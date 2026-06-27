# Battle State Snapshot Tests (P4a-prereq)

## Purpose
Capture battleState before/after each C-class function call to create a regression baseline for Core extraction verification.

**Target C-class functions:**
- `performEnemyAction` — enemy takes its turn
- `executeTeammateAttackSequence` — teammate performs attack chain
- `startNextRound` — new round begins (reset cooldowns, advance round counter)
- `moveToNextAction` — advance to next entity in action order

## How it works

The script uses two capture strategies:
1. **Module-level** (preferred): If `battleLogic.js` is accessible via dynamic import, uses `serializeBattleState()` for deep snapshots including all player/enemy stats, buffs, action order, and hate lists.
2. **DOM-level** (fallback): Reads current HP/MP/AP bars, enemy cards, and action order from the battle panel's Shadow DOM.

All snapshots include timestamp, label, and capture source for traceability.

## Prerequisites
- SillyTavern running with SAO Companion extension active
- A battle panel visible in the chat (start a combat scenario)

## Usage

### 1. Load the scaffold
Open browser DevTools console (F12 → Console), then paste the entire contents of `snapshotTest.js`.

The script will report whether module-level access was obtained:
```
[SAO Snapshot] Test scaffold loaded. Module access: YES  ← best case
[SAO Snapshot] Test scaffold loaded. Module access: NO   ← DOM-only fallback
```

### 2a. Manual capture (recommended for targeted tests)

Capture before and after each C-class function call by manually triggering actions:

```javascript
// Before clicking an attack that triggers performEnemyAction:
SAO_BATTLE_SNAPSHOT.before('performEnemyAction')
// ... click attack, wait for animation to finish ...
SAO_BATTLE_SNAPSHOT.after('performEnemyAction')

// Before round transition:
SAO_BATTLE_SNAPSHOT.before('startNextRound')
// ... trigger round end ...
SAO_BATTLE_SNAPSHOT.after('startNextRound')

// Same pattern for executeTeammateAttackSequence and moveToNextAction
```

### 2b. Auto capture (recommended for full round coverage)

```javascript
SAO_BATTLE_SNAPSHOT.startAutoCapture()
// Play through a complete battle round (all 4 C-class functions will fire)
// Snapshots are captured automatically on DOM mutations (debounced 500ms)
SAO_BATTLE_SNAPSHOT.stopAutoCapture()
```

### 2c. Polling-based capture

Polls the battle state at regular intervals. Only stores snapshots when state actually changes (deduplicated). Good for unattended capture during a full battle:

```javascript
SAO_BATTLE_SNAPSHOT.startPolling(1000)  // poll every 1 second
// Play through a complete battle round
SAO_BATTLE_SNAPSHOT.stopPolling()
```

**Note:** Polling interval is in milliseconds. Lower values capture more granular changes but generate more snapshots.

### 3. Review and export

```javascript
// Lightweight overview
SAO_BATTLE_SNAPSHOT.summary()

// Full JSON (also copies to clipboard)
SAO_BATTLE_SNAPSHOT.export()

// Download as file
SAO_BATTLE_SNAPSHOT.download('my-test-run.json')

// Count
SAO_BATTLE_SNAPSHOT.count()

// Clear for next run
SAO_BATTLE_SNAPSHOT.clear()
```

## Fixture format

The exported JSON has this structure:

```json
{
  "meta": {
    "exportedAt": "2025-01-01T00:00:00.000Z",
    "totalSnapshots": 8,
    "cClassFunctions": ["performEnemyAction", "executeTeammateAttackSequence", "startNextRound", "moveToNextAction"],
    "captureSource": "module+dom"
  },
  "snapshots": [
    {
      "index": 0,
      "label": "BEFORE: performEnemyAction",
      "hookName": "manual",
      "timestamp": 1735689600000,
      "source": "module",
      "battleState": {
        "isActive": true,
        "round": 1,
        "player": { "hp": 500, "maxHp": 500, "mp": 200, "maxMp": 200, ... },
        "enemies": [ { "id": "e1", "name": "Goblin", "hp": 100, "maxHp": 100, ... } ],
        "actionOrder": [ { "type": "player", "name": "User", "speed": 15 }, ... ],
        "currentActionIndex": 0,
        "playerBuffs": [],
        ...
      },
      "dom": {
        "player": { "hp": { "current": 500, "max": 500 }, "mp": { "current": 200, "max": 200 } },
        "enemies": [ { "index": 0, "name": "Goblin", "hp": { "current": 100, "max": 100 }, "selected": true } ],
        "actionOrder": [ { "name": "User", "speed": "15", "type": "player", "isCurrent": true } ],
        "round": 1
      }
    }
  ]
}
```

## After Core Extraction

1. Run the same battle scenario through the Core version of the 4 functions
2. Capture snapshots with the same labels
3. Compare the two JSON fixtures:
   - `battleState` fields should match (player HP/MP, enemy HP, action order, round number)
   - Any difference indicates a Core extraction regression

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No battle panel Shadow DOM found" | Start a battle first — the panel must be visible |
| Module access: NO | Normal — DOM-only mode still works; snapshots will have `dom` field only |
| Snapshot fields are null | Panel may not have rendered yet; wait a moment after battle starts |
| Auto-capture too noisy | Increase `DEBOUNCE_MS` in the script (default 500ms) |
