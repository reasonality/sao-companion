// SAO Companion - DOM 工具模块（Shadow DOM host 创建 + 标签常量）
// 从 sao-render.js 拆出，供 sao-render.js 和 battle/battleRenderer.js 共用，消除定位逻辑重复。

import { PANEL_TAGS } from './sao-panel-registry.js';

// SAO 自定义标签列表 — DOMPurify 钩子保留这些标签；hideSaoLightDomTags/cleanupSaoLightDom 也引用。
// 单一事实来源：PANEL_REGISTRY（sao-panel-registry.js）→ PANEL_TAGS → 此处别名。
// 所有使用点均为 .includes() 或遍历全体，顺序无关。
export const SAO_CUSTOM_TAGS = PANEL_TAGS;

/**
 * 创建（或复用）Shadow DOM 宿主，并插入到消息 DOM。
 * 位置优先：若提供 refNode，则 insertBefore(refNode) 使面板按标签在消息中的顺序渲染；
 *           无 refNode 时追加到 mes_text 末尾。
 * Showdown 会把自定义标签包在 <p> 里，此处将 host 提升到 <p> 之后避免被 cleanup 误删。
 * @param {HTMLElement} messageEl - .mes 容器
 * @param {string} tagName - SAO 标签名（用于 data-sao-tag 属性 + 去重）
 * @param {HTMLElement|null} [refNode] - light DOM 锚点节点（插入到此节点之前）；null/undefined 追加末尾
 * @returns {{ shadow: ShadowRoot, host: HTMLElement }} Shadow root 与 host 元素
 */
export function createSaoShadowHost(messageEl, tagName, refNode) {
    // 复用已有 host（按 data-sao-tag 去重）
    const existing = messageEl.querySelector(`.sao-render-host[data-sao-tag="${tagName}"]`);
    if (existing) return { shadow: existing.shadowRoot, host: existing };
    const host = document.createElement('div');
    host.className = 'sao-render-host';
    host.dataset.saoTag = tagName;
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const shadow = host.attachShadow({ mode: 'open' });

    const target = mesText || messageEl;
    if (refNode && refNode.parentNode) {
        refNode.parentNode.insertBefore(host, refNode);
        // Showdown 把自定义标签包在 <p> 里：提升 host 到 <p> 之后
        if (host.parentNode && host.parentNode.nodeName === 'P') {
            const p = host.parentNode;
            if (p.parentNode) p.parentNode.insertBefore(host, p.nextSibling);
        }
    } else {
        target.appendChild(host);
    }
    return { shadow, host };
}
