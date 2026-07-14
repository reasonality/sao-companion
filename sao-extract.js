// sao-extract.js — 数据提取模块
// 从 AI 回复中提取 SAO 状态标签（zd_status/user_status）并应用到 state

import { getSettings, log, getSaoData, safeJsonParse } from './sao-core.js';
import { getStore, saveStore } from './sao-store-core.js';
import { getWorldStore } from './sao-store-world.js';
import { getPlayerStore, updatePlayerProgression, updatePlayerPosition, updatePlayerIdentity, setCustomSkills, equipItem, unequipItem, updateMeditationProficiency, updateSubTechniqueProficiency, initStartingCharacter, STARTING_COR } from './sao-store-player.js';
import { SLOT_ENUM } from './sao-store-equipment.js';
import { getEquipmentById, getEquipmentStore } from './sao-store-equipment.js';
import { getSkillById, getSkillStore } from './sao-store-skill.js';
import { getInventoryStore, addEquipmentItem, removeEquipmentItem, addConsumable, addConsumableItem, setConsumableQty, addMaterial, addQuestItem, updateCurrency } from './sao-store-inventory.js';
import { findOrCreateNpc, updateNpcState, addObservation, getNpcById, getNpcByName } from './sao-store-npc.js';
import { findOrCreateConsumable } from './sao-store-consumable.js';
import { extractJsonObject } from './sao-specialists.js';
import { addTemporaryBuff, addPermanentBuff, removeBuff } from './sao-buff.js';
import { createGuild, discoverGuild, addGuildMember, removeGuildMember, getGuildByName } from './sao-store-guild.js';
import { setPlayerHousing, updatePlayerHousing, addDecoration, addFurniture, removeFurniture, clearPlayerHousing } from './sao-store-housing.js';

// === 模块级常量 ===

/** 中文装备槽位名 → 英文 slot 键映射（避免循环内重复构造） */
const SLOT_CN_TO_EN = { '武器':'weapon', '副手':'off_hand', '防具':'armor', '头部':'head', '头盔':'helmet', '胸部':'chest', '手部':'hands', '手套':'gloves', '腿部':'legs', '靴子':'boots', '盾牌':'shield', '饰品':'accessory', '戒指':'ring', '项链':'necklace', '披风':'cape', '腰带':'belt' };

/** 武器/防具关键词正则：物品名匹配到这些关键词时，即使 LLM 未标注 type 也按装备处理。
 *  注意：需配合 CONSUMABLE_NAME_RE 排除药水/食物等消耗品，避免"剑技药水"等含武器词的消耗品误判。 */
const EQUIP_NAME_RE = /匕首|短刀|长刀|太刀|刀|剑|枪|矛|斧|弓|弩|锤|杖|棍|镰|盾|盔|护手|护腿|护肩|披风|斗篷|戒指|项链|腰带|靴|鞋|头盔|胸甲|护腕/;

/** 消耗品关键词正则：物品名含这些词时强制为消耗品，覆盖 EQUIP_NAME_RE 的误匹配。
 *  例："初级剑技药水"含"剑"匹配 EQUIP_NAME_RE，但"药水"匹配 CONSUMABLE_NAME_RE → 判为消耗品。 */
const CONSUMABLE_NAME_RE = /药水|药丸|药膏|药剂|药片|卷轴|地图|食物|面包|干粮|水壶|口粮|精华|碎片|结晶|矿石|草药|蘑菇|肉干|果汁|茶|酒/;

// === 纯解析函数 ===

function parseSkillField(tok, skill) {
    if (tok.startsWith('ATK:'))    skill.atk    = parseInt(tok.substring(4)) || 0;
    else if (tok.startsWith('Hit%:'))   skill.hit   = parseInt(tok.substring(5)) || 0;
    else if (tok.startsWith('Crit%:'))  skill.crit  = parseInt(tok.substring(6)) || 0;
    else if (tok.startsWith('APT:'))    skill.apt   = parseInt(tok.substring(4)) || 0;
    else if (tok.startsWith('TPA:'))    skill.tpa   = parseInt(tok.substring(4)) || 0;
    else if (tok.startsWith('MPCost:')) skill.mpCost = parseInt(tok.substring(7)) || 0;
    else if (tok.startsWith('CD:'))     skill.cd    = parseInt(tok.substring(3)) || 0;
    else if (tok.startsWith('WN:'))     skill.wn    = tok.substring(3);
    else if (tok.startsWith('EN:')) {
        if (!skill.en) skill.en = [];
        skill.en.push(tok.substring(3));
    }
    else if (tok.startsWith('MN:')) {
        if (!skill.mn) skill.mn = [];
        skill.mn.push(tok.substring(3));
    }
    else return false;
    return true;
}

function parseZdStatus(zdText) {
    const result = { player: {}, skills: [], teammates: [], enemies: [] };

    // 去掉换行和多余空白，然后按 ][ 分割成 token
    const flat = zdText.replace(/[\r\n]+/g, '').replace(/\*\*.*?\*\*\s*/g, '');
    const rawTokens = flat.replace(/^\[/, '').replace(/\]$/, '').split(/\]\[/);

    // --- 定位各段边界 ---
    let frIdx = -1, enIdx = -1;
    for (let j = 0; j < rawTokens.length; j++) {
        if (rawTokens[j].startsWith('FRN:') && frIdx < 0) frIdx = j;
        if (rawTokens[j].startsWith('ENN:') && enIdx < 0) enIdx = j;
    }

    // --- 解析玩家段 [PR:...] ~ [FRN:...] 或 [ENN:] ---
    const playerEnd = frIdx >= 0 ? frIdx : (enIdx >= 0 ? enIdx : rawTokens.length);
    const playerTokens = rawTokens.slice(0, playerEnd);
    let currentSkill = null;
    const playerSkills = [];
    const player = {};

    for (const tok of playerTokens) {
        if (tok.startsWith('PR:')) { player.name = tok.substring(3); }
        else if (tok.startsWith('GR:')) { player.level = parseInt(tok.substring(3)) || 0; }
        else if (tok.startsWith('HP:')) {
            const p = tok.substring(3).split('/');
            player.hp = parseInt(p[0]) || 0; player.max_hp = parseInt(p[1]) || 0;
        } else if (tok.startsWith('MP:') && !tok.startsWith('MPCost:')) {
            const p = tok.substring(3).split('/');
            player.mp = parseInt(p[0]) || 0; player.max_mp = parseInt(p[1]) || 0;
        } else if (tok.startsWith('STR:')) { player.str = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('AGI:')) { player.agi = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('INT:')) { player.int = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('VIT:')) { player.vit = parseInt(tok.substring(4)) || 0; }
        else if (tok.startsWith('IT:')) {
            const parts = tok.substring(3).split(',');
            if (!player.items) player.items = [];
            player.items.push({ name: parts[0], qty: parseInt(parts[1]) || 1 });
        }
        else if (/^P\d+[A-Z]?[:]/.test(tok)) {
            if (!player.potionCodes) player.potionCodes = [];
            player.potionCodes.push(tok);
        }
        else if (tok.startsWith('WE:')) {
            if (currentSkill) playerSkills.push(currentSkill);
            currentSkill = { name: tok.substring(3) };
        }
        else if (currentSkill) {
            if (!parseSkillField(tok, currentSkill) && (tok.startsWith('MN:') || tok.startsWith('FR') || tok.startsWith('EN'))) {
                playerSkills.push(currentSkill); currentSkill = null;
            }
        }
    }
    if (currentSkill) playerSkills.push(currentSkill);
    result.player = player;
    result.skills = playerSkills;

    // --- 解析队友段 [FRN:...] ---
    if (frIdx >= 0) {
        const teamEnd = enIdx >= 0 ? enIdx : rawTokens.length;
        const teamTokens = rawTokens.slice(frIdx, teamEnd);
        const tm = {};
        let frSkill = null;
        for (const tok of teamTokens) {
            if (tok.startsWith('FRN:')) tm.name = tok.substring(4);
            else if (tok.startsWith('FRGR:')) tm.level = parseInt(tok.substring(5)) || 0;
            else if (tok.startsWith('FRHP:')) {
                const p = tok.substring(5).split('/');
                tm.hp = parseInt(p[0]) || 0; tm.max_hp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('FRMP:')) {
                const p = tok.substring(5).split('/');
                tm.mp = parseInt(p[0]) || 0; tm.max_mp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('FRSTR:')) tm.str = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRAGI:')) tm.agi = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRINT:')) tm.int = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRVIT:')) tm.vit = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('FRWE:')) {
                if (frSkill) tm.skills = [...(tm.skills || []), frSkill];
                frSkill = { name: tok.substring(5) };
            } else if (frSkill) {
                parseSkillField(tok, frSkill);
            }
        }
        if (frSkill) tm.skills = [...(tm.skills || []), frSkill];
        if (tm.name) result.teammates.push(tm);
    }

    // --- 解析敌人段 [ENN:...] ---
    if (enIdx >= 0) {
        const enemyTokens = rawTokens.slice(enIdx);
        let curEnemy = null, curESkill = null;
        for (const tok of enemyTokens) {
            if (tok.startsWith('ENN:')) {
                if (curEnemy) { if (curESkill) { curEnemy.skills.push(curESkill); curESkill = null; } result.enemies.push(curEnemy); }
                curEnemy = { name: tok.substring(4), skills: [] };
            } else if (!curEnemy) continue;
            else if (tok.startsWith('ENGR:')) curEnemy.level = parseInt(tok.substring(5)) || 0;
            else if (tok.startsWith('ENHP:')) {
                const p = tok.substring(5).split('/');
                curEnemy.hp = parseInt(p[0]) || 0; curEnemy.max_hp = parseInt(p[1]) || 0;
            } else if (tok.startsWith('ENSTR:')) curEnemy.str = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENAGI:')) curEnemy.agi = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENINT:')) curEnemy.int = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENVIT:')) curEnemy.vit = parseInt(tok.substring(6)) || 0;
            else if (tok.startsWith('ENS:')) {
                if (curESkill) curEnemy.skills.push(curESkill);
                curESkill = { name: tok.substring(4) };
            } else if (curESkill) {
                parseSkillField(tok, curESkill);
            }
            if (tok.startsWith('PN5A:')) {
                if (curESkill) { curEnemy.skills.push(curESkill); curESkill = null; }
                curEnemy.attackPattern = tok.substring(5).split(',');
            }
        }
        if (curEnemy) { if (curESkill) curEnemy.skills.push(curESkill); result.enemies.push(curEnemy); }
    }
    return result;
}

/**
 * 从 <user_status> 的 <details> 块解析装备/背包/技能/属性等
 */
function parseUserStatus(statusText) {
    const state = {};
    const hpM = statusText.match(/\u5F53\u524D\u751F\u547D\u503C[：:]\s*(\d+)\/(\d+)/);
    if (hpM) { state.hp = parseInt(hpM[1]); state.max_hp = parseInt(hpM[2]); }
    const mpM = statusText.match(/\u5F53\u524D\u6CD5\u529B\u503C[：:]\s*(\d+)\/(\d+)/);
    if (mpM) { state.mp = parseInt(mpM[1]); state.max_mp = parseInt(mpM[2]); }
    const strM = statusText.match(/\u529B\u91CF\s*\u0028STR\u0029[：:]\s*(\d+)/);
    if (strM) state.str = parseInt(strM[1]);
    const agiM = statusText.match(/\u654F\u6377\s*\u0028AGI\u0029[：:]\s*(\d+)/);
    if (agiM) state.agi = parseInt(agiM[1]);
    const intM = statusText.match(/\u667A\u529B\s*\u0028INT\u0029[：:]\s*(\d+)/);
    if (intM) state.int = parseInt(intM[1]);
    const vitM = statusText.match(/\u8010\u529B\s*\u0028VIT\u0029[：:]\s*(\d+)/);
    if (vitM) state.vit = parseInt(vitM[1]);
    const lvlM = statusText.match(/\u5F53\u524D\u7B49\u7EA7[：:]\s*Lv\.?(\d+)/i);
    if (lvlM) state.level = parseInt(lvlM[1]);
    const expM = statusText.match(/\u603B\u7ECF\u9A8C\u503C[：:]\s*(\d+)/);
    if (expM) state.exp = parseInt(expM[1]);
    const corM = statusText.match(/\u73C2\u5C14\s*\u0028Cor\u0029[：:]\s*(\d+)/);
    if (corM) state.cor = parseInt(corM[1]);
    const yuldM = statusText.match(/\u7531\u9C81\u7279\s*\u0028Yuld\u0029[：:]\s*(\d+)/);
    if (yuldM && !state.cor) state.cor = parseInt(yuldM[1]);

    // 装备解析: "主手: ⭐Lv.5 铁剑 (耐:100/100)" followed by stats line "❤️+50 💪+2 🏃+0 🧠+0 🔋+6"
    state.equipment = {};
    const equipSlotMap = { '主手': 'weapon', '副手': 'off_hand', '头部': 'head', '胸部': 'chest', '手部': 'hands', '腿部': 'legs', '饰品': 'accessory' };
    // 匹配 "主手: ⭐Lv.5 铁剑 (耐:100/100)" 格式
    const equipLines = statusText.match(/(?:主手|副手|头部|胸部|手部|腿部|饰品)\s*(?:1|2)?\s*[：:]\s*[^\n]+/g) || [];
    for (const line of equipLines) {
        const slotMatch = line.match(/(主手|副手|头部|胸部|手部|腿部|饰品)/);
        if (!slotMatch) continue;
        const slotKey = equipSlotMap[slotMatch[1]] || 'accessory';
        // 提取等级
        const lvlMatch = line.match(/⭐Lv\.?(\d+)/i) || line.match(/Lv\.?(\d+)/i);
        // 提取名称：⭐Lv.5 后面的词，或 ：后面的词
        // 提取名称：⭐Lv.X 后、(耐:...) 前的文本；无等级时取冒号后、(耐:...) 前的文本
        let nameMatch = line.match(/⭐?Lv\.?\d*\s+(.+?)\s*\(耐/);
        if (!nameMatch) nameMatch = line.match(/⭐?Lv\.?\d*\s+(.+?)\s*$/);  // 无耐久时取到行尾
        if (!nameMatch) {
            // 无等级前缀：取冒号后、(耐:...) 前
            const colonMatch = line.match(/[：:]\s*(.+?)\s*\(耐/);
            if (colonMatch) nameMatch = [null, colonMatch[1]];
            else {
                const colonOnly = line.match(/[：:]\s*(.+?)\s*$/);
                if (colonOnly) nameMatch = [null, colonOnly[1]];
            }
        }
        // 提取耐久
        const durMatch = line.match(/\(耐[:：](\d+\/\d+)\)/) || line.match(/耐[:：](\d+\/\d+)/);
        // 提取该行后面的属性行 "❤️+50 💪+2 🏃+0 🧠+0 🔋+6"
        const lineIdx = statusText.indexOf(line);
        const afterLine = statusText.substring(lineIdx + line.length, lineIdx + line.length + 200);
        const statsLine = afterLine.match(/❤️\+(\d+).*?💪\+(\d+).*?🏃\+(\d+).*?🧠\+(\d+).*?🔋\+(\d+)/s);
        
        const equip = { name: nameMatch ? nameMatch[1] : '未知' };
        // Bug fix: 空槽位占位词过滤 — "主手: 无" 不应创建装备
        const PLACEHOLDER_NAMES = ['无', '空', '[空]', 'なし', 'none', '空き', '未装备', '未知'];
        if (PLACEHOLDER_NAMES.includes(equip.name.trim())) continue;
        if (lvlMatch) equip.item_level = parseInt(lvlMatch[1]);
        if (durMatch) equip.durability = durMatch[1];
        if (statsLine) {
            // Bug#store-1: schema + 所有读取者(STAT_PRIORITY/keyStat/findBestMatch)用 camelCase maxHp/maxMp，
            // 原 snake_case max_hp 致装备 HP 加成存错键、投影/匹配全部失效。
            equip.stats = {
                maxHp: parseInt(statsLine[1]) || 0,
                str: parseInt(statsLine[2]) || 0,
                agi: parseInt(statsLine[3]) || 0,
                int: parseInt(statsLine[4]) || 0,
                vit: parseInt(statsLine[5]) || 0,
            };
        }
        state.equipment[slotKey] = equip;
    }

    // 背包: "• 初级治疗药水 x 10 (⭐Lv.1, 瞬间恢复100点HP。)" or equipment "• 铁剑 (耐:100/100) | 武器\n(⭐Lv.5|💎蓝色|❤️HP+75|💪STR+2|🔋VIT+6)"
    state.inventory = [];
    const invMatches = statusText.matchAll(/[•]\s*(.+?)\s*x\s*(\d+)\s*(?:\((.+?)\))?/g);
    for (const m of invMatches) {
        const item = { name: m[1].trim(), qty: parseInt(m[2]) || 1 };
        // 类型判断：消耗品名称关键词优先，其次武器/防具关键词
        if (CONSUMABLE_NAME_RE.test(item.name)) {
            item.type = 'consumable';
        } else if (EQUIP_NAME_RE.test(item.name)) {
            item.type = 'equipment';
        }
        if (m[3]) {
            const detail = m[3].trim();
            // Try to extract item level: ⭐Lv.1 or ⭐Lv1
            const lvlMatch = detail.match(/⭐Lv\.?(\d+)/);
            if (lvlMatch) item.item_level = parseInt(lvlMatch[1]);
            // Try to extract rarity: 💎蓝色 etc.
            const rarMatch = detail.match(/💎(\S+)/);
            if (rarMatch) item.rarity = rarMatch[1];
            // The description is the rest after the level portion
            // e.g. "⭐Lv.1, 瞬间恢复100点HP。" → "瞬间恢复100点HP。"
            const descParts = detail.split(/[,，]\s*/);
            const descFiltered = descParts.filter(p => p.trim() && !p.match(/⭐Lv/)).map(p => p.trim());
            if (descFiltered.length > 0) item.description = descFiltered.join('，');
            else item.description = detail;
        }
        state.inventory.push(item);
    }

    // Also handle equipment-style backpack entries: "• 铁剑 (耐:100/100) | 武器\n(⭐Lv.5|💎蓝色|❤️HP+75|💪STR+2|🔋VIT+6)"
    const equipInvBlocks = statusText.match(/[•]\s*(\S+)\s*\(耐[:：](\d+\/\d+)\)\s*\|\s*(\S+)\s*\n?\s*\(([^)]+)\)/g) || [];
    for (const block of equipInvBlocks) {
        const bm = block.match(/[•]\s*(\S+)\s*\(耐[:：](\d+\/\d+)\)\s*\|\s*(\S+)\s*\n?\s*\(([^)]+)\)/);
        if (bm) {
            const item = { name: bm[1].trim(), qty: 1, type: bm[3].trim(), durability: bm[2] };
            const detail = bm[4];
            const lvlMatch = detail.match(/⭐Lv\.?(\d+)/);
            if (lvlMatch) item.item_level = parseInt(lvlMatch[1]);
            const rarMatch = detail.match(/💎(\S+)/);
            if (rarMatch) item.rarity = rarMatch[1];
            // Parse stats like ❤️HP+75|💪STR+2|🔋VIT+6
            const stats = [];
            const statMatches = detail.matchAll(/[❤️💪🔋⚔️🛡️]\s*(\w+)[+\s]*(\d+)/g);
            for (const sm of statMatches) stats.push(`${sm[1]}+${sm[2]}`);
            if (stats.length > 0) item.description = stats.join('，');
            item._equip_backpack = true;
            state.inventory.push(item);
        }
    }

    // 技能: 卡片格式为 "• 刺击 (技能等级: 1)" 或 "• 刺击 Lv1"
    state.skills = [];
    const skillMatches = statusText.matchAll(/[•]\s*(\S+)\s*(?:\(\s*技能等级\s*[:：]\s*(\d+)\s*\)|Lv\.?\s*(\d+))/gi);
    for (const m of skillMatches) {
        const level = m[2] ? parseInt(m[2]) : (m[3] ? parseInt(m[3]) : 0);
        state.skills.push({ name: m[1], skill_level: level });
    }

    return state;
}

// === 主提取函数（callModelFn 通过参数注入） ===

/**
 * P3 重设计：主数据源切换为 status 专家 JSON（chatMetadata.panels[messageId].state）。
 * 回退链：专家 JSON → mes 标签正则解析（过渡兼容）→ LLM 模型提取（最终回退）。
 * @param {string} aiMessage - AI 消息原文
 * @param {Function} callModelFn - 模型调用函数
 * @param {number|string} [messageId] - P3：用于读取 status 专家面板数据
 */
export async function extractAll(aiMessage, callModelFn, messageId) {
    if (!callModelFn) throw new Error('callModelFn is required');
    const settings = getSettings();
    if (!settings.enabled) return null;

    // === P3: 优先从 status 专家面板数据读取 ===
    if (messageId != null) {
        const data = getSaoData();
        const statusPanel = data?.panels?.[messageId]?.status;
        // statusPanel.html 在 P3 存的是 {state, zdText} 对象（persistSpecialistPanel 包成 html 字段——这里兼容两种结构）
        if (statusPanel) {
            // persistSpecialistPanel(messageId, 'status', {state, zdText}) 把对象存入 html 字段
            const panelData = (typeof statusPanel.html === 'string') ? safeJsonParse(statusPanel.html) : statusPanel.html;
            if (panelData && panelData.state) {
                const state = { ...panelData.state }; // shallow copy: don't mutate stored panel data during HP/MP supplementation
                const npcUpdates = panelData.npcUpdates || [];

                // 补充 HP/MP：当专家面板 state 缺少 hp/mp 时，从标签解析补充
                let supplemented = false;
                if (state.hp == null || state.max_hp == null || state.mp == null || state.max_mp == null) {
                    const zdMatch = aiMessage.match(/<zd_status>([\s\S]*?)<\/zd_status>/);
                    if (zdMatch) {
                        try {
                            const zd = parseZdStatus(zdMatch[1]);
                            if (state.hp == null && zd.player.hp != null) { state.hp = zd.player.hp; supplemented = true; }
                            if (state.max_hp == null && zd.player.max_hp != null) { state.max_hp = zd.player.max_hp; supplemented = true; }
                            if (state.mp == null && zd.player.mp != null) { state.mp = zd.player.mp; supplemented = true; }
                            if (state.max_mp == null && zd.player.max_mp != null) { state.max_mp = zd.player.max_mp; supplemented = true; }
                        } catch (e) { /* ignore parse errors */ }
                    }
                }
                if (state.hp == null || state.max_hp == null || state.mp == null || state.max_mp == null) {
                    const usMatch = aiMessage.match(/<user_status>([\s\S]*?)<\/user_status>/);
                    if (usMatch) {
                        try {
                            const us = parseUserStatus(usMatch[1]);
                            if (state.hp == null && us.hp != null) { state.hp = us.hp; supplemented = true; }
                            if (state.max_hp == null && us.max_hp != null) { state.max_hp = us.max_hp; supplemented = true; }
                            if (state.mp == null && us.mp != null) { state.mp = us.mp; supplemented = true; }
                            if (state.max_mp == null && us.max_mp != null) { state.max_mp = us.max_mp; supplemented = true; }
                        } catch (e) { /* ignore parse errors */ }
                    }
                }

                log(supplemented ? 'status 专家面板数据命中（补充 HP/MP + npcUpdates）' : 'status 专家面板数据命中（跳过标签解析+模型）');
                return { state, npcUpdates };
            }
        }
    }

    // === 回退 1: 从 <zd_status> 和 <user_status> 直接解析（过渡兼容） ===
    const state = {};
    let parsedFromTags = false;

    // 1) 解析 <zd_status>
    const zdMatch = aiMessage.match(/<zd_status>([\s\S]*?)<\/zd_status>/);
    if (zdMatch) {
        try {
            const zd = parseZdStatus(zdMatch[1]);
            if (zd.player.name) state.player_name = zd.player.name;
            if (zd.player.level) state.level = zd.player.level;
            if (zd.player.hp != null) { state.hp = zd.player.hp; state.max_hp = zd.player.max_hp; }
            if (zd.player.mp != null) { state.mp = zd.player.mp; state.max_mp = zd.player.max_mp; }
            if (zd.player.str != null) { state.str = zd.player.str; state.agi = zd.player.agi; state.int = zd.player.int; state.vit = zd.player.vit; }
            if (zd.player.items) state.inventory = zd.player.items;
            if (zd.skills.length > 0) state.skills = zd.skills.map(s => ({
                name: s.name,
                skill_level: 0,
                base_damage: s.atk,
                hit_rate: s.hit,
                crit_rate: s.crit,
                mp_cost: s.mpCost,
                cooldown: s.cd,
                hits: s.apt,
                targets: s.tpa,
                core_code: s.wn,
                affix_codes: s.en || [],
                effects_description: (s.en || []).join(', '),
            }));
            state._zd_parsed = zd; // 保留完整解析供战斗/队友使用
            parsedFromTags = true;
            log('<zd_status> 正则解析成功');
        } catch (e) {
            log('<zd_status> 解析失败: ' + e.message, 'warn');
        }
    }

    // 2) 解析 <user_status> (装备/背包/技能/属性/位置)
    const statusMatch = aiMessage.match(/<user_status>([\s\S]*?)<\/user_status>/);
    if (statusMatch) {
        try {
            const us = parseUserStatus(statusMatch[1]);
            // 合并规则：
            // - equipment/inventory: 专家(P3) 优先（权威状态源），user_status 仅补充专家未提供的字段
            // - skills: zd_status 优先（有完整战斗属性 ATK/Hit%/Crit% 等），仅补充 skill_level
            for (const k of Object.keys(us)) {
                if (k === 'equipment' || k === 'inventory') {
                    if (us[k] && (Array.isArray(us[k]) ? us[k].length > 0 : Object.keys(us[k]).length > 0)) {
                        if (!state[k] || (Array.isArray(state[k]) ? state[k].length === 0 : Object.keys(state[k]).length === 0)) {
                            state[k] = us[k];
                        } else if (k === 'equipment' && typeof state[k] === 'object') {
                            for (const slot of Object.keys(us[k])) {
                                if (!state[k][slot]) state[k][slot] = us[k][slot];
                            }
                        }
                    }
                } else if (k === 'skills') {
                    // 技能：不覆盖 zd_status 的完整数据，仅补充 skill_level
                    // user_status 的技能格式是 "• 刺击 (技能等级: 1)"，解析为 {name, skill_level}
                    if (us.skills && us.skills.length > 0 && state.skills && state.skills.length > 0) {
                        for (const usSk of us.skills) {
                            const zdSk = state.skills.find(s => s.name === usSk.name);
                            if (zdSk && usSk.skill_level != null) {
                                zdSk.skill_level = usSk.skill_level;
                            }
                        }
                    }
                    // 如果 zd_status 没有技能数据，才用 user_status 的（fallback）
                    if ((!state.skills || state.skills.length === 0) && us.skills && us.skills.length > 0) {
                        state.skills = us.skills;
                    }
                } else if (us[k] != null) {
                    state[k] = us[k];
                }
            }
            parsedFromTags = true;
            log('<user_status> 正则解析成功');
        } catch (e) {
            log('<user_status> 解析失败: ' + e.message, 'warn');
        }
    }

    // 3) 解析 <time> 标签获取位置/楼层/章节信息
    const timeMatch = aiMessage.match(/<time>([\s\S]*?)<\/time>/);
    if (timeMatch) {
        const timeText = timeMatch[1];
        // 格式: 『[date] - [Seq: N] - [time] - [arc] - [floor] - [location] - [weather]』
        const parts = timeText.replace(/[『』]/g, '').split(/\s*-\s*/);
        if (parts.length >= 5) {
            // 找到 arc, floor, location
            for (let pi = 0; pi < parts.length; pi++) {
                const p = parts[pi].trim();
                if (/^\d+F$/i.test(p) && !state.floor) state.floor = parseInt(p) || null;
                if (/F$/.test(p) && !state.floor) state.floor = parseInt(p) || null;
            }
            // arc 通常是中文名如 "刀剑神域" / "幽灵子弹" 等
            // location 通常是最后一两个部分
            if (parts.length >= 6 && !state.location) {
                state.location = parts[parts.length - 2].trim();
            }
            // weather 是最后一个 part（跳过占位词"天气"）
            if (parts.length >= 7) {
                const weatherText = parts[parts.length - 1].trim();
                if (weatherText && weatherText !== '天气') {
                    state._weather = weatherText;
                }
            }
        }
    }

    if (parsedFromTags && Object.keys(state).length > 0) {
        log('状态从标签直接解析完成 (跳过模型调用)');
        return { state };
    }

    // === 回退: 使用模型提取 ===
    const systemPrompt = `你是 SAO 游戏状态提取器。分析 AI 的输出文本，提取游戏状态信息，只输出 JSON。注意查找 <zd_status> 和 <user_status> 标签中的数据。`;
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
- 优先从 <zd_status> 和 <user_status> 标签内提取
- 如果某字段无法确定，用 null
- player_name 必须是玩家角色名，不是NPC名，无法确定则为 null

AI 输出：
---
${aiMessage.substring(0, 8000)}`;

    try {
        const result = await callModelFn('extract', [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], 1024, { jsonSchema: true });
        const extracted = extractJsonObject(result);
        if (!extracted) {
            log('多任务提取: JSON 提取失败 (result 长度=' + (result?.length || 0) + ' 前80字符: ' + (result || '').slice(0, 80) + ')', 'warn');
            return null;
        }
        log('多任务提取完成 (模型回退)');
        return extracted;
    } catch (e) {
        log('多任务提取失败: ' + e.message, 'error');
        return null;
    }
}

// === 数据应用函数（customSkillDefs 通过参数注入） ===

/**
 * 检查叙事文本中是否包含技能获取信号。
 * 需要同时包含获取动词和技能名词，以减少误判：
 * - 单独"技能" → "你的技能很生疏"误判
 * - 单独"获得" → "获得了经验值"误判
 * - 动词+名词交集 → 高置信度获取信号
 */
function hasSkillAcquisitionSignal(text) {
    if (!text) return false;
    const acquisitionVerbs = [
        '学会了', '习得了', '获得了', '解锁了', '领悟了', '掌握了',
        '觉醒了', '觉醒', '爆出', '掉落了', '突破了', '跨越了',
        '学会', '习得', '获得', '解锁', '领悟', '掌握',
        '新技能', '新剑技', '新招式',
    ];
    const skillNouns = [
        '剑技', '技能', '剑招', '招式', '武技', '战技', '刀技',
        '连击', '必杀技', '奥义', '绝技',
    ];
    const hasVerb = acquisitionVerbs.some(v => text.includes(v));
    const hasNoun = skillNouns.some(n => text.includes(n));
    return hasVerb && hasNoun;
}

export async function applyExtractedData(extracted, customSkillDefs, isNewGame = false, rawText = '') {
    if (!extracted) return;
    const data = getStore();
    if (!data) return;

    if (extracted.state) {
        const s = extracted.state;

        // 2. Equipment → 只更新已有装备的运行时状态（如耐久度），不创建新装备。
        // 新装备只能通过 <gain_equipment> 标签 → generateEquipment 创建（路径A，逻辑管理）。
        // 专家只报告当前装备状态，无权创建装备定义。
        if (s.equipment && typeof s.equipment === 'object') {
            const equipStore = getEquipmentStore();
            for (const [oldSlot, equipData] of Object.entries(s.equipment)) {
                if (!equipData || typeof equipData !== 'object') continue;
                const newSlot = oldSlot;
                if (!SLOT_ENUM.includes(newSlot)) {
                    log(`applyExtractedData: 非法槽位 "${newSlot}"，跳过`, 'warn');
                    continue;
                }
                if (!equipData.name) continue;
                // 查找已存在的装备（按名称匹配）
                const existingIds = equipStore?.nameToId?.[equipData.name] || [];
                const existingId = existingIds.find(id => equipStore.byId[id]);
                if (!existingId) {
                    log(`applyExtractedData: 装备 "${equipData.name}" 不在 equipmentStore 中（需通过 gain_equipment 标签生成），跳过`, 'info');
                    continue;
                }
                // 已存在：仅更新运行时状态（耐久度），不覆盖 stats/affixes/rarity
                const entry = equipStore.byId[existingId];
                if (equipData.durability) {
                    const parts = String(equipData.durability).split('/');
                    const cur = parseInt(parts[0]);
                    const max = parts[1] != null ? parseInt(parts[1]) : NaN;
                    if (!isNaN(cur)) entry.durability = { current: cur, max: isNaN(max) ? cur : max };
                }
                // 确保装备在对应槽位
                const player = getPlayerStore();
                if (player.equipment?.[newSlot] !== existingId) {
                    try { await equipItem(newSlot, existingId, true); } catch (e) { log(`equipItem 失败: ${e.message}`, 'warn'); }
                }
            }
        }

        // 1. 数值 → playerStore（逻辑管理：新游戏数值全部由插件逻辑定义，
        //    不从卡片/LLM 读取 STR/AGI/INT/VIT/HP/MP。装备加成在上方 equipItem 中已处理。
        //    之后 LLM 消息不再覆盖数值；maxHp/maxMp 由升级成长 + 装备加成管理。
        if (isNewGame) {
            initStartingCharacter();
        }
        // 非新游戏：hp/mp/str/agi/int/vit 不再从 LLM 提取覆盖

        if (s.level != null || s.exp != null) {
            await updatePlayerProgression(s.level, s.exp, true);
        }
        if (isNewGame) {
            // 珂尔初始化为逻辑定义值（不从卡片读取）
            await updateCurrency(STARTING_COR, true);
        } else if (s.cor != null) {
            await updateCurrency(s.cor, true);
        }
        if (s.location != null || s.floor != null) {
            const player = getPlayerStore();
            await updatePlayerPosition(s.floor || player.position.floor_id, s.location || player.position.location, true);
        }
        if (s.player_name != null) {
            const player = getPlayerStore();
            await updatePlayerIdentity(s.player_name, player.identity.title, true);
        }

        // cursor_type → playerStore.cursor_type（顶层字段，不在 identity 里）
        if (s.cursor_type != null) {
            const CURSOR_TYPE_ENUM = ['green', 'orange', 'red'];
            const player = getPlayerStore();
            if (CURSOR_TYPE_ENUM.includes(s.cursor_type)) {
                player.cursor_type = s.cursor_type;
            } else {
                player.cursor_type = 'green';
            }
        }

        // 3. Inventory → inventoryStore (consumables/materials/quest items only; equipment handled by equipItem)
        if (Array.isArray(s.inventory) && s.inventory.length > 0) {
            for (const item of s.inventory) {
                if (!item || !item.name) continue;
                // Determine type: if item has stats/equipment-like fields OR matches weapon/armor name keywords,
                // route to equipment+inventory (backpack).
                // 消耗品名称优先：即使含武器关键词（如"剑技药水"含"剑"），含药水/食物等词则判为消耗品。
                const isConsumableByName = CONSUMABLE_NAME_RE.test(item.name);
                const looksLikeEquipment = !item.type && !isConsumableByName && EQUIP_NAME_RE.test(item.name);
                if (!isConsumableByName && (item.stats || item.slot || item._equip_backpack || item.durability || item.type === 'equipment' || looksLikeEquipment)) {
                    // 装备项：不通过专家创建，只在 equipmentStore 已存在时添加到背包
                    // 新装备只能通过 <gain_equipment> 标签 → generateEquipment 创建（逻辑管理数值）
                    const equipStore = getEquipmentStore();
                    const existingIds = equipStore?.nameToId?.[item.name] || [];
                    const existingId = existingIds.find(id => equipStore.byId[id]);
                    if (!existingId) {
                        log(`applyExtractedData: 装备 "${item.name}" 不在 equipmentStore 中（需通过 gain_equipment 标签生成），跳过`, 'info');
                        continue;
                    }
                    // 已存在：更新耐久度（如有），确保在背包中
                    if (item.durability) {
                        const parts = String(item.durability).split('/');
                        const cur = parseInt(parts[0]);
                        const max = parts[1] != null ? parseInt(parts[1]) : NaN;
                        if (!isNaN(cur)) {
                            equipStore.byId[existingId].durability = { current: cur, max: isNaN(max) ? cur : max };
                        }
                    }
                    await addEquipmentItem(existingId, true);
                    continue;
                }
                const type = item.type || 'consumable';
                const qty = item.qty || 1;
                if (type === 'material') {
                    await addMaterial(item.name, qty, true);
                } else if (type === 'quest_item') {
                    await addQuestItem(item.name, item.description || '', true);
                } else {
                    // consumable (default) — use consumableStore definition pattern
                    if (!item.name) { log('extract: 消耗品缺少 name，跳过', 'warn'); continue; }
                    const consumableId = findOrCreateConsumable({
                        name: item.name,
                        category: item.category || 'hp_restore',
                        rarity: item.rarity || 'common',
                        item_level: item.item_level || 1,
                        effects: item.effects || [],
                        description: item.description || '',
                        source: 'llm'
                    });
                    if (consumableId) await setConsumableQty(consumableId, qty, true);
                }
            }
        }

        // 3b. sellActions → 从背包移除物品 + 增加货币
        if (Array.isArray(s.sellActions) && s.sellActions.length > 0) {
            const invStore = getInventoryStore();
            for (const action of s.sellActions) {
                if (!action || !action.name) continue;
                const sellQty = Math.max(1, Math.floor(Number(action.qty) || 1));
                const corGained = Math.max(0, Math.floor(Number(action.cor_gained) || 0));
                log(`sellActions: 尝试售出 ${action.name} x${sellQty} → +${corGained} Cor`);

                // 按名称在背包中查找物品
                // 先找装备类
                let sold = false;
                for (let i = invStore.items.length - 1; i >= 0; i--) {
                    const invItem = invStore.items[i];
                    if (invItem.type === 'equipment' && invItem.equipment_id) {
                        const eqDef = getEquipmentById(invItem.equipment_id);
                        if (eqDef && eqDef.name === action.name) {
                            await removeEquipmentItem(invItem.equipment_id, true);
                            sold = true;
                            log(`sellActions: 装备售出 ${action.name} (equipment_id=${invItem.equipment_id})`);
                            break;
                        }
                    }
                }
                // Fallback: check if the item is currently equipped (not in inventory)
                if (!sold) {
                    const player = getPlayerStore();
                    for (const [slot, equipId] of Object.entries(player.equipment || {})) {
                        if (!equipId) continue;
                        const eqDef = getEquipmentById(equipId);
                        if (eqDef && eqDef.name === action.name) {
                            try {
                                await unequipItem(slot, true);
                                await removeEquipmentItem(equipId, true);
                                const { removeEquipmentById } = await import('./sao-store-equipment.js');
                                await removeEquipmentById(equipId, true);
                                sold = true;
                                log(`sellActions: 装备售出(已装备) ${action.name} (slot=${slot})`);
                            } catch (e) {
                                log(`sellActions: 卸下并售出装备失败: ${e.message}`, 'warn');
                            }
                            break;
                        }
                    }
                }
                // 找消耗品类
                if (!sold) {
                    for (let i = invStore.items.length - 1; i >= 0; i--) {
                        const invItem = invStore.items[i];
                        if (invItem.type === 'consumable' && invItem.consumable_id) {
                            const { getConsumableById } = await import('./sao-store-consumable.js');
                            const conDef = getConsumableById(invItem.consumable_id);
                            if (conDef && conDef.name === action.name) {
                                const newQty = (invItem.qty || 1) - sellQty;
                                if (newQty <= 0) {
                                    invStore.items.splice(i, 1);
                                } else {
                                    invItem.qty = newQty;
                                }
                                sold = true;
                                log(`sellActions: 消耗品售出 ${action.name} x${sellQty} (剩余 ${Math.max(0, newQty)})`);
                                break;
                            }
                        }
                    }
                }
                // 找材料类
                if (!sold) {
                    for (let i = invStore.items.length - 1; i >= 0; i--) {
                        const invItem = invStore.items[i];
                        if (invItem.type === 'material' && invItem.name === action.name) {
                            const newQty = (invItem.qty || 1) - sellQty;
                            if (newQty <= 0) {
                                invStore.items.splice(i, 1);
                            } else {
                                invItem.qty = newQty;
                            }
                            sold = true;
                            log(`sellActions: 材料售出 ${action.name} x${sellQty}`);
                            break;
                        }
                    }
                }

                if (sold && corGained > 0) {
                    const currentCor = (invStore.currency?.cor) || 0;
                    await updateCurrency(currentCor + corGained, true);
                    log(`sellActions: 货币 +${corGained} → ${currentCor + corGained} Cor`);
                } else if (!sold) {
                    log(`sellActions: 未找到物品 "${action.name}"，跳过售出`, 'warn');
                }
            }
        }

        // 4. Skills → 只更新已有技能的熟练度，不创建新技能。
        // 新技能只能通过 <gain_skill> 标签 → generateSkill 创建（路径A，逻辑管理数值）。
        // 专家只报告当前技能状态（熟练度），无权创建技能定义。
        if (Array.isArray(s.skills) && s.skills.length > 0) {
            const player = getPlayerStore();
            const customSkillNames = new Set();
            const customIds = player.customSkills || [];
            if (customSkillDefs) {
                for (const id of customIds) {
                    if (customSkillDefs[id]?.name) customSkillNames.add(customSkillDefs[id].name);
                }
            }

            const existingSkillNames = new Set((player.skills || []).map(s => s.name));

            for (const sk of s.skills) {
                if (!sk.name) continue;
                // Skip custom skills (don't overwrite)
                if (customSkillNames.has(sk.name)) continue;

                // 只更新已有技能的熟练度，不创建新技能
                if (!existingSkillNames.has(sk.name)) {
                    log(`[技能] "${sk.name}" 不在 playerStore.skills 中（需通过 gain_skill 标签生成），跳过`, 'info');
                    continue;
                }

                // 更新已有技能熟练度
                const proficiency = sk.skill_level || sk.proficiency;
                if (proficiency != null) {
                    const existing = (player.skills || []).find(s => s.name === sk.name);
                    if (existing) {
                        // 防递减：熟练度只增不减
                        if (proficiency > (existing.proficiency || 0)) {
                            existing.proficiency = proficiency;
                            log(`[技能] 更新 "${sk.name}" 熟练度 → ${proficiency}`);
                        }
                    }
                }
            }
        }

        // 4b. 月蚀系统：冥想熟练度 / 子技熟练度 / 计算过载
        // 防递减：冥想熟练度只增不减（防止 LLM 困惑时输出 0 重置进度）
        if (s.meditationProficiency != null) {
            const curMed = getPlayerStore()?.meditationProficiency || 0;
            if (s.meditationProficiency > curMed) {
                updateMeditationProficiency(s.medititationProficiency, true);
            }
        }
        // 子技熟练度同样只增不减
        if (s.uniqueSkillProficiency && typeof s.uniqueSkillProficiency === 'object') {
            const us = getPlayerStore()?.uniqueSkill;
            for (const [techId, prof] of Object.entries(s.uniqueSkillProficiency)) {
                if (prof == null) continue;
                const curProf = us?.subTechniques?.[techId]?.proficiency || 0;
                if (prof > curProf) updateSubTechniqueProficiency(techId, prof, true);
            }
        }
        if (s.incapacitated != null) {
            const player = getPlayerStore();
            player.incapacitated = !!s.incapacitated;
            if (s.incapacitated) {
                log('[月蚀] 计算过载 — 无法战斗状态激活');
            } else {
                log('[月蚀] 计算过载解除');
            }
        }

        // 5. _zd_parsed → runtime (NOT data.state)
        if (s._zd_parsed) {
            const d = getStore();
            if (!d.runtime) d.runtime = {};
            d.runtime._zd_parsed = s._zd_parsed;

            // FRN teammates: also sync to npcStore so they appear in the NPC panel
            // and get last_seen_date tracking. Combat vitals stay in _zd_parsed;
            // here we only ensure NPC existence + presence markers. This is the
            // fallback path's secondary NPC detection (when the status specialist
            // misses an on-scene teammate that zd_status explicitly listed).
            const tmList = s._zd_parsed.teammates || [];
            for (const tm of tmList) {
                if (!tm.name) continue;
                try {
                    const npcId = findOrCreateNpc(tm.name);
                    if (!npcId) continue;
                    const cur = getNpcById(npcId);
                    const upd = {};
                    // Update presence markers only if specialist didn't already
                    // update them this turn (npcUpdates takes precedence above).
                    if (!cur?.state?.last_seen_date) upd.last_seen_date = extracted._date || null;
                    if (!cur?.state?.floor_id && extracted.state?.floor) upd.floor_id = extracted.state.floor;
                    if (!cur?.state?.location && extracted.state?.location) upd.location = String(extracted.state.location);
                    if (Object.keys(upd).length > 0) await updateNpcState(npcId, upd, true);
                } catch (e) {
                    log(`FRN 同步 NPC 失败 (${tm.name}): ${e.message}`, 'warn');
                }
            }
        }

        // 6. weather → worldStore.currentWeather（由 <time> 标签正则提取）
        if (s._weather) {
            const ws = getWorldStore();
            ws.currentWeather = { condition: s._weather };
        }

        log('状态已更新（store 架构）');
    }

    // 5. NPC Updates → npcStore
    const newNpcs = [];
    if (Array.isArray(extracted.npcUpdates) && extracted.npcUpdates.length > 0) {
        for (const upd of extracted.npcUpdates) {
            if (!upd || !upd.name) continue;
            try {
                // 判断是否为新 NPC（在 findOrCreateNpc 之前检查）
                const existingNpc = getNpcByName(upd.name);
                const npcId = findOrCreateNpc(upd.name);
                if (!npcId) continue;
                // 记录新创建的 NPC（之前不存在，且无 worldbook 来源）
                if (!existingNpc) {
                    newNpcs.push(upd.name);
                }
                const stateUpdate = {};
                if (upd.relationship != null) stateUpdate.relationship = String(upd.relationship);
                if (upd.affinity != null) {
                    // affinity 解读为 delta（变化量），累加到当前值
                    const current = getNpcById(npcId);
                    const delta = typeof upd.affinity === 'string'
                        ? (parseInt(upd.affinity) || 0)
                        : Number(upd.affinity) || 0;
                    stateUpdate.affinity = (current?.state?.affinity || 0) + delta;
                }
                if (upd.floor_id != null) stateUpdate.floor_id = upd.floor_id;
                if (upd.location != null) stateUpdate.location = String(upd.location);
                if (upd.last_seen_date != null) stateUpdate.last_seen_date = String(upd.last_seen_date);
                if (upd.status != null && Array.isArray(upd.status)) {
                    // Merge with existing status (union, preserving order: new statuses first, then existing ones not re-listed).
                    // Avoids losing prior statuses (e.g. "中毒") when the specialist only outputs the latest change.
                    const existing = getNpcById(npcId);
                    const existingStatus = (existing?.state?.status && Array.isArray(existing.state.status)) ? existing.state.status : [];
                    const merged = [...upd.status];
                    for (const st of existingStatus) {
                        if (!merged.includes(st)) merged.push(st);
                    }
                    stateUpdate.status = merged;
                }
                if (Object.keys(stateUpdate).length > 0) {
                    await updateNpcState(npcId, stateUpdate, true);
                }
                if (upd.observation) {
                    await addObservation(npcId, String(upd.observation), true);
                }
                log(`NPC 更新: ${upd.name} → ${JSON.stringify(stateUpdate)}`);
            } catch (e) {
                log(`NPC 更新失败 (${upd.name}): ${e.message}`, 'warn');
            }
        }
    }

    // 7. Buff Updates → playerStore.buffs
    if (Array.isArray(extracted.buffUpdates) && extracted.buffUpdates.length > 0) {
        for (const b of extracted.buffUpdates) {
            if (!b || !b.id || !b.name) continue;
            if (b.type === 'permanent') {
                addPermanentBuff(getPlayerStore(), b);
            } else {
                addTemporaryBuff(getPlayerStore(), b);
            }
        }
        log(`Buff 更新: ${extracted.buffUpdates.length} 个`);
    }

    // 8. Buff Removals
    if (Array.isArray(extracted.buffRemovals) && extracted.buffRemovals.length > 0) {
        for (const id of extracted.buffRemovals) {
            removeBuff(getPlayerStore(), id);
        }
    }

    // 9. Guild Updates
    if (Array.isArray(extracted.guildUpdates) && extracted.guildUpdates.length > 0) {
        for (const g of extracted.guildUpdates) {
            if (!g || !g.name) continue;
            if (g.action === 'create') {
                createGuild(g.name, g.leader, { headquarters: g.headquarters, buff: g.buff, description: g.description });
            } else if (g.action === 'discover') {
                discoverGuild(g.name);
            } else if (g.action === 'join') {
                const player = getPlayerStore();
                const guild = getGuildByName(g.name);
                if (guild) {
                    player.guild_id = guild.guild_id;
                    addGuildMember(guild.guild_id, player.identity?.name || '{{user}}');
                    if (guild.buff) {
                        addPermanentBuff(player, {
                            id: 'guild_' + guild.guild_id,
                            source: '公会：' + guild.name,
                            name: guild.buff.name,
                            effects: guild.buff.effects,
                            description: guild.buff.description,
                        });
                    }
                }
            } else if (g.action === 'leave') {
                const player = getPlayerStore();
                const oldGuildId = player.guild_id;
                player.guild_id = null;
                if (oldGuildId) removeBuff(player, 'guild_' + oldGuildId);
            } else if (g.action === 'member_add' && g.guild_name && g.member_name) {
                const guild = getGuildByName(g.guild_name);
                if (guild) addGuildMember(guild.guild_id, g.member_name);
            } else if (g.action === 'member_remove' && g.guild_name && g.member_name) {
                const guild = getGuildByName(g.guild_name);
                if (guild) removeGuildMember(guild.guild_id, g.member_name);
            } else if (g.action === 'disband' && g.name) {
                const guild = getGuildByName(g.name);
                if (guild) guild.disbanded = true;
            }
        }
        log(`公会更新: ${extracted.guildUpdates.length} 条`);
    }

    // 10. Housing Updates
    if (Array.isArray(extracted.housingUpdates) && extracted.housingUpdates.length > 0) {
        for (const h of extracted.housingUpdates) {
            if (!h || !h.action) continue;
            if (h.action === 'buy' || h.action === 'set') {
                setPlayerHousing(h);
            } else if (h.action === 'update') {
                updatePlayerHousing(h);
            } else if (h.action === 'decorate' && h.decoration) {
                addDecoration(h.decoration);
            } else if (h.action === 'add_furniture' && h.furniture) {
                addFurniture(h.furniture);
            } else if (h.action === 'remove_furniture' && h.name) {
                removeFurniture(h.name);
            } else if (h.action === 'sell' || h.action === 'leave') {
                clearPlayerHousing();
            }
        }
        log(`房屋更新: ${extracted.housingUpdates.length} 条`);
    }

    await saveStore();
    return newNpcs;
}
