// sao-skills.js — 自定义技能系统
// 技能定义表 + 解锁检查 + 查找 + 通知 + 移除

import { getSaoData, log } from './sao-core.js';
import { getPlayerStore, setCustomSkills } from './sao-store-player.js';

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
        _unlock: { type: 'floor', floor: 75 },
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
function findSkillByName(name, state) {
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
function injectSkillAcquisition(def) {
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
    const player = getPlayerStore();
    if (!player) return;
    if (!player.customSkills) player.customSkills = [];
    const alreadyHas = new Set(player.customSkills);
    for (const [id, def] of Object.entries(CUSTOM_SKILL_DEFS)) {
        if (alreadyHas.has(id)) continue;
        let unlocked = false;
        switch (def._unlock.type) {
            case 'floor': {
                const floorVal = typeof player.position.floor_id === 'number' 
                    ? player.position.floor_id 
                    : (parseInt(String(player.position.floor_id || '').replace(/\D/g, '')) || 0);
                unlocked = floorVal >= def._unlock.floor; 
                break;
            }
            case 'keyword': unlocked = messageText.includes(def._unlock.keyword); break;
        }
        if (unlocked) {
            player.customSkills.push(id); // store ID only, not full def
            log(`获得自定义技能: ${def.name}`);
            injectSkillAcquisition(def);
        }
    }
}
