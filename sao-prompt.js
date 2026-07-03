// SAO Prompt 清理与状态注入模块
// 从 index.js 拆分：SAO 标签清理、紧凑状态格式化、上下文状态注入

import { getSaoData, getContext, getSettings, isSaoCard, log, esc } from './sao-core.js';
import { projectCompactState, projectFullState } from './sao-state-projection.js';
import { getStore } from './sao-store-core.js';

// ============================================================
// Phase 3: Prompt 清理 / 替代 promptOnly 正则
// ============================================================

/**
 * 需要从 prompt 中删除的 SAO 标签
 * 
 * 注意：此列表与 createSaoShadowHost 中的 CSS 隐藏列表不同：
 * - CSS 隐藏列表（calendar, user_status, equip, swordskill, map, zd_status）：
 *   只隐藏有 Shadow DOM 渲染器的标签，避免双重渲染
 * - Prompt 清理列表（本列表，12 个标签）：
 *   清理所有不应进入模型上下文的大块标签，无论是否有渲染器
 * - 差异：equip/swordskill 在 CSS 中隐藏但不从 prompt 清理（模型需要装备/技能数据）
 *         digest/guild/npc_status 等在 prompt 中清理但不 CSS 隐藏（无渲染器，不需要隐藏）
 */
export const SAO_PROMPT_STRIP_TAGS = [
    'zd_status',
    'user_status',
    'map',
    'digest',
    'guild',
    'npc_status',
    'npc_thoughts',
    'dice',
    'action',
    'preview',
    'output_instruction',
];

/**
 * 从文本中删除 SAO 标签块
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 */
export function cleanSaoPromptText(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const tag of SAO_PROMPT_STRIP_TAGS) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
        out = out.replace(re, '');
    }
    // 清理多余空行
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 从主 LLM prompt 副本中移除自动注入的大段原作时间线世界书内容。
 * 仅在 function calling 可用时调用；不可用时保留原注入作为 fallback。
 * @param {string} text
 * @returns {string}
 */
export function cleanTimelinePromptText(text) {
    if (!text || typeof text !== 'string') return text;
    const dateHeaderCount = (text.match(/^\s*#{1,6}\s*\*{0,2}\s*\d{1,2}月\d{1,2}日/gm) || []).length;
    const isoDateLineCount = (text.match(/^\s*\d{4}-\d{2}-\d{2}\s*[:：]/gm) || []).length;
    const hasTimelineKeyword = /世界历史背景|时间线|原作/.test(text);
    const looksLikeTimelineBook = hasTimelineKeyword && dateHeaderCount >= 2;
    const looksLikeTimelineList = hasTimelineKeyword && isoDateLineCount >= 3;
    if (!looksLikeTimelineBook && !looksLikeTimelineList) return text;
    return '[原作时间线]已改为按需查询：需要具体日期、范围或月份时调用 get_calendar 工具。不要根据被省略的时间线内容猜测。';
}

// ============================================================
// 状态注入
// ============================================================

/**
 * 格式化紧凑状态文本（用于注入 AI 上下文）
 *
 * @deprecated 当前生产代码不再调用（玩家状态已改为始终全量注入 via projectFullState）。
 * 保留供测试与潜在未来按需压缩使用。不要在生产路径新增调用。
 */
export function formatCompactState(state) {
    // A0: delegate to store projection layer
    // `state` parameter is kept for backward compat but ignored — projection reads from stores
    return projectCompactState();
}

export function injectMemoryAndState() {
    const ctx = getContext();
    const settings = getSettings();
    if (!settings.enabled || !isSaoCard()) return;

    const data = getSaoData();
    if (!data) return;
    const parts = [];

    // toolSupported 判断（提前到函数顶部，避免重复求值）
    const toolSupported = typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported();

    // Core State — 全量状态，始终注入（不依赖 tool call）
    const stateText = projectFullState();
    if (stateText) {
        parts.push(stateText);
    }

    // 当前章节
    parts.push(`[章节]${settings.currentArc}`);

    // P2b: inject calendar date if available (from calendarStore)
    const calStore = getStore()?.calendarStore;
    if (calStore?.currentDate) {
        parts.push(`[日期]${calStore.currentDate}`);
        if (toolSupported) {
            parts.push('[日历/原作时间线]不要猜测原作时间线或当前日程；需要查询某日、某月或范围事件时调用 get_calendar。');
        }
    }

    // P3: 告知 AI 有工具可用（仅 toolSupported 时注入）
    if (toolSupported) {
        parts.push(
            '## 可用工具\n' +
            '你可以通过 function calling 调用以下工具获取详细信息：\n' +
            '- get_floor_info(floor): 查询楼层设定（主题/主城/迷宫/BOSS）\n' +
            '- get_character_info(name): 查询NPC/角色档案\n' +
            '- get_calendar(date/month): 查询日历/时间线事件\n' +
            '- get_world_setting(topic): 查询世界设定规则（死亡游戏/经济/PK/战斗/技能/等级/房屋等）\n' +
            '- search_world_book(query): 按关键词搜索世界书条目（通用回退）\n' +
            '当你需要某楼层/NPC/事件/规则的详细信息时，优先调用工具而非猜测。'
        );
    }

    if (parts.length > 0) {
        ctx.setExtensionPrompt('sao_companion_inject', parts.join('\n'), 1, 4, false, 0);
    }
}

/**
 * 清理 prompt 中的数据类世界书条目注入（楼层/NPC/时间线等）。
 * 阶段5：当数据类条目由 tool call 接管后，禁用其世界书注入时启用此函数。
 * 当前数据类条目已 disabled（不在 prompt），暂不需要清理。
 * TODO: 阶段5 实现 — 在 CHAT_COMPLETION_PROMPT_READY 中调用，清理 data-entry 注入
 * @param {string} text
 * @returns {string}
 */
export function cleanDataEntryInjections(text) {
    // TODO: 阶段5 实现
    return text;
}
