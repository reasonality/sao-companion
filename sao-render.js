// SAO Companion - 渲染模块（Shadow DOM 渲染 + 标签提取 + DOMPurify 钩子）
// 从 index.js 拆分而来

import { esc, log, getSaoData, safeJsonParse } from './sao-core.js';
import { DOMPurify } from '../../../../lib.js';
import { renderBattlePanel } from './battle/battleRenderer.js';
import { restoreBattleState } from './battle/battleLogic.js';
import { SAO_CUSTOM_TAGS, createSaoShadowHost } from './sao-dom-utils.js';
import { PANEL_REGISTRY, PANEL_TAGS } from './sao-panel-registry.js';
import { SAO_CALENDAR_CSS } from './sao-calendar-theme.js';

// 模块级预编译：PANEL_TAGS 固定不变，正则与渲染函数映射构造一次，避免热路径重复构造。
const _SAO_TAG_RE = new RegExp(`<(?:${PANEL_TAGS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

/**
 * 注册 DOMPurify 钩子：保留 SAO 自定义标签不被剥离。
 * ST 的 messageFormatting 在 DOMPurify.sanitize 时默认只允许标准 HTML 标签，
 * 未知标签（如 <equip>）会被剥离，只保留文本内容。
 * 此钩子在 DOMPurify 处理每个元素时触发，将 SAO 标签标记为允许，
 * 使其作为 DOM 元素保留，供 Shadow DOM 渲染器 querySelector 定位。
 */
let saoDompurifyHookRegistered = false;
export function registerSaoDompurifyHook() {
    if (saoDompurifyHookRegistered) return;
    if (!DOMPurify || !DOMPurify.addHook) {
        console.warn('[SAO Companion] DOMPurify 不可用，无法注册钩子');
        return;
    }
    DOMPurify.addHook('uponSanitizeElement', (node, data, config) => {
        if (!data || !data.tagName || !data.allowedTags) return;
        if (SAO_CUSTOM_TAGS.includes(data.tagName.toLowerCase())) {
            // 注意: 这会永久修改 DOMPurify 全局 allowlist（对整个 ST 会话生效）。
            // SAO 自定义标签是无害的空元素，安全风险可忽略。
            data.allowedTags[data.tagName.toLowerCase()] = true;
        }
    });
    saoDompurifyHookRegistered = true;
    log('DOMPurify 钩子已注册: 保留 SAO 自定义标签');
}

// ─── 共享 CSS ────────────────────────────────────────────────
// 所有 5 个渲染器共用的 :host 重置
const SHARED_SAO_CSS = `:host { display: block; margin: 0; padding: 0; }`;

// renderEquipment + renderSwordSkill 共用的暗色 Stardew 主题基础样式
const SHARED_STARDEW_CSS = `
            /* Define the custom font */
                    @font-face {
                        font-family: 'NotoSansCJKsc-Bold';
                        src: url('https://files.catbox.moe/tisct7.otf') format('opentype');
                        font-style: normal;
                        font-weight: bold;
                        font-display: swap;
                    }

                    /* Main container style */
                    .stardew-text-wrapper {
                        background-color: rgba(40, 40, 40, 0.85);
                        border: 1px solid #666;
                        border-radius: 6px;
                        max-width: 861px;
                        margin: 5px auto;
                        padding: 0 5px 5px 5px;
                        box-sizing: border-box;
                        overflow: hidden;

                        /* --- Color Variables --- */
                        --stardew-header-text: #FFFFFF;
                        --stardew-content-border: rgba(255, 255, 255, 0.15);
                        --stardew-pressed-bg: rgba(40, 40, 40, 0.85);
                        --stardew-pressed-border: #666;
                        --stardew-pressed-highlight: rgba(80, 80, 80, 0.85);
                        --stardew-pressed-shadow: rgba(20, 20, 20, 0.85);
                        --stardew-pressed-text: #DDDDDD;
                        --stardew-pressed-outer-shadow-color: rgba(50, 50, 50, 0.3);
                    }
`;

/**
 * renderEquipment + renderSwordSkill 共用的 details/summary 交互样式。
 * 两个渲染器的 CSS 结构完全一致，只有 class 名、icon、icon 颜色不同，
 * 这些差异通过 CSS 自定义属性 --stardew-icon / --stardew-icon-open-color /
 * --stardew-icon-closed-color 参数化，由各自的 .stardew-text-wrapper 设定。
 * @param {string} className - details 元素的 class 名（如 'details-character-bar'）
 * @returns {string} CSS 规则文本
 */
function stardewDetailsSharedCSS(className) {
    return `
                    .${className} {
                        border: none;
                        margin: 0;
                        padding: 0;
                        color: #CCCCCC;
                        font-family: 'NotoSansCJKsc-Bold', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
                    .${className} > summary {
                        display: flex;
                        align-items: center;
                        width: 100%;
                        cursor: pointer;
                        font-weight: bold;
                        list-style: none;
                        outline: none;
                        image-rendering: pixelated;
                        -webkit-font-smoothing: none;
                        -moz-osx-font-smoothing: grayscale;
                        transition: all 0.1s ease-in-out;
                        position: relative;
                        top: 0; left: 0;
                        box-sizing: border-box;
                    }
                    .${className} > summary::-webkit-details-marker,
                    .${className} > summary::marker {
                         display: none;
                         content: '';
                    }
                    .${className} > summary::before {
                        content: var(--stardew-icon);
                        display: inline-block;
                        line-height: 1;
                        font-size: 1.1em;
                    }
                    .${className}:not([open]) > summary {
                        padding: 4px 8px 5px 8px;
                        font-size: 16px;
                        line-height: 1.2;
                        margin-bottom: 0;
                        background-color: transparent;
                        border: none !important;
                        border-radius: 0;
                        box-shadow: none !important;
                        filter: none;
                        justify-content: flex-start;
                        color: var(--stardew-header-text);
                        border-bottom: 1px solid var(--stardew-content-border);
                    }
                    .${className}:not([open]) > summary::before {
                         color: var(--stardew-icon-closed-color);
                         margin-right: 6px;
                    }
                    .${className}[open] > summary {
                        padding: 10px 8px;
                        font-size: 18px;
                        line-height: initial;
                        margin-bottom: 5px;
                        border: 2px solid var(--stardew-pressed-border);
                        border-radius: 5px;
                        background-color: var(--stardew-pressed-bg);
                        justify-content: flex-start;
                        color: var(--stardew-pressed-text);
                        border-bottom: none;
                        box-shadow:
                            inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                            inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                        filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                        top: 1px;
                        left: 1px;
                    }
                    .${className}[open] > summary::before {
                        color: var(--stardew-icon-open-color);
                        margin-right: 8px;
                    }
                    .${className} > summary:active {
                         padding: 10px 8px;
                         font-size: 18px;
                         line-height: initial;
                         background-color: var(--stardew-pressed-bg);
                         color: var(--stardew-pressed-text);
                         box-shadow:
                             inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                             inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                         filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                         top: 1px;
                         left: 1px;
                         border: 2px solid var(--stardew-pressed-border);
                         border-radius: 5px;
                         justify-content: flex-start;
                         margin-bottom: 5px;
                         border-bottom: none;
                    }
                    .${className} > summary:active::before {
                        color: var(--stardew-icon-open-color);
                        margin-right: 8px;
                    }
                    .${className} > div {
                        padding: 5px 0 0 0;
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.4;
                        background-color: rgba(40, 40, 40, 0.85);
                        color: #CCCCCC;
                    }`;
}

/**
 * 白名单清洗内联 HTML，仅保留 SAO 卡中常见的安全标签与属性。
 * 允许：br, font[color], span[style|color], b, strong, i, em
 * 移除：script/style/事件属性/data-/javascript: 等。
 */
function sanitizeInlineSaoHtml(html) {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['br', 'font', 'span', 'b', 'strong', 'i', 'em', 'div', 'details', 'summary'],
        ALLOWED_ATTR: ['color', 'style', 'open'],
        ALLOWED_CSS_PROPERTIES: ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration'],
    });
}
/**
 * 根据 year/month/current_day/days 生成日历网格 HTML（SAO 暗色主题）。
 * 使用 .sao-cal-cell 类名，data-date 属性，点击触发自定义事件。
 * Weekday 顺序：周一到周日。
 */
function buildCalendarGrid(year, month, currentDay, days, calDaysMap) {
    const y = Number(year), m = Number(month), cd = Number(currentDay);
    if (!y || !m || y < 1 || m < 1 || m > 12) return '';
    const firstDayOfWeek = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m, 0).getDate();
    const dayContentMap = {};
    if (Array.isArray(days)) {
        for (const d of days) {
            const num = typeof d === 'object' ? (d.day ?? d.date) : Number(d);
            if (num != null && !isNaN(num)) {
                const info = typeof d === 'object' ? d : { events: [String(d)] };
                const events = Array.isArray(info.events) ? info.events : (info.label ? [info.label] : []);
                if (events.length) dayContentMap[Number(num)] = events.slice(0, 10);
            }
        }
    } else if (days && typeof days === 'object') {
        for (const [k, v] of Object.entries(days)) {
            const num = Number(k);
            if (!isNaN(num)) {
                const items = typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [String(v)];
                dayContentMap[num] = items.slice(0, 10);
            }
        }
    }
    const pad = n => String(n).padStart(2, '0');
    const dateStr = (d) => y + '-' + pad(m) + '-' + pad(d);
    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells += '<div class="sao-cal-cell sao-cal-other-month"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const isCurrent = day === cd;
        const cls = 'sao-cal-cell' + (isCurrent ? ' sao-cal-today' : '');
        const events = dayContentMap[day];
        const dateStrFull = dateStr(day);
        const calDayEvents = calDaysMap?.[dateStrFull]?.events || [];
        const appointments = calDayEvents.filter(e => e.type === 'appointment');
        const nonAptEvents = calDayEvents.filter(e => e.type !== 'appointment');

        let dotsHtml = '';
        let eventHtml = '';
        // Green dots = non-appointment events (cap 5); fallback to gridDays events only when calDays has no data for this day
        const greenCount = nonAptEvents.length > 0 ? Math.min(nonAptEvents.length, 5) : (calDayEvents.length === 0 && events && events.length ? Math.min(events.length, 5) : 0);
        // Yellow dot = has appointments
        const yellowCount = appointments.length > 0 ? 1 : 0;
        let dots = '';
        for (let i = 0; i < greenCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-canon"></span>';
        for (let i = 0; i < yellowCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-apt"></span>';
        if (dots) dotsHtml = '<div class="sao-cal-dots">' + dots + '</div>';
        if (events && events.length) {
            const first = events[0];
            const full = typeof first === 'string' ? first : (first.title || first.description || '');
            eventHtml = '<div class="sao-cal-event-text">' + esc(full) + '</div>';
        }
        cells += `<div class="${cls}" data-date="${dateStrFull}"><div class="sao-cal-day-num">${day}${dotsHtml}</div>${eventHtml}</div>`;
    }
    return cells;
}
/**
 * 检查是否有待恢复的战斗状态
 * 在 renderBattlePanel 渲染后调用
 */
function restoreBattleIfPending() {
    try {
        const data = getSaoData();
        if (!data || !data.battle || !data.battle.isActive) return false;
        const restored = restoreBattleState(data.battle);
        if (restored) {
            log('战斗状态已恢复');
        }
        return restored;
    } catch (e) {
        log('恢复战斗状态失败: ' + e.message, 'warn');
        return false;
    }
}
/**
 * 通用标签提取
 */
function extractTag(rawText, tagName) {
    const re = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i');
    const m = rawText.match(re);
    return m ? m[1] : null;
}

function hideSaoLightDomTags(messageEl) {
    const mesText = messageEl.querySelector('.mes_text');
    const target = mesText || messageEl;
    target.classList.add('sao-tags-rendered');
    
    // 直接隐藏 light DOM 中的 SAO 自定义标签元素（比 CSS 更可靠）
    const tagsToHide = SAO_CUSTOM_TAGS;
    for (const tag of tagsToHide) {
        const elements = target.querySelectorAll(tag);
        elements.forEach(el => {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.style.opacity = '0';
            el.style.height = '0';
            el.style.overflow = 'hidden';
        });
    }
    
    // CSS 作为备份
    const styleId = 'sao-hide-custom-tags';
    if (target.querySelector(`#${styleId}`)) return;
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    const tagSelectors = SAO_CUSTOM_TAGS.map(t => `.sao-tags-rendered ${t}`).join(', ');
    const tagChildSelectors = SAO_CUSTOM_TAGS.map(t => `.sao-tags-rendered ${t} *`).join(', ');
    styleEl.textContent = `
        ${tagSelectors}, ${tagChildSelectors} {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
        }
    `;
    target.prepend(styleEl);
}

/** 从 chatMetadata.calendarPanels[messageId] 渲染日历面板，无数据时显示占位 */
export function renderCalendar(messageEl, rawText, messageId, refNode) {
    const data = getSaoData();
    const panel = (messageId != null) ? data?.calendarPanels?.[messageId] : null;

    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    // 无 <calendar> 标签锚点（主 LLM 不再发），日历面板追加到 mes_text 末尾
    const { shadow } = createSaoShadowHost(messageEl, 'calendar', refNode);

    let year = 0, month = 0, currentDay = 0;
    let gridDays = null;
    let placeholderMode = false;

    if (panel && panel.grid) {
        const g = panel.grid;
        year = Number(g.year) || 0;
        month = Number(g.month) || 0;
        currentDay = Number(g.current_day) || 0;
        gridDays = Array.isArray(g.days) ? g.days : null;
    }
    // 同步回退：异步管道（callStatusSpecialist + updateCalendarIncremental）可能尚未完成或失败，
    // 直接从消息原文的 <calendar> 标签解析预填数据，使开局日历无需等待异步即可渲染。
    if (!year || !month || !gridDays) {
        try {
            const calTagMatch = (rawText || '').match(/<calendar>\s*([\s\S]*?)\s*<\/calendar>/i);
            if (calTagMatch) {
                const body = calTagMatch[1];
                const yM = body.match(/^year:\s*(\d+)/m);
                const mM = body.match(/^month:\s*(\d+)/m);
                const cdM = body.match(/^current_day:\s*(\d+)/m);
                if (yM && mM) {
                    year = parseInt(yM[1]);
                    month = parseInt(mM[1]);
                    currentDay = cdM ? parseInt(cdM[1]) : 0;
                    const daysIdx = body.indexOf('days:');
                    if (daysIdx >= 0) {
                        const daysBlock = body.slice(daysIdx + 5);
                        const lineRe = /^(\d{1,2}):[ \t]*(.+)$/gm;
                        const dayMap = {};
                        let lm;
                        while ((lm = lineRe.exec(daysBlock)) !== null) {
                            const dn = parseInt(lm[1]);
                            if (dn < 1 || dn > 31) continue;
                            const title = lm[2].trim();
                            if (!title) continue;
                            if (!dayMap[dn]) dayMap[dn] = [];
                            dayMap[dn].push(title.slice(0, 100));
                        }
                        gridDays = [];
                        for (let dn = 1; dn <= 31; dn++) {
                            if (dayMap[dn]) gridDays.push({ day: dn, events: dayMap[dn].slice(0, 10) });
                        }
                    }
                }
            }
        } catch (e) {
            log('日历同步回退解析失败: ' + e.message, 'warn');
        }
    }
    if (!year || !month || !gridDays) {
        // 无数据或数据不完整：占位模式
        placeholderMode = true;
    }

    const summaryText = (!placeholderMode && year && month && currentDay)
        ? (() => { const wd = new Date(year, month - 1, currentDay).getDay(); const wdNames = ['\u5468\u65e5','\u5468\u4e00','\u5468\u4e8c','\u5468\u4e09','\u5468\u56db','\u5468\u4e94','\u5468\u516d']; return `\ud83d\udcc5 ${month}\u6708${currentDay}\u65e5 ${wdNames[wd]}`; })()
        : (!placeholderMode && year && month) ? `\ud83d\udcc5 ${year}\u5e74${month}\u6708` : '\ud83d\udcc5 \u65e5\u5386';
    const calDaysMap = data?.calendar?.days || {};
    const gridCells = (!placeholderMode && year && month)
        ? buildCalendarGrid(year, month, currentDay, gridDays, calDaysMap)
        : '';
    const weekdaysHtml = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
        .map(d => '<div class="sao-cal-header">' + d + '</div>').join('');

    // Preserve <details> open state across re-renders
    const prevDetails = shadow.querySelector('details.sao-cal-details');
    const wasOpen = prevDetails ? prevDetails.open : false;

    shadow.innerHTML = `
        <style>${SAO_CALENDAR_CSS}</style>
        <details class="sao-cal-details">
            <summary>${summaryText}</summary>
            ${placeholderMode
                ? '<div class="sao-cal-placeholder">\u23f3 \u65e5\u5386\u751f\u6210\u4e2d\u2026</div>'
                : `<div class="sao-cal-grid">${weekdaysHtml}${gridCells}</div>`}
        </details>
    `;

    if (wasOpen) {
        const newDetails = shadow.querySelector('details.sao-cal-details');
        if (newDetails) newDetails.open = true;
    }

    // Guard: avoid stacking duplicate click listeners on re-render (shadow host is reused)
    if (!shadow._calClickBound) {
        shadow._calClickBound = true;
        shadow.addEventListener('click', (e) => {
            const cell = e.target.closest('.sao-cal-cell[data-date]');
            if (!cell) return;
            const dateStr = cell.getAttribute('data-date');
            if (!dateStr) return;
            shadow.dispatchEvent(new CustomEvent('sao-cal-day-click', {
                detail: { dateStr },
                bubbles: true,
                composed: true,
            }));
        });
    }
}

// 渲染器映射（模块级，函数声明提升使其可在此引用后续定义的函数；避免 renderAllTags 每次重建）
const _RENDER_FN_MAP = {
    equip: renderEquipment,
    swordskill: renderSwordSkill,
    user_status: renderUserStatus,
    map: renderMap,
    calendar: renderCalendar,
};

export function renderAllTags(messageEl, rawText, messageId) {
    // 面板渲染顺序由 PANEL_REGISTRY 定义（sao-panel-registry.js），匹配消息中标签的原始顺序。
    // 每个渲染器通过 createSaoShadowHost(refNode) 在标签 DOM 节点处插入 Shadow host（位置插入）。
    // NPC状态栏由卡片正则脚本在 light DOM 渲染（已在正确位置），不在此处管理。
    // 过渡期主 LLM 可能仍发标签 → 需隐藏 light DOM 避免双重渲染
    const hasAnySaoTags = _SAO_TAG_RE.test(rawText || '');
    if (hasAnySaoTags) {
        hideSaoLightDomTags(messageEl)
    }
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    for (const entry of PANEL_REGISTRY) {
        if (entry.isSpecial) continue;       // zd_status(battle): 单独处理（签名不同）
        const fn = _RENDER_FN_MAP[entry.tag];
        if (!fn) continue;                   // digest 等: 无渲染器，仅 DOMPurify 保留 + cleanup
        try {
            fn(messageEl, rawText, messageId, mesText.querySelector(entry.tag));
        } catch (e) {
            log(`${entry.tag} 渲染失败: ${e.message}`, 'error');
        }
    }
    // 战斗面板（isSpecial: 自行定位 zd_status 锚点，签名无 refNode）
    if (typeof messageId !== 'undefined') {
        try { renderBattlePanel(messageEl, rawText, messageId); } catch(e) { log('renderBattlePanel 渲染失败: ' + e.message, 'error'); }
    }
    if (hasAnySaoTags) {
        cleanupSaoLightDom(messageEl)
    }
    if (rawText && rawText.includes('<zd_status>')) {
        restoreBattleIfPending()
    }
}

/**
 * 彻底删除 light DOM 中的 SAO 自定义标签元素及其逃逸的子元素。
 * Showdown (markdown→HTML) 可能破坏未知标签的容器结构，把 <details>/<summary>
 * 等子元素拆到标签外面。仅靠 display:none 无法隐藏这些逃逸的子元素。
 * Shadow DOM 渲染器已经从 rawText 提取了内容并渲染，light DOM 是冗余的。
 */
function cleanupSaoLightDom(messageEl) {
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    // 1. 删除所有自定义标签元素（及其子元素）
    const tagsToRemove = SAO_CUSTOM_TAGS;
    for (const tag of tagsToRemove) {
        mesText.querySelectorAll(tag).forEach(el => el.remove());
    }
    // 2. 删除逃逸的 <details> 块 — 只删除 mesText 的直接子节点（:scope > details）
    //    Shadow host 内部的 <details> 不会被 :scope > 匹配到
    const saoSummaryPatterns = [
        /装备栏/, /等级和属性/, /技能/, /关系列表/, /任务日志/, /背包/,
        /公会状态栏/, /NPC状态栏/, /基本信息/
    ];
    mesText.querySelectorAll(':scope > details').forEach(details => {
        const summary = details.querySelector('summary');
        if (summary && saoSummaryPatterns.some(p => p.test(summary.textContent))) {
            details.remove();
        }
    });
    // 3. 删除 Showdown 生成的空 <p>/<br>/<hr>（自定义标签删除后留下的空壳）
    //    只删除 mesText 的直接子节点中空白的元素
    mesText.querySelectorAll(':scope > p, :scope > br, :scope > hr').forEach(el => {
        // 保护包含 Shadow host 的容器
        if (el.querySelector('.sao-render-host')) return;
        const text = el.textContent.trim();
        const isOnlyBr = el.childNodes.length === 1 && el.firstChild.nodeName === 'BR';
        if (!text || isOnlyBr) {
            el.remove();
        }
    });
}

function renderUserStatus(messageEl, rawText, messageId, refNode) {
    // P3: 优先从 status 专家面板数据读取 userStatusHtml；回退到 mes 标签（过渡兼容）
    let content = null;
    if (messageId != null) {
        const panel = getSaoData()?.panels?.[messageId]?.status;
        // panel.html 存的是 {state, zdText, userStatusHtml} 对象（或字符串）
        const panelData = panel && (typeof panel.html === 'string') ? safeJsonParse(panel.html) : panel?.html;
        if (panelData && typeof panelData.userStatusHtml === 'string' && panelData.userStatusHtml.length > 0) {
            content = panelData.userStatusHtml;
        }
    }
    if (!content) {
        content = extractTag(rawText, 'user_status')
        if (content === null) return
    }
    const { shadow } = createSaoShadowHost(messageEl, 'user_status', refNode)
    const safeContent = sanitizeInlineSaoHtml(content.trim())
        .replace(/^[ \t]+/gm, '')      // 去除每行前导缩进（LLM 常插入多余缩进）
        .replace(/[ \t]+$/gm, '')      // 去除每行尾随空格
        .replace(/\n{3,}/g, '\n\n')    // 3+ 连续空行折叠为单个空行
        .replace(/<\/summary>\s*\n+/g, '</summary>')   // 消除 summary 后的换行（标题与内容间间隙）
        .replace(/<\/details>\s*\n+\s*<details/g, '</details><details') // 消除兄弟 details 间的换行
        .replace(/\s+<\/details>/g, '</details>')  // 消除 </details> 前的尾随空白（底部间隙）;
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            /* 主容器样式 */
                .character-status-wrapper {
                  background-color: rgba(235, 225, 210, 0.95); /* 浅米色背景 */
                  border: 1px solid rgba(165, 145, 120, 0.5);
                  border-radius: 6px;
                  max-width: 861px;
                  margin: 5px auto;
                  padding: 0 5px 5px 5px;
                  box-sizing: border-box;
                  overflow: hidden;
            
                  /* 颜色变量 */
                  --char-text-color: #4b3f34; /* 深灰褐色文本 */
                  --char-content-border: rgba(165, 145, 120, 0.3);
                  --char-button-bg: rgba(218, 198, 171, 0.95);
                  --char-button-border: rgba(165, 145, 120, 0.8);
                  --char-button-highlight: rgba(228, 208, 181, 0.95);
                  --char-button-shadow: rgba(175, 155, 130, 0.85);
                  --char-button-outer-shadow: rgba(150, 130, 105, 0.3);
                  --char-icon-color: #5b99c9; /* 蓝色图标 */
                  --char-content-bg: rgba(225, 215, 200, 0.95); /* 内容区背景 */
                  --char-button-hover: rgba(225, 205, 178, 0.95); /* 悬停颜色 */
                  --char-button-active: rgba(210, 190, 163, 0.95); /* 点击时颜色 */
                }
            
                /* 定义标准字体栈 */
                .character-status-wrapper {
                  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif;
                  color: var(--char-text-color); /* 应用默认文本颜色 */
                }
            
                /* 全局禁用文本阴影 */
                .character-status-wrapper,
                .character-status-wrapper *,
                .details-character-status,
                .details-character-status *,
                .details-character-status > summary,
                .details-character-status > summary::before,
                .details-character-status > div {
                  text-shadow: none !important;
                }
            
                /* 详情按钮样式 (使用新类名) */
                .details-character-status {
                  border: none;
                  margin: 0;
                  padding: 0;
                  color: inherit; /* 继承 wrapper 的颜色 */
                }
            
                /* 基础摘要样式 (使用新类名) */
                .details-character-status > summary {
                  display: flex;
                  align-items: center;
                  width: 100%;
                  cursor: pointer;
                  list-style: none;
                  outline: none;
                  image-rendering: auto;
                  -webkit-font-smoothing: antialiased;
                  -moz-osx-font-smoothing: grayscale;
                  transition: all 0.1s ease-in-out;
                  position: relative;
                  top: 0;
                  left: 0;
                  box-sizing: border-box;
                  font-weight: 600; /* 使用半粗体 (Semi-bold) 作为标题 */
                  color: var(--char-text-color);
                }
            
                /* 移除默认标记 (使用新类名) */
                .details-character-status > summary::-webkit-details-marker,
                .details-character-status > summary::marker {
                  display: none;
                  content: '';
                }
            
                /* 基础图标样式 (使用新类名) */
                .details-character-status > summary::before {
                  content: '👤'; /* <<< 角色状态图标 */
                  display: inline-block;
                  line-height: 1;
                  font-size: 1.1em;
                  color: var(--char-icon-color);
                  margin-right: 6px;
                }
            
                /* 关闭时状态 (使用新类名) */
                .details-character-status:not([open]) > summary {
                  padding: 4px 8px 5px 8px;
                  font-size: 16px;
                  line-height: 1.2;
                  margin-bottom: 0;
                  background-color: var(--char-button-bg);
                  border: 1px solid var(--char-button-border) !important;
                  border-radius: 5px;
                  box-shadow: 1px 1px 2px var(--char-button-outer-shadow) !important;
                  filter: none;
                  justify-content: flex-start;
                }
            
                /* 鼠标悬停效果 (使用新类名) */
                .details-character-status:not([open]) > summary:hover {
                  background-color: var(--char-button-hover);
                }
            
                /* 打开时状态 (使用新类名) */
                .details-character-status[open] > summary {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  margin-bottom: 5px;
                  border: 1px solid var(--char-button-border);
                  border-radius: 5px;
                  background-color: var(--char-button-active);
                  justify-content: flex-start;
                  box-shadow: inset 1px 1px 0px 1px var(--char-button-highlight), inset -1px -1px 0px 1px var(--char-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--char-button-outer-shadow));
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 打开时图标样式 (使用新类名) */
                .details-character-status[open] > summary::before {
                  margin-right: 8px;
                }
            
                /* 点击时反馈 (使用新类名) */
                .details-character-status > summary:active {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  background-color: var(--char-button-active);
                  box-shadow: inset 1px 1px 0px 1px var(--char-button-highlight), inset -1px -1px 0px 1px var(--char-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--char-button-outer-shadow));
                  top: 1px;
                  left: 1px;
                  border: 1px solid var(--char-button-border);
                  border-radius: 5px;
                  justify-content: flex-start;
                  margin-bottom: 5px;
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 点击时图标样式 (使用新类名) */
                .details-character-status > summary:active::before {
                  margin-right: 8px;
                }
            
                /* 打开时显示的内容 (使用新类名) */
                .details-character-status > div {
                  padding: 10px;
                  margin: 0;
                  font-size: 15px;
                  line-height: 1.5;
                  background-color: var(--char-content-bg);
                  color: var(--char-text-color);
                  border: 1px solid var(--char-content-border);
                  border-radius: 4px;
                  font-weight: normal; /* 内容使用普通字重 */
                  white-space: pre-wrap;
                  word-break: break-word;
                }
                /* 嵌套 details 间距控制 */
                .details-character-status > div > details {
                    margin: 2px 0 !important;
                }
                .details-character-status > div > details > summary {
                    padding: 4px 8px !important;
                    margin: 0 !important;
                    font-size: 14px !important;
                    font-weight: 600 !important;
                    cursor: pointer !important;
                }
                .details-character-status > div > details[open] > summary {
                    margin-bottom: 2px !important;
                }
        </style>
        <div class="character-status-wrapper">
            <details class="details-character-status" open>
                <summary>角色状态栏</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}

function renderEquipment(messageEl, rawText, messageId, refNode) {
    // P2: 优先从专家面板数据读取（非空）；回退到 mes 标签（过渡兼容）；均无则跳过
    const panel = (messageId != null) ? getSaoData()?.panels?.[messageId]?.equipment : null;
    let itemsHtml = '';
    if (panel && typeof panel.html === 'string' && panel.html.length > 0) {
        itemsHtml = sanitizeInlineSaoHtml(panel.html);
    } else {
        const matches = [...rawText.matchAll(/<equip>\s*([\s\S]*?)\s*<\/equip>/gi)]
        if (matches.length === 0) return
        itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    }
    const { shadow } = createSaoShadowHost(messageEl, 'equip', refNode)
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_STARDEW_CSS}
            ${stardewDetailsSharedCSS('details-character-bar')}
                    .stardew-text-wrapper {
                        --stardew-icon: '🎒';
                        --stardew-icon-closed-color: var(--stardew-header-text);
                        --stardew-icon-open-color: var(--stardew-pressed-text);
                    }
        </style>
        <div class="stardew-text-wrapper">
            <details class="details-character-bar" open>
                <summary>新装备</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

function renderSwordSkill(messageEl, rawText, messageId, refNode) {
    // P2: 优先从专家面板数据读取（非空）；回退到 mes 标签（过渡兼容）；均无则跳过
    const panel = (messageId != null) ? getSaoData()?.panels?.[messageId]?.swordskill : null;
    let itemsHtml = '';
    if (panel && typeof panel.html === 'string' && panel.html.length > 0) {
        itemsHtml = sanitizeInlineSaoHtml(panel.html);
    } else {
        const matches = [...rawText.matchAll(/<swordskill>\s*([\s\S]*?)\s*<\/swordskill>/gi)]
        if (matches.length === 0) return
        itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    }
    const { shadow } = createSaoShadowHost(messageEl, 'swordskill', refNode)
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_STARDEW_CSS}
            ${stardewDetailsSharedCSS('details-affinity-button')}
                    .stardew-text-wrapper {
                        --stardew-icon: '✨';
                        --stardew-icon-closed-color: var(--stardew-heart-icon-color);
                        --stardew-icon-open-color: var(--stardew-heart-icon-color);
                        --stardew-heart-icon-color: #ff6b6b;
                    }
        </style>
        <div class="stardew-text-wrapper">
            <details class="details-affinity-button" open>
                <summary>新剑技</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

function renderMap(messageEl, rawText, messageId, refNode) {
    // P2: 优先从专家面板数据读取（非空）；回退到 mes 标签（过渡兼容）；均无则跳过
    const panel = (messageId != null) ? getSaoData()?.panels?.[messageId]?.map : null;
    let content;
    if (panel && typeof panel.html === 'string' && panel.html.length > 0) {
        content = panel.html;
    } else {
        content = extractTag(rawText, 'map')
        if (content === null) return
    }
    const { shadow } = createSaoShadowHost(messageEl, 'map', refNode)
    const safeContent = sanitizeInlineSaoHtml(content.trim())
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            /* 主容器样式 */
                .map-status-wrapper {
                  background-color: rgba(235, 225, 210, 0.95); /* 浅米色背景 */
                  border: 1px solid rgba(165, 145, 120, 0.5);
                  border-radius: 6px;
                  max-width: 861px;
                  margin: 5px auto;
                  padding: 0 5px 5px 5px;
                  box-sizing: border-box;
                  overflow: hidden;
            
                  /* 颜色变量 */
                  --map-text-color: #4b3f34; /* 深灰褐色文本 */
                  --map-content-border: rgba(165, 145, 120, 0.3);
                  --map-button-bg: rgba(218, 198, 171, 0.95);
                  --map-button-border: rgba(165, 145, 120, 0.8);
                  --map-button-highlight: rgba(228, 208, 181, 0.95);
                  --map-button-shadow: rgba(175, 155, 130, 0.85);
                  --map-button-outer-shadow: rgba(150, 130, 105, 0.3);
                  --map-icon-color: #5b99c9; /* 蓝色图标 */
                  --map-content-bg: rgba(225, 215, 200, 0.95); /* 内容区背景 */
                  --map-button-hover: rgba(225, 205, 178, 0.95); /* 悬停颜色 */
                  --map-button-active: rgba(210, 190, 163, 0.95); /* 点击时颜色 */
                }
            
                /* 定义标准字体栈 */
                .map-status-wrapper {
                  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif;
                  color: var(--map-text-color); /* 应用默认文本颜色 */
                }
            
                /* 全局禁用文本阴影 */
                .map-status-wrapper,
                .map-status-wrapper *,
                .details-map-status,
                .details-map-status *,
                .details-map-status > summary,
                .details-map-status > summary::before,
                .details-map-status > div {
                  text-shadow: none !important;
                }
            
                /* 详情按钮样式 (使用新类名) */
                .details-map-status {
                  border: none;
                  margin: 0;
                  padding: 0;
                  color: inherit; /* 继承 wrapper 的颜色 */
                }
            
                /* 基础摘要样式 (使用新类名) */
                .details-map-status > summary {
                  display: flex;
                  align-items: center;
                  width: 100%;
                  cursor: pointer;
                  list-style: none;
                  outline: none;
                  image-rendering: auto;
                  -webkit-font-smoothing: antialiased;
                  -moz-osx-font-smoothing: grayscale;
                  transition: all 0.1s ease-in-out;
                  position: relative;
                  top: 0;
                  left: 0;
                  box-sizing: border-box;
                  font-weight: 600; /* 使用半粗体 (Semi-bold) 作为标题 */
                  color: var(--map-text-color);
                }
            
                /* 移除默认标记 (使用新类名) */
                .details-map-status > summary::-webkit-details-marker,
                .details-map-status > summary::marker {
                  display: none;
                  content: '';
                }
            
                /* 基础图标样式 (使用新类名) */
                .details-map-status > summary::before {
                  content: '🗺️'; /* <<< 地图状态图标 */
                  display: inline-block;
                  line-height: 1;
                  font-size: 1.1em;
                  color: var(--map-icon-color);
                  margin-right: 6px;
                }
            
                /* 关闭时状态 (使用新类名) */
                .details-map-status:not([open]) > summary {
                  padding: 4px 8px 5px 8px;
                  font-size: 16px;
                  line-height: 1.2;
                  margin-bottom: 0;
                  background-color: var(--map-button-bg);
                  border: 1px solid var(--map-button-border) !important;
                  border-radius: 5px;
                  box-shadow: 1px 1px 2px var(--map-button-outer-shadow) !important;
                  filter: none;
                  justify-content: flex-start;
                }
            
                /* 鼠标悬停效果 (使用新类名) */
                .details-map-status:not([open]) > summary:hover {
                  background-color: var(--map-button-hover);
                }
            
                /* 打开时状态 (使用新类名) */
                .details-map-status[open] > summary {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  margin-bottom: 5px;
                  border: 1px solid var(--map-button-border);
                  border-radius: 5px;
                  background-color: var(--map-button-active);
                  justify-content: flex-start;
                  box-shadow: inset 1px 1px 0px 1px var(--map-button-highlight), inset -1px -1px 0px 1px var(--map-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--map-button-outer-shadow));
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 打开时图标样式 (使用新类名) */
                .details-map-status[open] > summary::before {
                  margin-right: 8px;
                }
            
                /* 点击时反馈 (使用新类名) */
                .details-map-status > summary:active {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  background-color: var(--map-button-active);
                  box-shadow: inset 1px 1px 0px 1px var(--map-button-highlight), inset -1px -1px 0px 1px var(--map-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--map-button-outer-shadow));
                  top: 1px;
                  left: 1px;
                  border: 1px solid var(--map-button-border);
                  border-radius: 5px;
                  justify-content: flex-start;
                  margin-bottom: 5px;
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 点击时图标样式 (使用新类名) */
                .details-map-status > summary:active::before {
                  margin-right: 8px;
                }
            
                /* 打开时显示的内容 (使用新类名) */
                .details-map-status > div {
                  padding: 10px;
                  margin: 0;
                  font-size: 15px;
                  line-height: 1.5;
                  background-color: var(--map-content-bg);
                  color: var(--map-text-color);
                  border: 1px solid var(--map-content-border);
                  border-radius: 4px;
                  font-weight: normal; /* 内容使用普通字重 */
                  white-space: pre-wrap;
                  word-break: break-word;
                }
        </style>
        <div class="map-status-wrapper">
            <details class="details-map-status" open>
                <summary>地图</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}
