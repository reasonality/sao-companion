// SAO Companion - 刀剑神域角色卡专用扩展
// 版本: 0.5.0 (记忆系统已移除)
// 功能: 多模型分工 + 状态监控 + 章节管理 + 独立控制台

import { saveSettingsDebounced } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../events.js';
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
// M8: 多任务提取器（一次提取状态+关系 tier 变化+队友变化）
// ============================================================

/**
 * 提取游戏状态 (HP/MP/属性/物品/技能/位置)
 */
async function extractAll(aiMessage) {
    const settings = getSettings();
    if (!settings.enabled) return null;

    const systemPrompt = `你是 SAO 游戏状态提取器。分析 AI 的输出文本，提取游戏状态信息，只输出 JSON。`;
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

    // 更新状态
    if (extracted.state) {
        data.state = { ...data.state, ...extracted.state };
        log('状态已更新');
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

        const rawText = message.mes;
        log(`处理消息 #${messageId} (${rawText.length} 字符)`);

        // === 使用 per-message 锁串行执行，防止并发竞争 ===
        await withProcessingLock(`msg-${messageId}`, async () => {
            // 1. 标签填充：扫描 <equip> <swordskill> 标签，调用子代理填充数值
            await fillGenTags(messageId, rawText);

            // 2. 战斗结算：检测 <zd_status> 含战斗场景
            await processCombatIfNeeded(messageId, rawText);

            // 3. 战利品生成：检测敌人击败
            await processLootIfNeeded(messageId, rawText);

            // 4. 多任务提取（状态）— 修改共享数据，串行
            const extracted = await extractAll(rawText);
            if (extracted) await applyExtractedData(extracted);
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
    console.log('[SAO Companion] v0.5.0 初始化中...');
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
    if (isSaoCard()) {
        log('检测到 SAO 角色卡，立即激活');
        injectMemoryAndState();
    }
    console.log('[SAO Companion] 初始化完成');
}
