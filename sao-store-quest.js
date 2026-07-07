// sao-store-quest.js — 任务权威库
// 任务由游戏过程创建（无世界书初始化），通过 quest specialist 从叙事中抽取。
// 任务状态枚举：active / completed / failed / cancelled / archived

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';

const QUEST_STATUS_ENUM = ['active', 'completed', 'failed', 'cancelled', 'archived', 'abandoned'];
const QUEST_KIND_ENUM = ['main', 'side', 'daily', 'hidden'];

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 questStore 引用（惰性初始化）。
 * @returns {{ byId: Object, activeIds: string[], completedIds: string[] }}
 */
export function getQuestStore() {
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
 * 生成任务 ID（自增数字，格式 quest_001）。
 * 解析已有 ID 找最大数字后缀 +1，宽度 3 位。
 * @returns {string}
 */
export function generateQuestId() {
    const store = getQuestStore();
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
    const store = getQuestStore();
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
    const store = getQuestStore();
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

    // L9: 仅当当前状态不是显式终结态(failed/cancelled/archived)时才自动完成。
    // 否则 updateQuest(id, {status:'failed'}) 在 objectives 全 done 时会被错误覆盖回 completed；
    // 显式归档(archived)同样不应被自动复活为 completed。
    if (
        quest.status !== 'failed' && quest.status !== 'cancelled' && quest.status !== 'archived' &&
        quest.objectives.length > 0 && quest.objectives.every(o => o.done)
    ) {
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
    const store = getQuestStore();
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
/**
 * 放弃任务（从活跃列表移除，状态改为 abandoned）。
 * @param {string} quest_id
 * @param {boolean} [skipSave]
 * @returns {boolean}
 */
export function abandonQuest(quest_id, skipSave) {
    const store = getQuestStore();
    const quest = store.byId[quest_id];
    if (!quest) {
        log(`abandonQuest: 任务 ${quest_id} 不存在`, 'warn');
        return false;
    }
    quest.status = 'abandoned';
    const idx = store.activeIds.indexOf(quest_id);
    if (idx >= 0) store.activeIds.splice(idx, 1);
    if (skipSave !== true) saveStore();
    log(`任务放弃: ${quest.title}`);
    return true;
}

export function getQuestById(id) {
    const store = getQuestStore();
    return store.byId[id] || null;
}

/**
 * 获取所有活跃任务。
 * @returns {object[]}
 */
export function getActiveQuests() {
    const store = getQuestStore();
    return store.activeIds.map(id => store.byId[id]).filter(Boolean);
}

/**
 * 获取所有已完成任务。
 * @returns {object[]}
 */
export function getCompletedQuests() {
    const store = getQuestStore();
    return store.completedIds.map(id => store.byId[id]).filter(Boolean);
}

// validateQuestEntry removed — genuinely dead code (no production or test imports)
