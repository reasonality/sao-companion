import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock sao-core.js and sao-store-core.js with shared mockStore
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn().mockResolvedValue(undefined),
    appendActionLog: vi.fn((entry) => {
        if (!mockStore) return;
        if (!mockStore.actionLog) mockStore.actionLog = { entries: [], lastInjectedTurn: 0, currentTurn: 0 };
        const enriched = { ...entry, turn: mockStore.actionLog.currentTurn || 0, timestamp: Date.now() };
        mockStore.actionLog.entries.push(enriched);
        while (mockStore.actionLog.entries.length > 20) mockStore.actionLog.entries.shift();
    }),
    projectActionLogHint: vi.fn(() => {
        if (!mockStore || !mockStore.actionLog || !Array.isArray(mockStore.actionLog.entries)) return '';
        const minTurn = mockStore.actionLog.lastInjectedTurn || 0;
        const recent = mockStore.actionLog.entries.filter(e => e.turn > minTurn);
        if (recent.length === 0) return '';
        return recent.map(e => {
            const detail = e.resultDetail ? ` (${e.resultDetail})` : '';
            return `${e.action}: ${e.itemName || ''}${detail}`;
        }).join('\n');
    }),
}));

// Import AFTER mocks — real store modules will call the mocked getStore
import {
    findOrCreateSkill,
    getSkillById,
    getSkillByName,
    generateSkillId,
    validateSkillEntry,
} from '../sao-store-skill.js';
import {
    findOrCreateEquipment,
    getEquipmentById,
    generateEquipmentId,
    findBestMatch,
    validateEquipmentEntry,
    removeEquipmentById,
} from '../sao-store-equipment.js';
import {
    getPlayerStore,
    updatePlayerVitals,
    addPlayerSkill,
    updatePlayerAttributes,
    recalcStatsFromEquipment,
    unequipItem,
} from '../sao-store-player.js';
import {
    getInventoryStore,
    addConsumable,
    addConsumableItem,
    addMaterial,
    addEquipmentItem,
    removeEquipmentItem,
    updateCurrency,
    getCurrency,
} from '../sao-store-inventory.js';
import { equipItem } from '../sao-store-player.js';
import { projectCompactState } from '../sao-state-projection.js';
import {
    getConsumableStore,
    getConsumableById,
    findOrCreateConsumable,
    validateConsumableEntry,
    useConsumable,
} from '../sao-store-consumable.js';
import { appendActionLog, projectActionLogHint } from '../sao-store-core.js';
import {
    createQuest,
    updateQuest,
    completeQuest,
    getActiveQuests,
    getCompletedQuests,
    getQuestById,
} from '../sao-store-quest.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fresh store skeleton
// ─────────────────────────────────────────────────────────────────────────────
function makeEmptyStore() {
    return {
        schemaVersion: 1,
        skillStore: { byId: {}, nameToId: {} },
        equipmentStore: { byId: {}, nameToId: {} },
        playerStore: null,
        inventoryStore: null,
        npcStore: { byId: {}, nameToId: {} },
        floorStore: { byId: {}, numberToId: {} },
        calendarStore: { currentDate: null, events: {}, appointments: [] },
        questStore: { byId: {}, activeIds: [], completedIds: [] },
        consumableStore: { byId: {}, nameToId: {} },
        actionLog: { entries: [], lastInjectedTurn: 0, currentTurn: 0 },
        runtime: {},
        panels: {},
        calendarPanels: {},
    };
}

beforeEach(() => {
    mockStore = makeEmptyStore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Skill Store', () => {
    it('findOrCreateSkill creates new skill and returns ID', () => {
        const id = findOrCreateSkill({
            name: '水平方阵斩',
            rarity: 'rare',
            combat: { atk: 45, hit: 80, crit: 10, apt: 1, tpa: 1, mpCost: 15, cd: 2 },
        });
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');

        const skill = getSkillById(id);
        expect(skill).toBeTruthy();
        expect(skill.name).toBe('水平方阵斩');
        expect(skill.rarity).toBe('rare');
        expect(skill.combat.atk).toBe(45);
    });

    it('findOrCreateSkill is idempotent — same name returns same ID and merges combat', () => {
        const id1 = findOrCreateSkill({ name: '治疗', combat: { atk: 10 } });
        const id2 = findOrCreateSkill({ name: '治疗', combat: { atk: 20, hit: 50 } });
        expect(id1).toBe(id2);

        const skill = getSkillById(id1);
        expect(skill.combat.atk).toBe(20);  // updated
        expect(skill.combat.hit).toBe(50);   // merged
    });

    it('getSkillByName returns the same object as getSkillById', () => {
        const id = findOrCreateSkill({ name: '旋风斩', combat: { atk: 30 } });
        const byName = getSkillByName('旋风斩');
        const byId = getSkillById(id);
        expect(byName).toBe(byId);
    });

    it('getSkillById returns null for nonexistent ID', () => {
        expect(getSkillById('skill_nonexistent')).toBeNull();
    });

    it('getSkillByName returns null for nonexistent name', () => {
        expect(getSkillByName('不存在的技能')).toBeNull();
    });

    it('generateSkillId produces slug for ASCII names', () => {
        const id = generateSkillId('Horizontal Square');
        expect(id).toMatch(/^skill_horizontal_square$/);
    });

    it('generateSkillId produces skill_h + hash for non-ASCII names', () => {
        const id = generateSkillId('水平方阵斩');
        expect(id).toMatch(/^skill_hh[a-z0-9]+$/);
    });

    it('generateSkillId is idempotent for existing slugs', () => {
        findOrCreateSkill({ name: 'Test Skill' });
        const id1 = generateSkillId('Test Skill');
        const id2 = generateSkillId('Test Skill');
        expect(id1).toBe(id2);
    });

    it('findOrCreateSkill returns null for missing name', () => {
        const id = findOrCreateSkill({ combat: { atk: 10 } });
        expect(id).toBeNull();
    });

    it('validateSkillEntry rejects empty name', () => {
        const result = validateSkillEntry({ skill_id: 'x', name: '', rarity: 'common' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('validateSkillEntry rejects missing skill_id', () => {
        const result = validateSkillEntry({ name: 'test' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('skill_id'))).toBe(true);
    });

    it('validateSkillEntry accepts valid data', () => {
        const result = validateSkillEntry({
            skill_id: 'skill_test',
            name: '测试',
            rarity: 'common',
            combat: { atk: 10, hit: 50 },
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('validateSkillEntry rejects invalid rarity', () => {
        const result = validateSkillEntry({
            skill_id: 'x',
            name: 'test',
            rarity: 'legendary',  // not in skill rarity enum
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('rarity'))).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Equipment Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Equipment Store', () => {
    it('findOrCreateEquipment creates new equipment and returns ID', () => {
        const id = findOrCreateEquipment({
            name: '阐释者',
            slot: 'weapon',
            statType: 'str',
            rarity: 'rare',
            item_level: 30,
            stats: { atk: 40, str: 10 },
        });
        expect(id).toMatch(/^equip_\d{3}$/);

        const equip = getEquipmentById(id);
        expect(equip).toBeTruthy();
        expect(equip.name).toBe('阐释者');
        expect(equip.slot).toBe('weapon');
        expect(equip.stats.atk).toBe(40);
    });

    it('findOrCreateEquipment returns same ID for same name (single instance)', () => {
        const id1 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', stats: { atk: 20 } });
        const id2 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', stats: { atk: 20 } });
        expect(id1).toBe(id2);
    });

    it('findOrCreateEquipment returns same ID for same name when only one instance exists (single-instance shortcut)', () => {
        const id1 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', item_level: 5, stats: { atk: 20 } });
        // Second call with different stats but same name — returns existing ID
        // because nameToId has only 1 entry, so no findBestMatch is needed
        const id2 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', item_level: 10, stats: { atk: 35 } });
        expect(id1).toBe(id2);
    });

    it('findOrCreateEquipment uses findBestMatch for multi-instance with closest stats', () => {
        // Create two instances with different stats
        const id1 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', item_level: 5, stats: { atk: 20 } });
        const id2 = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', item_level: 10, stats: { atk: 35 } });

        // Query with stats close to id2
        const matched = findOrCreateEquipment({ name: '铁剑', slot: 'weapon', item_level: 10, stats: { atk: 34 } });
        expect(matched).toBe(id2);
    });

    it('generateEquipmentId produces sequential IDs', () => {
        const id1 = generateEquipmentId();
        expect(id1).toBe('equip_001');

        // Create one to advance counter
        findOrCreateEquipment({ name: '测试剑', stats: { atk: 1 } });
        const id2 = generateEquipmentId();
        expect(id2).toBe('equip_002');
    });

    it('getEquipmentById returns null for nonexistent ID', () => {
        expect(getEquipmentById('equip_999')).toBeNull();
    });

    it('findOrCreateEquipment returns null for missing name', () => {
        const id = findOrCreateEquipment({ slot: 'weapon', stats: { atk: 10 } });
        expect(id).toBeNull();
    });

    it('findBestMatch selects closest by item_level + stats', () => {
        const id1 = findOrCreateEquipment({ name: '测试A', item_level: 5, stats: { atk: 10 } });
        const id2 = findOrCreateEquipment({ name: '测试B', item_level: 15, stats: { atk: 50 } });

        // Target closer to id2
        const best = findBestMatch(
            { name: 'x', item_level: 14, stats: { atk: 48 } },
            [id1, id2]
        );
        expect(best).toBe(id2);
    });

    it('validateEquipmentEntry rejects invalid slot', () => {
        const result = validateEquipmentEntry({
            equipment_id: 'e1',
            name: 'x',
            slot: 'invalid_slot',
            statType: 'str',
            rarity: 'common',
            item_level: 1,
            stats: {},
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('slot'))).toBe(true);
    });

    it('validateEquipmentEntry rejects invalid statType', () => {
        const result = validateEquipmentEntry({
            equipment_id: 'e1',
            name: 'x',
            slot: 'weapon',
            statType: 'luck',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('statType'))).toBe(true);
    });

    it('validateEquipmentEntry accepts valid data', () => {
        const result = validateEquipmentEntry({
            equipment_id: 'equip_001',
            name: '阐释者',
            slot: 'weapon',
            statType: 'str',
            rarity: 'rare',
            item_level: 30,
            stats: { atk: 40 },
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Player Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Player Store', () => {
    it('getPlayerStore lazy-initializes with defaults when null', () => {
        expect(mockStore.playerStore).toBeNull();
        const player = getPlayerStore();
        expect(player).toBeTruthy();
        expect(player.identity.name).toBe('桐人');
        expect(player.vitals.hp).toBe(100);
        expect(player.vitals.maxHp).toBe(100);
        expect(player.equipment.weapon).toBeNull();
        expect(player.skills).toEqual([]);
    });

    it('getPlayerStore returns same reference on subsequent calls', () => {
        const p1 = getPlayerStore();
        const p2 = getPlayerStore();
        expect(p1).toBe(p2);
    });

    it('updatePlayerVitals merges partial vitals without clobbering others', async () => {
        await updatePlayerVitals({ hp: 50 });
        const player = getPlayerStore();
        expect(player.vitals.hp).toBe(50);
        expect(player.vitals.maxHp).toBe(100); // unchanged default
        expect(player.vitals.mp).toBe(20);      // unchanged default
    });

    it('updatePlayerVitals updates maxHp when provided', async () => {
        await updatePlayerVitals({ maxHp: 200, maxMp: 50 });
        const player = getPlayerStore();
        expect(player.vitals.maxHp).toBe(200);
        expect(player.vitals.maxMp).toBe(50);
    });

    it('updatePlayerAttributes merges partial attributes', async () => {
        await updatePlayerAttributes({ str: 50, agi: 60 });
        const player = getPlayerStore();
        expect(player.attributes.str).toBe(50);
        expect(player.attributes.agi).toBe(60);
        expect(player.attributes.int).toBe(0); // unchanged
    });

    it('addPlayerSkill adds skill reference', async () => {
        mockStore.skillStore.byId['skill_1'] = { skill_id: 'skill_1', name: '水平方阵斩' };
        mockStore.skillStore.nameToId['水平方阵斩'] = 'skill_1';
        await addPlayerSkill('skill_1', '水平方阵斩', 3);
        const player = getPlayerStore();
        expect(player.skills).toHaveLength(1);
        expect(player.skills[0].skill_id).toBe('skill_1');
        expect(player.skills[0].name).toBe('水平方阵斩');
        expect(player.skills[0].proficiency).toBe(3);
    });

    it('addPlayerSkill defaults proficiency to 1', async () => {
        mockStore.skillStore.byId['skill_2'] = { skill_id: 'skill_2', name: '治疗' };
        mockStore.skillStore.nameToId['治疗'] = 'skill_2';
        await addPlayerSkill('skill_2', '治疗');
        const player = getPlayerStore();
        expect(player.skills[0].proficiency).toBe(1);
    });

    it('addPlayerSkill upsert: duplicate updates proficiency', async () => {
        mockStore.skillStore.byId['skill_1'] = { skill_id: 'skill_1', name: '水平方阵斩' };
        mockStore.skillStore.nameToId['水平方阵斩'] = 'skill_1';
        await addPlayerSkill('skill_1', '水平方阵斩', 3);
        await addPlayerSkill('skill_1', '水平方阵斩', 5); // upsert
        const player = getPlayerStore();
        expect(player.skills).toHaveLength(1);
        expect(player.skills[0].proficiency).toBe(5); // updated
    });

    it('addPlayerSkill upsert: same proficiency is no-op', async () => {
        mockStore.skillStore.byId['skill_2'] = { skill_id: 'skill_2', name: '治疗' };
        mockStore.skillStore.nameToId['治疗'] = 'skill_2';
        await addPlayerSkill('skill_2', '治疗', 3);
        await addPlayerSkill('skill_2', '治疗', 3); // same — no-op
        const player = getPlayerStore();
        expect(player.skills).toHaveLength(1);
        expect(player.skills[0].proficiency).toBe(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inventory Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Inventory Store', () => {
    it('getInventoryStore lazy-initializes with defaults', () => {
        expect(mockStore.inventoryStore).toBeNull();
        const inv = getInventoryStore();
        expect(inv).toBeTruthy();
        expect(inv.owner_id).toBe('player');
        expect(inv.currency.cor).toBe(0);
        expect(inv.items).toEqual([]);
    });

    it('addConsumable adds new item with correct fields (deprecated wrapper)', async () => {
        const itemId = await addConsumable('回复药水', 3, '恢复HP');
        expect(itemId).toBeTruthy();

        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        // 新结构：item 用 consumable_id 引用定义库
        expect(inv.items[0].consumable_id).toBeTruthy();
        expect(inv.items[0].qty).toBe(3);
        expect(inv.items[0].type).toBe('consumable');

        // 验证定义库中有对应条目
        const def = getConsumableById(inv.items[0].consumable_id);
        expect(def).toBeTruthy();
        expect(def.name).toBe('回复药水');
        expect(def.description).toBe('恢复HP');
    });

    it('addConsumable merges by consumable_id — increments qty', async () => {
        await addConsumable('回复药水', 3);
        await addConsumable('回复药水', 2);
        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].qty).toBe(5);
    });

    it('addConsumable without description creates definition with empty description', async () => {
        await addConsumable('解毒草', 1);
        const inv = getInventoryStore();
        const def = getConsumableById(inv.items[0].consumable_id);
        expect(def.description).toBe('');
    });

    it('addMaterial adds new material item', async () => {
        const itemId = await addMaterial('铁矿石', 10);
        expect(itemId).toBeTruthy();

        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].name).toBe('铁矿石');
        expect(inv.items[0].qty).toBe(10);
        expect(inv.items[0].type).toBe('material');
    });

    it('addMaterial merges by name — increments qty', async () => {
        await addMaterial('铁矿石', 5);
        await addMaterial('铁矿石', 3);
        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].qty).toBe(8);
    });

    it('addEquipmentItem adds equipment to inventory', async () => {
        const itemId = await addEquipmentItem('equip_001');
        expect(itemId).toBeTruthy();

        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].type).toBe('equipment');
        expect(inv.items[0].equipment_id).toBe('equip_001');
        expect(inv.items[0].qty).toBe(1);
    });

    it('updateCurrency sets cor value', async () => {
        await updateCurrency(5000);
        expect(getCurrency()).toBe(5000);
    });

    it('getCurrency returns 0 by default', () => {
        expect(getCurrency()).toBe(0);
    });

    it('updateCurrency overwrites previous value', async () => {
        await updateCurrency(5000);
        await updateCurrency(3000);
        expect(getCurrency()).toBe(3000);
    });

    it('generateItemId produces sequential IDs', async () => {
        const id1 = await addConsumable('药水A', 1);
        const id2 = await addConsumable('药水B', 1);
        expect(id1).toBe('inv_001');
        expect(id2).toBe('inv_002');
    });

    it('different item types coexist in items array', async () => {
        await addConsumable('回复药水', 3);
        await addMaterial('铁矿石', 5);
        await addEquipmentItem('equip_001');

        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(3);
        expect(inv.items.map(i => i.type).sort()).toEqual(['consumable', 'equipment', 'material']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Quest Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Quest Store', () => {
    it('createQuest creates quest and adds to activeIds', () => {
        const id = createQuest({
            title: '黑铁宫的试炼',
            summary: '探索黑铁宫深处',
            status: 'active',
            kind: 'main',
            objectives: [{ text: '找到入口', done: false }],
            source: 'narrative',
        });
        expect(id).toBeTruthy();

        const quests = getActiveQuests();
        expect(quests).toHaveLength(1);
        expect(quests[0].title).toBe('黑铁宫的试炼');
        expect(quests[0].status).toBe('active');
    });

    it('createQuest returns null for missing title', () => {
        const id = createQuest({ summary: '无标题' });
        expect(id).toBeNull();
    });

    it('createQuest defaults status to active', () => {
        const id = createQuest({ title: '测试任务' });
        const quest = getQuestById(id);
        expect(quest.status).toBe('active');
        expect(getActiveQuests()).toHaveLength(1);
    });

    it('createQuest with non-active status does not add to activeIds', () => {
        const id = createQuest({ title: '已完成任务', status: 'completed' });
        expect(getActiveQuests()).toHaveLength(0);
    });

    it('completeQuest moves quest from activeIds to completedIds', async () => {
        const id = createQuest({
            title: '完成测试',
            status: 'active',
            objectives: [{ text: '目标1', done: false }],
        });
        expect(getActiveQuests()).toHaveLength(1);

        const result = await completeQuest(id);
        expect(result).toBe(true);

        expect(getActiveQuests()).toHaveLength(0);
        expect(getCompletedQuests()).toHaveLength(1);
        expect(getCompletedQuests()[0].title).toBe('完成测试');
        expect(getCompletedQuests()[0].status).toBe('completed');
    });

    it('completeQuest marks all objectives as done', async () => {
        const id = createQuest({
            title: '多目标任务',
            status: 'active',
            objectives: [
                { text: '目标A', done: false },
                { text: '目标B', done: false },
            ],
        });
        await completeQuest(id);
        const quest = getQuestById(id);
        expect(quest.objectives.every(o => o.done)).toBe(true);
    });

    it('completeQuest returns false for nonexistent quest', async () => {
        const result = await completeQuest('quest_999');
        expect(result).toBe(false);
    });

    it('updateQuest merges fields correctly', async () => {
        const id = createQuest({ title: '可更新任务', status: 'active' });
        const result = await updateQuest(id, { summary: '更新后的摘要', kind: 'side' });
        expect(result).toBe(true);

        const quest = getQuestById(id);
        expect(quest.summary).toBe('更新后的摘要');
        expect(quest.kind).toBe('side');
    });

    it('updateQuest auto-completes when all objectives done', async () => {
        const id = createQuest({
            title: '自动完成测试',
            status: 'active',
            objectives: [
                { objective_id: 'o1', text: '目标1', done: false },
            ],
        });

        await updateQuest(id, {
            objectives: [{ objective_id: 'o1', done: true }],
        });

        expect(getActiveQuests()).toHaveLength(0);
        expect(getCompletedQuests()).toHaveLength(1);
        expect(getQuestById(id).status).toBe('completed');
    });

    it('updateQuest returns false for nonexistent quest', async () => {
        const result = await updateQuest('quest_999', { title: 'x' });
        expect(result).toBe(false);
    });

    it('getActiveQuests returns empty array when no active quests', () => {
        expect(getActiveQuests()).toEqual([]);
    });

    it('getCompletedQuests returns empty array when no completed quests', () => {
        expect(getCompletedQuests()).toEqual([]);
    });

    it('getQuestById returns null for nonexistent ID', () => {
        expect(getQuestById('quest_999')).toBeNull();
    });

    it('multiple quests coexist correctly', () => {
        createQuest({ title: '任务A', status: 'active' });
        createQuest({ title: '任务B', status: 'active' });
        createQuest({ title: '任务C', status: 'active' });

        expect(getActiveQuests()).toHaveLength(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Equipment / Inventory Behavioral Invariants
// ═══════════════════════════════════════════════════════════════════════════════

describe('Equipment Behavioral Invariants', () => {
    it('equipItem invariant: equipping B in same slot moves A to inventory, no duplicate equipment_id', async () => {
        const idA = findOrCreateEquipment({ name: '阐释者', slot: 'weapon', stats: { atk: 40 } });
        const idB = findOrCreateEquipment({ name: '逐暗者', slot: 'weapon', stats: { atk: 35 } });
        await addEquipmentItem(idA);
        await addEquipmentItem(idB);

        // Equip A: A in slot, A removed from inventory
        await equipItem('weapon', idA);
        const player = getPlayerStore();
        const inv = getInventoryStore();
        expect(player.equipment.weapon).toBe(idA);
        expect(inv.items.find(i => i.equipment_id === idA)).toBeUndefined();
        expect(inv.items.find(i => i.equipment_id === idB)).toBeTruthy();

        // Equip B: B in slot, A moved to inventory, B removed from inventory
        await equipItem('weapon', idB);
        expect(player.equipment.weapon).toBe(idB);
        expect(inv.items.find(i => i.equipment_id === idB)).toBeUndefined();
        expect(inv.items.find(i => i.equipment_id === idA)).toBeTruthy();

        // No duplicate: slot's equipment_id must NOT appear in inventory
        const slotEquipId = player.equipment.weapon;
        const inInventory = inv.items.filter(i => i.equipment_id === slotEquipId);
        expect(inInventory).toHaveLength(0);
    });

    it('findOrCreateEquipment idempotency: same {name, slot, stats} returns same ID, single store entry', () => {
        const id1 = findOrCreateEquipment({ name: '月光剑', slot: 'weapon', stats: { atk: 25 } });
        const id2 = findOrCreateEquipment({ name: '月光剑', slot: 'weapon', stats: { atk: 25 } });
        expect(id1).toBe(id2);

        // equipmentStore.nameToId for this name should have exactly one entry
        const ids = mockStore.equipmentStore.nameToId['月光剑'];
        expect(Array.isArray(ids)).toBe(true);
        expect(ids).toHaveLength(1);
        expect(ids[0]).toBe(id1);

        // equipmentStore.byId should have exactly one entry for that ID
        expect(mockStore.equipmentStore.byId[id1]).toBeTruthy();
        expect(mockStore.equipmentStore.byId[id1].name).toBe('月光剑');
    });

    it('no-duplicate equipment_id: after equipItem, ID appears in slot but NOT in inventory', async () => {
        const idA = findOrCreateEquipment({ name: '暗夜之铠', slot: 'chest', stats: { vit: 20 } });
        await addEquipmentItem(idA);

        // Before equip: in inventory
        const inv = getInventoryStore();
        expect(inv.items.some(i => i.equipment_id === idA)).toBe(true);

        // Equip
        await equipItem('chest', idA);

        // After equip: in playerStore.equipment, NOT in inventory
        const player = getPlayerStore();
        expect(player.equipment.chest).toBe(idA);
        expect(inv.items.some(i => i.equipment_id === idA)).toBe(false);

        // equipment_id must appear exactly 0 times in inventory
        expect(inv.items.filter(i => i.equipment_id === idA)).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B4: removeEquipmentById
// ═══════════════════════════════════════════════════════════════════════════════

describe('removeEquipmentById', () => {
    it('removes equipment from byId and nameToId', async () => {
        const id = findOrCreateEquipment({ name: '测试销毁剑', slot: 'weapon', stats: { atk: 10 } });
        expect(mockStore.equipmentStore.byId[id]).toBeTruthy();
        expect(mockStore.equipmentStore.nameToId['测试销毁剑']).toContain(id);

        const result = await removeEquipmentById(id);
        expect(result).toBe(true);
        expect(mockStore.equipmentStore.byId[id]).toBeUndefined();
        expect(mockStore.equipmentStore.nameToId['测试销毁剑']).toBeUndefined();
    });

    it('returns false for non-existent equipment', async () => {
        const result = await removeEquipmentById('equip_999');
        expect(result).toBe(false);
    });

    it('refuses to destroy equipped item (cross-reference check)', async () => {
        const id = findOrCreateEquipment({ name: '已穿戴铠甲', slot: 'chest', stats: { vit: 20 } });
        await addEquipmentItem(id);
        await equipItem('chest', id);

        const result = await removeEquipmentById(id);
        expect(result).toBe(false);
        // Should still exist
        expect(mockStore.equipmentStore.byId[id]).toBeTruthy();
    });

    it('removes one instance from nameToId array without affecting others', async () => {
        // Manually create two equipment entries with the same name to simulate multi-instance
        const id1 = findOrCreateEquipment({ name: '同名剑', slot: 'weapon', item_level: 5, stats: { atk: 10 } });
        // Force a second entry into byId + nameToId (simulating a second instance)
        const id2 = 'equip_999';
        mockStore.equipmentStore.byId[id2] = { equipment_id: id2, name: '同名剑', slot: 'weapon', item_level: 10, stats: { atk: 20 } };
        mockStore.equipmentStore.nameToId['同名剑'].push(id2);
        expect(mockStore.equipmentStore.nameToId['同名剑']).toHaveLength(2);

        await removeEquipmentById(id1);
        expect(mockStore.equipmentStore.byId[id1]).toBeUndefined();
        expect(mockStore.equipmentStore.byId[id2]).toBeTruthy();
        expect(mockStore.equipmentStore.nameToId['同名剑']).toContain(id2);
        expect(mockStore.equipmentStore.nameToId['同名剑']).not.toContain(id1);
    });

    it('removeEquipmentItem removes item from inventory by equipmentId', async () => {
        const id = findOrCreateEquipment({ name: '背包测试剑', slot: 'weapon', stats: { atk: 5 } });
        await addEquipmentItem(id);
        const inv = getInventoryStore();
        expect(inv.items.some(i => i.equipment_id === id)).toBe(true);

        const removed = await removeEquipmentItem(id);
        expect(removed).toBe(true);
        expect(inv.items.some(i => i.equipment_id === id)).toBe(false);
    });

    it('removeEquipmentItem returns false for non-existent equipment in inventory', async () => {
        const removed = await removeEquipmentItem('equip_nonexist');
        expect(removed).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Projection Caps
// ═══════════════════════════════════════════════════════════════════════════════

describe('Projection Caps', () => {
    it('projectCompactState folds skills at cap (8) and inventory at cap (15)', async () => {
        // Create 10 skills in skillStore and add to player (exceeds cap of 8)
        const skillIds = [];
        for (let i = 1; i <= 10; i++) {
            const id = findOrCreateSkill({ name: `技能${i}`, combat: { atk: i * 5 } });
            skillIds.push(id);
        }
        for (let i = 0; i < skillIds.length; i++) {
            await addPlayerSkill(skillIds[i], `技能${i + 1}`, i % 5 + 1);
        }

        // Create 16 inventory items (exceeds cap of 15)
        for (let i = 1; i <= 16; i++) {
            await addConsumable(`物品${i}`, 1);
        }

        const output = projectCompactState();

        // Skills: cap 8, 10 total → "还有2个..."
        expect(output).toContain('还有2个...');

        // Inventory: cap 15, 16 total → "还有1个..."
        expect(output).toContain('还有1个...');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Consumable Store
// ═══════════════════════════════════════════════════════════════════════════════

describe('Consumable Store', () => {
    it('findOrCreateConsumable creates new consumable and returns ID', () => {
        const id = findOrCreateConsumable({
            name: '治疗药水',
            category: 'hp_restore',
            rarity: 'common',
            effects: [{ type: 'restore', stat: 'hp', value: 50, duration: 0 }],
            description: '恢复50点HP',
        });
        expect(id).toMatch(/^consumable_\d{3}$/);

        const def = getConsumableById(id);
        expect(def).toBeTruthy();
        expect(def.name).toBe('治疗药水');
        expect(def.category).toBe('hp_restore');
        expect(def.effects[0].value).toBe(50);
    });

    it('findOrCreateConsumable is idempotent — same name returns same ID', () => {
        const id1 = findOrCreateConsumable({ name: '治疗药水' });
        const id2 = findOrCreateConsumable({ name: '治疗药水' });
        expect(id1).toBe(id2);
    });

    it('findOrCreateConsumable returns null for missing name', () => {
        const id = findOrCreateConsumable({ category: 'hp_restore' });
        expect(id).toBeNull();
    });

    it('getConsumableById returns null for nonexistent ID', () => {
        expect(getConsumableById('consumable_999')).toBeNull();
    });

    it('getConsumableStore returns byId and nameToId', () => {
        findOrCreateConsumable({ name: '测试药水' });
        const store = getConsumableStore();
        expect(store.byId).toBeTruthy();
        expect(store.nameToId).toBeTruthy();
        expect(store.nameToId['测试药水']).toBeTruthy();
    });

    it('generateConsumableId produces sequential IDs', () => {
        const id1 = findOrCreateConsumable({ name: '药水A' });
        const id2 = findOrCreateConsumable({ name: '药水B' });
        expect(id1).toBe('consumable_001');
        expect(id2).toBe('consumable_002');
    });

    it('validateConsumableEntry accepts valid data', () => {
        const result = validateConsumableEntry({
            consumable_id: 'consumable_001',
            name: '治疗药水',
            category: 'hp_restore',
            rarity: 'common',
            effects: [{ type: 'restore', stat: 'hp', value: 50 }],
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('validateConsumableEntry rejects missing consumable_id', () => {
        const result = validateConsumableEntry({ name: 'test' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('consumable_id'))).toBe(true);
    });

    it('validateConsumableEntry rejects invalid category', () => {
        const result = validateConsumableEntry({
            consumable_id: 'c1',
            name: 'test',
            category: 'invalid',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('category'))).toBe(true);
    });

    it('validateConsumableEntry rejects invalid effect type', () => {
        const result = validateConsumableEntry({
            consumable_id: 'c1',
            name: 'test',
            effects: [{ type: 'invalid', stat: 'hp', value: 50 }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addConsumableItem (new main function)
// ═══════════════════════════════════════════════════════════════════════════════

describe('addConsumableItem', () => {
    it('adds consumable item with consumable_id', async () => {
        const cid = findOrCreateConsumable({ name: '治疗药水', maxStack: 99 });
        const itemId = await addConsumableItem(cid, 5);
        expect(itemId).toBeTruthy();

        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].type).toBe('consumable');
        expect(inv.items[0].consumable_id).toBe(cid);
        expect(inv.items[0].qty).toBe(5);
    });

    it('merges by consumable_id — increments qty', async () => {
        const cid = findOrCreateConsumable({ name: '治疗药水', maxStack: 99 });
        await addConsumableItem(cid, 3);
        await addConsumableItem(cid, 2);
        const inv = getInventoryStore();
        expect(inv.items).toHaveLength(1);
        expect(inv.items[0].qty).toBe(5);
    });

    it('respects maxStack', async () => {
        const cid = findOrCreateConsumable({ name: '小药水', maxStack: 10 });
        await addConsumableItem(cid, 8);
        await addConsumableItem(cid, 5); // would be 13, capped to 10
        const inv = getInventoryStore();
        expect(inv.items[0].qty).toBe(10);
    });

    it('returns null for qty < 1 when no existing item', async () => {
        const cid = findOrCreateConsumable({ name: '空药水' });
        const result = await addConsumableItem(cid, 0);
        expect(result).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// actionLog
// ═══════════════════════════════════════════════════════════════════════════════

describe('actionLog', () => {
    it('appendActionLog adds entry with turn and timestamp', () => {
        appendActionLog({ action: 'use_consumable', itemType: 'consumable', itemName: '治疗药水', result: 'success' });
        expect(mockStore.actionLog.entries).toHaveLength(1);
        expect(mockStore.actionLog.entries[0].action).toBe('use_consumable');
        expect(mockStore.actionLog.entries[0].turn).toBe(0);
        expect(mockStore.actionLog.entries[0].timestamp).toBeTruthy();
    });

    it('appendActionLog FIFO cap 20', () => {
        for (let i = 0; i < 25; i++) {
            appendActionLog({ action: 'test', itemType: 'test', itemName: `item${i}`, result: 'ok' });
        }
        expect(mockStore.actionLog.entries).toHaveLength(20);
        // 最早的条目被丢弃
        expect(mockStore.actionLog.entries[0].itemName).toBe('item5');
    });

    it('projectActionLogHint returns filtered entries', () => {
        mockStore.actionLog.currentTurn = 1;
        appendActionLog({ action: 'drop_item', itemType: 'equipment', itemName: '铁剑', result: 'success' });
        mockStore.actionLog.lastInjectedTurn = 0;

        const hint = projectActionLogHint();
        expect(hint).toContain('drop_item');
        expect(hint).toContain('铁剑');
    });

    it('projectActionLogHint returns empty when no new entries', () => {
        mockStore.actionLog.lastInjectedTurn = 999;
        appendActionLog({ action: 'test', itemType: 'test', itemName: 'x', result: 'ok' });
        // entry turn=0, lastInjectedTurn=999 → filtered out
        const hint = projectActionLogHint();
        expect(hint).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useConsumable
// ═══════════════════════════════════════════════════════════════════════════════

describe('useConsumable', () => {
    it('restores HP and decrements qty', async () => {
        // Setup: player with 50/100 HP
        const player = getPlayerStore();
        await updatePlayerVitals({ hp: 50, maxHp: 100, mp: 20, maxMp: 20 });

        // Create consumable definition
        const cid = findOrCreateConsumable({
            name: '治疗药水',
            effects: [{ type: 'restore', stat: 'hp', value: 30 }],
        });

        // Add to inventory
        const itemId = await addConsumableItem(cid, 3);

        // Use
        const results = await useConsumable(itemId);
        expect(results).toHaveLength(1);
        expect(results[0]).toContain('HP +30');
        expect(results[0]).toContain('50→80');

        // Verify state
        expect(player.vitals.hp).toBe(80);
        const inv = getInventoryStore();
        expect(inv.items[0].qty).toBe(2);
    });

    it('caps HP at maxHp', async () => {
        await updatePlayerVitals({ hp: 90, maxHp: 100 });
        const cid = findOrCreateConsumable({
            name: '大治疗药水',
            effects: [{ type: 'restore', stat: 'hp', value: 50 }],
        });
        const itemId = await addConsumableItem(cid, 1);
        const results = await useConsumable(itemId);
        expect(results[0]).toContain('90→100');
        expect(getPlayerStore().vitals.hp).toBe(100);
    });

    it('removes item when qty reaches 0', async () => {
        await updatePlayerVitals({ hp: 50, maxHp: 100 });
        const cid = findOrCreateConsumable({
            name: '唯一药水',
            effects: [{ type: 'restore', stat: 'hp', value: 10 }],
        });
        const itemId = await addConsumableItem(cid, 1);
        await useConsumable(itemId);
        const inv = getInventoryStore();
        expect(inv.items.find(i => i.item_id === itemId)).toBeUndefined();
    });

    it('returns informative message for nonexistent item (was empty array, now returns message)', async () => {
        const results = await useConsumable('inv_999');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]).toContain('inv_999');
    });

    it('appends actionLog on use', async () => {
        await updatePlayerVitals({ hp: 50, maxHp: 100 });
        const cid = findOrCreateConsumable({
            name: '日志药水',
            effects: [{ type: 'restore', stat: 'hp', value: 10 }],
        });
        const itemId = await addConsumableItem(cid, 1);
        const beforeLen = mockStore.actionLog.entries.length;
        await useConsumable(itemId);
        expect(mockStore.actionLog.entries.length).toBe(beforeLen + 1);
        expect(mockStore.actionLog.entries[mockStore.actionLog.entries.length - 1].action).toBe('use_consumable');
    });

    it('handles buff effects with duration', async () => {
        const player = getPlayerStore();
        player.attributes.str = 10;
        const cid = findOrCreateConsumable({
            name: '力量药水',
            effects: [{ type: 'buff', stat: 'str', value: 5, duration: 3 }],
        });
        const itemId = await addConsumableItem(cid, 1);
        const results = await useConsumable(itemId);
        expect(results[0]).toContain('STR +5');
        expect(player.attributes.str).toBe(15);
        expect(player.buffs).toHaveLength(1);
        expect(player.buffs[0].stat).toBe('str');
        expect(player.buffs[0].remaining).toBe(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #5: recalcStatsFromEquipment re-derives baseAttributes on every equip
// ═══════════════════════════════════════════════════════════════════════════════

describe('BUG #5: recalcStatsFromEquipment re-derives base when oldBonuses provided', () => {
    it('extract writes attributes between two equip actions — base re-derived correctly', async () => {
        // Setup: player base str=50, equip gear with +5 str
        const swordA = findOrCreateEquipment({ name: '旧剑', slot: 'weapon', stats: { atk: 10, str: 5 } });
        const swordB = findOrCreateEquipment({ name: '新剑', slot: 'weapon', stats: { atk: 20, str: 10 } });
        await addEquipmentItem(swordA);
        await addEquipmentItem(swordB);

        const player = getPlayerStore();

        // Initialize baseAttributes via first equip (triggers recalcStatsFromEquipment)
        // Set raw attributes first, then equip to establish baseAttributes
        player.attributes.str = 50;
        await equipItem('weapon', swordA);
        // After equip: baseAttributes.str = 50 - 0 (oldBonuses.str=0, no prior gear) = 50
        // attributes.str = 50 + 5 (swordA) = 55
        expect(player.baseAttributes.str).toBe(50);
        expect(player.attributes.str).toBe(55);

        // Simulate extract: specialist writes attributes.str = 60 (includes gear +5)
        // updatePlayerAttributes syncs: base = 60 - 5 = 55
        await updatePlayerAttributes({ str: 60 });
        expect(player.attributes.str).toBe(60);
        expect(player.baseAttributes.str).toBe(55); // base re-synced by updatePlayerAttributes

        // Equip swordB (+10 str, replacing swordA +5 str)
        // oldBonuses = {str:5,...} (swordA was equipped)
        // BUG #5 fix: recalc re-derives base = 60 - 5(oldBonuses) = 55
        // Then attributes = 55 + 10(newBonuses) = 65
        await equipItem('weapon', swordB);
        expect(player.baseAttributes.str).toBe(55); // correctly re-derived from 60 - 5
        expect(player.attributes.str).toBe(65);     // 55 + 10
    });

    it('extract writes attributes then unequip — base re-derived correctly', async () => {
        const armor = findOrCreateEquipment({ name: '铁甲', slot: 'chest', stats: { vit: 15 } });
        await addEquipmentItem(armor);

        const player = getPlayerStore();

        // Initialize baseAttributes: set vit=30 and equip armor
        player.attributes.vit = 30;
        await equipItem('chest', armor);
        expect(player.baseAttributes.vit).toBe(30);
        expect(player.attributes.vit).toBe(45); // 30 + 15

        // Simulate extract writes attributes.vit = 50 (includes gear +15)
        // updatePlayerAttributes syncs: base = 50 - 15 = 35
        await updatePlayerAttributes({ vit: 50 });
        expect(player.baseAttributes.vit).toBe(35);

        // Unequip armor: oldBonuses = {vit:15,...}
        // BUG #5 fix: recalc re-derives base = 50 - 15 = 35
        // Then attributes.vit = 35 + 0 (no gear) = 35
        await unequipItem('chest');
        expect(player.baseAttributes.vit).toBe(35); // correctly re-derived
        expect(player.attributes.vit).toBe(35);     // 35 + 0
    });

    it('consecutive equips without extract — base stays correct (idempotent)', async () => {
        const swordA = findOrCreateEquipment({ name: '剑A', slot: 'weapon', stats: { str: 5 } });
        const swordB = findOrCreateEquipment({ name: '剑B', slot: 'weapon', stats: { str: 10 } });
        await addEquipmentItem(swordA);
        await addEquipmentItem(swordB);

        const player = getPlayerStore();

        // Initialize baseAttributes via first equip
        player.attributes.str = 40;
        await equipItem('weapon', swordA);
        expect(player.baseAttributes.str).toBe(40);
        expect(player.attributes.str).toBe(45); // 40 + 5

        // Equip B (swap): oldBonuses={str:5}, recalc re-derives base = 45 - 5 = 40, attrs = 40 + 10 = 50
        await equipItem('weapon', swordB);
        expect(player.baseAttributes.str).toBe(40); // base preserved
        expect(player.attributes.str).toBe(50);     // 40 + 10
    });

    it('recalcStatsFromEquipment without oldBonuses uses cached base', async () => {
        const player = getPlayerStore();

        // Initialize baseAttributes first
        player.attributes.str = 30;
        player.attributes.agi = 20;
        recalcStatsFromEquipment(true); // no oldBonuses, baseAttributes not set → init from current
        expect(player.baseAttributes.str).toBe(30);
        expect(player.baseAttributes.agi).toBe(20);
        expect(player.attributes.str).toBe(30); // no gear bonuses
        expect(player.attributes.agi).toBe(20);

        // Manual recalc without oldBonuses — should use cached base
        recalcStatsFromEquipment(true);
        expect(player.baseAttributes.str).toBe(30);
        expect(player.baseAttributes.agi).toBe(20);
        expect(player.attributes.str).toBe(30);
        expect(player.attributes.agi).toBe(20);
    });
});
