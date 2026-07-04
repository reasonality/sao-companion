// sao-calendar.js — 日历模块（纯逻辑层）
// 日期工具 + 时间线解析 + 日历初始化 + 增量更新 + 约定提取 + LLM 格式化

import { getSaoData, getContext, getCurrentCharacter, log } from './sao-core.js';
import { getStore, saveStore } from './sao-store-core.js';

// === calendarStore 访问辅助 ===

/** 获取 calendarStore 引用（惰性初始化） */
function getCalendarStore() {
    const store = getStore();
    if (!store) return null;
    if (!store.calendarStore) {
        store.calendarStore = { currentDate: null, events: {}, appointments: [] };
    }
    if (!store.calendarStore.events) store.calendarStore.events = {};
    if (!Array.isArray(store.calendarStore.appointments)) store.calendarStore.appointments = [];
    return store.calendarStore;
}

/** 生成 event_id（基于 date + index） */
export function generateEventId(date, index) {
    const cleanDate = String(date || '').replace(/-/g, '');
    return `evt_${cleanDate}_${index}`;
}

/** 将 legacy day event 转为 calendarStore event 格式 */
export function toCalendarStoreEvent(legacyEvent, date, index) {
    return {
        event_id: generateEventId(date, index),
        type: legacyEvent.type || 'custom',
        title: legacyEvent.title || '',
        description: legacyEvent.description || '',
        time: legacyEvent.time || null,
        source: legacyEvent.source || '',
        related_npc_ids: legacyEvent.related_npc_ids || [],
        related_quest_ids: legacyEvent.related_quest_ids || [],
    };
}


// === 日期工具 ===

/**
 * 解析 YYYY-MM-DD 字符串为 Date 对象
 */
export function parseDate(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
        const year = parseInt(m[1]);
        const month = parseInt(m[2]);
        const day = parseInt(m[3]);
        // Basic range check before constructing Date
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const d = new Date(year, month - 1, day);
        // Round-trip check: Date auto-corrects invalid dates (e.g. Feb 30 → Mar 2)
        if (d.getMonth() + 1 !== month || d.getDate() !== day) return null;
        return d;
    }
    // fallback: try Date constructor
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    // Round-trip check for fallback path: verify parsed date components match input
    const parts = dateStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (parts) {
        if (d.getMonth() + 1 !== parseInt(parts[2]) || d.getDate() !== parseInt(parts[3])) return null;
    }
    return d;
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

/** canon 数据版本：世界书解析逻辑变更时递增，触发旧数据清除+重新提取。与 calendarVersion（并发控制）分离。
 * v7: 解析器改为捕获干净事件名 + 正文段落作为 description（原仅捕获整行作为 title，description=title）。 */
const CANON_DATA_VERSION = 7;

// === 渲染专用：干净数据缓存（绕过可能被污染的 cal.days） ===
let _cleanDaysCache = null;
let _cleanDaysCacheKey = null;

/**
 * 从世界书重新解析事件，返回干净的 days 对象（{ "YYYY-MM-DD": { events: [...] } }）。
 * 不依赖 cal.days 持久化数据，避免旧数据/跨月污染问题。
 * 结果按角色卡名缓存，切换角色时自动失效。
 * 渲染层应优先使用此函数而非 data.calendar.days。
 */
export function buildCleanCalendarDays(currentDate) {
    const char = getCurrentCharacter();
    const cacheKey = char?.name + '|' + (currentDate || '');
    if (_cleanDaysCache && _cleanDaysCacheKey === cacheKey) return _cleanDaysCache;

    const events = _filterTimelineEntries(currentDate, { monthWindow: 12 });
    const days = {};
    for (const ev of events) {
        if (!days[ev.date]) days[ev.date] = { events: [] };
        days[ev.date].events.push({
            type: 'canon',
            time: null,
            title: ev.title,
            description: ev.description || ev.title,
            subEvents: ev.subEvents || [],
            source: 'timeline',
            date: ev.date,
        });
    }
    _cleanDaysCache = days;
    _cleanDaysCacheKey = cacheKey;
    return days;
}

/**
 * 计算两个 YYYY-MM-DD 日期字符串之间的天数差
 * 返回正数表示 date2 > date1，负数表示 date2 < date1
 */
export function daysBetween(dateStr1, dateStr2) {
    const d1 = parseDate(dateStr1);
    const d2 = parseDate(dateStr2);
    if (!d1 || !d2) return 0;
    const msPerDay = 86400000;
    return Math.round((d2.getTime() - d1.getTime()) / msPerDay);
}

/**
 * 约定去重 key 归一化：去除空白后取前 20 个字符。
 * existingKeys 构建与新 key 构建均走此函数，修正 v1 既有 bug
 * （v1 existingKeys 用完整描述、新 key 用 50 字符截断导致永不匹配）。
 * 见 CALENDAR_MODEL_V2_DESIGN.md §10.05/§10.2。
 */
function _dedupKey(str) {
    return String(str || '').replace(/\s+/g, '').substring(0, 20);
}

/**
 * 递增日历版本号并保存。
 * v2 乐观并发控制依赖：每次 calendar 变更后调用此函数，确保 LLM fire-and-forget
 * 的版本号快照能检测到 v1 的后续变更（见 CALENDAR_MODEL_V2_DESIGN.md §5.3）。
 * 所有修改 calendar 数据后的保存点必须用本函数，不得直接调用 saveSaoDataNow。
 * @param {object} [calendar] - 可选：遗留调用方传入的日历对象（向后兼容）
 * @returns {Promise<void>}
 */
export async function persistCalendar(calendar) {
    // 权威版本号在 data.calendar（运行态）
    const data = getSaoData();
    if (data?.calendar) data.calendar.calendarVersion = (data.calendar.calendarVersion || 0) + 1;
    // 向后兼容：若传入独立 calendar 对象（非 data.calendar），也递增其版本号
    if (calendar && calendar !== data?.calendar) calendar.calendarVersion = (calendar.calendarVersion || 0) + 1;
    return saveStore();
}

// === Phase 1 专家架构：日历面板数据 ===

/**
 * 校验 calendarModelUpdate LLM 输出的 grid 字段。
 * grid 为显示用网格数据：{year, month, current_day, days:[{day, events:[str]}]}
 * @param {object} grid
 * @returns {boolean} true=合法
 */
export function _validateCalendarGrid(grid) {
    if (!grid || typeof grid !== 'object') return false;
    const y = Number(grid.year), m = Number(grid.month), cd = Number(grid.current_day);
    if (!Number.isInteger(y) || y < 1 || y > 9999) return false;
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    if (!Number.isInteger(cd) || cd < 1 || cd > 31) return false;
    const days = grid.days;
    if (!Array.isArray(days) || days.length > 31) return false;
    for (const d of days) {
        if (!d || typeof d !== 'object') return false;
        const dn = Number(d.day);
        if (!Number.isInteger(dn) || dn < 1 || dn > 31) return false;
        if (!Array.isArray(d.events)) return false;
        for (const e of d.events) {
            if (typeof e !== 'string' || e.length > 100) return false;
        }
    }
    return true;
}

/**
 * 写入日历面板数据到 chatMetadata.calendarPanels[messageId]。
 * 不调用 saveSaoDataNow——由调用方的 persistCalendar 统一保存。
 * @param {number|string} messageId
 * @param {object} grid - 通过 _validateCalendarGrid 校验的 grid
 */
export function persistCalendarPanel(messageId, grid) {
    if (messageId == null) return;
    const data = getSaoData();
    if (!data) return;
    if (!data.calendarPanels) data.calendarPanels = {};
    data.calendarPanels[messageId] = { grid };
}

/**
 * 从 calendar 状态（currentDate + days）派生显示用 grid。
 * 用于 updateCalendarIncremental 保存时立即写入面板，使面板不等待 LLM 即可显示。
 * @param {object} calendar
 * @returns {object|null} grid 或 null（currentDate 缺失时）
 */
export function buildTransientGridFromCalendar(calendar) {
    if (!calendar || !calendar.currentDate) return null;
    const m = calendar.currentDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1]), month = parseInt(m[2]), currentDay = parseInt(m[3]);
    const curPrefix = m[1] + '-' + m[2];
    const days = [];
    // Support both calendarStore shape (.events = flat arrays) and legacy shape (.days = { events: [] })
    const eventsSource = calendar.events || calendar.days || {};
    for (const [dateStr, dayData] of Object.entries(eventsSource)) {
        if (!dateStr.startsWith(curPrefix)) continue;
        const dm = dateStr.match(/^\d{4}-\d{2}-(\d{2})$/);
        if (!dm) continue;
        const dayNum = parseInt(dm[1]);
        // calendarStore: dayData is an array; legacy: dayData is { events: [...] }
        const evArr = Array.isArray(dayData) ? dayData : (dayData?.events || []);
        const events = evArr.map(ev => ev.title || ev.description || '').filter(Boolean).slice(0, 10);
        if (dayNum >= 1 && dayNum <= 31) days.push({ day: dayNum, events });
    }
    return { year, month, current_day: currentDay, days };
}

/**
 * 从文本中提取 <time> 标签并解析日期
 * @param {string} text - 包含 <time> 标签的文本
 * @returns {Date|null} 解析后的日期，未找到则返回 null
 */
export function parseTimeTagDate(text) {
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
 * 共享：从世界书条目中过滤 currentDate 附近的 YYYY年MM月 时间线条目，解析每个事件行。
 * getTimelineForPrompt 与 initCalendarIfNeeded 共用，消除过滤逻辑重复（见 ponytail 审查）。
 * @param {string} currentDate - YYYY-MM-DD，用于 ±1 月过滤；空则不过滤
 * @param {{monthWindow?: number|null}} [options] - 月份窗口；null 表示不过滤
 * @returns {Array<{date:string,title:string}>} 按 entry 顺序的事件列表（未排序）
 */
function _filterTimelineEntries(currentDate, options = {}) {
    const monthWindow = Object.prototype.hasOwnProperty.call(options, 'monthWindow') ? options.monthWindow : 1;
    const char = getCurrentCharacter();
    const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
    if (!entries || !Array.isArray(entries)) return [];

    let currentMonthIdx = null;
    if (currentDate) {
        const parts = currentDate.split('-');
        const cy = parseInt(parts[0]);
        const cm = parseInt(parts[1]);
        if (!isNaN(cy) && !isNaN(cm)) currentMonthIdx = cy * 12 + (cm - 1);
    }

    // 日期头检测：支持两种格式，后跟分隔符（区分于正文行）。
    //   格式A: MM月DD日（可选 YYYY年 前缀）后跟 空格/(/-///： 或行尾
    //   格式B: YYYY-MM-DD 或 YYYY/MM/DD 后跟 :：/空格/- 或行尾
    const stripMd = (s) => s.replace(/^#{0,6}\s*/, '').replace(/^\*+|\*+$/g, '').trim();
    const parseHeader = (line) => {
        const s = stripMd(line);
        let m = s.match(/^(?:\d{4}年)?(\d{1,2})月(\d{1,2})日(?=\s*(?:[\(\/\-–—:：]|$))/);
        if (m) {
            const yp = s.match(/^(\d{4})年/);
            return { year: yp ? parseInt(yp[1]) : null, month: parseInt(m[1]), day: parseInt(m[2]), tail: s.slice(m[0].length) };
        }
        m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?=\s*(?:[:：\s\-]|$))/);
        if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]), tail: s.slice(m[0].length) };
        return null;
    };
    // 事件名提取：去掉 (星期X) 前缀与分隔符，取最后一个 " - "/" | " 之后的内容，去尾冒号/粗体。
    // 例："(星期日) - 宣告日:" → "宣告日"；" / 第三周 - 探索的极限:" → "探索的极限"；"(星期二) | 稳步推进" → "稳步推进"。
    const extractName = (tail) => {
        let t = tail.replace(/^[\s]*\(星期.\)\s*/, '').replace(/^[\s\-–—\/:：|]+/, '').trim();
        const di = Math.max(t.lastIndexOf(' - '), t.lastIndexOf(' – '), t.lastIndexOf(' — '), t.lastIndexOf(' | '));
        if (di >= 0) t = t.slice(di).replace(/^[\s\-–—|]+/, '').trim();
        return t.replace(/[:：\s\*]+$/, '').trim();
    };
    // 月度总结/小结行（如 "11月总结:"）触发 flush 并停止累积，避免整月总结挂到最后一日。
    const summaryRe = /^\d{1,2}月(总结|小结|概览|汇总)[:：]?$/;

    const events = [];
    for (const e of entries) {
        const entryName = (e.comment || e.name || '').trim();
        if (!/^\d{4}年\d{1,2}月/.test(entryName)) continue;

        if (currentMonthIdx !== null && monthWindow != null) {
            const yearMatch = entryName.match(/^(\d{4})年(\d{1,2})月/);
            if (yearMatch) {
                const entryMonthIdx = parseInt(yearMatch[1]) * 12 + (parseInt(yearMatch[2]) - 1);
                if (Math.abs(entryMonthIdx - currentMonthIdx) > monthWindow) continue;
            }
        }

        const fallbackYear = extractYearFromEntryName(entryName);
        const content = e.content || '';
        if (!content) continue;

        let entryMonth = (entryName.match(/年(\d{1,2})月/) || [])[1];
        entryMonth = entryMonth ? parseInt(entryMonth) : 0;
        let curDay = 0;
        let curYear = fallbackYear || 0;
        let nameBuf = '';
        let descBuf = [];
        let stopped = false;

        const flush = () => {
            if (curDay > 0 && entryMonth > 0 && curYear > 0 && (nameBuf || descBuf.length)) {
                const dateStr = curYear + '-' + String(entryMonth).padStart(2, '0') + '-' + String(curDay).padStart(2, '0');
                let desc = descBuf
                    .map(l => l.replace(/^\s{0,3}[*\-+]\s+/, '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                if (desc.length > 1500) desc = desc.slice(0, 1500) + '…';
                let title = nameBuf;
                // 无干净事件名（空或仅括号标注如 \"(星期五)\"/\"(推算日期)\"）时，用描述首行作标题
                if (!title || /^\(.*\)$/.test(title)) {
                    const firstLine = desc.split('\n')[0] || '';
                    title = firstLine.replace(/^事件标题[:：]\s*/, '').slice(0, 40).trim() || (entryMonth + '月' + curDay + '日');
                }
                // 提取子事件标题（供格子多行展示）：正文里 "标签: 内容" 形式的行，标签作子事件名。
                // 时间格式标签（如 "13:00: 开服"）保留 "13:00" 作标题；含时间范围的标签（如 "13:00 - 14:00 之间 [现实世界]: ..."）
                // 取最后一个冒号前的全部文本，去 [括号] 后作标题。
                const subEvents = [];
                for (const line of desc.split('\n')) {
                    let m = line.match(/^(\d{1,2}:\d{2})[:：]\s*(.+)$/);
                    if (!m) m = line.match(/^(.{2,25})[:：]\s*(\S.*)$/);
                    if (m) {
                        let st = m[1].replace(/\[[^\]]*\]/g, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
                        if (st && st.length >= 2 && st.length <= 22) subEvents.push(st);
                    }
                }
                if (title) events.push({ date: dateStr, title, description: desc, subEvents: subEvents.slice(0, 8) });
            }
            curDay = 0; nameBuf = ''; descBuf = [];
        };

        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (stopped) continue;
            if (summaryRe.test(trimmed)) { flush(); stopped = true; continue; }
            const hdr = parseHeader(trimmed);
            if (hdr) {
                flush();
                entryMonth = hdr.month || entryMonth;
                curDay = hdr.day;
                curYear = hdr.year || fallbackYear || 0;
                nameBuf = extractName(hdr.tail);
                descBuf = [];
                continue;
            }
            if (curDay > 0) descBuf.push(trimmed);
        }
        flush();
    }
    return events;
}

/**
 * 为 v2 日历 LLM prompt 构造当月+下月原作时间线文本。
 * 见 CALENDAR_MODEL_V2_DESIGN.md §4.1（截断至 1500 字）。
 * @param {string} currentDate - YYYY-MM-DD
 * @param {number} [maxChars=1500]
 * @returns {string} 时间线文本；无可用条目时返回空串
 */
export function getTimelineForPrompt(currentDate, maxChars = 1500) {
    const events = _filterTimelineEntries(currentDate, { monthWindow: 1 }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const result = events.map(ev => `${ev.date}: ${ev.title}`).join('\n');
    return result.length > maxChars ? result.substring(0, maxChars) : result;
}

/**
 * 按需查询原作时间线事件。供 function calling 工具使用，不注入主 prompt。
 * @param {{date?:string,start_date?:string,end_date?:string,month?:string,max?:number}} query
 * @returns {Array<{date:string,title:string}>}
 */
export function queryTimeline(query = {}) {
    const normalizeDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) ? v.trim() : null;
    const normalizeMonth = (v) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v.trim())) ? v.trim() : null;
    let start = normalizeDate(query.date) || normalizeDate(query.start_date);
    let end = normalizeDate(query.date) || normalizeDate(query.end_date);
    const month = normalizeMonth(query.month);
    if (month && !start && !end) {
        start = month + '-01';
        const [y, m] = month.split('-').map(Number);
        end = y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
    }
    if (!start && !end) return [];
    if (!start) start = end;
    if (!end) end = start;
    if (start > end) [start, end] = [end, start];

    const parsedMax = parseInt(query.max);
    const max = Math.max(1, Math.min(Number.isFinite(parsedMax) ? parsedMax : 40, 120));
    return _filterTimelineEntries(null, { monthWindow: null })
        .filter(ev => ev.date >= start && ev.date <= end)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .slice(0, max);
}

/**
 * 解析 first_mes 中的 <calendar> 标签，提取用户预填的原作时间线。
 * 格式为自定义 YAML-like：
 *   year: 2022
 *   month: 11
 *   current_day: 6
 *   days:
 *   6: [主线] 事件描述
 *   7: ...
 * @param {string} rawText - 含 <calendar> 标签的文本（通常是 first_mes）
 * @returns {{year:number,month:number,currentDay:number,days:Object<string,Array<{title:string}>>}|null}
 *          days 键为 'YYYY-MM-DD'；解析失败返回 null
 */
export function parseFirstMesCalendarTag(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const m = rawText.match(/<calendar>\s*([\s\S]*?)\s*<\/calendar>/i);
    if (!m) return null;
    const body = m[1];
    const yearM = body.match(/^year:\s*(\d+)/m);
    const monthM = body.match(/^month:\s*(\d+)/m);
    const dayM = body.match(/^current_day:\s*(\d+)/m);
    if (!yearM || !monthM) return null;
    const year = parseInt(yearM[1]);
    const month = parseInt(monthM[1]);
    if (!year || month < 1 || month > 12) return null;
    const currentDay = dayM ? parseInt(dayM[1]) : 0;

    const days = {};
    const daysIdx = body.indexOf('days:');
    if (daysIdx >= 0) {
        const daysBlock = body.slice(daysIdx + 5);
        const lineRe = /^(\d{1,2}):[ \t]*(.+)$/gm;
        let lm;
        while ((lm = lineRe.exec(daysBlock)) !== null) {
            const dayNum = parseInt(lm[1]);
            if (dayNum < 1 || dayNum > 31) continue;
            const title = lm[2].trim();
            if (!title) continue;
            const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
            if (!days[dateStr]) days[dateStr] = [];
            days[dateStr].push({ title });
        }
    }
    return { year, month, currentDay, days };
}

/** 一次性清理 events 中历史遗留的重复 canon 事件（归一化前缀比较）。
 *  支持 calendarStore.events（flat 数组）和 legacy cal.days（嵌套 { events: [] }）。 */
function _dedupExistingDays(eventsObj) {
    if (!eventsObj) return;
    for (const [dateKey, dayData] of Object.entries(eventsObj)) {
        // calendarStore shape: dayData is array; legacy shape: dayData is { events: [] }
        const evArr = Array.isArray(dayData) ? dayData : dayData?.events;
        if (!evArr || evArr.length < 2) continue;
        const seen = new Set();
        const filtered = evArr.filter(ev => {
            const k = (ev.title || ev.description || '').replace(/\s+/g, '').replace(/^\[[^\]]*\]/, '').substring(0, 20);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        if (Array.isArray(dayData)) {
            eventsObj[dateKey] = filtered;
        } else {
            dayData.events = filtered;
        }
    }
}

/**
 * 日历懒初始化：首次访问时从世界书提取时间线条目
 * P2a: 仅从 world book timeline entries 初始化 days；appointments 为空
 */
export function initCalendarIfNeeded() {
    try {
        const data = getSaoData();
        if (!data) return;

        const calStore = getCalendarStore();
        if (!calStore) return;

        // 确保 data.calendar 运行态容器存在
        if (!data.calendar) {
            data.calendar = {
                lastCalUpdateDate: null,
                lastCalUpdateMsgId: null,
                calendarVersion: 0,
                canonDataVersion: 0,
            };
        }

        // 已初始化（events 非空）— 检查 canon 数据版本，必要时清除旧 canon 数据重新提取
        // 注意：calendarVersion 用于乐观并发控制（persistCalendar 每次递增），不能用于此检查
        const calVer = data.calendar.canonDataVersion || 0;
        if (Object.keys(calStore.events).length > 0) {
            _dedupExistingDays(calStore.events);
            // Clean stale auto-generated appointments from disabled regex extractor
            if (calStore.appointments.length > 0) {
                const before = calStore.appointments.length;
                calStore.appointments = calStore.appointments.filter(a => a.source !== 'auto');
                for (const [dateStr, evArr] of Object.entries(calStore.events)) {
                    calStore.events[dateStr] = (evArr || []).filter(ev => !(ev.type === 'appointment' && ev.source === 'auto'));
                }
                if (before !== calStore.appointments.length) {
                    log('\u6e05\u7406 ' + (before - calStore.appointments.length) + ' \u4e2a\u65e7\u6b63\u5219\u63d0\u53d6\u7684\u7ea6\u5b9a');
                }
            }
            // canon 数据版本升级：清除旧 canon 事件（可能跨月污染/截断），保留 appointment/custom，重新提取
            if (calVer < CANON_DATA_VERSION) {
                console.log('[SAO Calendar] canon 版本升级: ' + calVer + ' → ' + CANON_DATA_VERSION + '，清除旧 canon 事件');
                log('\u65e5\u5386 canon \u6570\u636e\u7248\u672c\u5347\u7ea7: ' + calVer + ' \u2192 ' + CANON_DATA_VERSION + '\uff0c\u6e05\u9664\u65e7 canon \u4e8b\u4ef6\u91cd\u65b0\u63d0\u53d6');
                let removedCount = 0;
                for (const [dateStr, evArr] of Object.entries(calStore.events)) {
                    const beforeLen = (evArr || []).length;
                    const filtered = (evArr || []).filter(ev => ev.type !== 'canon');
                    removedCount += beforeLen - filtered.length;
                    if (filtered.length === 0) {
                        delete calStore.events[dateStr];
                    } else {
                        calStore.events[dateStr] = filtered;
                    }
                }
                console.log('[SAO Calendar] 清除 ' + removedCount + ' 个旧 canon 事件，剩余 ' + Object.keys(calStore.events).length + ' 天');
                data.calendar.canonDataVersion = CANON_DATA_VERSION;
                // 不 return — 继续走重新提取流程
            } else {
                console.log('[SAO Calendar] canon 版本已是 ' + calVer + '，跳过重新提取');
                return;
            }
        }

        // A4: 从最新 AI 消息的 <time> 标签解析当前日期（必须在时间线提取之前，以便过滤 ±1 月）
        const ctx = getContext();
        if (ctx.chat && ctx.chat.length > 0) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                const msg = ctx.chat[i];
                if (msg && !msg.is_user && msg.mes) {
                    const parsedDate = parseTimeTagDate(msg.mes);
                    if (parsedDate) {
                        calStore.currentDate = formatDate(parsedDate);
                    }
                    break;
                }
            }
        }

        // A5: 优先从 first_mes <calendar> 标签预填原作时间线（用户-authored 权威数据）
        const chat2 = ctx.chat || [];
        for (let i = 0; i < chat2.length; i++) {
            const fm = chat2[i];
            if (!fm || fm.is_user) continue;
            const parsed = parseFirstMesCalendarTag(fm.mes || '');
            if (parsed && parsed.days && Object.keys(parsed.days).length > 0) {
                let fmCount = 0;
                for (const [dateStr, evs] of Object.entries(parsed.days)) {
                    if (!calStore.events[dateStr]) calStore.events[dateStr] = [];
                    for (const ev of evs) {
                        calStore.events[dateStr].push(toCalendarStoreEvent({
                            type: 'canon',
                            title: ev.title,
                            description: ev.title,
                        }, dateStr, calStore.events[dateStr].length));
                        fmCount++;
                    }
                }
                // 若 currentDate 仍为空，用 first_mes 的 current_day 补齐
                if (!calStore.currentDate && parsed.currentDay) {
                    calStore.currentDate = parsed.year + '-' + String(parsed.month).padStart(2, '0') + '-' + String(parsed.currentDay).padStart(2, '0');
                }
                log('日历初始化：从 first_mes <calendar> 预填 ' + fmCount + ' 个原作事件');
            }
            break; // 只处理第一条非用户消息（greeting）
        }

        // Guard: skip world book timeline extraction if pre-parser already handled it
        const loreParsed = getStore()?.loreParsed;
        if (loreParsed?.timelineCount > 0) {
            data.calendar.lastCalUpdateDate = calStore.currentDate;
            data.calendar.canonDataVersion = CANON_DATA_VERSION;
            log('日历初始化：pre-parser 已提取 ' + loreParsed.timelineCount + ' 个时间线条目，跳过世界书提取');
            return;
        }

        // 从世界书提取时间线条目（A4: 如果 currentDate 可用，限制 ±1 个月）
        const events = _filterTimelineEntries(calStore.currentDate, { monthWindow: 12 });
        if (!events.length) {
            log('日历初始化：未找到世界书条目');
            data.calendar.lastCalUpdateDate = calStore.currentDate;
            log('日历首次初始化完成（无世界书条目），currentDate=' + calStore.currentDate);
            return;
        }

        let extractedCount = 0;
        for (const ev of events) {
            if (!calStore.events[ev.date]) {
                calStore.events[ev.date] = [];
            }
            // 去重：归一化前缀比较（first_mes title 可能带 [标签] 前缀，worldbook title 经 markdown 清洗）
            const _normKey = (s) => (s || '').replace(/\s+/g, '').replace(/^\[[^\]]*\]/, '').substring(0, 20);
            const evKey = _normKey(ev.title);
            const dup = calStore.events[ev.date].some(e => _normKey(e.title) === evKey);
            if (dup) continue;
            calStore.events[ev.date].push(toCalendarStoreEvent({
                type: 'canon',
                title: ev.title,
                description: ev.description || ev.title,
            }, ev.date, calStore.events[ev.date].length));
            extractedCount++;
        }

        data.calendar.lastCalUpdateDate = calStore.currentDate;
        data.calendar.canonDataVersion = CANON_DATA_VERSION;
        log('日历初始化完成 v' + CANON_DATA_VERSION + '，提取了 ' + extractedCount + ' 个时间线条目（header-month-fix）');
        console.log('[SAO Calendar] ✓ 重新提取完成 v' + CANON_DATA_VERSION + '，' + extractedCount + ' 个事件，开始保存...');
        // M3: 用 persistCalendar 而非 saveStore，确保 calendarVersion 自增，
        // 否则并发 calendarModelUpdate 带陈旧 snapshotVersion 会覆盖刚写入的 canon 数据。
        // 函数本身非 async，保持与原 saveStore() 的 fire-and-forget 语义，加 catch 防未处理拒绝。
        // 关键：保存修改到持久化存储，否则重启后数据回滚
        try {
            // 外层 try 仅捕获 persistCalendar 同步阶段抛错(如 calendarVersion 自增)；异步拒绝由 .catch 处理
            persistCalendar().then(() => {
                console.log('[SAO Calendar] ✓ 保存完成');
            }).catch(saveErr => {
                console.log('[SAO Calendar] ✗ 保存失败: ' + saveErr.message);
            });
        } catch (saveErr) {
            console.log('[SAO Calendar] ✗ 保存失败: ' + saveErr.message);
        }
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
    // --- 原有 5 条（保持顺序不变） ---
    /约[定好].*?(明天|后天|下周|\d+月?\d*[日号]?)/,
    /(明天|后天|下周|过几天).*?(见|会面|等)/,
    /(上午|下午|晚上|\d{1,2}:\d{2}).*?(见|会面|约)/,
    /说好.*?(到时候|属于我们)/,
    /答应.*?(一起|同行|前往)/,
    // --- 扩展 5 条（SAO 角色扮演场景补充） ---
    // 仅保留含明确约会信号或可被 extractAppointments 解析日期/时间的模式；
    // 无日期/时间纯叙事动词（商定/计划/决定/承诺）及不可解析时词（中午/傍晚等）已剔除，避免产出无价值 today-dated 幻影约定。
    /约好了.*?(见|会面|碰头|一起)/,
    /(广场|城门|据点|塔|旅馆|酒馆).*?(见|集合|会合|碰头)/,
    /(\d{1,2}:\d{2}).*?(会合|碰头|集合)/,
    /Boss战.*?(定于|在|约).*?(明天|后天|\d+月\d+[日号])/,
    /老地方.*?(见|会合|碰头)/,
];

// === 时间跳跃正则 fallback（无 <time> 标签时的日期推进） ===
const TIME_SKIP_PATTERNS = [
    { pattern: /第[二两]天/, offset: 1 },
    { pattern: /第三天/, offset: 2 },
    { pattern: /第四天/, offset: 3 },
    { pattern: /第五天/, offset: 4 },
    { pattern: /次日/, offset: 1 },
    { pattern: /隔天/, offset: 1 },
    { pattern: /过了一周/, offset: 7 },
    { pattern: /一周后/, offset: 7 },
    { pattern: /数日后/, offset: 3 },
    { pattern: /几天后/, offset: 3 },
    { pattern: /过了\s*(\d+)\s*天/, offset: 0 },   // offset computed from capture group
    { pattern: /(\d+)\s*天[之后]/, offset: 0 },    // offset computed from capture group
    { pattern: /过了两三[日天]/, offset: 2 },
];

/**
 * 检测文本中的时间跳跃短语（正则 fallback，仅在无 <time> 标签时使用）
 * @param {string} text - 消息文本
 * @returns {{ offset: number, matchText: string } | null}
 */
export function detectTimeSkip(text) {
    if (!text) return null;
    for (const { pattern, offset } of TIME_SKIP_PATTERNS) {
        const m = text.match(pattern);
        if (m) {
            let resolvedOffset = offset;
            if (offset === 0) {
                // 动态 offset：从捕获组 1 提取数字
                if (!m[1]) continue;
                const parsed = parseInt(m[1], 10);
                if (isNaN(parsed) || parsed <= 0) continue;
                resolvedOffset = parsed;
            }
            return { offset: resolvedOffset, matchText: m[0] };
        }
    }
    return null;
}

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

    // 预计算 canon 事件标题前缀 Set（用于排除原作时间线复述）
    const _canonPrefixes = new Set();
    for (const dayData of Object.values(calendar.days || {})) {
        for (const ev of (dayData?.events || [])) {
            if (ev.type !== 'canon') continue;
            const t = (ev.title || ev.description || '').replace(/\s+/g, '');
            if (t.length >= 8) _canonPrefixes.add(t.substring(0, 8));
        }
    }

    let addedCount = 0;

    for (const pattern of APPOINTMENT_PATTERNS) {
        const matches = text.matchAll(new RegExp(pattern, 'g'));
        for (const match of matches) {
            const fullMatch = match[0];

            // 排除原作时间线复述：匹配文本与已有 canon 事件标题前缀重叠则跳过
            const fmLower = fullMatch.replace(/\s+/g, '');
            let isCanonDup = false;
            if (fmLower.length >= 8 && _canonPrefixes.has(fmLower.substring(0, 8))) {
                isCanonDup = true;
            } else if (fmLower.length < 8) {
                // 短匹配：检查是否被任一 canon 前缀包含
                for (const p of _canonPrefixes) {
                    if (p.includes(fmLower)) { isCanonDup = true; break; }
                }
            }
            if (isCanonDup) continue;

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

            // 通过共享 helper 添加（含去重 + 双写），见 CALENDAR_MODEL_V2_DESIGN.md §10.2
            const added = addAppointmentToCalendar(calendar, {
                date: aptDate,
                time: timeStr,
                description: description,
                source: 'auto',
                status: 'pending',
            });
            if (added) {
                addedCount++;
                log('提取到约定: ' + aptDate + ' ' + timeStr + ' - ' + description);
            }
        }
    }

    return addedCount;
}

/**
 * 共享 helper：向日历添加一条约定（含去重 + appointments/events 双写）。
 * v1 extractAppointments 与 v2 calendarModelUpdate 均调用此 helper。
 * dedup key = date|time|_dedupKey(description)，existingKeys 与新 key 均经 _dedupKey 归一化，
 * 修正 v1 既有 dedup bug（见 CALENDAR_MODEL_V2_DESIGN.md §5.4/§10.2）。
 * 支持 calendarStore 形状（.events = flat 数组）和 legacy 形状（.days = { events: [] }）。
 * @param {object} calendar - 日历/calendarStore 对象（原地修改）
 * @param {object} apt - {date, time, description, source, status}
 * @returns {boolean} true=新增成功，false=重复跳过
 */
export function addAppointmentToCalendar(calendar, { date, time, description, source, status } = {}) {
    if (!calendar || !date) return false;
    if (!calendar.appointments) calendar.appointments = [];

    // 支持 calendarStore（.events）和 legacy（.days）两种形状
    const isCalendarStore = calendar.events !== undefined && !calendar.days;
    const eventsContainer = isCalendarStore ? calendar.events : (calendar.days || {});
    if (!isCalendarStore && !calendar.days) calendar.days = {};

    const descKey = _dedupKey(description);
    // 去重：检查已有约定（existingKeys 与新 key 均经 _dedupKey 归一化）
    for (const apt of calendar.appointments) {
        const existingDescKey = _dedupKey(apt.description);
        if ((apt.date || '') + '|' + (apt.time || '') + '|' + existingDescKey === date + '|' + (time || '') + '|' + descKey) {
            return false; // 重复，跳过
        }
    }

    const newApt = {
        id: 'apt_' + Date.now() + '_' + calendar.appointments.length,
        date: date,
        time: time || '',
        description: description || '',
        participants: [],
        location: '',
        source: source || 'auto',
        status: status || 'pending',
        createdAt: new Date().toISOString(),
    };
    calendar.appointments.push(newApt);

    if (isCalendarStore) {
        // calendarStore 形状：events[date] 直接是数组
        if (!calendar.events[date]) calendar.events[date] = [];
        calendar.events[date].push(toCalendarStoreEvent({
            type: 'appointment',
            title: description || '',
            description: description || '',
            time: time || '',
            source: source || 'auto',
        }, date, calendar.events[date].length));
    } else {
        // legacy 形状：days[date] = { events: [] }
        if (!calendar.days[date]) {
            calendar.days[date] = { events: [], isUpdated: false };
        }
        calendar.days[date].events.push({
            type: 'appointment',
            time: time || '',
            title: description || '',
            description: description || '',
            source: source || 'auto',
        });
    }
    return true;
}

// === 增量更新 ===

/**
 * 推进日历日期并执行 GC（<time> 路径与时间跳跃 fallback 共享）
 * 仅处理 daysPassed>0 的推进场景：GC currentDate-30 之前的 events、标记跳过天、GC 过期约定。
 * 调用前已确认 daysPassed>0。
 * @param {object} calStore - calendarStore 对象
 * @param {object} runtimeCal - data.calendar 运行态对象
 * @param {string} oldDateStr - 推进前的日期 YYYY-MM-DD
 * @param {string} newDateStr - 推进后的日期 YYYY-MM-DD
 */
function applyDateAdvanceGC(calStore, runtimeCal, oldDateStr, newDateStr) {
    const newDateObj = parseDate(newDateStr);
    const daysPassed = daysBetween(oldDateStr, newDateStr);
    calStore.currentDate = newDateStr;
    if (runtimeCal) runtimeCal.lastCalUpdateDate = newDateStr;
    // GC：删除 currentDate-30 天之前的 events
    const gcCutoff = formatDate(addDays(newDateObj, -30));
    for (const dateKey of Object.keys(calStore.events)) {
        if (dateKey < gcCutoff) delete calStore.events[dateKey];
    }
    // 标记跳过的天数（介于 oldDateStr 和 newDateStr 之间的无事件天）
    if (daysPassed > 1) {
        const skippedStart = addDays(parseDate(oldDateStr), 1);
        for (let i = 0; i < daysPassed - 1; i++) {
            const skipDate = formatDate(addDays(skippedStart, i));
            if (!calStore.events[skipDate]) calStore.events[skipDate] = [];
        }
    }
    // GC 约定：移除已过期（超过 30 天）且非 pending 的
    calStore.appointments = (calStore.appointments || []).filter(apt =>
        apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
    );
}

/**
 * 日历增量更新（P2b：纯正则，无 LLM）
 * 在每条 AI 消息处理时调用，推进日历日期、提取约定、GC 过期数据
 * Phase 1: 接受 messageId 参数，每个保存点前写瞬时 grid 到 calendarPanels[messageId]，
 * 使日历面板无需等待 LLM 即可显示。
 * 日期推进仍由本函数独占（v1 权威）；calendarModelUpdate 的 grid 仅为显示数据（plan §2.3 修正）。
 * @param {string} messageText - AI 消息原始文本
 * @param {number|string} [messageId] - 消息 ID，用于索引 calendarPanels
 */
export async function updateCalendarIncremental(messageText, messageId) {
    let calStore = null; // 提到 try 块外，供 _writeTransient 闭包访问
    /** 在 persistCalendar 前写瞬时 grid（若 messageId 可用） */
    const _writeTransient = () => {
        if (messageId == null || !calStore) return;
        const tg = buildTransientGridFromCalendar(calStore);
        if (tg) persistCalendarPanel(messageId, tg);
    };
    try {
        const data = getSaoData();
        if (!data) return;

        // 确保日历已初始化
        initCalendarIfNeeded();
        calStore = getCalendarStore();
        if (!calStore) return;
        const runtimeCal = data.calendar;

        // 从 <time> 标签解析当前游戏日期
        const newDate = parseTimeTagDate(messageText);

        // 无论是否找到日期，都尝试提取约定
        // DISABLED: regex appointment extraction produces false positives (canon events, NPC-to-NPC promises).
        // Appointments now come ONLY from LLM analysis (calendarModelUpdate) per user requirement.
        // const newAptCount = extractAppointments(messageText, calendar);
        const newAptCount = 0;

        // 尝试时间跳跃正则 fallback（仅在无 <time> 标签时）
        let timeSkipOffset = 0;
        let timeSkipMatch = null;
        if (!newDate) {
            const skip = detectTimeSkip(messageText);
            if (skip) {
                timeSkipOffset = skip.offset;
                timeSkipMatch = skip.matchText;
            }
        }

        if (!newDate) {
            if (timeSkipOffset > 0) {
                // 时间跳跃 fallback：推进日期并执行 GC
                const baseDate = parseDate(calStore.currentDate);
                if (!baseDate) { _writeTransient(); await persistCalendar(); return; }
                const advancedDateStr = formatDate(addDays(baseDate, timeSkipOffset));
                const oldDateStr = calStore.currentDate;
                if (daysBetween(oldDateStr, advancedDateStr) <= 0) { _writeTransient(); await persistCalendar(); return; }
                applyDateAdvanceGC(calStore, runtimeCal, oldDateStr, advancedDateStr);
                log('日历时间跳跃(正则fallback): ' + oldDateStr + ' → ' + advancedDateStr + ' (+' + timeSkipOffset + '天，匹配: "' + timeSkipMatch + '")，新增约定: ' + newAptCount);
                _writeTransient();
                await persistCalendar();
                return;
            }
            // 无 <time> 标签且无时间跳跃 → 仅约定提取
            _writeTransient();
            await persistCalendar();
            return;
        }

        const newDateStr = formatDate(newDate);
        const lastDate = calStore.currentDate || newDateStr;
        const daysPassed = daysBetween(lastDate, newDateStr);

        if (daysPassed > 30) {
            // 长时间未游玩：清空 events 并重新初始化
            log('日历：超过 30 天未游玩 (' + daysPassed + ' 天)，重新初始化');
            calStore.events = {};
            calStore.currentDate = newDateStr;
            if (runtimeCal) runtimeCal.lastCalUpdateDate = newDateStr;
            // 重新初始化会从世界书提取时间线
            initCalendarIfNeeded();
            // GC 约定：移除已过期且非 pending 的
            calStore.appointments = (calStore.appointments || []).filter(apt =>
                apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
            );
            _writeTransient();
            await persistCalendar();
            log('日历重新初始化完成，日期: ' + newDateStr + '，新增约定: ' + newAptCount);
            return;
        }

        if (daysPassed < 0) {
            // 日期回退：仅警告，不执行 GC
            log('日历：日期回退 (' + lastDate + ' → ' + newDateStr + ')，跳过 GC', 'warn');
            calStore.currentDate = newDateStr;
            if (runtimeCal) runtimeCal.lastCalUpdateDate = newDateStr;
            _writeTransient();
            await persistCalendar();
            return;
        }

        if (daysPassed <= 0) {
            // 同一天：只做约定提取，跳过日推进
            calStore.currentDate = newDateStr;
            if (runtimeCal) runtimeCal.lastCalUpdateDate = newDateStr;
            // GC 约定：移除已过期（超过 30 天）且非 pending 的
            calStore.appointments = (calStore.appointments || []).filter(apt =>
                apt.status === 'pending' || daysBetween(newDateStr, apt.date) >= -30
            );
            _writeTransient();
            await persistCalendar();
            log('日历同日更新，日期: ' + newDateStr + '，新增约定: ' + newAptCount);
            return;
        }

        // daysPassed > 0：推进日期，GC 过期 events
        applyDateAdvanceGC(calStore, runtimeCal, lastDate, newDateStr);
        _writeTransient();
        await persistCalendar();
        log('日历更新: ' + lastDate + ' → ' + newDateStr + ' (+' + daysPassed + '天)，新增约定: ' + newAptCount);
    } catch (e) {
        log('日历增量更新失败: ' + e.message, 'warn');
        // 确保版本号与可能的部分变异一致（见 CALENDAR_MODEL_V2_DESIGN.md §5.3 catch 路径）
        try {
            await persistCalendar();
        } catch (_) { /* 忽略持久化失败 */ }
    }
}

// === LLM 格式化 ===

/**
 * 格式化日历数据供 LLM 消费
 * 支持 calendarStore（.events = flat 数组）和 legacy（.days = { events: [] }）两种形状。
 */
export function formatCalendarForLLM(cal, startDate, rangeDays) {
    const eventsSource = cal?.events || cal?.days;
    if (!cal || !eventsSource) return '日历数据尚未初始化';
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
            const dayData = eventsSource[dateStr];
            const isToday = (dateStr === cal.currentDate);
            lines.push(dateStr + (isToday ? ' (今天)' : '') + ':');
            // calendarStore: dayData is array; legacy: dayData is { events: [...] }
            const evArr = Array.isArray(dayData) ? dayData : (dayData?.events || []);
            if (evArr.length > 0) {
                for (const ev of evArr) {
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
