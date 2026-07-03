#!/usr/bin/env node
'use strict';

/**
 * fix-false-disabled-and-format.js
 *
 * Fixes two card-level bugs discovered during worldbook audit:
 *
 * Bug A (CRITICAL — root cause of tools not being called):
 *   SillyTavern checks `entry.disable` (world-info.js:3259 `const isActive = !entry.disable`),
 *   NOT `entry.enabled`. 120 entries were "disabled" via `enabled=false` but have
 *   `disable!==true`, so ST still injects them every prompt. 49 of them are
 *   `constant=true` (always-on), including 10 old format variants that all tell the
 *   LLM to call the non-existent `get_player_status` tool and contradict each other.
 *
 *   Fix: set `disable=true` on every entry where `enabled===false && disable!==true`.
 *
 * Bug B (sao-格式 internal contradiction + fake tool name):
 *   The single active format entry `sao-格式（去掉<map><npc_thoughts><guild>）` tells the
 *   LLM (a) in its Specialist Architecture section "don't output user_status/npc_status/
 *   calendar/zd_status/digest/guild/action", but (b) in its Module Rules section every one
 *   of those tags "Must be in every reply" — a direct contradiction. It also references
 *   the non-existent tool `get_player_status`.
 *
 *   Fix: rewrite the tool-reference line, fix the EXECUTION PATH string, and delete the
 *   stale Module Rules blocks for user_status/npc_status/calendar/action/zd_status/digest
 *   (keeping only the <content> rules).
 *
 * Backs up PNG to 2.0.0.before_false_disabled_fix.png before writing.
 * Writes compact JSON (no spaces) to both PNG tEXt chunks (chara + ccv3) and the
 * extracted working JSON. Verifies after write.
 */

const fs = require('fs');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_false_disabled_fix.png';

const FORMAT_ENTRY_COMMENT = 'sao-格式（去掉<map><npc_thoughts><guild>）';

// ── PNG helpers (CRC32, chunk read/write) ──────────────────────────────
const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngChunks(filePath) {
    const buf = fs.readFileSync(filePath);
    if (!buf.slice(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Invalid PNG signature');
    }
    let offset = 8;
    const chunks = [];
    while (offset < buf.length) {
        if (offset + 8 > buf.length) break;
        const length = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        const data = Buffer.from(buf.slice(offset + 8, offset + 8 + length));
        chunks.push({ type, data });
        offset = offset + 8 + length + 4;
        if (type === 'IEND') break;
    }
    return chunks;
}

function buildTextChunkData(keyword, text) {
    const keyBuf = Buffer.from(keyword, 'latin1');
    const textBuf = Buffer.from(text, 'latin1');
    return Buffer.concat([keyBuf, Buffer.from([0]), textBuf]);
}

function buildPng(chunks) {
    const parts = [PNG_SIGNATURE];
    for (const chunk of chunks) {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.data.length, 0);
        const typeBuf = Buffer.from(chunk.type, 'ascii');
        const crcInput = Buffer.concat([typeBuf, chunk.data]);
        const crcVal = crc32(crcInput);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crcVal, 0);
        parts.push(lenBuf, typeBuf, chunk.data, crcBuf);
    }
    return Buffer.concat(parts);
}

function findTextChunk(chunks, keyword) {
    return chunks.find(c => {
        if (c.type !== 'tEXt') return false;
        const ni = c.data.indexOf(0);
        return ni !== -1 && c.data.slice(0, ni).toString('latin1') === keyword;
    });
}

function decodeTextChunkData(chunk) {
    const text = chunk.data.slice(chunk.data.indexOf(0) + 1).toString('latin1');
    return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
}

// ── sao-格式 content rewrite ────────────────────────────────────────────

function rewriteFormatEntry(content) {
    let out = content;

    // --- Replace 1: tool-reference lines (Specialist Architecture section) ---
    const oldToolLines =
        '> 你的职责仅限于 `<content>` 内的叙事正文。游戏状态由系统注入你的上下文（紧凑状态摘要 + 工具查询）。\n' +
        '> 如需查询游戏状态（HP/装备/日历等），使用 `get_player_status` / `get_calendar` 工具。';
    const newToolLines =
        '> 你的职责仅限于 `<content>` 内的叙事正文。玩家状态（HP/装备/技能/背包/珂尔等）由系统每轮自动注入你的上下文，无需查询。\n' +
        '> 如需查询楼层/NPC/日历/世界设定/世界书，使用 get_floor_info / get_character_info / get_calendar / get_world_setting / search_world_book 工具。';
    if (!out.includes(oldToolLines)) {
        throw new Error('Replace 1 failed: tool-reference lines not found verbatim');
    }
    out = out.replace(oldToolLines, newToolLines);

    // --- Replace 2: EXECUTION PATH string inside <output_instruction> ---
    const oldPath = '[EXECUTION PATH]: [time] -> [dice] -> [Narrative] -> [user_status] -> [npc_status] -> [calendar] -> [action] -> [zd_status] -> [digest]';
    const newPath = '[EXECUTION PATH]: [time] -> [dice] -> [Narrative]';
    if (!out.includes(oldPath)) {
        throw new Error('Replace 2 failed: EXECUTION PATH string not found verbatim');
    }
    out = out.replace(oldPath, newPath);

    // --- Replace 3: delete stale Module Rules blocks for user_status..digest ---
    // Use indexOf (string literals handle backticks fine; regex literals do not).
    // The block starts at "\n\n*   **`<user_status>`**:" and ends right after the
    // <digest> block's "Must be in every reply.\n". We keep one leading "\n" so the
    // result is "Embedding line.\n\n---" (blank line preserved before the ---).
    const startMarker = '\n\n*   **`<user_status>`:**';
    const startIdx = out.indexOf(startMarker);
    if (startIdx < 0) {
        throw new Error('Replace 3 failed: start marker not found');
    }
    const digestMarker = '*   **`<digest>`:**';
    const dIdx = out.indexOf(digestMarker); // only one occurrence (Module Rules block)
    if (dIdx < 0) {
        throw new Error('Replace 3 failed: digest marker not found');
    }
    const endStr = 'Must be in every reply.\n';
    const endIdx = out.indexOf(endStr, dIdx);
    if (endIdx < 0) {
        throw new Error('Replace 3 failed: digest Must-be line not found');
    }
    const endPos = endIdx + endStr.length;
    // Keep the leading "\n" at startIdx (so "Embedding.\n\n---" stays), delete the rest.
    out = out.substring(0, startIdx + 1) + out.substring(endPos);

    // Safety: no get_player_status reference should remain
    if (out.includes('get_player_status')) {
        throw new Error('Post-check failed: get_player_status still present in content');
    }
    // Safety: none of the stale "Must be in every reply" lines for status tags should remain
    if (out.includes('**`<user_status>`:**') || out.includes('**`<digest>`:**')) {
        throw new Error('Post-check failed: stale status block markers still present');
    }

    return out;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== fix-false-disabled-and-format ===\n');

    // (1) Read and decode PNG
    console.log('Reading PNG...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    const chunks = readPngChunks(PNG_PATH);
    console.log(`  PNG chunks: ${chunks.length}`);

    let charaIdx = -1;
    let ccv3Idx = -1;
    for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].type === 'tEXt') {
            const nullIdx = chunks[i].data.indexOf(0);
            if (nullIdx !== -1) {
                const keyword = chunks[i].data.slice(0, nullIdx).toString('latin1');
                if (keyword === 'chara') charaIdx = i;
                if (keyword === 'ccv3') ccv3Idx = i;
            }
        }
    }
    console.log(`  chara chunk: ${charaIdx}, ccv3 chunk: ${ccv3Idx}`);
    if (charaIdx === -1 || ccv3Idx === -1) {
        throw new Error('chara or ccv3 tEXt chunk not found in PNG');
    }

    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // (2) Bug A: fix false-disabled entries
    const entries = obj.data?.character_book?.entries || [];
    console.log(`\nTotal entries: ${entries.length}`);

    let fixedDisabled = 0;
    let alreadyOk = 0;
    const fixedList = [];
    for (const entry of entries) {
        if (entry.enabled === false && entry.disable !== true) {
            entry.disable = true;
            fixedDisabled++;
            fixedList.push((entry.comment || '(no comment)').trim());
        } else if (entry.disable === true) {
            alreadyOk++;
        }
    }
    console.log(`  False-disabled entries fixed (disable=true): ${fixedDisabled}`);
    console.log(`  Already disable=true: ${alreadyOk}`);
    if (fixedDisabled === 0) {
        console.log('  No false-disabled entries found — Bug A already fixed.');
    }

    // (3) Bug B: rewrite sao-格式 entry content
    console.log(`\nRewriting format entry: ${FORMAT_ENTRY_COMMENT}`);
    let formatEntry = null;
    for (const entry of entries) {
        if ((entry.comment || '').trim() === FORMAT_ENTRY_COMMENT) {
            formatEntry = entry;
            break;
        }
    }
    if (!formatEntry) {
        throw new Error(`Format entry not found: ${FORMAT_ENTRY_COMMENT}`);
    }
    const beforeLen = (formatEntry.content || '').length;
    formatEntry.content = rewriteFormatEntry(formatEntry.content || '');
    const afterLen = formatEntry.content.length;
    console.log(`  Content length: ${beforeLen} -> ${afterLen} (delta ${afterLen - beforeLen})`);

    // (4) Backup PNG (only if not already backed up)
    console.log('\nBacking up PNG...');
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH} (leaving as-is)`);
    }

    // (5) Write back to PNG (compact JSON)
    console.log('\nWriting updated PNG...');
    const compactJson = JSON.stringify(obj);
    console.log(`  Compact JSON length: ${compactJson.length} bytes`);

    const newBase64 = Buffer.from(compactJson, 'utf8').toString('base64');
    console.log(`  Base64 length: ${newBase64.length} bytes`);

    const charaTextData = buildTextChunkData('chara', newBase64);
    const ccv3TextData = buildTextChunkData('ccv3', newBase64);
    chunks[charaIdx] = { type: 'tEXt', data: charaTextData };
    chunks[ccv3Idx] = { type: 'tEXt', data: ccv3TextData };

    const newPng = buildPng(chunks);
    console.log(`  New PNG size: ${newPng.length} bytes (${(newPng.length / 1024).toFixed(1)} KB)`);
    console.log(`  Size change: ${newPng.length - originalPngBuf.length} bytes`);

    const tmpPath = PNG_PATH + '.tmp';
    try {
        fs.writeFileSync(tmpPath, newPng);
        fs.renameSync(tmpPath, PNG_PATH);
    } catch (err) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        }
        throw err;
    }
    console.log(`  ✓ Wrote ${PNG_PATH} atomically`);

    // (6) Sync extracted JSON
    console.log('\nUpdating extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // (7) Verification
    console.log('\n=== Verification ===');
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyCharaChunk = findTextChunk(verifyChunks, 'chara');
    if (!verifyCharaChunk) throw new Error('Verify failed: chara tEXt chunk not found');
    const verifyObj = decodeTextChunkData(verifyCharaChunk);
    const verifyEntries = verifyObj.data?.character_book?.entries || [];
    console.log(`  Total entries in PNG: ${verifyEntries.length}`);

    // Verify A: count entries still false-disabled (should be 0)
    let stillFalse = 0;
    for (const entry of verifyEntries) {
        if (entry.enabled === false && entry.disable !== true) stillFalse++;
    }
    console.log(`  Entries still false-disabled (enabled=false && disable!==true): ${stillFalse}`);
    if (stillFalse > 0) {
        throw new Error(`Verify A failed: ${stillFalse} entries still false-disabled`);
    }
    console.log('  ✓ All false-disabled entries now have disable=true');

    // Verify A2: total disable=true count
    const totalDisabled = verifyEntries.filter(e => e.disable === true).length;
    console.log(`  Total disable=true entries: ${totalDisabled}`);

    // Verify B: format entry content
    let verifyFormat = null;
    for (const entry of verifyEntries) {
        if ((entry.comment || '').trim() === FORMAT_ENTRY_COMMENT) {
            verifyFormat = entry;
            break;
        }
    }
    if (!verifyFormat) throw new Error('Verify B failed: format entry not found after write');
    if (verifyFormat.content.includes('get_player_status')) {
        throw new Error('Verify B failed: get_player_status still in format entry');
    }
    if (verifyFormat.content.includes('**`<user_status>`:**')) {
        throw new Error('Verify B failed: stale <user_status> block still present');
    }
    if (!verifyFormat.content.includes('get_floor_info / get_character_info / get_calendar / get_world_setting / search_world_book')) {
        throw new Error('Verify B failed: real tool list not in content');
    }
    if (!verifyFormat.content.includes('[EXECUTION PATH]: [time] -> [dice] -> [Narrative]')) {
        throw new Error('Verify B failed: trimmed EXECUTION PATH not in content');
    }
    console.log('  ✓ Format entry content verified (no fake tool, no stale blocks, real tools listed)');

    // Verify PNG signature
    const verifyBuf = fs.readFileSync(PNG_PATH);
    if (!verifyBuf.slice(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Verify failed: PNG has invalid signature');
    }
    console.log('  ✓ PNG signature valid');

    // Verify chara and ccv3 consistency
    const verifyCcv3Chunk = findTextChunk(verifyChunks, 'ccv3');
    if (!verifyCcv3Chunk) throw new Error('Verify failed: ccv3 tEXt chunk not found');
    const verifyCcv3Obj = decodeTextChunkData(verifyCcv3Chunk);
    if (JSON.stringify(verifyObj) !== JSON.stringify(verifyCcv3Obj)) {
        throw new Error('Verify failed: chara and ccv3 JSON differ');
    }
    console.log('  ✓ chara and ccv3 JSON are consistent');

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Backup: ${BAK_PATH}`);
    console.log(`False-disabled entries fixed: ${fixedDisabled}`);
    console.log(`Format entry rewritten: ${beforeLen} -> ${afterLen} bytes`);
    console.log(`Total disable=true entries now: ${totalDisabled}`);
    console.log(`New PNG size: ${newPng.length} bytes (delta ${newPng.length - originalPngBuf.length})`);
    console.log('\nDone. Remember to commit + push for SillyTavern auto-update to pull the fix.');
}

main();
