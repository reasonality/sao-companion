// SAO Companion - 渲染模块（Shadow DOM 渲染 + 标签提取 + DOMPurify 钩子）
// 从 index.js 拆分而来

import { esc, log, getSaoData, safeJsonParse } from './sao-core.js';
import { DOMPurify } from '../../../../lib.js';
import { renderBattlePanel } from './battle/battleRenderer.js';
import { projectStatusPanelHtml } from './sao-state-projection.js';
import { restoreBattleState } from './battle/battleLogic.js';
import { SAO_CUSTOM_TAGS, createSaoShadowHost } from './sao-dom-utils.js';
import { PANEL_REGISTRY, PANEL_TAGS } from './sao-panel-registry.js';
import { SAO_CALENDAR_CSS } from './sao-calendar-theme.js';
import { buildCleanCalendarDays } from './sao-calendar.js';
import { equipItem, unequipItem } from './sao-store-player.js';
import { getEquipmentById } from './sao-store-equipment.js';
import { createQuest, completeQuest } from './sao-store-quest.js';
import { useConsumable } from './sao-store-consumable.js';
import { appendActionLog } from './sao-store-core.js';

// 模块级预编译：PANEL_TAGS 固定不变，正则与渲染函数映射构造一次，避免热路径重复构造。
const _SAO_TAG_RE = new RegExp(`<(?:${PANEL_TAGS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

// 每条消息的日历视图月份（messageId → Date），支持聊天日历月份翻页
const _chatCalViewDates = new Map();

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
function buildCalendarGrid(year, month, currentDay, days, calDaysMap, isHomeMonth) {
    const y = Number(year), m = Number(month), cd = Number(currentDay);
    if (!y || !m || y < 1 || m < 1 || m > 12) return '';
    const firstDayOfWeek = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m, 0).getDate();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = (d) => y + '-' + pad(m) + '-' + pad(d);
    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells += '<div class="sao-cal-cell sao-cal-other-month"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const isCurrent = day === cd;
        const cls = 'sao-cal-cell' + (isCurrent ? ' sao-cal-today' : '');
        const dateStrFull = dateStr(day);
        // 硬过滤：只显示 date 字段与当前 grid 日期完全匹配的事件
        // 旧数据没有 date 字段（undefined）→ 过滤掉（不信任旧数据）
        // 新数据有 date 字段 → 必须与 dateStrFull 匹配
        const rawCalEvents = calDaysMap?.[dateStrFull]?.events || [];
        const calDayEvents = rawCalEvents.filter(ev => {
            // 只信任有 date 字段且匹配的事件
            return ev.date === dateStrFull;
        });
        // 合并持久化 cal.days 中的非 canon 事件(appointment 等)，与控制台 buildCalCell 一致。
        // buildCleanCalendarDays 只产出 canon 事件，appointment 存在 cal.days，不合并则黄点永不显示。
        const dirtyEvents = getSaoData()?.calendar?.days?.[dateStrFull]?.events || [];
        const aptEvents = dirtyEvents.filter(ev => ev.type !== 'canon' && ev.date === dateStrFull);
        const allEvents = [...calDayEvents, ...aptEvents];
        const appointments = allEvents.filter(e => e.type === 'appointment');
        const nonAptEvents = allEvents.filter(e => e.type !== 'appointment');

        let dotsHtml = '';
        let eventHtml = '';
        // 绿点/黄点只用 calDayEvents（精确日期），不用 dayContentMap（可能跨月泄漏）
        const greenCount = nonAptEvents.length > 0 ? Math.min(nonAptEvents.length, 5) : 0;
        const yellowCount = appointments.length > 0 ? 1 : 0;
        let dots = '';
        for (let i = 0; i < greenCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-canon"></span>';
        for (let i = 0; i < yellowCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-apt"></span>';
        if (dots) dotsHtml = '<div class="sao-cal-dots">' + dots + '</div>';
        // 显示合并后的事件文字（canon + appointment），精确日期 key
        const displayEvents = allEvents;
        if (displayEvents.length > 0) {
            const first = displayEvents[0];
            const full = typeof first === 'string' ? first : (first.title || first.description || '');
            eventHtml = '<div class="sao-cal-event-text">' + esc(full) + '</div>';
        }
        cells += `<div class="${cls}" data-date="${dateStrFull}" role="button" aria-label="${dateStrFull}"><div class="sao-cal-day-num">${day}${dotsHtml}</div>${eventHtml}</div>`;
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


/** Partial calendar update — replaces only the grid cells and summary text.
 *  Keeps <style> and <details> shell intact (no CSS re-injection, preserves open state). */
function _partialUpdateCalendar(shadow, summaryText, weekdaysHtml, gridCells) {
    const summarySpan = shadow.querySelector('.sao-cal-details > summary > span');
    if (summarySpan) summarySpan.textContent = summaryText;
    const grid = shadow.querySelector('.sao-cal-grid');
    if (grid) grid.innerHTML = weekdaysHtml + gridCells;
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

    // 确定当前视图月份（支持翻页）
    // Bug A fix: when panel data IS available (year && month valid), reset cached viewDate
    // if it was poisoned by an earlier placeholder render (year=0 → new Date() stored).
    // The second render (panel data arrives) must override the poisoned cache.
    let viewDate = _chatCalViewDates.get(messageId);
    if (year && month) {
        // Panel data present: reset viewDate if cache is empty or was poisoned by placeholder render
        if (!viewDate || viewDate.getFullYear() !== year || viewDate.getMonth() !== month - 1) {
            viewDate = new Date(year, month - 1, 1);
            _chatCalViewDates.set(messageId, viewDate);
        }
    } else {
        // Placeholder mode (no panel data): use current date as fallback
        if (!viewDate) {
            viewDate = new Date();
            _chatCalViewDates.set(messageId, viewDate);
        }
    }
    // GC: 限制 _chatCalViewDates 大小，防止长会话内存泄漏
    if (_chatCalViewDates.size > 50) {
        const oldest = _chatCalViewDates.keys().next().value;
        _chatCalViewDates.delete(oldest);
    }
    const viewYear = viewDate.getFullYear();
    const viewMonth = viewDate.getMonth() + 1;
    const isHomeMonth = (viewYear === year && viewMonth === month);

    const summaryText = (!placeholderMode && isHomeMonth && currentDay)
        ? (() => { const wd = new Date(year, month - 1, currentDay).getDay(); const wdNames = ['\u5468\u65e5','\u5468\u4e00','\u5468\u4e8c','\u5468\u4e09','\u5468\u56db','\u5468\u4e94','\u5468\u516d']; return `\ud83d\udcc5 ${month}\u6708${currentDay}\u65e5 ${wdNames[wd]}`; })()
        : (!placeholderMode && viewYear && viewMonth) ? `\ud83d\udcc5 ${viewYear}\u5e74${viewMonth}\u6708` : '\ud83d\udcc5 \u65e5\u5386';
    // 渲染专用数据源：直接从世界书重新解析，绕过可能被污染的 cal.days
    // 解析器代码已验证正确（17个事件 for Nov 6，"桐人完成艰苦"在 Dec 6）
    // 不依赖版本升级、saveSaoDataNow 时序、或旧数据清理
    const calDaysMap = buildCleanCalendarDays(
        (year && month && currentDay) ? year + '-' + String(month).padStart(2,'0') + '-' + String(currentDay).padStart(2,'0') : null
    );
    const gridCells = (!placeholderMode && year && month)
        ? buildCalendarGrid(viewYear, viewMonth, isHomeMonth ? currentDay : 0, gridDays, calDaysMap, isHomeMonth)
        : '';
    const weekdaysHtml = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
        .map(d => '<div class="sao-cal-header">' + d + '</div>').join('');

    // Preserve <details> open state across re-renders
    const prevDetails = shadow.querySelector('details.sao-cal-details');
    const wasOpen = prevDetails ? prevDetails.open : false;

    shadow.innerHTML = `
        <style>${SAO_CALENDAR_CSS}</style>
        <details class="sao-cal-details">
            <summary>
                <span>${summaryText}</span>
                ${!placeholderMode ? `<span class="sao-cal-nav">
                    <button class="sao-cal-nav-btn" data-action="calPrev">\u2039</button>
                    <button class="sao-cal-nav-btn" data-action="calNext">\u203a</button>
                </span>` : ''}
            </summary>
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
            // Handle nav buttons — prevent <details> toggle
            const navBtn = e.target.closest('.sao-cal-nav-btn');
            if (navBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = navBtn.getAttribute('data-action');
                // Bug C fix: read FRESH state at click time (not stale closure-captured render locals)
                const freshPanel = getSaoData()?.calendarPanels?.[messageId];
                let freshYear = 0, freshMonth = 0, freshCurrentDay = 0;
                let freshGridDays = null;
                if (freshPanel && freshPanel.grid) {
                    const g = freshPanel.grid;
                    freshYear = Number(g.year) || 0;
                    freshMonth = Number(g.month) || 0;
                    freshCurrentDay = Number(g.current_day) || 0;
                    freshGridDays = Array.isArray(g.days) ? g.days : null;
                }
                // Reset cache if panel data now available but cache was poisoned
                let vd = _chatCalViewDates.get(messageId);
                if (freshYear && freshMonth) {
                    if (!vd || vd.getFullYear() !== freshYear || vd.getMonth() !== freshMonth - 1) {
                        vd = new Date(freshYear, freshMonth - 1, 1);
                        _chatCalViewDates.set(messageId, vd);
                    }
                } else if (!vd) {
                    vd = new Date();
                }
                if (action === 'calPrev') vd.setMonth(vd.getMonth() - 1);
                else vd.setMonth(vd.getMonth() + 1);
                const newVd = new Date(vd);
                _chatCalViewDates.set(messageId, newVd);
                // Partial update: only refresh grid + summary, keep <style>/<details> shell intact
                const newVY = newVd.getFullYear(), newVM = newVd.getMonth() + 1;
                const newIsHome = (newVY === freshYear && newVM === freshMonth);
                const newSummary = (freshYear && freshMonth && newIsHome && freshCurrentDay)
                    ? (() => { const wd = new Date(freshYear, freshMonth - 1, freshCurrentDay).getDay(); const wdNames = ['\u5468\u65e5','\u5468\u4e00','\u5468\u4e8c','\u5468\u4e09','\u5468\u56db','\u5468\u4e94','\u5468\u516d']; return `\ud83d\udcc5 ${freshMonth}\u6708${freshCurrentDay}\u65e5 ${wdNames[wd]}`; })()
                    : `\ud83d\udcc5 ${newVY}\u5e74${newVM}\u6708`;
                const homeDateStr = (freshYear && freshMonth && freshCurrentDay)
                    ? freshYear + '-' + String(freshMonth).padStart(2,'0') + '-' + String(freshCurrentDay).padStart(2,'0')
                    : null;
                const newCalDaysMap = buildCleanCalendarDays(homeDateStr);
                const newGridCells = (freshYear && freshMonth)
                    ? buildCalendarGrid(newVY, newVM, newIsHome ? freshCurrentDay : 0, freshGridDays, newCalDaysMap, newIsHome)
                    : '';
                const newWeekdaysHtml = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
                    .map(d => '<div class="sao-cal-header">' + d + '</div>').join('');
                _partialUpdateCalendar(shadow, newSummary, newWeekdaysHtml, newGridCells);
                return;
            }
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

/**
 * 渲染用户状态面板。
 * 三级回退策略（intentional 设计，非临时代码）：
 * 1. store projection（Phase C 主路径，projectStatusPanelHtml）
 * 2. panels 缓存（A0 过渡兼容 + store 不可用时 fallback）
 * 3. rawText <user_status> 标签（最终防线）
 * 详见 PHASE_C_STATUS_PANEL_REDESIGN_EXECUTION.md C2。
 */
function renderUserStatus(messageEl, rawText, messageId, refNode) {
    // Phase C: 优先从 store projection 渲染；回退到 status 专家面板缓存；最后回退到 mes 标签
    let content = null;

    // 1. 尝试 store projection（Phase C 主路径）
    try {
        content = projectStatusPanelHtml();
    } catch (e) {
        log(`projectStatusPanelHtml 失败: ${e.message}`, 'warn');
    }

    // 2. 回退：status 专家面板缓存（A0/P3 过渡兼容）
    if (!content && messageId != null) {
        const panel = getSaoData()?.panels?.[messageId]?.status;
        const panelData = panel && (typeof panel.html === 'string') ? safeJsonParse(panel.html) : panel?.html;
        if (panelData && typeof panelData.userStatusHtml === 'string' && panelData.userStatusHtml.length > 0) {
            content = panelData.userStatusHtml;
        }
    }

    // 3. 回退：rawText 标签提取
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
            @import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Exo+2:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap");
            ${SHARED_SAO_CSS}
            /* SAO 科技风：对话内角色状态面板 */
            .character-status-wrapper {
                /* 复用侧栏面板配色 */
                --primary: #00d2ff;
                --primary-dim: #0094b4;
                --primary-bright: #66e8ff;
                --success: #00d68a;
                --warning: #ffb800;
                --danger: #ff2e4a;
                --text-primary: #eaf2ff;
                --text-secondary: #9fb0cc;
                --text-tertiary: #5c6b85;
                --bg-base: #080c14;
                --bg-elevated: #0f1522;
                --bg-panel: #161e2e;
                --bg-glass: rgba(22,30,46,0.82);
                --border-subtle: rgba(255,255,255,0.08);
                --border-accent: rgba(0,210,255,0.35);

                background-color: rgba(12,18,28,0.94);
                border: 1px solid var(--border-accent);
                border-radius: 8px;
                max-width: 861px;
                margin: 5px auto;
                padding: 0 5px 5px 5px;
                box-sizing: border-box;
                overflow: hidden;
                position: relative;
                box-shadow: 0 0 18px rgba(0,210,255,0.12), 0 8px 24px rgba(0,0,0,0.45);
                font-family: "Exo 2", "Noto Sans SC", "Rajdhani", "Microsoft YaHei", sans-serif;
                color: var(--text-primary);
            }

            /* 顶部发光条 */
            .character-status-wrapper::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent 0%, var(--primary) 20%, var(--primary-bright) 50%, var(--primary) 80%, transparent 100%);
                opacity: 0.85;
                pointer-events: none;
            }

            /* 全局禁用文本阴影 */
            .character-status-wrapper,
            .character-status-wrapper *,
            .details-character-status,
            .details-character-status *,
            .details-character-status > summary,
            .details-character-status > summary::before,
            .details-character-status > summary::after,
            .details-character-status > div {
                text-shadow: none !important;
            }

            /* 详情折叠容器 */
            .details-character-status {
                border: none;
                margin: 0;
                padding: 0;
                color: inherit;
            }

            /* 摘要基础 */
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
                transition: all 0.2s ease;
                position: relative;
                top: 0;
                left: 0;
                box-sizing: border-box;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-weight: 700;
                letter-spacing: 0.6px;
                text-transform: uppercase;
            }

            /* 移除默认标记 */
            .details-character-status > summary::-webkit-details-marker,
            .details-character-status > summary::marker {
                display: none;
                content: '';
            }

            /* 闭合态：深色按钮条 + 左侧青色竖线 + ▸ 箭头 */
            .details-character-status:not([open]) > summary {
                padding: 6px 10px;
                font-size: 15px;
                line-height: 1.3;
                margin: 5px 0 0 0;
                background: rgba(15,21,34,0.85);
                border: 1px solid rgba(0,210,255,0.22);
                border-left: 3px solid var(--primary);
                border-radius: 5px;
                color: var(--text-secondary);
                justify-content: flex-start;
                box-shadow: -2px 0 6px rgba(0,210,255,0.18), 0 1px 4px rgba(0,0,0,0.25);
            }
            .details-character-status:not([open]) > summary::before {
                content: '▸';
                display: inline-block;
                color: var(--primary);
                margin-right: 8px;
                font-size: 12px;
                transition: transform 0.2s ease;
            }
            .details-character-status:not([open]) > summary:hover {
                color: var(--primary-bright);
                background: rgba(22,30,46,0.92);
                border-color: rgba(0,210,255,0.45);
                box-shadow: -2px 0 10px rgba(0,210,255,0.28), 0 0 10px rgba(0,210,255,0.12);
            }

            /* 展开态：标题青色 + 竖线发光 + 下方渐变分隔线 */
            .details-character-status[open] > summary {
                padding: 10px 8px;
                font-size: 17px;
                line-height: 1.3;
                margin: 5px 0 8px 0;
                background: transparent;
                border: none;
                border-left: 3px solid var(--primary);
                border-radius: 0;
                color: var(--primary);
                justify-content: flex-start;
                box-shadow: -2px 0 10px rgba(0,210,255,0.35);
                text-shadow: 0 0 10px rgba(0,210,255,0.35) !important;
            }
            .details-character-status[open] > summary::before {
                content: '▾';
                display: inline-block;
                color: var(--primary);
                margin-right: 8px;
                font-size: 12px;
            }
            .details-character-status[open] > summary::after {
                content: "";
                position: absolute;
                bottom: -4px;
                left: 0;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, var(--primary), transparent);
                opacity: 0.6;
            }

            /* 内容区：HUD 卡片 */
            .details-character-status > div {
                padding: 10px;
                margin: 0 0 5px 0;
                font-size: 14.5px;
                line-height: 1.55;
                background: var(--bg-glass);
                color: var(--text-primary);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                font-weight: 400;
                white-space: pre-wrap;
                word-break: break-word;
                backdrop-filter: blur(4px);
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
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                text-transform: none;
                letter-spacing: normal;
                color: var(--text-primary);
            }
            .details-character-status > div > details[open] > summary {
                margin-bottom: 2px !important;
                color: var(--primary);
            }

            /* 辅助文字类 */
            .sao-text-secondary { color: var(--text-secondary) !important; }
            .sao-text-muted { color: var(--text-tertiary) !important; }

            /* 任务输入框 */
            input[data-sao-quest-input] {
                width: 60%;
                padding: 4px 8px;
                font-size: 13px;
                background: rgba(8,12,20,0.6);
                border: 1px solid rgba(0,210,255,0.3);
                border-radius: 4px;
                color: var(--text-primary);
                font-family: inherit;
                outline: none;
                transition: all 0.2s ease;
            }
            input[data-sao-quest-input]::placeholder {
                color: var(--text-tertiary);
            }
            input[data-sao-quest-input]:focus {
                border-color: var(--primary);
                box-shadow: 0 0 10px rgba(0,210,255,0.2);
                background: rgba(8,12,20,0.75);
            }

            /* C3/C5.5: 操作按钮 */
            /* 主操作：完成 / 添加 任务 */
            .sao-quest-btn {
                display: inline-block;
                padding: 2px 8px;
                margin-left: 4px;
                font-size: 12px;
                font-weight: 700;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                letter-spacing: 0.4px;
                text-transform: uppercase;
                color: var(--bg-base);
                background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dim) 100%);
                border: 1px solid rgba(0,210,255,0.45);
                border-radius: 5px;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1.4;
                transition: all 0.2s ease;
                position: relative;
                overflow: hidden;
            }
            .sao-quest-btn:hover {
                filter: brightness(1.15);
                box-shadow: 0 0 12px rgba(0,210,255,0.4);
                transform: translateY(-1px);
            }
            .sao-quest-btn:active {
                transform: translateY(0);
                filter: brightness(0.95);
            }

            /* 次要操作：使用 / 卸下 / 穿戴 */
            .sao-equip-btn {
                display: inline-block;
                padding: 1px 7px;
                margin-left: 4px;
                font-size: 12px;
                font-weight: 600;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                letter-spacing: 0.3px;
                text-transform: uppercase;
                color: var(--primary);
                background: transparent;
                border: 1px solid rgba(0,210,255,0.45);
                border-radius: 5px;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1.4;
                transition: all 0.2s ease;
            }
            .sao-equip-btn:hover {
                background: rgba(0,210,255,0.12);
                color: var(--primary-bright);
                border-color: var(--primary);
                box-shadow: 0 0 10px rgba(0,210,255,0.18);
            }
            .sao-equip-btn:active {
                background: rgba(0,210,255,0.18);
                transform: translateY(0);
            }

            /* C4: 技能详情展开样式 */
            .sao-skill-details {
                margin: 2px 0 !important;
            }
            .sao-skill-details > summary {
                cursor: pointer;
                list-style: none;
                padding: 2px 0;
            }
            .sao-skill-details > summary::-webkit-details-marker,
            .sao-skill-details > summary::marker {
                display: none;
                content: '';
            }
            .sao-skill-details > summary::before {
                content: '▸ ';
                display: inline;
                font-size: 11px;
                color: var(--primary);
            }
            .sao-skill-details[open] > summary::before {
                content: '▾ ';
                color: var(--text-secondary);
            }
        </style>
        <div class="character-status-wrapper">
            <details class="details-character-status">
                <summary>角色状态栏</summary>
                <div class="sao-status-content">${safeContent}</div>
            </details>
        </div>
    `
    // C3/C4/C5.5: 附加交互事件监听
    _attachStatusPanelListeners(shadow);
}

/**
 * C3/C5.5: 为状态面板交互按钮附加事件监听。
 * 装备穿戴/卸下、任务添加/完成后重新投影渲染面板内容。
 * @param {ShadowRoot} shadow
 */
function _attachStatusPanelListeners(shadow) {
    // C3: 卸下装备
    shadow.querySelectorAll('[data-sao-action="unequip"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const slot = btn.dataset.saoSlot;
            try {
                const removedId = await unequipItem(slot);
                if (removedId) {
                    const eq = getEquipmentById(removedId);
                    appendActionLog({
                        action: 'unequip',
                        itemType: 'equipment',
                        itemName: eq?.name || removedId,
                        slot: slot,
                        result: 'success'
                    });
                }
                _refreshStatusPanelContent(shadow);
            } catch (err) {
                log(`卸下装备失败: ${err.message}`, 'warn');
                alert('卸下装备失败：' + err.message);
            }
        });
    });

    // C3: 穿戴装备（从背包）
    shadow.querySelectorAll('[data-sao-action="equip"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const equipId = btn.dataset.saoEquipId;
            try {
                const equip = getEquipmentById(equipId);
                if (equip) {
                    await equipItem(equip.slot, equipId);
                    appendActionLog({
                        action: 'equip',
                        itemType: 'equipment',
                        itemName: equip.name,
                        slot: equip.slot,
                        result: 'success'
                    });
                    _refreshStatusPanelContent(shadow);
                }
            } catch (err) {
                log(`穿戴装备失败: ${err.message}`, 'warn');
                alert('装备失败：' + err.message);
            }
        });
    });

    // 使用消耗品
    shadow.querySelectorAll('[data-sao-action="use-consumable"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            try {
                const results = await useConsumable(itemId);
                if (results.length === 0) {
                    alert('使用失败：物品不存在或非消耗品');
                    return;
                }
                _refreshStatusPanelContent(shadow);
                if (results && results.length > 0) alert('使用成功：' + results.join(', '));
            } catch (err) {
                log(`使用消耗品失败: ${err.message}`, 'warn');
                alert('使用失败：' + err.message);
            }
        });
    });

    // C5.5: 添加任务
    shadow.querySelectorAll('[data-sao-action="add-quest"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = shadow.querySelector('[data-sao-quest-input]');
            if (input && input.value.trim()) {
                createQuest({ title: input.value.trim(), source: 'manual' });
                _refreshStatusPanelContent(shadow);
            }
        });
    });
    // 回车提交
    shadow.querySelectorAll('[data-sao-quest-input]').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const addBtn = shadow.querySelector('[data-sao-action="add-quest"]');
                if (addBtn) addBtn.click();
            }
        });
    });

    // C5.5: 完成任务
    shadow.querySelectorAll('[data-sao-action="complete-quest"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const questId = btn.dataset.saoQuestId;
            try {
                await completeQuest(questId);
                _refreshStatusPanelContent(shadow);
            } catch (err) {
                log(`完成任务失败: ${err.message}`, 'warn');
            }
        });
    });
}

/**
 * C3/C5.5: 刷新状态面板内容区域（保留 Shadow DOM host 和 style）。
 * 重新从 store projection 获取 HTML，替换内容区并重新附加事件监听。
 * @param {ShadowRoot} shadow
 */
function _refreshStatusPanelContent(shadow) {
    try {
        const newHtml = projectStatusPanelHtml();
        if (!newHtml) {
            log('_refreshStatusPanelContent: projectStatusPanelHtml 返回 null，跳过更新（store 可能未初始化）', 'warn');
            return;
        }
        const contentDiv = shadow.querySelector('.sao-status-content');
        if (contentDiv) {
            // 刷新前记录各 details 的 open 状态（按 summary 文本识别）
            const prevOpenSummaries = new Set();
            contentDiv.querySelectorAll('details').forEach(d => {
                if (d.open) {
                    const s = d.querySelector('summary');
                    if (s) prevOpenSummaries.add(s.textContent.trim());
                }
            });
            // 外壳 details 也要记录
            const outerDetails = shadow.querySelector('.details-character-status');
            const outerWasOpen = outerDetails ? outerDetails.open : false;

            const safeContent = sanitizeInlineSaoHtml(newHtml.trim())
                .replace(/^[ \t]+/gm, '')
                .replace(/[ \t]+$/gm, '')
                .replace(/\n{3,}/g, '\n\n')
                .replace(/<\/summary>\s*\n+/g, '</summary>')
                .replace(/<\/details>\s*\n+\s*<details/g, '</details><details')
                .replace(/\s+<\/details>/g, '</details>');
            contentDiv.innerHTML = safeContent;

            // 恢复 open 状态
            contentDiv.querySelectorAll('details').forEach(d => {
                const s = d.querySelector('summary');
                if (s && prevOpenSummaries.has(s.textContent.trim())) {
                    d.open = true;
                }
            });
            // 恢复外壳
            const newOuter = shadow.querySelector('.details-character-status');
            if (newOuter) newOuter.open = outerWasOpen;

            _attachStatusPanelListeners(shadow);
        }
    } catch (e) {
        log(`刷新状态面板失败: ${e.message}`, 'warn');
    }
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
