import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock dependencies
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

vi.mock('../sao-store-player.js', () => ({
    getPlayerStore: vi.fn(() => mockStore?.playerStore || null),
}));

// Import AFTER mocks
import {
    getHousingStore,
    getPlayerHousing,
    setPlayerHousing,
    updatePlayerHousing,
    addDecoration,
    addFurniture,
    removeFurniture,
    isPlayerAtHome,
    getActiveFurnitureBuffs,
    clearPlayerHousing,
} from '../sao-store-housing.js';

// ─────────────────────────────────────────────────────────────────────────────
// beforeEach: reset mock store
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockStore = {
        playerStore: {
            player_id: 'player',
            identity: { name: '桐人', title: null },
            position: { floor_id: 'floor_001', location: '起始之城镇' },
        },
        housingStore: { playerHousing: null },
    };
});

// ═══════════════════════════════════════════════════════════════════════════════
// getHousingStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('getHousingStore', () => {
    it('returns existing housingStore', () => {
        const store = getHousingStore();
        expect(store).toBeTruthy();
        expect(store.playerHousing).toBeNull();
    });

    it('creates housingStore if missing', () => {
        delete mockStore.housingStore;
        const store = getHousingStore();
        expect(store).toBeTruthy();
        expect(store.playerHousing).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPlayerHousing
// ═══════════════════════════════════════════════════════════════════════════════

describe('getPlayerHousing', () => {
    it('returns null when no house', () => {
        expect(getPlayerHousing()).toBeNull();
    });

    it('returns housing data when set', () => {
        setPlayerHousing({ type: 'house', floor_id: 5, location: '测试镇' });
        const housing = getPlayerHousing();
        expect(housing).toBeTruthy();
        expect(housing.type).toBe('house');
        expect(housing.floor_id).toBe(5);
        expect(housing.location).toBe('测试镇');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setPlayerHousing
// ═══════════════════════════════════════════════════════════════════════════════

describe('setPlayerHousing', () => {
    it('sets all fields', () => {
        setPlayerHousing({
            type: 'mansion',
            floor_id: 20,
            location: '格兰萨姆',
            description: '豪华宅邸',
            decorations: ['壁画', '地毯'],
            furniture: [{ name: '床', buff: { name: '休息', effects: { vit: 5 }, description: '体力+5' } }],
        });
        const h = getPlayerHousing();
        expect(h.type).toBe('mansion');
        expect(h.floor_id).toBe(20);
        expect(h.location).toBe('格兰萨姆');
        expect(h.description).toBe('豪华宅邸');
        expect(h.decorations).toEqual(['壁画', '地毯']);
        expect(h.furniture).toHaveLength(1);
        expect(h.furniture[0].name).toBe('床');
    });

    it('uses defaults for missing fields', () => {
        setPlayerHousing({});
        const h = getPlayerHousing();
        expect(h.type).toBe('apartment');
        expect(h.floor_id).toBeNull();
        expect(h.location).toBe('');
        expect(h.description).toBe('');
        expect(h.decorations).toEqual([]);
        expect(h.furniture).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updatePlayerHousing
// ═══════════════════════════════════════════════════════════════════════════════

describe('updatePlayerHousing', () => {
    beforeEach(() => {
        setPlayerHousing({ type: 'house', floor_id: 5, location: '旧位置', description: '旧描述' });
    });

    it('updates location', () => {
        updatePlayerHousing({ location: '新位置' });
        expect(getPlayerHousing().location).toBe('新位置');
    });

    it('updates description', () => {
        updatePlayerHousing({ description: '新描述' });
        expect(getPlayerHousing().description).toBe('新描述');
    });

    it('updates decorations array', () => {
        updatePlayerHousing({ decorations: ['新装饰A', '新装饰B'] });
        expect(getPlayerHousing().decorations).toEqual(['新装饰A', '新装饰B']);
    });

    it('updates furniture array', () => {
        updatePlayerHousing({ furniture: [{ name: '新家具' }] });
        expect(getPlayerHousing().furniture).toEqual([{ name: '新家具' }]);
    });

    it('does nothing when no housing', () => {
        clearPlayerHousing();
        updatePlayerHousing({ location: '不存在' });
        expect(getPlayerHousing()).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addDecoration
// ═══════════════════════════════════════════════════════════════════════════════

describe('addDecoration', () => {
    beforeEach(() => {
        setPlayerHousing({ type: 'house', floor_id: 5 });
    });

    it('adds decoration to list', () => {
        addDecoration('挂画');
        addDecoration('花瓶');
        const h = getPlayerHousing();
        expect(h.decorations).toEqual(['挂画', '花瓶']);
    });

    it('does nothing when no housing', () => {
        clearPlayerHousing();
        addDecoration('无效装饰');
        expect(getPlayerHousing()).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addFurniture / removeFurniture
// ═══════════════════════════════════════════════════════════════════════════════

describe('addFurniture', () => {
    beforeEach(() => {
        setPlayerHousing({ type: 'house', floor_id: 5 });
    });

    it('adds furniture to list', () => {
        addFurniture({ name: '书架' });
        const h = getPlayerHousing();
        expect(h.furniture).toHaveLength(1);
        expect(h.furniture[0].name).toBe('书架');
    });

    it('adds furniture with buff', () => {
        addFurniture({
            name: '魔法床',
            buff: { name: '深度休息', effects: { vit: 10 }, description: '体力+10' },
        });
        const h = getPlayerHousing();
        expect(h.furniture[0].buff).toBeTruthy();
        expect(h.furniture[0].buff.effects.vit).toBe(10);
    });

    it('does nothing when no housing', () => {
        clearPlayerHousing();
        addFurniture({ name: '无效家具' });
        expect(getPlayerHousing()).toBeNull();
    });
});

describe('removeFurniture', () => {
    beforeEach(() => {
        setPlayerHousing({
            type: 'house',
            floor_id: 5,
            furniture: [
                { name: '床' },
                { name: '书架' },
                { name: '桌子' },
            ],
        });
    });

    it('removes furniture by name', () => {
        removeFurniture('书架');
        const h = getPlayerHousing();
        expect(h.furniture).toHaveLength(2);
        expect(h.furniture.find(f => f.name === '书架')).toBeUndefined();
    });

    it('handles removing non-existent furniture', () => {
        removeFurniture('不存在的家具');
        expect(getPlayerHousing().furniture).toHaveLength(3);
    });

    it('does nothing when no housing', () => {
        clearPlayerHousing();
        removeFurniture('床');
        expect(getPlayerHousing()).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isPlayerAtHome
// ═══════════════════════════════════════════════════════════════════════════════

describe('isPlayerAtHome', () => {
    it('returns false when no housing', () => {
        expect(isPlayerAtHome()).toBe(false);
    });

    it('returns false when housing has no floor_id', () => {
        setPlayerHousing({ type: 'house', floor_id: null });
        expect(isPlayerAtHome()).toBe(false);
    });

    it('returns false when player is on different floor', () => {
        setPlayerHousing({ type: 'house', floor_id: 10 });
        mockStore.playerStore.position.floor_id = 'floor_005';
        expect(isPlayerAtHome()).toBe(false);
    });

    it('returns true when player is on same floor (numeric vs string)', () => {
        setPlayerHousing({ type: 'house', floor_id: 1 });
        mockStore.playerStore.position.floor_id = 'floor_001';
        expect(isPlayerAtHome()).toBe(true);
    });

    it('returns true when both are same numeric string', () => {
        setPlayerHousing({ type: 'house', floor_id: 'floor_005' });
        mockStore.playerStore.position.floor_id = 'floor_005';
        expect(isPlayerAtHome()).toBe(true);
    });

    it('returns false when player position is missing', () => {
        setPlayerHousing({ type: 'house', floor_id: 1 });
        mockStore.playerStore.position = {};
        expect(isPlayerAtHome()).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getActiveFurnitureBuffs
// ═══════════════════════════════════════════════════════════════════════════════

describe('getActiveFurnitureBuffs', () => {
    it('returns empty when not at home', () => {
        setPlayerHousing({
            type: 'house',
            floor_id: 10, // different from player floor 1
            furniture: [{ name: '床', buff: { name: '休息', effects: { vit: 5 }, description: '' } }],
        });
        expect(getActiveFurnitureBuffs()).toEqual([]);
    });

    it('returns empty when no housing', () => {
        expect(getActiveFurnitureBuffs()).toEqual([]);
    });

    it('returns empty when no furniture', () => {
        setPlayerHousing({ type: 'house', floor_id: 1, furniture: [] });
        expect(getActiveFurnitureBuffs()).toEqual([]);
    });

    it('returns furniture buffs when at home', () => {
        setPlayerHousing({
            type: 'house',
            floor_id: 1,
            furniture: [
                { name: '魔法床', buff: { name: '深度休息', effects: { vit: 10 }, description: '体力+10' } },
                { name: '书架' }, // no buff
                { name: '护符', buff: { name: '守护', effects: { str: 3, agi: 3 }, description: '攻击+3 敏捷+3' } },
            ],
        });
        const buffs = getActiveFurnitureBuffs();
        expect(buffs).toHaveLength(2);
        expect(buffs[0].id).toBe('furniture_魔法床');
        expect(buffs[0].source).toBe('家具：魔法床');
        expect(buffs[0].name).toBe('深度休息');
        expect(buffs[0].effects).toEqual({ vit: 10 });
        expect(buffs[1].id).toBe('furniture_护符');
        expect(buffs[1].effects).toEqual({ str: 3, agi: 3 });
    });

    it('filters out furniture without buff', () => {
        setPlayerHousing({
            type: 'house',
            floor_id: 1,
            furniture: [
                { name: '桌子' },
                { name: '椅子' },
            ],
        });
        expect(getActiveFurnitureBuffs()).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// clearPlayerHousing
// ═══════════════════════════════════════════════════════════════════════════════

describe('clearPlayerHousing', () => {
    it('sets playerHousing to null', () => {
        setPlayerHousing({ type: 'house', floor_id: 5, location: '测试' });
        expect(getPlayerHousing()).toBeTruthy();
        clearPlayerHousing();
        expect(getPlayerHousing()).toBeNull();
    });

    it('is safe to call when already null', () => {
        clearPlayerHousing();
        clearPlayerHousing();
        expect(getPlayerHousing()).toBeNull();
    });
});
