// SAO Companion - 渲染模块（Shadow DOM 渲染 + 标签提取 + DOMPurify 钩子）
// 从 index.js 拆分而来

import { esc, log, getSaoData, safeJsonParse } from './sao-core.js';
import { DOMPurify } from '../../../../lib.js';
import { projectStatusPanelHtml, renderNpcPanel, renderEquipmentPanel, renderSkillPanel } from './sao-state-projection.js';
import { SAO_CUSTOM_TAGS, createSaoShadowHost } from './sao-dom-utils.js';
import { PANEL_REGISTRY, PANEL_TAGS } from './sao-panel-registry.js';
import { SAO_CALENDAR_CSS } from './sao-calendar-theme.js';
import { buildCleanCalendarDays } from './sao-calendar.js';
import { buildCalCellHtml } from './sao-calendar-cell.js';
import { renderDetailEquip as _renderEquipShared, renderDetailSkill as _renderSkillShared, renderDetailInv as _renderInvShared, rarityClass } from './sao-detail-popup.js';
import { equipItem, unequipItem, getPlayerStore, forgetPlayerSkill } from './sao-store-player.js';
import { getEquipmentById, getEquipmentStore } from './sao-store-equipment.js';
import { getSkillById, getSkillStore } from './sao-store-skill.js';
import { createQuest, completeQuest, abandonQuest, getCompletedQuests } from './sao-store-quest.js';
import { useConsumable, getConsumableById } from './sao-store-consumable.js';
import { getInventoryStore } from './sao-store-inventory.js';
import { appendActionLog } from './sao-store-core.js';

// 模块级预编译：SAO_CUSTOM_TAGS 固定不变，正则与渲染函数映射构造一次，避免热路径重复构造。
// 用 SAO_CUSTOM_TAGS（含 system_state_ref）而非 PANEL_TAGS，确保 system_state_ref 也能被检测并隐藏。
const _SAO_TAG_RE = new RegExp(`<(?:${SAO_CUSTOM_TAGS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

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
 * renderEquipment + renderSwordSkill 共用的 SAO 深色青色 HUD 面板样式。
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

            /* 操作按钮（使用/卸下/穿戴）极小图标风格 — 融入文本行 */
            .sao-equip-btn {
                display: inline-flex;
                align-items: center;
                padding: 0 3px;
                font-size: 11px;
                color: var(--primary);
                background: transparent;
                border: none;
                border-radius: 2px;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1;
                opacity: 0.5;
                transition: opacity 0.2s ease, color 0.2s ease, text-shadow 0.2s ease;
            }
            .sao-equip-btn:hover {
                opacity: 1;
                color: var(--primary-bright);
                text-shadow: 0 0 6px rgba(0,210,255,0.5);
            }
            .sao-equip-btn:active {
                opacity: 0.8;
            }

            /* 光标六边形徽章 — 3D 竖轴旋转 + 内联定位，无"光标"标签 */
            .sao-cursor-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 2px 9px 2px 7px;
                border-radius: 12px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.78em;
                font-weight: 700;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                white-space: nowrap;
                vertical-align: middle;
                line-height: 1;
            }
            .sao-cursor-hex {
                display: inline-block;
                width: 11px;
                height: 11px;
                background: currentColor;
                clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
                transform-style: preserve-3d;
                animation: sao-cursor-spin 3.2s linear infinite;
                filter: drop-shadow(0 0 4px currentColor);
                flex-shrink: 0;
            }
            @keyframes sao-cursor-spin {
                from { transform: perspective(80px) rotateY(0deg); }
                to   { transform: perspective(80px) rotateY(360deg); }
            }
            @media (prefers-reduced-motion: reduce) {
                .sao-cursor-hex {
                    animation: none;
                    transform: perspective(80px) rotateY(0deg);
                }
            }
            .sao-cursor-green  { color: #00d68a; background: rgba(0,214,138,0.10); border: 1px solid rgba(0,214,138,0.30); }
            .sao-cursor-orange { color: #ff8a3d; background: rgba(255,138,61,0.10); border: 1px solid rgba(255,138,61,0.32); }
            .sao-cursor-red    { color: #ff2e4a; background: rgba(255,46,74,0.12);  border: 1px solid rgba(255,46,74,0.36); }
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
        const dateStrFull = dateStr(day);
        // 硬过滤：只显示 date 字段与当前 grid 日期完全匹配的事件
        // 旧数据没有 date 字段（undefined）→ 过滤掉（不信任旧数据）
        // 新数据有 date 字段 → 必须与 dateStrFull 匹配
        const rawCalEvents = calDaysMap?.[dateStrFull]?.events || [];
        const calDayEvents = rawCalEvents.filter(ev => ev.date === dateStrFull);
        // 合并持久化 cal.days 中的非 canon 事件(appointment 等)，与控制台 buildCalCell 一致。
        // buildCleanCalendarDays 只产出 canon 事件，appointment 存在 cal.days，不合并则黄点永不显示。
        const dirtyEvents = getSaoData()?.calendar?.days?.[dateStrFull]?.events || [];
        const aptEvents = dirtyEvents.filter(ev => ev.type !== 'canon' && ev.date === dateStrFull);
        const allEvents = [...calDayEvents, ...aptEvents];

        cells += buildCalCellHtml({
            dateStr: dateStrFull,
            day,
            isCurrentMonth: true,
            isToday: isCurrent,
            events: allEvents,
            roleButton: true,
        });
    }
    return cells;
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
                // Only initialize from panel data if vd is not set at all
                if (!vd && freshYear && freshMonth) {
                    vd = new Date(freshYear, freshMonth - 1, 1);
                    _chatCalViewDates.set(messageId, vd);
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
    gain_equipment: renderEquipment,
    gain_skill: renderSwordSkill,
    user_status: renderUserStatus,
    npc_status: renderNpcStatus,
    calendar: renderCalendar,
};

export function renderAllTags(messageEl, rawText, messageId) {
    // 面板渲染顺序由 PANEL_REGISTRY 定义（sao-panel-registry.js），匹配消息中标签的原始顺序。
    // 每个渲染器通过 createSaoShadowHost(refNode) 在标签 DOM 节点处插入 Shadow host（位置插入）。
    // NPC状态栏已由插件 Shadow DOM 渲染器接管（renderNpcStatus），卡片正则脚本已从白名单移除。
    // 过渡期主 LLM 可能仍发标签 → 需隐藏 light DOM 避免双重渲染
    const hasAnySaoTags = _SAO_TAG_RE.test(rawText || '');
    if (hasAnySaoTags) {
        hideSaoLightDomTags(messageEl)
    }
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    for (const entry of PANEL_REGISTRY) {
        const fn = _RENDER_FN_MAP[entry.tag];
        if (!fn) continue;                   // digest/zd_status 等: 无渲染器，仅 DOMPurify 保留 + cleanup
        try {
            fn(messageEl, rawText, messageId, mesText.querySelector(entry.tag));
        } catch (e) {
            log(`${entry.tag} 渲染失败: ${e.message}`, 'error');
        }
    }
    if (hasAnySaoTags) {
        cleanupSaoLightDom(messageEl)
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
    // 1b. 删除 DOMPurify 剥离标签后残留的纯文本内容
    // DOMPurify 可能剥离 <swordskill> 等自定义标签（保留子文本节点），
    // 导致标签内容作为纯文本泄漏到聊天中。此处用正则删除残留的标签文本块。
    // 只在 mesText 的直接子 <p> 中搜索，避免误删 Shadow host 内部内容。
    mesText.querySelectorAll(':scope > p').forEach(p => {
        if (p.querySelector('.sao-render-host')) return; // 保护 Shadow host 容器
        const text = p.textContent;
        // 匹配 SAO 标签的转义形式（DOMPurify 剥离后残留的 &lt;swordskill&gt; 等）
        // 或 specialist 输出格式的残留纯文本（📜 词条 / ⚔️ 基础攻击力 等 emoji 行）
        const hasEscapedTag = /&lt;\/?(?:equip|swordskill|user_status|zd_status|calendar|map|system_state_ref|digest)&gt;/i.test(text);
        // 检测 specialist 面板格式的残留文本（多行 emoji 属性列表）
        const specialistPatterns = [
            /📜\s*词条/, /⚔️\s*基础攻击力/, /🎯\s*命中率/, /💥\s*暴击率/,
            /🔄\s*攻击次数/, /👥\s*目标数量/, /💧\s*法力消耗/, /⏳\s*冷却时间/,
            /✨\s*特殊效果/, /🎮\s*效果代码/,
            /=========.*【.*】.*==========/,
            /领悟新剑技/, /你的剑技已随武器变更/,
        ];
        const hasSpecialistResidue = specialistPatterns.filter(re => re.test(text)).length >= 3;
        if (hasEscapedTag || hasSpecialistResidue) {
            p.remove();
        }
    });
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
    // 渲染优先级：
    // 1. store projection（Phase C 主路径，结构化权威数据）
    // 2. status 专家面板缓存
    // 3. AI 的 <user_status> 标签内容（AI 仍输出标签时的兼容回退）
    let content = null;

    // 1. 优先：store projection（Phase C 主路径）
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

    // 3. 回退：AI 的 <user_status> 标签内容
    if (!content) {
        const tagContent = extractTag(rawText, 'user_status');
        if (tagContent) {
            // 剥离嵌套的其他 SAO 自定义标签
            const _stripRe = new RegExp(`<(?:${SAO_CUSTOM_TAGS.filter(t => t !== 'user_status').join('|')})\\b[^>]*>[\\s\\S]*?<\\/(?:${SAO_CUSTOM_TAGS.filter(t => t !== 'user_status').join('|')})>`, 'gi');
            content = tagContent.replace(_stripRe, '');
        }
        if (content === null) return;
    }
    const { shadow } = createSaoShadowHost(messageEl, 'user_status', refNode)
    // 保留已有 details 的 open 状态（renderAllTags 每次重建 innerHTML 会丢失）
    const _existingDetails = shadow.querySelector('.details-character-status');
    const _wasOpen = _existingDetails ? _existingDetails.open : false;
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

            /* ============================================================
             * SAO 科技风：对话内角色状态面板 — 照图3精确实现
             * 布局（与侧边面板状态监控 tab 同语言 panel.html:48-104）：
             *   Row 1: 玩家状态 (左 55%) | 世界状态 (右 45%)
             *   任务: 单独一栏
             *   Row 2: 物品 (左 55%) | 装备 + 技能 (右 45% stack)
             * ============================================================ */
            .character-status-wrapper {
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
                --bg-glass: rgba(22,30,46,0.92);
                --border-subtle: rgba(255,255,255,0.08);
                --border-accent: rgba(0,210,255,0.35);

                background: rgba(12,18,28,0.94);
                border: 1px solid rgba(0,210,255,0.45);
                border-radius: 8px;
                max-width: min(100%, 861px);
                margin: 5px auto;
                padding: 0 4px 4px 4px;
                box-sizing: border-box;
                overflow: hidden;
                max-height: 60vh;
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
            .details-character-status { border: none; margin: 0; padding: 0; color: inherit; }
            .details-character-status > summary {
                display: flex;
                align-items: center;
                width: 100%;
                cursor: pointer;
                list-style: none;
                outline: none;
                transition: all 0.2s ease;
                position: relative;
                box-sizing: border-box;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-weight: 700;
                letter-spacing: 0.6px;
                text-transform: uppercase;
            }
            .details-character-status > summary::-webkit-details-marker,
            .details-character-status > summary::marker { display: none; content: ''; }

            .details-character-status:not([open]) > summary {
                padding: 6px 10px;
                font-size: 15px;
                line-height: 1.3;
                margin: 5px 0 0 0;
                background: rgba(15,21,34,0.85);
                border: 1px solid rgba(0,210,255,0.22);
                border-left: 2px solid var(--primary);
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
            }
            .details-character-status:not([open]) > summary:hover {
                color: var(--primary-bright);
                background: rgba(22,30,46,0.92);
                border-color: rgba(0,210,255,0.45);
                box-shadow: -2px 0 10px rgba(0,210,255,0.28), 0 0 10px rgba(0,210,255,0.12);
            }

            .details-character-status[open] > summary {
                padding: 9px 8px 7px 10px;
                font-size: 16px;
                line-height: 1.3;
                margin: 5px 0 6px 0;
                background: transparent;
                border: none;
                border-left: 2px solid var(--primary);
                border-radius: 0;
                color: #ffffff;
                justify-content: flex-start;
                box-shadow: -2px 0 8px rgba(0,210,255,0.30);
                font-weight: 700;
                text-shadow: 0 0 8px rgba(0,210,255,0.35) !important;
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
                bottom: -2px;
                left: 2px;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, var(--primary), transparent);
                opacity: 0.6;
            }

            /* 内容区 */
            .details-character-status > div {
                padding: 10px;
                margin: 0 0 2px 0;
                font-size: 14px;
                line-height: 1.55;
                background: var(--bg-glass);
                color: var(--text-primary);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                white-space: pre-wrap;
                word-break: break-word;
                backdrop-filter: blur(4px);
            }
            .sao-status-content { display: block; overflow-y: auto; overflow-x: hidden; max-height: calc(60vh - 40px); padding-right: 4px; }
            .sao-status-content .sao-hud-card { white-space: normal; }

            /* === 双行 × 双列布局 (左 55% / 右 45%) === */
            .sao-status-row {
                display: grid;
                grid-template-columns: 11fr 9fr;
                gap: 8px 10px;
                align-items: start;
            }
            .sao-status-row + .sao-status-row { margin-top: 8px; }
            .sao-status-row + .sao-status-section-standalone { margin-top: 8px; }
            .sao-status-section-standalone + .sao-status-row { margin-top: 8px; }
            .sao-status-col { display: flex; flex-direction: column; gap: 0; min-width: 0; }
            .sao-status-col .sao-status-section { margin: 0; }
            .sao-status-right-stack { gap: 8px; }
            @media (max-width: 600px) {
                .sao-status-row { grid-template-columns: 1fr; gap: 8px; }
            }

            /* === Section 标题 (2px cyan 竖线) === */
            .sao-status-section { position: relative; }
            .sao-status-section-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.92em;
                font-weight: 700;
                color: var(--text-primary);
                letter-spacing: 0.5px;
                text-transform: uppercase;
                padding: 4px 0 4px 10px;
                margin: 0 0 6px 0;
                border-left: 2px solid var(--primary);
                line-height: 1.4;
            }
            .sao-status-section-title::after {
                content: "";
                position: absolute;
                left: 10px;
                right: 0;
                bottom: 0;
                height: 1px;
                background: linear-gradient(90deg, var(--primary), transparent 75%);
                opacity: 0.5;
                pointer-events: none;
            }

            /* === HUD 卡片基座 === */
            .sao-hud-card {
                background: linear-gradient(180deg, rgba(22,30,46,0.92) 0%, rgba(15,21,34,0.92) 100%);
                border: 1px solid var(--border-accent);
                border-radius: 8px;
                padding: 12px 12px;
                margin: 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.30), 0 0 12px rgba(0,210,255,0.08);
                position: relative;
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

            /* === 玩家状态 HUD 头部 (紧凑) === */
            .sao-hud-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
            .sao-hud-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
            .sao-hud-name {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 14px;            /* 压缩紧凑 */
                font-weight: 700;
                color: var(--text-primary);
                letter-spacing: 0.4px;
                line-height: 1.2;
            }
            .sao-hud-location {
                font-size: 12px;
                color: var(--text-secondary);
                letter-spacing: 0.4px;
                font-weight: 400;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .sao-hud-lv {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 12px;            /* 压缩紧凑 */
                font-weight: 700;
                color: var(--primary);
                text-shadow: 0 0 6px rgba(0,210,255,0.35);
                letter-spacing: 0.4px;
            }
            .sao-hud-sub {
                font-size: 12px;            /* 用户要求: 12px */
                color: var(--text-secondary);
                letter-spacing: 0.4px;
                font-weight: 400;
            }

            /* === 光标徽章 (普通/敌对/红名 — 绿底白字 + 左侧绿点) === */
            .sao-cursor-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 2px 8px 2px 7px;
                border-radius: 11px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 12px;            /* 用户要求: 12px */
                font-weight: 700;
                letter-spacing: 0.4px;
                text-transform: uppercase;
                white-space: nowrap;
                vertical-align: middle;
                line-height: 1;
            }
            .sao-cursor-dot {
                display: inline-block;
                width: 7px;
                height: 7px;
                background: currentColor;
                border-radius: 50%;
                flex-shrink: 0;
                box-shadow: 0 0 4px currentColor;
            }
            .sao-cursor-green  { color: #6ee7a3; background: rgba(0,168,107,0.18); border: 1px solid rgba(110,231,163,0.45); }
            .sao-cursor-orange { color: #ffa766; background: rgba(255,138,61,0.16); border: 1px solid rgba(255,167,102,0.42); }
            .sao-cursor-red    { color: #ff7d8a; background: rgba(255,46,74,0.18); border: 1px solid rgba(255,125,138,0.45); }

            /* === HP / MP 进度条 (6px 高) === */
            .sao-bar-row { margin: 0; padding: 0; line-height: 0; font-size: 0; }
            .sao-bar-row + .sao-bar-row { margin-top: 8px; } /* HP 与 MP 条之间留间隙 */
            .sao-bar-row:last-child { margin: 0; }
            .sao-bar-labels {
                display: flex;
                justify-content: space-between;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 11px;
                line-height: 1.2;
                margin: 0;
                padding: 0;
                color: var(--text-secondary);
                letter-spacing: 0.4px;
            }
            .sao-bar-container {
                height: 6px;
                margin: 3px 0 0 0;
                padding: 0;
                background: rgba(0,0,0,0.45);
                border-radius: 3px;
                overflow: hidden;
                box-shadow: inset 0 1px 1px rgba(0,0,0,0.5);
                position: relative;
                border: none;
                line-height: 0;
            }
            .sao-bar {
                height: 100%;
                border-radius: 4px;
                transition: width 0.5s cubic-bezier(0.22,0.61,0.36,1);
                position: relative;
                box-shadow: 0 0 6px currentColor;
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
                border-radius: 4px 4px 0 0;
            }
            .sao-bar-hp { background: linear-gradient(90deg, #e63956, #ff6b81); color: rgba(230,57,86,0.5); }
            .sao-bar-mp { background: linear-gradient(90deg, #0090c8, #4cd2ff); color: rgba(76,210,255,0.5); }
            .sao-bar-hp-low { animation: sao-pulse-red 1.1s ease-in-out infinite; }
            @keyframes sao-pulse-red {
                0%, 100% { filter: brightness(1); box-shadow: 0 0 0 rgba(255,46,74,0); }
                50% { filter: brightness(1.25); box-shadow: 0 0 10px rgba(255,46,74,0.55); }
            }

            /* === 属性卡片 (64px高, 数字 18px) === */
            .sao-stat-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
                margin-top: 16px;
            }
            .sao-stat-item {
                width: 100%;
                height: 64px;
                min-height: 64px;
                max-height: 64px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 3px;
                background: rgba(22,30,46,0.80);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                padding: 10px 8px;
                text-align: center;
                box-sizing: border-box;
                position: relative;
                overflow: hidden;
                transition: background 0.2s ease, border-color 0.2s ease;
            }
            .sao-stat-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--primary);
                opacity: 0.6;
            }
            .sao-stat-item::after {
                content: '';
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                width: 30%;
                height: 1px;
                background: var(--primary);
                opacity: 0.4;
            }
            .sao-stat-value {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 18px;
                line-height: 1;
                font-weight: 700;
                color: var(--primary);
                letter-spacing: 0;
            }
            .sao-stat-label {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.70em;
                color: var(--text-secondary);
                letter-spacing: 0.4px;
                line-height: 1;
                text-transform: uppercase;
                margin-top: 2px;
            }

            @media (max-width: 600px) {
                .sao-stat-grid { grid-template-columns: repeat(2, 1fr); }
                .sao-stat-item { height: 64px; min-height: 64px; max-height: 64px; }
                .sao-stat-value { font-size: 16px; }
            }

            /* === 世界状态行 (5 行紧凑, 32px 高) === */
            .sao-world-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                min-height: 32px;
                padding: 5px 0;
                border-bottom: 1px solid rgba(255,255,255,0.05);
                font-size: 0.92em;
            }
            .sao-world-row:last-child {
                border-bottom: none;
                padding-bottom: 0;
            }
            .sao-world-label {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.85em;
                letter-spacing: 0.3px;
                color: var(--text-secondary);
                flex-shrink: 0;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .sao-world-value {
                font-weight: 600;
                color: var(--text-primary);
                text-align: right;
                word-break: break-word;
                min-width: 0;
                font-size: 0.95em;
            }

            /* === 任务 section (独立一栏) === */
            .sao-status-section-standalone { margin: 0; }

            .sao-quest-card {
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-left: 2px solid var(--warning);
                border-radius: 6px;
                padding: 8px 10px;
                margin-bottom: 6px;
            }
            .sao-quest-card:last-of-type { margin-bottom: 4px; }
            .sao-quest-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                margin-bottom: 2px;
            }
            .sao-quest-header b {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-size: 0.95em;
                color: var(--text-primary);
            }
            .sao-quest-objectives {
                margin: 4px 0 0 0;
                padding-left: 18px;
                font-size: 0.85em;
                color: var(--text-secondary);
            }
            .sao-quest-objectives li { margin: 1px 0; }
            .sao-quest-add {
                margin-top: 6px;
                display: flex;
                gap: 5px;
                align-items: center;
            }
            .sao-quest-completed { margin-top: 6px; }

            /* === 任务列表项（新布局：标题+报酬+放弃按钮） === */
            .sao-quest-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                margin-bottom: 4px;
                background: rgba(22,30,46,0.6);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                transition: background 0.2s ease, border-color 0.2s ease;
            }
            .sao-quest-item:last-child { margin-bottom: 0; }
            .sao-quest-item:hover {
                background: rgba(30,40,58,0.75);
                border-color: var(--border-accent);
            }
            .sao-quest-item-main { flex: 1; min-width: 0; }
            .sao-quest-name { font-size: 0.88em; color: var(--text-primary); font-weight: 600; }
            .sao-quest-reward { font-size: 0.78em; color: var(--text-secondary); margin-top: 2px; }
            .sao-quest-abandon {
                background: none;
                border: none;
                color: var(--danger);
                cursor: pointer;
                font-size: 12px;
                padding: 2px 4px;
                opacity: 0.5;
                transition: opacity 0.2s;
                flex-shrink: 0;
            }
            .sao-quest-abandon:hover { opacity: 1; }
            .sao-quest-completed-btn {
                background: none;
                border: 1px solid var(--border-subtle);
                border-radius: 4px;
                padding: 2px 6px;
                cursor: pointer;
                font-size: 11px;
                opacity: 0.7;
                transition: opacity 0.2s, border-color 0.2s;
            }
            .sao-quest-completed-btn:hover { opacity: 1; border-color: var(--primary); }

            /* === 物品区: 4-tab + 胶囊标签 (照图3) === */
            .sao-inv-tabs {
                display: flex;
                gap: 0;
                margin-bottom: 10px;
                flex-wrap: wrap;
                border-bottom: 1px solid var(--border-subtle);
            }
            .sao-inv-tab {
                padding: 6px 12px;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                margin-bottom: -1px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                font-weight: 600;
                letter-spacing: 0.3px;
                transition: all 0.2s ease;
                opacity: 0.6;
                white-space: nowrap;
                border-radius: 0;
                color: var(--text-secondary);
                text-transform: uppercase;
                background: transparent;
            }
            .sao-inv-tab:hover {
                opacity: 0.95;
                color: var(--primary-bright);
                background: rgba(0,210,255,0.06);
            }
            .sao-inv-tab.active {
                opacity: 1;
                color: var(--primary);
                border-bottom-color: var(--primary);
                text-shadow: 0 0 8px rgba(0,210,255,0.35);
                background: rgba(0,210,255,0.08);
            }
            .sao-inv-tab-content { display: none; padding-top: 8px; }
            .sao-inv-tab-content[data-content="consumable"] { display: block; padding-top: 8px; } /* default active tab */

            /* 物品标签: 胶囊形 + 按 type 区分边框色 (消耗品 = 浅黄) */
            .sao-inv-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .sao-tag {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 5px 11px;
                border-radius: 14px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.82em;
                letter-spacing: 0.3px;
                line-height: 1.3;
                color: var(--text-primary);
                transition: all 0.2s ease;
            }
            /* 消耗品 - 浅黄边框 (照图3) */
            .sao-tag.sao-tag-consumable {
                background: rgba(255, 215, 80, 0.08);
                border: 1px solid rgba(255, 200, 60, 0.55);
            }
            .sao-tag.sao-tag-consumable:hover {
                background: rgba(255, 215, 80, 0.18);
                border-color: rgba(255, 200, 60, 0.85);
            }
            /* 任务物品 - 浅蓝边框 */
            .sao-tag.sao-tag-quest_item {
                background: rgba(0,210,255,0.08);
                border: 1px solid rgba(0,210,255,0.40);
                color: var(--primary-bright);
            }
            .sao-tag.sao-tag-quest_item:hover {
                background: rgba(0,210,255,0.18);
                border-color: rgba(0,210,255,0.70);
            }
            /* 材料 - 浅灰边框 */
            .sao-tag.sao-tag-material {
                background: rgba(160,170,190,0.10);
                border: 1px solid rgba(160,170,190,0.40);
            }
            .sao-tag.sao-tag-material:hover {
                background: rgba(160,170,190,0.20);
            }
            /* 装备 - 浅紫边框 (突出 vs consumable) */
            .sao-tag.sao-tag-equipment {
                background: rgba(168, 80, 220, 0.10);
                border: 1px solid rgba(168, 80, 220, 0.50);
                color: #d3a4ff;
            }
            .sao-tag.sao-tag-equipment:hover {
                background: rgba(168, 80, 220, 0.22);
                border-color: rgba(168, 80, 220, 0.80);
            }

            .sao-cor-row {
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.92em;
                color: var(--warning);
                margin-top: 12px;
            }
            .sao-cor-row b { color: var(--text-secondary); font-weight: 500; }

            /* === 装备紧凑列表 (替代 3x3 网格 — 用户要求格子不要太大) === */
            .sao-equip-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .sao-equip-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 5px 8px;
                background: rgba(22,30,46,0.55);
                border: 1px solid var(--border-subtle);
                border-radius: 5px;
                transition: background 0.2s ease, border-color 0.2s ease;
                min-height: 28px;
            }
            .sao-equip-row:hover {
                background: rgba(30,40,58,0.78);
                border-color: var(--border-accent);
            }
            .sao-equip-row-empty { opacity: 0.65; background: rgba(8,12,20,0.4); }
            .sao-equip-slot-label {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.72em;
                color: var(--text-secondary);
                letter-spacing: 0.4px;
                text-transform: uppercase;
                min-width: 36px;
                flex-shrink: 0;
            }
            .sao-equip-item {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-size: 0.92em;
                font-weight: 600;
                color: var(--text-primary);
                flex: 1;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .sao-equip-empty {
                color: var(--text-tertiary);
                font-style: italic;
                opacity: 0.75;
                font-size: 0.85em;
            }
            .sao-equip-stats {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.75em;
                color: var(--success);
                letter-spacing: 0.3px;
                white-space: nowrap;
            }
            .sao-equip-row .sao-equip-btn { flex-shrink: 0; }

            /* === 技能按钮网格 (照图3, 浅蓝边框+白粗体) === */
            .sao-skill-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 5px;
            }
            .sao-skill-btn {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                justify-content: center;
                gap: 1px;
                padding: 6px 10px;
                background: rgba(0,168,255,0.06);
                border: 1px solid rgba(0,210,255,0.40);
                border-radius: 6px;
                cursor: pointer;
                font-family: inherit;
                color: inherit;
                text-align: left;
                transition: all 0.2s ease;
                min-height: 36px;
            }
            .sao-skill-btn:hover {
                background: rgba(0,168,255,0.16);
                border-color: rgba(0,210,255,0.75);
                box-shadow: 0 0 8px rgba(0,210,255,0.30);
            }
            .sao-skill-btn-name {
                font-family: "Exo 2", "Noto Sans SC", sans-serif;
                font-size: 0.95em;
                font-weight: 700;
                color: var(--text-primary);
            }
            .sao-skill-btn-proficiency {
                font-family: "Rajdhani", "Noto Sans SC", sans-serif;
                font-size: 0.72em;
                color: var(--text-secondary);
                letter-spacing: 0.3px;
            }

            /* === 任务 / 操作按钮 (统一小型图标按钮) === */
            .sao-quest-btn {
                display: inline-flex;
                align-items: center;
                padding: 0 4px;
                font-size: 12px;
                color: var(--primary);
                background: transparent;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1;
                opacity: 0.6;
                transition: opacity 0.2s ease, color 0.2s ease;
            }
            .sao-quest-btn:hover { opacity: 1; color: var(--primary-bright); }
            .sao-quest-btn:active { opacity: 0.8; }

            .sao-equip-btn {
                display: inline-flex;
                align-items: center;
                padding: 0 4px;
                font-size: 12px;
                color: var(--primary);
                background: transparent;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                vertical-align: middle;
                line-height: 1;
                opacity: 0.6;
                transition: opacity 0.2s ease, color 0.2s ease;
            }
            .sao-equip-btn:hover { opacity: 1; color: var(--primary-bright); }
            .sao-equip-btn:active { opacity: 0.8; }

            /* === 任务输入框 === */
            input[data-sao-quest-input] {
                width: 60%;
                padding: 4px 8px;
                font-size: 12px;
                background: rgba(8,12,20,0.6);
                border: 1px solid rgba(0,210,255,0.3);
                border-radius: 4px;
                color: var(--text-primary);
                font-family: inherit;
                outline: none;
                transition: all 0.2s ease;
            }
            input[data-sao-quest-input]::placeholder { color: var(--text-tertiary); }
            input[data-sao-quest-input]:focus {
                border-color: var(--primary);
                box-shadow: 0 0 8px rgba(0,210,255,0.2);
                background: rgba(8,12,20,0.75);
            }

            .sao-text-secondary { color: var(--text-secondary) !important; }
            .sao-text-muted { color: var(--text-tertiary) !important; }
            .sao-empty {
                font-size: 0.88em;
                color: var(--text-tertiary);
                font-style: italic;
                padding: 6px 0;
            }
        </style>
        <div class="character-status-wrapper">
            <details class="details-character-status"${_wasOpen ? ' open' : ''}>
                <summary>角色状态栏</summary>
                <div class="sao-status-content">${safeContent}</div>
            </details>
        </div>
    `
    // C3/C4/C5.5: 附加交互事件监听
    _attachStatusPanelListeners(shadow);
}

// ============================================================
// 详情弹窗渲染辅助（_renderDetailInv 封装 getEquipmentById 部分应用）
// ============================================================

function _renderDetailInv(item) { return _renderInvShared(item, getEquipmentById); }

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
                (typeof toastr !== 'undefined' ? toastr.error('卸下装备失败：' + err.message, 'SAO Companion') : alert('卸下装备失败：' + err.message));
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
                (typeof toastr !== 'undefined' ? toastr.error('装备失败：' + err.message, 'SAO Companion') : alert('装备失败：' + err.message));
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
                    if (typeof toastr !== 'undefined') toastr.warning('使用失败：未知原因', 'SAO Companion');
                    return;
                }
                const isFail = results.some(r => /不在背包|未注册|已满|失败/.test(r));
                if (!isFail) _refreshStatusPanelContent(shadow);
                if (typeof toastr !== 'undefined') {
                    if (isFail) toastr.warning(results.join(', '), 'SAO Companion');
                    else toastr.success(results.join(', '), '使用成功');
                }
            } catch (err) {
                log(`使用消耗品失败: ${err.message}`, 'warn');
                if (typeof toastr !== 'undefined') toastr.error('使用失败: ' + err.message, 'SAO Companion');
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

    // 切换物品子页签
    shadow.querySelectorAll('[data-sao-action="switchInvTab"]').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetTab = tab.dataset.tab;
            // Toggle active class on tabs
            shadow.querySelectorAll('.sao-inv-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Show/hide tab contents
            shadow.querySelectorAll('.sao-inv-tab-content').forEach(c => {
                c.style.display = (c.dataset.content === targetTab) ? 'block' : 'none';
            });
        });
    });

    // 放弃任务
    shadow.querySelectorAll('[data-sao-action="abandon-quest"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const questId = btn.dataset.saoQuestId;
            try {
                abandonQuest(questId);
                _refreshStatusPanelContent(shadow);
            } catch (err) {
                log(`放弃任务失败: ${err.message}`, 'warn');
            }
        });
    });

    // 显示已完成任务弹窗
    shadow.querySelectorAll('[data-sao-action="show-completed-quests"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const completed = getCompletedQuests();
            const rows = completed.length
                ? completed.map(q => {
                    const reward = q.reward_hint || '-';
                    return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);gap:12px;">
                        <span style="opacity:0.85;font-size:0.85em;color:var(--text-secondary);flex:1;">${esc(q.title)}</span>
                        <span style="font-weight:700;color:var(--text-primary);text-align:right;font-size:0.85em;">${esc(reward)}</span>
                    </div>`;
                }).join('')
                : '<div style="font-size:0.88em;color:var(--text-tertiary);font-style:italic;padding:12px 0;text-align:center;">无已完成任务</div>';
            _showShadowModal(shadow, '已完成任务', `<div style="max-height:300px;overflow-y:auto;">${rows}</div>`);
        });
    });

    // D4: 装备/技能/物品详情弹窗（点击 data-detail-type 元素触发）
    // 使用标记防止重复绑定（refresh 会多次调用 _attachStatusPanelListeners）
    if (!shadow._saoDetailDelegated) {
    shadow._saoDetailDelegated = true;
    shadow.addEventListener('click', (e) => {
        const target = e.target.closest('[data-detail-type]');
        if (!target) return;
        const type = target.getAttribute('data-detail-type');
        const index = parseInt(target.getAttribute('data-detail-index'), 10);
        if (isNaN(index)) return;
        let title = '';
        let html = '';
        try {
            if (type === 'equip') {
                const equipData = renderEquipmentPanel();
                const entry = equipData?.[index];
                if (entry?.equipId) {
                    const item = getEquipmentById(entry.equipId);
                    if (item) {
                        title = `${entry.slotDisplay || ''}: ${item.name || '未知'}`;
                        html = _renderEquipShared(item);
                    }
                }
            } else if (type === 'skill') {
                const player = getPlayerStore();
                const ps = player?.skills?.[index];
                if (ps) {
                    const def = getSkillById(ps.skill_id);
                    title = `${def?.name || ps.name || '技能'}${ps.proficiency != null ? ' Lv' + ps.proficiency : ''}`;
                    html = _renderSkillShared({ ...(def || {}), proficiency: ps.proficiency, name: def?.name || ps.name });
                }
            } else if (type === 'inv') {
                const inv = getInventoryStore();
                const item = inv?.items?.[index];
                if (item) {
                    title = item.name || '物品';
                    html = _renderDetailInv(item);
                }
            }
        } catch (err) {
            log(`详情解析失败: ${err.message}`, 'warn');
        }
        if (title && html) {
            _showShadowModal(shadow, title, `<div style="max-height:60vh;overflow-y:auto;">${html}</div>`);
            // Attach forget-skill handler to the modal
            const modalOverlay = shadow.querySelector('.sao-shadow-modal');
            if (modalOverlay) {
                const forgetBtn = modalOverlay.querySelector('[data-sao-action="forget-skill"]');
                if (forgetBtn) {
                    forgetBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const skillId = forgetBtn.dataset.saoSkillId;
                        if (!skillId) return;
                        if (!confirm('确定遗忘此剑技？此操作不可撤销。')) return;
                        try {
                            await forgetPlayerSkill(skillId);
                            modalOverlay.remove();
                            _refreshStatusPanelContent(shadow);
                        } catch (err) {
                            log(`遗忘技能失败: ${err.message}`, 'warn');
                        }
                    });
                }
            }
        }
    });
    }
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
            // 外壳 details 是唯一需要保留 open 状态的折叠节点；
            // 内部 8 个分区已改为直接展示（无 <details>），不再需要恢复开合。
            const outerDetails = shadow.querySelector('.details-character-status');
            const outerWasOpen = outerDetails ? outerDetails.open : false;

            const safeContent = sanitizeInlineSaoHtml(newHtml.trim())
                .replace(/^[ \t]+/gm, '')
                .replace(/[ \t]+$/gm, '')
                .replace(/\n{3,}/g, '\n\n')
                .replace(/<\/summary>\s*\n+/g, '</summary>')
                .replace(/\s+<\/details>/g, '</details>');
            contentDiv.innerHTML = safeContent;

            // 恢复外壳折叠状态
            const newOuter = shadow.querySelector('.details-character-status');
            if (newOuter) newOuter.open = outerWasOpen;

            _attachStatusPanelListeners(shadow);
        }
    } catch (e) {
        log(`刷新状态面板失败: ${e.message}`, 'warn');
    }
}

/**
 * BUG #5: 刷新最新聊天消息的状态面板（供插件侧边栏调用）。
 * 查找 DOM 中最后一个 user_status Shadow DOM host，重新投影内容。
 */
export function refreshLatestChatStatusPanel() {
    try {
        const hosts = document.querySelectorAll('.sao-render-host[data-sao-tag="user_status"]');
        if (hosts.length === 0) return;
        const lastHost = hosts[hosts.length - 1];
        if (lastHost?.shadowRoot) {
            _refreshStatusPanelContent(lastHost.shadowRoot);
        }
    } catch (e) {
        log(`refreshLatestChatStatusPanel 失败: ${e.message}`, 'warn');
    }
}

/**
 * 在 Shadow DOM 内弹出临时模态框（已完成任务列表等）。
 * 点击 overlay 背景或关闭按钮关闭。
 * @param {ShadowRoot} shadow
 * @param {string} title
 * @param {string} html
 */
function _showShadowModal(shadow, title, html) {
    // 移除旧弹窗
    const old = shadow.querySelector('.sao-shadow-modal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'sao-shadow-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,20,0.75);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;box-sizing:border-box;backdrop-filter:blur(8px);';
    overlay.innerHTML = `
        <style>
            .sao-detail-row{display:flex!important;justify-content:space-between!important;padding:7px 0!important;border-bottom:1px solid rgba(255,255,255,0.05)!important;gap:12px!important;}
            .sao-detail-label{opacity:0.7!important;font-size:0.85em!important;color:#9fb0cc!important;font-family:"Rajdhani","Noto Sans SC",sans-serif!important;}
            .sao-detail-value{font-weight:700!important;color:#eaf2ff!important;text-align:right!important;}
            .sao-rarity-common{color:#9fb0cc!important;}
            .sao-rarity-uncommon{color:#4ade80!important;}
            .sao-rarity-rare{color:#60a5fa!important;}
            .sao-rarity-epic{color:#c084fc!important;}
            .sao-rarity-legendary{color:#fbbf24!important;text-shadow:0 0 10px rgba(255,184,0,0.35)!important;}
            .sao-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.78em;background:rgba(0,210,255,0.1);border:1px solid rgba(0,210,255,0.2);color:#66e8ff;margin:2px;}
            .sao-tag-affix{background:rgba(168,85,247,0.1);border-color:rgba(168,85,247,0.3);color:#c084fc;}
        </style>
        <div style="position:relative;max-width:520px;width:90%;max-height:78vh;overflow-y:auto;background:rgba(20,28,44,0.72);border:1px solid rgba(0,210,255,0.35);border-radius:14px;box-shadow:0 0 18px rgba(0,210,255,0.25),0 8px 32px rgba(0,0,0,0.45);color:#eaf2ff;font-family:'Exo 2','Noto Sans SC',sans-serif;animation:sao-scale-in 0.25s ease-out;backdrop-filter:blur(16px) saturate(120%);">
            <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 0%,#00d2ff 20%,#66e8ff 50%,#00d2ff 80%,transparent 100%);pointer-events:none;border-radius:14px 14px 0 0;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(8,12,20,0.4);position:relative;">
                <span style="font-family:'Rajdhani','Noto Sans SC',sans-serif;font-weight:700;font-size:1.1em;color:#00d2ff;letter-spacing:0.5px;">${esc(title)}</span>
                <button class="sao-shadow-modal-close" style="background:transparent;border:1px solid rgba(255,255,255,0.08);color:#9fb0cc;font-size:1.5em;line-height:1;cursor:pointer;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;">&times;</button>
            </div>
            <div style="padding:18px 22px;">${html}</div>
        </div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('.sao-shadow-modal-close')) {
            overlay.remove();
        }
    });

    shadow.appendChild(overlay);
}

function renderNpcStatus(messageEl, rawText, messageId, refNode) {
    let itemsHtml = '';
    // 1. 优先从 npcStore projection — 结构化数据，渲染为每 NPC 一张 sub-card
    try {
        const npcData = renderNpcPanel();
        if (npcData && npcData.length > 0) {
            itemsHtml = npcData.map(npc => _buildNpcCard(npc)).join('');
        }
    } catch (e) { /* ignore */ }
    // 2. 回退：从 <npc_status> 标签提取 — 旧 AI 输出格式，包在统一卡片外壳中保留视觉一致
    if (!itemsHtml) {
        const raw = extractTag(rawText, 'npc_status');
        if (raw === null) return;
        const safeContent = sanitizeInlineSaoHtml(raw.trim());
        if (!safeContent) return;
        itemsHtml = `<div class="sao-notify-item">
            <div class="sao-notify-head">
                <span class="sao-notify-head-name">👥 NPC 状态</span>
            </div>
            <div class="sao-notify-rows">${safeContent}</div>
        </div>`;
    }
    const { shadow } = createSaoShadowHost(messageEl, 'npc_status', refNode);
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            ${SAO_NOTIFY_ROW_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details">
                <summary>👥 NPC状态</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `;
}

// ============================================================
// 新装备/新剑技通知面板 — row-based 渲染（与 sao-detail-popup.js 一致）
// 数据源：equipmentStore.byId / playerStore.skills（结构化数据）
// 直接复用 _renderEquipShared / _renderSkillShared 模板，避免布局漂移。
// 模块级 Set 跟踪已展示 ID，避免同一会话内重复弹出。
// ============================================================
const _shownNotificationEquipmentIds = new Set();
const _shownNotificationSkillIds = new Set();

/** 清空已展示通知 ID 集合（CHAT_CHANGED 时调用，确保重新进入聊天时重新渲染通知面板） */
export function clearShownNotificationIds() {
    _shownNotificationEquipmentIds.clear();
    _shownNotificationSkillIds.clear();
}

/** 通知面板共享 CSS — row 样式 + 每条目卡片 + 头/底布局（与 sao-detail-popup.js + panel.html 同一设计语言） */
const SAO_NOTIFY_ROW_CSS = `
            /* === 共享 row 样式（与 sao-detail-popup.js 的 modal 行一致，供 _renderEquipShared/_renderSkillShared 输出使用） === */
            .sao-detail-row{display:flex!important;justify-content:space-between!important;padding:6px 0!important;border-bottom:1px solid rgba(255,255,255,0.05)!important;gap:12px!important;align-items:baseline;}
            .sao-detail-label{opacity:0.72!important;font-size:0.85em!important;color:#9fb0cc!important;font-family:"Rajdhani","Noto Sans SC",sans-serif!important;text-transform:uppercase;letter-spacing:0.4px;}
            .sao-detail-value{font-weight:700!important;color:#eaf2ff!important;text-align:right!important;}

            /* === 稀有度颜色（与 panel.html token 对齐，保证与侧栏 modal 同色） === */
            .sao-rarity-common{color:#9ca3af!important;}
            .sao-rarity-uncommon{color:#00d68a!important;}
            .sao-rarity-rare{color:#00d2ff!important;}
            .sao-rarity-epic{color:#a855f7!important;}
            .sao-rarity-legendary{color:#ffb800!important;text-shadow:0 0 10px rgba(255,184,0,0.35)!important;}

            /* === 词条 / 附魔 chip === */
            .sao-tag{display:inline-block!important;padding:2px 9px!important;border-radius:4px!important;font-size:0.78em!important;background:rgba(0,210,255,0.10)!important;border:1px solid rgba(0,210,255,0.22)!important;color:#66e8ff!important;margin:2px 2px 2px 0!important;font-family:"Rajdhani","Noto Sans SC",sans-serif!important;letter-spacing:0.3px;line-height:1.4!important;}
            .sao-tag-affix{background:rgba(168,85,247,0.10)!important;border-color:rgba(168,85,247,0.30)!important;color:#c084fc!important;}

            /* === 通知 summary 右上角小计数 chip === */
            .sao-summary-count{
                margin-left:auto;
                padding:1px 8px;
                border-radius:10px;
                font-family:"Orbitron","Noto Sans SC",sans-serif;
                font-size:0.72em;
                font-weight:700;
                letter-spacing:0.6px;
                background:rgba(0,210,255,0.12);
                border:1px solid rgba(0,210,255,0.30);
                color:var(--primary-bright);
                text-transform:uppercase;
                line-height:1.4;
                opacity:0.85;
            }

            /* === 每条目卡片 (sao-notify-item) — 装备/剑技/NPC 通用 === */
            .sao-notify-item{
                margin:0 0 12px 0;
                padding:10px 12px 11px 12px;
                background:linear-gradient(180deg, rgba(22,30,46,0.65) 0%, rgba(15,21,34,0.55) 100%);
                border:1px solid rgba(0,210,255,0.22);
                border-left:3px solid var(--primary);
                border-radius:7px;
                position:relative;
                overflow:hidden;
                box-shadow:0 2px 6px rgba(0,0,0,0.30);
                transition:border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
            }
            .sao-notify-item:hover{
                border-color:var(--border-accent);
                box-shadow:0 4px 14px rgba(0,210,255,0.15);
            }
            .sao-notify-item::before{
                content:"";
                position:absolute;
                top:0;left:0;right:0;
                height:1px;
                background:linear-gradient(90deg, var(--primary) 0%, transparent 65%);
                opacity:0.55;
                pointer-events:none;
            }
            .sao-notify-item:last-child{margin-bottom:0;}

            /* === 头部条: 左 name (Rajdhani 700) + 右 meta pills === */
            .sao-notify-head{
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
                flex-wrap:wrap;
                margin:0 0 8px 0;
                padding:0 0 7px 0;
                border-bottom:1px solid rgba(0,210,255,0.18);
            }
            .sao-notify-head-name{
                font-family:"Rajdhani","Noto Sans SC",sans-serif;
                font-size:1.10em;
                font-weight:700;
                color:var(--text-primary);
                letter-spacing:0.5px;
                text-shadow:0 0 8px rgba(0,210,255,0.18)!important;
                line-height:1.2;
            }
            .sao-notify-head-badges{
                display:flex;
                align-items:center;
                gap:5px;
                flex-wrap:wrap;
            }

            /* === 通用 pill (右上 meta) === */
            .sao-pill{
                display:inline-flex;
                align-items:center;
                padding:2px 9px;
                border-radius:12px;
                background:rgba(255,255,255,0.05);
                border:1px solid rgba(255,255,255,0.12);
                color:var(--text-secondary);
                font-family:"Rajdhani","Noto Sans SC",sans-serif;
                font-size:0.74em;
                font-weight:600;
                letter-spacing:0.5px;
                text-transform:uppercase;
                line-height:1.35;
                white-space:nowrap;
            }
            /* pill: 稀有度色（背景 + 边框 与 sao-rarity-X 文本色对齐） */
            .sao-pill.sao-pill-rarity.sao-rarity-common      {background:rgba(156,163,175,0.10)!important;border-color:rgba(156,163,175,0.32)!important;}
            .sao-pill.sao-pill-rarity.sao-rarity-uncommon    {background:rgba(0,214,138,0.10)!important;border-color:rgba(0,214,138,0.32)!important;}
            .sao-pill.sao-pill-rarity.sao-rarity-rare        {background:rgba(0,210,255,0.10)!important;border-color:rgba(0,210,255,0.36)!important;}
            .sao-pill.sao-pill-rarity.sao-rarity-epic        {background:rgba(168,85,247,0.10)!important;border-color:rgba(168,85,247,0.36)!important;}
            .sao-pill.sao-pill-rarity.sao-rarity-legendary   {background:rgba(255,184,0,0.14)!important;border-color:rgba(255,184,0,0.42)!important;}
            /* pill: NPC 关系 (暖色) */
            .sao-pill.sao-pill-relationship   {background:rgba(255,138,61,0.10)!important;border-color:rgba(255,138,61,0.34)!important;color:#ff9b66!important;}
            /* pill: NPC 好感度 (绿色 + Orbitron 字体) */
            .sao-pill.sao-pill-affinity       {background:rgba(0,214,138,0.10)!important;border-color:rgba(0,214,138,0.32)!important;color:#00d68a!important;font-family:"Orbitron","Noto Sans SC",sans-serif!important;letter-spacing:0.6px;}
            /* pill: 楼层 (cyan) */
            .sao-pill.sao-pill-floor          {background:rgba(0,210,255,0.10)!important;border-color:rgba(0,210,255,0.32)!important;color:var(--primary-bright)!important;font-family:"Orbitron","Noto Sans SC",sans-serif!important;letter-spacing:0.6px;}

            /* === 行容器（包装 _renderEquipShared/_renderSkillShared 输出的 row 序列） === */
            .sao-notify-rows{
                display:flex;
                flex-direction:column;
                font-size:0.92em;
            }

            /* === 描述/观察行: 玻璃卡块 (italic, ▎ 装饰、与 stat rows 视觉隔离) === */
            .sao-notify-desc{
                margin:8px 0 0 0;
                padding:8px 10px 8px 12px;
                background:rgba(8,12,20,0.55);
                border:1px solid rgba(0,210,255,0.10);
                border-left:2px solid rgba(0,210,255,0.32);
                border-radius:4px;
                color:var(--text-secondary);
                font-size:0.88em;
                line-height:1.55;
                font-style:italic;
                position:relative;
                word-break:break-word;
            }
            .sao-notify-desc::before{
                content:"▎";
                position:absolute;
                top:7px;
                left:4px;
                color:var(--primary-bright);
                font-style:normal;
                opacity:0.7;
                font-size:0.9em;
            }
            .sao-notify-desc > strong{
                font-style:normal;
                font-weight:600;
                color:var(--primary-bright);
                opacity:0.7;
                font-family:"Rajdhani","Noto Sans SC",sans-serif;
                font-size:0.85em;
                letter-spacing:0.5px;
                text-transform:uppercase;
                margin-right:6px;
            }
`;

/**
 * 收集本会话内尚未在通知面板中展示过的装备条目（结构化 fallback 路径）。
 * @returns {object[]}
 */
function _collectNewEquipmentEntries() {
    let store;
    try { store = getEquipmentStore(); } catch { return []; }
    if (!store?.byId) return [];
    const newEntries = [];
    for (const [id, entry] of Object.entries(store.byId)) {
        if (!entry || _shownNotificationEquipmentIds.has(id)) continue;
        // 附加 equipment_id 字段符合 _renderEquipShared 的预期（不影响输出）
        newEntries.push({ ...entry, equipment_id: id });
        _shownNotificationEquipmentIds.add(id);
    }
    return newEntries;
}

/**
 * 收集本会话内尚未在通知面板中展示过的剑技条目。
 * 与 sao-render.js 详情弹窗（行 1786-1791）相同模式：从 playerStore.skills 取 proficiency，
 * 与 skillStore.byId[skill_id].def 合并。注意：剥离 skill_id 以阻止 _renderSkillShared
 * 渲染"遗忘此剑技"按钮（通知面板上下文未绑定 forget handler，避免点击无响应）。
 * @returns {object[]}
 */
function _collectNewSkillEntries() {
    let store, player;
    try { store = getSkillStore(); } catch { return []; }
    try { player = getPlayerStore(); } catch { player = null; }
    if (!store?.byId || !Array.isArray(player?.skills)) return [];
    const newEntries = [];
    for (const s of player.skills) {
        const id = s?.skill_id;
        if (!id || _shownNotificationSkillIds.has(id)) continue;
        const def = store.byId[id];
        if (!def) continue;
        // 故意剥离 skill_id：suppress _renderSkillShared 中的"遗忘此剑技"按钮
        const merged = { ...def, proficiency: s.proficiency ?? 0, name: def.name || s.name };
        delete merged.skill_id;
        newEntries.push(merged);
        _shownNotificationSkillIds.add(id);
    }
    return newEntries;
}

/**
 * 装备通知条目卡（结构化投影 fallback 专用） — 与 sao-detail-popup 的 row 结构同语言，但有清晰 sub-card 视觉层次。
 * 调用策略：
 *   - headers: 显示 name + 槽位 + 类型 + 稀有度 pill（在头部条）
 *   - 共享行渲染：剥离已显示字段 + 描述（描述改在玻璃卡块），复用 _renderEquipShared 输出 stat/affix 行
 *   - 描述：以 ▎ 玻璃卡块呈现，独立于 stat rows
 */
function _buildEquipmentCard(eq) {
    const name = eq.name || eq.equipment_id || '未命名装备';
    const rCls = rarityClass(eq.rarity);
    // 英文稀有度 → 中文显示
    const RARITY_EN_TO_CN = { common: '白色', uncommon: '绿色', rare: '蓝色', epic: '紫色', legendary: '金色' };
    const rarityCn = RARITY_EN_TO_CN[eq.rarity] || eq.rarity || '';
    // slot 枚举 → 中文槽位名
    const SLOT_EN_TO_CN = { weapon: '主手', off_hand: '副手', head: '头部', chest: '胸部', hands: '手部', legs: '腿部', accessory: '饰品' };
    const slotCn = SLOT_EN_TO_CN[eq.slot] || eq.slot || '';
    // 优先显示 weapon_type（中文武器类型），无则显示中文槽位
    const typeLabel = eq.weapon_type || slotCn;
    const head = `<div class="sao-notify-head">
            <span class="sao-notify-head-name">⚔️ ${esc(name)}</span>
            <span class="sao-notify-head-badges">
                ${typeLabel ? `<span class="sao-pill">${esc(typeLabel)}</span>` : ''}
                ${eq.rarity ? `<span class="sao-pill sao-pill-rarity ${rCls}">${esc(rarityCn)}</span>` : ''}
            </span>
        </div>`;
    // 剥离：名称 + 槽位 + 类型 + 稀有度（已被 header pill 显示）+ 描述（改走玻璃卡块）
    const stripped = { ...eq, name: null, type: null, weapon_type: null, rarity: null, description: null };
    const rowsHtml = _renderEquipShared(stripped);
    const rowsBlock = rowsHtml ? `<div class="sao-notify-rows">${rowsHtml}</div>` : '';
    const descBlock = eq.description ? `<div class="sao-notify-desc">${esc(eq.description)}</div>` : '';
    return `<div class="sao-notify-item">${head}${rowsBlock}${descBlock}</div>`;
}

/**
 * 剑技通知条目卡（结构化投影 fallback 专用） — 同 _buildEquipmentCard，但适用于剑技字段集合。
 * header pill 显示: 武器类型 + 技能等级 (LvX) + 稀有度。
 * 共享行渲染保留: combat.{atk,hit,crit,apt,tpa,mpCost,cd} + effects.wn + effects.en（词条 tags）。
 */
function _buildSkillCard(sk) {
    const name = sk.name || '(未命名剑技)';
    const rCls = rarityClass(sk.rarity);
    const head = `<div class="sao-notify-head">
            <span class="sao-notify-head-name">✨ ${esc(name)}</span>
            <span class="sao-notify-head-badges">
                ${sk.weapon_type ? `<span class="sao-pill">${esc(sk.weapon_type)}</span>` : ''}
                ${sk.proficiency != null ? `<span class="sao-pill">Lv ${esc(sk.proficiency)}</span>` : ''}
                ${sk.rarity ? `<span class="sao-pill sao-pill-rarity ${rCls}">${esc(sk.rarity)}</span>` : ''}
            </span>
        </div>`;
    // 剥离：武器类型 + 技能等级 + 稀有度（已在 header pill 中）+ 描述（改走玻璃卡块）
    const stripped = { ...sk, weapon_type: null, proficiency: null, rarity: null, description: null };
    const rowsHtml = _renderSkillShared(stripped, null);
    const rowsBlock = rowsHtml ? `<div class="sao-notify-rows">${rowsHtml}</div>` : '';
    const descBlock = sk.description ? `<div class="sao-notify-desc">${esc(sk.description)}</div>` : '';
    return `<div class="sao-notify-item">${head}${rowsBlock}${descBlock}</div>`;
}

/**
 * NPC 状态卡 — header 显示 NPC 名字 + 关系 + 好感度 (Orbitron 数字) + 楼层 (Orbitron 数字)，
 * 之后以 sao-detail-row 结构展示位置 / 独特技能 / 状态 (tags) / 最后目击日期，
 * 观察以 ▎ 玻璃卡块呈现。
 */
function _buildNpcCard(npc) {
    const name = npc.name || '无姓名';
    const head = `<div class="sao-notify-head">
            <span class="sao-notify-head-name">👤 ${esc(name)}</span>
            <span class="sao-notify-head-badges">
                ${npc.relationship ? `<span class="sao-pill sao-pill-relationship">${esc(npc.relationship)}</span>` : ''}
                ${npc.affinity ? `<span class="sao-pill sao-pill-affinity">❤ ${esc(npc.affinity)}</span>` : ''}
                ${npc.floor_id != null ? `<span class="sao-pill sao-pill-floor">F${esc(npc.floor_id)}</span>` : ''}
            </span>
        </div>`;
    const rows = [];
    if (npc.location) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">位置</span><span class="sao-detail-value">${esc(npc.location)}</span></div>`);
    if (npc.uniqueSkill?.name) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">独特技能</span><span class="sao-detail-value">${esc(npc.uniqueSkill.name)}</span></div>`);
    if (npc.status && npc.status.length) {
        const tags = npc.status.map(s => `<span class="sao-tag">${esc(s)}</span>`).join(' ');
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">状态</span><span class="sao-detail-value" style="text-align:right;display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${tags}</span></div>`);
    }
    if (npc.last_seen_date) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">最后目击</span><span class="sao-detail-value">${esc(npc.last_seen_date)}</span></div>`);
    const rowsBlock = rows.length ? `<div class="sao-notify-rows">${rows.join('')}</div>` : '';
    const obs = npc.observations && npc.observations.length
        ? npc.observations.slice(-3).map(o => esc(o)).join(' · ')
        : '';
    const obsBlock = obs ? `<div class="sao-notify-desc"><strong>观察</strong>${obs}</div>` : '';
    return `<div class="sao-notify-item">${head}${rowsBlock}${obsBlock}</div>`;
}

function renderEquipment(messageEl, rawText, messageId, refNode) {
    // 从 equipmentStore 投影渲染（新架构：<gain_equipment> 是创建标签，非显示标签）
    const newEntries = _collectNewEquipmentEntries();
    if (newEntries.length === 0) return;
    const itemsHtml = newEntries.map(eq => _buildEquipmentCard(eq)).join('');
    const { shadow } = createSaoShadowHost(messageEl, 'gain_equipment', refNode)
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            ${SAO_NOTIFY_ROW_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details">
                <summary>🎒 新装备</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

function renderSwordSkill(messageEl, rawText, messageId, refNode) {
    // 从 skillStore 投影渲染（新架构：<gain_skill> 是创建标签，非显示标签）
    const newEntries = _collectNewSkillEntries();
    if (newEntries.length === 0) return;
    const itemsHtml = newEntries.map(sk => _buildSkillCard(sk)).join('');
    const { shadow } = createSaoShadowHost(messageEl, 'gain_skill', refNode)
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            ${SAO_NOTIFY_ROW_CSS}
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details">
                <summary>✨ 新剑技</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

