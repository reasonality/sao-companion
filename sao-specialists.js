// SAO Companion - 专家面板模块（Phase C 拆分）
// 从 index.js 拆出：装饰面板专家（map/equipment/swordskill）+ 状态专家（status）
// fireSpecialistPanels 返回 Promise[] 供调用方 allSettled 重渲染

import { getSaoData, log, safeJsonParse, getSettings } from './sao-core.js';
import { getStore, saveStore, projectActionLogHint } from './sao-store-core.js';
import { callSpecialist } from './sao-models.js';
import { projectStateHint, projectEquipmentSummary, projectSkillSummary, projectNpcHint } from './sao-state-projection.js';
import { applyWorldUpdates, projectWorldHint } from './sao-store-world.js';
import { getRules } from './sao-rules.js';

// ============================================================
// P2: 装饰面板专家调用（map/equipment/swordskill）
// ============================================================

/**
 * 写入专家面板数据到 chatMetadata.panels[messageId][panelType]
 */
export function persistSpecialistPanel(messageId, panelType, html) {
    if (messageId == null) return;
    const data = getSaoData();
    if (!data) return;
    if (!data.panels) data.panels = {};
    if (!data.panels[messageId]) data.panels[messageId] = {};
    data.panels[messageId][panelType] = { html };
}

/**
 * 通用专家 prompt 构造
 */
export function _buildPanelPrompt(panelName, instruction, narrativeText, currentStateHint) {
    return [
        {
            role: 'system',
            content: `你是 SAO 游戏的 ${panelName} 面板生成器。根据叙事正文生成该面板的 HTML 片段。

## 输出格式（严格 JSON，不要输出其他内容）
{ "html": "<内联 HTML，将被注入 Shadow DOM 的内容区>" }

## 规则
- html 是内联 HTML 片段（不要含 <html>/<body>/<style>），将被注入已带样式的容器内
- 内容应反映本回合叙事中 ${panelName} 的状态变化
- 简洁、信息密度高，避免冗长
- ${instruction}

## 输入
- 叙事正文（截断 2000 字）
- 当前状态摘要（如有）`
        },
        {
            role: 'user',
            content: `## 当前状态摘要\n${currentStateHint || '(无)'}\n\n## 本轮叙事正文\n${(narrativeText || '').substring(0, 2000)}\n\n请输出 JSON。`
        },
    ];
}

/**
 * 解析专家 JSON 响应，提取 html 字段（共享）。
 * @returns {string|null} html 字符串（非空），或 null（解析失败/空）
 */
export function _parseSpecialistHtml(content, panelType) {
    if (!content) return null;
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = safeJsonParse(cleaned);
    if (parsed && typeof parsed.html === 'string' && parsed.html.length > 0) {
        return parsed.html;
    }
    log(`${panelType} 专家 JSON 解析失败或 html 为空`, 'warn');
    return null;
}

/**
 * 通用装饰面板专家调用（DRY：map/equipment/swordskill 共用）。
 * @param {string} panelType - 'map'/'equipment'/'swordskill'（chatMetadata.panels[messageId] 键名 + specialistRole）
 * @param {string} panelName - 面板中文名（prompt 中使用）
 * @param {string} instruction - 面板内容指令
 * @param {string} stateHint - 当前状态摘要
 * @param {number|string} messageId
 * @param {string} narrativeText
 * @param {string[]} [rules] - 按需注入的规则关键词列表
 */
export async function _callPanelSpecialist(panelType, panelName, instruction, stateHint, messageId, narrativeText, rules) {
    const messages = _buildPanelPrompt(panelName, instruction, narrativeText, stateHint);
    // 规则按需注入
    if (rules?.length > 0) {
        const rh = getRules(rules, '面板参考规则');
        if (rh) messages[0].content += rh;
    }
    let content;
    try {
        content = await callSpecialist(panelType, messages, 512, { temperature: 0.5, jsonSchema: true });
    } catch (e) {
        log(`${panelType} 专家调用失败: ` + e.message, 'warn');
        return;
    }
    const html = _parseSpecialistHtml(content, panelType);
    if (!html) return;
    persistSpecialistPanel(messageId, panelType, html);
    await saveStore();
}

/** 装饰面板专家配置（DRY 驱动） */
export const PANEL_SPECIALIST_CONFIG = [
    { type: 'map',       name: '地图',   instruction: '反映当前位置、楼层、可探索区域、移动方向。', hint: () => '', rules: [] },
    { type: 'equipment', name: '装备栏', instruction: '列出各槽位装备（武器/防具/饰品），含名称与简短属性。', hint: () => projectEquipmentSummary(), rules: ['技能'] },
    { type: 'swordskill', name: '剑技',  instruction: '列出可用剑技/技能，含名称、等级、CD。', hint: () => projectSkillSummary(), rules: ['技能', '剑技获取'] },
];

/**
 * 触发所有装饰面板专家（并行）。
 * 每个专家成功后独立 saveStore（避免单点失败导致全丢）。
 * 返回 Promise 数组供调用方 allSettled 等待完成后重渲染。
 * @returns {Promise[]} 每个专家的 Promise（已 catch，不会 reject）
 */
export function fireSpecialistPanels(messageId, narrativeText) {
    if (messageId == null) return [];
    if (getSettings().specialistPanels?.enabled === false) return [];
    const promises = [];
    for (const cfg of PANEL_SPECIALIST_CONFIG) {
        const p = _callPanelSpecialist(cfg.type, cfg.name, cfg.instruction, cfg.hint(), messageId, narrativeText, cfg.rules)
            .catch(e => log(cfg.type + ' 专家失败: ' + e.message, 'warn'));
        promises.push(p);
    }
    return promises;
}

/** 清理指定消息的专家面板数据（swipe/edit 复用） */
export function _clearSpecialistPanels(messageId) {
    const d = getSaoData();
    if (d?.calendarPanels && d.calendarPanels[messageId] != null) delete d.calendarPanels[messageId];
    if (d?.panels && d.panels[messageId] != null) delete d.panels[messageId];
}

// ============================================================
// P3: status 专家 + extractAll 重设计
// ============================================================

/**
 * 校验 status 专家输出的 {state, zdText, userStatusHtml}（防注入/防漂移）。
 * @returns {boolean} true=合法
 */
export function _validateStatus(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    const s = parsed.state;
    if (!s || typeof s !== 'object') return false;
    // 标量数值字段：若存在必须是 number
    const numFields = ['hp','max_hp','mp','max_mp','str','agi','int','vit','level','exp','cor','floor'];
    for (const f of numFields) {
        if (s[f] != null && typeof s[f] !== 'number') return false;
    }
    // 字符串字段：若存在必须是 string
    const strFields = ['player_name','location'];
    for (const f of strFields) {
        if (s[f] != null && typeof s[f] !== 'string') return false;
    }
    // equipment：若存在必须是 object
    if (s.equipment != null && typeof s.equipment !== 'object') return false;
    // inventory：若存在必须是 array
    if (s.inventory != null && !Array.isArray(s.inventory)) return false;
    // skills：若存在必须是 array
    if (s.skills != null && !Array.isArray(s.skills)) return false;
    // zdText：string（可空）
    if (parsed.zdText != null && typeof parsed.zdText !== 'string') return false;
    // userStatusHtml：string（可空）
    if (parsed.userStatusHtml != null && typeof parsed.userStatusHtml !== 'string') return false;
    // zdText 长度限制（防注入，token 序列通常 < 5000）
    if (typeof parsed.zdText === 'string' && parsed.zdText.length > 10000) return false;
    // userStatusHtml 长度限制
    if (typeof parsed.userStatusHtml === 'string' && parsed.userStatusHtml.length > 50000) return false;
    // npcUpdates 校验
    if (parsed.npcUpdates != null) {
        if (!Array.isArray(parsed.npcUpdates)) return false;
        for (let i = 0; i < parsed.npcUpdates.length; i++) {
            const u = parsed.npcUpdates[i];
            if (!u || typeof u !== 'object' || typeof u.name !== 'string' || u.name.length === 0) {
                return false;
            }
        }
    }
    // cursor_type: 可选字符串，枚举
    if (parsed.state.cursor_type != null) {
        if (typeof parsed.state.cursor_type !== 'string') return false;
        if (!['green', 'orange', 'red'].includes(parsed.state.cursor_type)) return false;
    }
    return true;
}

/**
 * P3: status 专家——输出结构化 state（供 extractAll/applyExtractedData）+ zdText（供 renderBattlePanel）。
 * 主 LLM 不再发 <zd_status>/<user_status>；本专家接管全部状态生成。
 * 注意：status 专家不 fire-and-forget——extractAll 依赖其输出作为主数据源，须 await。
 * @param {number|string} messageId
 * @param {string} narrativeText
 * @returns {Promise<object|null>} { state, zdText } 或 null（失败）
 */
export async function callStatusSpecialist(messageId, narrativeText) {
    // A0: read from store projection instead of flat data.state
    const stateHint = projectStateHint();
    const equipHint = projectEquipmentSummary();
    const skillHint = projectSkillSummary();

    const systemPrompt = `你是 SAO 游戏状态管理器。根据叙事正文，更新游戏状态并输出战斗数据。

## 你的职责
1. 输出 state：玩家属性、装备、技能、物品、位置
2. 输出 zdText：战斗面板用的原始数据文本（与旧 <zd_status> 标签内容格式一致）

## 输出格式（严格 JSON，不要输出其他内容）
{
  "state": {
    "player_name": "string|null",
    "level": 0, "exp": 0, "cor": 0,
    "hp": 0, "max_hp": 0, "mp": 0, "max_mp": 0,
    "str": 0, "agi": 0, "int": 0, "vit": 0,
    "location": "string", "floor": 0,
    "equipment": { "weapon": {"name":"...","item_level":0,"stats":{"max_hp":0,"str":0,"agi":0,"int":0,"vit":0}} },
    "inventory": [ {"name":"...","qty":1} ],
    "skills": [ {"name":"...","proficiency":0,"base_damage":0,"hit_rate":0,"crit_rate":0,"mp_cost":0,"cooldown":0,"hits":0,"targets":0,"core_code":"","affix_codes":[]} ],
    "cursor_type": "green|orange|red"
  },
  "zdText": "[PR:玩家名][GR:等级][HP:当前/最大][MP:当前/最大][STR:值][AGI:值][INT:值][VIT:值][WE:技能名][ATK:值][Hit%:值][Crit%:值][APT:值][TPA:值][MPCost:值][CD:值][WN:代码][EN:代码参数][FRN:队友名][FRHP:当前/最大][FRMP:当前/最大][ENN:敌人名][ENHP:当前/最大][ENS:敌人技能名]",
  "userStatusHtml": "<内联 HTML：角色状态卡（装备/背包/技能/属性/位置），注入 Shadow DOM 内容区>",
  "npcUpdates": [ {"name":"NPC名","relationship":"关系","affinity":5,"floor_id":1,"location":"位置","status":["状态"],"last_seen_date":"日期","observation":"一句话观察"} ]
}

## 规则
- state 反映本回合结束时的状态（基于叙事变化）
- zdText 是战斗面板的原始数据，格式为 [KEY:VALUE] token 序列，用 ][ 分隔，不含外层 []
- 若叙事中无战斗，zdText 中仍输出玩家基础属性（PR/GR/HP/MP/STR/AGI/INT/VIT），无队友/敌人段
- 不确定时保持当前值不变（保守更新）
- 装备槽位：weapon/off_hand/head/chest/hands/legs/accessory
- 技能字段：base_damage=ATK, hit_rate=Hit%, crit_rate=Crit%, mp_cost=MPCost, cooldown=CD, hits=APT, targets=TPA, core_code=WN, affix_codes=EN（数组）
- cursor_type：光标类型，根据玩家行为状态判断。green=普通玩家/友方，orange=可攻击/敌对，red=红名PK者。若无法确定则不输出（保持当前值）

3. 输出 npcUpdates：识别叙事中出现的 NPC，更新其状态

## npcUpdates 触发条件
- 叙事中 NPC 出现/被提及（更新 last_seen_date、floor_id、location）
- NPC 与玩家关系变化（更新 relationship、affinity）
- NPC 状态变化（更新 status 数组）
- 新 NPC 首次出现（输出 name 即可，系统自动创建）

## npcUpdates 规则
- 只输出叙事中明确出现或被提及的 NPC，不要猜测
- 未变化的字段不要输出（系统会保持原值）
- affinity 用变化量表示（如 +5、-3），系统会累加
- 如果本回合无 NPC 相关变化，npcUpdates 输出空数组 []
- observation：一句话概括本回合与该 NPC 的关键互动

## 当前状态摘要（参考，勿剧变）
${stateHint || '(无)'}
${equipHint ? '装备: ' + equipHint : ''}
${skillHint ? '技能: ' + skillHint : ''}`;

    // R5: 注入 actionLog 提示
    const actionLogHint = projectActionLogHint();
    const actionLogSection = actionLogHint
        ? `\n\n## 玩家本地操作（UI 按钮触发，非叙事）\n${actionLogHint}\n这些操作已直接修改了玩家状态，请勿覆盖这些变更。\n`
        : '';

    // 规则按需注入：等级、技能
    const ruleHints = getRules(['等级', '技能'], '状态管理参考规则');

    const npcHint = projectNpcHint();
    const userPrompt = `## 本轮叙事正文\n${(narrativeText || '').substring(0, 2000)}\n` +
        (npcHint ? `\n## 已知 NPC\n${npcHint}\n` : '') +
        `\n请输出 JSON。`;

    const messages = [
        { role: 'system', content: systemPrompt + actionLogSection + ruleHints },
        { role: 'user', content: userPrompt },
    ];

    let content;
    try {
        content = await callSpecialist('status', messages, 1536, { temperature: 0.4, jsonSchema: true, timeoutMs: 30000 });
    } catch (e) {
        log('status 专家调用失败: ' + e.message, 'warn');
        return null;
    }
    if (!content) return null;
    try {
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = safeJsonParse(cleaned);
        if (!_validateStatus(parsed)) {
            log('status 专家输出校验失败', 'warn');
            return null;
        }
        // 写入 chatMetadata.panels[messageId].status（含 state/zdText/userStatusHtml）
        if (messageId != null) {
            persistSpecialistPanel(messageId, 'status', {
                state: parsed.state,
                zdText: parsed.zdText || '',
                userStatusHtml: parsed.userStatusHtml || '',
                npcUpdates: parsed.npcUpdates || [],
            });

            // R5: 更新 actionLog 状态
            const store = getStore();
            if (store && store.actionLog) {
                const maxTurn = store.actionLog.entries.reduce((max, e) => Math.max(max, e.turn || 0), 0);
                store.actionLog.lastInjectedTurn = maxTurn;
                store.actionLog.currentTurn = (store.actionLog.currentTurn || 0) + 1;
            }

            await saveStore();
        }
        return { state: parsed.state, zdText: parsed.zdText || '', userStatusHtml: parsed.userStatusHtml || '', npcUpdates: parsed.npcUpdates || [] };
    } catch (e) {
        log('status 专家 JSON 解析失败: ' + e.message, 'warn');
        return null;
    }
}

// ============================================================
// R3: 世界状态专家（worldStatus）
// ============================================================

/** areaStatus.danger_level 枚举 */
const DANGER_LEVEL_ENUM = ['safe', 'low', 'medium', 'high', 'extreme'];

/** areaStatus.zone_type 枚举 */
const ZONE_TYPE_ENUM = ['town', 'field', 'dungeon', 'labyrinth', 'boss_area', 'event_area'];

/**
 * 校验世界专家输出的 { areaStatus, worldEvents }。
 * @param {object} parsed
 * @returns {boolean} true=合法
 */
export function _validateWorldOutput(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;

    // areaStatus: null 或对象
    if (parsed.areaStatus != null) {
        if (typeof parsed.areaStatus !== 'object') return false;
        if (typeof parsed.areaStatus.location !== 'string' || parsed.areaStatus.location.length === 0) return false;
        if (!DANGER_LEVEL_ENUM.includes(parsed.areaStatus.danger_level)) return false;
        if (!ZONE_TYPE_ENUM.includes(parsed.areaStatus.zone_type)) return false;
        if (typeof parsed.areaStatus.description !== 'string') return false;
    }

    // worldEvents: 数组
    if (!Array.isArray(parsed.worldEvents)) return false;
    for (const evt of parsed.worldEvents) {
        if (!evt || typeof evt !== 'object') return false;
        if (typeof evt.event !== 'string' || evt.event.length === 0) return false;
        if (evt.floor_id != null && typeof evt.floor_id !== 'string') return false;
    }

    return true;
}

/**
 * 世界状态专家——输出区域状态和世界事件。
 * fire-and-forget 调用，不阻塞主链。
 *
 * @param {number|string} messageId
 * @param {string} narrativeText
 * @returns {Promise<void>}
 */
export async function callWorldSpecialist(messageId, narrativeText) {
    const stateHint = projectStateHint();
    const worldHint = projectWorldHint();

    const systemPrompt = `你是 SAO 游戏世界状态管理器。根据叙事正文，更新世界状态信息。

## 你的职责
1. 输出 areaStatus：当前区域状态（位置、危险等级、区域类型、描述）
2. 输出 worldEvents：本回合发生的世界级事件

## 输出格式（严格 JSON，不要输出其他内容）
{
  "areaStatus": {
    "location": "当前区域名称",
    "danger_level": "safe|low|medium|high|extreme",
    "zone_type": "town|field|dungeon|labyrinth|boss_area|event_area",
    "description": "区域简短描述"
  },
  "worldEvents": [
    { "event": "事件描述", "floor_id": "floor_XXX 或 null" }
  ]
}

## 规则
- areaStatus 反映玩家当前所在区域的状态
- danger_level: safe=安全(城镇), low=低危(安全区域), medium=中危(野外), high=高危(迷宫/危险区域), extreme=极危(Boss区/特殊事件)
- zone_type: town=城镇, field=野外, dungeon=地下城, labyrinth=迷宫, boss_area=Boss区域, event_area=事件区域
- worldEvents 只记录有世界影响的事件（BOSS出现/讨伐、重大灾难、区域封锁、重要NPC事件等），日常战斗不算
- 如果本回合无世界级事件，worldEvents 输出空数组 []
- areaStatus 若无变化可输出 null（系统保持原值）
- floor_id 尽量提供（如有明确楼层信息），无法确定则为 null

## 当前状态摘要
${stateHint || '(无)'}
${worldHint ? `世界: ${worldHint}` : ''}`;

    // 规则按需注入：经济、房屋
    const ruleHints = getRules(['经济', '房屋'], '世界状态参考规则');

    const userPrompt = `## 本轮叙事正文\n${(narrativeText || '').substring(0, 2000)}\n\n请输出 JSON。`;

    let content;
    try {
        content = await callSpecialist('worldStatus', [
            { role: 'system', content: systemPrompt + ruleHints },
            { role: 'user', content: userPrompt },
        ], 768, { temperature: 0.4, jsonSchema: true, timeoutMs: 25000 });
    } catch (e) {
        log('worldStatus 专家调用失败: ' + e.message, 'warn');
        return;
    }
    if (!content) return;

    try {
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = safeJsonParse(cleaned);
        if (!_validateWorldOutput(parsed)) {
            log('worldStatus 专家输出校验失败', 'warn');
            return;
        }
        await applyWorldUpdates({
            areaStatus: parsed.areaStatus,
            worldEvents: parsed.worldEvents,
        });
        log('worldStatus 专家更新完成');
    } catch (e) {
        log('worldStatus 专家 JSON 解析失败: ' + e.message, 'warn');
    }
}
