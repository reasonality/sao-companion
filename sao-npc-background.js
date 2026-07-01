// SAO Companion - NPC 后台发展专家（R4 简化版）
// 每 10 轮 fire-and-forget 调用 LLM 批量更新未出场 NPC 状态
// 复用 callSpecialist('npcBackground', ...) 接口，3 级回退

import { callSpecialist } from './sao-models.js';
import { getStore, saveStore } from './sao-store-core.js';
import { log, safeJsonParse } from './sao-core.js';
import { getPlayerStore } from './sao-store-player.js';
import { projectNpcHint } from './sao-state-projection.js';
import { findOrCreateNpc, updateNpcState, addObservation } from './sao-store-npc.js';

const NPC_BG_INTERVAL = 10;

/**
 * 判断是否触发 NPC 后台专家（每 10 轮）。
 * @param {number} turnCounter
 * @returns {boolean}
 */
export function shouldTriggerNpcBackground(turnCounter) {
    return turnCounter > 0 && turnCounter % NPC_BG_INTERVAL === 0;
}

/**
 * NPC 后台专家——fire-and-forget 更新未出场 NPC。
 * @param {number|string} messageId
 * @param {string} narrativeText
 * @returns {Promise<object|null>} 解析后的更新数据或 null
 */
export async function callNpcBackgroundSpecialist(messageId, narrativeText) {
    const player = getPlayerStore();
    const playerLocation = `${player?.position?.floor_id || '?'}F ${player?.position?.location || ''}`;
    const npcHint = projectNpcHint();

    const systemPrompt = `你是 SAO 游戏的 NPC 后台发展模拟器。你的职责是更新那些当前不在叙事正文中的 NPC 的状态。

## 输入
- 玩家当前位置: ${playerLocation}
- 当前 NPC 状态摘要: ${npcHint || '无'}
- 最近叙事摘要: (由 user 消息提供)

## 你的任务
对于未在最近叙事中出现的 NPC，根据时间流逝、玩家位置、NPC 性格和关系，合理推进他们的状态：
- 好感度可能微调（搭档/朋友关系可能缓慢增长，敌对关系可能恶化）
- 位置可能变化（NPC 有自己的生活轨迹，可能移动到同楼层其他区域）
- 状态可能变化（受伤恢复、心情变化等）
- 添加简要 observation（如"在酒馆休息"、"前往迷宫区"）

## 输出格式（严格 JSON）
{
  "npcUpdates": [
    { "name": "NPC名", "relationship": "关系", "affinity": 数字, "floor_id": "楼层", "location": "位置", "status": ["状态"], "observation": "简要观察" }
  ]
}

## 规则
- 只更新未出场 NPC（叙事中提到的由 status 专家处理）
- 好感度变化幅度小（±1-2），不要大幅突变
- 位置移动要合理（同楼层内移动，不要跨楼层瞬移除非有剧情理由）
- 无需更新的 NPC 不要输出
- 输出空数组表示本轮无后台变化`;

    const userPrompt = `最近叙事摘要:\n${(narrativeText || '').substring(0, 1500)}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    let content;
    try {
        content = await callSpecialist('npcBackground', messages, 768, { temperature: 0.4, jsonSchema: true, timeoutMs: 25000 });
    } catch (e) {
        log('npcBackground 专家调用失败: ' + e.message, 'warn');
        return null;
    }

    const parsed = _validateNpcBackgroundOutput(content);
    if (!parsed || !parsed.npcUpdates || parsed.npcUpdates.length === 0) return null;

    await _applyNpcBackgroundUpdates(parsed.npcUpdates);
    return parsed;
}

/**
 * 校验 NPC 后台专家输出。
 * @param {string|object} content - LLM 返回的原始内容
 * @returns {{ npcUpdates: Array }|null}
 */
export function _validateNpcBackgroundOutput(content) {
    if (!content) return null;
    try {
        const cleaned = typeof content === 'string'
            ? content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
            : content;
        const parsed = typeof cleaned === 'string' ? safeJsonParse(cleaned) : cleaned;
        if (!parsed || !Array.isArray(parsed.npcUpdates)) return null;
        for (const u of parsed.npcUpdates) {
            if (!u || typeof u.name !== 'string' || u.name.length === 0) return null;
            // affinity 必须是 number（若存在）
            if (u.affinity != null && typeof u.affinity !== 'number') return null;
            // status 必须是 array（若存在）
            if (u.status != null && !Array.isArray(u.status)) return null;
        }
        return parsed;
    } catch { return null; }
}

/**
 * 应用 NPC 后台更新到 npcStore。
 * 使用 updateNpcState + addObservation（skipSave 批量后统一 saveStore）。
 * @param {Array} updates
 */
async function _applyNpcBackgroundUpdates(updates) {
    const store = getStore();
    if (!store?.npcStore) return;

    let updatedCount = 0;
    const currentDate = store.calendarStore?.currentDate || '';

    for (const u of updates) {
        const npcId = findOrCreateNpc(u.name);
        if (!npcId) continue;

        // 构建 state 更新（只包含提供的字段）
        const stateUpdate = {};
        if (u.relationship) stateUpdate.relationship = u.relationship;
        if (typeof u.affinity === 'number') stateUpdate.affinity = u.affinity;
        if (u.floor_id) stateUpdate.floor_id = u.floor_id;
        if (u.location) stateUpdate.location = u.location;
        if (Array.isArray(u.status)) stateUpdate.status = u.status;
        if (currentDate) stateUpdate.last_seen_date = currentDate;

        if (Object.keys(stateUpdate).length > 0) {
            await updateNpcState(npcId, stateUpdate, true); // skipSave=true
        }

        if (u.observation) {
            await addObservation(npcId, u.observation, true); // skipSave=true
        }

        updatedCount++;
    }

    if (updatedCount > 0) {
        await saveStore();
        log(`NPC 后台更新: ${updatedCount} 个 NPC`);
    }
}
