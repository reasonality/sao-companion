// SAO Companion - Tool System & Tool Action Helpers
// Extracted from index.js: function calling tools, effect code table

import { getSaoData, getCurrentCharacter, isSaoCard, log, getContext } from './sao-core.js';
import { initCalendarIfNeeded, formatCalendarForLLM } from './sao-calendar.js';
import { eventSource, event_types } from '../../../events.js';

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

export function formatFullState(state) {
    if (!state) return 'No SAO state available.';
    const parts = [];

    // Core stats (reuse formatCompactState's core)
    if (state.player_name) parts.push(`[玩家]${state.player_name}`);
    if (state.level != null) parts.push(`Lv${state.level}`);
    if (state.hp != null) parts.push(`HP:${state.hp}/${state.max_hp || '?'}`);
    if (state.mp != null) parts.push(`MP:${state.mp}/${state.max_mp || '?'}`);
    if (state.floor != null) parts.push(`${state.floor}F`);
    if (state.location) parts.push(`@${state.location}`);
    if (state.cor != null) parts.push(`珂尔:${state.cor}`);

    // Equipment detailed stats
    if (state.equipment) {
        parts.push('\n[装备详情]');
        for (const [slot, eq] of Object.entries(state.equipment)) {
            if (!eq || !eq.name) continue;
            const stats = eq.stats || {};
            parts.push(`  ${slot}: ${eq.name} (STR+${stats.str||0} AGI+${stats.agi||0} INT+${stats.int||0} VIT+${stats.vit||0} HP+${stats.max_hp||0})`);
        }
    }

    // Inventory
    if (state.inventory?.length) {
        parts.push('\n[背包]');
        state.inventory.slice(0, 10).forEach(item => {
            parts.push(`  ${item.name || item.type || '?'} x${item.qty || 1}`);
        });
        if (state.inventory.length > 10) parts.push(`  ... 共${state.inventory.length}件`);
    }

    // Skills with combat attributes
    if (state.skills?.length) {
        parts.push('\n[技能详情]');
        const effectTable = getEffectCodeTable();
        state.skills.forEach(skill => {
            const atk = skill.atk || skill.base_damage || 0;
            const hit = skill.hit || skill.hit_rate || 0;
            const crit = skill.crit || skill.crit_rate || 0;
            const apt = skill.apt || skill.hits || 1;
            const tpa = skill.tpa || skill.targets || 1;
            const mpCost = skill.mpCost || skill.mp_cost || 0;
            const cd = skill.cd || skill.cooldown || 0;
            const wn = skill.wn || skill.core_code || 'A1';
            let line = `  ${skill.name || '?'}(Lv${skill.level||skill.skill_level||1}) ATK:${atk} 命中:${hit}% 暴击:${crit}% 连击:${apt} 目标:${tpa} MP:${mpCost} CD:${cd}轮 ${wn}`;
            // Affix descriptions
            const affixCodes = skill.affix_codes || skill.en || [];
            if (affixCodes.length > 0) {
                const affixDescs = affixCodes.map(code => {
                    const bareCode = code.replace(/^EN:/, '').split(',')[0];
                    const entry = effectTable[bareCode];
                    if (entry?.fmt) {
                        const params = code.split(',').slice(1).map(Number);
                        return entry.fmt(params);
                    }
                    return bareCode;
                });
                line += ` [${affixDescs.join(', ')}]`;
            }
            parts.push(line);
        });
    }

    // Last combat hint
    if (state.lastCombatHint) parts.push('\n' + state.lastCombatHint);

    return parts.join('\n');
}

/**
 * 从多个数据源查找角色信息
 * 优先级: state.relationships → character_book → char.data.description
 */
export function getCharacterInfoFromSources(name, aspect) {
    try {
        const data = getSaoData();
        const char = getCurrentCharacter();
        const results = [];

        // 1. 关系数据（如果存在）
        if (aspect === 'relationship' || aspect === 'full') {
            const rel = data && data.state && data.state.relationships && data.state.relationships[name];
            if (rel) {
                results.push('[关系] ' + (typeof rel === 'string' ? rel : JSON.stringify(rel)));
            }
        }

        // 2. character_book 条目
        const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
        if (entries) {
            const nameLower = name.toLowerCase();
            for (const e of entries) {
                const entryName = (e.comment || e.name || '').toLowerCase();
                const keys = (e.keys || []).map(k => k.toLowerCase());
                if (entryName.includes(nameLower) || keys.some(k => k.includes(nameLower))) {
                    let content = (e.content || '').substring(0, 500);
                    results.push('[世界书] ' + content);
                    break;
                }
            }
        }

        // 3. 角色卡描述（fallback）
        if (results.length === 0 && char && char.data && char.data.description) {
            const desc = char.data.description.substring(0, 500);
            results.push('[角色卡描述] ' + desc);
        }

        return results.length ? results.join('\n\n') : '未找到角色 "' + name + '" 的相关信息';
    } catch (e) {
        return '获取角色信息失败: ' + e.message;
    }
}

/**
 * 从世界书查找楼层信息
 */
export function getFloorInfo(floor, topic) {
    try {
        const char = getCurrentCharacter();
        const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
        if (!entries) return '世界书数据不可用';

        const floorStr = String(floor);
        const floorPatterns = [floorStr + 'F', floorStr + '层', floorStr + '楼'];
        const results = [];

        for (const e of entries) {
            const entryName = (e.comment || e.name || '').toLowerCase();
            const matched = floorPatterns.some(p => entryName.includes(p.toLowerCase()));
            if (!matched) continue;

            let content = e.content || '';
            // 可选 topic 过滤
            if (topic) {
                const topicLower = topic.toLowerCase();
                if (!content.toLowerCase().includes(topicLower) && !entryName.includes(topicLower)) {
                    continue;
                }
            }
            results.push(content.substring(0, 500));
            if (results.length >= 3) break;
        }

        return results.length ? results.join('\n---\n') : '未找到第' + floorStr + '层的相关信息' + (topic ? '（话题: ' + topic + '）' : '');
    } catch (e) {
        return '获取楼层信息失败: ' + e.message;
    }
}

/**
 * 格式化所有技能概览
 */
export function formatAllSkillsBrief(skills) {
    if (!skills || !skills.length) return '当前无已学习技能';
    try {
        const lines = skills.map((sk, i) => {
            let s = (i + 1) + '. ' + sk.name;
            if (sk.skill_level) s += ' Lv' + sk.skill_level;
            if (sk.core_code) s += ' [' + sk.core_code + ']';
            return s;
        });
        return lines.join('\n');
    } catch (e) {
        return '格式化技能列表失败: ' + e.message;
    }
}

/**
 * 格式化单个技能详细信息
 */
export function formatSkillDetail(skill) {
    if (!skill) return '技能数据为空';
    try {
        const parts = ['技能: ' + skill.name];
        if (skill.skill_level) parts.push('等级: ' + skill.skill_level);
        if (skill.base_damage != null) parts.push('攻击力(ATK): ' + skill.base_damage);
        if (skill.hit_rate != null) parts.push('命中率(Hit): ' + skill.hit_rate);
        if (skill.crit_rate != null) parts.push('暴击率(Crit): ' + skill.crit_rate);
        if (skill.hits != null) parts.push('连击数(Apt): ' + skill.hits);
        if (skill.targets != null) parts.push('目标数(TPA): ' + skill.targets);
        if (skill.mp_cost != null) parts.push('MP消耗: ' + skill.mp_cost);
        if (skill.cooldown != null) parts.push('冷却: ' + skill.cooldown);

        // 词缀描述
        const table = getEffectCodeTable();
        if (table) {
            if (skill.core_code) {
                const prefix = skill.core_code[0];
                const entry = table[prefix] && table[prefix][skill.core_code];
                if (entry) parts.push('核心效果: [' + skill.core_code + '] ' + entry.label);
            }
            if (skill.affix_codes && skill.affix_codes.length) {
                const affixDescs = skill.affix_codes.map(code => {
                    const p = code[0];
                    const e = table[p] && table[p][code];
                    return e ? code + '(' + e.label + ')' : code;
                });
                parts.push('词缀: ' + affixDescs.join(', '));
            }
            if (skill.effects_description) {
                parts.push('效果描述: ' + skill.effects_description);
            }
        }

        return parts.join('\n');
    } catch (e) {
        return '格式化技能详情失败: ' + e.message;
    }
}

/**
 * 搜索世界书条目（按话题关键词）
 * 名称/关键词/内容加权匹配，返回 top 3
 */
export function searchWorldBookEntries(topic) {
    try {
        const char = getCurrentCharacter();
        const entries = char && char.data && char.data.character_book && char.data.character_book.entries;
        if (!entries) return '世界书数据不可用';

        const topicLower = topic.toLowerCase();
        const scored = [];

        for (const e of entries) {
            const name = (e.comment || e.name || '').toLowerCase();
            const content = (e.content || '').toLowerCase();
            const keys = (e.keys || []).map(k => k.toLowerCase());

            let score = 0;
            // 名称匹配（最高权重）
            if (name.includes(topicLower)) score += 3;
            // 关键词匹配
            if (keys.some(k => k.includes(topicLower) || topicLower.includes(k))) score += 2;
            // 内容匹配
            if (content.includes(topicLower)) score += 1;

            if (score > 0) {
                scored.push({ entry: e, score: score });
            }
        }

        // 按分数排序，取 top 3
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 3);

        if (top.length === 0) return '未找到与"' + topic + '"相关的世界书条目';

        return top.map(item => {
            const e = item.entry;
            const ename = e.comment || e.name || '未命名条目';
            const econtent = (e.content || '').substring(0, 500);
            return '[' + ename + '] ' + econtent;
        }).join('\n---\n');
    } catch (e) {
        return '搜索世界书失败: ' + e.message;
    }
}

// ============================================================================
// Function Calling Tool System
// ============================================================================

// --- Tool Registration Functions (P1) ---

export function registerGetPlayerStatus(ctx) {
    ctx.registerFunctionTool({
        name: 'get_player_status',
        displayName: 'Get Player Status',
        formatMessage: () => '读取玩家状态...',
        description: '获取玩家的完整状态：属性(HP/MP/STR/AGI/INT/VIT)、装备详情、背包物品、技能战斗属性。当需要查看玩家当前状态时使用。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {},
            required: [],
        },
        action: wrapToolAction(async () => {
            try {
                const data = getSaoData();
                if (!data || !data.state) return '玩家状态数据尚未初始化';
                return formatFullState(data.state);
            } catch (e) {
                log('get_player_status 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetCalendar(ctx) {
    ctx.registerFunctionTool({
        name: 'get_calendar',
        displayName: 'Get Calendar',
        formatMessage: () => '查询日历...',
        description: '获取游戏内日历信息：查看日期范围内的事件和日程安排。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                date: { type: 'string', description: '起始日期 (YYYY-MM-DD 格式)，默认今天' },
                range_days: { type: 'integer', description: '查询天数范围，默认 7 天' },
            },
            required: [],
        },
        action: wrapToolAction(async (args) => {
            try {
                initCalendarIfNeeded();
                const data = getSaoData();
                const cal = data && data.calendar;
                return formatCalendarForLLM(cal, args && args.date, args && args.range_days);
            } catch (e) {
                log('get_calendar 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
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
        action: wrapToolAction(async (args) => {
            try {
                const name = args && args.name;
                if (!name) return '请提供角色名称';
                return getCharacterInfoFromSources(name, (args && args.aspect) || 'full');
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
        action: wrapToolAction(async (args) => {
            try {
                if (!args || args.floor == null) return '请提供楼层数';
                return getFloorInfo(args.floor, args.topic);
            } catch (e) {
                log('get_floor_info 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetSkillInfo(ctx) {
    ctx.registerFunctionTool({
        name: 'get_skill_info',
        displayName: 'Get Skill Info',
        formatMessage: () => '查询技能信息...',
        description: '获取技能信息：查看已学习技能列表，或查询特定技能的详细战斗属性（ATK/命中/暴击/连击/词缀效果）。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                skill_name: { type: 'string', description: '技能名称。不提供则返回所有技能概览列表' },
            },
            required: [],
        },
        action: wrapToolAction(async (args) => {
            try {
                const data = getSaoData();
                const skills = data && data.state && data.state.skills;
                if (!skills || !skills.length) return '当前无已学习技能';

                const skillName = args && args.skill_name;
                if (!skillName) {
                    return formatAllSkillsBrief(skills);
                }

                const skill = skills.find(s => s.name === skillName);
                if (!skill) {
                    const available = skills.map(s => s.name).join(', ');
                    return '未找到技能 "' + skillName + '"。可用技能: ' + available;
                }
                return formatSkillDetail(skill);
            } catch (e) {
                log('get_skill_info 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

export function registerGetWorldLore(ctx) {
    ctx.registerFunctionTool({
        name: 'get_world_lore',
        displayName: 'Get World Lore',
        formatMessage: () => '查询世界观...',
        description: '搜索世界观设定：从角色卡世界书中按关键词搜索世界观、背景、设定、规则等条目信息。',
        parameters: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                topic: { type: 'string', description: '搜索话题关键词（必填），如 "艾恩葛朗特"、"刀剑技能"、"珂尔"' },
            },
            required: ['topic'],
        },
        action: wrapToolAction(async (args) => {
            try {
                const topic = args && args.topic;
                if (!topic) return '请提供搜索话题';
                return searchWorldBookEntries(topic);
            } catch (e) {
                log('get_world_lore 失败: ' + e.message, 'warn');
                return '获取数据失败: ' + e.message;
            }
        }),
        shouldRegister: () => isSaoCard(),
        stealth: false,
    });
}

// === End Function Calling Tool Actions (P1) ===

// === Function Calling Tool System (P0: framework only, tools registered in P1) ===

export const SAO_TOOL_NAMES = ['get_player_status', 'get_calendar', 'get_character_info',
                        'get_floor_info', 'get_skill_info', 'get_world_lore'];

export function registerTools() {
    const ctx = getContext();
    // 软门控：不支持时静默跳过，不报错，不注册工具
    if (typeof ctx.registerFunctionTool !== 'function') {
        log('当前环境不支持 function calling，工具未注册（保持现有世界书注入模式）');
        return false;
    }
    if (typeof ctx.isToolCallingSupported === 'function' && !ctx.isToolCallingSupported()) {
        log('当前 API/设置不支持 function calling，工具未注册（保持现有世界书注入模式）');
        return false;
    }
    // P1: 注册 6 个 function calling 工具
    registerGetPlayerStatus(ctx);
    registerGetCalendar(ctx);
    registerGetCharacterInfo(ctx);
    registerGetFloorInfo(ctx);
    registerGetSkillInfo(ctx);
    registerGetWorldLore(ctx);
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
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
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
    eventSource.on(event_types.MAIN_API_CHANGED, () => {
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
export function recordToolCall(success) {
    const key = success ? 'sao_tool_call_count' : 'sao_tool_fail_count';
    const current = parseInt(localStorage.getItem(key) || '0');
    localStorage.setItem(key, String(current + 1));
}

/**
 * 工具 action 包装器 — 自动记录调用成功/失败
 * 用法: action: wrapToolAction(async (params) => { ... })
 */
export function wrapToolAction(originalAction) {
    return async (params) => {
        try {
            const result = await originalAction(params);
            recordToolCall(true);
            return result;
        } catch (e) {
            recordToolCall(false);
            throw e;
        }
    };
}
