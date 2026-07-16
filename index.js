// SAO Companion - 刀剑神域角色卡专用扩展
// 版本: 0.6.45 (用原卡模板替换自写美化)
// 功能: 多模型分工 + 状态监控 + 独立控制台

import { renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    MODULE_NAME, logs,
    esc, getContext, getCurrentCharacter, isSaoCard,
    getSettings,
    getSaoData,
    safeJsonParse, safe,
    log, updateLogDisplay,
    bindSaoEvent, bindSaoDom, unbindAllSaoEvents, isSaoEventsBound, setSaoEventsBound,
} from './sao-core.js';
import { getStore, saveStore, appendActionLog, captureSnapshot, restoreSnapshot } from './sao-store-core.js';
import { getPlayerStore, CURSOR_LABELS as CURSOR_LABEL, equipItem, unequipItem, forgetPlayerSkill, incrementIncapacitatedTurns, resetIncapacitatedTurns, getIncapacitatedTurns, migrateToLogicManaged } from './sao-store-player.js';
import { getEquipmentById, removeEquipmentById, getEquipmentStore } from './sao-store-equipment.js';
import { getSkillById, getSkillStore } from './sao-store-skill.js';
import { getInventoryStore, removeEquipmentItem, addMaterial, addQuestItem } from './sao-store-inventory.js';
import { useConsumable as useConsumableStore, getConsumableById, getConsumableStore } from './sao-store-consumable.js';
import { saveSettingsDebounced } from '../../../../script.js';
import {
    generateEquipment, generateSkill, generateLoot, generateConsumable,
} from './sao-generators.js';
import { event_types } from '../../../events.js';
import { power_user } from '../../../power-user.js';

import {
    initCalendarIfNeeded,
    updateCalendarIncremental,
    persistCalendar,
    parseDate, formatDate,
    addAppointmentToCalendar,
    buildCleanCalendarDays,
} from './sao-calendar.js';
import { buildCalCellHtml } from './sao-calendar-cell.js';
import { renderDetailEquip, renderDetailSkill, renderDetailInv } from './sao-detail-popup.js';

import { extractAll, applyExtractedData } from './sao-extract.js';
import { CUSTOM_SKILL_DEFS, checkCustomSkillUnlocks, checkUniqueSkillUnlocks } from './sao-skills.js';
import { expireBuffs, addTemporaryBuff, addPermanentBuff } from './sao-buff.js';
import { initPresetGuilds, createGuild, joinGuild, leaveGuild, getGuildByName } from './sao-store-guild.js';
import {
    getEffectCodeTable, resetEffectCodeTable,
    initToolSystem,
} from './sao-tools.js';
import { getFloorStore, getFloorById, getFloorStoreWithCanon } from './sao-store-floor.js';
import { runLorebookPreParser } from './sao-preparser.js';
import { getWorldStore } from './sao-store-world.js';
import { getNpcStore } from './sao-store-npc.js';
import { getQuestStore } from './sao-store-quest.js';
import { checkQuestsFromNarrative } from './sao-quest-specialist.js';
import { abandonQuest, getActiveQuests, getCompletedQuests } from './sao-store-quest.js';
// memory.js 已移除
import { cleanSaoPromptText, cleanTimelinePromptText, injectMemoryAndState } from './sao-prompt.js';
import { registerSaoDompurifyHook, renderAllTags, refreshLatestChatStatusPanel } from './sao-render.js';
import { DOMPurify } from '../../../../lib.js';
import { ROLES, SUB_ROLES, ALL_MODEL_KEYS, ROLE_LABELS, SUB_ROLE_LABELS, fetchModelList, callModel, isModelConfigured } from './sao-models.js';
import { fireSpecialistPanels, callStatusSpecialist, _clearSpecialistPanels, callWorldSpecialist } from './sao-specialists.js';
import { shouldTriggerPeriodicCalendarCheck, shouldTriggerCalendarModel, calendarModelUpdate, resetCalendarModelRunning } from './sao-calendar-model.js';
import { callNpcBackgroundSpecialist, shouldTriggerNpcBackground } from './sao-npc-background.js';
import { DANGER_LABEL } from './sao-state-projection.js';
// sao-rules.js 已删除（规则段落直接内联到各专家 systemPrompt）


// ============================================================
// 常量
// ============================================================

/** 装备槽中文标签 — 侧栏/装备列表用（完整 slot 集，与 sao-state-projection.js SLOT_DISPLAY 不同：投影用短标签） */
const SLOT_LABELS = {
    weapon: '武器', off_hand: '副手',
    armor: '防具', chest: '胸部', helmet: '头盔', head: '头部',
    boots: '靴子', legs: '腿部', gloves: '手套', hands: '手部',
    shield: '盾牌', accessory: '饰品', ring: '戒指', necklace: '项链',
    cape: '披风', belt: '腰带',
};

// ============================================================
// 骰子表常量已迁移至 sao-generators.js
// ============================================================

// ============================================================
// P4c: 自定义技能系统 (Custom Skill System)
// ============================================================

// 骰子工具函数已迁移至 sao-generators.js

// ============================================================
// 工具函数
// ============================================================

const _processingLocks = {};
let _saoCurrentData = {};
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
// 子代理任务
// ============================================================

// ============================================================
// <zd_status> 和 <user_status> 正则解析器 (FIX 1)
// ============================================================
// [sao-extract.js] parseZdStatus, parseUserStatus, extractAll, applyExtractedData 已移至 sao-extract.js

// ============================================================
// 生成子代理已迁移至 sao-generators.js
// ============================================================

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
        saveSettingsDebounced();
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

// 白名单：插件应管理的正则脚本（排除3个不应自动启用的工具/可选脚本）
const REGEX_WHITELIST = new Set([
    '公会状态栏',
    // npc状态栏: 已由插件 Shadow DOM 渲染器接管（renderNpcStatus），从白名单移除
    '快速回复', '开场白',
    // 注意: '战斗1.30手机' 有意不加入白名单。
    // 手机版是桌面端的窄屏适配，两者不应同时启用。
    // 插件无法可靠检测设备类型，因此手机版由用户手动启用/禁用。

    // Phase 1: 以下 5 个显示类正则已由插件 Shadow DOM 渲染器替代，从白名单移除。
    // DOMPurify uponSanitizeElement 钩子保留自定义标签作为 DOM 元素，渲染器 querySelector 定位。
    // 移除的正则: '日期', '角色状态栏', '装备栏', '剑技栏', '地图2'

    // Phase 2: '战斗1.30电脑' 已移除（战斗系统已清理），从白名单移除。
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
    'npc状态栏',
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
            saveSettingsDebounced();
        }
    } catch (e) {
        log('启用正则脚本失败: ' + e.message, 'warn');
    }
}

// ============================================================
// Phase 1 PoC: Shadow DOM 标签渲染
// ============================================================

/**
 * 处理 <gain_skill> 和 <gain_equipment> 标签：主LLM直接提供名称+描述，插件仅计算数值。
 * 格式: <gain_skill name="剑技名" weapon_type="武器类型" description="描述">武器类型</gain_skill>
 *       <gain_equipment name="装备名" slot="槽位" stat_type="类型" rarity="稀有度" description="描述">类型:稀有度</gain_equipment>
 */
async function processGainTags(rawText) {
    if (!rawText) return;

    // === <gain_skill> ===
    const skillMatches = [...rawText.matchAll(/<gain_skill([^>]*)>([\s\S]*?)<\/gain_skill>/gi)];
    for (const m of skillMatches) {
        const attrs = m[1] || '';
        const innerContent = (m[2] || '').trim();
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        const weaponTypeMatch = attrs.match(/weapon_type\s*=\s*["']([^"']*)["']/i);
        const prefilledName = nameMatch ? nameMatch[1].trim() : null;
        const prefilledDesc = descMatch ? descMatch[1].trim() : null;
        const weaponType = weaponTypeMatch ? weaponTypeMatch[1].trim() : innerContent;

        const player = getPlayerStore();
        const skillLevel = player?.progression?.level || 1;

        // Parse prefilled numeric attributes for skill
        const slMatch = attrs.match(/skill_level\s*=\s*["']?(\d+)["']?/i);
        const atkMatch = attrs.match(/(?<![a-z_])atk\s*=\s*["']?(\d+)["']?/i);
        const hitMatch = attrs.match(/(?<![a-z_])hit\s*=\s*["']?(\d+)["']?/i);
        const critMatch = attrs.match(/(?<![a-z_])crit\s*=\s*["']?(\d+)["']?/i);
        const aptMatch = attrs.match(/(?<![a-z_])apt\s*=\s*["']?(\d+)["']?/i);
        const tpaMatch = attrs.match(/(?<![a-z_])tpa\s*=\s*["']?(\d+)["']?/i);
        const mpCostMatch = attrs.match(/mp_cost\s*=\s*["']?(\d+)["']?/i);
        const wnMatch = attrs.match(/wn\s*=\s*["']([^"']*)["']/i);
        const enMatch = attrs.match(/en\s*=\s*["']([^"']*)["']/i);
        const skillPrefilled = {};
        if (slMatch) skillPrefilled.skill_level = parseInt(slMatch[1]);
        if (atkMatch) skillPrefilled.atk = parseInt(atkMatch[1]);
        if (hitMatch) skillPrefilled.hit = parseInt(hitMatch[1]);
        if (critMatch) skillPrefilled.crit = parseInt(critMatch[1]);
        if (aptMatch) skillPrefilled.apt = parseInt(aptMatch[1]);
        if (tpaMatch) skillPrefilled.tpa = parseInt(tpaMatch[1]);
        if (mpCostMatch) skillPrefilled.mp_cost = parseInt(mpCostMatch[1]);
        if (wnMatch) skillPrefilled.wn = wnMatch[1];
        if (enMatch) skillPrefilled.en = enMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const categoryMatch = attrs.match(/category\s*=\s*["']([^"']*)["']/i);
        if (categoryMatch) skillPrefilled.category = categoryMatch[1].trim();
        const rarityMatch = attrs.match(/rarity\s*=\s*["']([^"']*)["']/i);
        if (rarityMatch) skillPrefilled.rarity = rarityMatch[1].trim();
        const skillContext = { weaponType, skillLevel, playerLevel: skillLevel };
        if (Object.keys(skillPrefilled).length > 0) skillContext.prefilled = skillPrefilled;

        log(`[gain_skill] name=${prefilledName || '(子LLM生成)'} weapon=${weaponType}${skillContext.prefilled ? ' (prefilled)' : ''}`);
        try {
            const skill = await generateSkill(skillContext, callModel, prefilledName, prefilledDesc);
            if (skill) {
                log(`[gain_skill] 完成: ${skill.name} (ATK ${skill.base_damage})`);
                await saveStore();
            }
        } catch (e) {
            log(`[gain_skill] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_equipment> ===
    const equipMatches = [...rawText.matchAll(/<gain_equipment([^>]*)>([\s\S]*?)<\/gain_equipment>/gi)];
    for (const m of equipMatches) {
        const attrs = m[1] || '';
        const innerContent = (m[2] || '').trim();
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        const rarityMatch = attrs.match(/rarity\s*=\s*["']([^"']*)["']/i);
        const slotMatch = attrs.match(/slot\s*=\s*["']([^"']*)["']/i);
        const prefilledName = nameMatch ? nameMatch[1].trim() : null;
        const prefilledDesc = descMatch ? descMatch[1].trim() : null;

        const player = getPlayerStore();
        const playerLevel = player?.progression?.level || 1;
        const context = { playerLevel };
        const parts = innerContent.split(/[:：]/).map(s => s.trim());
        if (parts[0]) context.type = parts[0];
        if (parts[1]) context.rarity = parts[1];
        if (rarityMatch) context.rarity = rarityMatch[1];
        if (slotMatch) context.slot = slotMatch[1];

        // Parse prefilled numeric attributes for equipment
        const ilMatch = attrs.match(/item_level\s*=\s*["']?(\d+)["']?/i);
        const maxHpMatch = attrs.match(/max_hp\s*=\s*["']?(\d+)["']?/i);
        const strMatch = attrs.match(/(?<![a-z_])str\s*=\s*["']?(\d+)["']?/i);
        const agiMatch = attrs.match(/(?<![a-z_])agi\s*=\s*["']?(\d+)["']?/i);
        const intMatch = attrs.match(/(?<![a-z_])int\s*=\s*["']?(\d+)["']?/i);
        const vitMatch = attrs.match(/(?<![a-z_])vit\s*=\s*["']?(\d+)["']?/i);
        const affixesMatch = attrs.match(/affixes\s*=\s*["']([^"']*)["']/i);
        const prefilled = {};
        if (ilMatch) prefilled.item_level = parseInt(ilMatch[1]);
        if (slotMatch) prefilled.slot = slotMatch[1];
        if (rarityMatch) prefilled.rarity = rarityMatch[1];
        const weaponTypeMatch = attrs.match(/weapon_type\s*=\s*["']([^"']*)["']/i);
        if (weaponTypeMatch) prefilled.weapon_type = weaponTypeMatch[1].trim();
        const pfStats = {};
        if (maxHpMatch) pfStats.maxHp = parseInt(maxHpMatch[1]);
        if (strMatch) pfStats.str = parseInt(strMatch[1]);
        if (agiMatch) pfStats.agi = parseInt(agiMatch[1]);
        if (intMatch) pfStats.int = parseInt(intMatch[1]);
        if (vitMatch) pfStats.vit = parseInt(vitMatch[1]);
        if (Object.keys(pfStats).length > 0) prefilled.stats = pfStats;
        // affixes 必填:LLM 漏写视为空数组 []（白色装备无词缀），而非走掷骰路径自动生成
        prefilled.affixes = (affixesMatch ? affixesMatch[1].split(',').map(s => s.trim()).filter(Boolean) : []);
        context.prefilled = prefilled;

        log(`[gain_equipment] name=${prefilledName || '(子LLM生成)'} type=${context.type} rarity=${context.rarity || '随机'}${context.prefilled ? ' (prefilled)' : ''}`);
        try {
            const equip = await generateEquipment(context, callModel, prefilledName, prefilledDesc);
            if (equip) {
                log(`[gain_equipment] 完成: ${equip.name} (${equip.rarity})`);
                await saveStore();
            }
        } catch (e) {
            log(`[gain_equipment] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_consumable> ===
    const consumableMatches = [...rawText.matchAll(/<gain_consumable([^>]*)>([\s\S]*?)<\/gain_consumable>/gi)];
    for (const m of consumableMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        const rarityMatch = attrs.match(/rarity\s*=\s*["']([^"']*)["']/i);
        const categoryMatch = attrs.match(/category\s*=\s*["']([^"']*)["']/i);
        const itemLevelMatch = attrs.match(/item_level\s*=\s*["']?(\d+)["']?/i);
        const maxStackMatch = attrs.match(/max_stack\s*=\s*["']?(\d+)["']?/i);
        const effectsJsonMatch = attrs.match(/effects\s*=\s*["']([^"']*)["']/i);
        const prefilledName = nameMatch ? nameMatch[1].trim() : null;
        const prefilledDesc = descMatch ? descMatch[1].trim() : null;

        const context = {};
        if (itemLevelMatch) context.playerLevel = parseInt(itemLevelMatch[1]);
        context.prefilled = {};
        if (categoryMatch) context.prefilled.category = categoryMatch[1].trim();
        if (rarityMatch) context.prefilled.rarity = rarityMatch[1].trim();
        if (itemLevelMatch) context.prefilled.item_level = parseInt(itemLevelMatch[1]);
        if (maxStackMatch) context.prefilled.maxStack = parseInt(maxStackMatch[1]);
        if (effectsJsonMatch) {
            try { context.prefilled.effects = JSON.parse(effectsJsonMatch[1]); } catch (e) { log('[gain_consumable] effects JSON parse failed: ' + e.message, 'warn'); }
        }

        log(`[gain_consumable] name=${prefilledName || '(子LLM生成)'} category=${context.prefilled.category || '随机'}`);
        try {
            const consumable = await generateConsumable(context, callModel, prefilledName, prefilledDesc);
            if (consumable) {
                log(`[gain_consumable] 完成: ${consumable.name} (${consumable.rarity})`);
                await saveStore();
            }
        } catch (e) {
            log(`[gain_consumable] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_buff> ===
    const buffMatches = [...rawText.matchAll(/<gain_buff([^>]*)>([\s\S]*?)<\/gain_buff>/gi)];
    for (const m of buffMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const idMatch = attrs.match(/id\s*=\s*["']([^"']*)["']/i);
        const sourceMatch = attrs.match(/source\s*=\s*["']([^"']*)["']/i);
        const durationMatch = attrs.match(/duration\s*=\s*["']([^"']*)["']/i);
        const expiresMatch = attrs.match(/expires\s*=\s*["']([^"']*)["']/i);
        const acquiredTurnMatch = attrs.match(/acquired_turn\s*=\s*["']?(\d+)["']?/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        const permanentMatch = attrs.match(/permanent\s*=\s*["']?(true|false)["']?/i);
        const effectsJsonMatch = attrs.match(/effects\s*=\s*["']([^"']*)["']/i);

        if (!nameMatch) { log('[gain_buff] 缺少 name，跳过', 'warn'); continue; }
        const name = nameMatch[1].trim();
        const buffId = idMatch ? idMatch[1].trim() : ('buff_' + name);

        // source 必填
        if (!sourceMatch || !sourceMatch[1].trim()) {
            log('[gain_buff] 缺少必填 source，跳过 (name=' + name + ')', 'warn'); continue;
        }
        // description 必填
        if (!descMatch || !descMatch[1].trim()) {
            log('[gain_buff] 缺少必填 description，跳过 (name=' + name + ')', 'warn'); continue;
        }

        // Build effects: prefer effects JSON attr, else parse individual stat attrs
        let effects = {};
        if (effectsJsonMatch) {
            try { effects = JSON.parse(effectsJsonMatch[1]); } catch (e) { log('[gain_buff] effects JSON parse failed: ' + e.message, 'warn'); }
        }
        // Individual stat attrs as fallback/override
        const STAT_ATTRS = ['str', 'agi', 'int', 'vit'];
        for (const s of STAT_ATTRS) {
            const re = new RegExp(s + '\\s*=\\s*["\']?(-?\\d+)["\']?', 'i');
            const sm = attrs.match(re);
            if (sm) effects[s] = parseInt(sm[1]);
        }

        if (Object.keys(effects).length === 0) {
            log('[gain_buff] 缺少 effects，跳过 (name=' + name + ')', 'warn');
            continue;
        }

        const buff = {
            id: buffId,
            source: sourceMatch[1].trim(),
            name: name,
            effects: effects,
            special_effects: specialEffectsMatch ? specialEffectsMatch[1].split(';').map(s => s.trim()).filter(Boolean) : [],
            description: descMatch[1].trim(),
        };
        const isPermanent = permanentMatch && permanentMatch[1] === 'true';
        if (!isPermanent) {
            // 临时buff duration 必填
            if (!durationMatch || !durationMatch[1].trim()) {
                log('[gain_buff] 临时buff缺少必填 duration，跳过 (name=' + name + ')', 'warn'); continue;
            }
            buff.duration = durationMatch[1].trim();
            buff.expires = expiresMatch ? expiresMatch[1].trim() : 'manual';
            if (acquiredTurnMatch) buff.acquired_turn = parseInt(acquiredTurnMatch[1]);
        }

        const player = getPlayerStore();
        try {
            if (isPermanent) {
                addPermanentBuff(player, buff);
                log(`[gain_buff] 永久 buff 添加: ${name} (${buffId})`);
            } else {
                addTemporaryBuff(player, buff);
                log(`[gain_buff] 临时 buff 添加: ${name} (${buffId}) duration=${buff.duration}`);
            }
            await saveStore();
        } catch (e) {
            log(`[gain_buff] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_guild> ===
    // 公会创建/加入/离开。与装备/技能/消耗品/buff 不同：无 generate 函数，
    // buff 数值由标签属性直接提供（卡片或主LLM 预填），插件照单全收。
    // 公会 buff 的 source 固定为 'guild'，id 固定为 'guild_' + guild_id（与 joinGuild 内部一致）。
    const guildMatches = [...rawText.matchAll(/<gain_guild([^>]*)>([\s\S]*?)<\/gain_guild>/gi)];
    for (const m of guildMatches) {
        const attrs = m[1] || '';
        const actionMatch = attrs.match(/action\s*=\s*["']([^"']*)["']/i);
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const leaderMatch = attrs.match(/leader\s*=\s*["']([^"']*)["']/i);
        const hqMatch = attrs.match(/headquarters\s*=\s*["']([^"']*)["']/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        const buffNameMatch = attrs.match(/buff_name\s*=\s*["']([^"']*)["']/i);
        const buffDescMatch = attrs.match(/buff_description\s*=\s*["']([^"']*)["']/i);
        const buffSpecialMatch = attrs.match(/buff_special_effects\s*=\s*["']([^"']*)["']/i);
        const autoJoinMatch = attrs.match(/auto_join\s*=\s*["']?(true|false)["']?/i);
        const action = (actionMatch ? actionMatch[1].trim().toLowerCase() : 'create');

        if (!nameMatch && action !== 'leave') {
            log('[gain_guild] 缺少 name，跳过', 'warn');
            continue;
        }
        const guildName = nameMatch ? nameMatch[1].trim() : null;

        try {
            if (action === 'leave') {
                const ok = leaveGuild();
                log(`[gain_guild] 玩家离开公会: ${ok ? '成功' : '未加入公会'}`);
                await saveStore();
                continue;
            }

            if (action === 'join') {
                // 加入已有公会（应用其 buff）
                const ok = joinGuild(guildName);
                log(`[gain_guild] 玩家加入公会 ${guildName}: ${ok ? '成功（buff 已应用）' : '失败（公会不存在）'}`);
                await saveStore();
                continue;
            }

            // action === 'create' (default)
            // Required field validation for create
            if (!leaderMatch || !leaderMatch[1].trim()) {
                log('[gain_guild] create 缺少必填 leader，跳过', 'warn');
                continue;
            }
            if (!descMatch || !descMatch[1].trim()) {
                log('[gain_guild] create 缺少必填 description，跳过', 'warn');
                continue;
            }

            // 构建 buff effects：解析单独的 stat 属性 (str/agi/int/vit)
            const effects = {};
            const STAT_ATTRS = ['str', 'agi', 'int', 'vit'];
            for (const s of STAT_ATTRS) {
                const re = new RegExp(s + '\\s*=\\s*["\']?(-?\\d+)["\']?', 'i');
                const sm = attrs.match(re);
                if (sm) effects[s] = parseInt(sm[1]);
            }
            const buff = (buffNameMatch && Object.keys(effects).length > 0)
                ? {
                    name: buffNameMatch[1].trim(),
                    effects: effects,
                    special_effects: buffSpecialMatch ? buffSpecialMatch[1].split(';').map(s=>s.trim()).filter(Boolean) : [],
                    description: buffDescMatch ? buffDescMatch[1].trim() : (buffNameMatch[1].trim() + '（公会buff）'),
                }
                : null;

            const guildId = createGuild(guildName, leaderMatch[1].trim(), {
                headquarters: hqMatch ? hqMatch[1].trim() : null,
                buff: buff,
                description: descMatch[1].trim(),
            });
            log(`[gain_guild] 公会创建: ${guildName} → ${guildId}${buff ? ' (buff: ' + buff.name + ' ' + JSON.stringify(effects) + ')' : ' (无 buff)'}`);

            // auto_join 默认 true：创建后玩家自动加入（应用 buff）
            const autoJoin = !autoJoinMatch || autoJoinMatch[1] === 'true';
            if (autoJoin) {
                const ok = joinGuild(guildName);
                log(`[gain_guild] 玩家加入新建公会: ${ok ? '成功（buff 已应用）' : '失败'}`);
            }
            await saveStore();
        } catch (e) {
        log(`[gain_guild] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_material> ===
    const materialMatches = [...rawText.matchAll(/<gain_material([^>]*)>([\s\S]*?)<\/gain_material>/gi)];
    for (const m of materialMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const qtyMatch = attrs.match(/qty\s*=\s*["']?(\d+)["']?/i);
        if (!nameMatch) { log('[gain_material] 缺少 name，跳过', 'warn'); continue; }
        const name = nameMatch[1].trim();
        const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1])) : 1;
        try {
            await addMaterial(name, qty, true);
            log(`[gain_material] 材料 ${name} x${qty} 添加到背包`);
            await saveStore();
        } catch (e) {
            log(`[gain_material] 失败: ${e.message}`, 'warn');
        }
    }

    // === <gain_quest_item> ===
    const questItemMatches = [...rawText.matchAll(/<gain_quest_item([^>]*)>([\s\S]*?)<\/gain_quest_item>/gi)];
    for (const m of questItemMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const descMatch = attrs.match(/(?:desc|description)\s*=\s*["']([^"']*)["']/i);
        if (!nameMatch) { log('[gain_quest_item] 缺少 name，跳过', 'warn'); continue; }
        const name = nameMatch[1].trim();
        const description = descMatch ? descMatch[1].trim() : '';
        try {
            await addQuestItem(name, description, true);
            log(`[gain_quest_item] 任务物品 ${name} 添加到背包`);
            await saveStore();
        } catch (e) {
            log(`[gain_quest_item] 失败: ${e.message}`, 'warn');
        }
    }

    // === <use_item> === LLM在叙事中使用物品（消耗+应用效果）
    const useItemMatches = [...rawText.matchAll(/<use_item([^>]*)>([\s\S]*?)<\/use_item>/gi)];
    for (const m of useItemMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const qtyMatch = attrs.match(/qty\s*=\s*["']?(\d+)["']?/i);
        const targetMatch = attrs.match(/target\s*=\s*["']([^"']*)["']/i);
        if (!nameMatch) { log('[use_item] 缺少 name，跳过', 'warn'); continue; }
        const itemName = nameMatch[1].trim();
        const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1])) : 1;
        const target = targetMatch ? targetMatch[1].trim() : null;

        const invStore = getInventoryStore();
        let foundItem = null;
        let foundType = null;
        for (const it of (invStore.items || [])) {
            if (it.qty <= 0) continue;
            let displayName = it.name;
            if (it.type === 'consumable' && it.consumable_id) {
                const def = getConsumableById(it.consumable_id);
                if (def) displayName = def.name;
            } else if (it.type === 'equipment' && it.equipment_id) {
                const def = getEquipmentById(it.equipment_id);
                if (def) displayName = def.name;
            }
            if (displayName === itemName) { foundItem = it; foundType = it.type; break; }
        }
        if (!foundItem) {
            log(`[use_item] 物品 "${itemName}" 不在背包中，跳过`, 'warn');
            continue;
        }
        if (foundType === 'equipment') {
            log(`[use_item] "${itemName}" 是装备，请使用装备/卸下功能，跳过`, 'warn');
            continue;
        }
        if (foundType === 'consumable' && foundItem.consumable_id) {
            const def = getConsumableById(foundItem.consumable_id);
            const hasNumericalEffects = (def?.effects || []).some(e => e.type !== 'narrative');
            if (hasNumericalEffects) {
                try {
                    const results = await useConsumableStore(foundItem.item_id);
                    log(`[use_item] 消耗品 "${itemName}" 使用: ${results.join('; ')}`);
                } catch (e) {
                    log(`[use_item] 消耗品使用失败: ${e.message}`, 'warn');
                }
                await saveStore();
                continue;
            }
        }
        // Material/quest_item/consumable-narrative: just reduce qty
        const reduceQty = Math.min(qty, foundItem.qty || 1);
        foundItem.qty = (foundItem.qty || 1) - reduceQty;
        if (foundItem.qty <= 0) {
            const idx = invStore.items.indexOf(foundItem);
            if (idx >= 0) invStore.items.splice(idx, 1);
        }
        log(`[use_item] 使用 ${itemName} x${reduceQty}${target ? ' (目标: ' + target + ')' : ''}`);
        appendActionLog({ action: 'use_item', itemType: foundType, itemName, qty: reduceQty, target, result: 'success' });
        await saveStore();
    }

    // === <remove_item> === LLM移除物品（丢失/被夺/赠予/销毁，无效果）
    const removeItemMatches = [...rawText.matchAll(/<remove_item([^>]*)>([\s\S]*?)<\/remove_item>/gi)];
    for (const m of removeItemMatches) {
        const attrs = m[1] || '';
        const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
        const qtyMatch = attrs.match(/qty\s*=\s*["']?(\d+)["']?/i);
        if (!nameMatch) { log('[remove_item] 缺少 name，跳过', 'warn'); continue; }
        const itemName = nameMatch[1].trim();
        const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1])) : 1;

        const invStore = getInventoryStore();
        let foundItem = null;
        for (const it of (invStore.items || [])) {
            if (it.qty <= 0) continue;
            let displayName = it.name;
            if (it.type === 'consumable' && it.consumable_id) {
                const def = getConsumableById(it.consumable_id);
                if (def) displayName = def.name;
            } else if (it.type === 'equipment' && it.equipment_id) {
                const def = getEquipmentById(it.equipment_id);
                if (def) displayName = def.name;
            }
            if (displayName === itemName) { foundItem = it; break; }
        }
        if (!foundItem) {
            log(`[remove_item] 物品 "${itemName}" 不在背包中，跳过`, 'warn');
            continue;
        }
        const reduceQty = Math.min(qty, foundItem.qty || 1);
        foundItem.qty = (foundItem.qty || 1) - reduceQty;
        if (foundItem.qty <= 0) {
            const idx = invStore.items.indexOf(foundItem);
            if (idx >= 0) invStore.items.splice(idx, 1);
        }
        log(`[remove_item] 移除 ${itemName} x${reduceQty}`);
        appendActionLog({ action: 'remove_item', itemType: foundItem.type, itemName, qty: reduceQty, result: 'success' });
        await saveStore();
    }
}

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
            renderAllTags(el, rawText, messageId);
        }
        return;
    }
    if (attempts < 20) {
        setTimeout(() => renderMessageWhenReady(messageId, rawText, attempts + 1), 80);
    }
}




// ============================================================
// M8: 事件监听追踪 —— 统一通过 sao-core 的 bindSaoEvent/bindSaoDom 登记，
// deactivate 时 unbindAllSaoEvents 统一移除。避免 ST 扩展热重载/自动更新时监听器翻倍。
// ============================================================
const _bindEvt = bindSaoEvent;
const _bindDom = bindSaoDom;

/** ST 扩展停用钩子：移除所有已登记监听器。 */
export function deactivate() {
    unbindAllSaoEvents();
    document.body.classList.remove('sao-card-active');
    log('SAO Companion 已停用，事件监听已清理');
}


function bindEvents() {
    // M8: 幂等守卫 —— 热重载/重复 init 时先清旧监听再绑新，避免回调翻倍
    if (isSaoEventsBound()) deactivate();
    setSaoEventsBound(true);
    _bindEvt(event_types.CHAT_CHANGED, () => {
        // 切换角色卡时重置效果代码表缓存，使其重新从新卡解析
        resetEffectCodeTable();
        // 会话切换时重置日历模型并发守卫（原 sao-calendar-model.js 顶层监听，M8 集中后改由此处统一追踪）
        resetCalendarModelRunning();
        // 会话切换时重置计算过载回合计数（module-level，防跨 chat 污染）
        resetIncapacitatedTurns();
        document.body.classList.toggle('sao-card-active', isSaoCard());
        if (isSaoCard()) {
            log('聊天切换，加载 per-chat 数据');
            stabilizeSaoRegexScripts();
            enableCompatMode();
            // B3 + Pre-parser: Initialize stores from world book (Phase 1: NPCs, Phase 2: Floors, Phase 3: Timeline)
            // MUST run before initCalendarIfNeeded() so that loreParsed.timelineCount > 0
            // and calendar init skips the legacy _filterTimelineEntries path.
            const char = getCurrentCharacter();
            if (char?.data?.character_book?.entries) {
                const entries = char.data.character_book.entries;
                if (entries.length > 0) {
                    const result = runLorebookPreParser(entries);
                    if (result) {
                        saveStore().catch(e => log('保存 NPC/楼层数据失败: ' + (e.message || e), 'warn'));
                    }
                    log(`Pre-parser 完成: ${entries.length} 条目`);
                }
            }

            // 新游戏初始化：如果是新聊天（仅 first_mes，store 未从 AI 回复中初始化），
            // 从 first_mes 的 <user_status>/<zd_status>/<equip>/<swordskill> 标签提取初始状态。
            // first_mes 不触发 MESSAGE_RECEIVED，状态专家不会运行，store 停留在默认值。
            // 这里手动 extractAll + applyExtractedData 从 first_mes 初始化。
            {
                const chatCtx2 = getContext();
                const chat2 = chatCtx2.chat;
                const store2 = getStore();
                // 判断是否需要从 first_mes 初始化：
                // (a) 聊天仅有 first_mes（chat2.length === 1），且
                // (b) playerStore 完全处于初始状态（无装备、无经验、无技能、无名字、level=1）
                if (chat2 && chat2.length === 1 && store2) {
                    const firstAiMsg = chat2.find(m => m && !m.is_user);
                    if (firstAiMsg && firstAiMsg.mes) {
                        const player = getPlayerStore();
                        const isDefault = !player?.equipment?.weapon
                            && (player?.progression?.level ?? 1) === 1
                            && (player?.progression?.totalExp ?? 0) === 0
                            && (player?.skills?.length ?? 0) === 0
                            && !player?.identity?.name;
                        if (isDefault) {
                            log('检测到新游戏，从 first_mes 初始化 store');
                            (async () => {
                                try {
                                    await processGainTags(firstAiMsg.mes);
                                    await saveStore();
                                    const extracted = await extractAll(firstAiMsg.mes, callModel, null);
                                    if (extracted) {
                                        await applyExtractedData(extracted, CUSTOM_SKILL_DEFS, true);
                                        await saveStore();
                                        log('从 first_mes 初始化完成');
                                        // 重新渲染面板
                                        const el = getMessageElement(chat2.indexOf(firstAiMsg));
                                        if (el) renderAllTags(el, firstAiMsg.mes, chat2.indexOf(firstAiMsg));
                                    }
                                } catch (e) {
                                    log('从 first_mes 初始化失败: ' + e.message, 'warn');
                                }
                            })();
                        }
                    }
                }
            }

            injectMemoryAndState();
            initCalendarIfNeeded();

            // Phase 2: Initialize preset guilds
            initPresetGuilds();

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
                        renderAllTags(histEl, msg.mes || '', idx);
                    }
                });
                // Batching fix: 用单个轮询循环替代 N 条消息各自独立 setTimeout 链
                // 之前每条消息启动 renderMessageWhenReady (20×80ms)，100条消息 = 100个并发定时器链 → 酒馆卡顿/崩溃
                // 现在用单个定时器统一检查所有待渲染消息，每轮最多渲染 5 条，最多 30 轮
                {
                    const pendingMsgs = [];
                    chatCtx.chat.forEach((msg, idx) => {
                        if (!msg || msg.is_user) return;
                        if (idx === lastAiIdx) return;
                        const histEl = getMessageElement(idx);
                        if (!histEl || !histEl.querySelector('.sao-render-host')) {
                            pendingMsgs.push({ idx, text: msg.mes || '' });
                        }
                    });
                    if (pendingMsgs.length > 0) {
                        let batchAttempts = 0;
                        const batchPoll = () => {
                            const remaining = [];
                            let rendered = 0;
                            for (const { idx, text } of pendingMsgs) {
                                const el = getMessageElement(idx);
                                if (el && el.querySelector('.mes_text') && !el.querySelector('.sao-render-host')) {
                                    const msg = chatCtx.chat?.[idx];
                                    if (msg && !msg.is_user) {
                                        renderAllTags(el, text, idx);
                                        rendered++;
                                    }
                                } else if (!el || !el.querySelector('.mes_text')) {
                                    remaining.push({ idx, text });
                                }
                            }
                            // 更新 pending 列表（移除已渲染的，保留 DOM 仍未就绪的）
                            pendingMsgs.length = 0;
                            pendingMsgs.push(...remaining);
                            batchAttempts++;
                            if (pendingMsgs.length > 0 && batchAttempts < 30) {
                                setTimeout(batchPoll, 150);
                            }
                        };
                        setTimeout(batchPoll, 100);
                    }
                }
            }
        } else {
            // 切出 SAO 卡，恢复设置
            disableCompatMode();
        }
    });

    _bindEvt(event_types.MESSAGE_RECEIVED, (..._wrapArgs) => {
        try {
        const _wrapResult = (async (messageId, type) => {
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
        // === 快照：处理该消息前的 store 状态，用于 MESSAGE_DELETED 回滚 ===
        // 包裹 try/catch 防止 structuredClone 失败导致整个 MESSAGE_RECEIVED 处理链中断
        try { captureSnapshot(messageId); } catch (e) { log('captureSnapshot 失败: ' + e.message, 'warn'); }

        await withProcessingLock(`msg-${messageId}`, async () => {
          try {
            // 点10: 专家1始终运行（不再受 toggle 控制）
            await callStatusSpecialist(messageId, rawText);
            // 多任务提取（状态）— P3: 传 messageId，extractAll 优先读 status 专家面板数据
            const extracted = await extractAll(rawText, callModel, messageId);
            const newNpcs = extracted ? await applyExtractedData(extracted, CUSTOM_SKILL_DEFS, false, rawText) : [];

            // P3e: 新 NPC 档案生成（fire-and-forget，非阻塞）
            if (Array.isArray(newNpcs) && newNpcs.length > 0) {
                import('./sao-npc-profile-gen.js').then(({ generateNpcProfiles }) =>
                    generateNpcProfiles(newNpcs, rawText)
                ).catch(e => log('NPC 档案生成失败: ' + e.message, 'warn'));
            }

            // P2b: Calendar incremental update (v1 pure regex, no LLM)
            // await 保证 calendar 变更（含 calendarVersion 递增）在 combat/skill 之前完成，
            // 消除 fire-and-forget 双重保存与潜在未处理 rejection（见 oracle 审查）。
            // Phase 1: 传 messageId 以便写入 calendarPanels[messageId] 瞬时 grid
            await updateCalendarIncremental(rawText, messageId);

            // P4c: Custom skill unlock check
            checkCustomSkillUnlocks(rawText);

            // gain_skill / gain_equipment 标签处理：主LLM决定获取，插件生成数值
            await processGainTags(rawText);

            // 月蚀独特技能解锁检查
            checkUniqueSkillUnlocks();

            // 月蚀：计算过载回合计数（30秒 ≈ 2回合后自动解除）
            {
                const _player = getPlayerStore();
                if (_player?.incapacitated) {
                    if (incrementIncapacitatedTurns() >= 2) {
                        _player.incapacitated = false;
                        resetIncapacitatedTurns();
                        log('[月蚀] 计算过载自动解除（2回合）');
                    }
                } else if (getIncapacitatedTurns() > 0) {
                    resetIncapacitatedTurns();
                }
            }

            // Centralized turn counter increment (per spec §4.4, at end of chain before save)
            const saoData = getSaoData();

            // P2c: Periodic calendar health check (every 20 turns) — v1 consumer of calendarTurnCounter.
            // Also serves as the entry point for v2 trigger condition #4 (see CALENDAR_MODEL_V2_DESIGN.md §3).
            const preIncrement = saoData?.runtime?.calendarTurnCounter || 0;
            if (shouldTriggerPeriodicCalendarCheck({ calendarTurnCounter: preIncrement })) {
                try {
                    const cal = saoData.calendar;
                    if (cal) {
                        const pendingCount = (cal.appointments || []).filter(a => a.status === 'pending').length;
                        const dayCount = Object.keys(cal.days || {}).length;
                        log(`日历周期检查(轮次${preIncrement}): 日期=${cal.currentDate}, 待处理约定=${pendingCount}, 日历天数=${dayCount}`);
                    }
                } catch (e) {
                    log('日历周期检查失败: ' + e.message, 'warn');
                }
            }

            if (!saoData.runtime) saoData.runtime = {};
            saoData.runtime.calendarTurnCounter = (saoData.runtime.calendarTurnCounter || 0) + 1;

            // B6: Quest specialist — check every 5 turns
            const _questTurnCounter = saoData.runtime.calendarTurnCounter;
            const _shouldCheckQuests = (_questTurnCounter % 5 === 0);
            if (_shouldCheckQuests) {
                checkQuestsFromNarrative(rawText, messageId).catch(e =>
                    log('Quest specialist 检查失败: ' + e.message, 'warn')
                );
            }

            // Persist all state changes from this processing cycle
            await saveStore();
          } catch (e) {
            log(`处理链出错(仍会渲染): ${e.message}`, 'error');
          } finally {
            // Phase B: 重渲染所有面板（无论处理是否成功，确保面板始终更新）
            try {
                const el = getMessageElement(messageId);
                if (el) renderAllTags(el, rawText, messageId);
            } catch (e) { log('锁内重渲染失败: ' + e.message, 'warn'); }
          }

            // v2 CALENDAR MODEL: fire-and-forget 触发（发-晚，saveStore 之后、lock 块结束前）。
            // 不 await，不阻塞后处理链。opt-in 由 shouldTriggerCalendarModel 内部守护（§10.2）。
            // 见 CALENDAR_MODEL_V2_DESIGN.md §3/§5.3
            if (shouldTriggerCalendarModel(rawText, saoData)) {
                calendarModelUpdate(rawText)
                    .then(() => {
                        // 点3: LLM 事件同步 — calendarModelUpdate 完成后重新渲染聊天日历 + 插件日历。
                        try {
                            const el = getMessageElement(messageId);
                            if (el) renderAllTags(el, rawText, messageId);
                        } catch (_) {}
                        // 插件控制台日历如果打开则重新渲染
                        try {
                            if (window.SaoPanel && typeof window.SaoPanel.refreshCalendar === 'function') {
                                window.SaoPanel.refreshCalendar();
                            }
                        } catch (_) {}
                    })
                    .catch(e => log('日历模型 fire-and-forget 失败: ' + e.message, 'warn'));
            }

            // P2: 装饰面板专家触发，收集 Promise 以便 settle 后重渲染
            const specialistPromises = fireSpecialistPanels(messageId, rawText);
            if (specialistPromises.length > 0) {
                Promise.allSettled(specialistPromises).then(() => {
                    try {
                        const el = getMessageElement(messageId);
                        if (el) renderAllTags(el, rawText, messageId);
                    } catch (e) { log('专家面板重渲染失败: ' + e.message, 'warn'); }
                });
            }

            // R3: 世界状态专家（fire-and-forget，不阻塞主链）
            callWorldSpecialist(messageId, rawText)
                .catch(e => log('worldStatus 专家失败: ' + e.message, 'warn'));

            // R4: NPC 后台专家（fire-and-forget，每 10 轮触发一次）
            if (shouldTriggerNpcBackground(saoData.runtime?.calendarTurnCounter || 0)) {
                callNpcBackgroundSpecialist(messageId, rawText)
                    .catch(e => log('npcBackground 专家失败: ' + e.message, 'warn'));
            }
        });

        // 状态提取完成后刷新面板（如果已打开）
        if (document.getElementById('sao_panel_overlay')?.style.display === 'block') {
            refreshStatus();
        }

        // 新消息的 Shadow DOM 渲染已由 CHARACTER_MESSAGE_RENDERED 事件接管（见 H1）

        })(..._wrapArgs);
        if (_wrapResult && typeof _wrapResult.catch === 'function') {
            _wrapResult.catch(e => log(`MESSAGE_RECEIVED handler error: ${e.message}`, 'error'));
        }
        } catch (e) {
            log(`MESSAGE_RECEIVED handler error: ${e.message}`, 'error');
        }
    });

    _bindEvt(event_types.GENERATION_AFTER_COMMANDS, () => {
        if (!isSaoCard()) return;
        injectMemoryAndState();
    });

    // Phase 3: Chat Completion 兜底 — 替代 promptOnly 隐藏正则
    if (event_types.CHAT_COMPLETION_PROMPT_READY) {
        _bindEvt(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
            if (!isSaoCard()) return;
            const settings = getSettings();
            if (!settings.enabled) return;

            if (data.chat && Array.isArray(data.chat)) {
                const ctx = getContext();
                const stripTimeline = typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported();
                for (const msg of data.chat) {
                    if (typeof msg.content === 'string' && msg.content) {
                        msg.content = cleanSaoPromptText(msg.content);
                        if (stripTimeline) msg.content = cleanTimelinePromptText(msg.content);
                    }
                }
            }
        });
    } else {
        console.debug('[SAO Companion] event CHAT_COMPLETION_PROMPT_READY not available in this SillyTavern version, prompt-cleaning fallback skipped');
    }

    // Phase 3: Text Completion 兜底 — 替代 promptOnly 隐藏正则
    if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
        _bindEvt(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
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
        _bindEvt(event_types.MESSAGE_SWIPED, (messageId) => {
            if (!isSaoCard()) return;
            _clearSpecialistPanels(messageId);
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '', messageId);
            // P2: swipe 后重新触发装饰专家 + P3 status 专家
            // C6: Phase C — renderUserStatus 优先从 store projection 渲染（specialist 写 store → projection 读 store）
            // panel 缓存仅作 fallback，权威数据在 store 中
            // 点10: 专家始终运行（不再受 toggle 控制）
            callStatusSpecialist(messageId, msg.mes || '')
                .then(() => { const el2 = getMessageElement(messageId); if (el2) renderAllTags(el2, msg.mes || '', messageId); })
                .catch(e => log('swipe 重触发 status 专家失败: ' + e.message, 'warn'));
            const specialistPromises = fireSpecialistPanels(messageId, msg.mes || '');
            if (specialistPromises.length > 0) {
                Promise.allSettled(specialistPromises).then(() => {
                    try {
                        const el3 = getMessageElement(messageId);
                        if (el3) renderAllTags(el3, msg.mes || '', messageId);
                    } catch (e) { log('swipe 专家面板重渲染失败: ' + e.message, 'warn'); }
                });
            }
        });
    }
    // 消息编辑后重新渲染
    if (event_types.MESSAGE_EDITED) {
        _bindEvt(event_types.MESSAGE_EDITED, (messageId) => {
            if (!isSaoCard()) return;
            _clearSpecialistPanels(messageId);
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '', messageId);
            // P2: 编辑后重新触发装饰专家 + P3 status 专家
            // C6: Phase C — renderUserStatus 优先从 store projection 渲染（specialist 写 store → projection 读 store）
            // panel 缓存仅作 fallback，权威数据在 store 中
            // 点10: 专家始终运行（不再受 toggle 控制）
            callStatusSpecialist(messageId, msg.mes || '')
                .then(() => { const el2 = getMessageElement(messageId); if (el2) renderAllTags(el2, msg.mes || '', messageId); })
                .catch(e => log('edit 重触发 status 专家失败: ' + e.message, 'warn'));
            const specialistPromises = fireSpecialistPanels(messageId, msg.mes || '');
            if (specialistPromises.length > 0) {
                Promise.allSettled(specialistPromises).then(() => {
                    try {
                        const el3 = getMessageElement(messageId);
                        if (el3) renderAllTags(el3, msg.mes || '', messageId);
                    } catch (e) { log('edit 专家面板重渲染失败: ' + e.message, 'warn'); }
                });
            }
        });
    }

    // 消息删除后回滚 store 状态并重新渲染面板
    // 方案 A：恢复被删消息处理前的 store 快照，清除该消息及之后的专家面板缓存，
    // 然后重新渲染剩余消息的面板。store 状态正确回滚；面板视觉在下条消息时
    // 由专家刷新（或立即从 store projection 渲染）。
    if (event_types.MESSAGE_DELETED) {
        _bindEvt(event_types.MESSAGE_DELETED, (messageId) => {
            if (!isSaoCard()) return;

            // 1. 恢复快照（被删消息处理前的 store 状态）
            const restored = restoreSnapshot(messageId);

            // 2. 清理被删消息及之后所有消息的专家面板缓存
            //    （ST 删除消息后后续索引下移，旧面板缓存已失效）
            _clearSpecialistPanels(messageId);
            const d = getSaoData();
            if (d?.panels) {
                for (const key of Object.keys(d.panels)) {
                    if (parseInt(key) >= messageId) delete d.panels[key];
                }
            }
            if (d?.calendarPanels) {
                for (const key of Object.keys(d.calendarPanels)) {
                    if (parseInt(key) >= messageId) delete d.calendarPanels[key];
                }
            }

            // 3. 保存回滚后的 store
            saveStore().catch(e => log('删除消息后保存 store 失败: ' + e.message, 'warn'));

            // 4. 重新渲染剩余消息的面板（从 store projection 渲染，刷新视觉）
            const ctx = getContext();
            if (ctx.chat && ctx.chat.length > 0) {
                for (let i = Math.max(0, messageId); i < ctx.chat.length; i++) {
                    const msg = ctx.chat[i];
                    if (!msg || msg.is_user) continue;
                    const el = getMessageElement(i);
                    if (el) renderAllTags(el, msg.mes || '', i);
                }
            }
            log(`消息 ${messageId} 已删除，store ${restored ? '已回滚' : '无快照可回滚'}，面板已重渲染`);
        });
    }

    // 角色（AI）消息 DOM 渲染完成后渲染 tags（替代 MESSAGE_RECEIVED 中的 renderAllTags）
    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        _bindEvt(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            const msg = ctx.chat?.[messageId];
            if (!msg || msg.is_user) return;

            // 判断是否是最后一条消息
            const isLatest = (messageId === ctx.chat.length - 1);
            if (isLatest) {
                // 最新消息：检查是否已有 shadow host
                const msgEl = getMessageElement(messageId);
                if (msgEl && !msgEl.querySelector('.sao-render-host')) {
                    // 无 shadow host：可能是重新加载的旧消息（MESSAGE_RECEIVED 不会触发）
                    // 延迟渲染兜底：如果是新消息，MESSAGE_RECEIVED 会先渲染（createSaoShadowHost 去重）
                    // 如果是重新加载的旧消息，2秒后延迟渲染兜底
                    log(`CHARACTER_MESSAGE_RENDERED: 延迟渲染最新消息 #${messageId}（兜底重载场景）`);
                    setTimeout(() => {
                        const el = getMessageElement(messageId);
                        if (!el || el.querySelector('.sao-render-host')) return; // 已渲染或不存在
                        const ctx2 = getContext();
                        const msg2 = ctx2.chat?.[messageId];
                        if (!msg2 || msg2.is_user) return;
                        renderAllTags(el, msg2.mes || '', messageId);
                        log(`CHARACTER_MESSAGE_RENDERED: 延迟渲染完成 #${messageId}`);
                    }, 2000);
                    return;
                }
                // 已有 shadow host（swipe/编辑场景）→ 重新渲染
                if (msgEl) renderAllTags(msgEl, msg.mes || '', messageId);
                return;
            }

            // 历史消息：直接渲染
            const msgEl = getMessageElement(messageId);
            if (msgEl) renderAllTags(msgEl, msg.mes || '', messageId);
        });
    }

    // 滚动加载更多历史消息后批量渲染
    if (event_types.MORE_MESSAGES_LOADED) {
        _bindEvt(event_types.MORE_MESSAGES_LOADED, () => {
            if (!isSaoCard()) return;
            const ctx = getContext();
            if (ctx.chat && ctx.chat.length > 0) {
                ctx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    const histEl = getMessageElement(idx);
                    if (histEl && !histEl.querySelector('.sao-render-host')) {
                        renderAllTags(histEl, msg.mes || '', idx);
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
    if (bodyEl) bodyEl.innerHTML = DOMPurify.sanitize(html);
    // 遗忘技能按钮事件绑定
    bodyEl?.querySelectorAll('[data-sao-action="forget-skill"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const skillId = btn.dataset.saoSkillId;
            if (!skillId) return;
            if (!confirm('确定遗忘此剑技？此操作不可撤销。')) return;
            try {
                await forgetPlayerSkill(skillId);
                closeDetailModal();
                refreshStatus();
            } catch (e) {
                log('遗忘技能失败: ' + e.message, 'warn');
            }
        });
    });
    if (modal) {
        modal.style.display = 'flex';
        // 聚焦模态层以激活 Esc 键关闭（panel.html 中 onkeydown 监听需 focus 才能触发）
        if (typeof modal.focus === 'function') modal.focus();
    }
}

function closeDetailModal() {
    const modal = document.getElementById('sao_detail_modal');
    if (modal) modal.style.display = 'none';
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
    return renderDetailSkill(sk, describeEnCode);
}

function renderInventoryDetail(item) {
    // Equipment type: delegate to renderDetailEquip with full equipment data
    if (item.type === 'equipment' && item.equipment_id) {
        const eq = getEquipmentById(item.equipment_id);
        if (eq) {
            const detailHtml = renderDetailEquip(eq);
            // R5: 装备按钮 + 丢弃按钮
            return detailHtml + `<div style="margin-top:12px;text-align:center;display:flex;gap:10px;justify-content:center;">` +
                `<button class="sao-btn" data-action="equipFromInventory" data-equipment-id="${esc(item.equipment_id)}">装备</button>` +
                `<button class="sao-btn sao-btn-secondary" data-action="discardEquipment" data-equipment-id="${esc(item.equipment_id)}">丢弃</button>` +
                `</div>`;
        }
    }
    const detailHtml = renderDetailInv(item);
    if (item.type === 'consumable' && item.item_id) {
        return detailHtml + `<div style="margin-top:12px;text-align:center;"><button class="sao-btn" data-action="useConsumable" data-item-id="${esc(item.item_id)}">使用</button></div>`;
    }
    return detailHtml;
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

// ============================================================
// 数据存储浏览器 — schema/config 常量 + 字段递归渲染 + 编辑应用 helpers
// 这些都是 module-level 常量,window.SaoPanel 方法通过名字引用。
// ============================================================

const _dataStoreDefs = [
    { key: 'player',     label: '玩家',     kind: 'player',     get: () => getPlayerStore() },
    { key: 'world',      label: '世界',     kind: 'world',      get: () => getWorldStore() },
    { key: 'calendar',   label: '日历',     kind: 'calendar',   get: () => getStore().calendarStore },
    { key: 'npc',        label: 'NPC',     kind: 'collection', idField: 'npc_id',       get: () => getNpcStore() },
    { key: 'floor',      label: '楼层',     kind: 'collection', idField: 'floor_id',     get: () => getFloorStoreWithCanon() },  // 合并内存态 canon 供 UI 显示
    { key: 'equipment',  label: '装备',     kind: 'collection', idField: 'equipment_id', get: () => getEquipmentStore() },
    { key: 'skill',      label: '技能',     kind: 'collection', idField: 'skill_id',     get: () => getSkillStore() },
    { key: 'consumable', label: '消耗品',   kind: 'collection', idField: 'consumable_id', get: () => getConsumableStore() },
    { key: 'quest',      label: '任务',     kind: 'collection', idField: 'quest_id',     get: () => getQuestStore() },
    { key: 'inventory',  label: '背包',     kind: 'inventory',  get: () => getInventoryStore() },
    { key: 'runtime',    label: '运行时',   kind: 'runtime',    get: () => getStore().runtime },
];

// 字段 ID 形如 _xxx / xxx_id / xxx_hash 的视为只读元信息
function isReadOnlyKey(k) {
    return /^_/.test(k) || /_id$/.test(k) || /_hash$/.test(k) || /^source$/.test(k);
}

function formatValAsText(v) {
    if (v == null) return '(null)';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    return String(v);
}
function safeJsonStringify(v, maxLen) {
    let s; try { s = JSON.stringify(v); } catch (_) { return String(v); }
    if (typeof maxLen === 'number' && s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s;
}
function rowHtml(label, inputHtml) {
    return '<div class="sao-store-field-row"><label class="sao-store-field-label">' + esc(label) + '</label>' + inputHtml + '</div>';
}
function rowHtmlMulti(label, inputHtml) {
    return '<div class="sao-store-field-row sao-multiline"><label class="sao-store-field-label">' + esc(label) + '</label>' + inputHtml + '</div>';
}
function rowScalar(label, inputHtml, isCheckbox) {
    return '<div class="sao-store-field-row' + (isCheckbox ? ' sao-bool-row' : '') + '"><label class="sao-store-field-label">' + esc(label) + '</label>' + inputHtml + '</div>';
}
function lastPathSegment(p) {
    const seg = p.split('|');
    return seg[seg.length - 1];
}

// dot-path(|) → 在对象层级中取最后一段之前的路径对应的对象
function pathGet(root, path) {
    if (!root || !path) return root;
    const seg = path.split('|');
    let cur = root;
    for (const k of seg) {
        if (cur == null) return undefined;
        cur = cur[k];
    }
    return cur;
}
function pathSet(root, path, val) {
    const seg = path.split('|');
    let cur = root;
    for (let i = 0; i < seg.length - 1; i++) cur = (cur || {})[seg[i]];
    if (cur != null) cur[seg[seg.length - 1]] = val;
}

// 编辑应用:递归收集所有 data-field-path leaf input,parse 后写回 target
function _dataApplyEdits(rootEl, target) {
    if (!rootEl || !target) return;
    const list = rootEl.querySelectorAll('[data-field-path]');
    list.forEach(el => {
        const path = el.getAttribute('data-field-path');
        const type = el.getAttribute('data-field-type');
        let val;
        if (type === 'bool') val = !!el.checked;
        else if (type === 'number') val = el.value === '' ? 0 : (parseFloat(el.value) || 0);
        else if (type === 'scalar-null') {
            val = el.value === '' ? null : el.value;
        } else {
            val = el.value;
        }
        pathSet(target, path, val);
    });
}

// 编辑应用:calendar 事件现用字段化编辑(data-field-path)，由 _dataApplyEdits 统一处理，
// 不再需要独立的 JSON textarea 解析。旧 _dataApplyCalEventEdits 已删除。

// 单个 store 状态显示
function _dataSetStatus(storeKey, entryId, kind, message) {
    const selector = '[data-store-status="' + (entryId ? storeKey + '|' + entryId : storeKey) + '"]';
    const el = document.querySelector(selector);
    if (!el) return;
    if (kind === 'ok') {
        el.className = 'sao-store-status-ok';
        el.textContent = message;
        el.style.display = 'inline-block';
        setTimeout(() => { el.style.display = 'none'; }, 2400);
    } else {
        el.className = 'sao-store-status-err';
        el.textContent = message;
        el.style.display = 'inline-block';
    }
}

// 解析当前编辑目标(SaoPanel方法用,落到 store 里具体对象)
function _dataResolveTarget(def, entryId) {
    if (!def) return null;
    const data = safe(() => def.get());
    if (!data) return null;
    if (def.kind === 'inventory' || def.kind === 'world' || def.kind === 'player' || def.kind === 'calendar' || def.kind === 'runtime') return data;
    return (data.byId || {})[entryId];
}

// 集合字段 schema(目前仅作 hint,真实渲染按运行时类型推断)
const _dataCollectionSchemas = {
    npc_id: {
        name: 'string',
        aliases: ['string'], // array of strings
        canon: { characterName: 'string' },
        state: { relationship: 'string', affinity: 'number', floor_id: 'string', location: 'string', last_seen_date: 'string', status: ['string'] },
        observations: ['string'],
        uniqueSkill: { id: 'string', name: 'string' },
    },
    floor_id: {
        floor_number: 'number',
        name: 'string',
        canon: { theme: 'string', mainTown: 'string', labyrinth: 'string', boss: 'string' },
        state: { unlocked: 'bool', cleared: 'bool', discovered_locations: ['string'], notes: ['string'] },
    },
    equipment_id: {
        name: 'string', slot: 'string', item_level: 'number', rarity: 'string',
        stats: { atk: 'number', str: 'number', agi: 'number', int: 'number', vit: 'number', maxHp: 'number', maxMp: 'number', hit: 'number', crit: 'number' },
        effects: ['string'],
    },
    skill_id: {
        name: 'string', weapon_type: 'string', skill_level: 'number',
        combat: { atk: 'number', hitRate: 'number', critRate: 'number', attacksPerTurn: 'number', mpCost: 'number', cd: 'number', targetsPerAttack: 'number' },
        description: 'string',
    },
    consumable_id: {
        name: 'string', description: 'string', category: 'string', rarity: 'string', item_level: 'number',
        effects: [{ type: 'string', stat: 'string', amount: 'number', duration: 'number' }],
    },
    quest_id: {
        title: 'string', summary: 'string', status: 'string', kind: 'string',
        objectives: [{ text: 'string', done: 'bool', objective_id: 'string' }],
        reward_hint: 'string',
    },
};

const _dataPlayerSchema = {
    player_id: 'string',
    identity: { name: 'string', title: 'string' },
    vitals: { hp: 'number', maxHp: 'number', mp: 'number', maxMp: 'number' },
    attributes: { str: 'number', agi: 'number', int: 'number', vit: 'number' },
    progression: { level: 'number', totalExp: 'number' },
    position: { floor_id: 'string', location: 'string' },
    cursor_type: 'string',
    equipment: { weapon: 'string', off_hand: 'string', head: 'string', chest: 'string', hands: 'string', legs: 'string', accessory: 'string' },
    skills: [{ skill_id: 'string', name: 'string', proficiency: 'number' }],
    meditationProficiency: 'number',
    uniqueSkill: { id: 'string', name: 'string', title: 'string', buffLevel: 'number', subTechniques: {} },
    incapacitated: 'boolean',
    buffs: { temporary: [{ id: 'string', name: 'string', effects: {} }], permanent: [{ id: 'string', name: 'string', effects: {} }] },
    customSkills: ['string'],
    guild_id: 'string',
    _baseVitals: { hp: 'number', maxHp: 'number', mp: 'number', maxMp: 'number' },
};

const _dataInventoryItemSchema = {
    item_id: 'string', type: 'string', name: 'string', qty: 'number', equipment_id: 'string', consumable_id: 'string', description: 'string',
};
const _dataAppointmentSchema = {
    id: 'string', date: 'string', title: 'string', type: 'string', description: 'string', participants: 'string', location: 'string', status: 'string',
};
const _dataAppointmentDefaults = { id: '', date: '', title: '', type: 'custom', description: '', participants: '', location: '', status: 'pending' };
// 日历事件字段 schema（数据存储编辑器用，字段化而非 JSON）
const _dataCalEventSchema = {
    event_id: 'string', type: 'string', description: 'string', time: 'string', source: 'string',
};
const _dataCalEventDefaults = { event_id: '', type: 'custom', description: '', time: '', source: '' };

// 数据存储字段中文名映射：英文 → 中文(英文)。未列出的字段直接显示英文。
const _dataFieldLabels = {
    // 玩家
    player_id: '玩家ID(player_id)', name: '名称(name)', title: '称号(title)', level: '等级(level)',
    totalExp: '总经验(totalExp)', exp: '经验(exp)', str: '力量(str)', agi: '敏捷(agi)',
    vit: '体力(vit)', dex: '灵巧(dex)', luk: '幸运(luk)', int: '智力(int)',
    hp: '生命值(hp)', mp: '法力值(mp)', sp: '体力值(sp)',
    currentHp: '当前生命(currentHp)', currentMp: '当前法力(currentMp)', currentSp: '当前体力(currentSp)',
    maxHp: '最大生命(maxHp)', maxMp: '最大法力(maxMp)', maxSp: '最大体力(maxSp)',
    atk: '攻击力(atk)', def: '防御力(def)', hitRate: '命中率(hitRate)', critRate: '暴击率(critRate)',
    evasion: '闪避率(evasion)', attacksPerTurn: '每回合攻击次数(attacksPerTurn)',
    skillPoints: '技能点(skillPoints)', statusEffects: '状态效果(statusEffects)',
    equipment: '装备(equipment)', skills: '技能(skills)', inventory: '背包(inventory)',
    location: '位置(location)', coordinates: '坐标(coordinates)',
    col: '珂尔(col)', currency: '货币(currency)',
    // 世界
    currentWeather: '当前天气(currentWeather)', condition: '天气状况(condition)',
    temperature: '温度(temperature)', areaStatus: '区域状态(areaStatus)',
    danger_level: '危险等级(danger_level)', zone_type: '区域类型(zone_type)',
    description: '描述(description)', worldEvents: '世界事件(worldEvents)',
    event: '事件(event)', date: '日期(date)', floor_id: '楼层ID(floor_id)',
    // NPC
    npc_id: 'NPC ID(npc_id)', relationship: '关系(relationship)', status: '状态(status)',
    // 楼层
    floor_number: '楼层数(floor_number)', boss: 'Boss(boss)', cleared: '已通关(cleared)',
    // 装备
    equipment_id: '装备ID(equipment_id)', rarity: '稀有度(rarity)', slot: '槽位(slot)',
    type: '类型(type)',
    // 技能
    skill_id: '技能ID(skill_id)', damage: '伤害(damage)', cost: '消耗(cost)',
    cooldown: '冷却时间(cooldown)',
    // 消耗品
    consumable_id: '消耗品ID(consumable_id)', qty: '数量(qty)', effect: '效果(effect)',
    // 任务
    quest_id: '任务ID(quest_id)', objectives: '目标(objectives)', rewards: '奖励(rewards)',
    // 公会
    guild_id: '公会ID(guild_id)', members: '成员(members)', leader: '会长(leader)',
    // 日历
    currentDate: '当前日期(currentDate)', appointments: '约定(appointments)',
    events: '事件列表(events)', time: '时间(time)', participants: '参与人(participants)',
    event_id: '事件ID(event_id)', source: '来源(source)',
    // 背包
    owner_id: '所有者ID(owner_id)', items: '物品列表(items)', item_id: '物品ID(item_id)',
    // 通用
    id: 'ID(id)', createdAt: '创建时间(createdAt)', updatedAt: '更新时间(updatedAt)',
    related_npc_ids: '关联NPC(related_npc_ids)', related_quest_ids: '关联任务(related_quest_ids)',
    // 楼层 canon 子对象
    canon: '原作数据(canon)', theme: '主题(theme)', mainTown: '主城(mainTown)',
    labyrinth: '迷宫(labyrinth)',
    // 楼层 state 子对象
    state: '状态(state)', unlocked: '已解锁(unlocked)', discovered_locations: '已发现地点(discovered_locations)',
    notes: '笔记(notes)',
    // 玩家子对象
    vitals: '生命体征(vitals)', attributes: '属性(attributes)', progression: '成长(progression)',
    position: '位置(position)', cursor_type: '光标类型(cursor_type)',
    // 装备槽位
    weapon: '武器(weapon)', off_hand: '副手(off_hand)', head: '头部(head)',
    chest: '胸部(chest)', hands: '手部(hands)', legs: '腿部(legs)', accessory: '饰品(accessory)',
    // 装备/技能额外字段
    proficiency: '熟练度(proficiency)', affixes: '附魔(affixes)', item_level: '物品等级(item_level)',
    effects: '效果(effects)', stats: '属性(stats)', max_hp: '最大HP(max_hp)',
    combat: '战斗(combat)',
    // 技能 effects 子字段
    wn: '核心功能(wn)', en: '词条(en)',
    // 房屋
    playerHousing: '玩家房屋(playerHousing)', housing: '房屋(housing)',
    // quest
    title: '标题(title)',
    // affixes/store
    affix: '词条(affix)', affix_id: '词条ID(affix_id)',
    // runtime/其他
    runtime: '运行时(runtime)', panels: '面板(panels)',
    // 世界 events 子字段
    floor_id: '楼层ID(floor_id)',
    // 月蚀独特技能
    meditationProficiency: '冥想熟练度(meditationProficiency)',
    uniqueSkill: '独特技能(uniqueSkill)',
    incapacitated: '计算过载(incapacitated)',
    buffLevel: '增益等级(buffLevel)',
    subTechniques: '子技(subTechniques)',
    unlocked: '已解锁(unlocked)',
    unlockedAt: '解锁于(unlockedAt)',
    genmu: '现梦(genmu)',
    tsuki_no_shizuku: '月之滴(tsuki_no_shizuku)',
    mangekyou: '星夜万华镜(mangekyou)',
    kami_no_inori: '神明的祈祷(kami_no_inori)',
    shisou_rennai: '死奏怜音(shisou_rennai)',
    sanzen_sekai: '三千世界(sanzen_sekai)',
    // 玩家 store 其他
    buffs: '增益效果(buffs)',
    customSkills: '自定义技能(customSkills)',
    _baseVitals: '基础血量(_baseVitals)',
};

/** 字段标签：有中文名则返回 中文(英文)，否则返回原文。 */
function fieldLabel(key) {
    return _dataFieldLabels[key] || key;
}

/** 数字转中文数字（1→一, 10→十, 11→十一, 25→二十五, 100→一百）。用于楼层显示。 */
function _toChineseNumeral(n) {
    const digits = '零一二三四五六七八九';
    if (n === 100) return '一百';
    if (n >= 10 && n < 20) return '十' + (n > 10 ? digits[n - 10] : '');
    if (n >= 20) {
        const tens = Math.floor(n / 10);
        const ones = n % 10;
        return digits[tens] + '十' + (ones ? digits[ones] : '');
    }
    return digits[n];
}

// 递归渲染 fields (category: <fieldset> of <field row>)
function _dataRenderFields(obj, pathPrefix, storeKey, schema, allowNested, self) {
    if (!obj || typeof obj !== 'object') return '';
    const keys = Object.keys(obj);
    const schemaFor = schema || null;
    const html = keys.map(key => {
        const val = obj[key];
        const fullPath = pathPrefix ? pathPrefix + '|' + key : key;
        const label = fieldLabel(key);
        if (isReadOnlyKey(key)) {
            return rowHtml(label, '<div class="sao-store-field-readonly" title="' + esc(key) + '">' + esc(formatValAsText(val)) + '</div>');
        }
        if (val === null || typeof val === 'undefined') {
            return rowHtml(label, '<input type="text" class="sao-store-field-input" data-field-path="' + esc(fullPath) + '" data-field-type="scalar-null" value="" placeholder="(空)">');
        }
        if (typeof val === 'boolean') {
            return rowScalar(label, '<label class="sao-store-field-bool"><input type="checkbox" data-field-path="' + esc(fullPath) + '" data-field-type="bool" ' + (val ? 'checked' : '') + '> ' + (val ? '启用' : '关闭') + '</label>', true);
        }
        if (typeof val === 'number') {
            return rowHtml(label, '<input type="number" class="sao-store-field-input" data-field-path="' + esc(fullPath) + '" data-field-type="number" value="' + esc(val) + '">');
        }
        if (typeof val === 'string') {
            if (val.length > 80) {
                return rowHtmlMulti(label, '<textarea class="sao-store-field-textarea" data-field-path="' + esc(fullPath) + '" data-field-type="string" rows="3">' + esc(val) + '</textarea>');
            }
            return rowHtml(label, '<input type="text" class="sao-store-field-input" data-field-path="' + esc(fullPath) + '" data-field-type="string" value="' + esc(val) + '">');
        }
        if (Array.isArray(val)) {
            return _dataRenderArrayField(fullPath, val, { storeKey, topLabel: label }, self);
        }
        if (typeof val === 'object') {
            const innerSchema = (schemaFor && typeof schemaFor === 'object' && !Array.isArray(schemaFor)) ? (schemaFor[key]) : null;
            const nested = _dataRenderFields(val, fullPath, storeKey, innerSchema, true, self);
            return '<div class="sao-store-sub-section"><div class="sao-store-sub-section-title">' + esc(label) + '</div>' + nested + '</div>';
        }
        return rowHtml(label, '<div class="sao-store-field-readonly">' + esc(String(val)) + '</div>');
    }).join('');
    return html;
}

function _dataRenderArrayField(path, arr, opts, self) {
    const topLabel = opts.topLabel || lastPathSegment(path);
    const isObject = (opts.isObject === true) || (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null);
    // 点17: itemTitleKey 指定用哪个字段作为每条的标题(如 inventory items 用 name)
    const titleKey = opts.itemTitleKey || null;
    if (isObject) {
        const schema = opts.schema || _dataInventoryItemSchema;
        const addDefaults = opts.addDefaults || { name: '', value: 0 };
        const items = arr.map((it, idx) => {
            const inner = _dataRenderFields(it, path + '|' + idx, opts.storeKey || '', schema, true, self);
            const itemTitle = (titleKey && it && it[titleKey]) ? '<div class="sao-store-array-item-title">' + esc(String(it[titleKey])) + '</div>' : '';
            return '<div class="sao-store-array-item"><div class="sao-store-array-item-fields">' + itemTitle + inner + '</div><button class="sao-store-array-remove" data-action="storeArrayRemove" data-array-path="' + esc(path) + '" data-array-idx="' + idx + '" title="删除 ' + (idx + 1) + '/' + arr.length + '">×</button></div>';
        }).join('');
        return '<div class="sao-store-sub-section"><div class="sao-store-sub-section-title">' + esc(topLabel) + ' · ' + arr.length + ' 项（对象数组）</div>' + items + '<button class="sao-store-array-add" data-action="storeArrayAdd" data-array-path="' + esc(path) + '" data-array-defaults="' + esc(JSON.stringify([addDefaults])) + '">+ 添加</button></div>';
    }
    const rows = arr.map((item, idx) => {
        const val = item == null ? '' : String(item);
        return '<div class="sao-store-array-row"><input type="text" class="sao-store-field-input" data-field-path="' + esc(path) + '|' + idx + '" data-field-type="string" value="' + esc(val) + '"><button class="sao-store-array-remove" data-action="storeArrayRemove" data-array-path="' + esc(path) + '" data-array-idx="' + idx + '" title="删除">×</button></div>';
    }).join('');
    return '<div class="sao-store-sub-section"><div class="sao-store-sub-section-title">' + esc(topLabel) + ' · ' + arr.length + ' 项</div>' + rows + '<button class="sao-store-array-add" data-action="storeArrayAdd" data-array-path="' + esc(path) + '" data-array-defaults="[]">+ 添加</button></div>';
}

function initPanelLogic() {
    // ============================================================
    // P2c: Calendar tab UI
    // ============================================================

    let _calViewDate = null;
    let _calSelectedDate = null;

    function getCalendar() {
        const dataCal = getSaoData()?.calendar;
        if (!dataCal) return dataCal;
        // P0-2: 合并 calendarStore 数据，确保 LLM 新增约定在 UI 可见
        const calStore = getStore()?.calendarStore;
        if (!calStore) return dataCal;
        // 用 calendarStore 的 currentDate 覆盖（更权威）
        if (calStore.currentDate) dataCal.currentDate = calStore.currentDate;
        // 合并 calendarStore.appointments 到 dataCal.appointments（按 id 去重）
        if (Array.isArray(calStore.appointments) && calStore.appointments.length > 0) {
            const existingIds = new Set((dataCal.appointments || []).map(a => a.id));
            for (const apt of calStore.appointments) {
                if (apt.id && !existingIds.has(apt.id)) {
                    if (!dataCal.appointments) dataCal.appointments = [];
                    dataCal.appointments.push(apt);
                    existingIds.add(apt.id);
                }
            }
        }
        // 合并 calendarStore.events 到 dataCal.days（兼容 UI 渲染层 days 结构）
        if (calStore.events && typeof calStore.events === 'object') {
            if (!dataCal.days) dataCal.days = {};
            for (const [dateStr, events] of Object.entries(calStore.events)) {
                if (!Array.isArray(events) || events.length === 0) continue;
                if (!dataCal.days[dateStr]) dataCal.days[dateStr] = { events: [] };
                const existingTitles = new Set(
                    (dataCal.days[dateStr].events || []).map(e => e.title || e.description || '')
                );
                for (const ev of events) {
                    const key = ev.title || ev.description || '';
                    if (key && !existingTitles.has(key)) {
                        dataCal.days[dateStr].events.push({
                            type: ev.type || 'custom',
                            title: ev.title || '',
                            description: ev.description || '',
                            time: ev.time || null,
                            source: ev.source || '',
                        });
                        existingTitles.add(key);
                    }
                }
            }
        }
        return dataCal;
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
        // 一次渲染只解析一次世界书时间线（避免每格重复解析）。缓存按角色名，切换角色自动失效。
        const cleanDaysMap = buildCleanCalendarDays(cal?.currentDate);

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
            cells += buildCalCell(year, month - 2, d, false, todayStr, cleanDaysMap);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells += buildCalCell(year, month - 1, d, true, todayStr, cleanDaysMap);
        }
        const totalCells = startDay + daysInMonth;
        const remaining = (7 - (totalCells % 7)) % 7;
        for (let d = 1; d <= remaining; d++) {
            cells += buildCalCell(year, month, d, false, todayStr, cleanDaysMap);
        }

        grid.innerHTML = headers + cells;
    }

    function buildCalCell(year, monthIndex, day, isCurrentMonth, todayStr, cleanDaysMap) {
        const date = new Date(year, monthIndex, day);
        const dateStr = formatDate(date);
        const cal = getCalendar();
        // M2: 控制台格子改用与详情弹窗一致的 clean+apt 合并，而非直接读可能污染的 cal.days。
        // 干净 canon 从世界书重新解析(buildCleanCalendarDays)，约定/自定义从 cal.days 取非 canon 类。
        // 优化：cleanDaysMap 由 renderCalendarMonth 传入，避免每格重复解析世界书。
        const cleanDays = cleanDaysMap || buildCleanCalendarDays(cal?.currentDate);
        const cleanEvents = cleanDays?.[dateStr]?.events || [];
        const dirtyEvents = cal?.days?.[dateStr]?.events || [];
        const aptEvents = dirtyEvents.filter(ev => ev.type !== 'canon' && ev.date === dateStr);
        const events = [...cleanEvents, ...aptEvents];

        // 共享格子构建：与聊天栏同一份代码，保证两边样式/绿点/正文一致。
        // 控制台额外传 dataAction="calSelectDay"（事件委托）+ isSelected（选中态高亮）。
        return buildCalCellHtml({
            dateStr,
            day,
            isCurrentMonth,
            isToday: dateStr === todayStr,
            isSelected: dateStr === _calSelectedDate,
            events,
            dataAction: 'calSelectDay',
        });
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
        // Bug#render-1: 侧栏详情应与格子(buildCalCell)/弹窗(buildCalendarDayEventsHtml)用同一份合并数据，
        // 否则 cal.days 里的陈旧 canon 事件只在此处显示，三处视图不一致。
        const cleanDays = buildCleanCalendarDays(_calSelectedDate);
        const cleanEvents = cleanDays?.[_calSelectedDate]?.events || [];
        const dirtyEvents = cal?.days?.[_calSelectedDate]?.events || [];
        const aptEvents = dirtyEvents.filter(ev => ev.type !== 'canon');
        const events = [...cleanEvents, ...aptEvents];

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
                ${evt.description && evt.title && evt.description !== evt.title ? `<div class="sao-cal-event-meta">${esc(evt.description)}</div>` : ''}
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
        const typeEl = document.getElementById('sao_cal_input_type');
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
            if (typeEl) typeEl.value = 'custom';
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

    function buildCalendarDayEventsHtml(dateStr) {
        const cal = getCalendar();
        // 合并：干净 canon 数据（从世界书重新解析）+ 约定/自定义事件（从 cal.days）
        const cleanDays = buildCleanCalendarDays(cal?.currentDate);
        const cleanEvents = cleanDays?.[dateStr]?.events || [];
        const rawEvents = cal?.days?.[dateStr]?.events || [];
        // 从 cal.days 只取 appointment 和 custom 类型（canon 用干净的）
        // Bug#render-3: 编辑/删除按钮的 data-idx 必须指向 cal.days 原始数组索引（handler 据此查找），
        // 而非合并数组索引——否则会编辑/删除错误事件（甚至只读的 canon 事件）。
        // canon 事件来自世界书，只读，不显示编辑/删除按钮。
        const nonCanonRawIndices = [];
        const aptEvents = [];
        rawEvents.forEach((ev, rawIdx) => {
            if (ev.type !== 'canon') {
                nonCanonRawIndices.push(rawIdx);
                aptEvents.push(ev);
            }
        });
        const events = [...cleanEvents, ...aptEvents];
        // 为每个合并后的事件确定：是否可编辑 + 在 cal.days 原始数组中的索引
        const eventMeta = events.map((evt, mergedIdx) => {
            if (evt.type === 'canon') return { editable: false, rawIdx: -1 };
            const aptPos = mergedIdx - cleanEvents.length;
            return { editable: true, rawIdx: nonCanonRawIndices[aptPos] ?? -1 };
        });
        let html = '';
        if (events.length > 0) {
            html += events.map((evt, idx) => {
                const cls = ['sao-cal-event-item'];
                if (evt.type === 'appointment') cls.push('sao-cal-event-apt');
                else if (evt.type === 'canon') cls.push('sao-cal-event-canon');
                const time = evt.time ? `<span style="color:var(--primary);">${esc(evt.time)}</span> ` : '';
                const typeLabel = evt.type === 'canon' ? '[\u539f\u4f5c\u4e8b\u4ef6]' : evt.type === 'appointment' ? '[\u7ea6\u5b9a]' : '[\u53d8\u5316\u5267\u60c5]';
                const meta = eventMeta[idx];
                const editBtns = meta.editable
                    ? `<div style="flex-shrink:0;display:flex;gap:4px;">
                        <button class="sao-btn sao-btn-sm" data-action="calEditEvent" data-date="${dateStr}" data-idx="${meta.rawIdx}" style="padding:2px 8px;font-size:0.75em;">\u7f16\u8f91</button>
                        <button class="sao-btn sao-btn-sm sao-btn-secondary" data-action="calDeleteEvent" data-date="${dateStr}" data-idx="${meta.rawIdx}" style="padding:2px 8px;font-size:0.75em;">\u5220\u9664</button>
                    </div>`
                    : '';
            return `<div class="${cls.join(' ')}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;">
                            <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:rgba(0,210,255,0.12);font-size:0.75em;margin-right:6px;color:var(--primary-bright);">${esc(typeLabel)}</span>${time}${esc(evt.title || evt.description || '\u65e0\u6807\u9898')}
                        </div>
                        ${editBtns}
                    </div>
                    ${(evt.subEvents && evt.subEvents.length > 0) ? evt.subEvents.map(s => {
                        const lab = s.label ? `<div style="font-size:0.95em;font-weight:600;color:#00d2ff;margin-bottom:3px;">${esc(s.label)}</div>` : '';
                        const body = s.body ? `<div style="font-size:0.92em;color:#b8c8e0;white-space:pre-line;line-height:1.5;">${esc(s.body)}</div>` : '';
                        return `<div style="padding:8px 10px;margin-top:6px;background:rgba(0,210,255,0.05);border-left:2px solid rgba(0,210,255,0.4);border-radius:4px;">${lab}${body}</div>`;
                    }).join('') : (evt.description && evt.title && evt.description !== evt.title ? `<div class="sao-cal-event-meta" style="font-size:0.92em;color:#b8c8e0;margin-top:4px;white-space:pre-line;line-height:1.5;">${esc(evt.description)}</div>` : '')}
                </div>`;
            }).join('');
        } else {
            html += '<span style="opacity:0.6;font-size:0.85em;">\u65e0\u4e8b\u4ef6</span>';
        }
        html += `<div style="margin-top:10px;"><button class="sao-btn sao-btn-sm" data-action="calAddEvent" data-date="${dateStr}">+ \u6dfb\u52a0\u4e8b\u4ef6</button></div>`;
        return html;
    }

    function handleCalSelectDay(dateStr) {
        _calSelectedDate = dateStr;
        renderCalendarMonth();
        renderCalendarDayDetail();
        showDetailModal(dateStr + ' \u4e8b\u4ef6', buildCalendarDayEventsHtml(dateStr));
    }

    function handleCalEditEvent(dateStr, eventIdx) {
        const cal = getCalendar();
        const evt = cal?.days?.[dateStr]?.events?.[eventIdx];
        if (!evt) return;
        showCalEditForm(null, dateStr);
        const descEl = document.getElementById('sao_cal_input_desc');
        const timeEl = document.getElementById('sao_cal_input_time');
        if (descEl) descEl.value = evt.title || evt.description || '';
        if (timeEl) timeEl.value = evt.time || '';
        const idEl = document.getElementById('sao_cal_edit_id');
        if (idEl) {
            idEl.value = 'event';
            idEl.dataset.editDate = dateStr;
            idEl.dataset.editIdx = eventIdx;
        }
        const titleEl = document.getElementById('sao_cal_form_title');
        if (titleEl) titleEl.textContent = '\u7f16\u8f91\u4e8b\u4ef6';
        const typeEl = document.getElementById('sao_cal_input_type');
        if (typeEl) typeEl.value = evt.type === 'appointment' ? 'appointment' : (evt.type === 'canon' ? 'canon' : 'custom');
    }

    async function handleCalDeleteEvent(dateStr, eventIdx) {
        const cal = getCalendar();
        if (!cal?.days?.[dateStr]?.events) return;
        const evt = cal.days[dateStr].events[eventIdx];
        if (!evt) return;
        if (!confirm('\u786e\u8ba4\u5220\u9664\u8fd9\u6761\u4e8b\u4ef6\uff1f')) return;
        cal.days[dateStr].events.splice(eventIdx, 1);
        if (evt.type === 'appointment') {
            cal.appointments = (cal.appointments || []).filter(a =>
                !(a.date === dateStr && a.description === (evt.title || evt.description))
            );
        }
        await persistCalendar(cal);
        renderCalendarMonth();
        renderCalendarDayDetail();
        showDetailModal(dateStr + ' \u4e8b\u4ef6', buildCalendarDayEventsHtml(dateStr));
    }

    function handleCalAddEvent(dateStr) {
        showCalEditForm(null, dateStr);
        const titleEl = document.getElementById('sao_cal_form_title');
        if (titleEl) titleEl.textContent = '\u6dfb\u52a0\u4e8b\u4ef6';
        const idEl = document.getElementById('sao_cal_edit_id');
        if (idEl) idEl.value = 'new_event_' + dateStr;
        const typeEl = document.getElementById('sao_cal_input_type');
        if (typeEl) typeEl.value = 'custom';
    }

    function handleCalAddAppointment() {
        showCalEditForm(null, _calSelectedDate);
        const titleEl = document.getElementById('sao_cal_form_title');
        if (titleEl) titleEl.textContent = '\u6dfb\u52a0\u7ea6\u5b9a';
        const idEl = document.getElementById('sao_cal_edit_id');
        if (idEl) idEl.value = 'new_apt_' + (_calSelectedDate || formatDate(new Date()));
        const typeEl = document.getElementById('sao_cal_input_type');
        if (typeEl) typeEl.value = 'appointment';
    }

    function handleCalManualEdit() {
        showCalEditForm(null, _calSelectedDate);
    }

    function handleCalEditAppointment(id) {
        const cal = getCalendar();
        const apt = cal?.appointments?.find(a => a.id === id);
        if (apt) {
            showCalEditForm(apt);
            const typeEl = document.getElementById('sao_cal_input_type');
            if (typeEl) typeEl.value = 'appointment';
        }
    }

    async function handleCalSaveAppointment() {
        try {
        const cal = getCalendar();
        if (!cal) return;

        const idEl = document.getElementById('sao_cal_edit_id');
        const dateEl = document.getElementById('sao_cal_input_date');
        const timeEl = document.getElementById('sao_cal_input_time');
        const descEl = document.getElementById('sao_cal_input_desc');
        const typeEl = document.getElementById('sao_cal_input_type');
        const partEl = document.getElementById('sao_cal_input_participants');
        const locEl = document.getElementById('sao_cal_input_location');

        const date = dateEl.value;
        const time = timeEl.value;
        const description = descEl.value.trim();
        const eventType = typeEl ? typeEl.value : 'custom';
        const participants = partEl.value.split(',').map(s => s.trim()).filter(Boolean);
        const location = locEl.value.trim();

        if (!date || !description) {
            log('\u4fdd\u5b58\u5931\u8d25: \u65e5\u671f\u548c\u63cf\u8ff0\u4e0d\u80fd\u4e3a\u7a7a', 'warn');
            return;
        }

        const id = idEl.value;

        // Editing existing event (from modal edit button)
        if (id === 'event') {
            const eventDate = idEl.dataset.editDate;
            const eventIdx = parseInt(idEl.dataset.editIdx);
            if (eventDate && !isNaN(eventIdx) && cal.days?.[eventDate]?.events?.[eventIdx] != null) {
                const evt = cal.days[eventDate].events[eventIdx];
                evt.time = time;
                evt.title = description;
                evt.description = description;
                evt.type = eventType;
                await persistCalendar(cal);
                hideCalEditForm();
                _renderCalendarTab();
                showDetailModal(eventDate + ' \u4e8b\u4ef6', buildCalendarDayEventsHtml(eventDate));
            }
            return;
        }

        // Adding new event (from popup "+ 添加事件")
        if (id.startsWith('new_event_')) {
            const eventDate = id.substring('new_event_'.length);
            if (!cal.days[eventDate]) cal.days[eventDate] = { events: [], isUpdated: true };
            if (eventType === 'appointment') {
                addAppointmentToCalendar(cal, { date: eventDate, time, description, source: 'manual', status: 'pending' });
            } else {
                cal.days[eventDate].events.push({
                    type: eventType,
                    time: time,
                    title: description,
                    description: description,
                    source: 'manual',
                });
            }
            await persistCalendar(cal);
            hideCalEditForm();
            _renderCalendarTab();
            showDetailModal(eventDate + ' \u4e8b\u4ef6', buildCalendarDayEventsHtml(eventDate));
            return;
        }

        // Adding new appointment (from 约定区 "添加约定")
        if (id.startsWith('new_apt_')) {
            addAppointmentToCalendar(cal, { date, time, description, source: 'manual', status: 'pending' });
            await persistCalendar(cal);
            hideCalEditForm();
            _renderCalendarTab();
            showDetailModal(date + ' \u4e8b\u4ef6', buildCalendarDayEventsHtml(date));
            return;
        }

        // Original appointment editing (existing appointment id like 'apt_...')
        let apt;
        if (id) {
            apt = (cal.appointments || []).find(a => a.id === id);
            if (!apt) {
                log('\u4fdd\u5b58\u7ea6\u5b9a\u5931\u8d25: \u672a\u627e\u5230\u7ea6\u5b9a', 'warn');
                return;
            }
            const oldDay = cal.days[apt.date];
            if (oldDay) {
                oldDay.events = oldDay.events.filter(e => !(e.source === 'manual' && e.title === apt.description && e.time === apt.time));
            }
        } else {
            // Dead branch removed: UI always sets an existing apt id or uses 'new_apt_' prefix
            // (handled above). Fallthrough here is an impossible state.
            log('保存约定失败: 无效的 ID 状态', 'error');
            return;
        }

        apt.date = date;
        apt.time = time;
        apt.description = description;
        apt.participants = participants;
        apt.location = location;

        if (!cal.days[date]) cal.days[date] = { events: [], isUpdated: true };
        cal.days[date].events.push({
            type: 'appointment',
            time: time,
            title: description,
            description: description,
            source: 'manual',
        });

        await persistCalendar(cal);
        hideCalEditForm();
        _renderCalendarTab();
        } catch (e) {
            log('\u4fdd\u5b58\u5931\u8d25: ' + e.message, 'error');
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
        await persistCalendar(cal);
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
        await persistCalendar(cal);
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
        closeDetail() {
            closeDetailModal();
        },
        // 点3: LLM 事件同步后刷新插件日历（如果日历 tab 当前打开）
        refreshCalendar() {
            const calTab = document.querySelector('.sao-tab[data-tab="calendar"]');
            if (calTab && calTab.classList.contains('active')) {
                try { renderCalendarMonth(); } catch (e) { log('refreshCalendar 失败: ' + e.message, 'warn'); }
            }
        },
        // 标签切换
        switchTab(tabName) {
            document.querySelectorAll('.sao-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.sao-tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector(`.sao-tab[data-tab="${tabName}"]`)?.classList.add('active');
            document.querySelector(`.sao-tab-content[data-content="${tabName}"]`)?.classList.add('active');
            // Bug4 fix: 防御性清理 inv-tab-content 状态，防止切tab时残留
            if (tabName !== 'status') {
                document.querySelectorAll('.sao-inv-tab-content').forEach(el => {
                    el.style.setProperty('display', 'none', 'important');
                });
            } else {
                // 切回 status 时恢复 inv-tab 显示（移除 inline override，由 CSS class 控制）
                document.querySelectorAll('.sao-inv-tab-content').forEach(el => {
                    el.style.removeProperty('display');
                });
            }
            if (tabName === 'calendar') _renderCalendarTab();
            if (tabName === 'data') this.renderStoreTab();
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
            ALL_MODEL_KEYS.forEach(role => {
                const cfg = settings.models[role] || {};
                updateModelStatus(role, !!cfg.url && !!cfg.model);
            });
            // 显示保存成功提示
            const testEl = document.getElementById('sao_state_test') || document.getElementById('sao_narrative_test');
            if (testEl) {
                testEl.className = 'sao-test-result show success';
                testEl.textContent = '✓ 配置已保存';
                setTimeout(() => { testEl.className = 'sao-test-result'; }, 2000);
            }
            log('模型配置已保存');
        },
        clearLogs() {
            logs.length = 0;
            updateLogDisplay();
        },
        async testGenerate(type) {
            // type 参数若未传，从 select 读取
            if (!type) {
                const sel = document.getElementById('sao_test_type');
                type = sel ? sel.value : 'equipment';
            }
            const testEl = document.getElementById('sao_generate_test');
            if (!testEl) return;
            testEl.className = 'sao-test-result';
            testEl.textContent = '正在生成...';
            saveModelsToSettings();
            try {
                // 检查 equipment 模型是否配置（含子角色→主档回退，与 callModel 解析一致）
                if (!isModelConfigured('equipment')) {
                    testEl.className = 'sao-test-result show error';
                    testEl.textContent = '✗ 请先在"模型配置"标签中配置"装备/技能模型"的 API 地址和模型，并点击"获取"选择模型';
                    return;
                }
                let result;
                if (type === 'equipment') {
                    result = await generateEquipment({ playerLevel: 5, floor: 1, type: '武器', rarity: '蓝色' }, callModel);
                } else if (type === 'skill') {
                    result = await generateSkill({ weaponType: '单手直剑', skillLevel: 1, playerLevel: 5 }, callModel);
                } else if (type === 'loot') {
                    result = await generateLoot({ enemyLevel: 3, floor: 1, enemyType: '野猪' }, callModel);
                } else if (type === 'consumable') {
                    result = await generateConsumable({ playerLevel: 5, floor: 1, qty: 1 }, callModel);
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
        async discardEquipment(equipmentId) {
            if (!equipmentId) return;
            if (!confirm('确定丢弃此装备？此操作不可撤销。')) return;
            try {
                // 0. 在销毁前读取装备名（H1: removeEquipmentById 会删 byId 条目，之后 getEquipmentById 返回 null）
                const eqEntryBefore = getEquipmentById(equipmentId);
                const eqName = eqEntryBefore?.name || equipmentId;
                // 1. 先从 equipmentStore 销毁（含跨引用校验：已穿戴拒绝），skipSave 试探
                const destroyed = await removeEquipmentById(equipmentId, true);
                if (!destroyed) {
                    (typeof toastr !== 'undefined' ? toastr.error('无法丢弃：装备可能已穿戴或不存在。', 'SAO Companion') : alert('无法丢弃：装备可能已穿戴或不存在。'));
                    return;
                }
                // 2. 销毁成功，再从 inventoryStore 移除
                await removeEquipmentItem(equipmentId, true);
                // 3. 记录 actionLog + 统一保存（H2: 合并为单次 saveStore，避免双重保存竞争）
                appendActionLog({
                    action: 'drop_item',
                    itemType: 'equipment',
                    itemName: eqName,
                    result: 'success'
                });
                await saveStore();
                log('装备已丢弃: ' + equipmentId);
                closeDetailModal();
                refreshStatus();
            } catch (e) {
                log('丢弃装备失败: ' + e.message, 'error');
                (typeof toastr !== 'undefined' ? toastr.error('丢弃失败: ' + e.message, 'SAO Companion') : alert('丢弃失败: ' + e.message));
            }
        },

        // R5: 使用消耗品
        async useConsumable(itemId) {
            if (!itemId) return;
            try {
                const results = await useConsumableStore(itemId);
                if (results.length === 0) {
                    // useConsumable 现在总返回提示信息（非空），空数组表示异常
                    if (typeof toastr !== 'undefined') toastr.warning('使用失败：未知原因', 'SAO Companion');
                    return;
                }
                closeDetailModal();
                refreshStatus();
                log('使用消耗品: ' + itemId + ' → ' + results.join(', '));
                // 区分成功与失败提示：包含'不在背包'/'定义未注册'/'已满'等关键词时用 warning
                const isFail = results.some(r => /不在背包|未注册|已满|失败/.test(r));
                if (isFail) {
                    if (typeof toastr !== 'undefined') toastr.warning(results.join(', '), 'SAO Companion');
                } else {
                    if (typeof toastr !== 'undefined') toastr.success(results.join(', '), '使用成功');
                }
            } catch (e) {
                log('使用消耗品失败: ' + e.message, 'error');
                if (typeof toastr !== 'undefined') toastr.error('使用失败: ' + e.message, 'SAO Companion');
            }
        },

        // R5: 从背包装备装备
        async equipFromInventory(equipmentId) {
            if (!equipmentId) return;
            try {
                const eq = getEquipmentById(equipmentId);
                if (!eq) { (typeof toastr !== 'undefined' ? toastr.error('装备不存在', 'SAO Companion') : alert('装备不存在')); return; }
                const slot = eq.slot;
                if (!slot) { (typeof toastr !== 'undefined' ? toastr.error('装备无 slot 信息', 'SAO Companion') : alert('装备无 slot 信息')); return; }
                await equipItem(slot, equipmentId, false);
                appendActionLog({
                    action: 'equip',
                    itemType: 'equipment',
                    itemName: eq.name,
                    slot: slot,
                    result: 'success'
                });
                closeDetailModal();
                refreshStatus();
                log('装备穿戴: ' + equipmentId + ' → ' + slot);
            } catch (e) {
                log('装备穿戴失败: ' + e.message, 'error');
                (typeof toastr !== 'undefined' ? toastr.error('装备失败：' + e.message, 'SAO Companion') : alert('装备失败：' + e.message));
            }
        },

        // R5: 卸下装备
        async unequip(slot) {
            if (!slot) return;
            try {
                const removedId = await unequipItem(slot, false);
                if (!removedId) { (typeof toastr !== 'undefined' ? toastr.error('该槽位无装备', 'SAO Companion') : alert('该槽位无装备')); return; }
                const eq = getEquipmentById(removedId);
                appendActionLog({
                    action: 'unequip',
                    itemType: 'equipment',
                    itemName: eq?.name || removedId,
                    slot: slot,
                    result: 'success'
                });
                closeDetailModal();
                refreshStatus();
                log('装备卸下: ' + removedId + ' (slot: ' + slot + ')');
            } catch (e) {
                log('卸下装备失败: ' + e.message, 'error');
                (typeof toastr !== 'undefined' ? toastr.error('卸下失败：' + e.message, 'SAO Companion') : alert('卸下失败：' + e.message));
            }
        },

        // ============================================================
        // 数据存储浏览器 — DOM 渲染 + 保存均委托给以下方法。
        // 设计要点:单一递归 field renderer,按 dot-path(| 分隔)编辑 entry,避免按 sub-store 分支爆炸。
        // ============================================================
        _activeStoreKey: null,
        _activeEntryId: null,
        _pageLimit: 50,
        _dataSearches: {},
        _dataPages: {},

        _dataRefreshSidebar() {
            const sidebar = document.getElementById('sao_store_sidebar');
            if (!sidebar) return;
            const store = getStore();
            if (!store) {
                sidebar.innerHTML = '<div class="sao-store-empty">chatMetadata 不存在</div>';
                return;
            }
            const counts = this._dataComputeCounts();
            sidebar.innerHTML = _dataStoreDefs.map(d => {
                const count = counts[d.key];
                return `<div class="sao-store-sidebar-item${this._activeStoreKey === d.key ? ' active' : ''}" data-action="storeBrowse" data-store-key="${esc(d.key)}"><span>${esc(d.label)}</span>${count !== null ? `<span class="sao-store-sidebar-item-count">${count}</span>` : ''}</div>`;
            }).join('');
        },
        _dataComputeCounts() {
            const r = {};
            r.player = safe(() => getPlayerStore()) ? 1 : 0;
            const world = safe(() => getWorldStore());
            r.world = world && (world.currentWeather || world.areaStatus || (Array.isArray(world.worldEvents) && world.worldEvents.length)) ? 1 : 0;
            r.calendar = safe(() => getStore().calendarStore) ? 1 : 0;
            const npc = safe(() => getNpcStore());
            r.npc = npc ? Object.keys(npc.byId || {}).length : 0;
            const floor = safe(() => getFloorStore());
            r.floor = floor ? Object.keys(floor.byId || {}).length : 0;
            const eq = safe(() => getEquipmentStore());
            r.equipment = eq ? Object.keys(eq.byId || {}).length : 0;
            const sk = safe(() => getSkillStore());
            r.skill = sk ? Object.keys(sk.byId || {}).length : 0;
            const con = safe(() => getConsumableStore());
            r.consumable = con ? Object.keys(con.byId || {}).length : 0;
            const quest = safe(() => getQuestStore());
            r.quest = quest ? (quest.activeIds.length + quest.completedIds.length) : 0;
            const inv = safe(() => getInventoryStore());
            r.inventory = inv ? (inv.items || []).length : 0;
            const rt = safe(() => getStore().runtime);
            r.runtime = rt ? Object.keys(rt).length : 0;
            return r;
        },

        renderStoreTab() {
            this._activeEntryId = null;
            this._dataRefreshSidebar();
            const defs = _dataStoreDefs;
            const validKey = defs.find(d => d.key === this._activeStoreKey) ? this._activeStoreKey : defs[0].key;
            this.renderStoreSection(validKey);
        },

        renderStoreSection(storeKey) {
            this._activeStoreKey = storeKey;
            this._activeEntryId = null;
            document.querySelectorAll('.sao-store-sidebar-item').forEach(el => {
                el.classList.toggle('active', el.getAttribute('data-store-key') === storeKey);
            });
            const def = _dataStoreDefs.find(d => d.key === storeKey);
            const main = document.getElementById('sao_store_main');
            if (!def || !main) return;
            const data = safe(() => def.get());
            if (data == null) {
                main.innerHTML = `<div class="sao-store-main-header"><span class="sao-store-main-title">${esc(def.label)}</span></div><div class="sao-store-empty">store 尚未初始化</div>`;
                return;
            }
            const header = `<div class="sao-store-main-header"><span class="sao-store-main-title">${esc(def.label)}</span></div>`;
            let body = '';
            if (def.kind === 'runtime')            body = this._storeRenderRuntime(data);
            else if (def.kind === 'inventory')     body = this._storeRenderInventory(data);
            else if (def.kind === 'calendar')      body = this._storeRenderCalendar(data);
            else if (def.kind === 'world')         body = this._storeRenderWorld(data);
            else if (def.kind === 'player')        body = this._storeRenderPlayer(data);
            else                                   body = this._storeRenderCollection(data, def);
            main.innerHTML = header + body;
        },

        // --- 集合类显示（NPC / 楼层 / 装备 / 技能 / 消耗品 / 任务）---
        _storeRenderCollection(data, def) {
            const storeKey = this._activeStoreKey;
            const searchVal = (this._dataSearches && this._dataSearches[storeKey]) || '';
            const entries = Object.values(data.byId || {});
            const filtered = entries.filter(e => !searchVal || JSON.stringify(e).toLowerCase().includes(searchVal.toLowerCase()));
            // 点16: 楼层按 floor_number 数字排序(1→100), 其他按中文名 localeCompare
            if (storeKey === 'floor') {
                filtered.sort((a, b) => (Number(a.floor_number) || 999) - (Number(b.floor_number) || 999));
            } else {
                filtered.sort((a, b) => String(this._entryLabelOf(a, def)).localeCompare(String(this._entryLabelOf(b, def)), 'zh'));
            }
            const list = filtered.length === 0
                ? '<div class="sao-store-empty">无匹配条目</div>'
                : filtered.map(e => `<div class="sao-store-entry-row${this._activeEntryId === e[def.idField] ? ' active' : ''}" data-action="storeEntry" data-store-key="${esc(storeKey)}" data-entry-id="${esc(e[def.idField])}"><span class="sao-store-entry-row-main">${esc(this._entryLabelOf(e, def))}</span><span class="sao-store-entry-row-meta">${esc(e[def.idField] || '')}</span></div>`).join('');
            const searchBox = `<div class="sao-store-toolbar"><input type="text" class="sao-store-search" placeholder="搜索 ${esc(def.label)}..." value="${esc(searchVal)}" data-store-key="${esc(storeKey)}"></div>`;
            // 点16: 手风琴模式 — 点击行后就地展开详情, 再次点击收回
            const target = '<div class="sao-store-empty">从上方列表中选择一个条目以查看和编辑字段</div>';
            return searchBox + `<div class="sao-store-entry-list">${list}</div>${this._activeEntryId ? '' : target}`;
        },

        _entryLabelOf(entry, def) {
            if (!entry) return '';
            switch (def.key) {
                case 'npc':        return entry.name || entry[def.idField];
                case 'floor':      return entry.floor_number != null ? `第${_toChineseNumeral(Number(entry.floor_number))}层-${entry.canon?.theme || entry.name || ''}` : (entry.name || entry[def.idField]);
                case 'equipment':  return entry.name || entry[def.idField];
                case 'skill':      return entry.name || entry[def.idField];
                case 'consumable': return entry.name || entry[def.idField];
                case 'quest':      return entry.title || entry[def.idField];
                default:           return entry.name || entry.title || entry[def.idField];
            }
        },

        _storeRenderPlayer(data) { return '<div class="sao-store-entry-detail">' + this._renderFieldsByPath(data, '', _dataStoreDefs[0].key, _dataPlayerSchema, true) + this._storeActions('player') + '</div>'; },
        _storeRenderWorld(data) {
            const sub = {
                currentWeather: { condition: 'string', temperature: 'number' },
                areaStatus: { location: 'string', danger_level: 'string', zone_type: 'string', description: 'string' },
            };
            const inner = this._renderFieldsByPath(data, '', 'world', sub, true);
            // 点12: worldEvents 去重（按 date+event+floor_id 按键化，只保留唯一项）
            const rawEvents = Array.isArray(data.worldEvents) ? data.worldEvents : [];
            const seen = new Set();
            const deduped = rawEvents.filter(ev => {
                if (!ev || typeof ev !== 'object') return false;
                const key = (ev.date || '') + '|' + (ev.event || '') + '|' + (ev.floor_id || '');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            if (deduped.length !== rawEvents.length) {
                log('worldEvents 去重: ' + rawEvents.length + ' → ' + deduped.length + ' 条');
                data.worldEvents = deduped;
            }
            const events = this._renderArrayField('worldEvents', deduped, {
                storeKey: 'world',
                topLabel: fieldLabel('worldEvents'),
                isObject: true,
                schema: { date: 'string', event: 'string', floor_id: 'string' },
                addDefaults: { date: '', event: '', floor_id: null },
            });
            return '<div class="sao-store-entry-detail">' + inner + events + this._storeActions('world') + '</div>';
        },
        _storeRenderInventory(data) {
            const fields = [
                { key: 'owner_id', readOnly: true },
                { key: 'currency.cor', scalarType: 'number' },
                { key: 'items', kind: 'array-items', schema: _dataInventoryItemSchema, addDefaults: { item_id: '', type: '', name: '', qty: 1 }, itemTitleKey: 'name' },
            ];
            return '<div class="sao-store-entry-detail">' + this._renderFieldsByPath(data, '', 'inventory', fields, true) + this._storeActions('inventory') + '</div>';
        },
        _storeRenderCalendar(data) {
            const dateKeys = Object.keys(data.events || {});
            const eventTotal = dateKeys.reduce((s, k) => s + ((data.events[k] || []).length), 0);
            const aptCount = (data.appointments || []).length;
            // currentDate 手动渲染为日期选择器（_dataRenderFields 只支持 text input，需特殊处理）
            const currentDay = data.currentDate || '';
            const currentDateField = '<div class="sao-store-field-row"><label class="sao-store-field-label">currentDate</label><input type="date" class="sao-store-field-input" data-field-path="currentDate" data-field-type="string" value="' + esc(currentDay) + '"></div>';
            // appointments 用字段化数组编辑器
            const aptFields = [{ key: 'appointments', kind: 'array-items', schema: _dataAppointmentSchema, addDefaults: _dataAppointmentDefaults }];
            const aptFlat = { appointments: data.appointments || [] };
            const aptHtml = this._renderFieldsByPath(aptFlat, '', 'calendar', aptFields, true);
            const summary = '<div class="sao-store-pagination">' + dateKeys.length + ' 天 · ' + eventTotal + ' 事件 · ' + aptCount + ' 约定</div>';
            // 日期选择器：选择某天查看/编辑该日事件（不再显示全部日期）
            const viewDate = this._storeCalViewDate || currentDay || '';
            const datePicker = '<div class="sao-store-sub-section"><div class="sao-store-sub-section-title">选择日期查看事件</div><input type="date" class="sao-store-field-input" data-action="storeCalViewDateChange" value="' + esc(viewDate) + '" style="width:160px;"></div>';
            // 选中日期的事件列表（字段化编辑，非 JSON）
            const datesBody = viewDate ? this._renderCalendarDates([viewDate], data.events || {}) : '<div class="sao-store-empty">请选择日期</div>';
            // 用 .sao-store-entry-detail 包裹，使 _dataApplyEdits 能收集 data-field-path 编辑
            return '<div class="sao-store-entry-detail">' + summary + '<div class="sao-store-sub-section"><div class="sao-store-sub-section-title">基本信息</div>' + currentDateField + '</div>' + aptHtml + datePicker + datesBody + this._storeActions('calendar') + '</div>';
        },
        _storeRenderRuntime(data) {
            const keys = Object.keys(data || {});
            if (keys.length === 0) return '<div class="sao-store-empty">runtime 为空</div>';
            return '<div class="sao-store-warning">runtime 只读：编辑会绕过状态机的同步逻辑，可能破坏游戏流程。改动需小心。</div>'
                + keys.sort().map(k => {
                    let json;
                    try { json = JSON.stringify(data[k], null, 2); } catch (_) { json = String(data[k]); }
                    return '<details class="sao-store-runtime"><summary>' + esc(k) + '</summary><pre>' + esc(json) + '</pre></details>';
                }).join('');
        },
        _renderCalendarDates(dateKeys, eventsMap) {
            if (dateKeys.length === 0) return '<div class="sao-store-empty">无 events</div>';
            // 字段化编辑器：每个事件用 _renderArrayField 渲染为对象数组，复用 storeArrayAdd/Remove。
            // path 用 events|YYYY-MM-DD 格式，pathGet/pathSet 按 | 分段遍历对象键。
            const html = dateKeys.map(date => {
                const list = eventsMap[date] || [];
                return this._renderArrayField('events|' + date, list, {
                    storeKey: 'calendar',
                    topLabel: esc(date) + ' 事件',
                    isObject: true,
                    schema: _dataCalEventSchema,
                    addDefaults: _dataCalEventDefaults,
                });
            }).join('');
            return html;
        },

        renderStoreEntry(storeKey, entryId) {
            const def = _dataStoreDefs.find(d => d.key === storeKey);
            const main = document.getElementById('sao_store_main');
            if (!def || !main) return;
            const data = safe(() => def.get());
            if (!data) return;
            if (def.kind === 'player' || def.kind === 'world' || def.kind === 'inventory' || def.kind === 'calendar') return this.renderStoreSection(storeKey);
            const entry = (data.byId || {})[entryId];
            if (!entry) return;
            // 点16: 手风琴 — 找到点击的行, 切换展开/收回
            const clickedRow = main.querySelector(`.sao-store-entry-row[data-entry-id="${CSS.escape(entryId)}"]`);
            if (!clickedRow) return;
            const existingDetail = main.querySelector('.sao-store-entry-detail');
            const isAlreadyActive = clickedRow.classList.contains('active') && existingDetail && existingDetail.previousElementSibling === clickedRow;
            // 先清除所有 active 和现有详情
            document.querySelectorAll('.sao-store-entry-row').forEach(el => el.classList.remove('active'));
            if (existingDetail) existingDetail.remove();
            if (isAlreadyActive) {
                // 再次点击 = 收回
                this._activeEntryId = null;
                return;
            }
            // 展开: 标记 active, 在点击行后插入详情
            this._activeEntryId = entryId;
            clickedRow.classList.add('active');
            const html = this._storeRenderEntryDetail(entry, def.idField, storeKey);
            clickedRow.insertAdjacentHTML('afterend', html);
        },

        _storeActions(storeKey, entryId) {
            const eid = entryId != null ? esc(String(entryId)) : '';
            return '<div class="sao-store-actions"><button class="sao-store-btn-save" data-action="storeSave" data-store-key="' + esc(storeKey) + '" data-entry-id="' + eid + '">保存</button><button class="sao-store-btn-cancel" data-action="storeReset" data-store-key="' + esc(storeKey) + '" data-entry-id="' + eid + '">取消</button><span class="sao-store-status-ok" data-store-status="' + esc(storeKey) + (eid ? '|' + eid : '') + '" style="display:none;">✓ 已保存</span></div>';
        },
        _storeRenderEntryDetail(entry, idField, storeKey) {
            const detail = this._renderFieldsByPath(entry, '', storeKey, _dataCollectionSchemas[idField] || null, true);
            const actions = this._storeActions(storeKey, entry[idField]);
            return '<div class="sao-store-entry-detail"><div class="sao-store-warning">修改 ID 类字段（' + esc(idField) + '）可能破坏其它 store 的引用。保存即写入 chatMetadata。</div>' + detail + actions + '</div>';
        },

        _renderFieldsByPath(obj, pathPrefix, storeKey, schema, allowNested) { return _dataRenderFields(obj, pathPrefix, storeKey, schema, allowNested, this); },
        _renderArrayField(path, arr, opts) { return _dataRenderArrayField(path, arr, opts, this); },

        // --- 收集编辑并写回 ---
        async saveStoreEntry(storeKey, entryId) {
            const def = _dataStoreDefs.find(d => d.key === storeKey);
            const main = document.getElementById('sao_store_main');
            if (!def || !main) return;
            const data = safe(() => def.get());
            if (!data) { _dataSetStatus(storeKey, entryId, 'err', 'store 不存在'); return; }
            const isSingle = (def.kind === 'inventory' || def.kind === 'world' || def.kind === 'player' || def.kind === 'calendar' || def.kind === 'runtime');
            const target = isSingle ? data : (data.byId || {})[entryId];
            if (!target) { _dataSetStatus(storeKey, entryId, 'err', '目标对象不存在'); return; }
            const detail = main.querySelector('.sao-store-entry-detail');
            if (detail) _dataApplyEdits(detail, target);
            try {
                await saveStore();
                log('[data tab] saved ' + storeKey + (entryId ? ' ' + entryId : ''));
                _dataSetStatus(storeKey, entryId, 'ok', '✓ 已保存');
                if (typeof toastr !== 'undefined') toastr.success('数据已保存', 'SAO Companion');
            } catch (e) {
                log('[data tab] save failed: ' + e.message, 'error');
                _dataSetStatus(storeKey, entryId, 'err', '✗ ' + e.message);
                if (typeof toastr !== 'undefined') toastr.error('保存失败: ' + e.message, 'SAO Companion');
                return;
            }
            this._dataRefreshSidebar();
            this.renderStoreSection(storeKey);
            // 点14: 保存后立即应用到状态栏 — 重新渲染聊天面板 + 插件状态
            try {
                const ctx = getContext();
                if (ctx && ctx.chat && ctx.chat.length > 0) {
                    for (let i = ctx.chat.length - 1; i >= 0 && i >= ctx.chat.length - 5; i--) {
                        const msg = ctx.chat[i];
                        if (msg && !msg.is_user) {
                            const el = getMessageElement(i);
                            if (el) renderAllTags(el, msg.mes || '', i);
                        }
                    }
                }
                if (typeof refreshStatus === 'function') refreshStatus();
            } catch (e) { log('[data tab] 状态刷新失败: ' + e.message, 'warn'); }
        },

        storeCalViewDateChange(dateStr) {
            this._storeCalViewDate = dateStr || '';
            this.renderStoreSection('calendar');
        },
        storeSearchChange(storeKey, value) {
            this._dataSearches = this._dataSearches || {};
            this._dataSearches[storeKey] = value;
            const main = document.getElementById('sao_store_main');
            if (!main) return;
            const listEl = main.querySelector('.sao-store-entry-list');
            const def = _dataStoreDefs.find(d => d.key === storeKey);
            const data = safe(() => def.get());
            const newFragment = this._storeRenderCollection(data, def);
            main.innerHTML = main.querySelector('.sao-store-main-header').outerHTML + newFragment;
        },
        storeArrayAdd(path, defaultsJson) {
            const def = _dataStoreDefs.find(d => d.key === this._activeStoreKey);
            const target = _dataResolveTarget(def, this._activeEntryId);
            if (!target) return;
            let parent = pathGet(target, path);
            // 路径不存在时自动初始化（如 events|2022-11-06 不存在 → 创建空数组）
            if (!parent) {
                const seg = path.split('|');
                let cur = target;
                for (let i = 0; i < seg.length - 1; i++) {
                    if (cur[seg[i]] == null) cur[seg[i]] = {};
                    cur = cur[seg[i]];
                }
                if (cur != null) { cur[seg[seg.length - 1]] = []; parent = cur[seg[seg.length - 1]]; }
            }
            if (!parent || !Array.isArray(parent)) return;
            let defaults = [];
            try { defaults = JSON.parse(defaultsJson || '[]'); } catch (_) { defaults = []; }
            const newItem = Array.isArray(defaults) && defaults.length > 0 ? defaults[0] : '';
            parent.push(newItem);
            this.renderStoreSection(this._activeStoreKey);
        },
        storeArrayRemove(path, idx) {
            const def = _dataStoreDefs.find(d => d.key === this._activeStoreKey);
            const target = _dataResolveTarget(def, this._activeEntryId);
            if (!target) return;
            const arr = pathGet(target, path);
            if (!Array.isArray(arr)) return;
            arr.splice(idx, 1);
            this.renderStoreSection(this._activeStoreKey);
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

            switch (action) {
                case 'closePanel': window.SaoPanel.close(); break;
                case 'switchTab': window.SaoPanel.switchTab(tab); break;
                case 'fetchModels': window.SaoPanel.fetchModels(role); break;
                case 'testModel': window.SaoPanel.testModel(role); break;
                case 'saveModels': window.SaoPanel.saveModels(); break;
                case 'testGenerate': window.SaoPanel.testGenerate(); break;
                case 'refreshStatus': refreshStatus(); break;
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
                case 'calEditEvent': { const d = target.getAttribute('data-date'); const i = parseInt(target.getAttribute('data-idx')); if (d && !isNaN(i)) handleCalEditEvent(d, i); break; }
                case 'calDeleteEvent': { const d = target.getAttribute('data-date'); const i = parseInt(target.getAttribute('data-idx')); if (d && !isNaN(i)) handleCalDeleteEvent(d, i); break; }
                case 'calAddEvent': { const d = target.getAttribute('data-date'); if (d) handleCalAddEvent(d); break; }
                case 'calSaveAppointment': handleCalSaveAppointment(); break;
                case 'calCancelEdit': hideCalEditForm(); break;
                case 'calInit': handleCalInit(); break;
                case 'discardEquipment': {
                    const eqId = target.getAttribute('data-equipment-id');
                    if (eqId) window.SaoPanel.discardEquipment(eqId);
                    break;
                }
                case 'storeBrowse': {
                    const storeKey = target.getAttribute('data-store-key');
                    if (storeKey) window.SaoPanel.renderStoreSection(storeKey);
                    break;
                }
                case 'storeEntry': {
                    const storeKey = target.getAttribute('data-store-key');
                    const entryId = target.getAttribute('data-entry-id');
                    if (storeKey && entryId) window.SaoPanel.renderStoreEntry(storeKey, entryId);
                    break;
                }
                case 'storeSave': {
                    const storeKey = target.getAttribute('data-store-key');
                    const entryId = target.getAttribute('data-entry-id');
                    if (storeKey) window.SaoPanel.saveStoreEntry(storeKey, entryId || null);
                    break;
                }
                case 'storeReset': {
                    const storeKey = target.getAttribute('data-store-key');
                    if (storeKey) window.SaoPanel.renderStoreSection(storeKey);
                    break;
                }
                case 'storeSearchChange': {
                    const storeKey = target.getAttribute('data-store-key');
                    const val = target.value;
                    if (storeKey) window.SaoPanel.storeSearchChange(storeKey, val);
                    break;
                }
                case 'storeArrayAdd': {
                    const aPath = target.getAttribute('data-array-path');
                    const defaults = target.getAttribute('data-array-defaults');
                    if (aPath) window.SaoPanel.storeArrayAdd(aPath, defaults);
                    break;
                }
                case 'storeArrayRemove': {
                    const rPath = target.getAttribute('data-array-path');
                    const rIdx = parseInt(target.getAttribute('data-array-idx'), 10);
                    if (rPath && !isNaN(rIdx)) window.SaoPanel.storeArrayRemove(rPath, rIdx);
                    break;
                }
                case 'switchInvTab': {
                    const section = target.closest('.sao-section');
                    if (section) {
                        const tabName = target.getAttribute('data-tab');
                        section.querySelectorAll('.sao-inv-tab').forEach(t => t.classList.toggle('active', t === target));
                        section.querySelectorAll('.sao-inv-tab-content').forEach(c => {
                            c.classList.toggle('active', c.dataset.content === tabName);
                        });
                    }
                    break;
                }
                case 'useConsumable': {
                    const itemId = target.getAttribute('data-item-id');
                    if (itemId) window.SaoPanel.useConsumable(itemId);
                    break;
                }
                case 'equipFromInventory': {
                    const eqId2 = target.getAttribute('data-equipment-id');
                    if (eqId2) window.SaoPanel.equipFromInventory(eqId2);
                    break;
                }
                case 'unequip': {
                    const slot = target.getAttribute('data-slot');
                    if (slot) window.SaoPanel.unequip(slot);
                    break;
                }
                case 'abandonQuest': {
                    const questId = target.getAttribute('data-quest-id');
                    if (questId) {
                        abandonQuest(questId);
                        refreshStatus();
                    }
                    break;
                }
                case 'showCompletedQuests': {
                    const completed = getCompletedQuests();
                    const rows = completed.length
                        ? completed.map(q => {
                            const reward = q.reward_hint || '-';
                            return `<div class="sao-detail-row"><span class="sao-detail-label">${esc(q.title)}</span><span class="sao-detail-value">${esc(reward)}</span></div>`;
                        }).join('')
                        : '<div style="font-size:0.88em;color:var(--text-tertiary);font-style:italic;padding:12px 0;text-align:center;">无已完成任务</div>';
                    showDetailModal('已完成任务', rows);
                    break;
                }
            }
        });
        // 数据存储浏览器:搜索框实时过滤（debounce 不必要,数据量小）
        panel.addEventListener('input', (e) => {
            const tEl = e.target;
            if (!tEl.classList || !tEl.classList.contains('sao-store-search')) return;
            const sk = tEl.getAttribute('data-store-key');
            if (sk && window.SaoPanel) window.SaoPanel.storeSearchChange(sk, tEl.value);
        });
        // 日期选择器 change 事件（非 click）：日历栏选查看日期
        panel.addEventListener('change', (e) => {
            const tEl = e.target;
            if (!tEl || tEl.getAttribute('data-action') !== 'storeCalViewDateChange') return;
            if (window.SaoPanel) window.SaoPanel.storeCalViewDateChange(tEl.value);
        });
    }

    // Fix4: 详情弹窗 overlay 点击关闭 + Escape 键关闭
    const detailModal = document.getElementById('sao_detail_modal');
    if (detailModal) {
        // 点击 overlay 背景（非 modal-window 区域）关闭
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) closeDetailModal();
        });
    }
    // 全局 Escape 键关闭详情弹窗（不依赖 modal focus）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('sao_detail_modal');
            if (modal && modal.style.display !== 'none') {
                closeDetailModal();
                e.stopPropagation();
            }
        }
    });

    // 详情弹窗事件委托
    function handleDetailClick(e) {
        const target = e.target.closest('[data-detail-type]');
        if (!target) return;
        const type = target.getAttribute('data-detail-type');
        const index = parseInt(target.getAttribute('data-detail-index'), 10);
        const cached = _saoCurrentData;
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
                    html = renderDetailEquip(item);
                    // R5: 卸下按钮
                    html += `<div style="margin-top:12px;text-align:center;"><button class="sao-btn sao-btn-secondary" data-action="unequip" data-slot="${esc(entry.slot)}" title="卸下装备">↓ 卸下</button></div>`;
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
                    const def = sk.def || {};
                    title = `${sk.name || '技能'}${sk.proficiency != null ? ' Lv' + sk.proficiency : ''}`;
                    html = renderSkillDetail({ ...def, proficiency: sk.proficiency, name: sk.name });
                }
                break;
            }
        }
        if (title && html) {
            showDetailModal(title, html);
        }
    }
    document.getElementById('sao_equipment_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_equipped_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_consumable_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_questitem_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_material_list')?.addEventListener('click', handleDetailClick);
    document.getElementById('sao_skills_list')?.addEventListener('click', handleDetailClick);
}

function saveModelsToSettings() {
    const settings = getSettings();
    ALL_MODEL_KEYS.forEach(role => {
        const url = document.getElementById(`sao_${role}_url`)?.value || '';
        const key = document.getElementById(`sao_${role}_key`)?.value || '';
        const model = document.getElementById(`sao_${role}_model`)?.value || '';
        settings.models[role] = { url, key, model };
    });
    saveSettingsDebounced();
}

function loadSettingsToPanel() {
    const settings = getSettings();
    ALL_MODEL_KEYS.forEach(role => {
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

/** 渲染消耗品/任务物品/材料列表 — 三者结构相同，抽取公共函数 */
function _renderInvList(elId, inventory, type, defaultName) {
    const el = document.getElementById(elId);
    if (!el) return;
    const items = (inventory?.items || []).filter(i => i.type === type && i.qty > 0);
    if (items.length > 0) {
        el.innerHTML = items.map((item) => {
            const idx = (inventory.items || []).indexOf(item);
            let name;
            if (type === 'consumable') {
                const def = item.consumable_id ? getConsumableById(item.consumable_id) : null;
                name = def?.name || item.name || defaultName;
            } else {
                name = item.name || defaultName;
            }
            const btn = (type === 'consumable' && item.item_id)
                ? `<button class="sao-btn sao-btn-sm" data-action="useConsumable" data-item-id="${esc(item.item_id)}" title="使用">✓</button>` : '';
            if (btn) {
                return `<div class="sao-tag sao-tag-inv" style="display:inline-flex;align-items:center;gap:6px;cursor:default;">` +
                    `<span data-detail-type="inv" data-detail-index="${idx}" style="cursor:pointer;">${esc(name)} x${esc(item.qty)}</span>${btn}</div>`;
            }
            return `<div class="sao-tag sao-tag-inv" data-detail-type="inv" data-detail-index="${idx}" style="cursor:pointer;">${esc(name)} x${esc(item.qty)}</div>`;
        }).join('');
    } else {
        el.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">空</span>';
    }
}

function refreshStatus() {
    const settings = getSettings();
    
    // A0: read from stores instead of data.state
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '-'; };
    const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; };

    const player = getPlayerStore();
    if (!player) {
        // Clear data-dependent panels to avoid showing stale data
        ['sao_player_name','sao_hp_text','sao_mp_text','sao_stat_str','sao_stat_agi','sao_stat_int','sao_stat_vit','sao_level_text','sao_player_location','sao_world_location','sao_world_weather','sao_world_area','sao_world_clearing','sao_world_events'].forEach(id => setText(id, '-'));
        ['sao_hp_bar','sao_mp_bar'].forEach(id => setBar(id, 0));
        const _cursorEmpty = document.getElementById('sao_cursor_text');
        if (_cursorEmpty) _cursorEmpty.innerHTML = '<span class="sao-cursor-badge sao-cursor-green" style="opacity:0.4;filter:saturate(0.2);"><span class="sao-cursor-text">—</span></span>';
        ['sao_equipment_list','sao_equipped_list','sao_consumable_list','sao_questitem_list','sao_material_list','sao_skills_list'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">无数据</span>'; });
        const testEl = document.getElementById('sao_generate_test'); if (testEl) { testEl.className = 'sao-test-result'; testEl.textContent = ''; }
        _saoCurrentData = {};
        return;
    }
    const inventory = getInventoryStore();

    // 玩家名
    const playerName = player.identity?.name || getContext().name1 || '冒险者';
    setText('sao_player_name', playerName);

    // Location/floor
    const floorNum = typeof player.position?.floor_id === 'number' 
        ? player.position.floor_id 
        : (parseInt(String(player.position?.floor_id || '').replace(/\D/g, '')) || 0);
    setText('sao_player_location', `${player.position?.location || '?'} / ${floorNum || '?'}F`);
    // HP soft-guard: during combat, read from runtime._zd_parsed for real-time HP
    const _store = getStore();
    const _zdCombat = _store?.runtime?._zd_parsed?.enemies?.some(e => e.hp > 0);
    const hpVal = _zdCombat ? _store.runtime._zd_parsed.player.hp : player.vitals?.hp;
    const maxHpVal = _zdCombat ? _store.runtime._zd_parsed.player.max_hp : player.vitals?.maxHp;
    const mpVal = _zdCombat ? _store.runtime._zd_parsed.player.mp : player.vitals?.mp;
    const maxMpVal = _zdCombat ? _store.runtime._zd_parsed.player.max_mp : player.vitals?.maxMp;
    setText('sao_hp_text', `${hpVal ?? '?'}/${maxHpVal ?? '?'}${_zdCombat ? ' (战斗中)' : ''}`);
    setText('sao_mp_text', `${mpVal ?? '?'}/${maxMpVal ?? '?'}`);
    if (maxHpVal > 0) setBar('sao_hp_bar', (hpVal / maxHpVal) * 100);
    if (maxMpVal > 0) setBar('sao_mp_bar', (mpVal / maxMpVal) * 100);
    setText('sao_stat_str', player.attributes?.str ?? '?');
    setText('sao_stat_agi', player.attributes?.agi ?? '?');
    setText('sao_stat_int', player.attributes?.int ?? '?');
    setText('sao_stat_vit', player.attributes?.vit ?? '?');
    setText('sao_level_text', player.progression?.level ?? '?');

    // 光标类型（侧边栏填充，元素由 designer 后续添加）
    // 光标六边形徽章（SAO HUD 风格）
    const cursorType = player.cursor_type || 'green';
    const cursorRaw = CURSOR_LABEL[cursorType] || '🟢 普通';
    const cursorText = cursorRaw.replace(/^\S+\s*/, '');
    const cursorEl = document.getElementById('sao_cursor_text');
    if (cursorEl) {
        cursorEl.innerHTML = `<span class="sao-cursor-badge sao-cursor-${esc(cursorType)}"><span class="sao-cursor-hex"></span><span class="sao-cursor-text">${esc(cursorText)}</span></span>`;
    }

    // 世界状态
    const worldStore = getWorldStore();
    setText('sao_world_location', worldStore.areaStatus?.location || player.position?.location || '-');
    setText('sao_world_weather', worldStore.currentWeather?.condition || '-');
    const area = worldStore.areaStatus;
    setText('sao_world_area', area ? `${DANGER_LABEL[area.danger_level]||area.danger_level} - ${area.description||''}` : '-');
    // 攻略情况：只显示当前楼层攻略状态（R2: 不再列出全部楼层）
    const currentFloorId = player.position?.floor_id;
    const currentFloor = currentFloorId ? getFloorById(currentFloorId) : null;
    let clearingText = '-';
    if (currentFloor) {
        clearingText = `${currentFloor.floor_number}F ${currentFloor.state?.cleared ? '✓ 已攻略' : '✗ 攻略中'}`;
        if (currentFloor.canon?.boss) clearingText += ` (BOSS: ${currentFloor.canon.boss})`;
    }
    setText('sao_world_clearing', clearingText);
    // 事件：最近1条
    const events = worldStore.worldEvents || [];
    setText('sao_world_events', events.length > 0 ? events[events.length-1].event : '-');

    // 已穿戴装备 - 渲染到 sao_equipped_list（右列装备section）
    // 点9: 改成全 7 槽位网格（含空槽），与聊天栏装备区一致
    const slots = ['weapon', 'off_hand', 'head', 'chest', 'hands', 'legs', 'accessory'];
    const equipArr = [];
    for (const slot of slots) {
        const equipId = player.equipment?.[slot];
        if (!equipId) { equipArr.push({ slot, name: null, item: null }); continue; }
        const equip = getEquipmentById(equipId);
        equipArr.push({ slot, name: equip?.name || null, item: equip || null });
    }
    const equippedEl = document.getElementById('sao_equipped_list');
    if (equippedEl) {
        equippedEl.innerHTML = equipArr.map((entry, i) => {
            const slotLabel = SLOT_LABELS[entry.slot] || entry.slot;
            if (!entry.name) {
                // 空槽位
                return `<div class="sao-equip-row sao-equip-row-empty" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid rgba(255,255,255,0.04);border-radius:6px;margin-bottom:4px;">` +
                    `<span style="color:var(--text-tertiary);font-size:0.85em;">${esc(slotLabel)}</span>` +
                    `<span style="color:var(--text-tertiary);font-size:0.82em;opacity:0.6;">无</span>` +
                    `</div>`;
            }
            return `<div class="sao-equip-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid rgba(0,210,255,0.15);border-radius:6px;margin-bottom:4px;background:rgba(0,210,255,0.04);">` +
                `<div style="display:flex;flex-direction:column;gap:2px;cursor:pointer;" data-detail-type="equip" data-detail-index="${i}">` +
                `<span style="color:var(--text-tertiary);font-size:0.78em;">${esc(slotLabel)}</span>` +
                `<span style="color:var(--text-primary);font-size:0.9em;font-weight:600;">${esc(entry.name)}</span>` +
                `</div>` +
                `<button class="sao-btn sao-btn-sm" data-action="unequip" data-slot="${esc(entry.slot)}" title="卸下装备" style="padding:2px 8px;font-size:0.78em;">↓</button>` +
                `</div>`;
        }).join('');
        _saoCurrentData = _saoCurrentData || {};
        _saoCurrentData.equipment = equipArr;
    }

    // 背包装备 - 渲染到 sao_equipment_list（物品section的装备tab）
    const equipEl = document.getElementById('sao_equipment_list');
    if (equipEl) {
        const equippedIds = new Set(Object.values(player.equipment || {}).filter(Boolean));
        const invEquipItems = (inventory?.items || []).filter(i => i.type === 'equipment' && i.equipment_id && i.qty > 0 && !equippedIds.has(i.equipment_id));
        if (invEquipItems.length > 0) {
            equipEl.innerHTML = invEquipItems.map((item) => {
                const eq = getEquipmentById(item.equipment_id);
                const name = eq?.name || item.name || item.equipment_id;
                const itemLevel = eq?.item_level;
                return `<div class="sao-tag sao-tag-inv" style="display:inline-flex;align-items:center;gap:6px;cursor:default;">` +
                    `<span data-detail-type="inv" data-detail-index="${(inventory.items || []).indexOf(item)}" style="cursor:pointer;">${esc(name)}${itemLevel ? ' ⭐' + itemLevel : ''}</span>` +
                    `<button class="sao-btn sao-btn-sm" data-action="equipFromInventory" data-equipment-id="${esc(item.equipment_id)}" title="穿戴装备">↑</button>` +
                    `</div>`;
            }).join('');
        } else {
            equipEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">背包无装备</span>';
        }
    }

    // 消耗品 / 任务物品 / 材料列表（共用渲染逻辑）
    _renderInvList('sao_consumable_list', inventory, 'consumable', '消耗品');
    _renderInvList('sao_questitem_list', inventory, 'quest_item', '任务物品');
    _renderInvList('sao_material_list', inventory, 'material', '材料');

    // 更新 _saoCurrentData.inventory（详情弹窗索引用原始 inventory.items 下标）
    _saoCurrentData = _saoCurrentData || {};
    _saoCurrentData.inventory = inventory?.items || [];

    // 技能列表 - read from playerStore.skills + skillStore
    const skillEl = document.getElementById('sao_skills_list');
    if (skillEl) {
        if (player.skills && player.skills.length > 0) {
            const skillsWithDefs = player.skills.map(ps => ({
                name: ps.name,
                skill_id: ps.skill_id,
                proficiency: ps.proficiency,
                def: getSkillById(ps.skill_id)
            }));
            skillEl.innerHTML = skillsWithDefs.map((sk, i) =>
                `<div class="sao-tag sao-tag-skill" data-detail-type="skill" data-detail-index="${i}" style="cursor:pointer;">${esc(sk.name)}</div>`
            ).join('');
            _saoCurrentData = _saoCurrentData || {};
            _saoCurrentData.skills = skillsWithDefs;
        } else {
            skillEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">空</span>';
            if (_saoCurrentData) _saoCurrentData.skills = [];
        }
    }

    // 任务列表 - read from questStore
    const questEl = document.getElementById('sao_quest_list');
    if (questEl) {
        const activeQuests = getActiveQuests();
        if (activeQuests.length > 0) {
            questEl.innerHTML = activeQuests.map(q => {
                const reward = q.reward_hint ? `<div style="font-size:0.78em;color:var(--text-secondary);margin-top:2px;">报酬: ${esc(q.reward_hint)}</div>` : '';
                return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:rgba(22,30,46,0.6);border:1px solid var(--border-subtle);border-radius:6px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:0.88em;color:var(--text-primary);font-weight:600;">${esc(q.title)}</div>
                        ${reward}
                    </div>
                    <button class="sao-btn sao-btn-sm" data-action="abandonQuest" data-quest-id="${q.quest_id}" title="放弃任务" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;padding:2px 4px;opacity:0.5;">✕</button>
                </div>`;
            }).join('');
        } else {
            questEl.innerHTML = '<span style="opacity:0.5;font-size:0.85em;">暂无活跃任务</span>';
        }
    }

    // BUG #5: 同步更新聊天消息中的状态面板（插件侧边栏修改后自动刷新）
    refreshLatestChatStatusPanel();
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
            (typeof toastr !== 'undefined' ? toastr.error('[SAO Companion] 打开控制台失败: ' + e.message + '\n请检查浏览器控制台获取详细信息。', 'SAO Companion') : alert('[SAO Companion] 打开控制台失败: ' + e.message + '\n请检查浏览器控制台获取详细信息。'));
        }
    });

    // 绑定启用开关
    $('#sao_companion_enabled').on('change', function() {
        settings.enabled = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    // 绑定兼容模式开关
    $('#sao_compat_mode').on('change', function() {
        settings.compatMode = !!$(this).prop('checked');
        saveSettingsDebounced();
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
    console.log('[SAO Companion] v1.8.0 初始化中...');
    registerSaoDompurifyHook();
    migrateToLogicManaged(); // 一次性迁移旧存档到逻辑管理模式（幂等，已迁移则跳过）
    loadSettingsPanel().catch(e => {
        console.error('[SAO Companion] loadSettingsPanel 失败:', e);
    });
    bindEvents();
    initToolSystem();
    if (isSaoCard()) {
        log('检测到 SAO 角色卡，立即激活');
        stabilizeSaoRegexScripts();
        enableCompatMode();
        injectMemoryAndState();
    }

    // ─── 聊天日历点击弹窗（独立于控制台面板） ───
    if (!document.getElementById('sao_chat_cal_modal')) {
        const modal = document.createElement('div');
        modal.id = 'sao_chat_cal_modal';
        modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
        modal.innerHTML = `<div style="background:#0f1522;border:1px solid rgba(0,210,255,0.3);border-radius:8px;max-width:560px;width:92%;max-height:75vh;overflow-y:auto;padding:18px;color:#eaf2ff;font-family:sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <h3 id="sao_chat_cal_title" style="margin:0;color:#00d2ff;font-size:1.25em;font-weight:700;"></h3>
                <button id="sao_chat_cal_close" style="background:none;border:none;color:#9fb0cc;font-size:1.6em;cursor:pointer;line-height:1;">\u00d7</button>
            </div>
            <div id="sao_chat_cal_body"></div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.id === 'sao_chat_cal_close') modal.style.display = 'none';
        });
    }

    _bindDom('sao-cal-day-click', (e) => {
        try {
            const dateStr = e.detail?.dateStr;
            if (!dateStr) return;
            const modal = document.getElementById('sao_chat_cal_modal');
            const titleEl = document.getElementById('sao_chat_cal_title');
            const bodyEl = document.getElementById('sao_chat_cal_body');
            if (!modal || !titleEl || !bodyEl) return;
            titleEl.textContent = dateStr + ' \u4e8b\u4ef6';
            const saoData = (typeof getSaoData === 'function') ? getSaoData() : null;
            // 聊天日历详情弹框必须与聊天日历格子使用同一份干净 canon 数据；
            // 不能直接读取 saoData.calendar.days，因为那份持久化数据可能包含历史污染。
            const cleanDays = buildCleanCalendarDays(saoData?.calendar?.currentDate);
            const cleanEvents = cleanDays?.[dateStr]?.events || [];
            const savedEvents = saoData?.calendar?.days?.[dateStr]?.events || [];
            const manualEvents = savedEvents.filter(ev => ev.type !== 'canon');
            const events = [...cleanEvents, ...manualEvents];
            if (events.length === 0) {
                bodyEl.innerHTML = '<span style="opacity:0.6;font-size:1em;">\u65e0\u4e8b\u4ef6</span>';
            } else {
                bodyEl.innerHTML = events.map(evt => {
                    const typeLabel = evt.type === 'canon' ? '[\u539f\u4f5c\u4e8b\u4ef6]' : evt.type === 'appointment' ? '[\u7ea6\u5b9a]' : '[\u53d8\u5316\u5267\u60c5]';
                    const time = evt.time ? `<span style="color:#00d2ff;font-weight:600;">${esc(evt.time)}</span> ` : '';
                    const typeColor = evt.type === 'appointment' ? '#ffb800' : (evt.type === 'canon' ? '#00d68a' : '#00d2ff');
                    // 子事件拆分：有 subEvents 则逐条卡片化；否则退回整段 description。
                    const subs = (evt.subEvents && evt.subEvents.length > 0) ? evt.subEvents : null;
                    let inner;
                    if (subs) {
                        inner = subs.map(s => {
                            const lab = s.label ? `<div style="font-size:0.95em;font-weight:600;color:#00d2ff;margin-bottom:3px;">${esc(s.label)}</div>` : '';
                            const body = s.body ? `<div style="font-size:0.92em;color:#b8c8e0;white-space:pre-line;line-height:1.5;">${esc(s.body)}</div>` : '';
                            return `<div style="padding:8px 10px;margin-top:6px;background:rgba(0,210,255,0.05);border-left:2px solid rgba(0,210,255,0.4);border-radius:4px;">${lab}${body}</div>`;
                        }).join('');
                    } else {
                        inner = evt.description && evt.title && evt.description !== evt.title ? `<div style="font-size:0.92em;color:#b8c8e0;margin-top:5px;white-space:pre-line;line-height:1.5;">${esc(evt.description)}</div>` : '';
                    }
                    return `<div style="padding:10px 12px;margin-bottom:8px;background:rgba(8,12,20,0.6);border-left:4px solid ${typeColor};border-radius:5px;font-size:1em;line-height:1.4;">
                        <div style="margin-bottom:4px;"><span style="display:inline-block;padding:3px 8px;border-radius:3px;background:rgba(0,210,255,0.14);font-size:0.8em;margin-right:8px;color:${typeColor};font-weight:600;">${typeLabel}</span>${time}<span style="font-size:1em;font-weight:600;color:#eaf2ff;">${esc(evt.title || evt.description || '无标题')}</span></div>
                        ${inner}
                        </div>`;
                }).join('');
            }
            modal.style.display = 'flex';
        } catch (err) {
            console.error('[SAO Companion] chat calendar click error:', err);
        }
    });

    document.body.classList.toggle('sao-card-active', isSaoCard());

    // ─── 安全网：页面刷新后补渲染 + 补解析 ───
    // 问题：刷新酒馆后，CHAT_CHANGED 可能 (a) 在角色数据加载前就触发（isSaoCard()=false），
    // (b) DOM 尚未就绪导致批量轮询超时，(c) 跳过最后一条 AI 消息但 CHARACTER_MESSAGE_RENDERED
    // 未对已有消息触发。结果：所有美化（body class + Shadow DOM 面板）失效 + store 未初始化。
    // 此安全网在 init() 后延迟轮询，等角色就绪后补渲染消息 + 补运行 preparser/日历/状态注入。
    {
        let safetyAttempts = 0;
        let safetyInitialized = false; // 防止重复运行 preparser 等
        const safetyNet = () => {
            safetyAttempts++;
            if (safetyAttempts > 80) return; // 80 × 200ms = 16s 超时

            // 等到角色就绪
            if (!isSaoCard()) {
                setTimeout(safetyNet, 200);
                return;
            }

            // 角色就绪，确保 body class 已添加
            document.body.classList.add('sao-card-active');

            // 补运行初始化链（与 CHAT_CHANGED handler 相同的逻辑，但只运行一次）
            if (!safetyInitialized) {
                safetyInitialized = true;
                log('安全网: 角色就绪，补运行初始化链');
                try {
                    stabilizeSaoRegexScripts();
                    enableCompatMode();
                    const char = getCurrentCharacter();
                    if (char?.data?.character_book?.entries) {
                        const entries = char.data.character_book.entries;
                        if (entries.length > 0) {
                            const result = runLorebookPreParser(entries);
                            if (result) {
                                saveStore().catch(e => log('安全网: 保存数据失败: ' + (e.message || e), 'warn'));
                            }
                            log(`安全网: Pre-parser 完成: ${entries.length} 条目`);
                        }
                    }
                    injectMemoryAndState();
                    initCalendarIfNeeded();
                    initPresetGuilds();
                } catch (e) {
                    log('安全网: 初始化链失败: ' + (e.message || e), 'warn');
                }
            }

            // 补渲染所有未渲染的 AI 消息（包括 CHAT_CHANGED 跳过的最后一条）
            const ctx = getContext();
            if (ctx.chat && ctx.chat.length > 0) {
                let rendered = 0;
                let pending = 0;
                ctx.chat.forEach((msg, idx) => {
                    if (!msg || msg.is_user) return;
                    const el = getMessageElement(idx);
                    if (!el) { pending++; return; }
                    if (!el.querySelector('.mes_text')) { pending++; return; }
                    // 只渲染没有 shadow host 的消息（避免重复渲染）
                    if (el.querySelector('.sao-render-host')) return;
                    renderAllTags(el, msg.mes || '', idx);
                    rendered++;
                });

                if (rendered > 0) {
                    log(`安全网: 补渲染 ${rendered} 条消息`);
                }

                // 如果有 DOM 尚未就绪的消息，继续轮询
                if (pending > 0 && safetyAttempts < 80) {
                    setTimeout(safetyNet, 200);
                }
            }
        };
        setTimeout(safetyNet, 500); // 延迟 500ms 等 ST 完成初始渲染
    }


    if (!document.getElementById('sao_floating_ball')) {
        const ball = document.createElement('div');
        ball.id = 'sao_floating_ball';
        ball.style.cssText = 'position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#00d2ff 0%,#0096c7 100%);box-shadow:0 4px 14px rgba(0,210,255,0.4);cursor:pointer;z-index:99998;display:flex;align-items:center;justify-content:center;font-size:1.4em;color:#0a0e1a;font-family:"Rajdhani","Noto Sans SC",sans-serif;font-weight:700;transition:transform 0.2s ease,box-shadow 0.2s ease;user-select:none;';
        ball.innerHTML = '⚔';
        ball.title = 'SAO Companion 控制台';
        ball.addEventListener('mouseenter', () => { ball.style.transform = 'scale(1.1)'; ball.style.boxShadow = '0 6px 20px rgba(0,210,255,0.5)'; });
        ball.addEventListener('mouseleave', () => { ball.style.transform = 'scale(1)'; ball.style.boxShadow = '0 4px 14px rgba(0,210,255,0.4)'; });
        ball.addEventListener('click', async () => {
            try {
                await loadPanelHTML();
                if (!window.SaoPanel) initPanelLogic();
                window.SaoPanel.open();
                // 点4: 默认打开模型配置 tab
                if (typeof window.SaoPanel.switchTab === 'function') window.SaoPanel.switchTab('models');
            } catch (e) { console.error('[SAO Companion] 悬浮球打开失败:', e); }
        });
        document.body.appendChild(ball);
    }

    console.log('[SAO Companion] 初始化完成');
}

// ============================================================
// 测试钩子：仅在测试环境暴露内部函数供 E2E 测试
// 生产环境（浏览器）process 不存在，此块不执行
// ============================================================
if (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.NODE_ENV === 'test') {
    globalThis.__SAO_INTERNAL__ = {
        // 常量
        MODULE_NAME,
        // mock 注入点：测试可覆盖 getSaoData 的返回值
        __testSaoData: null,
        __getTestSaoData() { return globalThis.__SAO_INTERNAL__.__testSaoData; },
        __setTestSaoData(d) { globalThis.__SAO_INTERNAL__.__testSaoData = d; },
    };
}
