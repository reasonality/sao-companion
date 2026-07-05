// sao-store-consumable.js — 消耗品定义库 + useConsumable
// 沿用 equipmentStore/skillStore 的 byId+nameToId 模式。
// 消耗品是定义（非实例），同名=同消耗品。

import { getStore, saveStore, appendActionLog } from './sao-store-core.js';
import { log } from './sao-core.js';
import { getInventoryStore, generateItemId } from './sao-store-inventory.js';
import { getPlayerStore, updatePlayerVitals, updatePlayerAttributes } from './sao-store-player.js';

// ============================================================
// 常量
// ============================================================

const CATEGORY_ENUM = ['hp_restore', 'mp_restore', 'full_restore', 'buff', 'cure'];
const RARITY_ENUM = ['common', 'uncommon', 'rare', 'epic'];
const EFFECT_TYPE_ENUM = ['restore', 'buff', 'cure'];
const STAT_ENUM = ['hp', 'mp', 'str', 'agi', 'int', 'vit'];

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 consumableStore 及其子字段存在，返回引用。
 * @returns {{ byId: Object, nameToId: Object }}
 */
function ensureConsumableStore() {
    const store = getStore();
    if (!store.consumableStore) {
        store.consumableStore = { byId: {}, nameToId: {} };
    }
    if (!store.consumableStore.byId) store.consumableStore.byId = {};
    if (!store.consumableStore.nameToId) store.consumableStore.nameToId = {};
    return store.consumableStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 consumableStore 引用（惰性初始化）。
 * @returns {{ byId: Object, nameToId: Object }}
 */
export function getConsumableStore() {
    return ensureConsumableStore();
}

/**
 * 生成消耗品 ID（自增数字，格式 consumable_001）。
 * 解析已有 ID 找最大数字后缀 +1，宽度 3 位。
 * @returns {string}
 */
export function generateConsumableId() {
    const store = ensureConsumableStore();
    let maxNum = 0;
    for (const id of Object.keys(store.byId)) {
        const match = id.match(/^consumable_(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    return 'consumable_' + String(next).padStart(3, '0');
}

/**
 * 按 ID 获取消耗品条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getConsumableById(id) {
    const store = ensureConsumableStore();
    return store.byId[id] || null;
}

/**
 * 查找或创建消耗品条目。
 * 按 name 在 nameToId 查找：找到则返回已有 ID；
 * 找不到则创建新条目写入 byId + nameToId。
 * @param {object} data - 消耗品数据（至少含 name）
 * @returns {string} consumable_id
 */
export function findOrCreateConsumable(data) {
    const store = ensureConsumableStore();
    const { name } = data;
    if (!name) {
        log('findOrCreateConsumable: 缺少 name', 'warn');
        return null;
    }

    const existingId = store.nameToId[name];
    if (existingId && store.byId[existingId]) {
        return existingId;
    }

    // 创建新条目
    const id = generateConsumableId();
    const entry = {
        consumable_id: id,
        name: name,
        category: data.category || 'hp_restore',
        rarity: data.rarity || 'common',
        item_level: data.item_level || 1,
        effects: data.effects || [],
        stackable: data.stackable !== undefined ? data.stackable : true,
        maxStack: data.maxStack || 99,
        description: data.description || '',
        source: data.source || 'specialist'
    };

    store.byId[id] = entry;
    store.nameToId[name] = id;
    log(`消耗品定义创建: ${name} → ${id}`);
    return id;
}

/**
 * 校验消耗品条目数据。
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConsumableEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // consumable_id
    if (typeof data.consumable_id !== 'string' || data.consumable_id.length === 0) {
        errors.push('consumable_id 必须是非空字符串');
    }

    // name
    if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push('name 必须是非空字符串');
    }

    // category 枚举
    if (data.category != null && !CATEGORY_ENUM.includes(data.category)) {
        errors.push(`category 必须是 ${CATEGORY_ENUM.join('|')} 之一`);
    }

    // rarity 枚举
    if (data.rarity != null && !RARITY_ENUM.includes(data.rarity)) {
        errors.push(`rarity 必须是 ${RARITY_ENUM.join('|')} 之一`);
    }

    // item_level
    if (data.item_level != null && (typeof data.item_level !== 'number' || data.item_level < 1)) {
        errors.push('item_level 必须是 >= 1 的数字');
    }

    // effects
    if (data.effects != null) {
        if (!Array.isArray(data.effects)) {
            errors.push('effects 必须是数组');
        } else {
            for (let i = 0; i < data.effects.length; i++) {
                const eff = data.effects[i];
                if (!eff || typeof eff !== 'object') {
                    errors.push(`effects[${i}] 必须是对象`);
                    continue;
                }
                if (eff.type != null && !EFFECT_TYPE_ENUM.includes(eff.type)) {
                    errors.push(`effects[${i}].type 必须是 ${EFFECT_TYPE_ENUM.join('|')} 之一`);
                }
                if (eff.stat != null && !STAT_ENUM.includes(eff.stat)) {
                    errors.push(`effects[${i}].stat 必须是 ${STAT_ENUM.join('|')} 之一`);
                }
                if (eff.value != null && typeof eff.value !== 'number') {
                    errors.push(`effects[${i}].value 必须是数字`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 使用消耗品。
 * 1. 从 inventoryStore 找 item（item_id 匹配，type==='consumable'）
 * 2. 从 consumableStore 获取定义
 * 3. 应用 effects
 * 4. item.qty -= 1，qty<=0 则从 items 移除
 * 5. appendActionLog
 * 6. saveStore
 * @param {string} itemId - inventory item_id
 * @returns {Promise<string[]>} results 数组（如 ['HP +50 (100→150)']）
 */
export async function useConsumable(itemId) {
    if (!itemId) {
        log(`useConsumable: itemId 为空`, 'warn');
        return [];
    }

    const invStore = getInventoryStore();
    // 点8: 放宽查找条件 — item_id 或 consumable_id 匹配均可，type 不限 consumable
    // （旧逻辑仅匹配 type==='consumable' || consumable_id，部分物品 type 可能缺失或不匹配）
    const item = invStore.items.find(i =>
        (i.item_id === itemId || i.consumable_id === itemId) &&
        (i.type === 'consumable' || i.consumable_id || i.type === 'material')
    );
    if (!item) {
        log(`useConsumable: 物品 ${itemId} 不存在于背包`, 'warn');
        return [];
    }

    const def = getConsumableById(item.consumable_id);
    if (!def) {
        log(`useConsumable: 消耗品定义 ${item.consumable_id} 不存在（物品 ${itemId} 在背包中但定义未注册）`, 'warn');
        return [`物品 ${item.name || itemId} 定义未注册，无法使用`];
    }

    const playerStore = getPlayerStore();
    const results = [];
    let skippedFull = false;

    for (const eff of (def.effects || [])) {
        if (eff.type === 'restore' || eff.type === 'buff') {
            if (eff.stat === 'hp') {
                const oldHp = playerStore.vitals.hp;
                const maxHp = playerStore.vitals.maxHp;
                if (oldHp >= maxHp) { skippedFull = true; continue; }
                const newHp = Math.min(oldHp + (eff.value || 0), maxHp);
                await updatePlayerVitals({ hp: newHp }, true);
                results.push(`HP +${eff.value} (${oldHp}→${newHp})`);
            } else if (eff.stat === 'mp') {
                const oldMp = playerStore.vitals.mp;
                const maxMp = playerStore.vitals.maxMp;
                const newMp = Math.min(oldMp + (eff.value || 0), maxMp);
                await updatePlayerVitals({ mp: newMp }, true);
                results.push(`MP +${eff.value} (${oldMp}→${newMp})`);
            } else if (['str', 'agi', 'int', 'vit'].includes(eff.stat)) {
                const oldVal = playerStore.attributes[eff.stat] || 0;
                const newVal = oldVal + (eff.value || 0);
                await updatePlayerAttributes({ [eff.stat]: newVal }, true);
                results.push(`${eff.stat.toUpperCase()} +${eff.value} (${oldVal}→${newVal})`);

                // buff 有 duration 则存 buffs
                if (eff.type === 'buff' && eff.duration && eff.duration > 0) {
                    if (!Array.isArray(playerStore.buffs)) playerStore.buffs = [];
                    playerStore.buffs.push({
                        stat: eff.stat,
                        value: eff.value,
                        duration: eff.duration,
                        remaining: eff.duration
                    });
                }
            } else {
                // M1: 未知 buff/restore 目标属性，给用户反馈而非静默忽略
                results.push(`未知效果: ${eff.stat}`);
            }
        } else if (eff.type === 'cure') {
            // M2: cure effect — 待状态异常系统(playerStore.statusEffects)上线后实现实际清除
            results.push(`治愈: ${eff.stat || '状态异常'}`);
        } else {
            // M1: 未知效果类型，给用户反馈而非静默忽略
            results.push(`未知效果类型: ${eff.type}`);
        }
    }

    // 点8: 所有效果都因满血/满蓝跳过时, 返回提示而非空数组(避免误报'物品不存在')
    if (results.length === 0 && skippedFull) {
        return ['HP/MP 已满，无需使用'];
    }

    // 4. 减少数量（Bug4b: 防御 qty 为 undefined/NaN）
    if (item.qty == null) item.qty = 1;
    item.qty -= 1;
    if (isNaN(item.qty)) item.qty = 0;
    if (item.qty <= 0) {
        const idx = invStore.items.indexOf(item);
        if (idx >= 0) invStore.items.splice(idx, 1);
    }

    // 5. actionLog
    appendActionLog({
        action: 'use_consumable',
        itemType: 'consumable',
        itemName: def.name,
        result: 'success',
        resultDetail: results.join(', ')
    });

    // 6. saveStore
    await saveStore();

    return results;
}
