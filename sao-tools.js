// SAO Companion - Tool System & Tool Action Helpers
// Extracted from index.js: function calling tools, effect code table

import { getSaoData, getCurrentCharacter, isSaoCard, log, getContext, bindSaoEvent } from './sao-core.js';
import { initCalendarIfNeeded, queryTimeline, parseDate, formatDate } from './sao-calendar.js';
import { getNpcByName } from './sao-store-npc.js';
import { getFloorByNumber } from './sao-store-floor.js';
import { getStore } from './sao-store-core.js';
import { getWorldStore } from './sao-store-world.js';
import { getGuildByName } from './sao-store-guild.js';
import { event_types } from '../../../events.js';

// ============================================================================
// Effect Code Table (shared by tools and UI)
// ============================================================================

/**
 * 获取效果代码表（内置硬编码，缓存复用）
 */
let _effectCodeTable = null;

export function getEffectCodeTable() {
    if (_effectCodeTable) return _effectCodeTable;

    // 内置硬编码表
    const fallback = {
        A: {
            A1: { label: '伤害输出', fmt: a => `对敌人造成伤害` },
            A2: { label: '生命恢复', fmt: a => `恢复自己或队友的生命值` },
            A3: { label: '法力恢复', fmt: a => `恢复自己或队友的法力值` },
            A4: { label: '牺牲增益', fmt: a => `牺牲生命值获得临时增益` },
            A5: { label: '终结技', fmt: a => `耗尽剩余全AP进行连击，后续每击递减10%` },
        },
        B: {
            B1: { label: '生命窃取',   fmt: a => `将${a[0]||'?'}的伤害转化为自身生命值` },
            B2: { label: '减益·命中',   fmt: a => `${a[0]||'?'}回合内，目标命中率-${a[1]||'?'}` },
            B3: { label: '增益·暴击',   fmt: a => `暴击后${a[0]||'?'}回合内，自身暴击率+${a[1]||'?'}` },
            B4: { label: '触发·晕眩',   fmt: a => `暴击时晕眩目标${a[0]||'?'}回合` },
            B5: { label: '持续伤害',   fmt: a => `${a[0]||'?'}回合内，每回合造成${a[1]||'?'}点伤害` },
            B6: { label: '几率·晕眩',   fmt: a => `${a[0]||'?'}几率晕眩目标${a[1]||'?'}回合` },
            B7: { label: '几率·额外伤害', fmt: a => `${a[0]||'?'}几率造成${a[1]||'?'}额外伤害` },
            B8: { label: '易伤',       fmt: a => `${a[0]||'?'}回合内，目标受到伤害+${a[1]||'?'}` },
            B9: { label: '恢复·法力',   fmt: a => `命中后恢复${a[0]||'?'}点MP` },
            B10:{ label: '恢复·生命',   fmt: a => `${a[0]||'?'}回合内，每回合恢复${a[1]||'?'}点HP` },
            B11:{ label: '增益·力量',   fmt: a => `攻击后${a[0]||'?'}回合内，自身力量+${a[1]||'?'}` },
            B12:{ label: '增益·敏捷',   fmt: a => `攻击后${a[0]||'?'}回合内，自身敏捷+${a[1]||'?'}` },
            B13:{ label: '增益·智力',   fmt: a => `攻击后${a[0]||'?'}回合内，自身智力+${a[1]||'?'}` },
            B14:{ label: '增益·耐力',   fmt: a => `攻击后${a[0]||'?'}回合内，自身耐力+${a[1]||'?'}` },
            B15:{ label: '标记·易伤',   fmt: a => `下一次攻击造成+${a[0]||'?'}额外伤害` },
            B16:{ label: '标记·破绽',   fmt: a => `下一次攻击暴击率+${a[0]||'?'}` },
            B17:{ label: '标记·死点',   fmt: a => `下一次攻击暴击伤害+${a[0]||'?'}` },
            B18:{ label: '叠加·创伤',   fmt: a => `施加${a[0]||'?'}层创伤，每回合${a[1]||'?'}点伤害` },
            B19:{ label: '叠加·腐蚀',   fmt: a => `施加${a[0]||'?'}层腐蚀，受到伤害+${a[1]||'?'}` },
            B20:{ label: '护盾·固化',   fmt: a => `获得${a[0]||'?'}点永久护盾` },
            B21:{ label: '护盾·瞬发',   fmt: a => `获得${a[0]||'?'}点临时护盾(1回合)` },
            B22:{ label: '护盾·持续',   fmt: a => `${a[0]||'?'}回合内，每回合获得${a[1]||'?'}点护盾` },
        },
        S: {
            S1: { label: '力量',   fmt: a => `力量+${a[0]||'?'}` },
            S2: { label: '精准',   fmt: a => `命中率+${a[0]||'?'}%` },
            S3: { label: '致命',   fmt: a => `暴击率+${a[0]||'?'}%` },
            S4: { label: '节能',   fmt: a => `MP消耗+${a[0]||'?'}` },
            S5: { label: '专注',   fmt: a => `ATK+${a[0]||'?'}, 命中率+${a[1]||'?'}%` },
            S6: { label: '锋锐',   fmt: a => `ATK+${a[0]||'?'}, 暴击率+${a[1]||'?'}%` },
            S7: { label: '洞察',   fmt: a => `命中率+${a[0]||'?'}%, 暴击率+${a[1]||'?'}%` },
            S8: { label: '调和',   fmt: a => `ATK+${a[0]||'?'}, MP消耗+${a[1]||'?'}` },
        },
        M: {
            M1: { label: '吸血',   fmt: a => `吸取${a[0]||'?'}伤害值恢复自身HP` },
            M2: { label: '持续伤害', fmt: a => `持续${a[0]||'?'}回合，每回合${a[1]||'?'}点伤害` },
            M3: { label: '力量削弱', fmt: a => `持续${a[0]||'?'}回合，目标力量-${a[1]||'?'}` },
            M4: { label: '敏捷削弱', fmt: a => `持续${a[0]||'?'}回合，目标敏捷-${a[1]||'?'}` },
            M5: { label: '法力燃烧', fmt: a => `持续${a[0]||'?'}回合，每回合燃烧${a[1]||'?'}点MP` },
            M6: { label: '智力削弱', fmt: a => `持续${a[0]||'?'}回合，目标智力-${a[1]||'?'}` },
            M7: { label: '耐力削弱', fmt: a => `持续${a[0]||'?'}回合，目标耐力-${a[1]||'?'}` },
            M8: { label: '敏捷强化', fmt: a => `持续${a[0]||'?'}回合，自身敏捷+${a[1]||'?'}` },
            M9: { label: '持续再生', fmt: a => `持续${a[0]||'?'}回合，每回合恢复${a[1]||'?'}点HP` },
            M10:{ label: '力量强化', fmt: a => `持续${a[0]||'?'}回合，自身力量+${a[1]||'?'}` },
            M11:{ label: '群体力量', fmt: a => `持续${a[0]||'?'}回合，所有敌方力量+${a[1]||'?'}` },
            M12:{ label: '召唤',   fmt: a => `${a[0]||'?'}几率召唤衍生物` },
        },
        P: {
            P1: { label: '恢复生命', fmt: a => `恢复${a[0]||'?'}点HP` },
            P2: { label: '恢复法力', fmt: a => `恢复${a[0]||'?'}点MP` },
            P3: { label: '力量药水', fmt: a => `力量+${a[0]||'?'}，持续${a[1]||'?'}回合` },
            P4: { label: '敏捷药水', fmt: a => `敏捷+${a[0]||'?'}，持续${a[1]||'?'}回合` },
            P5: { label: '智力药水', fmt: a => `智力+${a[0]||'?'}，持续${a[1]||'?'}回合` },
            P6: { label: '耐力药水', fmt: a => `耐力+${a[0]||'?'}，持续${a[1]||'?'}回合` },
        },
    };

    _effectCodeTable = fallback;
    return _effectCodeTable;
}

/** 切换角色卡时重置效果代码表缓存 */
export function resetEffectCodeTable() {
    _effectCodeTable = null;
}

// ============================================================================
// Tool Action Helpers
// ============================================================================

/**
 * 从多个数据源查找角色信息
 * 优先级: character_book → char.data.description
 */
export function getCharacterInfoFromSources(name, aspect) {
    try {
        const char = getCurrentCharacter();
        const results = [];

        // 1. character_book 条目
        const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
        if (entries) {
            const nameLower = name.toLowerCase();
            for (const e of entries) {
                const entryName = (e.comment || e.name || '').toLowerCase();
                const keys = (e.keys || []).map(k => k.toLowerCase());
                if (entryName.includes(nameLower) || keys.some(k => k.includes(nameLower))) {
                    let content = e.content || '';
                    results.push('[世界书] ' + content);
                    break;
                }
            }
        }

        // 2. 角色卡描述（fallback）
        if (results.length === 0 && char && char.data && char.data.description) {
            const desc = char.data.description;
            results.push('[角色卡描述] ' + desc);
        }

        return results.length ? results.join('\n\n') : '未找到角色 "' + name + '" 的相关信息';
    } catch (e) {
        return '获取角色信息失败: ' + e.message;
    }
}

/**
 * 从 floorStore 获取楼层信息（结构化输出）
 */
export function getFloorInfo(floor, topic) {
    try {
        const floorEntry = getFloorByNumber(parseInt(floor));
        if (!floorEntry) return `未找到第${floor}层的信息`;

        const canon = floorEntry.canon;
        if (!canon) return `第${floor}层无详细设定`;

        const lines = [`第${floor}层`];
        if (canon.theme) lines.push(`主题: ${canon.theme}`);
        if (canon.intro) lines.push(`简介: ${canon.intro}`);
        if (canon.mainTown) lines.push(`主城: ${canon.mainTown}`);
        if (canon.mainCityDesc) lines.push(`主城描述: ${canon.mainCityDesc}`);
        if (canon.labyrinthLocation) lines.push(`迷宫位置: ${canon.labyrinthLocation}`);
        if (canon.labyrinthDesc) lines.push(`迷宫描述: ${canon.labyrinthDesc}`);
        if (canon.boss) lines.push(`楼层Boss: ${canon.boss}`);
        if (canon.bossDesc) lines.push(`Boss描述: ${canon.bossDesc}`);
        if (canon.attackPoint) {
            lines.push(`攻略据点: ${canon.attackPoint.name || ''}`);
            if (canon.attackPoint.location) lines.push(`据点位置: ${canon.attackPoint.location}`);
            if (canon.attackPoint.description) lines.push(`据点描述: ${canon.attackPoint.description}`);
        }
        if (Array.isArray(canon.landmarks) && canon.landmarks.length > 0) {
            lines.push('地标:');
            for (const lm of canon.landmarks) lines.push(`  - ${lm.name}: ${lm.description || ''}`);
        }
        if (Array.isArray(canon.villages) && canon.villages.length > 0) {
            lines.push('村庄:');
            for (const v of canon.villages) lines.push(`  - ${v.name}${v.location ? ' (' + v.location + ')' : ''}: ${v.description || ''}`);
        }        if (Array.isArray(canon.fieldBosses) && canon.fieldBosses.length > 0) {
            lines.push('区域Boss:');
            for (const fb of canon.fieldBosses) {
                const parts = [fb.name];
                if (fb.location) parts.push(`位置:${fb.location}`);
                if (fb.description) parts.push(fb.description);
                if (fb.dropItem) parts.push(`掉落:${fb.dropItem}`);
                lines.push(`  - ${parts.join(' | ')}`);
            }
        }
        if (floorEntry.state?.cleared) lines.push('状态: 已攻略');
        else lines.push('状态: 攻略中');
        if (floorEntry.state?.notes?.length) {
            lines.push('探索记录:');
            floorEntry.state.notes.slice(-5).forEach(n => lines.push(`  - ${n}`));
        }
        return lines.join('\n');
    } catch (e) {
        return '获取楼层信息失败: ' + e.message;
    }
}

// ============================================================================
// Function Calling Tool System
// ============================================================================

// --- Tool Registration Functions (P1) ---

export function registerGetCalendar(ctx) {
    ctx.registerFunctionTool({
        name: 'get_calendar',
        displayName: 'Get Calendar',
        formatMessage: () => '查询日历/时间线...',
        description: '查询游戏日历与原作时间线。必须传 date 参数（YYYY-MM-DD），默认返回该日期前后 3 天的事件（可用 range_days 调整）。返回的是原作时间线上该日期附近会发生的事件，实际情况由于玩家介入可能发生改变。不要凭空猜测原作时间线。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                date: { type: 'string', description: '查询单日 (YYYY-MM-DD)，如 2022-11-06' },
                range_days: { type: 'integer', description: '从 date 起正负 N 天范围，默认 ±3 天' },
                max: { type: 'integer', description: '最多返回事件数，默认 40，上限 120' },
            },
            required: ['date'],
        },
action: wrapToolAction('get_calendar', async (args) => {
            try {
                initCalendarIfNeeded();
                const data = getSaoData();
                const cal = data && data.calendar;

                // 1. Compute date window for filtering all event types
                let winStart = null; // YYYY-MM-DD inclusive
                let winEnd = null;

                if (args?.date) {
                    const explicitRange = Number.isFinite(Number(args?.range_days));
                    const days = explicitRange ? Number(args.range_days) : 3;
                    const d = parseDate(args.date);
                    if (d) {
                        const s = new Date(d); s.setDate(s.getDate() - days);
                        const e = new Date(d); e.setDate(e.getDate() + days);
                        winStart = formatDate(s);
                        winEnd = formatDate(e);
                    }
                }

                // 1b. Canon timeline from queryTimeline (world book, real-time)
                const query = {};
                if (winStart && winEnd) {
                    query.start_date = winStart;
                    query.end_date = winEnd;
                } else if (args?.date) {
                    query.date = args.date;
                }
                if (args?.max) query.max = args.max;

                const canonEvents = queryTimeline(query);

                // 2. Game calendar events (appointments, custom events)
                let gameEvents = [];
                const store = getStore();
                const calStore = store?.calendarStore;

                // Merge appointments from calendarStore (priority) and data.calendar (fallback), deduplicate by id
                const seenIds = new Set();
                const allAppointments = [];
                for (const apt of (calStore?.appointments || [])) {
                    if (apt.id && !seenIds.has(apt.id)) { seenIds.add(apt.id); allAppointments.push(apt); }
                }
                for (const apt of (cal?.appointments || [])) {
                    if (apt.id && !seenIds.has(apt.id)) { seenIds.add(apt.id); allAppointments.push(apt); }
                }
                // Filter appointments by date window
                const windowedAppointments = winStart && winEnd
                    ? allAppointments.filter(apt => apt.date && apt.date >= winStart && apt.date <= winEnd)
                    : allAppointments;
                gameEvents = windowedAppointments.map(apt => ({
                    date: apt.date || '',
                    type: '[约定]',
                    title: apt.title || apt.description || '',
                }));

                // 2b. calendarStore events (custom events from events map)
                if (calStore?.events && typeof calStore.events === 'object') {
                    for (const [dateKey, events] of Object.entries(calStore.events)) {
                        // Filter by date window
                        if (winStart && winEnd && (dateKey < winStart || dateKey > winEnd)) continue;
                        if (!Array.isArray(events)) continue;
                        for (const ev of events) {
                            gameEvents.push({
                                date: dateKey || ev.date || '',
                                type: ev.type === 'custom' ? '[自定义]' : '[事件]',
                                title: ev.title || ev.description || '',
                            });
                        }
                    }
                }

                // 3. Merge and tag
                const taggedCanon = canonEvents.map(ev => ({
                    date: ev.date,
                    type: '[原作]',
                    title: ev.title,
                }));

                const allEvents = [...taggedCanon, ...gameEvents];

                // Sort by date
                allEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

                if (!allEvents.length) {
                    return '未找到匹配的日历/时间线事件。请使用 date（YYYY-MM-DD）查询，可用 range_days 调整范围（默认 ±3 天）。';
                }

                return allEvents.map(ev => `${ev.date} ${ev.type} ${ev.title}`).join('\n');
            } catch (e) {
                log('get_calendar 失败: ' + e.message, 'warn');
                return '获取日历失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetCharacterInfo(ctx) {
    ctx.registerFunctionTool({
        name: 'get_character_info',
        displayName: 'Get Character Info',
        formatMessage: () => '查询角色信息...',
        description: '获取角色信息：查看 NPC 或角色的基本资料、关系状态。支持按名称搜索角色卡世界书中的条目。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                name: { type: 'string', description: '角色名称（必填）' },
                aspect: { type: 'string', description: '查询方面', 'enum': ['basic', 'relationship', 'full'] },
            },
            required: ['name'],
        },
action: wrapToolAction('get_character_info', async (args) => {
            try {
                const name = args && args.name;
                if (!name) return '请提供角色名称';
                // B4: Try npcStore first
                const npc = getNpcByName(name);
                // Live canon from world book (full profile) — store only keeps characterName now
                const liveCanon = getCharacterInfoFromSources(name, (args && args.aspect) || 'full');
                if (npc) {
                    const parts = [`[角色] ${npc.name}`];
                    if (npc.canon?.characterName) parts.push(`[设定名] ${npc.canon.characterName}`);
                    // Append full live canon (world book profile) if it returned real content
                    if (liveCanon && !liveCanon.startsWith('未找到') && liveCanon.length > 10) {
                        parts.push(`[档案]\n${liveCanon}`);
                    }
                    if (npc.state?.relationship) parts.push(`[当前关系] ${npc.state.relationship}`);
                    if (npc.observations?.length) {
                        parts.push('[最近观察]');
                        parts.push(...npc.observations.slice(-5).map(o => `- ${o}`));
                    }
                    return parts.join('\n');
                }
                // Fallback: npcStore miss — return live canon alone
                log('get_character_info: npcStore 未命中，仅返回世界书扫描 name=' + name, 'warn');
                return liveCanon;
            } catch (e) {
                log('get_character_info 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetFloorInfo(ctx) {
    ctx.registerFunctionTool({
        name: 'get_floor_info',
        displayName: 'Get Floor Info',
        formatMessage: () => '查询楼层信息...',
        description: '获取艾恩葛朗特楼层信息：查看特定楼层的迷宫、BOSS、城镇、地点等情报。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                floor: { type: 'integer', description: '楼层数（必填），如 1、2、50' },
                topic: { type: 'string', description: '可选话题过滤，如 "boss"、"迷宫"、"城镇"' },
            },
            required: ['floor'],
        },
action: wrapToolAction('get_floor_info', async (args) => {
            try {
                const floor = args && args.floor;
                if (!floor) return '请提供楼层数';
                const floorNum = parseInt(floor);
                const floorEntry = getFloorByNumber(floorNum);
                const info = getFloorInfo(floorNum, args.topic);
                if (floorEntry) {
                    return info;
                }
                // Fallback: floorStore miss — return info (will say "未找到")
                log('get_floor_info: floorStore 未命中 floor=' + floor, 'warn');
                return info;
            } catch (e) {
                log('get_floor_info 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}


export function registerGetWorldSetting(ctx) {
    ctx.registerFunctionTool({
        name: 'get_world_setting',
        displayName: 'Get World Setting',
        formatMessage: () => '查询世界设定...',
        description: '查询SAO世界设定和游戏规则。可查死亡游戏规则、经济系统、PK规则、战斗机制、技能系统、升级规则、住房系统、环境设定等。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                topic: { type: 'string', description: '查询话题（必填）', 'enum': ['world', 'pk', 'economy', 'npc_generation', 'npc_rules', 'field_boss', 'adult', 'mob', 'floor_general', 'output_rules', 'meditation', 'housing', 'leveling', 'skills', 'death_game', 'environment'] },
            },
            required: ['topic'],
        },
        action: wrapToolAction('get_world_setting', async (args) => {
            try {
                let topic = args && args.topic;
                if (!topic) return '请提供查询话题（topic）';

                // Alias resolution: map legacy/LLM-friendly names to parsed keys
                const ALIASES = {
                    death_game: 'world',
                    environment: 'world',
                    combat: 'skills',
                };
                topic = ALIASES[topic] || topic;

                const ws = getWorldStore();
                const rules = ws.rules;

                if (!rules || typeof rules !== 'object' || !rules[topic]) {
                    return `暂无"${topic}"的结构化数据，请参考世界书注入的规则条目。`;
                }

                let data = rules[topic];

                if (typeof data === 'string') return data;
                if (typeof data === 'object') return JSON.stringify(data, null, 2);
                return String(data);
            } catch (e) {
                log('get_world_setting 失败: ' + e.message, 'warn');
                return '获取世界设定失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetGuildInfo(ctx) {
    ctx.registerFunctionTool({
        name: 'get_guild_info',
        displayName: 'Get Guild Info',
        formatMessage: () => '查询公会信息...',
        description: '获取公会信息：查看公会的基本资料、成员、据点、公会加成等。只有已发现的公会才能被查询。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                name: { type: 'string', description: '公会名称（必填）' },
            },
            required: ['name'],
        },
        action: wrapToolAction('get_guild_info', async (args) => {
            try {
                const name = args && args.name;
                if (!name) return '请提供公会名称';
                const guild = getGuildByName(name);
                if (!guild) return '未找到公会"' + name + '"';
                let info = `公会: ${guild.name}\n会长: ${guild.leader || '?'}\n成员: ${guild.members.join(', ')}`;
                if (guild.headquarters) info += `\n据点: ${guild.headquarters.floor_id}F ${guild.headquarters.location}`;
                if (guild.buff) info += `\n公会加成: ${guild.buff.name} (${guild.buff.description})`;
                if (guild.description) info += `\n简介: ${guild.description}`;
                return info;
            } catch (e) {
                log('get_guild_info 失败: ' + e.message, 'warn');
                return '获取公会信息失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerSearchWorldBook(ctx) {
    ctx.registerFunctionTool({
        name: 'search_world_book',
        displayName: 'Search World Book',
        formatMessage: () => '搜索世界书...',
        description: '搜索世界书条目（通用回退工具）。当其他工具无法满足需求时使用，可按关键词搜索NPC、楼层、时间线、设定、规则等世界书内容。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词（必填）' },
                type: { type: 'string', description: '可选条目类型过滤', 'enum': ['npc', 'floor', 'timeline', 'setting', 'rule'] },
            },
            required: ['query'],
        },
        action: wrapToolAction('search_world_book', async (args) => {
            try {
                const query = args && args.query;
                if (!query) return '请提供搜索关键词（query）';

                const char = getCurrentCharacter();
                const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
                if (!entries || !entries.length) return '世界书数据不可用或为空';

                const queryLower = query.toLowerCase();
                const MAX_RESULTS = 5;

                // 类型推断：根据 comment 前缀判断条目类型
                function inferType(entry) {
                    const c = (entry.comment || '').toLowerCase();
                    if (/^sao-第|^\d+f|^floor/i.test(c)) return 'floor';
                    if (/桐人|亚丝娜|结城|kirito|asuna|npc/i.test(c)) return 'npc';
                    if (/时间|timeline|年|月|日/i.test(c)) return 'timeline';
                    if (/规则|rule|机制/i.test(c)) return 'rule';
                    return 'setting';
                }

                // 匹配函数：搜索 keys、comment、content
                function matches(entry) {
                    const keys = (entry.keys || []).map(k => k.toLowerCase());
                    const comment = (entry.comment || '').toLowerCase();
                    const content = (entry.content || '').toLowerCase();
                    return keys.some(k => k.includes(queryLower) || queryLower.includes(k))
                        || comment.includes(queryLower)
                        || content.includes(queryLower);
                }

                const results = [];
                for (const entry of entries) {
                    // 类型过滤
                    if (args?.type && inferType(entry) !== args.type) continue;
                    // 关键词匹配
                    if (!matches(entry)) continue;

                    const comment = entry.comment || entry.name || '(无标题)';
                    const content = (entry.content || '').substring(0, 100);
                    results.push(`[${inferType(entry)}] ${comment}: ${content}${(entry.content || '').length > 100 ? '...' : ''}`);

                    if (results.length >= MAX_RESULTS) break;
                }

                if (!results.length) {
                    return `未找到与"${query}"匹配的世界书条目` + (args?.type ? `（类型: ${args.type}）` : '') + '。';
                }

                return results.join('\n---\n');
            } catch (e) {
                log('search_world_book 失败: ' + e.message, 'warn');
                return '搜索世界书失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

// === End Function Calling Tool Actions (P1) ===

// === Function Calling Tool System (P0: framework only, tools registered in P1) ===

const SAO_TOOL_NAMES = ['get_calendar', 'get_character_info', 'get_floor_info', 'get_guild_info', 'get_world_setting', 'search_world_book'];

export function registerTools() {
    const ctx = getContext();
    if (typeof ctx.registerFunctionTool !== 'function') {
        log('当前环境不支持 function calling，工具未注册（保持现有世界书注入模式）');
        return false;
    }
    if (typeof ctx.isToolCallingSupported === 'function' && !ctx.isToolCallingSupported()) {
        log('当前 API/设置不支持 function calling，工具未注册（保持现有世界书注入模式）');
        return false;
    }
    registerGetCalendar(ctx);
    registerGetCharacterInfo(ctx);
    registerGetFloorInfo(ctx);
    registerGetGuildInfo(ctx);
    registerGetWorldSetting(ctx);
    registerSearchWorldBook(ctx);
    log('function calling 工具系统已就绪（6 个工具已注册）');
    return true;
}

export function unregisterAllTools(ctx) {
    if (typeof ctx.unregisterFunctionTool !== 'function') return;
    for (const name of SAO_TOOL_NAMES) {
        try { ctx.unregisterFunctionTool(name); } catch (e) { /* ignore */ }
    }
}

export function initToolSystem() {
    const ctx = getContext();
    let toolsRegistered = registerTools();

    // 用户设置变化（含 function_calling 开关）
    bindSaoEvent(event_types.SETTINGS_UPDATED, () => {
        if (!isSaoCard()) return;
        const nowSupported = typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported();
        if (nowSupported && !toolsRegistered) {
            toolsRegistered = registerTools();
            log('运行时检测到 function calling 支持，工具已注册');
        } else if (!nowSupported && toolsRegistered) {
            unregisterAllTools(ctx);
            toolsRegistered = false;
            log('运行时检测到 function calling 不支持，工具已注销');
        }
    });

    // API 模式切换（Chat Completion ↔ Text Completion）
    bindSaoEvent(event_types.MAIN_API_CHANGED, () => {
        if (!isSaoCard()) return;
        if (toolsRegistered) unregisterAllTools(ctx);
        toolsRegistered = registerTools();
    });
}

// ============================================================================
// Tool Call Recording & Wrapping
// ============================================================================

/**
 * 工具调用计数器 — 记录成功/失败次数到 localStorage
 */
function recordToolCall(success) {
    const key = success ? 'sao_tool_call_count' : 'sao_tool_fail_count';
    const current = parseInt(localStorage.getItem(key) || '0');
    localStorage.setItem(key, String(current + 1));
}

/**
 * 工具 action 包装器 — 自动记录调用成功/失败，并输出可见日志
 * 用法: action: wrapToolAction('tool_name', async (params) => { ... })
 */
function wrapToolAction(toolName, originalAction) {
    return async (params) => {
        try {
            const result = await originalAction(params);
            log(`🔧 ${toolName} 调用成功 | 参数: ${JSON.stringify(params).slice(0, 120)} | 返回 ${String(result).length} 字符`, 'info');
            recordToolCall(true);
            return result;
        } catch (e) {
            log(`🔧 ${toolName} 调用失败: ${e.message}`, 'warn');
            recordToolCall(false);
            throw e;
        }
    };
}

