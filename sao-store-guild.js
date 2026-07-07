// sao-store-guild.js — 公会系统权威库
// 记录所有在游戏中出现的公会（不仅是玩家的）。
// 公会有发现机制——未发现的公会不会注入 LLM prompt 以避免剧透。
// Phase 2 of 3：公会系统依赖 buff 系统（Phase 1）。

import { getStore, saveStore } from './sao-store-core.js';
import { log } from './sao-core.js';
import { getPlayerStore } from './sao-store-player.js';
import { addPermanentBuff, removeBuff } from './sao-buff.js';

// ============================================================
// 预置公会（含发现条件）
// ============================================================

const PRESET_GUILDS = [
    {
        guild_id: 'flh',
        name: '风林火山',
        leader: '克莱因',
        members: ['克莱因'],
        headquarters: null,
        buff: { name: '风林火山之魂', effects: { vit: 10 }, description: '公会成员体力+10' },
        description: '克莱因组建的公会，以日本武士道精神为信条',
        discovered: false,
        discovered_date: null,
        discover_condition: '2022-11-07',
        disbanded: false,
    },
    {
        guild_id: 'mbc',
        name: '月夜黑猫团',
        leader: '启',
        members: ['启', '桐人'],
        headquarters: null,
        buff: { name: '月夜的庇护', effects: { str: 5 }, description: '公会成员攻击+5' },
        description: '桐人曾加入的小型公会，后全员阵亡',
        discovered: false,
        discovered_date: null,
        discover_condition: '2022-11-15',
        disbanded: false,
    },
    {
        guild_id: 'als',
        name: '艾恩葛朗特解放军',
        leader: '辛卡',
        members: ['辛卡', '由莉耶儿'],
        headquarters: null,
        buff: { name: '解放军的秩序', effects: { vit: 5 }, description: '公会成员体力+5' },
        description: 'SAO最大规模公会，由辛卡领导',
        discovered: false,
        discovered_date: null,
        discover_condition: '2022-12-01',
        disbanded: false,
    },
    {
        guild_id: 'kob',
        name: '血盟骑士团',
        leader: '希兹克利夫',
        members: ['希兹克利夫', '亚丝娜'],
        headquarters: { floor_id: 55, location: '格兰萨姆' },
        buff: { name: '血盟的纪律', effects: { vit: 10 }, description: '公会成员防御+10' },
        description: 'SAO最强攻略公会，由希兹克利夫创立',
        discovered: false,
        discovered_date: null,
        discover_condition: '2023-03-01',
        disbanded: false,
    },
    {
        guild_id: 'lc',
        name: '微笑棺木',
        leader: 'PoH',
        members: ['PoH'],
        headquarters: null,
        buff: null,
        description: 'SAO中的杀人公会，由PoH领导',
        discovered: false,
        discovered_date: null,
        discover_condition: '2022-11-21',
        disbanded: false,
        hostile: true,
    },
    {
        guild_id: 'dda',
        name: '圣龙联合',
        leader: null,
        members: [],
        headquarters: { floor_id: 56, location: '帕尼' },
        buff: null,
        description: '中型攻略公会',
        discovered: false,
        discovered_date: null,
        discover_condition: '2023-01-01',
        disbanded: false,
    },
];

// ============================================================
// 内部工具
// ============================================================

/**
 * 获取 guildStore 引用（惰性初始化）。
 * @returns {{ byId: Object, nameToId: Object }}
 */
export function getGuildStore() {
    const store = getStore();
    if (!store.guildStore) {
        store.guildStore = { byId: {}, nameToId: {} };
    }
    if (!store.guildStore.byId) store.guildStore.byId = {};
    if (!store.guildStore.nameToId) store.guildStore.nameToId = {};
    return store.guildStore;
}

// ============================================================
// 导出函数
// ============================================================

/**
 * 按 ID 获取公会条目。
 * @param {string} id
 * @returns {object|null}
 */
export function getGuildById(id) {
    const store = getGuildStore();
    return store.byId[id] || null;
}

/**
 * 按名称获取公会条目。
 * @param {string} name
 * @returns {object|null}
 */
export function getGuildByName(name) {
    const store = getGuildStore();
    const id = store.nameToId[name];
    return id ? (store.byId[id] || null) : null;
}

/**
 * 初始化预置公会（在 SAO 卡 CHAT_CHANGED 时调用）。
 * 幂等：已存在的公会不会被覆盖。
 * @returns {number} 新初始化的公会数量
 */
export function initPresetGuilds() {
    const store = getGuildStore();
    let count = 0;
    for (const preset of PRESET_GUILDS) {
        if (store.byId[preset.guild_id]) continue;
        store.byId[preset.guild_id] = { ...preset, members: [...preset.members] };
        store.nameToId[preset.name] = preset.guild_id;
        count++;
    }
    if (count > 0) log(`公会初始化: ${count} 个预置公会`);
    return count;
}

/**
 * 检查并发现公会（基于当前日期）。
 * @param {string} currentDate - YYYY-MM-DD 格式
 * @returns {number} 新发现的公会数量
 */
export function checkGuildDiscovery(currentDate) {
    const store = getGuildStore();
    let discovered = 0;
    for (const guild of Object.values(store.byId)) {
        if (guild.discovered) continue;
        if (!guild.discover_condition) continue;
        if (currentDate >= guild.discover_condition) {
            guild.discovered = true;
            guild.discovered_date = currentDate;
            discovered++;
            log(`公会发现: ${guild.name} (${currentDate})`);
        }
    }
    return discovered;
}

/**
 * 创建新公会（游戏过程中）。
 * @param {string} name - 公会名称
 * @param {string} [leader] - 会长名称
 * @param {object} [options] - 可选参数
 * @returns {string} 公会 ID
 */
export function createGuild(name, leader, options = {}) {
    const store = getGuildStore();
    if (store.nameToId[name]) {
        return store.nameToId[name];
    }
    const id = 'guild_' + Date.now();
    const guild = {
        guild_id: id,
        name,
        leader: leader || null,
        members: leader ? [leader] : [],
        headquarters: options.headquarters || null,
        buff: options.buff || null,
        description: options.description || '',
        discovered: true,
        discovered_date: null,
        discover_condition: null,
        disbanded: false,
    };
    store.byId[id] = guild;
    store.nameToId[name] = id;
    log(`公会创建: ${name} → ${id}`);
    return id;
}

/**
 * 发现一个公会（叙事提到时）。
 * @param {string} name - 公会名称
 * @returns {boolean} 是否成功（公会存在即成功）
 */
export function discoverGuild(name) {
    const store = getGuildStore();
    const id = store.nameToId[name];
    if (!id || !store.byId[id]) return false;
    if (store.byId[id].discovered) return true;
    store.byId[id].discovered = true;
    log(`公会发现: ${name}`);
    return true;
}

/**
 * 向公会添加成员。
 * @param {string} guildId
 * @param {string} memberName
 * @returns {boolean}
 */
export function addGuildMember(guildId, memberName) {
    const store = getGuildStore();
    const guild = store.byId[guildId];
    if (!guild) return false;
    if (!guild.members.includes(memberName)) {
        guild.members.push(memberName);
    }
    return true;
}

/**
 * 从公会移除成员。
 * @param {string} guildId
 * @param {string} memberName
 * @returns {boolean}
 */
export function removeGuildMember(guildId, memberName) {
    const store = getGuildStore();
    const guild = store.byId[guildId];
    if (!guild) return false;
    guild.members = guild.members.filter(m => m !== memberName);
    return true;
}

/**
 * 获取所有已发现且未解散的公会（用于注入/显示）。
 * @returns {object[]}
 */
export function getDiscoveredGuilds() {
    const store = getGuildStore();
    return Object.values(store.byId).filter(g => g.discovered && !g.disbanded);
}

/**
 * 获取玩家当前所在公会。
 * @returns {object|null}
 */
export function getPlayerGuild() {
    const store = getGuildStore();
    const player = getPlayerStore();
    if (!player || !player.guild_id) return null;
    return store.byId[player.guild_id] || null;
}

/**
 * 玩家加入公会（自动应用公会 buff）。
 * @param {string} guildName - 公会名称
 * @returns {boolean} 是否成功加入
 */
export function joinGuild(guildName) {
    const store = getGuildStore();
    const player = getPlayerStore();
    const guild = getGuildByName(guildName);
    if (!guild) return false;

    player.guild_id = guild.guild_id;
    addGuildMember(guild.guild_id, player.identity?.name || '{{user}}');

    // 应用公会 buff（如果存在）
    if (guild.buff) {
        addPermanentBuff(player, {
            id: 'guild_' + guild.guild_id,
            source: '公会：' + guild.name,
            name: guild.buff.name,
            effects: guild.buff.effects,
            description: guild.buff.description,
        });
    }
    return true;
}

/**
 * 玩家离开当前公会（移除公会 buff）。
 * @returns {boolean} 是否成功离开
 */
export function leaveGuild() {
    const player = getPlayerStore();
    const oldGuildId = player.guild_id;
    if (!oldGuildId) return false;

    player.guild_id = null;
    removeBuff(player, 'guild_' + oldGuildId);
    return true;
}
