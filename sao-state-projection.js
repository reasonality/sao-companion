// sao-state-projection.js — Store → 可读文本投影层
// 将 playerStore / equipmentStore / skillStore / inventoryStore 投影为
// 主 LLM prompt 注入所需的 compact / full / summary 文本格式。
// 纯函数，无副作用，不写 store。

import { getStore } from './sao-store-core.js';
import { getPlayerStore, CURSOR_LABELS } from './sao-store-player.js';
import { getEquipmentById } from './sao-store-equipment.js';
import { getSkillById } from './sao-store-skill.js';
import { getInventoryStore, getCurrency } from './sao-store-inventory.js';
import { getQuestStore } from './sao-store-quest.js';
import { log, esc } from './sao-core.js';

// ============================================================
// 常量 & 映射
// ============================================================

/** 内部 slot 名 → 中文显示名 */
const SLOT_DISPLAY = {
    weapon:    '主手',
    off_hand:  '副手',
    head:      '头部',
    chest:     '身',
    hands:     '手',
    legs:      '腿',
    accessory: '饰品',
};

/** 投影输出时保持一致的 slot 顺序 */
const SLOT_ORDER = ['weapon', 'off_hand', 'head', 'chest', 'hands', 'legs', 'accessory'];

/** 统计属性中文标签 */
const STAT_LABEL = {
    atk:   'ATK',
    str:   'STR',
    agi:   'AGI',
    int:   'INT',
    vit:   'VIT',
    maxHp: 'HP',
    maxMp: 'MP',
    hit:   'HIT',
    crit:  'CRIT',
};

/** key stat 选择优先级：武器优先攻击 */
const STAT_PRIORITY_WEAPON = ['atk', 'str', 'agi', 'int', 'hit', 'crit'];
/** key stat 选择优先级：防具优先防御属性 */
const STAT_PRIORITY_ARMOR  = ['agi', 'str', 'int', 'vit', 'maxHp', 'maxMp'];

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 安全执行函数，失败时返回 null。
 * @param {Function} fn - 要执行的函数
 * @param {string} label - 日志标签
 * @returns {*|null}
 */
function safe(fn, label) {
    try {
        return fn();
    } catch (e) {
        log(`[projection] ${label} 失败: ${e.message}`, 'warn');
        return null;
    }
}

/**
 * 获取装备的单个 key stat 字符串（如 "ATK40"）。
 * 选取非零最高优先级属性。
 * @param {object} equip 装备详情 { stats:{atk,str,...} }
 * @param {string} [slot] slot 名（用于决定优先级顺序）
 * @returns {string} 如 "ATK40"，无有效属性时返回 ""
 */
function keyStat(equip, slot) {
    if (!equip?.stats) return '';
    const stats = equip.stats;
    const priority = slot === 'weapon' ? STAT_PRIORITY_WEAPON : STAT_PRIORITY_ARMOR;
    for (const key of priority) {
        const val = stats[key];
        if (val != null && val > 0) {
            return `${STAT_LABEL[key] || key.toUpperCase()}${val}`;
        }
    }
    // 回退：遍历所有非零 stat
    for (const [k, v] of Object.entries(stats)) {
        if (v != null && v > 0) {
            return `${STAT_LABEL[k] || k.toUpperCase()}${v}`;
        }
    }
    return '';
}

/**
 * 获取装备的 top N key stats 字符串（如 "ATK40,STR10"）。
 * @param {object} equip 装备详情
 * @param {string} [slot]
 * @param {number} [maxStats=2] 最多显示几个属性
 * @returns {string}
 */
function keyStats(equip, slot, maxStats = 2) {
    if (!equip?.stats) return '';
    const stats = equip.stats;
    const priority = slot === 'weapon' ? STAT_PRIORITY_WEAPON : STAT_PRIORITY_ARMOR;
    const results = [];
    const seen = new Set();

    for (const key of priority) {
        const val = stats[key];
        if (val != null && val > 0) {
            const label = `${STAT_LABEL[key] || key.toUpperCase()}${val}`;
            results.push(label);
            seen.add(key);
            if (results.length >= maxStats) break;
        }
    }

    // 优先级列表不够时，遍历剩余
    if (results.length < maxStats) {
        for (const [k, v] of Object.entries(stats)) {
            if (results.length >= maxStats) break;
            if (seen.has(k)) continue;
            if (v != null && v > 0) {
                results.push(`${STAT_LABEL[k] || k.toUpperCase()}${v}`);
            }
        }
    }

    return results.join(',');
}

/**
 * 检测是否处于活跃战斗中（有 hp > 0 的敌人）。
 * @returns {boolean}
 */
function isInCombat() {
    try {
        const store = getStore();
        const enemies = store?.runtime?._zd_parsed?.enemies;
        return Array.isArray(enemies) && enemies.some(e => e.hp > 0);
    } catch {
        return false;
    }
}

/**
 * 获取战斗中玩家 HP（从 runtime._zd_parsed.player 读取）。
 * @returns {{ hp: number, maxHp: number }|null}
 */
function getCombatHp() {
    try {
        const player = getStore()?.runtime?._zd_parsed?.player;
        if (player?.hp != null) {
            // parseZdStatus 存 max_hp (snake_case)，非 maxHp。两个名字都兜底。
            return { hp: player.hp, maxHp: player.maxHp ?? player.max_hp ?? player.hp };
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * 自检：移除字符串中可能泄露的内部 ID 前缀。
 * @param {string} text
 * @returns {string}
 */
function stripIds(text) {
    return text.replace(/equip_\w+/g, '').replace(/skill_\w+/g, '');
}

// ============================================================
// 投影函数
// ============================================================

/**
 * 投影紧凑状态（每轮注入，~150-220 字符）。
 * 格式：多行，pipe 分隔。每个区块以 [标签] 开头。
 *
 * @returns {string} 紧凑状态文本，store 不可用时返回空字符串
 */
export function projectCompactState() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player) return '';

    const lines = [];

    // ---- 第一行：玩家基础 ----
    const base = [];
    const name = player.identity?.name;
    if (name) base.push(`[玩家]${name}`);
    if (player.progression?.level != null) base.push(`Lv${player.progression.level}`);

    // HP / MP（含战斗软守卫）
    if (player.vitals) {
        const combat = isInCombat();
        const combatHp = combat ? getCombatHp() : null;
        const v = player.vitals;
        const hp    = combatHp?.hp    ?? v.hp    ?? 0;
        const maxHp = combatHp?.maxHp ?? v.maxHp ?? 0;
        base.push(`HP:${hp}/${maxHp}${combat ? ' (战斗中)' : ''}`);
        base.push(`MP:${v.mp ?? 0}/${v.maxMp ?? 0}`);
    }

    // 位置
    const pos = player.position;
    if (pos?.floor_id) base.push(`${pos.floor_id}F`);
    if (pos?.location) base.push(`@${pos.location}`);

    // 珂尔
    try {
        const cor = getCurrency();
        if (cor != null) base.push(`珂尔:${cor}`);
    } catch { /* ignore */ }

    lines.push(base.join(' | '));

    // ---- 装备行 ----
    const equipParts = [];
    const equip = player.equipment;
    if (equip) {
        for (const slot of SLOT_ORDER) {
            const id = equip[slot];
            if (!id) continue;
            const detail = safe(() => getEquipmentById(id), `getEquipmentById(${id})`);
            if (!detail) continue;
            const ks = keyStat(detail, slot);
            equipParts.push(`${SLOT_DISPLAY[slot]}:${detail.name}${ks ? `(${ks})` : ''}`);
        }
    }
    if (equipParts.length) {
        lines.push(`[装备]${equipParts.join(' | ')}`);
    }

    // ---- 技能行 ----
    const skills = player.skills;
    if (skills?.length) {
        const cap = 8;
        const shown = skills.slice(0, cap).map(s => {
            const detail = safe(() => getSkillById(s.skill_id), `getSkillById(${s.skill_id})`);
            const skName = detail?.name || s.name || '?';
            const prof = s.proficiency ?? '?';
            return `${skName}(熟练${prof})`;
        });
        if (skills.length > cap) {
            shown.push(`还有${skills.length - cap}个...`);
        }
        lines.push(`[技能]${shown.join(' | ')}`);
    }

    // ---- 背包行 ----
    const inv = safe(() => getInventoryStore(), 'getInventoryStore');
    if (inv?.items?.length) {
        const cap = 15;
        const shown = inv.items.slice(0, cap).map(item => {
            const itemName = item.name || item.item_id || '?';
            return item.qty > 1 ? `${itemName}x${item.qty}` : itemName;
        });
        if (inv.items.length > cap) {
            shown.push(`还有${inv.items.length - cap}个...`);
        }
        lines.push(`[背包]${shown.join(' | ')}`);
    }

    return stripIds(lines.join('\n'));
}

/**
 * 投影完整状态（按需注入，~350-600 字符，上限 1000）。
 * 六区分组：基本信息 / 等级与属性 / 装备 / 技能 / 任务 / 背包货币。
 * 超长时按优先级折叠：保留装备 > 技能 > 背包。
 *
 * @returns {string} 完整状态文本，store 不可用时返回空字符串
 */
export function projectFullState() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player) return '';

    const sections = [];

    // ---- 1. 基本信息 ----
    const info = [];
    if (player.identity?.name)  info.push(`姓名: ${player.identity.name}`);
    if (player.identity?.title) info.push(`称号: ${player.identity.title}`);
    if (info.length) {
        sections.push({ label: '基本信息', text: info.join(' | '), priority: 1 });
    }

    // ---- 2. 等级与属性 ----
    const stats = [];
    if (player.progression?.level != null)   stats.push(`等级: ${player.progression.level}`);
    if (player.progression?.totalExp != null) stats.push(`经验: ${player.progression.totalExp}`);
    const attr = player.attributes;
    if (attr) {
        const parts = [];
        if (attr.str != null) parts.push(`STR:${attr.str}`);
        if (attr.agi != null) parts.push(`AGI:${attr.agi}`);
        if (attr.int != null) parts.push(`INT:${attr.int}`);
        if (attr.vit != null) parts.push(`VIT:${attr.vit}`);
        if (parts.length) stats.push(parts.join(' '));
    }
    // HP / MP（含战斗软守卫）
    if (player.vitals) {
        const combat = isInCombat();
        const combatHp = combat ? getCombatHp() : null;
        const v = player.vitals;
        const hp    = combatHp?.hp    ?? v.hp    ?? 0;
        const maxHp = combatHp?.maxHp ?? v.maxHp ?? 0;
        stats.push(`HP:${hp}/${maxHp}${combat ? ' (战斗中)' : ''} MP:${v.mp ?? 0}/${v.maxMp ?? 0}`);
    }
    // 位置
    const pos = player.position;
    if (pos?.floor_id || pos?.location) {
        stats.push(`位置: ${pos.floor_id || '?'}F ${pos.location || ''}`);
    }
    if (stats.length) {
        sections.push({ label: '等级与属性', text: stats.join(' | '), priority: 2 });
    }

    // ---- 3. 装备 ----
    const equipLines = [];
    const equip = player.equipment;
    if (equip) {
        for (const slot of SLOT_ORDER) {
            const id = equip[slot];
            if (!id) {
                equipLines.push(`${SLOT_DISPLAY[slot]}: 无`);
                continue;
            }
            const detail = safe(() => getEquipmentById(id), `getEquipmentById(${id})`);
            if (!detail) {
                equipLines.push(`${SLOT_DISPLAY[slot]}: 无`);
                continue;
            }
            const ks = keyStats(detail, slot, 3);
            equipLines.push(`${SLOT_DISPLAY[slot]}: ${detail.name}${ks ? `(${ks})` : ''}`);
        }
    }
    if (equipLines.length) {
        sections.push({ label: '装备', text: equipLines.join(' | '), priority: 3 });
    }

    // ---- 4. 技能 ----
    const skills = player.skills;
    if (skills?.length) {
        const cap = 10;
        const skillTexts = skills.slice(0, cap).map(s => {
            const detail = safe(() => getSkillById(s.skill_id), `getSkillById(${s.skill_id})`);
            const skName = detail?.name || s.name || '?';
            const prof = s.proficiency ?? '?';
            return `${skName}(熟练${prof})`;
        });
        if (skills.length > cap) {
            skillTexts.push(`还有${skills.length - cap}个...`);
        }
        sections.push({ label: '技能', text: skillTexts.join(' | '), priority: 4 });
    }

    // ---- 5. 任务 ----
    const questText = projectQuestSummary() || '无';
    sections.push({ label: '任务', text: questText, priority: 5 });

    // ---- 6. 背包 / 货币 ----
    const invParts = [];
    const inv = safe(() => getInventoryStore(), 'getInventoryStore');
    if (inv?.items?.length) {
        const cap = 15;
        const items = inv.items.slice(0, cap).map(item => {
            const itemName = item.name || item.item_id || '?';
            return item.qty > 1 ? `${itemName}x${item.qty}` : itemName;
        });
        if (inv.items.length > cap) {
            items.push(`还有${inv.items.length - cap}个...`);
        }
        invParts.push(`物品: ${items.join(', ')}`);
    }
    try {
        const cor = getCurrency();
        if (cor != null) invParts.push(`珂尔: ${cor}`);
    } catch { /* ignore */ }
    if (invParts.length) {
        sections.push({ label: '背包/货币', text: invParts.join(' | '), priority: 6 });
    }

    // ---- 组装 ----
    let result = sections.map(s => `【${s.label}】${s.text}`).join('\n');

    // ---- 超长折叠（上限 1000 字符） ----
    const MAX_LEN = 1000;
    if (result.length > MAX_LEN) {
        // 从最低优先级开始裁剪（背包 → 任务 → 技能），装备永不裁剪
        const foldable = sections
            .filter(s => s.priority >= 4)
            .sort((a, b) => b.priority - a.priority);

        let foldedCount = 0;
        for (const sec of foldable) {
            if (result.length <= MAX_LEN) break;
            const header = `【${sec.label}】`;
            // 移除该区块（带换行或不带）
            result = result.replace(`${header}${sec.text}\n`, '');
            result = result.replace(`\n${header}${sec.text}`, '');
            result = result.replace(`${header}${sec.text}`, '');
            foldedCount++;
        }
        if (foldedCount > 0) {
            result += `\n已折叠${foldedCount}项`;
        }
    }

    return stripIds(result);
}

/**
 * 投影装备摘要（用于 specialist 装备提示）。
 * 格式: `主手:阐释者(ATK40,STR10) | 副手:无 | 身:黑衣(AGI5,VIT10)`
 *
 * @returns {string} 装备摘要，无装备时返回空字符串
 */
export function projectEquipmentSummary() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player?.equipment) return '';

    const parts = [];
    for (const slot of SLOT_ORDER) {
        const id = player.equipment[slot];
        if (!id) {
            parts.push(`${SLOT_DISPLAY[slot]}:无`);
            continue;
        }
        const detail = safe(() => getEquipmentById(id), `getEquipmentById(${id})`);
        if (!detail) {
            parts.push(`${SLOT_DISPLAY[slot]}:无`);
            continue;
        }
        const ks = keyStats(detail, slot, 2);
        parts.push(`${SLOT_DISPLAY[slot]}:${detail.name}${ks ? `(${ks})` : ''}`);
    }

    return stripIds(parts.join(' | '));
}

/**
 * 投影技能摘要（用于 specialist 技能提示）。
 * 格式: `水平方阵斩(熟练3) | 垂直方阵斩(熟练2) | 治疗(熟练1)`
 *
 * @returns {string} 技能摘要，无技能时返回空字符串
 */
export function projectSkillSummary() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player?.skills?.length) return '';

    const cap = 10;
    const shown = player.skills.slice(0, cap).map(s => {
        const detail = safe(() => getSkillById(s.skill_id), `getSkillById(${s.skill_id})`);
        const skName = detail?.name || s.name || '?';
        const prof = s.proficiency ?? '?';
        return `${skName}(熟练${prof})`;
    });

    if (player.skills.length > cap) {
        shown.push(`还有${player.skills.length - cap}个...`);
    }

    return stripIds(shown.join(' | '));
}

/**
 * 投影状态提示（用于 status specialist prompt 构造）。
 * 替代旧的 stateHint + equipHint + skillHint 模式。
 * 格式: `桐人 Lv25 HP:585/585 MP:120/120 STR:50 AGI:60 | 装备:阐释者(ATK40) | 技能:水平方阵斩(熟练3)`
 *
 * @returns {string} 状态提示，store 不可用时返回空字符串
 */
export function projectStateHint() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player) return '';

    const parts = [];

    // 基础
    if (player.identity?.name) parts.push(player.identity.name);
    if (player.progression?.level != null) parts.push(`Lv${player.progression.level}`);

    // HP / MP（含战斗软守卫）
    if (player.vitals) {
        const combat = isInCombat();
        const combatHp = combat ? getCombatHp() : null;
        const v = player.vitals;
        const hp    = combatHp?.hp    ?? v.hp    ?? 0;
        const maxHp = combatHp?.maxHp ?? v.maxHp ?? 0;
        parts.push(`HP:${hp}/${maxHp}${combat ? ' (战斗中)' : ''}`);
        parts.push(`MP:${v.mp ?? 0}/${v.maxMp ?? 0}`);
    }

    // 属性
    const attr = player.attributes;
    if (attr) {
        if (attr.str != null) parts.push(`STR:${attr.str}`);
        if (attr.agi != null) parts.push(`AGI:${attr.agi}`);
        if (attr.int != null) parts.push(`INT:${attr.int}`);
        if (attr.vit != null) parts.push(`VIT:${attr.vit}`);
    }

    const mainParts = [parts.join(' ')];

    // 装备摘要（简短：仅主手）
    const equip = player.equipment;
    if (equip?.weapon) {
        const detail = safe(() => getEquipmentById(equip.weapon), `getEquipmentById(${equip.weapon})`);
        if (detail) {
            const ks = keyStat(detail, 'weapon');
            mainParts.push(`装备:${detail.name}${ks ? `(${ks})` : ''}`);
        }
    }

    // 技能摘要（简短：前 3 个）
    const skills = player.skills;
    if (skills?.length) {
        const shown = skills.slice(0, 3).map(s => {
            const detail = safe(() => getSkillById(s.skill_id), `getSkillById(${s.skill_id})`);
            const skName = detail?.name || s.name || '?';
            const prof = s.proficiency ?? '?';
            return `${skName}(熟练${prof})`;
        });
        if (skills.length > 3) shown.push('...');
        mainParts.push(`技能:${shown.join(',')}`);
    }

    return stripIds(mainParts.join(' | '));
}

/**
 * 投影已知 NPC 名单（一行摘要，注入 status specialist prompt）。
 * 格式：亚丝娜(搭档,好感15) | 克莱因(朋友,好感5)
 * 只列出有 state 变化的 NPC（relationship/affinity/location/status 非空）。
 * @returns {string}
 */
export function projectNpcHint() {
    try {
        const store = getStore();
        if (!store?.npcStore?.byId) return '';
        const npcs = Object.values(store.npcStore.byId);
        const active = npcs.filter(npc => {
            const s = npc.state || {};
            return s.relationship || s.affinity || s.location || (s.status && s.status.length);
        });
        if (active.length === 0) return '';
        return active.map(npc => {
            const s = npc.state || {};
            const parts = [];
            if (s.relationship) parts.push(s.relationship);
            if (s.affinity) parts.push(`好感${s.affinity}`);
            return parts.length > 0 ? `${npc.name}(${parts.join(',')})` : npc.name;
        }).join(' | ');
    } catch (e) { return ''; }
}

/**
 * 投影 NPC 面板数据（结构化数组，供状态面板渲染）。
 * 只显示有实际 state 数据的 NPC（至少一个 state 字段非空，或有 observations）。
 * @returns {Array|null}
 */
export function renderNpcPanel() {
    try {
        const store = getStore();
        if (!store?.npcStore?.byId) return null;
        const npcs = Object.values(store.npcStore.byId);
        // 只显示有 state 数据的 NPC：relationship/affinity/location/status 非空，或 observations 非空
        const active = npcs.filter(npc => {
            if (!npc || !npc.name) return false;
            const s = npc.state || {};
            return s.relationship || s.affinity || s.location || (s.status && s.status.length)
                || (npc.observations && npc.observations.length);
        });
        if (active.length === 0) return null;
        return active.map(npc => ({
            name: npc.name,
            relationship: npc.state?.relationship || '',
            affinity: npc.state?.affinity || 0,
            floor_id: npc.state?.floor_id || null,
            location: npc.state?.location || '',
            status: npc.state?.status || [],
            last_seen_date: npc.state?.last_seen_date || null,
            observations: npc.observations || [],
        }));
    } catch (e) { return null; }
}

/**
 * 投影任务摘要（用于状态面板任务区）。
 * 从 questStore.activeIds 读取活跃任务，格式化为 HTML 字符串。
 * @returns {string} HTML 字符串，无活跃任务时返回空字符串
 */
export function projectQuestSummary() {
    try {
        const questPanel = renderQuestPanel();
        if (!questPanel?.active?.length) return '';

        const parts = questPanel.active.map(q => {
            const title = esc(q.title);
            const summary = q.summary ? ` — ${esc(q.summary)}` : '';
            const objectives = q.objectives?.length
                ? '<br>' + q.objectives.map(o => {
                    const check = o.done ? '☑' : '☐';
                    return `${check} ${esc(o.text)}`;
                }).join('<br>')
                : '';
            return `<b>${title}</b>${summary}${objectives}`;
        });

        return parts.join('<br><br>');
    } catch (e) {
        log(`[projection] projectQuestSummary 失败: ${e.message}`, 'warn');
        return '';
    }
}

// ============================================================
// C1: 结构化数据投影函数（返回数据对象，非 HTML）
// ============================================================

/**
 * 投影基本信息（返回数据对象，非 HTML）。
 * @returns {{ name: string, title: string }|null}
 */
export function renderPlayerStatusPanel() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player) return null;
    return {
        name: player.identity?.name || '',
        title: player.identity?.title || '',
        cursor_type: player.cursor_type || 'green',
    };
}

/**
 * 投影等级与属性（返回数据对象，含战斗软守卫）。
 * @returns {object|null}
 */
export function renderLevelAttributesPanel() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player) return null;
    const combat = isInCombat();
    const combatHp = combat ? getCombatHp() : null;
    const v = player.vitals || {};
    return {
        level: player.progression?.level ?? null,
        totalExp: player.progression?.totalExp ?? null,
        str: player.attributes?.str ?? null,
        agi: player.attributes?.agi ?? null,
        int: player.attributes?.int ?? null,
        vit: player.attributes?.vit ?? null,
        hp: combatHp?.hp ?? v.hp ?? null,
        maxHp: combatHp?.maxHp ?? v.maxHp ?? null,
        mp: v.mp ?? null,
        maxMp: v.maxMp ?? null,
        floorId: player.position?.floor_id ?? null,
        location: player.position?.location ?? '',
        inCombat: combat,
    };
}

/**
 * 投影装备（返回数据数组，每项含 slot/name/stats）。
 * null 槽位也包含在结果中（name=null）。
 * @returns {Array<{ slot: string, slotDisplay: string, equipId: string|null, name: string|null, keyStats: string }>|null}
 */
export function renderEquipmentPanel() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player?.equipment) return null;
    const result = [];
    for (const slot of SLOT_ORDER) {
        const id = player.equipment[slot];
        if (!id) {
            result.push({ slot, slotDisplay: SLOT_DISPLAY[slot], equipId: null, name: null, keyStats: '' });
            continue;
        }
        const detail = safe(() => getEquipmentById(id), `getEquipmentById(${id})`);
        if (!detail) {
            result.push({ slot, slotDisplay: SLOT_DISPLAY[slot], equipId: id, name: null, keyStats: '' });
            continue;
        }
        const ks = keyStats(detail, slot, 3);
        result.push({ slot, slotDisplay: SLOT_DISPLAY[slot], equipId: id, name: detail.name, keyStats: ks });
    }
    return result;
}

/**
 * 投影技能（返回数据数组，每项含 skill_id/name/proficiency/combat）。
 * @returns {Array<{ skill_id: string, name: string, proficiency: number, combat: object|null }>|null}
 */
export function renderSkillPanel() {
    const player = safe(() => getPlayerStore(), 'getPlayerStore');
    if (!player?.skills?.length) return null;
    return player.skills.map(s => {
        const detail = safe(() => getSkillById(s.skill_id), `getSkillById(${s.skill_id})`);
        return {
            skill_id: s.skill_id,
            name: detail?.name || s.name || '?',
            proficiency: s.proficiency ?? 0,
            combat: detail?.combat || null,
        };
    });
}

/**
 * 投影背包/货币（返回数据对象）。
 * @returns {{ cor: number, items: Array<{ name: string, qty: number, type: string, description?: string }> }|null}
 */
export function renderInventoryPanel() {
    const inv = safe(() => getInventoryStore(), 'getInventoryStore');
    let cor = 0;
    try { cor = getCurrency() || 0; } catch { /* ignore */ }
    const items = (inv?.items || []).map(item => ({
        name: item.name || item.item_id || '?',
        qty: item.qty || 1,
        type: item.type || 'unknown',
        ...(item.item_id ? { item_id: item.item_id } : {}),
        ...(item.description ? { description: item.description } : {}),
    }));
    return { cor, items };
}

/**
 * 投影任务面板（返回结构化数据对象，非 HTML）。
 * 参照 renderEquipmentPanel / renderSkillPanel 的风格。
 * @returns {{ active: Array, completed: Array }|null}
 */
export function renderQuestPanel() {
    const store = safe(() => getQuestStore(), 'getQuestStore');
    if (!store) return null;
    const mapQuest = (q) => ({
        quest_id: q.quest_id,
        title: q.title || '未知任务',
        summary: q.summary || '',
        status: q.status,
        objectives: (q.objectives || []).map(o => ({
            text: o.text || o.description || '',
            done: !!o.done,
        })),
    });
    return {
        active: (store.activeIds || []).map(id => store.byId[id]).filter(Boolean).map(mapQuest),
        completed: (store.completedIds || []).map(id => store.byId[id]).filter(Boolean).map(mapQuest),
    };
}

/**
 * 投影状态面板 HTML（用于 Shadow DOM 渲染）。
 * 内部调用 C1 结构化数据函数，再转换为 HTML。
 *
 * @returns {string|null} HTML 字符串，store 不可用时返回 null（让 renderUserStatus 回退）
 */
export function projectStatusPanelHtml() {
    const playerPanel = renderPlayerStatusPanel();
    if (!playerPanel) return null;
    const levelPanel = renderLevelAttributesPanel();
    if (!levelPanel) return null;
    // 检查是否有任何有意义的数据（至少有名字或等级）
    if (!playerPanel.name && levelPanel.level == null) return null;

    const sections = [];

    // ---- 1. 基本信息（HUD 角色信息区） ----
    const cursorText = CURSOR_LABELS[playerPanel.cursor_type] || CURSOR_LABELS.green;
    const cursorLabel = cursorText.replace(/^\S+\s*/, '');
    const cursorClass = `sao-cursor-${esc(playerPanel.cursor_type || 'green')}`;
    const locationParts = [];
    if (levelPanel.floorId != null) locationParts.push(`${levelPanel.floorId}F`);
    if (levelPanel.location) locationParts.push(levelPanel.location);
    const locationText = locationParts.join(' · ');

    sections.push(
        `<details data-sao-section="info">
            <summary>基本信息</summary>
            <div class="sao-hud-card">
                <div class="sao-hud-header">
                    <div>
                        <div class="sao-hud-name">${esc(playerPanel.name || '未知')}</div>
                        ${playerPanel.title ? `<div class="sao-hud-title">${esc(playerPanel.title)}</div>` : ''}
                    </div>
                    <span class="sao-cursor-badge ${cursorClass}"><span class="sao-cursor-hex"></span><span class="sao-cursor-text">${esc(cursorLabel)}</span></span>
                </div>
                ${locationText ? `<div class="sao-hud-sub">${esc(locationText)}</div>` : ''}
            </div>
        </details>`
    );

    // ---- 2. 等级与属性（HUD 生命与属性区） ----
    const hp = levelPanel.hp ?? 0;
    const maxHp = levelPanel.maxHp ?? 0;
    const mp = levelPanel.mp ?? 0;
    const maxMp = levelPanel.maxMp ?? 0;
    const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;
    const mpPct = maxMp > 0 ? Math.max(0, Math.min(100, Math.round((mp / maxMp) * 100))) : 0;
    const hpLowClass = hpPct < 25 ? 'sao-bar-hp-low' : '';

    const attrList = [
        { label: 'STR', val: levelPanel.str },
        { label: 'AGI', val: levelPanel.agi },
        { label: 'INT', val: levelPanel.int },
        { label: 'VIT', val: levelPanel.vit },
    ].filter(a => a.val != null);
    const statGrid = attrList.length
        ? `<div class="sao-stat-grid">${attrList.map(a =>
            `<div class="sao-stat-item"><div class="sao-stat-value">${a.val}</div><div class="sao-stat-label">${a.label}</div></div>`
        ).join('')}</div>`
        : '';

    const metaParts = [];
    if (levelPanel.level != null) metaParts.push(`Lv.${levelPanel.level}`);
    if (levelPanel.totalExp != null) metaParts.push(`EXP ${levelPanel.totalExp}`);
    if (levelPanel.inCombat) metaParts.push('战斗中');
    const metaLine = metaParts.length ? `<div class="sao-hud-meta">${esc(metaParts.join(' | '))}</div>` : '';

    sections.push(
        `<details data-sao-section="vitals">
            <summary>等级与属性</summary>
            <div class="sao-hud-card">
                <div class="sao-bar-row">
                    <div class="sao-bar-labels"><span>HP</span><span>${hp}/${maxHp}</span></div>
                    <div class="sao-bar-container"><div class="sao-bar sao-bar-hp ${hpLowClass}" style="width:${hpPct}%"></div></div>
                </div>
                <div class="sao-bar-row">
                    <div class="sao-bar-labels"><span>MP</span><span>${mp}/${maxMp}</span></div>
                    <div class="sao-bar-container"><div class="sao-bar sao-bar-mp" style="width:${mpPct}%"></div></div>
                </div>
                ${statGrid}
                ${metaLine}
            </div>
        </details>`
    );

    // ---- 3. 装备（HUD 装备槽网格 + 背包装备） ----
    const equipData = renderEquipmentPanel();
    if (equipData) {
        const equippedSlots = equipData.map(e => {
            // Bug3: 空槽位只显示"无"，无卸下按钮；有 equipId 才渲染卸下按钮
            if (!e.name) {
                return `<div class="sao-equip-slot"><div class="sao-equip-slot-label">${esc(e.slotDisplay)}</div><div class="sao-equip-item sao-equip-empty">无</div></div>`;
            }
            return `<div class="sao-equip-slot">
                <div class="sao-equip-slot-label">${esc(e.slotDisplay)}</div>
                <div class="sao-equip-item">${esc(e.name)}</div>
                ${e.keyStats ? `<div class="sao-equip-stats">${esc(e.keyStats)}</div>` : ''}
                ${e.equipId ? `<button class="sao-equip-btn" data-sao-action="unequip" data-sao-slot="${e.slot}" title="卸下装备">↓</button>` : ''}
            </div>`;
        }).join('');

        let backpackHtml = '';
        const inv = safe(() => getInventoryStore(), 'getInventoryStore');
        const equipItems = inv?.items?.filter(item => item.type === 'equipment') || [];
        if (equipItems.length) {
            const backpackSlots = equipItems.map(item => {
                const detail = safe(() => getEquipmentById(item.equipment_id), `getEquipmentById(${item.equipment_id})`);
                const name = detail?.name || item.equipment_id || '?';
                const ks = detail ? keyStats(detail, detail.slot, 2) : '';
                return `<div class="sao-equip-slot">
                    <div class="sao-equip-item">${esc(name)}</div>
                    ${ks ? `<div class="sao-equip-stats">${esc(ks)}</div>` : ''}
                    <button class="sao-equip-btn" data-sao-action="equip" data-sao-equip-id="${item.equipment_id}" title="穿戴装备">↑</button>
                </div>`;
            }).join('');
            backpackHtml = `<div class="sao-equip-backpack-title">背包装备</div><div class="sao-equip-grid">${backpackSlots}</div>`;
        }

        sections.push(
            `<details data-sao-section="equip">
                <summary>装备</summary>
                <div class="sao-hud-card">
                    <div class="sao-equip-grid">${equippedSlots}</div>
                    ${backpackHtml}
                </div>
            </details>`
        );
    }

    // ---- 4. 技能（HUD 技能折叠卡） ----
    const skillData = renderSkillPanel();
    if (skillData) {
        const cap = 15;
        const skillItems = skillData.slice(0, cap).map(s => {
            const combat = s.combat || {};
            const combatParts = [];
            if (combat.atk) combatParts.push(`ATK:${combat.atk}`);
            if (combat.hit) combatParts.push(`HIT:${combat.hit}`);
            if (combat.crit) combatParts.push(`CRIT:${combat.crit}`);
            if (combat.mpCost) combatParts.push(`MP:${combat.mpCost}`);
            if (combat.cd) combatParts.push(`CD:${combat.cd}`);
            if (combatParts.length) {
                return `<details class="sao-skill-details">
                    <summary><b>${esc(s.name)}</b><small>熟练${s.proficiency}</small></summary>
                    <div class="sao-skill-combat">${esc(combatParts.join(' '))}</div>
                </details>`;
            }
            return `<div class="sao-skill-item"><b>${esc(s.name)}</b><span class="sao-text-muted"> · 熟练${s.proficiency}</span></div>`;
        });
        if (skillData.length > cap) {
            skillItems.push(`<div class="sao-text-muted">还有${skillData.length - cap}个...</div>`);
        }
        sections.push(
            `<details data-sao-section="skills">
                <summary>技能</summary>
                <div class="sao-hud-card"><div class="sao-skill-list">${skillItems.join('')}</div></div>
            </details>`
        );
    }

    // ---- 5. 任务（HUD 任务卡 + 添加表单 + 已完成折叠） ----
    const questPanel = renderQuestPanel();
    let questContent = '';
    if (questPanel?.active?.length) {
        questContent = questPanel.active.map(q => {
            const summary = q.summary ? `<div class="sao-text-secondary">${esc(q.summary)}</div>` : '';
            const objectives = q.objectives?.length
                ? `<ul class="sao-quest-objectives">${q.objectives.map(o =>
                    `<li>${o.done ? '☑' : '☐'} ${esc(o.text)}</li>`
                ).join('')}</ul>`
                : '';
            return `<div class="sao-quest-card">
                <div class="sao-quest-header">
                    <b>${esc(q.title)}</b>
                    <button class="sao-quest-btn" data-sao-action="complete-quest" data-sao-quest-id="${q.quest_id}" title="完成任务">✓</button>
                </div>
                ${summary}
                ${objectives}
            </div>`;
        }).join('');
    }
    if (!questContent) {
        questContent = '<div class="sao-empty">暂无活跃任务</div>';
    }
    const addQuestForm = `<div class="sao-quest-add"><input type="text" data-sao-quest-input placeholder="输入任务标题..." /> <button class="sao-quest-btn" data-sao-action="add-quest" title="添加任务">+</button></div>`;
    const completed = questPanel?.completed || [];
    const completedHtml = completed.length
        ? `<details class="sao-quest-completed"><summary>已完成任务 (${completed.length})</summary><div class="sao-text-secondary">${completed.map(q => `<div>${esc(q.title)}</div>`).join('')}</div></details>`
        : '';
    sections.push(
        `<details data-sao-section="quests">
            <summary>任务</summary>
            <div class="sao-hud-card">
                ${questContent}
                ${addQuestForm}
                ${completedHtml}
            </div>
        </details>`
    );

    // ---- 6. 背包 / 货币（HUD 物品标签 + 珂尔） ----
    const invData = renderInventoryPanel();
    if (invData) {
        let itemsHtml = '';
        if (invData.items.length) {
            const cap = 20;
            const tags = invData.items.slice(0, cap).map(item => {
                const qtyText = item.qty > 1 ? ` x${item.qty}` : '';
                const useBtn = (item.type === 'consumable' && item.item_id)
                    ? `<button class="sao-equip-btn" data-sao-action="use-consumable" data-item-id="${item.item_id}" title="使用">✓</button>`
                    : '';
                return `<span class="sao-tag">${esc(item.name)}${qtyText}${useBtn}</span>`;
            });
            if (invData.items.length > cap) {
                tags.push(`<span class="sao-text-muted">还有${invData.items.length - cap}个...</span>`);
            }
            itemsHtml = `<div class="sao-inv-tags">${tags.join('')}</div>`;
        } else {
            itemsHtml = '<div class="sao-empty">背包空空如也</div>';
        }
        const corHtml = invData.cor != null ? `<div class="sao-cor-row"><b>珂尔</b><span>${invData.cor}</span></div>` : '';
        sections.push(
            `<details data-sao-section="inventory">
                <summary>背包 / 货币</summary>
                <div class="sao-hud-card">
                    ${itemsHtml}
                    ${corHtml}
                </div>
            </details>`
        );
    }

    // ---- 7. NPC 关系（HUD NPC 迷你卡） ----
    const npcData = renderNpcPanel();
    if (npcData && npcData.length > 0) {
        const npcCards = npcData.map(npc => {
            const tags = [];
            if (npc.relationship) tags.push(`<span class="sao-npc-tag sao-npc-tag-rel">${esc(npc.relationship)}</span>`);
            if (npc.affinity) tags.push(`<span class="sao-npc-tag">${esc(`好感${npc.affinity}`)}</span>`);
            if (npc.location) tags.push(`<span class="sao-npc-tag">${esc(npc.location)}</span>`);
            if (npc.status && npc.status.length) tags.push(`<span class="sao-npc-tag">${esc(npc.status.join(','))}</span>`);
            const metaParts = [];
            if (npc.floor_id != null) metaParts.push(`${npc.floor_id}F`);
            const meta = metaParts.length ? `<div class="sao-npc-meta">${esc(metaParts.join(' · '))}</div>` : '';
            return `<div class="sao-npc-card">
                <div class="sao-npc-name">${esc(npc.name)}<span class="sao-npc-tags">${tags.join('')}</span></div>
                ${meta}
            </div>`;
        }).join('');
        sections.push(
            `<details data-sao-section="npcs">
                <summary>NPC</summary>
                <div class="sao-hud-card">${npcCards}</div>
            </details>`
        );
    }

    // ---- 组装 ----
    if (!sections.length) return null;
    return sections.join('\n');
}
