// test/snapshotTest.js — P4a-prereq: Battle state snapshot test scaffold
// Usage: paste into browser console when a SAO battle panel is active.
// Captures battleState before/after each C-class function call:
//   performEnemyAction / executeTeammateAttackSequence / startNextRound / moveToNextAction
//
// Two capture strategies:
//   1. DOM-based (always works): reads current UI state from Shadow DOM
//   2. Module-based (preferred): uses serializeBattleState() via dynamic import
//
// Run SAO_BATTLE_SNAPSHOT.export() to get JSON fixtures for regression testing.

(async function () {
  'use strict';

  const LOG_PREFIX = '[SAO Snapshot]';
  const snapshots = [];
  let snapshotIndex = 0;
  let moduleApi = null; // Will hold { serializeBattleState } if module is accessible

  // ─── Try to access battleLogic module for rich snapshots ───
  try {
    // ES modules are singletons — dynamic import returns the same cached instance
    // Attempt common SillyTavern extension paths
    const candidates = [
      './scripts/extensions/third-party/SAO-Companion/battle/battleLogic.js',
      './scripts/extensions/third-party/sao-companion/battle/battleLogic.js',
    ];
    for (const path of candidates) {
      try {
        const mod = await import(path);
        if (typeof mod.serializeBattleState === 'function') {
          moduleApi = mod;
          console.log(`${LOG_PREFIX} Module access OK — using serializeBattleState() for rich snapshots`);
          break;
        }
      } catch (_) { /* try next */ }
    }
  } catch (_) { /* ignore */ }

  if (!moduleApi) {
    console.log(`${LOG_PREFIX} Module not accessible — falling back to DOM-only capture`);
  }

  // ─── DOM-based state capture ───
  function findShadowRoot() {
    const host = document.querySelector('.sao-render-host[data-sao-tag="battle"]');
    return host ? host.shadowRoot : null;
  }

  function parseStatText(text) {
    // Parses "120/150 (+5/回合)" → { current: 120, max: 150, regen: 5 }
    if (!text) return null;
    const match = text.match(/(\d+)\s*\/\s*(\d+)(?:\s*\(\+?(\d+))?/);
    if (match) return { current: +match[1], max: +match[2], regen: +match[3] };
    const simple = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (simple) return { current: +simple[1], max: +simple[2] };
    return { raw: text };
  }

  function captureFromDOM() {
    const shadow = findShadowRoot();
    if (!shadow) return null;

    const data = {};

    // Player HP/MP/AP
    const hpText = shadow.querySelector('.player-hp .hp-text');
    const mpText = shadow.querySelector('.player-mp .hp-text, .player-mp .mp-text');
    const hpFill = shadow.querySelector('.player-hp .hp-fill');
    const mpFill = shadow.querySelector('.player-mp .mp-fill, .player-mp .hp-fill');
    const apText = shadow.querySelector('.player-ap .ap-text');

    data.player = {
      hp: parseStatText(hpText?.textContent),
      mp: parseStatText(mpText?.textContent),
      ap: parseStatText(apText?.textContent),
      hpBarWidth: hpFill?.style?.width || null,
      mpBarWidth: mpFill?.style?.width || null,
    };

    // Player buffs (from buff icons if present)
    const buffEls = shadow.querySelectorAll('.player-buffs .buff-icon, .status-buff');
    if (buffEls.length) {
      data.player.buffs = Array.from(buffEls).map(el => ({
        name: el.getAttribute('data-buff-name') || el.title || el.textContent?.trim() || '',
        type: el.getAttribute('data-buff-type') || '',
      }));
    }

    // Enemies
    const enemyItems = shadow.querySelectorAll('.enemy-item');
    data.enemies = Array.from(enemyItems).map((el, i) => {
      const name = el.querySelector('.enemy-name')?.textContent?.trim() || '';
      const hp = parseStatText(el.querySelector('.enemy-hp .hp-text')?.textContent);
      const hpBar = el.querySelector('.enemy-hp .hp-fill')?.style?.width || null;
      const isSelected = el.classList.contains('selected');
      return { index: i, name, hp, hpBarWidth: hpBar, selected: isSelected };
    });

    // Action order
    const actionDisplay = shadow.querySelector('#action-order-display');
    if (actionDisplay) {
      const items = actionDisplay.querySelectorAll('.action-order-item');
      data.actionOrder = Array.from(items).map((el, i) => ({
        name: el.querySelector('.action-order-name')?.textContent?.trim() || '',
        speed: el.querySelector('.action-order-speed')?.textContent?.trim() || '',
        type: el.className.includes('player') ? 'player'
          : el.className.includes('enemy') ? 'enemy'
          : el.className.includes('teammate') ? 'teammate' : '',
        isCurrent: el.classList.contains('current'),
      }));
    }

    // Round — try to parse from combat title or action-order context
    const roundMatch = shadow.querySelector('#combat-title')?.textContent?.match(/(\d+)/);
    data.round = roundMatch ? +roundMatch[1] : null;

    return data;
  }

  // ─── Unified capture (module > DOM) ───
  function captureState(label, hookName) {
    const snapshot = {
      index: snapshotIndex++,
      label,
      hookName: hookName || null,
      timestamp: Date.now(),
    };

    // Prefer module-level serializeBattleState for deep data
    if (moduleApi) {
      try {
        const serialized = moduleApi.serializeBattleState();
        if (serialized) {
          snapshot.source = 'module';
          snapshot.battleState = serialized;
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX} serializeBattleState failed, falling back to DOM`, e);
      }
    }

    // Always capture DOM state too (for visual regression)
    const domState = captureFromDOM();
    if (domState) {
      snapshot.source = snapshot.source || 'dom';
      snapshot.dom = domState;
    }

    if (!snapshot.battleState && !snapshot.dom) {
      console.warn(`${LOG_PREFIX} Could not capture state — is battle panel active?`);
      return null;
    }

    return snapshot;
  }

  // ─── Polling-based capture ───
  // Since the 4 C-class functions are module-scoped and cannot be monkey-patched,
  // we provide a polling mode that captures state at regular intervals.
  // This is useful for capturing state transitions without manual before/after calls.

  let _pollInterval = null;

  function startPolling(intervalMs) {
    if (_pollInterval) clearInterval(_pollInterval);
    _pollInterval = setInterval(() => {
      const snap = captureState('POLL', 'polling');
      if (snap) {
        // Dedup: only store if state actually changed from last snapshot
        const lastSnap = snapshots[snapshots.length - 1];
        const prevJson = lastSnap ? JSON.stringify(lastSnap.battleState || lastSnap.dom) : '';
        const currJson = JSON.stringify(snap.battleState || snap.dom);
        if (prevJson !== currJson) {
          snapshots.push(snap);
          console.log(`${LOG_PREFIX} Poll captured #${snap.index} (state changed)`);
        }
      }
    }, intervalMs);
    console.log(`${LOG_PREFIX} Polling started every ${intervalMs}ms — call SAO_BATTLE_SNAPSHOT.stopPolling() to stop`);
  }

  function stopPolling() {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
      console.log(`${LOG_PREFIX} Polling stopped. Total snapshots: ${snapshots.length}`);
    }
  }

  // ─── Monkey-patch attempt: wrap the 4 C-class functions ───
  // Since these are module-scoped, we cannot directly wrap them from console.
  // BUT we can try to intercept by scanning the module exports or window objects.
  // If no direct access, we fall back to the manual API + MutationObserver.

  const C_CLASS_FUNCTIONS = [
    'performEnemyAction',
    'executeTeammateAttackSequence',
    'startNextRound',
    'moveToNextAction',
  ];

  // ─── Public API ───
  window.SAO_BATTLE_SNAPSHOT = {

    /**
     * Manual capture: call BEFORE triggering a C-class action.
     * @param {string} label — descriptive label, e.g. "performEnemyAction"
     * @returns {object|null} the snapshot
     */
    before(label) {
      const snap = captureState('BEFORE: ' + label, 'manual');
      if (snap) {
        snapshots.push(snap);
        console.log(`${LOG_PREFIX} BEFORE:`, label, snap);
      }
      return snap;
    },

    /**
     * Manual capture: call AFTER a C-class action completes.
     * @param {string} label — descriptive label, e.g. "performEnemyAction"
     * @returns {object|null} the snapshot
     */
    after(label) {
      const snap = captureState('AFTER: ' + label, 'manual');
      if (snap) {
        snapshots.push(snap);
        console.log(`${LOG_PREFIX} AFTER:`, label, snap);
      }
      return snap;
    },

    /**
     * Export all captured snapshots as a JSON string.
     * Also copies to clipboard if available.
     * @returns {string} JSON string of snapshots
     */
    export() {
      const result = {
        meta: {
          exportedAt: new Date().toISOString(),
          totalSnapshots: snapshots.length,
          cClassFunctions: C_CLASS_FUNCTIONS,
          captureSource: moduleApi ? 'module+dom' : 'dom-only',
        },
        snapshots,
      };
      const json = JSON.stringify(result, null, 2);
      console.log(`${LOG_PREFIX} Exported ${snapshots.length} snapshots`);

      if (navigator.clipboard) {
        navigator.clipboard.writeText(json).then(
          () => console.log(`${LOG_PREFIX} Copied to clipboard`),
          () => console.log(`${LOG_PREFIX} Clipboard write failed — use the returned string`),
        );
      }
      return json;
    },

    /**
     * Download snapshots as a .json file.
     * @param {string} filename — defaults to battle-snapshots-{timestamp}.json
     */
    download(filename) {
      const result = {
        meta: {
          exportedAt: new Date().toISOString(),
          totalSnapshots: snapshots.length,
          cClassFunctions: C_CLASS_FUNCTIONS,
          captureSource: moduleApi ? 'module+dom' : 'dom-only',
        },
        snapshots,
      };
      const json = JSON.stringify(result, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `battle-snapshots-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`${LOG_PREFIX} Download triggered: ${a.download}`);
    },

    /**
     * Clear all snapshots and reset index.
     */
    clear() {
      snapshots.length = 0;
      snapshotIndex = 0;
      console.log(`${LOG_PREFIX} Cleared`);
    },

    /**
     * @returns {number} current snapshot count
     */
    count() {
      return snapshots.length;
    },

    /**
     * Return a summary of all snapshots (lightweight, no full data).
     */
    summary() {
      return snapshots.map(s => ({
        index: s.index,
        label: s.label,
        hook: s.hookName,
        source: s.source,
        time: new Date(s.timestamp).toISOString(),
        playerHp: s.battleState?.player?.hp ?? s.dom?.player?.hp?.current ?? '?',
        playerMp: s.battleState?.player?.mp ?? s.dom?.player?.mp?.current ?? '?',
        enemyCount: s.battleState?.enemies?.length ?? s.dom?.enemies?.length ?? '?',
        round: s.battleState?.round ?? s.dom?.round ?? '?',
      }));
    },

    /** @type {MutationObserver|null} */
    autoCapture: null,

    /**
     * Start auto-capture via MutationObserver on the battle panel Shadow DOM.
     * Debounced: one snapshot per DOM mutation batch (max 2/sec).
     */
    startAutoCapture() {
      const host = document.querySelector('.sao-render-host[data-sao-tag="battle"]');
      if (!host?.shadowRoot) {
        console.warn(`${LOG_PREFIX} No battle panel Shadow DOM found`);
        return;
      }

      let lastCapture = 0;
      const DEBOUNCE_MS = 500;

      this.autoCapture = new MutationObserver((mutations) => {
        const now = Date.now();
        if (now - lastCapture < DEBOUNCE_MS) return;
        lastCapture = now;

        // Summarize what changed
        const changed = new Set();
        for (const m of mutations) {
          if (m.type === 'childList') changed.add('childList');
          if (m.type === 'attributes') changed.add('attr:' + m.attributeName);
        }

        const snap = captureState('AUTO: ' + [...changed].join(', '), 'mutationObserver');
        if (snap) {
          snapshots.push(snap);
          console.log(`${LOG_PREFIX} Auto-captured #${snap.index} (${[...changed].join(', ')})`);
        }
      });

      this.autoCapture.observe(host.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'data-hp', 'data-mp'],
      });

      console.log(`${LOG_PREFIX} Auto-capture started (debounce ${DEBOUNCE_MS}ms)`);
      console.log(`${LOG_PREFIX} Play through a battle round, then call SAO_BATTLE_SNAPSHOT.stopAutoCapture()`);
    },

    /**
     * Stop auto-capture and report results.
     */
    stopAutoCapture() {
      if (this.autoCapture) {
        this.autoCapture.disconnect();
        this.autoCapture = null;
        console.log(`${LOG_PREFIX} Auto-capture stopped. Total snapshots: ${snapshots.length}`);
      } else {
        console.log(`${LOG_PREFIX} Auto-capture was not running`);
      }
    },

    /**
     * Start polling-based capture at the given interval.
     * Only stores snapshots when state actually changes (deduped).
     * @param {number} intervalMs — poll interval in ms (default 1000)
     */
    startPolling(intervalMs) {
      startPolling(intervalMs || 1000);
    },

    /**
     * Stop polling-based capture.
     */
    stopPolling() {
      stopPolling();
    },

    /**
     * @returns {boolean} whether module-level access was obtained
     */
    hasModuleAccess() {
      return !!moduleApi;
    },

    /**
     * List the 4 C-class functions targeted by this scaffold.
     */
    targets() {
      return C_CLASS_FUNCTIONS;
    },
  };

  // ─── Console help ───
  console.log(`${LOG_PREFIX} Test scaffold loaded. Module access: ${moduleApi ? 'YES' : 'NO'}`);
  console.log(`${LOG_PREFIX} Commands:`);
  console.log('  SAO_BATTLE_SNAPSHOT.before("performEnemyAction")  — capture before action');
  console.log('  SAO_BATTLE_SNAPSHOT.after("performEnemyAction")   — capture after action');
  console.log('  SAO_BATTLE_SNAPSHOT.startAutoCapture()            — auto-capture on DOM mutations');
  console.log('  SAO_BATTLE_SNAPSHOT.stopAutoCapture()             — stop auto-capture');
  console.log('  SAO_BATTLE_SNAPSHOT.startPolling(1000)            — poll state every N ms');
  console.log('  SAO_BATTLE_SNAPSHOT.stopPolling()                 — stop polling');
  console.log('  SAO_BATTLE_SNAPSHOT.export()                      — export JSON (clipboard)');
  console.log('  SAO_BATTLE_SNAPSHOT.download()                    — download JSON file');
  console.log('  SAO_BATTLE_SNAPSHOT.summary()                     — lightweight overview');
  console.log('  SAO_BATTLE_SNAPSHOT.clear()                       — clear all snapshots');
  console.log(`${LOG_PREFIX} C-class targets: ${C_CLASS_FUNCTIONS.join(', ')}`);
})();
