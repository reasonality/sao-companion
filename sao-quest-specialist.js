// sao-quest-specialist.js — 任务专家（从叙事中抽取任务事件）
// 由 index.js 每 5 轮或 arc 切换时调用。
// 使用 specialist LLM 识别叙事中的任务事件（接受/进展/完成），更新 questStore。

import { getSettings, log, safeJsonParse } from './sao-core.js';
import { callSpecialist } from './sao-models.js';
import { getQuestStore, createQuest, updateQuest, completeQuest } from './sao-store-quest.js';
import { saveStore } from './sao-store-core.js';
import { getRules } from './sao-rules.js';

// ============================================================
// 导出函数
// ============================================================

/**
 * 从叙事文本中检查任务事件。
 * 使用 specialist LLM 识别任务接受/进展/完成，更新 questStore。
 *
 * @param {string} messageText - 叙事文本
 * @param {number|string} messageId - 消息 ID（用于日志）
 * @returns {Promise<void>}
 */
export async function checkQuestsFromNarrative(messageText, messageId) {
    if (!messageText || messageText.length < 20) return;

    const store = getQuestStore();
    const activeQuests = store.activeIds.map(id => store.byId[id]).filter(Boolean);

    // 构造当前任务上下文
    const questContext = activeQuests.map(q => ({
        quest_id: q.quest_id,
        title: q.title,
        status: q.status,
        objectives: q.objectives.map(o => ({ text: o.text, done: o.done })),
    }));

    const systemPrompt = `你是 SAO 游戏的任务管理器。分析叙事正文，识别任务相关事件。

## 你的职责
1. 识别新任务被接受的信号（NPC 委托、系统提示、主动接取）
2. 识别任务目标进展（完成了某个目标）
3. 识别任务完成信号

## 输出格式（严格 JSON，不要输出其他内容）
{
  "events": [
    {
      "type": "new_quest",
      "title": "任务标题",
      "summary": "任务简述",
      "kind": "main|side|daily",
      "objectives": [{"text": "目标描述", "done": false}]
    },
    {
      "type": "objective_progress",
      "quest_title": "已有任务标题",
      "objective_text": "目标描述",
      "done": true
    },
    {
      "type": "quest_completed",
      "quest_title": "已有任务标题"
    }
  ]
}

## 规则
- 仅报告叙事中明确提及的任务事件，不要推测
- 如果没有任务相关事件，返回 {"events": []}
- quest_title 必须与现有任务标题完全匹配或高度相似
- 新任务的 objectives 应从叙事中提取具体目标
- kind: main=主线, side=支线, daily=日常`;

    const userPrompt = `## 当前活跃任务
${questContext.length > 0 ? JSON.stringify(questContext, null, 2) : '(无活跃任务)'}

## 本轮叙事正文
${messageText.substring(0, 2000)}

请输出 JSON。`;

    // 规则按需注入：等级
    const ruleHints = getRules(['等级'], '任务参考规则');

    let content;
    try {
        content = await callSpecialist('quest', [
            { role: 'system', content: systemPrompt + ruleHints },
            { role: 'user', content: userPrompt },
        ], 512, { temperature: 0.3, jsonSchema: true, timeoutMs: 20000 });
    } catch (e) {
        log('Quest specialist 调用失败: ' + e.message, 'warn');
        return;
    }

    if (!content) return;

    try {
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = safeJsonParse(cleaned);
        if (!parsed || !Array.isArray(parsed.events)) {
            log('Quest specialist 输出格式无效', 'warn');
            return;
        }

        let updated = false;

        for (const event of parsed.events) {
            try {
                if (event.type === 'new_quest' && event.title) {
                    const questId = createQuest({
                        title: event.title,
                        summary: event.summary || '',
                        kind: event.kind || 'side',
                        objectives: (event.objectives || []).map((o, i) => ({
                            objective_id: 'obj_' + String(i + 1).padStart(3, '0'),
                            text: o.text || '',
                            done: o.done || false,
                        })),
                        source: 'narrative',
                    });
                    if (questId) {
                        log(`Quest specialist: 新任务 "${event.title}" → ${questId}`);
                        updated = true;
                    }
                } else if (event.type === 'objective_progress' && event.quest_title) {
                    // 查找匹配的任务
                    const matched = _findQuestByTitle(event.quest_title);
                    if (matched && event.objective_text) {
                        // Strict equality: specialist must echo exact objective text from context.
                        // If no exact match, objective not found → specialist can report a new one.
                        const obj = matched.objectives.find(o =>
                            o.text.trim() === event.objective_text.trim()
                        );
                        if (obj) {
                            obj.done = event.done !== false;
                            // 检查是否全部完成
                            if (matched.objectives.every(o => o.done)) {
                                await completeQuest(matched.quest_id, true);
                            }
                            log(`Quest specialist: 任务 "${event.quest_title}" 目标进展`);
                            updated = true;
                        }
                    }
                } else if (event.type === 'quest_completed' && event.quest_title) {
                    const matched = _findQuestByTitle(event.quest_title);
                    if (matched) {
                        await completeQuest(matched.quest_id);
                        log(`Quest specialist: 任务 "${event.quest_title}" 完成`);
                        updated = true;
                    }
                }
            } catch (e) {
                log('Quest specialist 事件处理失败: ' + e.message, 'warn');
            }
        }

        if (updated) {
            await saveStore();
        }
    } catch (e) {
        log('Quest specialist JSON 解析失败: ' + e.message, 'warn');
    }
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 按标题严格匹配查找任务。
 * 严格相等要求 specialist 回显精确标题；无匹配返回 null 让 specialist 创建新任务。
 * @param {string} title
 * @returns {object|null}
 */
function _findQuestByTitle(title) {
    const store = getQuestStore();
    for (const quest of Object.values(store.byId)) {
        // Strict equality: specialist must echo exact quest title from context.
        // If no exact match, return null so specialist can create a new quest.
        if (quest.title.trim() === title.trim()) {
            return quest;
        }
    }
    return null;
}
