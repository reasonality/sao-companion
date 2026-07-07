// sao-store-equipment.js — 装备定义/实例权威库
// 同名装备可有多件实例（每件独立 ID）。
// slot 使用新命名：weapon | off_hand | head | chest | hands | legs | accessory
// statType：str | agi | int | vit | all
// combat 字段使用简写命名，由 combat 层 normalizeWeapon 映射。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';

// ============================================================
// 常量
// ============================================================

export const SLOT_ENUM = ['weapon', 'off_hand', 'head', 'chest', 'hands', 'legs', 'accessory'];
const STAT_TYPE_ENUM = ['str', 'agi', 'int', 'vit', 'all'];
const RARITY_ENUM = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 equipmentStore 引用（惰性初始化）。
 * @returns {{ byId: Object, nameToId: Object }}
 */
export function getEquipmentStore() {
    const store = getStore();
    if (!store.equipmentStore) {
        store.equipmentStore = { byId: {}, nameToId: {} };
    }
    if (!store.equipmentStore.byId) store.equipmentStore.byId = {};
    if (!store.equipmentStore.nameToId) store.equipmentStore.nameToId = {};
    return store.equipmentStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 生成装备 ID（自增数字，格式 equip_001）。
 * 解析已有 ID 找最大数字后缀 +1，宽度 3 位。
 * @returns {string}
 */
export function generateEquipmentId() {
    const store = getEquipmentStore();
    let maxNum = 0;
    for (const id of Object.keys(store.byId)) {
        const match = id.match(/^equip_(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    return 'equip_' + String(next).padStart(3, '0');
}

/**
 * 查找或创建装备条目。
 * 1. 按 name 在 nameToId 查找
 * 2. 单件匹配 → 直接返回该 ID
 * 3. 多件匹配 → findBestMatch 按属性相似度取最接近
 * 4. 无匹配 → 创建新条目，写入 byId + nameToId
 * 不自动加入 inventoryStore。
 * @param {object} equipData - 装备数据（至少含 name）
 * @returns {string} equipment_id
 */
export function findOrCreateEquipment(equipData) {
    const store = getEquipmentStore();
    const { name } = equipData;
    if (!name) {
        log('findOrCreateEquipment: 缺少 name', 'warn');
        return null;
    }
    // 防御：空槽位占位词不应创建装备条目
    const PLACEHOLDER_NAMES = ['无', '空', '[空]', 'なし', 'none', '空き', '未装备', '未知'];
    if (PLACEHOLDER_NAMES.includes(name.trim())) {
        log(`findOrCreateEquipment: 跳过占位装备名 "${name}"`, 'warn');
        return null;
    }

    const existingIds = store.nameToId[name];
    if (existingIds && existingIds.length > 0) {
        // 过滤掉已不存在的 ID
        const validIds = existingIds.filter(id => store.byId[id]);
        if (validIds.length === 1) {
            return validIds[0];
        } else if (validIds.length > 1) {
            return findBestMatch(equipData, validIds);
        }
    }

    // 创建新条目
    const id = generateEquipmentId();
    const entry = {
        equipment_id: id,
        name: name,
        slot: equipData.slot || 'weapon',
        weapon_type: equipData.weapon_type || null,
        statType: equipData.statType || 'all',
        rarity: equipData.rarity || 'common',
        item_level: equipData.item_level || 1,
        durability: equipData.durability || { current: 100, max: 100 },
        stats: equipData.stats || { atk: 0, str: 0, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0, hit: 0, crit: 0 },
        affixes: equipData.affixes || [],
        description: equipData.description || '',
        source: equipData.source || 'specialist'
    };

    store.byId[id] = entry;

    // nameToId 值为数组（同名多件）
    if (!store.nameToId[name]) {
        store.nameToId[name] = [];
    }
    store.nameToId[name].push(id);

    log(`装备创建: ${name} → ${id}`);
    return id;
}

/**
 * 从候选 ID 列表中按属性相似度选出最匹配的装备。
 * 打分：item_level 差异 + stats 各字段绝对差异之和。分越低越匹配。
 * @param {object} equipData - 目标装备数据
 * @param {string[]} candidateIds - 候选 equipment_id 列表
 * @returns {string} 最佳匹配的 equipment_id
 */
export function findBestMatch(equipData, candidateIds) {
    const store = getEquipmentStore();
    let bestId = candidateIds[0];
    let bestScore = Infinity;

    for (const id of candidateIds) {
        const candidate = store.byId[id];
        if (!candidate) continue;

        let score = 0;

        // item_level 差异（权重 x2）
        if (equipData.item_level != null && candidate.item_level != null) {
            score += Math.abs(equipData.item_level - candidate.item_level) * 2;
        }

        // stats 各字段绝对差异
        const STAT_FIELDS = ['atk', 'str', 'agi', 'int', 'vit', 'maxHp', 'maxMp', 'hit', 'crit'];
        if (equipData.stats && candidate.stats) {
            for (const f of STAT_FIELDS) {
                const a = equipData.stats[f] || 0;
                const b = candidate.stats[f] || 0;
                score += Math.abs(a - b);
            }
        }

        if (score < bestScore) {
            bestScore = score;
            bestId = id;
        }
    }

    return bestId;
}

/**
 * 按 ID 获取装备条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getEquipmentById(id) {
    const store = getEquipmentStore();
    return store.byId[id] || null;
}

/**
 * 从 equipmentStore 销毁装备定义（byId + nameToId）。
 * 跨引用校验：已穿戴装备不允许销毁（return false）。
 * @param {string} equipmentId
 * @param {boolean} skipSave
 * @returns {Promise<boolean>} 是否销毁成功
 */
export async function removeEquipmentById(equipmentId, skipSave) {
    const store = getEquipmentStore();
    const equip = store.byId[equipmentId];
    if (!equip) {
        log(`removeEquipmentById: ${equipmentId} 不存在`, 'warn');
        return false;
    }
    // 跨引用校验：检查是否已穿戴
    const playerStore = getStore().playerStore;
    if (playerStore?.equipment) {
        for (const slot of Object.keys(playerStore.equipment)) {
            if (playerStore.equipment[slot] === equipmentId) {
                log(`removeEquipmentById: ${equipmentId} 已穿戴于 ${slot}，拒绝销毁`, 'warn');
                return false;
            }
        }
    }
    // 从 byId 删除
    delete store.byId[equipmentId];
    // 从 nameToId 删除（值为数组，同名多件）
    const name = equip.name;
    if (name && store.nameToId[name]) {
        const ids = store.nameToId[name];
        if (Array.isArray(ids)) {
            const filtered = ids.filter(id => id !== equipmentId);
            if (filtered.length === 0) {
                delete store.nameToId[name];
            } else {
                store.nameToId[name] = filtered;
            }
        } else if (ids === equipmentId) {
            delete store.nameToId[name];
        }
    }
    if (skipSave !== true) await saveStore();
    log(`装备销毁: ${equipmentId} (${name})`);
    return true;
}

/**
 * 校验装备条目数据。
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
// Exported for test use only
export function validateEquipmentEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // equipment_id
    if (typeof data.equipment_id !== 'string' || data.equipment_id.length === 0) {
        errors.push('equipment_id 必须是非空字符串');
    }

    // name
    if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push('name 必须是非空字符串');
    }

    // slot 枚举
    if (data.slot != null && !SLOT_ENUM.includes(data.slot)) {
        errors.push(`slot 必须是 ${SLOT_ENUM.join('|')} 之一`);
    }

    // statType 枚举
    if (data.statType != null && !STAT_TYPE_ENUM.includes(data.statType)) {
        errors.push(`statType 必须是 ${STAT_TYPE_ENUM.join('|')} 之一`);
    }

    // rarity 枚举
    if (data.rarity != null && !RARITY_ENUM.includes(data.rarity)) {
        errors.push(`rarity 必须是 ${RARITY_ENUM.join('|')} 之一`);
    }

    // item_level
    if (data.item_level != null && (typeof data.item_level !== 'number' || data.item_level < 1)) {
        errors.push('item_level 必须是 >= 1 的数字');
    }

    // stats
    if (data.stats != null && typeof data.stats !== 'object') {
        errors.push('stats 必须是对象');
    }

    return { valid: errors.length === 0, errors };
}
