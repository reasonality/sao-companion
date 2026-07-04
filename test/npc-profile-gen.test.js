import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock dependencies
// ─────────────────────────────────────────────────────────────────────────────
let mockChar = null;
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    safeJsonParse: (s) => { try { return JSON.parse(s); } catch { return null; } },
    getCurrentCharacter: vi.fn(() => mockChar),
    MODULE_NAME: 'sao_companion',
}));

vi.mock('../sao-store-npc.js', () => ({
    getNpcByName: vi.fn((name) => {
        if (!mockStore?.npcStore) return null;
        const id = mockStore.npcStore.nameToId[name];
        return id ? (mockStore.npcStore.byId[id] || null) : null;
    }),
}));

vi.mock('../sao-models.js', () => ({
    callSpecialist: vi.fn(),
}));

// Import AFTER mocks
import {
    shouldGenerateProfile,
    _validateProfileOutput,
    _writeProfileToEntries,
    generateNpcProfiles,
} from '../sao-npc-profile-gen.js';
import { callSpecialist } from '../sao-models.js';
import { getCurrentCharacter } from '../sao-core.js';
import { getNpcByName } from '../sao-store-npc.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeChar(entries = []) {
    return { data: { character_book: { entries } } };
}

function makeStore() {
    return { npcStore: { byId: {}, nameToId: {} } };
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldGenerateProfile
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldGenerateProfile', () => {
    beforeEach(() => {
        mockChar = null;
        mockStore = null;
    });

    it('returns false for empty/null name', () => {
        expect(shouldGenerateProfile('')).toBe(false);
        expect(shouldGenerateProfile(null)).toBe(false);
    });

    it('returns true when no character_book entries exist', () => {
        mockChar = { data: {} };
        expect(shouldGenerateProfile('新NPC')).toBe(true);
    });

    it('returns true when NPC not in character_book', () => {
        mockChar = makeChar([
            { comment: 'sao-亚丝娜', keys: ['亚丝娜'], content: '{}' },
        ]);
        expect(shouldGenerateProfile('新NPC')).toBe(true);
    });

    it('returns false when NPC already in character_book (by comment)', () => {
        mockChar = makeChar([
            { comment: 'sao-亚丝娜', keys: ['亚丝娜'], content: '{}' },
        ]);
        expect(shouldGenerateProfile('亚丝娜')).toBe(false);
    });

    it('returns false when NPC already in character_book (by keys)', () => {
        mockChar = makeChar([
            { comment: 'sao-桐人', keys: ['桐人', 'Kirito'], content: '{}' },
        ]);
        expect(shouldGenerateProfile('Kirito')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _validateProfileOutput
// ─────────────────────────────────────────────────────────────────────────────

describe('_validateProfileOutput', () => {
    it('returns null for null/undefined input', () => {
        expect(_validateProfileOutput(null, 'NPC')).toBe(null);
        expect(_validateProfileOutput(undefined, 'NPC')).toBe(null);
    });

    it('returns null for empty string', () => {
        expect(_validateProfileOutput('', 'NPC')).toBe(null);
    });

    it('returns null for invalid JSON', () => {
        expect(_validateProfileOutput('not json', 'NPC')).toBe(null);
    });

    it('returns null when characterProfile is missing', () => {
        expect(_validateProfileOutput('{"foo": 1}', 'NPC')).toBe(null);
    });

    it('returns null when characterName is empty', () => {
        const content = JSON.stringify({ characterProfile: { characterName: '' } });
        expect(_validateProfileOutput(content, 'NPC')).toBe(null);
    });

    it('returns null when characterName does not match expected', () => {
        const content = JSON.stringify({ characterProfile: { characterName: '亚丝娜' } });
        expect(_validateProfileOutput(content, '桐人')).toBe(null);
    });

    it('validates a correct profile', () => {
        const profile = {
            characterProfile: {
                characterName: '亚丝娜',
                basicInfo: { realName: '' },
            },
        };
        const result = _validateProfileOutput(JSON.stringify(profile), '亚丝娜');
        expect(result).not.toBe(null);
        expect(result.characterName).toBe('亚丝娜');
    });

    it('handles markdown fence wrapping', () => {
        const profile = { characterProfile: { characterName: '桐人' } };
        const fenced = '```json\n' + JSON.stringify(profile) + '\n```';
        const result = _validateProfileOutput(fenced, '桐人');
        expect(result).not.toBe(null);
        expect(result.characterName).toBe('桐人');
    });

    it('accepts object input (not string)', () => {
        const profile = { characterProfile: { characterName: '克莱因' } };
        const result = _validateProfileOutput(profile, '克莱因');
        expect(result).not.toBe(null);
        expect(result.characterName).toBe('克莱因');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _writeProfileToEntries
// ─────────────────────────────────────────────────────────────────────────────

describe('_writeProfileToEntries', () => {
    beforeEach(() => {
        mockChar = null;
        mockStore = null;
    });

    it('returns false when no character_book', () => {
        mockChar = { data: {} };
        expect(_writeProfileToEntries('NPC', { characterName: 'NPC' })).toBe(false);
    });

    it('returns false when getCurrentCharacter is null', () => {
        mockChar = null;
        expect(_writeProfileToEntries('NPC', { characterName: 'NPC' })).toBe(false);
    });

    it('writes a new entry to character_book', () => {
        mockChar = makeChar([]);
        mockStore = makeStore();
        const result = _writeProfileToEntries('新NPC', { characterName: '新NPC' });
        expect(result).toBe(true);
        expect(mockChar.data.character_book.entries).toHaveLength(1);
        const entry = mockChar.data.character_book.entries[0];
        expect(entry.comment).toBe('新NPC');
        expect(entry.keys).toContain('新NPC');
        expect(entry.disable).toBe(true);
        expect(entry.use_regex).toBe(true);
        expect(entry.selective).toBe(true);
        expect(entry.constant).toBe(false);
        expect(entry.position).toBe('before_char');
        expect(entry.insertion_order).toBe(100);
        expect(entry.content).toContain('characterProfile');
        expect(entry.content).toContain('```json');
    });

    it('returns false when entry already exists (duplicate check)', () => {
        mockChar = makeChar([
            { comment: '新NPC', keys: ['新NPC'], content: '{}' },
        ]);
        mockStore = makeStore();
        expect(_writeProfileToEntries('新NPC', { characterName: '新NPC' })).toBe(false);
        expect(mockChar.data.character_book.entries).toHaveLength(1);
    });

    it('includes aliases from npcStore', () => {
        mockChar = makeChar([]);
        mockStore = makeStore();

        // Override getNpcByName mock to return aliases
        vi.mocked(getNpcByName).mockReturnValue({ aliases: ['Test', 'Tester'] });

        _writeProfileToEntries('测试', { characterName: '测试' });
        const entry = mockChar.data.character_book.entries[0];
        expect(entry.keys).toContain('测试');
        expect(entry.keys).toContain('Test');
        expect(entry.keys).toContain('Tester');

        // Restore default implementation
        vi.mocked(getNpcByName).mockImplementation((name) => {
            if (!mockStore?.npcStore) return null;
            const id = mockStore.npcStore.nameToId[name];
            return id ? (mockStore.npcStore.byId[id] || null) : null;
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateNpcProfiles
// ─────────────────────────────────────────────────────────────────────────────

describe('generateNpcProfiles', () => {
    beforeEach(() => {
        mockChar = null;
        mockStore = null;
        vi.mocked(callSpecialist).mockReset();
    });

    it('returns 0 for empty array', async () => {
        expect(await generateNpcProfiles([], 'text')).toBe(0);
    });

    it('returns 0 for null input', async () => {
        expect(await generateNpcProfiles(null, 'text')).toBe(0);
    });

    it('skips NPCs that already have world book entries', async () => {
        mockChar = makeChar([
            { comment: 'sao-亚丝娜', keys: ['亚丝娜'], content: '{}' },
        ]);
        const result = await generateNpcProfiles(['亚丝娜'], '叙事文本');
        expect(result).toBe(0);
        expect(callSpecialist).not.toHaveBeenCalled();
    });

    it('generates profile for a new NPC', async () => {
        mockChar = makeChar([]);
        mockStore = makeStore();

        const profileJson = JSON.stringify({
            characterProfile: {
                characterName: '新NPC',
                basicInfo: { realName: '', gender: '', age: null, occupation: '' },
            },
        });
        vi.mocked(callSpecialist).mockResolvedValueOnce(profileJson);

        const result = await generateNpcProfiles(['新NPC'], '在酒馆遇到了新NPC');
        expect(result).toBe(1);
        expect(callSpecialist).toHaveBeenCalledTimes(1);
        expect(mockChar.data.character_book.entries).toHaveLength(1);
        expect(mockChar.data.character_book.entries[0].comment).toBe('新NPC');
    });

    it('skips NPC when LLM returns invalid JSON', async () => {
        mockChar = makeChar([]);
        mockStore = makeStore();
        vi.mocked(callSpecialist).mockResolvedValueOnce('not json');

        const result = await generateNpcProfiles(['新NPC'], '叙事');
        expect(result).toBe(0);
    });

    it('skips NPC when characterName does not match', async () => {
        mockChar = makeChar([]);
        mockStore = makeStore();
        const profileJson = JSON.stringify({
            characterProfile: { characterName: '错误名字' },
        });
        vi.mocked(callSpecialist).mockResolvedValueOnce(profileJson);

        const result = await generateNpcProfiles(['新NPC'], '叙事');
        expect(result).toBe(0);
    });

    it('handles callSpecialist error gracefully', async () => {
        mockChar = makeChar([]);
        mockStore = makeStore();
        vi.mocked(callSpecialist).mockRejectedValueOnce(new Error('网络超时'));

        const result = await generateNpcProfiles(['新NPC'], '叙事');
        expect(result).toBe(0);
    });

    it('processes multiple NPCs sequentially', async () => {
        mockChar = makeChar([]);
        mockStore = makeStore();

        const profile1 = JSON.stringify({ characterProfile: { characterName: 'NPC甲' } });
        const profile2 = JSON.stringify({ characterProfile: { characterName: 'NPC乙' } });
        vi.mocked(callSpecialist)
            .mockResolvedValueOnce(profile1)
            .mockResolvedValueOnce(profile2);

        const result = await generateNpcProfiles(['NPC甲', 'NPC乙'], '叙事');
        expect(result).toBe(2);
        expect(mockChar.data.character_book.entries).toHaveLength(2);
    });
});
