import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock dependencies
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    safeJsonParse: (s) => { try { return JSON.parse(s); } catch { return null; } },
    MODULE_NAME: 'sao_companion',
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sao-store-player.js', () => ({
    getPlayerStore: vi.fn(() => ({
        position: { floor_id: 'floor_001', location: '起始之城镇' },
    })),
}));

vi.mock('../sao-state-projection.js', () => ({
    projectNpcHint: vi.fn(() => '亚丝娜(搭档,好感15) | 克莱因(朋友,好感5)'),
}));

vi.mock('../sao-models.js', () => ({
    callSpecialist: vi.fn(),
}));

vi.mock('../sao-store-npc.js', () => ({
    findOrCreateNpc: vi.fn((name) => `npc_${name}`),
    updateNpcState: vi.fn().mockResolvedValue(true),
    addObservation: vi.fn().mockResolvedValue(true),
}));

// Import AFTER mocks
import {
    shouldTriggerNpcBackground,
    _validateNpcBackgroundOutput,
} from '../sao-npc-background.js';
import { callSpecialist } from '../sao-models.js';
import { findOrCreateNpc, updateNpcState, addObservation } from '../sao-store-npc.js';
import { saveStore } from '../sao-store-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldTriggerNpcBackground', () => {
    it('returns false for turn 0', () => {
        expect(shouldTriggerNpcBackground(0)).toBe(false);
    });

    it('returns false for non-multiple turns', () => {
        expect(shouldTriggerNpcBackground(1)).toBe(false);
        expect(shouldTriggerNpcBackground(5)).toBe(false);
        expect(shouldTriggerNpcBackground(9)).toBe(false);
        expect(shouldTriggerNpcBackground(11)).toBe(false);
    });

    it('returns true for every 10th turn', () => {
        expect(shouldTriggerNpcBackground(10)).toBe(true);
        expect(shouldTriggerNpcBackground(20)).toBe(true);
        expect(shouldTriggerNpcBackground(100)).toBe(true);
        expect(shouldTriggerNpcBackground(250)).toBe(true);
    });
});

describe('_validateNpcBackgroundOutput', () => {
    it('returns null for null/undefined input', () => {
        expect(_validateNpcBackgroundOutput(null)).toBe(null);
        expect(_validateNpcBackgroundOutput(undefined)).toBe(null);
    });

    it('returns null for empty string', () => {
        expect(_validateNpcBackgroundOutput('')).toBe(null);
    });

    it('returns null for invalid JSON', () => {
        expect(_validateNpcBackgroundOutput('not json')).toBe(null);
    });

    it('returns null when npcUpdates is missing', () => {
        expect(_validateNpcBackgroundOutput('{"foo": 1}')).toBe(null);
    });

    it('returns null when npcUpdates is not an array', () => {
        expect(_validateNpcBackgroundOutput('{"npcUpdates": "bad"}')).toBe(null);
    });

    it('returns null when an entry has no name', () => {
        const input = JSON.stringify({ npcUpdates: [{ affinity: 5 }] });
        expect(_validateNpcBackgroundOutput(input)).toBe(null);
    });

    it('returns null when an entry has empty name', () => {
        const input = JSON.stringify({ npcUpdates: [{ name: '' }] });
        expect(_validateNpcBackgroundOutput(input)).toBe(null);
    });

    it('returns null when affinity is not a number', () => {
        const input = JSON.stringify({ npcUpdates: [{ name: '亚丝娜', affinity: 'high' }] });
        expect(_validateNpcBackgroundOutput(input)).toBe(null);
    });

    it('returns null when status is not an array', () => {
        const input = JSON.stringify({ npcUpdates: [{ name: '亚丝娜', status: '受伤' }] });
        expect(_validateNpcBackgroundOutput(input)).toBe(null);
    });

    it('validates a correct payload', () => {
        const payload = {
            npcUpdates: [
                { name: '亚丝娜', relationship: '搭档', affinity: 16, floor_id: 'floor_001', location: '起始之城镇', status: ['在线'], observation: '在酒馆休息' },
            ],
        };
        const result = _validateNpcBackgroundOutput(JSON.stringify(payload));
        expect(result).not.toBe(null);
        expect(result.npcUpdates).toHaveLength(1);
        expect(result.npcUpdates[0].name).toBe('亚丝娜');
    });

    it('validates empty npcUpdates array', () => {
        const payload = { npcUpdates: [] };
        const result = _validateNpcBackgroundOutput(JSON.stringify(payload));
        expect(result).not.toBe(null);
        expect(result.npcUpdates).toHaveLength(0);
    });

    it('accepts object input (not string)', () => {
        const payload = { npcUpdates: [{ name: '克莱因' }] };
        const result = _validateNpcBackgroundOutput(payload);
        expect(result).not.toBe(null);
        expect(result.npcUpdates[0].name).toBe('克莱因');
    });

    it('handles JSON with markdown fence wrapping', () => {
        const payload = { npcUpdates: [{ name: '艾基尔' }] };
        const fenced = '```json\n' + JSON.stringify(payload) + '\n```';
        const result = _validateNpcBackgroundOutput(fenced);
        expect(result).not.toBe(null);
        expect(result.npcUpdates[0].name).toBe('艾基尔');
    });
});
