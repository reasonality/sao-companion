// sao-store-world.js — 世界状态数据层
// 天气：由 extractAll 正则提取写入（确定性，不经LLM）
// 区域状态/世界事件：由世界专家 LLM 产出写入

import { getStore, saveStore } from './sao-store-core.js';
import { getPlayerStore } from './sao-store-player.js';
import { updateFloorState } from './sao-store-floor.js';
import { log } from './sao-core.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 worldStore 及其子字段存在，返回 worldStore 引用。
 * @returns {object}
 */
function ensureWorldStore() {
    const store = getStore();
    if (!store.worldStore) {
        store.worldStore = { currentWeather: null, areaStatus: null, worldEvents: [], rules: {}, _updatedAt: null };
    }
    if (!Array.isArray(store.worldStore.worldEvents)) {
        store.worldStore.worldEvents = [];
    }
    if (!store.worldStore.rules || typeof store.worldStore.rules !== 'object') {
        store.worldStore.rules = {};
    }
    return store.worldStore;
}

/** worldEvents 最大条目数 */
const MAX_WORLD_EVENTS = 30;

/** BOSS 讨伐检测正则 */
const BOSS_CLEAR_RE = /BOSS.*?(讨伐|攻略)|(?:楼层|层)\s*BOSS\s*(?:cleared|defeated|defeat)/i;

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 worldStore 引用（惰性初始化）。
 * @returns {object}
 */
export function getWorldStore() {
    return ensureWorldStore();
}

/**
 * 应用世界专家输出到 worldStore。
 * - areaStatus：覆盖写入
 * - worldEvents：追加 + cap 30
 * - 检测 BOSS 讨伐事件时自动标记对应楼层 cleared: true
 *
 * @param {object} worldData - 专家输出 { areaStatus?, worldEvents? }
 * @returns {Promise<void>}
 */
export async function applyWorldUpdates(worldData) {
    if (!worldData || typeof worldData !== 'object') return;

    const ws = ensureWorldStore();
    const store = getStore();

    // areaStatus：覆盖
    if (worldData.areaStatus != null) {
        ws.areaStatus = worldData.areaStatus;
    }

    // worldEvents：追加 + cap
    if (Array.isArray(worldData.worldEvents) && worldData.worldEvents.length > 0) {
        // 从 calendarStore 获取当前日期
        const dateText = store?.calendarStore?.currentDate || '';

        for (const evt of worldData.worldEvents) {
            if (!evt || typeof evt.event !== 'string') continue;
            const entry = {
                date: dateText,
                event: evt.event,
                floor_id: evt.floor_id || null,
            };
            ws.worldEvents.push(entry);

            // 检测 BOSS 讨伐事件 → updateFloorState cleared: true
            if (BOSS_CLEAR_RE.test(evt.event)) {
                const floorId = evt.floor_id;
                if (floorId) {
                    try {
                        await updateFloorState(floorId, { cleared: true }, true);
                        log(`[world] BOSS 讨伐检测: ${floorId} → cleared=true`);
                    } catch (e) {
                        log(`[world] 更新楼层 cleared 失败: ${e.message}`, 'warn');
                    }
                }
            }
        }

        // cap 30
        if (ws.worldEvents.length > MAX_WORLD_EVENTS) {
            ws.worldEvents = ws.worldEvents.slice(-MAX_WORLD_EVENTS);
        }
    }

    ws._updatedAt = new Date().toISOString();
    await saveStore();
}

/**
 * 投影世界状态摘要字符串（供专家 prompt 用）。
 * 格式: "天气:晴天 | 区域:起始之城镇(安全) | 最近事件:XXX"
 *
 * @returns {string}
 */
export function projectWorldHint() {
    const ws = safe(() => ensureWorldStore(), 'ensureWorldStore');
    if (!ws) return '';

    const parts = [];

    // 天气
    if (ws.currentWeather?.condition) {
        parts.push(`天气:${ws.currentWeather.condition}`);
    }

    // 区域状态
    if (ws.areaStatus) {
        const a = ws.areaStatus;
        const dangerLabel = { safe: '安全', low: '低危', medium: '中危', high: '高危', extreme: '极危' };
        const danger = dangerLabel[a.danger_level] || a.danger_level || '';
        const loc = a.location || '';
        parts.push(`区域:${loc}${danger ? `(${danger})` : ''}`);
    } else {
        // 回退：读 playerStore.position
        try {
            const player = getPlayerStore();
            if (player?.position?.location) {
                parts.push(`区域:${player.position.location}`);
            }
        } catch { /* ignore */ }
    }

    // 最近事件
    if (ws.worldEvents?.length > 0) {
        const latest = ws.worldEvents[ws.worldEvents.length - 1];
        parts.push(`最近事件:${latest.event}`);
    }

    return parts.join(' | ');
}

/**
 * 安全执行函数，失败时返回 null。
 */
function safe(fn, label) {
    try {
        return fn();
    } catch (e) {
        log(`[store-world] ${label} 失败: ${e.message}`, 'warn');
        return null;
    }
}
