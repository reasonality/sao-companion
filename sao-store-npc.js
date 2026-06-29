// sao-store-npc.js — NPC 档案与当前状态权威库
// NPC 由世界书 characterProfile JSON 初始化，游戏过程通过 observations 更新。
// canon 对齐世界书 characterProfile 完整结构（A0 权威定义）。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 npcStore 及其子字段存在，返回 npcStore 引用。
 * @returns {{ byId: Object, nameToId: Object }}
 */
function ensureNpcStore() {
    const store = getStore();
    if (!store.npcStore) {
        store.npcStore = { byId: {}, nameToId: {} };
    }
    if (!store.npcStore.byId) store.npcStore.byId = {};
    if (!store.npcStore.nameToId) store.npcStore.nameToId = {};
    return store.npcStore;
}

/**
 * 简单字符串哈希（用于 _canonHash 变更检测）。
 * @param {string} str
 * @returns {string}
 */
export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash = hash & hash; // Convert to 32bit integer
    }
    return 'h' + Math.abs(hash).toString(36);
}

/**
 * 内部：创建 NPC 条目并写入 byId + nameToId。
 * @param {object} store - npcStore 引用
 * @param {string} id - 生成的 npc_id（未去重）
 * @param {string} name - NPC 名称
 * @param {string[]} aliases - 别名列表
 * @param {object} canon - canon 数据
 * @param {string} source - 来源
 * @param {string} canonHash - canon 内容哈希
 * @returns {object} 创建的条目
 */
function _createNpcEntry(store, id, name, aliases, canon, source, canonHash) {
    const finalId = store.byId[id] ? id + '_' + Date.now() : id;
    const entry = {
        npc_id: finalId,
        name: name,
        aliases: aliases || [],
        canon: canon || {},
        state: {
            relationship: '',
            affinity: 0,
            floor_id: null,
            location: '',
            last_seen_date: null,
            status: [],
        },
        observations: [],
        source: source || 'manual',
        _canonHash: canonHash || '',
    };
    store.byId[finalId] = entry;
    store.nameToId[name] = finalId;
    if (aliases) {
        for (const alias of aliases) {
            if (!store.nameToId[alias]) {
                store.nameToId[alias] = finalId;
            }
        }
    }
    return entry;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 npcStore 引用（惰性初始化）。
 * @returns {{ byId: Object, nameToId: Object }}
 */
export function getNpcStore() {
    return ensureNpcStore();
}

/**
 * 基于 NPC 名称生成唯一 ID。
 * ASCII 名称：npc_ + 小写 + 非字母数字替换为下划线。
 * 非 ASCII 名称（如中文）：npc_h + simpleHash(name)（基于名称哈希，幂等避免同毫秒碰撞）。
 * @param {string} name
 * @returns {string}
 */
export function generateNpcId(name) {
    const isAscii = /^[\x20-\x7e]+$/.test(name);
    if (isAscii) {
        return 'npc_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
    return 'npc_h' + simpleHash(name);
}

/**
 * 查找或创建 NPC 条目。
 * 按 name 在 nameToId 查找：找到则返回已有 npc_id；
 * 找不到则创建新条目写入 byId + nameToId。
 * @param {string} name - NPC 名称
 * @param {string[]} [aliases] - 别名列表
 * @returns {string} npc_id
 */
export function findOrCreateNpc(name, aliases) {
    const store = ensureNpcStore();
    if (!name) {
        log('findOrCreateNpc: 缺少 name', 'warn');
        return null;
    }

    // 按名称查找
    const existingId = store.nameToId[name];
    if (existingId && store.byId[existingId]) {
        // 更新别名（合并去重）
        if (aliases && aliases.length > 0) {
            const existing = store.byId[existingId];
            const aliasSet = new Set(existing.aliases || []);
            for (const a of aliases) aliasSet.add(a);
            existing.aliases = [...aliasSet];
        }
        return existingId;
    }

    // 按别名查找
    if (aliases) {
        for (const alias of aliases) {
            const aliasId = store.nameToId[alias];
            if (aliasId && store.byId[aliasId]) {
                return aliasId;
            }
        }
    }

    // 创建新条目
    const id = generateNpcId(name);
    const entry = _createNpcEntry(store, id, name, aliases, {}, 'manual', '');
    const finalId = entry.npc_id;
    log(`NPC 创建: ${name} → ${finalId}`);
    return finalId;
}

/**
 * 按 ID 获取 NPC 条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getNpcById(id) {
    const store = ensureNpcStore();
    return store.byId[id] || null;
}

/**
 * 按名称获取 NPC 条目。
 * @param {string} name
 * @returns {object|null}
 */
export function getNpcByName(name) {
    const store = ensureNpcStore();
    const id = store.nameToId[name];
    return id ? (store.byId[id] || null) : null;
}

/**
 * 从世界书条目初始化 NPC 档案。
 * 扫描条目中包含 characterProfile 的 JSON 数据。
 * @param {Array} entries - character_book.entries
 * @returns {number} 初始化的 NPC 数量
 */
export function initNpcFromWorldBook(entries) {
    if (!entries || !Array.isArray(entries)) return 0;

    const store = ensureNpcStore();
    let count = 0;

    for (const entry of entries) {
        try {
            const content = entry.content || '';
            if (!content.includes('characterProfile')) continue;

            // 剥离 ```json``` 围栏
            let jsonStr = content;
            const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (fenceMatch) {
                jsonStr = fenceMatch[1];
            }

            // 尝试找到 JSON 对象
            const jsonStart = jsonStr.indexOf('{');
            const jsonEnd = jsonStr.lastIndexOf('}');
            if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) continue;

            const parsed = JSON.parse(jsonStr.substring(jsonStart, jsonEnd + 1));
            if (!parsed.characterProfile) continue;

            const profile = parsed.characterProfile;
            const npcName = profile.characterName || entry.comment || entry.name || '';
            if (!npcName) continue;

            // 计算 canon hash
            const contentHash = simpleHash(content);

            // 检查是否已存在（按名称）
            const existingId = store.nameToId[npcName];
            if (existingId && store.byId[existingId]) {
                const existing = store.byId[existingId];
                // hash 变化 → 更新 canon
                if (existing._canonHash !== contentHash) {
                    existing.canon = profile;
                    existing._canonHash = contentHash;
                    existing.source = 'worldbook';
                    log(`NPC canon 刷新: ${npcName} (hash 变化)`);
                }
                count++;
                continue;
            }

            // 创建新条目
            const id = generateNpcId(npcName);
            const keys = (entry.keys || []).map(k => k.trim()).filter(Boolean);
            const aliases = keys.filter(k => k !== npcName);
            _createNpcEntry(store, id, npcName, aliases, profile, 'worldbook', contentHash);

            log(`NPC 初始化: ${npcName} → ${id}`);
            count++;
        } catch (e) {
            // 解析失败跳过（非 NPC 条目或格式不符）
        }
    }

    return count;
}

/**
 * 更新 NPC 状态字段（合并）。
 * @param {string} npc_id
 * @param {object} stateUpdate - 要合并的状态字段
 * @returns {boolean}
 */
export async function updateNpcState(npc_id, stateUpdate, skipSave) {
    const store = ensureNpcStore();
    const npc = store.byId[npc_id];
    if (!npc) {
        log(`updateNpcState: NPC ${npc_id} 不存在`, 'warn');
        return false;
    }
    if (!stateUpdate || typeof stateUpdate !== 'object') {
        log('updateNpcState: stateUpdate 无效', 'warn');
        return false;
    }
    npc.state = { ...npc.state, ...stateUpdate };
    if (skipSave !== true) await saveStore();
    return true;
}

/**
 * 向 NPC 添加观察记录。
 * @param {string} npc_id
 * @param {string} observation - 观察文本
 * @returns {boolean}
 */
export async function addObservation(npc_id, observation, skipSave) {
    const store = ensureNpcStore();
    const npc = store.byId[npc_id];
    if (!npc) {
        log(`addObservation: NPC ${npc_id} 不存在`, 'warn');
        return false;
    }
    if (!observation || typeof observation !== 'string') {
        log('addObservation: observation 无效', 'warn');
        return false;
    }
    if (!npc.observations) npc.observations = [];
    npc.observations.push(observation);
    // 限制最近 50 条
    if (npc.observations.length > 50) {
        npc.observations = npc.observations.slice(-50);
    }
    if (skipSave !== true) await saveStore();
    return true;
}

/**
 * 校验 NPC 条目数据。
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNpcEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // npc_id: 必须是 string
    if (typeof data.npc_id !== 'string' || data.npc_id.length === 0) {
        errors.push('npc_id 必须是非空字符串');
    }

    // name: 必须是非空 string
    if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push('name 必须是非空字符串');
    }

    // aliases: 若存在必须是 array
    if (data.aliases != null && !Array.isArray(data.aliases)) {
        errors.push('aliases 必须是数组');
    }

    // canon: 若存在必须是 object
    if (data.canon != null && typeof data.canon !== 'object') {
        errors.push('canon 必须是对象');
    }

    // state: 若存在必须是 object
    if (data.state != null && typeof data.state !== 'object') {
        errors.push('state 必须是对象');
    }

    // observations: 若存在必须是 array
    if (data.observations != null && !Array.isArray(data.observations)) {
        errors.push('observations 必须是数组');
    }

    // source: 枚举校验
    const SOURCE_ENUM = ['worldbook', 'narrative', 'manual'];
    if (data.source != null && !SOURCE_ENUM.includes(data.source)) {
        errors.push(`source 必须是 ${SOURCE_ENUM.join('|')} 之一`);
    }

    return { valid: errors.length === 0, errors };
}
