// sao-rules.js — 规则片段预提取与按需注入
// 从 character book 提取启用规则到 RULE_SNIPPETS 映射，按需注入专家 prompt

import { getCurrentCharacter, log } from './sao-core.js';

const RULE_DEFS = [
    { keyword: '世界设定', matchFn: (c) => c.includes('sao-世界设定') && !c.includes('层'), maxChars: 2000 },
    { keyword: 'PK', matchFn: (c) => c.includes('PK机制'), maxChars: 1500 },
    { keyword: '经济', matchFn: (c) => c.includes('sao-经济系统'), maxChars: 1000 },
    { keyword: '等级', matchFn: (c) => c.includes('sao-等级') && !c.includes('新生alo'), maxChars: 2000 },
    { keyword: '技能', matchFn: (c) => c.includes('sao-技能') && !c.includes('词条') && !c.includes('剑技'), maxChars: 2000 },
    { keyword: '骰子', matchFn: (c) => c.includes('真实骰子'), maxChars: 1000 },
    { keyword: '冥想', matchFn: (c) => c.includes('冥想'), maxChars: 1000 },
    { keyword: '房屋', matchFn: (c) => c.includes('sao-房屋'), maxChars: 1000 },
    { keyword: 'NPC构建', matchFn: (c) => c.includes('NPC档案构建') && c.includes('sao'), maxChars: 1500 },
    { keyword: '剑技获取', matchFn: (c) => c.includes('剑技获取'), maxChars: 1500 },
    { keyword: '格式', matchFn: (c) => c.includes('sao格式') && !c.includes('去掉') && !c.includes('关'), maxChars: 2000 },
    { keyword: '行动2', matchFn: (c) => c.trim() === '行动2', maxChars: 1000 },
];

let _snippets = null;

/**
 * 从 character book 提取启用规则片段（懒加载 + 缓存）。
 * @returns {Object<string,string>} keyword → content 映射
 */
export function getRuleSnippets() {
    if (_snippets) return _snippets;
    _snippets = {};
    try {
        const char = getCurrentCharacter();
        const entries = char?.data?.character_book?.entries;
        if (!entries || !entries.length) { log('[rules] character book 无条目','warn'); return _snippets; }
        for (const def of RULE_DEFS) {
            const match = entries.find(e => !e.disable && e.comment && def.matchFn(e.comment, e.uid));
            if (match && match.content) {
                let content = match.content;
                if (content.length > def.maxChars) {
                    const cut = content.lastIndexOf('\n\n', def.maxChars);
                    content = cut > def.maxChars * 0.5 ? content.substring(0, cut) : content.substring(0, def.maxChars) + '\n...(已截断)';
                }
                _snippets[def.keyword] = content;
                log('[rules] 提取规则: ' + def.keyword + ' (' + content.length + ' chars)');
            } else {
                log('[rules] 未匹配规则: ' + def.keyword, 'warn');
            }
        }
    } catch (e) { log('[rules] 规则预提取失败: ' + e.message, 'warn'); }
    return _snippets;
}

/**
 * 获取单条规则片段。
 * @param {string} keyword
 * @returns {string} 规则内容或空字符串
 */
export function getRule(keyword) { return getRuleSnippets()[keyword] || ''; }

/**
 * 按关键词数组获取规则片段，拼接为带标题的注入文本。
 * @param {string[]} keywords - 要注入的规则关键词
 * @param {string} header - 注入段标题
 * @returns {string} 拼接后的规则文本（无匹配时返回空字符串）
 */
export function getRules(keywords, header = '相关规则') {
    const snippets = getRuleSnippets();
    const parts = keywords.map(k => snippets[k]).filter(Boolean);
    if (parts.length === 0) return '';
    return '\n\n## ' + header + '\n' + parts.join('\n\n---\n\n');
}

/**
 * 缓存失效（切卡时调用，规则可能变，需重新提取）。
 */
export function invalidateRuleSnippets() { _snippets = null; }
