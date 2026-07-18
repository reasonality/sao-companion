/**
 * 共享详情弹窗渲染模块 —— 聊天栏(sao-render.js Shadow DOM)与插件(index.js)共用。
 * 单一来源：改这里，两边同步生效。避免两套渲染代码漂移。
 *
 * 职责：给定 item/skill def，返回详情行 HTML 字符串。
 *   - 装备：名称/槽位/类型/稀有度/物品等级/stats/affixes/描述
 *   - 技能：武器类型/技能等级/稀有度/combat/effects.wn/en/描述
 *   - 物品：名称/数量/物品等级/类型/稀有度/效果/描述
 *
 * 调用方负责：
 *   - 装入模态容器（插件 #sao_detail_modal / 聊天栏 shadow modal）
 *   - 注入 CSS（panel.html 的 .sao-detail-row 等 / SHARED_SAO_PANEL_CSS）
 *   - 绑定按钮事件（装备/卸下/使用/丢弃）
 */
import { esc } from './sao-core.js';

/** 稀有度文本 → CSS class（兼容中文颜色/中文档位/英文）。 */
export function rarityClass(rarity) {
    if (!rarity) return 'sao-rarity-common';
    const r = String(rarity).toLowerCase();
    if (r.includes('橙') || r.includes('传说') || r.includes('red') || r.includes('legendary') || r.includes('orange')) return 'sao-rarity-legendary';
    if (r.includes('紫') || r.includes('史诗') || r.includes('epic') || r.includes('purple')) return 'sao-rarity-epic';
    if (r.includes('蓝') || r.includes('稀有') || r.includes('rare') || r.includes('blue')) return 'sao-rarity-rare';
    if (r.includes('绿') || r.includes('优质') || r.includes('uncommon') || r.includes('green')) return 'sao-rarity-uncommon';
    return 'sao-rarity-common';
}

/** 核心功能代码 → 中文标签（剑技 effects.wn）。 */
export function coreCodeLabel(code) {
    const map = { A1: '伤害输出', A2: '生命恢复', A3: '法力恢复', A4: '牺牲增益', A5: '终结技' };
    return map[code] || code;
}

/** 单行详情（label + value，value 可含 HTML）。 */
function detailRow(label, value, valueClass) {
    return `<div class="sao-detail-row"><span class="sao-detail-label">${label}</span><span class="sao-detail-value${valueClass ? ' ' + valueClass : ''}">${value}</span></div>`;
}

/** 装备详情行。 */
export function renderDetailEquip(item) {
    const rows = [];
    if (item.name) rows.push(detailRow('名称', esc(item.name)));
    if (item.slot) {
        const SLOT_EN_TO_CN = { weapon: '主手', off_hand: '副手', head: '头部', chest: '胸部', hands: '手部', legs: '腿部', accessory: '饰品' };
        rows.push(detailRow('槽位', esc(SLOT_EN_TO_CN[item.slot] || item.slot)));
    }
    if (item.weapon_type) rows.push(detailRow('武器类型', esc(item.weapon_type)));
    if (item.rarity) {
        const RARITY_EN_TO_CN = { common: '白色', uncommon: '绿色', rare: '蓝色', epic: '紫色', legendary: '金色' };
        rows.push(detailRow('稀有度', esc(RARITY_EN_TO_CN[item.rarity] || item.rarity), rarityClass(item.rarity)));
    }
    if (item.item_level != null) rows.push(detailRow('物品等级', esc(item.item_level)));
    if (item.stats) {
        const labels = { max_hp: '❤️ HP', str: '💪 STR', agi: '🏃 AGI', int: '🧠 INT', vit: '🔋 VIT', atk: '⚔️ ATK', hit: '🎯 HIT', crit: '💥 CRIT' };
        for (const [k, v] of Object.entries(item.stats)) {
            if (v != null) rows.push(detailRow(labels[k] || esc(k.toUpperCase()), '+' + esc(v)));
        }
    }
    if (item.affixes) {
        const affixHtml = item.affixes.length > 0
            ? item.affixes.map(a => `<span class="sao-tag sao-tag-affix">${esc(a)}</span>`).join(' ')
            : '<span style="opacity:0.5">无</span>';
        rows.push(detailRow('附魔', affixHtml));
    }
    if (item.description) rows.push(detailRow('描述', esc(item.description)));
    if (item.source) rows.push(detailRow('来源', esc(item.source)));
    // 如果没有任何行，至少显示名称防止空弹窗
    if (rows.length === 0 && item.name) rows.push(detailRow('名称', esc(item.name)));
    return rows.join('');
}

/** 技能详情行。describeEnFn 为可选的 EN 效果翻译函数（插件传 describeEnCode，聊天栏传简单版本）。 */
export function renderDetailSkill(sk, describeEnFn) {
    const rows = [];
    if (sk.weapon_type) rows.push(detailRow('武器类型', esc(sk.weapon_type)));
    if (sk.category) rows.push(detailRow('类别', esc(sk.category)));
    if (sk.proficiency != null) rows.push(detailRow('技能等级', 'Lv' + esc(sk.proficiency)));
    if (sk.rarity) rows.push(detailRow('稀有度', esc(sk.rarity), rarityClass(sk.rarity)));
    // combat 字段：ATK/Hit%/Crit%/APT/TPA/MP/CD（技能详情弹窗之前缺失，只剩等级+稀有度）
    if (sk.combat) {
        const c = sk.combat;
        if (c.atk != null) rows.push(detailRow('⚔️ 基础攻击力 (ATK)', esc(c.atk)));
        if (c.hit != null) rows.push(detailRow('🎯 命中率 (Hit%)', esc(c.hit) + '%'));
        if (c.crit != null) rows.push(detailRow('💥 暴击率 (Crit%)', esc(c.crit) + '%'));
        if (c.apt != null) rows.push(detailRow('🌀 攻击次数 (APT)', esc(c.apt) + ' 次/轮'));
        if (c.tpa != null) rows.push(detailRow('👥 目标数量 (TPA)', esc(c.tpa) + ' 个'));
        if (c.mpCost != null) rows.push(detailRow('💧 法力消耗 (MPCost)', esc(c.mpCost) + ' MP'));
    }
    if (sk.effects && sk.effects.wn) rows.push(detailRow('核心功能', esc(coreCodeLabel(sk.effects.wn))));
    if (sk.effects && sk.effects.en && sk.effects.en.length > 0) {
        const affixHtml = sk.effects.en.map(raw => {
            if (describeEnFn) {
                const d = describeEnFn(raw);
                return d ? `<span class="sao-tag sao-tag-affix" title="${esc(d.code)}">${esc(d.label)}</span>` : `<span class="sao-tag sao-tag-affix">${esc(raw)}</span>`;
            }
            return `<span class="sao-tag sao-tag-affix">${esc(raw)}</span>`;
        }).join(' ');
        rows.push(detailRow('词条', affixHtml));
        if (describeEnFn) {
            const descHtml = sk.effects.en.map(raw => {
                const d = describeEnFn(raw);
                return d ? `<div style="margin:2px 0;">• <strong>${esc(d.label)}</strong>：${esc(d.desc)}</div>` : '';
            }).join('');
            if (descHtml) rows.push(detailRow('效果说明', `<div style="text-align:left;max-width:320px;">${descHtml}</div>`));
        }
    }
    if (sk.description) rows.push(detailRow('描述', esc(sk.description)));
    if (sk.source) rows.push(detailRow('来源', esc(sk.source)));
    // 遗忘剑技按钮
    if (sk.skill_id) {
        rows.push(`<div style="margin-top:12px;text-align:center;">
            <button class="sao-btn sao-btn-secondary" data-sao-action="forget-skill" data-sao-skill-id="${esc(sk.skill_id)}" style="background:rgba(255,46,74,0.15);border:1px solid rgba(255,46,74,0.4);color:#ff7d8a;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:0.85em;">遗忘此剑技</button>
        </div>`);
    }
    return rows.join('');
}

/** 物品详情行。equipmentResolver 为可选的装备解析函数（传入返回装备 def 或 null）。 */
export function renderDetailInv(item, equipmentResolver, consumableResolver) {
    if (item.type === 'equipment' && item.equipment_id && equipmentResolver) {
        const eq = equipmentResolver(item.equipment_id);
        if (eq) return renderDetailEquip(eq);
    }
    // 消耗品：用 consumable_id 从 consumableStore 查定义并合并显示
    if (item.type === 'consumable' && item.consumable_id && consumableResolver) {
        const def = consumableResolver(item.consumable_id);
        if (def) {
            // 合并：def 的完整字段 + item 的 qty
            return renderDetailConsumable(def, item.qty);
        }
    }
    // 材料/任务物品/无 resolver 的 fallback：用 inventory item 自身字段
    const TYPE_LABELS = { equipment: '装备', consumable: '消耗品', material: '材料', quest_item: '任务物品' };
    const rows = [];
    if (item.name) rows.push(detailRow('名称', esc(item.name)));
    if (item.qty != null) rows.push(detailRow('数量', esc(item.qty)));
    if (item.item_level != null) rows.push(detailRow('物品等级', '⭐' + esc(item.item_level)));
    if (item.type) rows.push(detailRow('类型', esc(TYPE_LABELS[item.type] || item.type)));
    if (item.rarity) rows.push(detailRow('稀有度', esc(item.rarity), rarityClass(item.rarity)));
    if (item.effects && item.effects.length > 0) {
        rows.push(detailRow('效果', item.effects.map(e => esc(typeof e === 'string' ? e : e.name || JSON.stringify(e))).join(', ')));
    }
    if (item.description) rows.push(detailRow('描述', esc(item.description)));
    return rows.join('');
}

/** 消耗品详情弹窗 — 显示完整 schema 字段：name/category/rarity/item_level/effects/description/source + qty */
function renderDetailConsumable(def, qty) {
    const RARITY_EN_TO_CN = { common: '白色', uncommon: '绿色', rare: '蓝色', epic: '紫色', legendary: '金色' };
    const CATEGORY_CN = { hp_restore: 'HP恢复', mp_restore: 'MP恢复', full_restore: '全恢复', buff: '增益', cure: '治疗', narrative: '叙事效果' };
    const rows = [];
    if (def.name) rows.push(detailRow('名称', esc(def.name)));
    if (qty != null) rows.push(detailRow('数量', esc(qty)));
    if (def.category) rows.push(detailRow('类别', esc(CATEGORY_CN[def.category] || def.category)));
    const rarityCn = RARITY_EN_TO_CN[def.rarity] || def.rarity;
    if (def.rarity) rows.push(detailRow('稀有度', esc(rarityCn), rarityClass(def.rarity)));
    if (def.item_level != null) rows.push(detailRow('物品等级', '⭐' + esc(def.item_level)));
    // effects: 数值效果（restore/buff/cure）+ 叙事效果
    if (def.effects && def.effects.length > 0) {
        const effectHtml = def.effects.map(e => {
            if (typeof e === 'string') return `<span class="sao-tag">${esc(e)}</span>`;
            const parts = [];
            if (e.type) parts.push(e.type);
            if (e.target) parts.push(e.target);
            if (e.value != null) parts.push(e.value);
            if (e.description) parts.push(e.description);
            return `<span class="sao-tag">${esc(parts.join(' '))}</span>`;
        }).join(' ');
        rows.push(detailRow('效果', effectHtml));
    }
    if (def.description) rows.push(detailRow('描述', esc(def.description)));
    if (def.source) rows.push(detailRow('来源', esc(def.source)));
    return rows.join('');
}
