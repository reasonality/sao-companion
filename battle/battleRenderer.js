// battle/battleRenderer.js
// 渲染主入口 - 将战斗系统注入 Shadow DOM

import { getBattleTemplate, getBattleCSS } from './battleTemplate.js';
import {
    setBattleDomRoot,
    initializeInterface,
    startBattle,
    setupSendDetection,
    initializeBattleInterface,
    initializeBattleDom,
    initializeBattleSideEffects,
} from './battleLogic.js';

/**
 * 在消息元素中渲染战斗面板
 * @param {HTMLElement} messageEl - 消息容器元素（.mes 或类似）
 * @param {string} rawText - 原始消息文本，包含 <zd_status> 数据
 */
export function renderBattlePanel(messageEl, rawText) {
    // 提取 <zd_status> 数据
    const zdMatch = rawText.match(/<zd_status>\s*([\s\S]*?)\s*<\/zd_status>/i);
    if (!zdMatch) return;
    const zdText = zdMatch[1];

    // 检查是否已渲染
    const existing = messageEl.querySelector('.sao-render-host[data-sao-tag="battle"]');
    if (existing) return;

    // 创建 Shadow DOM 宿主
    const host = document.createElement('div');
    host.className = 'sao-render-host';
    host.dataset.saoTag = 'battle';
    const shadow = host.attachShadow({ mode: 'open' });

    // 注入 CSS
    const style = document.createElement('style');
    style.textContent = getBattleCSS();
    shadow.appendChild(style);

    // 注入 HTML 模板
    const templateWrapper = document.createElement('div');
    templateWrapper.innerHTML = getBattleTemplate();
    while (templateWrapper.firstChild) {
        shadow.appendChild(templateWrapper.firstChild);
    }

    // 设置 domRoot 为 Shadow DOM
    setBattleDomRoot(shadow);

    // 注入 <zd_status> 数据到隐藏的数据源
    const dataSource = shadow.getElementById('status-data-source');
    if (dataSource) {
        dataSource.textContent = zdText;
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

    // 追加到消息 DOM（位置优先：插入到原 <zd_status> 标签处）
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('zd_status');
    if (refNode && refNode.parentNode) {
        refNode.parentNode.insertBefore(host, refNode);
    } else if (mesText) {
        mesText.appendChild(host);
    } else {
        messageEl.appendChild(host);
    }
}
