// sao-skills.js — 自定义技能系统
// 技能定义表 + 解锁检查 + 查找 + 通知 + 移除

import { getSaoData, log } from './sao-core.js';
import { getPlayerStore, setCustomSkills, getUniqueSkill, setUniqueSkill } from './sao-store-player.js';
export { getUniqueSkill };

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
        _unlock: { type: 'floor', floor: 75 },
        description: '双刀流奥义——十六连击的究极剑技。',
    },
};

// === 月蚀独特技能定义 ===
/**
 * 月蚀子技元数据（运行时常量）
 * 现梦通过冥想熟练度 ≥500 解锁；其余通过等级解锁。
 */
export const LUNAR_ECLIPSE_DEFS = {
    genmu: {
        name: '现梦', nameEn: 'Genmu', unlockType: 'meditation', unlockValue: 500,
        hits: 4, description: '模式读取+反击。2秒预知窗内敌方必失手，4连击弱点+30%伤害。闭眼一瞬→银线描出敌方攻击轨迹→步入其中绘新月。',
    },
    tsuki_no_shizuku: {
        name: '月之滴', nameEn: 'Tsuki no Shizuku', unlockType: 'level', unlockValue: 10,
        hits: 1, description: '弱点单发。忽略50%防御必爆，Boss+100%伤害。剑尖凝一滴月光→垂直落下→触点放射碎裂纹。',
    },
    mangekyou: {
        name: '星夜万华镜', nameEn: 'Hoshiya Mangekyou', unlockType: 'level', unlockValue: 20,
        hits: 12, description: '多目标几何。6敌×2击链式弱点，AoE+单体混合。旋转→万华镜折射→穿敌如针过布→身后凝成星座图。',
    },
    kami_no_inori: {
        name: '神明的祈祷', nameEn: 'Kami no Inori', unlockType: 'level', unlockValue: 30,
        hits: 0, description: '完美防御+队Buff。5米区6秒队友-40%伤害+20%命中，自身不动。跪地插剑→银线辐射计算网格→队友见引导线。',
    },
    shisou_rennai: {
        name: '死奏怜音', nameEn: 'Shisou Rennai', unlockType: 'level', unlockValue: 40,
        hits: 9, description: '精算致命+怜悯。9击恰好致死不过杀，存活则敌-30%攻速5秒。葬礼行进节奏每击一音成和弦末音如安魂曲。',
    },
    sanzen_sekai: {
        name: '三千世界', nameEn: 'Sanzen Sekai', unlockType: 'level', unlockValue: 50,
        hits: 27, description: '现实改写。算尽三千平行现实选胜路27击忽略100%防御4秒无敌。时间停→世界碎成三千现实→她同时在各处出手→归一。副作用：释放后陷入无法战斗状态（计算过载），持续至下次长休息或HP恢复满。',
    },
};

/** 子技 ID → 等级映射（checkUniqueSkillUnlocks 用） */
const SUB_TECH_LEVEL_MAP = {
    tsuki_no_shizuku: 10,
    mangekyou: 20,
    kami_no_inori: 30,
    shisou_rennai: 40,
    sanzen_sekai: 50,
};

/** 视觉阶段标签（buffLevel 1-6） */
const VISUAL_STAGES = ['淡月光迹', '新月', '上弦月', '半月', '近满月', '满月'];

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
            case 'meditation': {
                const medProf = getPlayerStore()?.meditationProficiency || 0;
                unlocked = medProf >= def._unlock.proficiency;
                break;
            }
            case 'level': {
                const playerLevel = getPlayerStore()?.progression?.level || 1;
                unlocked = playerLevel >= def._unlock.level;
                break;
            }
        }
        if (unlocked) {
            player.customSkills.push(id); // store ID only, not full def
            log(`获得自定义技能: ${def.name}`);
            injectSkillAcquisition(def);
        }
    }
}

// === 月蚀独特技能解锁 ===
/**
 * 检查月蚀独特技能的子技解锁。
 * 每次消息后调用（紧跟 checkCustomSkillUnlocks）。
 * @returns {string[]} 本轮新解锁的子技名称数组（用于通知/日志）
 */
export function checkUniqueSkillUnlocks() {
    const player = getPlayerStore();
    if (!player) return [];

    const calendarStore = getSaoData()?.calendarStore;
    const currentDate = calendarStore?.currentDate || '';
    const playerLevel = player.progression?.level || 1;
    const medProf = player.meditationProficiency || 0;
    const newlyUnlocked = [];

    // --- 现梦：冥想熟练度 ≥ 500 ---
    if (!player.uniqueSkill) {
        if (medProf >= 500) {
            // 首次解锁：创建 uniqueSkill 对象
            player.uniqueSkill = {
                id: 'lunar_eclipse',
                name: '月蚀',
                title: '碎月',
                buffLevel: 1,
                subTechniques: {
                    genmu:            { name: '现梦', proficiency: 0, unlocked: true, unlockedAt: currentDate },
                    tsuki_no_shizuku: { name: '月之滴', proficiency: 0, unlocked: false, unlockedAt: null },
                    mangekyou:        { name: '星夜万华镜', proficiency: 0, unlocked: false, unlockedAt: null },
                    kami_no_inori:    { name: '神明的祈祷', proficiency: 0, unlocked: false, unlockedAt: null },
                    shisou_rennai:    { name: '死奏怜音', proficiency: 0, unlocked: false, unlockedAt: null },
                    sanzen_sekai:     { name: '三千世界', proficiency: 0, unlocked: false, unlockedAt: null },
                },
            };
            newlyUnlocked.push('现梦');
            log('[月蚀] 现梦 解锁 — 碎月 称号获得，月蝕の残光 +10%');
        }
    } else {
        // uniqueSkill 已存在，检查等级子技
        for (const [techId, reqLevel] of Object.entries(SUB_TECH_LEVEL_MAP)) {
            const tech = player.uniqueSkill.subTechniques[techId];
            if (!tech || tech.unlocked) continue;
            if (playerLevel >= reqLevel) {
                tech.unlocked = true;
                tech.unlockedAt = currentDate;
                newlyUnlocked.push(tech.name);
                log(`[月蚀] ${tech.name} 解锁 (Lv.${reqLevel})`);
            }
        }

        // 更新 buffLevel = 已解锁子技数量
        const unlockedCount = Object.values(player.uniqueSkill.subTechniques)
            .filter(t => t.unlocked).length;
        player.uniqueSkill.buffLevel = unlockedCount;

        if (newlyUnlocked.length > 0) {
            log(`[月蚀] 月蝕の残光 更新: +${unlockedCount * 10}% (${unlockedCount}/6层)`);
        }
    }

    return newlyUnlocked;
}

/**
 * 获取月蚀 buff 等级和百分比。
 * @returns {{ buffLevel: number, buffPercent: number }} buffLevel 0-6, buffPercent 0-60
 */
export function getUniqueSkillBuffLevel() {
    const us = getUniqueSkill();
    if (!us) return { buffLevel: 0, buffPercent: 0 };
    const level = us.buffLevel || 0;
    return { buffLevel: level, buffPercent: level * 10 };
}

/**
 * 获取当前视觉阶段标签（用于投影）。
 * @param {number} buffLevel - 0-6
 * @returns {string} 视觉阶段中文名
 */
export function getVisualStage(buffLevel) {
    if (buffLevel <= 0) return '';
    return VISUAL_STAGES[Math.min(buffLevel, VISUAL_STAGES.length) - 1];
}
