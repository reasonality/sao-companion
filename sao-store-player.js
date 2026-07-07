// sao-store-player.js — 玩家当前状态权威库
// 由 status 专家通过 normalize 层写入。
// equipment slot 使用新命名：weapon | off_hand | head | chest | hands | legs | accessory

import { getStore, saveStore } from './sao-store-core.js';
import { log, getSaoData } from './sao-core.js';
import { getFloorByNumber } from './sao-store-floor.js';
import { getEquipmentStore, getEquipmentById, SLOT_ENUM } from './sao-store-equipment.js';
import { getInventoryStore, generateItemId } from './sao-store-inventory.js';
import { getSkillById } from './sao-store-skill.js';

// ============================================================
// 常量
// ============================================================

/** 光标类型 → 显示文本映射（权威定义） */
export const CURSOR_LABELS = { green: '🟢 普通', orange: '🟠 敌对', red: '🔴 红名' };

const DEFAULT_PLAYER = Object.freeze({
    player_id: 'player',
    identity: { name: null, title: null },
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
    cursor_type: 'green',
    // 月蚀独特技能系统
    meditationProficiency: 0,  // 冥想熟练度 0-2000
    uniqueSkill: null,          // 月蚀技能对象（现梦解锁时创建）
    incapacitated: false,       // 三千世界副作用：计算过载无法战斗
    _incapacitatedTurns: 0,     // 计算过载剩余回合数（私有，不持久化）
});

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 playerStore 引用（惰性初始化）。
 * 若不存在则以 DEFAULT_PLAYER 初始化。
 * @returns {object}
 */
export function getPlayerStore() {
    const store = getStore();
    if (!store.playerStore) {
        store.playerStore = structuredClone(DEFAULT_PLAYER);
    }
    // Buffs: 兼容旧数据补全
    if (!store.playerStore.buffs) store.playerStore.buffs = { temporary: [], permanent: [] };
    // Guild: 兼容旧数据补全
    if (store.playerStore.guild_id === undefined) store.playerStore.guild_id = null;
    // 月蚀系统: 兼容旧数据补全
    if (store.playerStore.meditationProficiency === undefined) store.playerStore.meditationProficiency = 0;
    if (store.playerStore.uniqueSkill === undefined) store.playerStore.uniqueSkill = null;
    if (store.playerStore.incapacitated === undefined) store.playerStore.incapacitated = false;
    if (store.playerStore._incapacitatedTurns === undefined) store.playerStore._incapacitatedTurns = 0;
    return store.playerStore;
}

// ============================================================
// 装备属性加成计算（BUG #4 修复）
// ============================================================

/** 属性加成字段（与 playerStore.attributes / vitals 对齐） */
const BONUS_ATTR_FIELDS = ['str', 'agi', 'int', 'vit'];
const BONUS_VITAL_FIELDS = ['maxHp', 'maxMp'];

/**
 * 汇总当前穿戴装备的属性加成。
 * @returns {{ str: number, agi: number, int: number, vit: number, maxHp: number, maxMp: number }}
 */
function _getEquipmentBonuses() {
    const playerStore = getPlayerStore();
    const equipStore = getEquipmentStore();
    const bonuses = { str: 0, agi: 0, int: 0, vit: 0, maxHp: 0, maxMp: 0 };
    for (const slot of SLOT_ENUM) {
        const eqId = playerStore.equipment?.[slot];
        if (!eqId) continue;
        const eq = equipStore.byId[eqId];
        if (!eq?.stats) continue;
        for (const f of BONUS_ATTR_FIELDS) {
            if (eq.stats[f] != null) bonuses[f] += eq.stats[f];
        }
        for (const f of BONUS_VITAL_FIELDS) {
            if (eq.stats[f] != null) bonuses[f] += eq.stats[f];
        }
    }
    return bonuses;
}

/**
 * 重新计算装备属性加成并更新 playerStore。
 * 
 * 原理：
 * - baseAttributes = 角色固有属性（不含装备加成），由 extract 更新时自动同步
 * - attributes = baseAttributes + 当前装备加成（显示值）
 * - _baseVitals = 固有 maxHp/maxMp，同理
 * 
 * BUG #5 修复：当 oldBonuses 被提供时（equip/unequip 路径），始终从当前
 * attributes 减去 oldBonuses 重新推导 baseAttributes/_baseVitals。
 * 这确保即使 extract（updatePlayerAttributes）在两次装备操作之间写入了
 * 新的属性值，base 也能正确反映真实固有属性，不会出现属性漂移。
 * 
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 * @param {object}  [oldBonuses] - 装备变更前的加成快照（equip/unequip 始终提供）
 */
export function recalcStatsFromEquipment(skipSave, oldBonuses) {
    const playerStore = getPlayerStore();
    const newBonuses = _getEquipmentBonuses();

    // BUG #5: 当 oldBonuses 提供时（equip/unequip 路径），始终重新推导 base，
    // 以防 extract 在上次 recalc 和本次之间写入了新的属性值。
    // 无 oldBonuses 且 baseAttributes 已存在时保留缓存 base（手动 recalc 调用）。
    if (oldBonuses) {
        // equip/unequip 路径：始终从当前 attributes 减去变更前加成得到固有属性
        playerStore.baseAttributes = {
            str: (playerStore.attributes?.str ?? 0) - (oldBonuses.str || 0),
            agi: (playerStore.attributes?.agi ?? 0) - (oldBonuses.agi || 0),
            int: (playerStore.attributes?.int ?? 0) - (oldBonuses.int || 0),
            vit: (playerStore.attributes?.vit ?? 0) - (oldBonuses.vit || 0),
        };
    } else if (!playerStore.baseAttributes) {
        // 首次调用，无 oldBonuses 上下文：从当前 attributes 初始化 base
        playerStore.baseAttributes = {
            str: (playerStore.attributes?.str ?? 0),
            agi: (playerStore.attributes?.agi ?? 0),
            int: (playerStore.attributes?.int ?? 0),
            vit: (playerStore.attributes?.vit ?? 0),
        };
    }
    // else: oldBonuses 未提供且 baseAttributes 已存在 — 使用缓存 base（手动 recalc 调用无装备上下文）

    // 计算总属性 = 固有 + 装备加成
    const base = playerStore.baseAttributes;
    playerStore.attributes = {
        str: (base.str ?? 0) + newBonuses.str,
        agi: (base.agi ?? 0) + newBonuses.agi,
        int: (base.int ?? 0) + newBonuses.int,
        vit: (base.vit ?? 0) + newBonuses.vit,
    };

    // maxHp / maxMp：同理（BUG #5 同步修复）
    if (oldBonuses) {
        playerStore._baseVitals = {
            maxHp: (playerStore.vitals?.maxHp ?? 100) - (oldBonuses.maxHp || 0),
            maxMp: (playerStore.vitals?.maxMp ?? 20) - (oldBonuses.maxMp || 0),
        };
    } else if (!playerStore._baseVitals) {
        playerStore._baseVitals = {
            maxHp: (playerStore.vitals?.maxHp ?? 100),
            maxMp: (playerStore.vitals?.maxMp ?? 20),
        };
    }
    const bv = playerStore._baseVitals;
    playerStore.vitals.maxHp = (bv.maxHp ?? 100) + newBonuses.maxHp;
    playerStore.vitals.maxMp = (bv.maxMp ?? 20) + newBonuses.maxMp;

    if (skipSave !== true) saveStore();
}

// ============================================================
// 导出函数
// ============================================================

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

    const playerStore = getPlayerStore();
    const invStore = getInventoryStore();

    // 捕获变更前加成快照（用于 baseAttributes 首次初始化）
    const oldBonuses = _getEquipmentBonuses();

    // 步骤 1: 当前 slot 有装备 → 回背包
    const currentId = playerStore.equipment[slot];
    if (currentId) {
        const itemId = generateItemId();
        invStore.items.unshift({
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

    // 步骤 4: 重算属性加成（BUG #4）
    recalcStatsFromEquipment(true, oldBonuses);

    if (skipSave !== true) await saveStore();
    log(`装备穿戴: ${equipmentId} → ${slot}`);
}

/**
 * 合并更新玩家生命值/法力值。
 * @param {object} vitals - { hp?, maxHp?, mp?, maxMp? }
 */
export async function updatePlayerVitals(vitals, skipSave) {
    const playerStore = getPlayerStore();

    // 先更新 max 值（以便后续 clamp 使用正确的上限）
    if (vitals.maxHp != null) playerStore.vitals.maxHp = Math.max(1, Number(vitals.maxHp));
    if (vitals.maxMp != null) playerStore.vitals.maxMp = Math.max(0, Number(vitals.maxMp));

    // HP/MP 取值并 clamp 到 [0, max]
    if (vitals.hp != null) {
        playerStore.vitals.hp = Math.max(0, Math.min(Number(vitals.hp), playerStore.vitals.maxHp || Number(vitals.hp)));
    }
    if (vitals.mp != null) {
        playerStore.vitals.mp = Math.max(0, Math.min(Number(vitals.mp), playerStore.vitals.maxMp || Number(vitals.mp)));
    }

    // 同步 _baseVitals：新 maxHp/maxMp = 总值（含装备），需减去当前装备加成得到固有值
    if (playerStore._baseVitals) {
        const bonuses = _getEquipmentBonuses();
        if (vitals.maxHp != null) playerStore._baseVitals.maxHp = vitals.maxHp - bonuses.maxHp;
        if (vitals.maxMp != null) playerStore._baseVitals.maxMp = vitals.maxMp - bonuses.maxMp;
    }

    // 月蚀：HP 恢复满时清除计算过载
    if (playerStore.incapacitated && playerStore.vitals.hp >= playerStore.vitals.maxHp && playerStore.vitals.maxHp > 0) {
        playerStore.incapacitated = false;
        log('[月蚀] 计算过载解除 — HP 已恢复满');
    }

    if (skipSave !== true) await saveStore();
}

/**
 * 合并更新玩家属性。
 * @param {object} attrs - { str?, agi?, int?, vit? }
 */
export async function updatePlayerAttributes(attrs, skipSave) {
    const playerStore = getPlayerStore();
    if (attrs.str != null) playerStore.attributes.str = attrs.str;
    if (attrs.agi != null) playerStore.attributes.agi = attrs.agi;
    if (attrs.int != null) playerStore.attributes.int = attrs.int;
    if (attrs.vit != null) playerStore.attributes.vit = attrs.vit;

    // 同步 baseAttributes：新属性 = 总值（含装备），需减去当前装备加成得到固有值
    if (playerStore.baseAttributes) {
        const bonuses = _getEquipmentBonuses();
        playerStore.baseAttributes = {
            str: (playerStore.attributes.str ?? 0) - bonuses.str,
            agi: (playerStore.attributes.agi ?? 0) - bonuses.agi,
            int: (playerStore.attributes.int ?? 0) - bonuses.int,
            vit: (playerStore.attributes.vit ?? 0) - bonuses.vit,
        };
    }

    if (skipSave !== true) await saveStore();
}

/**
 * 更新玩家等级与经验值。
 * @param {number} level
 * @param {number} totalExp
 */
export async function updatePlayerProgression(level, totalExp, skipSave) {
    const playerStore = getPlayerStore();
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
    const playerStore = getPlayerStore();
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
    const playerStore = getPlayerStore();
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
    const playerStore = getPlayerStore();
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
    const playerStore = getPlayerStore();
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

    const playerStore = getPlayerStore();
    const currentId = playerStore.equipment[slot];
    if (!currentId) {
        log(`unequipItem: slot "${slot}" 无装备`, 'warn');
        return null;
    }

    // 捕获变更前加成快照（用于 baseAttributes 首次初始化）
    const oldBonuses = _getEquipmentBonuses();

    // 装备回背包
    const invStore = getInventoryStore();
    const itemId = generateItemId();
    invStore.items.unshift({
        item_id: itemId,
        type: 'equipment',
        equipment_id: currentId,
        qty: 1
    });

    // 清空槽位
    playerStore.equipment[slot] = null;

    // 重算属性加成（BUG #4）
    recalcStatsFromEquipment(true, oldBonuses);

    if (skipSave !== true) await saveStore();
    log(`装备卸下: ${currentId} (slot: ${slot}) → 回背包`);
    return currentId;
}

// validatePlayerEntry removed — genuinely dead code (no production or test imports)

// ============================================================
// 月蚀独特技能系统 (Lunar Eclipse)
// ============================================================

/**
 * 获取独特技能对象（月蚀）。
 * @returns {object|null} uniqueSkill 对象，未解锁时返回 null
 */
export function getUniqueSkill() {
    return getPlayerStore()?.uniqueSkill || null;
}

/**
 * 设置独特技能对象。
 * @param {object} skillObj - uniqueSkill 对象
 */
export function setUniqueSkill(skillObj) {
    const player = getPlayerStore();
    player.uniqueSkill = skillObj;
    saveStore();
}

/**
 * 更新冥想熟练度。
 * @param {number} value - 新值（clamp 0-2000）
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export function updateMeditationProficiency(value, skipSave = false) {
    const player = getPlayerStore();
    player.meditationProficiency = Math.max(0, Math.min(2000, Number(value) || 0));
    if (!skipSave) saveStore();
}

/**
 * 更新月蚀子技熟练度。
 * @param {string} techId - 子技 ID（genmu/tsuki_no_shizuku/...）
 * @param {number} prof - 熟练度值
 * @param {boolean} [skipSave] - 是否跳过 saveStore
 */
export function updateSubTechniqueProficiency(techId, prof, skipSave = false) {
    const player = getPlayerStore();
    if (!player.uniqueSkill?.subTechniques?.[techId]) return;
    if (!player.uniqueSkill.subTechniques[techId].unlocked) return;
    player.uniqueSkill.subTechniques[techId].proficiency = Math.max(0, Number(prof) || 0);
    if (!skipSave) saveStore();
}
