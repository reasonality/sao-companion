import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock all store modules that sao-state-projection.js imports
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
    esc: vi.fn((s) => {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }),
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn(),
}));

vi.mock('../sao-store-player.js', () => ({
    getPlayerStore: vi.fn(() => mockStore?.playerStore || null),
    CURSOR_LABELS: { green: '🟢 普通', orange: '🟠 敌对', red: '🔴 红名' },
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

vi.mock('../sao-store-quest.js', () => ({
    getQuestStore: vi.fn(() => mockStore?.questStore || { byId: {}, activeIds: [], completedIds: [] }),
}));

// Import AFTER mocks
import { projectStatusPanelHtml, projectQuestSummary } from '../sao-state-projection.js';

beforeEach(() => {
    mockStore = null;
});

// ═══════════════════════════════════════════════════════════════════════════════
// projectStatusPanelHtml
// ═══════════════════════════════════════════════════════════════════════════════

describe('projectStatusPanelHtml', () => {
    it('returns null when playerStore is null', () => {
        expect(projectStatusPanelHtml()).toBeNull();
    });

    it('returns null when player has no meaningful data', () => {
        mockStore = {
            playerStore: {
                identity: { name: null, title: null },
                progression: { level: null, totalExp: null },
                attributes: { str: 0, agi: 0, int: 0, vit: 0 },
                vitals: null,
                position: { floor_id: null, location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };
        expect(projectStatusPanelHtml()).toBeNull();
    });

    it('generates HTML with all sections when stores are fully populated', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: '黑衣剑士' },
                progression: { level: 25, totalExp: 50000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: {
                    weapon: 'e1',
                    off_hand: null,
                    head: null,
                    chest: 'e2',
                    hands: null,
                    legs: null,
                    accessory: null,
                },
                skills: [
                    { skill_id: 's1', name: '水平方阵斩', proficiency: 3 },
                    { skill_id: 's2', name: '治疗', proficiency: 1 },
                ],
                customSkills: [],
            },
            equipmentStore: {
                byId: {
                    e1: { name: '阐释者', stats: { atk: 40, str: 10, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                    e2: { name: '黑衣', stats: { atk: 0, str: 0, agi: 5, int: 0, vit: 10, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                },
                nameToId: {},
            },
            skillStore: {
                byId: {
                    s1: { name: '水平方阵斩', combat: { atk: 45, hit: 80, crit: 10, mpCost: 15, cd: 2 } },
                    s2: { name: '治疗', combat: { atk: 0, hit: 0, crit: 0, mpCost: 20, cd: 0 } },
                },
                nameToId: {},
            },
            inventoryStore: {
                owner_id: 'player',
                currency: { cor: 5000 },
                items: [
                    { item_id: 'i1', type: 'consumable', name: '回复药水', qty: 3 },
                ],
            },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        expect(html).toBeTruthy();
        expect(typeof html).toBe('string');

        // Contains player name (HTML escaped)
        expect(html).toContain('桐人');
        // Contains title
        expect(html).toContain('黑衣剑士');
        // Contains equipment names
        expect(html).toContain('阐释者');
        expect(html).toContain('黑衣');
        // Contains skill names
        expect(html).toContain('水平方阵斩');
        // Contains currency
        expect(html).toContain('5000');
        // Contains inventory items
        expect(html).toContain('回复药水');

        // Should NOT contain internal IDs
        expect(html).not.toContain('e1');
        expect(html).not.toContain('e2');
        expect(html).not.toContain('s1');
        expect(html).not.toContain('s2');

        // Should use <details>/<summary> structure
        expect(html).toContain('<details');
        expect(html).toContain('<summary>');
    });

    it('contains all six section labels', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 1, totalExp: 0 },
                attributes: { str: 0, agi: 0, int: 0, vit: 0 },
                vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
                position: { floor_id: 'floor_001', location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [{ skill_id: 's1', name: '测试技能', proficiency: 1 }],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: { s1: { name: '测试技能', combat: {} } }, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        expect(html).toContain('基本信息');
        expect(html).toContain('等级与属性');
        expect(html).toContain('装备');
        expect(html).toContain('技能');
        expect(html).toContain('任务');
        expect(html).toContain('背包');
    });

    it('uses structured HUD classes and data-sao-section attributes', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: '黑衣剑士' },
                progression: { level: 25, totalExp: 50000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: {
                    weapon: 'e1',
                    off_hand: null,
                    head: null,
                    chest: 'e2',
                    hands: null,
                    legs: null,
                    accessory: null,
                },
                skills: [
                    { skill_id: 's1', name: '水平方阵斩', proficiency: 3 },
                ],
                customSkills: [],
            },
            equipmentStore: {
                byId: {
                    e1: { name: '阐释者', stats: { atk: 40, str: 10, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                    e2: { name: '黑衣', stats: { atk: 0, str: 0, agi: 5, int: 0, vit: 10, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                },
                nameToId: {},
            },
            skillStore: {
                byId: {
                    s1: { name: '水平方阵斩', combat: { atk: 45, hit: 80, crit: 10, mpCost: 15, cd: 2 } },
                },
                nameToId: {},
            },
            inventoryStore: {
                owner_id: 'player',
                currency: { cor: 5000 },
                items: [
                    { item_id: 'i1', type: 'consumable', name: '回复药水', qty: 3 },
                    { item_id: 'e3', type: 'equipment', equipment_id: 'e3', name: '试做短剑' },
                ],
            },
            equipmentStore: {
                byId: {
                    e1: { name: '阐释者', stats: { atk: 40, str: 10, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                    e2: { name: '黑衣', stats: { atk: 0, str: 0, agi: 5, int: 0, vit: 10, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                    e3: { name: '试做短剑', slot: 'weapon', stats: { atk: 25, str: 5, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0, hit: 0, crit: 0 } },
                },
                nameToId: {},
            },
            questStore: {
                byId: {
                    q1: { quest_id: 'q1', title: '黑铁宫试炼', summary: '探索深处', status: 'active', objectives: [] },
                },
                activeIds: ['q1'],
                completedIds: [],
            },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        // section markers
        expect(html).toContain('data-sao-section="info"');
        expect(html).toContain('data-sao-section="vitals"');
        expect(html).toContain('data-sao-section="equip"');
        expect(html).toContain('data-sao-section="skills"');
        expect(html).toContain('data-sao-section="quests"');
        expect(html).toContain('data-sao-section="inventory"');

        // HUD structure
        expect(html).toContain('sao-hud-card');
        expect(html).toContain('sao-hud-header');
        expect(html).toContain('sao-cursor-badge');
        expect(html).toContain('sao-bar-hp');
        expect(html).toContain('sao-bar-mp');
        expect(html).toContain('sao-stat-grid');
        expect(html).toContain('sao-stat-item');
        expect(html).toContain('sao-equip-grid');
        expect(html).toContain('sao-equip-slot');
        expect(html).toContain('sao-skill-details');
        expect(html).toContain('sao-quest-card');
        expect(html).toContain('sao-inv-tags');
        expect(html).toContain('sao-cor-row');

        // action buttons preserved
        expect(html).toContain('data-sao-action="unequip"');
        expect(html).toContain('data-sao-action="equip"');
        expect(html).toContain('data-sao-action="use-consumable"');
        expect(html).toContain('data-sao-action="complete-quest"');
        expect(html).toContain('data-sao-action="add-quest"');
    });

    it('uses combat HP during active combat (soft-guard)', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 1000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 1, location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {
                _zd_parsed: {
                    player: { hp: 300, maxHp: 585, mp: 50, maxMp: 120 },
                    enemies: [{ name: 'BOSS', hp: 500, max_hp: 1000 }],
                },
            },
        };

        const html = projectStatusPanelHtml();
        // Should show combat HP (300), not store HP (585)
        expect(html).toContain('300');
        expect(html).toContain('战斗中');
    });

    it('shows "无" for empty equipment slots', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 1, totalExp: 0 },
                attributes: { str: 0, agi: 0, int: 0, vit: 0 },
                vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
                position: { floor_id: 1, location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        expect(html).toContain('sao-equip-empty');
        expect(html).toContain('>主手<');
        expect(html).toContain('>副手<');
        expect(html).toContain('>无<');
    });

    it('HTML-escapes special characters in names', () => {
        mockStore = {
            playerStore: {
                identity: { name: '<script>alert("xss")</script>', title: '称号&测试' },
                progression: { level: 1, totalExp: 0 },
                attributes: { str: 0, agi: 0, int: 0, vit: 0 },
                vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
                position: { floor_id: 1, location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: { owner_id: 'player', currency: { cor: 0 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        // Should be escaped, not raw
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&amp;');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// projectQuestSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe('projectQuestSummary', () => {
    it('returns empty string when no active quests', () => {
        mockStore = {
            questStore: { byId: {}, activeIds: [], completedIds: [] },
        };
        expect(projectQuestSummary()).toBe('');
    });

    it('returns empty string when questStore has no activeIds', () => {
        mockStore = {
            questStore: {
                byId: { q1: { quest_id: 'q1', title: '测试', status: 'completed' } },
                activeIds: [],
                completedIds: ['q1'],
            },
        };
        expect(projectQuestSummary()).toBe('');
    });

    it('returns HTML with quest title when active quests exist', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: { quest_id: 'q1', title: '黑铁宫的试炼', summary: '探索深处', status: 'active', objectives: [] },
                },
                activeIds: ['q1'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        expect(result).toContain('黑铁宫的试炼');
        expect(result).toContain('探索深处');
        expect(result).toContain('<b>');
    });

    it('renders objectives with check marks', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: {
                        quest_id: 'q1',
                        title: '多目标任务',
                        status: 'active',
                        objectives: [
                            { text: '找到入口', done: true },
                            { text: '击败守卫', done: false },
                        ],
                    },
                },
                activeIds: ['q1'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        expect(result).toContain('☑');
        expect(result).toContain('☐');
        expect(result).toContain('找到入口');
        expect(result).toContain('击败守卫');
    });

    it('renders multiple quests separated by double <br>', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: { quest_id: 'q1', title: '任务A', status: 'active', objectives: [] },
                    q2: { quest_id: 'q2', title: '任务B', status: 'active', objectives: [] },
                },
                activeIds: ['q1', 'q2'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        expect(result).toContain('任务A');
        expect(result).toContain('任务B');
        expect(result).toContain('<br><br>');
    });

    it('HTML-escapes quest title and objective text', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: {
                        quest_id: 'q1',
                        title: '<b>危险任务</b>',
                        status: 'active',
                        objectives: [
                            { text: '使用<script>标签', done: false },
                        ],
                    },
                },
                activeIds: ['q1'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        // Should be escaped
        expect(result).not.toContain('<b>危险任务</b>');
        expect(result).toContain('&lt;b&gt;');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;script&gt;');
    });

    it('handles objectives with description field instead of text', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: {
                        quest_id: 'q1',
                        title: '测试任务',
                        status: 'active',
                        objectives: [
                            { description: '使用description字段', done: false },
                        ],
                    },
                },
                activeIds: ['q1'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        expect(result).toContain('使用description字段');
    });

    it('filters out nonexistent quest IDs from activeIds', () => {
        mockStore = {
            questStore: {
                byId: {
                    q1: { quest_id: 'q1', title: '存在的任务', status: 'active', objectives: [] },
                },
                activeIds: ['q1', 'q_nonexistent'],
                completedIds: [],
            },
        };
        const result = projectQuestSummary();
        expect(result).toContain('存在的任务');
        // Should not crash
        expect(result).toBeTruthy();
    });

    it('returns empty string when all active quests are nonexistent in byId', () => {
        mockStore = {
            questStore: {
                byId: {},
                activeIds: ['q_ghost'],
                completedIds: [],
            },
        };
        expect(projectQuestSummary()).toBe('');
    });
});
