import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock sao-core.js and sao-store-core.js
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks
import { runLorebookPreParser, computeEntriesHash } from '../sao-preparser.js';
import { getNpcByName, getNpcById } from '../sao-store-npc.js';
import { getFloorByNumber, getFloorById } from '../sao-store-floor.js';
import { log } from '../sao-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fresh store skeleton (matches DEFAULT_STORE structure)
// ─────────────────────────────────────────────────────────────────────────────
function makeEmptyStore() {
    return {
        schemaVersion: 1,
        npcStore: { byId: {}, nameToId: {} },
        floorStore: { byId: {}, numberToId: {} },
        skillStore: { byId: {}, nameToId: {} },
        equipmentStore: { byId: {}, nameToId: {} },
        playerStore: null,
        inventoryStore: null,
        calendarStore: { currentDate: null, events: {}, appointments: [] },
        questStore: { byId: {}, activeIds: [], completedIds: [] },
        consumableStore: { byId: {}, nameToId: {} },
        worldStore: { currentWeather: null, areaStatus: null, worldEvents: [], _updatedAt: null },
        actionLog: { entries: [], lastInjectedTurn: 0, currentTurn: 0 },
        runtime: {},
        panels: {},
        calendarPanels: {},
        loreParsed: null,
    };
}

beforeEach(() => {
    mockStore = makeEmptyStore();
    vi.mocked(log).mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeEntriesHash
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeEntriesHash', () => {
    it('returns same hash for same input', () => {
        const entries = [
            { content: 'hello', enabled: true },
            { content: 'world', enabled: true },
        ];
        const h1 = computeEntriesHash(entries);
        const h2 = computeEntriesHash(entries);
        expect(h1).toBe(h2);
    });

    it('returns different hash for different content', () => {
        const e1 = [{ content: 'abc', enabled: true }];
        const e2 = [{ content: 'xyz', enabled: true }];
        expect(computeEntriesHash(e1)).not.toBe(computeEntriesHash(e2));
    });

    it('skips disabled entries', () => {
        const e1 = [{ content: 'abc', enabled: true }];
        const e2 = [{ content: 'abc', enabled: true }, { content: 'disabled', enabled: false }];
        expect(computeEntriesHash(e1)).toBe(computeEntriesHash(e2));
    });

    it('returns deterministic value for empty/null', () => {
        expect(computeEntriesHash(null)).toBe('e0');
        expect(computeEntriesHash([])).toBe('e0');
        expect(computeEntriesHash(undefined)).toBe('e0');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 1: Character Profiles → npcStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 1: NPC profiles', () => {
    it('populates npcStore with character profiles', () => {
        const entries = [
            {
                keys: ['桐人', 'Kirito'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人 (Kirito)","basicInfo":{"realName":"桐谷和人","age":"14"}}}\n```',
            },
            {
                keys: ['亚丝娜', 'Asuna'],
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜 (Asuna)","basicInfo":{"realName":"结城明日奈","age":"15"}}}\n```',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.npcCount).toBe(2);

        const kirito = getNpcByName('桐人 (Kirito)');
        expect(kirito).toBeTruthy();
        expect(kirito.canon.characterName).toBe('桐人 (Kirito)');
        expect(kirito.canon.basicInfo.realName).toBe('桐谷和人');
        expect(kirito.source).toBe('worldbook');

        const asuna = getNpcByName('亚丝娜 (Asuna)');
        expect(asuna).toBeTruthy();
        expect(asuna.canon.characterName).toBe('亚丝娜 (Asuna)');
    });

    it('passes ALL entries to initNpcFromWorldBook (it internally filters)', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['楼层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层设定\n不是NPC内容',
            },
            {
                keys: ['设定'],
                comment: 'sao-世界设定',
                enabled: true,
                content: '一些世界规则设定',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.npcCount).toBe(1);
        expect(getNpcByName('桐人')).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 2: Floor settings → floorStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 2: Floor settings', () => {
    it('populates floorStore with floor entries', () => {
        const entries = [
            {
                keys: ['第1层', '1F'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层世界设定\n#### 核心原则：起始之野\n##### 主城區：【起始之鎮】\n迷宫区：地下迷宫\n守关Boss：伊尔方',
            },
            {
                keys: ['第2层', '2F'],
                comment: 'sao-第2层',
                enabled: true,
                content: '### 第二层世界设定\n#### 核心原则：迷雾森林\n##### 主城區：【乌尔巴斯】',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.floorCount).toBe(2);

        const floor1 = getFloorByNumber(1);
        expect(floor1).toBeTruthy();
        expect(floor1.floor_id).toBe('floor_001');
        expect(floor1.canon.theme).toContain('起始之野');
        expect(floor1.canon.mainTown).toContain('起始之鎮');

        const floor2 = getFloorByNumber(2);
        expect(floor2).toBeTruthy();
        expect(floor2.floor_id).toBe('floor_002');
    });

    it('handles mixed NPC + floor entries', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野\n主城區：【起始之鎮】',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.npcCount).toBe(1);
        expect(result.floorCount).toBe(1);
        expect(getNpcByName('桐人')).toBeTruthy();
        expect(getFloorByNumber(1)).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Idempotency
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Idempotency', () => {
    it('skips re-parse when loreParsed flag matches (same hash)', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
        ];

        // First run
        const result1 = runLorebookPreParser(entries);
        expect(result1).toBeTruthy();
        expect(result1.npcCount).toBe(1);
        vi.mocked(log).mockClear();

        // Second run — should skip
        const result2 = runLorebookPreParser(entries);
        expect(result2).toBeNull();
        expect(log).toHaveBeenCalledWith('Lore pre-parser: already parsed, skipping');
    });

    it('re-parses when entry content changes (hash mismatch)', () => {
        const entries1 = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人","basicInfo":{"age":"14"}}}\n```',
            },
        ];

        runLorebookPreParser(entries1);
        expect(getNpcByName('桐人').canon.basicInfo?.age).toBe('14');

        // Simulate card update: content changed
        const entries2 = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人","basicInfo":{"age":"16"}}}\n```',
            },
        ];

        vi.mocked(log).mockClear();
        const result2 = runLorebookPreParser(entries2);
        expect(result2).toBeTruthy();
        expect(getNpcByName('桐人').canon.basicInfo?.age).toBe('16');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('card content changed'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — loreParsed flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — loreParsed flag', () => {
    it('sets loreParsed with correct version, counts, and hash', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
        ];

        runLorebookPreParser(entries);

        expect(mockStore.loreParsed).toBeTruthy();
        expect(mockStore.loreParsed.version).toBe(1);
        expect(mockStore.loreParsed.npcCount).toBe(1);
        expect(mockStore.loreParsed.floorCount).toBe(1);
        expect(mockStore.loreParsed.entryHash).toBeTruthy();
        expect(mockStore.loreParsed.timestamp).toBeTruthy();
    });

    it('returns null when store is null', () => {
        mockStore = null;
        const entries = [{ content: 'test', enabled: true }];
        const result = runLorebookPreParser(entries);
        expect(result).toBeNull();
    });

    it('logs parse summary with counts', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['亚丝娜'],
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
        ];

        runLorebookPreParser(entries);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('2 NPCs'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('1 floors'));
    });
});
