// SAO Companion - 日历模型模块（Phase C 拆分）
// 从 index.js 拆出：v2 日历 LLM 异步更新（calendarModelUpdate + 触发条件 + prompt 构建 + 校验）

import { getSettings, getSaoData, log, getContext } from './sao-core.js';
import { callModel } from './sao-models.js';
import {
    persistCalendar,
    persistCalendarPanel,
    _validateCalendarGrid,
    parseDate, formatDate, daysBetween,
    addAppointmentToCalendar,
    formatCalendarForLLM,
    getTimelineForPrompt,
    detectTimeSkip,
    parseTimeTagDate,
} from './sao-calendar.js';

/**
 * Returns true when the calendar periodic check should fire (every 20 turns).
 * v2 trigger condition #4 entry point (see CALENDAR_MODEL_V2_DESIGN.md §3).
 * @param {object} state - saoData.state
 * @returns {boolean}
 */
export function shouldTriggerPeriodicCalendarCheck(state) {
    return !!(state && state.calendarTurnCounter > 0 && state.calendarTurnCounter % 20 === 0);
}

// ============================================================
// P2 v2: LLM 日历模型（约定提取 + 完成标记）
// 设计文档: CALENDAR_MODEL_V2_DESIGN.md §2-§8
// v1 独占日期推进；v2 仅做约定提取与完成标记，fire-and-forget 异步。
// ============================================================

// 模块级并发守卫：同一时刻仅一个 calendarModelUpdate 在运行。
let _calendarModelRunning = false;

/**
 * v2 触发条件检查（§3）。任一满足即返回 true。
 * @param {string} rawText - AI 消息原文
 * @param {object} saoData - getSaoData() 结果
 * @param {{arcChangedThisTurn?: boolean}} flags - 读-早传入的 arc 标记
 * @returns {boolean}
 */
function shouldTriggerCalendarModel(rawText, saoData, { arcChangedThisTurn } = {}) {
    if (!getSettings().saoCalendar?.llmEnabled) return false;
    if (!rawText || !saoData?.calendar) return false;

    // #1 时间跳跃（约定提取触发，非日期推进）
    if (detectTimeSkip(rawText)) return true;

    // #2 <time> 标签日期与 currentDate 不一致
    const cal = saoData.calendar;
    if (cal.currentDate) {
        const timeDate = parseTimeTagDate(rawText);
        if (timeDate) {
            const timeStr = formatDate(timeDate);
            if (timeStr && timeStr !== cal.currentDate) return true;
        }
    }

    // #3 章节切换（读-早传入的 flag）
    if (arcChangedThisTurn) return true;

    return false;
}
export { shouldTriggerCalendarModel };

/**
 * 构造 v2 日历模型 prompt（§4.1/§8）。
 * @param {object} calendar - 日历对象
 * @param {string} rawText - AI 消息原文（截断 2000 字）
 * @returns {Array<{role:string,content:string}>} messages 数组
 */
function buildCalendarPrompt(calendar, rawText) {
    const currentDate = calendar.currentDate || '';
    const aiReply = (rawText || '').substring(0, 2000);
    const timeline = getTimelineForPrompt(currentDate, 1500);
    const pending = (calendar.appointments || []).filter(a => a.status === 'pending').slice(0, 20);
    const pendingLines = pending.map((a, i) => `[${i}] ${a.id || ''} | ${a.date || ''} ${(a.time || '').padEnd(5)} | ${a.description || ''}`);
    const calSummary = formatCalendarForLLM(calendar, currentDate, 5);

    const systemPrompt = `你是 SAO 游戏日历管理器，负责从 AI 回复中提取约定记录、标记已完成约定，并输出当前游戏日历网格。

## 你的职责
1. 从 AI 回复中提取**玩家（用户角色）与其他NPC角色之间**新产生的约定/会面/计划（正则可能遗漏的复杂场景）
2. 标记已完成的约定（AI 回复中明确提到约定已履行）
3. 输出当前游戏日历网格（grid），反映本回合结束时的日期与本月事件

> 日期推进不归你管——由系统正则独占。你只做约定提取、完成标记与网格输出。

## 严格排除：原作时间线事件
- **原作时间线中的角色约定/会面不属于"新约定"**。这些已在原作事件数据中记录，不要重复提取为 appointments。
- 仅提取**当前游戏中玩家与NPC新建立的约定**——即 AI 在本回合叙事中原创的、不属于原作时间线的约定。
- 判断依据：若该约定内容与原作时间线描述高度相似，或属于原作已记载的剧情节点，则不提取。

## 保守策略
- 不确定时不修改任何数据，宁可漏报不错报
- 仅当 AI 回复**明确**提及玩家与NPC之间的约定/会面/计划时才提取 appointments
- 仅当 AI 回复**明确**提到约定已履行时才标记完成
- grid 反映"当前游戏日期"所在月份，current_day 为该日期的天数

## 日期处理
- 日期推进由系统正则独占，不归你管。
- appointments_detected 中的 date 由你从 AI 回复中直接提取（ISO YYYY-MM-DD），不做日期算术；AI 若用相对表述无法解析为绝对日期则该条不提取。
- grid.year/month/current_day 从输入"当前游戏日期"派生；grid.days 列出该月有事件的天（含约定+原作事件），每天 events 为简短标题数组。

## 输出格式（严格 JSON，不要输出其他内容）
{
  "appointments_detected": [
    { "date": "YYYY-MM-DD", "time": "HH:MM 或空", "description": "约定内容" }
  ],
  "completed_appointment_indices": [0],
  "grid": {
    "year": 2024,
    "month": 12,
    "current_day": 16,
    "days": [
      { "day": 16, "events": ["与Asuna会面"] },
      { "day": 20, "events": ["与西莉卡训练"] }
    ]
  }
}

## 字段说明
- appointments_detected: 新检测到的**玩家与NPC之间**的约定（排除原作时间线已有的角色约定）。date 从 AI 回复中提取（ISO YYYY-MM-DD）。若无新增，输出空数组 []
- completed_appointment_indices: 输入 pending 列表中已完成的约定的**下标**（0-based 小整数，对应输入顺序）。直接输出数字，不要复述 id。若无完成，输出空数组 []
- grid: 当前游戏日历网格。year/month/current_day 从当前游戏日期派生；days 列出本月有事件的天（每天 events ≤ 10 条，每条 ≤ 100 字符）。若无事件天，输出空数组 []。

## 约定示例
当前日期: 2024-12-16
AI: "明天下午三点，我们在主城广场见。"
输出: { "appointments_detected": [{"date":"2024-12-17","time":"15:00","description":"主城广场见面"}], "completed_appointment_indices": [], "grid": {"year":2024,"month":12,"current_day":17,"days":[{"day":17,"events":["主城广场见面"]}]} }

## 完成约定示例
pending 输入（带下标）:
  [0] apt_1718123456789_0 | 2024-12-16 18:00 | 与Asuna会面
AI: "昨天和Asuna的会面很顺利。"
输出: { "appointments_detected": [], "completed_appointment_indices": [0], "grid": {"year":2024,"month":12,"current_day":17,"days":[]} }`;

    const userPrompt = `当前游戏日期: ${currentDate}

## 未来5天日历
${calSummary}

## 当前待完成约定（pending）
${pendingLines.length ? pendingLines.join('\n') : '(无)'}

## 当月+下月原作时间线
${timeline || '(无)'}

## 本轮 AI 回复
${aiReply}

请输出 JSON。`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * 校验 appointments_detected 单条（§5.4 步骤 0.5 防注入 6 条规则）。
 * @returns {boolean} true=合法
 */
function _validateAppointment(apt, currentDate) {
    if (!apt || typeof apt !== 'object') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(apt.date || '')) return false;
    const base = parseDate(currentDate);
    const target = parseDate(apt.date);
    if (!base || !target) return false;
    if (target.getTime() < base.getTime()) return false;
    if (daysBetween(currentDate, apt.date) > 90) return false;
    const desc = apt.description || '';
    if (typeof desc !== 'string' || desc.length < 1 || desc.length > 100) return false;
    if (apt.time) {
        const tm = String(apt.time).match(/^(\d{2}):(\d{2})$/);
        if (!tm) return false;
        if (parseInt(tm[1]) >= 24 || parseInt(tm[2]) >= 60) return false;
    }
    return true;
}

/**
 * v2 日历模型异步更新（§5.2-§5.4）。fire-and-forget 调用，不阻塞后处理链。
 * 含：版本号快照 → 并发守卫 → prompt → callModel → JSON 解析 → 降级 →
 *     版本号检查 → 应用更新（防注入校验 + helper 双写 + 下标映射） → 保存。
 * @param {string} rawText - AI 消息原文
 */
async function calendarModelUpdate(rawText) {
    if (_calendarModelRunning) { log('日历模型跳过：上一轮仍在运行', 'warn'); return; }
    _calendarModelRunning = true;
    try {
        const data = getSaoData();
        if (!data?.calendar) return;
        const calendar = data.calendar;
        const ctx = getContext();
        const chat = ctx.chat || [];
        const snapshotMsgId = chat.findLastIndex(m => m && !m.is_user);

        const snapshotVersion = calendar.calendarVersion || 0;
        const pendingSnapshot = (calendar.appointments || []).filter(a => a.status === 'pending').slice(0, 20);

        const messages = buildCalendarPrompt(calendar, rawText);

        let content;
        try {
            content = await callModel('calendar', messages, 512, { temperature: 0.3, jsonSchema: true });
        } catch (e) {
            log('日历模型调用失败，降级跳过: ' + e.message, 'warn');
            return;
        }
        if (!content) { log('日历模型返回空，降级跳过', 'warn'); return; }

        let parsed;
        try {
            // 容忍包裹的 ```json 围栏；截断输出会导致 JSON.parse 失败走下方 catch
            const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            log('日历模型 JSON 解析失败（可能输出被截断），降级跳过: ' + e.message, 'warn');
            return;
        }

        // §5.4 步骤 0-3 同步区，严禁 await
        if ((calendar.calendarVersion || 0) !== snapshotVersion) {
            log('日历模型结果丢弃：日历已被后续消息更新（版本不匹配）', 'warn');
            return;
        }
        if (snapshotMsgId >= 0 && (!ctx.chat || ctx.chat.length <= snapshotMsgId)) {
            log('日历模型结果丢弃：会话已切换', 'warn');
            return;
        }

        const currentDate = calendar.currentDate;
        const detected = Array.isArray(parsed.appointments_detected) ? parsed.appointments_detected.slice(0, 5) : [];
        let addedCount = 0;
        for (const apt of detected) {
            if (!_validateAppointment(apt, currentDate)) { log('日历模型约定校验失败跳过: ' + JSON.stringify(apt), 'warn'); continue; }
            if (addAppointmentToCalendar(calendar, { date: apt.date, time: apt.time || '', description: apt.description || '', source: 'llm', status: 'pending' })) addedCount++;
        }

        const indices = Array.isArray(parsed.completed_appointment_indices) ? parsed.completed_appointment_indices : [];
        let completedCount = 0;
        for (const idx of indices) {
            if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= pendingSnapshot.length) {
                log('日历模型完成标记下标越界跳过: ' + idx, 'warn'); continue;
            }
            const candidateId = pendingSnapshot[idx].id;
            const live = (calendar.appointments || []).find(a => a.id === candidateId && a.status === 'pending');
            if (live) {
                live.status = 'completed';
                completedCount++;
            } else {
                log('日历模型完成标记未找到/已非 pending 跳过: ' + candidateId, 'warn');
            }
        }

        // Phase 1: 应用 grid（显示用日历网格）
        let gridApplied = false;
        if (parsed.grid && _validateCalendarGrid(parsed.grid)) {
            persistCalendarPanel(snapshotMsgId, parsed.grid);
            gridApplied = true;
        } else if (parsed.grid) {
            log('日历模型 grid 校验失败跳过', 'warn');
        }

        if (addedCount === 0 && completedCount === 0 && !gridApplied) {
            log('日历模型无新增约定/完成标记/grid');
            return;
        }

        log(`日历模型应用完成: 新增约定=${addedCount}, 完成标记=${completedCount}, grid=${gridApplied ? '是' : '否'}`);
        await persistCalendar(calendar);
    } catch (e) {
        log('日历模型异步更新失败: ' + e.message, 'warn');
    } finally {
        _calendarModelRunning = false;
    }
}
export { calendarModelUpdate };

/** 会话切换时重置并发守卫（用户可能在 LLM 运行中切聊天）。
 * 由 index.js 的 CHAT_CHANGED 处理器调用（已纳入事件追踪，deactivate 后可重绑）。 */
export function resetCalendarModelRunning() { _calendarModelRunning = false; }
