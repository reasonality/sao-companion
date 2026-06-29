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
import {
    initNpcFromWorldBook,
    getNpcByName,
    getNpcById,
    findOrCreateNpc,
    validateNpcEntry,
} from '../sao-store-npc.js';
import {
    initFloorFromWorldBook,
    getFloorByNumber,
    getFloorById,
    validateFloorEntry,
} from '../sao-store-floor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fresh store skeleton
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
        runtime: {},
        panels: {},
        calendarPanels: {},
    };
}

beforeEach(() => {
    mockStore = makeEmptyStore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// NPC Store — init from world book
// ═══════════════════════════════════════════════════════════════════════════════

describe('initNpcFromWorldBook', () => {
    it('parses characterProfile JSON from entry content', () => {
        const entries = [{
            keys: ['亚丝娜', 'Asuna'],
            comment: 'sao-亚丝娜',
            content: '```json\n{"characterProfile":{"characterName":"亚丝娜 (Asuna)","basicInfo":{"realName":"结城明日奈"}}}\n```',
        }];
        const count = initNpcFromWorldBook(entries);
        expect(count).toBe(1);

        const npc = getNpcByName('亚丝娜 (Asuna)');
        expect(npc).toBeTruthy();
        expect(npc.canon.characterName).toBe('亚丝娜 (Asuna)');
        expect(npc.source).toBe('worldbook');
        expect(npc._canonHash).toBeTruthy();
    });

    it('extracts aliases from entry keys (excluding npcName)', () => {
        const entries = [{
            keys: ['亚丝娜', 'Asuna', '闪光'],
            comment: 'sao-亚丝娜',
            content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
        }];
        initNpcFromWorldBook(entries);

        // '亚丝娜' is the npcName, so aliases are ['Asuna', '闪光']
        const npc = getNpcByName('亚丝娜');
        expect(npc.aliases).toContain('Asuna');
        expect(npc.aliases).toContain('闪光');

        // Alias lookup should also work
        expect(getNpcByName('Asuna')).toBe(npc);
        expect(getNpcByName('闪光')).toBe(npc);
    });

    it('skips entries without characterProfile in content', () => {
        const entries = [{
            keys: ['楼层'],
            comment: '第1层',
            content: '### 第一层设定\n这是楼层描述',
        }];
        const count = initNpcFromWorldBook(entries);
        expect(count).toBe(0);
    });

    it('skips entries with empty npcName', () => {
        const entries = [{
            keys: ['unknown'],
            comment: '',
            content: '```json\n{"characterProfile":{"characterName":""}}\n```',
        }];
        const count = initNpcFromWorldBook(entries);
        expect(count).toBe(0);
    });

    it('handles multiple NPC entries', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['亚丝娜'],
                comment: 'sao-亚丝娜',
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
        ];
        const count = initNpcFromWorldBook(entries);
        expect(count).toBe(2);
        expect(getNpcByName('桐人')).toBeTruthy();
        expect(getNpcByName('亚丝娜')).toBeTruthy();
    });

    it('updates canon on re-init when content hash changes', () => {
        const entries1 = [{
            keys: ['测试NPC'],
            comment: 'test',
            content: '```json\n{"characterProfile":{"characterName":"测试NPC","basicInfo":{"age":"20"}}}\n```',
        }];
        initNpcFromWorldBook(entries1);
        const npc1 = getNpcByName('测试NPC');
        expect(npc1.canon.basicInfo?.age).toBe('20');

        // Re-init with updated content
        const entries2 = [{
            keys: ['测试NPC'],
            comment: 'test',
            content: '```json\n{"characterProfile":{"characterName":"测试NPC","basicInfo":{"age":"25"}}}\n```',
        }];
        const count = initNpcFromWorldBook(entries2);
        expect(count).toBe(1);  // counted as existing
        const npc2 = getNpcByName('测试NPC');
        expect(npc2.canon.basicInfo?.age).toBe('25');  // updated
    });

    it('skips unchanged content on re-init (same hash)', () => {
        const entry = {
            keys: ['稳定NPC'],
            comment: 'test',
            content: '```json\n{"characterProfile":{"characterName":"稳定NPC"}}\n```',
        };
        initNpcFromWorldBook([entry]);
        const npc1 = getNpcByName('稳定NPC');
        const hash1 = npc1._canonHash;

        initNpcFromWorldBook([entry]);
        const npc2 = getNpcByName('稳定NPC');
        expect(npc2._canonHash).toBe(hash1);  // hash unchanged
    });

    it('returns 0 for null/empty entries', () => {
        expect(initNpcFromWorldBook(null)).toBe(0);
        expect(initNpcFromWorldBook([])).toBe(0);
        expect(initNpcFromWorldBook(undefined)).toBe(0);
    });

    it('handles entries with content outside json fences', () => {
        const entries = [{
            keys: ['自由格式NPC'],
            comment: 'test',
            content: '一些描述文字\n{"characterProfile":{"characterName":"自由格式NPC"}}\n更多文字',
        }];
        const count = initNpcFromWorldBook(entries);
        expect(count).toBe(1);
        expect(getNpcByName('自由格式NPC')).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// NPC Store — basic CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('NPC Store CRUD', () => {
    it('findOrCreateNpc creates new NPC', () => {
        const id = findOrCreateNpc('克莱因', ['Klein']);
        expect(id).toBeTruthy();

        const npc = getNpcById(id);
        expect(npc.name).toBe('克莱因');
        expect(npc.aliases).toContain('Klein');
    });

    it('findOrCreateNpc is idempotent — same name returns same ID', () => {
        const id1 = findOrCreateNpc('克莱因');
        const id2 = findOrCreateNpc('克莱因', ['Klein']);
        expect(id1).toBe(id2);

        // Aliases should be merged
        const npc = getNpcById(id1);
        expect(npc.aliases).toContain('Klein');
    });

    it('findOrCreateNpc returns null for empty name', () => {
        expect(findOrCreateNpc('')).toBeNull();
        expect(findOrCreateNpc(null)).toBeNull();
    });

    it('getNpcByName returns null for nonexistent', () => {
        expect(getNpcByName('不存在')).toBeNull();
    });

    it('validateNpcEntry rejects missing npc_id', () => {
        const result = validateNpcEntry({ name: 'test' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('npc_id'))).toBe(true);
    });

    it('validateNpcEntry accepts valid data', () => {
        const result = validateNpcEntry({
            npc_id: 'npc_test',
            name: '测试NPC',
            aliases: ['alias1'],
            canon: {},
            state: { affinity: 0 },
            observations: [],
            source: 'manual',
        });
        expect(result.valid).toBe(true);
    });

    it('validateNpcEntry rejects invalid source', () => {
        const result = validateNpcEntry({
            npc_id: 'npc_test',
            name: 'test',
            source: 'invalid',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('source'))).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Floor Store — init from world book
// ═══════════════════════════════════════════════════════════════════════════════

describe('initFloorFromWorldBook', () => {
    it('extracts floor number from "第N层" comment pattern', () => {
        const entries = [{
            keys: ['第一层', '第1层'],
            comment: 'sao-第1层',
            content: '### 第一层世界设定\n#### 核心原则：起始之野\n##### 主城區：【起始之鎮】\n迷宫区：地下迷宫\n守关Boss：伊尔方',
        }];
        const count = initFloorFromWorldBook(entries);
        expect(count).toBe(1);

        const floor = getFloorByNumber(1);
        expect(floor).toBeTruthy();
        expect(floor.floor_number).toBe(1);
        expect(floor.floor_id).toBe('floor_001');
        expect(floor.canon.rawContent).toContain('第一层');
        expect(floor.canon.theme).toContain('起始之野');
        expect(floor.canon.mainTown).toContain('起始之鎮');
        expect(floor.source).toBe('worldbook');
    });

    it('extracts floor number from "NF" pattern', () => {
        const entries = [{
            keys: ['55F'],
            comment: '55F',
            content: '第五十五层\n主城區：【帕那雷赛】',
        }];
        const count = initFloorFromWorldBook(entries);
        expect(count).toBe(1);

        const floor = getFloorByNumber(55);
        expect(floor).toBeTruthy();
        expect(floor.floor_id).toBe('floor_055');
    });

    it('extracts floor number from "floor N" pattern', () => {
        const entries = [{
            keys: ['floor 10'],
            comment: 'floor 10',
            content: '第十层设定',
        }];
        const count = initFloorFromWorldBook(entries);
        expect(count).toBe(1);
        expect(getFloorByNumber(10)).toBeTruthy();
    });

    it('skips non-floor entries', () => {
        const entries = [{
            keys: ['亚丝娜'],
            comment: 'sao-亚丝娜',
            content: '```json\n{"characterProfile":{}}\n```',
        }];
        const count = initFloorFromWorldBook(entries);
        expect(count).toBe(0);
    });

    it('handles multiple floor entries', () => {
        const entries = [
            { keys: ['第1层'], comment: 'sao-第1层', content: '第一层设定' },
            { keys: ['第2层'], comment: 'sao-第2层', content: '第二层设定' },
            { keys: ['第3层'], comment: 'sao-第3层', content: '第三层设定' },
        ];
        const count = initFloorFromWorldBook(entries);
        expect(count).toBe(3);
        expect(getFloorByNumber(1)).toBeTruthy();
        expect(getFloorByNumber(2)).toBeTruthy();
        expect(getFloorByNumber(3)).toBeTruthy();
    });

    it('updates canon on re-init when content hash changes', () => {
        const entries1 = [{
            keys: ['第1层'],
            comment: 'sao-第1层',
            content: '第一层原始设定',
        }];
        initFloorFromWorldBook(entries1);
        expect(getFloorByNumber(1).canon.rawContent).toBe('第一层原始设定');

        const entries2 = [{
            keys: ['第1层'],
            comment: 'sao-第1层',
            content: '第一层更新设定',
        }];
        initFloorFromWorldBook(entries2);
        expect(getFloorByNumber(1).canon.rawContent).toBe('第一层更新设定');
    });

    it('returns 0 for null/empty entries', () => {
        expect(initFloorFromWorldBook(null)).toBe(0);
        expect(initFloorFromWorldBook([])).toBe(0);
        expect(initFloorFromWorldBook(undefined)).toBe(0);
    });

    it('extracts labyrinth and boss info from content', () => {
        const entries = [{
            keys: ['第1层'],
            comment: 'sao-第1层',
            content: '迷宫区：地下洞窟迷宫\n守关Boss：【狂暴牛头人】',
        }];
        initFloorFromWorldBook(entries);
        const floor = getFloorByNumber(1);
        expect(floor.canon.labyrinth).toContain('地下洞窟迷宫');
        expect(floor.canon.boss).toContain('狂暴牛头人');
    });

    it('numberToId mapping is correct', () => {
        const entries = [
            { keys: ['第1层'], comment: '第1层', content: '设定' },
            { keys: ['第48层'], comment: '第48层', content: '设定' },
        ];
        initFloorFromWorldBook(entries);

        expect(getFloorById('floor_001')).toBeTruthy();
        expect(getFloorById('floor_048')).toBeTruthy();
        expect(getFloorById('floor_001').floor_number).toBe(1);
        expect(getFloorById('floor_048').floor_number).toBe(48);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Floor Store — validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Floor Store validation', () => {
    it('validateFloorEntry rejects missing floor_id', () => {
        const result = validateFloorEntry({ floor_number: 1, name: '第1层' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('floor_id'))).toBe(true);
    });

    it('validateFloorEntry rejects floor_number < 1', () => {
        const result = validateFloorEntry({
            floor_id: 'floor_000',
            floor_number: 0,
            name: 'test',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('floor_number'))).toBe(true);
    });

    it('validateFloorEntry accepts valid data', () => {
        const result = validateFloorEntry({
            floor_id: 'floor_001',
            floor_number: 1,
            name: '第1层',
            canon: { rawContent: 'test' },
            state: { unlocked: true },
            source: 'worldbook',
        });
        expect(result.valid).toBe(true);
    });

    it('validateFloorEntry rejects invalid source', () => {
        const result = validateFloorEntry({
            floor_id: 'floor_001',
            floor_number: 1,
            name: 'test',
            source: 'invalid',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('source'))).toBe(true);
    });
});
