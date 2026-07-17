// SAO Companion - 专家面板模块（Phase C 拆分）
// 从 index.js 拆出：装饰面板专家（map/equipment/swordskill）+ 状态专家（status）
// fireSpecialistPanels 返回 Promise[] 供调用方 allSettled 重渲染

import { getSaoData, log, safeJsonParse, getSettings } from './sao-core.js';
import { getStore, saveStore, projectActionLogHint } from './sao-store-core.js';
import { callSpecialist } from './sao-models.js';
import { projectStateHint, projectEquipmentSummary, projectSkillSummary, projectNpcHint } from './sao-state-projection.js';
import { applyWorldUpdates, projectWorldHint } from './sao-store-world.js';
// 规则段落（精简版，从世界书摘取核心规则，替代原 sao-rules.js 动态提取）
const RULE_LEVEL = `
## 等级规则
- **等级公式:** 升到等级 L 所需总 EXP = 50 * L * (L - 1)。反解: L = floor(0.5 + sqrt(2500 + 200 * 总EXP) / 100)
- **EXP 获取:** 战斗/任务获得的经验累加到总 EXP 池，每次获取后立即重算等级和属性
- **核心属性:** STR/AGI/INT/VIT 基础值 = 当前等级（裸装）
- **基础 HP:** 500 + (5 * 等级 * (等级 + 1))；基础 MP: 300（不受等级影响）
- **升级叙事:** 升1级"一道升级光芒笼罩"；连升多级"一连串耀眼的升级光芒炸开"，并报告属性提升量
`;

const RULE_SKILL = `
## 技能规则
SAO 技能分三类：
1. **武器技能** (如«单手直剑»): 提升熟练度，解锁剑技，无直接属性成长
2. **战斗技能** (如«格挡»«蹲伏»): 学习时不赋予技能本身，而是永久提升一级属性——根据技能名关键词查表：力量/强韧/筋力→STR, 敏捷/反应/速度→AGI, 精神/专注/洞察→INT, 耐力/生存/防御→VIT，每项 +1D3+1。复合关键词同时触发多项
3. **辅助技能** (炼金/锻造/索敌等): 无属性成长，仅赋予叙事能力，熟练度决定产出品质
`;

const RULE_SWORDSKILL = `
## 剑技获取规则
四种获取路径：
- **熟练度突破:** 武器熟练度等级提升时，每跨越一个10的整数倍里程碑（Lv.10/20…），分别生成一枚该等级的剑技
- **战斗掉落:** 战利品骰落在81-98区间时触发，新剑技等级 = 玩家当前该武器熟练度等级
- **剑意领悟:** 玩家叙事中表达操练/领悟意图，或GM判断叙事创造触发。等级上限 = min(角色等级*10, 武器熟练度等级)
- **初始武装:** 首次装备新武器类型时，授予2枚等级1的剑技
遗忘剑技：永久移除，返还熟练度 = 角色等级 * 50
`;

const RULE_MEDITATION = `
## 冥想与月蚀规则
- 冥想熟练度：每次冥想修炼 +50~100（根据深度/时长），上限 2000
- 达到 500 解锁月蚀独特技能「现梦」
- 子技熟练度：每次使用对应子技 +10~20（根据战斗表现）
- 状态摘要中的数值是当前值，输出更新后的累计值
`;

const RULE_ECONOMY = `
## 经济规则
- **货币:** 珂尔 (Cor)，高压生存经济，珂尔与生存直接挂钩
- **收入:** 击败怪物（主要，与等级正相关）、NPC任务报酬、出售物品/材料、提供服务
- **支出:** 消耗品（药水/传送水晶）、装备购买/修理/强化、食物料理、情报/住房
- **物价锚点:** 黑面包1Cor, 旅馆50Cor/晚, 普通修理~100Cor, 低级怪~20-30Cor, 中级怪~180Cor, 小Boss~1000Cor, 层Boss总奖励25000Cor(团队), 回廊水晶250000Cor, 第22层湖边小屋5000000Cor
`;

const RULE_HOUSING = `
## 房屋规则
- **房价:** 1-20层50-80万Cor(公寓), 21-70层300万+(自建别墅), 71-100层1000万+(工会据点)。起始之镇溢价200万/公寓
- **购房:** 个人完成任务解锁地契；工会会长用"领地旗帜"(层主Boss掉落)宣告所有权。禁止NPC转售，玩家交易征20%税，死亡回收。支持分期(首付30%)
- **类型:** 自建别墅(需建筑师副职,可定制庭院)、工会据点(战略大厅+附属建筑,最大200人)、公寓(系统模板,1-3房)、工会宿舍(集体居住,共享工坊)
- **特殊:** 安全区失效+无箭塔→可能被怪物攻破；空间水晶可扩展地下室；稀有家具提供Buff
`;

// ============================================================
// 通用 JSON 提取工具（处理模型输出中的 prose/markdown 包裹）
// ============================================================

/**
 * 从模型输出文本中稳健提取 JSON 对象。
 * 处理：纯 JSON、markdown 代码块包裹、prose 前后文包裹。
 * 使用平衡花括号匹配找到实际 JSON 边界。
 * @param {string} text - 模型原始输出
 * @returns {object|null} 解析后的对象，或 null（提取失败）
 */
export function extractJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    // 1. Direct parse
    try { return JSON.parse(trimmed); } catch {}
    // 2. Strip markdown fences and surrounding text, then extract first {...} by brace matching
    let cleaned = trimmed;
    // Remove ```json ... ``` or ``` ... ``` blocks
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    // Balanced brace extraction
    const start = cleaned.indexOf('{');
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const candidate = cleaned.substring(start, i + 1);
                try { return JSON.parse(candidate); } catch {}
                // If the first {...} fails, continue searching for the next one
            }
        }
    }
    return null;
}

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
function _buildPanelPrompt(panelName, instruction, narrativeText, currentStateHint) {
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
function _parseSpecialistHtml(content, panelType) {
    if (!content) return null;
    // Primary: strict JSON parse
    const parsed = extractJsonObject(content);
    if (parsed && typeof parsed.html === 'string' && parsed.html.length > 0) {
        return parsed.html;
    }
    // Fallback: extract html field value directly (tolerates unescaped quotes in HTML)
    // Models sometimes emit { "html": "<div style="...">..." } where inner double-quotes
    // break JSON.parse. The html value starts at the opening " after "html": and ends
    // at the LAST " in the content (the JSON's closing quote, since JSON ends with "}).
    // Using "last \" in content" is robust against CSS braces (}) and quotes inside HTML.
    // Truncation (no closing ") degrades gracefully — falls through to warning log.
    const htmlKeyIdx = content.indexOf('"html"');
    if (htmlKeyIdx >= 0) {
        // Find the first " after "html": (opening quote of the html value)
        const colonIdx = content.indexOf(':', htmlKeyIdx);
        if (colonIdx >= 0) {
            let openQuote = -1;
            for (let i = colonIdx + 1; i < content.length; i++) {
                if (content[i] === '"') { openQuote = i; break; }
            }
            // Find the LAST " in the content (JSON's closing quote of the html value)
            let endQuote = -1;
            for (let i = content.length - 1; i > openQuote; i--) {
                if (content[i] === '"') { endQuote = i; break; }
            }
            if (openQuote >= 0 && endQuote > openQuote) {
                let v = content.substring(openQuote + 1, endQuote);
                // Unescape \" -> " and \\ -> \
                v = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                if (v.length > 0) {
                    return v;
                }
            }
        }
    }
    log(`${panelType} 专家 JSON 提取失败 (content 长度=${content.length} 前80字符: ${content.slice(0, 80)})`, 'warn');
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
 * @param {Function} [rules] - 返回规则字符串的函数（按需注入）
 */
async function _callPanelSpecialist(panelType, panelName, instruction, stateHint, messageId, narrativeText, rules) {
    const messages = _buildPanelPrompt(panelName, instruction, narrativeText, stateHint);
    // 规则按需注入（rules 为函数，返回规则字符串）
    if (rules) {
        const rh = rules();
        if (rh) messages[0].content += rh;
    }
    let content;
    try {
        content = await callSpecialist(panelType, messages, 1024, { temperature: 0.5, jsonSchema: true });
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
const PANEL_SPECIALIST_CONFIG = [
    // map 专家已移除（面板不再渲染，避免浪费 API 调用）
    { type: 'equipment', name: '装备栏', instruction: '仅输出本回合新生成/获得的装备。若本回合无新增装备，返回空内容（不要列出已有装备）。', hint: () => projectEquipmentSummary(), rules: () => RULE_SKILL },
    { type: 'swordskill', name: '剑技',  instruction: '仅输出本回合新生成/获得的剑技或技能。若本回合无新增，返回空内容（不要列出已有剑技）。', hint: () => projectSkillSummary(), rules: () => RULE_SKILL + '\n\n' + RULE_SWORDSKILL },
];

/**
 * 生成/获取事件触发正则 — 仅匹配装备/剑技/技能的获得语言，
 * 排除使用语言（使用/挥出/释放/使出）和单纯提及。
 * @type {RegExp}
 */
const GENERATION_TRIGGER_RE = /习得|获得新|获得.*(?:剑技|装备|技能)|新(?:剑技|装备|技能)|掉落|装备了|拾取|开出|解锁.*(?:剑技|技能)|学会|领悟|更换|替换|入手|买[到入]?|购[买入得]?/;

/**
 * 触发所有装饰面板专家（并行）。
 * 每个专家成功后独立 saveStore（避免单点失败导致全丢）。
 * 返回 Promise 数组供调用方 allSettled 等待完成后重渲染。
 * @returns {Promise[]} 每个专家的 Promise（已 catch，不会 reject）
 */
export function fireSpecialistPanels(messageId, narrativeText) {
    if (messageId == null) return [];
    // 点10: 专家2始终运行（不再受 toggle 控制）
    const promises = [];
    for (const cfg of PANEL_SPECIALIST_CONFIG) {
        // 装备/剑技专家触发条件：
        // (a) 叙述包含生成/获取关键词，或
        // (b) 消息中已有 <equip>/<swordskill> 标签（AI 已输出，需要专家生成更好的 HTML）
        if (cfg.type === 'equipment' || cfg.type === 'swordskill') {
            const hasKeyword = GENERATION_TRIGGER_RE.test(narrativeText);
            const hasTag = narrativeText.includes(`<${cfg.type}>`) || narrativeText.includes(`<${cfg.type} `);
            if (!hasKeyword && !hasTag) continue;
        }
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
function _validateStatus(parsed, stateHint) {
    if (!parsed || typeof parsed !== 'object') return false;
    const s = parsed.state;
    if (!s || typeof s !== 'object') return false;
    // 标量数值字段：若存在必须是 number
    const numFields = ['hp','max_hp','mp','max_mp','str','agi','int','vit','level','exp','cor','floor','meditationProficiency'];
    for (const f of numFields) {
        if (s[f] != null && typeof s[f] !== 'number') return false;
    }
    // 等级漂移校验：从 stateHint 提取当前等级，拒绝跳跃超过 3 级
    if (s.level != null && stateHint) {
        const lvlMatch = stateHint.match(/Lv(\d+)/);
        if (lvlMatch) {
            const currentLevel = parseInt(lvlMatch[1], 10);
            if (s.level > currentLevel + 3) {
                log(`[validateStatus] 等级漂移: 当前Lv${currentLevel}, 输出Lv${s.level}（差距>3）`, 'warn');
                return false;
            }
        }
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
    // 月蚀系统字段校验
    if (s.uniqueSkillProficiency != null && typeof s.uniqueSkillProficiency !== 'object') return false;
    if (s.incapacitated != null && typeof s.incapacitated !== 'boolean') return false;
    return true;
}

/**
 * P3: status 专家——输出结构化 state（供 extractAll/applyExtractedData）。
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
    "inventory": [ {"name":"...","qty":1,"type":"equipment|consumable|material|quest_item"} ],
    "skills": [ {"name":"...","proficiency":0,"base_damage":0,"hit_rate":0,"crit_rate":0,"mp_cost":0,"cooldown":0,"hits":0,"targets":0,"core_code":"","affix_codes":[]} ],
    "sellActions": [ {"name":"物品名","qty":1,"cor_gained":50} ],
    "cursor_type": "green|orange|red"
  },
  "zdText": "[PR:玩家名][GR:等级][HP:当前/最大][MP:当前/最大][STR:值][AGI:值][INT:值][VIT:值][WE:技能名][ATK:值][Hit%:值][Crit%:值][APT:值][TPA:值][MPCost:值][CD:值][WN:代码][EN:代码参数][FRN:队友名][FRHP:当前/最大][FRMP:当前/最大][ENN:敌人名][ENHP:当前/最大][ENS:敌人技能名]",
  "userStatusHtml": "<内联 HTML：角色状态卡（装备/背包/技能/属性/位置），注入 Shadow DOM 内容区>",
  "npcUpdates": [ {"name":"NPC名","relationship":"关系","affinity":5,"floor_id":1,"location":"位置","status":["状态"],"last_seen_date":"日期","observation":"一句话观察"} ]
}

## 规则
- state 反映本回合结束时的状态（基于叙事变化）
- **技能防幻觉**: state.skills 只能包含叙事正文中明确提到的技能。只有在叙事中明确描写了"学会/获得/解锁新技能"或"技能熟练度提升"时，才能在 skills 中新增技能或更新熟练度。不要凭空创造叙事中未提及的新技能。已有技能的熟练度仅在叙事有明确变化时才更新，否则保持不变。
- STR/AGI/INT/VIT 是总属性值（已包含装备加成），不要在当前值上再加上装备属性。属性值在没有升级/装备变更时不应变化
- HP/MP 是当前/最大值，不要将装备 HP 加成叠加到已包含的总量上
- 装备变更检测：叙事中提到购买/更换/装备/拾取/获得新武器或防具时，必须在 state.equipment 中更新对应槽位（weapon/off_hand/head/chest/hands/legs/accessory），包括名称、item_level、stats。不要遗漏装备变更
- zdText 是战斗面板的原始数据，格式为 [KEY:VALUE] token 序列，用 ][ 分隔，不含外层 []
- 若叙事中无战斗，zdText 中仍输出玩家基础属性（PR/GR/HP/MP/STR/AGI/INT/VIT），无队友/敌人段
- 不确定时保持当前值不变（保守更新）
- 装备槽位：weapon/off_hand/head/chest/hands/legs/accessory
- 技能字段：base_damage=ATK, hit_rate=Hit%, crit_rate=Crit%, mp_cost=MPCost, cooldown=CD, hits=APT, targets=TPA, core_code=WN, affix_codes=EN（数组）
- 新增剑技时，base_damage/hit_rate/crit_rate 等数值必须根据技能等级、武器类型和玩家等级设定合理值，不得全为 0。参考当前已有技能的数值作为基准
- inventory 中每个物品必须标注 type 字段：equipment（武器/防具/装备）、consumable（药水/消耗品）、material（材料）、quest_item（任务物品）。武器/防具类物品（如匕首/剑/刀/弓/盾/盔甲）必须设 type: "equipment"
- cursor_type：光标类型，根据玩家行为状态判断。green=普通玩家/友方，orange=可攻击/敌对，red=红名PK者。若无法确定则不输出（保持当前值）
- 玩家出售/卖出物品时，在 state.sellActions 中输出售出信息。格式: [{"name":"物品名","qty":1,"cor_gained":50}]。售出后该物品应从 inventory 中移除，获得的珂尔加到 cor 中

4. 输出月蚀独特技能相关字段（仅在叙事涉及这些内容时输出）：
- 如果叙事中提到冥想修炼，输出 meditationProficiency (number, 在当前值基础上+50~100，当前值见状态摘要)
- 如果叙事中提到使用了月蚀子技，输出 uniqueSkillProficiency (object, 在当前值基础上+10~20，当前值见状态摘要)。子技ID: genmu, tsuki_no_shizuku, mangekyou, kami_no_inori, shisou_rennai, sanzen_sekai
- 如果主角因释放三千世界陷入无法战斗，输出 incapacitated:true。约30秒(约2回合)后恢复，恢复后输出 incapacitated:false

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

    // 规则按需注入：等级、技能、剑技获取、冥想
    const ruleHints = RULE_LEVEL + '\n\n' + RULE_SKILL + '\n\n' + RULE_SWORDSKILL + '\n\n' + RULE_MEDITATION;

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
    let parsed = extractJsonObject(content);
    if (!_validateStatus(parsed, stateHint)) {
        // Retry once with stricter prompt suffix
        log('status 专家首次输出校验失败，重试一次（严格 JSON 指令）', 'warn');
        try {
            const retryMessages = [
                { role: 'system', content: messages[0].content + '\n\n重要：仅输出纯 JSON 对象，不要包含任何说明文字、问候语或 markdown 代码块标记。直接以 { 开头，以 } 结尾。' },
                messages[1],
            ];
            const retryContent = await callSpecialist('status', retryMessages, 1536, { temperature: 0.4, jsonSchema: true, timeoutMs: 30000 });
            if (retryContent) {
                parsed = extractJsonObject(retryContent);
            }
        } catch (e) {
            log('status 专家重试调用失败: ' + e.message, 'warn');
        }
        if (!_validateStatus(parsed, stateHint)) {
            if (!parsed) log('status 专家 JSON 提取失败 (content 长度=' + (content?.length || 0) + ' 前80字符: ' + (content || '').slice(0, 80) + ')', 'warn');
            else log('status 专家输出校验失败（重试后）', 'warn');
            return null;
        }
    }
    try {
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
function _validateWorldOutput(parsed) {
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
    const ruleHints = RULE_ECONOMY + '\n\n' + RULE_HOUSING;

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
        const parsed = extractJsonObject(content);
        if (!_validateWorldOutput(parsed)) {
            if (!parsed) log('worldStatus 专家 JSON 提取失败 (content 长度=' + (content?.length || 0) + ' 前80字符: ' + (content || '').slice(0, 80) + ')', 'warn');
            else log('worldStatus 专家输出校验失败', 'warn');
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

/**
 * 获取事件检测专家——审查叙事文本，识别所有获取事件并输出对应标签。
 * 替代主 LLM 输出 gain 标签的路径（主 LLM 不可靠，经常不输出）。
 * @param {string} narrativeText - 本轮 AI 叙事正文
 * @returns {Promise<string|null>} 标签文本（含 < 实体的标签需反转义）或 null（无获取事件）
 */
export async function callAcquisitionSpecialist(narrativeText) {
    if (!narrativeText || !narrativeText.trim()) return null;

    // 不做关键词预检——叙事获取事件的表述方式无限多样，正则无法穷举。
    // 子 LLM 自己会判断"无获取事件"并输出空文本，成本可控（输入仅叙事文本，输出为空或少量标签）。

    const systemPrompt = `你是 SAO 游戏的获取事件检测器。阅读叙事文本，识别所有获取事件并输出对应的获取标签。

## 检测规则
1. 只在叙事明确描写了获取/获得/领悟/学会/加入/创建/使用/失去时才输出标签
2. 没有获取事件则不输出任何标签（输出空文本）
3. 每个获取事件输出一个标签，每个标签占一行
4. 不要输出任何其他文本（不要解释、不要注释、不要 markdown、不要代码块标记）
5. 卖出/出售/卖掉/交易给NPC → 输出 <remove_item>，绝对不要输出 <gain_equipment>
6. 购买/买入/从商店获得 → 输出 <gain_equipment> 或对应类型的 gain 标签
7. 叙事中提到某物品名字不代表获取——只有在玩家实际获得该物品时才输出 gain 标签

## 标签格式（9类）

### 1. 剑技领悟
<gain_skill name="剑技名" weapon_type="武器类型" rarity="稀有度" atk="攻击力" hit="命中率" crit="暴击率" apt="攻击次数" tpa="目标数" mp_cost="MP消耗" description="1-2句描述">武器类型</gain_skill>

### 2. 装备获取
<gain_equipment name="装备名" slot="槽位" weapon_type="武器类型" rarity="稀有度" item_level="等级" max_hp="HP加成" str="STR加成" agi="AGI加成" int="INT加成" vit="VIT加成" affixes="词缀1,词缀2" description="1-2句描述">装备</gain_equipment>
slot枚举: weapon/off_hand/head/chest/hands/legs/accessory

### 3. 消耗品获得
<gain_consumable name="物品名" category="类别" rarity="稀有度" description="1-2句描述">类别:稀有度</gain_consumable>
category枚举: hp_restore/mp_restore/full_restore/buff/cure

### 4. Buff获得
<gain_buff name="buff名" source="来源" permanent="false" duration="持续" str="加成值" vit="加成值" special_effects="特殊效果">描述</gain_buff>
source枚举: food/furniture/title/guild/equipment_set/skill/special_event/enemy_trait

### 5. 公会事件
<gain_guild action="create" name="公会名" leader="会长" description="描述" buff_name="buff名" str="加成" vit="加成">公会</gain_guild>
action: create(创建,默认)/join(加入)/leave(离开)

### 6. 材料获得
<gain_material name="材料名" qty="数量" rarity="稀有度" description="描述">材料</gain_material>

### 7. 任务物品获得
<gain_quest_item name="物品名" description="描述">任务物品</gain_quest_item>

### 8. 使用物品
<use_item name="物品名" qty="1" target="目标(可选)">使用描述</use_item>

### 9. 移除物品
<remove_item name="物品名" qty="数量">消失描述</remove_item>

## 稀有度指南
稀有度由你根据叙事语境决定：白色=杂兵掉落/普通商店；绿色=精英怪/普通任务；蓝色=楼层Boss/重要任务/隐藏宝箱；紫色=关键剧情/稀有掉落/特殊事件。
不要滥用高稀有度——保持稀缺感。

## 数值参考
- 剑技 atk: 普通技能 80-150, 稀有技能 150-300, 高级技能 300+
- 剑技 hit: 70-95, crit: 1-20
- 装备 max_hp: 白色 10-30, 绿色 30-60, 蓝色 60-100, 紫色 100+
- 装备属性 str/agi/int/vit: 白色 0-2, 绿色 2-5, 蓝色 5-10, 紫色 10+

## 重要
- 数值必须是合理范围内的正整数（0 除外：hit/crit/mp_cost 可为 0）
- name 和 description 必须填写
- 装备必须有 slot 和 weapon_type（武器类）或 weapon_type="防具"（防具类）
- 消耗品必须有 category
- 不要为叙事中未明确描写的物品/技能生成标签`;

    const userPrompt = `## 叙事文本
${narrativeText.substring(0, 3000)}

请输出获取标签（无则空）：`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    let content;
    try {
        content = await callSpecialist('extract', messages, 512, { temperature: 0.3, timeoutMs: 15000 });
    } catch (e) {
        log('acquisition 专家调用失败: ' + e.message, 'warn');
        return null;
    }
    if (!content || !content.trim()) return null;

    // 反转义 HTML 实体为真实标签（processGainTags 需要真实 < >）
    const unescaped = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (!unescaped || !unescaped.includes('<')) return null;

    log('acquisition 专家输出标签: ' + unescaped.substring(0, 200));
    return unescaped;
}
