import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock sao-core.js BEFORE importing sao-calendar.js
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../sao-core.js', () => ({
    getSaoData: vi.fn(),
    saveSaoDataNow: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn(() => ({})),
    getCurrentCharacter: vi.fn(() => null),
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
}));

import {
    addAppointmentToCalendar,
    getTimelineForPrompt,
    persistCalendar,
    persistCalendarPanel,
    buildTransientGridFromCalendar,
    _validateCalendarGrid,
    detectTimeSkip,
    parseTimeTagDate,
    parseDate,
    formatDate,
} from '../sao-calendar.js';
import { saveSaoDataNow, getCurrentCharacter, getSaoData } from '../sao-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fresh calendar object
// ─────────────────────────────────────────────────────────────────────────────
function makeCalendar(overrides = {}) {
    return {
        appointments: [],
        days: {},
        currentDate: '2024-12-16',
        calendarVersion: 0,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseDate
// ─────────────────────────────────────────────────────────────────────────────
describe('parseDate', () => {
    it('parses YYYY-MM-DD', () => {
        const d = parseDate('2024-12-25');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(11); // 0-indexed
        expect(d.getDate()).toBe(25);
    });

    it('parses single-digit month/day', () => {
        const d = parseDate('2024-1-5');
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(5);
    });

    it('returns null for empty string', () => {
        expect(parseDate('')).toBeNull();
    });

    it('returns null for null/undefined', () => {
        expect(parseDate(null)).toBeNull();
        expect(parseDate(undefined)).toBeNull();
    });

    it('returns null for garbage string', () => {
        expect(parseDate('not-a-date')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDate
// ─────────────────────────────────────────────────────────────────────────────
describe('formatDate', () => {
    it('formats Date to YYYY-MM-DD', () => {
        expect(formatDate(new Date(2024, 11, 25))).toBe('2024-12-25');
    });

    it('pads month/day with leading zeros', () => {
        expect(formatDate(new Date(2024, 0, 5))).toBe('2024-01-05');
    });

    it('returns empty string for null', () => {
        expect(formatDate(null)).toBe('');
    });

    it('returns empty string for invalid Date', () => {
        expect(formatDate(new Date('invalid'))).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// addAppointmentToCalendar
// ─────────────────────────────────────────────────────────────────────────────
describe('addAppointmentToCalendar', () => {
    it('adds a new appointment successfully', () => {
        const cal = makeCalendar();
        const result = addAppointmentToCalendar(cal, {
            date: '2024-12-20',
            time: '15:00',
            description: '主城广场见Asuna训练',
            source: 'auto',
            status: 'pending',
        });
        expect(result).toBe(true);
        expect(cal.appointments).toHaveLength(1);
        expect(cal.days['2024-12-20'].events).toHaveLength(1);
        expect(cal.days['2024-12-20'].events[0].type).toBe('appointment');
    });

    it('deduplicates same date+time+description', () => {
        const cal = makeCalendar();
        const apt = { date: '2024-12-20', time: '15:00', description: '主城广场见Asuna训练' };
        expect(addAppointmentToCalendar(cal, apt)).toBe(true);
        expect(addAppointmentToCalendar(cal, apt)).toBe(false);
        expect(cal.appointments).toHaveLength(1);
        expect(cal.days['2024-12-20'].events).toHaveLength(1);
    });

    it('deduplicates with whitespace difference (normalized)', () => {
        const cal = makeCalendar();
        addAppointmentToCalendar(cal, {
            date: '2024-12-20',
            time: '15:00',
            description: '主城广场见Asuna训练',
        });
        // Same content with extra whitespace — after stripping spaces and taking first 20 chars, same key
        const result = addAppointmentToCalendar(cal, {
            date: '2024-12-20',
            time: '15:00',
            description: '主城广场 见 Asuna 训练',
        });
        expect(result).toBe(false);
        expect(cal.appointments).toHaveLength(1);
    });

    it('deduplicates descriptions >20 chars when first 20 non-ws chars match', () => {
        const cal = makeCalendar();
        // 31 chars: A×20 + B×10
        addAppointmentToCalendar(cal, {
            date: '2024-12-20',
            time: '15:00',
            description: 'AAAAAAAAAAAAAAAAAAAAABBBBBBBBBB',
        });
        // 30 chars: A×20 + C×10 — first 20 non-ws chars are the same (A×20)
        const result = addAppointmentToCalendar(cal, {
            date: '2024-12-20',
            time: '15:00',
            description: 'AAAAAAAAAAAAAAAAAAAAACCCCCCCCCC',
        });
        expect(result).toBe(false);
        expect(cal.appointments).toHaveLength(1);
    });

    it('does NOT deduplicate when dates differ', () => {
        const cal = makeCalendar();
        addAppointmentToCalendar(cal, { date: '2024-12-20', time: '15:00', description: '训练' });
        const result = addAppointmentToCalendar(cal, { date: '2024-12-21', time: '15:00', description: '训练' });
        expect(result).toBe(true);
        expect(cal.appointments).toHaveLength(2);
    });

    it('does NOT deduplicate when times differ', () => {
        const cal = makeCalendar();
        addAppointmentToCalendar(cal, { date: '2024-12-20', time: '15:00', description: '训练' });
        const result = addAppointmentToCalendar(cal, { date: '2024-12-20', time: '16:00', description: '训练' });
        expect(result).toBe(true);
        expect(cal.appointments).toHaveLength(2);
    });

    it('returns false when date is missing', () => {
        const cal = makeCalendar();
        const result = addAppointmentToCalendar(cal, { time: '15:00', description: '训练' });
        expect(result).toBe(false);
    });

    it('returns false when calendar is null', () => {
        const result = addAppointmentToCalendar(null, { date: '2024-12-20' });
        expect(result).toBe(false);
    });

    it('defaults source to "auto" and status to "pending"', () => {
        const cal = makeCalendar();
        addAppointmentToCalendar(cal, { date: '2024-12-20', description: '测试' });
        expect(cal.appointments[0].source).toBe('auto');
        expect(cal.appointments[0].status).toBe('pending');
    });

    it('creates days[date] entry when calendar.days is empty', () => {
        const cal = makeCalendar({ days: {} });
        addAppointmentToCalendar(cal, { date: '2024-12-25', description: '圣诞聚会' });
        expect(cal.days['2024-12-25']).toBeDefined();
        expect(cal.days['2024-12-25'].events).toBeInstanceOf(Array);
        expect(cal.days['2024-12-25'].events).toHaveLength(1);
    });

    it('generates unique ids for rapid successive adds', () => {
        const cal = makeCalendar();
        addAppointmentToCalendar(cal, { date: '2024-12-20', time: '10:00', description: '事件A' });
        addAppointmentToCalendar(cal, { date: '2024-12-20', time: '11:00', description: '事件B' });
        const idA = cal.appointments[0].id;
        const idB = cal.appointments[1].id;
        expect(idA).not.toBe(idB);
        // ids should differ because appointments.length differs (0 vs 1)
        expect(idA).toContain('apt_');
        expect(idB).toContain('apt_');
    });

    it('initializes calendar.appointments if missing', () => {
        const cal = { days: {}, currentDate: '2024-12-16', calendarVersion: 0 };
        addAppointmentToCalendar(cal, { date: '2024-12-20', description: '测试' });
        expect(cal.appointments).toHaveLength(1);
    });

    it('initializes calendar.days if missing', () => {
        const cal = { appointments: [], currentDate: '2024-12-16', calendarVersion: 0 };
        addAppointmentToCalendar(cal, { date: '2024-12-20', description: '测试' });
        expect(cal.days['2024-12-20']).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectTimeSkip
// ─────────────────────────────────────────────────────────────────────────────
describe('detectTimeSkip', () => {
    it('detects 第二天', () => {
        const result = detectTimeSkip('第二天，阳光照进了房间');
        expect(result).toEqual({ offset: 1, matchText: '第二天' });
    });

    it('detects 过了5天', () => {
        const result = detectTimeSkip('就这样，过了5天');
        expect(result).toEqual({ offset: 5, matchText: '过了5天' });
    });

    it('returns null for text with no time skip', () => {
        expect(detectTimeSkip('无时间跳跃文本')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(detectTimeSkip('')).toBeNull();
    });

    it('returns null for null/undefined', () => {
        expect(detectTimeSkip(null)).toBeNull();
        expect(detectTimeSkip(undefined)).toBeNull();
    });

    it('detects 次日', () => {
        const result = detectTimeSkip('次日一早');
        expect(result).toEqual({ offset: 1, matchText: '次日' });
    });

    it('detects 过了一周', () => {
        const result = detectTimeSkip('就这样过了一周');
        expect(result).toEqual({ offset: 7, matchText: '过了一周' });
    });

    it('detects 数日后', () => {
        const result = detectTimeSkip('数日后');
        expect(result).toEqual({ offset: 3, matchText: '数日后' });
    });

    it('detects dynamic offset: 过了10天', () => {
        const result = detectTimeSkip('过了10天的漫长等待');
        expect(result).toEqual({ offset: 10, matchText: '过了10天' });
    });

    it('detects 3天后', () => {
        const result = detectTimeSkip('3天后我们再见面');
        expect(result).toEqual({ offset: 3, matchText: '3天后' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseTimeTagDate
// ─────────────────────────────────────────────────────────────────────────────
describe('parseTimeTagDate', () => {
    it('parses <time>YYYY年MM月DD日</time> Chinese format', () => {
        const d = parseTimeTagDate('今天是<time>2024年12月25日</time>圣诞节');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(11);
        expect(d.getDate()).toBe(25);
    });

    it('returns null when no <time> tag present', () => {
        expect(parseTimeTagDate('没有时间标签的文本')).toBeNull();
    });

    it('handles <time> with Chinese date range (takes first part)', () => {
        const d = parseTimeTagDate('<time>2024年12月25日 - 2024年12月26日</time>');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(11);
        expect(d.getDate()).toBe(25);
    });

    it('handles 『quoted』 Chinese date in time tag', () => {
        const d = parseTimeTagDate('<time>『2024年12月25日』 - 『2024年12月26日』</time>');
        expect(d).toBeInstanceOf(Date);
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(11);
        expect(d.getDate()).toBe(25);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTimelineForPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('getTimelineForPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns sorted "YYYY-MM-DD: title" lines from character_book entries', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue({
            data: {
                character_book: {
                    entries: [
                        {
                            comment: '2024年12月',
                            content: '2024-12-15: 艾恩葛朗特第1层攻略会议\n2024-12-20: 与西莉卡训练',
                        },
                    ],
                },
            },
        });

        const result = getTimelineForPrompt('2024-12-16');
        expect(result).toContain('2024-12-15: 艾恩葛朗特第1层攻略会议');
        expect(result).toContain('2024-12-20: 与西莉卡训练');
        // Verify sorted order
        const lines = result.split('\n');
        expect(lines[0]).toContain('2024-12-15');
        expect(lines[1]).toContain('2024-12-20');
    });

    it('filters entries outside ±1 month range', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue({
            data: {
                character_book: {
                    entries: [
                        {
                            comment: '2024年10月',
                            content: '2024-10-15: 早期事件',
                        },
                        {
                            comment: '2024年12月',
                            content: '2024-12-15: 当月事件',
                        },
                        {
                            comment: '2025年2月',
                            content: '2025-02-15: 未来事件',
                        },
                    ],
                },
            },
        });

        // currentDate = 2024-12-16 → ±1 month = Nov 2024 to Jan 2025
        const result = getTimelineForPrompt('2024-12-16');
        expect(result).toContain('2024-12-15: 当月事件');
        expect(result).not.toContain('2024-10-15');
        expect(result).not.toContain('2025-02-15');
    });

    it('truncates result to maxChars', () => {
        // Build a long content string
        const longLines = Array.from({ length: 50 }, (_, i) =>
            `2024-12-${String(i + 1).padStart(2, '0')}: 这是一段很长的事件描述，用于测试截断功能，第${i + 1}天`,
        ).join('\n');

        vi.mocked(getCurrentCharacter).mockReturnValue({
            data: {
                character_book: {
                    entries: [
                        { comment: '2024年12月', content: longLines },
                    ],
                },
            },
        });

        const result = getTimelineForPrompt('2024-12-16', 200);
        expect(result.length).toBeLessThanOrEqual(200);
    });

    it('returns empty string when no entries exist', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue({
            data: { character_book: { entries: [] } },
        });
        expect(getTimelineForPrompt('2024-12-16')).toBe('');
    });

    it('returns empty string when character has no character_book', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue({ data: {} });
        expect(getTimelineForPrompt('2024-12-16')).toBe('');
    });

    it('returns empty string when getCurrentCharacter returns null', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue(null);
        expect(getTimelineForPrompt('2024-12-16')).toBe('');
    });

    it('includes all entries when no currentDate provided (no month filter)', () => {
        vi.mocked(getCurrentCharacter).mockReturnValue({
            data: {
                character_book: {
                    entries: [
                        {
                            comment: '2024年1月',
                            content: '2024-01-15: 年初事件',
                        },
                        {
                            comment: '2024年12月',
                            content: '2024-12-15: 年末事件',
                        },
                    ],
                },
            },
        });

        // No currentDate → no month filter, all entries included
        const result = getTimelineForPrompt(null);
        expect(result).toContain('2024-01-15: 年初事件');
        expect(result).toContain('2024-12-15: 年末事件');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistCalendar
// ─────────────────────────────────────────────────────────────────────────────
describe('persistCalendar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('increments calendarVersion', async () => {
        const cal = makeCalendar({ calendarVersion: 5 });
        await persistCalendar(cal);
        expect(cal.calendarVersion).toBe(6);
    });

    it('initializes calendarVersion from 0 if missing', async () => {
        const cal = makeCalendar();
        delete cal.calendarVersion;
        await persistCalendar(cal);
        expect(cal.calendarVersion).toBe(1);
    });

    it('calls saveSaoDataNow', async () => {
        const cal = makeCalendar();
        await persistCalendar(cal);
        expect(saveSaoDataNow).toHaveBeenCalledTimes(1);
    });

    it('does not throw when calendar is null', async () => {
        await expect(persistCalendar(null)).resolves.not.toThrow();
        expect(saveSaoDataNow).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractAppointments (tested indirectly via integration with addAppointmentToCalendar)
// Since extractAppointments is not exported, we test its behavior through
// the dedup + pattern-matching logic exercised by addAppointmentToCalendar.
// ─────────────────────────────────────────────────────────────────────────────
describe('extractAppointments integration (via addAppointmentToCalendar dedup)', () => {
    it('dedup works when same appointment is added twice', () => {
        const cal = makeCalendar({ currentDate: '2024-12-16' });
        const apt = {
            date: '2024-12-17',
            time: '15:00',
            description: '明天下午三点我们在主城广场见',
            source: 'auto',
            status: 'pending',
        };
        expect(addAppointmentToCalendar(cal, apt)).toBe(true);
        expect(addAppointmentToCalendar(cal, apt)).toBe(false);
        expect(cal.appointments).toHaveLength(1);
    });

    it('handles CJK text dedup correctly', () => {
        const cal = makeCalendar();
        // First 20 non-ws chars after stripping whitespace
        addAppointmentToCalendar(cal, {
            date: '2024-12-17',
            time: '15:00',
            description: '在主城广场见Asuna，一起训练剑术技巧',
        });
        // Same first 20 non-ws chars, different tail
        const result = addAppointmentToCalendar(cal, {
            date: '2024-12-17',
            time: '15:00',
            description: '在主城广场见Asuna，一起训练魔法技能',
        });
        // "在主城广场见Asuna，一起训练剑术技巧" → strip ws → first 20 = "在主城广场见Asuna，一起训练剑术"
        // "在主城广场见Asuna，一起训练魔法技能" → strip ws → first 20 = "在主城广场见Asuna，一起训练魔法"
        // These are different, so NOT deduped
        expect(result).toBe(true);
        expect(cal.appointments).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _validateCalendarGrid (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
describe('_validateCalendarGrid', () => {
    const validGrid = {
        year: 2024, month: 12, current_day: 16,
        days: [{ day: 16, events: ['与Asuna会面'] }, { day: 20, events: ['训练'] }],
    };

    it('accepts a valid grid', () => {
        expect(_validateCalendarGrid(validGrid)).toBe(true);
    });

    it('accepts grid with empty days array', () => {
        expect(_validateCalendarGrid({ year: 2024, month: 12, current_day: 16, days: [] })).toBe(true);
    });

    it('rejects null/undefined', () => {
        expect(_validateCalendarGrid(null)).toBe(false);
        expect(_validateCalendarGrid(undefined)).toBe(false);
    });

    it('rejects non-object', () => {
        expect(_validateCalendarGrid('2024-12')).toBe(false);
        expect(_validateCalendarGrid(2024)).toBe(false);
    });

    it('rejects out-of-range year', () => {
        expect(_validateCalendarGrid({ ...validGrid, year: 0 })).toBe(false);
        expect(_validateCalendarGrid({ ...validGrid, year: 10000 })).toBe(false);
    });

    it('rejects out-of-range month', () => {
        expect(_validateCalendarGrid({ ...validGrid, month: 0 })).toBe(false);
        expect(_validateCalendarGrid({ ...validGrid, month: 13 })).toBe(false);
    });

    it('rejects out-of-range current_day', () => {
        expect(_validateCalendarGrid({ ...validGrid, current_day: 0 })).toBe(false);
        expect(_validateCalendarGrid({ ...validGrid, current_day: 32 })).toBe(false);
    });

    it('rejects days not array', () => {
        expect(_validateCalendarGrid({ ...validGrid, days: 'not-array' })).toBe(false);
    });

    it('rejects days array > 31 entries', () => {
        const big = Array.from({ length: 32 }, (_, i) => ({ day: i + 1, events: [] }));
        expect(_validateCalendarGrid({ ...validGrid, days: big })).toBe(false);
    });

    it('rejects day entry with out-of-range day number', () => {
        expect(_validateCalendarGrid({ ...validGrid, days: [{ day: 0, events: [] }] })).toBe(false);
        expect(_validateCalendarGrid({ ...validGrid, days: [{ day: 32, events: [] }] })).toBe(false);
    });

    it('rejects events not array', () => {
        expect(_validateCalendarGrid({ ...validGrid, days: [{ day: 16, events: 'x' }] })).toBe(false);
    });

    it('rejects event string > 100 chars', () => {
        const long = 'x'.repeat(101);
        expect(_validateCalendarGrid({ ...validGrid, days: [{ day: 16, events: [long] }] })).toBe(false);
    });

    it('rejects non-string event', () => {
        expect(_validateCalendarGrid({ ...validGrid, days: [{ day: 16, events: [123] }] })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistCalendarPanel (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
describe('persistCalendarPanel', () => {
    let testSaoData;
    beforeEach(() => {
        vi.clearAllMocks();
        testSaoData = {
            calendar: { calendarVersion: 7, currentDate: '2024-12-16', days: {}, appointments: [] },
            calendarPanels: {},
        };
        vi.mocked(getSaoData).mockReturnValue(testSaoData);
    });

    afterEach(() => {
        vi.mocked(getSaoData).mockReset();
    });

    it('writes panel with grid, version, createdAt', () => {
        const grid = { year: 2024, month: 12, current_day: 16, days: [] };
        persistCalendarPanel(5, grid);
        const panel = testSaoData.calendarPanels[5];
        expect(panel).toBeDefined();
        expect(panel.grid).toEqual(grid);
        expect(panel.version).toBe(7);
        expect(panel.createdAt).toBeTruthy();
    });

    it('initializes calendarPanels when missing', () => {
        delete testSaoData.calendarPanels;
        persistCalendarPanel(3, { year: 2024, month: 12, current_day: 1, days: [] });
        expect(testSaoData.calendarPanels).toBeDefined();
        expect(testSaoData.calendarPanels[3]).toBeDefined();
    });

    it('overwrites existing panel for same messageId', () => {
        persistCalendarPanel(1, { year: 2024, month: 12, current_day: 16, days: [] });
        persistCalendarPanel(1, { year: 2024, month: 12, current_day: 17, days: [] });
        expect(testSaoData.calendarPanels[1].grid.current_day).toBe(17);
    });

    it('no-ops when messageId is null', () => {
        persistCalendarPanel(null, { year: 2024, month: 12, current_day: 1, days: [] });
        expect(Object.keys(testSaoData.calendarPanels)).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTransientGridFromCalendar (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildTransientGridFromCalendar', () => {
    it('derives grid from currentDate and days', () => {
        const cal = {
            currentDate: '2024-12-16',
            days: {
                '2024-12-16': { events: [{ title: '与Asuna会面' }, { description: '训练' }] },
                '2024-12-20': { events: [{ title: '远征' }] },
            },
        };
        const grid = buildTransientGridFromCalendar(cal);
        expect(grid.year).toBe(2024);
        expect(grid.month).toBe(12);
        expect(grid.current_day).toBe(16);
        const d16 = grid.days.find(d => d.day === 16);
        expect(d16).toBeDefined();
        expect(d16.events).toContain('与Asuna会面');
        expect(d16.events).toContain('训练');
    });

    it('excludes cross-month entries (only current month rendered)', () => {
        const cal = {
            currentDate: '2024-12-16',
            days: {
                '2024-12-16': { events: [{ title: '本月事件' }] },
                '2025-01-05': { events: [{ title: '跨月事件' }] }, // 应被排除
            },
        };
        const grid = buildTransientGridFromCalendar(cal);
        expect(grid.days.find(d => d.day === 16)).toBeDefined();
        expect(grid.days.find(d => d.day === 5)).toBeUndefined(); // 跨月事件不进本月网格
    });

    it('returns null when currentDate missing', () => {
        expect(buildTransientGridFromCalendar({ days: {} })).toBeNull();
        expect(buildTransientGridFromCalendar(null)).toBeNull();
    });

    it('returns null when currentDate malformed', () => {
        expect(buildTransientGridFromCalendar({ currentDate: 'not-a-date' })).toBeNull();
    });

    it('skips days entries with malformed date keys', () => {
        const cal = {
            currentDate: '2024-12-16',
            days: { 'bad-key': { events: [{ title: 'x' }] }, '2024-12-17': { events: [] } },
        };
        const grid = buildTransientGridFromCalendar(cal);
        expect(grid.days.find(d => d.day === 17)).toBeDefined();
        expect(grid.days.find(d => d.day === 'bad')).toBeUndefined();
    });

    it('caps events per day at 10', () => {
        const events = Array.from({ length: 15 }, (_, i) => ({ title: `ev${i}` }));
        const cal = { currentDate: '2024-12-16', days: { '2024-12-16': { events } } };
        const grid = buildTransientGridFromCalendar(cal);
        const d16 = grid.days.find(d => d.day === 16);
        expect(d16.events).toHaveLength(10);
    });
});
