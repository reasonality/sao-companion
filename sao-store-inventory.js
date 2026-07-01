// sao-store-inventory.js — 背包/货币权威库
// 管理玩家持有物品（装备、消耗品、材料、任务物品）和货币（cor）。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';

// ============================================================
// 常量
// ============================================================

const ITEM_TYPE_ENUM = ['equipment', 'consumable', 'quest_item', 'material'];

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 inventoryStore 及其子字段存在，返回引用。
 * @returns {{ owner_id: string, currency: { cor: number }, items: Array }}
 */
function ensureInventoryStore() {
    const store = getStore();
    if (!store.inventoryStore) {
        store.inventoryStore = {
            owner_id: 'player',
            currency: { cor: 0 },
            items: []
        };
    }
    if (!store.inventoryStore.currency) store.inventoryStore.currency = { cor: 0 };
    if (!Array.isArray(store.inventoryStore.items)) store.inventoryStore.items = [];
    return store.inventoryStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 inventoryStore 引用（惰性初始化）。
 * @returns {{ owner_id: string, currency: { cor: number }, items: Array }}
 */
export function getInventoryStore() {
    return ensureInventoryStore();
}

/**
 * 生成物品 ID（自增数字，格式 inv_001）。
 * @returns {string}
 */
export function generateItemId() {
    const store = ensureInventoryStore();
    let maxNum = 0;
    for (const item of store.items) {
        if (item.item_id) {
            const match = item.item_id.match(/^inv_(\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
    }
    const next = maxNum + 1;
    return 'inv_' + String(next).padStart(3, '0');
}

/**
 * 添加装备物品到背包。
 * @param {string} equipmentId
 * @returns {string} item_id
 */
export async function addEquipmentItem(equipmentId, skipSave) {
    const store = ensureInventoryStore();
    const itemId = generateItemId();
    store.items.push({
        item_id: itemId,
        type: 'equipment',
        equipment_id: equipmentId,
        qty: 1
    });
    if (skipSave !== true) await saveStore();
    log(`装备入背包: ${equipmentId} → ${itemId}`);
    return itemId;
}

/**
 * 从背包移除装备物品（按 equipment_id 匹配）。
 * 若未找到不报错。
 * @param {string} equipmentId
 * @returns {boolean} 是否移除了条目
 */
export async function removeEquipmentItem(equipmentId, skipSave) {
    const store = ensureInventoryStore();
    const idx = store.items.findIndex(
        item => item.type === 'equipment' && item.equipment_id === equipmentId
    );
    if (idx >= 0) {
        store.items.splice(idx, 1);
        if (skipSave !== true) await saveStore();
        log(`装备出背包: ${equipmentId}`);
        return true;
    }
    return false;
}

/**
 * 添加消耗品（DEPRECATED — 旧签名兼容 wrapper）。
 * 内部转调 addConsumableItem。保留旧签名 addConsumable(name, qty, description, skipSave)。
 * @deprecated Use addConsumableItem(consumableId, qty, skipSave) instead.
 * @param {string} name
 * @param {number} qty
 * @param {string} [description]
 * @returns {string} item_id
 */
export async function addConsumable(name, qty, description, skipSave) {
    // 动态导入避免循环依赖
    const { findOrCreateConsumable } = await import('./sao-store-consumable.js');
    // 用 name+description 创建/查找空壳定义（source:'manual'）
    const consumableId = findOrCreateConsumable({
        name,
        description: description || '',
        source: 'manual'
    });
    if (!consumableId) {
        log(`addConsumable: 无法创建消耗品定义 "${name}"`, 'warn');
        return null;
    }
    return addConsumableItem(consumableId, qty, skipSave);
}

/**
 * 添加消耗品物品到背包（主函数）。
 * 按 consumable_id 匹配已有条目，qty 累加；无则新建。
 * @param {string} consumableId - consumable_id
 * @param {number} qty
 * @param {boolean} [skipSave]
 * @returns {string} item_id
 */
export async function addConsumableItem(consumableId, qty, skipSave) {
    // Bug5: consumableId 为空时直接返回（避免创建 consumable_id=null 的残缺条目）
    if (!consumableId) {
        log(`addConsumableItem: consumableId 为空，跳过`, 'warn');
        return null;
    }
    const store = ensureInventoryStore();
    const safeQty = Math.max(0, Math.floor(Number(qty) || 0));

    // M4: 统一 import，避免 existing/new 两分支各自 await import
    const { getConsumableById } = await import('./sao-store-consumable.js');

    // 按 consumable_id 查找已有
    const existing = store.items.find(
        item => item.type === 'consumable' && item.consumable_id === consumableId
    );
    if (existing) {
        // stackable 检查
        const def = getConsumableById(consumableId);
        const maxStack = def?.maxStack || 99;
        existing.qty = Math.min(maxStack, Math.max(0, (existing.qty || 0) + safeQty));
        if (skipSave !== true) await saveStore();
        log(`消耗品累加: ${consumableId} +${safeQty} → ${existing.qty}`);
        return existing.item_id;
    }

    if (safeQty < 1) {
        log(`addConsumableItem: qty=${qty} 无效(需≥1)，跳过创建 "${consumableId}"`, 'warn');
        return null;
    }

    // stackable 检查
    const def = getConsumableById(consumableId);
    const maxStack = def?.maxStack || 99;
    const finalQty = Math.min(maxStack, safeQty);

    const itemId = generateItemId();
    store.items.push({
        item_id: itemId,
        type: 'consumable',
        consumable_id: consumableId,
        qty: finalQty
    });
    if (skipSave !== true) await saveStore();
    log(`消耗品添加: ${consumableId} x${finalQty}`);
    return itemId;
}

/**
 * 添加材料。同名已存在则累加数量，否则创建新条目。
 * @param {string} name
 * @param {number} qty
 * @returns {string} item_id
 */
export async function addMaterial(name, qty, skipSave) {
    const store = ensureInventoryStore();
    const safeQty = Math.max(0, Math.floor(Number(qty) || 0));

    const existing = store.items.find(
        item => item.type === 'material' && item.name === name
    );
    if (existing) {
        existing.qty = Math.max(0, (existing.qty || 0) + safeQty);
        if (skipSave !== true) await saveStore();
        log(`材料累加: ${name} +${safeQty} → ${existing.qty}`);
        return existing.item_id;
    }

    if (safeQty < 1) {
        log(`addMaterial: qty=${qty} 无效(需≥1)，跳过创建 "${name}"`, 'warn');
        return null;
    }
    const itemId = generateItemId();
    store.items.push({
        item_id: itemId,
        type: 'material',
        name: name,
        qty: safeQty
    });
    if (skipSave !== true) await saveStore();
    log(`材料添加: ${name} x${safeQty}`);
    return itemId;
}

/**
 * 添加任务物品（qty 固定为 1）。
 * @param {string} name
 * @param {string} [description]
 * @returns {string} item_id
 */
export async function addQuestItem(name, description, skipSave) {
    const store = ensureInventoryStore();
    const itemId = generateItemId();
    const entry = {
        item_id: itemId,
        type: 'quest_item',
        name: name,
        qty: 1
    };
    if (description) entry.description = description;
    store.items.push(entry);
    if (skipSave !== true) await saveStore();
    log(`任务物品添加: ${name}`);
    return itemId;
}

/**
 * 设置货币 cor 值。
 * @param {number} cor
 */
export async function updateCurrency(cor, skipSave) {
    const store = ensureInventoryStore();
    // L4: schema 要求 cor 为非负整数；强制取整 + 非负，避免 LLM 传 float/负数写入违反 schema。
    const normalizedCor = Math.max(0, Math.floor(Number(cor) || 0));
    store.currency.cor = normalizedCor;
    if (skipSave !== true) await saveStore();
}

/**
 * 获取当前 cor 余额。
 * @returns {number}
 */
export function getCurrency() {
    const store = ensureInventoryStore();
    return store.currency.cor || 0;
}

/**
 * 校验 inventoryStore 条目数据。
 * @param {object} data - inventoryStore 条目
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateInventoryEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // owner_id
    if (typeof data.owner_id !== 'string' || data.owner_id.length === 0) {
        errors.push('owner_id 必须是非空字符串');
    }

    // currency.cor
    if (data.currency != null) {
        if (typeof data.currency !== 'object') {
            errors.push('currency 必须是对象');
        } else if (data.currency.cor != null && (typeof data.currency.cor !== 'number' || data.currency.cor < 0)) {
            errors.push('currency.cor 必须是 >= 0 的数字');
        }
    }

    // items
    if (data.items != null) {
        if (!Array.isArray(data.items)) {
            errors.push('items 必须是数组');
        } else {
            for (let i = 0; i < data.items.length; i++) {
                const item = data.items[i];
                if (!item || typeof item !== 'object') {
                    errors.push(`items[${i}] 必须是对象`);
                    continue;
                }

                const type = item.type;

                // item_id: common to all types
                if (typeof item.item_id !== 'string' || item.item_id.length === 0) {
                    errors.push(`items[${i}].item_id 必须是非空字符串`);
                }

                if (type === 'equipment') {
                    if (typeof item.equipment_id !== 'string' || item.equipment_id.length === 0) {
                        errors.push(`items[${i}].equipment_id 必须是非空字符串`);
                    }
                    if (item.qty != null && (typeof item.qty !== 'number' || item.qty < 1)) {
                        errors.push(`items[${i}].qty 必须是 >= 1 的数字`);
                    }
                } else if (type === 'consumable') {
                    if (typeof item.consumable_id !== 'string' || item.consumable_id.length === 0) {
                        errors.push(`items[${i}].consumable_id 必须是非空字符串`);
                    }
                    if (item.qty != null && (typeof item.qty !== 'number' || item.qty < 1)) {
                        errors.push(`items[${i}].qty 必须是 >= 1 的数字`);
                    }
                } else if (type === 'quest_item') {
                    if (typeof item.name !== 'string' || item.name.length === 0) {
                        errors.push(`items[${i}].name 必须是非空字符串`);
                    }
                    if (item.qty != null && (typeof item.qty !== 'number' || item.qty < 1)) {
                        errors.push(`items[${i}].qty 必须是 >= 1 的数字`);
                    }
                    // description is optional
                } else if (type === 'material') {
                    if (typeof item.name !== 'string' || item.name.length === 0) {
                        errors.push(`items[${i}].name 必须是非空字符串`);
                    }
                    if (item.qty != null && (typeof item.qty !== 'number' || item.qty < 1)) {
                        errors.push(`items[${i}].qty 必须是 >= 1 的数字`);
                    }
                } else {
                    errors.push(`items[${i}].type 无效，必须是 ${ITEM_TYPE_ENUM.join('|')} 之一`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
