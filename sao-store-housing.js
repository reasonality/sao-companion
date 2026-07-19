// sao-store-housing.js — 住房系统权威库
// 玩家购房后记录位置和描述。装饰随时间更新，家具提供 buff（仅在家时生效）。
// Phase 3 of 3：住房系统依赖 buff 系统（Phase 1）和公会系统（Phase 2）。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';
import { getPlayerStore } from './sao-store-player.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 housingStore 引用（惰性初始化）。
 * @returns {{ playerHousing: object|null }}
 */
export function getHousingStore() {
    const store = getStore();
    if (!store.housingStore) {
        store.housingStore = { playerHousing: null };
    }
    return store.housingStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取玩家住房数据。
 * @returns {object|null} 住房数据，无房时返回 null
 */
export function getPlayerHousing() {
    return getHousingStore().playerHousing;
}

/**
 * 设定玩家住房（购房时调用）。
 * @param {object} housing - { type, floor_id, location, description, decorations: [], furniture: [] }
 */
export async function setPlayerHousing(housing, skipSave = false) {
    const store = getHousingStore();
    store.playerHousing = {
        type: housing.type || 'apartment',
        floor_id: housing.floor_id || null,
        location: housing.location || '',
        description: housing.description || '',
        decorations: housing.decorations || [],
        furniture: housing.furniture || [],
    };
    log(`房屋设定: ${store.playerHousing.location || store.playerHousing.type}`);
    if (!skipSave) await saveStore();
}

/**
 * 更新玩家住房（局部更新，如添加装饰/家具）。
 * @param {object} updates - 部分住房数据，合并到现有数据
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export async function updatePlayerHousing(updates, skipSave = false) {
    const store = getHousingStore();
    if (!store.playerHousing) return;
    if (updates.location !== undefined) store.playerHousing.location = updates.location;
    if (updates.description !== undefined) store.playerHousing.description = updates.description;
    if (Array.isArray(updates.decorations)) store.playerHousing.decorations = updates.decorations;
    if (Array.isArray(updates.furniture)) store.playerHousing.furniture = updates.furniture;
    log(`房屋更新: ${JSON.stringify(Object.keys(updates))}`);
    if (!skipSave) await saveStore();
}

/**
 * 添加装饰到玩家住房。
 * @param {string} decoration - 自由文本描述
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export async function addDecoration(decoration, skipSave = false) {
    const store = getHousingStore();
    if (!store.playerHousing) return;
    store.playerHousing.decorations.push(decoration);
    log(`装修更新: ${decoration}`);
    if (!skipSave) await saveStore();
}

/**
 * 添加家具到玩家住房。
 * @param {object} furniture - { name, buff?: { name, effects, description } }
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export async function addFurniture(furniture, skipSave = false) {
    const store = getHousingStore();
    if (!store.playerHousing) return;
    store.playerHousing.furniture.push(furniture);
    log(`家具添加: ${furniture.name}`);
    if (!skipSave) await saveStore();
}

/**
 * 按名称移除家具。
 * @param {string} name
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export async function removeFurniture(name, skipSave = false) {
    const store = getHousingStore();
    if (!store.playerHousing) return;
    store.playerHousing.furniture = store.playerHousing.furniture.filter(f => f.name !== name);
    log(`家具移除: ${name}`);
    if (!skipSave) await saveStore();
}

/**
 * 检查玩家是否在家（与房屋在同一楼层）。
 * @returns {boolean}
 */
export function isPlayerAtHome() {
    const housing = getPlayerHousing();
    if (!housing || !housing.floor_id) return false;
    const player = getPlayerStore();
    if (!player?.position?.floor_id) return false;
    // floor_id 可能是字符串 "floor_001" 或数字 1，统一提取数字比较
    const housingFloor = parseInt(String(housing.floor_id).replace(/\D/g, ''), 10);
    const playerFloor = parseInt(String(player.position.floor_id).replace(/\D/g, ''), 10);
    return !isNaN(housingFloor) && !isNaN(playerFloor) && housingFloor === playerFloor;
}

/**
 * 获取当前生效的家具 buff 列表（仅在家时生效）。
 * @returns {array} 活跃家具 buff 对象列表
 */
export function getActiveFurnitureBuffs() {
    if (!isPlayerAtHome()) return [];
    const housing = getPlayerHousing();
    if (!housing || !housing.furniture) return [];
    return housing.furniture.filter(f => f.buff).map(f => ({
        id: 'furniture_' + f.name,
        source: '家具：' + f.name,
        name: f.buff.name,
        effects: f.buff.effects,
        description: f.buff.description,
    }));
}

/**
 * 清除玩家住房（出售/搬出）。
 */
export async function clearPlayerHousing(skipSave = false) {
    getHousingStore().playerHousing = null;
    log('房屋清除');
    if (!skipSave) await saveStore();
}
