import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    getPlayerStatsCore,
    calculateActionOrderCore,
    handleDOTCore,
    handleHealOverTimeCore,
    handlePermanentShieldCore,
    handleTemporaryShieldCore,
    handleShieldOverTimeCore,
    hasDebuff,
    selectTargets,
    applyDamageToEnemy,
    healCore,
    manaRestoreCore,
    sacrificeBoostCore,
    processEnchantmentEffectsCore,
} from '../battle/battleCore.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// getPlayerStatsCore
// ─────────────────────────────────────────────────────────────────────────────
describe('getPlayerStatsCore', () => {
    it('returns base derived stats with no equipment or buffs', () => {
        const player = { str: 10, agi: 20, int: 30, vit: 40 };
        const stats = getPlayerStatsCore(player, [], {});
        expect(stats.str).toBe(10);
        expect(stats.agi).toBe(20);
        expect(stats.int).toBe(30);
        expect(stats.end).toBe(40);
        expect(stats.speed).toBe(50 + 20 * 2); // 90
        expect(stats.hpRegen).toBe(10 + 40 + Math.floor(1600 / 100)); // 66
    });

    it('adds equipment stats to base stats', () => {
        const player = { str: 10, agi: 10, int: 10, vit: 10 };
        const equip = { str: 5, agi: 3, int: 2, vit: 8 };
        const stats = getPlayerStatsCore(player, [], equip);
        expect(stats.str).toBe(15);
        expect(stats.agi).toBe(13);
        expect(stats.int).toBe(12);
        expect(stats.end).toBe(18);
    });

    it('applies buff modifiers on top of base + equipment', () => {
        const player = { str: 10, agi: 10, int: 10, vit: 10 };
        const equip = { str: 5, agi: 5, int: 5, vit: 5 };
        const buffs = [
            { type: 'strBoost', value: 3 },
            { type: 'agiBoost', value: 2 },
            { type: 'intBoost', value: 7 },
            { type: 'endBoost', value: 1 },
        ];
        const stats = getPlayerStatsCore(player, buffs, equip);
        expect(stats.str).toBe(18); // 10+5+3
        expect(stats.agi).toBe(17); // 10+5+2
        expect(stats.int).toBe(22); // 10+5+7
        expect(stats.end).toBe(16); // 10+5+1
    });

    it('treats missing equipment fields as 0', () => {
        const player = { str: 5, agi: 5, int: 5, vit: 5 };
        const stats = getPlayerStatsCore(player, [], {});
        expect(stats.str).toBe(5);
        expect(stats.agi).toBe(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateActionOrderCore
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateActionOrderCore', () => {
    it('sorts participants by speed descending', () => {
        const participants = [
            { type: 'player', id: 'p1', name: 'Hero', speed: 60, entity: {} },
            { type: 'enemy', id: 'e1', name: 'Slime', speed: 100, entity: {} },
        ];
        const result = calculateActionOrderCore(participants);
        expect(result[0].id).toBe('e1');
        expect(result[0].speed).toBe(100);
        expect(result[1].id).toBe('p1');
    });

    it('grants extra actions for entities with speed >= 2x minSpeed', () => {
        const participants = [
            { type: 'player', id: 'p1', name: 'Hero', speed: 200, entity: {} },
            { type: 'enemy', id: 'e1', name: 'Slime', speed: 50, entity: {} },
        ];
        const result = calculateActionOrderCore(participants);
        // Hero: base(200), extra(100), extra(50) — 200>=100 → 100, 100>=100 → 50
        // Slime: base(50) — 50>=100? no
        const heroActions = result.filter(a => a.id === 'p1');
        expect(heroActions.length).toBe(3);
        expect(heroActions[0].actionNumber).toBe(1);
        expect(heroActions[1].actionNumber).toBe(2);
        expect(heroActions[2].actionNumber).toBe(3);
    });

    it('returns single action per participant when speeds are equal', () => {
        const participants = [
            { type: 'player', id: 'p1', name: 'Hero', speed: 80, entity: {} },
            { type: 'enemy', id: 'e1', name: 'Bat', speed: 80, entity: {} },
        ];
        const result = calculateActionOrderCore(participants);
        // minSpeed=80, each participant: 80>=160? no → 1 action each
        expect(result.length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleDOTCore
// ─────────────────────────────────────────────────────────────────────────────
describe('handleDOTCore', () => {
    it('adds a dot buff with correct duration and damage', () => {
        const enemy = { name: 'Goblin', buffs: [] };
        const log = [];
        handleDOTCore(['3', '15'], enemy, log);
        expect(enemy.buffs).toHaveLength(1);
        expect(enemy.buffs[0]).toMatchObject({
            type: 'dot', value: 15, duration: 3, isPositive: false,
        });
    });

    it('pushes a log message with damage and duration', () => {
        const enemy = { name: 'Goblin', buffs: [] };
        const log = [];
        handleDOTCore(['2', '10'], enemy, log);
        expect(log).toHaveLength(1);
        expect(log[0]).toContain('10');
        expect(log[0]).toContain('2');
    });

    it('initializes buffs array if missing', () => {
        const enemy = { name: 'Skeleton' };
        const log = [];
        handleDOTCore(['1', '20'], enemy, log);
        expect(enemy.buffs).toBeDefined();
        expect(enemy.buffs).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleHealOverTimeCore
// ─────────────────────────────────────────────────────────────────────────────
describe('handleHealOverTimeCore', () => {
    it('adds a healOverTime buff to the array', () => {
        const buffs = [];
        const log = [];
        handleHealOverTimeCore(['3', '10'], buffs, log);
        expect(buffs).toHaveLength(1);
        expect(buffs[0]).toMatchObject({
            type: 'healOverTime', value: 10, duration: 3, isPositive: true,
        });
    });

    it('pushes a log message', () => {
        const buffs = [];
        const log = [];
        handleHealOverTimeCore(['2', '25'], buffs, log);
        expect(log).toHaveLength(1);
        expect(log[0]).toContain('25');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handlePermanentShieldCore
// ─────────────────────────────────────────────────────────────────────────────
describe('handlePermanentShieldCore', () => {
    it('initializes shield and maxShield on first use', () => {
        const target = { name: 'Hero' };
        const log = [];
        handlePermanentShieldCore(['100'], target, log);
        expect(target.maxShield).toBe(100);
        expect(target.shield).toBe(100);
    });

    it('refills shield to maxShield when called again', () => {
        const target = { name: 'Hero', shield: 30, maxShield: 100 };
        const log = [];
        handlePermanentShieldCore(['200'], target, log);
        // maxShield is already set (100), only refills
        expect(target.maxShield).toBe(100);
        expect(target.shield).toBe(100);
    });

    it('uses custom targetName in log', () => {
        const target = { name: 'Hero' };
        const log = [];
        handlePermanentShieldCore(['50'], target, log, '你');
        expect(log[0]).toContain('你');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleTemporaryShieldCore
// ─────────────────────────────────────────────────────────────────────────────
describe('handleTemporaryShieldCore', () => {
    it('initializes tempShield to 0 then adds value', () => {
        const target = { name: 'Hero' };
        const log = [];
        handleTemporaryShieldCore(['50'], target, log);
        expect(target.tempShield).toBe(50);
    });

    it('accumulates tempShield on repeated calls', () => {
        const target = { name: 'Hero' };
        const log = [];
        handleTemporaryShieldCore(['30'], target, log);
        handleTemporaryShieldCore(['20'], target, log);
        expect(target.tempShield).toBe(50);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleShieldOverTimeCore
// ─────────────────────────────────────────────────────────────────────────────
describe('handleShieldOverTimeCore', () => {
    it('creates a new shieldOverTime buff', () => {
        const buffs = [];
        const log = [];
        handleShieldOverTimeCore(['3', '15'], buffs, log);
        expect(buffs).toHaveLength(1);
        expect(buffs[0]).toMatchObject({
            type: 'shieldOverTime', value: 15, duration: 3, isPositive: true,
        });
    });

    it('merges with existing shieldOverTime buff (stacks value, keeps max duration)', () => {
        const buffs = [{ type: 'shieldOverTime', value: 15, duration: 2 }];
        const log = [];
        handleShieldOverTimeCore(['5', '10'], buffs, log);
        expect(buffs).toHaveLength(1);
        expect(buffs[0].value).toBe(25); // 15+10
        expect(buffs[0].duration).toBe(5); // max(2, 5)
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasDebuff
// ─────────────────────────────────────────────────────────────────────────────
describe('hasDebuff', () => {
    it('returns true when debuff is present with turns > 0', () => {
        const entity = { buffs: [{ type: 'stun', turns: 2 }] };
        expect(hasDebuff(entity, 'stun')).toBe(true);
    });

    it('returns false when debuff turns is 0 (expired)', () => {
        const entity = { buffs: [{ type: 'stun', turns: 0 }] };
        expect(hasDebuff(entity, 'stun')).toBe(false);
    });

    it('returns true when debuff has undefined turns (permanent)', () => {
        const entity = { buffs: [{ type: 'freeze' }] };
        expect(hasDebuff(entity, 'freeze')).toBe(true);
    });

    it('returns false when no buffs exist', () => {
        const entity = {};
        expect(hasDebuff(entity, 'stun')).toBe(false);
    });

    it('returns false when debuff type does not match', () => {
        const entity = { buffs: [{ type: 'burn', turns: 3 }] };
        expect(hasDebuff(entity, 'stun')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectTargets
// ─────────────────────────────────────────────────────────────────────────────
describe('selectTargets', () => {
    it('returns up to count alive enemies', () => {
        const enemies = [
            { id: 'e1', hp: 100 },
            { id: 'e2', hp: 50 },
            { id: 'e3', hp: 80 },
        ];
        const result = selectTargets(enemies, 2);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('e1');
        expect(result[1].id).toBe('e2');
    });

    it('skips dead enemies (hp <= 0)', () => {
        const enemies = [
            { id: 'e1', hp: 0 },
            { id: 'e2', hp: 50 },
            { id: 'e3', hp: 80 },
        ];
        const result = selectTargets(enemies, 2);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('e2');
        expect(result[1].id).toBe('e3');
    });

    it('returns fewer than count if not enough alive', () => {
        const enemies = [
            { id: 'e1', hp: 0 },
            { id: 'e2', hp: 0 },
            { id: 'e3', hp: 10 },
        ];
        const result = selectTargets(enemies, 3);
        expect(result).toHaveLength(1);
    });

    it('returns empty array when all enemies are dead', () => {
        const enemies = [
            { id: 'e1', hp: 0 },
            { id: 'e2', hp: -10 },
        ];
        const result = selectTargets(enemies, 2);
        expect(result).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyDamageToEnemy
// ─────────────────────────────────────────────────────────────────────────────
describe('applyDamageToEnemy', () => {
    it('absorbs damage with tempShield first, then shield, then HP', () => {
        const enemy = { name: 'Boss', hp: 200, maxHp: 200, tempShield: 30, shield: 50 };
        const log = [];
        applyDamageToEnemy(enemy, 100, log, 'Hero', 'Sword', false);
        // tempShield absorbs 30 → remaining 70
        // shield absorbs 50 → remaining 20
        // HP absorbs 20 → HP = 180
        expect(enemy.tempShield).toBe(0);
        expect(enemy.shield).toBe(0);
        expect(enemy.hp).toBe(180);
    });

    it('clamps HP to 0 minimum', () => {
        const enemy = { name: 'Slime', hp: 10, maxHp: 100 };
        const log = [];
        applyDamageToEnemy(enemy, 50, log, 'Hero', 'Axe', false);
        expect(enemy.hp).toBe(0);
    });

    it('leaves shields intact when damage is less than tempShield', () => {
        const enemy = { name: 'Guard', hp: 100, maxHp: 100, tempShield: 50, shield: 30 };
        const log = [];
        applyDamageToEnemy(enemy, 20, log, 'Hero', 'Bow', false);
        expect(enemy.tempShield).toBe(30);
        expect(enemy.shield).toBe(30);
        expect(enemy.hp).toBe(100);
    });

    it('skips shield absorption when no shields exist', () => {
        const enemy = { name: 'Wolf', hp: 80, maxHp: 100 };
        const log = [];
        applyDamageToEnemy(enemy, 25, log, 'Hero', 'Dagger', true);
        expect(enemy.hp).toBe(55);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// healCore
// ─────────────────────────────────────────────────────────────────────────────
describe('healCore', () => {
    it('heals normally on non-crit', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // critRoll=99, won't crit
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', hp: 50, maxHp: 100 } };
        const weapon = { attack: 30, critRate: 10 };
        const playerStats = { baseCritMultiplier: 2.0 };
        const log = [];

        const result = healCore(target, weapon, playerStats, log);

        expect(target.entity.hp).toBe(80);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'heal', heal: 30, isCrit: false });
        expect(log[0]).toContain('30');
    });

    it('applies crit multiplier on crit roll', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0); // critRoll=0, always crits
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', hp: 50, maxHp: 200 } };
        const weapon = { attack: 40, critRate: 50 };
        const playerStats = { baseCritMultiplier: 2.0 };
        const log = [];

        const result = healCore(target, weapon, playerStats, log);

        // healAmount = floor(40 * 2.0) = 80
        expect(target.entity.hp).toBe(130);
        expect(result[0].heal).toBe(80);
        expect(result[0].isCrit).toBe(true);
        expect(log[0]).toContain('暴击');
    });

    it('caps heal at maxHp', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', hp: 90, maxHp: 100 } };
        const weapon = { attack: 50, critRate: 0 };
        const playerStats = { baseCritMultiplier: 2.0 };
        const log = [];

        const result = healCore(target, weapon, playerStats, log);

        expect(target.entity.hp).toBe(100);
        expect(result[0].heal).toBe(10); // actual heal, not weapon.attack
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// manaRestoreCore
// ─────────────────────────────────────────────────────────────────────────────
describe('manaRestoreCore', () => {
    it('restores mana normally on non-crit', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', mp: 20, maxMp: 100 } };
        const weapon = { attack: 25, critRate: 10 };
        const playerStats = { baseCritMultiplier: 2.0 };
        const log = [];

        const result = manaRestoreCore(target, weapon, playerStats, log);

        expect(target.entity.mp).toBe(45);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'manaRestore', restore: 25, isCrit: false });
    });

    it('applies crit multiplier on crit', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', mp: 0, maxMp: 200 } };
        const weapon = { attack: 30, critRate: 50 };
        const playerStats = { baseCritMultiplier: 2.5 };
        const log = [];

        const result = manaRestoreCore(target, weapon, playerStats, log);

        // manaAmount = floor(30 * 2.5) = 75
        expect(target.entity.mp).toBe(75);
        expect(result[0].restore).toBe(75);
        expect(result[0].isCrit).toBe(true);
        expect(log[0]).toContain('暴击');
    });

    it('caps mana restore at maxMp', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const target = { type: 'player', entity: { id: 'p1', name: 'Hero', mp: 90, maxMp: 100 } };
        const weapon = { attack: 40, critRate: 0 };
        const playerStats = { baseCritMultiplier: 2.0 };
        const log = [];

        const result = manaRestoreCore(target, weapon, playerStats, log);

        expect(target.entity.mp).toBe(100);
        expect(result[0].restore).toBe(10); // actual restore capped
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// sacrificeBoostCore
// ─────────────────────────────────────────────────────────────────────────────
describe('sacrificeBoostCore', () => {
    it('reduces player HP by floor(hp*0.25), minimum 1', () => {
        const player = { name: 'Hero', hp: 100 };
        const weapon = { attack: 60, hitRate: 80, critRate: 15, attacksPerTurn: 2, targetsPerAttack: 1, name: 'Blood Blade' };
        const log = [];

        const result = sacrificeBoostCore(player, weapon, log);

        const sacrificeDamage = Math.floor(100 * 0.25); // 25 (25% HP per §5.3)
        expect(player.hp).toBe(75);
        expect(result[0]).toMatchObject({ type: 'sacrificeDamage', damage: sacrificeDamage });
    });

    it('clamps HP to minimum 1 when sacrifice exceeds current HP', () => {
        const player = { name: 'Hero', hp: 1 };
        const weapon = { attack: 100, hitRate: 80, critRate: 15, attacksPerTurn: 2, targetsPerAttack: 1, name: 'Great Sword' };
        const log = [];

        sacrificeBoostCore(player, weapon, log);

        expect(player.hp).toBe(1); // max(1, 1 - floor(1*0.25)) = max(1, 1-0) = 1
    });

    it('sets sacrificeBoostActive with weapon fields', () => {
        const player = { name: 'Hero', hp: 100 };
        const weapon = { attack: 40, hitRate: 90, critRate: 20, attacksPerTurn: 3, targetsPerAttack: 2, name: 'Blood Axe' };
        const log = [];

        const result = sacrificeBoostCore(player, weapon, log);

        expect(player.sacrificeBoostActive).toMatchObject({
            attack: 40,
            hitRate: 90,
            critRate: 20,
            attacksPerTurn: 3,
            targetsPerAttack: 2,
            weaponName: 'Blood Axe',
        });
        // Second instruction is the buff
        expect(result[1]).toMatchObject({ type: 'buff', buffType: 'sacrificeBoost' });
    });

    it('pushes appropriate log messages', () => {
        const player = { name: 'Hero', hp: 100 };
        const weapon = { attack: 40, hitRate: 90, critRate: 20, attacksPerTurn: 1, targetsPerAttack: 1, name: 'Blood Sword' };
        const log = [];

        sacrificeBoostCore(player, weapon, log);

        // Should have 4 log entries: use, sacrifice, gain buff, buff details
        expect(log.length).toBeGreaterThanOrEqual(3);
        expect(log[0]).toContain('牺牲增益');
        expect(log[1]).toContain('牺牲');
        expect(log.some(m => m.includes('增益效果'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// processEnchantmentEffectsCore
// ─────────────────────────────────────────────────────────────────────────────
describe('processEnchantmentEffectsCore', () => {
    it('returns empty result when weapon has no codes', () => {
        const weapon = { attack: 50 };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, false, log, player, []);
        expect(result.totalExtraDamage).toBe(0);
        expect(result.instructions).toEqual([]);
    });

    it('returns empty result when weapon.codes is empty array', () => {
        const weapon = { attack: 50, codes: [] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, false, log, player, []);
        expect(result.totalExtraDamage).toBe(0);
        expect(result.instructions).toEqual([]);
    });

    it('B5 DoT: applies dot buff to enemy', () => {
        const weapon = { attack: 50, codes: ['EN:B5,3,15'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, false, log, player, []);
        expect(enemy.buffs).toHaveLength(1);
        expect(enemy.buffs[0]).toMatchObject({ type: 'dot', value: 15, duration: 3, isPositive: false });
        expect(result.totalExtraDamage).toBe(0);
    });

    it('B1 lifesteal: heals player based on damage dealt', () => {
        const weapon = { attack: 50, codes: ['EN:B1,50'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 150, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 100, false, log, player, []);
        // healAmount = floor(100 * 50/100) = 50; player hp: 150+50 = 200
        expect(player.hp).toBe(200);
        expect(result.instructions).toHaveLength(1);
        expect(result.instructions[0]).toMatchObject({ type: 'heal', targetId: 'player', heal: 50 });
        expect(log.some(m => m.includes('生命窃取'))).toBe(true);
    });

    it('B1 lifesteal: caps heal at maxHp', () => {
        const weapon = { attack: 50, codes: ['EN:B1,50'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 190, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 100, false, log, player, []);
        // healAmount = floor(100 * 0.5) = 50, but capped: 190+50=240 → 200
        expect(player.hp).toBe(200);
        expect(result.instructions[0].heal).toBe(10); // actual heal
    });

    it('B4 crit freeze: applies stun on crit hit', () => {
        const weapon = { attack: 50, codes: ['EN:B4,3'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, true, log, player, []);
        expect(enemy.pendingFreeze).toBe(true);
        expect(enemy.pendingFreezeCount).toBe(3);
        expect(enemy.buffs).toHaveLength(1);
        expect(enemy.buffs[0]).toMatchObject({ type: 'stun', turns: 3, duration: 3, isPositive: false });
        expect(log.some(m => m.includes('晕眩'))).toBe(true);
    });

    it('B4 crit freeze: does NOT trigger on non-crit', () => {
        const weapon = { attack: 50, codes: ['EN:B4,3'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, false, log, player, []);
        expect(enemy.pendingFreeze).toBeUndefined();
        expect(enemy.buffs).toHaveLength(0);
    });

    it('ignores non-EN codes', () => {
        const weapon = { attack: 50, codes: ['MN:M1,50', 'XX:invalid'] };
        const enemy = { name: 'Goblin', hp: 100, maxHp: 100, buffs: [] };
        const player = { name: 'Hero', hp: 200, maxHp: 200 };
        const log = [];
        const result = processEnchantmentEffectsCore(weapon, enemy, 50, false, log, player, []);
        expect(result.totalExtraDamage).toBe(0);
        expect(result.instructions).toEqual([]);
    });
});
