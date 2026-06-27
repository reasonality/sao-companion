// sao-calendar.js — 日历模块（纯逻辑层）
// 日期工具 + 时间线解析 + 日历初始化 + 增量更新 + 约定提取 + LLM 格式化

import { getSaoData, saveSaoDataNow, getContext, getCurrentCharacter, log } from './sao-core.js';

// === 日期工具 ===

/**
 * 解析 YYYY-MM-DD 字符串为 Date 对象
 */
export function parseDate(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    // fallback: try Date constructor
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * 格式化 Date 对象为 YYYY-MM-DD 字符串
 */
export function formatDate(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return '';
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

/**
 * 日期加减天数，返回新 Date 对象
 */
function addDays(dateObj, n) {
    const result = new Date(dateObj);
    result.setDate(result.getDate() + n);
    return result;
}

/**
 * 计算两个 YYYY-MM-DD 日期字符串之间的天数差
 * 返回正数表示 date2 > date1，负数表示 date2 < date1
 */
function daysBetween(dateStr1, dateStr2) {
    const d1 = parseDate(dateStr1);
    const d2 = parseDate(dateStr2);
    if (!d1 || !d2) return 0;
    const msPerDay = 86400000;
    return Math.round((d2.getTime() - d1.getTime()) / msPerDay);
}

/**
 * 从文本中提取 <time> 标签并解析日期
 * @param {string} text - 包含 <time> 标签的文本
 * @returns {Date|null} 解析后的日期，未找到则返回 null
 */
function parseTimeTagDate(text) {
    const timeMatch = text.match(/<time>([\s\S]*?)<\/time>/);
    if (!timeMatch) return null;
    const parts = timeMatch[1].replace(/[『』]/g, '').split(/\s*-\s*/);
    if (parts.length === 0) return null;
    const datePart = parts[0].trim();
    const parsedDate = parseDate(datePart);
    if (parsedDate) return parsedDate;
    // 尝试中文日期格式 YYYY年MM月DD日
    const cm = datePart.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
    if (cm) return new Date(parseInt(cm[1]), parseInt(cm[2]) - 1, parseInt(cm[3]));
    return null;
}

// === 时间线解析 ===

/**
 * 尝试从中文文本中解析日期
 * 支持: YYYY-MM-DD, YYYY年MM月DD日, MM月DD日 (假设当前年)
 * 返回 { date: 'YYYY-MM-DD', title: string } 或 null
 */
function parseTimelineEvent(line, fallbackYear) {
    if (!line || typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 格式1: YYYY-MM-DD 或 YYYY/MM/DD 后跟分隔符和事件
    let m = trimmed.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s*[:：\-\s]\s*(.+)$/);
    if (m) {
        const date = m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
        return { date, title: m[4].trim() };
    }

    // 格式2: YYYY年MM月DD日 后跟分隔符和事件
    m = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?\s*[:：\-\s]\s*(.+)$/);
    if (m) {
        const date = m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
        return { date, title: m[4].trim() };
    }

    // 格式3: MM月DD日 后跟分隔符和事件 (假设当前年或 fallbackYear)
    m = trimmed.match(/^(\d{1,2})月(\d{1,2})日?\s*[:：\-\s]\s*(.+)$/);
    if (m) {
        const year = fallbackYear || new Date().getFullYear();
        const date = year + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
        return { date, title: m[3].trim() };
    }

    // 格式4: 纯日期行（如 "2024-12-15"），无事件描述 → 跳过
    m = trimmed.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (m) return null;

    // 无法解析 → 跳过
    return null;
}

/**
 * 从时间线条目名称中提取年份（如 "2024年12月" → 2024）
 */
function extractYearFromEntryName(name) {
    if (!name) return null;
    const m = name.match(/^(\d{4})年/);
    return m ? parseInt(m[1]) : null;
}

// === 日历核心逻辑 ===

/**
 * 日历懒初始化：首次访问时从世界书提取时间线条目
 * P2a: 仅从 world book timeline entries 初始化 days；appointments 为空
 */
export function initCalendarIfNeeded() {
    try {
        const data = getSaoData();
        if (!data) return;

        // 已初始化（days 非空）
        if (data.calendar && data.calendar.days && Object.keys(data.calendar.days).length > 0) {
            return;
        }

        // 创建空日历结构
        if (!data.calendar) {
            data.calendar = {
                currentDate: null,
                days: {},
                appointments: [],
                lastCalUpdateDate: null,
                lastCalUpdateMsgId: null,
            };
        }
        const cal = data.calendar;

        // A4: 从最新 AI 消息的 <time> 标签解析当前日期（必须在时间线提取之前，以便过滤 ±1 月）
        const ctx = getContext();
        if (ctx.chat && ctx.chat.length > 0) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const msg = ctx.chat[i];
                if (msg && !msg.is_user && msg.mes) {
                    const parsedDate = parseTimeTagDate(msg.mes);
                    if (parsedDate) {
                        cal.currentDate = formatDate(parsedDate);
                    }
                    break;
                }
            }
        }

        // 从世界书提取时间线条目（A4: 如果 currentDate 可用，限制 ±1 个月）
        const char = getCurrentCharacter();
        const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
        if (!entries || !Array.isArray(entries)) {
            log('日历初始化：未找到世界书条目');
            // A4: 即使没有世界书条目，也要确保日历结构完整
            cal.lastCalUpdateDate = cal.currentDate;
            log('日历首次初始化完成（无世界书条目），currentDate=' + cal.currentDate);
            return;
        }

        let extractedCount = 0;
        // A4: 预计算 currentDate 的月索引用于 ±1 月过滤
        let currentMonthIdx = null;
        if (cal.currentDate) {
            const [cy, cm] = cal.currentDate.split('-').map(Number);
            currentMonthIdx = cy * 12 + (cm - 1);
        }

        for (const e of entries) {
            const entryName = (e.comment || e.name || '').trim();
            // 匹配时间线条目名称：YYYY年MM月
            if (!/^\d{4}年\d{1,2}月/.test(entryName)) continue;

            // A4: ±1 月过滤：如果 currentDate 已知，跳过超出范围的条目
            if (currentMonthIdx !== null) {
                const yearMatch = entryName.match(/^(\d{4})年(\d{1,2})月/);
                if (yearMatch) {
                    const entryMonthIdx = parseInt(yearMatch[1]) * 12 + (parseInt(yearMatch[2]) - 1);
                    if (Math.abs(entryMonthIdx - currentMonthIdx) > 1) continue;
                }
            }

            const fallbackYear = extractYearFromEntryName(entryName);
            const content = e.content || '';
            if (!content) continue;

            // 解析内容中的日期+事件行
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
                const parsed = parseTimelineEvent(line, fallbackYear);
                if (!parsed) continue;

                if (!cal.days[parsed.date]) {
                    cal.days[parsed.date] = { events: [], isUpdated: false };
                }
                cal.days[parsed.date].events.push({
                    type: 'canon',
                    time: null,
                    title: parsed.title,
                    description: parsed.title,
                    source: 'timeline',
                });
                extractedCount++;
            }
        }

        cal.lastCalUpdateDate = cal.currentDate;
        log('日历首次初始化完成，提取了 ' + extractedCount + ' 个时间线条目');
    } catch (e) {
        log('日历初始化失败: ' + e.message, 'warn');
    }
}

// === 约定提取 ===

/**
 * 约定/会面类关键词正则模式
 * 用于从 AI 消息中自动提取约定事项
 */
const APPOINTMENT_PATTERNS = [
    /约[定好].*?(明天|后天|下周|\d+月?\d*[日号]?)/,
    /(明天|后天|下周|过几天).*?(见|会面|等)/,
    /(上午|下午|晚上|\d{1,2}:\d{2}).*?(见|会面|约)/,
    /说好.*?(到时候|属于我们)/,
    /答应.*?(一起|同行|前往)/,
];

/**
 * 从文本中提取约定/会面类事件（纯正则，无 LLM）
 * @param {string} text - 消息文本
 * @param {object} calendar - 日历数据对象
 * @returns {number} 新增约定数量
 */
function extractAppointments(text, calendar) {
    if (!text || !calendar) return 0;

    const currentDate = calendar.currentDate;
    if (!currentDate) return 0;

    let addedCount = 0;

    // 用于去重：收集已有的 date+time+description 组合
    const existingKeys = new Set();
    for (const apt of (calendar.appointments || [])) {
        existingKeys.add(apt.date + '|' + (apt.time || '') + '|' + (apt.description || ''));
    }

    for (const pattern of APPOINTMENT_PATTERNS) {
        const matches = text.matchAll(new RegExp(pattern, 'g'));
        for (const match of matches) {
            const fullMatch = match[0];

            // 启发式提取相对日期
            let dateOffset = 0;
            if (/明天/.test(fullMatch)) dateOffset = 1;
            else if (/后天/.test(fullMatch)) dateOffset = 2;
            else if (/下周/.test(fullMatch)) dateOffset = 7;
            else if (/过几天/.test(fullMatch)) dateOffset = 3;
            else {
                // 尝试提取绝对日期：X月X日/号
                const absDateMatch = fullMatch.match(/(\d{1,2})月(\d{1,2})[日号]/);
                if (absDateMatch) {
                    const baseDate = parseDate(currentDate);
                    if (baseDate) {
                        const month = parseInt(absDateMatch[1]) - 1;
                        const day = parseInt(absDateMatch[2]);
                        const target = new Date(baseDate.getFullYear(), month, day);
                        // 如果目标日期已过，推到明年
                        if (target < baseDate) target.setFullYear(target.getFullYear() + 1);
                        dateOffset = Math.round((target.getTime() - baseDate.getTime()) / 86400000);
                    }
                }
            }

            // 启发式提取时间
            let timeStr = '';
            const timeMatch = fullMatch.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                timeStr = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
            } else if (/上午/.test(fullMatch)) {
                timeStr = '10:00';
            } else if (/下午/.test(fullMatch)) {
                timeStr = '14:00';
            } else if (/晚上/.test(fullMatch)) {
                timeStr = '20:00';
            }

            // 描述：截取匹配文本（最多 50 字符）
            const description = fullMatch.length > 50 ? fullMatch.substring(0, 50) : fullMatch;

            // 计算绝对日期
            const baseDateObj = parseDate(currentDate);
            if (!baseDateObj) continue;
            const aptDate = formatDate(addDays(baseDateObj, dateOffset));

            // 去重
            const dedupKey = aptDate + '|' + timeStr + '|' + description;
            if (existingKeys.has(dedupKey)) continue;
            existingKeys.add(dedupKey);

            // 创建约定对象
            const appointment = {
                id: 'apt_' + Date.now() + '_' + addedCount,
                date: aptDate,
                time: timeStr,
                description: description,
                participants: [],
                location: '',
                source: 'auto',
                status: 'pending',
                createdAt: new Date().toISOString(),
            };

            // 添加到 appointments 数组
            if (!calendar.appointments) calendar.appointments = [];
            calendar.appointments.push(appointment);

            // 添加到对应日期的 events
            if (!calendar.days[aptDate]) {
                calendar.days[aptDate] = { events: [], isUpdated: false };
            }
            calendar.days[aptDate].events.push({
                type: 'appointment',
                time: timeStr,
                title: description,
                description: description,
                source: 'auto',
            });

            addedCount++;
            log('提取到约定: ' + aptDate + ' ' + timeStr + ' - ' + description);
        }
    }

    return addedCount;
}

// === 增量更新 ===

/**
 * 日历增量更新（P2b：纯正则，无 LLM）
 * 在每条 AI 消息处理时调用，推进日历日期、提取约定、GC 过期数据
 * @param {string} messageText - AI 消息原始文本
 */
export function updateCalendarIncremental(messageText) {
    try {
        const data = getSaoData();
        if (!data) return;

        // 确保日历已初始化
        initCalendarIfNeeded();
        const calendar = data.calendar;
        if (!calendar) return;

        // 从 <time> 标签解析当前游戏日期
        const newDate = parseTimeTagDate(messageText);

        // 无论是否找到日期，都尝试提取约定
        const newAptCount = extractAppointments(messageText, calendar);

        if (!newDate) {
            // 无 <time> 标签或无法解析日期 → 只做了约定提取
            saveSaoDataNow();
            return;
        }

        const newDateStr = formatDate(newDate);
        const lastDate = calendar.currentDate || newDateStr;
        const daysPassed = daysBetween(lastDate, newDateStr);

        if (daysPassed > 30) {
            // 长时间未游玩：清空 days 并重新初始化
            log('日历：超过 30 天未游玩 (' + daysPassed + ' 天)，重新初始化');
            calendar.days = {};
            calendar.currentDate = newDateStr;
            calendar.lastCalUpdateDate = newDateStr;
            // 重新初始化会从世界书提取时间线
            initCalendarIfNeeded();
            // GC 约定：移除已过期且非 pending 的
            calendar.appointments = (calendar.appointments || []).filter(apt =>
                apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
            );
            saveSaoDataNow();
            log('日历重新初始化完成，日期: ' + newDateStr + '，新增约定: ' + newAptCount);
            return;
        }

        if (daysPassed < 0) {
            // 日期回退：仅警告，不执行 GC
            log('日历：日期回退 (' + lastDate + ' → ' + newDateStr + ')，跳过 GC', 'warn');
            calendar.currentDate = newDateStr;
            calendar.lastCalUpdateDate = newDateStr;
            saveSaoDataNow();
            return;
        }

        if (daysPassed <= 0) {
            // 同一天：只做约定提取，跳过日推进
            calendar.currentDate = newDateStr;
            calendar.lastCalUpdateDate = newDateStr;
            // GC 约定：移除已过期（超过 30 天）且非 pending 的
            calendar.appointments = (calendar.appointments || []).filter(apt =>
                apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
            );
            saveSaoDataNow();
            log('日历同日更新，日期: ' + newDateStr + '，新增约定: ' + newAptCount);
            return;
        }

        // daysPassed > 0：推进日期，GC 过期 days
        calendar.currentDate = newDateStr;
        calendar.lastCalUpdateDate = newDateStr;

        // GC：删除 currentDate-30 天之前的 days
        const gcCutoff = formatDate(addDays(newDate, -30));
        for (const dateKey of Object.keys(calendar.days)) {
            if (dateKey < gcCutoff) {
                delete calendar.days[dateKey];
            }
        }

        // 标记跳过的天数（介于 lastDate 和 newDate 之间的无事件天）
        if (daysPassed > 1) {
            const skippedStart = addDays(parseDate(lastDate), 1);
            for (let i = 0; i < daysPassed - 1; i++) {
                const skipDate = formatDate(addDays(skippedStart, i));
                if (!calendar.days[skipDate]) {
                    calendar.days[skipDate] = { events: [], isUpdated: true };
                }
            }
        }

        // GC 约定：移除已过期（超过 30 天）且非 pending 的
        calendar.appointments = (calendar.appointments || []).filter(apt =>
            apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
        );

        saveSaoDataNow();

        log('日历更新: ' + lastDate + ' → ' + newDateStr + ' (+' + daysPassed + '天)，新增约定: ' + newAptCount);
    } catch (e) {
        log('日历增量更新失败: ' + e.message, 'warn');
    }
}

// === LLM 格式化 ===

/**
 * 格式化日历数据供 LLM 消费（P2a: 从 calendar.days 提取事件）
 */
export function formatCalendarForLLM(cal, startDate, rangeDays) {
    if (!cal || !cal.days) return '日历数据尚未初始化';
    try {
        const start = startDate || cal.currentDate;
        if (!start) return '当前日期未知';
        const range = Math.min(rangeDays || 7, 30);
        const startDateObj = parseDate(start);
        if (!startDateObj) return '日期格式无效: ' + start;

        const lines = [];
        for (let i = 0; i < range; i++) {
            const dateObj = addDays(startDateObj, i);
            const dateStr = formatDate(dateObj);
            const day = cal.days[dateStr];
            const isToday = (dateStr === cal.currentDate);
            lines.push(dateStr + (isToday ? ' (今天)' : '') + ':');
            if (day && day.events && day.events.length) {
                for (const ev of day.events) {
                    const typeLabel = ev.type === 'canon' ? '[原作事件]' :
                                      ev.type === 'appointment' ? '[约定]' : '[变化剧情]';
                    const timeStr = ev.time ? ' ' + ev.time : '';
                    lines.push('  - ' + typeLabel + timeStr + ' ' + (ev.title || ev.description || ''));
                }
            } else {
                lines.push('  (无事件)');
            }
        }
        return lines.join('\n');
    } catch (e) {
        return '日历格式化失败: ' + e.message;
    }
}
