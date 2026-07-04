// sao-preparser.js — Lorebook Pre-Parser Orchestration
// Parses lorebook entries into structured stores at chat-load time.
// Phase 1: Character profiles → npcStore
// Phase 2: Floor settings → floorStore
// Phase 3: Timeline entries → calendarStore.events
// Phase 4: World rules → worldStore.rules

import { getStore } from './sao-store-core.js';
import { initNpcFromWorldBook } from './sao-store-npc.js';
import { initFloorFromWorldBook, ensureAllFloorsExist } from './sao-store-floor.js';
import { getWorldStore } from './sao-store-world.js';
import { toCalendarStoreEvent } from './sao-calendar.js';
import { log } from './sao-core.js';

// ============================================================
// Constants
// ============================================================

const CURRENT_LORE_PARSER_VERSION = 2;

// ============================================================
// Hash helper
// ============================================================

/**
 * Compute a deterministic hash of enabled entries' content.
 * Samples first 64 + middle 32 + last 32 chars per entry for robust fingerprinting.
 * @param {Array} entries - character_book.entries
 * @returns {string}
 */
export function computeEntriesHash(entries) {
    if (!entries || !Array.isArray(entries) || entries.length === 0) return 'e0';

    let hash = 0;
    let totalCount = 0;

    for (const entry of entries) {
        // Hash ALL entries regardless of enabled state — disabling is an in-memory
        // plugin action that does not change card content. The hash must detect
        // actual card-content changes, not plugin disable state.
        const content = entry.content || '';
        totalCount++;

        // Sample from beginning, middle, and end of content
        const len = content.length;
        const sample = content.substring(0, 64)
            + content.substring(Math.max(0, Math.floor(len / 2) - 16), Math.floor(len / 2) + 16)
            + content.substring(Math.max(0, len - 32));

        for (let i = 0; i < sample.length; i++) {
            const ch = sample.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
    }

    // Mix in total count
    hash = ((hash << 5) - hash) + totalCount;
    hash = hash & hash;

    return 'lp' + Math.abs(hash).toString(36);
}

// ============================================================
// Phase 3: Timeline entries → calendarStore.events
// ============================================================

/**
 * Normalize a title for deduplication: strip whitespace, remove [tag] prefix, take first 20 chars.
 * Matches the _dedupKey pattern in sao-calendar.js.
 * @param {string} str
 * @returns {string}
 */
function _dedupKey(str) {
    return String(str || '').replace(/\s+/g, '').replace(/^\[[^\]]*\]/, '').substring(0, 20);
}

/**
 * Parse timeline entries (YYYY年M月 keyed) and write events to calendarStore.events.
 * Extracts top-level bullets as events under each date header.
 * @param {Array} entries - character_book.entries
 * @returns {number} count of events parsed
 */
export function parseTimelineEntries(entries) {
    const store = getStore();
    if (!store || !entries || !Array.isArray(entries)) return 0;

    const calStore = store.calendarStore;
    if (!calStore) return 0;
    if (!calStore.events) calStore.events = {};

    // Build set of enabled entry comments for stale data removal
    const enabledComments = new Set();
    for (const e of entries) {
        if (e.disable !== true) {
            enabledComments.add((e.comment || '').trim());
        }
    }

    // Remove canon events whose source entry is now disabled or no longer exists.
    // Non-canon events (appointments, custom, etc.) are preserved.
    for (const [dateStr, evArr] of Object.entries(calStore.events)) {
        if (!Array.isArray(evArr)) continue;
        const filtered = evArr.filter(ev => {
            if (ev.type !== 'canon') return true;
            if (!ev.sourceEntryId) return true; // legacy data without source tracking — keep
            return enabledComments.has(ev.sourceEntryId);
        });
        if (filtered.length !== evArr.length) {
            if (filtered.length === 0) {
                delete calStore.events[dateStr];
            } else {
                calStore.events[dateStr] = filtered;
            }
        }
    }

    // Filter timeline entries
    const timelineEntries = entries.filter(e =>
        e.disable !== true && /^\d{4}年\d{1,2}月/.test((e.comment || '').trim()) && (e.content || '').length > 10
    );

    let totalCount = 0;

    for (const entry of timelineEntries) {
        const comment = (entry.comment || '').trim();
        const ymMatch = comment.match(/(\d{4})年(\d{1,2})月/);
        if (!ymMatch) continue;

        const year = parseInt(ymMatch[1]);
        const entryMonthFromComment = parseInt(ymMatch[2]);
        const content = entry.content || '';

        let entryMonth = entryMonthFromComment;
        let curDay = 0;
        let eventBuf = [];

        const flushDay = () => {
            if (curDay > 0 && eventBuf.length > 0 && entryMonth > 0 && year) {
                const dateStr = year + '-' + String(entryMonth).padStart(2, '0') + '-' + String(curDay).padStart(2, '0');
                if (!calStore.events[dateStr]) calStore.events[dateStr] = [];

                for (const txt of eventBuf) {
                    // Dedup: normalize prefix match (same as _dedupKey)
                    const evKey = _dedupKey(txt);
                    const dup = calStore.events[dateStr].some(e => _dedupKey(e.title) === evKey);
                    if (dup) continue;

                    const evt = toCalendarStoreEvent({
                        type: 'canon',
                        title: txt,
                        description: '',
                    }, dateStr, calStore.events[dateStr].length);
                    evt.sourceEntryId = comment;
                    calStore.events[dateStr].push(evt);
                    totalCount++;
                }
            }
            eventBuf = [];
        };

        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Date header: #### **11月6日 (星期日) - 宣告日** or ### **2月下旬**
            const hdrM = trimmed.match(/^#{1,6}\s*\*{0,2}\s*(\d{1,2})月(\d{1,2})日/);
            if (hdrM) {
                flushDay();
                entryMonth = parseInt(hdrM[1]) || entryMonth;
                curDay = parseInt(hdrM[2]);
                continue;
            }

            if (curDay > 0) {
                // Top-level bullet: check indentation on RAW line (not trimmed)
                // Top-level: 0-3 spaces; sub-bullets: 4+ spaces
                const bulM = line.match(/^\s{0,3}[*\-+]\s+(.+)$/);
                if (bulM) {
                    let txt = bulM[1]
                        .replace(/\*\*([^*]+)\*\*/g, '$1')
                        .replace(/\*([^*]+)\*/g, '$1')
                        .replace(/^\[[^\]]*\]:\s*/, '')
                        .replace(/\s*\[[^\]]*\]:\s*/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (txt && txt.length > 1) eventBuf.push(txt);
                }
            }
        }
        flushDay();
    }

    return totalCount;
}

// ============================================================
// Phase 4: World rules → worldStore.rules
// ============================================================

/**
 * Parse world rule entries and write to worldStore.rules.
 * Extracts <directive> content and maps to topic keys.
 * @param {Array} entries - character_book.entries
 * @returns {number} count of rules parsed
 */
export function parseWorldRules(entries) {
    const ws = getWorldStore();
    if (!ws || !entries || !Array.isArray(entries)) return 0;

    // Simple hash for idempotency
    const simpleHash = (str) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h = h & h;
        }
        return 'w' + Math.abs(h).toString(36);
    };

    // Topic mapping: regex pattern → worldStore.rules key
    const TOPIC_MAP = [
        { pattern: /PK机制|PK规则/, topic: 'pk' },
        { pattern: /经济系统/, topic: 'economy' },
        { pattern: /等级|成长规则/, topic: 'leveling' },
        { pattern: /技能/, topic: 'skills' },
        { pattern: /剑技获取/, topic: 'combat' },
        { pattern: /冥想/, topic: 'meditation' },
        { pattern: /房屋/, topic: 'housing' },
        { pattern: /NPC档案构建/, topic: 'npc_rules' },
    ];

    if (!ws._rulesHashes) ws._rulesHashes = {};
    if (!ws._ruleSources) ws._ruleSources = {};

    // Build set of enabled entry comments for stale data removal
    const enabledComments = new Set();
    for (const e of entries) {
        if (e.disable !== true) {
            enabledComments.add((e.comment || '').trim());
        }
    }

    // Remove rules whose source entry is now disabled or no longer exists
    for (const [topic, sourceComment] of Object.entries(ws._ruleSources)) {
        if (!enabledComments.has(sourceComment)) {
            delete ws.rules[topic];
            delete ws._rulesHashes[topic];
            delete ws._ruleSources[topic];
        }
    }

    let count = 0;

    for (const entry of entries) {
        if (entry.disable === true) continue;
        const comment = (entry.comment || '').trim();
        if (!comment) continue;

        // Match against topic map
        let matchedTopic = null;
        for (const { pattern, topic } of TOPIC_MAP) {
            if (pattern.test(comment)) {
                matchedTopic = topic;
                break;
            }
        }
        if (!matchedTopic) continue;

        // Extract <directive> content
        const content = entry.content || '';
        const directiveMatch = content.match(/<directive[^>]*>([\s\S]*?)<\/directive>/);
        if (!directiveMatch) continue;

        // Clean: strip HTML comments, trim
        const cleaned = directiveMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
        if (!cleaned) continue;

        // Idempotency: skip if hash matches
        const hash = simpleHash(cleaned);
        if (ws._rulesHashes[matchedTopic] === hash) continue;

        ws.rules[matchedTopic] = cleaned;
        ws._rulesHashes[matchedTopic] = hash;
        ws._ruleSources[matchedTopic] = comment;
        count++;
    }

    return count;
}

// ============================================================
// Phase 5: Disable parsed entries in lorebook
// ============================================================

/**
 * Whitelist of entry comments that must NEVER be disabled.
 * These are format instructions, action rules, plugin protocols, and hybrid entries
 * that the LLM needs in its prompt context (cannot be retrieved via tool calls).
 * @type {string[]}  (prefix-matched: entries with trailing parentheticals
 * like "sao-格式（去掉…）" are still protected)
 */
const KEEP_ENABLED = [
    'sao-格式',
    'sao-注意事项（可能的错误）',
    'sao-数值由系统计算(插件接管)',
    'sao-标签输出与数值委托协议(插件)',
    'sao-NPC档案构建规则',
];

/**
 * Rule comments to tentatively keep enabled (small, frequently referenced).
 * These are parsed into worldStore.rules but remain injected for latency.
 * @type {string[]}  (prefix-matched)
 */
const RULES_KEEP_ENABLED = [
    'sao-PK机制',
    'sao-经济系统',
    'sao-等级',
];

/**
 * Rule comments whose data entries should be DISABLED (larger, less frequently needed).
 * Data is now in worldStore.rules, retrieved via get_world_setting tool.
 * @type {string[]}  (prefix-matched)
 */
const RULES_TO_DISABLE = [
    'sao-剑技获取',
    'sao-冥想',
    'sao-房屋',
];

/** Check if comment starts with any prefix in a list (prefix match, not exact). */
function matchesPrefix(comment, prefixes) {
    return prefixes.some(p => comment.startsWith(p));
}

/**
 * Decide whether an entry should be disabled after successful parsing.
 * Mirrors shouldDisableEntry logic from design doc §6.3.
 *
 * @param {Object} entry - lorebook entry object
 * @param {{ npcCount: number, floorCount: number, timelineCount: number, rulesCount: number }} parseResults - parse counts
 * @returns {boolean}
 */
function shouldDisableEntry(entry, parseResults) {
    // Never disable const entries (always injected by ST)
    if (entry.constant === true) return false;

    // Never disable already-disabled entries (don't inflate counts)
    if (entry.disable === true) return false;

    const comment = (entry.comment || '').trim();
    const content = entry.content || '';

    // Never disable entries in the KEEP_ENABLED whitelist
    if (matchesPrefix(comment, KEEP_ENABLED)) return false;

    // Never disable the tentative-keep rule entries
    if (matchesPrefix(comment, RULES_KEEP_ENABLED)) return false;

    // Disable character profile entries (NPC data now in npcStore)
    if (parseResults.npcCount > 0 && content.includes('characterProfile')) return true;

    // Disable floor entries (data now in floorStore)
    if (parseResults.floorCount > 0 && /第\d+层/.test(comment)) return true;

    // Disable timeline entries (data now in calendarStore)
    if (parseResults.timelineCount > 0 && /^\d{4}年\d{1,2}月/.test(comment)) return true;

    // Disable specific rule entries (data now in worldStore.rules)
    if (parseResults.rulesCount > 0 && matchesPrefix(comment, RULES_TO_DISABLE)) return true;

    return false;
}

/**
 * Disable parsed lorebook entries in-memory so ST no longer injects them.
 * LLM retrieves data via tool calls instead.
 *
 * SAFETY: Only mutates in-memory entry objects (entry.disable = true).
 * Same pattern as enableCardRegex (index.js:388-443) which disables MIGRATED_SCRIPTS.
 * Card file (.json) is NOT modified — reversible on plugin deactivation or card switch.
 *
 * @param {Array} entries - character_book.entries
 * @param {{ npcCount: number, floorCount: number, timelineCount: number, rulesCount: number } | null} parseResults
 * @returns {number} count of entries disabled
 */
export function disableParsedEntries(entries, parseResults) {
    if (!entries || !Array.isArray(entries) || !parseResults) return 0;

    // Safety guard: if all counts are 0, nothing was parsed — skip disabling
    if (parseResults.npcCount === 0 && parseResults.floorCount === 0
        && parseResults.timelineCount === 0 && parseResults.rulesCount === 0) {
        return 0;
    }

    let disabledCount = 0;
    let npcDisabled = 0;
    let floorDisabled = 0;
    let timelineDisabled = 0;
    let rulesDisabled = 0;

    for (const entry of entries) {
        if (!shouldDisableEntry(entry, parseResults)) continue;

        entry.disable = true;
        disabledCount++;

        // Track per-category for logging
        const comment = (entry.comment || '').trim();
        const content = entry.content || '';
        if (content.includes('characterProfile')) {
            npcDisabled++;
        } else if (/第\d+层/.test(comment)) {
            floorDisabled++;
        } else if (/^\d{4}年\d{1,2}月/.test(comment)) {
            timelineDisabled++;
        } else if (matchesPrefix(comment, RULES_TO_DISABLE)) {
            rulesDisabled++;
        }
    }

    if (disabledCount > 0) {
        log(`Lore pre-parser: disabled ${disabledCount} data entries (npc=${npcDisabled}, floor=${floorDisabled}, timeline=${timelineDisabled}, rules=${rulesDisabled})`);
    }

    return disabledCount;
}

// ============================================================
// Main orchestrator
// ============================================================

/**
 * Run the lorebook pre-parser on all entries.
 * Phase 1: Parse character profiles into npcStore.
 * Phase 2: Parse floor settings into floorStore.
 * Phase 3: Parse timeline entries into calendarStore.
 * Phase 4: Parse world rules into worldStore.rules.
 *
 * Idempotent: skips if already parsed with matching entry hash.
 * @param {Array} entries - character_book.entries
 * @returns {{ npcCount: number, floorCount: number, stubCount: number, timelineCount: number, rulesCount: number, disabledCount: number } | null}
 */
export function runLorebookPreParser(entries) {
    const store = getStore();
    if (!store) return null;

    // Idempotency check
    if (store.loreParsed?.version === CURRENT_LORE_PARSER_VERSION) {
        const currentHash = computeEntriesHash(entries);
        if (store.loreParsed.entryHash === currentHash) {
            log('Lore pre-parser: already parsed, skipping');
            return null;
        }
        log('Lore pre-parser: card content changed, re-parsing');
    }

    // Phase 1: Character profiles → npcStore
    const npcCount = initNpcFromWorldBook(entries);

    // Phase 2: Floor settings → floorStore
    const floorCount = initFloorFromWorldBook(entries);
    const stubCount = ensureAllFloorsExist();

    // Phase 3: Timeline entries → calendarStore
    const timelineCount = parseTimelineEntries(entries);

    // Phase 4: World rules → worldStore.rules
    const rulesCount = parseWorldRules(entries);

    // Phase 5: Disable parsed entries in lorebook
    const parseResults = { npcCount, floorCount, timelineCount, rulesCount };
    const disabledCount = disableParsedEntries(entries, parseResults);

    // Compute hash and set loreParsed flag.
    // Note: computeEntriesHash hashes content regardless of enabled state, so
    // disabling entries here does not affect the hash (correct: disable is a
    // plugin in-memory action, not a card-content change).
    const entryHash = computeEntriesHash(entries);

    store.loreParsed = {
        version: CURRENT_LORE_PARSER_VERSION,
        timestamp: new Date().toISOString(),
        entryHash,
        npcCount,
        floorCount,
        timelineCount,
        rulesCount,
        disabledCount,
    };

    log(`Lore pre-parser: parsed ${npcCount} NPCs, ${floorCount} floors, ${stubCount} stubs, ${timelineCount} timeline events, ${rulesCount} rules`);

    return { npcCount, floorCount, stubCount, timelineCount, rulesCount, disabledCount };
}
