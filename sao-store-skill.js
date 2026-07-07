// sao-store-skill.js — 技能定义权威库
// 技能是定义（非玩家状态），同名=同一技能。
// combat 字段使用简写命名（atk/hit/crit/apt/tpa/mpCost/cd）。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';
import { simpleHash } from './sao-store-npc.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 skillStore 引用（惰性初始化）。
 * @returns {{ byId: Object, nameToId: Object }}
 */
export function getSkillStore() {
    const store = getStore();
    if (!store.skillStore) {
        store.skillStore = { byId: {}, nameToId: {} };
    }
    if (!store.skillStore.byId) store.skillStore.byId = {};
    if (!store.skillStore.nameToId) store.skillStore.nameToId = {};
    return store.skillStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 基于技能名称生成唯一 ID（slug）。
 * ASCII 名称：skill_ + 小写 + 非字母数字替换为下划线 + 合并连续下划线。
 * 非 ASCII 名称（如中文）：skill_h + simpleHash(name)（基于名称哈希，幂等避免同毫秒碰撞）。
 * 幂等：若 slug 已存在于 byId，返回已有 ID。
 * @param {string} name
 * @returns {string}
 */
export function generateSkillId(name) {
    const store = getSkillStore();

    // 尝试 ASCII slug
    const isAscii = /^[\x20-\x7e]+$/.test(name);
    let slug;
    if (isAscii) {
        slug = 'skill_' + name.toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    } else {
        slug = 'skill_h' + simpleHash(name);
    }

    // 幂等：slug 已存在则返回
    if (store.byId[slug]) {
        return slug;
    }

    return slug;
}

/**
 * 查找或创建技能条目。
 * 按 name 在 nameToId 查找：找到则更新 combat/effects 字段（最新状态定义）；
 * 找不到则创建新条目写入 byId + nameToId。
 * @param {object} skillData - 技能数据（至少含 name，可选 combat/effects/rarity 等）
 * @returns {string} skill_id
 */
export function findOrCreateSkill(skillData) {
    const store = getSkillStore();
    const { name } = skillData;
    if (!name) {
        log('findOrCreateSkill: 缺少 name', 'warn');
        return null;
    }

    const existingId = store.nameToId[name];
    if (existingId && store.byId[existingId]) {
        // 更新 combat/effects（最新状态定义覆盖）
        const existing = store.byId[existingId];
        if (skillData.combat) {
            existing.combat = { ...existing.combat, ...skillData.combat };
        }
        if (skillData.effects) {
            existing.effects = { ...existing.effects, ...skillData.effects };
        }
        // 可选字段也更新
        if (skillData.rarity) existing.rarity = skillData.rarity;
        if (skillData.description) existing.description = skillData.description;
        if (skillData.category) existing.category = skillData.category;
        if (skillData.weapon_type) existing.weapon_type = skillData.weapon_type;
        return existingId;
    }

    // 创建新条目
    const id = generateSkillId(name);
    const entry = {
        skill_id: id,
        name: name,
        rarity: skillData.rarity || 'common',
        category: skillData.category || null,
        weapon_type: skillData.weapon_type || null,
        combat: skillData.combat || { atk: 0, hit: 0, crit: 0, apt: 1, tpa: 1, mpCost: 0, cd: 0 },
        // L9: schema 要求 effects.wn 为 string；用 '' 兜底避免 null 违反 schema（投影层对空字符串渲染为空）。
        effects: skillData.effects || { wn: '', en: [], mn: [] },
        description: skillData.description || '',
        source: skillData.source || 'specialist'
    };

    store.byId[id] = entry;
    store.nameToId[name] = id;
    log(`技能创建: ${name} → ${id}`);
    return id;
}

/**
 * 按 ID 获取技能条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getSkillById(id) {
    const store = getSkillStore();
    return store.byId[id] || null;
}

/**
 * 按名称获取技能条目。
 * @param {string} name
 * @returns {object|null}
 */
export function getSkillByName(name) {
    const store = getSkillStore();
    const id = store.nameToId[name];
    return id ? (store.byId[id] || null) : null;
}

/**
 * 校验技能条目数据。
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
// Exported for test use only
export function validateSkillEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // skill_id: 必须是 string
    if (typeof data.skill_id !== 'string' || data.skill_id.length === 0) {
        errors.push('skill_id 必须是非空字符串');
    }

    // name: 必须是非空 string
    if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push('name 必须是非空字符串');
    }

    // rarity: 枚举校验
    const RARITY_ENUM = ['common', 'uncommon', 'rare', 'epic'];
    if (data.rarity != null && !RARITY_ENUM.includes(data.rarity)) {
        errors.push(`rarity 必须是 ${RARITY_ENUM.join('|')} 之一`);
    }

    // combat: 若存在，字段必须是 number
    if (data.combat != null) {
        if (typeof data.combat !== 'object') {
            errors.push('combat 必须是对象');
        } else {
            const COMBAT_NUM_FIELDS = ['atk', 'hit', 'crit', 'apt', 'tpa', 'mpCost', 'cd'];
            for (const f of COMBAT_NUM_FIELDS) {
                if (data.combat[f] != null && typeof data.combat[f] !== 'number') {
                    errors.push(`combat.${f} 必须是数字`);
                }
            }
        }
    }

    // effects: 若存在，必须是对象
    if (data.effects != null && typeof data.effects !== 'object') {
        errors.push('effects 必须是对象');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 更新技能 combat 字段（normalize 层调用，当 status 专家输出更新值时）。
 * @param {string} skillId
 * @param {object} combatData - 部分或全部 combat 字段
 * @returns {boolean} 是否更新成功
 */
export async function updateSkillCombat(skillId, combatData, skipSave) {
    const store = getSkillStore();
    const skill = store.byId[skillId];
    if (!skill) {
        log(`updateSkillCombat: 技能 ${skillId} 不存在`, 'warn');
        return false;
    }

    if (!combatData || typeof combatData !== 'object') {
        log('updateSkillCombat: combatData 无效', 'warn');
        return false;
    }

    skill.combat = { ...skill.combat, ...combatData };
    if (skipSave !== true) await saveStore();
    log(`技能 combat 更新: ${skillId}`);
    return true;
}
