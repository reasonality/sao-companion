# Lorebook Pre-Parser System — Design Document

> **Status**: DRAFT — for review before implementation
> **Author**: Oracle (design), to be implemented by @fixer
> **Date**: 2026-07-03
> **Scope**: SAO Companion plugin (`sao-companion/`)

---

## 1. Problem Statement

The SAO character card (`2.0.0_extracted.json`) contains **302 lorebook entries** (182 currently enabled). SillyTavern injects these via keyword matching at prompt assembly time. This is:

- **Costly**: 182 enabled entries × average ~1.5KB = ~270KB of prompt tokens injected per turn, even when irrelevant.
- **Imprecise**: Keyword matching (e.g. keys like `sao, SAO, 艾恩葛朗特`) fires on nearly every message, injecting all SAO-arc entries indiscriminately.
- **Redundant with tool calls**: The plugin already has 5 function-calling tools (`get_character_info`, `get_floor_info`, `get_calendar`, `get_world_setting`, `search_world_book`) that can retrieve this data on-demand.

**Goal**: Parse lorebook entries into structured database stores at chat-load time, then disable the data entries from ST's keyword injection. The LLM retrieves data via tool calls instead of receiving it all upfront.

---

## 2. Current Entry Census (182 enabled)

| Category | Count | Position | Key Pattern | Content Format |
|---|---|---|---|---|
| **Character profiles** | 24 | before_char | `桐谷和人, 桐人, Kirito` etc. | JSON with `characterProfile` key |
| **Floor settings** | 99 | before_char | `第N层, 第N层, 第N层` | Markdown prose + `worldbook-data` JSON fence |
| **Timeline** | 44 | before_char | `YYYY年M月, YYYY年 M月` | Markdown with date headers (`M月D日`) |
| **Const (rules)** | 3 | mixed | N/A (always injected) | `<directive>` XML + markdown |
| **Selective (rules/format)** | 12 | after_char | `sao, SAO, 艾恩葛朗特` etc. | `<directive>` XML + markdown |

**Disabled entries** (120): 49 const (other arcs: ALO/GGO/现实), 51 character profiles (other arcs), 20 misc.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  CHAT_CHANGED (isSaoCard)                           │
│  ┌───────────────────────────────────────────────┐  │
│  │  1. Existing init: stabilizeRegex, compatMode │  │
│  │  2. Existing init: initNpcFromWorldBook        │  │
│  │     initFloorFromWorldBook, ensureAllFloors    │  │
│  │  3. NEW: runLorebookPreParser()                │  │
│  │     ├─ Parse character profiles → npcStore     │  │
│  │     ├─ Parse floor entries → floorStore        │  │
│  │     ├─ Parse timeline entries → calendarStore  │  │
│  │     ├─ Parse world rules → worldStore.rules    │  │
│  │     ├─ Disable parsed entries in-memory        │  │
│  │     └─ Set loreParsed flag + version           │  │
│  │  4. saveStore()                                │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 4. Pre-Parser Scope (Section A)

### 4.1 Character Profiles → npcStore

**Source entries**: 24 enabled entries with `characterProfile` JSON (indices 13–28, plus ~50 disabled for other arcs).

**Parsing approach**: JSON extraction — identical to existing `initNpcFromWorldBook()` in `sao-store-npc.js:183-245`.

**What it does**:
1. Scan entries where `content.includes('characterProfile')`.
2. Strip ` ```json ``` ` fence if present.
3. Parse JSON, extract `characterProfile` object.
4. Use `characterName` as primary key, `keys[]` as aliases.
5. Write to `npcStore.byId[id]` with `canon = profile`, `source = 'worldbook'`.
6. Hash content for idempotency (`_canonHash`).

**Idempotency**: Already handled — `initNpcFromWorldBook` checks `_canonHash` and skips unchanged entries. **However**, the existing function is called with pre-filtered entries (only those matching `content.includes('characterProfile')`). The pre-parser should call the same function with ALL entries, relying on the function's internal filter.

**Action**: No new parser needed. Reuse `initNpcFromWorldBook(entries)` directly. The existing pre-classification in `index.js:556-567` already does this.

**Target store**: `npcStore.byId[id]`
**Key field**: `npc_id` (generated from `characterName` via `generateNpcId`)

### 4.2 Floor Entries → floorStore

**Source entries**: 99 enabled entries with floor keys (indices 89–123, 238–301).

**Parsing approach**: Regex extraction — identical to existing `initFloorFromWorldBook()` in `sao-store-floor.js:167-294`.

**What it does**:
1. Scan entries where comment/keys match `/层|floor/i`.
2. Extract floor numbers from comment (`第(\d+)层`) and keys (`(\d+)F`).
3. Parse ` ```worldbook-data ``` ` JSON fence for structured fields (theme, mainTown, labyrinth, boss).
4. Fallback to regex extraction (`extractTheme`, `extractMainTown`, etc.) for entries without JSON.
5. Write to `floorStore.byId[floorId]` with `canon = { rawContent, theme, mainTown, labyrinth, boss }`.

**Idempotency**: Already handled — `_canonHash` comparison.

**Action**: No new parser needed. Reuse `initFloorFromWorldBook(entries)` directly. The existing pre-classification already filters floor entries.

**Target store**: `floorStore.byId[floor_id]`
**Key field**: `floor_id` (e.g. `floor_001`)

**Gap identified**: 99 floor entries are enabled but the existing `initFloorFromWorldBook` is only called with entries matching the pre-classification regex. Currently at `index.js:564`: `/层|floor|f\b/.test(allText)`. This works — all 99 floor entries match. No gap.

### 4.3 Timeline Entries → calendarStore

**Source entries**: 44 enabled entries keyed by `YYYY年M月` (indices 4, 29, 46, 50, 52–79, 81, 84, 124, 127, 130–133, 143, 165–167).

**Parsing approach**: Regex extraction of date-event pairs from markdown.

**Content format** (example from entry #50, `2022年11月时间表`):
```markdown
### **【世界历史背景：2022年11月 - 艾恩葛朗特事件表】**

#### **11月6日 (星期日) - 宣告日**
*   **[关键事件]:**
    *   **13:00:** 《Sword Art Online》正式开服。
    *   **下午:** 两条故事线并行发生：
        *   **桐人与克莱因：** 经验丰富的桐人...
```

**Parser design** (new function: `parseTimelineEntries`):

```
Input: entries[] (all lorebook entries)
Output: events Map<YYYY-MM-DD, Array<{title: string, type: 'canon'}>>

Algorithm:
1. Filter entries where comment matches /年.*月/ and has digit content
2. Extract year+month from comment: /(\d{4})年(\d{1,2})月/
3. For each entry, scan content line by line:
   a. Match date headers: /(\d{1,2})月(\d{1,2})日/ → compute YYYY-MM-DD
   b. Match bullet events: /^\s*\*\s+(.+)/ → extract title text
   c. Strip markdown formatting (**, *, etc.) from title
4. Group by date string (YYYY-MM-DD)
5. Return merged map
```

**Key challenge**: The timeline entries have complex nested markdown with multiple sections per day (世界状态, 玩家认知, 关键事件, etc.). The parser should extract **top-level bullet items** as events, not nested sub-bullets. This keeps the calendar manageable.

**Fallback**: If regex parsing fails for an entry, log a warning and skip. The existing `initCalendarIfNeeded()` in `sao-calendar.js:505` will still work as a fallback (it reads from the same world book entries at runtime).

**Idempotency**: Use `canonDataVersion` (already exists in `data.calendar`). Bump version when pre-parser runs; `initCalendarIfNeeded` checks this version and skips re-extraction if current.

**Target store**: `calendarStore.events[YYYY-MM-DD]`
**Key field**: Date string (YYYY-MM-DD)

**Overlap with existing code**: `initCalendarIfNeeded()` already parses timeline entries from the world book into `calendarStore.events`. The pre-parser should **replace** the lazy init with eager init. Specifically:
- Pre-parser calls a new `parseAllTimelineEntries(entries)` that extracts ALL timeline events.
- `initCalendarIfNeeded()` is modified to check `data.loreParsed.timeline === true` and skip re-extraction if already parsed.
- This avoids the current behavior where `initCalendarIfNeeded` only parses ±12 months from `currentDate`.

### 4.4 World Rules → worldStore.rules

**Source entries**: 12 enabled selective entries with SAO-wide keys (indices 8, 9, 35, 42, 80, 125, 126, 149).

**Content format**: `<directive>` XML blocks with markdown rules. Example (entry #8, `sao-PK机制`):
```xml
<directive name="SAO_PK规则">
### PK机制
* 玩家可以在非安全区发起PK...
</directive>
```

**Parsing approach**: Topic-based extraction with hardcoded topic mapping.

**Topic mapping** (from entry comment/key → `worldStore.rules` key):

| Entry Comment | Topic Key | Content Summary |
|---|---|---|
| `sao-PK机制` | `pk` | PK rules, safe zones, murder penalty |
| `sao-经济系统` | `economy` | Currency, shops, trading |
| `sao-等级` | `leveling` | XP curves, stat allocation |
| `sao-技能` | `skills` | Skill slots, proficiency |
| `sao-剑技获取` | `combat` | Sword skill acquisition |
| `sao-冥想` | `meditation` | Meditation mechanic |
| `sao-房屋` | `housing` | Housing system |
| `sao-NPC档案构建规则` | `npc_rules` | How AI should build NPC profiles |

**Parser design** (new function: `parseWorldRules`):

```
Input: entries[] (all lorebook entries)
Output: void (writes to worldStore.rules)

Algorithm:
1. Define TOPIC_MAP: { comment_pattern → topic_key }
2. For each enabled selective entry:
   a. Match comment against TOPIC_MAP patterns
   b. If matched, extract directive content (strip <directive> tags)
   c. Write to worldStore.rules[topic_key] = cleaned_content
3. Log count of parsed rules
```

**Idempotency**: Simple content hash comparison. Store hash in `worldStore.rules._hashes[topic_key]`.

**Target store**: `worldStore.rules[topic_key]`
**Key field**: Topic string (e.g. `'pk'`, `'economy'`)

**Gap identified**: `get_world_setting` tool (`sao-tools.js:395-438`) already reads from `worldStore.rules`. After pre-parser populates this, the tool will return real data instead of `"暂无...的结构化数据"`. No tool changes needed.

### 4.5 Entries NOT to Parse (Stay as Injected Prompts)

These entries contain **format instructions, action rules, and plugin protocols** that the LLM needs in its prompt context to generate correct output. They cannot be retrieved via tool calls because they govern *how* the LLM writes, not *what* it knows.

| Entry | Index | Reason to Keep Enabled |
|---|---|---|
| `sao-世界设定` | 0 | **Const.** Core world rules, always needed. |
| `sao-真实骰子规则` | 41 | **Const.** Dice mechanics for combat. |
| `行动2` | 174 | **Const.** Action format template. |
| `sao-格式` | 233 | Output format template (`<zd_status>`, `<user_status>` tags). |
| `sao-注意事项` | 232 | Error avoidance rules for the LLM. |
| `sao-数值由系统计算` | 236 | Plugin protocol: LLM must not invent numbers. |
| `sao-标签输出与数值委托协议` | 237 | Plugin protocol: tag format specification. |
| `sao-NPC档案构建规则` | 35 | **Hybrid** — contains format rules AND reference data. See §4.4. |

**Decision on hybrid entries** (e.g. `sao-NPC档案构建规则`): Parse the *reference data* portion into `worldStore.rules`, but keep the entry enabled for the *format instructions*. This means some content is double-stored (once in rules, once in prompt). Acceptable — the rules store version is for tool-call retrieval by the LLM when it needs to *reference* the rules mid-conversation; the injected version is for *compliance* from the first token.

---

## 5. Store Changes (Section B)

### 5.1 No New Store Needed

All parsed data fits existing stores:
- Character profiles → `npcStore` (existing, `sao-store-npc.js`)
- Floor settings → `floorStore` (existing, `sao-store-floor.js`)
- Timeline events → `calendarStore.events` (existing, `sao-calendar.js`)
- World rules → `worldStore.rules` (existing field, `sao-store-world.js:27`)

### 5.2 worldStore.rules Enhancement

**Current state** (`sao-store-world.js:27`): `rules` field exists but is always empty `{}`. The `get_world_setting` tool reads from it but returns "暂无数据".

**Change**: The pre-parser writes extracted rule content into `worldStore.rules[topic]`. No schema change needed — the field already accepts arbitrary string/object values.

**New fields in worldStore**:
```javascript
worldStore: {
    currentWeather: null,
    areaStatus: null,
    worldEvents: [],
    rules: {},           // ← pre-parser writes here
    _rulesHashes: {},    // ← NEW: idempotency hashes per topic
    _updatedAt: null,
}
```

### 5.3 calendarStore Timeline Pre-Population

**Current state**: `calendarStore.events` is populated lazily by `initCalendarIfNeeded()` which only parses ±12 months from `currentDate`.

**Change**: Pre-parser populates ALL timeline events eagerly. `initCalendarIfNeeded()` checks a flag and skips re-extraction.

**New field in data (chatMetadata level)**:
```javascript
{
    loreParsed: {
        version: 1,           // schema version for migration
        timestamp: ISO string,// when parsing ran
        npcCount: number,     // how many NPCs parsed
        floorCount: number,   // how many floors parsed
        timelineCount: number,// how many timeline events parsed
        rulesCount: number,   // how many rules parsed
    }
}
```

---

## 6. Lorebook Enable Strategy (Section C)

### 6.1 Entries to KEEP Enabled (Always Injected)

**Const entries** (3):
| Index | Comment | Reason |
|---|---|---|
| 0 | `sao-世界设定` | Core world rules — SAO physical laws, UI, combat logic. Must always be in context. |
| 41 | `sao-真实骰子规则` | Dice mechanics — combat resolution needs this in prompt. |
| 174 | `行动2` | Action format template — LLM needs this to write correct action blocks. |

**Selective entries to KEEP enabled** (8):
| Index | Comment | Reason |
|---|---|---|
| 233 | `sao-格式` | Output format — `<zd_status>`, `<user_status>` tag templates. |
| 232 | `sao-注意事项` | Error avoidance — common LLM mistakes to avoid. |
| 236 | `sao-数值由系统计算` | Plugin protocol — "don't invent numbers, use tags". |
| 237 | `sao-标签输出与数值委托协议` | Plugin protocol — tag format spec. |
| 35 | `sao-NPC档案构建规则` | Format rules for NPC profiles (hybrid — also parsed to rules). |
| 8 | `sao-PK机制` | **Tentative** — small enough (~1KB) to keep injected for latency. |
| 9 | `sao-经济系统` | **Tentative** — same reasoning. |
| 42 | `sao-等级` | **Testative** — same reasoning. |

**Rationale for keeping mechanic rules (8, 9, 42)**: These are small entries (~1-2KB each) that the LLM references frequently during gameplay. Keeping them injected avoids a tool call round-trip for common queries. If token budget becomes tight, these can be moved to disabled + tool-call in a later phase.

### 6.2 Entries to DISABLE (Now in DB)

| Category | Count | Indices | Reason |
|---|---|---|---|
| Character profiles (SAO arc) | 24 | 13–28 | Data now in `npcStore`. Retrieved via `get_character_info`. |
| Character profiles (other arcs) | ~51 | various | Already disabled. No change. |
| Floor settings | 99 | 89–123, 238–301 | Data now in `floorStore`. Retrieved via `get_floor_info`. |
| Timeline | 44 | 4, 29, 46, 50, 52–79, 81, 84, 124, 127, 130–133, 143, 165–167 | Data now in `calendarStore`. Retrieved via `get_calendar`. |
| Mechanic rules (if moved) | 5 | 80, 125, 126, 149, 35(data portion) | Data now in `worldStore.rules`. Retrieved via `get_world_setting`. |

**Total to disable**: ~172 entries (from 182 enabled → ~10 enabled).

### 6.3 Disable Mechanism

**Runtime disable** (recommended — see §6.F): The pre-parser sets `entry.enabled = false` on the in-memory entry objects in `char.data.character_book.entries`. This is the same pattern used by `enableCardRegex()` for regex scripts (`index.js:417-431`).

**Why runtime, not card edit**:
1. **No card modification**: The `.json` file stays untouched. User can update the card without losing the pre-parser's work.
2. **Reversible**: On plugin deactivation or card switch, the entries are restored (ST reloads from file).
3. **Safe**: Same pattern as `MIGRATED_SCRIPTS` — in-memory disable with save/restore.

**Implementation**: Add a new function `disableLorebookDataEntries(entries, loreParsed)` that iterates entries and sets `enabled = false` for those whose data was successfully parsed.

---

## 7. Pre-Parser Trigger & Idempotency (Section D)

### 7.1 Trigger Point

**When**: Inside the `CHAT_CHANGED` event handler (`index.js:527`), after the existing store init block (lines 549-574).

**Sequence**:
```
CHAT_CHANGED
  ├─ stabilizeSaoRegexScripts()
  ├─ enableCompatMode()
  ├─ injectMemoryAndState()
  ├─ initCalendarIfNeeded()
  ├─ [EXISTING] initNpcFromWorldBook / initFloorFromWorldBook / ensureAllFloorsExist
  ├─ [NEW] runLorebookPreParser(entries)    ← INSERT HERE
  └─ saveStore()
```

**Why here**: This is the earliest point where:
1. We know it's a SAO card (`isSaoCard()` is true).
2. The character book entries are accessible (`char.data.character_book.entries`).
3. The stores are initialized (getStore() returns non-null).
4. We can disable entries before the first prompt assembly.

### 7.2 Idempotency

**Flag**: `chatMetadata[MODULE_NAME].loreParsed`

```javascript
loreParsed: {
    version: 1,              // schema version (for future migration)
    timestamp: '2026-07-03T12:00:00Z',
    entryHash: 'h1a2b3c4d5', // hash of all enabled entry content (detect card update)
    npcCount: 24,
    floorCount: 99,
    timelineEventCount: 350,
    rulesCount: 5,
}
```

**Check logic**:
```javascript
function runLorebookPreParser(entries) {
    const store = getStore();
    if (!store) return;

    // Already parsed?
    if (store.loreParsed?.version === CURRENT_LORE_PARSER_VERSION) {
        // Check if card content changed (user updated the card)
        const currentHash = computeEntriesHash(entries);
        if (store.loreParsed.entryHash === currentHash) {
            log('Lore pre-parser: already parsed, skipping');
            return;
        }
        log('Lore pre-parser: card content changed, re-parsing');
    }

    // Run parsers...
    // Disable entries...
    // Set flag...
}
```

**Why hash the entries**: If the user updates the card (e.g. adds a new NPC), the hash changes, triggering re-parse. This handles "card drift" (§9.I).

### 7.3 Avoiding Re-Parse on Every Load

The `loreParsed` flag is persisted in `chatMetadata` (via `saveStore()`). On subsequent `CHAT_CHANGED` events for the same chat, the flag is found and parsing is skipped. The hash check ensures correctness if the card is updated.

---

## 8. Tool Impact (Section E)

### 8.1 Existing Tool Analysis

| Tool | Current Data Source | After Pre-Parser | Change Needed? |
|---|---|---|---|
| `get_character_info` | npcStore first, world book fallback | npcStore (populated by pre-parser) | **No** — already tries npcStore first (`sao-tools.js:325`). Will find data. |
| `get_floor_info` | floorStore first, world book fallback | floorStore (populated by pre-parser) | **No** — already tries floorStore first (`sao-tools.js:369`). Will find data. |
| `get_calendar` | calendarStore + queryTimeline | calendarStore (pre-populated) | **No** — already reads calendarStore. |
| `get_world_setting` | worldStore.rules | worldStore.rules (populated by pre-parser) | **No** — already reads rules. Will now return real data. |
| `search_world_book` | Direct world book scan | World book scan (entries still accessible) | **No** — reads from `char.data.character_book.entries` directly. Disabled entries are still in the array, just with `enabled: false`. |

### 8.2 Gap Analysis

**Potential gap**: `get_character_info` (`sao-tools.js:305-347`) falls back to `getCharacterInfoFromSources()` which scans the world book. After pre-parser, the npcStore will be populated, so the fallback won't be needed for SAO-arc characters. But for characters in **other arcs** (ALO, GGO) that aren't parsed, the fallback still works because:
1. Other-arc entries are already disabled (not injected), but...
2. `search_world_book` scans ALL entries regardless of `enabled` flag.
3. `getCharacterInfoFromSources` also scans ALL entries.

**No gap**: All tools will return data correctly after pre-parser.

### 8.3 Tool Enhancement Opportunity (Optional, Future)

`get_world_setting` currently accepts a fixed `topic` enum: `['death_game', 'economy', 'pk', 'combat', 'skills', 'leveling', 'housing', 'environment']`. After pre-parser populates `worldStore.rules` with actual content, consider:
- Expanding the enum to include `npc_rules`, `meditation`.
- Adding a `list_topics` action to discover available topics.
- **Not in scope** for this design — the existing enum covers the pre-parser's topics.

---

## 9. Card Modification vs Runtime Disable (Section F)

### 9.1 Option A: Edit the Card JSON (Not Recommended)

**Approach**: Modify `2.0.0_extracted.json` to set `enabled: false` on data entries.

**Pros**:
- Permanent — entries stay disabled across all tools/sessions.
- No runtime overhead.

**Cons**:
- **Card drift**: If the user regenerates or updates the card, edits are lost.
- **Version control**: Card file becomes a fork, diverging from upstream.
- **User confusion**: "Why are entries disabled in my card?"
- **Irreversible without backup**: Hard to restore if something goes wrong.

### 9.2 Option B: Runtime Disable (Recommended)

**Approach**: Plugin sets `entry.enabled = false` on in-memory entry objects at chat load time. Same pattern as `MIGRATED_SCRIPTS` (`index.js:376-383`) and `enableCardRegex` (`index.js:388-443`).

**Pros**:
- **No card modification**: Card file stays pristine.
- **Reversible**: Entries restore on plugin deactivation (ST reloads from file).
- **Safe**: If plugin crashes, next load starts fresh.
- **Consistent**: Same pattern already used for regex scripts.

**Cons**:
- **Per-chat**: Must run on each chat load (but idempotent, fast).
- **In-memory only**: If ST saves chat metadata before disable runs, the entries are briefly injected on first message. **Mitigation**: Run pre-parser in CHAT_CHANGED, which fires before first message.

### 9.3 Recommendation

**Use Option B (runtime disable)**. It is safer, reversible, and follows the existing pattern established by `MIGRATED_SCRIPTS`.

**Implementation**:
```javascript
function disableParsedEntries(entries, parsedCategories) {
    let disabled = 0;
    for (const entry of entries) {
        if (shouldDisable(entry, parsedCategories)) {
            entry.enabled = false;
            disabled++;
        }
    }
    return disabled;
}

function shouldDisable(entry, parsedCategories) {
    if (entry.constant) return false;  // Never disable const
    if (entry.enabled === false) return false;  // Already disabled

    const comment = (entry.comment || '').trim();
    const content = entry.content || '';

    // Character profiles
    if (parsedCategories.npc && content.includes('characterProfile')) return true;

    // Floor entries
    if (parsedCategories.floor && /第\d+层/.test(comment)) return true;

    // Timeline entries
    if (parsedCategories.timeline && /^\d{4}年\d{1,2}月/.test(comment)) return true;

    // World rules (only if we parsed them)
    if (parsedCategories.rules) {
        const RULE_COMMENTS = ['sao-PK机制', 'sao-经济系统', 'sao-等级', 'sao-技能', 'sao-剑技获取', 'sao-冥想', 'sao-房屋'];
        if (RULE_COMMENTS.some(r => comment.includes(r))) return true;
    }

    return false;
}
```

---

## 10. Migration & Rollback (Section G)

### 10.1 Existing Chats (Pre-Parser Migration)

**Scenario**: User has existing chats with `npcStore`, `floorStore`, `calendarStore` data from the old init path (which only parsed a subset of entries).

**Migration strategy**:
1. Pre-parser checks `loreParsed.version`. If absent, this is a pre-parser chat.
2. Pre-parser runs full parse, merging with existing store data.
3. Existing store data takes precedence (user's runtime observations > canon data).
4. Pre-parser only writes canon fields (`npc.canon`, `floor.canon`), never overwriting `state` or `observations`.

**Specific merge logic**:
- **npcStore**: `initNpcFromWorldBook` already handles this — it checks `_canonHash` and only updates `canon` if hash changed. Existing `state` and `observations` are preserved.
- **floorStore**: `initFloorFromWorldBook` already handles this — same `_canonHash` pattern.
- **calendarStore**: Pre-parser adds canon events. Existing `appointments` and custom events are preserved. Canon events are deduplicated by normalized title.
- **worldStore.rules**: Pre-parser writes to `rules[topic]`. If topic already exists (from a previous manual write or specialist), skip unless hash changed.

### 10.2 Rollback

**If pre-parser corrupts data**:

1. **Immediate rollback**: Set `loreParsed.version = 0` in chatMetadata. On next CHAT_CHANGED, pre-parser will re-run.
2. **Nuclear rollback**: Delete `chatMetadata[MODULE_NAME].loreParsed`. Pre-parser treats this as "never parsed" and runs fresh.
3. **Store reset**: Use existing `resetStore()` (`sao-store-core.js:250-262`). This clears all stores to defaults. Pre-parser re-populates on next load.
4. **Card rollback**: Re-enable entries manually in ST's world book editor. The pre-parser respects `entry.enabled` — if user manually enables an entry, pre-parser won't re-disable it (it only disables entries it successfully parsed).

**Rollback does NOT require card file modification** — all changes are in chatMetadata (runtime state).

---

## 11. Testing Strategy (Section H)

### 11.1 Unit Tests (per category)

| Test | Input | Assert |
|---|---|---|
| `parseCharacterProfiles` | 24 profile entries | npcStore.byId has 24 entries, each with `canon.characterName` |
| `parseFloorEntries` | 99 floor entries | floorStore.byId has 99+ entries (99 world book + stubs), each with `canon.theme` |
| `parseTimelineEntries` | 44 timeline entries | calendarStore.events has events on correct dates, no duplicates |
| `parseWorldRules` | 8 rule entries | worldStore.rules has 8 topics with non-empty content |
| `disableParsedEntries` | Mixed entries | Correct entries disabled, const/hybrid kept enabled |
| `computeEntriesHash` | Deterministic input | Same input → same hash; different input → different hash |

### 11.2 Integration Tests

| Test | Description |
|---|---|
| Full parse of 182 entries | Run pre-parser on all 182 enabled entries. Verify: 24 NPCs, 99 floors, ~350 timeline events, 8 rules. |
| Idempotency | Run pre-parser twice. Second run should be no-op (flag check). Verify stores unchanged. |
| Card update detection | Modify one entry's content, re-run. Verify only that entry's store data updated. |
| Merge with existing data | Pre-populate npcStore with runtime data (observations, state). Run pre-parser. Verify runtime data preserved. |
| Tool integration | After pre-parser, call `get_character_info('桐人')`. Verify returns npcStore data, not world book fallback. |

### 11.3 Regression Tests

- All existing 416 tests must pass unchanged.
- `store.test.js`, `store-init.test.js` — verify store structure unchanged.
- `calendar.test.js` — verify calendar behavior unchanged (pre-parser writes to same store).
- `prompt.test.js` — verify prompt cleaning unchanged.

### 11.4 Manual Testing Checklist

1. Open existing SAO chat → verify pre-parser logs count of parsed entries.
2. Open new SAO chat → verify pre-parser runs, stores populated.
3. Call `get_character_info('桐人')` → verify returns rich profile.
4. Call `get_floor_info(1)` → verify returns floor data.
5. Call `get_calendar({month: '2022-11'})` → verify returns timeline events.
6. Call `get_world_setting({topic: 'pk'})` → verify returns PK rules.
7. Check ST's world book editor → verify data entries show as disabled.
8. Send a message → verify LLM uses tool calls instead of injected lore.

---

## 12. Risks (Section I)

### 12.1 Data Integrity

**Risk**: Parser mis-extracts data → wrong NPC/floor data in stores.

**Mitigation**:
- Character profiles are **pure JSON** — parsing is deterministic (JSON.parse). Risk is near-zero.
- Floor entries with `worldbook-data` JSON are also deterministic. Entries without JSON use regex, which could mis-extract. **Fallback**: Keep `rawContent` in floorStore for manual review.
- Timeline entries use regex on structured markdown. Edge cases (nested bullets, multi-line events) may cause mis-extraction. **Fallback**: `queryTimeline` still reads from world book as fallback.

### 12.2 Performance

**Risk**: Parsing 182 entries on every chat load is slow.

**Mitigation**:
- Most entries are skipped (already disabled, or hash unchanged).
- JSON parsing is O(n) where n = content length. Total content ~270KB → <10ms.
- Regex extraction for timeline ~44 entries × ~2KB = ~88KB → <50ms.
- **Estimated total**: <100ms on modern hardware. Acceptable for a one-time chat-load operation.
- The `loreParsed` flag ensures this only runs once per chat (unless card changes).

### 12.3 Card Drift

**Risk**: Card is updated (new entries, changed content) but pre-parser uses stale data.

**Mitigation**:
- `entryHash` in `loreParsed` detects content changes.
- On hash mismatch, pre-parser re-runs full parse.
- New entries (not in previous hash) trigger re-parse.
- **Edge case**: If user adds entries to the card *after* pre-parser ran, those entries won't be in the store until next chat load (which triggers re-parse due to hash change).

### 12.4 Store Size

**Risk**: Pre-parser adds ~270KB of content to chatMetadata, bloating store.

**Mitigation**:
- `npcStore` canon data is ~75KB (24 profiles × ~3KB each). Already partially populated by existing init.
- `floorStore` canon data is ~99KB (99 floors × ~1KB each). Already partially populated.
- `calendarStore` events: ~44 entries × ~1.5KB = ~66KB. Already partially populated by `initCalendarIfNeeded`.
- `worldStore.rules`: ~8 entries × ~2KB = ~16KB. New addition.
- **Net new data**: ~50-80KB (incremental over existing). Within the 200KB warning threshold.
- The disabled entries save ~270KB of prompt tokens per turn — a massive net win.

### 12.5 Interaction with Existing Init

**Risk**: Pre-parser conflicts with existing `initNpcFromWorldBook` / `initFloorFromWorldBook` calls.

**Mitigation**:
- Pre-parser should **replace** the existing init calls, not add to them.
- Move `initNpcFromWorldBook`, `initFloorFromWorldBook`, `ensureAllFloorsExist` into the pre-parser function.
- This eliminates the duplicate scan of entries (currently: pre-classification loop + init function loop = 2 passes).

---

## 13. Phased Implementation Plan (Section J)

### Phase 1: Character Profiles (Safest, Clearest)

**Scope**: Parse 24 character profile entries into npcStore.

**Files changed**:
- `sao-preparser.js` (NEW) — `parseCharacterProfiles(entries)` function
- `index.js` — Call `parseCharacterProfiles` in CHAT_CHANGED, after existing `initNpcFromWorldBook`

**Why start here**: Character profiles are pure JSON — parsing is deterministic and well-understood. The existing `initNpcFromWorldBook` already does this. The pre-parser version simply calls it with ALL entries (not just pre-filtered).

**Test**: Unit test verifying 24 NPCs parsed with correct `canon.characterName`.

**Estimated effort**: 1-2 hours.

### Phase 2: Floor Settings

**Scope**: Parse 99 floor entries into floorStore.

**Files changed**:
- `sao-preparser.js` — `parseFloorEntries(entries)` function
- `index.js` — Call `parseFloorEntries` in CHAT_CHANGED

**Why second**: Floor entries are semi-structured (markdown + JSON fence). The existing `initFloorFromWorldBook` already handles this. Pre-parser version calls it with ALL entries.

**Test**: Unit test verifying 99 floors parsed with `canon.theme` populated for entries with `worldbook-data`.

**Estimated effort**: 1-2 hours.

### Phase 3: Timeline Events

**Scope**: Parse 44 timeline entries into calendarStore.events.

**Files changed**:
- `sao-preparser.js` — `parseTimelineEntries(entries)` function (NEW parser)
- `sao-calendar.js` — Modify `initCalendarIfNeeded` to check `loreParsed.timeline` flag
- `index.js` — Call `parseTimelineEntries` in CHAT_CHANGED

**Why third**: Timeline parsing requires a new regex parser (the existing `_filterTimelineEntries` reads from world book at runtime, not from a pre-parsed store). This is the most complex new code.

**Test**: Unit test verifying events on known dates (e.g. 2022-11-06 has "SAO开服" event).

**Estimated effort**: 3-4 hours.

### Phase 4: World Rules

**Scope**: Parse 8 rule entries into worldStore.rules.

**Files changed**:
- `sao-preparser.js` — `parseWorldRules(entries)` function
- `index.js` — Call `parseWorldRules` in CHAT_CHANGED

**Why fourth**: World rules are the least structured (prose in `<directive>` tags). The parser is simple (topic mapping + content extraction) but requires careful testing to ensure `get_world_setting` returns useful data.

**Test**: Unit test verifying `worldStore.rules.pk` contains PK rules text.

**Estimated effort**: 1-2 hours.

### Phase 5: Enable Strategy Change

**Scope**: Disable parsed entries in the lorebook. Consolidate pre-parser into single `runLorebookPreParser()` function.

**Files changed**:
- `sao-preparser.js` — Add `disableParsedEntries()` and orchestration
- `index.js` — Replace individual init calls with single `runLorebookPreParser()` call

**Why last**: This is the "switch flip" — after this phase, the LLM relies on tool calls instead of injected lore. All parsers must be validated first.

**Test**: Integration test verifying 172 entries disabled, 10 remain enabled. Manual test verifying LLM uses tool calls.

**Estimated effort**: 2-3 hours.

### Phase 6: Cleanup & Optimization

**Scope**: Remove redundant code paths, optimize store size.

**Files changed**:
- `index.js` — Remove old pre-classification loop (lines 556-567), consolidate into pre-parser
- `sao-calendar.js` — Remove lazy timeline extraction from `initCalendarIfNeeded` (now handled by pre-parser)
- `sao-tools.js` — Remove world book fallback from `getCharacterInfoFromSources` and `getFloorInfo` (now guaranteed to be in stores)

**Estimated effort**: 2-3 hours.

---

## 14. File Structure

```
sao-companion/
├── sao-preparser.js          ← NEW: Pre-parser orchestration
│   ├── runLorebookPreParser(entries)
│   ├── parseCharacterProfiles(entries)   → npcStore
│   ├── parseFloorEntries(entries)        → floorStore
│   ├── parseTimelineEntries(entries)     → calendarStore
│   ├── parseWorldRules(entries)          → worldStore.rules
│   ├── disableParsedEntries(entries, results)
│   ├── computeEntriesHash(entries)
│   └── shouldDisableEntry(entry, categories)
├── sao-store-npc.js          ← UNCHANGED (reuse initNpcFromWorldBook)
├── sao-store-floor.js        ← UNCHANGED (reuse initFloorFromWorldBook)
├── sao-store-world.js        ← MINOR: Add _rulesHashes field to ensureWorldStore
├── sao-store-core.js         ← MINOR: Add loreParsed to DEFAULT_STORE
├── sao-calendar.js           ← MODERATE: Add loreParsed check in initCalendarIfNeeded
├── sao-tools.js              ← UNCHANGED (tools already read from stores)
├── index.js                  ← MODERATE: Replace old init with pre-parser call
└── test/
    ├── preparser.test.js     ← NEW: Unit tests for pre-parser
    └── ...existing tests...
```

---

## 15. Open Questions

1. **Mechanic rules injection**: Should `sao-PK机制`, `sao-经济系统`, `sao-等级` stay injected (Phase 5) or move to tool-call only? Recommendation: keep injected for Phase 5, evaluate token savings in Phase 6.

2. **Other-arc entries**: The pre-parser only handles SAO-arc entries (24 profiles, 99 floors). ALO/GGO/现实 entries are already disabled. Should the pre-parser also parse them for multi-arc support? Recommendation: defer to future work — the user's current scope is SAO arc.

3. **Timeline granularity**: Should the parser extract every sub-bullet event, or only top-level items? Recommendation: top-level items only (keeps calendar manageable). Sub-bullets are context for the LLM, not discrete events.

4. **Entry hash algorithm**: Should we hash ALL 302 entries (including disabled) or only the 182 enabled? Recommendation: only enabled entries — disabled entries are irrelevant to the pre-parser.

---

## 16. Success Criteria

1. **Token savings**: After pre-parser, only ~10 entries are injected (down from 182). Estimated savings: ~250KB of prompt tokens per turn.
2. **Tool coverage**: All 5 tools return meaningful data (no more "暂无数据" for world rules).
3. **Regression**: All 416 existing tests pass.
4. **Idempotency**: Pre-parser runs once per chat, not on every load.
5. **Reversibility**: Disabling the plugin restores all entries to their original enabled state.
