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

/**
 * renderEquipment + renderSwordSkill + renderMap 共用的 SAO 深色青色 HUD 面板样式。
 * 与 renderUserStatus (details-character-status) 完全同一套语言：
 *   - navy rgba(12,18,28,0.94) + cyan border + top 发光条
 *   - 闭合态暗色按钮条 + 左 cyan 竖线 + ▸ 箭头
 *   - 展开态 cyber 标题 cyan + text-shadow glow + 1px 渐变分隔线
 *   - 内容区 HUD glass 卡 + backdrop-filter blur
 * 三个渲染器共用本常量，仅 summary 文字/icon 与 wrapper/details 类名（sao-panel-wrapper / sao-panel-details）一致。
 */
const SHARED_SAO_PANEL_CSS = `
            @import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Exo+2:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap");

            /* 主容器：与 renderUserStatus 的 .character-status-wrapper 同一 token */
            .sao-panel-wrapper {
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
                max-width: min(100%, 861px);
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
            .sao-panel-wrapper::before {
                content: "";
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent 0%, var(--primary) 20%, var(--primary-bright) 50%, var(--primary) 80%, transparent 100%);
                opacity: 0.85;
                pointer-events: none;
            }

            /* 全局禁用文本阴影（仅 open summary 标题允许发光，由下方 !important 单点启用） */
            .sao-panel-wrapper,
            .sao-panel-wrapper *,
            .sao-panel-details,
            .sao-panel-details *,
            .sao-panel-details > summary,
            .sao-panel-details > summary::before,
            .sao-panel-details > summary::after,
            .sao-panel-details > div {
                text-shadow: none !important;
            }

            /* 详情折叠容器 */
            .sao-panel-details {
                border: none;
                margin: 0;
                padding: 0;
                color: inherit;
            }

            /* 摘要基础 */
            .sao-panel-details > summary {
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
            .sao-panel-details > summary::-webkit-details-marker,
            .sao-panel-details > summary::marker {
                display: none;
                content: '';
            }

            /* 闭合态：深色按钮条 + 左侧 cyan 竖线 + ▸ 箭头 */
            .sao-panel-details:not([open]) > summary {
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
            .sao-panel-details:not([open]) > summary::before {
                content: '▸';
                display: inline-block;
                color: var(--primary);
                margin-right: 8px;
                font-size: 12px;
                transition: transform 0.2s ease;
            }
            .sao-panel-details:not([open]) > summary:hover {
                color: var(--primary-bright);
                background: rgba(22,30,46,0.92);
                border-color: rgba(0,210,255,0.45);
                box-shadow: -2px 0 10px rgba(0,210,255,0.28), 0 0 10px rgba(0,210,255,0.12);
            }

            /* 展开态：标题 cyan + 竖线发光 + 下方渐变分隔线 */
            .sao-panel-details[open] > summary {
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
            .sao-panel-details[open] > summary::before {
                content: '▾';
                display: inline-block;
                color: var(--primary);
                margin-right: 8px;
                font-size: 12px;
            }
            .sao-panel-details[open] > summary::after {
                content: "";
                position: absolute;
                bottom: -4px;
                left: 0;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, var(--primary), transparent);
                opacity: 0.6;
            }

            /* 内容区：HUD glass 卡片 */
            .sao-panel-details > div {
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
`;

/**
 * 白名单清洗内联 HTML，仅保留 SAO 卡中常见的安全标签与属性。
 * 允许：br, font[color], span[style|color], b, strong, i, em, div, details, summary,
 *      button, input, ul, li 及 data-sao-* 等交互属性
 * 移除：script/style/事件属性/javascript: 等。
 */
function sanitizeInlineSaoHtml(html) {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['br', 'font', 'span', 'b', 'strong', 'i', 'em', 'div', 'details', 'summary', 'button', 'input', 'ul', 'li', 'small'],
        ALLOWED_ATTR: ['color', 'style', 'open', 'class', 'title', 'type', 'placeholder',
            'data-sao-action', 'data-sao-slot', 'data-sao-equip-id', 'data-sao-quest-id',
            'data-item-id', 'data-sao-quest-input', 'data-sao-section'],
        ALLOWED_CSS_PROPERTIES: ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'width'],
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
                max-width: min(100%, 861px);
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

            /* ============================================================
             * R1: 对话内 HUD 化样式
             * ============================================================ */

            /* 保留 fallback 文本换行，但 HUD 卡片内部恢复正常排版 */
            .details-character-status > .sao-status-content { white-space: pre-wrap !important; }
            .sao-status-content > .sao-hud-card { white-space: normal; }

            /* HUD 卡片基座 */
            .sao-hud-card {
                background: linear-gradient(180deg, rgba(22,30,46,0.92) 0%, rgba(15,21,34,0.92) 100%);
                border: 1px solid var(--border-subtle);
                border-left: 3px solid var(--primary);
                border-radius: 8px;
                padding: 10px 12px;
                margin: 0 0 8px 0;
                box-shadow: 0 4px 14px rgba(0,0,0,0.35);
                position: relative;
                overflow: hidden;
            }
            .sao-hud-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, var(--primary), transparent 70%);
                opacity: 0.4;
                pointer-events: none;
            }
            .sao-hud-card:last-child { margin-bottom: 0; }

            /* 角色信息区 */
            .sao-hud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 6px;
            }
            .sao-hud-name {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 1.35em;
                font-weight: 700;
                color: var(--text-primary);
                letter-spacing: 0.4px;
                text-shadow: 0 0 10px rgba(0,210,255,0.25);
            }
            .sao-hud-title {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.92em;
                color: var(--text-secondary);
                margin-top: 2px;
            }
            .sao-hud-sub {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.85em;
                color: var(--text-tertiary);
                letter-spacing: 0.5px;
            }

            /* 光标徽章 */
            .sao-cursor-badge {
                display: inline-flex;
                align-items: center;
                padding: 3px 10px;
                border-radius: 12px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.78em;
                font-weight: 700;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                border: 1px solid rgba(255,255,255,0.12);
                box-shadow: 0 0 8px currentColor;
                white-space: nowrap;
            }
            .sao-cursor-green { background: rgba(0,214,138,0.12); color: var(--success); }
            .sao-cursor-orange { background: rgba(255,184,0,0.12); color: var(--warning); }
            .sao-cursor-red { background: rgba(255,46,74,0.14); color: var(--danger); }

            /* HP / MP 进度条 */
            .sao-bar-row { margin-bottom: 10px; }
            .sao-bar-row:last-child { margin-bottom: 0; }
            .sao-bar-labels {
                display: flex;
                justify-content: space-between;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                margin-bottom: 3px;
                color: var(--text-secondary);
                letter-spacing: 0.5px;
            }
            .sao-bar-container {
                height: 9px;
                background: rgba(255,255,255,0.06);
                border-radius: 5px;
                overflow: hidden;
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.45);
                position: relative;
            }
            .sao-bar {
                height: 100%;
                border-radius: 5px;
                transition: width 0.5s cubic-bezier(0.22,0.61,0.36,1);
                position: relative;
                box-shadow: 0 0 10px currentColor;
            }
            .sao-bar::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 40%;
                background: linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0));
                pointer-events: none;
                border-radius: 5px 5px 0 0;
            }
            .sao-bar-hp { background: linear-gradient(90deg, #ff4757, #ff6b81); color: rgba(255,71,87,0.5); }
            .sao-bar-mp { background: linear-gradient(90deg, #00a8e6, #00d2ff); color: rgba(0,210,255,0.5); }
            .sao-bar-hp-low { animation: sao-pulse-red 1.1s ease-in-out infinite; }
            @keyframes sao-pulse-red {
                0%, 100% { filter: brightness(1); box-shadow: 0 0 0 rgba(255,46,74,0); }
                50% { filter: brightness(1.25); box-shadow: 0 0 14px rgba(255,46,74,0.55); }
            }

            /* 属性卡片 */
            .sao-stat-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
                margin: 12px 0;
            }
            .sao-stat-item {
                text-align: center;
                padding: 8px 6px;
                background: rgba(22,30,46,0.65);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                transition: all 0.25s ease;
                position: relative;
                overflow: hidden;
            }
            .sao-stat-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--primary);
                opacity: 0;
                transition: opacity 0.25s ease;
            }
            .sao-stat-item:hover {
                background: rgba(30,40,58,0.8);
                border-color: var(--border-accent);
                transform: translateY(-2px);
                box-shadow: 0 6px 18px rgba(0,210,255,0.14);
            }
            .sao-stat-item:hover::before { opacity: 1; }
            .sao-stat-value {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 1.25em;
                font-weight: 700;
                color: var(--primary);
                text-shadow: 0 0 8px rgba(0,210,255,0.3);
            }
            .sao-stat-label {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.72em;
                color: var(--text-secondary);
                margin-top: 2px;
                letter-spacing: 0.6px;
            }

            /* 元信息 */
            .sao-hud-meta {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.8em;
                color: var(--text-tertiary);
                letter-spacing: 0.4px;
                margin-top: 6px;
            }

            /* 装备槽网格 */
            .sao-equip-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
                margin-top: 8px;
            }
            .sao-equip-grid:first-child { margin-top: 0; }
            .sao-equip-slot {
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                transition: all 0.2s ease;
            }
            .sao-equip-slot:hover {
                background: rgba(30,40,58,0.7);
                border-color: var(--border-accent);
            }
            .sao-equip-slot-label {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.72em;
                color: var(--text-tertiary);
                letter-spacing: 0.6px;
                text-transform: uppercase;
            }
            .sao-equip-item {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-size: 0.9em;
                font-weight: 600;
                color: var(--text-primary);
            }
            .sao-equip-empty {
                color: var(--text-tertiary);
                font-style: italic;
            }
            .sao-equip-stats {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.75em;
                color: var(--success);
                letter-spacing: 0.3px;
            }
            .sao-equip-slot .sao-equip-btn {
                margin: 4px 0 0 0;
                align-self: flex-start;
            }

            /* 背包装备标题 */
            .sao-equip-backpack-title {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.6px;
                margin: 12px 0 4px 0;
            }

            /* 技能列表 */
            .sao-skill-list { display: flex; flex-direction: column; gap: 6px; }
            .sao-skill-details {
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                overflow: hidden;
                margin: 0 !important;
            }
            .sao-skill-details > summary {
                padding: 7px 10px !important;
                font-size: 0.95em !important;
                font-weight: 600 !important;
                color: var(--text-primary) !important;
                cursor: pointer !important;
                list-style: none !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 8px !important;
            }
            .sao-skill-details > summary small {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.78em;
                color: var(--text-tertiary);
                font-weight: 500;
            }
            .sao-skill-combat {
                padding: 6px 10px 8px 10px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                color: var(--text-secondary);
                background: rgba(8,12,20,0.45);
                border-top: 1px solid var(--border-subtle);
                letter-spacing: 0.4px;
            }
            .sao-skill-item {
                padding: 7px 10px;
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                font-size: 0.92em;
                color: var(--text-primary);
            }

            /* 任务卡 */
            .sao-quest-card {
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-left: 3px solid var(--warning);
                border-radius: 6px;
                padding: 8px 10px;
                margin-bottom: 8px;
            }
            .sao-quest-card:last-child { margin-bottom: 0; }
            .sao-quest-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 3px;
            }
            .sao-quest-header b {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-size: 0.98em;
                color: var(--text-primary);
            }
            .sao-quest-objectives {
                margin: 6px 0 0 0;
                padding-left: 18px;
                font-size: 0.88em;
                color: var(--text-secondary);
            }
            .sao-quest-objectives li { margin: 2px 0; }
            .sao-quest-add { margin-top: 10px; display: flex; gap: 6px; align-items: center; }
            .sao-quest-completed { margin-top: 10px; }

            /* 背包标签 */
            .sao-inv-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-bottom: 8px;
            }
            .sao-tag {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                background: rgba(0,210,255,0.08);
                border: 1px solid rgba(0,210,255,0.28);
                border-radius: 14px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                color: var(--primary-bright);
                transition: all 0.2s ease;
            }
            .sao-tag:hover {
                background: rgba(0,210,255,0.16);
                border-color: rgba(0,210,255,0.5);
                box-shadow: 0 0 10px rgba(0,210,255,0.14);
            }
            .sao-tag .sao-equip-btn {
                margin-left: 2px;
                padding: 0 6px;
                font-size: 0.78em;
            }
            .sao-cor-row {
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.9em;
                color: var(--warning);
                margin-top: 6px;
            }
            .sao-cor-row b { color: var(--text-secondary); }

            /* NPC 迷你卡 */
            .sao-npc-card {
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                padding: 8px 10px;
                margin-bottom: 8px;
            }
            .sao-npc-card:last-child { margin-bottom: 0; }
            .sao-npc-name {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-weight: 600;
                font-size: 0.95em;
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .sao-npc-meta {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.8em;
                color: var(--text-secondary);
                margin-top: 3px;
                letter-spacing: 0.3px;
            }
            .sao-npc-tags {
                display: inline-flex;
                flex-wrap: wrap;
                gap: 4px;
            }
            .sao-npc-tag {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.72em;
                padding: 1px 7px;
                border-radius: 10px;
                background: rgba(0,210,255,0.1);
                color: var(--primary-bright);
                border: 1px solid rgba(0,210,255,0.22);
            }
            .sao-npc-tag.sao-npc-tag-rel { background: rgba(0,214,138,0.1); border-color: rgba(0,214,138,0.25); color: var(--success); }

            /* 辅助元素 */
            .sao-divider {
                height: 1px;
                background: linear-gradient(90deg, var(--border-accent), transparent);
                margin: 10px 0;
                opacity: 0.5;
            }
            .sao-empty {
                font-size: 0.88em;
                color: var(--text-tertiary);
                font-style: italic;
                padding: 6px 0;
            }
            .sao-text-secondary { color: var(--text-secondary) !important; }
            .sao-text-muted { color: var(--text-tertiary) !important; }

            /* 响应式：小屏幕属性/装备网格降级 */
            @media (max-width: 560px) {
                .sao-stat-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
                .sao-equip-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
                .sao-hud-header { flex-direction: column; align-items: flex-start; gap: 6px; }
                .sao-quest-header { flex-wrap: wrap; }
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
            // 刷新前记录各 section details 的 open 状态（按 data-sao-section 识别，更可靠）
            const prevOpen = new Set();
            contentDiv.querySelectorAll('details[data-sao-section]').forEach(d => {
                if (d.open) prevOpen.add(d.dataset.saoSection);
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

            // 恢复 section open 状态
            contentDiv.querySelectorAll('details[data-sao-section]').forEach(d => {
                if (prevOpen.has(d.dataset.saoSection)) d.open = true;
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
            ${SHARED_SAO_PANEL_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>🎒 新装备</summary>
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
            ${SHARED_SAO_PANEL_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>✨ 新剑技</summary>
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
            ${SHARED_SAO_PANEL_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>🗺️ 地图</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}
