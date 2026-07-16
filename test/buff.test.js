import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock sao-core.js (log function)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
}));

// Import AFTER mocks
import {
    calculateBuffTotals,
    addTemporaryBuff,
    addPermanentBuff,
    removeBuff,
    expireBuffs,
    formatBuffsForDisplay,
    formatBuffsForInjection,
    formatBuffSpecialEffects,
} from '../sao-buff.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: make a blank entity with empty buffs
// ─────────────────────────────────────────────────────────────────────────────
function makeEntity() {
    return {
        buffs: { temporary: [], permanent: [] },
    };
}

function makeEntityNoBuffs() {
    return {};
}

// ═══════════════════════════════════════════════════════════════════════════════
// calculateBuffTotals
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculateBuffTotals', () => {
    it('returns all zeros for null/undefined buffs', () => {
        const totals = calculateBuffTotals(null);
        expect(totals.str).toBe(0);
        expect(totals.agi).toBe(0);
        expect(totals.vit).toBe(0);
    });

    it('returns all zeros for empty buffs', () => {
        const totals = calculateBuffTotals({ temporary: [], permanent: [] });
        expect(totals.str).toBe(0);
        expect(totals.agi).toBe(0);
    });

    it('sums temporary buffs only', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '力量料理', effects: { str: 5 }, duration: '3回合' },
                { id: 't2', source: 'food', name: '速度料理', effects: { agi: 3 }, duration: '3回合' },
            ],
            permanent: [],
        };
        const totals = calculateBuffTotals(buffs);
        expect(totals.str).toBe(5);
        expect(totals.agi).toBe(3);
        expect(totals.int).toBe(0);
    });

    it('sums permanent buffs only', () => {
        const buffs = {
            temporary: [],
            permanent: [
                { id: 'p1', source: 'title', name: '封弊者', effects: { str: 3, agi: 3 }, description: '独自战斗的称号' },
            ],
        };
        const totals = calculateBuffTotals(buffs);
        expect(totals.str).toBe(3);
        expect(totals.agi).toBe(3);
    });

    it('sums both temporary and permanent buffs', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '力量料理', effects: { str: 5 }, duration: '3回合' },
            ],
            permanent: [
                { id: 'p1', source: 'title', name: '封弊者', effects: { str: 3, agi: 3 }, description: '独自战斗的称号' },
            ],
        };
        const totals = calculateBuffTotals(buffs);
        expect(totals.str).toBe(8);  // 5 + 3
        expect(totals.agi).toBe(3);
    });

    it('handles overlapping effects correctly', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '料理A', effects: { str: 5, vit: 2 }, duration: '3回合' },
                { id: 't2', source: 'food', name: '料理B', effects: { str: 3, vit: 1 }, duration: '3回合' },
            ],
            permanent: [
                { id: 'p1', source: 'title', name: '称号', effects: { str: 2 }, description: '称号' },
            ],
        };
        const totals = calculateBuffTotals(buffs);
        expect(totals.str).toBe(10);  // 5 + 3 + 2
        expect(totals.vit).toBe(3);   // 2 + 1
    });

    it('ignores effects with unknown stat keys', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '奇怪buff', effects: { str: 5, unknownStat: 10 }, duration: '3回合' },
            ],
            permanent: [],
        };
        const totals = calculateBuffTotals(buffs);
        expect(totals.str).toBe(5);
        // unknownStat should not be added (not in BUFF_STAT_FIELDS)
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addTemporaryBuff
// ═══════════════════════════════════════════════════════════════════════════════

describe('addTemporaryBuff', () => {
    it('adds a new temporary buff', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 'food_001',
            source: 'food',
            name: '力量料理',
            effects: { str: 5 },
            special_effects: [],
            description: '增加5点力量的料理',
            duration: '3回合',
            expires: 'turn_103',
        });
        expect(entity.buffs.temporary).toHaveLength(1);
        expect(entity.buffs.temporary[0].id).toBe('food_001');
        expect(entity.buffs.temporary[0].name).toBe('力量料理');
        expect(entity.buffs.temporary[0].effects.str).toBe(5);
        expect(entity.buffs.temporary[0].expires).toBe('turn_103');
    });

    it('replaces buff with same ID', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 'food_001',
            source: 'food',
            name: '力量料理',
            effects: { str: 5 },
            special_effects: [],
            description: '增加5点力量',
            duration: '3回合',
            expires: 'turn_103',
        });
        addTemporaryBuff(entity, {
            id: 'food_001',
            source: 'food',
            name: '超级力量料理',
            effects: { str: 10 },
            special_effects: [],
            description: '增加10点力量',
            duration: '5回合',
            expires: 'turn_105',
        });
        expect(entity.buffs.temporary).toHaveLength(1);
        expect(entity.buffs.temporary[0].name).toBe('超级力量料理');
        expect(entity.buffs.temporary[0].effects.str).toBe(10);
    });

    it('initializes buffs structure if missing', () => {
        const entity = makeEntityNoBuffs();
        addTemporaryBuff(entity, {
            id: 't1',
            source: 'food',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '测试buff',
            duration: '1回合',
            expires: 'manual',
        });
        expect(entity.buffs).toBeTruthy();
        expect(entity.buffs.temporary).toHaveLength(1);
    });

    it('skips buff with missing required fields', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, { id: 't1' }); // missing name and effects
        expect(entity.buffs.temporary).toHaveLength(0);
    });

    it('rejects missing source', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 't1',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '描述',
            duration: '1回合',
        });
        expect(entity.buffs.temporary).toHaveLength(0);
    });

    it('rejects missing description', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 't1',
            source: 'food',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            duration: '1回合',
        });
        expect(entity.buffs.temporary).toHaveLength(0);
    });

    it('rejects missing duration', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 't1',
            source: 'food',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '描述',
        });
        expect(entity.buffs.temporary).toHaveLength(0);
    });

    it('rejects invalid source', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 't1',
            source: 'invalid_source',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '描述',
            duration: '1回合',
        });
        expect(entity.buffs.temporary).toHaveLength(0);
    });

    it('rejects missing special_effects', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, {
            id: 't1',
            source: 'food',
            name: '测试',
            effects: { str: 1 },
            description: '描述',
            duration: '1回合',
        });
        expect(entity.buffs.temporary).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addPermanentBuff
// ═══════════════════════════════════════════════════════════════════════════════

describe('addPermanentBuff', () => {
    it('adds a new permanent buff', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'title_001',
            source: 'title',
            name: '封弊者',
            effects: { str: 3, agi: 3 },
            special_effects: [],
            description: '独自战斗的称号',
        });
        expect(entity.buffs.permanent).toHaveLength(1);
        expect(entity.buffs.permanent[0].id).toBe('title_001');
        expect(entity.buffs.permanent[0].name).toBe('封弊者');
        expect(entity.buffs.permanent[0].effects.str).toBe(3);
    });

    it('replaces buff with same ID', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'title_001',
            source: 'title',
            name: '封弊者',
            effects: { str: 3 },
            special_effects: [],
            description: '独自战斗的称号',
        });
        addPermanentBuff(entity, {
            id: 'title_001',
            source: 'title',
            name: '封弊者+',
            effects: { str: 5, agi: 5 },
            special_effects: [],
            description: '强化称号',
        });
        expect(entity.buffs.permanent).toHaveLength(1);
        expect(entity.buffs.permanent[0].name).toBe('封弊者+');
        expect(entity.buffs.permanent[0].effects.str).toBe(5);
    });

    it('initializes buffs structure if missing', () => {
        const entity = makeEntityNoBuffs();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'title',
            name: '测试永久',
            effects: { str: 1 },
            special_effects: [],
            description: '测试永久buff',
        });
        expect(entity.buffs).toBeTruthy();
        expect(entity.buffs.permanent).toHaveLength(1);
    });

    it('skips buff with missing required fields', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, { effects: { str: 1 } }); // missing id and name
        expect(entity.buffs.permanent).toHaveLength(0);
    });

    it('rejects missing source', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '描述',
        });
        expect(entity.buffs.permanent).toHaveLength(0);
    });

    it('rejects missing description', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'title',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
        });
        expect(entity.buffs.permanent).toHaveLength(0);
    });

    it('rejects invalid source', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'bad_source',
            name: '测试',
            effects: { str: 1 },
            special_effects: [],
            description: '描述',
        });
        expect(entity.buffs.permanent).toHaveLength(0);
    });

    it('rejects missing special_effects', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'title',
            name: '测试',
            effects: { str: 1 },
            description: '描述',
        });
        expect(entity.buffs.permanent).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// removeBuff
// ═══════════════════════════════════════════════════════════════════════════════

describe('removeBuff', () => {
    it('removes a temporary buff by ID', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, { id: 't1', source: 'food', name: '临时', effects: { str: 1 }, special_effects: [], description: '测试', duration: '1回合', expires: 'manual' });
        addTemporaryBuff(entity, { id: 't2', source: 'food', name: '临时2', effects: { agi: 1 }, special_effects: [], description: '测试', duration: '1回合', expires: 'manual' });
        const result = removeBuff(entity, 't1');
        expect(result).toBe(true);
        expect(entity.buffs.temporary).toHaveLength(1);
        expect(entity.buffs.temporary[0].id).toBe('t2');
    });

    it('removes a permanent buff by ID', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, { id: 'p1', source: 'title', name: '永久', effects: { str: 3 }, special_effects: [], description: '测试' });
        const result = removeBuff(entity, 'p1');
        expect(result).toBe(true);
        expect(entity.buffs.permanent).toHaveLength(0);
    });

    it('returns false when buff ID not found', () => {
        const entity = makeEntity();
        const result = removeBuff(entity, 'nonexistent');
        expect(result).toBe(false);
    });

    it('returns false for null entity', () => {
        expect(removeBuff(null, 'x')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// expireBuffs
// ═══════════════════════════════════════════════════════════════════════════════

describe('expireBuffs', () => {
    it('expires turn-based buffs when currentTurn >= expireTurn', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, { id: 't1', source: 'food', name: '限时buff', effects: { str: 5 }, special_effects: [], description: '测试', duration: '1回合', expires: 'turn_150' });
        addTemporaryBuff(entity, { id: 't2', source: 'food', name: '未到期', effects: { agi: 1 }, special_effects: [], description: '测试', duration: '1回合', expires: 'turn_200' });
        const removed = expireBuffs(entity, 150, 'turn');
        expect(removed).toEqual(['限时buff']);
        expect(entity.buffs.temporary).toHaveLength(1);
        expect(entity.buffs.temporary[0].id).toBe('t2');
    });

    it('does not expire turn-based buffs when currentTurn < expireTurn', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, { id: 't1', source: 'food', name: '未到期', effects: { str: 5 }, special_effects: [], description: '测试', duration: '1回合', expires: 'turn_150' });
        const removed = expireBuffs(entity, 100, 'turn');
        expect(removed).toEqual([]);
        expect(entity.buffs.temporary).toHaveLength(1);
    });

    it('manual buffs never expire', () => {
        const entity = makeEntity();
        addTemporaryBuff(entity, { id: 't1', source: 'food', name: '手动控制', effects: { str: 5 }, special_effects: [], description: '测试', duration: '1回合', expires: 'manual' });
        const removed = expireBuffs(entity, 9999, 'turn');
        expect(removed).toEqual([]);
        expect(entity.buffs.temporary).toHaveLength(1);
    });

    it('returns empty array when entity has no temporary buffs', () => {
        const entity = makeEntity();
        const removed = expireBuffs(entity, 100, 'turn');
        expect(removed).toEqual([]);
    });

    it('returns empty array for null entity', () => {
        const removed = expireBuffs(null, 100, 'turn');
        expect(removed).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatBuffsForDisplay
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatBuffsForDisplay', () => {
    it('returns empty string for null buffs', () => {
        expect(formatBuffsForDisplay(null)).toBe('');
    });

    it('returns empty string for empty buffs', () => {
        expect(formatBuffsForDisplay({ temporary: [], permanent: [] })).toBe('');
    });

    it('formats permanent buffs', () => {
        const buffs = {
            temporary: [],
            permanent: [
                { id: 'p1', name: '封弊者', effects: { str: 3, agi: 3 } },
            ],
        };
        expect(formatBuffsForDisplay(buffs)).toBe('封弊者(STR+3,AGI+3)');
    });

    it('formats temporary buffs with duration', () => {
        const buffs = {
            temporary: [
                { id: 't1', name: '力量料理', effects: { str: 5 }, duration: '1场战斗' },
            ],
            permanent: [],
        };
        expect(formatBuffsForDisplay(buffs)).toBe('力量料理(STR+5,1场战斗)');
    });

    it('formats mixed buffs: permanent first, then temporary', () => {
        const buffs = {
            temporary: [
                { id: 't1', name: '力量料理', effects: { str: 5 }, duration: '1场战斗' },
            ],
            permanent: [
                { id: 'p1', name: '封弊者', effects: { str: 3, agi: 3 } },
            ],
        };
        const result = formatBuffsForDisplay(buffs);
        expect(result).toBe('封弊者(STR+3,AGI+3) | 力量料理(STR+5,1场战斗)');
        // 永久在前
        expect(result.indexOf('封弊者')).toBeLessThan(result.indexOf('力量料理'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatBuffsForInjection
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatBuffsForInjection', () => {
    it('returns empty string for null buffs', () => {
        expect(formatBuffsForInjection(null)).toBe('');
    });

    it('returns empty string for empty buffs', () => {
        expect(formatBuffsForInjection({ temporary: [], permanent: [] })).toBe('');
    });

    it('formats permanent buffs with source', () => {
        const buffs = {
            temporary: [],
            permanent: [
                { id: 'p1', source: 'title', name: '封弊者', effects: { str: 3, agi: 3 } },
            ],
        };
        expect(formatBuffsForInjection(buffs)).toBe('[title]封弊者(STR+3,AGI+3 永久)');
    });

    it('formats temporary buffs with source and duration', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '力量料理', effects: { str: 5 }, duration: '1场战斗' },
            ],
            permanent: [],
        };
        expect(formatBuffsForInjection(buffs)).toBe('[food]力量料理(STR+5,1场战斗)');
    });

    it('formats mixed buffs', () => {
        const buffs = {
            temporary: [
                { id: 't1', source: 'food', name: '力量料理', effects: { str: 5 }, duration: '1场战斗' },
            ],
            permanent: [
                { id: 'p1', source: 'title', name: '封弊者', effects: { str: 3, agi: 3 } },
            ],
        };
        const result = formatBuffsForInjection(buffs);
        expect(result).toContain('[title]封弊者(STR+3,AGI+3 永久)');
        expect(result).toContain('[food]力量料理(STR+5,1场战斗)');
        // 永久在前
        expect(result.indexOf('封弊者')).toBeLessThan(result.indexOf('力量料理'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// special_effects
// ═══════════════════════════════════════════════════════════════════════════════

describe('special_effects', () => {
    it('formatBuffSpecialEffects returns empty for no special_effects', () => {
        expect(formatBuffSpecialEffects(null)).toBe('');
        expect(formatBuffSpecialEffects({})).toBe('');
        expect(formatBuffSpecialEffects({ special_effects: [] })).toBe('');
    });

    it('formatBuffSpecialEffects formats special effects', () => {
        const buff = { special_effects: ['免疫即死', '复活时满血'] };
        expect(formatBuffSpecialEffects(buff)).toBe('免疫即死; 复活时满血');
    });

    it('buff with special_effects displays them in formatBuffsForDisplay', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'title',
            name: '不死之躯',
            effects: { str: 3, vit: 5 },
            special_effects: ['免疫即死', '复活时满血'],
            description: '死亡游戏中的不死称号',
        });
        const result = formatBuffsForDisplay(entity.buffs);
        expect(result).toContain('免疫即死');
        expect(result).toContain('复活时满血');
        expect(result).toContain('STR+3');
        expect(result).toContain('VIT+5');
    });

    it('buff with empty special_effects omits them from display', () => {
        const entity = makeEntity();
        addPermanentBuff(entity, {
            id: 'p1',
            source: 'title',
            name: '普通称号',
            effects: { str: 3 },
            special_effects: [],
            description: '普通称号',
        });
        const result = formatBuffsForDisplay(entity.buffs);
        expect(result).toBe('普通称号(STR+3)');
    });
});
