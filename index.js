// SAO Companion - 刀剑神域角色卡专用扩展
// 版本: 0.6.14 (用原卡模板替换自写美化)
// 功能: 多模型分工 + 状态监控 + 章节管理 + 独立控制台

import { renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    MODULE_NAME, logs,
    esc, getContext, getCurrentCharacter, isSaoCard,
    getSettings, saveSettings,
    getSaoData, saveSaoDataNow,
    log, updateLogDisplay,
} from './sao-core.js';
import {
    resolveAffixArgs,
    generateEquipment, generateSkill, generateLoot,
} from './sao-generators.js';
import { eventSource, event_types } from '../../../events.js';
import { power_user } from '../../../power-user.js';
import { renderBattlePanel, updateBattlePanelAfterCombat, clearBattleHostRegistry, removeBattleHost } from './battle/battleRenderer.js';
import {
    initCalendarIfNeeded,
    updateCalendarIncremental,
    parseDate, formatDate,
} from './sao-calendar.js';
import { serializeBattleState, setBattleStateChangeCallback, setBattleEndCallback, destroyBattleSideEffects } from './battle/battleLogic.js';
import { extractAll, applyExtractedData } from './sao-extract.js';
import { CUSTOM_SKILL_DEFS, checkCustomSkillUnlocks } from './sao-skills.js';
import {
    getEffectCodeTable, resetEffectCodeTable,
    initToolSystem,
    checkMigrationReadiness, executeWorldBookMigration,
    restoreWorldBook, backupWorldBook,
} from './sao-tools.js';
// memory.js 已移除
import { cleanSaoPromptText, injectMemoryAndState } from './sao-prompt.js';
import { registerSaoDompurifyHook, renderAllTags } from './sao-render.js';

// ============================================================
// 常量
// ============================================================

// 5 个子代理角色：narrative 不干预主对话，用于 NPC 反应生成
// combat 兼管武器/技能/物品生成（因为涉及数值）
const ROLES = ['narrative', 'combat', 'extract'];
const ROLE_LABELS = {
    narrative: '📝 叙事/NPC模型',
    combat: '⚔️ 数值与生成模型',
    extract: '📊 状态提取模型',
};

const SLOT_LABELS = {
    weapon: '武器', main_hand: '主手', off_hand: '副手',
    armor: '防具', body: '身体', helmet: '头盔', head: '头部',
    boots: '靴子', feet: '脚部', gloves: '手套', hands: '手部',
    shield: '盾牌', accessory: '饰品', ring: '戒指', necklace: '项链',
    cape: '披风', belt: '腰带',
};

// ============================================================
// 骰子表常量已迁移至 sao-generators.js
// ============================================================

/** 章节 -> 世界书条目名称前缀映射 (FIX 4) */
const ARC_NAME_PREFIXES = {
    sao:     ['sao-', 'sao'],
    alo_old: ['\u65E7alo-', '\u65E7alo', '\u65E7ALO'],
    alo_new: ['\u65B0\u751Falo-', '\u65B0\u751Falo', '\u65B0\u751FALO'],
    ggo:     ['ggo-', 'ggo', 'GGO'],
    real:    ['\u73B0\u5B9E', '\u771F\u5B9E\u4E16\u754C'],
};

// ============================================================
// P4c: 自定义技能系统 (Custom Skill System)
// ============================================================

// 骰子工具函数已迁移至 sao-generators.js

// ============================================================
// 工具函数
// ============================================================
// 工具函数
// ============================================================

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.key}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }

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
// [sao-extract.js] parseZdStatus, parseUserStatus, extractAll, applyExtractedData 已移至 sao-extract.js

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
// 生成子代理已迁移至 sao-generators.js
// ============================================================

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
// SAO 卡兼容模式（替代 TavernHelper 脚本）
// ============================================================

/**
 * 启用 SAO 卡兼容模式
 * 1. 关闭不兼容的酒馆设置（修改全局 power_user）
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
            if (window.saveSettingsDebounced) window.saveSettingsDebounced();
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
        if (window.saveSettingsDebounced) window.saveSettingsDebounced();
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
    '公会状态栏',
    // npc状态栏: keep on-card (disabled=false) like 公会状态栏 — replaceString is clean pure HTML, no Shadow DOM renderer needed
    'npc状态栏',
    '快速回复', '开场白',
    // 注意: '战斗1.30手机' 有意不加入白名单。
    // 手机版是桌面端的窄屏适配，两者不应同时启用。
    // 插件无法可靠检测设备类型，因此手机版由用户手动启用/禁用。

    // Phase 1: 以下 5 个显示类正则已由插件 Shadow DOM 渲染器替代，从白名单移除。
    // DOMPurify uponSanitizeElement 钩子保留自定义标签作为 DOM 元素，渲染器 querySelector 定位。
    // 移除的正则: '日期', '角色状态栏', '装备栏', '剑技栏', '地图2'

    // Phase 2: '战斗1.30电脑' 已由插件 battle/battleRenderer.js 迁移，从白名单移除。
    // 移除的正则: '战斗1.30电脑'

    // Phase 3: 以下 promptOnly 隐藏正则已由插件 saoPromptCleanerInterceptor 替代，从白名单移除。
    // 插件通过 generate_interceptor + CHAT_COMPLETION_PROMPT_READY + GENERATE_AFTER_COMBINE_PROMPTS
    // 在 prompt 组装前统一清理 SAO 标签，不再需要正则脚本逐个处理。
    // 移除的正则: '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
    //            '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏', '隐藏回复', '隐藏预告'
    // 保留: '摘要' 已迁移至插件 (extractAll 解析 digest + SAO_PROMPT_STRIP_TAGS 清理)，从白名单移除
]);

// 已迁移脚本：插件已接管渲染/prompt清理，必须在插件活跃时主动禁用，避免双重渲染/重复prompt清理。
// Phase 1 (显示类): 日期, 角色状态栏, 装备栏, 剑技栏, 地图2
//   DOMPurify uponSanitizeElement 钩子保留自定义标签，Shadow DOM 渲染器 querySelector 渲染。
// Phase 2 (战斗): 战斗1.30电脑
// Phase 3 (promptOnly): 隐藏摘要, 隐藏npc, 隐藏日历, 隐藏战斗, 隐藏状态栏,
//                        隐藏地图, 隐藏骰子, 隐藏npc思维链, 隐藏公会状态栏, 隐藏回复, 隐藏预告
// Phase 4 (摘要): 摘要 (extractAll + SAO_PROMPT_STRIP_TAGS 已接管 digest 解析和 prompt 清理)
// 注意: '战斗1.30手机' 有意不在列表中（用户手动控制，见 §12.3）。
const MIGRATED_SCRIPTS = new Set([
    '日期', '角色状态栏', '装备栏', '剑技栏', '地图2',
    '战斗1.30电脑',
    '摘要',
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
 * 延迟轮询渲染：等待 .mes_text 就绪后渲染标签（解决首条消息 DOM 未就绪问题）
 */
function renderMessageWhenReady(messageId, rawText, attempts = 0) {
    const el = getMessageElement(messageId);
    if (el && el.querySelector('.mes_text')) {
        if (!el.querySelector('.sao-render-host')) {
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;
            renderAllTags(el, rawText);
        }
        return;
    }
    if (attempts < 20) {
        setTimeout(() => renderMessageWhenReady(messageId, rawText, attempts + 1), 80);
    }
}


// === P4b: Combat Resolution (resolveCombatRound + helpers) ===
// Extracted to sao-combat.js - import all combat functions from there
import {
    resolveCombatRound,
    buildPlayerEntity,
    buildEnemyEntity,
    buildTeammateEntity,
    detectPlayerAction,
    selectEnemySkill,
    getEquipmentStatsFromState,
    persistCooldowns,
    buildCombatNarrativeHint,
    normalizeWeapon,
    applyDamageToEnemy,
    executeStandardAttack,
    a5MultiHitCore,
    executePlayerActionCore,
    executeTeammateAttackCore,
    performEnemyActionCore,
    processEndOfRoundCore,
} from './sao-combat.js';


function bindEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 切换角色卡时重置效果代码表缓存，使其重新从新卡解析
        resetEffectCodeTable();
        // 无论是否 SAO 卡，先清理战斗副作用（幂等，非 SAO 卡或未初始化时为空操作）
        destroyBattleSideEffects();
        // A3: 清理 battle host 注册表，防止切换聊天后内存泄漏
        clearBattleHostRegistry();
        if (isSaoCard()) {
            log('聊天切换，加载 per-chat 数据');
            stabilizeSaoRegexScripts();
            enableCompatMode();
            injectMemoryAndState();
            initCalendarIfNeeded();
            // 刷新面板（如果已打开）
            if (document.getElementById('sao_panel_overlay')?.style.display === 'block') {
                refreshStatus();
            }

            // Phase 1 PoC: 切换聊天时对可见历史消息批量渲染日历
            // 注意：DOM 可能尚未完全就绪，此处做最佳努力尝试；未来可改为 MutationObserver 或延迟轮询
            const chatCtx = getContext();
            if (chatCtx.chat && chatCtx.chat.length > 0) {
                // 找到最后一条 AI 消息的 index
                let lastAiIdx = -1;
                if (event_types.CHARACTER_MESSAGE_RENDERED) {
                    for (let i = chatCtx.chat.length - 1; i >= 0; i--) {
                        if (chatCtx.chat[i] && !chatCtx.chat[i].is_user) {
                            lastAiIdx = i;
                            break;
                        }
                    }
                }
                chatCtx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    // 如果 CHARACTER_MESSAGE_RENDERED 可用，跳过最后一条 AI 消息（由该事件处理）
                    if (idx === lastAiIdx) return;
                    const histEl = getMessageElement(idx);
                    if (histEl) {
                        renderAllTags(histEl, msg.mes || '');
                    }
                });
                // 延迟轮询未渲染的消息（DOM 可能尚未就绪）
                chatCtx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    // 同样跳过最后一条 AI 消息
                    if (idx === lastAiIdx) return;
                    const histEl = getMessageElement(idx);
                    if (histEl && !histEl.querySelector('.sao-render-host')) {
                        renderMessageWhenReady(idx, msg.mes || '');
                    }
                });
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
            const extracted = await extractAll(rawText, callModel);
            if (extracted) await applyExtractedData(extracted, CUSTOM_SKILL_DEFS);

            // P2b: Calendar incremental update (v1 pure regex, no LLM)
            updateCalendarIncremental(rawText);

            // P4b: Combat resolution (no DOM dependency)
            const combatResult = resolveCombatRound(rawText);
            if (combatResult) {
                const data = getSaoData();
                if (data) {
                    // Step [3b]: generateLoot (only if combat occurred and enemies defeated)
                    if (combatResult.enemiesAfter?.some(e => e.defeated)) {
                        try {
                            const lootResult = await generateLoot({ enemyLevel: combatResult.enemiesAfter[0]?.level || 1 }, callModel);
                            if (lootResult) {
                                combatResult.loot = lootResult;
                            }
                        } catch (e) {
                            console.error('[SAO] generateLoot failed:', e);
                            // Loot generation failure is non-fatal — combat result still valid
                        }
                    }
                    data._lastCombatResult = combatResult;
                    if (combatResult.narrativeHint) {
                        if (!data.state) data.state = {};
                        data.state.lastCombatHint = combatResult.narrativeHint;
                    }
                }
                log(`战斗结算完成: ${combatResult.log.length} 条日志`);
            }
            // FIX3: 本轮无战斗提示时清除过期的 lastCombatHint
            if (!combatResult?.narrativeHint) {
                const hintData = getSaoData();
                if (hintData?.state?.lastCombatHint) {
                    delete hintData.state.lastCombatHint;
                }
            }

            // P4c: Custom skill unlock check
            checkCustomSkillUnlocks(rawText);

            // Centralized turn counter increment (per spec §4.4, at end of chain before save)
            const saoData = getSaoData();
            if (saoData?.state) {
                saoData.state.calendarTurnCounter = (saoData.state.calendarTurnCounter || 0) + 1;
            }

            // Persist all state changes from this processing cycle
            await saveSaoDataNow();
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
                if (fallbackEl) renderAllTags(fallbackEl, rawText, messageId);
                // P4b fallback: update battle panel + clear _lastCombatResult
                const fbData = getSaoData();
                if (fbData?._lastCombatResult) {
                    updateBattlePanelAfterCombat(messageId, fbData._lastCombatResult);
                    delete fbData._lastCombatResult;
                }
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
            // A3: 清理当前消息的 battle host，防止切换分支后内存泄漏（不再整表清除，保护其他活跃战斗面板）
            removeBattleHost(messageId);
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
            if (!msg || msg.is_user) return;
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
            if (msgEl) renderAllTags(msgEl, msg.mes || '', messageId);
            const data = getSaoData();
            if (data?._lastCombatResult) {
                updateBattlePanelAfterCombat(messageId, data._lastCombatResult);
                delete data._lastCombatResult;
            }
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

    // ============================================================
    // P2c: Calendar tab UI
    // ============================================================

    let _calViewDate = null;
    let _calSelectedDate = null;

    function getCalendar() {
        return getSaoData()?.calendar;
    }

    function initCalendarTabState() {
        const cal = getCalendar();
        if (!cal) return;
        const current = cal.currentDate ? parseDate(cal.currentDate) : new Date();
        if (!_calViewDate) _calViewDate = current ? new Date(current) : new Date();
        if (!_calSelectedDate) _calSelectedDate = cal.currentDate || formatDate(new Date());
    }

    function _renderCalendarTab() {
        const cal = getCalendar();
        const uninitEl = document.getElementById('sao_cal_uninit');

        if (!cal) {
            if (uninitEl) uninitEl.style.display = 'block';
            return;
        }

        if (uninitEl) uninitEl.style.display = 'none';
        initCalendarTabState();

        const currentDateEl = document.getElementById('sao_cal_current_date');
        if (currentDateEl) currentDateEl.textContent = cal.currentDate || '-';

        renderCalendarMonth();
        renderCalendarDayDetail();
        renderCalendarAppointments();
    }

    function renderCalendarMonth() {
        const grid = document.getElementById('sao_cal_grid');
        const label = document.getElementById('sao_cal_month_label');
        if (!grid || !label || !_calViewDate) return;

        const year = _calViewDate.getFullYear();
        const month = _calViewDate.getMonth() + 1;
        label.textContent = `${year}\u5e74 ${String(month).padStart(2, '0')}\u6708`;

        const cal = getCalendar();
        const todayStr = cal?.currentDate || formatDate(new Date());

        const headers = ['\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u65e5'].map(d =>
            `<div class="sao-cal-header">${d}</div>`
        ).join('');

        const firstDay = new Date(year, month - 1, 1);
        const startDay = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month, 0).getDate();
        const prevMonthDays = new Date(year, month - 1, 0).getDate();

        let cells = '';
        for (let i = startDay - 1; i >= 0; i--) {
            const d = prevMonthDays - i;
            cells += buildCalCell(year, month - 2, d, false, todayStr);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells += buildCalCell(year, month - 1, d, true, todayStr);
        }
        const totalCells = startDay + daysInMonth;
        const remaining = (7 - (totalCells % 7)) % 7;
        for (let d = 1; d <= remaining; d++) {
            cells += buildCalCell(year, month, d, false, todayStr);
        }

        grid.innerHTML = headers + cells;
    }

    function buildCalCell(year, monthIndex, day, isCurrentMonth, todayStr) {
        const date = new Date(year, monthIndex, day);
        const dateStr = formatDate(date);
        const cal = getCalendar();
        const dayData = cal?.days?.[dateStr];
        const events = dayData?.events || [];

        const cls = ['sao-cal-cell'];
        if (!isCurrentMonth) cls.push('sao-cal-other-month');
        if (dateStr === todayStr) cls.push('sao-cal-today');
        if (dateStr === _calSelectedDate) cls.push('sao-cal-selected');
        if (events.length > 0) cls.push('sao-cal-has-event');

        let dots = '';
        if (events.length > 0) {
            const hasApt = events.some(e => e.type === 'appointment');
            const hasCanon = events.some(e => e.type === 'canon');
            const hasCustom = events.some(e => e.type !== 'appointment' && e.type !== 'canon');
            dots = '<div class="sao-cal-dots">';
            if (hasApt) dots += '<div class="sao-cal-dot sao-cal-dot-apt"></div>';
            if (hasCanon) dots += '<div class="sao-cal-dot sao-cal-dot-canon"></div>';
            if (hasCustom) dots += '<div class="sao-cal-dot"></div>';
            dots += '</div>';
        }

        return `<div class="${cls.join(' ')}" data-action="calSelectDay" data-date="${dateStr}"><div class="sao-cal-day-num">${day}</div>${dots}</div>`;
    }

    function renderCalendarDayDetail() {
        const infoEl = document.getElementById('sao_cal_selected_info');
        const eventsEl = document.getElementById('sao_cal_day_events');
        if (!infoEl || !eventsEl) return;

        const cal = getCalendar();
        if (!_calSelectedDate) {
            infoEl.textContent = '\u9009\u62e9\u4e00\u5929\u67e5\u770b\u4e8b\u4ef6';
            eventsEl.innerHTML = '<span style="opacity:0.6;font-size:0.85em;">\u65e0\u4e8b\u4ef6</span>';
            return;
        }

        infoEl.textContent = _calSelectedDate;
        const dayData = cal?.days?.[_calSelectedDate];
        const events = dayData?.events || [];

        if (events.length === 0) {
            eventsEl.innerHTML = '<span style="opacity:0.6;font-size:0.85em;">\u65e0\u4e8b\u4ef6</span>';
            return;
        }

        eventsEl.innerHTML = events.map(evt => {
            const cls = ['sao-cal-event-item'];
            if (evt.type === 'appointment') cls.push('sao-cal-event-apt');
            else if (evt.type === 'canon') cls.push('sao-cal-event-canon');
            const time = evt.time ? `<span style="color:var(--primary);">${esc(evt.time)}</span> ` : '';
            const typeLabel = evt.type === 'canon' ? '[\u539f\u4f5c\u4e8b\u4ef6]' : evt.type === 'appointment' ? '[\u7ea6\u5b9a]' : '[\u53d8\u5316\u5267\u60c5]';
            return `<div class="${cls.join(' ')}">
                <div><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:rgba(0,210,255,0.12);font-size:0.75em;margin-right:6px;color:var(--primary-bright);">${esc(typeLabel)}</span>${time}${esc(evt.title || evt.description || '\u65e0\u6807\u9898')}</div>
                ${evt.description && evt.description !== evt.title ? `<div class="sao-cal-event-meta">${esc(evt.description)}</div>` : ''}
            </div>`;
        }).join('');
    }

    function renderCalendarAppointments() {
        const el = document.getElementById('sao_cal_appointments');
        if (!el) return;
        const cal = getCalendar();
        const apts = cal?.appointments || [];

        if (apts.length === 0) {
            el.innerHTML = '<span style="opacity:0.6;font-size:0.85em;">\u65e0\u7ea6\u5b9a</span>';
            return;
        }

        const sorted = [...apts].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

        el.innerHTML = sorted.map(apt => {
            const done = apt.status === 'completed';
            const cls = done ? 'sao-cal-event-item sao-cal-event-apt sao-cal-event-done' : 'sao-cal-event-item sao-cal-event-apt';
            const partText = apt.participants && apt.participants.length ? esc(Array.isArray(apt.participants) ? apt.participants.join(', ') : apt.participants) : '';
            return `<div class="${cls}">
                <div>${esc(apt.date)} ${apt.time ? `<span style="color:var(--warning);">${esc(apt.time)}</span>` : ''} ${esc(apt.description || '\u65e0\u63cf\u8ff0')}</div>
                ${apt.location ? `<div class="sao-cal-event-meta">\u5730\u70b9: ${esc(apt.location)}</div>` : ''}
                ${partText ? `<div class="sao-cal-event-meta">\u53c2\u4e0e\u8005: ${partText}</div>` : ''}
                <div class="sao-cal-event-actions">
                    <button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="calEditAppointment" data-id="${esc(apt.id)}">\u7f16\u8f91</button>
                    ${done ? '' : `<button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="calCompleteAppointment" data-id="${esc(apt.id)}">\u5b8c\u6210</button>`}
                    <button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="calDeleteAppointment" data-id="${esc(apt.id)}">\u5220\u9664</button>
                </div>
            </div>`;
        }).join('');
    }

    function showCalEditForm(apt = null, prefillDate = null) {
        const formEl = document.getElementById('sao_cal_edit_form');
        const titleEl = document.getElementById('sao_cal_form_title');
        const idEl = document.getElementById('sao_cal_edit_id');
        const dateEl = document.getElementById('sao_cal_input_date');
        const timeEl = document.getElementById('sao_cal_input_time');
        const descEl = document.getElementById('sao_cal_input_desc');
        const partEl = document.getElementById('sao_cal_input_participants');
        const locEl = document.getElementById('sao_cal_input_location');
        if (!formEl) return;

        if (apt) {
            titleEl.textContent = '\u7f16\u8f91\u7ea6\u5b9a';
            idEl.value = apt.id;
            dateEl.value = apt.date || '';
            timeEl.value = apt.time || '';
            descEl.value = apt.description || '';
            partEl.value = Array.isArray(apt.participants) ? apt.participants.join(', ') : (apt.participants || '');
            locEl.value = apt.location || '';
        } else {
            titleEl.textContent = '\u6dfb\u52a0\u7ea6\u5b9a';
            idEl.value = '';
            dateEl.value = prefillDate || _calSelectedDate || formatDate(new Date());
            timeEl.value = '';
            descEl.value = '';
            partEl.value = '';
            locEl.value = '';
        }

        formEl.style.display = 'block';
        formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideCalEditForm() {
        const formEl = document.getElementById('sao_cal_edit_form');
        if (formEl) formEl.style.display = 'none';
    }

    function handleCalPrevMonth() {
        if (!_calViewDate) initCalendarTabState();
        _calViewDate.setMonth(_calViewDate.getMonth() - 1);
        renderCalendarMonth();
    }

    function handleCalNextMonth() {
        if (!_calViewDate) initCalendarTabState();
        _calViewDate.setMonth(_calViewDate.getMonth() + 1);
        renderCalendarMonth();
    }

    function handleCalSelectDay(dateStr) {
        _calSelectedDate = dateStr;
        renderCalendarMonth();
        renderCalendarDayDetail();
    }

    function handleCalAddAppointment() {
        showCalEditForm(null, _calSelectedDate);
    }

    function handleCalManualEdit() {
        showCalEditForm(null, _calSelectedDate);
    }

    function handleCalEditAppointment(id) {
        const cal = getCalendar();
        const apt = cal?.appointments?.find(a => a.id === id);
        if (apt) showCalEditForm(apt);
    }

    async function handleCalSaveAppointment() {
        try {
        const cal = getCalendar();
        if (!cal) return;

        const idEl = document.getElementById('sao_cal_edit_id');
        const dateEl = document.getElementById('sao_cal_input_date');
        const timeEl = document.getElementById('sao_cal_input_time');
        const descEl = document.getElementById('sao_cal_input_desc');
        const partEl = document.getElementById('sao_cal_input_participants');
        const locEl = document.getElementById('sao_cal_input_location');

        const date = dateEl.value;
        const time = timeEl.value;
        const description = descEl.value.trim();
        const participants = partEl.value.split(',').map(s => s.trim()).filter(Boolean);
        const location = locEl.value.trim();

        if (!date || !description) {
            log('\u4fdd\u5b58\u7ea6\u5b9a\u5931\u8d25: \u65e5\u671f\u548c\u63cf\u8ff0\u4e0d\u80fd\u4e3a\u7a7a', 'warn');
            return;
        }

        const id = idEl.value;
        let apt;
        if (id) {
            apt = cal.appointments.find(a => a.id === id);
            if (!apt) {
                log('\u4fdd\u5b58\u7ea6\u5b9a\u5931\u8d25: \u672a\u627e\u5230\u7ea6\u5b9a', 'warn');
                return;
            }
            const oldDay = cal.days[apt.date];
            if (oldDay) {
                oldDay.events = oldDay.events.filter(e => !(e.source === 'manual' && e.title === apt.description && e.time === apt.time));
            }
        } else {
            apt = {
                id: 'apt_' + Date.now(),
                date: date,
                time: time,
                description: description,
                participants: [],
                location: '',
                source: 'manual',
                status: 'pending',
                createdAt: new Date().toISOString(),
            };
            if (!cal.appointments) cal.appointments = [];
            cal.appointments.push(apt);
        }

        apt.date = date;
        apt.time = time;
        apt.description = description;
        apt.participants = participants;
        apt.location = location;

        if (!cal.days[date]) cal.days[date] = { events: [], isUpdated: true };
        const eventObj = {
            type: 'appointment',
            time: time,
            title: description,
            description: description,
            source: 'manual',
        };
        const existingIdx = cal.days[date].events.findIndex(e => e.source === 'manual' && e.title === description && e.time === time);
        if (existingIdx >= 0) {
            cal.days[date].events[existingIdx] = eventObj;
        } else {
            cal.days[date].events.push(eventObj);
        }

        await saveSaoDataNow();
        hideCalEditForm();
        _renderCalendarTab();
        } catch (e) {
            log('\u4fdd\u5b58\u7ea6\u5b9a\u5931\u8d25: ' + e.message, 'error');
        }
    }

    async function handleCalDeleteAppointment(id) {
        try {
        const cal = getCalendar();
        if (!cal || !cal.appointments) return;
        const idx = cal.appointments.findIndex(a => a.id === id);
        if (idx < 0) return;
        const apt = cal.appointments[idx];
        cal.appointments.splice(idx, 1);
        const day = cal.days[apt.date];
        if (day) {
            day.events = day.events.filter(e => !(e.type === 'appointment' && e.source === 'manual' && e.title === apt.description && e.time === apt.time));
        }
        await saveSaoDataNow();
        _renderCalendarTab();
        } catch (e) {
            log('\u5220\u9664\u7ea6\u5b9a\u5931\u8d25: ' + e.message, 'error');
        }
    }

    async function handleCalCompleteAppointment(id) {
        try {
        const cal = getCalendar();
        if (!cal) return;
        const apt = cal.appointments?.find(a => a.id === id);
        if (!apt) return;
        apt.status = 'completed';
        await saveSaoDataNow();
        _renderCalendarTab();
        } catch (e) {
            log('\u5b8c\u6210\u7ea6\u5b9a\u5931\u8d25: ' + e.message, 'error');
        }
    }

    function handleCalInit() {
        initCalendarIfNeeded();
        _renderCalendarTab();
    }

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
            if (tabName === 'calendar') _renderCalendarTab();
        },
        renderCalendarTab() { _renderCalendarTab(); },
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
                    result = await generateEquipment({ playerLevel: 5, floor: 1, type: '武器', rarity: '蓝色' }, callModel);
                } else if (type === 'skill') {
                    result = await generateSkill({ weaponType: '单手直剑', skillLevel: 1, playerLevel: 5 }, callModel);
                } else if (type === 'loot') {
                    result = await generateLoot({ enemyLevel: 3, floor: 1, enemyType: '野猪' }, callModel);
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
        // P7: 世界书迁移
        checkMigrationReadiness() { return checkMigrationReadiness(); },
        executeWorldBookMigration() { return executeWorldBookMigration(); },
        restoreWorldBook() { return restoreWorldBook(); },
        backupWorldBook() { return backupWorldBook(); },
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
                case 'calPrevMonth': handleCalPrevMonth(); break;
                case 'calNextMonth': handleCalNextMonth(); break;
                case 'calSelectDay': { const d = target.getAttribute('data-date'); if (d) handleCalSelectDay(d); break; }
                case 'calAddAppointment': handleCalAddAppointment(); break;
                case 'calManualEdit': handleCalManualEdit(); break;
                case 'calEditAppointment': { const id = target.getAttribute('data-id'); if (id) handleCalEditAppointment(id); break; }
                case 'calDeleteAppointment': { const id = target.getAttribute('data-id'); if (id) handleCalDeleteAppointment(id); break; }
                case 'calCompleteAppointment': { const id = target.getAttribute('data-id'); if (id) handleCalCompleteAppointment(id); break; }
                case 'calSaveAppointment': handleCalSaveAppointment(); break;
                case 'calCancelEdit': hideCalEditForm(); break;
                case 'calInit': handleCalInit(); break;
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
            await loadPanelHTML();
            if (!window.SaoPanel) {
                initPanelLogic();
            }
            window.SaoPanel.open();
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
    console.log('[SAO Companion] v0.6.14 初始化中...');
    registerSaoDompurifyHook();
    loadSettingsPanel().catch(e => {
        console.error('[SAO Companion] loadSettingsPanel 失败:', e);
    });
    bindEvents();
    initToolSystem();
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

// ============================================================
// 测试钩子：仅在测试环境暴露内部函数供 E2E 测试
// 生产环境（浏览器）process 不存在，此块不执行
// ============================================================
if (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.NODE_ENV === 'test') {
    globalThis.__SAO_INTERNAL__ = {
        // 后处理链战斗入口 + 实体构建
        resolveCombatRound,
        buildPlayerEntity,
        buildEnemyEntity,
        buildTeammateEntity,
        detectPlayerAction,
        selectEnemySkill,
        getEquipmentStatsFromState,
        persistCooldowns,
        buildCombatNarrativeHint,
        normalizeWeapon,
        // 本地 Core 函数（index.js 版，签名与 battleCore.js 不同）
        applyDamageToEnemy,
        executeStandardAttack,
        a5MultiHitCore,
        executePlayerActionCore,
        executeTeammateAttackCore,
        performEnemyActionCore,
        processEndOfRoundCore,
        // 常量
        MODULE_NAME,
        // mock 注入点：测试可覆盖 getSaoData 的返回值
        __testSaoData: null,
        __getTestSaoData() { return globalThis.__SAO_INTERNAL__.__testSaoData; },
        __setTestSaoData(d) { globalThis.__SAO_INTERNAL__.__testSaoData = d; },
    };
}
