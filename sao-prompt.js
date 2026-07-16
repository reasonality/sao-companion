// SAO Prompt 清理与状态注入模块
// 从 index.js 拆分：SAO 标签清理、紧凑状态格式化、上下文状态注入

import { getSaoData, getContext, getSettings, isSaoCard, log, esc } from './sao-core.js';
import { projectCompactState, projectFullState } from './sao-state-projection.js';
import { getStore } from './sao-store-core.js';
import { buildContextualInjection } from './sao-context-inject.js';

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
    'map',
    'digest',
    'guild',
    'npc_status',
    'npc_thoughts',
    'dice',
    'action',
    'preview',
    'output_instruction',
    'system_state_ref',
    'gain_skill',
    'gain_equipment',
    'gain_consumable',
    'gain_buff',
    'gain_guild',
    'gain_material',
    'gain_quest_item',
    'use_item',
    'remove_item',
];

/**
 * 从文本中删除 SAO 标签块
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 */
export function cleanSaoPromptText(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const tag of SAO_PROMPT_STRIP_TAGS) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
        out = out.replace(re, '');
    }
    // 清理多余空行
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 从主 LLM prompt 副本中移除自动注入的大段原作时间线世界书内容。
 * 仅在 function calling 可用时调用；不可用时保留原注入作为 fallback。
 * @param {string} text
 * @returns {string}
 */
export function cleanTimelinePromptText(text) {
    if (!text || typeof text !== 'string') return text;
    const dateHeaderCount = (text.match(/^\s*#{1,6}\s*\*{0,2}\s*\d{1,2}月\d{1,2}日/gm) || []).length;
    const isoDateLineCount = (text.match(/^\s*\d{4}-\d{2}-\d{2}\s*[:：]/gm) || []).length;
    const hasTimelineKeyword = /世界历史背景|时间线|原作/.test(text);
    const looksLikeTimelineBook = hasTimelineKeyword && dateHeaderCount >= 2;
    const looksLikeTimelineList = hasTimelineKeyword && isoDateLineCount >= 3;
    if (!looksLikeTimelineBook && !looksLikeTimelineList) return text;
    return '[原作时间线]已改为按需查询：需要具体日期、范围或月份时调用 get_calendar 工具。不要根据被省略的时间线内容猜测。';
}

// ============================================================
// 状态注入
// ============================================================

export function injectMemoryAndState() {
    const ctx = getContext();
    const settings = getSettings();
    if (!settings.enabled || !isSaoCard()) return;

    const data = getSaoData();
    if (!data) return;
    const parts = [];

    // toolSupported 判断（提前到函数顶部，避免重复求值）
    const toolSupported = typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported();

    // Core State — 全量状态，始终注入（不依赖 tool call）
    const stateText = projectFullState();
    if (stateText) {
        // 用 XML 标签包裹状态注入，明确标识为系统元数据，防止 AI 复制此格式到叙事中。
        // 标签名使用 system_state 以区别于 SAO 游戏标签（equip/swordskill 等）。
        parts.push('<system_state_ref>');
        parts.push('以下为系统自动注入的当前游戏状态参考，仅供你了解当前数值。');
        parts.push('严禁在你的回复中复制、原样输出、或以任何形式复述此状态块。');
        parts.push(stateText);
        parts.push('</system_state_ref>');
    }

    // 获取标签格式指引（独立于 system_state_ref 块，避免被 cleanSaoPromptText 清理）
    parts.push('## 获取标签（9类实体创建契约，重要）');
    parts.push('当叙事中发生获取事件时，在叙事末尾输出对应标签。数值由插件自动计算，你决定名称、描述、稀有度。');
    parts.push('');
    parts.push('### 1. 剑技领悟 &lt;gain_skill&gt;');
    parts.push('格式: &lt;gain_skill name="剑技名" weapon_type="武器类型" rarity="稀有度" atk="攻击力" hit="命中率" crit="暴击率" apt="攻击次数" tpa="目标数" mp_cost="MP消耗" description="1-2句描述"&gt;武器类型&lt;/gain_skill&gt;');
    parts.push('例: &lt;gain_skill name="风之轨迹" weapon_type="单手直剑" rarity="绿色" atk="120" hit="85" crit="15" apt="3" tpa="1" mp_cost="8" description="以风之势连续斩击目标三次"&gt;单手直剑&lt;/gain_skill&gt;');
    parts.push('');
    parts.push('### 2. 装备获取 &lt;gain_equipment&gt;');
    parts.push('格式: &lt;gain_equipment name="装备名" slot="槽位" rarity="稀有度" description="1-2句描述"&gt;装备&lt;/gain_equipment&gt;');
    parts.push('例: &lt;gain_equipment name="暗影短刀" slot="weapon" rarity="蓝色" description="轻巧的短刀，刀身泛着寒光"&gt;装备&lt;/gain_equipment&gt;');
    parts.push('slot枚举: weapon(主手)/off_hand(副手)/head/chest/hands/legs/accessory');
    parts.push('');
    parts.push('### 3. 消耗品获得 &lt;gain_consumable&gt;');
    parts.push('格式: &lt;gain_consumable name="物品名" category="类别" rarity="稀有度" description="1-2句描述"&gt;类别:稀有度&lt;/gain_consumable&gt;');
    parts.push('例: &lt;gain_consumable name="高级治疗药水" category="hp_restore" rarity="绿色" description="恢复大量生命值的红色药水"&gt;hp_restore:绿色&lt;/gain_consumable&gt;');
    parts.push('category枚举: hp_restore/mp_restore/full_restore/buff/cure');
    parts.push('效果类型: restore(恢复)/buff(增益)/cure(治疗)/narrative(叙事效果，如复活/传送/解锁，填description)');
    parts.push('');
    parts.push('### 4. Buff获得 &lt;gain_buff&gt;');
    parts.push('格式: &lt;gain_buff name="buff名" source="来源" permanent="false" duration="持续" str="加成值" vit="加成值" special_effects="特殊效果1;特殊效果2"&gt;描述&lt;/gain_buff&gt;');
    parts.push('例: &lt;gain_buff name="不死之躯" source="title" permanent="true" str="3" vit="5" special_effects="免疫即死;复活时满血"&gt;死亡游戏中的不死称号&lt;/gain_buff&gt;');
    parts.push('source枚举: food/furniture/title/guild/equipment_set/skill/special_event/enemy_trait');
    parts.push('属性字段: str/agi/int/vit，按需填写。special_effects: 特殊效果（分号分隔，可留空）');
    parts.push('');
    parts.push('### 5. 公会事件 &lt;gain_guild&gt;');
    parts.push('格式: &lt;gain_guild action="create" name="公会名" leader="会长" description="描述" buff_name="buff名" str="加成" vit="加成" buff_special_effects="特殊效果" auto_join="true"&gt;公会&lt;/gain_guild&gt;');
    parts.push('action: create(创建,默认)/join(加入)/leave(离开)');
    parts.push('action=create 时 name/leader/description 必填；buff 可选（有则 buff_name/effects/buff_description/buff_special_effects 必填）');
    parts.push('例: &lt;gain_guild action="create" name="龙啸团" leader="陈锋" description="新公会，由陈锋组建的攻略组外围佣兵组织" buff_name="龙啸之魂" str="5" vit="10"&gt;佣兵团&lt;/gain_guild&gt;');
    parts.push('');
    parts.push('### 6. 材料获得 &lt;gain_material&gt;');
    parts.push('格式: &lt;gain_material name="材料名" qty="数量" rarity="稀有度" description="描述"&gt;材料&lt;/gain_material&gt;');
    parts.push('例: &lt;gain_material name="龙鳞" qty="3" rarity="绿色" description="坚硬的龙鳞，可用于锻造"&gt;材料&lt;/gain_material&gt;');
    parts.push('');
    parts.push('### 7. 任务物品获得 &lt;gain_quest_item&gt;');
    parts.push('格式: &lt;gain_quest_item name="物品名" description="描述"&gt;任务物品&lt;/gain_quest_item&gt;');
    parts.push('例: &lt;gain_quest_item name="古代钥匙" description="开启某扇封印之门的钥匙"&gt;任务物品&lt;/gain_quest_item&gt;');
    parts.push('');
    parts.push('### 8. 使用物品 &lt;use_item&gt;');
    parts.push('当叙事中玩家使用物品时（喝药水/用钥匙/激活道具），输出:');
    parts.push('格式: &lt;use_item name="物品名" qty="1" target="目标(可选)"&gt;使用描述&lt;/use_item&gt;');
    parts.push('例: &lt;use_item name="复活水晶" target="克莱因"&gt;桐人将水晶按在克莱因胸口，水晶绽放白光&lt;/use_item&gt;');
    parts.push('装备不通过此标签使用（用装备/卸下功能）。数值效果自动应用，叙事效果由你描写。');
    parts.push('');
    parts.push('### 9. 移除物品 &lt;remove_item&gt;');
    parts.push('当叙事中物品消失时（丢失/被夺/赠予/销毁/用作材料），输出:');
    parts.push('格式: &lt;remove_item name="物品名" qty="数量"&gt;消失描述&lt;/remove_item&gt;');
    parts.push('例: &lt;remove_item name="龙鳞" qty="1"&gt;锻造消耗了一片龙鳞&lt;/remove_item&gt;');
    parts.push('');
    parts.push('### 稀有度使用指南');
    parts.push('稀有度由你根据叙事语境决定（不是楼层）。白色=杂兵掉落/普通商店；绿色=精英怪/普通任务；蓝色=楼层Boss/重要任务/隐藏宝箱；紫色=关键剧情/稀有掉落/特殊事件。');
    parts.push('稀有度枚举: 白色/绿色/蓝色/紫色（装备可额外用金色=legendary）。');
    parts.push('仅在叙事确实描写了获取事件时才输出标签。name和description必须填写。不要滥用高稀有度——保持稀缺感。');

    // P2b: inject calendar date if available (from calendarStore)
    const calStore = getStore()?.calendarStore;
    if (calStore?.currentDate) {
        parts.push(`[日期]${calStore.currentDate}`);
        if (toolSupported) {
            parts.push('[日历/原作时间线]不要猜测原作时间线或当前日程；需要查询某日、某月或范围事件时调用 get_calendar。');
        }
    }

    // P3: 告知 AI 有工具可用（仅 toolSupported 时注入）
    if (toolSupported) {
        parts.push(
            '## 可用工具\n' +
            '你可以通过 function calling 调用以下工具获取详细信息：\n' +
            '- get_floor_info(floor): 查询楼层设定（主题/主城/迷宫/BOSS）\n' +
            '- get_character_info(name): 查询NPC/角色档案\n' +
            '- get_calendar(date/month): 查询日历/时间线事件\n' +
            '- get_world_setting(topic): 查询世界设定规则（死亡游戏/经济/PK/战斗/技能/等级/房屋等）\n' +
            '- search_world_book(query): 按关键词搜索世界书条目（通用回退）\n' +
            '当你需要某楼层/NPC/事件/规则的详细信息时，优先调用工具而非猜测。'
        );
    }

    // Contextual canon injection (keyword-triggered NPC/floor profiles + all rules + calendar ±7d + NPC summary)
    const recentMsgs = (ctx.chat || []).slice(-3).map(m => m.mes || '').join('\n');
    const contextBlock = buildContextualInjection(recentMsgs);
    if (contextBlock) {
        parts.push(contextBlock);
    }

    if (parts.length > 0) {
        const injected = parts.join('\n');
        ctx.setExtensionPrompt('sao_companion_inject', injected, 1, 4, false, 0);
        // 诊断日志：每次注入输出 parts 数量、总字符数、各部分首行标记，便于在 SAO Companion 日志 tab 验证
        // parts 顺序固定：[状态] / [日期] / [日历提示] / 可用工具 / [上下文注入块]
        const partHeaders = parts.map((p, i) => {
            const firstLine = p.split('\n', 1)[0] || '';
            const tag = firstLine.slice(0, 40);
            return `[${i}]${tag}(${p.length}字)`;
        }).join(' ');
        log(`状态注入: ${parts.length}块 共${injected.length}字 — ${partHeaders}`);
    }
}
