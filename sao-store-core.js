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

/** 面板缓存最大条目数（panels / calendarPanels 各自独立限制） */
const MAX_PANEL_ENTRIES = 50;

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
    calendarStore: { currentDate: null, events: {}, appointments: [] },
    questStore: { byId: {}, activeIds: [], completedIds: [] },
    worldStore: { currentWeather: null, areaStatus: null, worldEvents: [], _updatedAt: null },
    consumableStore: { byId: {}, nameToId: {} },
    loreParsed: null,
    actionLog: { entries: [], lastInjectedTurn: 0, currentTurn: 0 },
    runtime: {},
    panels: {},
    calendarPanels: {},
    // 向后兼容字段（非迁移代码仍在使用）
    arc: 'sao',
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
            arc:        d.arc        ?? 'sao',
            panels:     d.panels     ?? {},
            calendarPanels: d.calendarPanels ?? {},
            calendar:   d.calendar   ?? null,
        };
        // 替换为新骨架
        Object.assign(d, structuredClone(DEFAULT_STORE));
        // 回写保留字段
        d.arc            = preserved.arc;
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
    if (!d.calendarStore)  d.calendarStore = { currentDate: null, events: {}, appointments: [] };
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
    if (typeof d.consumableMigrationV1 !== 'boolean') d.consumableMigrationV1 = false;
    if (!d.actionLog) d.actionLog = { entries: [], lastInjectedTurn: 0, currentTurn: 0 };
    else {
        if (!Array.isArray(d.actionLog.entries)) d.actionLog.entries = [];
        if (typeof d.actionLog.lastInjectedTurn !== 'number') d.actionLog.lastInjectedTurn = 0;
        if (typeof d.actionLog.currentTurn !== 'number') d.actionLog.currentTurn = 0;
    }

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
        arc: meta[MODULE_NAME]?.arc ?? 'sao',
        calendar: meta[MODULE_NAME]?.calendar ?? null,
    };
    meta[MODULE_NAME] = structuredClone(DEFAULT_STORE);
    meta[MODULE_NAME].arc = preserved.arc;
    meta[MODULE_NAME].calendar = preserved.calendar;
    log('[store-core] store 已重置');
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
