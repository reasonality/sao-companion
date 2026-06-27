import { describe, it, expect } from 'vitest';
import {
    calculateDerivedStats,
    calculateFinalHitRate,
    calculateFinalCritRate,
    calculateFinalCritMultiplier,
    calculateFinalDamage,
    getTeammateActualStats,
    getEnemyActualStats,
} from '../battle/battleMath.js';

describe('calculateDerivedStats', () => {
    it('returns correct HPRE (hpRegen) formula', () => {
        // HPRE = 10 + VIT + floor(VIT^2/100)
        const stats = calculateDerivedStats(0, 0, 0, 20);
        expect(stats.hpRegen).toBe(10 + 20 + Math.floor(400 / 100)); // 34
    });

    it('returns correct MPRE (mpRegen) formula', () => {
        // MPRE = 5 + floor(INT/4)
        const stats = calculateDerivedStats(0, 0, 17, 0);
        expect(stats.mpRegen).toBe(5 + Math.floor(17 / 4)); // 9
    });

    it('returns correct AP (actionPoints) formula', () => {
        // AP = 2 + floor(VIT/20)
        const stats = calculateDerivedStats(0, 0, 0, 45);
        expect(stats.actionPoints).toBe(2 + Math.floor(45 / 20)); // 4
    });

    it('returns correct speed formula', () => {
        // speed = 50 + AGI*2
        const stats = calculateDerivedStats(0, 15, 0, 0);
        expect(stats.speed).toBe(50 + 15 * 2); // 80
    });

    it('returns correct derived stats from multiple inputs', () => {
        const stats = calculateDerivedStats(10, 20, 30, 40);
        expect(stats.evasionRate).toBe(20 * 0.005);
        expect(stats.damageBonus).toBe(10 * 0.01);
        expect(stats.physicalReduction).toBe(10);
        expect(stats.damageTakenRate).toBe(50 / (50 + 40));
        expect(stats.extraHitRate).toBe(20 * 0.01);
        expect(stats.extraCritRate).toBe(30 * 0.01);
        expect(stats.baseCritMultiplier).toBe(1.5 + 30 * 0.01);
        expect(stats.critRateResistance).toBe(20 * 0.005 + 30 * 0.005);
        expect(stats.critDamageResistance).toBe(10 * 0.005 + 30 * 0.005);
    });

    it('treats undefined/null as 0', () => {
        const stats = calculateDerivedStats(undefined, null, undefined, 0);
        expect(stats.hpRegen).toBe(10); // VIT=0 → 10 + 0 + 0
        expect(stats.speed).toBe(50);   // AGI=0 → 50
    });
});

describe('calculateFinalHitRate', () => {
    it('calculates hit rate with no evasion', () => {
        const attackerStats = { extraHitRate: 0 };
        const targetStats = { evasionRate: 0 };
        expect(calculateFinalHitRate(80, attackerStats, targetStats)).toBe(0.8);
    });

    it('subtracts target evasion', () => {
        const attackerStats = { extraHitRate: 0.1 };
        const targetStats = { evasionRate: 0.2 };
        expect(calculateFinalHitRate(90, attackerStats, targetStats)).toBeCloseTo(0.8);
    });

    it('clamps to 0 when negative', () => {
        const attackerStats = { extraHitRate: 0 };
        const targetStats = { evasionRate: 1.5 };
        expect(calculateFinalHitRate(50, attackerStats, targetStats)).toBe(0);
    });
});

describe('calculateFinalCritRate', () => {
    it('calculates basic crit rate', () => {
        const attackerStats = { extraCritRate: 0 };
        const targetStats = { critRateResistance: 0 };
        expect(calculateFinalCritRate(30, attackerStats, targetStats, 0.8)).toBeCloseTo(0.3);
    });

    it('adds over-hit crit bonus when hitRate > 1.0', () => {
        const attackerStats = { extraCritRate: 0 };
        const targetStats = { critRateResistance: 0 };
        const overHitBonus = Math.max(0, 1.2 - 1.0) * 0.5; // 0.1
        expect(calculateFinalCritRate(30, attackerStats, targetStats, 1.2)).toBeCloseTo(0.3 + 0.1);
    });

    it('subtracts target crit resistance', () => {
        const attackerStats = { extraCritRate: 0.05 };
        const targetStats = { critRateResistance: 0.1 };
        expect(calculateFinalCritRate(20, attackerStats, targetStats, 0.8)).toBeCloseTo(0.2 + 0.05 - 0.1);
    });

    it('clamps to 0 when negative', () => {
        const attackerStats = { extraCritRate: 0 };
        const targetStats = { critRateResistance: 2.0 };
        expect(calculateFinalCritRate(10, attackerStats, targetStats, 0.5)).toBe(0);
    });
});

describe('calculateFinalCritMultiplier', () => {
    it('returns base crit multiplier with no over-crit', () => {
        const attackerStats = { baseCritMultiplier: 1.8 };
        const targetStats = { critDamageResistance: 0 };
        expect(calculateFinalCritMultiplier(attackerStats, targetStats, 0.5)).toBeCloseTo(1.8);
    });

    it('adds over-crit damage bonus when critRate > 1.0', () => {
        const attackerStats = { baseCritMultiplier: 1.8 };
        const targetStats = { critDamageResistance: 0 };
        const overCritBonus = Math.max(0, 1.3 - 1.0) * 0.5; // 0.15
        expect(calculateFinalCritMultiplier(attackerStats, targetStats, 1.3)).toBeCloseTo(1.8 + 0.15);
    });

    it('subtracts target crit damage resistance', () => {
        const attackerStats = { baseCritMultiplier: 2.0 };
        const targetStats = { critDamageResistance: 0.5 };
        expect(calculateFinalCritMultiplier(attackerStats, targetStats, 0.5)).toBeCloseTo(1.5);
    });

    it('clamps to minimum 1.0', () => {
        const attackerStats = { baseCritMultiplier: 1.0 };
        const targetStats = { critDamageResistance: 5.0 };
        expect(calculateFinalCritMultiplier(attackerStats, targetStats, 0.5)).toBe(1.0);
    });
});

describe('calculateFinalDamage', () => {
    it('calculates non-crit damage', () => {
        const attackerStats = { damageBonus: 0.2 };     // +20%
        const targetStats = { damageTakenRate: 0.5, physicalReduction: 10 };
        // 100 * (1 + 0.2) * 0.5 = 60, minus 10 = 50
        expect(calculateFinalDamage(100, attackerStats, targetStats)).toBe(50);
    });

    it('applies crit multiplier', () => {
        const attackerStats = { damageBonus: 0 };
        const targetStats = { damageTakenRate: 1.0, physicalReduction: 0 };
        // 50 * 1.0 * 1.0 = 50, crit → 50 * 2.0 = 100
        expect(calculateFinalDamage(50, attackerStats, targetStats, true, 2.0)).toBe(100);
    });

    it('floors the result', () => {
        const attackerStats = { damageBonus: 0 };
        const targetStats = { damageTakenRate: 0.33, physicalReduction: 0 };
        // 100 * 0.33 = 33.0 → floor = 33
        expect(calculateFinalDamage(100, attackerStats, targetStats)).toBe(33);
    });

    it('clamps to 0 when reduction exceeds damage', () => {
        const attackerStats = { damageBonus: 0 };
        const targetStats = { damageTakenRate: 0.1, physicalReduction: 50 };
        // 10 * 0.1 = 1, minus 50 = -49 → clamp 0
        expect(calculateFinalDamage(10, attackerStats, targetStats)).toBe(0);
    });
});

describe('getTeammateActualStats', () => {
    it('returns raw stats when no buffs', () => {
        const teammate = { str: 10, agi: 20, int: 30, vit: 40 };
        const result = getTeammateActualStats(teammate);
        expect(result.str).toBe(10);
        expect(result.agi).toBe(20);
        expect(result.int).toBe(30);
        expect(result.end).toBe(40);
        expect(result.speed).toBe(50 + 20 * 2);
    });

    it('applies strBoost buff', () => {
        const teammate = { str: 10, agi: 0, int: 0, vit: 0, buffs: [{ type: 'strBoost', value: 5 }] };
        const result = getTeammateActualStats(teammate);
        expect(result.str).toBe(15);
        expect(result.physicalReduction).toBe(15); // str * 1
    });

    it('applies multiple buff types', () => {
        const teammate = {
            str: 10, agi: 10, int: 10, vit: 10,
            buffs: [
                { type: 'strBoost', value: 5 },
                { type: 'agiBoost', value: 3 },
                { type: 'intBoost', value: 2 },
                { type: 'endBoost', value: 8 },
            ],
        };
        const result = getTeammateActualStats(teammate);
        expect(result.str).toBe(15);
        expect(result.agi).toBe(13);
        expect(result.int).toBe(12);
        expect(result.end).toBe(18);
    });

    it('defaults missing stats to 0', () => {
        const teammate = {};
        const result = getTeammateActualStats(teammate);
        expect(result.str).toBe(0);
        expect(result.speed).toBe(50);
    });
});

describe('getEnemyActualStats', () => {
    it('returns raw stats when no buffs', () => {
        const enemy = { str: 5, agi: 10, int: 15, vit: 20 };
        const result = getEnemyActualStats(enemy);
        expect(result.str).toBe(5);
        expect(result.agi).toBe(10);
        expect(result.int).toBe(15);
        expect(result.vit).toBe(20);
        expect(result.speed).toBe(50 + 10 * 2);
    });

    it('applies strBoost buff', () => {
        const enemy = { str: 10, agi: 0, int: 0, vit: 0, buffs: [{ type: 'strBoost', value: 3 }] };
        const result = getEnemyActualStats(enemy);
        expect(result.str).toBe(13);
    });

    it('applies endBoost to vit', () => {
        const enemy = { str: 0, agi: 0, int: 0, vit: 10, buffs: [{ type: 'endBoost', value: 5 }] };
        const result = getEnemyActualStats(enemy);
        expect(result.vit).toBe(15);
    });

    it('defaults missing stats to 0', () => {
        const enemy = {};
        const result = getEnemyActualStats(enemy);
        expect(result.str).toBe(0);
        expect(result.vit).toBe(0);
    });
});
