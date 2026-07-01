// sao-store-player.js — 玩家当前状态权威库
// 由 status 专家通过 normalize 层写入。
// equipment slot 使用新命名：weapon | off_hand | head | chest | hands | legs | accessory

import { getStore, saveStore } from './sao-store-core.js';
import { log, getSaoData } from './sao-core.js';
import { getFloorByNumber } from './sao-store-floor.js';
import { getEquipmentStore, SLOT_ENUM } from './sao-store-equipment.js';
import { getInventoryStore, generateItemId } from './sao-store-inventory.js';
import { getSkillById } from './sao-store-skill.js';

// ============================================================
// 常量
// ============================================================

/** 光标类型 → 显示文本映射（权威定义） */
export const CURSOR_LABELS = { green: '🟢 普通', orange: '🟠 敌对', red: '🔴 红名' };

const DEFAULT_PLAYER = Object.freeze({
    player_id: 'player',
    identity: { name: '桐人', title: null },
    progression: { level: 1, totalExp: 0 },
    attributes: { str: 0, agi: 0, int: 0, vit: 0 },
    vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
    position: { floor_id: 'floor_001', location: '起始之城镇' },
    equipment: {
        weapon: null,
        off_hand: null,
        head: null,
        chest: null,
        hands: null,
        legs: null,
        accessory: null
    },
    skills: [],
    customSkills: [],
    cursor_type: 'green'
});

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 playerStore 存在，返回引用。
 * 若不存在则以 DEFAULT_PLAYER 初始化。
 * @returns {object}
 */
function ensurePlayerStore() {
    const store = getStore();
    if (!store.playerStore) {
        store.playerStore = structuredClone(DEFAULT_PLAYER);
    }
    return store.playerStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 playerStore 引用（惰性初始化）。
 * @returns {object}
 */
export function getPlayerStore() {
    return ensurePlayerStore();
}

/**
 * 原子装备操作：
 * 1. 校验 equipmentStore.byId[equipmentId] 存在
 * 2. 当前 slot 有装备 → 回背包
 * 3. 新装备若在背包中 → 移除
 * 4. 写 playerStore.equipment[slot] = equipmentId
 * 5. saveStore()
 *
 * @param {string} slot - 装备槽位（新命名）
 * @param {string} equipmentId - equipment_id
 * @throws {Error} 若 equipmentId 在 equipmentStore 中不存在
 */
export async function equipItem(slot, equipmentId, skipSave) {
    // 校验 slot
    if (!SLOT_ENUM.includes(slot)) {
        throw new Error(`equipItem: 无效 slot "${slot}"，必须是 ${SLOT_ENUM.join('|')} 之一`);
    }

    const equipStore = getEquipmentStore();
    if (!equipStore.byId[equipmentId]) {
        throw new Error(`equipItem: equipment_id "${equipmentId}" 在 equipmentStore 中不存在`);
    }

    const playerStore = ensurePlayerStore();
    const invStore = getInventoryStore();

    // 步骤 1: 当前 slot 有装备 → 回背包
    const currentId = playerStore.equipment[slot];
    if (currentId) {
        const itemId = generateItemId();
        invStore.items.push({
            item_id: itemId,
            type: 'equipment',
            equipment_id: currentId,
            qty: 1
        });
        log(`装备回背包: ${currentId} (slot: ${slot})`);
    }

    // 步骤 2: 新装备从背包移除（若存在）
    const invIdx = invStore.items.findIndex(
        item => item.type === 'equipment' && item.equipment_id === equipmentId
    );
    if (invIdx >= 0) {
        invStore.items.splice(invIdx, 1);
        log(`装备出背包: ${equipmentId}`);
    }
    // 若不在背包（新创建/刚捡起），跳过，不报错

    // 步骤 3: 写入 playerStore
    playerStore.equipment[slot] = equipmentId;

    if (skipSave !== true) await saveStore();
    log(`装备穿戴: ${equipmentId} → ${slot}`);
}

/**
 * 合并更新玩家生命值/法力值。
 * @param {object} vitals - { hp?, maxHp?, mp?, maxMp? }
 */
export async function updatePlayerVitals(vitals, skipSave) {
    const playerStore = ensurePlayerStore();
    if (vitals.hp != null) playerStore.vitals.hp = vitals.hp;
    if (vitals.maxHp != null) playerStore.vitals.maxHp = vitals.maxHp;
    if (vitals.mp != null) playerStore.vitals.mp = vitals.mp;
    if (vitals.maxMp != null) playerStore.vitals.maxMp = vitals.maxMp;
    if (skipSave !== true) await saveStore();
}

/**
 * 合并更新玩家属性。
 * @param {object} attrs - { str?, agi?, int?, vit? }
 */
export async function updatePlayerAttributes(attrs, skipSave) {
    const playerStore = ensurePlayerStore();
    if (attrs.str != null) playerStore.attributes.str = attrs.str;
    if (attrs.agi != null) playerStore.attributes.agi = attrs.agi;
    if (attrs.int != null) playerStore.attributes.int = attrs.int;
    if (attrs.vit != null) playerStore.attributes.vit = attrs.vit;
    if (skipSave !== true) await saveStore();
}

/**
 * 更新玩家等级与经验值。
 * @param {number} level
 * @param {number} totalExp
 */
export async function updatePlayerProgression(level, totalExp, skipSave) {
    const playerStore = ensurePlayerStore();
    // L11: 防 null/undefined 写入（specialist JSON 可能只传其中一个字段，另一个为 undefined）
    if (level != null) playerStore.progression.level = level;
    if (totalExp != null) playerStore.progression.totalExp = totalExp;
    if (skipSave !== true) await saveStore();
}

/**
 * 更新玩家位置。
 * @param {string} floor_id
 * @param {string} location
 */
export async function updatePlayerPosition(floor_id, location, skipSave) {
    const playerStore = ensurePlayerStore();
    const oldFloorId = playerStore.position.floor_id;
    const oldLocation = playerStore.position.location;

    playerStore.position.floor_id = floor_id;
    playerStore.position.location = location;

    // location 变化时向 floorStore 追加探索记录
    if (location && location !== oldLocation) {
        const floorNum = parseInt(String(floor_id).replace(/\D/g, '') || '0', 10);
        const floorEntry = getFloorByNumber(floorNum);
        if (floorEntry) {
            const store = getStore();
            const dateText = store?.calendarStore?.currentDate
                || getSaoData()?.calendar?.currentDate
                || '';
            const note = dateText ? `${dateText} ${location}` : location;
            if (!Array.isArray(floorEntry.state.notes)) {
                floorEntry.state.notes = [];
            }
            if (floorEntry.state.notes[floorEntry.state.notes.length - 1] !== note) {
                floorEntry.state.notes.push(note);
            }
        } else {
            log(`updatePlayerPosition: 未找到 floor ${floorNum}，跳过探索记录`, 'warn');
        }
    }

    if (skipSave !== true) await saveStore();
}

/**
 * 更新玩家身份信息。
 * @param {string} name
 * @param {string|null} title
 */
export async function updatePlayerIdentity(name, title, skipSave) {
    const playerStore = ensurePlayerStore();
    playerStore.identity.name = name;
    playerStore.identity.title = title;
    if (skipSave !== true) await saveStore();
}

/**
 * 添加玩家技能（按 skill_id 去重）。
 * @param {string} skill_id
 * @param {string} name
 * @param {number} proficiency
 */
export async function addPlayerSkill(skill_id, name, proficiency, skipSave) {
    const playerStore = ensurePlayerStore();
    const existing = playerStore.skills.find(s => s.skill_id === skill_id);
    if (existing) {
        // 已存在则更新熟练度（upsert 语义）
        if (proficiency != null && proficiency !== existing.proficiency) {
            existing.proficiency = proficiency;
            if (skipSave !== true) await saveStore();
            log(`玩家技能熟练度更新: ${name} (${skill_id}) → ${proficiency}`);
        }
        return;
    }
    if (!getSkillById(skill_id)) {
        log(`addPlayerSkill: skill_id "${skill_id}" 在 skillStore 中不存在，跳过添加`, 'warn');
        return;
    }
    // L6: schema 允许 proficiency=0；用 `?? 1` 仅在 null/undefined 时兜底，保留显式 0。
    playerStore.skills.push({ skill_id, name, proficiency: proficiency ?? 1 });
    if (skipSave !== true) await saveStore();
    log(`玩家技能添加: ${name} (${skill_id})`);
}

/**
 * 设置自定义技能 ID 列表。
 * @param {string[]} ids
 */
export async function setCustomSkills(ids, skipSave) {
    const playerStore = ensurePlayerStore();
    playerStore.customSkills = Array.isArray(ids) ? [...ids] : [];
    if (skipSave !== true) await saveStore();
}

/**
 * 卸下装备（equipItem 的逆操作）：
 * 1. 校验 slot 有效且当前有装备
 * 2. 将装备移回背包
 * 3. 清空 playerStore.equipment[slot]
 * 4. saveStore()
 *
 * @param {string} slot - 装备槽位（新命名）
 * @returns {string|null} 被卸下的 equipment_id，无装备时返回 null
 * @throws {Error} 若 slot 无效
 */
export async function unequipItem(slot, skipSave) {
    if (!SLOT_ENUM.includes(slot)) {
        throw new Error(`unequipItem: 无效 slot "${slot}"，必须是 ${SLOT_ENUM.join('|')} 之一`);
    }

    const playerStore = ensurePlayerStore();
    const currentId = playerStore.equipment[slot];
    if (!currentId) {
        log(`unequipItem: slot "${slot}" 无装备`, 'warn');
        return null;
    }

    // 装备回背包
    const invStore = getInventoryStore();
    const itemId = generateItemId();
    invStore.items.push({
        item_id: itemId,
        type: 'equipment',
        equipment_id: currentId,
        qty: 1
    });

    // 清空槽位
    playerStore.equipment[slot] = null;

    if (skipSave !== true) await saveStore();
    log(`装备卸下: ${currentId} (slot: ${slot}) → 回背包`);
    return currentId;
}

/**
 * 校验 playerStore 条目数据。
 * @param {object} data - playerStore 条目
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlayerEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // player_id
    if (typeof data.player_id !== 'string' || data.player_id.length === 0) {
        errors.push('player_id 必须是非空字符串');
    }

    // identity.name
    if (!data.identity || typeof data.identity.name !== 'string' || data.identity.name.length === 0) {
        errors.push('identity.name 必须是非空字符串');
    }

    // progression
    if (data.progression != null) {
        if (typeof data.progression !== 'object') {
            errors.push('progression 必须是对象');
        } else {
            if (typeof data.progression.level !== 'number' || data.progression.level < 1) {
                errors.push('progression.level 必须是 >= 1 的数字');
            }
            if (typeof data.progression.totalExp !== 'number' || data.progression.totalExp < 0) {
                errors.push('progression.totalExp 必须是 >= 0 的数字');
            }
        }
    }

    // attributes
    if (data.attributes != null) {
        if (typeof data.attributes !== 'object') {
            errors.push('attributes 必须是对象');
        } else {
            const ATTR_FIELDS = ['str', 'agi', 'int', 'vit'];
            for (const f of ATTR_FIELDS) {
                if (data.attributes[f] != null && typeof data.attributes[f] !== 'number') {
                    errors.push(`attributes.${f} 必须是数字`);
                }
            }
        }
    }

    // vitals
    if (data.vitals != null) {
        if (typeof data.vitals !== 'object') {
            errors.push('vitals 必须是对象');
        } else {
            const VITAL_FIELDS = ['hp', 'maxHp', 'mp', 'maxMp'];
            for (const f of VITAL_FIELDS) {
                if (data.vitals[f] != null && typeof data.vitals[f] !== 'number') {
                    errors.push(`vitals.${f} 必须是数字`);
                }
            }
        }
    }

    // equipment
    const SLOT_ENUM = ['weapon', 'off_hand', 'head', 'chest', 'hands', 'legs', 'accessory'];
    if (data.equipment != null) {
        if (typeof data.equipment !== 'object') {
            errors.push('equipment 必须是对象');
        } else {
            for (const [slot, val] of Object.entries(data.equipment)) {
                if (!SLOT_ENUM.includes(slot)) {
                    errors.push(`equipment 包含无效 slot "${slot}"`);
                }
                if (val !== null && typeof val !== 'string') {
                    errors.push(`equipment.${slot} 必须是字符串或 null`);
                }
            }
        }
    }

    // skills
    if (data.skills != null) {
        if (!Array.isArray(data.skills)) {
            errors.push('skills 必须是数组');
        } else {
            for (let i = 0; i < data.skills.length; i++) {
                const sk = data.skills[i];
                if (!sk || typeof sk !== 'object') {
                    errors.push(`skills[${i}] 必须是对象`);
                    continue;
                }
                if (typeof sk.skill_id !== 'string' || sk.skill_id.length === 0) {
                    errors.push(`skills[${i}].skill_id 必须是非空字符串`);
                }
                if (typeof sk.name !== 'string' || sk.name.length === 0) {
                    errors.push(`skills[${i}].name 必须是非空字符串`);
                }
                if (sk.proficiency != null && typeof sk.proficiency !== 'number') {
                    errors.push(`skills[${i}].proficiency 必须是数字`);
                }
            }
        }
    }

    // cursor_type: 枚举校验
    const CURSOR_TYPE_ENUM = ['green', 'orange', 'red'];
    if (data.cursor_type != null) {
        if (!CURSOR_TYPE_ENUM.includes(data.cursor_type)) {
            errors.push(`cursor_type 必须是 ${CURSOR_TYPE_ENUM.join('|')} 之一`);
        }
    }

    return { valid: errors.length === 0, errors };
}
