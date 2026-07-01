import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getCurrentCharacter as a controllable function
let mockCharacter = null;
vi.mock('../sao-core.js', () => ({
    getCurrentCharacter: vi.fn(() => mockCharacter),
    log: vi.fn(),
}));

// Import AFTER mocks
import { getRuleSnippets, getRule, getRules, invalidateRuleSnippets } from '../sao-rules.js';
import { getCurrentCharacter, log } from '../sao-core.js';

function makeEntry(comment, content, disable = false) {
    return { comment, content, disable };
}

function setCharacterBook(entries) {
    mockCharacter = entries ? { data: { character_book: { entries } } } : null;
}

describe('sao-rules', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateRuleSnippets();
        mockCharacter = null;
    });

    it('getRuleSnippets returns empty object when character is null', () => {
        setCharacterBook(null);
        const result = getRuleSnippets();
        expect(result).toEqual({});
    });

    it('getRuleSnippets extracts enabled rules by comment match', () => {
        setCharacterBook([
            makeEntry('sao-世界设定', '世界设定内容'),
            makeEntry('sao-PK机制', 'PK内容'),
            makeEntry('sao-经济系统', '经济内容'),
            makeEntry('sao-等级', '等级内容'),
            makeEntry('sao-技能', '技能内容'),
            makeEntry('sao-真实骰子规则', '骰子内容'),
            makeEntry('sao-冥想', '冥想内容'),
            makeEntry('sao-房屋', '房屋内容'),
            makeEntry('sao-NPC档案构建规则 （sao）', 'NPC构建内容'),
            makeEntry('sao-剑技获取', '剑技获取内容'),
            makeEntry('行动2', '行动2内容'),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['世界设定']).toBe('世界设定内容');
        expect(snippets['PK']).toBe('PK内容');
        expect(snippets['经济']).toBe('经济内容');
        expect(snippets['等级']).toBe('等级内容');
        expect(snippets['技能']).toBe('技能内容');
        expect(snippets['骰子']).toBe('骰子内容');
        expect(snippets['冥想']).toBe('冥想内容');
        expect(snippets['房屋']).toBe('房屋内容');
        expect(snippets['NPC构建']).toBe('NPC构建内容');
        expect(snippets['剑技获取']).toBe('剑技获取内容');
        expect(snippets['行动2']).toBe('行动2内容');
    });

    it('getRuleSnippets skips disabled entries', () => {
        setCharacterBook([
            makeEntry('sao-PK机制', 'PK内容-禁用', true),
            makeEntry('sao-等级', '等级内容-启用', false),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['PK']).toBeUndefined();
        expect(snippets['等级']).toBe('等级内容-启用');
    });

    it('getRuleSnippets truncates long content', () => {
        const longContent = 'A'.repeat(3000);
        setCharacterBook([
            makeEntry('sao-等级', longContent),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['等级'].length).toBeLessThan(3000);
        expect(snippets['等级']).toContain('已截断');
    });

    it('getRule returns specific rule or empty string', () => {
        setCharacterBook([
            makeEntry('sao-等级', '等级规则'),
        ]);

        expect(getRule('等级')).toBe('等级规则');
        expect(getRule('不存在')).toBe('');
    });

    it('getRules concatenates multiple rules with header', () => {
        setCharacterBook([
            makeEntry('sao-等级', '等级规则'),
            makeEntry('sao-技能', '技能规则'),
        ]);

        const result = getRules(['等级', '技能'], '测试标题');
        expect(result).toContain('## 测试标题');
        expect(result).toContain('等级规则');
        expect(result).toContain('技能规则');
        expect(result).toContain('---');
    });

    it('getRules returns empty string when no rules match', () => {
        setCharacterBook([]);

        expect(getRules(['等级', '技能'])).toBe('');
    });

    it('invalidateRuleSnippets clears cache', () => {
        setCharacterBook([
            makeEntry('sao-等级', 'V1'),
        ]);

        getRuleSnippets();
        expect(getRule('等级')).toBe('V1');

        // Change character and invalidate
        setCharacterBook([
            makeEntry('sao-等级', 'V2'),
        ]);

        // Without invalidation, still returns cached V1
        expect(getRule('等级')).toBe('V1');

        invalidateRuleSnippets();

        // After invalidation, returns V2
        expect(getRule('等级')).toBe('V2');
    });

    it('matchFn distinguishes sao-等级 from 新生alo-等级', () => {
        setCharacterBook([
            makeEntry('sao-等级', 'SAO等级'),
            makeEntry('新生alo-等级', 'ALO等级'),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['等级']).toBe('SAO等级');
    });

    it('matchFn distinguishes sao-技能 from 剑技/词条 entries', () => {
        setCharacterBook([
            makeEntry('sao-技能', '技能规则'),
            makeEntry('sao-剑技和词条生成sao', '剑技词条'),
            makeEntry('剑技生成sao1', '剑技生成'),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['技能']).toBe('技能规则');
    });

    it('format rule excluded by 去掉/关 keywords', () => {
        setCharacterBook([
            makeEntry('sao格式（去掉行动action，记得关sao格式和行动2）', '格式内容'),
            makeEntry('sao格式全部版，记得关之前的sao格式', '格式全部版'),
        ]);

        const snippets = getRuleSnippets();
        expect(snippets['格式']).toBeUndefined();
    });
});
