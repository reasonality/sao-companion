import { describe, it, expect, vi } from 'vitest';
import {
    calculateActionOrderCore,
    executeStandardAttack,
    performEnemyActionCore,
    executeTeammateAttackCore,
    processEndOfRoundCore,
    a5MultiHitCore,
    applyDamageToEnemy,
    getPlayerStatsCore,
} from '../battle/battleCore.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal player entity for combat tests.
 * stats derived from getPlayerStatsCore({str:30, agi:25, int:10, vit:10}, [], {})
 *   → speed=100, hpRegen=24, mpRegen=7
 */
function makePlayer(overrides = {}) {
    return {
        id: 'p1',
        name: 'Kirito',
        hp: 500,
        maxHp: 500,
        mp: 200,
        maxMp: 200,
        str: 30,
        agi: 25,
        int: 10,
        vit: 10,
        ap: 4,
        buffs: [],
        ...overrides,
    };
}

function makeEnemy(overrides = {}) {
    return {
        id: 'e1',
        name: 'Goblin',
        hp: 200,
        maxHp: 200,
        str: 15,
        agi: 10,
        int: 5,
        vit: 10,
        buffs: [],
        attackPattern: ['Slash'],
        nextAttackIndex: 0,
        skills: [{ name: 'Slash', attack: 30, hitRate: 90, critRate: 5, targetsPerAttack: 1 }],
        ...overrides,
    };
}

function makeTeammate(overrides = {}) {
    return {
        id: 't1',
        name: 'Asuna',
        hp: 300,
        maxHp: 300,
        mp: 100,
        maxMp: 100,
        str: 20,
        agi: 15,
        int: 10,
        vit: 10,
        buffs: [],
        skills: [{ name: 'Thrust', attack: 25, hitRate: 85, critRate: 10, mpCost: 0, apt: 1 }],
        ...overrides,
    };
}

/** Standard attack skill (A1 archetype) */
function makeA1Skill(overrides = {}) {
    return {
        name: 'A1:PowerSlash',
        attack: 80,
        hitRate: 90,
        critRate: 15,
        apt: 1,
        tpa: 1,
        ...overrides,
    };
}

/** Player stats snapshot (from getPlayerStatsCore with str:30, agi:25, int:10, vit:10) */
const PLAYER_STATS = getPlayerStatsCore({ str: 30, agi: 25, int: 10, vit: 10 }, [], {});

// ─────────────────────────────────────────────────────────────────────────────
// 1. 单轮战斗：A1 标准攻击正确造成伤害
// ─────────────────────────────────────────────────────────────────────────────
describe('单轮战斗：A1 标准攻击正确造成伤害', () => {
    it('enemy takes damage and player may take counter-damage without exceptions', () => {
        // Fix random seed: guarantee hit + no crit for determinism
        let callCount = 0;
        vi.spyOn(Math, 'random').mockImplementation(() => {
            callCount++;
            // Pattern: hitRoll (0.1=hit), critRoll (0.99=no crit), then enemy stuff...
            // For player attack: hitRoll, critRoll
            // For enemy attack: hitRoll, critRoll
            if (callCount === 1) return 0.1;  // player hit
            if (callCount === 2) return 0.99; // player no crit
            if (callCount === 3) return 0.1;  // enemy hit
            if (callCount === 4) return 0.99; // enemy no crit
            return 0.5; // default
        });

        const player = makePlayer();
        const enemy = makeEnemy();
        const skill = makeA1Skill();
        const playerBuffs = [];
        const log = [];

        // Execute player attack (mirrors resolveCombatRound call order)
        const instructions = executeStandardAttack(skill, [enemy], PLAYER_STATS, player, playerBuffs, log, player.name);

        // Enemy should have taken damage
        expect(enemy.hp).toBeLessThan(200);
        expect(enemy.hp).toBeGreaterThanOrEqual(0);

        // Execute enemy attack
        const enemyInstructions = performEnemyActionCore(enemy, player, [], log);
        expect(() => performEnemyActionCore(enemy, player, [], log)).not.toThrow();

        // Player may have taken damage (enemy counter-attack)
        expect(player.hp).toBeLessThanOrEqual(500);
        expect(player.hp).toBeGreaterThanOrEqual(0);

        // Process end of round
        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log);
        expect(log.length).toBeGreaterThan(0);

        vi.restoreAllMocks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 两轮战斗一致性：HP 跨轮次正确递减
// ─────────────────────────────────────────────────────────────────────────────
describe('两轮战斗一致性：HP 跨轮次正确递减', () => {
    it('enemy HP decreases or stays same across rounds; player HP stays <= maxHp', () => {
        // Deterministic rolls: always hit, never crit
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        const player = makePlayer();
        const enemy = makeEnemy();
        const skill = makeA1Skill();
        const playerBuffs = [];
        const log = [];

        // ─── Round 1 ───
        executeStandardAttack(skill, [enemy], PLAYER_STATS, player, playerBuffs, log, player.name);
        performEnemyActionCore(enemy, player, [], log);
        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log);

        const enemyHpAfterR1 = enemy.hp;
        const playerHpAfterR1 = player.hp;

        // Enemy must have taken damage in R1
        expect(enemyHpAfterR1).toBeLessThan(200);
        // Player HP should not exceed maxHp (regen capped)
        expect(playerHpAfterR1).toBeLessThanOrEqual(500);

        // ─── Round 2 ───
        // Reset AP for next round (resolveCombatRound does this)
        player.ap = 4;
        const log2 = [];

        executeStandardAttack(skill, [enemy], PLAYER_STATS, player, playerBuffs, log2, player.name);
        performEnemyActionCore(enemy, player, [], log2);
        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log2);

        const enemyHpAfterR2 = enemy.hp;
        const playerHpAfterR2 = player.hp;

        // Enemy HP should not increase across rounds (no enemy regen in this fixture)
        expect(enemyHpAfterR2).toBeLessThanOrEqual(enemyHpAfterR1);
        // Player HP should never exceed maxHp
        expect(playerHpAfterR2).toBeLessThanOrEqual(500);

        vi.restoreAllMocks();
    });

    it('buff durations decrement across rounds', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        const player = makePlayer();
        const enemy = makeEnemy();
        const playerBuffs = [{ type: 'strBoost', value: 5, duration: 3, isPositive: true, name: '力量提升' }];
        const log = [];

        // Round 1
        executeStandardAttack(makeA1Skill(), [enemy], PLAYER_STATS, player, playerBuffs, log, player.name);
        performEnemyActionCore(enemy, player, [], log);
        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log);

        expect(playerBuffs[0].duration).toBe(2);

        // Round 2
        player.ap = 4;
        executeStandardAttack(makeA1Skill(), [enemy], PLAYER_STATS, player, playerBuffs, log, player.name);
        performEnemyActionCore(enemy, player, [], log);
        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log);

        expect(playerBuffs[0].duration).toBe(1);

        vi.restoreAllMocks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 护盾吸收顺序：tempShield 先于 permanent shield
// ─────────────────────────────────────────────────────────────────────────────
describe('护盾吸收顺序：tempShield 先于 permanent shield', () => {
    it('tempShield absorbs first, then permanent shield, then HP', () => {
        const target = {
            name: 'Hero',
            hp: 100,
            maxHp: 100,
            shield: 50,
            maxShield: 50,
            tempShield: 30,
        };
        const log = [];

        applyDamageToEnemy(target, 70, log, 'Attacker', 'Sword', false);

        // tempShield absorbs first 30 → 0
        expect(target.tempShield).toBe(0);
        // shield absorbs next 40 (70-30) → 10 remaining
        expect(target.shield).toBe(10);
        // HP untouched (70 - 30 - 40 = 0 remaining damage)
        expect(target.hp).toBe(100);
    });

    it('excess damage bleeds through all shields into HP', () => {
        const target = {
            name: 'Guard',
            hp: 100,
            maxHp: 100,
            shield: 20,
            maxShield: 20,
            tempShield: 10,
        };
        const log = [];

        applyDamageToEnemy(target, 80, log, 'Attacker', 'Sword', false);

        // tempShield absorbs 10 → 0
        expect(target.tempShield).toBe(0);
        // shield absorbs 20 → 0
        expect(target.shield).toBe(0);
        // HP absorbs remaining 50 (80-10-20) → 50
        expect(target.hp).toBe(50);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. M1 吸血：怪物吸血技能触发
// ─────────────────────────────────────────────────────────────────────────────
describe('M1 吸血：怪物吸血技能触发', () => {
    it('enemy heals from M1 lifesteal and player takes damage', () => {
        // Force hit, no crit
        vi.spyOn(Math, 'random').mockReturnValue(0.1);

        const player = makePlayer({ hp: 200, maxHp: 200, str: 5, agi: 5, int: 5, vit: 5 });
        const enemy = makeEnemy({
            hp: 100,
            maxHp: 200,
            str: 30,
            agi: 10,
            attackPattern: ['Drain'],
            skills: [{
                name: 'Drain',
                attack: 50,
                hitRate: 100,
                critRate: 0,
                targetsPerAttack: 1,
                codes: ['MN:M1,50'], // 50% lifesteal
            }],
        });

        const log = [];
        const enemyHpBefore = enemy.hp; // 100

        performEnemyActionCore(enemy, player, [], log);

        // Enemy should have healed (M1 lifesteal: 50% of damage)
        expect(enemy.hp).toBeGreaterThan(enemyHpBefore);
        // Player should have taken damage
        expect(player.hp).toBeLessThan(200);
        // Log should mention lifesteal
        expect(log.some(m => m.includes('吸血'))).toBe(true);

        vi.restoreAllMocks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. A5 多段命中：命中与未命中均发生
// ─────────────────────────────────────────────────────────────────────────────
describe('A5 多段命中：每击独立命中判定', () => {
    it('with hitRate=50%, both hits and misses occur across iterations', () => {
        // Deterministic mock: pattern [hit, critRoll, miss, hit, critRoll] repeating.
        // finalHitRate = weaponHitRate/100 + extraHitRate - enemyEvasionRate
        //   = 0.50 + agi*0.01 - agi*0.005 = 0.50 + 0.25 - 0.05 = 0.70
        // So hitRoll <= 0.70 → hit; > 0.70 → miss.
        // On hit: 2 random calls (hitRoll + critRoll); on miss: 1 call (hitRoll only).
        // Roll sequence assumes hitRoll + critRoll per attack per enemy. Update if a5MultiHitCore changes.
        const rolls = [0.1, 0.99, 0.8, 0.1, 0.99]; // hit, no-crit, miss, hit, no-crit (repeating)
        let rollIdx = 0;
        vi.spyOn(Math, 'random').mockImplementation(() => rolls[rollIdx++ % rolls.length]);

        const player = makePlayer({ ap: 3, mp: 100 });
        const enemy = makeEnemy({ hp: 9999, maxHp: 9999 }); // won't die
        const weapon = { name: 'A5:MultiStrike', attack: 20, hitRate: 50, critRate: 0, mpCost: 5, apt: 1 };
        const log = [];

        let hitCount = 0;
        let missCount = 0;

        // Run 20 iterations with fresh enemy each time to observe statistical spread
        for (let i = 0; i < 20; i++) {
            const testEnemy = { ...enemy, hp: 9999, maxHp: 9999, buffs: [], str: 15, agi: 10, vit: 10 };
            const testPlayer = { ...player, ap: 3, mp: 100 };
            const testLog = [];

            const instr = a5MultiHitCore(testPlayer, weapon, [testEnemy], PLAYER_STATS, testLog);
            const hits = instr.filter(i => i.type === 'damage');
            const misses = instr.filter(i => i.type === 'miss');
            hitCount += hits.length;
            missCount += misses.length;
        }

        // With 50% hitRate over 20 iterations * multiple hits, we should see both
        expect(hitCount).toBeGreaterThan(0);
        expect(missCount).toBeGreaterThan(0);

        vi.restoreAllMocks();
    });

    it('with hitRate=100%, all attacks hit', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.01); // always below threshold

        const player = makePlayer({ ap: 2, mp: 100 });
        const enemy = makeEnemy({ hp: 9999, maxHp: 9999 });
        const weapon = { name: 'A5:MultiStrike', attack: 20, hitRate: 100, critRate: 0, mpCost: 5, apt: 1 };
        const log = [];

        const instr = a5MultiHitCore(player, weapon, [enemy], PLAYER_STATS, log);
        const damages = instr.filter(i => i.type === 'damage');
        const misses = instr.filter(i => i.type === 'miss');

        expect(damages.length).toBeGreaterThan(0);
        expect(misses.length).toBe(0);

        vi.restoreAllMocks();
    });

    it('stops when MP is exhausted', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.01); // always hit

        const player = makePlayer({ ap: 10, mp: 12 }); // enough for 2 hits at cost 5 each, not 3
        const enemy = makeEnemy({ hp: 9999, maxHp: 9999 });
        const weapon = { name: 'A5:MultiStrike', attack: 20, hitRate: 100, critRate: 0, mpCost: 5, apt: 1 };
        const log = [];

        a5MultiHitCore(player, weapon, [enemy], PLAYER_STATS, log);

        // Should have stopped due to MP exhaustion
        expect(log.some(m => m.includes('MP不足') || m.includes('AP耗尽'))).toBe(true);

        vi.restoreAllMocks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 队友 MP 不足时跳过攻击
// ─────────────────────────────────────────────────────────────────────────────
describe('队友 MP 不足时跳过攻击', () => {
    it('skips attack when teammate MP < skill mpCost', () => {
        const teammate = makeTeammate({
            mp: 5,
            skills: [{ name: 'PowerSlash', attack: 25, hitRate: 85, critRate: 10, mpCost: 10, apt: 1 }],
        });
        const enemy = makeEnemy();
        const log = [];

        const instructions = executeTeammateAttackCore(teammate, [enemy], log);

        // No damage instructions (attack was skipped)
        expect(instructions.length).toBe(0);
        // Enemy HP unchanged
        expect(enemy.hp).toBe(200);
        // Log mentions MP shortage
        expect(log.some(m => m.includes('蓝量不足') || m.includes('MP不足'))).toBe(true);
    });

    it('proceeds with attack when MP is sufficient', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.1); // force hit

        const teammate = makeTeammate({
            mp: 20,
            skills: [{ name: 'Thrust', attack: 25, hitRate: 100, critRate: 0, mpCost: 10, apt: 1 }],
        });
        const enemy = makeEnemy();
        const log = [];

        const instructions = executeTeammateAttackCore(teammate, [enemy], log);

        // Should have damage instruction
        expect(instructions.some(i => i.type === 'damage')).toBe(true);
        // Enemy HP reduced
        expect(enemy.hp).toBeLessThan(200);
        // MP deducted
        expect(teammate.mp).toBe(10);

        vi.restoreAllMocks();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 队友 regen 与 enemy HoT 回血
// ─────────────────────────────────────────────────────────────────────────────
describe('队友 regen 与 enemy HoT 回血', () => {
    it('teammate heals from hpRegen, enemy heals from healOverTime buff', () => {
        const player = makePlayer({ hp: 100, maxHp: 500 });
        const teammate = makeTeammate({ hp: 50, maxHp: 100, hpRegen: 10 });
        const enemy = makeEnemy({
            hp: 50,
            maxHp: 200,
            buffs: [{ type: 'healOverTime', value: 15, duration: 3, isPositive: true, name: '持续恢复' }],
        });
        const playerBuffs = [];
        const log = [];

        processEndOfRoundCore(player, playerBuffs, [enemy], [teammate], PLAYER_STATS, log);

        // Teammate: 50 + hpRegen(10) = 60
        expect(teammate.hp).toBe(60);
        // Enemy: 50 + healOverTime(15) = 65
        expect(enemy.hp).toBe(65);
    });

    it('healOverTime is capped at maxHp', () => {
        const player = makePlayer({ hp: 100, maxHp: 500 });
        const enemy = makeEnemy({
            hp: 195,
            maxHp: 200,
            buffs: [{ type: 'healOverTime', value: 15, duration: 2, isPositive: true, name: '持续恢复' }],
        });
        const playerBuffs = [];
        const log = [];

        processEndOfRoundCore(player, playerBuffs, [enemy], [], PLAYER_STATS, log);

        // 195 + 15 = 210, capped at 200
        expect(enemy.hp).toBe(200);
    });

    it('teammate hpRegen is capped at maxHp', () => {
        const player = makePlayer({ hp: 100, maxHp: 500 });
        const teammate = makeTeammate({ hp: 95, maxHp: 100, hpRegen: 10 });
        const playerBuffs = [];
        const log = [];

        processEndOfRoundCore(player, playerBuffs, [], [teammate], PLAYER_STATS, log);

        // 95 + 10 = 105, capped at 100
        expect(teammate.hp).toBe(100);
    });

    it('multiple teammates each regenerate independently', () => {
        const player = makePlayer({ hp: 100, maxHp: 500 });
        const tm1 = makeTeammate({ id: 't1', name: 'Asuna', hp: 50, maxHp: 100, hpRegen: 10 });
        const tm2 = makeTeammate({ id: 't2', name: 'Leafa', hp: 30, maxHp: 80, hpRegen: 5 });
        const playerBuffs = [];
        const log = [];

        processEndOfRoundCore(player, playerBuffs, [], [tm1, tm2], PLAYER_STATS, log);

        expect(tm1.hp).toBe(60); // 50 + 10
        expect(tm2.hp).toBe(35); // 30 + 5
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: processEndOfRoundCore comprehensive integration
// ─────────────────────────────────────────────────────────────────────────────
describe('processEndOfRoundCore 综合：DoT + HoT + regen + buff 递减', () => {
    it('processes all end-of-round effects in correct order', () => {
        const player = makePlayer({ hp: 200, maxHp: 500 });
        const teammate = makeTeammate({ hp: 80, maxHp: 100, hpRegen: 5 });
        const enemy = makeEnemy({
            hp: 150,
            maxHp: 200,
            buffs: [
                { type: 'dot', value: 10, duration: 2, isPositive: false, name: '持续伤害' },
                { type: 'healOverTime', value: 5, duration: 2, isPositive: true, name: '持续恢复' },
            ],
        });
        const playerBuffs = [
            { type: 'strBoost', value: 5, duration: 1, isPositive: true, name: '力量提升' },
        ];
        const log = [];

        processEndOfRoundCore(player, playerBuffs, [enemy], [teammate], PLAYER_STATS, log);

        // Enemy: 150 - 10(DoT) + 5(HoT) = 145
        expect(enemy.hp).toBe(145);
        // Teammate: 80 + 5(regen) = 85
        expect(teammate.hp).toBe(85);
        // Player: 200 + hpRegen (from PLAYER_STATS) capped at 500
        expect(player.hp).toBeGreaterThan(200);
        expect(player.hp).toBeLessThanOrEqual(500);

        // strBoost duration decremented from 1 → 0 → removed by removeExpiredBuffs
        expect(playerBuffs.length).toBe(0); // expired and removed

        // Enemy DoT and HoT durations: 2→1 after decrementBuffTurns (still >0, kept)
        expect(enemy.buffs.length).toBe(2);
        expect(enemy.buffs[0].duration).toBe(1);
        expect(enemy.buffs[1].duration).toBe(1);

        // Verify log contains DoT and HoT messages
        expect(log.some(m => m.includes('持续伤害'))).toBe(true);
        // Enemy healOverTime log uses "持续再生", not "持续恢复"
        expect(log.some(m => m.includes('持续再生') || m.includes('持续恢复'))).toBe(true);
    });
});
