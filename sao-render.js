// SAO Companion - 渲染模块（Shadow DOM 渲染 + 标签提取 + DOMPurify 钩子）
// 从 index.js 拆分而来

import { esc, log, getSaoData } from './sao-core.js';
import { DOMPurify } from '../../../../lib.js';
import { renderBattlePanel } from './battle/battleRenderer.js';
import { restoreBattleState } from './battle/battleLogic.js';

// SAO 自定义标签列表 — DOMPurify 钩子会保留这些标签作为 DOM 元素
const SAO_CUSTOM_TAGS = ['calendar', 'user_status', 'equip', 'swordskill', 'map', 'zd_status', 'digest'];

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
 * 根据 year/month/current_day/days 生成原卡日历网格 HTML。
 * 使用原卡 class 名：day, day empty, day current-day, day-number, day-content, normal-text。
 * Weekday 顺序：周一到周日。
 */
function buildCalendarGrid(year, month, currentDay, days) {
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
    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells += '<div class="day empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const isCurrent = day === cd;
        const cls = isCurrent ? 'day current-day' : 'day';
        const numHtml = '<div class="day-number">' + day + '</div>';
        const events = dayContentMap[day];
        let contentHtml = '';
        if (events && events.length) {
            contentHtml = '<div class="day-content">' +
                events.filter(t => t && t.length <= 100).map(t => '<div class="normal-text">' + esc(t) + '</div>').join('') +
                '</div>';
        }
        cells += '<div class="' + cls + '">' + numHtml + contentHtml + '</div>';
    }
    return cells;
}
/**
 * 解析旧正则常见的 key: value 日历文本，例如：
 * year: 2022\nmonth: 11\ncurrent_day: 6\ndays: ...
 */
function parseCalendarKeyValueText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const data = {};
    let currentKey = null;
    let matched = 0;
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$/);
        if (m) {
            currentKey = m[1].toLowerCase();
            data[currentKey] = m[2].trim();
            matched += 1;
        } else if (currentKey && line.trim()) {
            data[currentKey] += `${data[currentKey] ? '\n' : ''}${line.trim()}`;
        }
    }
    if (!matched || !(data.year || data.month || data.current_day || data.days)) return null;

    data.text = text.trim();

    if (data.days && typeof data.days === 'string') {
        data.day_events = data.days;
        const parsedDays = [];
        let current = null;
        for (const rawLine of data.days.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const dayM = line.match(/^(?:day\s*)?(\d{1,2})\s*[:：\-]\s*(.*)$/i);
            if (dayM) {
                current = { day: Number(dayM[1]), events: [] };
                if (dayM[2].trim()) current.events.push(dayM[2].trim());
                parsedDays.push(current);
            } else if (current) {
                current.events.push(line.replace(/^[-*•]\s*/, ''));
            }
        }
        if (parsedDays.length) {
            data.days = parsedDays.map(day => {
                const firstEvent = day.events.find(Boolean) || '';
                return {
                    day: day.day,
                    label: firstEvent.slice(0, 18),
                    events: day.events,
                };
            });
        }
    }
    return data;
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
    const tagsToHide = ['calendar', 'user_status', 'equip', 'swordskill', 'map', 'zd_status', 'digest'];
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
    styleEl.textContent = `
        .sao-tags-rendered calendar, .sao-tags-rendered user_status, .sao-tags-rendered equip,
        .sao-tags-rendered swordskill, .sao-tags-rendered map, .sao-tags-rendered zd_status,
        .sao-tags-rendered digest,
        .sao-tags-rendered calendar *, .sao-tags-rendered user_status *, .sao-tags-rendered equip *,
        .sao-tags-rendered swordskill *, .sao-tags-rendered map *, .sao-tags-rendered zd_status *,
        .sao-tags-rendered digest * {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
        }
    `;
    target.prepend(styleEl);
}

/**
 * 创建 Shadow DOM 容器
 */
function createSaoShadowHost(messageEl, tagName, refNode) {
    // 避免重复注入
    const existing = messageEl.querySelector(`.sao-render-host[data-sao-tag="${tagName}"]`);
    if (existing) return existing.shadowRoot;
    const host = document.createElement('div');
    host.className = 'sao-render-host';
    host.dataset.saoTag = tagName;
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const shadow = host.attachShadow({ mode: 'open' });

    if (refNode && refNode.parentNode) {
        refNode.parentNode.insertBefore(host, refNode);
        // 如果 host 被插入到 <p> 内部（Showdown 会把自定义标签包在 <p> 里），
        // 将 host 提升到 <p> 之后，避免 cleanup 删除空 <p> 时误删 host
        // 放在 <p> 之后（而非之前）以保持标签在文本流中的原始位置
        if (host.parentNode && host.parentNode.nodeName === 'P') {
            const p = host.parentNode;
            if (p.parentNode) {
                p.parentNode.insertBefore(host, p.nextSibling);
            }
        }
    } else if (mesText) {
        mesText.appendChild(host);
    } else {
        messageEl.appendChild(host);
    }
    return shadow;
}

/**
 * 解析日历标签内容（优先 JSON，失败则作文本）
 */
function parseCalendarContent(rawContent) {
    if (!rawContent) return { text: '' };
    const trimmed = rawContent.trim();
    if (!trimmed) return { text: '' };
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // 非 JSON，按普通文本处理
        }
    }
    const kvData = parseCalendarKeyValueText(trimmed);
    if (kvData) return kvData;
    return { text: trimmed };
}

/**
 * 在消息 Shadow DOM 中渲染 <calendar> 标签
 * 只读：不修改 msg.mes，仅操作已渲染的 DOM
 */
function renderCalendar(messageEl, rawText) {
    const calendarContent = extractTag(rawText, 'calendar');
    if (calendarContent === null) return;

    const data = parseCalendarContent(calendarContent);
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('calendar');
    const shadow = createSaoShadowHost(messageEl, 'calendar', refNode);

    const year = Number(data.year) || 0;
    const month = Number(data.month) || 0;
    const currentDay = Number(data.current_day) || 0;

    const summaryText = (year && month)
        ? year + '\u5e74 ' + month + '\u6708 \u65e5\u5386'
        : (data.text || data.date || '\u65e5\u5386');
    const calendarTitle = (year && month) ? month + '\u6708' : '';
    const calendarInfo = year ? '\u5e74\u4efd ' + year : '';
    const gridCells = (year && month)
        ? buildCalendarGrid(year, month, currentDay, data.days)
        : '';
    const weekdays = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
        .map(d => '<div class="weekday">' + d + '</div>').join('');

    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            /* 移动优先设计 */
                  * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                  }
            
                  /* 主容器样式 - 米色风格 */
                  .calendar-wrapper {
                    background-color: #f8f4ed;
                    border: 1px solid #8c785d;
                    border-radius: 6px;
                    width: 100%;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 2px;
                    font-family: 'Microsoft YaHei', sans-serif;
                    color: #5c4d3a;
                    overflow: hidden; /* 防止内容溢出 */
                  }
            
                  /* 日历折叠按钮容器 */
                  .details-calendar-button {
                    border: none;
                    margin: 0;
                    padding: 0;
                    color: #5c4d3a;
                    width: 100%;
                  }
            
                  /* 折叠按钮基础样式 */
                  .details-calendar-button > summary {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    cursor: pointer;
                    font-weight: bold;
                    list-style: none;
                    outline: none;
                    transition: all 0.1s ease-in-out;
                    position: relative;
                  }
            
                  /* 移除默认标记 */
                  .details-calendar-button > summary::-webkit-details-marker,
                  .details-calendar-button > summary::marker {
                    display: none;
                    content: '';
                  }
            
                  /* 图标样式 */
                  .details-calendar-button > summary::before {
                    content: '📅';
                    display: inline-block;
                    margin-right: 6px;
                  }
            
                  /* 关闭时状态 */
                  .details-calendar-button:not([open]) > summary {
                    padding: 4px 8px;
                    font-size: 16px;
                    margin-top: -5px;
                    background-color: #f0d9b5;
                    border-radius: 5px;
                    border: 1px solid #8c785d;
                  }
            
                  /* 鼠标悬停效果 */
                  .details-calendar-button:not([open]) > summary:hover {
                    background-color: #e6ccaa;
                  }
            
                  /* 打开时状态 */
                  .details-calendar-button[open] > summary {
                    padding: 8px 8px;
                    font-size: 16px;
                    margin-top: -5px;
                    margin-bottom: 5px;
                    border: 1px solid #8c785d;
                    border-radius: 5px;
                    background-color: #d9bda0;
                  }
            
                  /* 日历内容区域 */
                  .calendar-content {
                    padding: 8px;
                    background-color: #ede4d3;
                    border-radius: 5px;
                    border: 1px solid #bfae98;
                    overflow-x: auto; /* 允许在小屏幕上滚动 */
                  }
            
                  /* 日历标题区域 */
                  .calendar-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                    padding-bottom: 4px;
                    border-bottom: 1px solid #bfae98;
                  }
            
                  .calendar-title {
                    font-size: 16px;
                    font-weight: bold;
                    color: #5c4d3a;
                  }
            
                  .calendar-info {
                    font-size: 14px;
                    color: #5c4d3a;
                  }
            
                  /* 日历表格样式 */
                  .calendar-grid {
                    display: grid;
                    grid-template-columns: repeat(7, minmax(40px, 1fr)); /* 确保每列至少40px宽 */
                    gap: 1px;
                    min-width: 280px; /* 最小宽度确保在小屏幕上也能看到所有列 */
                  }
            
                  /* 星期标题 */
                  .weekday {
                    text-align: center;
                    padding: 4px 2px;
                    font-weight: bold;
                    color: #5c4d3a;
                    background-color: #d9c8b3;
                    font-size: 13px; /* 更小的字体大小 */
                  }
            
                  /* 日期单元格 */
                  .day {
                    min-height: 60px; /* 减小高度以适应移动设备 */
                    padding: 2px;
                    background-color: #f5f0e1;
                    border: 1px solid #bfae98;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                  }
            
                  /* 空白单元格 */
                  .day.empty {
                    background-color: #ede4d3;
                    border: 1px solid #ede4d3;
                  }
            
                  /* 日期数字 */
                  .day-number {
                    font-size: 12px;
                    color: #8c785d;
                    text-align: left;
                    width: 100%;
                    height: 16px;
                  }
            
                  /* 当前日期高亮 */
                  .current-day {
                    background-color: #e6ccaa;
                    border: 1px solid #8c785d;
                  }
            
                  .current-day .day-number {
                    color: #5c4d3a;
                    font-weight: bold;
                  }
            
                  /* 日期内容 */
                  .day-content {
                    flex-grow: 1;
                    font-size: 10px; /* 更小的字体大小 */
                    line-height: 1.2;
                    overflow-y: auto;
                    word-break: break-word; /* 允许单词在必要时断行 */
                  }
            
                  /* 普通文本样式 */
                  .normal-text {
                    color: #5c4d3a;
                    font-size: 10px; /* 更小的字体大小 */
                    line-height: 1.2;
                    margin-bottom: 2px;
                  }
            
                  /* 适配更大屏幕的媒体查询 */
                  @media (min-width: 500px) {
                    .details-calendar-button[open] > summary {
                      padding: 10px 8px;
                      font-size: 18px;
                    }
            
                    .calendar-content {
                      padding: 10px;
                    }
            
                    .calendar-title {
                      font-size: 18px;
                    }
            
                    .calendar-info {
                      font-size: 16px;
                    }
            
                    .weekday {
                      padding: 5px;
                      font-size: 14px;
                    }
            
                    .day {
                      min-height: 80px;
                      padding: 5px;
                    }
            
                    .day-number {
                      font-size: 14px;
                      height: 20px;
                    }
            
                    .day-content,
                    .normal-text {
                      font-size: 12px;
                      line-height: 1.3;
                    }
                  }
        </style>
        <div class="calendar-wrapper">
            <details class="details-calendar-button" open>
                <summary>${summaryText}</summary>
                <div class="calendar-content">
                    <div class="calendar-header">
                        <div class="calendar-title">${calendarTitle}</div>
                        <div class="calendar-info">${calendarInfo}</div>
                    </div>
                    <div class="calendar-grid">
                        ${weekdays}
                        ${gridCells}
                    </div>
                </div>
            </details>
        </div>
    `;
}

export function renderAllTags(messageEl, rawText, messageId) {
    const hasTags = /<(?:calendar|user_status|equip|swordskill|map|zd_status|digest)\b/i.test(rawText || '');
    if (hasTags) {
        hideSaoLightDomTags(messageEl)
    }
    try { renderCalendar(messageEl, rawText); } catch(e) { console.error('[SAO Companion] renderCalendar ERROR:', e.message, e.stack); }
    try { renderUserStatus(messageEl, rawText); } catch(e) { console.error('[SAO Companion] renderUserStatus ERROR:', e.message, e.stack); }
    try { renderEquipment(messageEl, rawText); } catch(e) { console.error('[SAO Companion] renderEquipment ERROR:', e.message, e.stack); }
    try { renderSwordSkill(messageEl, rawText); } catch(e) { console.error('[SAO Companion] renderSwordSkill ERROR:', e.message, e.stack); }
    try { renderMap(messageEl, rawText); } catch(e) { console.error('[SAO Companion] renderMap ERROR:', e.message, e.stack); }
    try { renderBattlePanel(messageEl, rawText, messageId); } catch(e) { console.error('[SAO Companion] renderBattlePanel ERROR:', e.message, e.stack); }
    if (hasTags) {
        cleanupSaoLightDom(messageEl)
    }
    if (rawText.includes('<zd_status>')) {
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
    const tagsToRemove = ['calendar', 'user_status', 'equip', 'swordskill', 'map', 'zd_status', 'digest'];
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

function renderUserStatus(messageEl, rawText) {
    const content = extractTag(rawText, 'user_status')
    if (content === null) return
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('user_status');
    const shadow = createSaoShadowHost(messageEl, 'user_status', refNode)
    const safeContent = sanitizeInlineSaoHtml(content.trim())
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
        </style>
        <div class="character-status-wrapper">
            <details class="details-character-status" open>
                <summary>角色状态栏</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}

function renderEquipment(messageEl, rawText) {
    const matches = [...rawText.matchAll(/<equip>\s*([\s\S]*?)\s*<\/equip>/gi)]
    if (matches.length === 0) return
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('equip');
    const shadow = createSaoShadowHost(messageEl, 'equip', refNode)
    const itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_STARDEW_CSS}

                    /* --- Styles SPECIFICALLY for the Character Bar Button --- */
                    .details-character-bar {
                        border: none;
                        margin: 0;
                        padding: 0;
                        color: #CCCCCC;
                        font-family: 'NotoSansCJKsc-Bold', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
            
                    /* Base Summary Styling (Unchanged) */
                    .details-character-bar > summary {
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
            
                    /* Remove default marker (Unchanged) */
                    .details-character-bar > summary::-webkit-details-marker,
                    .details-character-bar > summary::marker {
                         display: none;
                         content: '';
                    }
            
                    /* Base Character Icon Styling (Unchanged) */
                    .details-character-bar > summary::before {
                        content: '🎒';
                        display: inline-block;
                        line-height: 1;
                        font-size: 1.1em;
                    }
            
                    /* State when CLOSED (Unchanged) */
                    .details-character-bar:not([open]) > summary {
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
                    /* Icon color and margin when closed (Unchanged) */
                    .details-character-bar:not([open]) > summary::before {
                         color: var(--stardew-header-text);
                         margin-right: 6px;
                    }
            
                    /* State when OPEN (Summary unchanged) */
                    .details-character-bar[open] > summary {
                        padding: 10px 8px;
                        font-size: 18px;
                        line-height: initial;
                        margin-bottom: 5px;
                        border: 2px solid var(--stardew-pressed-border);
                        border-radius: 5px;
                        background-color: var(--stardew-pressed-bg); /* Summary background */
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
                     /* Icon style when open (Unchanged) */
                    .details-character-bar[open] > summary::before {
                        color: var(--stardew-pressed-text);
                        margin-right: 8px;
                    }
            
                    /* Instant feedback WHILE clicking (:active) (Unchanged) */
                    .details-character-bar > summary:active {
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
                     /* Icon style when active (Unchanged) */
                    .details-character-bar > summary:active::before {
                        color: var(--stardew-pressed-text);
                        margin-right: 8px;
                    }
            
                    /* Content revealed when details is open - Added explicit background */
                    .details-character-bar > div {
                        padding: 5px 0 0 0;
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.4;
                        background-color: rgba(40, 40, 40, 0.85); /* Ensure content area matches */
                        color: #CCCCCC; /* Ensure text color is set */
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

function renderSwordSkill(messageEl, rawText) {
    const matches = [...rawText.matchAll(/<swordskill>\s*([\s\S]*?)\s*<\/swordskill>/gi)]
    if (matches.length === 0) return
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('swordskill');
    const shadow = createSaoShadowHost(messageEl, 'swordskill', refNode)
    const itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_STARDEW_CSS}
                    .stardew-text-wrapper {
                        --stardew-heart-icon-color: #ff6b6b;
                    }

                    /* --- Styles SPECIFICALLY for the Affinity Button (Placed directly in wrapper) --- */
            
                    .details-affinity-button { /* Target the specific details element */
                        border: none;
                        margin: 0;
                        padding: 0;
                        color: #CCCCCC; /* Default text color */
                        font-family: 'NotoSansCJKsc-Bold', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
            
                    /* Base Summary Styling (MATCHES CHARACTER BAR) */
                    .details-affinity-button > summary {
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
                         /* Font size set by state */
                    }
            
                    /* Remove default marker */
                    .details-affinity-button > summary::-webkit-details-marker,
                    .details-affinity-button > summary::marker {
                         display: none;
                         content: '';
                    }
            
                    /* Base Heart Icon Styling */
                    .details-affinity-button > summary::before {
                        content: '✨'; /* AFFINITY ICON */
                        display: inline-block;
                        line-height: 1;
                        font-size: 1.1em; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color);
                        /* Margin set by state */
                    }
            
                    /* State when CLOSED (MATCHES CHARACTER BAR) */
                    .details-affinity-button:not([open]) > summary {
                        padding: 4px 8px 5px 8px; /* Adjusted padding for larger size */
                        font-size: 16px; /* Increased closed font size */
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
                    /* Icon margin when closed */
                    .details-affinity-button:not([open]) > summary::before {
                         margin-right: 6px; /* MATCHES CHARACTER BAR */
                         color: var(--stardew-heart-icon-color); /* Keep heart color */
                    }
            
                    /* State when OPEN (MATCHES CHARACTER BAR) */
                    .details-affinity-button[open] > summary {
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
                     /* Icon style when open */
                    .details-affinity-button[open] > summary::before {
                        margin-right: 8px; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color); /* Keep heart color */
                        /* font-size: 1.1em; Already set */
                    }
            
                    /* Instant feedback WHILE clicking (:active) (MATCHES CHARACTER BAR) */
                    .details-affinity-button > summary:active {
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
                     /* Icon style when active */
                    .details-affinity-button > summary:active::before {
                        margin-right: 8px; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color); /* Keep heart color */
                        /* font-size: 1.1em; Already set */
                    }
            
                    /* Content revealed when details is open (Added background color) */
                    .details-affinity-button > div {
                        padding: 5px 0 0 0;
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.4;
                        background-color: rgba(40, 40, 40, 0.85); /* Ensure content area matches background */
                        color: #CCCCCC;
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

function renderMap(messageEl, rawText) {
    const content = extractTag(rawText, 'map')
    if (content === null) return
    const mesText = messageEl.querySelector('.mes_text') || messageEl;
    const refNode = mesText.querySelector('map');
    const shadow = createSaoShadowHost(messageEl, 'map', refNode)
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
