// SAO Companion - 刀剑神域角色卡专用扩展
// 版本: 0.5.0 (全面修复 + UI重写 + 标签兼容 + 世界书切换 + 消息回滚 + per-chat存储)
// 功能: 多模型分工 + 记忆系统 + 章节管理 + 独立控制台

import { saveSettingsDebounced } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
import {
    RELATION_DIMENSIONS, RelationshipManager, TeammateManager,
    StateFormatter, MemoryManager, tokenize, bm25Search,
    tierToValue, valueToTier, deriveRelationTypes,
} from './memory.js';

// ============================================================
// 常量
// ============================================================

const MODULE_NAME = 'sao_companion';
// 5 个子代理角色：narrative 不干预主对话，用于 NPC 反应生成
// combat 兼管武器/技能/物品生成（因为涉及数值）
const ROLES = ['narrative', 'combat', 'extract', 'memory'];
const ROLE_LABELS = {
    narrative: '📝 叙事/NPC模型',
    combat: '⚔️ 数值与生成模型',
    extract: '📊 状态提取模型',
    memory: '🧠 记忆检索模型',
};
const ROLE_DESC = {
    narrative: 'NPC 反应生成、剧情分支生成（留空=不使用，主对话始终用酒馆主模型）',
    combat: '战斗结算 + 武器/装备/剑技/物品/经验生成（留空=用主模型）',
    extract: '从 AI 输出提取 HP/MP/物品等状态 JSON',
    memory: '记忆检索与摘要',
};

const SLOT_LABELS = {
    weapon: '武器', main_hand: '主手', off_hand: '副手',
    armor: '防具', body: '身体', helmet: '头盔', head: '头部',
    boots: '靴子', feet: '脚部', gloves: '手套', hands: '手部',
    shield: '盾牌', accessory: '饰品', ring: '戒指', necklace: '项链',
    cape: '披风', belt: '腰带',
};

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // 多模型 API 配置 (直接存储 endpoint/key/model)
    models: {
        narrative: { url: '', key: '', model: '' },
        combat:    { url: '', key: '', model: '' },
        extract:   { url: '', key: '', model: '' },
        memory:    { url: '', key: '', model: '' },
    },
    // 记忆系统
    memoryEnabled: true,
    memoryDepth: 4,
    maxMemories: 50,
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
        if (legacy && (legacy.state || legacy.episodic || legacy.relationships)) {
            meta[MODULE_NAME] = {
                state: legacy.state || null,
                episodic: legacy.episodic || legacy.memories || [],
                relationships: legacy.relationships || {},
                teammates: legacy.teammates || [],
                quests: legacy.quests || [],
                arc: legacy.arc || 'sao',
                _migrated: true,
            };
            log('从角色卡迁移 v1 数据到 chatMetadata');
        } else {
            meta[MODULE_NAME] = {
                state: null, episodic: [], relationships: {},
                teammates: [], quests: [], arc: 'sao',
            };
        }
    }
    const d = meta[MODULE_NAME];
    // 兼容旧字段
    if (!d.episodic) d.episodic = d.memories || [];
    if (!d.relationships) d.relationships = {};
    if (!d.teammates) d.teammates = [];
    if (!d.quests) d.quests = [];
    delete d.memories;
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
 * @param {string} role - narrative|combat|extract|memory
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
 * @param {string} role - narrative|combat|extract|memory
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
// M8: 多任务提取器（一次提取状态+关系 tier 变化+队友变化）
// ============================================================

/**
 * 一次调用 extract 子代理，提取三类数据：
 * 1. 游戏状态 (HP/MP/属性/物品/技能/位置)
 * 2. 关系 tier 变化 (NPC 名+维度+tier+原因)
 * 3. 队友变化 (加入/离开/状态更新)
 */
async function extractAll(aiMessage) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const tierExamples = Object.entries(RELATION_DIMENSIONS).map(([dim, config]) =>
        `${config.label}: ${config.tiers.join('/')}`
    ).join('\n');

    const systemPrompt = `你是 SAO 游戏状态提取器。分析 AI 的输出文本，提取三类信息，只输出 JSON。`;
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
  },
  "relationship_changes": [
    {"npc": "NPC名字", "dimension": "trust|affection|respect|fear|familiarity", "tier": "档位文本", "reason": "原因"}
  ],
  "teammate_changes": [
    {"action": "join|leave|update|dead", "name": "队友名", "hp": number, "max_hp": number, "mp": number, "weapon_type": string, "level": number}
  ]
}

关系维度和档位：
${tierExamples}

规则：
- 关系 tier 必须是上面列出的档位之一
- 如果某字段无法确定，用 null
- 如果没有关系变化，relationship_changes 为空数组 []
- 如果没有队友变化，teammate_changes 为空数组 []
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
        log('多任务提取完成');
        return extracted;
    } catch (e) {
        log('多任务提取失败: ' + e.message, 'error');
        return null;
    }
}

/**
 * 应用提取结果到数据
 */
async function applyExtractedData(extracted) {
    if (!extracted) return;
    const data = getSaoData();
    if (!data) return;
    const settings = getSettings();

    // 1. 更新状态
    if (extracted.state) {
        data.state = { ...data.state, ...extracted.state };
        log('状态已更新');
    }

    // 2. 更新关系 tier
    if (extracted.relationship_changes && extracted.relationship_changes.length > 0) {
        for (const change of extracted.relationship_changes) {
            if (!change.npc || !change.dimension || !change.tier) continue;
            RelationshipManager.setTier(data, change.npc, change.dimension, change.tier, change.reason || '');
            log(`关系更新: ${change.npc} ${change.dimension}=${change.tier}`);
        }
    }

    // 3. 更新队友
    if (extracted.teammate_changes && extracted.teammate_changes.length > 0) {
        for (const change of extracted.teammate_changes) {
            if (!change.name || !change.action) continue;
            switch (change.action) {
                case 'join':
                    TeammateManager.add(data, change.name, {
                        hp: change.hp, max_hp: change.max_hp, mp: change.mp,
                        weapon_type: change.weapon_type, level: change.level,
                    });
                    log(`队友加入: ${change.name}`);
                    break;
                case 'leave':
                    TeammateManager.remove(data, change.name, 'left');
                    log(`队友离开: ${change.name}`);
                    break;
                case 'dead':
                    TeammateManager.remove(data, change.name, 'dead');
                    log(`队友死亡: ${change.name}`);
                    break;
                case 'update':
                    TeammateManager.update(data, change.name, {
                        hp: change.hp, max_hp: change.max_hp, mp: change.mp,
                        weapon_type: change.weapon_type, level: change.level,
                    });
                    log(`队友更新: ${change.name}`);
                    break;
            }
        }
    }

    // 持久化
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

    const systemPrompt = '你是 SAO 战斗数值判定器。根据玩家状态、敌人状态和行动，计算战斗结果。只输出 JSON。';
    const formulas = `伤害公式: 命中率=基础+AGI*0.01-敌人闪避(AGI*0.005); 伤害加成=STR*0.01; 承伤率=50/(50+VIT); 基础伤害=剑技基础*(1+伤害加成)*承伤率; 暴击率=基础+INT*0.01; 暴击倍率=1.5+INT*0.01; 最终伤害=基础*(暴击?倍率:1)-减伤(STR*1)`;
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
 * 生成武器/装备
 * @param {object} context - { playerLevel, floor, type, rarity }
 * @returns {Promise<object|null>} 装备对象
 */
async function generateEquipment(context) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const systemPrompt = '你是 SAO 装备生成器。根据等级、楼层、类型、稀有度生成一件装备。只输出 JSON。';
    const userPrompt = `生成一件装备，返回 JSON:
{"name":string,"type":string,"rarity":string,"item_level":number,
 "stats":{"max_hp":number,"str":number,"agi":number,"int":number,"vit":number},
 "affixes":[string],"description":string}
玩家等级: ${context.playerLevel}
楼层: ${context.floor}
类型: ${context.type || '随机'}
稀有度: ${context.rarity || '随机(绿/蓝/紫/橙)'}`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 512);
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) { log('装备生成完成'); return JSON.parse(jsonMatch[0]); }
        return null;
    } catch (e) { log('装备生成失败: ' + e.message, 'error'); return null; }
}

/**
 * 生成剑技
 * @param {object} context - { weaponType, skillLevel, playerLevel }
 * @returns {Promise<object|null>} 剑技对象
 */
async function generateSkill(context) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const systemPrompt = '你是 SAO 剑技生成器。根据武器类型和技能等级生成一个剑技。只输出 JSON。';
    const userPrompt = `生成一个剑技，返回 JSON:
{"name":string,"weapon_type":string,"skill_level":number,"rarity":string,
 "base_damage":number,"hit_rate":number,"crit_rate":number,
 "mp_cost":number,"cooldown":number,"hits":number,
 "effects":[string],"description":string}
武器类型: ${context.weaponType || '单手直剑'}
技能等级: ${context.skillLevel || 1}
玩家等级: ${context.playerLevel || 1}`;

    try {
        const result = await callModel('combat', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 512);
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) { log('剑技生成完成'); return JSON.parse(jsonMatch[0]); }
        return null;
    } catch (e) { log('剑技生成失败: ' + e.message, 'error'); return null; }
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
// 记忆系统
// ============================================================

async function saveState(state) {
    const data = getSaoData();
    if (!data || !state) return;
    data.state = { ...data.state, ...state };
    data.arc = state.arc || data.arc || 'sao';
    await saveSaoDataNow();
    log('状态已保存');
}

async function addMemory(content, type = 'event') {
    const settings = getSettings();
    const data = getSaoData();
    if (!data) return;
    // 用 MemoryManager 添加（含关键词总结+代词消解）
    const npcNames = RelationshipManager.getAllNpcNames(data);
    const speaker = npcNames.length > 0 ? npcNames[0] : '';
    MemoryManager.add(data, content, type, {
        maxMemories: settings.maxMemories,
        speaker,
    });
    await saveSaoDataNow();
    log('记忆已添加: ' + type);
}

// ============================================================
// M9: 分层注入（Core Blocks + Working Memory + BM25 检索 + 上一轮恒定注入）
// ============================================================

/**
 * 获取当前用户消息（用于检索查询）
 */
function getCurrentUserMessage() {
    const ctx = getContext();
    const chat = ctx.chat;
    if (!chat || chat.length === 0) return '';
    // 找最后一条用户消息
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].is_user) return chat[i].mes || '';
    }
    return '';
}

function injectMemoryAndState() {
    const ctx = getContext();
    const settings = getSettings();
    if (!settings.enabled || !isSaoCard()) return;

    const data = getSaoData();
    if (!data) return;
    const parts = [];

    // === L0: Core Blocks（常驻，紧凑格式）===
    const compactState = StateFormatter.formatCompactState(data.state, data);
    if (compactState) {
        parts.push(compactState);
    }

    // === L1: Working Memory - 上一轮 AI 回复摘要（恒定注入）===
    const lastSummary = MemoryManager.getLastSummary(data);
    if (lastSummary) {
        parts.push(`[上一轮]${lastSummary}`);
    }

    // === L2: BM25 检索相关记忆（<10ms）===
    if (settings.memoryEnabled && data.episodic && data.episodic.length > 1) {
        const userMsg = getCurrentUserMessage();
        if (userMsg) {
            const results = MemoryManager.search(data, userMsg, 3);
            if (results.length > 0) {
                // 过滤掉上一轮摘要（已恒定注入）
                const filtered = results.filter(r => r.content !== lastSummary);
                if (filtered.length > 0) {
                    parts.push(`[相关记忆]\n${MemoryManager.formatSearchResults(filtered)}`);
                }
            }
        }
    }

    // === 当前章节 ===
    parts.push(`[章节]${settings.currentArc}`);

    if (parts.length > 0) {
        ctx.setExtensionPrompt('sao_companion_inject', parts.join('\n'), 1, settings.memoryDepth, false, 0);
    }
}

async function extractMemoryFromMessage(message, messageId) {
    const settings = getSettings();
    if (!settings.memoryEnabled) return null;

    const data = getSaoData();
    if (!data) return null;

    // 从 digest 标签提取（无需调用模型）
    const digestMatch = message.match(/<digest>([\s\S]*?)<\/digest>/);
    if (digestMatch) {
        const content = digestMatch[1].trim();
        // 代词消解：获取上下文 NPC 名字
        const npcNames = RelationshipManager.getAllNpcNames(data);
        const speaker = npcNames.length > 0 ? npcNames[0] : '';
        MemoryManager.add(data, content, 'event', {
            maxMemories: settings.maxMemories,
            tags: ['digest'],
            speaker,
            messageId,
        });
        // 持久化
        await saveSaoDataNow();
        log('记忆已添加(digest)');
        return content;
    }

    // 用记忆模型提取
    try {
        const result = await callModel('memory', [
            { role: 'system', content: '你是 SAO 记忆提取器。从 AI 输出中提取一个关键事件摘要（一句话），如果没有重要事件返回 "NONE"。' },
            { role: 'user', content: message.substring(0, 4000) },
        ], 128);
        if (result.trim() !== 'NONE') {
            const content = result.trim();
            const npcNames = RelationshipManager.getAllNpcNames(data);
            const speaker = npcNames.length > 0 ? npcNames[0] : '';
            MemoryManager.add(data, content, 'event', {
                maxMemories: settings.maxMemories,
                speaker,
                messageId,
            });
            await saveSaoDataNow();
            log('记忆已添加(模型提取)');
            return content;
        }
    } catch (e) {
        log('记忆提取失败: ' + e.message, 'warn');
    }
    return null;
}

// ============================================================
// 标签扫描与即时填充
// ============================================================

/**
 * 扫描 <equip> <swordskill> 标签，调用子代理填充数值
 * 兼容两种格式：
 * 1. JSON 格式：`<equip>{"name":"铁剑",...}</equip>`
 * 2. 纯文本格式：`<equip>...名称：铁剑...类型：武器...稀有度：蓝色...物品等级：5...</equip>`
 */
async function fillGenTags(messageId, text) {
    const ctx = getContext();
    let modified = false;

    // === <equip> 标签处理 ===
    // 匹配 <equip> 内的任意内容（非贪婪）
    const equipRegex = /<equip>([\s\S]*?)<\/equip>/g;
    const equipMatches = [...text.matchAll(equipRegex)];
    if (equipMatches.length > 0) {
        log(`检测到 ${equipMatches.length} 个 <equip> 标签`);
        const equipResults = await Promise.allSettled(
            equipMatches.map(m => {
                const content = m[1].trim();
                let basic = {};
                // 尝试 JSON 格式
                try {
                    basic = JSON.parse(content);
                } catch {
                    // 纯文本格式：用正则提取基本信息
                    const nameMatch = content.match(/名称[：:]\s*<font[^>]*>([^<]+)<\/font>/i) || content.match(/名称[：:]\s*(\S+)/i);
                    const typeMatch = content.match(/类型[：:]\s*(\S+)/i);
                    const rarityMatch = content.match(/稀有度[：:]\s*<font[^>]*>([^<]+)<\/font>/i) || content.match(/稀有度[：:]\s*(\S+)/i);
                    const levelMatch = content.match(/物品等级[：:]\s*(\d+)/i) || content.match(/等级[：:]\s*(\d+)/i);
                    if (nameMatch) basic.name = nameMatch[1].trim();
                    if (typeMatch) basic.type = typeMatch[1].trim();
                    if (rarityMatch) basic.rarity = rarityMatch[1].trim();
                    if (levelMatch) basic.item_level = parseInt(levelMatch[1]);
                }
                return generateEquipment({
                    playerLevel: getSaoData()?.state?.level || 1,
                    floor: getSaoData()?.state?.floor || 1,
                    type: basic.type,
                    rarity: basic.rarity,
                    name: basic.name,
                }).then(result => ({ result, originalMatch: m, basic }));
            })
        );
        equipResults.forEach((r) => {
            if (r.status === 'fulfilled' && r.value?.result) {
                const { result, originalMatch, basic } = r.value;
                const origContent = originalMatch[1].trim();
                let isJson = false;
                try { JSON.parse(origContent); isJson = true; } catch {}

                if (isJson) {
                    // JSON 格式：合并数值
                    const fullData = { ...basic, ...result };
                    const newTag = `<equip>${JSON.stringify(fullData)}</equip>`;
                    text = text.replace(originalMatch[0], newTag);
                } else {
                    // 纯文本格式：追加 <sao_data> JSON 块，保留原始内容
                    const saoData = JSON.stringify(result);
                    const newTag = `<equip>${origContent}\n<sao_data>${saoData}</sao_data></equip>`;
                    text = text.replace(originalMatch[0], newTag);
                }
                modified = true;
                log(`装备填充完成: ${result.name}`);
            }
        });
    }

    // === <swordskill> 标签处理 ===
    const skillRegex = /<swordskill>([\s\S]*?)<\/swordskill>/g;
    const skillMatches = [...text.matchAll(skillRegex)];
    if (skillMatches.length > 0) {
        log(`检测到 ${skillMatches.length} 个 <swordskill> 标签`);
        const skillResults = await Promise.allSettled(
            skillMatches.map(m => {
                const content = m[1].trim();
                let basic = {};
                try {
                    basic = JSON.parse(content);
                } catch {
                    const nameMatch = content.match(/名称[：:]\s*<font[^>]*>([^<]+)<\/font>/i) || content.match(/名称[：:]\s*(\S+)/i);
                    const typeMatch = content.match(/武器类型[：:]\s*(\S+)/i) || content.match(/类型[：:]\s*(\S+)/i);
                    const levelMatch = content.match(/技能等级[：:]\s*(\d+)/i) || content.match(/等级[：:]\s*(\d+)/i);
                    if (nameMatch) basic.name = nameMatch[1].trim();
                    if (typeMatch) basic.weapon_type = typeMatch[1].trim();
                    if (levelMatch) basic.skill_level = parseInt(levelMatch[1]);
                }
                return generateSkill({
                    weaponType: basic.weapon_type || '单手直剑',
                    skillLevel: basic.skill_level || 1,
                    playerLevel: getSaoData()?.state?.level || 1,
                }).then(result => ({ result, originalMatch: m, basic }));
            })
        );
        skillResults.forEach((r) => {
            if (r.status === 'fulfilled' && r.value?.result) {
                const { result, originalMatch, basic } = r.value;
                const origContent = originalMatch[1].trim();
                let isJson = false;
                try { JSON.parse(origContent); isJson = true; } catch {}

                if (isJson) {
                    const fullData = { ...basic, ...result };
                    const newTag = `<swordskill>${JSON.stringify(fullData)}</swordskill>`;
                    text = text.replace(originalMatch[0], newTag);
                } else {
                    const saoData = JSON.stringify(result);
                    const newTag = `<swordskill>${origContent}\n<sao_data>${saoData}</sao_data></swordskill>`;
                    text = text.replace(originalMatch[0], newTag);
                }
                modified = true;
                log(`剑技填充完成: ${result.name}`);
            }
        });
    }

    // 如果有修改，更新消息
    if (modified) {
        const msg = ctx.chat?.[messageId];
        if (msg) {
            msg.mes = text;
            log(`消息 #${messageId} 标签填充完成`);
        }
    }
}

/**
 * 检测 <zd_status> 含战斗场景，调用战斗结算
 */
async function processCombatIfNeeded(messageId, text) {
    // 检查是否有战斗场景标记
    const zdMatch = text.match(/<zd_status>([\s\S]*?)<\/zd_status>/);
    if (!zdMatch) return;

    // 检查是否包含"战斗"关键词或敌人数据
    const combatKeywords = ['敌人', '怪物', '战斗', '攻击', 'HP:', '敌方'];
    const hasCombat = combatKeywords.some(k => zdMatch[1].includes(k));
    if (!hasCombat) return;

    log('检测到战斗场景，调用战斗结算');
    const state = getSaoData()?.state;
    if (!state) return;

    // 简单战斗结算（实际参数需要更复杂的解析）
    try {
        const result = await calculateCombat({
            player: { hp: state.hp, max_hp: state.max_hp, str: state.str, agi: state.agi, int: state.int, vit: state.vit },
            enemy: { name: '敌人', hp: 100, max_hp: 100, str: 5, agi: 3, int: 1, vit: 3 },
            action: text.match(/攻击(.+?)(?:。|$)/)?.[1] || '普通攻击',
        });
        if (result) {
            log(`战斗结算完成: 伤害=${result.damage} 暴击=${result.is_crit}`);
            // TODO: 将战斗结果注入到 zd_status 中
        }
    } catch (e) {
        log('战斗结算失败: ' + e.message, 'warn');
    }
}

/**
 * 检测敌人击败，生成战利品
 */
async function processLootIfNeeded(messageId, text) {
    // 检查是否有"击败"/"掉落"等关键词
    const lootKeywords = ['击败了', '化为了碎片', '获得经验', '掉落', '战利品'];
    const hasLoot = lootKeywords.some(k => text.includes(k));
    if (!hasLoot) return;

    log('检测到战利品场景');
    const state = getSaoData()?.state;
    if (!state) return;

    try {
        const result = await generateLoot({
            enemyLevel: state.level || 1,
            floor: state.floor || 1,
            enemyType: text.match(/击败了(.+?)(?:。|，)/)?.[1] || '怪物',
        });
        if (result && result.loot && result.loot.length > 0) {
            log(`战利品生成完成: ${result.loot.length} 件物品 + ${result.cor} Cor`);
            // TODO: 将战利品注入到消息中
        }
    } catch (e) {
        log('战利品生成失败: ' + e.message, 'warn');
    }
}


// ============================================================
// SAO 卡兼容模式（替代 TavernHelper 脚本）
// ============================================================

/**
 * 启用 SAO 卡兼容模式
 * 1. 关闭不兼容的酒馆设置
 * 2. 启用角色卡局部正则
 */
function enableCompatMode() {
    const settings = getSettings();
    if (!settings.compatMode) return;

    // === 1. 关闭不兼容设置 ===
    try {
        const power_user = window.power_user;
        if (power_user) {
            // 保存原始值（持久化到 extension_settings，防止切卡丢失）
            if (!settings._savedPowerUser) {
                settings._savedPowerUser = {
                    auto_fix_generated_markdown: power_user.auto_fix_generated_markdown,
                    encode_tags: power_user.encode_tags,
                    trim_sentences: power_user.trim_sentences,
                    forbid_external_media: power_user.forbid_external_media,
                };
            }

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

// 白名单：插件应管理的正则脚本（排除4个不应自动启用的脚本）
const REGEX_WHITELIST = new Set([
    '摘要', '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗',
    '隐藏状态栏', '隐藏地图', '隐藏骰子', '隐藏npc思维链',
    '隐藏公会状态栏', '隐藏回复', '隐藏预告',
    '剑技栏', '装备栏', '角色状态栏', '公会状态栏',
    '日期', '快速回复', '地图2', '开场白', '战斗1.30电脑',
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
                settings._savedRegexState.push({ scriptName: s.scriptName, disabled: true });
                s.disabled = false;
                enabled++;
            } else if (s.disabled === true) {
                log(`跳过正则脚本（不在白名单）: ${s.scriptName}`, 'info');
            }
        });

        if (enabled > 0) {
            log(`已启用 ${enabled} 个角色卡正则脚本（共 ${scripts.length} 个）`);
            saveSettings();
        }
    } catch (e) {
        log('启用正则脚本失败: ' + e.message, 'warn');
    }
}


function bindEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (isSaoCard()) {
            log('聊天切换，加载 per-chat 数据');
            enableCompatMode();
            injectMemoryAndState();
            // 刷新面板（如果已打开）
            if (document.getElementById('sao_panel_overlay')?.style.display === 'block') {
                refreshStatus();
                refreshMemoryList();
            }
        } else {
            // 切出 SAO 卡，恢复设置
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

        // 如果是 swipe，先回滚该消息的旧记忆
        if (type === 'swipe') {
            const data = getSaoData();
            if (data) {
                const removed = MemoryManager.rollbackByMessageId(data, messageId);
                if (removed > 0) log(`swipe 回滚 ${removed} 条旧记忆 (消息 #${messageId})`);
            }
        }

        const rawText = message.mes;
        log(`处理消息 #${messageId} (${rawText.length} 字符)`);

        // === 使用 per-message 锁串行执行，防止并发竞争 ===
        await withProcessingLock(`msg-${messageId}`, async () => {
            // 1. 标签填充：扫描 <equip> <swordskill> 标签，调用子代理填充数值
            // fillGenTags 只修改 msg.mes（非共享数据），先执行
            await fillGenTags(messageId, rawText);

            // 2. 战斗结算：检测 <zd_status> 含战斗场景
            await processCombatIfNeeded(messageId, rawText);

            // 3. 战利品生成：检测敌人击败
            await processLootIfNeeded(messageId, rawText);

            // 4. 多任务提取（状态+关系 tier+队友变化）— 修改共享数据，串行
            const extracted = await extractAll(rawText);
            if (extracted) await applyExtractedData(extracted);

            // 5. 记忆提取（含关键词总结+代词消解）— 修改共享数据，串行
            await extractMemoryFromMessage(rawText, messageId);

            // 6. 关系衰减检查（同步，安全）
            const decayData = getSaoData();
            if (decayData) RelationshipManager.applyDecay(decayData);
        });

        // 更新消息显示
        const updatedMsg = ctx.chat?.[messageId];
        if (updatedMsg && updatedMsg.mes !== rawText) {
            // 消息内容被修改了，触发重新渲染
            log('消息已更新，触发重新渲染');
            // 用 ST 的 updateMessageBlock 重新渲染
            if (ctx.updateMessageBlock) {
                ctx.updateMessageBlock(messageId, updatedMsg);
            }
        }
    }));

    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
        if (!isSaoCard()) return;
        injectMemoryAndState();
    });

    // B3: 监听消息重新生成（swipe），回滚对应记忆
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, wrapAsync(async (messageId) => {
            if (!isSaoCard()) return;
            const data = getSaoData();
            if (!data) return;
            const removed = MemoryManager.rollbackByMessageId(data, messageId);
            if (removed > 0) {
                log(`回滚 ${removed} 条记忆 (消息 #${messageId} swipe)`);
                saveSaoData();
            }
        }));
    }

    // B3: 监听消息删除，GC 清理悬空记忆
    if (event_types.MESSAGE_DELETED) {
        eventSource.on(event_types.MESSAGE_DELETED, wrapAsync(async () => {
            if (!isSaoCard()) return;
            const data = getSaoData();
            if (!data) return;
            const ctx = getContext();
            const existingIds = new Set((ctx.chat || []).map((m, i) => i));
            const removed = MemoryManager.gc(data, existingIds);
            if (removed > 0) {
                log(`GC 清理 ${removed} 条悬空记忆（消息删除）`);
                saveSaoData();
            }
        }));
    }

    log('事件绑定完成');
}

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
    if (item.type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">类型</span><span class="sao-detail-value">${esc(item.type)}</span></div>`)
    if (item.rarity) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">稀有度</span><span class="sao-detail-value ${rarityClass(item.rarity)}">${esc(item.rarity)}</span></div>`)
    if (item.item_level != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">物品等级</span><span class="sao-detail-value">${esc(item.item_level)}</span></div>`)
    if (item.stats) {
        for (const [k, v] of Object.entries(item.stats)) {
            if (v > 0) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">${esc(k.toUpperCase())}</span><span class="sao-detail-value">+${esc(v)}</span></div>`)
        }
    }
    if (item.affixes && item.affixes.length > 0) {
        const affixHtml = item.affixes.map(a => `<span class="sao-tag sao-tag-affix">${esc(a)}</span>`).join(' ')
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">附魔</span><span class="sao-detail-value">${affixHtml}</span></div>`)
    }
    if (item.description) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">描述</span><span class="sao-detail-value">${esc(item.description)}</span></div>`)
    return rows.join('')
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
    if (item.type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">类型</span><span class="sao-detail-value">${esc(item.type)}</span></div>`)
    if (item.rarity) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">稀有度</span><span class="sao-detail-value ${rarityClass(item.rarity)}">${esc(item.rarity)}</span></div>`)
    if (item.description) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">描述</span><span class="sao-detail-value">${esc(item.description)}</span></div>`)
    return rows.join('')
}

function renderTeammateDetail(t) {
    const statusMap = { active: '在队', inactive: '暂离', left: '已离队', dead: '已阵亡' }
    const rows = []
    if (t.status) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">状态</span><span class="sao-detail-value">${esc(statusMap[t.status] || t.status)}</span></div>`)
    if (t.level != null) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">等级</span><span class="sao-detail-value">Lv${esc(t.level)}</span></div>`)
    if (t.hp != null && t.max_hp != null) {
        const pct = t.max_hp > 0 ? Math.round(t.hp / t.max_hp * 100) : 0
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">HP</span><span class="sao-detail-value">${esc(t.hp)}/${esc(t.max_hp)} (${pct}%)</span></div>`)
    }
    if (t.mp != null && t.max_mp != null) {
        const pct = t.max_mp > 0 ? Math.round(t.mp / t.max_mp * 100) : 0
        rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">MP</span><span class="sao-detail-value">${esc(t.mp)}/${esc(t.max_mp)} (${pct}%)</span></div>`)
    }
    if (t.weapon) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">武器</span><span class="sao-detail-value">${esc(t.weapon)}</span></div>`)
    if (t.weapon_type) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">武器类型</span><span class="sao-detail-value">${esc(t.weapon_type)}</span></div>`)
    if (t.joined_at) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">入队时间</span><span class="sao-detail-value">${esc(t.joined_at?.substring(0, 10))}</span></div>`)
    if (t.left_at) rows.push(`<div class="sao-detail-row"><span class="sao-detail-label">离队时间</span><span class="sao-detail-value">${esc(t.left_at?.substring(0, 10))}</span></div>`)
    return rows.join('')
}

async function loadPanelHTML() {
    if (panelLoaded) return;
    // 加载 panel.html 到 DOM（使用 ST API 而非硬编码路径）
    const html = await renderExtensionTemplateAsync('third-party/sao-companion', 'panel');
    // 提取 <body> 内容和 <style>
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    const styleMatch = html.match(/<style[^>]*>([\s\S]*)<\/style>/);
    if (styleMatch) {
        const style = document.createElement('style');
        style.id = 'sao_panel_style';
        style.textContent = styleMatch[1];
        document.head.appendChild(style);
    }
    if (bodyMatch && bodyMatch[1]) {
        const div = document.createElement('div');
        div.innerHTML = bodyMatch[1];
        document.body.appendChild(div.firstElementChild);
    } else {
        log('panel.html body 提取失败', 'error');
    }
    panelLoaded = true;
}

function initPanelLogic() {
    // 章节 → 世界书条目切换
    window.switchWorldInfoEntries = async function switchWorldInfoEntries(arc) {
        try {
            const ctx = getContext();
            const char = getCurrentCharacter();
            if (!char?.data?.character_book?.entries) return;

            const entries = char.data.character_book.entries;
            const arcKeywords = {
                sao: ['sao', 'SAO', '艾恩葛朗特', 'Aincrad'],
                alo_old: ['旧alo', '旧ALO', '旧ALO篇'],
                alo_new: ['新生alo', '新生ALO', '新生ALO篇'],
                ggo: ['ggo', 'GGO', '幽灵子弹'],
                real: ['现实', '真实世界', '现实世界'],
            };
            const currentKeys = arcKeywords[arc] || [];

            entries.forEach(e => {
                if (e.constant) return; // 常驻条目不动
                if (!e.selective) return; // 非选择性条目不动
                const entryKeys = e.keys || [];
                const isCurrentArc = entryKeys.some(k =>
                    currentKeys.some(ck => k.toLowerCase().includes(ck.toLowerCase()))
                );
                // 有关键词的条目才控制启禁
                if (entryKeys.length > 0) {
                    e.enabled = isCurrentArc;
                }
            });

            // 保存世界书
            if (typeof ctx.saveWorldInfo === 'function') {
                // SillyTavern 新版 API
                const bookName = char.data.character_book.name || char.name;
                await ctx.saveWorldInfo(bookName, char.data.character_book, true);
            } else if (ctx.writeExtensionField) {
                // 回退：通过扩展字段保存
                await ctx.writeExtensionField(ctx.characterId, 'character_book', char.data.character_book);
            }
            log(`世界书条目已按章节 [${arc}] 切换`);
        } catch (e) {
            log('世界书切换失败: ' + e.message, 'warn');
        }
    };

    window.SaoPanel = {
        open() {
            const overlay = document.getElementById('sao_panel_overlay');
            if (!overlay) { log('面板未加载', 'error'); return; }
            overlay.style.display = 'block';
            loadSettingsToPanel();
            refreshMemoryList();
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
        saveMemory() {
            const settings = getSettings();
            settings.memoryEnabled = document.getElementById('sao_memory_enabled')?.checked ?? true;
            settings.memoryDepth = parseInt(document.getElementById('sao_memory_depth')?.value) || 4;
            settings.maxMemories = parseInt(document.getElementById('sao_max_memories')?.value) || 50;
            saveSettings();
            log('记忆设置已保存');
        },
        async clearMemories() {
            const data = getSaoData();
            if (data) {
                data.episodic = [];
                await saveSaoDataNow();
                log('记忆已清空');
                refreshMemoryList();
            }
        },
        async editMemory(memoryId) {
            const data = getSaoData();
            if (!data?.episodic) return;
            const m = data.episodic.find(x => x.id === memoryId);
            if (!m) return;
            const newContent = prompt('编辑记忆内容:', m.content);
            if (newContent !== null && newContent.trim()) {
                MemoryManager.update(data, memoryId, { content: newContent.trim() });
                await saveSaoDataNow();
                log('记忆已编辑');
                refreshMemoryList();
            }
        },
        async deleteMemory(memoryId) {
            if (!confirm('确定删除这条记忆？')) return;
            const data = getSaoData();
            if (!data?.episodic) return;
            MemoryManager.delete(data, memoryId);
            await saveSaoDataNow();
            log('记忆已删除');
            refreshMemoryList();
        },
        async addMemoryManual() {
            const content = prompt('输入记忆内容:');
            if (!content || !content.trim()) return;
            const type = prompt('记忆类型 (event/combat/trade/social):', 'event') || 'event';
            const data = getSaoData();
            if (!data) return;
            const settings = getSettings();
            const npcNames = RelationshipManager.getAllNpcNames(data);
            const speaker = npcNames.length > 0 ? npcNames[0] : '';
            MemoryManager.add(data, content.trim(), type, {
                maxMemories: settings.maxMemories,
                speaker,
            });
            await saveSaoDataNow();
            log('记忆已手动添加');
            refreshMemoryList();
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
            document.querySelectorAll('[data-content="chapter"] .sao-card').forEach(c => c.style.borderColor = '');
            document.querySelectorAll(`[data-content="chapter"] .sao-card`).forEach(c => {
                if (c.onclick && c.getAttribute('onclick')?.includes(`'${arc}'`)) {
                    c.style.borderColor = '#6c5ce7';
                }
            });
        },
        refreshStatus() {
            refreshStatus();
        },
        filterMemories(query) {
            const el = document.getElementById('sao_memory_list');
            if (!el) return;
            const data = getSaoData();
            if (!data?.episodic?.length) {
                el.innerHTML = '<div class="sao-memory-item" style="opacity:0.5;">暂无记忆</div>';
                return;
            }
            const q = (query || '').toLowerCase().trim();
            const filtered = q ? data.episodic.filter(m => (m.content || '').toLowerCase().includes(q)) : data.episodic;
            el.innerHTML = filtered.slice().reverse().map(m =>
                `<div class="sao-memory-item" data-mem-id="${esc(m.id)}"><div class="sao-memory-content"><div>${esc(m.content?.substring(0, 120))}</div><div class="sao-memory-meta">[${esc(m.type || 'event')}] ${esc(m.timestamp?.substring(0, 10))} #${esc(String(m.id).substring(0,6))}</div></div><div class="sao-memory-actions"><button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="edit">编辑</button><button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="delete">删除</button></div></div>`
            ).join('') || '<div class="sao-memory-item" style="opacity:0.5;">无匹配记忆</div>';
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

    // 绑定标签点击
    document.addEventListener('click', (e) => {
        if (e.target.classList?.contains('sao-tab')) {
            window.SaoPanel.switchTab(e.target.dataset.tab);
        }
    });

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
                    title = `${SLOT_LABELS[entry.slot] || entry.slot}: ${entry.item?.name || '未知'}`;
                    html = renderEquipmentDetail(entry.item || {});
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
                    title = `${sk.name || '技能'} Lv${sk.level || '?'}`;
                    html = renderSkillDetail(sk);
                }
                break;
            }
            case 'teammate': {
                const t = cached.teammates?.[index];
                if (t) {
                    title = t.name || '队友';
                    html = renderTeammateDetail(t);
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
    document.getElementById('sao_teammates_list')?.addEventListener('click', handleDetailClick);
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
    // 记忆设置
    const memEnabled = document.getElementById('sao_memory_enabled');
    const memDepth = document.getElementById('sao_memory_depth');
    const maxMem = document.getElementById('sao_max_memories');
    if (memEnabled) memEnabled.checked = settings.memoryEnabled;
    if (memDepth) memDepth.value = settings.memoryDepth;
    if (maxMem) maxMem.value = settings.maxMemories;
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

function refreshMemoryList() {
    const el = document.getElementById('sao_memory_list');
    if (!el) return;
    const data = getSaoData();
    if (!data?.episodic?.length) {
        el.innerHTML = '<div class="sao-memory-item" style="opacity:0.5;">暂无记忆</div>';
        return;
    }
    el.innerHTML = data.episodic.slice().reverse().map(m =>
        `<div class="sao-memory-item" data-mem-id="${esc(m.id)}"><div class="sao-memory-content"><div>${esc(m.content?.substring(0, 120))}</div><div class="sao-memory-meta">[${esc(m.type || 'event')}] ${esc(m.timestamp?.substring(0, 10))} #${esc(String(m.id).substring(0,6))}</div></div><div class="sao-memory-actions"><button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="edit">编辑</button><button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="delete">删除</button></div></div>`
    ).join('');
    refreshMemoryStats();
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
                    `<div class="sao-tag sao-tag-inv" data-detail-type="inv" data-detail-index="${i}" style="cursor:pointer;">${esc(item.name)} x${esc(item.qty)}</div>`
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
                    `<div class="sao-tag sao-tag-skill" data-detail-type="skill" data-detail-index="${i}" style="cursor:pointer;">${esc(sk.name)} Lv${esc(sk.level)}</div>`
                ).join('');
                window._saoCurrentData = window._saoCurrentData || {};
                window._saoCurrentData.skills = s.skills;
            } else {
                skillEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">空</span>';
                if (window._saoCurrentData) window._saoCurrentData.skills = [];
            }
        }
    }

    // 队友面板 - 显示名字+HP条+事件委托
    const teamEl = document.getElementById('sao_teammates_list');
    if (teamEl) {
        const teammates = TeammateManager.getAll(data).filter(t => t.status === 'active');
        if (teammates.length > 0) {
            teamEl.innerHTML = teammates.map((t, i) => {
                const hpPct = t.max_hp > 0 ? (t.hp / t.max_hp * 100) : 0;
                return `<div class="sao-teammate-card" data-detail-type="teammate" data-detail-index="${i}" style="cursor:pointer;"><div class="sao-teammate-name">${esc(t.name)}</div><div class="sao-bar-container"><div class="sao-bar sao-bar-hp" style="width:${hpPct}%"></div></div></div>`;
            }).join('');
            window._saoCurrentData = window._saoCurrentData || {};
            window._saoCurrentData.teammates = teammates;
        } else {
            teamEl.innerHTML = '<div class="sao-card" style="opacity:0.5;font-size:0.85em;">暂无队友</div>';
            if (window._saoCurrentData) window._saoCurrentData.teammates = [];
        }
    }

    // 当前章节高亮
    const arcEl = document.getElementById('sao_current_arc');
    if (arcEl) arcEl.textContent = settings.currentArc || 'sao';
    document.querySelectorAll('.sao-chapter-card').forEach(c => {
        c.classList.toggle('sao-chapter-active', c.dataset.arc === settings.currentArc);
    });

    // 关系图
    refreshRelationList();

    // 记忆统计
    refreshMemoryStats();
}

// ============================================================
// 扩展面板入口 (酒馆左侧设置)
// ============================================================

function refreshRelationList() {
    const el = document.getElementById('sao_relation_list');
    if (!el) return;
    const data = getSaoData();
    if (!data?.relationships || Object.keys(data.relationships).length === 0) {
        el.innerHTML = '<div class="sao-card" style="opacity:0.5;font-size:0.85em;">暂无关系数据</div>';
        return;
    }
    el.innerHTML = Object.entries(data.relationships).map(([name, rel]) => {
        const dims = Object.entries(RELATION_DIMENSIONS).map(([dim, config]) => {
            const val = rel.dimensions[dim] || 0;
            const tier = valueToTier(dim, val);
            const tierIdx = config.tiers.indexOf(tier);
            const pct = val; // 0-100
            return `<div class="sao-dim-row"><span class="sao-dim-label">${esc(config.label)}</span><div class="sao-dim-bar-wrap"><div class="sao-dim-bar sao-tier-${tierIdx}" style="width:${pct}%"></div></div><span class="sao-dim-tier">${esc(tier)}</span></div>`;
        }).join('');
        const types = (rel.relation_type || []).join(', ') || 'stranger';
        const history = (rel.history || []).slice(-3).reverse().map(h =>
            `<div style="font-size:0.75em;opacity:0.6;margin:2px 0;">${esc(h.timestamp?.substring(5,10))} ${esc(h.dimension)}: ${esc(h.old_tier)} → ${esc(h.tier || h.new_tier)} ${esc(h.reason)}</div>`
        ).join('');
        return `<div class="sao-relation-card"><div class="sao-relation-header"><span class="sao-relation-name">${esc(name)}</span><span class="sao-relation-type">${esc(types)}</span></div>${dims}${history ? '<div style="margin-top:6px;">' + history + '</div>' : ''}</div>`;
    }).join('');
}

function refreshMemoryStats() {
    const data = getSaoData();
    if (!data?.episodic) return;
    const mems = data.episodic;
    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setT('sao_mem_count', mems.length);
    setT('sao_mem_event', mems.filter(m => m.type === 'event').length);
    setT('sao_mem_combat', mems.filter(m => m.type === 'combat').length);
    setT('sao_mem_social', mems.filter(m => m.type === 'social' || m.type === 'trade').length);
}

async function loadSettingsPanel() {
    const settings = getSettings();
    const templateData = { ...settings };
    const html = await renderExtensionTemplateAsync('third-party/sao-companion', 'settings', templateData);
    $('#extensions_settings').append(html);

    // 绑定"打开控制台"按钮
    $('#sao_open_panel').on('click', async () => {
        await loadPanelHTML();
        if (!window.SaoPanel) initPanelLogic();
        window.SaoPanel.open();
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

    // 记忆列表按钮事件委托（避免 onclick 内联注入风险）
    document.getElementById('sao_memory_list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const item = btn.closest('[data-mem-id]');
        if (!item) return;
        const id = item.getAttribute('data-mem-id');
        const action = btn.getAttribute('data-action');
        if (action === 'edit' && window.SaoPanel?.editMemory) {
            window.SaoPanel.editMemory(id);
        } else if (action === 'delete' && window.SaoPanel?.deleteMemory) {
            window.SaoPanel.deleteMemory(id);
        }
    });

    log('设置面板已加载');
}

// ============================================================
// 初始化
// ============================================================

export function init() {
    console.log('[SAO Companion] v0.5.0 初始化中...');
    loadSettingsPanel();
    bindEvents();
    if (isSaoCard()) {
        log('检测到 SAO 角色卡，立即激活');
        injectMemoryAndState();
    }
    console.log('[SAO Companion] 初始化完成');
}
