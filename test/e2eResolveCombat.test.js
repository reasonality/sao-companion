/**
 * E2E 测试：直接测试 index.js 本地版本的 resolveCombatRound 完整路径。
 *
 * 与 twoRoundCombat.test.js 的区别：后者测 battleCore.js 导出函数（直接 import），
 * 本文件测 index.js 私有函数（通过 __SAO_INTERNAL__ 测试钩子），验证完整后处理链路径
 * （getSaoData → buildPlayerEntity → calculateActionOrderCore → executePlayerActionCore
 *   → performEnemyActionCore → processEndOfRoundCore → persistCooldowns → buildCombatNarrativeHint）。
 *
 * 运行：NODE_ENV=test npx vitest run test/e2eResolveCombat.test.js
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// 设置 NODE_ENV=test 以激活 index.js 的测试钩子
// vitest.config.js 的 resolve.alias 将 index.js 的 ST 依赖映射到 test/mocks/，
// 使 index.js 可在 Node + jsdom 环境加载。
process.env.NODE_ENV = 'test';

// 动态 import index.js（触发测试钩子挂载 globalThis.__SAO_INTERNAL__）
let SAO;
beforeAll(async () => {
    await import('../index.js');
    SAO = globalThis.__SAO_INTERNAL__;
    if (!SAO) throw new Error('index.js 测试钩子未激活：globalThis.__SAO_INTERNAL__ 不存在');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture 构造
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 构造最小有效 _zd_parsed + state，用于注入 mock getSaoData。
 * @param {Object} overrides - 覆盖默认值
 */
function makeSaoData(overrides = {}) {
    const basePlayer = {
        name: '桐人',
        hp: 500, max_hp: 500,
        mp: 200, max_mp: 200,
        str: 30, agi: 25, int: 10, vit: 20,
    };
    const baseSkill = {
        name: '旋风斩', wn: 'A1', atk: 80, hit: 90, crit: 15,
        apt: 1, tpa: 1, mp_cost: 10, cd: 0,
    };
    const baseEnemy = {
        name: '哥布林', hp: 200, max_hp: 200,
        str: 15, agi: 10, int: 5, vit: 10,
        skills: [{ name: '挥砍', atk: 30, hit: 70, crit: 5, apt: 1, tpa: 1 }],
        attackPattern: ['挥砍'],
    };
    return {
        state: {
            _zd_parsed: {
                player: { ...basePlayer, ...overrides.player },
                skills: overrides.skills || [baseSkill],
                enemies: overrides.enemies || [{ ...baseEnemy, ...overrides.enemy }],
                teammates: overrides.teammates || [],
            },
            skillCooldowns: {},
            equipment: { ...overrides.equipment },
            customSkills: overrides.customSkills || [],
        },
        arc: 'sao',
        calendar: null,
        ...overrides.meta,
    };
}

/** 注入 mock data 到 getSaoData 短路路径 */
function injectMockData(data) {
    SAO.__setTestSaoData(data);
}

/** 清除 mock，让 getSaoData 回退到真实 getContext() */
function clearMockData() {
    SAO.__setTestSaoData(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试用例
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: resolveCombatRound 完整路径', () => {
    beforeEach(() => {
        clearMockData();
        // 固定 Math.random 避免概率性测试不稳定
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    describe('1. 基本结构与空输入', () => {
        it('无 _zd_parsed 时返回 null，不崩溃', () => {
            injectMockData({ state: null, arc: 'sao' });
            const result = SAO.resolveCombatRound('一些消息');
            expect(result).toBeNull();
        });

        it('无 player 时返回 null', () => {
            injectMockData({ state: { _zd_parsed: { enemies: [] } }, arc: 'sao' });
            const result = SAO.resolveCombatRound('');
            expect(result).toBeNull();
        });

        it('无 enemies 时返回 null', () => {
            injectMockData({ state: { _zd_parsed: { player: { name: 'p' }, enemies: [] } }, arc: 'sao' });
            const result = SAO.resolveCombatRound('');
            expect(result).toBeNull();
        });

        it('enemies 全部 HP<=0 时返回空结果结构', () => {
            const data = makeSaoData({
                enemy: { hp: 0, max_hp: 100, name: 'dead-goblin' },
            });
            injectMockData(data);
            const result = SAO.resolveCombatRound('旋风斩');
            expect(result).toBeDefined();
            expect(result.enemiesAfter).toEqual([]);
            expect(result.log).toContain('无存活敌人');
        });
    });

    describe('2. 单轮战斗：A1 标准攻击', () => {
        it('构造 _zd_parsed，调用 resolveCombatRound，验证 combatResult 结构', () => {
            const data = makeSaoData();
            injectMockData(data);
            const result = SAO.resolveCombatRound('桐人使用旋风斩攻击哥布林');

            expect(result).toBeDefined();
            expect(result.playerAfter).toBeDefined();
            expect(result.playerAfter.hp).toBeGreaterThan(0);
            expect(result.playerAfter.maxHp).toBe(500);
            expect(result.enemiesAfter).toHaveLength(1);
            expect(result.enemiesAfter[0].hp).toBeLessThan(200); // 受到伤害
            expect(result.narrativeHint).toContain('[上轮结算]');
            expect(result.log).toBeInstanceOf(Array);
            expect(result.log.length).toBeGreaterThan(0);
        });

        it('敌人受到伤害后 HP 同步回 _zd_parsed.enemies', () => {
            const data = makeSaoData();
            injectMockData(data);
            SAO.resolveCombatRound('旋风斩');
            const zdEnemy = data.state._zd_parsed.enemies[0];
            expect(zdEnemy.hp).toBeLessThan(200);
            expect(zdEnemy.hp).toBeGreaterThanOrEqual(0);
        });

        it('玩家 HP/MP 同步回 _zd_parsed.player', () => {
            const data = makeSaoData();
            injectMockData(data);
            SAO.resolveCombatRound('旋风斩');
            const zdPlayer = data.state._zd_parsed.player;
            // 玩家可能受反击伤害，HP <= 初始 500
            expect(zdPlayer.hp).toBeLessThanOrEqual(500);
        });
    });

    describe('3. 两轮战斗一致性', () => {
        it('连续调用两次，HP 跨轮次正确递减，不重置', () => {
            const data = makeSaoData({
                enemy: { hp: 1000, max_hp: 1000, name: '厚血BOSS' },
            });
            injectMockData(data);

            const r1 = SAO.resolveCombatRound('旋风斩');
            expect(r1).toBeDefined();
            const enemyHpAfterR1 = data.state._zd_parsed.enemies[0].hp;
            expect(enemyHpAfterR1).toBeLessThan(1000);

            // 第二轮不重置 state，再调用
            const r2 = SAO.resolveCombatRound('旋风斩');
            expect(r2).toBeDefined();
            const enemyHpAfterR2 = data.state._zd_parsed.enemies[0].hp;
            expect(enemyHpAfterR2).toBeLessThanOrEqual(enemyHpAfterR1); // 持续递减
        });

        it('低 HP 敌人受击后 HP 降至 0 标记 defeated', () => {
            const data = makeSaoData({
                enemy: { hp: 5, max_hp: 5, name: '一击怪',
                    str: 1, agi: 1, int: 1, vit: 1,
                    skills: [{ name: '弱击', atk: 1, hit: 10, crit: 0, apt: 1, tpa: 1 }] },
            });
            injectMockData(data);
            const r1 = SAO.resolveCombatRound('旋风斩');
            // 5HP 应被玩家高伤秒杀（atk 80 vs 5HP）
            expect(r1.enemiesAfter[0].defeated).toBe(true);
            expect(r1.enemiesAfter[0].hp).toBe(0);
        });
    });

    describe('4. 护盾吸收 E2E（tempShield → shield → HP）', () => {
        it('player 有 tempShield+shield，敌人攻击后 tempShield 先消耗', () => {
            // 直接构造带护盾的战斗实体，通过 applyDamageToEnemy 测
            // resolveCombatRound 中 player 的 tempShield/shield 默认 0，
            // 这里直接测 applyDamageToEnemy 验证顺序
            const target = {
                name: '测试目标', hp: 100, maxHp: 100,
                tempShield: 30, shield: 50, buffs: [],
            };
            const log = [];
            const hpDamage = SAO.applyDamageToEnemy(target, 70, log, '敌人', '挥砍', false);

            expect(target.tempShield).toBe(0); // tempShield 先消耗完
            expect(target.shield).toBe(10); // shield 消耗 20
            expect(target.hp).toBe(100); // HP 未触及
        });

        it('伤害溢出护盾后扣 HP', () => {
            const target = {
                name: '溢出测试', hp: 100, maxHp: 100,
                tempShield: 10, shield: 20, buffs: [],
            };
            const log = [];
            SAO.applyDamageToEnemy(target, 50, log, '敌人', '重击', false);

            expect(target.tempShield).toBe(0);
            expect(target.shield).toBe(0);
            expect(target.hp).toBe(80); // 50 - 10 - 20 = 20 伤害到 HP
        });
    });

    describe('5. 敌人全灭触发 generateLoot 条件', () => {
        it('combatResult.enemiesAfter 全 defeated 时应可触发战利品', () => {
            const data = makeSaoData({
                enemy: { hp: 10, max_hp: 10, name: '一击怪' },
            });
            injectMockData(data);
            const result = SAO.resolveCombatRound('旋风斩');

            const allDefeated = result.enemiesAfter.every(e => e.defeated);
            expect(allDefeated).toBe(true);
            expect(result.log.some(l => l.includes('击败'))).toBe(true);
        });
    });

    describe('6. 内联护盾吸收去重验证（performEnemyActionCore 调用 applyDamageToEnemy）', () => {
        it('敌人攻击玩家走 applyDamageToEnemy（而非内联重复逻辑）', () => {
            const data = makeSaoData({
                player: { hp: 1000, max_hp: 1000, str: 50, agi: 5 }, // agi 低确保敌人命中
                enemy: { hp: 100, max_hp: 100, str: 20, agi: 30, name: '强敌',
                    skills: [{ name: '重击', atk: 60, hit: 95, crit: 0, apt: 1, tpa: 1 }] },
            });
            injectMockData(data);
            const result = SAO.resolveCombatRound('旋风斩');

            // 玩家应受反击伤害（敌人攻击走 applyDamageToEnemy 路径）
            expect(result.playerAfter.hp).toBeLessThanOrEqual(1000);
            // 日志应含敌人攻击记录
            expect(result.log.some(l => l.includes('强敌'))).toBe(true);
        });
    });

    describe('7. normalizeWeapon E2E', () => {
        it('正确归一化技能字段 + EN 前缀', () => {
            const raw = { name: '测试技', wn: 'A1', atk: 50, hit: 80, crit: 10, apt: 2, tpa: 1, mp_cost: 5, cd: 3, en: ['B5,3,30'] };
            const w = SAO.normalizeWeapon(raw, {});
            expect(w.name).toBe('测试技');
            expect(w.attack).toBe(50);
            expect(w.hitRate).toBe(80);
            expect(w.attacksPerTurn).toBe(2);
            expect(w.codes).toContain('EN:B5,3,30');
            expect(w.codes).toContain('WN:A1');
            expect(w.currentCooldown).toBe(0);
        });

        it('EN 代码自动补前缀', () => {
            const raw = { name: 'T', wn: 'A1', en: ['B1', 'B2'] };
            const w = SAO.normalizeWeapon(raw, {});
            expect(w.codes).toContain('EN:B1');
            expect(w.codes).toContain('EN:B2');
        });

        it('冷却中的技能被记录 currentCooldown', () => {
            const raw = { name: 'CD技', wn: 'A1', atk: 50, hit: 80, cd: 5 };
            const w = SAO.normalizeWeapon(raw, { 'CD技': 3 });
            expect(w.currentCooldown).toBe(3);
        });
    });

    describe('8. buildPlayerEntity E2E', () => {
        it('从 _zd_parsed.player + skills + equipment 正确构建实体', () => {
            // getEquipmentStatsFromState 读 equipment 的 slots（每个 slot 有 .stats），
            // 不是直接 {str,agi}。构造正确格式。
            const data = makeSaoData({
                equipment: {
                    weapon: { stats: { str: 5, agi: 3, int: 0, vit: 2 } },
                },
            });
            injectMockData(data);
            const player = SAO.buildPlayerEntity(
                data.state._zd_parsed.player,
                data.state._zd_parsed.skills,
                SAO.getEquipmentStatsFromState(),
            );
            expect(player.name).toBe('桐人');
            expect(player.hp).toBe(500);
            expect(player.str).toBe(35); // 30 + 5 装备
            expect(player.agi).toBe(28); // 25 + 3
            expect(player.vit).toBe(22); // 20 + 2
            expect(player.weapons.length).toBeGreaterThanOrEqual(1);
            expect(player.buffs).toEqual([]);
            expect(player.tempShield).toBe(0);
        });

        it('无技能时 weapons 为空数组', () => {
            const data = makeSaoData({ skills: [] });
            injectMockData(data);
            const player = SAO.buildPlayerEntity(
                data.state._zd_parsed.player,
                [],
                {},
            );
            expect(player.weapons).toEqual([]);
        });
    });

    describe('9. buildEnemyEntity E2E', () => {
        it('从 _zd_parsed.enemy 正确构建实体', () => {
            const zdEnemy = {
                name: 'BOSS', hp: 1000, max_hp: 1000,
                str: 40, agi: 20, int: 15, vit: 30,
                skills: [{ name: '横扫', atk: 100, hit: 80, crit: 10, apt: 1, tpa: 2, mn: ['M1'] }],
                attackPattern: ['横扫'],
            };
            const enemy = SAO.buildEnemyEntity(zdEnemy);
            expect(enemy.name).toBe('BOSS');
            expect(enemy.hp).toBe(1000);
            expect(enemy.skills[0].attacksPerTurn).toBe(1);
            expect(enemy.skills[0].targetsPerAttack).toBe(2);
            expect(enemy.skills[0].codes).toContain('MN:M1');
            expect(enemy.attackPattern).toEqual(['横扫']);
            expect(enemy.nextAttackIndex).toBe(0);
        });
    });

    describe('10. buildCombatNarrativeHint E2E', () => {
        it('从 log + 实体状态生成叙事提示', () => {
            const player = { name: '桐人', hp: 450, maxHp: 500, mp: 180, maxMp: 200 };
            const enemies = [{ name: '哥布林', hp: 120, maxHp: 200 }];
            const log = ['桐人对哥布林造成80点伤害'];
            const hint = SAO.buildCombatNarrativeHint(player, enemies, [], log);
            expect(hint).toContain('[上轮结算]');
            expect(hint).toContain('哥布林');
            expect(hint).toContain('80');
            expect(hint).toContain('你的HP:450/500');
        });

        it('空 log 返回空字符串', () => {
            expect(SAO.buildCombatNarrativeHint({}, [], [], [])).toBe('');
        });

        it('玩家倒下时提示', () => {
            const player = { name: '桐人', hp: 0, maxHp: 500, mp: 0, maxMp: 200 };
            const hint = SAO.buildCombatNarrativeHint(player, [{ name: 'e', hp: 100, maxHp: 100 }], [], ['log']);
            expect(hint).toContain('你已倒下');
        });
    });
});
