// SAO Companion - 记忆与关系系统模块
// 包含: Tier关系系统 + 队友管理 + 记忆检索(BM25+向量) + 代词消解

// ============================================================
// M1: Tier 关系系统
// ============================================================

/**
 * 关系维度定义 - 每个维度 7 档 tier
 * AI 只提取 tier 文本，插件内部维护数值
 */
const RELATION_DIMENSIONS = {
    trust: {
        label: '信任',
        tiers: ['陌生', '认识', '熟悉', '信任', '亲密', '信赖', '生死之交'],
        values: [0, 15, 30, 45, 60, 80, 95], // tier 对应的数值
    },
    affection: {
        label: '好感',
        tiers: ['无感', '好感', '喜欢', '心动', '爱慕', '深爱', '至死不渝'],
        values: [0, 15, 30, 45, 60, 80, 95],
    },
    respect: {
        label: '敬意',
        tiers: ['轻视', '普通', '认可', '敬佩', '崇敬', '仰慕', '崇拜'],
        values: [0, 15, 30, 45, 60, 80, 95],
    },
    fear: {
        label: '畏惧',
        tiers: ['无', '警惕', '不安', '畏惧', '恐惧', '战栗', '绝望'],
        values: [0, 15, 30, 45, 60, 80, 95],
    },
    familiarity: {
        label: '熟悉度',
        tiers: ['陌生', '见过', '认识', '了解', '熟知', '默契', '心有灵犀'],
        values: [0, 15, 30, 45, 60, 80, 95],
    },
};

/**
 * 从 tier 文本获取数值
 */
function tierToValue(dimension, tier) {
    const dim = RELATION_DIMENSIONS[dimension];
    if (!dim) return 0;
    const idx = dim.tiers.indexOf(tier);
    if (idx === -1) return 0;
    return dim.values[idx];
}

/**
 * 从数值获取 tier 文本
 */
function valueToTier(dimension, value) {
    const dim = RELATION_DIMENSIONS[dimension];
    if (!dim) return '陌生';
    let result = dim.tiers[0];
    for (let i = 0; i < dim.values.length; i++) {
        if (value >= dim.values[i]) result = dim.tiers[i];
    }
    return result;
}

/**
 * 关系类型自动推导
 */
function deriveRelationTypes(dimensions) {
    const types = [];
    const d = dimensions;
    if (d.affection >= 60) types.push('love_interest');
    if (d.trust >= 45 && d.respect >= 30) types.push('ally');
    if (d.trust >= 30) types.push('friend');
    if (d.fear >= 45) types.push('enemy');
    if (d.fear >= 30 && d.trust < 30) types.push('rival');
    if (types.length === 0) {
        if (d.familiarity >= 15) types.push('acquaintance');
        else types.push('stranger');
    }
    return types;
}

/**
 * RelationshipManager - 关系图管理
 */
const RelationshipManager = {
    /**
     * 获取某 NPC 的关系
     */
    get(data, npcName) {
        return data.relationships?.[npcName] || null;
    },

    /**
     * 创建新关系
     */
    create(data, npcName, profile = {}) {
        if (!data.relationships) data.relationships = {};
        const dimensions = {};
        for (const dim of Object.keys(RELATION_DIMENSIONS)) {
            dimensions[dim] = 0;
        }
        data.relationships[npcName] = {
            dimensions,
            relation_type: ['stranger'],
            history: [],
            npc_profile: {
                name: npcName,
                title: profile.title || '',
                known_background: profile.background || '',
                personality_tags: profile.tags || [],
            },
            last_interaction: new Date().toISOString(),
            decay_rate: 0.5, // 每天衰减 0.5
        };
        return data.relationships[npcName];
    },

    /**
     * 用 tier 更新关系（AI 提取 tier，插件设置数值）
     */
    setTier(data, npcName, dimension, tier, reason = '') {
        let rel = this.get(data, npcName);
        if (!rel) rel = this.create(data, npcName);
        const value = tierToValue(dimension, tier);
        const oldValue = rel.dimensions[dimension] || 0;
        rel.dimensions[dimension] = value;
        rel.history.push({
            timestamp: new Date().toISOString(),
            dimension,
            tier,
            old_tier: valueToTier(dimension, oldValue),
            reason,
        });
        rel.last_interaction = new Date().toISOString();
        rel.relation_type = deriveRelationTypes(rel.dimensions);
        return rel;
    },

    /**
     * 数值增减（规则驱动，如"协同战斗" → trust+1档）
     */
    applyDelta(data, npcName, dimension, deltaValue, reason = '') {
        let rel = this.get(data, npcName);
        if (!rel) rel = this.create(data, npcName);
        const oldValue = rel.dimensions[dimension] || 0;
        const newValue = Math.max(0, Math.min(100, oldValue + deltaValue));
        rel.dimensions[dimension] = newValue;
        rel.history.push({
            timestamp: new Date().toISOString(),
            dimension,
            delta: deltaValue,
            old_tier: valueToTier(dimension, oldValue),
            new_tier: valueToTier(dimension, newValue),
            reason,
        });
        rel.last_interaction = new Date().toISOString();
        rel.relation_type = deriveRelationTypes(rel.dimensions);
        return rel;
    },

    /**
     * 衰减长期未互动的关系
     */
    applyDecay(data, daysThreshold = 3) {
        if (!data.relationships) return;
        const now = Date.now();
        for (const [name, rel] of Object.entries(data.relationships)) {
            const lastTime = new Date(rel.last_interaction).getTime();
            const daysSince = (now - lastTime) / (1000 * 60 * 60 * 24);
            if (daysSince > daysThreshold) {
                const decayAmount = rel.decay_rate * (daysSince - daysThreshold);
                for (const dim of Object.keys(RELATION_DIMENSIONS)) {
                    if (dim === 'familiarity') continue; // 熟悉度不衰减
                    rel.dimensions[dim] = Math.max(0, rel.dimensions[dim] - decayAmount);
                }
                rel.relation_type = deriveRelationTypes(rel.dimensions);
            }
        }
    },

    /**
     * 获取 Top N 关系（按综合分排序）
     */
    getTopRelations(data, n = 5) {
        if (!data.relationships) return [];
        return Object.entries(data.relationships)
            .map(([name, r]) => ({
                name,
                ...r,
                composite: Object.values(r.dimensions).reduce((s, v) => s + v, 0) / 5,
            }))
            .sort((a, b) => b.composite - a.composite)
            .slice(0, n);
    },

    /**
     * 格式化为紧凑注入文本
     */
    formatCompact(data, n = 5) {
        const top = this.getTopRelations(data, n);
        if (top.length === 0) return '';
        return top.map(r => {
            const tiers = [];
            for (const [dim, config] of Object.entries(RELATION_DIMENSIONS)) {
                const tier = valueToTier(dim, r.dimensions[dim]);
                if (tier !== config.tiers[0]) { // 非初始档位才显示
                    tiers.push(`${config.label}:${tier}`);
                }
            }
            return `${r.name}(${r.relation_type.join('/')}${tiers.length ? ',' + tiers.join(',') : ''})`;
        }).join(' | ');
    },

    /**
     * 获取所有 NPC 名字（用于代词消解）
     */
    getAllNpcNames(data) {
        if (!data.relationships) return [];
        return Object.keys(data.relationships);
    },
};

// ============================================================
// M5: 队友系统
// ============================================================

const TeammateManager = {
    /**
     * 获取所有队友
     */
    getAll(data) {
        return data.teammates || [];
    },

    /**
     * 添加队友
     */
    add(data, npcName, state = {}) {
        if (!data.teammates) data.teammates = [];
        if (data.teammates.find(t => t.name === npcName)) return;
        data.teammates.push({
            name: npcName,
            status: 'active', // active | inactive | left | dead
            hp: state.hp || 100,
            max_hp: state.max_hp || 100,
            mp: state.mp || 50,
            max_mp: state.max_mp || 50,
            level: state.level || 1,
            weapon: state.weapon || '',
            weapon_type: state.weapon_type || '',
            joined_at: new Date().toISOString(),
        });
    },

    /**
     * 移除队友
     */
    remove(data, npcName, reason = 'left') {
        if (!data.teammates) return;
        const t = data.teammates.find(t => t.name === npcName);
        if (t) {
            t.status = reason; // left | dead
            t.left_at = new Date().toISOString();
        }
    },

    /**
     * 更新队友状态
     */
    update(data, npcName, updates) {
        if (!data.teammates) return;
        const t = data.teammates.find(t => t.name === npcName);
        if (!t) return;
        Object.assign(t, updates);
        t.last_updated = new Date().toISOString();
    },

    /**
     * 格式化为紧凑注入文本
     */
    formatCompact(data) {
        const active = (data.teammates || []).filter(t => t.status === 'active');
        if (active.length === 0) return '';
        return active.map(t =>
            `${t.name}(HP:${t.hp}/${t.max_hp},${t.weapon_type || '?'},Lv${t.level})`
        ).join('|');
    },
};

// ============================================================
// M2: 背包/技能/装备紧凑注入
// ============================================================

const StateFormatter = {
    /**
     * 格式化背包为紧凑文本
     */
    formatInventory(state) {
        if (!state?.inventory) return '';
        return state.inventory
            .filter(i => i.qty > 0)
            .map(i => `${i.name}x${i.qty}`)
            .join('|');
    },

    /**
     * 格式化技能为紧凑文本
     */
    formatSkills(state) {
        if (!state?.skills) return '';
        return state.skills
            .map(s => `${s.name}Lv${s.level}`)
            .join('|');
    },

    /**
     * 格式化装备为紧凑文本
     */
    formatEquipment(state) {
        if (!state?.equipment) return '';
        const parts = [];
        for (const [slot, item] of Object.entries(state.equipment)) {
            if (item && item.name) {
                const stats = [];
                if (item.stats) {
                    for (const [k, v] of Object.entries(item.stats)) {
                        if (v > 0) stats.push(`${k.toUpperCase()}+${v}`);
                    }
                }
                parts.push(`${slot}:${item.name}(${stats.join(',')})`);
            }
        }
        return parts.join('|');
    },

    /**
     * 生成完整紧凑状态注入
     */
    formatCompactState(state, data) {
        const parts = [];
        if (state) {
            parts.push(`[状态]HP:${state.hp}/${state.max_hp} MP:${state.mp}/${state.max_mp} Lv:${state.level} ${state.location || ''}`);
        }
        const inv = this.formatInventory(state);
        if (inv) parts.push(`[背包]${inv}`);
        const skills = this.formatSkills(state);
        if (skills) parts.push(`[技能]${skills}`);
        const equip = this.formatEquipment(state);
        if (equip) parts.push(`[装备]${equip}`);
        const cor = state?.cor;
        if (cor !== undefined && cor !== null) parts.push(`[珂尔]${cor}`);

        const teammates = TeammateManager.formatCompact(data);
        if (teammates) parts.push(`[队友]${teammates}`);

        const relations = RelationshipManager.formatCompact(data, 5);
        if (relations) parts.push(`[关系]${relations}`);

        return parts.join('\n');
    },
};

// ============================================================
// M3+M4: 记忆系统（BM25 + 向量 + 关键词总结 + 代词消解）
// ============================================================

/**
 * 简单中文分词（用于 BM25）
 * 使用滑动窗口生成 2-4 字子串，提高召回率
 */
function tokenize(text) {
    if (!text) return [];
    const tokens = new Set();
    // 提取中文连续段
    const cnSegments = text.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const seg of cnSegments) {
        // 滑动窗口：2字、3字、4字子串
        for (let len = 2; len <= 4; len++) {
            for (let i = 0; i <= seg.length - len; i++) {
                tokens.add(seg.substring(i, i + len));
            }
        }
        // 如果段本身<=4字，也加入完整段
        if (seg.length <= 4) tokens.add(seg);
    }
    // 英文单词
    const enMatches = text.match(/[a-zA-Z]{2,}/g);
    if (enMatches) enMatches.forEach(t => tokens.add(t.toLowerCase()));
    // 数字
    const numMatches = text.match(/\d+/g);
    if (numMatches) numMatches.forEach(t => tokens.add(t));
    // 去停用词
    const stopWords = new Set(['的', '了', '是', '在', '我', '他', '她', '它', '们', '这', '那', '就', '都', '也', '而', '及', '与', '或', '一个', '可以', '什么', '怎么', '为什么', 'the', 'is', 'at', 'which', 'on']);
    stopWords.forEach(w => tokens.delete(w));
    return [...tokens];
}

/**
 * BM25 检索
 */
function bm25Search(queryTokens, documents, topK = 5) {
    if (!documents || documents.length === 0 || !queryTokens || queryTokens.length === 0) return [];
    const k1 = 1.5;
    const b = 0.75;
    const N = documents.length;
    // 计算 IDF
    const df = {};
    for (const doc of documents) {
        const docTokens = new Set(doc.searchTokens || tokenize(doc.content || doc.summary || ''));
        for (const t of docTokens) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const t of Object.keys(df)) idf[t] = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));

    // 评分
    const docTokenCache = documents.map(doc => doc.searchTokens || tokenize(doc.content || doc.summary || ''));
    const avgLen = docTokenCache.reduce((s, tokens) => s + tokens.length, 0) / N;

    const scored = documents.map((doc, i) => {
        const docTokens = docTokenCache[i];
        const tf = {};
        for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;
        const docLen = docTokens.length;

        let score = 0;
        for (const qt of queryTokens) {
            if (tf[qt] && idf[qt]) {
                score += idf[qt] * (tf[qt] * (k1 + 1)) / (tf[qt] + k1 * (1 - b + b * docLen / avgLen));
            }
        }
        return { ...doc, score };
    });
    return scored.filter(d => d.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * 向量检索（用记忆模型生成 embedding）
 * 备用方案：如果没配置 embedding，回退到纯 BM25
 */
async function vectorSearch(query, memories, topK = 5) {
    // 纯浏览器端无内置 embedding，这里用记忆模型做相似度判断
    // 如果记忆模型未配置，回退到 BM25
    // 实际向量检索需要调用 embedding API，这里作为可选增强
    return null; // 默认回退到 BM25
}

/**
 * MemoryManager - 记忆管理
 */
const MemoryManager = {
    /**
     * 添加记忆（同时总结关键词 + 代词消解）
     */
    add(data, content, type = 'event', context = {}) {
        if (!data.episodic) data.episodic = [];
        // 代词消解：如果 context 中有当前 NPC 名字，把代词替换
        let resolvedContent = content;
        const npcNames = RelationshipManager.getAllNpcNames(data);
        if (context.speaker && npcNames.includes(context.speaker)) {
            resolvedContent = resolvedContent.replace(/^[他她它]/, context.speaker);
        }

        // 总结关键词
        const searchTokens = tokenize(resolvedContent);

        const memory = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message_id: context.messageId ?? null,
            timestamp: new Date().toISOString(),
            type,
            content: resolvedContent,
            searchTokens,
            importance: context.importance || 0.5,
            tags: context.tags || [],
            related_npcs: this.extractNpcNames(resolvedContent, npcNames),
        };
        data.episodic.push(memory);

        // 限制数量（maxMemories 由调用方传入）
        const maxMemories = context.maxMemories || 50;
        if (data.episodic.length > maxMemories) {
            // 淘汰低重要性的旧记忆
            data.episodic.sort((a, b) => b.importance - a.importance);
            data.episodic = data.episodic.slice(0, maxMemories);
            data.episodic.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
        return memory;
    },

    /**
     * 从文本中提取 NPC 名字（用于代词消解的关键词标记）
     */
    extractNpcNames(text, knownNames) {
        const found = [];
        for (const name of knownNames) {
            if (text.includes(name)) found.push(name);
        }
        return found;
    },

    /**
     * 检索相关记忆
     * 策略：BM25 关键词匹配（<10ms）
     * 可选增强：向量检索（需 embedding API）
     */
    search(data, query, topK = 5) {
        if (!data.episodic || data.episodic.length === 0) return [];
        const queryTokens = tokenize(query);
        return bm25Search(queryTokens, data.episodic, topK);
    },

    /**
     * 获取上一轮 AI 回复的摘要（恒定注入）
     */
    getLastSummary(data) {
        if (!data.episodic || data.episodic.length === 0) return '';
        return data.episodic[data.episodic.length - 1]?.content || '';
    },

    /**
     * 格式化检索结果为注入文本
     */
    formatSearchResults(results) {
        if (!results || results.length === 0) return '';
        return results.map(r => `- ${r.content}`).join('\n');
    },

    /**
     * 删除记忆
     */
    delete(data, memoryId) {
        if (!data.episodic) return;
        data.episodic = data.episodic.filter(m => m.id !== memoryId);
    },

    /**
     * 编辑记忆
     */
    update(data, memoryId, updates) {
        if (!data.episodic) return;
        const m = data.episodic.find(m => m.id === memoryId);
        if (!m) return;
        Object.assign(m, updates);
        if (updates.content) {
            m.searchTokens = tokenize(updates.content);
        }
    },

    /**
     * 按 messageId 回滚记忆（用于 swipe/delete）
     */
    rollbackByMessageId(data, messageId) {
        if (!data.episodic) return 0;
        const before = data.episodic.length;
        data.episodic = data.episodic.filter(m => m.message_id !== messageId);
        return before - data.episodic.length;
    },

    /**
     * 垃圾回收：删除 message_id 不在当前 chat 存活消息 id 集合中的记忆
     * @param {object} data
     * @param {Set<number>} existingMessageIds - 当前 chat 中所有消息的 index 集合
     * @returns {number} 被清除的记忆数
     */
    gc(data, existingMessageIds) {
        if (!data.episodic) return 0;
        const idSet = new Set(existingMessageIds);
        const before = data.episodic.length;
        data.episodic = data.episodic.filter(m => m.message_id == null || idSet.has(m.message_id));
        return before - data.episodic.length;
    },
};

// 导出所有模块
export {
    RELATION_DIMENSIONS,
    RelationshipManager,
    TeammateManager,
    StateFormatter,
    MemoryManager,
    tokenize,
    bm25Search,
    tierToValue,
    valueToTier,
    deriveRelationTypes,
};
