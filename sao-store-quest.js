// sao-store-quest.js — 任务权威库
// 任务由游戏过程创建（无世界书初始化），通过 quest specialist 从叙事中抽取。
// 任务状态枚举：active / completed / failed / cancelled / archived

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';

const QUEST_STATUS_ENUM = ['active', 'completed', 'failed', 'cancelled', 'archived'];
const QUEST_KIND_ENUM = ['main', 'side', 'daily', 'hidden'];

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 questStore 及其子字段存在，返回 questStore 引用。
 * @returns {{ byId: Object, activeIds: string[], completedIds: string[] }}
 */
function ensureQuestStore() {
    const store = getStore();
    if (!store.questStore) {
        store.questStore = { byId: {}, activeIds: [], completedIds: [] };
    }
    if (!store.questStore.byId) store.questStore.byId = {};
    if (!store.questStore.activeIds) store.questStore.activeIds = [];
    if (!store.questStore.completedIds) store.questStore.completedIds = [];
    return store.questStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 questStore 引用（惰性初始化）。
 * @returns {{ byId: Object, activeIds: string[], completedIds: string[] }}
 */
export function getQuestStore() {
    return ensureQuestStore();
}

/**
 * 生成任务 ID（自增数字，格式 quest_001）。
 * 解析已有 ID 找最大数字后缀 +1，宽度 3 位。
 * @returns {string}
 */
export function generateQuestId() {
    const store = ensureQuestStore();
    let maxNum = 0;
    for (const id of Object.keys(store.byId)) {
        const match = id.match(/^quest_(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    return 'quest_' + String(next).padStart(3, '0');
}

/**
 * 创建新任务。
 * @param {object} questData - 任务数据（至少含 title）
 * @returns {string} quest_id
 */
export function createQuest(questData) {
    const store = ensureQuestStore();
    if (!questData || !questData.title) {
        log('createQuest: 缺少 title', 'warn');
        return null;
    }

    const id = generateQuestId();
    const entry = {
        quest_id: id,
        title: questData.title,
        summary: questData.summary || '',
        status: QUEST_STATUS_ENUM.includes(questData.status) ? questData.status : 'active',
        kind: questData.kind || 'main',
        objectives: questData.objectives || [],
        related_npc_ids: questData.related_npc_ids || [],
        related_floor_ids: questData.related_floor_ids || [],
        related_calendar_event_ids: questData.related_calendar_event_ids || [],
        accepted_date: questData.accepted_date || null,
        deadline_date: questData.deadline_date || null,
        reward_hint: questData.reward_hint || '',
        source: questData.source || 'narrative',
    };

    store.byId[id] = entry;
    if (entry.status === 'active') {
        store.activeIds.push(id);
    }
    log(`任务创建: ${entry.title} → ${id}`);
    return id;
}

/**
 * 更新任务字段。
 * 若所有 objectives.done 都为 true，自动标记为 completed。
 * @param {string} quest_id
 * @param {object} update - 要合并的字段
 * @returns {boolean}
 */
export async function updateQuest(quest_id, update, skipSave) {
    const store = ensureQuestStore();
    const quest = store.byId[quest_id];
    if (!quest) {
        log(`updateQuest: 任务 ${quest_id} 不存在`, 'warn');
        return false;
    }
    if (!update || typeof update !== 'object') {
        log('updateQuest: update 无效', 'warn');
        return false;
    }

    // 合并字段
    for (const [key, value] of Object.entries(update)) {
        if (key === 'objectives' && Array.isArray(value)) {
            // 合并 objectives（按 objective_id 匹配）
            for (const objUpdate of value) {
                const existing = quest.objectives.find(o => o.objective_id === objUpdate.objective_id);
                if (existing) {
                    Object.assign(existing, objUpdate);
                } else {
                    quest.objectives.push(objUpdate);
                }
            }
        } else {
            if (key === 'status' && !QUEST_STATUS_ENUM.includes(value)) continue; // 忽略非法 status
            quest[key] = value;
        }
    }

    // 检查是否所有 objectives 都完成
    if (quest.objectives.length > 0 && quest.objectives.every(o => o.done)) {
        quest.status = 'completed';
        _moveToCompleted(store, quest_id);
    }

    if (skipSave !== true) await saveStore();
    return true;
}

/**
 * 标记任务为完成。
 * @param {string} quest_id
 * @returns {boolean}
 */
export async function completeQuest(quest_id, skipSave) {
    const store = ensureQuestStore();
    const quest = store.byId[quest_id];
    if (!quest) {
        log(`completeQuest: 任务 ${quest_id} 不存在`, 'warn');
        return false;
    }
    quest.status = 'completed';
    // 标记所有 objectives 为 done
    for (const obj of quest.objectives) {
        obj.done = true;
    }
    _moveToCompleted(store, quest_id);
    if (skipSave !== true) await saveStore();
    log(`任务完成: ${quest.title}`);
    return true;
}

/**
 * 内部：将 quest_id 从 activeIds 移到 completedIds。
 * @param {object} store - questStore 引用
 * @param {string} quest_id
 */
function _moveToCompleted(store, quest_id) {
    const activeIdx = store.activeIds.indexOf(quest_id);
    if (activeIdx >= 0) {
        store.activeIds.splice(activeIdx, 1);
    }
    if (!store.completedIds.includes(quest_id)) {
        store.completedIds.push(quest_id);
    }
}

/**
 * 按 ID 获取任务条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getQuestById(id) {
    const store = ensureQuestStore();
    return store.byId[id] || null;
}

/**
 * 获取所有活跃任务。
 * @returns {object[]}
 */
export function getActiveQuests() {
    const store = ensureQuestStore();
    return store.activeIds.map(id => store.byId[id]).filter(Boolean);
}

/**
 * 获取所有已完成任务。
 * @returns {object[]}
 */
export function getCompletedQuests() {
    const store = ensureQuestStore();
    return store.completedIds.map(id => store.byId[id]).filter(Boolean);
}

/**
 * 手写轻量守卫（0 依赖，不引入 ajv/zod）。
 * 返回 { valid, errors }，不 throw。风格对齐 validateNpcEntry/validateFloorEntry。
 */
export function validateQuestEntry(data) {
    const errors = [];
    if (!data || typeof data !== 'object') return { valid: false, errors: ['数据不是对象'] };
    if (typeof data.quest_id !== 'string' || !data.quest_id) errors.push('quest_id 必须是非空字符串');
    if (typeof data.title !== 'string' || !data.title) errors.push('title 必须是非空字符串');
    if (data.status != null && !QUEST_STATUS_ENUM.includes(data.status)) errors.push(`status 必须是 ${QUEST_STATUS_ENUM.join('|')} 之一`);
    if (data.kind != null && !QUEST_KIND_ENUM.includes(data.kind)) errors.push(`kind 必须是 ${QUEST_KIND_ENUM.join('|')} 之一`);
    if (data.objectives != null && !Array.isArray(data.objectives)) errors.push('objectives 必须是数组');
    if (data.source != null && !['narrative', 'manual'].includes(data.source)) errors.push('source 必须是 narrative|manual 之一');
    return { valid: errors.length === 0, errors };
}
