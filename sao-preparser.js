// sao-preparser.js — Lorebook Pre-Parser Orchestration
// Parses lorebook entries into structured stores at chat-load time.
// Phase 1: Character profiles → npcStore
// Phase 2: Floor settings → floorStore

import { getStore } from './sao-store-core.js';
import { initNpcFromWorldBook } from './sao-store-npc.js';
import { initFloorFromWorldBook, ensureAllFloorsExist } from './sao-store-floor.js';
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
// Main orchestrator
// ============================================================

/**
 * Run the lorebook pre-parser on all entries.
 * Phase 1: Parse character profiles into npcStore.
 * Phase 2: Parse floor settings into floorStore.
 *
 * Idempotent: skips if already parsed with matching entry hash.
 * @param {Array} entries - character_book.entries
 * @param {string} [arc] - current arc key (default 'sao')
 * @returns {{ npcCount: number, floorCount: number, stubCount: number } | null}
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

    // Compute hash and set loreParsed flag
    const entryHash = computeEntriesHash(entries);

    store.loreParsed = {
        version: CURRENT_LORE_PARSER_VERSION,
        timestamp: new Date().toISOString(),
        entryHash,
        npcCount,
        floorCount,
    };

    log(`Lore pre-parser: parsed ${npcCount} NPCs, ${floorCount} floors, ${stubCount} stubs`);

    return { npcCount, floorCount, stubCount };
}
