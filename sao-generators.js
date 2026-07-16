// sao-generators.js — 装备/技能/战利品生成系统
// 骰子表 + 纯工具函数 + 词缀参数 + 异步生成函数

import { getSettings, log } from './sao-core.js';
import { findOrCreateEquipment } from './sao-store-equipment.js';
import { findOrCreateSkill } from './sao-store-skill.js';
import { findOrCreateConsumable } from './sao-store-consumable.js';
import { addEquipmentItem, addConsumableItem } from './sao-store-inventory.js';
import { addPlayerSkill } from './sao-store-player.js';

// ============================================================
// 骰子表
// ============================================================

/** 装备稀有度骰子表 (1D20): 1-6=白, 7-13=绿, 14-18=蓝, 19-20=紫 */
const EQUIP_RARITY_TABLE = [
    { roll: [1,6],   name: '白色', mult: 1.0, affixes: 1 },
    { roll: [7,13],  name: '绿色', mult: 1.2, affixes: 1 },
    { roll: [14,18], name: '蓝色', mult: 1.5, affixes: 2 },
    { roll: [19,20], name: '紫色', mult: 2.0, affixes: 2 },
];

/** 掉落物类型骰子表 (1D10): 消耗品/材料/药草/杂物/装备 */
const LOOT_TYPE_TABLE = [
    { roll: [1,3],  type: '消耗品', label: '药水/食物' },
    { roll: [4,5],  type: '材料',   label: '矿石/皮革/木材' },
    { roll: [6,7],  type: '药草',   label: '草药' },
    { roll: [8,9],  type: '杂物',   label: '哥布林耳朵/狼牙等' },
    { roll: [10,10],type: '装备',   label: '随机装备（触发generateEquipment）' },
];

/** 装备插槽骰子表 (1D10): 1-2=主手, 3=副手, 4=头部, 5=胸部, 6=手部, 7=腿部, 8-10=饰品 */
const EQUIP_SLOT_TABLE = [
    { roll: [1,2],  slot: 'weapon',    label: '主手' },
    { roll: [3,3],  slot: 'off_hand',  label: '副手' },
    { roll: [4,4],  slot: 'head',      label: '头部' },
    { roll: [5,5],  slot: 'chest',     label: '胸部' },
    { roll: [6,6],  slot: 'hands',     label: '手部' },
    { roll: [7,7],  slot: 'legs',      label: '腿部' },
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

/** 中文稀有度 → 英文枚举（equipmentStore / skillStore 通用） */
const RARITY_TO_EN = {
    '白色': 'common',
    '绿色': 'uncommon',
    '蓝色': 'rare',
    '紫色': 'epic',
};

/** 剑技核心功能骰子表 (1D20): 1-16=伤害A1, 17=终结技A5, 18=生命恢复A2, 19=法力恢复A3, 20=牺牲增益A4 */
const SKILL_CORE_TABLE = [
    { roll: [1,16],  code: 'A1', name: '伤害' },
    { roll: [17,17], code: 'A5', name: '终结技' },
    { roll: [18,18], code: 'A2', name: '生命恢复' },
    { roll: [19,19], code: 'A3', name: '法力恢复' },
    { roll: [20,20], code: 'A4', name: '牺牲增益' },
];

/** 消耗品类型骰子表 (1D20): 1-5=HP药水, 6-10=MP药水, 11-14=属性药水, 15-18=万能药, 19-20=治愈药 */
const CONSUMABLE_TYPE_TABLE = [
    { roll: [1,5],   category: 'hp_restore',   label: 'HP药水', baseValue: (lv) => lv * 10 },
    { roll: [6,10],  category: 'mp_restore',    label: 'MP药水', baseValue: (lv) => lv * 5 },
    { roll: [11,14], category: 'buff',          label: '属性药水', baseValue: (lv) => Math.ceil(lv / 5) },
    { roll: [15,18], category: 'full_restore',  label: '万能药', baseValue: (lv) => lv * 8 },
    { roll: [19,20], category: 'cure',          label: '治愈药', baseValue: () => 1 },
];

/** 消耗品稀有度骰子表 (1D20): 1-10=普通, 11-16=优秀, 17-19=稀有, 20=史诗 */
const CONSUMABLE_RARITY_TABLE = [
    { roll: [1,10],  name: 'common',   mult: 1.0 },
    { roll: [11,16], name: 'uncommon', mult: 1.3 },
    { roll: [17,19], name: 'rare',     mult: 1.6 },
    { roll: [20,20], name: 'epic',     mult: 2.0 },
];

// ============================================================
// 纯工具函数
// ============================================================

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

// ============================================================
// 词缀参数
// ============================================================

/**
 * P3: 词缀参数生成器 — 纯函数，根据词缀代码和稀有度返回完整 EN:CODE,params 字符串
 * @param {string} affixCode - 裸词缀代码，如 'B5', 'S3'
 * @param {string} rarity - 稀有度名称，如 '白色', '绿色', '蓝色', '紫色'
 * @returns {string} 完整词缀字符串，如 'EN:B5,3,35' 或 'EN:S3'
 */
function generateAffixParams(affixCode, rarity) {
    const code = affixCode.split(',')[0];
    const tier = rarity || '白色';
    const PARAM_TABLE = {
        'B1':  { '白色': '5',    '绿色': '8',    '蓝色': '12',   '紫色': '18' },
        'B2':  { '白色': '2,10', '绿色': '2,15', '蓝色': '3,20', '紫色': '3,30' },
        'B3':  { '白色': '2,8',  '绿色': '2,12', '蓝色': '2,18', '紫色': '3,25' },
        'B4':  { '白色': '1',    '绿色': '1',    '蓝色': '1',    '紫色': '2' },
        'B5':  { '白色': '3,10', '绿色': '3,20', '蓝色': '3,35', '紫色': '4,50' },
        'B6':  { '白色': '10,1', '绿色': '15,1', '蓝色': '20,1', '紫色': '30,2' },
        'B7':  { '白色': '15,10','绿色': '20,15','蓝色': '25,25','紫色': '35,40' },
        'B8':  { '白色': '2,10', '绿色': '2,15', '蓝色': '3,20', '紫色': '3,30' },
        'B9':  { '白色': '3',    '绿色': '5',    '蓝色': '8',    '紫色': '12' },
        'B10': { '白色': '3,10', '绿色': '3,20', '蓝色': '3,35', '紫色': '4,50' },
        'B11': { '白色': '2,2',  '绿色': '2,4',  '蓝色': '3,6',  '紫色': '3,10' },
        'B12': { '白色': '2,2',  '绿色': '2,4',  '蓝色': '3,6',  '紫色': '3,10' },
        'B13': { '白色': '2,2',  '绿色': '2,4',  '蓝色': '3,6',  '紫色': '3,10' },
        'B14': { '白色': '2,2',  '绿色': '2,4',  '蓝色': '3,6',  '紫色': '3,10' },
        'B15': { '白色': '10',   '绿色': '15',   '蓝色': '25',   '紫色': '40' },
        'B16': { '白色': '10',   '绿色': '15',   '蓝色': '25',   '紫色': '40' },
        'B17': { '白色': '15',   '绿色': '25',   '蓝色': '40',   '紫色': '60' },
        'B18': { '白色': '3,5',  '绿色': '3,10', '蓝色': '4,15', '紫色': '5,25' },
        'B19': { '白色': '3,3',  '绿色': '3,5',  '蓝色': '4,8',  '紫色': '5,12' },
        'B20': { '白色': '20',   '绿色': '40',   '蓝色': '70',   '紫色': '120' },
        'B21': { '白色': '30',   '绿色': '50',   '蓝色': '80',   '紫色': '150' },
        'B22': { '白色': '3,10', '绿色': '3,20', '蓝色': '3,35', '紫色': '4,50' },
    };
    const entry = PARAM_TABLE[code];
    const params = entry ? (entry[tier] || entry['白色']) : '';
    return params ? `EN:${code},${params}` : `EN:${code}`;
}

/**
 * P3: 从词缀代码中解析数值参数 — 若代码本身携带参数则直接使用，否则运行时补全
 * @param {string} affixCode - 完整词缀字符串，如 'EN:B5,3,35' 或裸 'B5'
 * @param {object} skill - 技能对象（用于取 rarity 兜底）
 * @returns {number[]} 数值参数数组
 */
export function resolveAffixArgs(affixCode, skill) {
    const parts = affixCode.split(',');
    if (parts.length > 1) return parts.slice(1).map(Number);
    log(`[resolveAffixArgs] 词缀代码无参数，运行时补全: ${affixCode}`, 'warn');
    const code = parts[0].replace(/^EN:/, '');
    const completed = generateAffixParams(code, skill?.rarity || '白色');
    return completed.split(',').slice(1).map(Number);
}

// ============================================================
// 异步生成函数
// ============================================================

/**
 * 生成武器/装备 (FIX 3: 使用骰子表确定性计算数值，仅名称/描述由模型生成)
 * @param {object} context - { playerLevel, floor, type, rarity, name }
 * @param {Function} callModelFn - 模型调用函数
 * @returns {Promise<object|null>} 装备对象
 */
export async function generateEquipment(context, callModelFn, prefilledName, prefilledDesc) {
    if (!callModelFn && !prefilledName) throw new Error('callModelFn is required (or provide prefilledName)');
    const settings = getSettings();
    if (!settings.enabled) return null;

    const itemLevel = context.playerLevel || context.floor || 1;
    const pf = context.prefilled;

    // 1) 掷稀有度 (1D20)
    let rarityEntry;
    if (context.rarity) {
        // 从传入的名称匹配
        const r = String(context.rarity);
        rarityEntry = EQUIP_RARITY_TABLE.find(e => r.includes(e.name[0])) || lookupRoll(EQUIP_RARITY_TABLE, (Math.floor(Math.random() * 20) + 1));
    } else {
        rarityEntry = lookupRoll(EQUIP_RARITY_TABLE, (Math.floor(Math.random() * 20) + 1));
    }

    // 2) 掷插槽 (1D10)
    let slotEntry = lookupRoll(EQUIP_SLOT_TABLE, (Math.floor(Math.random() * 10) + 1));

    // 3) 掷类型 (1D5)
    let typeEntry;
    if (context.type) {
        const t = String(context.type);
        typeEntry = EQUIP_TYPE_TABLE.find(e => t.includes(e.type[0])) || lookupRoll(EQUIP_TYPE_TABLE, (Math.floor(Math.random() * 5) + 1));
    } else {
        typeEntry = lookupRoll(EQUIP_TYPE_TABLE, (Math.floor(Math.random() * 5) + 1));
    }

    // 4) 计算 HP 基础值
    const hpBase = itemLevel * 10;
    const hpFinal = Math.floor(hpBase * rarityEntry.mult);

    // 5) 计算基础属性
    const levelBaseValue = Math.ceil(itemLevel / 5);
    const stats = { maxHp: hpFinal, str: 0, agi: 0, int: 0, vit: 0 };
    if (typeEntry.mainStat === 'all') {
        stats.str += levelBaseValue;
        stats.agi += levelBaseValue;
        stats.int += levelBaseValue;
        stats.vit += levelBaseValue;
    } else {
        stats[typeEntry.mainStat] += levelBaseValue * 3;
    }

    // 6) 掷词缀 (1D50) x affixCount
    let affixNames = [];
    for (let ai = 0; ai < rarityEntry.affixes; ai++) {
        const affixRoll = (Math.floor(Math.random() * 50) + 1);
        const affixEntry = EQUIP_AFFIX_TABLE[affixRoll];
        const bonus = resolveAffixStats(affixEntry);
        stats.str += bonus.str;
        stats.agi += bonus.agi;
        stats.int += bonus.int;
        stats.vit += bonus.vit;
        if (affixEntry) affixNames.push(affixEntry.name);
    }

    // === Prefilled override (from card opening message / gain_equipment attrs) ===
    if (pf && typeof pf === 'object') {
        if (pf.slot) slotEntry = { slot: pf.slot, label: pf.slot };
        if (pf.rarity) {
            const r = String(pf.rarity);
            rarityEntry = EQUIP_RARITY_TABLE.find(e => r.includes(e.name[0]))
                || EQUIP_RARITY_TABLE.find(e => r.toLowerCase().includes((RARITY_TO_EN[e.name] || '').toLowerCase()))
                || rarityEntry;
        }
        if (pf.stats && typeof pf.stats === 'object') {
            const clamp = (v, lo, hi, name) => {
                if (v == null) return v;
                if (v < lo) { log('generateEquipment: ' + name + ' ' + v + ' 过低，钳制到 ' + lo, 'warn'); return lo; }
                if (v > hi) { log('generateEquipment: ' + name + ' ' + v + ' 过高，钳制到 ' + hi, 'warn'); return hi; }
                return v;
            };
            stats.maxHp = clamp(pf.stats.maxHp ?? stats.maxHp, 0, 9999, 'maxHp');
            stats.str = clamp(pf.stats.str ?? stats.str, 0, 9999, 'str');
            stats.agi = clamp(pf.stats.agi ?? stats.agi, 0, 9999, 'agi');
            stats.int = clamp(pf.stats.int ?? stats.int, 0, 9999, 'int');
            stats.vit = clamp(pf.stats.vit ?? stats.vit, 0, 9999, 'vit');
        }
        if (Array.isArray(pf.affixes) && pf.affixes.length > 0) affixNames = pf.affixes.slice();
        if (pf.item_level != null) {
            if (pf.item_level < 1) { log('generateEquipment: item_level ' + pf.item_level + ' 过低，钳制到 1', 'warn'); pf.item_level = 1; }
            if (pf.item_level > 100) { log('generateEquipment: item_level ' + pf.item_level + ' 过高，钳制到 100', 'warn'); pf.item_level = 100; }
        }
        log('generateEquipment: 使用预填数值 (prefilled)');
    }

    // 7) 构造完整装备记录，请求模型填充 name 和 description
    const weaponSubtypeHint = slotEntry.slot === 'weapon'
        ? '（请从「短刀/匕首/单手剑/双手剑/矛/弓/斧/钝器」中选择具体武器类型融入名称）'
        : slotEntry.slot === 'off_hand'
            ? '（请从「盾牌/短刀/匕首/法器」中选择）'
            : '';
    const rarityEn = RARITY_TO_EN[rarityEntry.name] || 'common';
    const fullEquipJson = JSON.stringify({
        name: '',
        slot: slotEntry.slot,
        weapon_type: (pf && pf.weapon_type) ? pf.weapon_type : null,
        rarity: rarityEn,
        item_level: (pf && pf.item_level != null) ? pf.item_level : itemLevel,
        stats: { maxHp: stats.maxHp, str: stats.str, agi: stats.agi, int: stats.int, vit: stats.vit },
        affixes: affixNames,
        description: '',
    }, null, 2);

    const namePrompt = `为一件SAO游戏装备生成名称和描述。

以下JSON中数值字段已由系统计算完成。请填充 "name" 和 "description" 两个字段，保持其他字段不变，返回完整JSON对象。
- "name": 装备名称，要有SAO风格（如「暗影短刀」「铁壁圆盾」）${weaponSubtypeHint}
- "description": 1-2句装备描述

输入JSON（name 和 description 为空，请填充）:
${fullEquipJson}

要求: 只输出完整的JSON对象，不要包含markdown代码块标记或说明文字。`;

    const equip = {
        name: prefilledName || null,
        slot: slotEntry.slot,
        weapon_type: (pf && pf.weapon_type) ? pf.weapon_type : (slotEntry.slot === 'weapon' ? '单手剑' : slotEntry.slot === 'off_hand' ? '盾牌' : '防具'),
        rarity: rarityEn,
        item_level: (pf && pf.item_level != null) ? pf.item_level : itemLevel,
        stats,
        affixes: affixNames,
        description: prefilledDesc || '',
        source: 'specialist',
    };

    if (prefilledName) {
        // 主LLM已提供名称和描述，跳过子LLM调用
        log('装备生成(主LLM提供名称): ' + prefilledName);
    } else {
        // 子LLM生成名称和描述
        try {
            const result = await callModelFn('equipment', [
                { role: 'system', content: '你是SAO装备命名器。根据输入的装备JSON，填充name和description字段后返回完整JSON。不要改变其他字段的值，不要输出任何非JSON内容。' },
                { role: 'user', content: namePrompt },
            ], 384, { jsonSchema: true });
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            const modelResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            equip.name = modelResult.name || `${slotEntry.label}装备`;
            equip.description = modelResult.description || '';
            if (!equip.description) equip.description = (slotEntry.label || '装备') + '（未命名描述）';
        } catch (e) {
            log('装备命名生成失败: ' + e.message, 'warn');
            equip.name = `${slotEntry.label}装备`;
            if (!equip.description) equip.description = (slotEntry.label || '装备') + '（未命名描述）';
        }
    }

    // B2: 直写 equipmentStore + 默认入背包
    try {
        const equipId = findOrCreateEquipment({ ...equip, source: 'specialist' });
        if (equipId) {
            await addEquipmentItem(equipId, true);
            equip.equipment_id = equipId;
            log('装备入Store: ' + equip.name + ' → ' + equipId);
        }
    } catch (e) {
        log('装备直写Store失败(非致命): ' + e.message, 'warn');
    }
    log('装备生成完成: ' + equip.name);
    return equip;
}

/**
 * 生成剑技 (FIX 3: 使用骰子表确定性计算数值，仅名称/描述由模型生成)
 * @param {object} context - { weaponType, skillLevel, playerLevel }
 * @param {Function} callModelFn - 模型调用函数
 * @returns {Promise<object|null>} 剑技对象
 */
export async function generateSkill(context, callModelFn, prefilledName, prefilledDesc) {
    if (!callModelFn && !prefilledName) throw new Error('callModelFn is required (or provide prefilledName)');
    const settings = getSettings();
    if (!settings.enabled) return null;

    const skillLevel = context.skillLevel || 1;
    const pf = context.prefilled;

    // 1) 掷稀有度 (1D20)
    const rarityEntry = lookupRoll(SKILL_RARITY_TABLE, (Math.floor(Math.random() * 20) + 1));

    // 2) 掷核心功能 (1D20)
    const coreEntry = lookupRoll(SKILL_CORE_TABLE, (Math.floor(Math.random() * 20) + 1));

    // 3) 计算基础ATK
    const baseATK = Math.floor((100 + skillLevel) * rarityEntry.mult);

    // 4) 命中率 = 70 + 1D20
    const hitRate = 70 + (Math.floor(Math.random() * 20) + 1);

    // 5) 暴击率 = 1D20
    const critRate = (Math.floor(Math.random() * 20) + 1);

    // 6) APT (连击数) = 1D10 映射: 1-5->1, 6-8->2, 9-10->3
    const aptRoll = (Math.floor(Math.random() * 10) + 1);
    const apt = aptRoll <= 5 ? 1 : aptRoll <= 8 ? 2 : 3;

    // 7) TPA (目标数) = 同上
    const tpaRoll = (Math.floor(Math.random() * 10) + 1);
    const tpa = tpaRoll <= 5 ? 1 : tpaRoll <= 8 ? 2 : 3;

    // 8) MP消耗 = 1D20
    const mpCost = (Math.floor(Math.random() * 20) + 1);

    // 9) 3条词缀: 1D30 决定类型, PL = skillLevel*2 + rarityBonus + 1D10
    const rarityBonuses = { '\u767D\u8272': 10, '\u7EFF\u8272': 20, '\u84DD\u8272': 35, '\u7D2B\u8272': 55 };
    const rBonus = rarityBonuses[rarityEntry.name] || 10;
    const affixCodes = [];
    const affixNames = [];
    for (let ai = 0; ai < 3; ai++) {
        const affixRoll = (Math.floor(Math.random() * 30) + 1);
        const PL = skillLevel * 2 + rBonus + (Math.floor(Math.random() * 10) + 1);
        if (affixRoll <= 8) {
            // 属性词缀 S1-S8 (简化: 根据PL生成一个属性提升)
            const statNames = ['\u529B\u91CF', '\u654F\u6377', '\u667A\u529B', '\u8010\u529B', '\u5168\u5C5E\u6027'];
            const picked = statNames[Math.floor(Math.random() * statNames.length)];
            const val = Math.max(1, Math.floor(PL / 10));
            affixCodes.push(generateAffixParams(`S${affixRoll}`, rarityEntry.name));
            affixNames.push(`${picked}+${val}`);
        } else {
            // 特殊效果 B1-B22
            const bCode = affixRoll - 8; // 1-22
            affixCodes.push(generateAffixParams(`B${bCode}`, rarityEntry.name));
            affixNames.push(`\u7279\u6B8A\u6548\u679C${bCode}`);
        }
    }

    // === Prefilled override (from card opening message / gain_skill attrs) ===
    let _baseATK = baseATK, _hitRate = hitRate, _critRate = critRate;
    let _apt = apt, _tpa = tpa, _mpCost = mpCost;
    let _coreCode = coreEntry.code, _affixCodes = affixCodes, _skillLevel = skillLevel;
    if (pf && typeof pf === 'object') {
        const clamp = (v, lo, hi, name) => {
            if (v == null) return v;
            if (v < lo) { log('generateSkill: ' + name + ' ' + v + ' 过低，钳制到 ' + lo, 'warn'); return lo; }
            if (v > hi) { log('generateSkill: ' + name + ' ' + v + ' 过高，钳制到 ' + hi, 'warn'); return hi; }
            return v;
        };
        if (pf.atk != null) _baseATK = clamp(pf.atk, 0, 9999, 'atk');
        if (pf.hit != null) _hitRate = clamp(pf.hit, 0, 100, 'hit');
        if (pf.crit != null) _critRate = clamp(pf.crit, 0, 100, 'crit');
        if (pf.apt != null) _apt = clamp(pf.apt, 1, 10, 'apt');
        if (pf.tpa != null) _tpa = clamp(pf.tpa, 1, 10, 'tpa');
        if (pf.mp_cost != null) _mpCost = clamp(pf.mp_cost, 0, 999, 'mp_cost');
        if (pf.wn) _coreCode = pf.wn;
        if (Array.isArray(pf.en) && pf.en.length > 0) _affixCodes = pf.en.slice();
        if (pf.skill_level != null) _skillLevel = clamp(pf.skill_level, 1, 100, 'skill_level');
        log('generateSkill: 使用预填数值 (prefilled)');
    }

    // 构造完整剑技记录，请求模型填充 name / description / effects_description
    const weaponType = context.weaponType || '单手直剑';
    const rarityEn = RARITY_TO_EN[rarityEntry.name] || 'common';
    const fullSkillJson = JSON.stringify({
        name: '',
        weapon_type: weaponType,
        rarity: rarityEn,
        category: (pf && pf.category) ? pf.category : 'sword_skill',
        combat: {
            atk: _baseATK,
            hit: _hitRate,
            crit: _critRate,
            apt: _apt,
            tpa: _tpa,
            mpCost: _mpCost,
        },
        effects: {
            wn: _coreCode,
            en: _affixCodes,
        },
        affix_names: affixNames,
        description: '',
        effects_description: '',
    }, null, 2);

    const namePrompt = `为SAO剑技生成名称和描述。

以下JSON中数值字段已由系统计算完成。请填充 "name"、"description" 和 "effects_description" 三个字段，保持其他字段不变，返回完整JSON对象。
- "name": 剑技名称，要有SAO风格（如「星爆气流斩」「音速冲击」等）
- "description": 1-2句技能描述（描述该剑技的动作或效果）
- "effects_description": 技能特效简述（如「对单体造成连续斩击」「范围横扫」）

输入JSON（name/description/effects_description 为空，请填充）:
${fullSkillJson}

要求: 只输出完整的JSON对象，不要包含markdown代码块标记或说明文字。`;

    const skill = {
        name: prefilledName || null,
        weapon_type: weaponType,
        skill_level: _skillLevel,
        rarity: rarityEn,
        base_damage: _baseATK,
        hit_rate: _hitRate,
        crit_rate: _critRate,
        mp_cost: _mpCost,
        hits: _apt,
        targets: _tpa,
        core_code: _coreCode || 'A1',
        affix_codes: _affixCodes,
        affix_names: affixNames,
        effects_description: '',
        description: prefilledDesc || '',
    };

    if (prefilledName) {
        // \u4E3BLLM\u5DF2\u63D0\u4F9B\u540D\u79F0\u548C\u63CF\u8FF0
        log('\u5251\u6280\u751F\u6210(\u4E3BLLM\u63D0\u4F9B\u540D\u79F0): ' + prefilledName);
    } else {
        // \u5B50LLM\u751F\u6210\u540D\u79F0\u548C\u63CF\u8FF0
        try {
            const result = await callModelFn('equipment', [
                { role: 'system', content: '\u4F60\u662FSAO\u5251\u6280\u547D\u540D\u5668\u3002\u6839\u636E\u8F93\u5165\u7684\u5251\u6280JSON\uFF0C\u586B\u5145name\u3001description\u548Ceffects_description\u5B57\u6BB5\u540E\u8FD4\u56DE\u5B8C\u6574JSON\u3002\u4E0D\u8981\u6539\u53D8\u5176\u4ED6\u5B57\u6BB5\u7684\u503C\uFF0C\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u975EJSON\u5185\u5BB9\u3002' },
                { role: 'user', content: namePrompt },
            ], 384, { jsonSchema: true });
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            const modelResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            skill.name = modelResult.name || '\u5251\u6280';
            skill.description = modelResult.description || '';
            skill.effects_description = modelResult.effects_description || '';
            if (!skill.description) skill.description = (weaponType || '\u5251\u6280') + '\uFF08\u672A\u547D\u540D\u63CF\u8FF0\uFF09';
        } catch (e) {
            log('\u5251\u6280\u547D\u540D\u751F\u6210\u5931\u8D25: ' + e.message, 'warn');
            skill.name = '\u5251\u6280';
            if (!skill.description) skill.description = (weaponType || '\u5251\u6280') + '\uFF08\u672A\u547D\u540D\u63CF\u8FF0\uFF09';
        }
    }

    // B2: \u5B57\u6BB5\u6620\u5C04 + \u76F4\u5199 skillStore
    try {
        const skillId = findOrCreateSkill({
            name: skill.name,
            rarity: skill.rarity,
            category: (pf && pf.category) ? pf.category : 'sword_skill',
            weapon_type: skill.weapon_type,
            combat: {
                atk: skill.base_damage,
                hit: skill.hit_rate,
                crit: skill.crit_rate,
                apt: skill.hits,
                tpa: skill.targets,
                mpCost: skill.mp_cost,
            },
            effects: {
                wn: skill.core_code,
                en: Array.isArray(skill.affix_codes) ? skill.affix_codes : [],
            },
            description: skill.description,
            source: 'specialist',
        });
        if (skillId) {
            skill.skill_id = skillId;
            await addPlayerSkill(skillId, skill.name, skillLevel, true);
            log('\u6280\u80FD\u5165Store: ' + skill.name + ' \u2192 ' + skillId);
        }
    } catch (e) {
        log('\u6280\u80FD\u76F4\u5199Store\u5931\u8D25(\u975E\u81F4\u547D): ' + e.message, 'warn');
    }
    log('\u5251\u6280\u751F\u6210\u5B8C\u6210: ' + skill.name);
    return skill;
}

/**
 * 根据消耗品类型和数值构造 effects 数组
 * @param {string} category - 消耗品类型
 * @param {number} value - 效果数值（已乘稀有度倍率）
 * @returns {Array} effects 数组
 */
function buildEffects(category, value) {
    const buffStats = ['str', 'agi', 'int', 'vit'];
    switch (category) {
        case 'hp_restore':
            return [{ type: 'restore', stat: 'hp', value, duration: 0 }];
        case 'mp_restore':
            return [{ type: 'restore', stat: 'mp', value, duration: 0 }];
        case 'full_restore':
            return [
                { type: 'restore', stat: 'hp', value, duration: 0 },
                { type: 'restore', stat: 'mp', value, duration: 0 },
            ];
        case 'buff': {
            const picked = buffStats[Math.floor(Math.random() * buffStats.length)];
            return [{ type: 'buff', stat: picked, value, duration: 3 }];
        }
        case 'cure':
            return [{ type: 'cure', stat: 'status', value: 1, duration: 0 }];
        default:
            return [{ type: 'restore', stat: 'hp', value, duration: 0 }];
    }
}

/**
 * 生成消耗品（骰子表 + LLM 命名模式）
 * @param {object} context - { playerLevel, floor, qty, prefilled }
 * @param {Function} callModelFn - 模型调用函数（prefilledName 存在时可选）
 * @param {string} [prefilledName] - 主LLM提供的名称（跳过子LLM命名）
 * @param {string} [prefilledDesc] - 主LLM提供的描述
 * @returns {Promise<object|null>} 消耗品对象
 */
export async function generateConsumable(context, callModelFn, prefilledName, prefilledDesc) {
    if (!callModelFn && !prefilledName) throw new Error('callModelFn is required (or provide prefilledName)');
    const settings = getSettings();
    if (!settings.enabled) return null;

    const itemLevel = context.playerLevel || context.floor || 1;
    const pf = context.prefilled;

    // 1) 掷类型 (1D20)
    let typeEntry = lookupRoll(CONSUMABLE_TYPE_TABLE, (Math.floor(Math.random() * 20) + 1));

    // 2) 掷稀有度 (1D20)
    let rarityEntry = lookupRoll(CONSUMABLE_RARITY_TABLE, (Math.floor(Math.random() * 20) + 1));

    // 3) 计算效果数值（基础值 × 稀有度倍率）
    const baseVal = typeEntry.baseValue(itemLevel);
    const finalValue = Math.floor(baseVal * rarityEntry.mult);

    // 4) 构造 effects
    let effects = buildEffects(typeEntry.category, finalValue);

    // === Prefilled override (from card opening message / gain_consumable attrs) ===
    if (pf && typeof pf === 'object') {
        if (pf.category) typeEntry = { category: pf.category, label: pf.category, baseValue: () => 0 };
        if (pf.rarity) {
            const r = String(pf.rarity);
            // CONSUMABLE_RARITY_TABLE uses English names (common/uncommon/rare/epic)
            rarityEntry = CONSUMABLE_RARITY_TABLE.find(e => r.toLowerCase() === e.name.toLowerCase())
                || CONSUMABLE_RARITY_TABLE.find(e => r === e.name)
                || rarityEntry;
        }
        if (Array.isArray(pf.effects) && pf.effects.length > 0) {
            effects = pf.effects.slice();
            // Clamp effect values
            for (const e of effects) {
                if (e.value != null) {
                    if (e.value < 0) { log('generateConsumable: effect value ' + e.value + ' 过低，钳制到 0', 'warn'); e.value = 0; }
                    if (e.value > 9999) { log('generateConsumable: effect value ' + e.value + ' 过高，钳制到 9999', 'warn'); e.value = 9999; }
                }
            }
        }
        log('generateConsumable: 使用预填数值 (prefilled)');
    }

    const consumable = {
        name: prefilledName || null,
        category: typeEntry.category,
        rarity: rarityEntry.name,
        item_level: itemLevel,
        effects,
        description: prefilledDesc || '',
        qty: context.qty || 1,
    };

    if (prefilledName) {
        // 主LLM已提供名称和描述，跳过子LLM调用
        log('消耗品生成(主LLM提供名称): ' + prefilledName);
    } else {
        // 5) LLM 生成名称+描述
        const effectDesc = effects.map(e => {
            if (e.type === 'restore') return `恢复${e.stat.toUpperCase()} ${e.value}`;
            if (e.type === 'buff') return `${e.stat.toUpperCase()} +${e.value} 持续${e.duration}回合`;
            if (e.type === 'cure') return '治愈状态异常';
            return '';
        }).join('，');

        const namePrompt = `为SAO消耗品生成名称和描述。

输出格式: 必须返回纯 JSON 对象，不要包含 markdown 代码块标记或任何说明文字。
JSON 必须包含以下字段:
- "name": 字符串，消耗品名称（如「治愈药水」「高级回复药」等）
- "description": 字符串，1-2句描述，中文

示例输出:
{"name": "初级治疗药水", "description": "瞬间恢复少量生命值的红色药水。"}

消耗品信息:
类型: ${typeEntry.label} (${typeEntry.category})
稀有度: ${rarityEntry.name}
物品等级: ${itemLevel}
效果: ${effectDesc}`;

        try {
            const result = await callModelFn('equipment', [
                { role: 'system', content: '你是SAO消耗品命名器。只输出JSON对象，格式为 {"name": "名称", "description": "描述"}，不要输出任何其他内容。' },
                { role: 'user', content: namePrompt },
            ], 256, { jsonSchema: true });
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            const nameDesc = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            consumable.name = nameDesc.name || typeEntry.label;
            consumable.description = nameDesc.description || '';
            if (!consumable.description) consumable.description = (typeEntry?.label || '药水') + '（未命名描述）';
        } catch (e) {
            log('消耗品命名生成失败: ' + e.message, 'warn');
            consumable.name = typeEntry.label;
            if (!consumable.description) consumable.description = (typeEntry?.label || '药水') + '（未命名描述）';
        }
    }

    // 6) 写入 consumableStore 定义库
    try {
        const consumableId = findOrCreateConsumable({ ...consumable, source: prefilledName ? 'specialist' : 'dice' });
        if (consumableId) {
            consumable.consumable_id = consumableId;
            // 7) 入背包
            await addConsumableItem(consumableId, context.qty || 1, true);
            log('消耗品入Store: ' + consumable.name + ' → ' + consumableId);
        }
    } catch (e) {
        log('消耗品直写Store失败(非致命): ' + e.message, 'warn');
    }

    log('消耗品生成完成: ' + consumable.name);
    return consumable;
}

/**
 * 生成战利品/物品（混合模式：JS骰子确定数值，LLM仅生成名称/描述）
 * @param {object} context - { enemyLevel, floor, enemyType }
 * @param {Function} callModelFn - 模型调用函数
 * @returns {Promise<object|null>} 物品对象或 null
 */
export async function generateLoot(context, callModelFn) {
    if (!callModelFn) throw new Error('callModelFn is required');
    const settings = getSettings();
    if (!settings.enabled) return null;

    const enemyLevel = context.enemyLevel || 1;

    // === JS dice for all numeric values ===
    // Drop chance: 30% + enemyLevel * 1%
    const dropChance = Math.min(0.8, 0.3 + enemyLevel * 0.01);
    if (Math.random() > dropChance) {
        return { loot: [], cor: 0, exp: 0 };
    }

    // Number of drops: 1D3
    const numDrops = (Math.floor(Math.random() * 3) + 1);

    // Cor: baseCor = enemyLevel * (10 + 1D20)
    const baseCor = enemyLevel * (10 + (Math.floor(Math.random() * 20) + 1));

    // Exp: baseExp = enemyLevel * (20 + 1D20)
    const baseExp = enemyLevel * (20 + (Math.floor(Math.random() * 20) + 1));

    // Generate loot items (JS dice for type/rarity, LLM for names)
    const lootItems = [];
    for (let i = 0; i < numDrops; i++) {
        const typeRoll = (Math.floor(Math.random() * 10) + 1);
        const typeEntry = LOOT_TYPE_TABLE.find(e => typeRoll >= e.roll[0] && typeRoll <= e.roll[1]) || LOOT_TYPE_TABLE[0];
        const rarityEntry = lookupRoll(EQUIP_RARITY_TABLE, (Math.floor(Math.random() * 20) + 1));

        if (typeEntry.type === '装备') {
            // Equipment drop — placeholder; actual equipment gen is separate (generateEquipment)
            lootItems.push({
                type: '装备',
                rarity: RARITY_TO_EN[rarityEntry.name] || 'common',
                name: '',
                description: '',
            });
        } else if (typeEntry.type === '消耗品') {
            // Consumable drop — use generateConsumable (full dice+LLM pipeline)
            const consumable = await generateConsumable({
                playerLevel: enemyLevel,
                floor: context.floor,
                qty: (Math.floor(Math.random() * 3) + 1),
            }, callModelFn);
            if (consumable) {
                lootItems.push({
                    type: '消耗品',
                    rarity: consumable.rarity,
                    name: consumable.name,
                    description: consumable.description,
                    qty: consumable.qty,
                    consumable_id: consumable.consumable_id,
                    effects: consumable.effects,
                });
            }
        } else {
            lootItems.push({
                type: typeEntry.type,
                rarity: RARITY_TO_EN[rarityEntry.name] || 'common',
                name: '',
                description: '',
                qty: (Math.floor(Math.random() * 3) + 1),
            });
        }
    }

    // === LLM for naming/description only (256 tokens) — skip items already named ===
    const unnamedItems = lootItems.filter(item => !item.name);
    if (unnamedItems.length > 0) {
        const namePrompt = `为SAO掉落物生成名称和描述。

输出格式: 必须返回纯 JSON 对象，不要包含 markdown 代码块标记或任何说明文字。
JSON 必须包含以下字段:
- "items": 数组，每个元素含 "name"(字符串) 和 "description"(字符串)

示例输出:
{"items": [{"name": "哥布林耳朵", "description": "一只沾满泥土的尖锐耳朵。"}, {"name": "破损的短刀", "description": "一把已经卷刃的旧短刀。"}]}

掉落物信息:
${unnamedItems.map((item, i) => `${i+1}. 类型:${item.type} 稀有度:${item.rarity}${item.qty ? ' 数量:'+item.qty : ''}`).join('\n')}
敌人等级: ${enemyLevel}
要求: 名称要有SAO风格，描述简短（20-50字）`;

        try {
            const result = await callModelFn('equipment', [
                { role: 'system', content: '你是SAO物品命名器。只输出JSON对象，格式为 {"items": [{"name": "名称", "description": "描述"}]}，不要输出任何其他内容。' },
                { role: 'user', content: namePrompt },
            ], 256, { jsonSchema: true });
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const nameDesc = JSON.parse(jsonMatch[0]);
                if (nameDesc.items) {
                    nameDesc.items.forEach((nd, i) => {
                        if (unnamedItems[i]) {
                            unnamedItems[i].name = nd.name || unnamedItems[i].type;
                            unnamedItems[i].description = nd.description || '';
                        }
                    });
                }
            }
        } catch (e) {
            log('物品命名失败，使用默认名称: ' + e.message, 'warn');
            // Fallback: use type as name
            unnamedItems.forEach(item => {
                if (!item.name) item.name = item.type + '·' + item.rarity;
            });
        }
    }

    log(`战利品生成完成: ${lootItems.length} 个物品, ${baseCor} 珂尔, ${baseExp} 经验`);
    return { loot: lootItems, cor: baseCor, exp: baseExp };
}