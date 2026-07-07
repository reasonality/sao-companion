import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock store modules with controlled data
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
    getContext: vi.fn(() => ({
        chatMetadata: {},
        saveMetadata: vi.fn(),
    })),
    safe: (fn, label) => { try { return fn(); } catch { return null; } },
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn(),
}));
vi.mock('../sao-store-player.js', () => ({
    getPlayerStore: vi.fn(() => mockStore?.playerStore || null),
}));
vi.mock('../sao-store-equipment.js', () => ({
    getEquipmentById: vi.fn((id) => mockStore?.equipmentStore?.byId?.[id] || null),
    getEquipmentStore: vi.fn(() => mockStore?.equipmentStore || { byId: {}, nameToId: {} }),
}));
vi.mock('../sao-store-skill.js', () => ({
    getSkillById: vi.fn((id) => mockStore?.skillStore?.byId?.[id] || null),
    getSkillStore: vi.fn(() => mockStore?.skillStore || { byId: {}, nameToId: {} }),
}));
vi.mock('../sao-store-inventory.js', () => ({
    getInventoryStore: vi.fn(() => mockStore?.inventoryStore || null),
    getCurrency: vi.fn(() => mockStore?.inventoryStore?.currency?.cor ?? 0),
}));
vi.mock('../sao-context-inject.js', () => ({
    buildContextualInjection: vi.fn(() => ''),
    injectContextualCanon: vi.fn(() => ''),
}));

// Import after mocks
import { projectCompactState, projectFullState, projectEquipmentSummary, projectSkillSummary, projectStateHint } from '../sao-state-projection.js';
import { cleanTimelinePromptText } from '../sao-prompt.js';

describe('projectCompactState', () => {
    beforeEach(() => { mockStore = null; });

    it('null store returns empty or fallback string, no crash', () => {
        const result = projectCompactState();
        expect(typeof result).toBe('string');
    });

    it('with full player data produces expected format', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 1000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: { weapon: 'equip_001', off_hand: null, head: null, chest: 'equip_002', hands: null, legs: null, accessory: null },
                skills: [{ skill_id: 'skill_1', name: '水平方阵斩', proficiency: 3 }],
                customSkills: [],
            },
            equipmentStore: {
                byId: {
                    equip_001: { name: '阐释者', stats: { atk: 40, str: 10 } },
                    equip_002: { name: '黑衣', stats: { agi: 5, vit: 10 } },
                },
            },
            skillStore: { byId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 5000 }, items: [{ item_id: 'i1', type: 'consumable', name: '回复药水', qty: 3 }] },
            runtime: {},
        };
        const result = projectCompactState();
        expect(result).toContain('桐人');
        expect(result).toContain('Lv25');
        expect(result).toContain('阐释者');
        // Should NOT contain IDs
        expect(result).not.toContain('equip_');
        expect(result).not.toContain('skill_');
    });

    it('uses store HP (combat HP override removed)', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 1000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            runtime: {
                _zd_parsed: {
                    player: { hp: 300, max_hp: 585 },
                    enemies: [{ name: 'BOSS', hp: 500, max_hp: 1000 }],
                },
            },
        };
        const result = projectCompactState();
        // Combat HP override removed — shows store HP (585)
        expect(result).toContain('585/585');
    });
});

describe('projectEquipmentSummary', () => {
    beforeEach(() => { mockStore = null; });

    it('null store returns empty string', () => {
        const result = projectEquipmentSummary();
        expect(typeof result).toBe('string');
    });

    it('shows equipment names with key stats', () => {
        mockStore = {
            playerStore: {
                equipment: { weapon: 'e1', off_hand: null, head: null, chest: 'e2', hands: null, legs: null, accessory: null },
            },
            equipmentStore: {
                byId: {
                    e1: { name: '阐释者', stats: { atk: 40, str: 10 } },
                    e2: { name: '黑衣', stats: { agi: 5, vit: 10 } },
                },
            },
        };
        const result = projectEquipmentSummary();
        expect(result).toContain('阐释者');
        expect(result).toContain('黑衣');
        expect(result).not.toContain('e1');
        expect(result).not.toContain('e2');
    });
});

describe('projectSkillSummary', () => {
    beforeEach(() => { mockStore = null; });

    it('null store returns empty string', () => {
        const result = projectSkillSummary();
        expect(typeof result).toBe('string');
    });

    it('shows skill names with proficiency', () => {
        mockStore = {
            playerStore: {
                skills: [
                    { skill_id: 's1', name: '水平方阵斩', proficiency: 3 },
                    { skill_id: 's2', name: '治疗', proficiency: 1 },
                ],
            },
            skillStore: { byId: {}, nameToId: {} },
        };
        const result = projectSkillSummary();
        expect(result).toContain('水平方阵斩');
        expect(result).toContain('治疗');
        expect(result).not.toContain('s1');
        expect(result).not.toContain('s2');
    });
});

describe('projectStateHint', () => {
    beforeEach(() => { mockStore = null; });

    it('null store returns empty string, no crash', () => {
        const result = projectStateHint();
        expect(typeof result).toBe('string');
    });
});

describe('projectFullState', () => {
    beforeEach(() => { mockStore = null; });

    it('null store returns empty string, no crash', () => {
        const result = projectFullState();
        expect(typeof result).toBe('string');
    });

    it('produces six-group output', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 1000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: { weapon: 'e1', off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [{ skill_id: 's1', name: '水平方阵斩', proficiency: 3 }],
                customSkills: [],
            },
            equipmentStore: {
                byId: { e1: { name: '阐释者', stats: { atk: 40 } } },
            },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 5000 }, items: [] },
            runtime: {},
        };
        const result = projectFullState();
        expect(result).toContain('桐人');
        expect(result).toContain('等级');
        expect(result).toContain('阐释者');
        expect(result).toContain('水平方阵斩');
        expect(result).not.toContain('e1');
        expect(result).not.toContain('s1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanTimelinePromptText
// ─────────────────────────────────────────────────────────────────────────────
describe('cleanTimelinePromptText', () => {
    it('null/undefined/string passthrough', () => {
        expect(cleanTimelinePromptText(null)).toBeNull();
        expect(cleanTimelinePromptText(undefined)).toBeUndefined();
        expect(cleanTimelinePromptText('普通文本')).toBe('普通文本');
    });

    it('non-timeline text passthrough', () => {
        const text = '这是一段普通的描述文本，没有日期也没有时间线关键词。角色走在街上，阳光明媚。';
        expect(cleanTimelinePromptText(text)).toBe(text);
    });

    it('timeline book format (date headers + keyword) → replaced', () => {
        const text = [
            '# 世界历史背景',
            '',
            '#### **11月6日**',
            '艾恩葛朗特开放，第一批玩家进入。',
            '',
            '#### **11月7日**',
            '死亡游戏开始，茅场晶彦宣布规则。',
            '',
            '#### **11月8日**',
            '第一层攻略会议召开。',
        ].join('\n');
        const result = cleanTimelinePromptText(text);
        expect(result).toContain('get_calendar');
        expect(result).not.toContain('11月6日');
        expect(result).not.toContain('11月7日');
    });

    it('timeline list format (ISO dates + keyword) → replaced', () => {
        const text = [
            '原作时间线概要：',
            '2022-11-06: 艾恩葛朗特开放',
            '2022-11-07: 死亡游戏开始',
            '2022-11-08: 第一层攻略会议',
        ].join('\n');
        const result = cleanTimelinePromptText(text);
        expect(result).toContain('get_calendar');
        expect(result).not.toContain('2022-11-06');
        expect(result).not.toContain('2022-11-07');
    });

    it('keyword but insufficient date count → passthrough', () => {
        const text = [
            '#### **11月6日**',
            '时间线：艾恩葛朗特开放。',
        ].join('\n');
        expect(cleanTimelinePromptText(text)).toBe(text);
    });
});
