// battle/battleCore.js — B-class Core functions extracted from battleLogic.js
// Pure logic, no DOM, no battleState singleton. Uses log array for output.
// Extracted in P4a per SAO_COMPANION_2_AGENT_ARCHITECTURE.md §5.9
import {
    calculateDerivedStats,
    calculateFinalHitRate,
    calculateFinalCritRate,
    calculateFinalCritMultiplier,
    calculateFinalDamage,
    getTeammateActualStats,
    getEnemyActualStats,
    applyStatBuffs,
} from './battleMath.js';

/**
 * getPlayerStatsCore — Pure version of getPlayerActualStats
 * @param {Object} player - Base player stats {str, agi, int, vit}
 * @param {Array} playerBuffs - Active buffs array [{type, value}, ...]
 * @param {Object} equipmentStats - Equipment bonuses {str, agi, int, vit, max_hp} (optional)
 * @returns {Object} Computed stats {str, agi, int, end, hpRegen, mpRegen, actionPoints, speed, ...}
 */
export function getPlayerStatsCore(player, playerBuffs, equipmentStats) {
    const base = {
        str: (player.str || 0) + (equipmentStats?.str || 0),
        agi: (player.agi || 0) + (equipmentStats?.agi || 0),
        int: (player.int || 0) + (equipmentStats?.int || 0),
        end: (player.vit || 0) + (equipmentStats?.vit || 0),
    };

    applyStatBuffs(base, playerBuffs);

    const derivedStats = calculateDerivedStats(base.str, base.agi, base.int, base.end);
    return {
        str: base.str,
        agi: base.agi,
        int: base.int,
        end: base.end,
        hpRegen: derivedStats.hpRegen,
        mpRegen: derivedStats.mpRegen,
        actionPoints: derivedStats.actionPoints,
        speed: derivedStats.speed,
        evasionRate: derivedStats.evasionRate,
        damageBonus: derivedStats.damageBonus,
        physicalReduction: derivedStats.physicalReduction,
        damageTakenRate: derivedStats.damageTakenRate,
        extraHitRate: derivedStats.extraHitRate,
        extraCritRate: derivedStats.extraCritRate,
        baseCritMultiplier: derivedStats.baseCritMultiplier,
        critRateResistance: derivedStats.critRateResistance,
        critDamageResistance: derivedStats.critDamageResistance,
    };
}

/**
 * calculateActionOrderCore — Pure version of calculateActionOrder
 * @param {Array} participants - Array of {type, id, name, speed, entity}
 * @returns {Array} Sorted action pool with actionNumber assigned
 */
export function calculateActionOrderCore(participants) {
    const minSpeed = Math.min(...participants.map(p => p.speed));
    const actionPool = [];

    participants.forEach(participant => {
        actionPool.push({
            type: participant.type,
            id: participant.id,
            name: participant.name,
            entity: participant.entity,
            speed: participant.speed,
            actionNumber: 1,
        });

        let extraActionCount = 1;
        let currentSpeed = participant.speed;
        while (currentSpeed >= minSpeed * 2) {
            currentSpeed = Math.floor(currentSpeed / 2);
            extraActionCount++;
            actionPool.push({
                type: participant.type,
                id: participant.id,
                name: participant.name,
                entity: participant.entity,
                speed: currentSpeed,
                actionNumber: extraActionCount,
            });
        }
    });

    actionPool.sort((a, b) => b.speed - a.speed);
    return actionPool;
}

/**
 * handleDOTCore — Pure version of handleDOT
 * @param {Array} params - [duration, damage]
 * @param {Object} enemy - Enemy entity to apply DoT to
 * @param {Array} log - Log array to push messages to
 */
export function handleDOTCore(params, enemy, log) {
    const duration = parseInt(params[0]);
    const damage = parseInt(params[1]);
    enemy.buffs = enemy.buffs || [];
    enemy.buffs.push({
        name: '持续伤害',
        type: 'dot',
        value: damage,
        duration: duration,
        isPositive: false,
    });
    log.push(`持续伤害效果触发！${enemy.name} 将在 ${duration} 回合内每回合受到 ${damage} 点伤害！`);
}

/**
 * handleHealOverTimeCore — Pure version of handleHealOverTime
 * @param {Array} params - [duration, heal]
 * @param {Array} buffsArray - Buffs array to add HoT buff to
 * @param {Array} log - Log array to push messages to
 */
export function handleHealOverTimeCore(params, buffsArray, log) {
    const duration = parseInt(params[0]);
    const heal = parseInt(params[1]);
    buffsArray.push({
        name: '持续恢复',
        type: 'healOverTime',
        value: heal,
        duration: duration,
        isPositive: true,
    });
    log.push(`持续恢复效果触发！将在 ${duration} 回合内每回合恢复 ${heal} 点生命值！`);
}

/**
 * handlePermanentShieldCore — Pure version of handlePermanentShield
 * @param {Array} params - [shieldValue]
 * @param {Object} target - Target entity to apply shield to
 * @param {Array} log - Log array to push messages to
 * @param {string} targetName - Display name for log (optional, defaults to target.name)
 */
export function handlePermanentShieldCore(params, target, log, targetName) {
    const shieldValue = parseInt(params[0]);
    const name = targetName || target.name || '未知';

    if (!target.shield) {
        target.shield = 0;
        target.maxShield = shieldValue;
    }

    target.shield = target.maxShield;
    log.push(`${name}的固化护盾触发！护盾值恢复至 ${target.maxShield} 点！`);
}

/**
 * handleTemporaryShieldCore — Pure version of handleTemporaryShield
 * @param {Array} params - [shieldValue]
 * @param {Object} target - Target entity to apply shield to
 * @param {Array} log - Log array to push messages to
 * @param {string} targetName - Display name for log (optional, defaults to target.name)
 */
export function handleTemporaryShieldCore(params, target, log, targetName) {
    const shieldValue = parseInt(params[0]);
    const name = targetName || target.name || '未知';

    if (!target.tempShield) {
        target.tempShield = 0;
    }

    target.tempShield += shieldValue;
    log.push(`${name}的瞬发护盾触发！获得 ${shieldValue} 点临时护盾（总计 ${target.tempShield} 点）！`);
}

/**
 * handleShieldOverTimeCore — Pure version of handleShieldOverTime
 * @param {Array} params - [duration, shieldPerRound]
 * @param {Array} buffsArray - Buffs array to add/merge shield buff into
 * @param {Array} log - Log array to push messages to
 * @param {string} targetName - Display name for log (optional, defaults to '未知')
 */
export function handleShieldOverTimeCore(params, buffsArray, log, targetName) {
    const duration = parseInt(params[0]);
    const shieldPerRound = parseInt(params[1]);
    const name = targetName || '未知';

    const existingBuff = buffsArray.find(buff => buff.type === 'shieldOverTime');

    if (existingBuff) {
        existingBuff.value += shieldPerRound;
        existingBuff.duration = Math.max(existingBuff.duration, duration);
        log.push(
            `${name}的护盾持续效果叠加！每回合获得护盾值增加至 ${existingBuff.value} 点，持续 ${existingBuff.duration} 回合！`,
        );
    } else {
        buffsArray.push({
            name: '护盾持续',
            type: 'shieldOverTime',
            value: shieldPerRound,
            duration: duration,
            isPositive: true,
        });
        log.push(`${name}的护盾持续效果触发！将在 ${duration} 回合内每回合获得 ${shieldPerRound} 点护盾！`);
    }
}

const STAT_BOOST_MAP = {
    'B11': ['strBoost', '力量', 'str'],
    'B12': ['agiBoost', '敏捷', 'agi'],
    'B13': ['intBoost', '智力', 'int'],
    'B14': ['endBoost', '耐力', 'end'],
};

/**
 * processEnchantmentEffectsCore — Pure version of processEnchantmentEffects
 * Dispatches to handle*Core versions. Uses log array instead of logBattleAction.
 * @param {Object} weapon - Weapon with codes array
 * @param {Object} enemy - Enemy target
 * @param {number} damage - Base damage dealt
 * @param {boolean} isCrit - Whether the hit was critical
 * @param {Array} log - Log array to push messages to
 * @param {Object} player - Player entity (for buffs, shield, etc.)
 * @param {Array} playerBuffs - Player buffs array (for shieldOverTime, etc.)
 * @returns {{ totalExtraDamage: number, instructions: Array }} Total extra damage and UI instructions
 */
export function processEnchantmentEffectsCore(weapon, enemy, damage, isCrit, log, player, playerBuffs) {
    if (!weapon.codes) return { totalExtraDamage: 0, instructions: [] };
    let totalExtraDamage = 0;
    const instructions = [];
    weapon.codes.forEach(code => {
        if (!code.startsWith('EN:B')) return;
        const match = code.match(/EN:(B\d+),(.+)/);
        if (!match) return;
        const effectType = match[1];
        const params = match[2].split(',');
        switch (effectType) {
            case 'B5':
                handleDOTCore(params, enemy, log);
                break;
            case 'B10':
                handleHealOverTimeCore(params, playerBuffs, log);
                break;
            case 'B20':
                handlePermanentShieldCore(params, player, log, '你');
                break;
            case 'B21':
                handleTemporaryShieldCore(params, player, log, '你');
                break;
            case 'B22':
                handleShieldOverTimeCore(params, playerBuffs, log, '你');
                break;
            case 'B1': {
                const percent = parseInt(params[0]);
                const healAmount = Math.floor(damage * (percent / 100));
                if (healAmount > 0) {
                    const oldHp = player.hp;
                    player.hp = Math.min(player.hp + healAmount, player.maxHp);
                    const actualHeal = player.hp - oldHp;
                    if (actualHeal > 0) {
                        log.push(`生命窃取触发！恢复 ${actualHeal} 点生命值！`);
                        instructions.push({ type: 'heal', targetId: 'player', targetName: player.name || 'User', heal: actualHeal });
                    }
                }
                break;
            }
            case 'B2': {
                const duration = parseInt(params[0]);
                const value = parseInt(params[1].replace('%', ''));
                enemy.buffs = enemy.buffs || [];
                enemy.buffs.push({
                    name: '命中降低', type: 'hitRateDown',
                    value, duration, isPositive: false,
                });
                log.push(`命中降低效果触发！${enemy.name} 命中率降低 ${value}% 持续 ${duration} 回合！`);
                break;
            }
            case 'B3': {
                if (isCrit) {
                    const duration = parseInt(params[0]);
                    const value = parseInt(params[1].replace('%', ''));
                    playerBuffs.push({
                        name: '暴击提升', type: 'critBoost',
                        value, duration, isPositive: true,
                    });
                    log.push(`暴击提升效果触发！暴击率提升 ${value}% 持续 ${duration} 回合！`);
                }
                break;
            }
            case 'B4': {
                if (isCrit) {
                    const duration = parseInt(params[0]);
                    enemy.pendingFreeze = true;
                    enemy.pendingFreezeCount = duration;
                    // TECH_DEBT: pendingFreeze 和 buff stun 双轨，待统一
                    // 同时推送 buff-based stun 让 hasDebuff('stun') 也能检测到
                    enemy.buffs = enemy.buffs || [];
                    enemy.buffs.push({ name: '晕眩', type: 'stun', turns: duration, duration, isPositive: false });
                    log.push(`晕眩效果触发！${enemy.name} 将在下次行动时被晕眩！`);
                }
                break;
            }
            // B5 handled above (DoT)
            case 'B6': {
                const chance = parseInt(params[0].replace('%', ''));
                const duration = parseInt(params[1]);
                if (Math.random() * 100 <= chance) {
                    enemy.pendingFreeze = true;
                    enemy.pendingFreezeCount = duration;
                    // TECH_DEBT: pendingFreeze 和 buff stun 双轨，待统一
                    enemy.buffs = enemy.buffs || [];
                    enemy.buffs.push({ name: '晕眩', type: 'stun', turns: duration, duration, isPositive: false });
                    log.push(`几率晕眩触发！${enemy.name} 将在下次行动时被晕眩！`);
                }
                break;
            }
            case 'B7': {
                const chance = parseInt(params[0].replace('%', ''));
                const bonus = parseInt(params[1].replace('%', ''));
                if (Math.random() * 100 <= chance) {
                    const extraDamage = Math.floor(damage * (bonus / 100));
                    log.push(`额外伤害触发！造成额外 ${extraDamage} 点伤害！`);
                    totalExtraDamage += extraDamage;
                }
                break;
            }
            case 'B8': {
                const duration = parseInt(params[0]);
                const bonus = parseInt(params[1].replace('%', ''));
                enemy.buffs = enemy.buffs || [];
                enemy.buffs.push({
                    name: '易伤', type: 'vulnerable',
                    value: bonus, duration, isPositive: false,
                });
                log.push(`易伤效果触发！${enemy.name} 受到伤害增加 ${bonus}% 持续 ${duration} 回合！`);
                break;
            }
            case 'B9': {
                const mp = parseInt(params[0]);
                const oldMp = player.mp;
                player.mp = Math.min(player.mp + mp, player.maxMp);
                const actualRestore = player.mp - oldMp;
                if (actualRestore > 0) {
                    log.push(`法力恢复触发！恢复 ${actualRestore} 点法力值！`);
                }
                break;
            }
            // B10 handled above (HoT)
            case 'B11':
            case 'B12':
            case 'B13':
            case 'B14': {
                const [buffType, label] = STAT_BOOST_MAP[effectType];
                const duration = parseInt(params[0]);
                const value = parseInt(params[1]);
                playerBuffs.push({ name: `${label}提升`, type: buffType, value, duration, isPositive: true });
                log.push(`${label}提升效果触发！${label}+${value} 持续 ${duration} 回合！`);
                break;
            }
            case 'B15': {
                const bonus = parseInt(params[0].replace('%', ''));
                enemy.marks = enemy.marks || {};
                enemy.marks.vulnerability = bonus;
                log.push(`易伤标记施加！${enemy.name} 下次受到攻击将额外承受 ${bonus}% 伤害！`);
                break;
            }
            case 'B16': {
                const bonus = parseInt(params[0].replace('%', ''));
                enemy.marks = enemy.marks || {};
                enemy.marks.weakness = bonus;
                log.push(`破绽标记施加！${enemy.name} 下次受到攻击暴击率额外提升 ${bonus}%！`);
                break;
            }
            case 'B17': {
                const bonus = parseInt(params[0].replace('%', ''));
                enemy.marks = enemy.marks || {};
                enemy.marks.death = bonus;
                log.push(`死点标记施加！${enemy.name} 下次受到攻击暴击伤害额外提升 ${bonus}%！`);
                break;
            }
            case 'B18': {
                const stacks = parseInt(params[0]);
                const dmgPerStack = parseInt(params[1]);
                enemy.stacks = enemy.stacks || {};
                if (!enemy.stacks.trauma) {
                    enemy.stacks.trauma = { count: 0, damagePerStack: dmgPerStack };
                }
                enemy.stacks.trauma.count += stacks;
                enemy.stacks.trauma.damagePerStack = dmgPerStack;
                const totalDmg = enemy.stacks.trauma.count * enemy.stacks.trauma.damagePerStack;
                log.push(`创伤叠加！${enemy.name} 获得 ${stacks} 层创伤效果（总计 ${enemy.stacks.trauma.count} 层），每层每回合造成 ${dmgPerStack} 点伤害（总计 ${totalDmg} 点/回合）！`);
                break;
            }
            case 'B19': {
                const stacks = parseInt(params[0]);
                const bonus = parseInt(params[1].replace('%', ''));
                enemy.stacks = enemy.stacks || {};
                if (!enemy.stacks.corrosion) {
                    enemy.stacks.corrosion = { count: 0, bonusPerStack: bonus };
                }
                enemy.stacks.corrosion.count += stacks;
                enemy.stacks.corrosion.bonusPerStack = bonus;
                const totalBonus = enemy.stacks.corrosion.count * enemy.stacks.corrosion.bonusPerStack;
                log.push(`腐蚀叠加！${enemy.name} 获得 ${stacks} 层腐蚀效果（总计 ${enemy.stacks.corrosion.count} 层），每层使受到伤害增加 ${bonus}%（总计 +${totalBonus}%）！`);
                break;
            }
            // B20-B22 handled above (shields)
        }
    });
    return { totalExtraDamage, instructions };
}

// =============================================================================
// PHASE 1: A2-A5 Core functions
// =============================================================================

/**
 * restoreCore - Unified heal/mana restore logic
 * @param {Object} target - {type, entity}
 * @param {Object} weapon - {attack, critRate}
 * @param {Object} playerStats - {baseCritMultiplier}
 * @param {Array} log
 * @param {'heal'|'mana'} type
 */
function restoreCore(target, weapon, playerStats, log, type) {
    const isHeal = type === 'heal';
    const targetName = target.type === 'player' ? (target.entity.name || 'User') : target.entity.name;
    const instructions = [];
    let amount = weapon.attack;

    const critRoll = Math.random() * 100;
    const isCrit = critRoll <= weapon.critRate;
    if (isCrit) {
        amount = Math.floor(amount * playerStats.baseCritMultiplier);
        log.push((isHeal ? "暴击治疗！对 " : "暴击恢复！对 ") + targetName + " 恢复 " + amount + " 点" + (isHeal ? "生命值" : "法力值") + "！");
    } else {
        log.push("对 " + targetName + " 恢复 " + amount + " 点" + (isHeal ? "生命值" : "法力值") + "！");
    }

    const entity = target.entity;
    const prop = isHeal ? 'hp' : 'mp';
    const maxProp = isHeal ? 'maxHp' : 'maxMp';
    const oldVal = entity[prop];
    entity[prop] = Math.min(entity[prop] + amount, entity[maxProp]);
    const actual = entity[prop] - oldVal;
    if (!isHeal) log.push("实际恢复了 " + actual + " 点法力值！");

    instructions.push({
        type: isHeal ? 'heal' : 'manaRestore',
        targetId: target.type === 'player' ? 'player' : entity.id,
        targetName,
        ...(isHeal ? { heal: actual } : { restore: actual }),
        isCrit,
    });
    return instructions;
}

export function healCore(target, weapon, playerStats, log) {
    return restoreCore(target, weapon, playerStats, log, 'heal');
}

export function manaRestoreCore(target, weapon, playerStats, log) {
    return restoreCore(target, weapon, playerStats, log, 'mana');
}

/**
 * sacrificeBoostCore - Pure version of performSingleSacrificeBoost
 * @param {Object} player - Player entity (mutable)
 * @param {Object} weapon - Weapon with attack, hitRate, critRate, attacksPerTurn, targetsPerAttack, name
 * @param {Array} log - Log array
 * @returns {Array} Instructions
 */
export function sacrificeBoostCore(player, weapon, log) {
    const instructions = [];
    const attackerName = player.name || 'User';

    log.push(attackerName + " 使用 " + weapon.name + " 进行牺牲增益！");

    // Architecture §5.3: sacrifice 25% HP (minimum keep 1)
    const sacrificeDamage = Math.floor(player.hp * 0.25);
    player.hp = Math.max(1, player.hp - sacrificeDamage);
    log.push(attackerName + " 牺牲 " + sacrificeDamage + " 点生命值！");

    instructions.push({
        type: 'sacrificeDamage',
        targetId: 'player',
        targetName: attackerName,
        damage: sacrificeDamage,
    });

    player.sacrificeBoostActive = {
        attack: weapon.attack,
        hitRate: weapon.hitRate,
        critRate: weapon.critRate,
        attacksPerTurn: weapon.attacksPerTurn,
        targetsPerAttack: weapon.targetsPerAttack,
        weaponName: weapon.name,
    };
    log.push(attackerName + " 获得强大增益！本回合所有攻击都将获得 " + weapon.name + " 的属性加成！");
    log.push("增益效果：攻击+" + weapon.attack + "，命中+" + weapon.hitRate + "%，暴击+" + weapon.critRate + "%，次数+" + weapon.attacksPerTurn + "，目标+" + weapon.targetsPerAttack);

    instructions.push({
        type: 'buff',
        targetId: 'player',
        targetName: attackerName,
        buffType: 'sacrificeBoost',
        weaponName: weapon.name,
    });
    return instructions;
}

/**
 * a5MultiHitCore - Pure version of executeA5ContinuousAttack
 * @param {Object} player - Player entity (mutable, has ap, mp)
 * @param {Object} weapon - Weapon with attack, hitRate, critRate, mpCost, codes, name
 * @param {Array} enemies - Enemies list (mutable, hp will be modified)
 * @param {Object} playerStats - Player stats from getPlayerStatsCore
 * @param {Array} log - Log array
 * @returns {Array} Instructions [{type:'damage'|'miss'|'enemyDeath', ...}]
 */
export function a5MultiHitCore(player, weapon, enemies, playerStats, log) {
    const instructions = [];
    const aliveEnemies = enemies.filter(function(e) { return e.hp > 0; });

    if (aliveEnemies.length === 0) {
        log.push("【终结技】没有可攻击的目标！");
        return instructions;
    }

    const selectedEnemyIds = aliveEnemies.map(function(e) { return e.id; });
    log.push("【终结技】" + (player.name || 'User') + " 使用 " + weapon.name + "！消耗所有AP持续攻击！");

    let attackCount = 0;

    while (player.ap > 0 && player.mp >= (weapon.mpCost || 0)) {
        const aliveSelected = [];
        for (let i = 0; i < selectedEnemyIds.length; i++) {
            const found = enemies.find(function(e) { return e.id === selectedEnemyIds[i] && e.hp > 0; });
            if (found) aliveSelected.push(found);
        }

        if (aliveSelected.length === 0) {
            log.push("所有目标已被击败！" + weapon.name + " 结束，共攻击 " + attackCount + " 次！");
            break;
        }

        const damageModifier = Math.max(0.5, 1 - attackCount * 0.1);

        if (attackCount === 0) {
            log.push("第 " + (attackCount + 1) + " 击（威力100%）");
        } else {
            log.push("第 " + (attackCount + 1) + " 击（威力" + (damageModifier * 100).toFixed(0) + "%）");
        }

        player.ap -= 1;
        player.mp -= (weapon.mpCost || 0);

        for (let ei = 0; ei < aliveSelected.length; ei++) {
            const enemy = aliveSelected[ei];
            const modifiedWeapon = Object.assign({}, weapon, { attack: Math.floor(weapon.attack * damageModifier) });
            const enemyStats = getEnemyActualStats(enemy);
            const finalHitRate = calculateFinalHitRate(modifiedWeapon.hitRate, playerStats, enemyStats);
            const hitRoll = Math.random();

            if (hitRoll <= Math.min(1.0, finalHitRate)) {
                log.push("攻击命中 " + enemy.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");

                let finalCritRate = calculateFinalCritRate(modifiedWeapon.critRate, playerStats, enemyStats, finalHitRate);
                const critRoll = Math.random();
                const isCrit = critRoll <= finalCritRate;
                const finalCritMultiplier = isCrit ? calculateFinalCritMultiplier(playerStats, enemyStats, finalCritRate) : 1.0;

                let damage = calculateFinalDamage(modifiedWeapon.attack, playerStats, enemyStats, isCrit, finalCritMultiplier);

                var hasEnchantments = weapon.codes && weapon.codes.some(function(code) { return code.startsWith('EN:'); });
                if (hasEnchantments) {
                    var enchantmentTriggerRoll = Math.random();
                    var enchantmentTriggerChance = damageModifier * 100;
                    if (enchantmentTriggerRoll <= damageModifier) {
                        var enchResult = processEnchantmentEffectsCore(weapon, enemy, damage, isCrit, log, player, player.buffs || []);
                        damage += enchResult.totalExtraDamage;
                        for (var ii = 0; ii < enchResult.instructions.length; ii++) instructions.push(enchResult.instructions[ii]);
                        if (enchResult.totalExtraDamage > 0) {
                            log.push("【终结技特效】特效触发成功！(触发概率: " + enchantmentTriggerChance.toFixed(0) + "%) 额外伤害+" + enchResult.totalExtraDamage);
                        } else {
                            log.push("【终结技特效】特效触发成功！(触发概率: " + enchantmentTriggerChance.toFixed(0) + "%) 无额外伤害效果");
                        }
                    } else {
                        log.push("【终结技特效】特效未触发 (触发概率: " + enchantmentTriggerChance.toFixed(0) + "%)");
                    }
                }

                enemy.hp = Math.max(0, enemy.hp - damage);

                if (isCrit) {
                    log.push("暴击！对 " + enemy.name + " 造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%, 暴击倍率: " + finalCritMultiplier.toFixed(2) + "x)");
                } else {
                    log.push("对 " + enemy.name + " 造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%)");
                }

                instructions.push({
                    type: 'damage', targetId: enemy.id, targetName: enemy.name,
                    damage: damage, isCrit: isCrit, hitRate: finalHitRate,
                });

                if (enemy.hp <= 0) {
                    log.push(enemy.name + " 被击败了！");
                    instructions.push({ type: 'enemyDeath', targetId: enemy.id, targetName: enemy.name });
                }
            } else {
                log.push("攻击未命中 " + enemy.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");
                instructions.push({ type: 'miss', targetId: enemy.id, targetName: enemy.name, hitRate: finalHitRate });
            }
        }
        attackCount++;
    }

    if (player.ap <= 0) {
        log.push("AP耗尽！" + weapon.name + " 结束，共攻击 " + attackCount + " 次！");
    } else if (player.mp < (weapon.mpCost || 0)) {
        log.push("MP不足！" + weapon.name + " 提前结束，共攻击 " + attackCount + " 次！");
    }

    return instructions;
}

// =============================================================================
// PHASE 2: Combat helpers
// =============================================================================

/**
 * hasDebuff - Check if entity has a specific debuff type (unexpired)
 * @param {Object} entity - Battle entity
 * @param {string} debuffType - Debuff type identifier (e.g. 'stun')
 * @returns {boolean}
 */
export function hasDebuff(entity, debuffType) {
    return (entity.buffs || []).some(function(b) {
        return b.type === debuffType && (b.turns === undefined || b.turns > 0);
    });
}

/**
 * selectTargets - Pick count alive enemies from the list
 * @param {Array} enemies - Enemies list
 * @param {number} count - Number of targets to select
 * @returns {Array} Alive enemies (up to count)
 */
export function selectTargets(enemies, count) {
    const alive = enemies.filter(function(e) { return e.hp > 0; });
    return alive.slice(0, count);
}

/**
 * applyDamageToEnemy - Apply damage with shield absorption (tempShield -> shield -> HP)
 * @param {Object} enemy - Enemy entity (mutable)
 * @param {number} damage - Damage to apply
 * @param {Array} log - Log array
 * @param {string} attackerName - Attacker display name
 * @param {string} weaponName - Weapon display name
 * @param {boolean} isCrit - Whether critical hit
 */
export function applyDamageToEnemy(enemy, damage, log, attackerName, weaponName, isCrit) {
    let remainingDamage = damage;

    if (enemy.tempShield && enemy.tempShield > 0) {
        const absorbed = Math.min(enemy.tempShield, remainingDamage);
        enemy.tempShield -= absorbed;
        remainingDamage -= absorbed;
        if (absorbed > 0) {
            log.push(enemy.name + "的临时护盾抵挡了 " + absorbed + " 点伤害！剩余临时护盾: " + enemy.tempShield);
        }
    }

    if (remainingDamage > 0 && enemy.shield && enemy.shield > 0) {
        const absorbed = Math.min(enemy.shield, remainingDamage);
        enemy.shield -= absorbed;
        remainingDamage -= absorbed;
        if (absorbed > 0) {
            log.push(enemy.name + "的护盾抵挡了 " + absorbed + " 点伤害！剩余护盾: " + enemy.shield);
        }
    }

    if (remainingDamage > 0) {
        enemy.hp = Math.max(0, enemy.hp - remainingDamage);
        log.push(enemy.name + "受到 " + remainingDamage + " 点伤害！当前HP: " + enemy.hp + "/" + enemy.maxHp);
    }
}

/**
 * executeStandardAttack - Perform apt x tpa independent hit calculations
 * @param {Object} weapon - Weapon object
 * @param {Array} enemies - Enemies list (mutable)
 * @param {Object} stats - Attacker stats
 * @param {Object} player - Player entity
 * @param {Array} playerBuffs - Player buffs array
 * @param {Array} log - Log array
 * @param {string} attackerName - Attacker display name
 * @returns {Array} Instructions
 */
export function executeStandardAttack(weapon, enemies, stats, player, playerBuffs, log, attackerName) {
    const instructions = [];
    const apt = weapon.apt || 1;
    const tpa = weapon.tpa || 1;

    for (let hit = 0; hit < apt; hit++) {
        const targets = selectTargets(enemies, tpa);
        if (targets.length === 0) break;

        for (let ti = 0; ti < targets.length; ti++) {
            const target = targets[ti];
            if (target.hp <= 0) continue;

            const targetStats = getEnemyActualStats(target);
            const finalHitRate = calculateFinalHitRate(weapon.hitRate, stats, targetStats);
            const hitRoll = Math.random();

            if (hitRoll <= Math.min(1.0, finalHitRate)) {
                const finalCritRate = calculateFinalCritRate(weapon.critRate, stats, targetStats, finalHitRate);
                const critRoll = Math.random();
                const isCrit = critRoll <= finalCritRate;
                const finalCritMult = isCrit ? calculateFinalCritMultiplier(stats, targetStats, finalCritRate) : 1.0;

                let damage = calculateFinalDamage(weapon.attack, stats, targetStats, isCrit, finalCritMult);

                const enchResult = processEnchantmentEffectsCore(weapon, target, damage, isCrit, log, player, playerBuffs);
                damage += enchResult.totalExtraDamage;
                for (let ii = 0; ii < enchResult.instructions.length; ii++) instructions.push(enchResult.instructions[ii]);

                if (target.marks && target.marks.vulnerability) {
                    const bonusDmg = Math.floor(damage * (target.marks.vulnerability / 100));
                    damage += bonusDmg;
                    log.push("易伤标记！" + target.name + " 额外承受 " + bonusDmg + " 点伤害！");
                    delete target.marks.vulnerability;
                }

                if (isCrit && target.marks && target.marks.death) {
                    const bonusDmg = Math.floor(damage * (target.marks.death / 100));
                    damage += bonusDmg;
                    log.push("死点标记！" + target.name + " 额外承受 " + bonusDmg + " 点暴击伤害！");
                    delete target.marks.death;
                }

                applyDamageToEnemy(target, damage, log, attackerName, weapon.name, isCrit);

                if (isCrit) {
                    log.push("暴击！对 " + target.name + " 造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%, 暴击倍率: " + finalCritMult.toFixed(2) + "x)");
                } else {
                    log.push("对 " + target.name + " 造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%)");
                }

                instructions.push({
                    type: 'damage', targetId: target.id, targetName: target.name,
                    damage: damage, isCrit: isCrit, hitRate: finalHitRate,
                });

                if (target.hp <= 0) {
                    log.push(target.name + " 被击败了！");
                    instructions.push({ type: 'enemyDeath', targetId: target.id, targetName: target.name });
                }
            } else {
                log.push("攻击未命中 " + target.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");
                instructions.push({ type: 'miss', targetId: target.id, targetName: target.name, hitRate: finalHitRate });
            }
        }
    }
    return instructions;
}

// =============================================================================
// PHASE 2f/2g: End-of-round processing
// =============================================================================

export function clearExpiredTempShields(player, teammates, log) {
    if (player.tempShield) {
        log.push("临时护盾消散，失去 " + player.tempShield + " 点临时护盾！");
        player.tempShield = 0;
    }
    for (let i = 0; i < teammates.length; i++) {
        if (teammates[i].tempShield) {
            log.push(teammates[i].name + "的临时护盾消散，失去 " + teammates[i].tempShield + " 点临时护盾！");
            teammates[i].tempShield = 0;
        }
    }
}

/**
 * expireBuffs — decrement buff durations and revert stats on expiry
 * @param {Array} buffs - mutable buff array
 * @param {Object} entity - entity whose stats to revert
 * @param {Object} statMap - { buffType: statKey, ... } e.g. { strBoost: 'str' }
 * @param {string} [logPrefix] - if set, logs "{prefix} {name} 效果已结束！"
 * @param {Array} log
 */
function expireBuffs(buffs, entity, statMap, logPrefix, log) {
    for (let i = 0; i < buffs.length; i++) {
        const buff = buffs[i];
        if (buff.turns !== undefined) buff.turns--;
        if (buff.duration !== undefined) buff.duration--;
        const expired = (buff.turns !== undefined && buff.turns <= 0) || (buff.duration !== undefined && buff.duration <= 0);
        if (expired) {
            if (buff.type && statMap[buff.type]) {
                const key = statMap[buff.type];
                if (buff.type.endsWith('Boost')) {
                    entity[key] = Math.max(1, (entity[key] || 0) - (buff.value || 0));
                } else {
                    entity[key] = (entity[key] || 0) + buff.value;
                }
            }
            log.push((logPrefix || '') + buff.name + " 效果已结束！");
        }
    }
}

const BOOST_STAT_MAP = { strBoost: 'str', agiBoost: 'agi', intBoost: 'int', endBoost: 'vit' };
const FULL_STAT_MAP = { ...BOOST_STAT_MAP, strDebuff: 'str', agiDebuff: 'agi', intDebuff: 'int', vitDebuff: 'vit' };

export function decrementBuffTurns(player, playerBuffs, enemies, teammates, log) {
    expireBuffs(playerBuffs, player, FULL_STAT_MAP, '', log);
    for (let i = 0; i < enemies.length; i++) {
        var enemy = enemies[i];
        if (enemy.buffs && enemy.buffs.length > 0) {
            expireBuffs(enemy.buffs, enemy, BOOST_STAT_MAP, enemy.name + " 的 ", log);
        }
    }
    for (let i = 0; i < teammates.length; i++) {
        var tm = teammates[i];
        if (tm.buffs && tm.buffs.length > 0) {
            expireBuffs(tm.buffs, tm, FULL_STAT_MAP, tm.name + " 的 ", log);
        }
    }
}

export function removeExpiredBuffs(playerBuffs, enemies, teammates) {
    for (let i = playerBuffs.length - 1; i >= 0; i--) {
        if (playerBuffs[i].duration <= 0) playerBuffs.splice(i, 1);
    }
    for (let i = 0; i < enemies.length; i++) {
        if (enemies[i].buffs) {
            enemies[i].buffs = enemies[i].buffs.filter(function(b) { return b.duration > 0; });
        }
    }
    for (let i = 0; i < teammates.length; i++) {
        if (teammates[i].buffs) {
            teammates[i].buffs = teammates[i].buffs.filter(function(b) { return b.duration > 0; });
        }
    }
}

/**
 * processEndOfRoundCore - End-of-round processing (DoT, HoT, shields, buff decrements)
 * Per architecture 5.13: DoT, HoT, shieldOverTime, tempShield expiry, buff decrement,
 * expired removal, clear sacrificeBoostActive. CD decrement handled by persistCooldowns.
 */
export function processEndOfRoundCore(player, playerBuffs, enemies, teammates, playerStats, log) {
    // 1. DoT on player and teammates
    var allAllies = [player].concat(teammates);
    allAllies.forEach(function(entity, index) {
        var isPlayer = index === 0;
        var entityBuffs = isPlayer ? playerBuffs : entity.buffs;
        if (entityBuffs && entityBuffs.length > 0) {
            entityBuffs.forEach(function(buff) {
                if (buff.type === 'dot') {
                    entity.hp = Math.max(0, entity.hp - buff.value);
                    log.push((isPlayer ? (player.name || 'User') : entity.name) + " 受到持续伤害 " + buff.value + " 点！");
                }
                if (buff.type === 'manaBurn') {
                    var oldMp = entity.mp;
                    entity.mp = Math.max(0, entity.mp - buff.value);
                    var actualLoss = oldMp - entity.mp;
                    if (actualLoss > 0) {
                        log.push((isPlayer ? (player.name || 'User') : entity.name) + " 法力燃烧！损失 " + actualLoss + " 点MP！");
                    }
                }
            });
        }
    });

    // 2. DoT on enemies + enemy healOverTime + trauma stacks
    for (var ei = 0; ei < enemies.length; ei++) {
        var enemy = enemies[ei];
        if (enemy.buffs && enemy.buffs.length > 0) {
            enemy.buffs.forEach(function(buff) {
                if (buff.type === 'dot') {
                    enemy.hp = Math.max(0, enemy.hp - buff.value);
                    log.push(enemy.name + " 受到持续伤害 " + buff.value + " 点！");
                    if (enemy.hp <= 0) log.push(enemy.name + " 因持续伤害死亡！");
                }
                if (buff.type === 'healOverTime') {
                    var oldHp = enemy.hp;
                    enemy.hp = Math.min(enemy.hp + buff.value, enemy.maxHp);
                    var actualHeal = enemy.hp - oldHp;
                    if (actualHeal > 0) log.push(enemy.name + " 持续再生效果触发，恢复 " + actualHeal + " 点生命值！");
                }
            });
        }
        if (enemy.stacks && enemy.stacks.trauma) {
            var traumaData = enemy.stacks.trauma;
            var traumaCount = typeof traumaData === 'object' ? traumaData.count : traumaData;
            var damagePerStack = typeof traumaData === 'object' ? traumaData.damagePerStack : 3;
            var traumaDamage = traumaCount * damagePerStack;
            enemy.hp = Math.max(0, enemy.hp - traumaDamage);
            log.push(enemy.name + " 受到创伤伤害 " + traumaDamage + " 点（" + traumaCount + " 层 x " + damagePerStack + " 点/层）！");
            if (enemy.hp <= 0) log.push(enemy.name + " 因创伤死亡！");
        }
    }

    // 3. HoT on teammates
    for (var ti = 0; ti < teammates.length; ti++) {
        var tm = teammates[ti];
        if (tm.buffs && tm.buffs.length > 0) {
            tm.buffs.forEach(function(buff) {
                if (buff.type === 'healOverTime') {
                    var oldHp = tm.hp;
                    tm.hp = Math.min(tm.hp + buff.value, tm.maxHp);
                    var actualHeal = tm.hp - oldHp;
                    if (actualHeal > 0) log.push(tm.name + " 持续恢复效果触发，恢复 " + actualHeal + " 点生命值！");
                }
                if (buff.type === 'shieldOverTime') {
                    if (!tm.shield) { tm.shield = 0; tm.maxShield = 0; }
                    tm.shield += buff.value;
                    log.push(tm.name + "的护盾持续效果触发，获得 " + buff.value + " 点护盾（当前护盾 " + tm.shield + " 点）！");
                }
            });
        }
    }

    // 4. HoT on player
    var healOTBuff = playerBuffs.find(function(b) { return b.type === 'healOverTime'; });
    if (healOTBuff) {
        var oldHp = player.hp;
        player.hp = Math.min(player.hp + healOTBuff.value, player.maxHp);
        var actualHeal = player.hp - oldHp;
        if (actualHeal > 0) log.push("持续恢复效果触发，恢复 " + actualHeal + " 点生命值！");
    }

    // 5. Shield over time on player
    var shieldOTBuff = playerBuffs.find(function(b) { return b.type === 'shieldOverTime'; });
    if (shieldOTBuff) {
        if (!player.shield) { player.shield = 0; player.maxShield = 0; }
        player.shield += shieldOTBuff.value;
        log.push("护盾持续效果触发，获得 " + shieldOTBuff.value + " 点护盾（当前护盾 " + player.shield + " 点）！");
    }

    // 6. Clear temp shields
    clearExpiredTempShields(player, teammates, log);

    // 7. Decrement all buff durations
    decrementBuffTurns(player, playerBuffs, enemies, teammates, log);

    // 8. Remove expired buffs
    removeExpiredBuffs(playerBuffs, enemies, teammates);

    // 9. Clear sacrificeBoostActive
    player.sacrificeBoostActive = null;

    // 10. HP/MP natural regen
    player.hp = Math.min(player.hp + playerStats.hpRegen, player.maxHp);
    player.mp = Math.min(player.mp + playerStats.mpRegen, player.maxMp);

    // 11. Teammate regen
    for (var ri = 0; ri < teammates.length; ri++) {
        var tmr = teammates[ri];
        var tmStats = getTeammateActualStats(tmr);
        tmr.hp = Math.min(tmr.hp + (tmr.hpRegen || tmStats.hpRegen || 0), tmr.maxHp);
        tmr.mp = Math.min(tmr.mp + (tmStats.mpRegen || 0), tmr.maxMp);
    }
}

// =============================================================================
// PHASE 3: C-class Core functions
// =============================================================================

/**
 * performEnemyActionCore - Pure version of performEnemyAction
 * Extracts stun check, burn DoT, attackPattern selection, target selection,
 * damage calculation, and monster skill effects. Returns instruction list.
 * @param {Object} enemy - Enemy entity (mutable)
 * @param {Object} player - Player entity (mutable)
 * @param {Array} teammates - Teammates list (mutable)
 * @param {Array} log - Log array
 * @returns {Array} Instructions [{type:'damage'|'stun'|'miss'|'burnDamage'|'enemyDeath', ...}]
 */
export function performEnemyActionCore(enemy, player, teammates, log) {
    const instructions = [];

    // Stun check (pendingFreeze pattern from existing code)
    if (enemy.pendingFreeze) {
        log.push(enemy.name + " 被晕眩，无法行动！");
        enemy.pendingFreezeCount--;
        if (enemy.pendingFreezeCount <= 0) {
            enemy.pendingFreeze = false;
            enemy.pendingFreezeCount = 0;
            log.push(enemy.name + " 解除了晕眩状态！");
        }
        instructions.push({ type: 'stun', targetId: enemy.id, targetName: enemy.name });
        return instructions;
    }

    // Burn DoT processing (burnOverTime on enemy before attack)
    let totalBurnDamage = 0;
    const burnBuffs = enemy.buffs ? enemy.buffs.filter(function(b) { return b.type === 'burnOverTime'; }) : [];
    if (burnBuffs.length > 0) {
        burnBuffs.forEach(function(b) { totalBurnDamage += b.value; });
        if (totalBurnDamage > 0) {
            enemy.hp = Math.max(0, enemy.hp - totalBurnDamage);
            log.push(enemy.name + " 受到余烬效果，损失 " + totalBurnDamage + " 点生命值！");
            instructions.push({ type: 'burnDamage', targetId: enemy.id, targetName: enemy.name, damage: totalBurnDamage });
            if (enemy.hp <= 0) {
                log.push(enemy.name + " 被余烬效果击败了！");
                instructions.push({ type: 'enemyDeath', targetId: enemy.id, targetName: enemy.name });
                return instructions;
            }
        }
    }

    // Attack pattern selection
    let skill;
    if (!enemy.attackPattern || enemy.attackPattern.length === 0) {
        // Fallback: no attackPattern → use first skill (matches index.js behavior)
        skill = enemy.skills?.[0] || null;
        if (!skill) return instructions; // truly no skills at all
    } else {
        const attackName = enemy.attackPattern[enemy.nextAttackIndex || 0];
        skill = enemy.skills ? enemy.skills.find(function(s) { return s.name === attackName; }) : null;
        enemy.nextAttackIndex = ((enemy.nextAttackIndex || 0) + 1) % enemy.attackPattern.length;
    }

    if (!skill) return instructions;

    log.push(enemy.name + " 使用 " + skill.name + " 攻击！");

    // Target selection (random from alive player + teammates)
    const maxTargets = skill.targetsPerAttack || 1;
    const possibleTargets = [];
    if (player.hp > 0) {
        possibleTargets.push({ type: 'player', entity: player, name: player.name || 'User' });
    }
    for (let i = 0; i < teammates.length; i++) {
        if (teammates[i].hp > 0) {
            possibleTargets.push({ type: 'teammate', entity: teammates[i], name: teammates[i].name });
        }
    }
    if (possibleTargets.length === 0) {
        log.push(enemy.name + " 找不到可攻击的目标！");
        return instructions;
    }

    // Pick targets (random subset)
    const shuffled = possibleTargets.slice().sort(function() { return Math.random() - 0.5; });
    const targets = shuffled.slice(0, maxTargets);

    if (maxTargets > 1) {
        log.push(enemy.name + " 的 " + skill.name + " 瞄准了 " + targets.length + " 个目标：" + targets.map(function(t) { return t.name; }).join(', '));
    }

    // Attack each target
    const enemyStats = getEnemyActualStats(enemy);

    for (let ti = 0; ti < targets.length; ti++) {
        const target = targets[ti];
        const targetStats = target.type === 'player'
            ? getTeammateActualStats(player)
            : getTeammateActualStats(target.entity);

        // Effective hit rate with hitRateDown debuff
        let effectiveHitRate = skill.hitRate;
        if (enemy.buffs) {
            enemy.buffs.forEach(function(buff) {
                if (buff.type === 'hitRateDown') effectiveHitRate -= buff.value;
            });
        }
        effectiveHitRate = Math.max(0, effectiveHitRate);

        const finalHitRate = calculateFinalHitRate(effectiveHitRate, enemyStats, targetStats);
        const hitRoll = Math.random();

        if (hitRoll <= Math.min(1.0, finalHitRate)) {
            log.push("攻击命中 " + target.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");

            const finalCritRate = calculateFinalCritRate(skill.critRate, enemyStats, targetStats, finalHitRate);
            const critRoll = Math.random();
            const isCrit = critRoll <= finalCritRate;
            const finalCritMult = isCrit ? calculateFinalCritMultiplier(enemyStats, targetStats, finalCritRate) : 1.0;

            let damage = calculateFinalDamage(skill.attack, enemyStats, targetStats, isCrit, finalCritMult);

            if (isCrit) {
                log.push("暴击！造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%, 暴击倍率: " + finalCritMult.toFixed(2) + "x)");
            } else {
                log.push("造成 " + damage + " 点伤害！");
            }

            // Process monster skill codes (MN:M* effects)
            if (skill.codes && skill.codes.length > 0) {
                for (let ci = 0; ci < skill.codes.length; ci++) {
                    const code = skill.codes[ci];
                    if (!code.startsWith('MN:M')) continue;
                    const mMatch = code.match(/MN:(M\d+),(.+)/);
                    if (!mMatch) continue;
                    const effectType = mMatch[1];
                    const mParams = mMatch[2].split(',');
                    const targetBuffs = target.type === 'player' ? (player.buffs || []) : (target.entity.buffs || []);

                    switch (effectType) {
                        case 'M1': {
                            const healAmt = Math.floor(damage * (parseFloat(mParams[0]) / 100));
                            enemy.hp = Math.min(enemy.hp + healAmt, enemy.maxHp);
                            log.push("【怪物特效】吸血攻击！" + enemy.name + " 恢复 " + healAmt + " 点生命值！");
                            break;
                        }
                        case 'M2': {
                            targetBuffs.push({ name: '持续伤害', type: 'dot', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            log.push("【怪物特效】持续伤害！" + target.name + " 受到诅咒 " + mParams[0] + " 回合！");
                            break;
                        }
                        case 'M3': {
                            targetBuffs.push({ name: '力量削弱', type: 'strDebuff', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            if (target.type === 'player') player.str = Math.max(1, player.str - parseInt(mParams[1]));
                            else target.entity.str = Math.max(1, target.entity.str - parseInt(mParams[1]));
                            log.push("【怪物特效】力量削弱！" + target.name + " 力量降低 " + mParams[1] + " 点！");
                            break;
                        }
                        case 'M4': {
                            targetBuffs.push({ name: '敏捷削弱', type: 'agiDebuff', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            if (target.type === 'player') player.agi = Math.max(1, player.agi - parseInt(mParams[1]));
                            else target.entity.agi = Math.max(1, target.entity.agi - parseInt(mParams[1]));
                            log.push("【怪物特效】敏捷削弱！" + target.name + " 敏捷降低 " + mParams[1] + " 点！");
                            break;
                        }
                        case 'M5': {
                            targetBuffs.push({ name: '法力燃烧', type: 'manaBurn', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            log.push("【怪物特效】法力燃烧！" + target.name + " 将持续损失法力 " + mParams[0] + " 回合！");
                            break;
                        }
                        case 'M6': {
                            targetBuffs.push({ name: '智力削弱', type: 'intDebuff', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            if (target.type === 'player') player.int = Math.max(1, player.int - parseInt(mParams[1]));
                            else target.entity.int = Math.max(1, target.entity.int - parseInt(mParams[1]));
                            log.push("【怪物特效】智力削弱！" + target.name + " 智力降低 " + mParams[1] + " 点！");
                            break;
                        }
                        case 'M7': {
                            targetBuffs.push({ name: '耐力削弱', type: 'vitDebuff', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: false });
                            if (target.type === 'player') player.vit = Math.max(1, player.vit - parseInt(mParams[1]));
                            else target.entity.vit = Math.max(1, target.entity.vit - parseInt(mParams[1]));
                            log.push("【怪物特效】耐力削弱！" + target.name + " 耐力降低 " + mParams[1] + " 点！");
                            break;
                        }
                        case 'M8': {
                            if (!enemy.buffs) enemy.buffs = [];
                            enemy.buffs.push({ name: '敏捷强化', type: 'agiBoost', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: true });
                            enemy.agi = enemy.agi + parseInt(mParams[1]);
                            log.push("【怪物特效】敏捷强化！" + enemy.name + " 敏捷提升 " + mParams[1] + " 点！");
                            break;
                        }
                        case 'M9': {
                            if (!enemy.buffs) enemy.buffs = [];
                            enemy.buffs.push({ name: '持续再生', type: 'healOverTime', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: true });
                            log.push("【怪物特效】持续再生！" + enemy.name + " 将在 " + mParams[0] + " 回合内每回合恢复 " + mParams[1] + " 点HP！");
                            break;
                        }
                        case 'M10': {
                            if (!enemy.buffs) enemy.buffs = [];
                            enemy.buffs.push({ name: '力量强化', type: 'strBoost', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), isPositive: true });
                            enemy.str = enemy.str + parseInt(mParams[1]);
                            log.push("【怪物特效】力量强化！" + enemy.name + " 力量提升 " + mParams[1] + " 点！");
                            break;
                        }
                    }
                }
            }

            // Apply damage via shield absorption
            applyDamageToEnemy(target.entity, damage, log, enemy.name, skill.name, isCrit);

            instructions.push({
                type: 'damage',
                targetId: target.type === 'player' ? 'player' : target.entity.id,
                targetName: target.name,
                damage: damage,
                isCrit: isCrit,
                hitRate: finalHitRate,
                fromEnemy: true,
            });

            if (target.entity.hp <= 0) {
                if (target.type === 'player') {
                    log.push("玩家被击败了！");
                    instructions.push({ type: 'playerDeath', targetId: 'player', targetName: target.name });
                } else {
                    log.push(target.name + " 被击败了！");
                    instructions.push({ type: 'teammateDeath', targetId: target.entity.id, targetName: target.name });
                }
            }
        } else {
            log.push("攻击未命中 " + target.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");
            instructions.push({ type: 'miss', targetId: target.type === 'player' ? 'player' : target.entity.id, targetName: target.name, hitRate: finalHitRate, fromEnemy: true });
        }
    }

    return instructions;
}

/**
 * executeTeammateAttackCore - Pure version of executeTeammateAttackSequence
 * @param {Object} teammate - Teammate entity (mutable)
 * @param {Array} enemies - Enemies list (mutable)
 * @param {Array} log - Log array
 * @returns {Array} Instructions [{type:'damage'|'miss'|'enemyDeath', ...}]
 */
export function executeTeammateAttackCore(teammate, enemies, log) {
    const instructions = [];
    if (!enemies || enemies.length === 0) return instructions;

    // Find first alive enemy
    const aliveEnemies = enemies.filter(function(e) { return e.hp > 0; });
    if (aliveEnemies.length === 0) return instructions;
    const target = aliveEnemies[0];

    // Use first skill or default attack
    const weapon = teammate.skills && teammate.skills.length > 0 ? teammate.skills[0] : null;
    const weaponName = weapon ? weapon.name : (teammate.name + "的攻击");
    const weaponAttack = weapon ? (weapon.attack || weapon.atk || 10) : 10;
    const weaponHitRate = weapon ? (weapon.hitRate || weapon.hit || 90) : 90;
    const weaponCritRate = weapon ? (weapon.critRate || weapon.crit || 5) : 5;
    const weaponMpCost = weapon ? (weapon.mpCost || weapon.mp_cost || 0) : 0;
    const weaponApt = weapon ? (weapon.apt || 1) : 1;

    const teammateStats = getTeammateActualStats(teammate);
    const enemyStats = getEnemyActualStats(target);

    log.push(teammate.name + " 使用 " + weaponName + " 攻击！");

    // Check MP
    if (teammate.mp < weaponMpCost) {
        log.push(teammate.name + " 蓝量不足！无法继续攻击。");
        return instructions;
    }

    // Deduct MP
    teammate.mp = Math.max(0, teammate.mp - weaponMpCost);
    if (weaponMpCost > 0) {
        log.push(teammate.name + " 消耗 " + weaponMpCost + " 点法力值。剩余法力值: " + teammate.mp);
    }

    // Attack loop (apt times)
    for (let hit = 0; hit < weaponApt; hit++) {
        if (target.hp <= 0) break;

        const tEnemyStats = getEnemyActualStats(target);
        const finalHitRate = calculateFinalHitRate(weaponHitRate, teammateStats, tEnemyStats);
        const hitRoll = Math.random();

        if (hitRoll <= Math.min(1.0, finalHitRate)) {
            log.push("攻击命中 " + target.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");

            const finalCritRate = calculateFinalCritRate(weaponCritRate, teammateStats, tEnemyStats, finalHitRate);
            const critRoll = Math.random();
            const isCrit = critRoll <= finalCritRate;
            const finalCritMult = isCrit ? calculateFinalCritMultiplier(teammateStats, tEnemyStats, finalCritRate) : 1.0;

            let damage = calculateFinalDamage(weaponAttack, teammateStats, tEnemyStats, isCrit, finalCritMult);

            // Corrosion stacks bonus
            if (target.stacks && target.stacks.corrosion) {
                const corrosionData = target.stacks.corrosion;
                const corrosionCount = typeof corrosionData === 'object' ? corrosionData.count : corrosionData;
                const bonusPerStack = typeof corrosionData === 'object' ? corrosionData.bonusPerStack : 5;
                const totalCorrosionBonus = corrosionCount * bonusPerStack;
                const bonusDamage = Math.floor(damage * (totalCorrosionBonus / 100));
                damage += bonusDamage;
                log.push("腐蚀效果！" + corrosionCount + " 层腐蚀（" + bonusPerStack + "%/层）造成额外 " + bonusDamage + " 点伤害（+" + totalCorrosionBonus + "%）！");
            }

            if (isCrit) {
                log.push("暴击！造成 " + damage + " 点伤害！(暴击率: " + (finalCritRate * 100).toFixed(1) + "%, 暴击倍率: " + finalCritMult.toFixed(2) + "x)");
            } else {
                log.push("造成 " + damage + " 点伤害！");
            }

            // Apply damage
            target.hp = Math.max(0, target.hp - damage);

            instructions.push({
                type: 'damage', targetId: target.id, targetName: target.name,
                damage: damage, isCrit: isCrit, hitRate: finalHitRate,
            });

            if (target.hp <= 0) {
                log.push(target.name + " 被击败了！");
                instructions.push({ type: 'enemyDeath', targetId: target.id, targetName: target.name });
            }
        } else {
            log.push("攻击未命中 " + target.name + "！(最终命中率: " + (finalHitRate * 100).toFixed(1) + "%)");
            instructions.push({ type: 'miss', targetId: target.id, targetName: target.name, hitRate: finalHitRate });
        }
    }

    return instructions;
}
