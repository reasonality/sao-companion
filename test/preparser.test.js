import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock sao-core.js and sao-store-core.js
// ─────────────────────────────────────────────────────────────────────────────
let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
    _dedupKey: (str) => String(str || '').replace(/\s+/g, '').substring(0, 20),
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks
import { runLorebookPreParser, computeEntriesHash, parseTimelineEntries, parseWorldRules, disableParsedEntries } from '../sao-preparser.js';
import { getNpcByName, getNpcById } from '../sao-store-npc.js';
import { getFloorByNumber, getFloorById } from '../sao-store-floor.js';
import { log } from '../sao-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fresh store skeleton (matches DEFAULT_STORE structure)
// ─────────────────────────────────────────────────────────────────────────────
function makeEmptyStore() {
    return {
        schemaVersion: 1,
        npcStore: { byId: {}, nameToId: {} },
        floorStore: { byId: {}, numberToId: {} },
        skillStore: { byId: {}, nameToId: {} },
        equipmentStore: { byId: {}, nameToId: {} },
        playerStore: null,
        inventoryStore: null,
        calendarStore: { currentDate: null, events: {}, appointments: [] },
        questStore: { byId: {}, activeIds: [], completedIds: [] },
        consumableStore: { byId: {}, nameToId: {} },
        worldStore: { currentWeather: null, areaStatus: null, worldEvents: [], rules: {}, _rulesHashes: {}, _ruleSources: {}, _updatedAt: null },
        actionLog: { entries: [], lastInjectedTurn: 0, currentTurn: 0 },
        runtime: {},
        panels: {},
        calendarPanels: {},
        loreParsed: null,
    };
}

beforeEach(() => {
    mockStore = makeEmptyStore();
    vi.mocked(log).mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeEntriesHash
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeEntriesHash', () => {
    it('returns same hash for same input', () => {
        const entries = [
            { content: 'hello', enabled: true },
            { content: 'world', enabled: true },
        ];
        const h1 = computeEntriesHash(entries);
        const h2 = computeEntriesHash(entries);
        expect(h1).toBe(h2);
    });

    it('returns different hash for different content', () => {
        const e1 = [{ content: 'abc', enabled: true }];
        const e2 = [{ content: 'xyz', enabled: true }];
        expect(computeEntriesHash(e1)).not.toBe(computeEntriesHash(e2));
    });

    it('hashes content regardless of enabled state (disable is in-memory, not card change)', () => {
        // e1 and e2 have DIFFERENT content sets → different hashes
        const e1 = [{ content: 'abc' }];
        const e2 = [{ content: 'abc' }, { content: 'disabled-entry', disable: true }];
        expect(computeEntriesHash(e1)).not.toBe(computeEntriesHash(e2));
        // Same content set, different disable states → SAME hash (content is what matters)
        const a = [{ content: 'abc' }];
        const b = [{ content: 'abc', disable: true }];
        expect(computeEntriesHash(a)).toBe(computeEntriesHash(b));
    });

    it('returns deterministic value for empty/null', () => {
        expect(computeEntriesHash(null)).toBe('e0');
        expect(computeEntriesHash([])).toBe('e0');
        expect(computeEntriesHash(undefined)).toBe('e0');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 1: Character Profiles → npcStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 1: NPC profiles', () => {
    it('populates npcStore with character profiles', () => {
        const entries = [
            {
                keys: ['桐人', 'Kirito'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人 (Kirito)","basicInfo":{"realName":"桐谷和人","age":"14"}}}\n```',
            },
            {
                keys: ['亚丝娜', 'Asuna'],
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜 (Asuna)","basicInfo":{"realName":"结城明日奈","age":"15"}}}\n```',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.npcCount).toBe(2);

        const kirito = getNpcByName('桐人 (Kirito)');
        expect(kirito).toBeTruthy();
        expect(kirito.canon.characterName).toBe('桐人 (Kirito)');
        expect(kirito.source).toBe('worldbook');

        const asuna = getNpcByName('亚丝娜 (Asuna)');
        expect(asuna).toBeTruthy();
        expect(asuna.canon.characterName).toBe('亚丝娜 (Asuna)');
    });

    it('passes ALL entries to initNpcFromWorldBook (it internally filters)', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['楼层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层设定\n不是NPC内容',
            },
            {
                keys: ['设定'],
                comment: 'sao-世界设定',
                enabled: true,
                content: '一些世界规则设定',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.npcCount).toBe(1);
        expect(getNpcByName('桐人')).toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 2: Floor settings → floorStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 2: Floor settings', () => {
    it('populates floorStore with floor entries', () => {
        const entries = [
            {
                keys: ['第1层', '1F'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层世界设定\n#### 核心原则：起始之野\n##### 主城區：【起始之鎮】\n迷宫区：地下迷宫\n守关Boss：伊尔方',
            },
            {
                keys: ['第2层', '2F'],
                comment: 'sao-第2层',
                enabled: true,
                content: '### 第二层世界设定\n#### 核心原则：迷雾森林\n##### 主城區：【乌尔巴斯】',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.floorCount).toBe(2);

        const floor1 = getFloorByNumber(1);
        expect(floor1).toBeTruthy();
        expect(floor1.floor_id).toBe('floor_001');
        expect(floor1.canon.theme).toContain('起始之野');
        expect(floor1.canon.mainTown).toContain('起始之鎮');

        const floor2 = getFloorByNumber(2);
        expect(floor2).toBeTruthy();
        expect(floor2.floor_id).toBe('floor_002');
    });

    it('handles mixed NPC + floor entries', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野\n主城區：【起始之鎮】',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.npcCount).toBe(1);
        expect(result.floorCount).toBe(1);
        expect(getNpcByName('桐人')).toBeTruthy();
        expect(getFloorByNumber(1)).toBeTruthy();
    });

    it('parses compacted floor format with 数据: line (no worldbook-data fence)', () => {
        const entries = [
            {
                keys: ['第76层', '76F'],
                comment: 'sao-第76层',
                enabled: true,
                content: [
                    '[第76层 - 毒雾密林]',
                    '',
                    '后25层起点。沼泽与密林交错，持续毒雾削减HP...',
                    '',
                    '主城: 阿克索菲亚(Arc Sophia)',
                    '密林高地要塞城镇，净化水晶阵列驱散毒雾...',
                    '',
                    'Boss: 凶兆凝视者(The Ghastlygaze)',
                    '由毒雾凝聚而成的巨大眼球形怪物...',
                    '',
                    '数据: floor=76 theme=毒雾密林/沼泽 town=阿克索菲亚(Arc Sophia) labyrinth=毒雾密林(持续HP削减,需抗毒装备) boss=凶兆凝视者(The Ghastlygaze) notes=后25层起点 source=game_hollow_fragment',
                ].join('\n'),
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result).toBeTruthy();
        expect(result.floorCount).toBe(1);

        const floor76 = getFloorByNumber(76);
        expect(floor76).toBeTruthy();
        expect(floor76.floor_id).toBe('floor_076');
        expect(floor76.canon.theme).toBe('毒雾密林/沼泽');
        expect(floor76.canon.mainTown).toBe('阿克索菲亚(Arc Sophia)');
        expect(floor76.canon.labyrinth).toBe('毒雾密林(持续HP削减,需抗毒装备)');
        expect(floor76.canon.boss).toBe('凶兆凝视者(The Ghastlygaze)');
        expect(floor76.source).toBe('game_hollow_fragment');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Idempotency
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Idempotency', () => {
    it('skips re-parse when loreParsed flag matches (same hash)', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
        ];

        // First run
        const result1 = runLorebookPreParser(entries);
        expect(result1).toBeTruthy();
        expect(result1.npcCount).toBe(1);
        vi.mocked(log).mockClear();

        // Second run — should skip re-parse
        const result2 = runLorebookPreParser(entries);
        expect(result2).toBeNull();
        expect(log).toHaveBeenCalledWith('Lore pre-parser: already parsed, skipping re-parse');
    });

    it('re-parses when entry content changes (hash mismatch)', () => {
        const entries1 = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人","basicInfo":{"age":"14"}}}\n```',
            },
        ];

        runLorebookPreParser(entries1);
        expect(getNpcByName('桐人').canon.characterName).toBe('桐人');

        // Simulate card update: content changed
        const entries2 = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人","basicInfo":{"age":"16"}}}\n```',
            },
        ];

        vi.mocked(log).mockClear();
        const result2 = runLorebookPreParser(entries2);
        expect(result2).toBeTruthy();
        expect(getNpcByName('桐人').canon.characterName).toBe('桐人');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('card content changed'));
    });

    it('skips re-parse after page reload (entries re-enabled from card)', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '#### 第1层\n主题: 起始之镇',
            },
        ];

        // First run — parses + disables
        const result1 = runLorebookPreParser(entries);
        expect(result1).toBeTruthy();
        // Phase 5 disables the npc + floor entries in-memory
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);

        // Simulate page reload: ST re-reads card from disk → entries re-enabled
        delete entries[0].disable;
        delete entries[1].disable;

        vi.mocked(log).mockClear();
        // Second run — hash was computed on FRESH entries (before disable),
        // so it should match and skip (no re-parse despite re-enabled entries)
        const result2 = runLorebookPreParser(entries);
        expect(result2).toBeNull();
        expect(log).toHaveBeenCalledWith('Lore pre-parser: already parsed, skipping re-parse');
        // After reload skip path, entries should be re-disabled in-memory
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('re-disabled'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — loreParsed flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — loreParsed flag', () => {
    it('sets loreParsed with correct version, counts, and hash', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
        ];

        runLorebookPreParser(entries);

        expect(mockStore.loreParsed).toBeTruthy();
        expect(mockStore.loreParsed.version).toBe(6);
        expect(mockStore.loreParsed.npcCount).toBe(1);
        expect(mockStore.loreParsed.floorCount).toBe(1);
        expect(mockStore.loreParsed.timelineCount).toBe(0);
        expect(mockStore.loreParsed.rulesCount).toBe(0);
        expect(mockStore.loreParsed.entryHash).toBeTruthy();
        expect(mockStore.loreParsed.timestamp).toBeTruthy();
    });

    it('returns null when store is null', () => {
        mockStore = null;
        const entries = [{ content: 'test', enabled: true }];
        const result = runLorebookPreParser(entries);
        expect(result).toBeNull();
    });

    it('logs parse summary with counts', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['亚丝娜'],
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
        ];

        runLorebookPreParser(entries);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('2 NPCs'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('1 floors'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3: Timeline entries → calendarStore.events
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 3: parseTimelineEntries', () => {
    it('parses JSON timeline entries into calendarStore.events', () => {
        const entries = [
            {
                id: 50,
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    notes: '',
                    events: {
                        '2022-11-06': [
                            { time: null, description: 'SAO正式开服，所有玩家被困。' },
                            { time: null, description: '桐人教导克莱因基础操作。' },
                        ],
                        '2022-11-07': [
                            { time: null, description: '情报商阿尔戈找到桐人。' },
                            { time: null, description: '桐人与克莱因完成任务。' },
                        ],
                        '2022-11-21': [
                            { time: null, description: 'PoH正式登入SAO。' },
                        ],
                    },
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(5);

        const calStore = mockStore.calendarStore;
        expect(calStore.events['2022-11-06']).toBeTruthy();
        expect(calStore.events['2022-11-06'].length).toBe(2);
        expect(calStore.events['2022-11-06'][0].type).toBe('canon');
        expect(calStore.events['2022-11-06'][0].description).toContain('SAO');

        expect(calStore.events['2022-11-07']).toBeTruthy();
        expect(calStore.events['2022-11-07'].length).toBe(2);

        expect(calStore.events['2022-11-21']).toBeTruthy();
        expect(calStore.events['2022-11-21'].length).toBe(1);
        expect(calStore.events['2022-11-21'][0].description).toContain('PoH');
    });

    it('parses timeline with time field', () => {
        const entries = [
            {
                comment: '2023年1月时间线',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2023-01-15': [
                            { time: '15:00', description: '桐人与亚丝娜在广场相遇。' },
                            { time: null, description: '阿尔戈发布阿尔戈周报。' },
                        ],
                    },
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(2);
        const events = mockStore.calendarStore.events['2023-01-15'];
        expect(events).toBeTruthy();
        expect(events[0].description).toContain('桐人');
        expect(events[0].description).toContain('亚丝娜');
        expect(events[0].time).toBe('15:00');
        expect(events[1].description).toContain('阿尔戈周报');
    });

    it('skips non-JSON timeline entries', () => {
        const entries = [
            {
                comment: '2022年12月时间表',
                enabled: true,
                content: '这不是JSON格式的内容。',
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(0);
    });

    it('idempotency: running twice does not duplicate events', () => {
        const entries = [
            {
                comment: '2024年1月时间线',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2024-01-06': [
                            { time: null, description: '亚丝娜挑战绝剑。' },
                        ],
                    },
                }),
            },
        ];

        const count1 = parseTimelineEntries(entries);
        expect(count1).toBe(1);
        expect(mockStore.calendarStore.events['2024-01-06'].length).toBe(1);

        // Second run: clears all canon events, then re-parses fresh.
        // count2 should be 1 (re-added after clearing), total still 1 (not duplicated).
        const count2 = parseTimelineEntries(entries);
        expect(count2).toBe(1);
        expect(mockStore.calendarStore.events['2024-01-06'].length).toBe(1);
    });

    it('stores monthNotes from JSON notes field', () => {
        const entries = [
            {
                comment: '2025年2月时间线',
                enabled: true,
                content: JSON.stringify({
                    notes: '本月发生重大事件。',
                    events: {
                        '2025-02-15': [
                            { time: null, description: '某事件发生。' },
                        ],
                    },
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(1);
        expect(mockStore.calendarStore.monthNotes['2025-02']).toBe('本月发生重大事件。');
    });

    it('handles month-only date markers (no specific day)', () => {
        const entries = [
            {
                comment: '2025年2月时间线',
                enabled: true,
                content: JSON.stringify({
                    events: {},
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(0);
    });

    it('preserves pre-existing non-canon events when adding canon events', () => {
        mockStore.calendarStore.events['2022-11-06'] = [
            {
                event_id: 'evt_20221106_0',
                type: 'appointment',
                description: 'Meet Asuna',
                date: '2022-11-06',
            },
        ];

        const entries = [
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [
                            { time: null, description: 'SAO正式开服。' },
                            { time: null, description: '桐人教导克莱因。' },
                        ],
                    },
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(2);

        const events = mockStore.calendarStore.events['2022-11-06'];
        expect(events.length).toBe(3);
        expect(events[0].type).toBe('appointment');
        expect(events[0].description).toBe('Meet Asuna');
        expect(events[1].type).toBe('canon');
        expect(events[1].description).toContain('SAO');
        expect(events[2].type).toBe('canon');
        expect(events[2].description).toContain('桐人');
    });

    it('parses floor format with ## 元数据 section (new integrated format)', () => {
        const entries = [
            {
                keys: ['第13层', '第 13层', '第十三层'],
                comment: 'sao-第13层',
                enabled: true,
                content: [
                    '[第十三层世界设定 - 焦热荒野与烈焰射手]',
                    '',
                    '第十三层是攻略组在突破前十层之后遭遇的第一片恶劣环境。',
                    '',
                    '## 主城: 阿什拉尔 (Ashralar)',
                    '描述: 一座建在冷却熔岩平原上的灰黑色城镇。',
                    '',
                    '## 迷宫区',
                    '位置: 活火山的内部。',
                    '描述: 迷宫区沿火山内壁盘旋而下。',
                    '',
                    '## Boss: 阿拉兹·烈焰射手 (Allaz the Blaze Shooter)',
                    '描述: 一具由凝固熔岩与烈焰构成的人形魔像。',
                    '',
                    '## 元数据',
                    '楼层: 13 | 主题: 火山荒野/恶劣环境 | 主城: 阿什拉尔(Ashralar) | 迷宫: 活火山内部熔岩通道 | Boss: 阿拉兹·烈焰射手(Allaz the Blaze Shooter) | 来源: external+original | 备注: IF手游Nautilus首次登场',
                ].join('\n'),
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result).toBeTruthy();
        expect(result.floorCount).toBe(1);

        const floor13 = getFloorByNumber(13);
        expect(floor13).toBeTruthy();
        expect(floor13.floor_id).toBe('floor_013');
        expect(floor13.canon.theme).toBe('火山荒野/恶劣环境');
        expect(floor13.canon.boss).toBe('阿拉兹·烈焰射手(Allaz the Blaze Shooter)');
        expect(floor13.source).toBe('external+original');
    });

    it('parses disabled timeline entries (Plan A: plugin disables after parsing)', () => {
        const entries = [
            {
                comment: '2022年11月时间表',
                disable: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [
                            { time: null, description: 'SAO正式开服。' },
                        ],
                    },
                }),
            },
        ];

        const count = parseTimelineEntries(entries);
        expect(count).toBe(1);
        expect(mockStore.calendarStore.events['2022-11-06']).toBeTruthy();
        expect(mockStore.calendarStore.events['2022-11-06'][0].description).toContain('SAO');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4: World rules → worldStore.rules
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 4: parseWorldRules', () => {
    it('parses rule entries into worldStore.rules by topic', () => {
        const entries = [
            {
                comment: 'sao-PK机制',
                enabled: true,
                selective: true,
                content: '<directive name="PK规则">\n### PK基本规则\n* 仅限安全区外。\n</directive>',
            },
            {
                comment: 'sao-经济系统',
                enabled: true,
                selective: true,
                content: '<directive name="经济规则">\n### 核心概念\n* 货币：珂尔。\n</directive>',
            },
        ];

        const count = parseWorldRules(entries);
        expect(count).toBe(2);

        const ws = mockStore.worldStore;
        expect(ws.rules.pk).toContain('安全区外');
        expect(ws.rules.economy).toContain('珂尔');
        expect(ws._rulesHashes.pk).toBeTruthy();
        expect(ws._rulesHashes.economy).toBeTruthy();
    });

    it('strips HTML comments from directive content', () => {
        const entries = [
            {
                comment: 'sao-等级',
                enabled: true,
                selective: true,
                content: '<directive name="等级规则">\n<!-- hidden comment -->\n### 等级计算\n* 公式说明。\n</directive>',
            },
        ];

        const count = parseWorldRules(entries);
        expect(count).toBe(1);
        expect(mockStore.worldStore.rules.leveling).not.toContain('hidden comment');
        expect(mockStore.worldStore.rules.leveling).toContain('等级计算');
    });

    it('idempotency: skips unchanged rules on second parse', () => {
        const entries = [
            {
                comment: 'sao-技能',
                enabled: true,
                selective: true,
                content: '<directive name="技能规则">\n### 技能类别\n* 武器技能。\n</directive>',
            },
        ];

        const count1 = parseWorldRules(entries);
        expect(count1).toBe(1);

        const count2 = parseWorldRules(entries);
        expect(count2).toBe(0); // hash matches, skipped
        expect(mockStore.worldStore.rules.skills).toContain('武器技能');
    });

    it('re-parses when rule content changes', () => {
        const entries1 = [
            {
                comment: 'sao-冥想',
                enabled: true,
                selective: true,
                content: '<directive name="冥想规则">\n### 阶段1\n* 潜能。\n</directive>',
            },
        ];
        parseWorldRules(entries1);
        expect(mockStore.worldStore.rules.meditation).toContain('潜能');

        const entries2 = [
            {
                comment: 'sao-冥想',
                enabled: true,
                selective: true,
                content: '<directive name="冥想规则">\n### 阶段1\n* 潜能更新版。\n</directive>',
            },
        ];
        const count = parseWorldRules(entries2);
        expect(count).toBe(1);
        expect(mockStore.worldStore.rules.meditation).toContain('潜能更新版');
    });

    it('parses disabled entries (Plan A: plugin disables after parsing)', () => {
        const entries = [
            {
                comment: 'sao-房屋',
                disable: true,
                selective: true,
                content: '<directive name="房屋规则">\n### 房价\n* 50-80万。\n</directive>',
            },
        ];

        const count = parseWorldRules(entries);
        expect(count).toBe(1);
        expect(mockStore.worldStore.rules.housing).toContain('50-80万');
    });

    it('skips entries without <directive> tags', () => {
        const entries = [
            {
                comment: 'sao-经济系统',
                enabled: true,
                selective: true,
                content: 'Just plain text, no directive tags.',
            },
        ];

        const count = parseWorldRules(entries);
        expect(count).toBe(0);
    });

    it('maps all expected topics', () => {
        const entries = [
            { comment: 'sao-PK机制', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-经济系统', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-等级', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-技能', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-剑技获取', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-冥想', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-房屋', enabled: true, selective: true, content: '<directive>x</directive>' },
            { comment: 'sao-NPC档案构建规则', enabled: true, selective: true, content: '<directive>x</directive>' },
        ];

        const count = parseWorldRules(entries);
        expect(count).toBe(7);
        expect(Object.keys(mockStore.worldStore.rules)).toEqual(
            expect.arrayContaining(['pk', 'economy', 'leveling', 'skills', 'meditation', 'housing', 'npc_rules'])
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 3+4 integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 3+4 integration', () => {
    it('includes timelineCount and rulesCount in result and loreParsed', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [{ time: null, description: 'SAO正式开服。' }],
                        '2022-11-07': [{ time: null, description: '桐人探索。' }],
                    },
                }),
            },
            {
                comment: 'sao-PK机制',
                enabled: true,
                selective: true,
                content: '<directive name="PK">\n### PK规则\n* 安全区外可PK。\n</directive>',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.npcCount).toBe(1);
        expect(result.floorCount).toBe(1);
        expect(result.timelineCount).toBe(2);
        expect(result.rulesCount).toBe(1);

        expect(mockStore.loreParsed.timelineCount).toBe(2);
        expect(mockStore.loreParsed.rulesCount).toBe(1);

        // Verify data actually written to stores
        expect(mockStore.calendarStore.events['2022-11-06']).toBeTruthy();
        expect(mockStore.worldStore.rules.pk).toBeTruthy();
    });

    it('logs parse summary with all counts', () => {
        const entries = [
            {
                comment: '2023年3月时间线',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2023-03-01': [{ time: null, description: '事件A。' }],
                        '2023-03-15': [{ time: null, description: '事件B。' }],
                    },
                }),
            },
            {
                comment: 'sao-房屋',
                enabled: true,
                selective: true,
                content: '<directive>### 房价\n* 50万。</directive>',
            },
        ];

        runLorebookPreParser(entries);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('2 timeline events'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('1 rules'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5: Disable parsed entries in lorebook
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5: disableParsedEntries', () => {
    it('disables character profile entries when npcCount > 0', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 2, floorCount: 0, timelineCount: 0, rulesCount: 0 });
        expect(count).toBe(2);
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);
    });

    it('disables floor entries when floorCount > 0', () => {
        const entries = [
            {
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层设定',
            },
            {
                comment: 'sao-第50层',
                enabled: true,
                content: '### 第五十层设定',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 0, floorCount: 2, timelineCount: 0, rulesCount: 0 });
        expect(count).toBe(2);
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);
    });

    it('disables timeline entries when timelineCount > 0', () => {
        const entries = [
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: '#### 11月6日\n* 事件。',
            },
            {
                comment: '2023年1月时间线',
                enabled: true,
                content: '#### 1月15日\n* 事件。',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 0, floorCount: 0, timelineCount: 10, rulesCount: 0 });
        expect(count).toBe(2);
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);
    });

    it('disables specific rule entries (剑技获取, 冥想, 房屋) when rulesCount > 0', () => {
        const entries = [
            {
                comment: 'sao-剑技获取',
                enabled: true,
                selective: true,
                content: '<directive>剑技规则</directive>',
            },
            {
                comment: 'sao-冥想',
                enabled: true,
                selective: true,
                content: '<directive>冥想规则</directive>',
            },
            {
                comment: 'sao-房屋',
                enabled: true,
                selective: true,
                content: '<directive>房屋规则</directive>',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 0, floorCount: 0, timelineCount: 0, rulesCount: 3 });
        expect(count).toBe(3);
        expect(entries[0].disable).toBe(true);
        expect(entries[1].disable).toBe(true);
        expect(entries[2].disable).toBe(true);
    });

    it('does NOT disable const entries (constant === true)', () => {
        const entries = [
            {
                comment: 'sao-世界设定',
                enabled: true,
                constant: true,
                content: '世界规则',
            },
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 1, floorCount: 0, timelineCount: 0, rulesCount: 0 });
        expect(count).toBe(1);
        expect(entries[0].disable).not.toBe(true);   // const — not disabled
        expect(entries[1].disable).toBe(true);        // profile — disabled
    });

    it('does NOT disable already-disabled entries (count does not inflate)', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                disable: true,  // already disabled
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 2, floorCount: 0, timelineCount: 0, rulesCount: 0 });
        expect(count).toBe(1);  // only亚丝娜, not 桐人 (already disabled)
        expect(entries[0].disable).toBe(true);  // unchanged (was already disabled)
        expect(entries[1].disable).toBe(true);  // newly disabled
    });

    it('does NOT disable when parseResults is null (parsing failed)', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
        ];

        const count = disableParsedEntries(entries, null);
        expect(count).toBe(0);
        expect(entries[0].disable).not.toBe(true);
    });

    it('does NOT disable when all parse counts are 0', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 0, floorCount: 0, timelineCount: 0, rulesCount: 0 });
        expect(count).toBe(0);
        expect(entries[0].disable).not.toBe(true);
    });

    it('does NOT disable KEEP_ENABLED whitelist entries even if they match patterns', () => {
        const entries = [
            {
                comment: 'sao-格式',
                enabled: true,
                content: '格式说明（包含characterProfile的edge case）',  // edge case: content has characterProfile string
            },
            {
                comment: 'sao-注意事项（可能的错误）',
                enabled: true,
                content: '注意事项',
            },
            {
                comment: 'sao-数值由系统计算(插件接管)',
                enabled: true,
                content: '数值规则',
            },
            {
                comment: 'sao-标签输出与数值委托协议(插件)',
                enabled: true,
                content: '标签协议',
            },
            {
                comment: 'sao-NPC档案构建规则',
                enabled: true,
                content: 'NPC档案构建规则',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 5, floorCount: 99, timelineCount: 44, rulesCount: 8 });
        expect(count).toBe(0);
        for (const e of entries) {
            expect(e.disable).not.toBe(true);
        }
    });

    it('does NOT disable KEEP_ENABLED entries with trailing parentheticals (prefix match)', () => {
        // Regression: entry #233 comment is "sao-格式（去掉<map><npc_thoughts><guild>）"
        // which did NOT exact-match "sao-格式" in old Set.has() → was wrongly disabled
        const entries = [
            { comment: 'sao-格式（去掉<map><npc_thoughts><guild>）', enabled: true, selective: true, content: '<directive>格式</directive>' },
            { comment: 'sao-NPC档案构建规则 （sao）', enabled: true, selective: true, content: '<directive>NPC规则</directive>' },
        ];
        const count = disableParsedEntries(entries, { npcCount: 5, floorCount: 99, timelineCount: 44, rulesCount: 8 });
        expect(count).toBe(0);
        expect(entries[0].disable).not.toBe(true);
        expect(entries[1].disable).not.toBe(true);
    });

    it('does NOT disable tentative-keep rule entries (PK, 经济, 等级)', () => {
        const entries = [
            {
                comment: 'sao-PK机制',
                enabled: true,
                selective: true,
                content: '<directive>PK规则</directive>',
            },
            {
                comment: 'sao-经济系统',
                enabled: true,
                selective: true,
                content: '<directive>经济规则</directive>',
            },
            {
                comment: 'sao-等级',
                enabled: true,
                selective: true,
                content: '<directive>等级规则</directive>',
            },
            {
                comment: 'sao-技能',
                enabled: true,
                selective: true,
                content: '<directive>技能规则</directive>',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 0, floorCount: 0, timelineCount: 0, rulesCount: 4 });
        expect(count).toBe(0);  // none disabled — PK/经济/等级 kept, 技能 not in RULES_TO_DISABLE
        for (const e of entries) {
            expect(e.disable).not.toBe(true);
        }
    });

    it('returns 0 for null/empty entries', () => {
        expect(disableParsedEntries(null, { npcCount: 1, floorCount: 0, timelineCount: 0, rulesCount: 0 })).toBe(0);
        expect(disableParsedEntries([], { npcCount: 1, floorCount: 0, timelineCount: 0, rulesCount: 0 })).toBe(0);
        expect(disableParsedEntries(undefined, { npcCount: 1, floorCount: 0, timelineCount: 0, rulesCount: 0 })).toBe(0);
    });

    it('logs disabled count with per-category breakdown', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层',
            },
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: '#### 11月6日\n* 事件。',
            },
            {
                comment: 'sao-剑技获取',
                enabled: true,
                selective: true,
                content: '<directive>剑技</directive>',
            },
        ];

        const count = disableParsedEntries(entries, { npcCount: 1, floorCount: 1, timelineCount: 1, rulesCount: 1 });
        expect(count).toBe(4);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('disabled 4 data entries'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('npc=1'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('floor=1'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('timeline=1'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('rules=1'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// runLorebookPreParser — Phase 5 integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('runLorebookPreParser — Phase 5 integration (disable entries)', () => {
    it('disables data entries after successful parsing', () => {
        const entries = [
            {
                keys: ['桐人'],
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                keys: ['第1层'],
                comment: 'sao-第1层',
                enabled: true,
                content: '### 第一层\n核心原则：起始之野',
            },
            {
                comment: 'sao-世界设定',
                enabled: true,
                constant: true,
                content: '世界基本规则',
            },
        ];

        const result = runLorebookPreParser(entries);

        expect(result).toBeTruthy();
        expect(result.disabledCount).toBe(2);  // NPC + floor, not const
        expect(entries[0].disable).toBe(true);  // NPC disabled
        expect(entries[1].disable).toBe(true);  // floor disabled
        expect(entries[2].disable).not.toBe(true);   // const kept

        expect(mockStore.loreParsed.disabledCount).toBe(2);
    });

    it('returns disabledCount in result object', () => {
        const entries = [
            {
                comment: 'sao-桐人',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"桐人"}}\n```',
            },
            {
                comment: 'sao-亚丝娜',
                enabled: true,
                content: '```json\n{"characterProfile":{"characterName":"亚丝娜"}}\n```',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.disabledCount).toBe(2);
    });

    it('does not disable entries when all counts are 0', () => {
        const entries = [
            {
                comment: 'sao-世界设定',
                enabled: true,
                constant: true,
                content: '世界规则（不含characterProfile）',
            },
        ];

        const result = runLorebookPreParser(entries);
        expect(result.disabledCount).toBe(0);
        expect(entries[0].disable).not.toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stale data removal: disabled entries' canon data cleaned on re-parse
// ═══════════════════════════════════════════════════════════════════════════════

describe('Stale data removal — timeline events from removed entries', () => {
    it('removes canon events from entries that are removed from the array', () => {
        const entries = [
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [{ time: null, description: 'SAO正式开服，所有玩家被困。' }],
                    },
                }),
            },
        ];

        // First parse — populates events
        const count1 = parseTimelineEntries(entries);
        expect(count1).toBe(1);
        expect(mockStore.calendarStore.events['2022-11-06']).toBeTruthy();
        expect(mockStore.calendarStore.events['2022-11-06'][0].sourceEntryId).toBe('2022年11月时间表');

        // Remove entry from array
        entries.splice(0, 1);

        // Re-parse — stale events removed
        const count2 = parseTimelineEntries(entries);
        expect(count2).toBe(0);
        expect(mockStore.calendarStore.events['2022-11-06']).toBeFalsy();
    });

    it('preserves non-canon events when removing stale canon events from removed entries', () => {
        const entries = [
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [{ time: null, description: 'SAO正式开服。' }],
                    },
                }),
            },
        ];

        // First parse
        parseTimelineEntries(entries);
        expect(mockStore.calendarStore.events['2022-11-06'].length).toBe(1);

        // Add appointment on the same date
        mockStore.calendarStore.events['2022-11-06'].push({
            event_id: 'evt_20221106_apt',
            type: 'appointment',
            description: 'Meet Asuna',
        });
        expect(mockStore.calendarStore.events['2022-11-06'].length).toBe(2);

        // Remove entry from array
        entries.splice(0, 1);

        // Re-parse
        parseTimelineEntries(entries);

        // Appointment survives, canon event removed
        const events = mockStore.calendarStore.events['2022-11-06'];
        expect(events).toBeTruthy();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('appointment');
        expect(events[0].description).toBe('Meet Asuna');
    });

    it('keeps canon events from still-present entries on re-parse (idempotent stale check)', () => {
        const entries = [
            {
                comment: '2022年11月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-11-06': [{ time: null, description: 'SAO正式开服。' }],
                    },
                }),
            },
            {
                comment: '2022年12月时间表',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2022-12-01': [{ time: null, description: '攻略会议召开。' }],
                    },
                }),
            },
        ];

        // First parse
        parseTimelineEntries(entries);
        expect(mockStore.calendarStore.events['2022-11-06']).toBeTruthy();
        expect(mockStore.calendarStore.events['2022-12-01']).toBeTruthy();

        // Remove only the November entry from the array
        entries.splice(0, 1);

        // Re-parse
        parseTimelineEntries(entries);

        // November events removed, December kept
        expect(mockStore.calendarStore.events['2022-11-06']).toBeFalsy();
        expect(mockStore.calendarStore.events['2022-12-01']).toBeTruthy();
        expect(mockStore.calendarStore.events['2022-12-01'][0].description).toContain('攻略');
    });

    it('adds sourceEntryId to all newly parsed canon events', () => {
        const entries = [
            {
                comment: '2023年3月时间线',
                enabled: true,
                content: JSON.stringify({
                    events: {
                        '2023-03-10': [
                            { time: null, description: '事件A。' },
                            { time: null, description: '事件B。' },
                        ],
                        '2023-03-20': [
                            { time: null, description: '事件C。' },
                        ],
                    },
                }),
            },
        ];

        parseTimelineEntries(entries);

        for (const dateStr of ['2023-03-10', '2023-03-20']) {
            for (const evt of mockStore.calendarStore.events[dateStr]) {
                expect(evt.sourceEntryId).toBe('2023年3月时间线');
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stale data removal: disabled entries' world rules cleaned on re-parse
// ═══════════════════════════════════════════════════════════════════════════════

describe('Stale data removal — world rules from removed entries', () => {
    it('removes rules from entries that are removed from the array', () => {
        const entries = [
            {
                comment: 'sao-PK机制',
                enabled: true,
                selective: true,
                content: '<directive name="PK规则">\n### PK基本规则\n* 仅限安全区外。\n</directive>',
            },
        ];

        // First parse
        const count1 = parseWorldRules(entries);
        expect(count1).toBe(1);
        expect(mockStore.worldStore.rules.pk).toContain('安全区外');

        // Remove entry from array (not just disable — disabled entries are still parsed in Plan A)
        entries.splice(0, 1);

        // Re-parse
        const count2 = parseWorldRules(entries);
        expect(count2).toBe(0);
        expect(mockStore.worldStore.rules.pk).toBeUndefined();
        expect(mockStore.worldStore._rulesHashes.pk).toBeUndefined();
        expect(mockStore.worldStore._ruleSources.pk).toBeUndefined();
    });

    it('preserves rules from still-present entries while removing stale ones', () => {
        const entries = [
            {
                comment: 'sao-PK机制',
                enabled: true,
                selective: true,
                content: '<directive name="PK规则">\n### PK基本规则\n* 仅限安全区外。\n</directive>',
            },
            {
                comment: 'sao-经济系统',
                enabled: true,
                selective: true,
                content: '<directive name="经济规则">\n### 核心概念\n* 货币：珂尔。\n</directive>',
            },
        ];

        // First parse
        parseWorldRules(entries);
        expect(mockStore.worldStore.rules.pk).toBeTruthy();
        expect(mockStore.worldStore.rules.economy).toBeTruthy();

        // Remove only PK entry from array
        entries.splice(0, 1);

        // Re-parse
        parseWorldRules(entries);

        // PK removed, economy kept
        expect(mockStore.worldStore.rules.pk).toBeUndefined();
        expect(mockStore.worldStore.rules.economy).toContain('珂尔');
    });

    it('stores _ruleSources mapping for each parsed rule', () => {
        const entries = [
            {
                comment: 'sao-剑技获取',
                enabled: true,
                selective: true,
                content: '<directive name="剑技">\n### 剑技获取\n* 通过实战。\n</directive>',
            },
        ];

        parseWorldRules(entries);
        // 'combat' topic removed — 剑技获取 entry no longer parsed as a rule
        expect(mockStore.worldStore._ruleSources.combat).toBeUndefined();
    });
});
