#!/usr/bin/env node
'use strict';

/**
 * update-timelines.js
 * 1) Delete duplicate combined floor entry: sao-第65层第66层
 * 2) Update/replace/add timeline entries (2024年11月 – 2026年11月, 25 entries)
 * 3) Write PNG + JSON
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';

// ── Load timeline data ─────────────────────────────────────────────
const timelinesDataPath = path.join(__dirname, 'fill-data', 'timelines-data.js');
const timelinesSrc = fs.readFileSync(timelinesDataPath, 'utf8').replace(/^export\s+const\s+/gm, 'const ');
const TIMELINE_ENTRIES = (new Function(timelinesSrc + '\nreturn TIMELINE_ENTRIES;'))();

// ── PNG helpers (CRC32, chunk read/write) ──────────────────────────
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

// ── Main ───────────────────────────────────────────────────────────
function main() {
    console.log('=== update-timelines ===\n');

    // ── Read PNG ────────────────────────────────────────────────────
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`PNG size before: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    const chunks = readPngChunks(PNG_PATH);
    console.log(`PNG chunks: ${chunks.length}`);

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
    console.log(`chara chunk: index ${charaIdx}, ccv3 chunk: index ${ccv3Idx}`);

    if (charaIdx === -1 || ccv3Idx === -1) {
        throw new Error('chara or ccv3 tEXt chunk not found in PNG');
    }

    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;
    console.log(`\nCurrent entry count: ${beforeCount}`);

    // ── Step 1a: Delete duplicate combined floor entry ──────────────
    console.log('\nStep 1a: Delete duplicate combined floor entry...');
    const dupIdx = entries.findIndex(e => e.comment === 'sao-第65层第66层');
    if (dupIdx !== -1) {
        entries.splice(dupIdx, 1);
        console.log('  [DELETE] sao-第65层第66层');
    } else {
        console.log('  sao-第65层第66层 not found (already deleted?)');
    }
    const afterDelete = entries.length;
    console.log(`  Entry count after delete: ${afterDelete}`);

    // ── Step 1b: Update timeline entries ────────────────────────────
    console.log('\nStep 1b: Update timeline entries...');
    console.log(`  TIMELINE_ENTRIES to process: ${TIMELINE_ENTRIES.length}`);
    let timelineReplaced = 0;
    let timelineAdded = 0;

    for (const newEntry of TIMELINE_ENTRIES) {
        const existingIdx = entries.findIndex(e => e.comment === newEntry.comment);
        if (existingIdx !== -1) {
            entries[existingIdx].content = newEntry.content;
            entries[existingIdx].keys = newEntry.keys;
            timelineReplaced++;
            console.log(`  [REPLACE] ${newEntry.comment}`);
        } else {
            entries.push({
                disable: '',
                uid: '',
                position: 'before_char',
                insertion_order: 100,
                constant: false,
                selective: true,
                use_regex: false,
                extensions: {},
                secondary_keys: [],
                comment: newEntry.comment,
                keys: newEntry.keys,
                content: newEntry.content,
            });
            timelineAdded++;
            console.log(`  [ADD] ${newEntry.comment}`);
        }
    }

    console.log(`\n  Timeline results: ${timelineReplaced} replaced, ${timelineAdded} added`);
    const afterCount = entries.length;
    console.log(`  Total entries: ${beforeCount} → ${afterDelete} (after delete) → ${afterCount} (after timeline update)`);

    // ── Step 1c: Write PNG + JSON ───────────────────────────────────
    console.log('\nStep 1c: Write updated PNG...');
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
    console.log(`  Size change: ${newPng.length - originalPngBuf.length} bytes (${((newPng.length - originalPngBuf.length) / 1024).toFixed(1)} KB)`);

    // Atomic write
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
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 2: Verify ──────────────────────────────────────────────
    console.log('\nStep 2: Verify...');
    const verifyScriptPath = path.join(__dirname, 'verify-card-regex.js');
    let verifyPassed = false;
    if (fs.existsSync(verifyScriptPath)) {
        try {
            const { execSync } = require('child_process');
            const result = execSync(
                `node "${verifyScriptPath}" "${PNG_PATH}" "${JSON_PATH}"`,
                { encoding: 'utf8', timeout: 30000 }
            );
            console.log(result);
            verifyPassed = true;
        } catch (e) {
            console.error(`  ⚠ verify-card-regex.js exited with code ${e.status}`);
            if (e.stdout) console.log(e.stdout);
            if (e.stderr) console.error(e.stderr);
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // ── Step 3: Sanity checks ───────────────────────────────────────
    console.log('\nStep 3: Sanity checks...');
    let allPassed = true;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);

    // 2. Entry count
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (before: ${beforeCount}, deleted: ${beforeCount - afterDelete}, added: ${timelineAdded})`);
    const expectedCount = beforeCount - (beforeCount - afterDelete) + timelineAdded;
    if (entryCount !== expectedCount) {
        console.log(`      ✗ FAIL: Expected ${expectedCount}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. sao-第65层第66层 should NOT exist
    const dupCheck = verifyObj.data.character_book.entries.filter(e => e.comment === 'sao-第65层第66层');
    console.log(`  [3] sao-第65层第66层 count: ${dupCheck.length} (expected 0)`);
    if (dupCheck.length === 0) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL');
        allPassed = false;
    }

    // 4. sao-第65层 and sao-第66层 should still exist
    const e65 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第65层');
    const e66 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第66层');
    console.log(`  [4] sao-第65层 exists: ${!!e65}, sao-第66层 exists: ${!!e66}`);
    if (e65 && e66) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL');
        allPassed = false;
    }

    // 5. 2026年11月时间线 should exist
    const eNov26 = verifyObj.data.character_book.entries.find(e => e.comment === '2026年11月时间线');
    console.log(`  [5] 2026年11月时间线 exists: ${!!eNov26}`);
    if (eNov26) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL');
        allPassed = false;
    }

    // 6. 2024年11月时间线 content contains "攻略组决定不击杀茅场"
    const eNov24 = verifyObj.data.character_book.entries.find(e => e.comment === '2024年11月时间线');
    const hasNov24 = eNov24 && eNov24.content.includes('攻略组决定不击杀茅场');
    console.log(`  [6] 2024年11月时间线 contains "攻略组决定不击杀茅场": ${hasNov24}`);
    if (hasNov24) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL');
        allPassed = false;
    }

    // 7. 2026年11月时间线 content contains "死亡游戏通关"
    const hasNov26 = eNov26 && eNov26.content.includes('死亡游戏通关');
    console.log(`  [7] 2026年11月时间线 contains "死亡游戏通关": ${hasNov26}`);
    if (hasNov26) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL');
        allPassed = false;
    }

    // 8. 2026年3月时间线 should NOT mention "死亡游戏通关"
    const eMar26 = verifyObj.data.character_book.entries.find(e => e.comment === '2026年3月时间线');
    const mar26HasEnding = eMar26 && eMar26.content.includes('死亡游戏通关');
    console.log(`  [8] 2026年3月时间线 does NOT contain "死亡游戏通关": ${!mar26HasEnding}`);
    if (!mar26HasEnding) {
        console.log('      ✓ Pass');
    } else {
        console.log('      ✗ FAIL: old ending content still in March');
        allPassed = false;
    }

    // 9. node --check on this script
    console.log(`  [9] node --check on update-timelines.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // 10. Total timeline entries (comment matches 时间线 or 时间表)
    // 25 original (2022-10 through 2024-10) + 25 new (2024-11 through 2026-11) = 50
    const allTimelines = verifyObj.data.character_book.entries.filter(
        e => e.comment.includes('时间线') || e.comment.includes('时间表')
    );
    console.log(`  [10] Total timeline entries: ${allTimelines.length} (expected 50: 25 original + 25 new)`);
    if (allTimelines.length === 50) {
        console.log('       ✓ Pass');
    } else {
        console.log(`       ✗ FAIL: Expected 50`);
        allPassed = false;
    }

    // ── Final summary ───────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Deleted: ${beforeCount - afterDelete} entry (sao-第65层第66层)`);
    console.log(`Timeline: ${timelineReplaced} replaced, ${timelineAdded} added (total ${TIMELINE_ENTRIES.length} processed)`);
    console.log(`Entries: ${beforeCount} → ${afterCount}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`Verify: ${verifyPassed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
