# Lorebook Pre-Parser — Deepwork Progress

## Confirmed Research Findings

### #1 injectMemoryAndState injected text (sao-prompt.js:83-132)
The injected prompt (`sao_companion_inject` extension prompt) contains:
- `formatCompactState(data.state)` OR `projectFullState()` (when toolSupported) — the state projection text
- `[章节]<arc>`
- `[日期]<currentDate>` (from calendarStore)
- When toolSupported: a "## 可用工具" block listing 5 tools + instruction "需要详细信息时优先调用工具而非猜测"
- When toolSupported + currentDate: "[日历/原作时间线]不要猜测原作时间线或当前日程；需要查询某日、某月或范围事件时调用 get_calendar。"

NOTE: There is NO instruction forbidding the AI from echoing the injected state text back as a [玩家状态] block. The state projection (projectCompactState/projectFullState) returns formatted status text — the AI may echo it verbatim. Bug #2 (duplicate status block) likely stems from this.

### #2 Item card format root cause
Explorer found: NO enabled entry contains the `==========【物品获得】==========` card format. Only DISABLED entry #82 (sao-道具系统) has it. The AI is HALLUCINATING the card format from legacy patterns. Fix: add explicit prohibition to ENABLED entry #237 (标签输出与数值委托协议) — reinforce tag-only output, forbid card display in narrative.

### #3 Pre-parser design
Oracle design doc written to `.slim/deepwork/lorebook-preparser-design.md`. Key decisions:
- Runtime disable (not card edit) — same pattern as MIGRATED_SCRIPTS
- Reuse existing initNpcFromWorldBook / initFloorFromWorldBook for phases 1-2
- New parsers needed for timeline (phase 3) and world rules (phase 4)
- 6 phases, ~10-15 hours total
- 182 enabled → ~10 enabled after phase 5 (saves ~250KB prompt tokens/turn)
