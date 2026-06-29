// SAO Companion - 模型调用模块（Phase C 拆分）
// 从 index.js 拆出：模型配置常量 + OpenAI 兼容 API 调用（callModel/callSpecialist/callViaMainModel/fetchModelList）

import { getSettings, log, getContext } from './sao-core.js';

// 子代理角色：narrative 不干预主对话，用于 NPC 反应生成
// combat 兼管武器/技能/物品生成（因为涉及数值）
// extract 单条消息状态提取；calendar 跨轮次状态机（约定提取+完成标记，v2）
// specialist P2: 装饰面板（map/equipment/swordskill）共享档位，4 级回退
export const ROLES = ['narrative', 'combat', 'extract', 'calendar', 'specialist'];
export const ROLE_LABELS = {
    narrative: '📝 叙事/NPC模型',
    combat: '⚔️ 数值与生成模型',
    extract: '📊 状态提取模型',
    calendar: '📅 日历模型',
    specialist: '🧩 专家面板模型',
};

/**
 * 拉取模型列表
 * @param {string} role - narrative|combat|extract
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

export async function callModel(role, messages, maxTokens = 512, opts = {}) {
    const settings = getSettings();
    const cfg = settings.models[role];

    // 没有配置 API → 回退到酒馆主模型
    if (!cfg.url || !cfg.model) {
        log(`${ROLE_LABELS[role]} 未配置，回退到主模型`, 'warn');
        return await callViaMainModel(messages, maxTokens);
    }

    return _fetchOpenAICompat(ROLE_LABELS[role], cfg, messages, maxTokens, opts);
}

/**
 * 回退：使用酒馆主模型
 */
export async function callViaMainModel(messages, maxTokens) {
    const ctx = getContext();
    const quietPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    return await ctx.generateQuietPrompt({
        quietPrompt,
        skipWIAN: true,
        responseLength: maxTokens,
    });
}

/** 专家面板调用——4 级回退：专家专属档 → specialist 档 → extract 档 → 主模型。
 *  specialistRole = 'map'/'equipment'/'swordskill'/'status'/'quest' 等面板类型。
 *  专家专属档为可选：仅当 settings.models[specialistRole] 被显式配置时启用，
 *  否则跳过（DEFAULT_SETTINGS.models 不含这些键，getSettings 不会回填它们）。 */
export async function callSpecialist(specialistRole, messages, maxTokens = 512, opts = {}) {
    const settings = getSettings();
    const tryConfig = (cfg) => cfg && cfg.url && cfg.model;
    const label = (r) => ROLE_LABELS[r] || r;
    // 0. 专家专属档（per-panel）——可选，显式配置才生效
    if (specialistRole && settings.models[specialistRole] && tryConfig(settings.models[specialistRole])) {
        return _fetchOpenAICompat(label(specialistRole), settings.models[specialistRole], messages, maxTokens, opts);
    }
    // 1. specialist 档
    if (settings.models.specialist && tryConfig(settings.models.specialist)) {
        return _fetchOpenAICompat(label('specialist'), settings.models.specialist, messages, maxTokens, opts);
    }
    // 2. extract 档
    if (settings.models.extract && tryConfig(settings.models.extract)) {
        return _fetchOpenAICompat(label('extract'), settings.models.extract, messages, maxTokens, opts);
    }
    // 3. 主模型
    log(`专家面板 ${specialistRole} 未配置专用 API，回退主模型`, 'warn');
    return await callViaMainModel(messages, maxTokens);
}
