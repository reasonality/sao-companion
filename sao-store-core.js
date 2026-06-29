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
