// sao-extract.js — 数据提取模块
// 从 AI 回复中提取 SAO 状态标签（zd_status/user_status）并应用到 state

import { getSettings, log, getSaoData, saveSaoDataNow, safeJsonParse } from './sao-core.js';

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
    const equipSlotMap = { '主手': 'main_hand', '副手': 'off_hand', '头部': 'head', '胸部': 'body', '手部': 'hands', '腿部': 'feet', '饰品': 'accessory' };
    // 匹配 "主手: ⭐Lv.5 铁剑 (耐:100/100)" 格式
    const equipLines = statusText.match(/(?:主手|副手|头部|胸部|手部|腿部|饰品)\s*(?:1|2)?\s*[：:]\s*\S+/g) || [];
    for (const line of equipLines) {
        const slotMatch = line.match(/(主手|副手|头部|胸部|手部|腿部|饰品)/);
        if (!slotMatch) continue;
        const slotKey = equipSlotMap[slotMatch[1]] || 'accessory';
        // 提取等级
        const lvlMatch = line.match(/⭐Lv\.?(\d+)/i) || line.match(/Lv\.?(\d+)/i);
        // 提取名称：⭐Lv.5 后面的词，或 ：后面的词
        const nameMatch = line.match(/⭐?Lv\.?\d*\s*(\S+)/);
        // 提取耐久
        const durMatch = line.match(/\(耐[:：](\d+\/\d+)\)/) || line.match(/耐[:：](\d+\/\d+)/);
        // 提取该行后面的属性行 "❤️+50 💪+2 🏃+0 🧠+0 🔋+6"
        const lineIdx = statusText.indexOf(line);
        const afterLine = statusText.substring(lineIdx + line.length, lineIdx + line.length + 200);
        const statsLine = afterLine.match(/❤️\+(\d+).*?💪\+(\d+).*?🏃\+(\d+).*?🧠\+(\d+).*?🔋\+(\d+)/s);
        
        const equip = { name: nameMatch ? nameMatch[1] : '未知' };
        if (lvlMatch) equip.item_level = parseInt(lvlMatch[1]);
        if (durMatch) equip.durability = durMatch[1];
        if (statsLine) {
            equip.stats = {
                max_hp: parseInt(statsLine[1]) || 0,
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
                log('status 专家面板数据命中（跳过标签解析+模型）');
                return { state: panelData.state };
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
            // - equipment/inventory: user_status 优先（有描述/稀有度等详细信息）
            // - skills: zd_status 优先（有完整战斗属性 ATK/Hit%/Crit% 等），仅补充 skill_level
            for (const k of Object.keys(us)) {
                if (k === 'equipment' || k === 'inventory') {
                    if (us[k] && (Array.isArray(us[k]) ? us[k].length > 0 : Object.keys(us[k]).length > 0)) {
                        state[k] = us[k];
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
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            log('多任务提取: 未找到 JSON', 'warn');
            return null;
        }
        const extracted = JSON.parse(jsonMatch[0]);
        log('多任务提取完成 (模型回退)');
        return extracted;
    } catch (e) {
        log('多任务提取失败: ' + e.message, 'error');
        return null;
    }
}

// === 数据应用函数（customSkillDefs 通过参数注入） ===

export async function applyExtractedData(extracted, customSkillDefs) {
    if (!extracted) return;
    const data = getSaoData();
    if (!data) return;

    if (extracted.state) {
        const s = extracted.state;
        if (!data.state) data.state = {};

        // 标量字段直接覆盖
        const scalars = ['hp','max_hp','mp','max_mp','str','agi','int','vit','level','exp','cor','location','floor','arc','player_name'];
        for (const k of scalars) {
            if (s[k] != null) data.state[k] = s[k];
        }

        // equipment: 深度合并（保留已有槽位）
        if (s.equipment && typeof s.equipment === 'object') {
            if (!data.state.equipment) data.state.equipment = {};
            Object.assign(data.state.equipment, s.equipment);
        }

        // inventory: 合并（按 name 去重，用新数据完全覆盖旧条目以保留 description/item_level 等）
        if (Array.isArray(s.inventory) && s.inventory.length > 0) {
            if (!data.state.inventory) data.state.inventory = [];
            for (const newItem of s.inventory) {
                const existingIdx = data.state.inventory.findIndex(i => i.name === newItem.name);
                if (existingIdx >= 0) {
                    // 用新数据完全覆盖旧条目（保留完整字段：description, item_level, rarity 等）
                    data.state.inventory[existingIdx] = { ...newItem };
                } else {
                    data.state.inventory.push({ ...newItem });
                }
            }
        }

        // skills: 合并（按 name 去重，用新数据完全覆盖旧条目以保留 base_damage/hit_rate 等）
        if (Array.isArray(s.skills) && s.skills.length > 0) {
            if (!data.state.skills) data.state.skills = [];
            for (const newSk of s.skills) {
                // P4c: 保护自定义技能不被提取数据覆盖
                const isCustom = (data.state.customSkills || []).some(id =>
                    customSkillDefs && customSkillDefs[id]?.name === newSk.name
                );
                if (isCustom) continue; // 跳过，不覆盖自定义技能
                const existingIdx = data.state.skills.findIndex(sk => sk.name === newSk.name);
                if (existingIdx >= 0) {
                    // 用新数据完全覆盖旧条目（保留完整战斗属性）
                    data.state.skills[existingIdx] = { ...newSk };
                } else {
                    data.state.skills.push({ ...newSk });
                }
            }
        }

        // 保留 zd 解析的内部数据（供战斗系统使用）
        if (s._zd_parsed) data.state._zd_parsed = s._zd_parsed;

        log('状态已更新');
    }

    await saveSaoDataNow();
}
