// SAO Companion - 模型调用模块（Phase C 拆分）
// 从 index.js 拆出：模型配置常量 + OpenAI 兼容 API 调用（callModel/callSpecialist/callViaMainModel/fetchModelList）

import { getSettings, log, getContext } from './sao-core.js';

// 主档（UI 3 卡片，对应文档 3 类 LLM 角色）
export const ROLES = ['state', 'equipment', 'world'];
export const ROLE_LABELS = {
    state: '🧬 玩家/NPC状态模型',
    equipment: '⚔️ 装备/技能模型',
    world: '🌍 世界/日历/任务模型',
};

// 子角色覆盖（高级，可选；空则回退到所属主档）
export const SUB_ROLES = ['extract', 'status', 'swordskill', 'calendar', 'quest', 'map', 'worldStatus', 'npcBackground'];
export const SUB_ROLE_LABELS = {
    extract: '📊 状态提取',
    status: '📋 状态面板专家',
    swordskill: '🗡️ 剑技面板专家',
    calendar: '📅 日历',
    quest: '📜 任务',
    map: '🗺️ 地图面板专家',
    worldStatus: '🌍 世界状态专家',
    npcBackground: '🧑‍🤝‍🧑 NPC后台专家',
};

// 子角色 → 所属主档映射
const ROLE_PARENT = {
    extract: 'state', status: 'state', npcBackground: 'state',
    swordskill: 'equipment',
    calendar: 'world', quest: 'world', map: 'world', worldStatus: 'world',
};

// 所有 model keys（主档 + 子角色），供 saveModelsToSettings/loadSettingsToPanel 遍历
export const ALL_MODEL_KEYS = [...ROLES, ...SUB_ROLES];

/**
 * 拉取模型列表
 * @param {string} role - state|equipment|world 或子角色 key
 * @returns {Promise<string[]>} 模型 ID 列表
 */
export async function fetchModelList(role) {
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
 * @param {object} [opts] - {temperature, jsonSchema, prefill, timeoutMs}
 * @returns {Promise<string>}
 */
/**
 * 共享 OpenAI 兼容 API 调用（callModel 与 callSpecialist 复用）。
 * @param {string} label - 日志/错误中显示的角色名
 * @param {object} cfg - {url, key, model}
 */
async function _fetchOpenAICompat(label, cfg, messages, maxTokens, opts) {
    let baseUrl = cfg.url.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) baseUrl += '/v1';
    const url = `${baseUrl}/chat/completions`;
    log(`调用 ${label}: ${cfg.model}`);

    const body = {
        model: cfg.model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
        stream: false,
    };
    if (opts.prefill) body.messages.push({ role: 'assistant', content: opts.prefill });
    if (opts.jsonSchema) {
        const isOpenAICompatible = !cfg.url?.includes('ollama') && !cfg.model?.includes('claude');
        if (isOpenAICompatible) body.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`${label} 调用失败: HTTP ${resp.status} - ${errText.substring(0, 300)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    log(`${label} 调用成功 (${content.length} 字符)`);
    return content;
}

/**
 * 解析模型配置：角色专属 → parent 主档 → null。
 * @param {string} role - 主档 key 或子角色 key
 * @returns {{cfg: object, label: string} | null}
 */
function _resolveModelConfig(role) {
    const settings = getSettings();
    const tryConfig = (cfg) => cfg && cfg.url && cfg.model;
    const label = (r) => ROLE_LABELS[r] || SUB_ROLE_LABELS[r] || r;
    // 0. 角色专属配置（主档或子角色覆盖）
    if (settings.models[role] && tryConfig(settings.models[role])) {
        return { cfg: settings.models[role], label: label(role) };
    }
    // 1. parent 主档（仅子角色）
    const parent = ROLE_PARENT[role];
    if (parent && settings.models[parent] && tryConfig(settings.models[parent])) {
        return { cfg: settings.models[parent], label: label(parent) };
    }
    return null;
}

export async function callModel(role, messages, maxTokens = 512, opts = {}) {
    const resolved = _resolveModelConfig(role);
    if (resolved) return _fetchOpenAICompat(resolved.label, resolved.cfg, messages, maxTokens, opts);
    log(`${ROLE_LABELS[role] || SUB_ROLE_LABELS[role] || role} 未配置，回退到主模型`, 'warn');
    return await callViaMainModel(messages, maxTokens);
}

/**
 * 判断某角色（含子角色→主档回退）是否已配置可直接调用。
 * 与 callModel / callSpecialist 使用相同的 _resolveModelConfig 解析，
 * 避免预检查与实际调用逻辑不一致（曾导致 testGenerate 误报"未配置"）。
 * @param {string} role - 主档 key 或子角色 key
 * @returns {boolean}
 */
export function isModelConfigured(role) {
    return _resolveModelConfig(role) !== null;
}

/**
 * 回退：使用酒馆主模型
 */
async function callViaMainModel(messages, maxTokens) {
    const ctx = getContext();
    const quietPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    return await ctx.generateQuietPrompt({
        quietPrompt,
        skipWIAN: true,
        responseLength: maxTokens,
    });
}

/**
 * 专家面板调用——3 级回退：角色专属 → parent 主档 → 主模型。
 * specialistRole = 'status'/'map'/'equipment'/'swordskill'/'quest' 等面板类型。
 * 'equipment' 既是主档也是 specialistRole（装备面板专家直接用 equipment 主档）。
 */
export async function callSpecialist(specialistRole, messages, maxTokens = 512, opts = {}) {
    const resolved = _resolveModelConfig(specialistRole);
    if (resolved) return _fetchOpenAICompat(resolved.label, resolved.cfg, messages, maxTokens, opts);
    log(`专家面板 ${specialistRole} 未配置，回退主模型`, 'warn');
    return await callViaMainModel(messages, maxTokens);
}
