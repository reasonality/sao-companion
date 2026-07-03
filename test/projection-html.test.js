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

vi.mock('../sao-store-world.js', () => ({
    getWorldStore: vi.fn(() => mockStore?.worldStore || { currentWeather: null, areaStatus: null, worldEvents: [], rules: {} }),
    applyWorldUpdates: vi.fn(),
    projectWorldHint: vi.fn(() => ''),
}));

vi.mock('../sao-store-floor.js', () => ({
    getFloorStore: vi.fn(() => mockStore?.floorStore || { byId: {}, numberToId: {} }),
    initFloorFromWorldBook: vi.fn(() => 0),
    updateFloorState: vi.fn(),
}));

vi.mock('../sao-store-consumable.js', () => ({
    getConsumableById: vi.fn((id) => mockStore?.consumableStore?.byId?.[id] || null),
    getConsumableStore: vi.fn(() => mockStore?.consumableStore || { byId: {}, nameToId: {} }),
    findOrCreateConsumable: vi.fn(() => null),
    useConsumable: vi.fn(() => []),
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
        // NOTE: title (player.title 称号) 不再渲染到 HUD — 改为 cursor/badges 焦点；
        //       HUD 紧凑布局省下空间（ver 角色状态栏照图3）。
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

        // 投影输出是 inner content；外层 <details>/<summary> 由 sao-render.js 包裹（本测试仅测投影）
        // 因此这里不强求 <details>，但确认任务 section 存在（在 Row2 中与技能并列）
        expect(html).toContain('data-sao-section="quests"');
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
        // 玩家 + vitals 已合并为单 section '玩家状态'（照图3）
        expect(html).toContain('玩家状态');
        expect(html).toContain('装备');
        expect(html).toContain('技能');
        expect(html).toContain('任务');
        // 物品：原 '背包 / 货币' 简化为 '物品'
        expect(html).toContain('物品');
        // 世界状态 section（行 1 右列）
        expect(html).toContain('世界状态');
    });

    it('renders 2-row × 2-col grid (玩家状态|世界状态） row1 + tasks standalone + (物品|+技能) row2', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 50000 },
                attributes: { str: 50, agi: 60, int: 10, vit: 20 },
                vitals: { hp: 585, maxHp: 585, mp: 120, maxMp: 120 },
                position: { floor_id: 48, location: '黑铁宫' },
                equipment: { weapon: 'e1', off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [{ skill_id: 's1', name: '水平方阵斩', proficiency: 3 }],
                customSkills: [],
            },
            equipmentStore: {
                byId: { e1: { name: '阐释者', slot: 'weapon', stats: { atk: 40, str: 10 } } },
                nameToId: {},
            },
            skillStore: {
                byId: { s1: { name: '水平方阵斩', combat: { atk: 45, hit: 80 } } },
                nameToId: {},
            },
            inventoryStore: { owner_id: 'player', currency: { cor: 5000 }, items: [] },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();

        // 两个 grid row 容器（sao-status-row1 在 sao-status-row2 之前）
        const idxRow1 = html.indexOf('sao-status-row1');
        const idxRow2 = html.indexOf('sao-status-row2');
        expect(idxRow1).toBeGreaterThan(-1);
        expect(idxRow2).toBeGreaterThan(idxRow1);

        // 列容器
        expect(html).toContain('sao-status-col');

        // Row 1 切片（row1 ~ row2）应包含 info + world（玩家已合并入 info，对齐图3）
        const row1Slice = html.slice(idxRow1, idxRow2);
        expect(row1Slice).toContain('data-sao-section="info"');
        expect(row1Slice).toContain('data-sao-section="world"');

        // Row 2（row2 ~ row3）应包含 skills + quests
        const idxRow3 = html.indexOf('sao-status-row3');
        expect(idxRow3).toBeGreaterThan(idxRow2);
        const row2Slice = html.slice(idxRow2, idxRow3);
        expect(row2Slice).toContain('data-sao-section="skills"');
        expect(row2Slice).toContain('data-sao-section="quests"');

        // Row 3 应包含 inventory + equip
        const row3Slice = html.slice(idxRow3);
        expect(row3Slice).toContain('data-sao-section="inventory"');
        expect(row3Slice).toContain('data-sao-section="equip"');
    });

    it('renders world rows with location/weather/area/clearing/events (always 5 rows)', () => {
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 25, totalExp: 0 },
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
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            worldStore: {
                currentWeather: { condition: '晴朗' },
                areaStatus: { location: '黑铁宫', danger_level: 'high', description: '危险' },
                worldEvents: [{ event: '首通黑铁宫 BOSS' }],
                rules: {},
            },
            floorStore: {
                byId: {
                    48: { floor_id: '48', floor_number: 48, state: { cleared: false }, canon: { boss: '守护者' } },
                },
                numberToId: {},
            },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        // 5 行世界卡（位置/天气/区域/攻略/事件）
        const rowMatches = html.match(/sao-world-row/g) || [];
        expect(rowMatches.length).toBeGreaterThanOrEqual(5);

        // 数据值出现
        expect(html).toContain('黑铁宫');      // location
        expect(html).toContain('晴朗');        // weather
        expect(html).toContain('危险');        // description (area)
        expect(html).toContain('攻略中');      // 当前楼层未攻略
        expect(html).toContain('守护者');      // BOSS 名
        expect(html).toContain('首通黑铁宫 BOSS');  // 最近事件
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
        // section markers（玩家+vitals 已合并到 'info' 玩家状态；其余保留）
        expect(html).toContain('data-sao-section="info"');
        // vitals section 已并入 info（玩家状态），不再独立数据 section
        expect(html).not.toContain('data-sao-section="vitals"');
        expect(html).toContain('data-sao-section="equip"');
        expect(html).toContain('data-sao-section="skills"');
        expect(html).toContain('data-sao-section="quests"');
        expect(html).toContain('data-sao-section="inventory"');
        expect(html).toContain('data-sao-section="world"');

        // 双栏布局（与侧边面板 panel.html:48-104 同语言）
        expect(html).toContain('sao-status-row1');
        expect(html).toContain('sao-status-row2');
        expect(html).toContain('sao-status-row3');
        expect(html).toContain('sao-status-row ');
        expect(html).toContain('sao-status-col');
        // 世界行卡（5 行：位置/天气/区域/攻略/事件）
        expect(html).toContain('sao-world-row');
        expect(html).toContain('sao-world-label');
        expect(html).toContain('sao-world-value');

        // HUD structure（注意：equip 改为紧凑列表，skill 改为按钮网格）
        expect(html).toContain('sao-hud-card');
        expect(html).toContain('sao-hud-header');
        expect(html).toContain('sao-cursor-badge');
        expect(html).toContain('sao-bar-hp');
        expect(html).toContain('sao-bar-mp');
        expect(html).toContain('sao-stat-grid');
        expect(html).toContain('sao-stat-item');
        // 装备已从 3x3 grid 改为紧凑列表（sao-equip-list + sao-equip-row）
        expect(html).toContain('sao-equip-list');
        expect(html).toContain('sao-equip-row');
        // 技能已从 details 折叠改为按钮网格（sao-skill-btn / sao-skill-grid）
        expect(html).toContain('sao-skill-btn');
        expect(html).toContain('sao-skill-grid');
        expect(html).toContain('sao-quest-item');
        expect(html).toContain('sao-inv-tags');
        expect(html).toContain('sao-cor-row');

        // action buttons preserved
        expect(html).toContain('data-sao-action="unequip"');
        // equip-from-backpack now renders in inventory 物品 tab (↑ button for equipment items)
        expect(html).toContain('data-sao-action="equip"');
        expect(html).toContain('data-sao-action="use-consumable"');
        expect(html).toContain('data-sao-action="abandon-quest"');
        expect(html).toContain('data-sao-action="show-completed-quests"');
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
        // Should show combat HP (300/585), not store HP (585/585)
        expect(html).toContain('300/585');
        // compact HUD 不再单独渲染 '战斗中' meta，但 HP 数据本身已切换
        // sao-hud-lv 仍然渲染
        expect(html).toContain('sao-hud-lv');
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
        // Name 必须 HTML-escape（玩家名仍渲染到 HUD 头条）
        // title (称号) 不再渲染到 dialog HUD（紧凑布局省略）以省空间、照图3
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        // 注入的引号被 escape 为 &quot;
        expect(html).toContain('&quot;');
    });

    it('resolves consumable name via consumableStore.getConsumableById(item.consumable_id)', () => {
        // Bug 复现：旧代码只读 item.name || item.item_id，导致背包物品显示 inv_001 而非真实名字。
        // 修复后：consumable 类型 item 无 name，但有 consumable_id 时，从 consumableStore.byId 取真实 name。
        mockStore = {
            playerStore: {
                identity: { name: '桐人', title: null },
                progression: { level: 1, totalExp: 0 },
                attributes: { str: 10, agi: 10, int: 5, vit: 5 },
                vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
                position: { floor_id: 1, location: '' },
                equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
                skills: [],
                customSkills: [],
            },
            equipmentStore: { byId: {}, nameToId: {} },
            skillStore: { byId: {}, nameToId: {} },
            inventoryStore: {
                owner_id: 'player',
                currency: { cor: 0 },
                items: [
                    // 注意：item 没有 name 字段，只有 consumable_id = consumable_001
                    { item_id: 'test_item_001', type: 'consumable', consumable_id: 'consumable_001', qty: 20 },
                ],
            },
            consumableStore: {
                byId: {
                    consumable_001: { consumable_id: 'consumable_001', name: '初级治疗药水' },
                },
                nameToId: { '初级治疗药水': 'consumable_001' },
            },
            questStore: { byId: {}, activeIds: [], completedIds: [] },
            runtime: {},
        };

        const html = projectStatusPanelHtml();
        // 真实药品名应被渲染
        expect(html).toContain('初级治疗药水');
        // item.item_id 用于 use 按钮的 data-item-id（这是允许保留的内部链路），
        // 但定义库 id consumable_001 不应泄漏到用户可见文案
        expect(html).not.toContain('consumable_001');
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
