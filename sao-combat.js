// sao-combat.js — Combat resolution functions extracted from index.js (P4b)
// Pure state-based combat engine — no DOM dependency.
// All functions read from sao-core data, mutate combat entities, and return results.

import { getSaoData, log } from './sao-core.js';
import { resolveAffixArgs } from './sao-generators.js';
import { CUSTOM_SKILL_DEFS } from './sao-skills.js';
import {
    getPlayerStatsCore,
    calculateActionOrderCore,
    selectTargets,
    hasDebuff,
} from './battle/battleCore.js';
import {
    calculateDerivedStats,
    calculateFinalHitRate,
    calculateFinalCritRate,
    calculateFinalCritMultiplier,
    calculateFinalDamage,
    getTeammateActualStats,
    getEnemyActualStats,
} from './battle/battleMath.js';
/**
 * 规范化武器/技能字段名 + EN: 前缀
 * @param {Object} rawSkill - zd_parsed 中的原始技能对象
 * @param {Object} skillCooldowns - state.skillCooldowns
 * @returns {Object} 规范化后的技能对象
 */
export function normalizeWeapon(rawSkill, skillCooldowns) {
    if (!rawSkill) return null;
    const name = rawSkill.name || '未知';
    const codes = [];
    // 规范化 EN 前缀
    if (Array.isArray(rawSkill.en)) {
        rawSkill.en.forEach(c => {
            codes.push(c.startsWith('EN:') ? c : `EN:${c}`);
        });
    }
    // P4c: 处理自定义技能的 affix_codes
    if (Array.isArray(rawSkill.affix_codes)) {
        rawSkill.affix_codes.forEach(c => {
            codes.push(c.startsWith('EN:') || c.startsWith('WN:') ? c : `EN:${c}`);
        });
    }
    if (rawSkill.wn) {
        codes.push(rawSkill.wn.startsWith('WN:') ? rawSkill.wn : `WN:${rawSkill.wn}`);
    }
    // 查冷却
    const cdKey = name;
    const currentCooldown = (skillCooldowns && skillCooldowns[cdKey]) || 0;

    const normalized = {
        name,
        attack: rawSkill.atk || 0,
        hitRate: rawSkill.hit || 0,
        critRate: rawSkill.crit || 0,
        attacksPerTurn: rawSkill.apt || 1,
        targetsPerAttack: rawSkill.tpa || 1,
        mpCost: rawSkill.mpCost || rawSkill.mp_cost || 0,
        cooldown: rawSkill.cd || rawSkill.cooldown || 0,
        currentCooldown,
        codes,
        wn: rawSkill.wn || 'A1',
        used: false,
        isHealing: name.includes('治疗'),
    };
    // P4c: 透传自定义技能元数据（函数字段，不可序列化但运行时可用）
    if (rawSkill._custom) normalized._custom = true;
    if (rawSkill._customHandler) normalized._customHandler = rawSkill._customHandler;
    return normalized;
}

/**
 * 从 zd_parsed.player 构建玩家战斗实体
 * @param {Object} zdPlayer - _zd_parsed.player
 * @param {Array} zdSkills - _zd_parsed.skills
 * @param {Object} equipmentStats - 装备属性加成
 * @returns {Object} 玩家战斗实体
 */
export function buildPlayerEntity(zdPlayer, zdSkills, equipmentStats) {
    const data = getSaoData();
    const cooldowns = data?.state?.skillCooldowns || {};
    const weapons = (zdSkills || []).map(s => normalizeWeapon(s, cooldowns)).filter(Boolean);

    // P4c: 注入已解锁的自定义技能到武器列表
    const customSkillIds = data?.state?.customSkills || [];
    for (const id of customSkillIds) {
        const def = CUSTOM_SKILL_DEFS[id];
        if (!def) continue;
        // 避免重复注入（按名称去重）
        if (!weapons.some(w => w.name === def.name)) {
            const normalized = normalizeWeapon(def, cooldowns);
            if (normalized) weapons.push(normalized);
        }
    }

    const str = (zdPlayer.str || 0) + (equipmentStats?.str || 0);
    const agi = (zdPlayer.agi || 0) + (equipmentStats?.agi || 0);
    const int = (zdPlayer.int || 0) + (equipmentStats?.int || 0);
    const vit = (zdPlayer.vit || 0) + (equipmentStats?.vit || 0);

    const derived = calculateDerivedStats(str, agi, int, vit);

    return {
        name: zdPlayer.name || '玩家',
        hp: zdPlayer.hp || 0,
        maxHp: zdPlayer.max_hp || 100,
        mp: zdPlayer.mp || 0,
        maxMp: zdPlayer.max_mp || 50,
        str, agi, int, vit,
        speed: derived.speed,
        evasionRate: derived.evasionRate,
        damageBonus: derived.damageBonus,
        physicalReduction: derived.physicalReduction,
        damageTakenRate: derived.damageTakenRate,
        extraHitRate: derived.extraHitRate,
        extraCritRate: derived.extraCritRate,
        baseCritMultiplier: derived.baseCritMultiplier,
        critRateResistance: derived.critRateResistance,
        critDamageResistance: derived.critDamageResistance,
        weapons,
        buffs: [],
        shield: 0,
        tempShield: 0,
        marks: {},
        stacks: {},
    };
}

/**
 * 从 zd_parsed.teammate 构建队友战斗实体
 * @param {Object} zdTeammate - _zd_parsed.teammates[i]
 * @returns {Object} 队友战斗实体
 */
export function buildTeammateEntity(zdTeammate) {
    const stats = getTeammateActualStats({
        str: zdTeammate.str || 0,
        agi: zdTeammate.agi || 0,
        int: zdTeammate.int || 0,
        vit: zdTeammate.vit || 0,
        buffs: [],
    });
    const weapons = (zdTeammate.skills || []).map(s => normalizeWeapon(s, {})).filter(Boolean);

    return {
        name: zdTeammate.name || '队友',
        hp: zdTeammate.hp || 0,
        maxHp: zdTeammate.max_hp || 100,
        mp: zdTeammate.mp || 0,
        maxMp: zdTeammate.max_mp || 50,
        str: stats.str,
        agi: stats.agi,
        int: stats.int,
        vit: stats.end,
        speed: stats.speed,
        evasionRate: stats.evasionRate,
        damageBonus: stats.damageBonus,
        physicalReduction: stats.physicalReduction,
        damageTakenRate: stats.damageTakenRate,
        extraHitRate: stats.extraHitRate,
        extraCritRate: stats.extraCritRate,
        baseCritMultiplier: stats.baseCritMultiplier,
        critRateResistance: stats.critRateResistance,
        critDamageResistance: stats.critDamageResistance,
        weapons,
        buffs: [],
        shield: 0,
        tempShield: 0,
        marks: {},
        stacks: {},
        skills: weapons, // alias for action selection
    };
}

/**
 * 从 zd_parsed.enemy 构建敌人战斗实体
 * @param {Object} zdEnemy - _zd_parsed.enemies[i]
 * @returns {Object} 敌人战斗实体
 */
export function buildEnemyEntity(zdEnemy) {
    const stats = getEnemyActualStats({
        str: zdEnemy.str || 0,
        agi: zdEnemy.agi || 0,
        int: zdEnemy.int || 0,
        vit: zdEnemy.vit || 0,
        buffs: [],
    });

    const skills = (zdEnemy.skills || []).map(s => ({
        name: s.name || '攻击',
        attack: s.atk || 0,
        hitRate: s.hit || 0,
        critRate: s.crit || 0,
        attacksPerTurn: s.apt || 1,
        targetsPerAttack: s.tpa || 1,
        codes: Array.isArray(s.mn) ? s.mn.map(c => c.startsWith('MN:') ? c : `MN:${c}`) : [],
    }));

    return {
        name: zdEnemy.name || '敌人',
        hp: zdEnemy.hp || 0,
        maxHp: zdEnemy.max_hp || 100,
        level: zdEnemy.level || 1,
        str: stats.str,
        agi: stats.agi,
        int: stats.int,
        vit: stats.vit,
        speed: stats.speed,
        evasionRate: stats.evasionRate,
        damageBonus: stats.damageBonus,
        physicalReduction: stats.physicalReduction,
        damageTakenRate: stats.damageTakenRate,
        extraHitRate: stats.extraHitRate,
        extraCritRate: stats.extraCritRate,
        baseCritMultiplier: stats.baseCritMultiplier,
        critRateResistance: stats.critRateResistance,
        critDamageResistance: stats.critDamageResistance,
        skills,
        attackPattern: zdEnemy.attackPattern || [],
        nextAttackIndex: 0,
        buffs: [],
        marks: {},
        stacks: {},
    };
}

/**
 * 从消息文本中检测玩家使用的技能
 * @param {string} messageText - 消息文本
 * @param {Array} skills - zd_parsed.skills
 * @param {Object} player - 玩家战斗实体
 * @returns {Object|null} 匹配到的武器对象或 null（默认普攻）
 */
export function detectPlayerAction(messageText, skills, player) {
    if (!messageText || !player?.weapons?.length) return null;
    const text = messageText.toLowerCase();
    // 按名称匹配（最长匹配优先）
    let bestMatch = null;
    let bestLen = 0;
    for (const w of player.weapons) {
        if (w.currentCooldown > 0) continue; // 跳过冷却中的技能
        const name = (w.name || '').toLowerCase();
        if (name.length > bestLen && text.includes(name)) {
            bestMatch = w;
            bestLen = name.length;
        }
    }
    return bestMatch;
}

/**
 * 敌人技能选择（简化版：按 attackPattern 或随机选第一个可用技能）
 * @param {Object} enemy - 敌人战斗实体
 * @returns {Object|null} 选中的技能
 */
export function selectEnemySkill(enemy) {
    if (!enemy.skills || enemy.skills.length === 0) return null;
    // 按 attackPattern 选择
    if (enemy.attackPattern && enemy.attackPattern.length > 0) {
        const idx = enemy.nextAttackIndex % enemy.attackPattern.length;
        const patternName = enemy.attackPattern[idx];
        enemy.nextAttackIndex++;
        const found = enemy.skills.find(s => s.name === patternName);
        if (found) return found;
    }
    // fallback: 第一个技能
    return enemy.skills[0];
}

/**
 * 检查实体是否有指定 debuff — 已改用 battleCore.js 的 hasDebuff（更宽松：turns===undefined 视为有效）
 */

/**
 * 从装备栏聚合属性加成
 * @returns {Object} {str, agi, int, vit}
 */
export function getEquipmentStatsFromState() {
    const data = getSaoData();
    const equip = data?.state?.equipment;
    if (!equip) return { str: 0, agi: 0, int: 0, vit: 0 };
    let str = 0, agi = 0, int = 0, vit = 0;
    for (const slot of Object.values(equip)) {
        if (!slot || !slot.stats) continue;
        str += slot.stats.str || 0;
        agi += slot.stats.agi || 0;
        int += slot.stats.int || 0;
        vit += slot.stats.vit || 0;
    }
    return { str, agi, int, vit };
}

/**
 * 将冷却状态写回 state.skillCooldowns
 * @param {Object} player - 玩家战斗实体
 */
export function persistCooldowns(player) {
    if (!player?.weapons) return;
    const data = getSaoData();
    if (!data) return;
    if (!data.state) data.state = {};
    if (!data.state.skillCooldowns) data.state.skillCooldowns = {};
    // §5.8 Step 1: 先递减所有已有冷却条目（处理LLM遗漏的技能）
    for (const name of Object.keys(data.state.skillCooldowns)) {
        data.state.skillCooldowns[name]--;
        if (data.state.skillCooldowns[name] <= 0) {
            delete data.state.skillCooldowns[name];
        }
    }
    // Step 2: 用当前武器实际值覆盖
    for (const w of player.weapons) {
        if (w.currentCooldown > 0) {
            data.state.skillCooldowns[w.name] = w.currentCooldown;
        } else {
            delete data.state.skillCooldowns[w.name];
        }
    }
}

/**
 * 生成战斗结算叙事提示
 * @param {Object} player - 玩家战斗实体
 * @param {Array} enemies - 敌人实体数组
 * @param {Array} teammates - 队友实体数组
 * @param {Array} log - 战斗日志
 * @returns {string} 叙事提示字符串
 */
export function buildCombatNarrativeHint(player, enemies, teammates, log) {
    if (!log || log.length === 0) return '';

    // 从日志中提取关键信息
    const dmgEntries = [];
    const healEntries = [];
    for (const entry of log) {
        const dmgMatch = entry.match(/对(.+?)造成(\d+)点?伤害/);
        if (dmgMatch) dmgEntries.push({ target: dmgMatch[1], dmg: parseInt(dmgMatch[2]) });
        const healMatch = entry.match(/恢复了(\d+)点?(?:HP|生命)/);
        if (healMatch) healEntries.push({ heal: parseInt(healMatch[1]) });
    }

    // 构建简洁提示
    const parts = ['[上轮结算]'];
    if (dmgEntries.length > 0) {
        const d = dmgEntries[0];
        const target = enemies.find(e => e.name === d.target);
        const remainHp = target ? Math.max(0, target.hp) : '?';
        const maxHp = target ? target.maxHp : '?';
        parts.push(`你对${d.target}造成${d.dmg}伤害，${d.target}剩余HP:${remainHp}/${maxHp}`);
    }
    if (player.hp <= 0) {
        parts.push('你已倒下');
    }
    if (enemies.every(e => e.hp <= 0)) {
        parts.push('所有敌人已被击败');
    }
    // 玩家状态
    parts.push(`你的HP:${Math.max(0, player.hp)}/${player.maxHp},MP:${Math.max(0, player.mp)}/${player.maxMp}`);

    return parts.join('。');
}

// --- Battle Engine Core functions (§5.13 helper functions) ---

/**
 * 选择目标 — 已改用 battleCore.js 的 selectTargets
 */

/**
 * 对敌人施加伤害（含护盾吸收）（§5.13 applyDamageToEnemy）
 * @param {Object} target - 目标实体
 * @param {number} damage - 伤害值
 * @param {Array} log - 日志数组
 * @param {string} attackerName - 攻击者名称
 * @param {string} weaponName - 武器名称
 * @param {boolean} isCrit - 是否暴击
 */
export function applyDamageToEnemy(target, damage, log, attackerName, weaponName, isCrit) {
    let remaining = damage;
    // 正确顺序：临时护盾 → 永久护盾 → HP（与 battleCore.js 一致）
    if (remaining > 0 && (target.tempShield || target.shieldTemp) > 0) {
        const tempVal = target.tempShield || target.shieldTemp || 0;
        const absorbed = Math.min(tempVal, remaining);
        if (target.tempShield) target.tempShield -= absorbed;
        if (target.shieldTemp) target.shieldTemp -= absorbed;
        remaining -= absorbed;
        log.push(`${target.name} 的临时护盾吸收了 ${absorbed} 点伤害`);
    }
    if (remaining > 0 && target.shield > 0) {
        const absorbed = Math.min(target.shield, remaining);
        target.shield -= absorbed;
        remaining -= absorbed;
        log.push(`${target.name} 的护盾吸收了 ${absorbed} 点伤害`);
    }
    if (remaining > 0) {
        target.hp = Math.max(0, target.hp - remaining);
        const critStr = isCrit ? ' 暴击!' : '';
        log.push(`${attackerName} 使用 ${weaponName} 对 ${target.name} 造成 ${remaining} 点伤害${critStr} (剩余HP:${target.hp}/${target.maxHp || '?'})`);
    }
    return remaining;
}

/**
 * A1 标准攻击（apt×tpa 循环）（§5.13 executeStandardAttack）
 * @param {Object} player - 玩家实体
 * @param {Object} weapon - 武器对象（normalized）
 * @param {Array} enemies - 敌人数组
 * @param {Object} stats - getPlayerStatsCore 返回值
 * @param {Array} log - 日志数组
 */
export function executeStandardAttack(player, weapon, enemies, stats, log) {
    const targets = selectTargets(enemies, weapon.targetsPerAttack || 1);
    if (targets.length === 0) { log.push('无存活目标'); return; }
    for (let hit = 0; hit < (weapon.attacksPerTurn || 1); hit++) {
        for (const target of targets) {
            if (target.hp <= 0) continue;
            const targetStats = {
                evasionRate: target.evasionRate || 0,
                critRateResistance: target.critRateResistance || 0,
                critDamageResistance: target.critDamageResistance || 0,
                damageTakenRate: target.damageTakenRate || 1,
                physicalReduction: target.physicalReduction || 0,
            };
            const hitRate = calculateFinalHitRate(weapon.hitRate || 90, stats, targetStats);
            const isHit = Math.random() < hitRate;
            if (!isHit) { log.push(`${player.name} 的攻击未命中 ${target.name}`); continue; }
            const critRate = calculateFinalCritRate(weapon.critRate || 5, stats, targetStats, hitRate);
            const isCrit = Math.random() < critRate;
            const critMult = isCrit ? calculateFinalCritMultiplier(stats, targetStats, critRate) : 1.0;
            const damage = calculateFinalDamage(weapon.attack || 50, stats, targetStats, isCrit, critMult);
            applyDamageToEnemy(target, damage, log, player.name, weapon.name, isCrit);
            // Execute instant affixes after hit (B1/B7/B9/B15/B16/B17)
            executeAffixEffects(weapon, player, enemies, stats, log, 'instant', target, damage, isCrit);
        }
    }
}

// === A-class combat helpers (post-processing chain adapters) ===
// 注：以下函数为后处理链专用（扁平参数+直接 mutation）；逻辑与 battleCore.js 保持行为一致，差异仅在于返回 instruction 数组与否。

/**
 * A2 生命恢复核心（§5.3）
 */
function healCore(target, amount, isCrit, multiplier, log) {
    const heal = Math.floor(amount * (isCrit ? multiplier : 1.0));
    target.hp = Math.min(target.maxHp || target.hp + heal, (target.hp || 0) + heal);
    log.push(`恢复了 ${heal} 点HP${isCrit ? ' 暴击治疗!' : ''} (HP:${target.hp}/${target.maxHp || '?'})`);
}

/**
 * A3 法力恢复核心（§5.3）
 */
function manaRestoreCore(target, amount, isCrit, multiplier, log) {
    const restore = Math.floor(amount * (isCrit ? multiplier : 1.0));
    target.mp = Math.min(target.maxMp || target.mp + restore, (target.mp || 0) + restore);
    log.push(`恢复了 ${restore} 点MP${isCrit ? ' 暴击恢复!' : ''} (MP:${target.mp}/${target.maxMp || '?'})`);
}

/**
 * A4 牺牲增益核心（§5.3）
 */
function sacrificeBoostCore(player, weapon, log) {
    const cost = Math.floor((player.hp || 100) * 0.25);
    player.hp = Math.max(1, (player.hp || 100) - cost);
    player.sacrificeBoostActive = {
        attack: (weapon.attack || 50) * 0.5,
        hitRate: 20,
        critRate: 15,
        attacksPerTurn: 1,
        targetsPerAttack: 1,
    };
    log.push(`牺牲了 ${cost} HP 获得增益 (attack+${player.sacrificeBoostActive.attack}, hit+20%, crit+15%)`);
}

/**
 * A5 终结技·连续打击核心（§5.3）
 */
export function a5MultiHitCore(player, weapon, enemies, log) {
    let count = 0;
    let damageMultiplier = 1.0;
    while ((player.ap || 0) > 0 && enemies.some(e => e.hp > 0)) {
        const target = enemies.find(e => e.hp > 0);
        if (!target) break;

        // 每击独立命中判定
        const playerStats = {
            extraHitRate: player.extraHitRate || 0,
            extraCritRate: player.extraCritRate || 0,
            baseCritMultiplier: player.baseCritMultiplier || 1.5,
            damageBonus: player.damageBonus || 0,
        };
        const targetStats = {
            evasionRate: target.evasionRate || 0,
            critRateResistance: target.critRateResistance || 0,
            critDamageResistance: target.critDamageResistance || 0,
            damageTakenRate: target.damageTakenRate || 1,
            physicalReduction: target.physicalReduction || 0,
        };

        const hitRate = calculateFinalHitRate(weapon.hitRate || 90, playerStats, targetStats);
        if (Math.random() > hitRate) {
            log.push(`${weapon.name} 第${count + 1}击未命中 ${target.name}！(命中率:${(hitRate * 100).toFixed(1)}%)`);
            player.ap--;
            count++;
            damageMultiplier = Math.max(0.5, damageMultiplier - 0.1);
            continue;
        }

        // 每击独立暴击判定
        const critRate = calculateFinalCritRate(weapon.critRate || 5, playerStats, targetStats, hitRate);
        const isCrit = Math.random() <= critRate;
        const critMult = isCrit ? calculateFinalCritMultiplier(playerStats, targetStats, critRate) : 1.0;

        const baseDmg = Math.floor((weapon.attack || 50) * damageMultiplier);
        const damage = Math.floor(baseDmg * critMult);

        // 每击独立词缀触发（攻击词缀在 instant timing）
        if (weapon.codes && weapon.codes.some(c => c.startsWith('EN:'))) {
            executeAffixEffects(weapon, player, enemies, playerStats, log, 'instant', target, damage, isCrit);
        }

        applyDamageToEnemy(target, damage, log, player.name, weapon.name + `(${count + 1}击)`, isCrit);
        player.ap--;
        count++;
        damageMultiplier = Math.max(0.5, damageMultiplier - 0.1);
    }
    if (count === 0) {
        // 没有 AP 时仍执行一次
        const target = enemies.find(e => e.hp > 0);
        if (target) {
            const damage = Math.floor((weapon.attack || 50) * 0.8);
            applyDamageToEnemy(target, damage, log, player.name, weapon.name + '(终结)', false);
            count = 1;
        }
    }
    log.push(`${weapon.name} 连击 ${count} 次`);
}

/**
 * 执行词缀效果（§5.4.3 executeAffixEffects）
 * @param {Object} weapon - 武器对象
 * @param {Object} player - 玩家实体
 * @param {Array} enemies - 敌人数组
 * @param {Object} stats - 玩家计算属性
 * @param {Array} log - 日志数组
 * @param {string} timing - 时机：'instant'|'persistent'|'debuff'|'buff'|'shield'
 * @param {Object} target - 目标（可选）
 * @param {number} damage - 伤害（可选）
 * @param {boolean} isCrit - 是否暴击
 */
function executeAffixEffects(weapon, player, enemies, stats, log, timing, target, damage, isCrit) {
    const codes = weapon.codes || [];
    for (const code of codes) {
        if (!code.startsWith('EN:B')) continue;
        const args = resolveAffixArgs(code, weapon);
        const effectCode = code.split(',')[0].replace(/^EN:/, '');
        applyAffixEffect(effectCode, args, player, enemies, stats, log, timing, target, damage, isCrit);
    }
}

/**
 * 应用单个词缀效果（§5.4.3 applyAffixEffect，B1-B22 完整执行链）
 */
function applyAffixEffect(effectCode, args, player, enemies, stats, log, timing, target, damage, isCrit) {
    const TIMING_MAP = {
        'instant': ['B1', 'B7', 'B9', 'B15', 'B16', 'B17'],
        'persistent': ['B5', 'B10', 'B18', 'B22'],
        'debuff': ['B2', 'B4', 'B6', 'B8', 'B19'],
        'buff': ['B3', 'B11', 'B12', 'B13', 'B14'],
        'shield': ['B20', 'B21'],
    };
    let effectTiming = null;
    for (const [t, codes] of Object.entries(TIMING_MAP)) {
        if (codes.includes(effectCode)) { effectTiming = t; break; }
    }
    if (!effectTiming || effectTiming !== timing) return;

    switch (effectCode) {
        case 'B1': // 生命窃取
            if (damage > 0) {
                const heal = Math.floor(damage * (args[0] || 5) / 100);
                player.hp = Math.min(player.maxHp || 9999, (player.hp || 0) + heal);
                log.push(`生命窃取: 恢复 ${heal} HP`);
            }
            break;
        case 'B7': // 概率追加伤害
            if (Math.random() < ((args[0] || 15) / 100) && target) {
                const bonusDmg = Math.floor(damage * (args[1] || 10) / 100);
                applyDamageToEnemy(target, bonusDmg, log, player.name, '额外伤害', false);
            }
            break;
        case 'B9': // 法力恢复
            player.mp = Math.min(player.maxMp || 9999, (player.mp || 0) + (args[0] || 3));
            log.push(`法力恢复: +${args[0] || 3} MP`);
            break;
        case 'B15': // 易伤标记
            if (target) {
                target.vulnerabilityMark = (target.vulnerabilityMark || 0) + (args[0] || 10);
                log.push(`标记 ${target.name} 易伤 +${args[0] || 10}%`);
            }
            break;
        case 'B16': // 破绽标记
            if (target) {
                target.weaknessMark = (target.weaknessMark || 0) + (args[0] || 10);
                log.push(`标记 ${target.name} 破绽 +${args[0] || 10}%`);
            }
            break;
        case 'B17': // 死点标记
            if (target) {
                target.deathMark = (target.deathMark || 0) + (args[0] || 15);
                log.push(`标记 ${target.name} 死点 +${args[0] || 15}%`);
            }
            break;
        case 'B2': // 命中降低
            if (target) {
                target.buffs = target.buffs || [];
                target.buffs.push({type: 'hitRateDebuff', turns: args[0] || 2, value: args[1] || 10});
                log.push(`${target.name} 命中降低 ${args[1] || 10}% 持续 ${args[0] || 2} 回合`);
            }
            break;
        case 'B3': // 暴击提升
            player.buffs = player.buffs || [];
            player.buffs.push({type: 'critBoost', turns: args[0] || 2, value: args[1] || 8});
            log.push(`暴击提升 ${args[1] || 8}% 持续 ${args[0] || 2} 回合`);
            break;
        case 'B4': // 冰冻（晕眩）
            if (target) {
                target.buffs = target.buffs || [];
                target.buffs.push({type: 'stun', turns: args[0] || 1});
                log.push(`${target.name} 被晕眩 ${args[0] || 1} 回合`);
            }
            break;
        case 'B6': // 概率冰冻
            if (target && Math.random() < (args[0] || 10) / 100) {
                target.buffs = target.buffs || [];
                target.buffs.push({type: 'stun', turns: args[1] || 1});
                log.push(`${target.name} 被晕眩 ${args[1] || 1} 回合`);
            }
            break;
        case 'B8': // 易伤
            if (target) {
                target.buffs = target.buffs || [];
                target.buffs.push({type: 'vulnerability', turns: args[0] || 2, value: args[1] || 10});
                log.push(`${target.name} 易伤 ${args[1] || 10}% 持续 ${args[0] || 2} 回合`);
            }
            break;
        case 'B11': // 力量提升
            player.buffs = player.buffs || [];
            player.buffs.push({type: 'strBoost', turns: args[0] || 2, value: args[1] || 2});
            log.push(`力量提升 ${args[1] || 2} 持续 ${args[0] || 2} 回合`);
            break;
        case 'B12': // 敏捷提升
            player.buffs = player.buffs || [];
            player.buffs.push({type: 'agiBoost', turns: args[0] || 2, value: args[1] || 2});
            log.push(`敏捷提升 ${args[1] || 2} 持续 ${args[0] || 2} 回合`);
            break;
        case 'B13': // 智力提升
            player.buffs = player.buffs || [];
            player.buffs.push({type: 'intBoost', turns: args[0] || 2, value: args[1] || 2});
            log.push(`智力提升 ${args[1] || 2} 持续 ${args[0] || 2} 回合`);
            break;
        case 'B14': // 耐力提升
            player.buffs = player.buffs || [];
            player.buffs.push({type: 'endBoost', turns: args[0] || 2, value: args[1] || 2});
            log.push(`耐力提升 ${args[1] || 2} 持续 ${args[0] || 2} 回合`);
            break;
        case 'B19': // 腐蚀叠加
            if (target) {
                target.corrosionStacks = (target.corrosionStacks || 0) + 1;
                target.corrosionPercent = (target.corrosionPercent || 0) + (args[1] || 3);
                log.push(`${target.name} 腐蚀 ${target.corrosionStacks}层 (${target.corrosionPercent}%)`);
            }
            break;
        case 'B20': // 永久护盾
            player.shield = (player.shield || 0) + (args[0] || 20);
            log.push(`获得 ${args[0] || 20} 点永久护盾`);
            break;
        case 'B21': // 临时护盾
            player.tempShield = (player.tempShield || 0) + (args[0] || 30);
            log.push(`获得 ${args[0] || 30} 点临时护盾`);
            break;
        // B5/B10/B18/B22 are persistent effects handled by processEndOfRoundCore via processEnchantmentEffectsCore
    }
}

/**
 * 完整版：执行玩家行动（§5.12 executePlayerActionCore，含 A1-A5 路由）
 */
export function executePlayerActionCore(player, skill, enemies, teammates, log, stateUpdates) {
    const stats = getPlayerStatsCore(player, player.buffs || [], player.equipmentStats || {});
    let activeWeapon = skill ? normalizeWeapon(skill, player._skillCooldowns || {}) : null;

    const normalAttackTemplate = {
        name: '普通攻击',
        attack: stats.str || 50,
        hitRate: 90,
        critRate: 5,
        attacksPerTurn: 1,
        targetsPerAttack: 1,
        mpCost: 0,
        cooldown: 0,
        currentCooldown: 0,
        codes: [],
        wn: 'A1',
    };

    if (activeWeapon) {
        if (activeWeapon.mpCost > 0 && player.mp < activeWeapon.mpCost) {
            log.push(`MP不足(${player.mp}/${activeWeapon.mpCost})，使用普通攻击`);
            activeWeapon = normalAttackTemplate;
        } else if (activeWeapon.currentCooldown > 0) {
            log.push(`技能冷却中(${activeWeapon.currentCooldown}回合)，使用普通攻击`);
            activeWeapon = normalAttackTemplate;
        } else {
            if (activeWeapon.mpCost > 0) player.mp -= activeWeapon.mpCost;
            if (activeWeapon.cooldown > 0) activeWeapon.currentCooldown = activeWeapon.cooldown;
        }
    } else {
        activeWeapon = normalAttackTemplate;
    }

    // Apply sacrificeBoostActive stat bonuses (§5.13 step 6a)
    if (player.sacrificeBoostActive) {
        const boost = player.sacrificeBoostActive;
        const boostedStats = {
            ...stats,
            damageBonus: (stats.damageBonus || 0) + (boost.attack || 0) / 100,
            extraHitRate: (stats.extraHitRate || 0) + (boost.hitRate || 0) / 100,
            extraCritRate: (stats.extraCritRate || 0) + (boost.critRate || 0) / 100,
        };
        // Route by core code (wn)
        const wn = activeWeapon.wn || 'A1';
        switch (wn) {
            case 'A2': healCore(player, activeWeapon.attack, false, 1.0, log); break;
            case 'A3': manaRestoreCore(player, activeWeapon.attack, false, 1.0, log); break;
            case 'A4': sacrificeBoostCore(player, activeWeapon, log); break;
            case 'A5': a5MultiHitCore(player, activeWeapon, enemies, log); break;
            default: case 'A1': executeStandardAttack(player, activeWeapon, enemies, boostedStats, log); break;
        }
    } else {
        // Route by core code (wn)
        const wn = activeWeapon.wn || 'A1';
        switch (wn) {
            case 'A2': healCore(player, activeWeapon.attack, false, 1.0, log); break;
            case 'A3': manaRestoreCore(player, activeWeapon.attack, false, 1.0, log); break;
            case 'A4': sacrificeBoostCore(player, activeWeapon, log); break;
            case 'A5': a5MultiHitCore(player, activeWeapon, enemies, log); break;
            default: case 'A1': executeStandardAttack(player, activeWeapon, enemies, stats, log); break;
        }
    }

    // Execute affix effects (buff/debuff/shield timing)
    executeAffixEffects(activeWeapon, player, enemies, stats, log, 'buff', null, 0, false);
    executeAffixEffects(activeWeapon, player, enemies, stats, log, 'debuff', enemies[0] || null, 0, false);
    executeAffixEffects(activeWeapon, player, enemies, stats, log, 'shield', null, 0, false);

    // P4c: Custom handler hook
    if (activeWeapon._customHandler) {
        activeWeapon._customHandler(player, activeWeapon, enemies, log);
    }
}

/**
 * 简化版：执行队友攻击（对第一个存活敌人）
 * NOTE: Simplified single-hit version for post-processing chain.
 */
export function executeTeammateAttackCore(teammate, enemies, log) {
    const target = enemies.find(e => e.hp > 0);
    if (!target) return;

    const weapon = teammate.weapons?.[0];
    if (!weapon) return;

    // MP 检查：MP不足则跳过攻击
    const mpCost = weapon.mpCost || weapon.mp_cost || 0;
    if ((teammate.mp || 0) < mpCost) {
        log.push(`${teammate.name} MP不足，无法使用 ${weapon.name}！`);
        return;
    }
    // 扣除 MP
    if (mpCost > 0) {
        teammate.mp -= mpCost;
        log.push(`${teammate.name} 消耗 ${mpCost} 点MP，剩余 ${teammate.mp}`);
    }

    const targetStats = {
        evasionRate: target.evasionRate || 0,
        critRateResistance: target.critRateResistance || 0,
        critDamageResistance: target.critDamageResistance || 0,
        damageTakenRate: target.damageTakenRate || 1,
        physicalReduction: target.physicalReduction || 0,
    };
    const attackerStats = {
        extraHitRate: teammate.extraHitRate || 0,
        extraCritRate: teammate.extraCritRate || 0,
        baseCritMultiplier: teammate.baseCritMultiplier || 1.5,
        damageBonus: teammate.damageBonus || 0,
    };

    // apt 多击循环：每击独立命中判定
    const apt = weapon.apt || 1;
    for (let hit = 0; hit < apt; hit++) {
        if (target.hp <= 0) break;

        const finalHitRate = calculateFinalHitRate(weapon.hitRate, attackerStats, targetStats);
        if (Math.random() > finalHitRate) {
            log.push(`${teammate.name} 攻击 ${target.name} 第${hit + 1}击未命中！`);
            continue;
        }

        const finalCritRate = calculateFinalCritRate(weapon.critRate, attackerStats, targetStats, finalHitRate);
        const isCrit = Math.random() <= finalCritRate;
        const critMultiplier = isCrit
            ? calculateFinalCritMultiplier(attackerStats, targetStats, finalCritRate)
            : 1.0;

        let damage = calculateFinalDamage(weapon.attack, attackerStats, targetStats, isCrit, critMultiplier);

        // 腐蚀层加成：若目标有 corrosion stacks，伤害加成
        if (target.stacks && target.stacks.corrosion) {
            const corrosionData = target.stacks.corrosion;
            const corrosionCount = typeof corrosionData === 'object' ? (corrosionData.count || 0) : corrosionData;
            const bonusPerStack = typeof corrosionData === 'object' ? (corrosionData.bonusPerStack || 5) : 5;
            const totalCorrosionBonus = corrosionCount * bonusPerStack;
            const bonusDamage = Math.floor(damage * (totalCorrosionBonus / 100));
            damage += bonusDamage;
            if (bonusDamage > 0) {
                log.push(`腐蚀效果！${corrosionCount} 层腐蚀（${bonusPerStack}%/层）额外造成 ${bonusDamage} 点伤害（+${totalCorrosionBonus}%）！`);
            }
        }

        target.hp = Math.max(0, target.hp - damage);

        const critText = isCrit ? '（暴击！）' : '';
        const hitLabel = apt > 1 ? ` 第${hit + 1}击` : '';
        log.push(`${teammate.name} 使用 ${weapon.name}${hitLabel} 对 ${target.name} 造成 ${damage} 点伤害${critText}，${target.name} HP:${target.hp}/${target.maxHp}`);
    }
}

/**
 * 完整版：执行敌人行动（§5.5 performEnemyActionCore，含晕眩/燃烧/attackPattern/M1-M10 怪物技能）
 * NOTE: This post-processing-chain version uses hasDebuff('stun') + burnOverTime buff model.
 */
export function performEnemyActionCore(enemy, player, teammates, log) {
    if (enemy.hp <= 0) return;

    // Stun check（保留 buff 数组模型，不改 stun 模型）
    if (hasDebuff(enemy, 'stun')) {
        log.push(`${enemy.name} 被晕眩，无法行动`);
        return;
    }

    // Burn DoT — 改用 burnOverTime buff 模型（与 processEndOfRoundCore 的 dot 处理对齐）
    const burnBuffs = (enemy.buffs || []).filter(b => b.type === 'burnOverTime');
    if (burnBuffs.length > 0) {
        let totalBurn = 0;
        for (const b of burnBuffs) totalBurn += (b.value || 0);
        if (totalBurn > 0) {
            enemy.hp = Math.max(0, enemy.hp - totalBurn);
            log.push(`${enemy.name} 受到余烬效果，损失 ${totalBurn} 点生命值！`);
            if (enemy.hp <= 0) { log.push(`${enemy.name} 被余烬效果击败！`); return; }
        }
    }

    // 攻击模式选择：优先用 attackPattern 循环
    let skill = null;
    if (enemy.attackPattern && enemy.attackPattern.length > 0 && enemy.skills) {
        const idx = (enemy.nextAttackIndex || 0) % enemy.attackPattern.length;
        const patternName = enemy.attackPattern[idx];
        enemy.nextAttackIndex = idx + 1;
        skill = enemy.skills.find(s => s.name === patternName) || null;
    }
    if (!skill) skill = selectEnemySkill(enemy);
    if (!skill) return;

    log.push(`${enemy.name} 使用 ${skill.name} 攻击！`);

    // Target selection: 随机选取 player 或 teammate
    const possibleTargets = [];
    if (player.hp > 0) possibleTargets.push({ type: 'player', entity: player, name: player.name || '玩家' });
    for (const t of (teammates || [])) {
        if (t.hp > 0) possibleTargets.push({ type: 'teammate', entity: t, name: t.name });
    }
    if (possibleTargets.length === 0) return;

    const maxTargets = skill.targetsPerAttack || 1;
    const shuffled = possibleTargets.slice().sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, maxTargets);

    const attackerStats = {
        extraHitRate: enemy.extraHitRate || 0,
        extraCritRate: enemy.extraCritRate || 0,
        baseCritMultiplier: enemy.baseCritMultiplier || 1.5,
        damageBonus: enemy.damageBonus || 0,
    };

    for (const tInfo of targets) {
        const target = tInfo.entity;
        const targetStats = {
            evasionRate: target.evasionRate || 0,
            critRateResistance: target.critRateResistance || 0,
            critDamageResistance: target.critDamageResistance || 0,
            damageTakenRate: target.damageTakenRate || 1,
            physicalReduction: target.physicalReduction || 0,
        };

        const finalHitRate = calculateFinalHitRate(skill.hitRate || 70, attackerStats, targetStats);
        if (Math.random() > finalHitRate) {
            log.push(`${enemy.name} 使用 ${skill.name} 攻击 ${tInfo.name}，未命中！`);
            continue;
        }

        const finalCritRate = calculateFinalCritRate(skill.critRate || 5, attackerStats, targetStats, finalHitRate);
        const isCrit = Math.random() < finalCritRate;
        const critMultiplier = isCrit
            ? calculateFinalCritMultiplier(attackerStats, targetStats, finalCritRate)
            : 1.0;

        const damage = calculateFinalDamage(skill.attack || 30, attackerStats, targetStats, isCrit, critMultiplier);

        if (isCrit) {
            log.push(`暴击！造成 ${damage} 点伤害！(暴击率:${(finalCritRate * 100).toFixed(1)}%, 倍率:${critMultiplier.toFixed(2)}x)`);
        }

        // === M1-M10 怪物技能处理 ===
        if (skill.codes && skill.codes.length > 0) {
            for (const code of skill.codes) {
                if (!code.startsWith('MN:M')) continue;
                const mMatch = code.match(/MN:(M\d+),(.+)/);
                if (!mMatch) continue;
                const effectType = mMatch[1];
                const mParams = mMatch[2].split(',');
                const targetBuffs = target.buffs || (target.buffs = []);

                switch (effectType) {
                    case 'M1': { // 吸血：造成伤害后 enemy 回血
                        const healAmt = Math.floor(damage * (parseFloat(mParams[0]) / 100));
                        enemy.hp = Math.min((enemy.hp || 0) + healAmt, enemy.maxHp || 9999);
                        log.push(`【怪物特效】吸血攻击！${enemy.name} 恢复 ${healAmt} 点生命值！`);
                        break;
                    }
                    case 'M2': { // DoT：推 dot buff 到 target
                        targetBuffs.push({ name: '持续伤害', type: 'dot', value: parseInt(mParams[1]), duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        log.push(`【怪物特效】持续伤害！${tInfo.name} 受到诅咒 ${mParams[0]} 回合！`);
                        break;
                    }
                    case 'M3': { // str debuff
                        const val = parseInt(mParams[1]);
                        targetBuffs.push({ name: '力量削弱', type: 'strDebuff', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        target.str = Math.max(1, (target.str || 0) - val);
                        log.push(`【怪物特效】力量削弱！${tInfo.name} 力量降低 ${val} 点！`);
                        break;
                    }
                    case 'M4': { // agi debuff
                        const val = parseInt(mParams[1]);
                        targetBuffs.push({ name: '敏捷削弱', type: 'agiDebuff', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        target.agi = Math.max(1, (target.agi || 0) - val);
                        log.push(`【怪物特效】敏捷削弱！${tInfo.name} 敏捷降低 ${val} 点！`);
                        break;
                    }
                    case 'M5': { // mana burn
                        const val = parseInt(mParams[1]);
                        targetBuffs.push({ name: '法力燃烧', type: 'manaBurn', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        log.push(`【怪物特效】法力燃烧！${tInfo.name} 将持续损失法力 ${mParams[0]} 回合！`);
                        break;
                    }
                    case 'M6': { // int debuff
                        const val = parseInt(mParams[1]);
                        targetBuffs.push({ name: '智力削弱', type: 'intDebuff', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        target.int = Math.max(1, (target.int || 0) - val);
                        log.push(`【怪物特效】智力削弱！${tInfo.name} 智力降低 ${val} 点！`);
                        break;
                    }
                    case 'M7': { // vit debuff
                        const val = parseInt(mParams[1]);
                        targetBuffs.push({ name: '耐力削弱', type: 'vitDebuff', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: false });
                        target.vit = Math.max(1, (target.vit || 0) - val);
                        log.push(`【怪物特效】耐力削弱！${tInfo.name} 耐力降低 ${val} 点！`);
                        break;
                    }
                    case 'M8': { // agi self-buff
                        const val = parseInt(mParams[1]);
                        if (!enemy.buffs) enemy.buffs = [];
                        enemy.buffs.push({ name: '敏捷强化', type: 'agiBoost', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: true });
                        enemy.agi = (enemy.agi || 0) + val;
                        log.push(`【怪物特效】敏捷强化！${enemy.name} 敏捷提升 ${val} 点！`);
                        break;
                    }
                    case 'M9': { // healOverTime self-buff
                        const val = parseInt(mParams[1]);
                        if (!enemy.buffs) enemy.buffs = [];
                        enemy.buffs.push({ name: '持续再生', type: 'healOverTime', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: true });
                        log.push(`【怪物特效】持续再生！${enemy.name} 将在 ${mParams[0]} 回合内每回合恢复 ${val} 点HP！`);
                        break;
                    }
                    case 'M10': { // str self-buff
                        const val = parseInt(mParams[1]);
                        if (!enemy.buffs) enemy.buffs = [];
                        enemy.buffs.push({ name: '力量强化', type: 'strBoost', value: val, duration: parseInt(mParams[0]), turns: parseInt(mParams[0]), isPositive: true });
                        enemy.str = (enemy.str || 0) + val;
                        log.push(`【怪物特效】力量强化！${enemy.name} 力量提升 ${val} 点！`);
                        break;
                    }
                }
            }
        }

        // Apply damage with shield absorption（tempShield → shield → HP，复用 applyDamageToEnemy）
        applyDamageToEnemy(target, damage, log, enemy.name, skill.name, isCrit);
    }
}

/**
 * 完整版：回合结束处理（§5.12 processEndOfRoundCore）
 * DoT/HoT/SoT + buff 递减 + 牺牲增益清理 + 护盾过期 + HP/MP 恢复 + 冷却递减
 */
export function processEndOfRoundCore(player, enemies, teammates, log) {
    // 1. DoT (B5/B18) on enemies + trauma stacks (ported from battleCore.js:936)
    for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const dotBuff = (enemy.buffs || []).find(b => b.type === 'dot');
        if (dotBuff) {
            enemy.hp = Math.max(0, enemy.hp - dotBuff.value);
            log.push(`${enemy.name} 受到持续伤害 ${dotBuff.value} 点，HP:${enemy.hp}`);
        }
        // Trauma stack damage (B18, ported from battleCore.js:953)
        if (enemy.stacks && enemy.stacks.trauma) {
            const traumaData = enemy.stacks.trauma;
            const traumaCount = typeof traumaData === 'object' ? (traumaData.count || 0) : traumaData;
            const damagePerStack = typeof traumaData === 'object' ? (traumaData.damagePerStack || 3) : 3;
            const traumaDamage = traumaCount * damagePerStack;
            if (traumaDamage > 0) {
                enemy.hp = Math.max(0, enemy.hp - traumaDamage);
                log.push(`${enemy.name} 受到创伤伤害 ${traumaDamage} 点（${traumaCount} 层 x ${damagePerStack} 点/层），HP:${enemy.hp}`);
            }
        }
    }

    // 1b. DoT + manaBurn on player and teammates (ported from battleCore.js:912)
    const allAllies = [player, ...teammates];
    for (const ally of allAllies) {
        for (const buff of (ally.buffs || [])) {
            if (buff.type === 'dot') {
                ally.hp = Math.max(0, ally.hp - buff.value);
                log.push(`${ally.name || '玩家'} 受到持续伤害 ${buff.value} 点，HP:${ally.hp}`);
            }
            if (buff.type === 'manaBurn') {
                const oldMp = ally.mp || 0;
                ally.mp = Math.max(0, oldMp - buff.value);
                const actualLoss = oldMp - ally.mp;
                if (actualLoss > 0) {
                    log.push(`${ally.name || '玩家'} 法力燃烧！损失 ${actualLoss} 点MP！`);
                }
            }
        }
    }

    // 2. HoT (B10) — 玩家 + 队友 + 敌人 healOverTime
    const hotBuff = (player.buffs || []).find(b => b.type === 'healOverTime');
    if (hotBuff && hotBuff.value > 0) {
        player.hp = Math.min(player.maxHp || 9999, player.hp + hotBuff.value);
        log.push(`${player.name} 持续恢复 ${hotBuff.value} 点HP (HP:${player.hp}/${player.maxHp || '?'})`);
    }
    for (const t of teammates) {
        const tHot = (t.buffs || []).find(b => b.type === 'healOverTime');
        if (tHot && tHot.value > 0) {
            t.hp = Math.min(t.maxHp || 9999, t.hp + tHot.value);
            log.push(`${t.name} 持续恢复 ${tHot.value} 点HP`);
        }
    }
    // 敌人 healOverTime（与 battleCore.js line 957-962 对齐）
    for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        const eHot = (enemy.buffs || []).find(b => b.type === 'healOverTime');
        if (eHot && eHot.value > 0) {
            const oldHp = enemy.hp;
            enemy.hp = Math.min(enemy.hp + eHot.value, enemy.maxHp || 9999);
            const healed = enemy.hp - oldHp;
            if (healed > 0) log.push(`${enemy.name} 持续再生恢复 ${healed} 点HP (HP:${enemy.hp}/${enemy.maxHp || '?'})`);
        }
    }

    // 3. Shield over time (B22)
    const sotBuff = (player.buffs || []).find(b => b.type === 'shieldOverTime');
    if (sotBuff && sotBuff.value > 0) {
        player.shield = (player.shield || 0) + sotBuff.value;
        log.push(`${player.name} 获得 ${sotBuff.value} 点护盾`);
    }

    // 4. Clear expired temp shields (B21)
    if (player.tempShieldTurns !== undefined) {
        player.tempShieldTurns--;
        if (player.tempShieldTurns <= 0) {
            player.tempShield = 0;
            log.push('临时护盾过期');
        }
    }

    // 5. Decrement buff turns/duration for all entities (含 stat 恢复)
    const decrementAndClean = (entity) => {
        if (!entity.buffs) return;
        entity.buffs = entity.buffs.filter(b => {
            if (b.turns !== undefined) {
                b.turns--;
                if (b.turns <= 0) {
                    // stat 降 debuff 过期时恢复属性
                    if (b.type === 'strDebuff') entity.str = (entity.str || 0) + (b.value || 0);
                    if (b.type === 'agiDebuff') entity.agi = (entity.agi || 0) + (b.value || 0);
                    if (b.type === 'intDebuff') entity.int = (entity.int || 0) + (b.value || 0);
                    if (b.type === 'vitDebuff') entity.vit = (entity.vit || 0) + (b.value || 0);
                    // stat buff 过期时回退加成
                    if (b.type === 'strBoost') entity.str = Math.max(1, (entity.str || 0) - (b.value || 0));
                    if (b.type === 'agiBoost') entity.agi = Math.max(1, (entity.agi || 0) - (b.value || 0));
                    return false;
                }
                return true;
            }
            if (b.duration !== undefined) {
                b.duration--;
                if (b.duration <= 0) {
                    if (b.type === 'strDebuff') entity.str = (entity.str || 0) + (b.value || 0);
                    if (b.type === 'agiDebuff') entity.agi = (entity.agi || 0) + (b.value || 0);
                    if (b.type === 'intDebuff') entity.int = (entity.int || 0) + (b.value || 0);
                    if (b.type === 'vitDebuff') entity.vit = (entity.vit || 0) + (b.value || 0);
                    if (b.type === 'strBoost') entity.str = Math.max(1, (entity.str || 0) - (b.value || 0));
                    if (b.type === 'agiBoost') entity.agi = Math.max(1, (entity.agi || 0) - (b.value || 0));
                    return false;
                }
                return true;
            }
            return true;
        });
    };
    decrementAndClean(player);
    enemies.forEach(decrementAndClean);
    teammates.forEach(decrementAndClean);

    // 6. Clear sacrificeBoostActive (§5.13 step 6b)
    if (player.sacrificeBoostActive) {
        player.sacrificeBoostActive = null;
        log.push('牺牲增益效果结束');
    }

    // CD decrement handled by persistCooldowns() in resolveCombatRound — do not double-decrement here

    // 8. HP/MP natural regen
    if (player.hp > 0) {
        const stats = getPlayerStatsCore(player, player.buffs || [], player.equipmentStats || {});
        if (stats.hpRegen) {
            player.hp = Math.min(player.maxHp || 9999, player.hp + stats.hpRegen);
        }
        if (stats.mpRegen) {
            player.mp = Math.min(player.maxMp || 9999, player.mp + stats.mpRegen);
        }
    }

    // 9. Teammate HP/MP regen（与 battleCore.js line 1030-1035 对齐）
    for (const tm of teammates) {
        if (tm.hp <= 0) continue;
        const tmHpRegen = tm.hpRegen || 0;
        const tmMpRegen = tm.mpRegen || 0;
        if (tmHpRegen > 0) {
            tm.hp = Math.min(tm.maxHp || 9999, tm.hp + tmHpRegen);
        }
        if (tmMpRegen > 0) {
            tm.mp = Math.min(tm.maxMp || 9999, (tm.mp || 0) + tmMpRegen);
        }
    }
}

/**
 * resolveCombatRound — 主入口：从 _zd_parsed 解析并执行一个战斗回合
 * @param {string} messageText - 消息文本（用于检测玩家技能选择）
 * @returns {Object|null} combatResult 或 null（无战斗数据时）
 */
export function resolveCombatRound(messageText) {
    const data = getSaoData();
    const zd = data?.state?._zd_parsed;
    if (!zd?.player || !zd?.enemies?.length) {
        return null; // 无战斗数据，no-op
    }

    const roundLog = [];
    const stateUpdates = {};

    // 构建实体
    const player = buildPlayerEntity(zd.player, zd.skills, getEquipmentStatsFromState());
    const teammates = (zd.teammates || []).map(t => buildTeammateEntity(t));
    const enemies = zd.enemies.filter(e => e.hp > 0).map(e => buildEnemyEntity(e));

    if (enemies.length === 0) {
        return {
            log: ['无存活敌人'],
            stateUpdates,
            playerAfter: { hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp },
            enemiesAfter: [],
            teammatesAfter: teammates.map(t => ({ name: t.name, hp: t.hp, maxHp: t.maxHp })),
            narrativeHint: '',
        };
    }

    // 检测玩家行动
    const playerSkill = detectPlayerAction(messageText, zd.skills, player);

    // 构建参与者列表
    const allEntities = [
        { type: 'player', id: 'player', name: player.name, entity: player, speed: player.speed, skill: playerSkill },
        ...teammates.map((t, i) => ({
            type: 'teammate', id: `teammate-${i}`, name: t.name, entity: t, speed: t.speed, skill: t.skills?.[0] || null,
        })),
        ...enemies.map((e, i) => ({
            type: 'enemy', id: `enemy-${i}`, name: e.name, entity: e, speed: e.speed, skill: selectEnemySkill(e),
        })),
    ];

    // 按速度排序
    const actionOrder = calculateActionOrderCore(allEntities);

    // 执行回合
    for (const actor of actionOrder) {
        const entity = actor.entity;
        if (entity.hp <= 0) continue; // 已死亡跳过

        if (hasDebuff(entity, 'stun')) {
            roundLog.push(`${entity.name} 被晕眩，无法行动`);
            continue;
        }

        try {
            if (actor.type === 'player') {
                executePlayerActionCore(player, actor.skill, enemies, teammates, roundLog, stateUpdates);
            } else if (actor.type === 'teammate') {
                executeTeammateAttackCore(entity, enemies, roundLog);
            } else if (actor.type === 'enemy') {
                performEnemyActionCore(entity, player, teammates, roundLog);
            }
        } catch (e) {
            roundLog.push(`[异常] ${entity.name} 行动失败: ${e.message}`);
        }

        // 检查战斗结束条件
        if (enemies.every(e => e.hp <= 0)) { roundLog.push('所有敌人已被击败！'); break; }
        if (player.hp <= 0) { roundLog.push('玩家倒下了...'); break; }
    }

    // 回合结束处理
    processEndOfRoundCore(player, enemies, teammates, roundLog);

    // 持久化冷却
    persistCooldowns(player);

    // 同步 zd 数据回 state（HP/MP 变化）
    if (data.state && zd.player) {
        zd.player.hp = Math.max(0, player.hp);
        zd.player.mp = Math.max(0, player.mp);
    }
    // 同步敌人 HP
    for (let i = 0; i < zd.enemies.length; i++) {
        const zdEnemy = zd.enemies[i];
        const combatEnemy = enemies.find(e => e.name === zdEnemy.name);
        if (combatEnemy) {
            zdEnemy.hp = Math.max(0, combatEnemy.hp);
        }
    }
    // 同步队友 HP
    for (let i = 0; i < (zd.teammates || []).length; i++) {
        const zdTm = zd.teammates[i];
        const combatTm = teammates.find(t => t.name === zdTm.name);
        if (combatTm) {
            zdTm.hp = Math.max(0, combatTm.hp);
        }
    }

    // 构建叙事提示
    const narrativeHint = buildCombatNarrativeHint(player, enemies, teammates, roundLog);

    return {
        playerAfter: { hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp },
        enemiesAfter: enemies.map(e => ({ name: e.name, hp: Math.max(0, e.hp), maxHp: e.maxHp, defeated: e.hp <= 0 })),
        teammatesAfter: teammates.map(t => ({ name: t.name, hp: t.hp, maxHp: t.maxHp })),
        narrativeHint,
        log: roundLog,
        stateUpdates,
    };
}