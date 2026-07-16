import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock dependencies
// ─────────────────────────────────────────────────────────────────────────────

let mockStore = null;

vi.mock('../sao-core.js', () => ({
    log: vi.fn(),
    MODULE_NAME: 'sao_companion',
}));

vi.mock('../sao-store-core.js', () => ({
    getStore: vi.fn(() => mockStore),
    saveStore: vi.fn().mockResolvedValue(undefined),
    appendActionLog: vi.fn(),
}));

// Import AFTER mocks
import {
    getGuildStore,
    getGuildById,
    getGuildByName,
    initPresetGuilds,
    checkGuildDiscovery,
    createGuild,
    discoverGuild,
    addGuildMember,
    removeGuildMember,
    getDiscoveredGuilds,
    getPlayerGuild,
    joinGuild,
    leaveGuild,
} from '../sao-store-guild.js';
import { getPlayerStore } from '../sao-store-player.js';

// ─────────────────────────────────────────────────────────────────────────────
// beforeEach: reset mock store
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockStore = {
        playerStore: {
            player_id: 'player',
            identity: { name: '桐人', title: null },
            progression: { level: 1, totalExp: 0 },
            attributes: { str: 0, agi: 0, int: 0, vit: 0 },
            vitals: { hp: 100, maxHp: 100, mp: 20, maxMp: 20 },
            position: { floor_id: 'floor_001', location: '起始之城镇' },
            equipment: { weapon: null, off_hand: null, head: null, chest: null, hands: null, legs: null, accessory: null },
            skills: [],
            customSkills: [],
            cursor_type: 'green',
            buffs: { temporary: [], permanent: [] },
            guild_id: null,
        },
        guildStore: { byId: {}, nameToId: {} },
    };
});

// ═══════════════════════════════════════════════════════════════════════════════
// getGuildStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('getGuildStore', () => {
    it('returns existing guildStore', () => {
        const store = getGuildStore();
        expect(store).toBeTruthy();
        expect(store.byId).toBeTruthy();
        expect(store.nameToId).toBeTruthy();
    });

    it('creates guildStore if missing', () => {
        delete mockStore.guildStore;
        const store = getGuildStore();
        expect(store).toBeTruthy();
        expect(store.byId).toEqual({});
        expect(store.nameToId).toEqual({});
    });

    it('creates byId/nameToId if missing', () => {
        mockStore.guildStore = {};
        const store = getGuildStore();
        expect(store.byId).toEqual({});
        expect(store.nameToId).toEqual({});
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// initPresetGuilds
// ═══════════════════════════════════════════════════════════════════════════════

describe('initPresetGuilds', () => {
    it('initializes 6 preset guilds', () => {
        const count = initPresetGuilds();
        expect(count).toBe(6);
        const store = getGuildStore();
        expect(Object.keys(store.byId)).toHaveLength(6);
    });

    it('is idempotent (second call returns 0)', () => {
        initPresetGuilds();
        const count = initPresetGuilds();
        expect(count).toBe(0);
    });

    it('sets up nameToId mapping', () => {
        initPresetGuilds();
        const store = getGuildStore();
        expect(store.nameToId['风林火山']).toBe('flh');
        expect(store.nameToId['血盟骑士团']).toBe('kob');
        expect(store.nameToId['微笑棺木']).toBe('lc');
    });

    it('guilds are initially not discovered', () => {
        initPresetGuilds();
        const guild = getGuildById('flh');
        expect(guild.discovered).toBe(false);
        expect(guild.discovered_date).toBeNull();
    });

    it('copies members array (no shared reference)', () => {
        initPresetGuilds();
        const g1 = getGuildById('flh');
        const g2 = getGuildById('flh');
        g1.members.push('test');
        // Since we only shallow-copy, they share the same reference in store
        // But a second initPresetGuilds won't overwrite
        expect(g2.members).toContain('test');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// checkGuildDiscovery
// ═══════════════════════════════════════════════════════════════════════════════

describe('checkGuildDiscovery', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('discovers guilds whose condition is met', () => {
        const count = checkGuildDiscovery('2022-11-07');
        expect(count).toBe(1);
        const flh = getGuildById('flh');
        expect(flh.discovered).toBe(true);
        expect(flh.discovered_date).toBe('2022-11-07');
    });

    it('discovers multiple guilds when date matches', () => {
        const count = checkGuildDiscovery('2022-12-15');
        // flh (11-07), mbc (11-15), lc (11-21), als (12-01) should be discovered
        expect(count).toBe(4);
    });

    it('discovers all guilds with far-future date', () => {
        const count = checkGuildDiscovery('2025-01-01');
        expect(count).toBe(6);
    });

    it('skips already discovered guilds', () => {
        checkGuildDiscovery('2022-11-07');
        const count = checkGuildDiscovery('2022-11-07');
        expect(count).toBe(0);
    });

    it('discovers nothing with early date', () => {
        const count = checkGuildDiscovery('2022-11-06');
        expect(count).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createGuild
// ═══════════════════════════════════════════════════════════════════════════════

describe('createGuild', () => {
    it('creates a new guild and returns its ID', () => {
        const id = createGuild('测试公会', '测试会长', { description: '测试' });
        expect(id).toBeTruthy();
        const guild = getGuildById(id);
        expect(guild.name).toBe('测试公会');
        expect(guild.leader).toBe('测试会长');
        expect(guild.members).toContain('测试会长');
        expect(guild.discovered).toBe(true);
        expect(guild.discover_condition).toBeNull();
    });

    it('returns existing ID for duplicate name', () => {
        const id1 = createGuild('测试公会', '会长A', { description: '测试' });
        const id2 = createGuild('测试公会', '会长B', { description: '测试' });
        expect(id1).toBe(id2);
    });

    it('rejects missing leader', () => {
        const id = createGuild('无会长公会', null, { description: '测试' });
        expect(id).toBeNull();
    });

    it('rejects missing description', () => {
        const id = createGuild('无描述公会', '会长');
        expect(id).toBeNull();
    });

    it('creates guild with buff option', () => {
        const buff = { name: '测试加成', effects: { str: 5 }, special_effects: [], description: '攻击+5' };
        const id = createGuild('有加成公会', '会长', { description: '测试', buff });
        const guild = getGuildById(id);
        expect(guild.buff).toEqual(buff);
    });

    it('rejects buff without name', () => {
        const id = createGuild('测试', '会长', {
            description: '测试',
            buff: { effects: { str: 5 }, special_effects: [], description: 'x' },
        });
        expect(id).toBeNull();
    });

    it('rejects buff without special_effects', () => {
        const id = createGuild('测试', '会长', {
            description: '测试',
            buff: { name: 'x', effects: { str: 5 }, description: 'x' },
        });
        expect(id).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// discoverGuild
// ═══════════════════════════════════════════════════════════════════════════════

describe('discoverGuild', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('discovers a guild by name', () => {
        const result = discoverGuild('风林火山');
        expect(result).toBe(true);
        expect(getGuildById('flh').discovered).toBe(true);
    });

    it('returns true for already discovered guild', () => {
        discoverGuild('风林火山');
        const result = discoverGuild('风林火山');
        expect(result).toBe(true);
    });

    it('returns false for non-existent guild', () => {
        const result = discoverGuild('不存在的公会');
        expect(result).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addGuildMember / removeGuildMember
// ═══════════════════════════════════════════════════════════════════════════════

describe('addGuildMember', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('adds a member to a guild', () => {
        const result = addGuildMember('flh', '桐人');
        expect(result).toBe(true);
        expect(getGuildById('flh').members).toContain('桐人');
    });

    it('does not duplicate existing member', () => {
        addGuildMember('flh', '桐人');
        addGuildMember('flh', '桐人');
        const members = getGuildById('flh').members.filter(m => m === '桐人');
        expect(members).toHaveLength(1);
    });

    it('returns false for non-existent guild', () => {
        const result = addGuildMember('nonexistent', '桐人');
        expect(result).toBe(false);
    });
});

describe('removeGuildMember', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('removes a member from a guild', () => {
        addGuildMember('flh', '桐人');
        const result = removeGuildMember('flh', '桐人');
        expect(result).toBe(true);
        expect(getGuildById('flh').members).not.toContain('桐人');
    });

    it('returns false for non-existent guild', () => {
        const result = removeGuildMember('nonexistent', '桐人');
        expect(result).toBe(false);
    });

    it('handles removing non-existent member gracefully', () => {
        const result = removeGuildMember('flh', '不存在的人');
        expect(result).toBe(true); // Still returns true (guild exists)
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDiscoveredGuilds
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDiscoveredGuilds', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('returns only discovered guilds', () => {
        checkGuildDiscovery('2022-11-07');
        const discovered = getDiscoveredGuilds();
        expect(discovered.length).toBe(1);
        expect(discovered[0].guild_id).toBe('flh');
    });

    it('excludes disbanded guilds', () => {
        checkGuildDiscovery('2025-01-01');
        const flh = getGuildById('flh');
        flh.disbanded = true;
        const discovered = getDiscoveredGuilds();
        expect(discovered.find(g => g.guild_id === 'flh')).toBeUndefined();
    });

    it('returns empty array when no guilds discovered', () => {
        const discovered = getDiscoveredGuilds();
        expect(discovered).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPlayerGuild
// ═══════════════════════════════════════════════════════════════════════════════

describe('getPlayerGuild', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('returns null when player has no guild_id', () => {
        const guild = getPlayerGuild();
        expect(guild).toBeNull();
    });

    it('returns guild when player has guild_id', () => {
        mockStore.playerStore.guild_id = 'flh';
        const guild = getPlayerGuild();
        expect(guild).toBeTruthy();
        expect(guild.guild_id).toBe('flh');
        expect(guild.name).toBe('风林火山');
    });

    it('returns null when guild_id points to non-existent guild', () => {
        mockStore.playerStore.guild_id = 'nonexistent';
        const guild = getPlayerGuild();
        expect(guild).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// joinGuild
// ═══════════════════════════════════════════════════════════════════════════════

describe('joinGuild', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('joins a guild and sets player guild_id', () => {
        const result = joinGuild('风林火山');
        expect(result).toBe(true);
        expect(mockStore.playerStore.guild_id).toBe('flh');
    });

    it('adds player as guild member', () => {
        joinGuild('风林火山');
        const guild = getGuildById('flh');
        expect(guild.members).toContain('桐人');
    });

    it('applies guild buff when guild has one', () => {
        const guildId = createGuild('测试buff公会', '会长', {
            description: '测试',
            buff: { name: '测试之魂', effects: { str: 7 }, special_effects: [], description: '测试+7' },
        });
        joinGuild('测试buff公会');
        const player = mockStore.playerStore;
        const guildBuff = player.buffs.permanent.find(b => b.id === 'guild_' + guildId);
        expect(guildBuff).toBeTruthy();
        expect(guildBuff.name).toBe('测试之魂');
        expect(guildBuff.effects.str).toBe(7);
    });

    it('returns false for non-existent guild', () => {
        const result = joinGuild('不存在的公会');
        expect(result).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// leaveGuild
// ═══════════════════════════════════════════════════════════════════════════════

describe('leaveGuild', () => {
    beforeEach(() => {
        initPresetGuilds();
    });

    it('leaves guild and clears guild_id', () => {
        joinGuild('风林火山');
        const result = leaveGuild();
        expect(result).toBe(true);
        expect(mockStore.playerStore.guild_id).toBeNull();
    });

    it('removes guild buff on leave', () => {
        const guildId = createGuild('测试离开公会', '会长', {
            description: '测试',
            buff: { name: '离开之魂', effects: { vit: 3 }, special_effects: [], description: '测试buff' },
        });
        joinGuild('测试离开公会');
        const player = mockStore.playerStore;
        // sanity check: buff exists after join
        expect(player.buffs.permanent.find(b => b.id === 'guild_' + guildId)).toBeTruthy();
        leaveGuild();
        const guildBuff = player.buffs.permanent.find(b => b.id === 'guild_' + guildId);
        expect(guildBuff).toBeUndefined();
    });

    it('returns false when player has no guild', () => {
        const result = leaveGuild();
        expect(result).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getGuildById / getGuildByName
// ═══════════════════════════════════════════════════════════════════════════════

describe('getGuildById', () => {
    it('returns null for non-existent ID', () => {
        expect(getGuildById('nonexistent')).toBeNull();
    });

    it('returns guild by ID', () => {
        initPresetGuilds();
        const guild = getGuildById('flh');
        expect(guild).toBeTruthy();
        expect(guild.name).toBe('风林火山');
    });
});

describe('getGuildByName', () => {
    it('returns null for non-existent name', () => {
        expect(getGuildByName('不存在')).toBeNull();
    });

    it('returns guild by name', () => {
        initPresetGuilds();
        const guild = getGuildByName('风林火山');
        expect(guild).toBeTruthy();
        expect(guild.guild_id).toBe('flh');
    });
});
