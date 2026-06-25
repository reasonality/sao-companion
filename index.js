// SAO Companion - 刀剑神域角色卡专用扩展
// 版本: 0.6.13 (用原卡模板替换自写美化)
// 功能: 多模型分工 + 状态监控 + 章节管理 + 独立控制台

import { saveSettingsDebounced } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
import { renderBattlePanel } from './battle/battleRenderer.js';
import { serializeBattleState, restoreBattleState, setBattleStateChangeCallback, setBattleEndCallback, destroyBattleSideEffects } from './battle/battleLogic.js';
// memory.js 已移除

// ============================================================
// 常量
// ============================================================

const MODULE_NAME = 'sao_companion';
// 5 个子代理角色：narrative 不干预主对话，用于 NPC 反应生成
// combat 兼管武器/技能/物品生成（因为涉及数值）
const ROLES = ['narrative', 'combat', 'extract'];
const ROLE_LABELS = {
    narrative: '📝 叙事/NPC模型',
    combat: '⚔️ 数值与生成模型',
    extract: '📊 状态提取模型',
};
const ROLE_DESC = {
    narrative: 'NPC 反应生成、剧情分支生成（留空=不使用，主对话始终用酒馆主模型）',
    combat: '战斗结算 + 武器/装备/剑技/物品/经验生成（留空=用主模型）',
    extract: '从 AI 输出提取 HP/MP/物品等状态 JSON',
};

const SLOT_LABELS = {
    weapon: '武器', main_hand: '主手', off_hand: '副手',
    armor: '防具', body: '身体', helmet: '头盔', head: '头部',
    boots: '靴子', feet: '脚部', gloves: '手套', hands: '手部',
    shield: '盾牌', accessory: '饰品', ring: '戒指', necklace: '项链',
    cape: '披风', belt: '腰带',
};

// ============================================================
// SAO 卡牌骰子表常量 (装备/剑技生成确定性数值)
// 来源: 角色卡 creator_notes 和世界书条目
// ============================================================

/** 装备稀有度骰子表 (1D20): 1-6=白, 7-13=绿, 14-18=蓝, 19-20=紫 */
const EQUIP_RARITY_TABLE = [
    { roll: [1,6],   name: '白色', mult: 1.0, affixes: 1 },
    { roll: [7,13],  name: '绿色', mult: 1.2, affixes: 1 },
    { roll: [14,18], name: '蓝色', mult: 1.5, affixes: 2 },
    { roll: [19,20], name: '紫色', mult: 2.0, affixes: 2 },
];

/** 装备插槽骰子表 (1D10): 1-2=主手, 3=副手, 4=头部, 5=胸部, 6=手部, 7=腿部, 8-10=饰品 */
const EQUIP_SLOT_TABLE = [
    { roll: [1,2],  slot: 'main_hand', label: '主手' },
    { roll: [3,3],  slot: 'off_hand',  label: '副手' },
    { roll: [4,4],  slot: 'head',      label: '头部' },
    { roll: [5,5],  slot: 'body',      label: '胸部' },
    { roll: [6,6],  slot: 'hands',     label: '手部' },
    { roll: [7,7],  slot: 'feet',      label: '腿部' },
    { roll: [8,10], slot: 'accessory', label: '饰品' },
];

/** 装备类型骰子表 (1D5): 1=力量型, 2=敏捷型, 3=智力型, 4=耐力型, 5=全能型 */
const EQUIP_TYPE_TABLE = [
    { roll: [1,1], type: '力量型', mainStat: 'str' },
    { roll: [2,2], type: '敏捷型', mainStat: 'agi' },
    { roll: [3,3], type: '智力型', mainStat: 'int' },
    { roll: [4,4], type: '耐力型', mainStat: 'vit' },
    { roll: [5,5], type: '全能型', mainStat: 'all' },
];

// id=35 为特殊项「上级强化」，stats=null 表示随机一条属性+4
const EQUIP_AFFIX_TABLE = [
    null,
    { id: 1,  name: '力量+1',             stats: { str: 1, agi: 0, int: 0, vit: 0 } },
    { id: 2,  name: '敏捷+1',             stats: { str: 0, agi: 1, int: 0, vit: 0 } },
    { id: 3,  name: '智力+1',             stats: { str: 0, agi: 0, int: 1, vit: 0 } },
    { id: 4,  name: '耐力+1',             stats: { str: 0, agi: 0, int: 0, vit: 1 } },
    { id: 5,  name: '智力+1耐力+1',       stats: { str: 0, agi: 0, int: 1, vit: 1 } },
    { id: 6,  name: '力量+1耐力+1',       stats: { str: 1, agi: 0, int: 0, vit: 1 } },
    { id: 7,  name: '敏捷+1智力+1',       stats: { str: 0, agi: 1, int: 1, vit: 0 } },
    { id: 8,  name: '力量+1敏捷+1',       stats: { str: 1, agi: 1, int: 0, vit: 0 } },
    { id: 9,  name: '耐力+1力量+1',       stats: { str: 1, agi: 0, int: 0, vit: 1 } },
    { id: 10, name: '智力+1敏捷+1',       stats: { str: 0, agi: 1, int: 1, vit: 0 } },
    { id: 11, name: '力量+2',             stats: { str: 2, agi: 0, int: 0, vit: 0 } },
    { id: 12, name: '敏捷+2',             stats: { str: 0, agi: 2, int: 0, vit: 0 } },
    { id: 13, name: '智力+2',             stats: { str: 0, agi: 0, int: 2, vit: 0 } },
    { id: 14, name: '耐力+2',             stats: { str: 0, agi: 0, int: 0, vit: 2 } },
    { id: 15, name: '力量+2耐力+1',       stats: { str: 2, agi: 0, int: 0, vit: 1 } },
    { id: 16, name: '敏捷+2力量+1',       stats: { str: 1, agi: 2, int: 0, vit: 0 } },
    { id: 17, name: '智力+2耐力+1',       stats: { str: 0, agi: 0, int: 2, vit: 1 } },
    { id: 18, name: '耐力+2敏捷+1',       stats: { str: 0, agi: 1, int: 0, vit: 2 } },
    { id: 19, name: '力量+2敏捷+1',       stats: { str: 2, agi: 1, int: 0, vit: 0 } },
    { id: 20, name: '智力+2敏捷+1',       stats: { str: 0, agi: 1, int: 2, vit: 0 } },
    { id: 21, name: '耐力+2力量+1',       stats: { str: 1, agi: 0, int: 0, vit: 2 } },
    { id: 22, name: '敏捷+2耐力+1',       stats: { str: 0, agi: 2, int: 0, vit: 1 } },
    { id: 23, name: '力量+3',             stats: { str: 3, agi: 0, int: 0, vit: 0 } },
    { id: 24, name: '敏捷+3',             stats: { str: 0, agi: 3, int: 0, vit: 0 } },
    { id: 25, name: '智力+3',             stats: { str: 0, agi: 0, int: 3, vit: 0 } },
    { id: 26, name: '耐力+3',             stats: { str: 0, agi: 0, int: 0, vit: 3 } },
    { id: 27, name: '全属性+1',           stats: { str: 1, agi: 1, int: 1, vit: 1 } },
    { id: 28, name: '力量+2耐力+2',       stats: { str: 2, agi: 0, int: 0, vit: 2 } },
    { id: 29, name: '敏捷+2智力+2',       stats: { str: 0, agi: 2, int: 2, vit: 0 } },
    { id: 30, name: '耐力+2智力+2',       stats: { str: 0, agi: 0, int: 2, vit: 2 } },
    { id: 31, name: '力量+2敏捷+2',       stats: { str: 2, agi: 2, int: 0, vit: 0 } },
    { id: 32, name: '力量+2智力+2',       stats: { str: 2, agi: 0, int: 2, vit: 0 } },
    { id: 33, name: '敏捷+2耐力+2',       stats: { str: 0, agi: 2, int: 0, vit: 2 } },
    { id: 34, name: '全属性+1',           stats: { str: 1, agi: 1, int: 1, vit: 1 } },
    { id: 35, name: '上级强化',           stats: null },
    { id: 36, name: '力量+6',             stats: { str: 6, agi: 0, int: 0, vit: 0 } },
    { id: 37, name: '敏捷+6',             stats: { str: 0, agi: 6, int: 0, vit: 0 } },
    { id: 38, name: '智力+6',             stats: { str: 0, agi: 0, int: 6, vit: 0 } },
    { id: 39, name: '耐力+6',             stats: { str: 0, agi: 0, int: 0, vit: 6 } },
    { id: 40, name: '全属性+1力量+3',     stats: { str: 4, agi: 1, int: 1, vit: 1 } },
    { id: 41, name: '全属性+1敏捷+3',     stats: { str: 1, agi: 4, int: 1, vit: 1 } },
    { id: 42, name: '全属性+1智力+3',     stats: { str: 1, agi: 1, int: 4, vit: 1 } },
    { id: 43, name: '全属性+1耐力+3',     stats: { str: 1, agi: 1, int: 1, vit: 4 } },
    { id: 44, name: '力量+4敏捷+3',       stats: { str: 4, agi: 3, int: 0, vit: 0 } },
    { id: 45, name: '敏捷+4智力+3',       stats: { str: 0, agi: 4, int: 3, vit: 0 } },
    { id: 46, name: '全属性+2',           stats: { str: 2, agi: 2, int: 2, vit: 2 } },
    { id: 47, name: '力量+5耐力+5',       stats: { str: 5, agi: 0, int: 0, vit: 5 } },
    { id: 48, name: '敏捷+5智力+5',       stats: { str: 0, agi: 5, int: 5, vit: 0 } },
    { id: 49, name: '力量+4敏捷+4智力+4', stats: { str: 4, agi: 4, int: 4, vit: 0 } },
    { id: 50, name: '全属性+3',           stats: { str: 3, agi: 3, int: 3, vit: 3 } },
];

/** 剑技稀有度骰子表 (1D20): 1-10=白, 11-16=绿, 17-19=蓝, 20=紫 */
const SKILL_RARITY_TABLE = [
    { roll: [1,10],  name: '白色', mult: 1.0 },
    { roll: [11,16], name: '绿色', mult: 1.2 },
    { roll: [17,19], name: '蓝色', mult: 1.5 },
    { roll: [20,20], name: '紫色', mult: 2.0 },
];

/** 剑技核心功能骰子表 (1D20): 1-16=伤害A1, 17=终结技A5, 18=生命恢复A2, 19=法力恢复A3, 20=牺牲增益A4 */
const SKILL_CORE_TABLE = [
    { roll: [1,16],  code: 'A1', name: '伤害' },
    { roll: [17,17], code: 'A5', name: '终结技' },
    { roll: [18,18], code: 'A2', name: '生命恢复' },
    { roll: [19,19], code: 'A3', name: '法力恢复' },
    { roll: [20,20], code: 'A4', name: '牺牲增益' },
];

/** 章节 -> 世界书条目名称前缀映射 (FIX 4) */
const ARC_NAME_PREFIXES = {
    sao:     ['sao-', 'sao'],
    alo_old: ['\u65E7alo-', '\u65E7alo', '\u65E7ALO'],
    alo_new: ['\u65B0\u751Falo-', '\u65B0\u751Falo', '\u65B0\u751FALO'],
    ggo:     ['ggo-', 'ggo', 'GGO'],
    real:    ['\u73B0\u5B9E', '\u771F\u5B9E\u4E16\u754C'],
};

// 骰子工具函数
function rollDice(sides) { return Math.floor(Math.random() * sides) + 1; }
function lookupRoll(table, rollValue) {
    for (const entry of table) {
        if (rollValue >= entry.roll[0] && rollValue <= entry.roll[1]) return entry;
    }
    return table[table.length - 1];
}
function resolveAffixStats(affixEntry) {
    if (!affixEntry) return { str: 0, agi: 0, int: 0, vit: 0 };
    if (affixEntry.stats) return { ...affixEntry.stats };
    const keys = ['str', 'agi', 'int', 'vit'];
    const r = { str: 0, agi: 0, int: 0, vit: 0 };
    r[keys[Math.floor(Math.random() * 4)]] = 4;
    return r;
}

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // 多模型 API 配置 (直接存储 endpoint/key/model)
    models: {
        narrative: { url: '', key: '', model: '' },
        combat:    { url: '', key: '', model: '' },
        extract:   { url: '', key: '', model: '' },
    },
    // 章节
    currentArc: 'sao',
    // SAO 卡兼容模式（替代 TavernHelper 脚本）
    compatMode: true,  // 自动关闭不兼容选项 + 启用角色卡正则
});

// ============================================================
// 设置管理
// ============================================================

function getContext() {
    return SillyTavern.getContext();
}

function getSettings() {
    const ctx = getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    // 兼容旧版本：确保 models 对象存在
    if (!ctx.extensionSettings[MODULE_NAME].models) {
        ctx.extensionSettings[MODULE_NAME].models = structuredClone(DEFAULT_SETTINGS.models);
    }
    return ctx.extensionSettings[MODULE_NAME];
}

function saveSettings() {
    saveSettingsDebounced();
}

// ============================================================
// 工具函数
// ============================================================

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 白名单清洗内联 HTML，仅保留 SAO 卡中常见的安全标签与属性。
 * 允许：br, font[color], span[style|color], b, strong, i, em
 * 移除：script/style/事件属性/data-/javascript: 等。
 */
function sanitizeInlineSaoHtml(html) {
    if (!html) return '';
    const allowed = {
        br: {},
        font: { color: true },
        span: { style: true, color: true },
        b: {},
        strong: {},
        i: {},
        em: {},
    };
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;
    function walk(node) {
        if (node.nodeType === 3) return document.createTextNode(node.data);
        if (node.nodeType !== 1) return null;
        const tag = node.nodeName.toLowerCase();
        if (!allowed[tag]) {
            if (tag === 'script' || tag === 'style' || tag === 'template') return null;
            const frag = document.createDocumentFragment();
            for (const child of Array.from(node.childNodes)) {
                const n = walk(child);
                if (n) frag.appendChild(n);
            }
            return frag;
        }
        const spec = allowed[tag];
        const el = document.createElement(tag);
        for (const attr of Array.from(node.attributes)) {
            const aname = attr.name.toLowerCase();
            if (aname.startsWith('on')) continue;
            if (/^data-/i.test(aname)) continue;
            if (aname === 'style') {
                const styleVal = attr.value.toLowerCase();
                if (/javascript\s*:|expression\s*\(|behavior\s*:|url\s*\(\s*['"]?\s*(?:javascript|data)\s*:/i.test(styleVal)) continue;
                const safeStyle = styleVal.split(';').every(part => {
                    const [prop] = part.split(':');
                    const name = (prop || '').trim();
                    return !name || ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration'].includes(name);
                });
                if (!safeStyle) continue;
            }
            if (spec[aname]) el.setAttribute(attr.name, attr.value);
        }
        for (const child of Array.from(node.childNodes)) {
            const n = walk(child);
            if (n) el.appendChild(n);
        }
        return el;
    }
    const out = document.createElement('div');
    for (const child of Array.from(root.childNodes)) {
        const n = walk(child);
        if (n) out.appendChild(n);
    }
    return out.innerHTML;
}


/**
 * 根据 year/month/current_day/days 生成原卡日历网格 HTML。
 * 使用原卡 class 名：day, day empty, day current-day, day-number, day-content, normal-text。
 * Weekday 顺序：周一到周日。
 */
function buildCalendarGrid(year, month, currentDay, days) {
    const y = Number(year), m = Number(month), cd = Number(currentDay);
    if (!y || !m || y < 1 || m < 1 || m > 12) return '';
    const firstDayOfWeek = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m, 0).getDate();
    const dayContentMap = {};
    if (Array.isArray(days)) {
        for (const d of days) {
            const num = typeof d === 'object' ? (d.day ?? d.date) : Number(d);
            if (num != null && !isNaN(num)) {
                const info = typeof d === 'object' ? d : { events: [String(d)] };
                const events = Array.isArray(info.events) ? info.events : (info.label ? [info.label] : []);
                if (events.length) dayContentMap[Number(num)] = events.slice(0, 10);
            }
        }
    } else if (days && typeof days === 'object') {
        for (const [k, v] of Object.entries(days)) {
            const num = Number(k);
            if (!isNaN(num)) {
                const items = typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [String(v)];
                dayContentMap[num] = items.slice(0, 10);
            }
        }
    }
    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
        cells += '<div class="day empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const isCurrent = day === cd;
        const cls = isCurrent ? 'day current-day' : 'day';
        const numHtml = '<div class="day-number">' + day + '</div>';
        const events = dayContentMap[day];
        let contentHtml = '';
        if (events && events.length) {
            contentHtml = '<div class="day-content">' +
                events.filter(t => t && t.length <= 100).map(t => '<div class="normal-text">' + esc(t) + '</div>').join('') +
                '</div>';
        }
        cells += '<div class="' + cls + '">' + numHtml + contentHtml + '</div>';
    }
    return cells;
}

/**
 * 解析旧正则常见的 key: value 日历文本，例如：
 * year: 2022\nmonth: 11\ncurrent_day: 6\ndays: ...
 */
function parseCalendarKeyValueText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const data = {};
    let currentKey = null;
    let matched = 0;
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$/);
        if (m) {
            currentKey = m[1].toLowerCase();
            data[currentKey] = m[2].trim();
            matched += 1;
        } else if (currentKey && line.trim()) {
            data[currentKey] += `${data[currentKey] ? '\n' : ''}${line.trim()}`;
        }
    }
    if (!matched || !(data.year || data.month || data.current_day || data.days)) return null;

    data.text = text.trim();

    if (data.days && typeof data.days === 'string') {
        data.day_events = data.days;
        const parsedDays = [];
        let current = null;
        for (const rawLine of data.days.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const dayM = line.match(/^(?:day\s*)?(\d{1,2})\s*[:：\-]\s*(.*)$/i);
            if (dayM) {
                current = { day: Number(dayM[1]), events: [] };
                if (dayM[2].trim()) current.events.push(dayM[2].trim());
                parsedDays.push(current);
            } else if (current) {
                current.events.push(line.replace(/^[-*•]\s*/, ''));
            }
        }
        if (parsedDays.length) {
            data.days = parsedDays.map(day => {
                const firstEvent = day.events.find(Boolean) || '';
                return {
                    day: day.day,
                    label: firstEvent.slice(0, 18),
                    events: day.events,
                };
            });
        }
    }
    return data;
}

function wrapAsync(fn) {
    return (...args) => {
        try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function') {
                result.catch(e => log(`${fn.name || 'event handler'} error: ${e.message}`, 'error'));
            }
        } catch (e) {
            log(`${fn.name || 'event handler'} error: ${e.message}`, 'error');
        }
    };
}

const _processingLocks = {};
function withProcessingLock(key, fn) {
    const prev = _processingLocks[key] || Promise.resolve();
    const next = prev.then(() => fn()).catch(e => {
        log(`Processing error (${key}): ${e.message}`, 'error');
    }).finally(() => {
        // 没有后续任务排队进来时，清理自己，避免内存长期累积
        if (_processingLocks[key] === next) delete _processingLocks[key];
    });
    _processingLocks[key] = next;
    return next;
}

// ============================================================
// Phase 3: Prompt 清理 / 替代 promptOnly 正则
// ============================================================

/**
 * 需要从 prompt 中删除的 SAO 标签
 * 
 * 注意：此列表与 createSaoShadowHost 中的 CSS 隐藏列表不同：
 * - CSS 隐藏列表（calendar, user_status, equip, swordskill, map, zd_status）：
 *   只隐藏有 Shadow DOM 渲染器的标签，避免双重渲染
 * - Prompt 清理列表（本列表，12 个标签）：
 *   清理所有不应进入模型上下文的大块标签，无论是否有渲染器
 * - 差异：equip/swordskill 在 CSS 中隐藏但不从 prompt 清理（模型需要装备/技能数据）
 *         digest/guild/npc_status 等在 prompt 中清理但不 CSS 隐藏（无渲染器，不需要隐藏）
 */
const SAO_PROMPT_STRIP_TAGS = [
    'zd_status',
    'user_status',
    'calendar',
    'map',
    'digest',
    'guild',
    'npc_status',
    'npc_thoughts',
    'dice',
    'action',
    'preview',
    'output_instruction',
];

/**
 * 从文本中删除 SAO 标签块
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 */
function cleanSaoPromptText(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const tag of SAO_PROMPT_STRIP_TAGS) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
        out = out.replace(re, '');
    }
    // 清理多余空行
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

function getCurrentCharacter() {
    const ctx = getContext();
    if (ctx.characterId === undefined || ctx.characterId === null) return null;
    return ctx.characters?.[ctx.characterId] ?? null;
}

function isSaoCard() {
    const char = getCurrentCharacter();
    if (!char) return false;
    return char.name === '刀剑神域SAO' || (typeof char.data?.extensions?.world === 'string' && char.data.extensions.world.startsWith('刀剑神域SAO'));
}

function getSaoData() {
    const ctx = getContext();
    const meta = ctx.chatMetadata;
    if (!meta) return null;  // 群聊或异常情况
    if (!meta[MODULE_NAME]) {
        // v1 迁移：尝试从旧的角色卡 extension field 迁移
        const char = getCurrentCharacter();
        const legacy = char?.data?.extensions?.sao_companion;
        if (legacy && legacy.state) {
            meta[MODULE_NAME] = {
                state: legacy.state || null,
                arc: legacy.arc || 'sao',
                _migrated: true,
            };
            log('从角色卡迁移 v1 数据到 chatMetadata');
        } else {
            meta[MODULE_NAME] = {
                state: null, arc: 'sao',
            };
        }
    }
    const d = meta[MODULE_NAME];
    // 兼容旧字段
    if (!d.quests) d.quests = [];
    return d;
}

function saveSaoData() {
    const ctx = getContext();
    if (ctx.saveMetadataDebounced) {
        ctx.saveMetadataDebounced();
    }
}

async function saveSaoDataNow() {
    const ctx = getContext();
    if (ctx.saveMetadata) {
        await ctx.saveMetadata();
    }
}

// ============================================================
// 战斗状态持久化
// ============================================================

let _battleSaveTimer = null;

/**
 * 节流保存战斗状态到 chatMetadata（2秒节流）
 */
function saveBattleStateThrottled() {
    if (_battleSaveTimer) return;
    _battleSaveTimer = setTimeout(() => {
        _battleSaveTimer = null;
        try {
            const data = getSaoData();
            if (!data) return;
            const snapshot = serializeBattleState();
            if (snapshot) {
                if (!data.battle) data.battle = {};
                data.battle = snapshot;
                saveSaoDataNow();
            }
        } catch (e) {
            log('保存战斗状态失败: ' + e.message, 'warn');
        }
    }, 2000);
}

/**
 * 清除战斗状态（战斗结束时调用）
 */
function clearBattleState() {
    try {
        const data = getSaoData();
        if (data && data.battle) {
            data.battle = null;
            saveSaoDataNow();
        }
    } catch (e) {
        log('清除战斗状态失败: ' + e.message, 'warn');
    }
}

/**
 * 检查是否有待恢复的战斗状态
 * 在 renderBattlePanel 渲染后调用
 */
function restoreBattleIfPending() {
    try {
        const data = getSaoData();
        if (!data || !data.battle || !data.battle.isActive) return false;
        const restored = restoreBattleState(data.battle);
        if (restored) {
            log('战斗状态已恢复');
        }
        return restored;
    } catch (e) {
        log('恢复战斗状态失败: ' + e.message, 'warn');
        return false;
    }
}

// ============================================================
// 日志系统
// ============================================================

const logs = [];
const MAX_LOGS = 100;

function log(msg, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), level, msg };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[SAO Companion] ${prefix} ${msg}`);
    // 更新面板日志显示
    updateLogDisplay();
}

function updateLogDisplay() {
    const el = document.getElementById('sao_log_display');
    if (!el) return;
    el.innerHTML = logs.slice().reverse().map(e =>
        `<div class="sao-log-entry"><span class="sao-log-time">${esc(e.time)}</span>${esc(e.msg)}</div>`
    ).join('');
}

// ============================================================
// 模型调用核心 (直接调用 OpenAI 兼容 API)
// ============================================================

/**
 * 拉取模型列表
 * @param {string} role - narrative|combat|extract
 * @returns {Promise<string[]>} 模型 ID 列表
 */
async function fetchModelList(role) {
    const settings = getSettings();
    const cfg = settings.models[role];
    if (!cfg.url) throw new Error('请先填写 API 地址');

    // 标准化 URL：去掉尾部斜杠，确保有 /v1
    let baseUrl = cfg.url.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) baseUrl += '/v1';

    const url = `${baseUrl}/models`;
    log(`拉取模型列表: ${url}`);

    const resp = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${cfg.key}`,
        },
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 200)}`);
    }

    const data = await resp.json();
    const models = (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
    models.sort();
    log(`拉取到 ${models.length} 个模型`);
    return models;
}

/**
 * 调用模型 (OpenAI 兼容格式)
 * @param {string} role - narrative|combat|extract
 * @param {Array<{role:string,content:string}>} messages
 * @param {number} maxTokens
 * @param {object} [opts] - {temperature, jsonSchema, prefill}
 * @returns {Promise<string>}
 */
async function callModel(role, messages, maxTokens = 512, opts = {}) {
    const settings = getSettings();
    const cfg = settings.models[role];

    // 没有配置 API → 回退到酒馆主模型
    if (!cfg.url || !cfg.model) {
        log(`${ROLE_LABELS[role]} 未配置，回退到主模型`, 'warn');
        return await callViaMainModel(messages, maxTokens, opts);
    }

    // 标准化 URL
    let baseUrl = cfg.url.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) baseUrl += '/v1';

    const url = `${baseUrl}/chat/completions`;
    log(`调用 ${ROLE_LABELS[role]}: ${cfg.model}`);

    const body = {
        model: cfg.model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
        stream: false,
    };

    // 预填充 (Anthropic 风格)
    if (opts.prefill) {
        body.messages.push({ role: 'assistant', content: opts.prefill });
    }

    // JSON Schema (仅对 OpenAI 兼容 API 发送，Ollama/Claude 不支持)
    if (opts.jsonSchema) {
        const isOpenAICompatible = !cfg.url?.includes('ollama') && !cfg.model?.includes('claude');
        if (isOpenAICompatible) {
            body.response_format = { type: 'json_object' };
        }
    }

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.key}`,
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`${ROLE_LABELS[role]} 调用失败: HTTP ${resp.status} - ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    log(`${ROLE_LABELS[role]} 调用成功 (${content.length} 字符)`);
    return content;
}

/**
 * 回退：使用酒馆主模型
 */
async function callViaMainModel(messages, maxTokens, opts) {
    const ctx = getContext();
    const quietPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    return await ctx.generateQuietPrompt({
        quietPrompt,
        skipWIAN: true,
        responseLength: maxTokens,
        ...opts,
    });
}

// ============================================================
// 子代理任务
// ============================================================

// ============================================================
// <zd_status> 和 <user_status> 正则解析器 (FIX 1)
// ============================================================

/**
 * 从 <zd_status> 压缩格式解析游戏状态
 * 格式: [PR:name][GR:level][HP:cur/max]...[WE:name][ATK:x]...[FRN:name]...[ENN:name]...
 * @param {string} zdText - zd_status 标签内的文本
 * @returns {{ player: object, skills: array, teammates: array, enemies: array }}
 */
function parseZdStatus(zdText) {
    const result = { player: {}, skills: [], teammates: [], enemies: [] };

    // 去掉换行和多余空白，然后按 ][ 分割成 token
    const flat = zdText.replace(/[\r\n]+/g, '').replace(/\*\*.*?\*\*\s*/g, '');
    const rawTokens = flat.replace(/^\[/, '').replace(/\]$/, '').split(/\]\[/);

    // --- 定位各段边界 ---
    let frIdx = -1, enIdx = -1;
    for (let j = 0; j < rawTokens.length; j++) {
        if (rawTokens[j].startsWith('FRN:') && frIdx < 0) frIdx = j;
        if (rawTokens[j].startsWith('ENN:') && enIdx < 0) enIdx = j;
    }

    // --- 解析玩家段 [PR:...] ~ [FRN:...] 或 [ENN:] ---
    const playerEnd = frIdx >= 0 ? frIdx : (enIdx >= 0 ? enIdx : rawTokens.length);
    const playerTokens = rawTokens.slice(0, playerEnd);
    let currentSkill = null;
    const playerSkills = [];
    const player = {};

    for (const tok of playerTokens) {
        if (tok.startsWith('PR:')) { player.name = tok.substring(3); }
        else if (tok.startsWith('GR:')) { player.level = parseInt(tok.substring(3)) || 0; }
        else if (tok.startsWith('HP:')) {
            const p = tok.substring(3).split('/');
            player.hp = parseInt(p[0]) || 0; player.max_hp = parseInt(p[1]) || 0;
        } else if (tok.startsWith('MP:') && !tok.startsWith('MPCost:')) {
            const p = tok.substring(3).split('/');
            player.mp = parseInt(p[0]) || 0; player.max_mp = parseInt(p[1]) || 0;
        } else if (tok.startsWith('STR:')) { player.str = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('AGI:')) { player.agi = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('INT:')) { player.int = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('VIT:')) { player.vit = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('IT:')) {
            const parts = tok.substring(3).split(',');
            if (!player.items) player.items = [];
            player.items.push({ name: parts[0], qty: parseInt(parts[1]) || 1 });
        }
        else if (/^P\d+[A-Z]?[:]/.test(tok)) {
            if (!player.potionCodes) player.potionCodes = [];
            player.potionCodes.push(tok);
        }
        else if (tok.startsWith('WE:')) {
            if (currentSkill) playerSkills.push(currentSkill);
            currentSkill = { name: tok.substring(3) };
        }
        else if (currentSkill) {
            if (tok.startsWith('ATK:')) currentSkill.atk = parseInt(tok.substring(4)) || 0;
            else if (tok.startsWith('Hit%:')) currentSkill.hit = parseInt(tok.substring(5)) || 0;
            else if (tok.startsWith('Crit%:')) currentSkill.crit = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('APT:')) currentSkill.apt = parseInt(tok.substring(4)) || 0;
            else if (tok.startsWith('TPA:')) currentSkill.tpa = parseInt(tok.substring(4)) || 0;
            else if (tok.startsWith('MPCost:')) currentSkill.mpCost = parseInt(tok.substring(7)) || 0;
            else if (tok.startsWith('CD:')) currentSkill.cd = parseInt(tok.substring(3)) || 0;
            else if (tok.startsWith('WN:')) currentSkill.wn = tok.substring(3);
            else if (tok.startsWith('EN:')) {
                if (!currentSkill.en) currentSkill.en = [];
                currentSkill.en.push(tok.substring(3));
            }
            else if (tok.startsWith('MN:') || tok.startsWith('FR') || tok.startsWith('EN')) {
                playerSkills.push(currentSkill); currentSkill = null;
            }
        }
    }
    if (currentSkill) playerSkills.push(currentSkill);
    result.player = player;
    result.skills = playerSkills;

    // --- 解析队友段 [FRN:...] ---
    if (frIdx >= 0) {
        const teamEnd = enIdx >= 0 ? enIdx : rawTokens.length;
        const teamTokens = rawTokens.slice(frIdx, teamEnd);
        const tm = {};
        let frSkill = null;
        for (const tok of teamTokens) {
            if (tok.startsWith('FRN:')) tm.name = tok.substring(4);
            else if (tok.startsWith('FRGR:')) tm.level = parseInt(tok.substring(5)) || 0;
            else if (tok.startsWith('FRHP:')) {
                const p = tok.substring(5).split('/');
                tm.hp = parseInt(p[0]) || 0; tm.max_hp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('FRMP:')) {
                const p = tok.substring(5).split('/');
                tm.mp = parseInt(p[0]) || 0; tm.max_mp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('FRSTR:')) tm.str = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRAGI:')) tm.agi = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRINT:')) tm.int = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRVIT:')) tm.vit = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRWE:')) {
                if (frSkill) tm.skills = [...(tm.skills || []), frSkill];
                frSkill = { name: tok.substring(5) };
            } else if (frSkill) {
                if (tok.startsWith('ATK:')) frSkill.atk = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('Hit%:')) frSkill.hit = parseInt(tok) || 0;
                else if (tok.startsWith('Crit%:')) frSkill.crit = parseInt(tok) || 0;
                else if (tok.startsWith('APT:')) frSkill.apt = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('TPA:')) frSkill.tpa = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('MPCost:')) frSkill.mpCost = parseInt(tok.substring(7)) || 0;
                else if (tok.startsWith('CD:')) frSkill.cd = parseInt(tok.substring(3)) || 0;
                else if (tok.startsWith('WN:')) frSkill.wn = tok.substring(3);
            }
        }
        if (frSkill) tm.skills = [...(tm.skills || []), frSkill];
        if (tm.name) result.teammates.push(tm);
    }

    // --- 解析敌人段 [ENN:...] ---
    if (enIdx >= 0) {
        const enemyTokens = rawTokens.slice(enIdx);
        let curEnemy = null, curESkill = null;
        for (const tok of enemyTokens) {
            if (tok.startsWith('ENN:')) {
                if (curEnemy) { if (curESkill) { curEnemy.skills.push(curESkill); curESkill = null; } result.enemies.push(curEnemy); }
                curEnemy = { name: tok.substring(4), skills: [] };
            } else if (!curEnemy) continue;
            else if (tok.startsWith('ENGR:')) curEnemy.level = parseInt(tok.substring(5)) || 0;
            else if (tok.startsWith('ENHP:')) {
                const p = tok.substring(5).split('/');
                curEnemy.hp = parseInt(p[0]) || 0; curEnemy.max_hp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('ENSTR:')) curEnemy.str = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENAGI:')) curEnemy.agi = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENINT:')) curEnemy.int = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENVIT:')) curEnemy.vit = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENS:')) {
                if (curESkill) curEnemy.skills.push(curESkill);
                curESkill = { name: tok.substring(4) };
            } else if (curESkill) {
                if (tok.startsWith('ATK:')) curESkill.atk = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('Hit%:')) curESkill.hit = parseInt(tok) || 0;
                else if (tok.startsWith('Crit%:')) curESkill.crit = parseInt(tok) || 0;
                else if (tok.startsWith('APT:')) curESkill.apt = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('TPA:')) curESkill.tpa = parseInt(tok.substring(4)) || 0;
                else if (tok.startsWith('MN:')) {
                    if (!curESkill.mn) curESkill.mn = [];
                    curESkill.mn.push(tok.substring(3));
                }
            }
            if (tok.startsWith('PN5A:')) {
                if (curESkill) { curEnemy.skills.push(curESkill); curESkill = null; }
                curEnemy.attackPattern = tok.substring(5).split(',');
            }
        }
        if (curEnemy) { if (curESkill) curEnemy.skills.push(curESkill); result.enemies.push(curEnemy); }
    }
    return result;
}

/**
 * 从 <user_status> 的 <details> 块解析装备/背包/技能/属性等
 */
function parseUserStatus(statusText) {
    const state = {};
    const hpM = statusText.match(/\u5F53\u524D\u751F\u547D\u503C[：:]\s*(\d+)\/(\d+)/);
    if (hpM) { state.hp = parseInt(hpM[1]); state.max_hp = parseInt(hpM[2]); }
    const mpM = statusText.match(/\u5F53\u524D\u6CD5\u529B\u503C[：:]\s*(\d+)\/(\d+)/);
    if (mpM) { state.mp = parseInt(mpM[1]); state.max_mp = parseInt(mpM[2]); }
    const strM = statusText.match(/\u529B\u91CF\s*\u0028STR\u0029[：:]\s*(\d+)/);
    if (strM) state.str = parseInt(strM[1]);
    const agiM = statusText.match(/\u654F\u6377\s*\u0028AGI\u0029[：:]\s*(\d+)/);
    if (agiM) state.agi = parseInt(agiM[1]);
    const intM = statusText.match(/\u667A\u529B\s*\u0028INT\u0029[：:]\s*(\d+)/);
    if (intM) state.int = parseInt(intM[1]);
    const vitM = statusText.match(/\u8010\u529B\s*\u0028VIT\u0029[：:]\s*(\d+)/);
    if (vitM) state.vit = parseInt(vitM[1]);
    const lvlM = statusText.match(/\u5F53\u524D\u7B49\u7EA7[：:]\s*Lv\.?(\d+)/i);
    if (lvlM) state.level = parseInt(lvlM[1]);
    const expM = statusText.match(/\u603B\u7ECF\u9A8C\u503C[：:]\s*(\d+)/);
    if (expM) state.exp = parseInt(expM[1]);
    const corM = statusText.match(/\u73C2\u5C14\s*\u0028Cor\u0029[：:]\s*(\d+)/);
    if (corM) state.cor = parseInt(corM[1]);
    const yuldM = statusText.match(/\u7531\u9C81\u7279\s*\u0028Yuld\u0029[：:]\s*(\d+)/);
    if (yuldM && !state.cor) state.cor = parseInt(yuldM[1]);

    // 装备解析: "主手: ⭐Lv.5 铁剑 (耐:100/100)" followed by stats line "❤️+50 💪+2 🏃+0 🧠+0 🔋+6"
    state.equipment = {};
    const equipSlotMap = { '主手': 'main_hand', '副手': 'off_hand', '头部': 'head', '胸部': 'body', '手部': 'hands', '腿部': 'feet', '饰品': 'accessory' };
    // 匹配 "主手: ⭐Lv.5 铁剑 (耐:100/100)" 格式
    const equipLines = statusText.match(/(?:主手|副手|头部|胸部|手部|腿部|饰品)\s*(?:1|2)?\s*[：:]\s*\S+/g) || [];
    for (const line of equipLines) {
        const slotMatch = line.match(/(主手|副手|头部|胸部|手部|腿部|饰品)/);
        if (!slotMatch) continue;
        const slotKey = equipSlotMap[slotMatch[1]] || 'accessory';
        // 提取等级
        const lvlMatch = line.match(/⭐Lv\.?(\d+)/i) || line.match(/Lv\.?(\d+)/i);
        // 提取名称：⭐Lv.5 后面的词，或 ：后面的词
        const nameMatch = line.match(/⭐?Lv\.?\d*\s*(\S+)/);
        // 提取耐久
        const durMatch = line.match(/\(耐[:：](\d+\/\d+)\)/) || line.match(/耐[:：](\d+\/\d+)/);
        // 提取该行后面的属性行 "❤️+50 💪+2 🏃+0 🧠+0 🔋+6"
        const lineIdx = statusText.indexOf(line);
        const afterLine = statusText.substring(lineIdx + line.length, lineIdx + line.length + 200);
        const statsLine = afterLine.match(/❤️\+(\d+).*?💪\+(\d+).*?🏃\+(\d+).*?🧠\+(\d+).*?🔋\+(\d+)/s);
        
        const equip = { name: nameMatch ? nameMatch[1] : '未知' };
        if (lvlMatch) equip.item_level = parseInt(lvlMatch[1]);
        if (durMatch) equip.durability = durMatch[1];
        if (statsLine) {
            equip.stats = {
                max_hp: parseInt(statsLine[1]) || 0,
                str: parseInt(statsLine[2]) || 0,
                agi: parseInt(statsLine[3]) || 0,
                int: parseInt(statsLine[4]) || 0,
                vit: parseInt(statsLine[5]) || 0,
            };
        }
        state.equipment[slotKey] = equip;
    }

    // 背包: "• 初级治疗药水 x 10 (⭐Lv.1, 瞬间恢复100点HP。)" or equipment "• 铁剑 (耐:100/100) | 武器\n(⭐Lv.5|💎蓝色|❤️HP+75|💪STR+2|🔋VIT+6)"
    state.inventory = [];
    const invMatches = statusText.matchAll(/[•]\s*(.+?)\s*x\s*(\d+)\s*(?:\((.+?)\))?/g);
    for (const m of invMatches) {
        const item = { name: m[1].trim(), qty: parseInt(m[2]) || 1 };
        if (m[3]) {
            const detail = m[3].trim();
            // Try to extract item level: ⭐Lv.1 or ⭐Lv1
            const lvlMatch = detail.match(/⭐Lv\.?(\d+)/);
            if (lvlMatch) item.item_level = parseInt(lvlMatch[1]);
            // Try to extract rarity: 💎蓝色 etc.
            const rarMatch = detail.match(/💎(\S+)/);
            if (rarMatch) item.rarity = rarMatch[1];
            // The description is the rest after the level portion
            // e.g. "⭐Lv.1, 瞬间恢复100点HP。" → "瞬间恢复100点HP。"
            const descParts = detail.split(/[,，]\s*/);
            const descFiltered = descParts.filter(p => p.trim() && !p.match(/⭐Lv/)).map(p => p.trim());
            if (descFiltered.length > 0) item.description = descFiltered.join('，');
            else item.description = detail;
        }
        state.inventory.push(item);
    }

    // Also handle equipment-style backpack entries: "• 铁剑 (耐:100/100) | 武器\n(⭐Lv.5|💎蓝色|❤️HP+75|💪STR+2|🔋VIT+6)"
    const equipInvBlocks = statusText.match(/[•]\s*(\S+)\s*\(耐[:：](\d+\/\d+)\)\s*\|\s*(\S+)\s*\n?\s*\(([^)]+)\)/g) || [];
    for (const block of equipInvBlocks) {
        const bm = block.match(/[•]\s*(\S+)\s*\(耐[:：](\d+\/\d+)\)\s*\|\s*(\S+)\s*\n?\s*\(([^)]+)\)/);
        if (bm) {
            const item = { name: bm[1].trim(), qty: 1, type: bm[3].trim(), durability: bm[2] };
            const detail = bm[4];
            const lvlMatch = detail.match(/⭐Lv\.?(\d+)/);
            if (lvlMatch) item.item_level = parseInt(lvlMatch[1]);
            const rarMatch = detail.match(/💎(\S+)/);
            if (rarMatch) item.rarity = rarMatch[1];
            // Parse stats like ❤️HP+75|💪STR+2|🔋VIT+6
            const stats = [];
            const statMatches = detail.matchAll(/[❤️💪🔋⚔️🛡️]\s*(\w+)[+\s]*(\d+)/g);
            for (const sm of statMatches) stats.push(`${sm[1]}+${sm[2]}`);
            if (stats.length > 0) item.description = stats.join('，');
            item._equip_backpack = true;
            state.inventory.push(item);
        }
    }

    // 技能: 卡片格式为 "• 刺击 (技能等级: 1)" 或 "• 刺击 Lv1"
    state.skills = [];
    const skillMatches = statusText.matchAll(/[•]\s*(\S+)\s*(?:\(\s*技能等级\s*[:：]\s*(\d+)\s*\)|Lv\.?\s*(\d+))/gi);
    for (const m of skillMatches) {
        const level = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : 0);
        state.skills.push({ name: m[1], skill_level: level });
    }

    return state;
}

// ============================================================
// M8: 多任务提取器（一次提取状态+关系 tier 变化+队友变化）
// ============================================================

/**
 * 提取游戏状态 (HP/MP/属性/物品/技能/位置)
 * FIX 1: 优先从 <zd_status> 和 <user_status> 标签直接解析，仅在找不到时回退到模型
 */
async function extractAll(aiMessage) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    // === FIX 1: 优先从 <zd_status> 和 <user_status> 直接解析 ===
    const state = {};
    let parsedFromTags = false;

    // 1) 解析 <zd_status>
    const zdMatch = aiMessage.match(/<zd_status>([\s\S]*?)<\/zd_status>/);
    if (zdMatch) {
        try {
            const zd = parseZdStatus(zdMatch[1]);
            if (zd.player.name) state.player_name = zd.player.name;
            if (zd.player.level) state.level = zd.player.level;
            if (zd.player.hp != null) { state.hp = zd.player.hp; state.max_hp = zd.player.max_hp; }
            if (zd.player.mp != null) { state.mp = zd.player.mp; state.max_mp = zd.player.max_mp; }
            if (zd.player.str != null) { state.str = zd.player.str; state.agi = zd.player.agi; state.int = zd.player.int; state.vit = zd.player.vit; }
            if (zd.player.items) state.inventory = zd.player.items;
            if (zd.skills.length > 0) state.skills = zd.skills.map(s => ({
                name: s.name,
                skill_level: 0,
                base_damage: s.atk,
                hit_rate: s.hit,
                crit_rate: s.crit,
                mp_cost: s.mpCost,
                cooldown: s.cd,
                hits: s.apt,
                targets: s.tpa,
                core_code: s.wn,
                affix_codes: s.en || [],
                effects_description: (s.en || []).join(', '),
            }));
            state._zd_parsed = zd; // 保留完整解析供战斗/队友使用
            parsedFromTags = true;
            log('<zd_status> 正则解析成功');
        } catch (e) {
            log('<zd_status> 解析失败: ' + e.message, 'warn');
        }
    }

    // 2) 解析 <user_status> (装备/背包/技能/属性/位置)
    const statusMatch = aiMessage.match(/<user_status>([\s\S]*?)<\/user_status>/);
    if (statusMatch) {
        try {
            const us = parseUserStatus(statusMatch[1]);
            // 合并规则：
            // - equipment/inventory: user_status 优先（有描述/稀有度等详细信息）
            // - skills: zd_status 优先（有完整战斗属性 ATK/Hit%/Crit% 等），仅补充 skill_level
            for (const k of Object.keys(us)) {
                if (k === 'equipment' || k === 'inventory') {
                    if (us[k] && (Array.isArray(us[k]) ? us[k].length > 0 : Object.keys(us[k]).length > 0)) {
                        state[k] = us[k];
                    }
                } else if (k === 'skills') {
                    // 技能：不覆盖 zd_status 的完整数据，仅补充 skill_level
                    // user_status 的技能格式是 "• 刺击 (技能等级: 1)"，解析为 {name, skill_level}
                    if (us.skills && us.skills.length > 0 && state.skills && state.skills.length > 0) {
                        for (const usSk of us.skills) {
                            const zdSk = state.skills.find(s => s.name === usSk.name);
                            if (zdSk && usSk.skill_level != null) {
                                zdSk.skill_level = usSk.skill_level;
                            }
                        }
                    }
                    // 如果 zd_status 没有技能数据，才用 user_status 的（fallback）
                    if ((!state.skills || state.skills.length === 0) && us.skills && us.skills.length > 0) {
                        state.skills = us.skills;
                    }
                } else if (us[k] != null) {
                    state[k] = us[k];
                }
            }
            parsedFromTags = true;
            log('<user_status> 正则解析成功');
        } catch (e) {
            log('<user_status> 解析失败: ' + e.message, 'warn');
        }
    }

    // 3) 解析 <time> 标签获取位置/楼层/章节信息
    const timeMatch = aiMessage.match(/<time>([\s\S]*?)<\/time>/);
    if (timeMatch) {
        const timeText = timeMatch[1];
        // 格式: 『[date] - [Seq: N] - [time] - [arc] - [floor] - [location] - [weather]』
        const parts = timeText.replace(/[『』]/g, '').split(/\s*-\s*/);
        if (parts.length >= 5) {
            // 找到 arc, floor, location
            for (let pi = 0; pi < parts.length; pi++) {
                const p = parts[pi].trim();
                if (/^\d+F$/i.test(p) && !state.floor) state.floor = parseInt(p) || null;
                if (/F$/.test(p) && !state.floor) state.floor = parseInt(p) || null;
            }
            // arc 通常是中文名如 "刀剑神域" / "幽灵子弹" 等
            // location 通常是最后一两个部分
            if (parts.length >= 6 && !state.location) {
                state.location = parts[parts.length - 2].trim();
            }
        }
    }

    if (parsedFromTags && Object.keys(state).length > 0) {
        log('状态从标签直接解析完成 (跳过模型调用)');
        return { state };
    }

    // === 回退: 使用模型提取 ===
    const systemPrompt = `你是 SAO 游戏状态提取器。分析 AI 的输出文本，提取游戏状态信息，只输出 JSON。注意查找 <zd_status> 和 <user_status> 标签中的数据。`;
    const userPrompt = `分析以下 SAO 游戏输出，提取数据，返回严格的 JSON：
{
  "state": {
    "hp": number, "max_hp": number, "mp": number, "max_mp": number,
    "str": number, "agi": number, "int": number, "vit": number,
    "level": number, "exp": number, "cor": number,
    "location": string, "floor": number, "arc": string,
    "player_name": string|null,
    "inventory": [{"name": string, "qty": number}],
    "skills": [{"name": string, "level": number}],
    "equipment": {"weapon": {"name": string, "stats": {"str": number, "vit": number, "hp": number}}}
  }
}

规则：
- 优先从 <zd_status> 和 <user_status> 标签内提取
- 如果某字段无法确定，用 null
- player_name 必须是玩家角色名，不是NPC名，无法确定则为 null

AI 输出：
---
${aiMessage.substring(0, 8000)}`;

    try {
        const result = await callModel('extract', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 1024, { jsonSchema: true });
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            log('多任务提取: 未找到 JSON', 'warn');
            return null;
        }
        const extracted = JSON.parse(jsonMatch[0]);
        log('多任务提取完成 (模型回退)');
        return extracted;
    } catch (e) {
        log('多任务提取失败: ' + e.message, 'error');
        return null;
    }
}

/**
 * 应用提取结果到数据 (FIX 1: 深度合并 equipment/inventory/skills)
 */
async function applyExtractedData(extracted) {
    if (!extracted) return;
    const data = getSaoData();
    if (!data) return;

    if (extracted.state) {
        const s = extracted.state;
        if (!data.state) data.state = {};

        // 标量字段直接覆盖
        const scalars = ['hp','max_hp','mp','max_mp','str','agi','int','vit','level','exp','cor','location','floor','arc','player_name'];
        for (const k of scalars) {
            if (s[k] != null) data.state[k] = s[k];
        }

        // equipment: 深度合并（保留已有槽位）
        if (s.equipment && typeof s.equipment === 'object') {
            if (!data.state.equipment) data.state.equipment = {};
            Object.assign(data.state.equipment, s.equipment);
        }

        // inventory: 合并（按 name 去重，用新数据完全覆盖旧条目以保留 description/item_level 等）
        if (Array.isArray(s.inventory) && s.inventory.length > 0) {
            if (!data.state.inventory) data.state.inventory = [];
            for (const newItem of s.inventory) {
                const existingIdx = data.state.inventory.findIndex(i => i.name === newItem.name);
                if (existingIdx >= 0) {
                    // 用新数据完全覆盖旧条目（保留完整字段：description, item_level, rarity 等）
                    data.state.inventory[existingIdx] = { ...newItem };
                } else {
                    data.state.inventory.push({ ...newItem });
                }
            }
        }

        // skills: 合并（按 name 去重，用新数据完全覆盖旧条目以保留 base_damage/hit_rate 等）
        if (Array.isArray(s.skills) && s.skills.length > 0) {
            if (!data.state.skills) data.state.skills = [];
            for (const newSk of s.skills) {
                const existingIdx = data.state.skills.findIndex(sk => sk.name === newSk.name);
                if (existingIdx >= 0) {
                    // 用新数据完全覆盖旧条目（保留完整战斗属性）
                    data.state.skills[existingIdx] = { ...newSk };
                } else {
                    data.state.skills.push({ ...newSk });
                }
            }
        }

        // 保留 zd 解析的内部数据（供战斗系统使用）
        if (s._zd_parsed) data.state._zd_parsed = s._zd_parsed;

        log('状态已更新');
    }

    await saveSaoDataNow();
}

// 保留旧函数名兼容（内部调用 extractAll）
async function extractState(aiMessage) {
    const extracted = await extractAll(aiMessage);
    await applyExtractedData(extracted);
    return extracted?.state || null;
}

async function calculateCombat(combatContext) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const systemPrompt = '你是 SAO 战斗数值判定器。根据玩家状态、敌人状态和行动，按公式计算战斗结果。只输出 JSON。';
    const formulas = `SAO 战斗公式:
HPRE = 10 + VIT + floor(VIT^2/100)
MPRE = 5 + floor(INT/4)
AP = 2 + floor(VIT/20)
速度 = 50 + AGI*2
闪避率 = AGI * 0.005
伤害加成 = STR * 0.01
减伤值 = STR * 1
承伤率 = 50 / (50 + VIT)
额外命中率 = AGI * 0.01
额外暴击率 = INT * 0.01
暴击伤害倍率 = 1.5 + INT*0.01
暴击率抵抗 = AGI*0.005 + INT*0.005
暴击伤害抵抗 = STR*0.005 + INT*0.005
最终命中率 = 技能基础命中率 + 额外命中率 - 敌人闪避率
最终暴击率 = 技能基础暴击率 + 额外暴击率 + max(0, 最终命中率-1)*0.5 - 敌人暴击率抵抗
最终暴击伤害倍率 = max(1.0, 暴击伤害倍率) + max(0, 最终暴击率-1)*0.5 - 敌人暴击伤害抵抗
基础伤害 = 技能ATK * (1+伤害加成) * 敌人承伤率
暴击后伤害 = 基础伤害 * 暴击伤害倍率
最终伤害 = 暴击后伤害 - 敌人减伤值 (非暴击则跳过暴击乘算)`;
    const userPrompt = `计算战斗结果，返回 JSON:
{"hit":boolean,"damage":number,"is_crit":boolean,"player_hp_after":number,"enemy_hp_after":number,"enemy_defeated":boolean,"exp_gained":number,"loot":[{"name":string,"qty":number}],"log":string}
${formulas}
玩家: ${JSON.stringify(combatContext.player)}
敌人: ${JSON.stringify(combatContext.enemy)}
行动: ${combatContext.action}`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 512);
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            log('战斗计算完成');
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch (e) {
        log('战斗计算失败: ' + e.message, 'error');
        return null;
    }
}

// ============================================================
// 生成子代理（武器/装备/剑技/物品/经验）— 用 combat 角色
// ============================================================

/**
 * 生成武器/装备 (FIX 3: 使用骰子表确定性计算数值，仅名称/描述由模型生成)
 * @param {object} context - { playerLevel, floor, type, rarity, name }
 * @returns {Promise<object|null>} 装备对象
 */
async function generateEquipment(context) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const itemLevel = context.playerLevel || context.floor || 1;

    // 1) 掷稀有度 (1D20)
    let rarityEntry;
    if (context.rarity) {
        // 从传入的名称匹配
        const r = String(context.rarity);
        rarityEntry = EQUIP_RARITY_TABLE.find(e => r.includes(e.name[0])) || lookupRoll(EQUIP_RARITY_TABLE, rollDice(20));
    } else {
        rarityEntry = lookupRoll(EQUIP_RARITY_TABLE, rollDice(20));
    }

    // 2) 掷插槽 (1D10)
    const slotEntry = lookupRoll(EQUIP_SLOT_TABLE, rollDice(10));

    // 3) 掷类型 (1D5)
    let typeEntry;
    if (context.type) {
        const t = String(context.type);
        typeEntry = EQUIP_TYPE_TABLE.find(e => t.includes(e.type[0])) || lookupRoll(EQUIP_TYPE_TABLE, rollDice(5));
    } else {
        typeEntry = lookupRoll(EQUIP_TYPE_TABLE, rollDice(5));
    }

    // 4) 计算 HP 基础值
    const hpBase = itemLevel * 10;
    const hpFinal = Math.floor(hpBase * rarityEntry.mult);

    // 5) 计算基础属性
    const levelBaseValue = Math.ceil(itemLevel / 5);
    const stats = { max_hp: hpFinal, str: 0, agi: 0, int: 0, vit: 0 };
    if (typeEntry.mainStat === 'all') {
        stats.str += levelBaseValue;
        stats.agi += levelBaseValue;
        stats.int += levelBaseValue;
        stats.vit += levelBaseValue;
    } else {
        stats[typeEntry.mainStat] += levelBaseValue * 3;
    }

    // 6) 掷词缀 (1D50) x affixCount
    const affixNames = [];
    for (let ai = 0; ai < rarityEntry.affixes; ai++) {
        const affixRoll = rollDice(50);
        const affixEntry = EQUIP_AFFIX_TABLE[affixRoll];
        const bonus = resolveAffixStats(affixEntry);
        stats.str += bonus.str;
        stats.agi += bonus.agi;
        stats.int += bonus.int;
        stats.vit += bonus.vit;
        if (affixEntry) affixNames.push(affixEntry.name);
    }

    // 7) 仅请求模型生成名称和描述（传入已计算的数值）
    const namePrompt = `为一件SAO游戏装备生成名称和描述，返回JSON:
{"name":string,"description":string}
槽位: ${slotEntry.label}
类型: ${typeEntry.type}
稀有度: ${rarityEntry.name}
物品等级: ${itemLevel}
数值: HP+${hpFinal} STR+${stats.str} AGI+${stats.agi} INT+${stats.int} VIT+${stats.vit}
词缀: ${affixNames.join(', ') || '无'}
要求: 名称和描述要有SAO风格，描述1-2句话`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: '你是SAO装备命名器。只输出JSON。' },
            { role: 'user', content: namePrompt },
        ], 256, { jsonSchema: true });
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        const nameDesc = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        const equip = {
            name: nameDesc.name || `${slotEntry.label}`,
            slot: slotEntry.slot,
            type: typeEntry.type,
            rarity: rarityEntry.name,
            item_level: itemLevel,
            stats,
            affixes: affixNames,
            description: nameDesc.description || '',
        };
        log('装备生成完成: ' + equip.name);
        return equip;
    } catch (e) { log('装备生成失败: ' + e.message, 'error'); return null; }
}

/**
 * 生成剑技 (FIX 3: 使用骰子表确定性计算数值，仅名称/描述由模型生成)
 * @param {object} context - { weaponType, skillLevel, playerLevel }
 * @returns {Promise<object|null>} 剑技对象
 */
async function generateSkill(context) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const skillLevel = context.skillLevel || 1;

    // 1) 掷稀有度 (1D20)
    const rarityEntry = lookupRoll(SKILL_RARITY_TABLE, rollDice(20));

    // 2) 掷核心功能 (1D20)
    const coreEntry = lookupRoll(SKILL_CORE_TABLE, rollDice(20));

    // 3) 计算基础ATK
    const baseATK = Math.floor((100 + skillLevel) * rarityEntry.mult);

    // 4) 命中率 = 70 + 1D20
    const hitRate = 70 + rollDice(20);

    // 5) 暴击率 = 1D20
    const critRate = rollDice(20);

    // 6) APT (连击数) = 1D10 映射: 1-5->1, 6-8->2, 9-10->3
    const aptRoll = rollDice(10);
    const apt = aptRoll <= 5 ? 1 : aptRoll <= 8 ? 2 : 3;

    // 7) TPA (目标数) = 同上
    const tpaRoll = rollDice(10);
    const tpa = tpaRoll <= 5 ? 1 : tpaRoll <= 8 ? 2 : 3;

    // 8) MP消耗 = 1D20
    const mpCost = rollDice(20);

    // 9) CD = 1D4 - 1 (0-3)
    const cd = rollDice(4) - 1;

    // 10) 3条词缀: 1D30 决定类型, PL = skillLevel*2 + rarityBonus + 1D10
    const rarityBonuses = { '\u767D\u8272': 10, '\u7EFF\u8272': 20, '\u84DD\u8272': 35, '\u7D2B\u8272': 55 };
    const rBonus = rarityBonuses[rarityEntry.name] || 10;
    const affixCodes = [];
    const affixNames = [];
    for (let ai = 0; ai < 3; ai++) {
        const affixRoll = rollDice(30);
        const PL = skillLevel * 2 + rBonus + rollDice(10);
        if (affixRoll <= 8) {
            // 属性词缀 S1-S8 (简化: 根据PL生成一个属性提升)
            const statNames = ['\u529B\u91CF', '\u654F\u6377', '\u667A\u529B', '\u8010\u529B', '\u5168\u5C5E\u6027'];
            const picked = statNames[Math.floor(Math.random() * statNames.length)];
            const val = Math.max(1, Math.floor(PL / 10));
            affixCodes.push(`S${affixRoll}`);
            affixNames.push(`${picked}+${val}`);
        } else {
            // 特殊效果 B1-B22
            const bCode = affixRoll - 8; // 1-22
            affixCodes.push(`B${bCode}`);
            affixNames.push(`\u7279\u6B8A\u6548\u679C${bCode}`);
        }
    }

    // 请求模型生成名称和描述
    const weaponType = context.weaponType || '\u5355\u624B\u76F4\u5251';
    const namePrompt = `为SAO剑技生成名称和描述，返回JSON:
{"name":string,"description":string,"effects_description":string}
武器类型: ${weaponType}
技能等级: ${skillLevel}
稀有度: ${rarityEntry.name}
核心功能: ${coreEntry.name}(${coreEntry.code})
ATK: ${baseATK}  命中率: ${hitRate}%  暴击率: ${critRate}%
连击数: ${apt}  目标数: ${tpa}  MP消耗: ${mpCost}  冷却: ${cd}回合
词缀: ${affixNames.join(', ')}
要求: 名称要有SAO剑技风格(如「星爆气流斩」「音速冲击」等)`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: '你是SAO剑技命名器。只输出JSON。' },
            { role: 'user', content: namePrompt },
        ], 256, { jsonSchema: true });
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        const nameDesc = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        const skill = {
            name: nameDesc.name || `\u5251\u6280`,
            weapon_type: weaponType,
            skill_level: skillLevel,
            rarity: rarityEntry.name,
            base_damage: baseATK,
            hit_rate: hitRate,
            crit_rate: critRate,
            mp_cost: mpCost,
            cooldown: cd,
            hits: apt,
            targets: tpa,
            core_code: coreEntry.code,
            affix_codes: affixCodes,
            affix_names: affixNames,
            effects_description: nameDesc.effects_description || '',
            description: nameDesc.description || '',
        };
        log('\u5251\u6280\u751F\u6210\u5B8C\u6210: ' + skill.name);
        return skill;
    } catch (e) { log('\u5251\u6280\u751F\u6210\u5931\u8D25: ' + e.message, 'error'); return null; }
}

/**
 * 生成战利品/物品
 * @param {object} context - { enemyLevel, floor, enemyType }
 * @returns {Promise<object|null>} 物品对象或 null
 */
async function generateLoot(context) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const systemPrompt = '你是 SAO 物品生成器。根据敌人等级和类型生成掉落物。如果敌人不值得掉落物品，返回 {"loot":[]}。只输出 JSON。';
    const userPrompt = `生成掉落物，返回 JSON:
{"loot":[{"name":string,"type":string,"qty":number,"rarity":string,"description":string}],
 "cor":number,"exp":number}
敌人等级: ${context.enemyLevel}
楼层: ${context.floor}
敌人类型: ${context.enemyType || '普通怪物'}`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 512);
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) { log('物品生成完成'); return JSON.parse(jsonMatch[0]); }
        return null;
    } catch (e) { log('物品生成失败: ' + e.message, 'error'); return null; }
}

/**
 * NPC 反应生成（用 narrative 角色）
 * @param {string} npcName, {string} situation
 * @returns {Promise<string|null>} NPC 反应文本
 */
async function generateNpcReaction(npcName, situation) {
    const settings = getSettings();
    // narrative 未配置则跳过
    const cfg = settings.models.narrative;
    if (!cfg.url || !cfg.model) return null;

    try {
        const result = await callModel('narrative', [
            { role: 'system', content: `你是 ${npcName}，根据当前情境生成这个 NPC 的内心反应和微表情（50-100字）。只输出反应描写，不要 JSON。` },
            { role: 'user', content: `当前情境: ${situation.substring(0, 2000)}` },
        ], 256);
        log(`NPC(${npcName}) 反应生成完成`);
        return result.trim();
    } catch (e) { log('NPC反应生成失败: ' + e.message, 'warn'); return null; }
}

// ============================================================
// 状态注入
// ============================================================

/**
 * 格式化紧凑状态文本（用于注入 AI 上下文）
 */
function formatCompactState(state) {
    if (!state) return '';
    const parts = [];
    if (state.player_name) parts.push(`[玩家]${state.player_name}`);
    if (state.level != null) parts.push(`Lv${state.level}`);
    if (state.hp != null) parts.push(`HP:${state.hp}/${state.max_hp || '?'}`);
    if (state.mp != null) parts.push(`MP:${state.mp}/${state.max_mp || '?'}`);
    if (state.floor != null) parts.push(`${state.floor}F`);
    if (state.location) parts.push(`@${state.location}`);
    if (state.cor != null) parts.push(`珂尔:${state.cor}`);
    // 装备摘要
    if (state.equipment) {
        const equips = Object.entries(state.equipment)
            .filter(([, v]) => v && v.name)
            .map(([k, v]) => `${k}:${v.name}`)
            .join(',');
        if (equips) parts.push(`[装备]${equips}`);
    }
    // 技能摘要
    if (state.skills?.length) {
        const sk = state.skills.slice(0, 5).map(s => `${s.name}Lv${s.level}`).join(',');
        parts.push(`[技能]${sk}`);
    }
    return parts.join(' | ');
}

function injectMemoryAndState() {
    const ctx = getContext();
    const settings = getSettings();
    if (!settings.enabled || !isSaoCard()) return;

    const data = getSaoData();
    if (!data) return;
    const parts = [];

    // Core State（常驻，紧凑格式）
    const compactState = formatCompactState(data.state);
    if (compactState) {
        parts.push(compactState);
    }

    // 当前章节
    parts.push(`[章节]${settings.currentArc}`);

    if (parts.length > 0) {
        ctx.setExtensionPrompt('sao_companion_inject', parts.join('\n'), 1, 4, false, 0);
    }
}

// ============================================================
// SAO 卡兼容模式（替代 TavernHelper 脚本）
// ============================================================

/**
 * 启用 SAO 卡兼容模式
 * 1. 关闭不兼容的酒馆设置（修改全局 window.power_user）
 * 2. 启用角色卡局部正则
 *
 * 全局设置副作用（有保存/恢复机制，见 disableCompatMode）：
 * - auto_fix_generated_markdown → false
 * - encode_tags → false
 * - trim_sentences → false
 * - forbid_external_media → true
 * 风险: 若插件异常退出未执行 disableCompatMode，用户全局设置可能残留。
 */
function enableCompatMode() {
    const settings = getSettings();
    if (!settings.compatMode) return;

    // === 1. 关闭不兼容设置 ===
    try {
        const power_user = window.power_user;
        if (power_user) {
            // 保存原始值（始终覆盖，确保崩溃后恢复最新基线）
            settings._savedPowerUser = {
                auto_fix_generated_markdown: power_user.auto_fix_generated_markdown,
                encode_tags: power_user.encode_tags,
                trim_sentences: power_user.trim_sentences,
                forbid_external_media: power_user.forbid_external_media,
            };

            // 关闭不兼容选项
            power_user.auto_fix_generated_markdown = false;
            power_user.encode_tags = false;
            power_user.trim_sentences = false;
            power_user.forbid_external_media = true;

            // 更新 UI 复选框
            $('#auto_fix_generated_markdown').prop('checked', false);
            $('#encode_tags').prop('checked', false);
            $('#trim_sentences_checkbox').prop('checked', false);
            $('#forbid_external_media').prop('checked', true);

            // 保存设置
            if (window.saveSettingsDebounced) saveSettingsDebounced();
            log('已关闭不兼容选项（自动修复Markdown/显示标签/修剪句子/禁止外部媒体）');
        }
    } catch (e) {
        log('关闭不兼容选项失败: ' + e.message, 'warn');
    }

    // === 2. 启用角色卡局部正则 ===
    enableCardRegex();
}

/**
 * 恢复原始设置（切出 SAO 卡时）
 */
function disableCompatMode() {
    const power_user = window.power_user;
    if (!power_user) return;

    const settings = getSettings();
    const saved = settings._savedPowerUser;
    if (!saved) return;

    let restored = false;
    if (saved.auto_fix_generated_markdown !== undefined) {
        power_user.auto_fix_generated_markdown = saved.auto_fix_generated_markdown;
        $('#auto_fix_generated_markdown').prop('checked', saved.auto_fix_generated_markdown);
        restored = true;
    }
    if (saved.encode_tags !== undefined) {
        power_user.encode_tags = saved.encode_tags;
        $('#encode_tags').prop('checked', saved.encode_tags);
        restored = true;
    }
    if (saved.trim_sentences !== undefined) {
        power_user.trim_sentences = saved.trim_sentences;
        $('#trim_sentences_checkbox').prop('checked', saved.trim_sentences);
        restored = true;
    }
    if (saved.forbid_external_media !== undefined) {
        power_user.forbid_external_media = saved.forbid_external_media;
        $('#forbid_external_media').prop('checked', saved.forbid_external_media);
        restored = true;
    }
    if (restored) {
        delete settings._savedPowerUser;
        if (window.saveSettingsDebounced) saveSettingsDebounced();
        log('已恢复原始酒馆设置');
    }

    // 恢复被 enableCardRegex 启用的正则脚本的 disabled 状态
    if (settings._savedRegexState && settings._savedRegexState.length > 0) {
        try {
            const char = getCurrentCharacter();
            if (char?.data?.extensions?.regex_scripts) {
                const scripts = char.data.extensions.regex_scripts;
                let restoredCount = 0;
                settings._savedRegexState.forEach(savedEntry => {
                    const script = scripts.find(s => s.scriptName === savedEntry.scriptName);
                    if (script && savedEntry.disabled) {
                        script.disabled = true;
                        restoredCount++;
                    }
                });
                if (restoredCount > 0) {
                    log(`已恢复 ${restoredCount} 个正则脚本的 disabled 状态`);
                }
            }
        } catch (e) {
            log('恢复正则脚本状态失败: ' + e.message, 'warn');
        }
        delete settings._savedRegexState;
        saveSettings();
    }
}

/**
 * 运行时稳定化：剥离 SAO 卡正则脚本 replaceString 外层的 markdown 代码围栏
 * 原因: 部分正则脚本（如「快速回复」「开场白」；已迁移/删除的「战斗1.30」系列也曾如此）
 * 的 replaceString 以 ```text\n<!DOCTYPE html... 开头、以 ...</html>\n``` 结尾。
 * SillyTavern 正则引擎原样注入后，二次渲染会把围栏内的 HTML/JS 暴露为裸文本。
 * 去掉外层围栏后 replaceString 就是纯 HTML，注入行为不变但安全。
 * 只做内存修改，不写磁盘/卡。适用于卡中所有带代码围栏的正则脚本。
 */
function stabilizeSaoRegexScripts() {
    try {
        const char = getCurrentCharacter();
        if (!char?.data?.extensions?.regex_scripts) return;

        const scripts = char.data.extensions.regex_scripts;
        let sanitized = 0;

        for (const script of scripts) {
            if (typeof script.replaceString !== 'string') continue;

            let rs = script.replaceString;

            // 剥离开头 ```text 或 ```html 围栏
            const fenceHeadMatch = rs.match(/^```(?:[a-zA-Z]*)?\s*/);
            // 剥离结尾 ``` 围栏（允许尾部空白/换行）
            const fenceTailMatch = rs.match(/\s*```\s*$/);

            if (fenceHeadMatch && fenceTailMatch) {
                rs = rs.slice(fenceHeadMatch[0].length);
                rs = rs.slice(0, rs.length - fenceTailMatch[0].length);

                // 可选: 修复已知的畸形碎片 '</head></html>\n\n  <body>'（重复/错位标签）
                // 修成正常的 '</head><body>'，避免 body 内容落在 head 中
                rs = rs.replace(/<\/head>\s*<\/html>\s*\n\s*<body>/gi, '</head>\n  <body>');

                script.replaceString = rs;
                sanitized++;
                log(`正则脚本「${script.scriptName}」已剥离代码围栏 (${rs.length} 字符)`);
            }
        }

        if (sanitized > 0) {
            log(`运行时正则稳定化: 共处理 ${sanitized} 个脚本`);
        }
    } catch (e) {
        log('正则稳定化失败: ' + e.message, 'warn');
    }
}

// 白名单：插件应管理的正则脚本（排除4个不应自动启用的脚本）
const REGEX_WHITELIST = new Set([
    '摘要',
    '公会状态栏',
    // npc状态栏: keep on-card (disabled=false) like 公会状态栏 — replaceString is clean pure HTML, no Shadow DOM renderer needed
    'npc状态栏',
    '快速回复', '开场白',
    // 注意: '战斗1.30手机' 有意不加入白名单。
    // 手机版是桌面端的窄屏适配，两者不应同时启用。
    // 插件无法可靠检测设备类型，因此手机版由用户手动启用/禁用。

    // Phase 1: 以下显示类正则已由插件 Shadow DOM 渲染器替代，从白名单移除。
    // 它们保持 disabled=true，避免与插件渲染产生双重渲染。
    // 移除的正则: '日期', '角色状态栏', '装备栏', '剑技栏', '地图2'

    // Phase 2: '战斗1.30电脑' 已由插件 battle/battleRenderer.js 迁移，从白名单移除。
    // 移除的正则: '战斗1.30电脑'

    // Phase 3: 以下 promptOnly 隐藏正则已由插件 saoPromptCleanerInterceptor 替代，从白名单移除。
    // 插件通过 generate_interceptor + CHAT_COMPLETION_PROMPT_READY + GENERATE_AFTER_COMBINE_PROMPTS
    // 在 prompt 组装前统一清理 SAO 标签，不再需要正则脚本逐个处理。
    // 移除的正则: '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
    //            '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏', '隐藏回复', '隐藏预告'
    // 保留: '摘要' (promptOnly=true, replaceLen=0, 仅提取摘要不产生显示，谨慎保留 fallback)
]);

// 已迁移脚本：插件已接管渲染/prompt清理，必须在插件活跃时主动禁用，避免双重渲染/重复prompt清理。
// Phase 1 (显示类): 日期, 角色状态栏, 装备栏, 剑技栏, 地图2
// Phase 2 (战斗): 战斗1.30电脑
// Phase 3 (promptOnly): 隐藏摘要, 隐藏npc, 隐藏日历, 隐藏战斗, 隐藏状态栏,
//                        隐藏地图, 隐藏骰子, 隐藏npc思维链, 隐藏公会状态栏, 隐藏回复, 隐藏预告
// 注意: '战斗1.30手机' 有意不在列表中（用户手动控制，见 §12.3）。
const MIGRATED_SCRIPTS = new Set([
    '日期', '角色状态栏', '装备栏', '剑技栏', '地图2',
    '战斗1.30电脑',
    '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
    '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏', '隐藏回复', '隐藏预告',
]);

/**
 * 启用当前角色卡的局部正则脚本（白名单模式）
 */
function enableCardRegex() {
    try {
        const ctx = getContext();
        const char = getCurrentCharacter();
        if (!char || !char.data?.extensions?.regex_scripts) {
            log('未找到角色卡正则脚本', 'warn');
            return;
        }

        const settings = getSettings();
        const scripts = char.data.extensions.regex_scripts;
        let enabled = 0;
        scripts.forEach(s => {
            if (s.disabled === true && REGEX_WHITELIST.has(s.scriptName)) {
                // 记录原始 disabled 状态，供 disableCompatMode 恢复
                if (!settings._savedRegexState) settings._savedRegexState = [];
                const existingIdx = settings._savedRegexState.findIndex(e => e.scriptName === s.scriptName);
                if (existingIdx >= 0) {
                    settings._savedRegexState[existingIdx] = { scriptName: s.scriptName, disabled: true };
                } else {
                    settings._savedRegexState.push({ scriptName: s.scriptName, disabled: true });
                }
                s.disabled = false;
                enabled++;
            } else if (s.disabled === true) {
                log(`跳过正则脚本（不在白名单）: ${s.scriptName}`, 'info');
            }
        });

        // 主动禁用已迁移脚本（避免与插件渲染/prompt清理产生双重处理）
        let forceDisabled = 0;
        scripts.forEach(s => {
            if (s.disabled === false && MIGRATED_SCRIPTS.has(s.scriptName)) {
                if (!settings._savedRegexState) settings._savedRegexState = [];
                const existingIdx = settings._savedRegexState.findIndex(e => e.scriptName === s.scriptName);
                if (existingIdx >= 0) {
                    settings._savedRegexState[existingIdx] = { scriptName: s.scriptName, disabled: false };
                } else {
                    settings._savedRegexState.push({ scriptName: s.scriptName, disabled: false });
                }
                s.disabled = true;
                forceDisabled++;
            }
        });
        if (forceDisabled > 0) {
            log(`主动禁用 ${forceDisabled} 个已迁移脚本（原状态已保存，切卡时恢复）`);
        }

        if (enabled > 0 || forceDisabled > 0) {
            log(`已启用 ${enabled} 个角色卡正则脚本（共 ${scripts.length} 个）`);
            saveSettings();
        }
    } catch (e) {
        log('启用正则脚本失败: ' + e.message, 'warn');
    }
}

// ============================================================
// Phase 1 PoC: Shadow DOM 标签渲染
// ============================================================

/**
 * 定位消息 DOM 元素（SillyTavern 使用 mesid 属性标识消息）
 * @param {string|number} messageId - 消息 ID
 * @returns {HTMLElement|null}
 */
function getMessageElement(messageId) {
    return document.querySelector(`[mesid="${messageId}"]`);
}

/**
 * 通用标签提取
 */
function extractTag(rawText, tagName) {
    const re = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i');
    const m = rawText.match(re);
    return m ? m[1] : null;
}

function hideSaoLightDomTags(messageEl) {
    const mesText = messageEl.querySelector('.mes_text');
    const target = mesText || messageEl;
    target.classList.add('sao-tags-rendered');
    const styleId = 'sao-hide-custom-tags';
    if (target.querySelector(`#${styleId}`)) return;
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
        .sao-tags-rendered calendar, .sao-tags-rendered user_status, .sao-tags-rendered equip,
        .sao-tags-rendered swordskill, .sao-tags-rendered map, .sao-tags-rendered zd_status,
        .sao-tags-rendered calendar *, .sao-tags-rendered user_status *, .sao-tags-rendered equip *,
        .sao-tags-rendered swordskill *, .sao-tags-rendered map *, .sao-tags-rendered zd_status * {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
        }
    `;
    target.prepend(styleEl);
}

/**
 * 创建 Shadow DOM 容器
 */
function createSaoShadowHost(messageEl, tagName) {
    // 避免重复注入
    const existing = messageEl.querySelector(`.sao-render-host[data-sao-tag="${tagName}"]`);
    if (existing) return existing.shadowRoot;
    const host = document.createElement('div');
    host.className = 'sao-render-host';
    host.dataset.saoTag = tagName;
    const mesText = messageEl.querySelector('.mes_text');
    const shadow = host.attachShadow({ mode: 'open' });

    // 统一隐藏 light DOM 中的 SAO 自定义标签，避免与 Shadow DOM 渲染器双重渲染
    hideSaoLightDomTags(messageEl);

    if (mesText) {
        mesText.appendChild(host);
    } else {
        messageEl.appendChild(host);
    }
    return shadow;
}

/**
 * 解析日历标签内容（优先 JSON，失败则作文本）
 */
function parseCalendarContent(rawContent) {
    if (!rawContent) return { text: '' };
    const trimmed = rawContent.trim();
    if (!trimmed) return { text: '' };
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // 非 JSON，按普通文本处理
        }
    }
    const kvData = parseCalendarKeyValueText(trimmed);
    if (kvData) return kvData;
    return { text: trimmed };
}

/**
 * 在消息 Shadow DOM 中渲染 <calendar> 标签
 * 只读：不修改 msg.mes，仅操作已渲染的 DOM
 */
function renderCalendar(messageEl, rawText) {
    const calendarContent = extractTag(rawText, 'calendar');
    if (calendarContent === null) return;

    const data = parseCalendarContent(calendarContent);
    const shadow = createSaoShadowHost(messageEl, 'calendar');

    const year = Number(data.year) || 0;
    const month = Number(data.month) || 0;
    const currentDay = Number(data.current_day) || 0;

    const summaryText = (year && month)
        ? year + '\u5e74 ' + month + '\u6708 \u65e5\u5386'
        : (data.text || data.date || '\u65e5\u5386');
    const calendarTitle = (year && month) ? month + '\u6708' : '';
    const calendarInfo = year ? '\u5e74\u4efd ' + year : '';
    const gridCells = (year && month)
        ? buildCalendarGrid(year, month, currentDay, data.days)
        : '';
    const weekdays = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5']
        .map(d => '<div class="weekday">' + d + '</div>').join('');

    shadow.innerHTML = `
        <style>
            :host { display: block; }
            /* 移动优先设计 */
                  * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                  }
            
                  body {
                    margin: 0;
                    padding: 0;
                  }
            
                  /* 主容器样式 - 米色风格 */
                  .calendar-wrapper {
                    background-color: #f8f4ed;
                    border: 1px solid #8c785d;
                    border-radius: 6px;
                    width: 100%;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 2px;
                    font-family: 'Microsoft YaHei', sans-serif;
                    color: #5c4d3a;
                    overflow: hidden; /* 防止内容溢出 */
                  }
            
                  /* 日历折叠按钮容器 */
                  .details-calendar-button {
                    border: none;
                    margin: 0;
                    padding: 0;
                    color: #5c4d3a;
                    width: 100%;
                  }
            
                  /* 折叠按钮基础样式 */
                  .details-calendar-button > summary {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    cursor: pointer;
                    font-weight: bold;
                    list-style: none;
                    outline: none;
                    transition: all 0.1s ease-in-out;
                    position: relative;
                  }
            
                  /* 移除默认标记 */
                  .details-calendar-button > summary::-webkit-details-marker,
                  .details-calendar-button > summary::marker {
                    display: none;
                    content: '';
                  }
            
                  /* 图标样式 */
                  .details-calendar-button > summary::before {
                    content: '📅';
                    display: inline-block;
                    margin-right: 6px;
                  }
            
                  /* 关闭时状态 */
                  .details-calendar-button:not([open]) > summary {
                    padding: 4px 8px;
                    font-size: 16px;
                    margin-top: -5px;
                    background-color: #f0d9b5;
                    border-radius: 5px;
                    border: 1px solid #8c785d;
                  }
            
                  /* 鼠标悬停效果 */
                  .details-calendar-button:not([open]) > summary:hover {
                    background-color: #e6ccaa;
                  }
            
                  /* 打开时状态 */
                  .details-calendar-button[open] > summary {
                    padding: 8px 8px;
                    font-size: 16px;
                    margin-top: -5px;
                    margin-bottom: 5px;
                    border: 1px solid #8c785d;
                    border-radius: 5px;
                    background-color: #d9bda0;
                  }
            
                  /* 日历内容区域 */
                  .calendar-content {
                    padding: 8px;
                    background-color: #ede4d3;
                    border-radius: 5px;
                    border: 1px solid #bfae98;
                    overflow-x: auto; /* 允许在小屏幕上滚动 */
                  }
            
                  /* 日历标题区域 */
                  .calendar-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                    padding-bottom: 4px;
                    border-bottom: 1px solid #bfae98;
                  }
            
                  .calendar-title {
                    font-size: 16px;
                    font-weight: bold;
                    color: #5c4d3a;
                  }
            
                  .calendar-info {
                    font-size: 14px;
                    color: #5c4d3a;
                  }
            
                  /* 日历表格样式 */
                  .calendar-grid {
                    display: grid;
                    grid-template-columns: repeat(7, minmax(40px, 1fr)); /* 确保每列至少40px宽 */
                    gap: 1px;
                    min-width: 280px; /* 最小宽度确保在小屏幕上也能看到所有列 */
                  }
            
                  /* 星期标题 */
                  .weekday {
                    text-align: center;
                    padding: 4px 2px;
                    font-weight: bold;
                    color: #5c4d3a;
                    background-color: #d9c8b3;
                    font-size: 13px; /* 更小的字体大小 */
                  }
            
                  /* 日期单元格 */
                  .day {
                    min-height: 60px; /* 减小高度以适应移动设备 */
                    padding: 2px;
                    background-color: #f5f0e1;
                    border: 1px solid #bfae98;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                  }
            
                  /* 空白单元格 */
                  .day.empty {
                    background-color: #ede4d3;
                    border: 1px solid #ede4d3;
                  }
            
                  /* 日期数字 */
                  .day-number {
                    font-size: 12px;
                    color: #8c785d;
                    text-align: left;
                    width: 100%;
                    height: 16px;
                  }
            
                  /* 当前日期高亮 */
                  .current-day {
                    background-color: #e6ccaa;
                    border: 1px solid #8c785d;
                  }
            
                  .current-day .day-number {
                    color: #5c4d3a;
                    font-weight: bold;
                  }
            
                  /* 日期内容 */
                  .day-content {
                    flex-grow: 1;
                    font-size: 10px; /* 更小的字体大小 */
                    line-height: 1.2;
                    overflow-y: auto;
                    word-break: break-word; /* 允许单词在必要时断行 */
                  }
            
                  /* 普通文本样式 */
                  .normal-text {
                    color: #5c4d3a;
                    font-size: 10px; /* 更小的字体大小 */
                    line-height: 1.2;
                    margin-bottom: 2px;
                  }
            
                  /* 适配更大屏幕的媒体查询 */
                  @media (min-width: 500px) {
                    .details-calendar-button[open] > summary {
                      padding: 10px 8px;
                      font-size: 18px;
                    }
            
                    .calendar-content {
                      padding: 10px;
                    }
            
                    .calendar-title {
                      font-size: 18px;
                    }
            
                    .calendar-info {
                      font-size: 16px;
                    }
            
                    .weekday {
                      padding: 5px;
                      font-size: 14px;
                    }
            
                    .day {
                      min-height: 80px;
                      padding: 5px;
                    }
            
                    .day-number {
                      font-size: 14px;
                      height: 20px;
                    }
            
                    .day-content,
                    .normal-text {
                      font-size: 12px;
                      line-height: 1.3;
                    }
                  }
        </style>
        <div class="calendar-wrapper">
            <details class="details-calendar-button" open>
                <summary>${summaryText}</summary>
                <div class="calendar-content">
                    <div class="calendar-header">
                        <div class="calendar-title">${calendarTitle}</div>
                        <div class="calendar-info">${calendarInfo}</div>
                    </div>
                    <div class="calendar-grid">
                        ${weekdays}
                        ${gridCells}
                    </div>
                </div>
            </details>
        </div>
    `;
}

function renderAllTags(messageEl, rawText) {
    if (/<(?:calendar|user_status|equip|swordskill|map|zd_status)\b/i.test(rawText || '')) {
        hideSaoLightDomTags(messageEl)
    }
    renderCalendar(messageEl, rawText)
    renderUserStatus(messageEl, rawText)
    renderEquipment(messageEl, rawText)
    renderSwordSkill(messageEl, rawText)
    renderMap(messageEl, rawText)
    renderBattlePanel(messageEl, rawText)
    // 渲染战斗面板后检查是否需要恢复战斗状态
    if (rawText.includes('<zd_status>')) {
        restoreBattleIfPending()
    }
}

function renderUserStatus(messageEl, rawText) {
    const content = extractTag(rawText, 'user_status')
    if (content === null) return
    const shadow = createSaoShadowHost(messageEl, 'user_status')
    const safeContent = sanitizeInlineSaoHtml(content.trim())
    shadow.innerHTML = `
        <style>
            :host { display: block; }
            /* 主容器样式 */
                .character-status-wrapper {
                  background-color: rgba(235, 225, 210, 0.95); /* 浅米色背景 */
                  border: 1px solid rgba(165, 145, 120, 0.5);
                  border-radius: 6px;
                  max-width: 861px;
                  margin: 5px auto;
                  padding: 0 5px 5px 5px;
                  box-sizing: border-box;
                  overflow: hidden;
            
                  /* 颜色变量 */
                  --char-text-color: #4b3f34; /* 深灰褐色文本 */
                  --char-content-border: rgba(165, 145, 120, 0.3);
                  --char-button-bg: rgba(218, 198, 171, 0.95);
                  --char-button-border: rgba(165, 145, 120, 0.8);
                  --char-button-highlight: rgba(228, 208, 181, 0.95);
                  --char-button-shadow: rgba(175, 155, 130, 0.85);
                  --char-button-outer-shadow: rgba(150, 130, 105, 0.3);
                  --char-icon-color: #5b99c9; /* 蓝色图标 */
                  --char-content-bg: rgba(225, 215, 200, 0.95); /* 内容区背景 */
                  --char-button-hover: rgba(225, 205, 178, 0.95); /* 悬停颜色 */
                  --char-button-active: rgba(210, 190, 163, 0.95); /* 点击时颜色 */
                }
            
                /* 定义标准字体栈 */
                .character-status-wrapper {
                  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif;
                  color: var(--char-text-color); /* 应用默认文本颜色 */
                }
            
                /* 全局禁用文本阴影 */
                .character-status-wrapper,
                .character-status-wrapper *,
                .details-character-status,
                .details-character-status *,
                .details-character-status > summary,
                .details-character-status > summary::before,
                .details-character-status > div {
                  text-shadow: none !important;
                }
            
                /* 详情按钮样式 (使用新类名) */
                .details-character-status {
                  border: none;
                  margin: 0;
                  padding: 0;
                  color: inherit; /* 继承 wrapper 的颜色 */
                }
            
                /* 基础摘要样式 (使用新类名) */
                .details-character-status > summary {
                  display: flex;
                  align-items: center;
                  width: 100%;
                  cursor: pointer;
                  list-style: none;
                  outline: none;
                  image-rendering: auto;
                  -webkit-font-smoothing: antialiased;
                  -moz-osx-font-smoothing: grayscale;
                  transition: all 0.1s ease-in-out;
                  position: relative;
                  top: 0;
                  left: 0;
                  box-sizing: border-box;
                  font-weight: 600; /* 使用半粗体 (Semi-bold) 作为标题 */
                  color: var(--char-text-color);
                }
            
                /* 移除默认标记 (使用新类名) */
                .details-character-status > summary::-webkit-details-marker,
                .details-character-status > summary::marker {
                  display: none;
                  content: '';
                }
            
                /* 基础图标样式 (使用新类名) */
                .details-character-status > summary::before {
                  content: '👤'; /* <<< 角色状态图标 */
                  display: inline-block;
                  line-height: 1;
                  font-size: 1.1em;
                  color: var(--char-icon-color);
                  margin-right: 6px;
                }
            
                /* 关闭时状态 (使用新类名) */
                .details-character-status:not([open]) > summary {
                  padding: 4px 8px 5px 8px;
                  font-size: 16px;
                  line-height: 1.2;
                  margin-bottom: 0;
                  background-color: var(--char-button-bg);
                  border: 1px solid var(--char-button-border) !important;
                  border-radius: 5px;
                  box-shadow: 1px 1px 2px var(--char-button-outer-shadow) !important;
                  filter: none;
                  justify-content: flex-start;
                }
            
                /* 鼠标悬停效果 (使用新类名) */
                .details-character-status:not([open]) > summary:hover {
                  background-color: var(--char-button-hover);
                }
            
                /* 打开时状态 (使用新类名) */
                .details-character-status[open] > summary {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  margin-bottom: 5px;
                  border: 1px solid var(--char-button-border);
                  border-radius: 5px;
                  background-color: var(--char-button-active);
                  justify-content: flex-start;
                  box-shadow: inset 1px 1px 0px 1px var(--char-button-highlight), inset -1px -1px 0px 1px var(--char-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--char-button-outer-shadow));
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 打开时图标样式 (使用新类名) */
                .details-character-status[open] > summary::before {
                  margin-right: 8px;
                }
            
                /* 点击时反馈 (使用新类名) */
                .details-character-status > summary:active {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  background-color: var(--char-button-active);
                  box-shadow: inset 1px 1px 0px 1px var(--char-button-highlight), inset -1px -1px 0px 1px var(--char-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--char-button-outer-shadow));
                  top: 1px;
                  left: 1px;
                  border: 1px solid var(--char-button-border);
                  border-radius: 5px;
                  justify-content: flex-start;
                  margin-bottom: 5px;
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 点击时图标样式 (使用新类名) */
                .details-character-status > summary:active::before {
                  margin-right: 8px;
                }
            
                /* 打开时显示的内容 (使用新类名) */
                .details-character-status > div {
                  padding: 10px;
                  margin: 0;
                  font-size: 15px;
                  line-height: 1.5;
                  background-color: var(--char-content-bg);
                  color: var(--char-text-color);
                  border: 1px solid var(--char-content-border);
                  border-radius: 4px;
                  font-weight: normal; /* 内容使用普通字重 */
                  white-space: pre-wrap;
                  word-break: break-word;
                }
        </style>
        <div class="character-status-wrapper">
            <details class="details-character-status" open>
                <summary>角色状态栏</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}

function renderEquipment(messageEl, rawText) {
    const matches = [...rawText.matchAll(/<equip>\s*([\s\S]*?)\s*<\/equip>/gi)]
    if (matches.length === 0) return
    const shadow = createSaoShadowHost(messageEl, 'equip')
    const itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    shadow.innerHTML = `
        <style>
            :host { display: block; }
            /* Define the custom font */
                    @font-face {
                        font-family: 'NotoSansCJKsc-Bold';
                        src: url('https://files.catbox.moe/tisct7.otf') format('opentype');
                        font-style: normal;
                        font-weight: bold;
                        font-display: swap;
                    }
            
                    /* Main container style (Unchanged) */
                    .stardew-text-wrapper {
                        background-color: rgba(40, 40, 40, 0.85);
                        border: 1px solid #666;
                        border-radius: 6px;
                        max-width: 861px;
                        margin: 5px auto;
                        padding: 0 5px 5px 5px;
                        box-sizing: border-box;
                        overflow: hidden;
            
                        /* --- Color Variables (Unchanged) --- */
                        --stardew-header-text: #FFFFFF;
                        --stardew-content-border: rgba(255, 255, 255, 0.15);
                        --stardew-pressed-bg: rgba(40, 40, 40, 0.85); /* This is our target dark grey */
                        --stardew-pressed-border: #666;
                        --stardew-pressed-highlight: rgba(80, 80, 80, 0.85);
                        --stardew-pressed-shadow: rgba(20, 20, 20, 0.85);
                        --stardew-pressed-text: #DDDDDD;
                        --stardew-pressed-outer-shadow-color: rgba(50, 50, 50, 0.3);
                    }
            
                    /* --- Styles SPECIFICALLY for the Character Bar Button --- */
                    .details-character-bar {
                        border: none;
                        margin: 0;
                        padding: 0;
                        color: #CCCCCC;
                        font-family: 'NotoSansCJKsc-Bold', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
            
                    /* Base Summary Styling (Unchanged) */
                    .details-character-bar > summary {
                        display: flex;
                        align-items: center;
                        width: 100%;
                        cursor: pointer;
                        font-weight: bold;
                        list-style: none;
                        outline: none;
                        image-rendering: pixelated;
                        -webkit-font-smoothing: none;
                        -moz-osx-font-smoothing: grayscale;
                        transition: all 0.1s ease-in-out;
                        position: relative;
                        top: 0; left: 0;
                        box-sizing: border-box;
                    }
            
                    /* Remove default marker (Unchanged) */
                    .details-character-bar > summary::-webkit-details-marker,
                    .details-character-bar > summary::marker {
                         display: none;
                         content: '';
                    }
            
                    /* Base Character Icon Styling (Unchanged) */
                    .details-character-bar > summary::before {
                        content: '🎒';
                        display: inline-block;
                        line-height: 1;
                        font-size: 1.1em;
                    }
            
                    /* State when CLOSED (Unchanged) */
                    .details-character-bar:not([open]) > summary {
                        padding: 4px 8px 5px 8px;
                        font-size: 16px;
                        line-height: 1.2;
                        margin-bottom: 0;
                        background-color: transparent;
                        border: none !important;
                        border-radius: 0;
                        box-shadow: none !important;
                        filter: none;
                        justify-content: flex-start;
                        color: var(--stardew-header-text);
                        border-bottom: 1px solid var(--stardew-content-border);
                    }
                    /* Icon color and margin when closed (Unchanged) */
                    .details-character-bar:not([open]) > summary::before {
                         color: var(--stardew-header-text);
                         margin-right: 6px;
                    }
            
                    /* State when OPEN (Summary unchanged) */
                    .details-character-bar[open] > summary {
                        padding: 10px 8px;
                        font-size: 18px;
                        line-height: initial;
                        margin-bottom: 5px;
                        border: 2px solid var(--stardew-pressed-border);
                        border-radius: 5px;
                        background-color: var(--stardew-pressed-bg); /* Summary background */
                        justify-content: flex-start;
                        color: var(--stardew-pressed-text);
                        border-bottom: none;
                        box-shadow:
                            inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                            inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                        filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                        top: 1px;
                        left: 1px;
                    }
                     /* Icon style when open (Unchanged) */
                    .details-character-bar[open] > summary::before {
                        color: var(--stardew-pressed-text);
                        margin-right: 8px;
                    }
            
                    /* Instant feedback WHILE clicking (:active) (Unchanged) */
                    .details-character-bar > summary:active {
                         padding: 10px 8px;
                         font-size: 18px;
                         line-height: initial;
                         background-color: var(--stardew-pressed-bg);
                         color: var(--stardew-pressed-text);
                         box-shadow:
                             inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                             inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                         filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                         top: 1px;
                         left: 1px;
                         border: 2px solid var(--stardew-pressed-border);
                         border-radius: 5px;
                         justify-content: flex-start;
                         margin-bottom: 5px;
                         border-bottom: none;
                    }
                     /* Icon style when active (Unchanged) */
                    .details-character-bar > summary:active::before {
                        color: var(--stardew-pressed-text);
                        margin-right: 8px;
                    }
            
                    /* Content revealed when details is open - Added explicit background */
                    .details-character-bar > div {
                        padding: 5px 0 0 0;
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.4;
                        background-color: rgba(40, 40, 40, 0.85); /* Ensure content area matches */
                        color: #CCCCCC; /* Ensure text color is set */
                    }
        </style>
        <div class="stardew-text-wrapper">
            <details class="details-character-bar" open>
                <summary>新装备</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

function renderSwordSkill(messageEl, rawText) {
    const matches = [...rawText.matchAll(/<swordskill>\s*([\s\S]*?)\s*<\/swordskill>/gi)]
    if (matches.length === 0) return
    const shadow = createSaoShadowHost(messageEl, 'swordskill')
    const itemsHtml = matches.map(m => sanitizeInlineSaoHtml(m[1].trim())).join('\n')
    shadow.innerHTML = `
        <style>
            :host { display: block; }
            /* Define the custom font */
                    @font-face {
                        font-family: 'NotoSansCJKsc-Bold';
                        src: url('https://files.catbox.moe/tisct7.otf') format('opentype');
                        font-style: normal;
                        font-weight: bold;
                        font-display: swap;
                    }
            
                    /* Main container style (MATCHES CHARACTER BAR) */
                    .stardew-text-wrapper {
                        background-color: rgba(40, 40, 40, 0.85); /* Dark grey background */
                        border: 1px solid #666;
                        border-radius: 6px;
                        max-width: 861px; /* Target width */
                        margin: 5px auto; /* Centering */
                        padding: 0 5px 5px 5px; /* Padding: Top 0, R 5, B 5, L 5 */
                        box-sizing: border-box;
                        overflow: hidden;
            
                        /* --- Color Variables (MATCHES CHARACTER BAR THEME) --- */
                        --stardew-header-text: #FFFFFF;
                        --stardew-content-border: rgba(255, 255, 255, 0.15);
                        --stardew-pressed-bg: rgba(40, 40, 40, 0.85);
                        --stardew-pressed-border: #666;
                        --stardew-pressed-highlight: rgba(80, 80, 80, 0.85);
                        --stardew-pressed-shadow: rgba(20, 20, 20, 0.85);
                        --stardew-pressed-text: #DDDDDD;
                        --stardew-pressed-outer-shadow-color: rgba(50, 50, 50, 0.3);
                        --stardew-heart-icon-color: #ff6b6b; /* Specific heart color */
                    }
            
                    /* REMOVED .stardew-text-content styles */
            
                    /* --- Styles SPECIFICALLY for the Affinity Button (Placed directly in wrapper) --- */
            
                    .details-affinity-button { /* Target the specific details element */
                        border: none;
                        margin: 0;
                        padding: 0;
                        color: #CCCCCC; /* Default text color */
                        font-family: 'NotoSansCJKsc-Bold', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
            
                    /* Base Summary Styling (MATCHES CHARACTER BAR) */
                    .details-affinity-button > summary {
                        display: flex;
                        align-items: center;
                        width: 100%;
                        cursor: pointer;
                        font-weight: bold;
                        list-style: none;
                        outline: none;
                        image-rendering: pixelated;
                        -webkit-font-smoothing: none;
                        -moz-osx-font-smoothing: grayscale;
                        transition: all 0.1s ease-in-out;
                        position: relative;
                        top: 0; left: 0;
                        box-sizing: border-box;
                         /* Font size set by state */
                    }
            
                    /* Remove default marker */
                    .details-affinity-button > summary::-webkit-details-marker,
                    .details-affinity-button > summary::marker {
                         display: none;
                         content: '';
                    }
            
                    /* Base Heart Icon Styling */
                    .details-affinity-button > summary::before {
                        content: '✨'; /* AFFINITY ICON */
                        display: inline-block;
                        line-height: 1;
                        font-size: 1.1em; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color);
                        /* Margin set by state */
                    }
            
                    /* State when CLOSED (MATCHES CHARACTER BAR) */
                    .details-affinity-button:not([open]) > summary {
                        padding: 4px 8px 5px 8px; /* Adjusted padding for larger size */
                        font-size: 16px; /* Increased closed font size */
                        line-height: 1.2;
                        margin-bottom: 0;
                        background-color: transparent;
                        border: none !important;
                        border-radius: 0;
                        box-shadow: none !important;
                        filter: none;
                        justify-content: flex-start;
                        color: var(--stardew-header-text);
                        border-bottom: 1px solid var(--stardew-content-border);
                    }
                    /* Icon margin when closed */
                    .details-affinity-button:not([open]) > summary::before {
                         margin-right: 6px; /* MATCHES CHARACTER BAR */
                         color: var(--stardew-heart-icon-color); /* Keep heart color */
                    }
            
                    /* State when OPEN (MATCHES CHARACTER BAR) */
                    .details-affinity-button[open] > summary {
                        padding: 10px 8px;
                        font-size: 18px;
                        line-height: initial;
                        margin-bottom: 5px;
                        border: 2px solid var(--stardew-pressed-border);
                        border-radius: 5px;
                        background-color: var(--stardew-pressed-bg);
                        justify-content: flex-start;
                        color: var(--stardew-pressed-text);
                        border-bottom: none;
                        box-shadow:
                            inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                            inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                        filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                        top: 1px;
                        left: 1px;
                    }
                     /* Icon style when open */
                    .details-affinity-button[open] > summary::before {
                        margin-right: 8px; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color); /* Keep heart color */
                        /* font-size: 1.1em; Already set */
                    }
            
                    /* Instant feedback WHILE clicking (:active) (MATCHES CHARACTER BAR) */
                    .details-affinity-button > summary:active {
                         padding: 10px 8px;
                         font-size: 18px;
                         line-height: initial;
                         background-color: var(--stardew-pressed-bg);
                         color: var(--stardew-pressed-text);
                         box-shadow:
                             inset 1px 1px 0px 1px var(--stardew-pressed-highlight),
                             inset -1px -1px 0px 1px var(--stardew-pressed-shadow);
                         filter: drop-shadow(1px 1px 0px var(--stardew-pressed-outer-shadow-color));
                         top: 1px;
                         left: 1px;
                         border: 2px solid var(--stardew-pressed-border);
                         border-radius: 5px;
                         justify-content: flex-start;
                         margin-bottom: 5px;
                         border-bottom: none;
                    }
                     /* Icon style when active */
                    .details-affinity-button > summary:active::before {
                        margin-right: 8px; /* MATCHES CHARACTER BAR */
                        color: var(--stardew-heart-icon-color); /* Keep heart color */
                        /* font-size: 1.1em; Already set */
                    }
            
                    /* Content revealed when details is open (Added background color) */
                    .details-affinity-button > div {
                        padding: 5px 0 0 0;
                        margin: 0;
                        font-size: 15px;
                        line-height: 1.4;
                        background-color: rgba(40, 40, 40, 0.85); /* Ensure content area matches background */
                        color: #CCCCCC;
                    }
        </style>
        <div class="stardew-text-wrapper">
            <details class="details-affinity-button" open>
                <summary>新剑技</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `
}

function renderMap(messageEl, rawText) {
    const content = extractTag(rawText, 'map')
    if (content === null) return
    const shadow = createSaoShadowHost(messageEl, 'map')
    const safeContent = sanitizeInlineSaoHtml(content.trim())
    shadow.innerHTML = `
        <style>
            :host { display: block; }
            /* 主容器样式 */
                .map-status-wrapper {
                  background-color: rgba(235, 225, 210, 0.95); /* 浅米色背景 */
                  border: 1px solid rgba(165, 145, 120, 0.5);
                  border-radius: 6px;
                  max-width: 861px;
                  margin: 5px auto;
                  padding: 0 5px 5px 5px;
                  box-sizing: border-box;
                  overflow: hidden;
            
                  /* 颜色变量 */
                  --map-text-color: #4b3f34; /* 深灰褐色文本 */
                  --map-content-border: rgba(165, 145, 120, 0.3);
                  --map-button-bg: rgba(218, 198, 171, 0.95);
                  --map-button-border: rgba(165, 145, 120, 0.8);
                  --map-button-highlight: rgba(228, 208, 181, 0.95);
                  --map-button-shadow: rgba(175, 155, 130, 0.85);
                  --map-button-outer-shadow: rgba(150, 130, 105, 0.3);
                  --map-icon-color: #5b99c9; /* 蓝色图标 */
                  --map-content-bg: rgba(225, 215, 200, 0.95); /* 内容区背景 */
                  --map-button-hover: rgba(225, 205, 178, 0.95); /* 悬停颜色 */
                  --map-button-active: rgba(210, 190, 163, 0.95); /* 点击时颜色 */
                }
            
                /* 定义标准字体栈 */
                .map-status-wrapper {
                  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif;
                  color: var(--map-text-color); /* 应用默认文本颜色 */
                }
            
                /* 全局禁用文本阴影 */
                .map-status-wrapper,
                .map-status-wrapper *,
                .details-map-status,
                .details-map-status *,
                .details-map-status > summary,
                .details-map-status > summary::before,
                .details-map-status > div {
                  text-shadow: none !important;
                }
            
                /* 详情按钮样式 (使用新类名) */
                .details-map-status {
                  border: none;
                  margin: 0;
                  padding: 0;
                  color: inherit; /* 继承 wrapper 的颜色 */
                }
            
                /* 基础摘要样式 (使用新类名) */
                .details-map-status > summary {
                  display: flex;
                  align-items: center;
                  width: 100%;
                  cursor: pointer;
                  list-style: none;
                  outline: none;
                  image-rendering: auto;
                  -webkit-font-smoothing: antialiased;
                  -moz-osx-font-smoothing: grayscale;
                  transition: all 0.1s ease-in-out;
                  position: relative;
                  top: 0;
                  left: 0;
                  box-sizing: border-box;
                  font-weight: 600; /* 使用半粗体 (Semi-bold) 作为标题 */
                  color: var(--map-text-color);
                }
            
                /* 移除默认标记 (使用新类名) */
                .details-map-status > summary::-webkit-details-marker,
                .details-map-status > summary::marker {
                  display: none;
                  content: '';
                }
            
                /* 基础图标样式 (使用新类名) */
                .details-map-status > summary::before {
                  content: '🗺️'; /* <<< 地图状态图标 */
                  display: inline-block;
                  line-height: 1;
                  font-size: 1.1em;
                  color: var(--map-icon-color);
                  margin-right: 6px;
                }
            
                /* 关闭时状态 (使用新类名) */
                .details-map-status:not([open]) > summary {
                  padding: 4px 8px 5px 8px;
                  font-size: 16px;
                  line-height: 1.2;
                  margin-bottom: 0;
                  background-color: var(--map-button-bg);
                  border: 1px solid var(--map-button-border) !important;
                  border-radius: 5px;
                  box-shadow: 1px 1px 2px var(--map-button-outer-shadow) !important;
                  filter: none;
                  justify-content: flex-start;
                }
            
                /* 鼠标悬停效果 (使用新类名) */
                .details-map-status:not([open]) > summary:hover {
                  background-color: var(--map-button-hover);
                }
            
                /* 打开时状态 (使用新类名) */
                .details-map-status[open] > summary {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  margin-bottom: 5px;
                  border: 1px solid var(--map-button-border);
                  border-radius: 5px;
                  background-color: var(--map-button-active);
                  justify-content: flex-start;
                  box-shadow: inset 1px 1px 0px 1px var(--map-button-highlight), inset -1px -1px 0px 1px var(--map-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--map-button-outer-shadow));
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 打开时图标样式 (使用新类名) */
                .details-map-status[open] > summary::before {
                  margin-right: 8px;
                }
            
                /* 点击时反馈 (使用新类名) */
                .details-map-status > summary:active {
                  padding: 10px 8px;
                  font-size: 18px;
                  line-height: initial;
                  background-color: var(--map-button-active);
                  box-shadow: inset 1px 1px 0px 1px var(--map-button-highlight), inset -1px -1px 0px 1px var(--map-button-shadow);
                  filter: drop-shadow(1px 1px 0px var(--map-button-outer-shadow));
                  top: 1px;
                  left: 1px;
                  border: 1px solid var(--map-button-border);
                  border-radius: 5px;
                  justify-content: flex-start;
                  margin-bottom: 5px;
                  font-weight: 600; /* 保持半粗体 */
                }
            
                /* 点击时图标样式 (使用新类名) */
                .details-map-status > summary:active::before {
                  margin-right: 8px;
                }
            
                /* 打开时显示的内容 (使用新类名) */
                .details-map-status > div {
                  padding: 10px;
                  margin: 0;
                  font-size: 15px;
                  line-height: 1.5;
                  background-color: var(--map-content-bg);
                  color: var(--map-text-color);
                  border: 1px solid var(--map-content-border);
                  border-radius: 4px;
                  font-weight: normal; /* 内容使用普通字重 */
                  white-space: pre-wrap;
                  word-break: break-word;
                }
        </style>
        <div class="map-status-wrapper">
            <details class="details-map-status" open>
                <summary>地图</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `
}


function bindEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 切换角色卡时重置效果代码表缓存，使其重新从新卡解析
        resetEffectCodeTable();
        // 无论是否 SAO 卡，先清理战斗副作用（幂等，非 SAO 卡或未初始化时为空操作）
        destroyBattleSideEffects();
        if (isSaoCard()) {
            log('聊天切换，加载 per-chat 数据');
            stabilizeSaoRegexScripts();
            enableCompatMode();
            injectMemoryAndState();
            // 刷新面板（如果已打开）
            if (document.getElementById('sao_panel_overlay')?.style.display === 'block') {
                refreshStatus();
            }

            // Phase 1 PoC: 切换聊天时对可见历史消息批量渲染日历
            // 注意：DOM 可能尚未完全就绪，此处做最佳努力尝试；未来可改为 MutationObserver 或延迟轮询
            const chatCtx = getContext();
            if (chatCtx.chat && chatCtx.chat.length > 0) {
                chatCtx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    const histEl = getMessageElement(idx);
                    if (histEl) {
                        renderAllTags(histEl, msg.mes || '');
                    }
                });
                // 延迟重试未渲染的消息（DOM 可能尚未就绪）
                setTimeout(() => {
                    chatCtx.chat.forEach((msg, idx) => {
                        if (!msg || msg.is_user) return;
                        const histEl = getMessageElement(idx);
                        if (histEl && !histEl.querySelector('.sao-render-host')) {
                            renderAllTags(histEl, msg.mes || '');
                        }
                    });
                }, 100);
            }
        } else {
            // 切出 SAO 卡，恢复设置（destroyBattleSideEffects 已移到上面）
            disableCompatMode();
        }
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, wrapAsync(async (messageId, type) => {
        if (!isSaoCard()) return;
        const settings = getSettings();
        if (!settings.enabled) return;

        const ctx = getContext();
        const message = ctx.chat?.[messageId];
        if (!message || message.is_user) return;

        const rawText = message.mes;
        log(`处理消息 #${messageId} (${rawText.length} 字符)`);

        // === READ-ONLY handler: 只提取状态并刷新面板，不修改消息文本 ===
        // 原因: SAO 卡的正则脚本（如「战斗1.30电脑」）会把 <zd_status> 替换为
        // 382KB 的完整 HTML/JS 文档并包裹在 ```text 围栏中。
        // 如果插件修改 msg.mes 并触发二次渲染，正则脚本会再次执行，
        // 导致原始消息文本被破坏、原始卡片 HTML/JS 暴露为裸代码。
        // fillGenTags / processCombatIfNeeded / processLootIfNeeded 已删除（死代码，
        // 其内部 msg.mes 改写逻辑与本只读原则矛盾）。editMessage / updateMessageBlock
        // 同样不得在自动事件中调用。
        await withProcessingLock(`msg-${messageId}`, async () => {
            // 多任务提取（状态）— 只读取文本、写入 chatMetadata，不修改消息
            const extracted = await extractAll(rawText);
            if (extracted) await applyExtractedData(extracted);
        });

        // 状态提取完成后刷新面板（如果已打开）
        if (document.getElementById('sao_panel_overlay')?.style.display === 'block') {
            refreshStatus();
        }

        // 新消息的 Shadow DOM 渲染已由 CHARACTER_MESSAGE_RENDERED 事件接管（见 H1）

        // fallback: 如果 CHARACTER_MESSAGE_RENDERED 事件不可用，延迟渲染新消息
        if (!event_types.CHARACTER_MESSAGE_RENDERED) {
            setTimeout(() => {
                const fallbackEl = getMessageElement(messageId);
                if (fallbackEl) renderAllTags(fallbackEl, rawText);
            }, 100);
        }
    }));

    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
        if (!isSaoCard()) return;
        injectMemoryAndState();
    });

    // Phase 3: Chat Completion 兜底 — 替代 promptOnly 隐藏正则
    if (event_types.CHAT_COMPLETION_PROMPT_READY) {
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
            if (!isSaoCard()) return;
            const settings = getSettings();
            if (!settings.enabled) return;

            if (data.chat && Array.isArray(data.chat)) {
                for (const msg of data.chat) {
                    if (typeof msg.content === 'string' && msg.content) {
                        msg.content = cleanSaoPromptText(msg.content);
                    }
                }
            }
        });
    } else {
        console.debug('[SAO Companion] event CHAT_COMPLETION_PROMPT_READY not available in this SillyTavern version, prompt-cleaning fallback skipped');
    }

    // Phase 3: Text Completion 兜底 — 替代 promptOnly 隐藏正则
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
        eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
            if (!isSaoCard()) return;
            const settings = getSettings();
            if (!settings.enabled) return;

            if (typeof data.prompt === 'string' && data.prompt) {
                data.prompt = cleanSaoPromptText(data.prompt);
            }
        });
    } else {
        console.debug('[SAO Companion] event GENERATE_AFTER_COMBINE_PROMPTS not available in this SillyTavern version, prompt-cleaning fallback skipped');
    }

    // === Shadow DOM 重绘恢复 ===
    // ST 的 updateMessageBlock / swipe / 历史消息加载会重绘 .mes_text，销毁 Shadow DOM Host
    // 监听相关事件后重新渲染 SAO tags

    // swipe 切分支后重新渲染
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '');
        });
    }

    // 消息编辑后重新渲染
    if (event_types.MESSAGE_EDITED) {
        eventSource.on(event_types.MESSAGE_EDITED, (messageId) => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg) return;
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '');
        });
    }

    // 角色（AI）消息 DOM 渲染完成后渲染 tags（替代 MESSAGE_RECEIVED 中的 renderAllTags）
    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '');
        });
    }

    // 滚动加载更多历史消息后批量渲染
    if (event_types.MORE_MESSAGES_LOADED) {
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            if (ctx.chat && ctx.chat.length > 0) {
                ctx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    const histEl = getMessageElement(idx);
                    if (histEl && !histEl.querySelector('.sao-render-host')) {
                        renderAllTags(histEl, msg.mes || '');
                    }
                });
            }
        });
    }

    log('事件绑定完成');
}

/**
 * Prompt 拦截器 - 在 prompt 组装前修改聊天副本
 * SillyTavern 通过 manifest.json 的 generate_interceptor 调用此函数
 * chat 是生成用副本，不是 context.chat 本体，因此不会影响聊天显示
 */
globalThis.saoPromptCleanerInterceptor = async function(chat, contextSize, abort, type) {
    try {
        if (!isSaoCard()) return;
        const settings = getSettings();
        if (!settings.enabled) return;
        if (!Array.isArray(chat)) return;

        let cleaned = 0;
        for (const msg of chat) {
            if (typeof msg.mes === 'string' && msg.mes) {
                const before = msg.mes.length;
                msg.mes = cleanSaoPromptText(msg.mes);
                if (msg.mes.length !== before) cleaned++;
            }
        }
        if (cleaned > 0) {
            log(`Prompt 清理: 处理了 ${cleaned} 条消息中的 SAO 标签`);
        }
    } catch (e) {
        log('Prompt 清理失败: ' + e.message, 'warn');
    }
};

// ============================================================
// 独立前端面板
// ============================================================

let panelLoaded = false;

// ============================================================
// 详情弹窗与渲染函数
// ============================================================

function showDetailModal(title, html) {
    const titleEl = document.getElementById('sao_modal_title');
    const bodyEl = document.getElementById('sao_modal_body');
    const modal = document.getElementById('sao_detail_modal');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = html;
    if (modal) modal.style.display = 'flex';
}

function closeDetailModal() {
    const modal = document.getElementById('sao_detail_modal');
    if (modal) modal.style.display = 'none';
}

// 稀有度文本 → CSS class 映射（兼容中文颜色/中文档位/英文）
function rarityClass(rarity) {
    if (!rarity) return 'sao-rarity-common';
    const r = String(rarity).toLowerCase();
    if (r.includes('橙') || r.includes('传说') || r.includes('red') || r.includes('legendary') || r.includes('orange')) return 'sao-rarity-legendary';
    if (r.includes('紫') || r.includes('史诗') || r.includes('epic') || r.includes('purple')) return 'sao-rarity-epic';
    if (r.includes('蓝') || r.includes('稀有') || r.includes('rare') || r.includes('blue')) return 'sao-rarity-rare';
    if (r.includes('绿') || r.includes('优质') || r.includes('uncommon') || r.includes('green')) return 'sao-rarity-uncommon';
    return 'sao-rarity-common';
}

function renderEquipmentDetail(item) {
    const rows = []
    // 名称行：确保有名字的装备一定显示名称（避免详情弹窗为空）
    if (item.name) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">名称</span><span class="sao-detail-value">${esc(item.name)}</span></div>`)
    if (item.type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">类型</span><span class="sao-detail-value">${esc(item.type)}</span></div>`)
    if (item.rarity) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">稀有度</span><span class="sao-detail-value ${rarityClass(item.rarity)}">${esc(item.rarity)}</span></div>`)
    if (item.item_level != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">物品等级</span><span class="sao-detail-value">${esc(item.item_level)}</span></div>`)
    if (item.durability) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">耐久</span><span class="sao-detail-value">${esc(item.durability)}</span></div>`)
    if (item.stats) {
        const statLabels = { max_hp: '❤️ HP', str: '💪 STR', agi: '🏃 AGI', int: '🧠 INT', vit: '🔋 VIT' };
        for (const [k, v] of Object.entries(item.stats)) {
            if (v > 0) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">${statLabels[k] || esc(k.toUpperCase())}</span><span class="sao-detail-value">+${esc(v)}</span></div>`)
        }
    }
    if (item.affixes && item.affixes.length > 0) {
        const affixHtml = item.affixes.map(a => `<span class="sao-tag sao-tag-affix">${esc(a)}</span>`).join(' ')
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">附魔</span><span class="sao-detail-value">${affixHtml}</span></div>`)
    }
    if (item.description) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">描述</span><span class="sao-detail-value">${esc(item.description)}</span></div>`)
    // 如果没有任何行，至少显示名称防止空弹窗
    if (rows.length === 0 && item.name) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">名称</span><span class="sao-detail-value">${esc(item.name)}</span></div>`)
    return rows.join('')
}

function coreCodeLabel(code) {
    const map = { A1: '伤害输出', A2: '生命恢复', A3: '法力恢复', A4: '牺牲增益', A5: '终结技' };
    return map[code] || code;
}

/**
 * 从角色卡世界书条目「特殊效果编号」动态解析效果代码表
 * 在首次调用时解析，结果缓存在 _effectCodeTable 中
 * 如果解析失败则回退到内置硬编码表
 */
let _effectCodeTable = null;
let _effectCodeParsed = false; // 标记是否已尝试解析（避免每次调用都重新解析角色卡）

function getEffectCodeTable() {
    if (_effectCodeParsed) return _effectCodeTable;
    _effectCodeParsed = true;

    // 内置硬编码表（作为回退）
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

    // 尝试从角色卡世界书动态解析
    try {
        const char = getCurrentCharacter();
        if (!char?.data?.character_book?.entries) {
            _effectCodeTable = fallback;
            return _effectCodeTable;
        }

        const entries = char.data.character_book.entries;
        // 查找包含"特殊效果编号"的条目
        let effEntry = null;
        for (const e of entries) {
            const name = (e.name || e.comment || '').toLowerCase();
            if (name.includes('特殊效果编号') || name.includes('效果编号')) {
                effEntry = e;
                break;
            }
        }
        if (!effEntry) {
            _effectCodeTable = fallback;
            return _effectCodeTable;
        }

        const content = effEntry.content || '';
        const parsed = { A: {}, B: {}, S: {}, M: {}, P: {} };

        // 解析格式: **B1 (生命窃取):** `[EN:B1,X%]` ... 后面可能有说明文字
        // 或: **A1 (伤害输出模板):** `[WN:A1]`
        const codeRegex = /\*+\s*(A\d+|B\d+|S\d+|M\d+|P\d+)\s*\(([^)]+)\)[：:]*/g;
        let match;
        while ((match = codeRegex.exec(content)) !== null) {
            const code = match[1];
            const label = match[2].replace(/模板$/, '').trim();
            const prefix = code[0]; // A, B, S, M, P

            // 提取该条目后续的说明文字（直到下一个 ** 或 ---）
            const afterPos = match.index + match[0].length;
            const nextSection = content.indexOf('**', afterPos);
            const nextDash = content.indexOf('---', afterPos);
            const endPos = Math.min(
                nextSection > 0 ? nextSection : content.length,
                nextDash > 0 ? nextDash : content.length
            );
            const descText = content.substring(afterPos, endPos)
                .replace(/\[.*?\]/g, '') // 去掉代码格式标记
                .replace(/\*\*/g, '')
                .replace(/<[^>]+>/g, '')
                .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
                .replace(/[\r\n]+/g, ' ')
                .trim();

            // 构建描述生成函数：用卡片中的说明文字，参数用占位符替换
            // 如果卡片有详细说明，直接用说明文字；否则用 label
            parsed[prefix][code] = {
                label: label,
                fmt: (args) => {
                    // 尝试将卡片说明中的 X, Y 等参数替换为实际值
                    let desc = descText || label;
                    const paramNames = ['X', 'Y', 'N', 'P%', 'Cost%'];
                    for (let pi = 0; pi < args.length && pi < paramNames.length; pi++) {
                        desc = desc.replace(new RegExp(paramNames[pi].replace('%', '\\%'), 'g'), args[pi]);
                    }
                    // 如果没有可替换的参数，直接附加
                    if (args.length > 0 && !descText) {
                        desc = `${label}: ${args.join(', ')}`;
                    }
                    return desc;
                },
            };
        }

        // 合并：解析到的覆盖 fallback 中没有的
        for (const prefix of ['A', 'B', 'S', 'M', 'P']) {
            for (const code in parsed[prefix]) {
                if (!fallback[prefix][code]) {
                    fallback[prefix][code] = parsed[prefix][code];
                } else {
                    // 用卡片解析的 label 覆盖
                    fallback[prefix][code].label = parsed[prefix][code].label;
                    // 如果卡片有说明文字，用它
                    if (parsed[prefix][code].fmt) {
                        fallback[prefix][code].fmt = parsed[prefix][code].fmt;
                    }
                }
            }
        }
        _effectCodeTable = fallback;
        log('效果代码表已从角色卡动态解析');
    } catch (e) {
        log('效果代码表动态解析失败，使用内置表: ' + e.message, 'warn');
        _effectCodeTable = fallback;
    }
    return _effectCodeTable;
}

/** 切换角色卡时重置效果代码表缓存 */
function resetEffectCodeTable() {
    _effectCodeTable = null;
    _effectCodeParsed = false;
}

/**
 * 将 EN 效果代码翻译为可读说明
 * 动态从角色卡世界书条目解析，自动同步卡片更新
 * 格式: "B1,5%" → { code: 'B1', desc: '...', label: '生命窃取' }
 */
function describeEnCode(raw) {
    if (!raw) return null;
    const parts = raw.split(',').map(s => s.trim());
    const code = parts[0];
    const args = parts.slice(1);

    const table = getEffectCodeTable();
    const prefix = code[0];
    const tableSection = table[prefix];

    if (!tableSection || !tableSection[code]) {
        return { code, label: code, desc: raw };
    }
    const entry = tableSection[code];
    const desc = entry.fmt(args);
    return { code, label: entry.label, desc };
}

function renderSkillDetail(sk) {
    const rows = []
    if (sk.weapon_type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">武器类型</span><span class="sao-detail-value">${esc(sk.weapon_type)}</span></div>`)
    if (sk.skill_level != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">技能等级</span><span class="sao-detail-value">Lv${esc(sk.skill_level)}</span></div>`)
    if (sk.rarity) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">稀有度</span><span class="sao-detail-value ${rarityClass(sk.rarity)}">${esc(sk.rarity)}</span></div>`)
    if (sk.base_damage != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">基础伤害</span><span class="sao-detail-value">${esc(sk.base_damage)}</span></div>`)
    if (sk.hit_rate != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">命中率</span><span class="sao-detail-value">${esc(sk.hit_rate)}%</span></div>`)
    if (sk.crit_rate != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">暴击率</span><span class="sao-detail-value">${esc(sk.crit_rate)}%</span></div>`)
    if (sk.mp_cost != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">MP消耗</span><span class="sao-detail-value">${esc(sk.mp_cost)}</span></div>`)
    if (sk.cooldown != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">冷却</span><span class="sao-detail-value">${esc(sk.cooldown)}回合</span></div>`)
    if (sk.hits != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">连击数</span><span class="sao-detail-value">${esc(sk.hits)}</span></div>`)
    if (sk.targets != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">目标数</span><span class="sao-detail-value">${esc(sk.targets)}</span></div>`)
    if (sk.core_code) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">核心功能</span><span class="sao-detail-value">${esc(coreCodeLabel(sk.core_code))}</span></div>`)
    if (sk.affix_codes && sk.affix_codes.length > 0) {
        const affixHtml = sk.affix_codes.map(raw => {
            const d = describeEnCode(raw);
            return d ? `<span class="sao-tag sao-tag-affix" title="${esc(d.code)}">${esc(d.label)}</span>` : `<span class="sao-tag sao-tag-affix">${esc(raw)}</span>`;
        }).join(' ');
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">词条</span><span class="sao-detail-value">${affixHtml}</span></div>`)
    }
    if (sk.affix_codes && sk.affix_codes.length > 0) {
        const descHtml = sk.affix_codes.map(raw => {
            const d = describeEnCode(raw);
            return d ? `<div style="margin:2px 0;">• <strong>${esc(d.label)}</strong>：${esc(d.desc)}</div>` : '';
        }).join('');
        if (descHtml) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">效果说明</span><span class="sao-detail-value" style="text-align:left;max-width:320px;">${descHtml}</span></div>`)
    }
    if (sk.effects && sk.effects.length > 0) {
        const effHtml = sk.effects.map(e => `<span class="sao-tag sao-tag-effect">${esc(e)}</span>`).join(' ')
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">效果</span><span class="sao-detail-value">${effHtml}</span></div>`)
    }
    if (sk.description) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">描述</span><span class="sao-detail-value">${esc(sk.description)}</span></div>`)
    return rows.join('')
}

function renderInventoryDetail(item) {
    const rows = []
    if (item.qty != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">数量</span><span class="sao-detail-value">${esc(item.qty)}</span></div>`)
    if (item.item_level != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">物品等级</span><span class="sao-detail-value">⭐${esc(item.item_level)}</span></div>`)
    if (item.type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">类型</span><span class="sao-detail-value">${esc(item.type)}</span></div>`)
    if (item.rarity) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">稀有度</span><span class="sao-detail-value ${rarityClass(item.rarity)}">${esc(item.rarity)}</span></div>`)
    if (item.durability) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">耐久</span><span class="sao-detail-value">${esc(item.durability)}</span></div>`)
    if (item.description) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">描述</span><span class="sao-detail-value">${esc(item.description)}</span></div>`)
    return rows.join('')
}

async function loadPanelHTML() {
    if (panelLoaded) return;
    try {
        // 不使用 renderExtensionTemplateAsync（DOMPurify 会移除 <style> 标签）
        // 直接 fetch 原始 panel.html
        const url = `/scripts/extensions/third-party/sao-companion/panel.html`;
        const resp = await fetch(url);
        const html = await resp.text();

        // 用 DOMParser 解析 HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. 提取所有 <style> 标签，添加到 head（只添加一次）
        if (!document.getElementById('sao_panel_style')) {
            const styles = doc.querySelectorAll('style');
            const combinedStyle = document.createElement('style');
            combinedStyle.id = 'sao_panel_style';
            combinedStyle.textContent = Array.from(styles).map(s => s.textContent).join('\n');
            document.head.appendChild(combinedStyle);
        }

        // 2. 提取 body 的所有子元素（不包括 style），添加到 document.body
        const bodyElements = doc.body
            ? Array.from(doc.body.children).filter(el => el.tagName !== 'STYLE')
            : Array.from(doc.documentElement.children).filter(el => el.tagName !== 'HEAD' && el.tagName !== 'STYLE');

        if (bodyElements.length > 0) {
            const fragment = document.createDocumentFragment();
            bodyElements.forEach(el => fragment.appendChild(el));
            document.body.appendChild(fragment);
        } else {
            log('panel.html body 提取失败', 'error');
        }
        panelLoaded = true;
    } catch (e) {
        log('loadPanelHTML 失败: ' + e.message, 'error');
        console.error('[SAO Companion] loadPanelHTML error:', e);
        throw e;
    }
}

function initPanelLogic() {
    // 章节 → 世界书条目切换 (FIX 4: 使用条目名称前缀匹配)
    window.switchWorldInfoEntries = async function switchWorldInfoEntries(arc) {
        try {
            const ctx = getContext();
            const char = getCurrentCharacter();
            if (!char?.data?.character_book?.entries) return;

            const entries = char.data.character_book.entries;

            // 旧的关键词映射（作为后备检查）
            const arcKeywords = {
                sao: ['sao', 'SAO', '\u827E\u6069\u845B\u6717\u7279', 'Aincrad'],
                alo_old: ['\u65E7alo', '\u65E7ALO', '\u65E7ALO\u7BC7'],
                alo_new: ['\u65B0\u751Falo', '\u65B0\u751FALO', '\u65B0\u751FALO\u7BC7'],
                ggo: ['ggo', 'GGO', '\u5E7D\u7075\u5B50\u5F39'],
                real: ['\u73B0\u5B9E', '\u771F\u5B9E\u4E16\u754C', '\u73B0\u5B9E\u4E16\u754C'],
            };
            const currentKeys = arcKeywords[arc] || [];
            const namePrefixes = ARC_NAME_PREFIXES[arc] || [];

            let enabledCount = 0, disabledCount = 0, unchangedCount = 0;

            entries.forEach(e => {
                const entryName = (e.comment || e.name || '').trim();

                // 跳过时间线条目（按日期触发，不应被章节切换控制）
                if (/\d{4}\u5E74\d{1,2}\u6708/.test(entryName)) {
                    unchangedCount++;
                    return;
                }

                // 方法1: 通过条目名称前缀判断章节归属
                let entryArc = null;
                for (const [arcKey, prefixes] of Object.entries(ARC_NAME_PREFIXES)) {
                    if (prefixes.some(pfx => entryName.startsWith(pfx) || entryName.toLowerCase().startsWith(pfx.toLowerCase()))) {
                        entryArc = arcKey;
                        break;
                    }
                }

                if (entryArc) {
                    // 条目名称明确归属某个章节：启用/禁用
                    const shouldBeEnabled = (entryArc === arc);
                    if (e.enabled !== shouldBeEnabled) {
                        e.enabled = shouldBeEnabled;
                        if (shouldBeEnabled) enabledCount++; else disabledCount++;
                    } else {
                        unchangedCount++;
                    }
                    return;
                }

                // 方法2: 条目名称不含已知前缀 → 用旧的关键词匹配（仅对有 keys 的条目）
                if (e.constant) { unchangedCount++; return; }
                if (!e.selective) { unchangedCount++; return; }
                const entryKeys = e.keys || [];
                if (entryKeys.length === 0) { unchangedCount++; return; }

                const isCurrentArc = entryKeys.some(k =>
                    currentKeys.some(ck => k.toLowerCase().includes(ck.toLowerCase()))
                );
                if (entryKeys.length > 0) {
                    const wasEnabled = e.enabled;
                    e.enabled = isCurrentArc;
                    if (e.enabled !== wasEnabled) {
                        if (e.enabled) enabledCount++; else disabledCount++;
                    } else {
                        unchangedCount++;
                    }
                }
            });

            log(`\u4E16\u754C\u4E66\u5207\u6362 [${arc}]: \u542F\u7528=${enabledCount} \u7981\u7528=${disabledCount} \u4E0D\u53D8=${unchangedCount}`);

            // 保存世界书
            if (typeof ctx.saveWorldInfo === 'function') {
                const bookName = char.data.character_book.name || char.name;
                await ctx.saveWorldInfo(bookName, char.data.character_book, true);
            } else if (ctx.writeExtensionField) {
                await ctx.writeExtensionField(ctx.characterId, 'character_book', char.data.character_book);
            }
            log(`\u4E16\u754C\u4E66\u6761\u76EE\u5DF2\u6309\u7AE0\u8282 [${arc}] \u5207\u6362`);
        } catch (e) {
            log('\u4E16\u754C\u4E66\u5207\u6362\u5931\u8D25: ' + e.message, 'warn');
        }
    };

    window.SaoPanel = {
        open() {
            const overlay = document.getElementById('sao_panel_overlay');
            if (!overlay) { log('面板未加载', 'error'); return; }
            overlay.style.display = 'block';
            loadSettingsToPanel();
            refreshStatus();
            updateLogDisplay();
        },
        close() {
            const overlay = document.getElementById('sao_panel_overlay');
            if (overlay) overlay.style.display = 'none';
        },
        showDetail(title, html) {
            showDetailModal(title, html);
        },
        closeDetail() {
            closeDetailModal();
        },
        // 标签切换
        switchTab(tabName) {
            document.querySelectorAll('.sao-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.sao-tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector(`.sao-tab[data-tab="${tabName}"]`)?.classList.add('active');
            document.querySelector(`.sao-tab-content[data-content="${tabName}"]`)?.classList.add('active');
        },
        // 拉取模型列表
        async fetchModels(role) {
            const testEl = document.getElementById(`sao_${role}_test`);
            const selectEl = document.getElementById(`sao_${role}_model`);
            testEl.className = 'sao-test-result';
            testEl.textContent = '正在拉取模型列表...';

            // 先保存当前输入
            saveModelsToSettings();

            try {
                const models = await fetchModelList(role);
                selectEl.innerHTML = '';
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m; opt.textContent = m;
                    selectEl.appendChild(opt);
                });
                // 恢复已选模型
                const settings = getSettings();
                if (settings.models[role].model && models.includes(settings.models[role].model)) {
                    selectEl.value = settings.models[role].model;
                }
                testEl.className = 'sao-test-result show success';
                testEl.textContent = `✓ 拉取到 ${models.length} 个模型`;
            } catch (e) {
                testEl.className = 'sao-test-result show error';
                testEl.textContent = '✗ ' + e.message;
                log('拉取模型失败(' + role + '): ' + e.message, 'error');
            }
        },
        // 测试模型
        async testModel(role) {
            const testEl = document.getElementById(`sao_${role}_test`);
            testEl.className = 'sao-test-result';
            testEl.textContent = '正在测试...';
            saveModelsToSettings();

            try {
                const result = await callModel(role, [
                    { role: 'system', content: '回复"OK"即可。' },
                    { role: 'user', content: '测试连接' },
                ], 10);
                testEl.className = 'sao-test-result show success';
                testEl.textContent = '✓ 连接成功: ' + result.substring(0, 50);
                updateModelStatus(role, true);
            } catch (e) {
                testEl.className = 'sao-test-result show error';
                testEl.textContent = '✗ ' + e.message;
                updateModelStatus(role, false);
                log('测试失败(' + role + '): ' + e.message, 'error');
            }
        },
        saveModels() {
            saveModelsToSettings();
            // 刷新所有状态标签
            const settings = getSettings();
            ROLES.forEach(role => {
                const cfg = settings.models[role] || {};
                updateModelStatus(role, !!cfg.url && !!cfg.model);
            });
            // 显示保存成功提示
            const testEl = document.getElementById('sao_narrative_test');
            if (testEl) {
                testEl.className = 'sao-test-result show success';
                testEl.textContent = '✓ 配置已保存';
                setTimeout(() => { testEl.className = 'sao-test-result'; }, 2000);
            }
            log('模型配置已保存');
        },
        switchArc(arc) {
            const settings = getSettings();
            settings.currentArc = arc;
            saveSettings();
            const data = getSaoData();
            if (data) data.arc = arc;
            switchWorldInfoEntries(arc);
            injectMemoryAndState();
            log('章节切换: ' + arc);
            // 更新 UI
            document.querySelectorAll('.sao-chapter-card').forEach(c => {
                c.classList.toggle('sao-chapter-active', c.dataset.arc === arc);
            });
        },
        refreshStatus() {
            refreshStatus();
        },
        clearLogs() {
            logs.length = 0;
            updateLogDisplay();
        },
        async testGenerate(type) {
            const testEl = document.getElementById('sao_generate_test');
            if (!testEl) return;
            testEl.className = 'sao-test-result';
            testEl.textContent = '正在生成...';
            saveModelsToSettings();
            try {
                // 检查 combat 模型是否配置
                const settings = getSettings();
                const cfg = settings.models.combat;
                if (!cfg.url || !cfg.model) {
                    testEl.className = 'sao-test-result show error';
                    testEl.textContent = '✗ 请先在"模型配置"标签中配置"数值与生成模型"的 API 地址和模型，并点击"获取"选择模型';
                    return;
                }
                let result;
                if (type === 'equipment') {
                    result = await generateEquipment({ playerLevel: 5, floor: 1, type: '武器', rarity: '蓝色' });
                } else if (type === 'skill') {
                    result = await generateSkill({ weaponType: '单手直剑', skillLevel: 1, playerLevel: 5 });
                } else if (type === 'loot') {
                    result = await generateLoot({ enemyLevel: 3, floor: 1, enemyType: '野猪' });
                } else if (type === 'combat') {
                    result = await calculateCombat({
                        player: { hp: 585, max_hp: 585, str: 3, agi: 1, int: 1, vit: 7 },
                        enemy: { name: '野猪', hp: 50, max_hp: 50, str: 5, agi: 3, int: 1, vit: 3 },
                        action: '使用剑技「刺击」攻击野猪',
                    });
                }
                if (result === null || result === undefined) {
                    testEl.className = 'sao-test-result show error';
                    testEl.textContent = '✗ 生成失败：模型返回空结果，请检查模型配置';
                    return;
                }
                testEl.className = 'sao-test-result show success';
                testEl.textContent = '✓ ' + JSON.stringify(result, null, 2).substring(0, 500);
            } catch (e) {
                testEl.className = 'sao-test-result show error';
                testEl.textContent = '✗ ' + e.message;
            }
        },
    };

    // 面板事件委托（替代 onclick 内联事件，避免 DOMPurify 清洗）
    const panel = document.getElementById('sao_panel_overlay');
    if (panel) {
        panel.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.getAttribute('data-action');
            const role = target.getAttribute('data-role');
            const type = target.getAttribute('data-type');
            const tab = target.getAttribute('data-tab');
            const arc = target.getAttribute('data-arc');

            switch (action) {
                case 'closePanel': window.SaoPanel.close(); break;
                case 'switchTab': window.SaoPanel.switchTab(tab); break;
                case 'switchArc': window.SaoPanel.switchArc(arc); break;
                case 'fetchModels': window.SaoPanel.fetchModels(role); break;
                case 'testModel': window.SaoPanel.testModel(role); break;
                case 'saveModels': window.SaoPanel.saveModels(); break;
                case 'testGenerate': window.SaoPanel.testGenerate(type); break;
                case 'refreshStatus': window.SaoPanel.refreshStatus(); break;
                case 'clearLogs': window.SaoPanel.clearLogs(); break;
                case 'closeDetail': window.SaoPanel.closeDetail(); break;
            }
        });
    }

    // 详情弹窗事件委托
    function handleDetailClick(e) {
        const target = e.target.closest('[data-detail-type]');
        if (!target) return;
        const type = target.getAttribute('data-detail-type');
        const index = parseInt(target.getAttribute('data-detail-index'), 10);
        const cached = window._saoCurrentData;
        if (!cached) return;
        let title = '';
        let html = '';
        switch (type) {
            case 'equip': {
                const entry = cached.equipment?.[index];
                if (entry) {
                    // entry 是 { slot, item } 格式，item 可能是 {name, stats, item_level, ...}
                    const item = entry.item || {};
                    title = `${SLOT_LABELS[entry.slot] || entry.slot}: ${item.name || '未知'}`;
                    html = renderEquipmentDetail(item);
                }
                break;
            }
            case 'inv': {
                const item = cached.inventory?.[index];
                if (item) {
                    title = item.name || '物品';
                    html = renderInventoryDetail(item);
                }
                break;
            }
            case 'skill': {
                const sk = cached.skills?.[index];
                if (sk) {
                    title = `${sk.name || '技能'}${(sk.skill_level ?? sk.level) != null ? ' Lv' + (sk.skill_level ?? sk.level) : ''}`;
                    html = renderSkillDetail(sk);
                }
                break;
            }
        }
        if (title && html) {
            showDetailModal(title, html);
        }
    }
    document.getElementById('sao_equipment_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_inventory_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_skills_list')?.addEventListener('click', handleDetailClick);
}

function saveModelsToSettings() {
    const settings = getSettings();
    ROLES.forEach(role => {
        const url = document.getElementById(`sao_${role}_url`)?.value || '';
        const key = document.getElementById(`sao_${role}_key`)?.value || '';
        const model = document.getElementById(`sao_${role}_model`)?.value || '';
        settings.models[role] = { url, key, model };
    });
    saveSettings();
}

function loadSettingsToPanel() {
    const settings = getSettings();
    ROLES.forEach(role => {
        const cfg = settings.models[role] || {};
        const urlEl = document.getElementById(`sao_${role}_url`);
        const keyEl = document.getElementById(`sao_${role}_key`);
        const modelEl = document.getElementById(`sao_${role}_model`);
        if (urlEl) urlEl.value = cfg.url || '';
        if (keyEl) keyEl.value = cfg.key || '';
        if (modelEl) {
            if (cfg.model) {
                // 如果有已保存的模型，显示为选项
                if (modelEl.options.length === 1) {
                    modelEl.innerHTML = `<option value="${esc(cfg.model)}">${esc(cfg.model)}</option>`;
                }
                modelEl.value = cfg.model;
            }
            updateModelStatus(role, !!cfg.url && !!cfg.model);
        }
    });
}

function updateModelStatus(role, ok) {
    const el = document.getElementById(`sao_${role}_status`);
    if (!el) return;
    if (ok) {
        el.className = 'sao-status-box sao-status-ok';
        el.textContent = '已配置';
    } else {
        el.className = 'sao-status-box sao-status-warn';
        el.textContent = '未配置';
    }
}

function refreshStatus() {
    const data = getSaoData();
    const settings = getSettings();
    if (!data) return;

    // 更新玩家状态卡片
    if (data.state) {
        const s = data.state;
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '-'; };
        const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; };

        // 玩家名
        const playerName = s.player_name || getContext().name1 || '冒险者';
        setText('sao_player_name', playerName);

        setText('sao_player_location', `${s.location || '?'} / ${s.floor || '?'}F`);
        setText('sao_hp_text', `${s.hp ?? '?'}/${s.max_hp ?? '?'}`);
        setText('sao_mp_text', `${s.mp ?? '?'}/${s.max_mp ?? '?'}`);
        if (s.max_hp > 0) setBar('sao_hp_bar', (s.hp / s.max_hp) * 100);
        if (s.max_mp > 0) setBar('sao_mp_bar', (s.mp / s.max_mp) * 100);
        setText('sao_stat_str', s.str ?? '?');
        setText('sao_stat_agi', s.agi ?? '?');
        setText('sao_stat_int', s.int ?? '?');
        setText('sao_stat_vit', s.vit ?? '?');
        setText('sao_level_text', s.level ?? '?');
        setText('sao_cor_text', s.cor ?? '?');
        setText('sao_floor_text', s.floor ?? '?');

        // 装备列表 - 显示名字+事件委托
        const equipEl = document.getElementById('sao_equipment_list');
        if (equipEl) {
            if (s.equipment && Object.keys(s.equipment).length > 0) {
                const equipArr = Object.entries(s.equipment).filter(([, item]) => item && item.name);
                equipEl.innerHTML = equipArr.map(([slot, item], i) =>
                    `<div class="sao-tag sao-tag-equip" data-detail-type="equip" data-detail-index="${i}" style="cursor:pointer;">${esc(SLOT_LABELS[slot] || slot)}: ${esc(item.name)}</div>`
                ).join('');
                window._saoCurrentData = window._saoCurrentData || {};
                window._saoCurrentData.equipment = equipArr.map(([slot, item]) => ({ slot, item }));
            } else {
                equipEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">暂无装备数据</span>';
                if (window._saoCurrentData) window._saoCurrentData.equipment = [];
            }
        }

        // 背包列表 - 显示名字+数量+事件委托
        const invEl = document.getElementById('sao_inventory_list');
        if (invEl) {
            if (s.inventory && s.inventory.length > 0) {
                const invFiltered = s.inventory.filter(i => i.qty > 0);
                invEl.innerHTML = invFiltered.map((item, i) =>
                    `<div class="sao-tag sao-tag-inv" data-detail-type="inv" data-detail-index="${i}" style="cursor:pointer;">${esc(item.name)} x${esc(item.qty)}${item.item_level ? ' ⭐' + item.item_level : ''}</div>`
                ).join('');
                window._saoCurrentData = window._saoCurrentData || {};
                window._saoCurrentData.inventory = invFiltered;
            } else {
                invEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">空</span>';
                if (window._saoCurrentData) window._saoCurrentData.inventory = [];
            }
        }

        // 技能列表 - 显示名字+等级+事件委托
        const skillEl = document.getElementById('sao_skills_list');
        if (skillEl) {
            if (s.skills && s.skills.length > 0) {
                skillEl.innerHTML = s.skills.map((sk, i) =>
                    `<div class="sao-tag sao-tag-skill" data-detail-type="skill" data-detail-index="${i}" style="cursor:pointer;">${esc(sk.name)}</div>`
                ).join('');
                window._saoCurrentData = window._saoCurrentData || {};
                window._saoCurrentData.skills = s.skills;
            } else {
                skillEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">空</span>';
                if (window._saoCurrentData) window._saoCurrentData.skills = [];
            }
        }
    }

    // 当前章节高亮
    const arcEl = document.getElementById('sao_current_arc');
    if (arcEl) arcEl.textContent = settings.currentArc || 'sao';
    document.querySelectorAll('.sao-chapter-card').forEach(c => {
        c.classList.toggle('sao-chapter-active', c.dataset.arc === settings.currentArc);
    });
}

// ============================================================
// 扩展面板入口 (酒馆左侧设置)
// ============================================================

async function loadSettingsPanel() {
    const settings = getSettings();
    const templateData = { ...settings };
    const html = await renderExtensionTemplateAsync('third-party/sao-companion', 'settings', templateData);
    $('#extensions_settings').append(html);

    // 绑定"打开控制台"按钮
    $('#sao_open_panel').on('click', async () => {
        try {
            console.log('[SAO Companion] 按钮点击：开始 loadPanelHTML');
            await loadPanelHTML();
            console.log('[SAO Companion] loadPanelHTML 完成，panelLoaded=', panelLoaded);
            if (!window.SaoPanel) {
                console.log('[SAO Companion] SaoPanel 不存在，调用 initPanelLogic');
                initPanelLogic();
            }
            window.SaoPanel.open();
            console.log('[SAO Companion] SaoPanel.open 调用完成');
        } catch (e) {
            console.error('[SAO Companion] 打开控制台失败:', e);
            alert('[SAO Companion] 打开控制台失败: ' + e.message + '\n请检查浏览器控制台获取详细信息。');
        }
    });

    // 绑定启用开关
    $('#sao_companion_enabled').on('change', function() {
        settings.enabled = !!$(this).prop('checked');
        saveSettings();
    });

    // 绑定兼容模式开关
    $('#sao_compat_mode').on('change', function() {
        settings.compatMode = !!$(this).prop('checked');
        saveSettings();
        if (settings.compatMode && isSaoCard()) {
            enableCompatMode();
        } else if (!settings.compatMode) {
            disableCompatMode();
        }
    });

    log('设置面板已加载');
}

// ============================================================
// 初始化
// ============================================================

export function init() {
    // 版本保护：低于 1.17.0 的 ST 不支持 hooks.activate，init 不会被调用；
    // 如果通过其他途径被调用，此处检测 SillyTavern API 是否可用
    if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
        console.error('[SAO Companion] SillyTavern API 不可用，需要 ST 1.17.0+');
        return;
    }
    console.log('[SAO Companion] v0.6.13 初始化中...');
    window.__SAO_INIT_CALLED = true;
    loadSettingsPanel().then(() => {
        console.log('[SAO Companion] loadSettingsPanel 完成');
        window.__SAO_SETTINGS_LOADED = true;
        const btn = document.getElementById('sao_open_panel');
        console.log('[SAO Companion] #sao_open_panel exists:', !!btn);
        if (btn) {
            const events = $._data(btn, 'events');
            console.log('[SAO Companion] click events bound:', events?.click?.length || 0);
        }
    }).catch(e => {
        console.error('[SAO Companion] loadSettingsPanel 失败:', e);
        window.__SAO_SETTINGS_ERROR = e.message;
    });
    bindEvents();
    // 设置战斗状态持久化回调
    setBattleStateChangeCallback(saveBattleStateThrottled);
    setBattleEndCallback(clearBattleState);
    if (isSaoCard()) {
        log('检测到 SAO 角色卡，立即激活');
        stabilizeSaoRegexScripts();
        enableCompatMode();
        injectMemoryAndState();
    }
    console.log('[SAO Companion] 初始化完成');
}
