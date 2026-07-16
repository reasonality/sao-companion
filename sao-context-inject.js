// sao-context-inject.js — 三层上下文注入系统 (Layer 2: Contextual Canon Injection)
// 关键词触发 NPC/楼层档案 + 全量规则 + 日历 ±7天 + NPC 摘要块
// 被 sao-prompt.js injectMemoryAndState() 调用，输出追加到 per-turn 状态注入

import { getCurrentCharacter, log } from './sao-core.js';
import { getStore } from './sao-store-core.js';
import { getNpcByName } from './sao-store-npc.js';
import { getFloorByNumber } from './sao-store-floor.js';
import { getCharacterInfoFromSources } from './sao-tools.js';
import { getAllGuilds, getPlayerGuild } from './sao-store-guild.js';
import { getPlayerHousing, isPlayerAtHome } from './sao-store-housing.js';

// ============================================================
// 常量
// ============================================================

/** 规则条目 comment 前缀 — 始终注入（非关键词触发） */
const RULE_COMMENT_PATTERNS = [
    'sao-PK机制', 'sao-经济系统', 'sao-等级', 'sao-技能',
    'sao-剑技获取', 'sao-冥想', 'sao-房屋', 'sao-NPC档案构建规则',
];

// ============================================================
// 公共 API
// ============================================================

/**
 * 构建上下文注入文本（关键词触发 NPC/楼层档案 + 全量规则 + 日历 ±7天 + NPC 摘要块）。
 * @param {string} recentText - 最近 3 条消息拼接文本
 * @returns {string} 要追加到 per-turn 注入的文本，或空字符串
 */
export function buildContextualInjection(recentText) {
    try {
        const char = getCurrentCharacter();
        const entries = char?.data?.character_book?.entries || [];
        const npcStore = getStore()?.npcStore;

        // 无世界书条目且无 npcStore → 跳过
        if (!entries.length && !npcStore?.byId) return '';

        const recentLower = (recentText || '').toLowerCase();
        const allParts = [];

        // ──── 1. NPC 摘要块（始终注入，当前章节主要 NPC） ────
        const summaryBlock = buildNpcSummaryBlock(entries);
        if (summaryBlock) allParts.push(summaryBlock);

        // ──── 1.5. 已发现公会摘要（始终注入已发现的公会） ────
        const guildBlock = buildGuildBlock();
        if (guildBlock) allParts.push(guildBlock);

        // ──── 1.7. 住所信息（当玩家有房时注入） ────
        const housingBlock = buildHousingBlock();
        if (housingBlock) allParts.push(housingBlock);

        // ──── 2. 关键词触发 NPC 档案（上限 5） ────
        if (recentLower) {
            const npcProfileBlocks = buildNpcKeywordProfiles(entries, recentLower);
            if (npcProfileBlocks.length) allParts.push(npcProfileBlocks.join('\n\n'));

            // ──── 3. 关键词触发楼层档案（上限 2） ────
            const floorProfileBlocks = buildFloorKeywordProfiles(entries, recentLower);
            if (floorProfileBlocks.length) allParts.push(floorProfileBlocks.join('\n\n'));
        }

        // ──── 4. 全量活跃规则条目（始终注入，无上限） ────
        const ruleBlocks = buildRuleBlocks(entries);
        if (ruleBlocks.length) allParts.push(ruleBlocks.join('\n\n'));

        // ──── 5. 日历 ±7天（上限 30 事件） ────
        const calendarBlock = buildCalendarBlock();
        if (calendarBlock) allParts.push(calendarBlock);

        return allParts.join('\n\n');
    } catch (e) {
        log('buildContextualInjection 失败: ' + e.message, 'warn');
        return '';
    }
}

/**
 * 便捷包装：调用 buildContextualInjection 并返回字符串。
 * 调用方负责实际的 setExtensionPrompt。
 * @param {string} recentText
 * @returns {string}
 */
export function injectContextualCanon(recentText) {
    return buildContextualInjection(recentText);
}

// ============================================================
// 内部构建函数
// ============================================================

/**
 * NPC 摘要块：列出当前世界书 NPC 的一行状态。
 * "来源" = npcStore.source==='worldbook' + 世界书条目 comment 匹配 NPC 名称。
 * @param {Array} entries - character_book.entries
 * @returns {string}
 */
function buildNpcSummaryBlock(entries) {
    const npcStore = getStore()?.npcStore;
    if (!npcStore?.byId) return '';

    const summaryNpcs = [];
    for (const npc of Object.values(npcStore.byId)) {
        if (npc.source !== 'worldbook') continue;

        // 查找该 NPC 对应的世界书条目
        const entry = entries.find(e => {
            const keys = (e.keys || []).map(k => k.trim());
            const comment = (e.comment || '').trim();
            return keys[0] === npc.name || comment.includes(npc.name);
        });
        if (!entry) continue;

        const parts = [npc.name];
        if (npc.state?.relationship) parts.push(npc.state.relationship);
        if (npc.state?.affinity != null) parts.push(`好感${npc.state.affinity}`);
        if (npc.state?.floor_id) parts.push(`${npc.state.floor_id}F`);
        if (npc.uniqueSkill?.name) parts.push(`独特技能:${npc.uniqueSkill.name}`);
        summaryNpcs.push(parts.join(','));
    }

    return summaryNpcs.length ? `[已知NPC]\n${summaryNpcs.join(' | ')}` : '';
}

/**
 * 关键词触发 NPC 完整档案（上限 5）。
 * 扫描世界书 NPC 条目的 keys 是否出现在 recentLower 中。
 * @param {Array} entries
 * @param {string} recentLower - 小写化的最近消息文本
 * @returns {string[]}
 */
function buildNpcKeywordProfiles(entries, recentLower) {
    // 主动注入：仅处理 disabled 条目（enabled 条目由 ST 原生世界书注入，避免重复）。
    // SAO NPC 档案在重排后是 disabled，由这里按关键词触发注入；
    // 现实 NPC 档案是 enabled，由 ST 按 keys 触发注入。
    const npcEntries = entries.filter(e =>
        e.disable === true && (e.content || '').includes('characterProfile')
    );

    const matchedNpcs = [];
    for (const e of npcEntries) {
        const keys = (e.keys || []).map(k => k.toLowerCase());
        if (keys.some(k => recentLower.includes(k))) {
            const npcName = (e.keys || [])[0] || (e.comment || '').trim();
            if (!matchedNpcs.includes(npcName)) {
                matchedNpcs.push(npcName);
            }
            if (matchedNpcs.length >= 5) break;
        }
    }

    const blocks = [];
    for (const npcName of matchedNpcs) {
        const npc = getNpcByName(npcName);
        const liveCanon = getCharacterInfoFromSources(npcName, 'full');
        const lines = [`[相关NPC] ${npcName}`];

        if (liveCanon && !liveCanon.startsWith('未找到') && liveCanon.length > 10) {
            lines.push(`[档案]\n${liveCanon}`);
        }
        if (npc?.state?.relationship) lines.push(`[当前关系] ${npc.state.relationship}`);
        if (npc?.state?.affinity != null) lines.push(`[好感] ${npc.state.affinity}`);
        if (npc?.uniqueSkill?.name) lines.push(`[独特技能] ${npc.uniqueSkill.name}`);
        if (npc?.observations?.length) {
            lines.push('[最近观察]');
            lines.push(...npc.observations.slice(-5).map(o => `- ${o}`));
        }
        blocks.push(lines.join('\n'));
    }
    return blocks;
}

/**
 * 关键词触发楼层完整档案（上限 2）。
 * 扫描世界书楼层条目的 keys 是否出现在 recentLower 中。
 * @param {Array} entries
 * @param {string} recentLower
 * @returns {string[]}
 */
function buildFloorKeywordProfiles(entries, recentLower) {
    // 主动注入：楼层条目在重排后全 disabled，由这里按关键词触发注入。
    const floorEntries = entries.filter(e =>
        e.disable === true && /第\d+层/.test(e.comment || '')
    );

    const matchedFloors = [];
    for (const e of floorEntries) {
        const keys = (e.keys || []).map(k => k.toLowerCase());
        if (keys.some(k => recentLower.includes(k))) {
            const m = (e.comment || '').match(/第(\d+)层/);
            if (m) {
                const floorNum = parseInt(m[1]);
                if (!matchedFloors.includes(floorNum)) {
                    matchedFloors.push(floorNum);
                }
                if (matchedFloors.length >= 2) break;
            }
        }
    }

    const blocks = [];
    for (const floorNum of matchedFloors) {
        const floorEntry = getFloorByNumber(floorNum);
        const lines = [`[相关楼层] 第${floorNum}层`];
        const canon = floorEntry?.canon;

        if (canon) {
            if (canon.theme) lines.push(`[主题] ${canon.theme}`);
            if (canon.intro) lines.push(`[简介] ${canon.intro}`);
            if (canon.mainTown) lines.push(`[主城] ${canon.mainTown}`);
            if (canon.mainCityDesc) lines.push(`[主城描述] ${canon.mainCityDesc}`);
            if (canon.labyrinthLocation) lines.push(`[迷宫位置] ${canon.labyrinthLocation}`);
            if (canon.labyrinthDesc) lines.push(`[迷宫描述] ${canon.labyrinthDesc}`);
            if (canon.boss) lines.push(`[楼层Boss] ${canon.boss}`);
            if (canon.bossDesc) lines.push(`[Boss描述] ${canon.bossDesc}`);
            if (canon.attackPoint) {
                lines.push(`[攻略据点] ${canon.attackPoint.name || ''}`);
                if (canon.attackPoint.description) lines.push(`[据点描述] ${canon.attackPoint.description}`);
            }
            if (Array.isArray(canon.landmarks) && canon.landmarks.length > 0) {
                lines.push('[地标]');
                for (const lm of canon.landmarks) {
                    lines.push(`- ${lm.name || ''}: ${lm.description || ''}`);
                }
            }
            if (Array.isArray(canon.villages) && canon.villages.length > 0) {
                lines.push('[村庄]');
                for (const v of canon.villages) {
                    lines.push(`- ${v.name || ''}${v.location ? ' (' + v.location + ')' : ''}: ${v.description || ''}`);
                }
            }
            if (Array.isArray(canon.fieldBosses) && canon.fieldBosses.length > 0) {
                lines.push('[区域Boss]');
                for (const fb of canon.fieldBosses) {
                    const parts = [fb.name || ''];
                    if (fb.location) parts.push(`位置:${fb.location}`);
                    if (fb.description) parts.push(fb.description);
                    if (fb.dropItem) parts.push(`掉落:${fb.dropItem}`);
                    lines.push(`- ${parts.join(' | ')}`);
                }
            }
        }

        if (floorEntry?.state?.cleared) lines.push('[攻略状态] 已攻略');
        else lines.push('[攻略状态] 攻略中');
        if (floorEntry?.state?.notes?.length) {
            lines.push('[探索记录]');
            lines.push(...floorEntry.state.notes.slice(-3).map(n => `- ${n}`));
        }
        blocks.push(lines.join('\n'));
    }
    return blocks;
}

/**
 * 全量活跃规则条目（无上限，非关键词触发）。
 * @param {Array} entries
 * @returns {string[]}
 */
function buildRuleBlocks(entries) {
    // 主动注入：仅注入 disabled 规则条目（enabled 规则如 sao-PK机制/经济/等级由 ST 注入，避免重复）。
    // RULE_COMMENT_PATTERNS 中的 sao-技能/剑技获取/冥想/房屋 在重排后是 disabled，由这里注入。
    const ruleEntries = entries.filter(e =>
        e.disable === true &&
        RULE_COMMENT_PATTERNS.some(p => (e.comment || '').trim().startsWith(p))
    );
    return ruleEntries.map(e => `[规则: ${(e.comment || '').trim()}]\n${e.content || ''}`);
}

/**
 * 已发现公会摘要块。
 * @returns {string}
 */
function buildGuildBlock() {
    const allGuilds = getAllGuilds();
    if (!allGuilds || allGuilds.length === 0) return '';

    const playerGuild = getPlayerGuild();
    const lines = ['[公会信息]'];
    for (const g of allGuilds) {
        const isPlayerGuild = playerGuild && playerGuild.guild_id === g.guild_id;
        const marker = isPlayerGuild ? '★' : '·';
        const buffInfo = g.buff ? ` [${g.buff.name}]` : '';
        const hqInfo = g.headquarters ? ` 据点:${g.headquarters.floor_id}F` : '';
        const memberCount = g.members.length;
        lines.push(`${marker}${g.name} (会长:${g.leader || '?'}, 成员:${memberCount}${buffInfo}${hqInfo})${isPlayerGuild ? ' ← 你的公会' : ''}`);
    }
    return lines.join('\n');
}

/**
 * 日历 ±7天事件块（上限 30 事件）。
 * @returns {string}
 */
function buildCalendarBlock() {
    const calStore = getStore()?.calendarStore;
    const currentDate = calStore?.currentDate;
    if (!currentDate) return '';

    const baseDate = new Date(currentDate + 'T00:00:00');
    const winStart = new Date(baseDate);
    winStart.setDate(winStart.getDate() - 7);
    const winEnd = new Date(baseDate);
    winEnd.setDate(winEnd.getDate() + 7);

    const fmt = d =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const winStartStr = fmt(winStart);
    const winEndStr = fmt(winEnd);

    const calEvents = [];
    if (calStore.events) {
        for (const [dateStr, evArr] of Object.entries(calStore.events)) {
            if (dateStr < winStartStr || dateStr > winEndStr) continue;
            if (!Array.isArray(evArr)) continue;
            for (const ev of evArr) {
                const typeLabel =
                    ev.type === 'canon' ? '[原作]' :
                    ev.type === 'appointment' ? '[约定]' :
                    '[事件]';
                const timeStr = ev.time ? ` ${ev.time}` : '';
                calEvents.push(`${dateStr}${timeStr} ${typeLabel} ${ev.description || ''}`);
            }
        }
    }

    calEvents.sort((a, b) => a.localeCompare(b));

    const parts = [];
    if (calEvents.length) parts.push('[近期日历]\n' + calEvents.join('\n'));

    // Inject current month's notes
    const ym = currentDate.substring(0, 7); // YYYY-MM
    const monthNote = calStore.monthNotes?.[ym];
    if (monthNote) parts.push('[本月备注]\n' + monthNote);

    return parts.length ? parts.join('\n\n') : '';
}

/**
 * 住房信息块（当玩家有房时注入）。
 * @returns {string}
 */
function buildHousingBlock() {
    const housing = getPlayerHousing();
    if (!housing) return '';

    const atHome = isPlayerAtHome();
    const lines = ['[住所信息]'];
    lines.push(`类型: ${housing.type}`);
    lines.push(`位置: ${housing.location || (housing.floor_id ? housing.floor_id + 'F' : '未知')}`);
    if (housing.description) lines.push(`描述: ${housing.description}`);
    if (housing.decorations && housing.decorations.length > 0) {
        lines.push('装修:');
        housing.decorations.forEach(d => lines.push(`  - ${d}`));
    }
    if (housing.furniture && housing.furniture.length > 0) {
        lines.push('家具:');
        housing.furniture.forEach(f => {
            const buffInfo = f.buff ? ` [${f.buff.name}]` : '';
            lines.push(`  - ${f.name}${buffInfo}`);
        });
    }
    if (atHome) lines.push('状态: 现在在家，家具buff生效中');
    return lines.join('\n');
}
