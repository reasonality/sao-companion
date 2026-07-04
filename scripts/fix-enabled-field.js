#!/usr/bin/env node
'use strict';

/**
 * fix-enabled-field.js
 * Fixes the enabled/disable field inconsistency in the SAO character card.
 *
 * SillyTavern's convertCharacterBook reads `enabled` and computes disable = !entry.enabled.
 * Some entries have `enabled: true` even though `disable: true`, causing ST to import
 * them as enabled when they should be disabled.
 *
 * Fix: Set enabled = !disable for ALL entries (overwrite existing values).
 * Keep disable field as-is (some ST code paths read it directly).
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';

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

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== fix-enabled-field ===\n');

    // ── Step 0: Read PNG ─────────────────────────────────────────────────
    console.log('Step 0: Read PNG...');
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
    console.log(`  chara chunk: index ${charaIdx}, ccv3 chunk: index ${ccv3Idx}`);

    if (charaIdx === -1 || ccv3Idx === -1) {
        throw new Error('chara or ccv3 tEXt chunk not found in PNG');
    }

    // Decode chara chunk
    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // ── Step 1: Fix enabled field ────────────────────────────────────────
    console.log('\nStep 1: Fix enabled field...');
    const entries = obj.data.character_book.entries;
    console.log(`  Total entries: ${entries.length}`);

    let addedCount = 0;    // entries that had no enabled field
    let changedCount = 0;  // entries where enabled was changed

    for (const entry of entries) {
        const disableVal = entry.disable;       // boolean true/false
        const correctEnabled = !disableVal;     // inverse of disable

        if (entry.enabled === undefined) {
            // Entry had no enabled field — add it
            addedCount++;
        } else if (entry.enabled !== correctEnabled) {
            // Entry had wrong enabled value — fix it
            changedCount++;
        }

        // Set enabled = !disable for ALL entries (overwrite if needed)
        entry.enabled = correctEnabled;
    }

    console.log(`  Entries with enabled field ADDED (was missing): ${addedCount}`);
    console.log(`  Entries with enabled field CHANGED (was wrong): ${changedCount}`);
    console.log(`  Entries already correct: ${entries.length - addedCount - changedCount}`);

    // ── Step 2: Write PNG + sync JSON ────────────────────────────────────
    console.log('\nStep 2: Write updated PNG...');
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

    // Atomic write PNG
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

    // Sync extracted JSON
    console.log('\nStep 2b: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 3: Verify ───────────────────────────────────────────────────
    console.log('\nStep 3: Verify...');
    const verifyScriptPath = path.join(__dirname, 'verify-card-regex.js');
    if (fs.existsSync(verifyScriptPath)) {
        try {
            const { execSync } = require('child_process');
            const result = execSync(
                `node "${verifyScriptPath}" "${PNG_PATH}" "${JSON_PATH}"`,
                { encoding: 'utf8', timeout: 30000 }
            );
            console.log(result);
        } catch (e) {
            console.error(`  ⚠ verify-card-regex.js exited with code ${e.status}`);
            if (e.stdout) console.log(e.stdout);
            if (e.stderr) console.error(e.stderr);
            process.exit(1);
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // ── Step 4: Sanity checks ────────────────────────────────────────────
    console.log('\nStep 4: Sanity checks...');
    let allPassed = true;

    // Re-read the PNG to verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const verifyEntries = verifyObj.data.character_book.entries;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log('      ✓ Size check done');

    // 2. Entry count = 239
    console.log(`  [2] Entry count: ${verifyEntries.length} (expected 239)`);
    if (verifyEntries.length !== 239) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. Count enabled === true (should be 32)
    const enabledTrue = verifyEntries.filter(e => e.enabled === true).length;
    console.log(`  [3] enabled=true count: ${enabledTrue} (expected 32)`);
    if (enabledTrue !== 32) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 4. Count enabled === false (should be 207)
    const enabledFalse = verifyEntries.filter(e => e.enabled === false).length;
    console.log(`  [4] enabled=false count: ${enabledFalse} (expected 207)`);
    if (enabledFalse !== 207) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 5. Count entries where enabled !== !disable (inconsistency) — should be 0
    const inconsistent = verifyEntries.filter(e => e.enabled !== !e.disable).length;
    console.log(`  [5] Inconsistent entries (enabled !== !disable): ${inconsistent} (expected 0)`);
    if (inconsistent !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 6. Count entries where enabled field is missing — should be 0
    const missingEnabled = verifyEntries.filter(e => e.enabled === undefined).length;
    console.log(`  [6] Missing enabled field: ${missingEnabled} (expected 0)`);
    if (missingEnabled !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 7. sao-第1层 should have enabled: false, disable: true (disabled floor)
    const saoFloor1 = verifyEntries.find(e => e.comment === 'sao-第1层');
    if (saoFloor1) {
        console.log(`  [7] sao-第1层: enabled=${saoFloor1.enabled}, disable=${saoFloor1.disable} (expected false/true)`);
        if (saoFloor1.enabled === false && saoFloor1.disable === true) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL');
            allPassed = false;
        }
    } else {
        console.log('  [7] ✗ FAIL: sao-第1层 entry not found');
        allPassed = false;
    }

    // 8. 现实-亚丝娜 should have enabled: true, disable: false (enabled real NPC)
    const asunaReal = verifyEntries.find(e => e.comment === '现实-亚丝娜');
    if (asunaReal) {
        console.log(`  [8] 现实-亚丝娜: enabled=${asunaReal.enabled}, disable=${asunaReal.disable} (expected true/false)`);
        if (asunaReal.enabled === true && asunaReal.disable === false) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL');
            allPassed = false;
        }
    } else {
        console.log('  [8] ✗ FAIL: 现实-亚丝娜 entry not found');
        allPassed = false;
    }

    // 9. sao-格式 should have enabled: true, disable: false (enabled format)
    const saoFormat = verifyEntries.find(e => (e.comment || '').startsWith('sao-格式'));
    if (saoFormat) {
        console.log(`  [9] sao-格式: enabled=${saoFormat.enabled}, disable=${saoFormat.disable} (expected true/false)`);
        if (saoFormat.enabled === true && saoFormat.disable === false) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL');
            allPassed = false;
        }
    } else {
        console.log('  [9] ✗ FAIL: sao-格式 entry not found');
        allPassed = false;
    }

    // 10. 2022年11月时间表 should have enabled: false, disable: true (disabled timeline)
    const timeline = verifyEntries.find(e => e.comment === '2022年11月时间表');
    if (timeline) {
        console.log(`  [10] 2022年11月时间表: enabled=${timeline.enabled}, disable=${timeline.disable} (expected false/true)`);
        if (timeline.enabled === false && timeline.disable === true) {
            console.log('       ✓ Pass');
        } else {
            console.log('       ✗ FAIL');
            allPassed = false;
        }
    } else {
        console.log('  [10] ✗ FAIL: 2022年11月时间表 entry not found');
        allPassed = false;
    }

    // 11. node --check the script
    console.log(`  [11] node --check on fix-enabled-field.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('       ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`       ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Final summary ────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Entries with enabled field added (was missing): ${addedCount}`);
    console.log(`Entries with enabled field changed (was wrong): ${changedCount}`);
    console.log(`Entries already correct: ${entries.length - addedCount - changedCount}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
