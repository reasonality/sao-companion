// sao-buff.js — Buff 系统模块
// 为任何实体（玩家、队友 NPC、敌人）管理临时/永久 Buff。
// Phase 1 of 3：buffs 是公会和住房系统的基础。

import { log } from './sao-core.js';

// ============================================================
// 常量
// ============================================================

/** 所有支持的 buff 属性字段 */
const BUFF_STAT_FIELDS = ['str', 'agi', 'int', 'vit', 'atk', 'maxHp', 'maxMp', 'hit', 'crit'];

/** buff 来源枚举（用于校验和展示） */
export const BUFF_SOURCES = [
    'food', 'furniture', 'title', 'guild', 'equipment_set',
    'skill', 'special_event', 'enemy_trait',
];

// ============================================================
// 内部工具
// ============================================================

/**
 * 确保实体有 buffs 字段结构。
 * @param {object} entity - 任意实体对象
 */
function ensureBuffStructure(entity) {
    if (!entity) return;
    if (!entity.buffs) entity.buffs = { temporary: [], permanent: [] };
    if (!Array.isArray(entity.buffs.temporary)) entity.buffs.temporary = [];
    if (!Array.isArray(entity.buffs.permanent)) entity.buffs.permanent = [];
}

/**
 * 格式化单个 buff 的 effects 为简洁字符串。
 * @param {object} effects - { str:5, agi:3 }
 * @returns {string} 如 "STR+5,AGI+3"
 */
function formatEffectsShort(effects) {
    if (!effects || typeof effects !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(effects)) {
        if (v != null && v !== 0) {
            parts.push(`${k.toUpperCase()}+${v}`);
        }
    }
    return parts.join(',');
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 计算所有 buff（临时 + 永久）的属性加成总和。
 * @param {object} buffs - { temporary: [], permanent: [] }
 * @returns {{ str: number, agi: number, int: number, vit: number, atk: number, maxHp: number, maxMp: number, hit: number, crit: number }}
 */
export function calculateBuffTotals(buffs) {
    const totals = {};
    for (const f of BUFF_STAT_FIELDS) totals[f] = 0;

    if (!buffs) return totals;

    const allBuffs = [
        ...(Array.isArray(buffs.permanent) ? buffs.permanent : []),
        ...(Array.isArray(buffs.temporary) ? buffs.temporary : []),
    ];

    for (const buff of allBuffs) {
        if (!buff?.effects || typeof buff.effects !== 'object') continue;
        for (const [k, v] of Object.entries(buff.effects)) {
            const key = k.toLowerCase();
            if (key in totals && typeof v === 'number') {
                totals[key] += v;
            }
        }
    }

    return totals;
}

/**
 * 给实体添加临时 buff。
 * @param {object} entity - 任意实体对象
 * @param {object} buff - { id, source, name, effects, duration, expires, description? }
 */
export function addTemporaryBuff(entity, buff) {
    if (!entity || !buff) return;
    ensureBuffStructure(entity);

    // 必填字段校验
    if (!buff.id || !buff.name || !buff.effects) {
        log('addTemporaryBuff: 缺少必填字段 (id/name/effects)', 'warn');
        return;
    }

    const entry = {
        id: buff.id,
        source: buff.source || 'unknown',
        name: buff.name,
        effects: buff.effects,
        description: buff.description || '',
        duration: buff.duration || '',
        acquired_turn: buff.acquired_turn ?? null,
        expires: buff.expires || 'manual',
    };

    // 去重：同 ID 替换
    const idx = entity.buffs.temporary.findIndex(b => b.id === buff.id);
    if (idx >= 0) {
        entity.buffs.temporary[idx] = entry;
    } else {
        entity.buffs.temporary.push(entry);
    }
}

/**
 * 给实体添加永久 buff。
 * @param {object} entity - 任意实体对象
 * @param {object} buff - { id, source, name, effects, description? }
 */
export function addPermanentBuff(entity, buff) {
    if (!entity || !buff) return;
    ensureBuffStructure(entity);

    // 必填字段校验
    if (!buff.id || !buff.name || !buff.effects) {
        log('addPermanentBuff: 缺少必填字段 (id/name/effects)', 'warn');
        return;
    }

    const entry = {
        id: buff.id,
        source: buff.source || 'unknown',
        name: buff.name,
        effects: buff.effects,
        description: buff.description || '',
    };

    // 去重：同 ID 替换
    const idx = entity.buffs.permanent.findIndex(b => b.id === buff.id);
    if (idx >= 0) {
        entity.buffs.permanent[idx] = entry;
    } else {
        entity.buffs.permanent.push(entry);
    }
}

/**
 * 按 ID 移除 buff（从临时或永久列表中查找）。
 * @param {object} entity - 任意实体对象
 * @param {string} buffId - buff ID
 * @returns {boolean} 是否成功移除
 */
export function removeBuff(entity, buffId) {
    if (!entity || !buffId || !entity.buffs) return false;

    let idx = entity.buffs.temporary.findIndex(b => b.id === buffId);
    if (idx >= 0) {
        entity.buffs.temporary.splice(idx, 1);
        return true;
    }

    idx = entity.buffs.permanent.findIndex(b => b.id === buffId);
    if (idx >= 0) {
        entity.buffs.permanent.splice(idx, 1);
        return true;
    }

    return false;
}

/**
 * 检查并过期临时 buff。
 * @param {object} entity - 任意实体对象
 * @param {number} currentTurn - 当前回合数
 * @param {string} trigger - 'next_combat' | 'turn'（触发过期检查的上下文）
 * @returns {string[]} 被移除 buff 的 name 列表（用于日志）
 */
export function expireBuffs(entity, currentTurn, trigger) {
    if (!entity?.buffs?.temporary) return [];

    const removed = [];
    const remaining = [];

    for (const buff of entity.buffs.temporary) {
        let expired = false;

        if (buff.expires === 'next_combat' && trigger === 'next_combat') {
            expired = true;
        } else if (typeof buff.expires === 'string' && buff.expires.startsWith('turn_')) {
            const expireTurn = parseInt(buff.expires.slice(5), 10);
            if (!isNaN(expireTurn) && expireTurn <= currentTurn) {
                expired = true;
            }
        }
        // expires === 'manual' → 永不过期

        if (expired) {
            removed.push(buff.name);
        } else {
            remaining.push(buff);
        }
    }

    entity.buffs.temporary = remaining;
    return removed;
}

/**
 * 格式化 buffs 用于面板展示。
 * 永久 buff 在前，临时在后。
 * @param {object} buffs - { temporary: [], permanent: [] }
 * @returns {string} 如 "封弊者(STR+3,AGI+3) | 力量料理(STR+5,1场战斗)"，无 buff 返回 ''
 */
export function formatBuffsForDisplay(buffs) {
    if (!buffs) return '';

    const parts = [];

    // 永久 buff 优先
    if (Array.isArray(buffs.permanent)) {
        for (const buff of buffs.permanent) {
            const eff = formatEffectsShort(buff.effects);
            parts.push(eff ? `${buff.name}(${eff})` : buff.name);
        }
    }

    // 临时 buff
    if (Array.isArray(buffs.temporary)) {
        for (const buff of buffs.temporary) {
            const eff = formatEffectsShort(buff.effects);
            const dur = buff.duration || '';
            const detail = [eff, dur].filter(Boolean).join(',');
            parts.push(detail ? `${buff.name}(${detail})` : buff.name);
        }
    }

    return parts.join(' | ');
}

/**
 * 格式化 buffs 用于 LLM 注入（更详细，含来源信息）。
 * @param {object} buffs - { temporary: [], permanent: [] }
 * @returns {string} 如 "[称号]封弊者(STR+3,AGI+3 永久) [食物]力量料理(STR+5,1场战斗)"，无 buff 返回 ''
 */
export function formatBuffsForInjection(buffs) {
    if (!buffs) return '';

    const parts = [];

    // 永久 buff 优先
    if (Array.isArray(buffs.permanent)) {
        for (const buff of buffs.permanent) {
            const eff = formatEffectsShort(buff.effects);
            const src = buff.source ? `[${buff.source}]` : '';
            const detail = eff ? `(${eff} 永久)` : '(永久)';
            parts.push(`${src}${buff.name}${detail}`);
        }
    }

    // 临时 buff
    if (Array.isArray(buffs.temporary)) {
        for (const buff of buffs.temporary) {
            const eff = formatEffectsShort(buff.effects);
            const dur = buff.duration || '';
            const src = buff.source ? `[${buff.source}]` : '';
            const detailParts = [eff, dur].filter(Boolean);
            const detail = detailParts.length ? `(${detailParts.join(',')})` : '';
            parts.push(`${src}${buff.name}${detail}`);
        }
    }

    return parts.join(' ');
}
