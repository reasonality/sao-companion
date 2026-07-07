/**
 * 共享日历格子构建模块 —— 聊天栏日历(sao-render.js)与插件控制台日历(index.js)共用。
 * 单一来源：改这里，两边同步生效。避免两套渲染代码漂移。
 *
 * 职责：给定日期 + 事件列表 + 标志位，返回单个格子 HTML 字符串。
 *   - 绿点数 = 非约定事件的子事件总数（无子事件时主事件算1，上限5）
 *   - 黄点 = 有约定则1个
 *   - 正文 = 第一个事件的第一个子事件 body（最多5行截断，200字）
 *   - 类名：sao-cal-cell / sao-cal-today / sao-cal-other-month / sao-cal-selected / sao-cal-has-event
 *
 * 调用方负责：
 *   - 合并事件源（buildCleanCalendarDays canon + cal.days/calendarStore 非canon）
 *   - 按精确日期 date 字段过滤事件
 *   - 注入 CSS（SAO_CALENDAR_CSS，聊天栏用Shadow DOM；控制台用panel.html内嵌，高度140px覆盖）
 *   - 绑定点击（聊天栏shadow click；控制台data-action="calSelectDay"委托）
 */
import { esc } from './sao-core.js';

/**
 * 构建单个日历格子 HTML。
 * @param {object} opts
 * @param {string} opts.dateStr - YYYY-MM-DD
 * @param {number} opts.day - 日号(1-31)
 * @param {boolean} opts.isCurrentMonth - 是否当前显示月份
 * @param {boolean} [opts.isToday=false] - 是否当天
 * @param {boolean} [opts.isSelected=false] - 是否选中（控制台用）
 * @param {Array} opts.events - 已合并+按精确date过滤的事件列表
 * @param {string} [opts.dataAction=null] - 控制台 data-action 属性（如 "calSelectDay"）
 * @param {boolean} [opts.roleButton=false] - 是否加 role=button（聊天栏用，无障碍）
 * @returns {string} 格子 HTML
 */
export function buildCalCellHtml(opts) {
    const { dateStr, day, isCurrentMonth, events = [] } = opts;
    const isToday = !!opts.isToday;
    const isSelected = !!opts.isSelected;
    const dataAction = opts.dataAction || null;
    const roleButton = !!opts.roleButton;

    const cls = ['sao-cal-cell'];
    if (!isCurrentMonth) cls.push('sao-cal-other-month');
    if (isToday) cls.push('sao-cal-today');
    if (isSelected) cls.push('sao-cal-selected');
    if (events.length > 0) cls.push('sao-cal-has-event');

    let dotsHtml = '';
    let eventHtml = '';

    if (isCurrentMonth && events.length > 0) {
        const appointments = events.filter(e => e.type === 'appointment');
        const nonAptEvents = events.filter(e => e.type !== 'appointment');

        // 绿点数 = 非约定事件的子事件总数（无子事件时主事件算1），上限5。
        let greenCount = 0;
        for (const ev of nonAptEvents) {
            const subs = (ev && ev.subEvents) || [];
            greenCount += subs.length > 0 ? subs.length : 1;
        }
        greenCount = greenCount > 0 ? Math.min(greenCount, 5) : 0;
        const yellowCount = appointments.length > 0 ? 1 : 0;

        let dots = '';
        for (let i = 0; i < greenCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-canon"></span>';
        for (let i = 0; i < yellowCount; i++) dots += '<span class="sao-cal-dot sao-cal-dot-apt"></span>';
        if (dots) dotsHtml = '<div class="sao-cal-dots">' + dots + '</div>';

        // 正文 = 第一个事件的第一个子事件 body（最多5行截断，200字）；无子事件用标题/描述。
        const lines = [];
        for (const ev of events) {
            const subs = (ev && ev.subEvents) || [];
            if (subs.length > 0) {
                const first = subs[0];
                const body = first.body || first.label || '';
                if (body) lines.push('<div class="sao-cal-event-body">' + esc(body.slice(0, 200)) + '</div>');
            } else {
                const main = typeof ev === 'string' ? ev : (ev.description || ev.title || '');
                if (main) lines.push('<div class="sao-cal-event-body">' + esc(main.slice(0, 200)) + '</div>');
            }
            break; // 只显示第一个事件
        }
        if (lines.length > 0) eventHtml = '<div class="sao-cal-event-text">' + lines.join('') + '</div>';
    }

    const dataActionAttr = dataAction ? ` data-action="${dataAction}"` : '';
    const roleAttr = roleButton ? ' role="button"' : '';
    return `<div class="${cls.join(' ')}" data-date="${dateStr}"${dataActionAttr}${roleAttr} aria-label="${dateStr}"><div class="sao-cal-day-num">${day}${dotsHtml}</div>${eventHtml}</div>`;
}
