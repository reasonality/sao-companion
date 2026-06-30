import { describe, it, expect } from 'vitest';
import { esc } from '../sao-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// esc — HTML entity escaping utility
// ─────────────────────────────────────────────────────────────────────────────
describe('esc', () => {
    it('returns empty string for null', () => {
        expect(esc(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(esc(undefined)).toBe('');
    });

    it('escapes <script> tags', () => {
        expect(esc('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes double quotes', () => {
        expect(esc('"q"')).toBe('&quot;q&quot;');
    });

    it('escapes single quotes', () => {
        expect(esc("'")).toBe('&#39;');
    });

    it('escapes ampersands', () => {
        expect(esc('&')).toBe('&amp;');
    });

    it('escapes mixed special characters', () => {
        expect(esc('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });

    it('passes through plain text unchanged', () => {
        expect(esc('hello world')).toBe('hello world');
    });

    it('converts numbers to string', () => {
        expect(esc(42)).toBe('42');
    });
});
