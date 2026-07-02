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

const CURRENT_LORE_PARSER_VERSION = 1;

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
    let enabledCount = 0;

    for (const entry of entries) {
        if (entry.enabled === false) continue;
        const content = entry.content || '';
        enabledCount++;

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

    // Mix in enabled count
    hash = ((hash << 5) - hash) + enabledCount;
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

    // Filter timeline entries
    const timelineEntries = entries.filter(e =>
        e.enabled !== false && /^\d{4}年\d{1,2}月/.test((e.comment || '').trim()) && (e.content || '').length > 10
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

                    calStore.events[dateStr].push(toCalendarStoreEvent({
                        type: 'canon',
                        title: txt,
                        description: txt,
                    }, dateStr, calStore.events[dateStr].length));
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
    let count = 0;

    for (const entry of entries) {
        if (entry.enabled === false) continue;
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
        count++;
    }

    return count;
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
 * @param {string} [arc] - current arc key (default 'sao')
 * @returns {{ npcCount: number, floorCount: number, stubCount: number, timelineCount: number, rulesCount: number } | null}
 */
export function runLorebookPreParser(entries, arc) {
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
    const stubCount = ensureAllFloorsExist(arc || 'sao');

    // Phase 3: Timeline entries → calendarStore
    const timelineCount = parseTimelineEntries(entries);

    // Phase 4: World rules → worldStore.rules
    const rulesCount = parseWorldRules(entries);

    // Compute hash and set loreParsed flag
    const entryHash = computeEntriesHash(entries);

    store.loreParsed = {
        version: CURRENT_LORE_PARSER_VERSION,
        timestamp: new Date().toISOString(),
        entryHash,
        npcCount,
        floorCount,
        timelineCount,
        rulesCount,
    };

    log(`Lore pre-parser: parsed ${npcCount} NPCs, ${floorCount} floors, ${stubCount} stubs, ${timelineCount} timeline events, ${rulesCount} rules`);

    return { npcCount, floorCount, stubCount, timelineCount, rulesCount };
}
