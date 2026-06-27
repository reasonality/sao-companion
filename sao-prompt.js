// SAO Prompt 清理与状态注入模块
// 从 index.js 拆分：SAO 标签清理、紧凑状态格式化、上下文状态注入

import { getSaoData, getContext, getSettings, isSaoCard, log, esc } from './sao-core.js';

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

// ============================================================
// 状态注入
// ============================================================

/**
 * 格式化紧凑状态文本（用于注入 AI 上下文）
 */
export function formatCompactState(state) {
    if (!state) return '';
    const parts = [];
    if (state.player_name) parts.push(`[玩家]${state.player_name}`);
    if (state.level != null) parts.push(`Lv${state.level}`);
    if (state.hp != null) parts.push(`HP:${state.hp}/${state.max_hp || '?'}`);
    if (state.mp != null) parts.push(`MP:${state.mp}/${state.max_mp || '?'}`);
    if (state.floor != null) parts.push(`${state.floor}F`);
    if (state.location) parts.push(`@${state.location}`);
    if (state.cor != null) parts.push(`珂尔:${state.cor}`);
    // 装备摘要
    if (state.equipment) {
        const equips = Object.entries(state.equipment)
            .filter(([, v]) => v && v.name)
            .map(([k, v]) => `${k}:${v.name}`)
            .join(',');
        if (equips) parts.push(`[装备]${equips}`);
    }
    // 技能摘要
    if (state.skills?.length) {
        const sk = state.skills.slice(0, 5).map(s => `${s.name}Lv${s.level}`).join(',');
        parts.push(`[技能]${sk}`);
    }
    // P3: 上轮战斗结算摘要（narrativeHint，让 LLM 自我修正叙事连续性，见 10.2 节）
    // 注意：不在 formatCompactState 中 delete——swipe/重新生成时 GENERATION_AFTER_COMMANDS 会再次触发，
    // 若已 delete 则 hint 丢失。改为在下一轮 MESSAGE_RECEIVED 处理器中清除（确认生成成功后）。
    if (state.lastCombatHint) {
        parts.push(state.lastCombatHint);
    }
    return parts.join(' | ');
}

export function injectMemoryAndState() {
    const ctx = getContext();
    const settings = getSettings();
    if (!settings.enabled || !isSaoCard()) return;

    const data = getSaoData();
    if (!data) return;
    const parts = [];

    // Core State（常驻，紧凑格式）
    const compactState = formatCompactState(data.state);
    if (compactState) {
        parts.push(compactState);
    }

    // 当前章节
    parts.push(`[章节]${settings.currentArc}`);

    // P2b: inject calendar date if available
    if (data?.calendar?.currentDate) {
        parts.push(`[日期]${data.calendar.currentDate}`);
    }

    if (parts.length > 0) {
        ctx.setExtensionPrompt('sao_companion_inject', parts.join('\n'), 1, 4, false, 0);
    }
}
