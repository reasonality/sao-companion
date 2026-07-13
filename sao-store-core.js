// sao-store-core.js — SAO Companion 多 Store 统一管理
// 替代旧的 flat data.state，提供结构化 store + 大小监控 + 面板缓存裁剪
// 与 sao-core.js 的 getSaoData()/saveSaoDataNow() 共存，读同一 chatMetadata 对象

import { MODULE_NAME, getContext, log } from './sao-core.js';

// ============================================================
// 常量
// ============================================================

/** 警告阈值：200KB — log warn */
const SIZE_WARNING_THRESHOLD = 200 * 1024;

/** 严重阈值：500KB — log error + 建议清理 */
const SIZE_CRITICAL_THRESHOLD = 500 * 1024;

/** 面板缓存最大条目数（panels / calendarPanels 各自独立限制）
 *  从50降到20，减少 store 体积（每条 specialist 面板 HTML 较大，
 *  50条易累积到 265KB+ 触发警告；20条够覆盖最近会话回看） */
const MAX_PANEL_ENTRIES = 20;

/** 快照最大条目数（FIFO cap，按 messageId 索引）。
 *  每条快照是处理 messageId 前 store 的深拷贝，用于 MESSAGE_DELETED 回滚。 */
const MAX_SNAPSHOTS = 20;

/** actionLog 最大条目数（FIFO cap） */
const ACTION_LOG_CAP = 20;

// ============================================================
// 默认 Store 结构
// ============================================================

/**
 * 新 store 的默认骨架。
 * 每次 getStore() 发现缺失时使用 structuredClone 填充。
 * @type {object}
 */
const DEFAULT_STORE = {
    schemaVersion: 1,
    skillStore: { byId: {}, nameToId: {} },
    equipmentStore: { byId: {}, nameToId: {} },
    playerStore: null,
    inventoryStore: null,
    npcStore: { byId: {}, nameToId: {} },
    floorStore: { byId: {}, numberToId: {} },
    calendarStore: { currentDate: null, events: {}, appointments: [], eventOverrides: {} },
    questStore: { byId: {}, activeIds: [], completedIds: [] },
    worldStore: { currentWeather: null, areaStatus: null, worldEvents: [], _updatedAt: null },
    consumableStore: { byId: {}, nameToId: {} },
    guildStore: { byId: {}, nameToId: {} },
    housingStore: { playerHousing: null },
    loreParsed: null,
    actionLog: { entries: [], lastInjectedTurn: 0, currentTurn: 0 },
    runtime: {},
    panels: {},
    calendarPanels: {},
    // 向后兼容字段（非迁移代码仍在使用）
    calendar: null,
};

// ============================================================
// Store 读取
// ============================================================

/**
 * 获取当前 chat 的 SAO store 对象（惰性初始化 + 旧数据迁移守卫）。
 *
 * 读取 `chatMetadata[MODULE_NAME]`，若不存在则用 DEFAULT_STORE 初始化。
 * 若存在但缺少 `schemaVersion`（旧 flat state），则保留 arc/panels/calendarPanels/calendar
 * 后替换为 DEFAULT_STORE 骨架并回写保留字段。
 *
 * @returns {object|null} store 对象，meta 不存在时返回 null
 */
export function getStore() {
    // 测试环境短路：允许 E2E 测试注入 mock state
    if (typeof globalThis !== 'undefined'
        && globalThis.__SAO_INTERNAL__
        && globalThis.__SAO_INTERNAL__.__testSaoData !== null
        && globalThis.__SAO_INTERNAL__.__testSaoData !== undefined) {
        return globalThis.__SAO_INTERNAL__.__testSaoData;
    }

    const ctx = getContext();
    const meta = ctx.chatMetadata;
    if (!meta) return null;  // 群聊或异常情况

    // ---- 首次初始化 ----
    if (!meta[MODULE_NAME]) {
        meta[MODULE_NAME] = structuredClone(DEFAULT_STORE);
    }

    const d = meta[MODULE_NAME];

    // ---- 旧数据迁移守卫 ----
    // 旧 flat state 没有 schemaVersion 字段
    if (d.schemaVersion === undefined) {
        log('[store-core] 检测到旧版 flat state，执行惰性迁移', 'warn');
        // 保留旧数据中需要延续的字段
        const preserved = {
            panels:     d.panels     ?? {},
            calendarPanels: d.calendarPanels ?? {},
            calendar:   d.calendar   ?? null,
        };
        // 替换为新骨架
        Object.assign(d, structuredClone(DEFAULT_STORE));
        // 回写保留字段
        d.panels         = preserved.panels;
        d.calendarPanels = preserved.calendarPanels;
        d.calendar       = preserved.calendar;
    }

    // ---- 字段完整性保障（防御性补全） ----
    if (!d.runtime)        d.runtime = {};
    if (!d.skillStore)     d.skillStore = { byId: {}, nameToId: {} };
    else {
        if (!d.skillStore.byId)     d.skillStore.byId = {};
        if (!d.skillStore.nameToId) d.skillStore.nameToId = {};
    }
    if (!d.equipmentStore) d.equipmentStore = { byId: {}, nameToId: {} };
    else {
        if (!d.equipmentStore.byId)     d.equipmentStore.byId = {};
        if (!d.equipmentStore.nameToId) d.equipmentStore.nameToId = {};
    }
    if (!d.npcStore)       d.npcStore = { byId: {}, nameToId: {} };
    else {
        if (!d.npcStore.byId)     d.npcStore.byId = {};
        if (!d.npcStore.nameToId) d.npcStore.nameToId = {};
    }
    if (!d.floorStore)     d.floorStore = { byId: {}, numberToId: {} };
    else {
        if (!d.floorStore.byId)        d.floorStore.byId = {};
        if (!d.floorStore.numberToId)  d.floorStore.numberToId = {};
    }
    if (!d.calendarStore)  d.calendarStore = { currentDate: null, events: {}, appointments: [], eventOverrides: {} };
    if (!d.questStore)     d.questStore = { byId: {}, activeIds: [], completedIds: [] };
    else {
        if (!d.questStore.byId)          d.questStore.byId = {};
        if (!d.questStore.activeIds)     d.questStore.activeIds = [];
        if (!d.questStore.completedIds)  d.questStore.completedIds = [];
    }
    if (!d.panels)         d.panels = {};
    if (!d.calendarPanels) d.calendarPanels = {};
    if (!d.worldStore)     d.worldStore = { currentWeather: null, areaStatus: null, worldEvents: [], _updatedAt: null };
    else {
        if (!Array.isArray(d.worldStore.worldEvents)) d.worldStore.worldEvents = [];
    }
    if (!d.consumableStore) d.consumableStore = { byId: {}, nameToId: {} };
    else {
        if (!d.consumableStore.byId)     d.consumableStore.byId = {};
        if (!d.consumableStore.nameToId) d.consumableStore.nameToId = {};
    }
    if (!d.guildStore) d.guildStore = { byId: {}, nameToId: {} };
    else {
        if (!d.guildStore.byId)     d.guildStore.byId = {};
        if (!d.guildStore.nameToId) d.guildStore.nameToId = {};
    }
    if (!d.housingStore) d.housingStore = { playerHousing: null };
    if (typeof d.consumableMigrationV1 !== 'boolean') d.consumableMigrationV1 = false;
    if (!d.actionLog) d.actionLog = { entries: [], lastInjectedTurn: 0, currentTurn: 0 };
    else {
        if (!Array.isArray(d.actionLog.entries)) d.actionLog.entries = [];
        if (typeof d.actionLog.lastInjectedTurn !== 'number') d.actionLog.lastInjectedTurn = 0;
        if (typeof d.actionLog.currentTurn !== 'number') d.actionLog.currentTurn = 0;
    }
    // Buffs: playerStore 惰性初始化（由 sao-store-player.js 负责），此处仅补全已有 playerStore 的 buffs
    if (d.playerStore && !d.playerStore.buffs) d.playerStore.buffs = { temporary: [], permanent: [] };

    // ---- consumable 迁移守卫（只跑一次） ----
    // M3: 加标记避免每次 getStore() 都 O(n) 遍历 items
    if (!d.consumableMigrationV1) {
        // 若已有 inventoryStore.items 含 consumable 且无 consumable_id，为每个 name 创建空壳定义
        if (d.inventoryStore && Array.isArray(d.inventoryStore.items)) {
            // Bug4 fix: 补全缺失的 item_id（useConsumable 按 item_id 查找）
            let maxInvNum = 0;
            // 先扫描已有 inv_* ID 的最大编号
            for (const item of d.inventoryStore.items) {
                if (item.item_id) {
                    const m = item.item_id.match(/^inv_(\d+)$/);
                    if (m) { const n = parseInt(m[1], 10); if (n > maxInvNum) maxInvNum = n; }
                }
            }

            for (const item of d.inventoryStore.items) {
                if (item.type === 'consumable' && !item.consumable_id && item.name) {
                    // 检查 consumableStore 是否已有同名定义
                    let consumableId = d.consumableStore.nameToId[item.name];
                    if (!consumableId || !d.consumableStore.byId[consumableId]) {
                        // 创建空壳定义
                        let maxNum = 0;
                        for (const id of Object.keys(d.consumableStore.byId)) {
                            const match = id.match(/^consumable_(\d+)$/);
                            if (match) {
                                const num = parseInt(match[1], 10);
                                if (num > maxNum) maxNum = num;
                            }
                        }
                        consumableId = 'consumable_' + String(maxNum + 1).padStart(3, '0');
                        d.consumableStore.byId[consumableId] = {
                            consumable_id: consumableId,
                            name: item.name,
                            category: 'hp_restore',
                            rarity: 'common',
                            item_level: 1,
                            effects: [],
                            stackable: true,
                            maxStack: 99,
                            description: item.description || '',
                            source: 'migrated'
                        };
                        d.consumableStore.nameToId[item.name] = consumableId;
                        log(`[store-core] 迁移守卫: 消耗品 "${item.name}" → ${consumableId}`);
                    }
                    // 给 item 加 consumable_id，删 item.name 和 item.description
                    item.consumable_id = consumableId;
                    delete item.name;
                    delete item.description;
                }
                // Bug4 fix: 补全缺失的 item_id（useConsumable 按 item_id 查找）
                if (item.type === 'consumable' && !item.item_id) {
                    maxInvNum++;
                    item.item_id = 'inv_' + String(maxInvNum).padStart(3, '0');
                    log(`[store-core] 迁移守卫: 补全 item_id → ${item.item_id}`);
                }
            }
        }
        d.consumableMigrationV1 = true;
    }

    // calendarStore 过渡同步：仅 currentDate（calendarStore 其余字段为 deferred 迁移保留，独立 PR 处理）
    if (d.calendar?.currentDate && !d.calendarStore.currentDate) {
        d.calendarStore.currentDate = d.calendar.currentDate;
    }

    return d;
}

// ============================================================
// Store 保存
// ============================================================

/**
 * 增强保存：大小监控 + 面板裁剪 + 持久化。
 * 替代旧的 saveSaoDataNow()，在 A0 迁移期供调用方切换。
 *
 * @returns {Promise<void>}
 */
export async function saveStore() {
    const d = getStore();
    if (!d) return;

    checkStoreSize(d);
    trimPanels(d);

    const ctx = getContext();
    if (ctx.saveMetadata) {
        await ctx.saveMetadata();
    }
}

/**
 * 重置 store 到初始状态（保留 arc 和 calendar 向后兼容）。
 * 用于调试/测试/用户手动重置。不自动 saveStore()，由调用方决定。
 */
export function resetStore() {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta) return;
    const preserved = {
        calendar: meta[MODULE_NAME]?.calendar ?? null,
    };
    meta[MODULE_NAME] = structuredClone(DEFAULT_STORE);
    meta[MODULE_NAME].calendar = preserved.calendar;
    log('[store-core] store 已重置');
}

// ============================================================
// 快照与回滚（方案 A：每条 AI 消息处理前快照 store，删除消息时恢复 + 回放）
// ============================================================

/** 快照存储：messageId → 处理该消息前的 store 深拷贝。
 *  存在 chatMetadata 内部（随聊天持久化），FIFO 上限 MAX_SNAPSHOTS。
 *  键名：`${MODULE_NAME}_snapshots`，避免与 store 本身冲突。 */
const SNAPSHOTS_KEY = MODULE_NAME + '_snapshots';

function _getSnapshotsMap() {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta) return null;
    if (!meta[SNAPSHOTS_KEY]) meta[SNAPSHOTS_KEY] = {};
    return meta[SNAPSHOTS_KEY];
}

/**
 * 捕获处理 messageId 前的 store 快照。
 * 在 MESSAGE_RECEIVED 处理链开始时调用（applyExtractedData 之前）。
 * 仅深拷贝 store 数据字段，不含 panels/calendarPanels（面板由专门缓存管理）。
 * @param {number} messageId
 */
export function captureSnapshot(messageId) {
    if (messageId == null) return;
    const d = getStore();
    if (!d) return;
    const map = _getSnapshotsMap();
    if (!map) return;

    // 深拷贝需要回滚的 store 字段（不含 panels/calendarPanels/runtime，
    // 这些由专门机制管理：panels 是缓存、runtime 是瞬时态）
    const snapshot = {
        skillStore: structuredClone(d.skillStore || {}),
        equipmentStore: structuredClone(d.equipmentStore || {}),
        playerStore: d.playerStore ? structuredClone(d.playerStore) : null,
        inventoryStore: d.inventoryStore ? structuredClone(d.inventoryStore) : null,
        npcStore: structuredClone(d.npcStore || {}),
        floorStore: structuredClone(d.floorStore || {}),
        calendarStore: structuredClone(d.calendarStore || {}),
        questStore: structuredClone(d.questStore || {}),
        worldStore: structuredClone(d.worldStore || {}),
        consumableStore: structuredClone(d.consumableStore || {}),
        guildStore: structuredClone(d.guildStore || {}),
        housingStore: structuredClone(d.housingStore || {}),
        loreParsed: d.loreParsed ? structuredClone(d.loreParsed) : null,
        actionLog: structuredClone(d.actionLog || {}),
    };

    // 存储 messageId（转 string 键）→ 快照
    const key = String(messageId);
    map[key] = snapshot;

    // FIFO cap：只保留最近 MAX_SNAPSHOTS 条
    const keys = Object.keys(map);
    if (keys.length > MAX_SNAPSHOTS) {
        // 按 messageId 数值排序，删除最早的
        keys.sort((a, b) => parseInt(a) - parseInt(b));
        const toRemove = keys.slice(0, keys.length - MAX_SNAPSHOTS);
        for (const k of toRemove) delete map[k];
    }
}

/**
 * 获取 messageId 的快照（处理该消息前的 store 状态）。
 * @param {number} messageId
 * @returns {object|null}
 */
export function getSnapshot(messageId) {
    if (messageId == null) return null;
    const map = _getSnapshotsMap();
    if (!map) return null;
    return map[String(messageId)] || null;
}

/**
 * 从快照恢复 store 状态（删除 messageId 时调用）。
 * 恢复为处理该消息前的状态，然后由调用方回放后续消息。
 * @param {number} messageId
 * @returns {boolean} 恢复成功
 */
export function restoreSnapshot(messageId) {
    if (messageId == null) return false;
    const snapshot = getSnapshot(messageId);
    if (!snapshot) {
        log(`restoreSnapshot: 无 messageId ${messageId} 的快照`, 'warn');
        return false;
    }
    const d = getStore();
    if (!d) return false;

    // 恢复各 store 字段
    d.skillStore = structuredClone(snapshot.skillStore);
    d.equipmentStore = structuredClone(snapshot.equipmentStore);
    d.playerStore = snapshot.playerStore ? structuredClone(snapshot.playerStore) : null;
    d.inventoryStore = snapshot.inventoryStore ? structuredClone(snapshot.inventoryStore) : null;
    d.npcStore = structuredClone(snapshot.npcStore);
    d.floorStore = structuredClone(snapshot.floorStore);
    d.calendarStore = structuredClone(snapshot.calendarStore);
    d.questStore = structuredClone(snapshot.questStore);
    d.worldStore = structuredClone(snapshot.worldStore);
    d.consumableStore = structuredClone(snapshot.consumableStore);
    d.guildStore = structuredClone(snapshot.guildStore);
    d.housingStore = structuredClone(snapshot.housingStore);
    d.loreParsed = snapshot.loreParsed ? structuredClone(snapshot.loreParsed) : null;
    d.actionLog = structuredClone(snapshot.actionLog);

    // 清理 runtime（瞬时态，回滚后重置）
    d.runtime = {};

    // 不删除快照——ST 删除消息后索引下移，后续删除会用移位后的索引
    // 调用 restoreSnapshot，若删除快照会导致第二次删除找不到匹配。
    // 快照由 FIFO 上限自动淘汰，不需要手动清理。

    log(`restoreSnapshot: 已恢复到 messageId ${messageId} 处理前的状态`);
    return true;
}

/**
 * 删除 messageId 及之后的所有快照（用于删除消息后清理）。
 * @param {number} messageId
 */
export function clearSnapshotsFrom(messageId) {
    if (messageId == null) return;
    const map = _getSnapshotsMap();
    if (!map) return;
    for (const key of Object.keys(map)) {
        if (parseInt(key) >= messageId) delete map[key];
    }
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 检查 store JSON 大小，超阈值时输出警告/错误日志。
 * @param {object} d store 对象
 */
function checkStoreSize(d) {
    try {
        const size = JSON.stringify(d).length;
        if (size >= SIZE_CRITICAL_THRESHOLD) {
            log(`Store 数据过大 (${(size / 1024).toFixed(0)}KB)，建议开新 chat 或清理渲染缓存`, 'error');
        } else if (size >= SIZE_WARNING_THRESHOLD) {
            log(`Store 数据较大 (${(size / 1024).toFixed(0)}KB)，注意 chat 保存性能`, 'warn');
        }

        // === 诊断：各子 store 体积明细 ===
        const subKeys = [
            'skillStore', 'equipmentStore', 'playerStore', 'inventoryStore',
            'npcStore', 'floorStore', 'calendarStore', 'questStore',
            'worldStore', 'consumableStore', 'guildStore', 'housingStore',
            'actionLog', 'runtime', 'panels', 'calendarPanels', 'calendar',
        ];
        const parts = [];
        for (const key of subKeys) {
            if (d[key] === undefined || d[key] === null) continue;
            try {
                const sub = JSON.stringify(d[key]).length;
                if (sub > 512) parts.push(`${key}:${(sub / 1024).toFixed(1)}KB`);
            } catch (e) { /* skip */ }
        }
        log(`[size-breakdown] ${parts.join(' | ')}`, 'info');

        // floorStore 深度细分：canon vs state vs meta
        if (d.floorStore?.byId) {
            let canon = 0, state = 0, meta = 0, n = 0;
            for (const id of Object.keys(d.floorStore.byId)) {
                const f = d.floorStore.byId[id];
                n++;
                if (f.canon) canon += JSON.stringify(f.canon).length;
                if (f.state) state += JSON.stringify(f.state).length;
                meta += JSON.stringify({ floor_id: f.floor_id, floor_number: f.floor_number, name: f.name, source: f.source, _canonHash: f._canonHash }).length;
            }
            log(`[floor-breakdown] ${n}层 | canon ${(canon / 1024).toFixed(1)}KB | state ${(state / 1024).toFixed(1)}KB | meta ${(meta / 1024).toFixed(1)}KB`, 'info');
        }
        // === 诊断结束 ===
    } catch (e) {
        // stringify 失败不阻塞保存流程
    }
}

/**
 * 裁剪 panels / calendarPanels 缓存，每个最多保留 MAX_PANEL_ENTRIES 条。
 * 按 messageId 数值排序，保留最大的（最新的）条目。
 * @param {object} d store 对象
 */
function trimPanels(d) {
    trimPanelMap(d.panels, 'panels');
    trimPanelMap(d.calendarPanels, 'calendarPanels');
}

/**
 * 裁剪单个面板缓存 map。
 * @param {Record<string, object>} map 面板缓存对象
 * @param {string} label 日志标签
 */
function trimPanelMap(map, label) {
    const keys = Object.keys(map);
    if (keys.length <= MAX_PANEL_ENTRIES) return;

    // 按 messageId 数值降序排列，保留前 MAX_PANEL_ENTRIES 个
    const sorted = keys
        .map(k => ({ key: k, num: Number(k) }))
        .sort((a, b) => b.num - a.num);

    const keep = new Set(sorted.slice(0, MAX_PANEL_ENTRIES).map(e => e.key));

    for (const k of keys) {
        if (!keep.has(k)) {
            delete map[k];
        }
    }

    log(`[store-core] 裁剪 ${label}：${keys.length} → ${MAX_PANEL_ENTRIES} 条`);
}

// ============================================================
// actionLog 机制
// ============================================================

/**
 * 追加操作日志条目。
 * entry 形如 { action, itemType, itemName, detail?, result, resultDetail? }。
 * 函数补全 turn 和 timestamp，FIFO cap 20。
 * 不 saveStore（由调用方 save）。
 * @param {object} entry
 */
export function appendActionLog(entry) {
    const store = getStore();
    if (!store) return;
    if (!store.actionLog) store.actionLog = { entries: [], lastInjectedTurn: 0, currentTurn: 0 };

    const enriched = {
        ...entry,
        turn: store.actionLog.currentTurn || 0,
        timestamp: Date.now()
    };

    store.actionLog.entries.push(enriched);

    // FIFO cap
    while (store.actionLog.entries.length > ACTION_LOG_CAP) {
        store.actionLog.entries.shift();
    }
}

/**
 * 投影 actionLog 提示字符串（供 status 专家 systemPrompt 注入）。
 * 过滤 entries 中 turn > lastInjectedTurn 的条目。
 * @returns {string} 格式化字符串，无则返回 ''
 */
export function projectActionLogHint() {
    const store = getStore();
    if (!store || !store.actionLog || !Array.isArray(store.actionLog.entries)) return '';

    const minTurn = store.actionLog.lastInjectedTurn || 0;
    const recent = store.actionLog.entries.filter(e => e.turn > minTurn);
    if (recent.length === 0) return '';

    return recent.map(e => {
        const detail = e.resultDetail ? ` (${e.resultDetail})` : '';
        return `${e.action}: ${e.itemName || ''}${detail}`;
    }).join('\n');
}
