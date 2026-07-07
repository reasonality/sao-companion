// sao-store-floor.js — 楼层信息权威库
// 楼层由世界书 Markdown 散文初始化（混合方案：slim canon + regex 提取字段）。
// rawContent 不再存储（从世界书实时读取），仅保留 theme/mainTown/labyrinth/boss。
// 游戏过程通过 state.notes 更新探索记录。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';
import { simpleHash } from './sao-store-npc.js';

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 floorStore 引用（惰性初始化）。
 * @returns {{ byId: Object, numberToId: Object }}
 */
export function getFloorStore() {
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
 * @returns {{ theme: string, mainTown: string, mainCityDesc: string, labyrinth: string, labyrinthLocation: string, labyrinthDesc: string, boss: string, bossDesc: string, intro: string, notes: string, landmarks: Array, villages: Array, attackPoint: object|null }}
 */
function _buildCanon(content) {
    return {
        theme: extractTheme(content),
        mainTown: extractMainTown(content),
        labyrinth: extractLabyrinth(content),
        boss: extractBoss(content),
    };
}

// ============================================================
// 外部楼层数据 & 章节配置
// ============================================================

// ============================================================
// 导出函数
// ============================================================

/**
 * 按 ID 获取楼层条目。
 * @param {string} id - floor_id，如 "floor_001"
 * @returns {object|null}
 */
export function getFloorById(id) {
    const store = getFloorStore();
    return store.byId[id] || null;
}

/**
 * 按楼层号获取楼层条目。
 * @param {number} num - 楼层数，如 1
 * @returns {object|null}
 */
export function getFloorByNumber(num) {
    const store = getFloorStore();
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

    const store = getFloorStore();
    let count = 0;

    for (const entry of entries) {
        try {
            const comment = (entry.comment || entry.name || '').trim();
            const keys = (entry.keys || []).map(k => k.toLowerCase());
            const allText = (comment + ' ' + keys.join(' ')).toLowerCase();

            // 判断是否为楼层条目
            const isFloor = /层|floor|f\b/.test(allText);
            if (!isFloor) continue;

            // 提取所有楼层号（支持合并条目如"第65层-第66层"）
            const floorNums = [];
            const re6566 = /第(\d+)层/g;
            let m;
            while ((m = re6566.exec(comment)) !== null) {
                const n = parseInt(m[1]);
                if (n >= 1 && n <= 999) floorNums.push(n);
            }
            // 也从 keys 补充
            const reNF = /(\d+)F/gi;
            while ((m = reNF.exec(comment)) !== null) {
                const n = parseInt(m[1]);
                if (n >= 1 && n <= 999 && !floorNums.includes(n)) floorNums.push(n);
            }
            // 从 keys 中提取
            for (const k of keys) {
                const mk = k.match(/(\d+)/);
                if (mk) {
                    const n = parseInt(mk[1]);
                    if (n >= 1 && n <= 999 && !floorNums.includes(n)) floorNums.push(n);
                }
            }
            if (floorNums.length === 0) continue;

            const content = entry.content || '';
            const contentHash = simpleHash(content);

            let floorJson = null;

            // 优先0：直接JSON格式（新格式）
            try {
                const parsed = JSON.parse(content);
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                if (arr[0] && typeof arr[0].floor === 'number') {
                    floorJson = arr.map(p => ({
                        floor_number: p.floor,
                        theme: p.theme || '',
                        mainTown: p.mainCity ? p.mainCity.name : '',
                        mainCityDesc: p.mainCity ? (p.mainCity.description || '') : '',
                        labyrinth: p.labyrinth ? (p.labyrinth.location ? p.labyrinth.location + ' ' + (p.labyrinth.description || '') : (p.labyrinth.description || '')) : '',
                        labyrinthLocation: p.labyrinth ? (p.labyrinth.location || '') : '',
                        labyrinthDesc: p.labyrinth ? (p.labyrinth.description || '') : '',
                        boss: p.boss ? p.boss.name : '',
                        bossDesc: p.boss ? (p.boss.description || '') : '',
                        intro: p.intro || '',
                        notes: p.notes || '',
                        landmarks: p.landmarks || [],
                        villages: p.villages || [],
                        attackPoint: p.attackPoint || null,
                        source: 'worldbook',
                    }));
                }
            } catch (e) {
                // 非 JSON 格式，继续回退
            }

            // 优先1：提取 worldbook-data JSON 围栏
            if (!floorJson) {
            const fenceMatch = content.match(/```worldbook-data\s*([\s\S]*?)```/);
            if (fenceMatch) {
                try {
                    const parsed = JSON.parse(fenceMatch[1].trim());
                    // 支持单对象或数组（65/66合并条目）
                    floorJson = Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                    log(`楼层 ${floorNums[0]} worldbook-data JSON 解析失败: ${e.message}`, 'warn');
                }
            }

            } // end if (!floorJson) for fenceMatch

            // 回退1：解析 "## 元数据" 段（新格式，融入正文结构）
            if (!floorJson) {
                const metaMatch = content.match(/^##\s*元数据\s*\n([\s\S]*?)(?:\n##\s|$)/m);
                if (metaMatch) {
                    const metaStr = metaMatch[1].trim();
                    // 格式: "楼层: 13 | 主题: 火山荒野 | 来源: external+original | 备注: ..."
                    const fields = {};
                    const parts = metaStr.split(/\s*\|\s*/);
                    for (const part of parts) {
                        const colonIdx = part.indexOf(':');
                        if (colonIdx > 0) {
                            const key = part.substring(0, colonIdx).trim();
                            const val = part.substring(colonIdx + 1).trim();
                            // Map Chinese keys to field names
                            const keyMap = { '楼层': 'floor', '主题': 'theme', '来源': 'source', '备注': 'notes', '主城': 'town', '迷宫': 'labyrinth', 'Boss': 'boss' };
                            const mappedKey = keyMap[key] || key;
                            fields[mappedKey] = val;
                        }
                    }
                    if (fields.floor) {
                        floorJson = [{
                            floor_number: parseInt(fields.floor),
                            theme: fields.theme || '',
                            mainTown: fields.town || '',
                            labyrinth: fields.labyrinth || '',
                            boss: fields.boss || '',
                            notes: fields.notes || '',
                            source: fields.source || 'worldbook',
                        }];
                    }
                }
            }

            // 回退2：解析 "数据:" 行（旧格式，向后兼容）
            if (!floorJson) {
                const dataLineMatch = content.match(/^数据:\s*(.+)$/m);
                if (dataLineMatch) {
                    const dataStr = dataLineMatch[1].trim();
                    const fields = {};
                    // 按 " key=" 模式分割：每个字段以 word= 开头
                    const parts = dataStr.split(/\s+(?=\w+=)/);
                    for (const part of parts) {
                        const eqIdx = part.indexOf('=');
                        if (eqIdx > 0) {
                            const key = part.substring(0, eqIdx).trim();
                            const val = part.substring(eqIdx + 1).trim();
                            fields[key] = val;
                        }
                    }
                    if (fields.floor) {
                        floorJson = [{
                            floor_number: parseInt(fields.floor),
                            theme: fields.theme || '',
                            mainTown: fields.town || '',
                            labyrinth: fields.labyrinth || '',
                            boss: fields.boss || '',
                            notes: fields.notes || '',
                            source: fields.source || 'worldbook',
                        }];
                    }
                }
            }

            // 辅助：构建 canon（JSON 优先，回退正则）
            const buildCanonFor = (fn) => {
                if (floorJson) {
                    const fd = floorJson.find(f => f.floor_number === fn);
                    if (fd) {
                        return {
                            theme: fd.theme || '',
                            mainTown: fd.mainTown || '',
                            mainCityDesc: fd.mainCityDesc || '',
                            labyrinth: fd.labyrinth || '',
                            labyrinthLocation: fd.labyrinthLocation || '',
                            labyrinthDesc: fd.labyrinthDesc || '',
                            boss: fd.boss || '',
                            bossDesc: fd.bossDesc || '',
                            intro: fd.intro || '',
                            notes: fd.notes || '',
                            landmarks: fd.landmarks || [],
                            villages: fd.villages || [],
                            attackPoint: fd.attackPoint || null,
                        };
                    }
                }
                return _buildCanon(content);
            };
            const jsonSourceFor = (fn) => {
                if (!floorJson) return null;
                const fd = floorJson.find(f => f.floor_number === fn);
                return fd ? (fd.source || 'worldbook') : null;
            };

            // 对每个楼层号创建/更新条目
            for (const floorNum of floorNums) {
                const padded = String(floorNum).padStart(3, '0');
                const floorId = 'floor_' + padded;

                // 检查是否已存在
                if (store.numberToId[String(floorNum)] && store.byId[store.numberToId[String(floorNum)]]) {
                    const existing = store.byId[store.numberToId[String(floorNum)]];
                    // Migration: strip old rawContent (slimmed canon no longer stores it)
                    if (existing.canon && 'rawContent' in existing.canon) {
                        delete existing.canon.rawContent;
                    }
                    // hash 变化 → 更新 canon
                    if (existing._canonHash !== contentHash) {
                        existing.canon = buildCanonFor(floorNum);
                        existing._canonHash = contentHash;
                        const src = jsonSourceFor(floorNum);
                        if (src) existing.source = src;
                        log(`楼层 canon 刷新: ${floorNum}F (hash 变化)`);
                    }
                    count++;
                    continue;
                }

                // 创建新条目
                const resolvedSource = jsonSourceFor(floorNum);
                const floorEntry = {
                    floor_id: floorId,
                    floor_number: floorNum,
                    name: `第${floorNum}层`,
                    canon: buildCanonFor(floorNum),
                    state: {
                        unlocked: true,
                        cleared: false,
                        discovered_locations: [],
                        notes: [],
                    },
                    source: resolvedSource || 'worldbook',
                    _canonHash: contentHash,
                };

                store.byId[floorId] = floorEntry;
                store.numberToId[String(floorNum)] = floorId;

                log(`楼层初始化: ${floorNum}F → ${floorId}`);
                count++;
            }
        } catch (e) {
            // 解析失败跳过
        }
    }

    return count;
}

/**
 * 补全全部楼层 stub（世界书已有则跳过）。
 * @returns {number} 新创建的 stub 数量
 */
export function ensureAllFloorsExist() {
    const maxFloor = 100;
    const prefix = 'floor_';

    const store = getFloorStore();
    let created = 0;

    for (let i = 1; i <= maxFloor; i++) {
        const padded = String(i).padStart(3, '0');
        const id = prefix + padded;
        if (store.byId[id]) continue; // 已有（世界书或之前创建），跳过

        store.byId[id] = {
            floor_id: id,
            floor_number: i,
            name: `第${i}层`,
            canon: {
                theme: '',
                mainTown: '',
                labyrinth: '',
                boss: '',
            },
            state: { unlocked: i === 1, cleared: false, discovered_locations: [], notes: [] },
            source: 'stub',
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
    const store = getFloorStore();
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
// Exported for test use only
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
