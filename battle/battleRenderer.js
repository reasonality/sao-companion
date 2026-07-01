// battle/battleRenderer.js
// 渲染主入口 - 将战斗系统注入 Shadow DOM

import { BATTLE_TEMPLATE, BATTLE_CSS } from './battleTemplate.js';
import {
    setBattleDomRoot,
    initializeInterface,
    initializeBattleInterface,
    initializeBattleDom,
    initializeBattleSideEffects,
} from './battleLogic.js';
import { createSaoShadowHost } from '../sao-dom-utils.js';

// === P4b: battleHostRegistry — 全局 Shadow DOM 宿主注册表 ===
const battleHostRegistry = new Map(); // Map<messageId, {host, shadowRoot}>

/**
 * Bug7: 若 zdText 缺少玩家基础数据（[HP:...]），从 store playerStore 补全。
 * 避免战前准备面板显示全零。
 * @param {string} zdText - 原始 zd_status 文本
 * @returns {string} 补全后的文本
 */
function augmentZdTextFromStore(zdText) {
    if (!zdText) return zdText;
    // 已有 HP 数据则不补全
    if (/\[HP:\d/.test(zdText)) return zdText;

    try {
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        const meta = ctx?.chatMetadata?.sao_companion;
        const ps = meta?.playerStore;
        if (!ps) return zdText;

        const parts = [];
        // 玩家名
        if (meta.playerStore?.name || meta.playerCursor?.name) {
            parts.push(`[PR:${meta.playerCursor?.name || meta.playerStore?.name || ''}]`);
        }
        // HP / MP
        const hp = ps.vitals?.hp ?? 0;
        const maxHp = ps.vitals?.maxHp ?? 0;
        const mp = ps.vitals?.mp ?? 0;
        const maxMp = ps.vitals?.maxMp ?? 0;
        parts.push(`[HP:${hp}/${maxHp}]`);
        parts.push(`[MP:${mp}/${maxMp}]`);
        // 属性
        const str = ps.attributes?.str ?? 0;
        const agi = ps.attributes?.agi ?? 0;
        const intel = ps.attributes?.int ?? 0;
        const vit = ps.attributes?.vit ?? 0;
        parts.push(`[STR:${str}]`);
        parts.push(`[AGI:${agi}]`);
        parts.push(`[INT:${intel}]`);
        parts.push(`[VIT:${vit}]`);
        // 等级
        const level = ps.progression?.level ?? 1;
        parts.push(`[GR:${level}]`);

        // 追加到 zdText 末尾（保持原有数据完整）
        zdText = zdText + parts.join('');
    } catch (e) {
        console.warn('[BattleRenderer] augmentZdTextFromStore 失败:', e);
    }
    return zdText;
}

/**
 * 注册战斗面板宿主到全局注册表
 * @param {number} messageId - 消息 ID
 * @param {HTMLElement} host - Shadow DOM 宿主元素
 * @param {ShadowRoot} shadowRoot - Shadow DOM 根
 */
export function registerBattleHost(messageId, host, shadowRoot) {
    if (messageId == null || !host || !shadowRoot) return;
    battleHostRegistry.set(messageId, { host, shadowRoot });
}

/**
 * 清空注册表（用于会话切换等场景）
 */
export function clearBattleHostRegistry() {
    battleHostRegistry.clear();
}

/**
 * 删除单条注册表项（用于 swipe 切换等场景，避免清除其他消息的战斗面板）
 * @param {number} messageId - 消息 ID
 */
export function removeBattleHost(messageId) {
    battleHostRegistry.delete(messageId);
}

/**
 * 更新单个 HP/MP 条的 fill 宽度和文字
 * @param {Element} container - 包含 fill/text 元素的容器
 * @param {string} fillSel - fill 元素选择器
 * @param {string} textSel - text 元素选择器
 * @param {number} cur - 当前值
 * @param {number} max - 最大值
 */
function updateBar(container, fillSel, textSel, cur, max) {
    const fill = container.querySelector(fillSel);
    if (fill && max) fill.style.width = `${Math.max(0, Math.min(100, (cur / max) * 100))}%`;
    const text = container.querySelector(textSel);
    if (text) text.textContent = `${Math.max(0, cur)}/${max || '?'}`;
}

/**
 * P4b: 战斗结算后更新 Shadow DOM 面板（HP/MP 条 + 敌人状态）
 * @param {number} messageId - 消息 ID
 * @param {Object} combatResult - resolveCombatRound 返回的结算对象
 */
export function updateBattlePanelAfterCombat(messageId, combatResult) {
    const entry = battleHostRegistry.get(messageId);
    if (!entry || !combatResult) return;
    const { shadowRoot } = entry;

    try {
        // 1. 更新玩家 HP/MP 条
        if (combatResult.playerAfter) {
            const p = combatResult.playerAfter;
            const panel = shadowRoot.querySelector('#combat-player-panel');
            updateBar(panel, '.hp-fill', '.hp-text', p.hp, p.maxHp);
            updateBar(panel, '.mp-fill', '.mp-text', p.mp, p.maxMp);
        }

        // 2. 更新敌人列表 HP 状态
        if (Array.isArray(combatResult.enemiesAfter)) {
            const enemyItems = shadowRoot.querySelectorAll('#combat-enemy-panel .enemy-item');
            combatResult.enemiesAfter.forEach((enemy, idx) => {
                if (idx >= enemyItems.length) return;
                updateBar(enemyItems[idx], '.hp-fill', '.hp-text', enemy.hp, enemy.maxHp);
                if (enemy.defeated) {
                    enemyItems[idx].style.opacity = '0.4';
                    enemyItems[idx].style.filter = 'grayscale(1)';
                }
            });
        }

        // 3. 更新队友 HP 状态
        if (Array.isArray(combatResult.teammatesAfter)) {
            const tmItems = shadowRoot.querySelectorAll('.teammate-item');
            combatResult.teammatesAfter.forEach((tm, idx) => {
                if (idx >= tmItems.length) return;
                updateBar(tmItems[idx], '.hp-fill', '.hp-text', tm.hp, tm.maxHp);
            });
        }
    } catch (e) {
        console.error('[BattleRenderer] updateBattlePanelAfterCombat 失败:', e);
    }
}

/**
 * 在消息元素中渲染战斗面板
 * @param {HTMLElement} messageEl - 消息容器元素（.mes 或类似）
 * @param {string} rawText - 原始消息文本，包含 <zd_status> 数据
 * @param {number} [messageId] - 可选消息 ID，用于注册 battleHostRegistry + P3 专家面板数据
 */
export function renderBattlePanel(messageEl, rawText, messageId) {
    // P3: 优先从专家面板数据读取 zdText；回退到 mes 标签（过渡兼容）
    let zdText = null;
    if (messageId != null) {
        try {
            // 通过 SillyTavern 上下文获取 chatMetadata（battleRenderer 不直接 import sao-core 以避免循环依赖）
            const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
            const meta = ctx?.chatMetadata?.sao_companion;
            const statusPanel = meta?.panels?.[messageId]?.status;
            // statusPanel.html 存的是 {state, zdText, userStatusHtml} 对象
            const panelData = statusPanel && (typeof statusPanel.html === 'string')
                ? (() => { try { return JSON.parse(statusPanel.html); } catch(e) { return null; } })()
                : statusPanel?.html;
            if (panelData && typeof panelData.zdText === 'string' && panelData.zdText.length > 0) {
                zdText = panelData.zdText;
            }
        } catch (e) { /* 读取失败，走回退 */ }
    }
    if (!zdText) {
        const zdMatch = rawText.match(/<zd_status>\s*([\s\S]*?)\s*<\/zd_status>/i);
        if (!zdMatch) return;
        zdText = zdMatch[1];
    }

    // 检查是否已渲染
    const existing = messageEl.querySelector('.sao-render-host[data-sao-tag="battle"]');
    if (existing) return;

    // 通过共享的 createSaoShadowHost 创建宿主并定位（位置插入 zd_status 锚点 + <p> 提升）
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('zd_status');
    const { shadow, host } = createSaoShadowHost(messageEl, 'battle', refNode);

    // 注入 CSS
    const style = document.createElement('style');
    style.textContent = BATTLE_CSS;
    shadow.appendChild(style);

    // 注入 Font Awesome CSS 到 Shadow DOM（全局样式不穿透 Shadow 边界）
    const faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    shadow.appendChild(faLink);

    // 注入 HTML 模板
    const templateWrapper = document.createElement('div');
    templateWrapper.innerHTML = BATTLE_TEMPLATE;
    while (templateWrapper.firstChild) {
        shadow.appendChild(templateWrapper.firstChild);
    }

    // 设置 domRoot 为 Shadow DOM
    setBattleDomRoot(shadow);

    // 注入 <zd_status> 数据到隐藏的数据源
    // Bug7: 若 zdText 缺少玩家基础数据（HP/MP/属性），从 store 补全
    const augmentedZdText = augmentZdTextFromStore(zdText);
    const dataSource = shadow.getElementById('status-data-source');
    if (dataSource) {
        dataSource.textContent = augmentedZdText;
    }

    // 初始化战斗系统
    try {
        if (typeof initializeBattleSideEffects === 'function') initializeBattleSideEffects();
        else console.warn('[BattleRenderer] initializeBattleSideEffects not found');
    } catch (e) {
        console.error('[BattleRenderer] initializeBattleSideEffects 失败:', e);
        return; // 阻断后续初始化
    }

    try {
        initializeBattleDom();
    } catch (e) {
        console.error('[BattleRenderer] initializeBattleDom 失败:', e);
        // 不 return —— initializeInterface 有 guard 会静默处理
    }

    try {
        initializeInterface();
    } catch (e) {
        console.error('[BattleRenderer] initializeInterface 失败:', e);
        // 不 return —— initializeBattleInterface 完全独立
    }

    try {
        initializeBattleInterface();
    } catch (e) {
        console.error('[BattleRenderer] initializeBattleInterface 失败:', e);
    }

    // P4b: 注册宿主到全局注册表（供后续 combatResult 更新使用）
    if (messageId != null) {
        registerBattleHost(messageId, host, shadow);
    }
}
