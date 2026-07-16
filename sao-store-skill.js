// sao-store-skill.js — 技能定义权威库
// 技能是定义（非玩家状态），同名=同一技能。
// combat 字段使用简写命名（atk/hit/crit/apt/tpa/mpCost）。

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

    // === 必填字段校验（仅新建时，更新路径跳过） ===
    const RARITY_ENUM = ['common', 'uncommon', 'rare', 'epic'];
    if (!skillData.weapon_type || typeof skillData.weapon_type !== 'string') {
        log('findOrCreateSkill: 必填字段 weapon_type 缺失或非法', 'warn');
        return null;
    }
    if (!skillData.rarity || !RARITY_ENUM.includes(skillData.rarity)) {
        log('findOrCreateSkill: 必填字段 rarity 缺失或非法 (需为 ' + RARITY_ENUM.join('|') + ')', 'warn');
        return null;
    }
    if (!skillData.category || typeof skillData.category !== 'string' || skillData.category.length === 0) {
        log('findOrCreateSkill: 必填字段 category 缺失或为空', 'warn');
        return null;
    }
    if (!skillData.combat || typeof skillData.combat !== 'object') {
        log('findOrCreateSkill: 必填字段 combat 缺失或非法', 'warn');
        return null;
    }
    const c = skillData.combat;
    if (typeof c.atk !== 'number' || c.atk < 0) {
        log('findOrCreateSkill: combat.atk 必须为 >=0 的数字', 'warn');
        return null;
    }
    if (typeof c.hit !== 'number' || c.hit < 0 || c.hit > 100) {
        log('findOrCreateSkill: combat.hit 必须为 0-100 的数字', 'warn');
        return null;
    }
    if (typeof c.crit !== 'number' || c.crit < 0 || c.crit > 100) {
        log('findOrCreateSkill: combat.crit 必须为 0-100 的数字', 'warn');
        return null;
    }
    if (typeof c.apt !== 'number' || c.apt < 1) {
        log('findOrCreateSkill: combat.apt 必须为 >=1 的数字', 'warn');
        return null;
    }
    if (typeof c.tpa !== 'number' || c.tpa < 1) {
        log('findOrCreateSkill: combat.tpa 必须为 >=1 的数字', 'warn');
        return null;
    }
    if (typeof c.mpCost !== 'number' || c.mpCost < 0) {
        log('findOrCreateSkill: combat.mpCost 必须为 >=0 的数字', 'warn');
        return null;
    }
    if (!skillData.effects || typeof skillData.effects !== 'object') {
        log('findOrCreateSkill: 必填字段 effects 缺失或非法', 'warn');
        return null;
    }
    if (!skillData.effects.wn || typeof skillData.effects.wn !== 'string' || skillData.effects.wn.length === 0) {
        log('findOrCreateSkill: effects.wn 必须为非空字符串', 'warn');
        return null;
    }
    if (!Array.isArray(skillData.effects.en)) {
        log('findOrCreateSkill: effects.en 必须为数组', 'warn');
        return null;
    }
    if (!skillData.description || typeof skillData.description !== 'string' || skillData.description.length === 0) {
        log('findOrCreateSkill: 必填字段 description 缺失或为空', 'warn');
        return null;
    }
    if (!skillData.source || typeof skillData.source !== 'string' || skillData.source.length === 0) {
        log('findOrCreateSkill: 必填字段 source 缺失或为空', 'warn');
        return null;
    }

    // 创建新条目
    const id = generateSkillId(name);
    const entry = {
        skill_id: id,
        name: name,
        rarity: skillData.rarity,
        category: skillData.category,
        weapon_type: skillData.weapon_type,
        combat: skillData.combat,
        effects: skillData.effects,
        description: skillData.description,
        source: skillData.source
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
 * 从 skillStore 彻底删除技能定义（byId + nameToId）。
 * @param {string} skillId
 * @param {boolean} skipSave
 * @returns {boolean} 是否删除成功
 */
export function removeSkill(skillId, skipSave) {
    const store = getSkillStore();
    const skill = store.byId[skillId];
    if (!skill) {
        log(`removeSkill: ${skillId} 不存在`, 'warn');
        return false;
    }
    delete store.byId[skillId];
    if (store.nameToId[skill.name]) {
        delete store.nameToId[skill.name];
    }
    log(`技能删除: ${skill.name} (${skillId})`);
    if (skipSave !== true) saveStore();
    return true;
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

    // weapon_type: 必填，非空 string
    if (typeof data.weapon_type !== 'string' || data.weapon_type.length === 0) {
        errors.push('weapon_type 必填且为非空字符串');
    }

    // rarity: 必填，枚举校验
    const RARITY_ENUM = ['common', 'uncommon', 'rare', 'epic'];
    if (!data.rarity || !RARITY_ENUM.includes(data.rarity)) {
        errors.push(`rarity 必填且为 ${RARITY_ENUM.join('|')} 之一`);
    }

    // combat: 必填，必须是对象
    if (!data.combat || typeof data.combat !== 'object') {
        errors.push('combat 必填且必须是对象');
    } else {
        // combat 子字段全部必填
        if (typeof data.combat.atk !== 'number' || data.combat.atk < 0) {
            errors.push('combat.atk 必填且为 >=0 的数字');
        }
        if (typeof data.combat.hit !== 'number' || data.combat.hit < 0 || data.combat.hit > 100) {
            errors.push('combat.hit 必填且为 0-100 的数字');
        }
        if (typeof data.combat.crit !== 'number' || data.combat.crit < 0 || data.combat.crit > 100) {
            errors.push('combat.crit 必填且为 0-100 的数字');
        }
        if (typeof data.combat.apt !== 'number' || data.combat.apt < 1) {
            errors.push('combat.apt 必填且为 >=1 的数字');
        }
        if (typeof data.combat.tpa !== 'number' || data.combat.tpa < 1) {
            errors.push('combat.tpa 必填且为 >=1 的数字');
        }
        if (typeof data.combat.mpCost !== 'number' || data.combat.mpCost < 0) {
            errors.push('combat.mpCost 必填且为 >=0 的数字');
        }
    }

    // effects: 必填，必须是对象
    if (!data.effects || typeof data.effects !== 'object') {
        errors.push('effects 必填且必须是对象');
    } else {
        // effects.wn: 必填，非空字符串
        if (!data.effects.wn || typeof data.effects.wn !== 'string' || data.effects.wn.length === 0) {
            errors.push('effects.wn 必填且为非空字符串');
        }
        // effects.en: 必填，必须是数组（可为空）
        if (!Array.isArray(data.effects.en)) {
            errors.push('effects.en 必填且必须是数组');
        }
    }

    // description: 必填，非空字符串
    if (typeof data.description !== 'string' || data.description.length === 0) {
        errors.push('description 必填且为非空字符串');
    }

    // source: 必填，非空字符串
    if (typeof data.source !== 'string' || data.source.length === 0) {
        errors.push('source 必填且为非空字符串');
    }

    // category: 必填，非空字符串
    if (typeof data.category !== 'string' || data.category.length === 0) {
        errors.push('category 必填且为非空字符串');
    }

    return { valid: errors.length === 0, errors };
}
