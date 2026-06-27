// sao-skills.js — 自定义技能系统
// 技能定义表 + 解锁检查 + 查找 + 通知 + 移除

import { getSaoData, saveSaoDataNow, log } from './sao-core.js';

// === 自定义技能定义 ===
/**
 * 自定义技能定义表（运行时常量）
 * state.customSkills 只存 ID 数组（不存完整对象，因为函数无法序列化到 chatMetadata）
 * 运行时通过此表查找完整定义
 */
export const CUSTOM_SKILL_DEFS = {
    'starburst_stream': {
        name: '星爆气流斩',
        _custom: true,
        weapon_type: '双剑',
        skill_level: 50,
        rarity: '紫色',
        atk: 350, hit: 92, crit: 25, apt: 16, tpa: 1,
        mp_cost: 45, cooldown: 5, wn: 'A1',
        affix_codes: ['EN:B1,15', 'EN:B5,3,30'],
        _customHandler: function(player, skill, enemies, log) {
            const target = enemies.find(e => e.hp > 0);
            if (!target) return;
            const bonusDmg = Math.floor(skill.atk * 0.5);
            target.hp -= Math.max(1, bonusDmg - (target.str || 0));
            log.push('星爆气流斩·双重打击：追加伤害！');
        },
        _unlock: { type: 'floor', floor: 75, arc: 'sao' },
        description: '双刀流奥义——十六连击的究极剑技。',
        effects_description: '生命窃取15% | 持续伤害3回合x30点 | 命中后追加50%ATK伤害',
    },
};

// === 技能查找 ===
/**
 * 按名称查找技能（优先自定义技能，再查常规技能）
 * @param {string} name - 技能名称
 * @param {Object} state - data.state
 * @returns {Object|null} 技能定义或 null
 */
export function findSkillByName(name, state) {
    // 1. Custom skills first (already acquired)
    for (const id of (state.customSkills || [])) {
        const def = CUSTOM_SKILL_DEFS[id];
        if (def && def.name === name) return def;
    }
    // 2. Regular skills
    return (state.skills || []).find(s => s.name === name) || null;
}

// === 获得通知 ===
/**
 * 技能获取通知
 * @param {Object} def - CUSTOM_SKILL_DEFS 中的技能定义
 */
export function injectSkillAcquisition(def) {
    if (typeof toastr !== 'undefined') {
        toastr.success(`获得技能：${def.name}`, 'SAO Companion');
    }
    log(`[技能获取] ${def.name} — ${def.description}`);
}

// === 解锁检查 ===
/**
 * 检查自定义技能解锁条件
 * 在 MESSAGE_RECEIVED 中 extractAll/applyExtractedData 之后调用
 * @param {string} messageText - 当前消息文本（用于 keyword 类型解锁）
 */
export function checkCustomSkillUnlocks(messageText) {
    const data = getSaoData();
    if (!data?.state) return;
    if (!data.state.customSkills) data.state.customSkills = [];
    const alreadyHas = new Set(data.state.customSkills);
    for (const [id, def] of Object.entries(CUSTOM_SKILL_DEFS)) {
        if (alreadyHas.has(id)) continue;
        let unlocked = false;
        switch (def._unlock.type) {
            case 'floor': unlocked = data.state.floor >= def._unlock.floor; break;
            case 'chapter': unlocked = data.arc === def._unlock.arc; break;
            case 'keyword': unlocked = messageText.includes(def._unlock.keyword); break;
            case 'manual': unlocked = false; break;
            // TODO: implement grantCustomSkill(skillId) + window.SAO.grantCustomSkill (per architecture doc 6.6.1) when the first manual-type custom skill is added to CUSTOM_SKILL_DEFS.
        }
        if (unlocked) {
            data.state.customSkills.push(id); // store ID only, not full def
            log(`获得自定义技能: ${def.name}`);
            injectSkillAcquisition(def);
        }
    }
}

// === 移除技能 ===
/**
 * 移除已解锁的自定义技能
 * @param {string} skillId - CUSTOM_SKILL_DEFS 中的技能 ID
 */
export function removeCustomSkill(skillId) {
    const data = getSaoData();
    if (!data?.state?.customSkills) return;
    data.state.customSkills = data.state.customSkills.filter(id => id !== skillId);
    saveSaoDataNow();
}

// TODO: grantCustomSkill — 待首个 manual 类型自定义技能加入时实现
