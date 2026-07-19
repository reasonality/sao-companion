// sao-store-guild.js — 公会系统权威库
// 记录所有在游戏中出现的公会（不仅是玩家的）。
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
        buff: null,
        description: '克莱因组建的公会，以日本武士道精神为信条',
    },
    {
        guild_id: 'mbc',
        name: '月夜黑猫团',
        leader: '启',
        members: ['启', '桐人'],
        headquarters: null,
        buff: null,
        description: '桐人曾加入的小型公会，后全员阵亡',
    },
    {
        guild_id: 'als',
        name: '艾恩葛朗特解放军',
        leader: '辛卡',
        members: ['辛卡', '由莉耶儿'],
        headquarters: null,
        buff: null,
        description: 'SAO最大规模公会，由辛卡领导',
    },
    {
        guild_id: 'kob',
        name: '血盟骑士团',
        leader: '希兹克利夫',
        members: ['希兹克利夫', '亚丝娜'],
        headquarters: { floor_id: 55, location: '格兰萨姆' },
        buff: null,
        description: 'SAO最强攻略公会，由希兹克利夫创立',
    },
    {
        guild_id: 'lc',
        name: '微笑棺木',
        leader: 'PoH',
        members: ['PoH'],
        headquarters: null,
        buff: null,
        description: 'SAO中的杀人公会，由PoH领导',
    },
    {
        guild_id: 'dda',
        name: '圣龙联合',
        leader: '（不明）',
        members: [],
        headquarters: { floor_id: 56, location: '帕尼' },
        buff: null,
        description: '中型攻略公会',
    },
];

// ============================================================
// 内部工具
// ============================================================

/**
 * 生成唯一公会 ID（计数器模式，避免 Date.now() 同毫秒冲突）。
 * 解析现有 guild_NNN 格式 ID，取最大值 +1。
 * @returns {string} guild_001 格式 ID
 */
function generateGuildId() {
    const store = getGuildStore();
    let maxNum = 0;
    for (const id of Object.keys(store.byId)) {
        const match = id.match(/^guild_(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    return 'guild_' + String(maxNum + 1).padStart(3, '0');
}

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

    // Required field validation
    if (!name || typeof name !== 'string' || name.length === 0) {
        log('createGuild: 必填字段 name 缺失', 'warn');
        return null;
    }
    if (!leader || typeof leader !== 'string' || leader.length === 0) {
        log('createGuild: 必填字段 leader 缺失（创建公会必须指定会长）', 'warn');
        return null;
    }
    if (!options.description || typeof options.description !== 'string' || options.description.length === 0) {
        log('createGuild: 必填字段 description 缺失', 'warn');
        return null;
    }

    // Conditional buff validation (if buff exists, all buff sub-fields required)
    if (options.buff) {
        const b = options.buff;
        if (!b.name || typeof b.name !== 'string' || b.name.length === 0) {
            log('createGuild: buff.name 缺失（buff 存在时必填）', 'warn');
            return null;
        }
        if (!b.effects || typeof b.effects !== 'object' || Object.keys(b.effects).length === 0) {
            log('createGuild: buff.effects 缺失或为空（buff 存在时必填）', 'warn');
            return null;
        }
        if (!Array.isArray(b.special_effects)) {
            log('createGuild: buff.special_effects 缺失（buff 存在时必填，可为空数组）', 'warn');
            return null;
        }
        if (!b.description || typeof b.description !== 'string' || b.description.length === 0) {
            log('createGuild: buff.description 缺失（buff 存在时必填）', 'warn');
            return null;
        }
    }

    const id = generateGuildId();
    const guild = {
        guild_id: id,
        name,
        leader,
        members: [leader],
        headquarters: options.headquarters ?? null,
        buff: options.buff ?? null,
        description: options.description,
    };
    store.byId[id] = guild;
    store.nameToId[name] = id;
    log(`公会创建: ${name} → ${id}`);
    return id;
}

/**
 * 获取所有公会（用于注入/显示）。
 * @returns {object[]}
 */
export function getAllGuilds() {
    return Object.values(getGuildStore().byId || {});
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
 * 注意：本函数不调用 saveStore()，由调用方负责保存（参考 processGainTags 的 gain_guild 处理）。
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
            source: 'guild',
            name: guild.buff.name,
            effects: guild.buff.effects,
            special_effects: guild.buff.special_effects || [],
            description: guild.buff.description || (guild.buff.name + '（公会buff）'),
        });
    }
    return true;
}

/**
 * 玩家离开当前公会（移除公会 buff）。
 * 注意：本函数不调用 saveStore()，由调用方负责保存（参考 processGainTags 的 gain_guild 处理）。
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
