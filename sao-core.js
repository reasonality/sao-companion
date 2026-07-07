// sao-core.js — SAO Companion 基础设施层
// ST API 封装 + 状态管理 + 日志 + 纯工具
// 被所有其他功能模块共享依赖

import { eventSource } from '../../../events.js';

// ============================================================
// 常量
// ============================================================

export const MODULE_NAME = 'sao_companion';
const MAX_LOGS = 100;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // 多模型 API 配置 (直接存储 endpoint/key/model)
    models: {
        // 3 主档（对应文档 3 类 LLM 角色）
        state:      { url: '', key: '', model: '' },  // 玩家/NPC 状态 LLM
        equipment:  { url: '', key: '', model: '' },  // 装备/技能 LLM
        world:      { url: '', key: '', model: '' },  // 世界/日历/任务 LLM
        // 子角色覆盖（高级，可选；空则回退到所属主档）
        extract:    { url: '', key: '', model: '' },  // 状态提取（→state）
        status:     { url: '', key: '', model: '' },  // 状态面板专家（→state）
        combat:     { url: '', key: '', model: '' },  // 战斗/生成（→equipment）
        swordskill: { url: '', key: '', model: '' },  // 剑技面板专家（→equipment）
        calendar:   { url: '', key: '', model: '' },  // 日历（→world）
        quest:      { url: '', key: '', model: '' },  // 任务（→world）
        map:        { url: '', key: '', model: '' },  // 地图面板专家（→world）
    },
    // v2 日历 LLM 模型开关（opt-in 默认关）
    saoCalendar: { llmEnabled: false },
    // P2: 专家面板开关（opt-in 默认开——装饰面板专家化是核心收益）
    specialistPanels: { enabled: true },
    // SAO 卡兼容模式（替代 TavernHelper 脚本）
    compatMode: true,  // 自动关闭不兼容选项 + 启用角色卡正则
});

// ============================================================
// 可变状态
// ============================================================

export const logs = [];

// ============================================================
// 事件监听追踪（M8）：所有 eventSource/document 监听统一通过这里登记，
// deactivate 时统一移除。避免 ST 扩展热重载/自动更新时监听器翻倍。
// 各模块（index/sao-tools/sao-calendar-model）应使用 bindSaoEvent/bindSaoDom 而非裸 on/addEventListener。
// ============================================================
export const _saoEventBindings = []; // {target:'eventSource'|'dom', type, fn, domTarget?}
let _eventsBound = false;

/** 绑定 eventSource 事件并登记。 */
export function bindSaoEvent(type, fn) {
    eventSource.on(type, fn);
    _saoEventBindings.push({ target: 'eventSource', type, fn });
}

/** 绑定 document 事件并登记。 */
export function bindSaoDom(type, fn, target = document) {
    target.addEventListener(type, fn);
    _saoEventBindings.push({ target: 'dom', type, fn, domTarget: target });
}

/** 移除所有已登记的监听器（deactivate 调用）。 */
export function unbindAllSaoEvents() {
    for (const b of _saoEventBindings) {
        try {
            if (b.target === 'eventSource') {
                // ST 的 EventEmitter 提供 removeListener（非 off）；off?. 兜底防旧版/mock 差异。
                const remover = eventSource.removeListener || eventSource.off;
                if (remover) remover.call(eventSource, b.type, b.fn);
            } else if (b.target === 'dom') {
                b.domTarget.removeEventListener(b.type, b.fn);
            }
        } catch { /* ignore */ }
    }
    _saoEventBindings.length = 0;
    _eventsBound = false;
}

/**
 * v1→v2 模型配置迁移：旧 5 槽（narrative/combat/extract/calendar/specialist）→ 新 3 主档 + 子角色。
 * 旧 extract → state 主档 + extract 子角色保留；
 * 旧 calendar → world 主档 + calendar 子角色保留；旧 narrative/specialist 丢弃（无消费者）。
 * 幂等：已迁移（_modelConfigVersion >= 2）则跳过。
 */
function _migrateModelSettingsV1ToV2(s) {
    if (!s.models) return;
    if (s._modelConfigVersion >= 2) return;
    const m = s.models;
    // 旧值迁移到新主档（仅当新主档为空时填充）
    if (!m.state && (m.extract || m.specialist)) {
        m.state = structuredClone(m.extract || m.specialist);
    }
    if (!m.world && m.calendar) {
        m.world = structuredClone(m.calendar);
    }
    // 清理废弃键
    delete m.narrative;
    delete m.specialist;
    delete m.combat;
    s._modelConfigVersion = 2;
}

export function isSaoEventsBound() { return _eventsBound; }
export function setSaoEventsBound(v) { _eventsBound = v; }

// ============================================================
// 纯工具
// ============================================================

export function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** try/catch wrapper: returns null on failure. Replaces 3 duplicate definitions. */
export function safe(fn, label) {
    try { return fn(); } catch (e) {
        if (label) console.warn('[SAO] ' + label + ':', e);
        return null;
    }
}

/** Dedup key: strip whitespace, take first 20 chars. Replaces 2 duplicate definitions. */
export function _dedupKey(str) {
    return String(str || '').replace(/\s+/g, '').substring(0, 20);
}

/**
 * 安全 JSON 解析（失败返回 null，不抛出）。共享工具。
 */
export function safeJsonParse(s) {
    if (s == null || typeof s !== 'string') return null;
    try { return JSON.parse(s); } catch (e) { return null; }
}

// ============================================================
// ST API 封装
// ============================================================

export function getContext() {
    return SillyTavern.getContext();
}

export function getCurrentCharacter() {
    const ctx = getContext();
    if (ctx.characterId === undefined || ctx.characterId === null) return null;
    return ctx.characters?.[ctx.characterId] ?? null;
}

export function isSaoCard() {
    const char = getCurrentCharacter();
    if (!char) return false;
    return char.name === '刀剑神域SAO' || (typeof char.data?.extensions?.world === 'string' && char.data.extensions.world.startsWith('刀剑神域SAO'));
}

// ============================================================
// 设置管理
// ============================================================

export function getSettings() {
    const ctx = getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    // 兼容旧版本：确保 models 对象存在
    if (!s.models) {
        s.models = structuredClone(DEFAULT_SETTINGS.models);
    }
    // v1→v2 模型配置迁移（5 槽 → 3 主档 + 子角色）
    _migrateModelSettingsV1ToV2(s);
    // 兼容旧版本：补全可能缺失的各角色 model 配置（如新增 calendar）
    for (const role of Object.keys(DEFAULT_SETTINGS.models)) {
        if (!s.models[role]) {
            s.models[role] = structuredClone(DEFAULT_SETTINGS.models[role]);
        }
    }
    // 兼容旧版本：确保 saoCalendar 开关存在
    if (!s.saoCalendar) {
        s.saoCalendar = structuredClone(DEFAULT_SETTINGS.saoCalendar);
    }
    // 兼容旧版本：确保 specialistPanels 开关存在（P2）
    if (!s.specialistPanels) {
        s.specialistPanels = structuredClone(DEFAULT_SETTINGS.specialistPanels);
    }
    return s;
}

// ============================================================
// 状态管理
// ============================================================

export function getSaoData() {
    // 测试环境短路：允许 E2E 测试注入 mock state
    if (typeof globalThis !== 'undefined' && globalThis.__SAO_INTERNAL__ && globalThis.__SAO_INTERNAL__.__testSaoData !== null) {
        return globalThis.__SAO_INTERNAL__.__testSaoData;
    }
    const ctx = getContext();
    const meta = ctx.chatMetadata;
    if (!meta) return null;  // 群聊或异常情况
    if (!meta[MODULE_NAME]) {
        meta[MODULE_NAME] = { state: null, calendar: null, calendarPanels: {}, panels: {} };
    }
    const d = meta[MODULE_NAME];
    // 兼容旧字段
    if (d.calendar === undefined) d.calendar = null;
    // Phase 1: 兼容旧版本，补全 calendarPanels（日历面板按 messageId 缓存）
    if (!d.calendarPanels) d.calendarPanels = {};
    // P2: 兼容旧版本，补全 panels（专家面板按 messageId 缓存）
    if (!d.panels) d.panels = {};
    return d;
}

export async function saveSaoDataNow() {
    // A0: deprecated 别名——委托 saveStore（含 checkStoreSize + trimPanels）
    // 保留旧接口名避免外部调用方断裂；新代码应直接用 saveStore()
    const { saveStore } = await import('./sao-store-core.js');
    await saveStore();
}

// ============================================================
// 日志基础设施
// ============================================================

export function log(msg, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, msg };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[SAO Companion] ${prefix} ${msg}`);
    // 更新面板日志显示
    updateLogDisplay();
}

export function updateLogDisplay() {
    const el = document.getElementById('sao_log_display');
    if (!el) return;
    el.innerHTML = logs.slice().reverse().map(e =>
        `<div class="sao-log-entry"><span class="sao-log-time">${esc(e.time)}</span>${esc(e.msg)}</div>`
    ).join('');
}
