// sao-store-floor.js — 楼层信息权威库
// 楼层由世界书 Markdown 散文初始化（混合方案：rawContent + regex 提取字段）。
// 游戏过程通过 state.notes 更新探索记录。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';
import { simpleHash } from './sao-store-npc.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保 floorStore 及其子字段存在，返回 floorStore 引用。
 * @returns {{ byId: Object, numberToId: Object }}
 */
function ensureFloorStore() {
    const store = getStore();
    if (!store.floorStore) {
        store.floorStore = { byId: {}, numberToId: {} };
    }
    if (!store.floorStore.byId) store.floorStore.byId = {};
    if (!store.floorStore.numberToId) store.floorStore.numberToId = {};
    return store.floorStore;
}

// ============================================================
// Regex 提取 helpers（内部）
// ============================================================

/**
 * 从楼层内容提取主题/核心原则。
 * @param {string} content
 * @returns {string}
 */
function extractTheme(content) {
    if (!content) return '';
    const m = content.match(/核心原则[：:]\s*(.+)/);
    if (m) return m[1].trim();
    const m2 = content.match(/主题.*?[:：]\s*(.+)/);
    if (m2) return m2[1].trim();
    return '';
}

/**
 * 从楼层内容提取主城镇。
 * @param {string} content
 * @returns {string}
 */
function extractMainTown(content) {
    if (!content) return '';
    const m = content.match(/主城[區区]：.*?【(.+?)】/);
    if (m) return m[1].trim();
    const m2 = content.match(/主城[區区]?.*?[:：]\s*(.+)/);
    if (m2) return m2[1].trim().substring(0, 50);
    return '';
}

/**
 * 从楼层内容提取迷宫区。
 * @param {string} content
 * @returns {string}
 */
function extractLabyrinth(content) {
    if (!content) return '';
    const m = content.match(/迷宫[區区]?.*?[:：]\s*(.+)/);
    if (m) return m[1].trim().substring(0, 100);
    return '';
}

/**
 * 从楼层内容提取 BOSS 信息。
 * @param {string} content
 * @returns {string}
 */
function extractBoss(content) {
    if (!content) return '';
    const m = content.match(/Boss.*?[:：]\s*(.+)/i);
    if (m) return m[1].trim().substring(0, 100);
    const m2 = content.match(/守关.*?【(.+?)】/);
    if (m2) return m2[1].trim();
    return '';
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 构建楼层 canon 对象。
 * @param {string} content - 世界书原始内容
 * @returns {{ rawContent: string, theme: string, mainTown: string, labyrinth: string, boss: string }}
 */
function _buildCanon(content) {
    return {
        rawContent: content,
        theme: extractTheme(content),
        mainTown: extractMainTown(content),
        labyrinth: extractLabyrinth(content),
        boss: extractBoss(content),
    };
}

// ============================================================
// 外部楼层数据 & 章节配置
// ============================================================

/**
 * 外部已知楼层信息（SAO Progressive / Wiki 训练数据）。
 * 仅填写有把握的条目；不确定的留空由 stub 等 LLM 到达后补充。
 * 当前为空——不编造数据，未来手动补充。
 * @type {Record<number, { theme?: string, mainTown?: string, boss?: string }>}
 */
const EXTERNAL_FLOOR_DATA = {};

/**
 * 各章节楼层配置。
 * maxFloor <= 0 的章节不做楼层补全。
 */
const ARC_FLOOR_CONFIG = {
    sao:       { maxFloor: 100, prefix: 'floor_' },
    'alo_new':  { maxFloor: 100, prefix: 'newalo_floor_' },  // 新生 ALO 世界树9层+其他，预留100
    'alo_old':  { maxFloor: 9,   prefix: 'oldalo_floor_' },   // 旧 ALO 9 大世界
    ggo:        { maxFloor: 0,   prefix: 'ggo_' },            // GGO 无楼层概念
    'real':     { maxFloor: 0,   prefix: 'real_' },           // 现实无楼层
};

// ============================================================
// 导出函数
// ============================================================

/**
 * 获取 floorStore 引用（惰性初始化）。
 * @returns {{ byId: Object, numberToId: Object }}
 */
export function getFloorStore() {
    return ensureFloorStore();
}

/**
 * 按 ID 获取楼层条目。
 * @param {string} id - floor_id，如 "floor_001"
 * @returns {object|null}
 */
export function getFloorById(id) {
    const store = ensureFloorStore();
    return store.byId[id] || null;
}

/**
 * 按楼层号获取楼层条目。
 * @param {number} num - 楼层数，如 1
 * @returns {object|null}
 */
export function getFloorByNumber(num) {
    const store = ensureFloorStore();
    const id = store.numberToId[String(num)];
    return id ? (store.byId[id] || null) : null;
}

/**
 * 从世界书条目初始化楼层档案。
 * 扫描条目中楼层相关内容（keys/comment 含"层"/"floor"/"第N层"）。
 * @param {Array} entries - character_book.entries
 * @returns {number} 初始化的楼层数量
 */
export function initFloorFromWorldBook(entries) {
    if (!entries || !Array.isArray(entries)) return 0;

    const store = ensureFloorStore();
    let count = 0;

    for (const entry of entries) {
        try {
            const comment = (entry.comment || entry.name || '').trim();
            const keys = (entry.keys || []).map(k => k.toLowerCase());
            const allText = (comment + ' ' + keys.join(' ')).toLowerCase();

            // 判断是否为楼层条目
            const isFloor = /层|floor|f\b/.test(allText);
            if (!isFloor) continue;

            // 提取楼层号
            const floorNumMatch = comment.match(/第(\d+)层/) ||
                                  comment.match(/(\d+)F/i) ||
                                  comment.match(/floor.*?(\d+)/i) ||
                                  allText.match(/(\d+)/);
            if (!floorNumMatch) continue;

            const floorNum = parseInt(floorNumMatch[1]);
            if (floorNum < 1 || floorNum > 999) continue;

            const padded = String(floorNum).padStart(3, '0');
            const floorId = 'floor_' + padded;
            const content = entry.content || '';
            const contentHash = simpleHash(content);

            // 检查是否已存在
            if (store.numberToId[String(floorNum)] && store.byId[store.numberToId[String(floorNum)]]) {
                const existing = store.byId[store.numberToId[String(floorNum)]];
                // hash 变化 → 更新 canon
                if (existing._canonHash !== contentHash) {
                    existing.canon = _buildCanon(content);
                    existing._canonHash = contentHash;
                    log(`楼层 canon 刷新: ${floorNum}F (hash 变化)`);
                }
                count++;
                continue;
            }

            // 创建新条目
            const floorEntry = {
                floor_id: floorId,
                floor_number: floorNum,
                name: `第${floorNum}层`,
                canon: _buildCanon(content),
                state: {
                    unlocked: true,
                    cleared: false,
                    discovered_locations: [],
                    notes: [],
                },
                source: 'worldbook',
                _canonHash: contentHash,
            };

            store.byId[floorId] = floorEntry;
            store.numberToId[String(floorNum)] = floorId;

            log(`楼层初始化: ${floorNum}F → ${floorId}`);
            count++;
        } catch (e) {
            // 解析失败跳过
        }
    }

    return count;
}

/**
 * 补全当前章节的全部楼层 stub（世界书已有则跳过）。
 * @param {string} [arc] - 章节key，默认 'sao'。非 SAO 章节预留结构（当前只 SAO 填100层，其余留空待后续）。
 * @returns {number} 新创建的 stub 数量
 */
export function ensureAllFloorsExist(arc) {
    const cfg = ARC_FLOOR_CONFIG[arc || 'sao'];
    if (!cfg || cfg.maxFloor <= 0) return 0;

    const store = ensureFloorStore();
    let created = 0;

    for (let i = 1; i <= cfg.maxFloor; i++) {
        const padded = String(i).padStart(3, '0');
        const id = cfg.prefix + padded;
        if (store.byId[id]) continue; // 已有（世界书或之前创建），跳过

        const ext = EXTERNAL_FLOOR_DATA[i] || {};
        store.byId[id] = {
            floor_id: id,
            floor_number: i,
            name: `第${i}层`,
            canon: {
                rawContent: '',
                theme: ext.theme || '',
                mainTown: ext.mainTown || '',
                labyrinth: '',
                boss: ext.boss || '',
            },
            state: { unlocked: i === 1, cleared: false, discovered_locations: [], notes: [] },
            source: ext.theme ? 'external' : 'stub',
            _canonHash: '',
        };
        store.numberToId[String(i)] = id;
        created++;
    }

    return created;
}

/**
 * 更新楼层状态字段（合并）。
 * @param {string} floor_id
 * @param {object} stateUpdate - 要合并的状态字段
 * @returns {boolean}
 */
export async function updateFloorState(floor_id, stateUpdate, skipSave) {
    const store = ensureFloorStore();
    const floor = store.byId[floor_id];
    if (!floor) {
        log(`updateFloorState: 楼层 ${floor_id} 不存在`, 'warn');
        return false;
    }
    if (!stateUpdate || typeof stateUpdate !== 'object') {
        log('updateFloorState: stateUpdate 无效', 'warn');
        return false;
    }
    floor.state = { ...floor.state, ...stateUpdate };
    if (skipSave !== true) await saveStore();
    return true;
}

/**
 * 校验楼层条目数据。
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFloorEntry(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['数据不是对象'] };
    }

    // floor_id: 必须是 string
    if (typeof data.floor_id !== 'string' || data.floor_id.length === 0) {
        errors.push('floor_id 必须是非空字符串');
    }

    // floor_number: 必须是 number
    if (typeof data.floor_number !== 'number' || data.floor_number < 1) {
        errors.push('floor_number 必须是 >= 1 的数字');
    }

    // name: 必须是非空 string
    if (typeof data.name !== 'string' || data.name.length === 0) {
        errors.push('name 必须是非空字符串');
    }

    // canon: 若存在必须是 object
    if (data.canon != null && typeof data.canon !== 'object') {
        errors.push('canon 必须是对象');
    }

    // state: 若存在必须是 object
    if (data.state != null && typeof data.state !== 'object') {
        errors.push('state 必须是对象');
    }

    // state.cleared: 若存在必须是 boolean
    if (data.state?.cleared != null && typeof data.state.cleared !== 'boolean') {
        errors.push('state.cleared 必须是布尔值');
    }

    // source: 枚举校验
    const SOURCE_ENUM = ['worldbook', 'narrative', 'manual', 'stub', 'external'];
    if (data.source != null && !SOURCE_ENUM.includes(data.source)) {
        errors.push(`source 必须是 ${SOURCE_ENUM.join('|')} 之一`);
    }

    return { valid: errors.length === 0, errors };
}
