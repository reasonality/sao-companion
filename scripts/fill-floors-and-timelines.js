#!/usr/bin/env node
'use strict';

/**
 * fill-floors-and-timelines.js
 * Fills floor data (28 entries: 65/66 new, 75 rewrite, 76-100 replace/new)
 * and timeline data (17 entries: 2024年11月 rewrite, 2024年12月-2026年3月 new/replace)
 * into the SAO character card PNG.
 *
 * Both chara and ccv3 tEXt chunks are updated identically.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_floor_fill.png';

// ── Data (inline to avoid ES module issues) ─────────────────────────────

// Import data files - use require with a shim
const floorsDataPath = path.join(__dirname, 'fill-data', 'floors-data.js');
const timelinesDataPath = path.join(__dirname, 'fill-data', 'timelines-data.js');

// Read and evaluate ES modules by stripping 'export' keyword
function loadESModuleData(filePath) {
    let src = fs.readFileSync(filePath, 'utf8');
    // Replace 'export const' with 'const' to make it plain JS
    src = src.replace(/^export\s+const\s+/gm, 'const ');
    // Evaluate in a function scope
    const fn = new Function(src + '\nreturn { FLOOR_ENTRIES, TIMELINE_ENTRIES };');
    return fn();
}

const floorsSrc = fs.readFileSync(floorsDataPath, 'utf8').replace(/^export\s+const\s+/gm, 'const ');
const FLOOR_ENTRIES = (new Function(floorsSrc + '\nreturn FLOOR_ENTRIES;'))();

const timelinesSrc = fs.readFileSync(timelinesDataPath, 'utf8').replace(/^export\s+const\s+/gm, 'const ');
const TIMELINE_ENTRIES = (new Function(timelinesSrc + '\nreturn TIMELINE_ENTRIES;'))();

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
    console.log('=== fill-floors-and-timelines ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        const bakSize = fs.statSync(BAK_PATH).size;
        console.log(`  Backup already exists: ${BAK_PATH} (${bakSize} bytes) — preserving existing backup`);
    } else {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH} (${originalPngBuf.length} bytes)`);
    }

    // ── Read & decode PNG ────────────────────────────────────────────────
    console.log('\nReading PNG chunks...');
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

    // Decode chara chunk (both should be identical)
    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;
    console.log(`\n  Current entry count: ${beforeCount}`);
    console.log(`  FLOOR_ENTRIES to process: ${FLOOR_ENTRIES.length}`);
    console.log(`  TIMELINE_ENTRIES to process: ${TIMELINE_ENTRIES.length}`);

    // ── Step 1: Process FLOOR_ENTRIES ────────────────────────────────────
    console.log('\nStep 1: Process floor entries...');
    let floorReplaced = 0;
    let floorAdded = 0;

    for (const newEntry of FLOOR_ENTRIES) {
        const existingIdx = entries.findIndex(e => e.comment === newEntry.comment);
        if (existingIdx !== -1) {
            // REPLACE: keep uid, disable, position, etc. — only update content, keys
            entries[existingIdx].content = newEntry.content;
            entries[existingIdx].keys = newEntry.keys;
            floorReplaced++;
            console.log(`  [REPLACE] ${newEntry.comment}`);
        } else {
            // ADD: new entry at end
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
            floorAdded++;
            console.log(`  [ADD] ${newEntry.comment}`);
        }
    }

    console.log(`\n  Floor results: ${floorReplaced} replaced, ${floorAdded} added`);

    // ── Step 2: Process TIMELINE_ENTRIES ─────────────────────────────────
    console.log('\nStep 2: Process timeline entries...');
    let timelineReplaced = 0;
    let timelineAdded = 0;

    for (const newEntry of TIMELINE_ENTRIES) {
        const existingIdx = entries.findIndex(e => e.comment === newEntry.comment);
        if (existingIdx !== -1) {
            // REPLACE: keep uid, disable, position, etc. — only update content, keys
            entries[existingIdx].content = newEntry.content;
            entries[existingIdx].keys = newEntry.keys;
            timelineReplaced++;
            console.log(`  [REPLACE] ${newEntry.comment}`);
        } else {
            // ADD: new entry at end
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
    console.log(`\n  Total entries: ${beforeCount} → ${afterCount} (+${afterCount - beforeCount})`);

    // ── Step 3: Write PNG ────────────────────────────────────────────────
    console.log('\nStep 3: Write updated PNG...');
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

    // ── Step 4: Sync extracted JSON ──────────────────────────────────────
    console.log('\nStep 4: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 5: Verification ─────────────────────────────────────────────
    console.log('\nStep 5: Verify...');
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

            // Restore from backup
            console.log('\n  ⚠ VERIFY FAILED — Restoring from backup...');
            fs.copyFileSync(BAK_PATH, PNG_PATH);
            console.log(`  ✓ Restored ${PNG_PATH} from backup`);
            process.exit(1);
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // ── Step 6: Sanity checks ────────────────────────────────────────────
    console.log('\nStep 6: Sanity checks...');
    let allPassed = true;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);

    // 2. Entry count
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (before: ${beforeCount}, added: ${floorAdded + timelineAdded})`);
    const expectedCount = beforeCount + floorAdded + timelineAdded;
    if (entryCount !== expectedCount) {
        console.log(`      ✗ FAIL: Expected ${expectedCount}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. Verify sao-第65层, sao-第66层, sao-第76层, sao-第100层 exist
    const checkComments = ['sao-第65层', 'sao-第66层', 'sao-第76层', 'sao-第100层'];
    const foundComments = checkComments.map(c => verifyObj.data.character_book.entries.find(e => e.comment === c));
    console.log(`  [3] Check key floor entries exist:`);
    for (let i = 0; i < checkComments.length; i++) {
        if (foundComments[i]) {
            console.log(`      ✓ ${checkComments[i]} exists`);
        } else {
            console.log(`      ✗ ${checkComments[i]} NOT FOUND`);
            allPassed = false;
        }
    }

    // 4. Verify sao-第75层 content contains "转折而非终局"
    const e75 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第75层');
    if (e75 && e75.content.includes('转折而非终局')) {
        console.log(`  [4] ✓ sao-第75层 content contains "转折而非终局"`);
    } else {
        console.log(`  [4] ✗ FAIL: sao-第75层 missing "转折而非终局"`);
        allPassed = false;
    }

    // 5. Verify 2024年11月时间线 content contains "攻略组最终决定不击杀茅场"
    const eNov = verifyObj.data.character_book.entries.find(e => e.comment === '2024年11月时间线');
    if (eNov && eNov.content.includes('攻略组最终决定不击杀茅场')) {
        console.log(`  [5] ✓ 2024年11月时间线 content contains "攻略组最终决定不击杀茅场"`);
    } else {
        console.log(`  [5] ✗ FAIL: 2024年11月时间线 missing "攻略组最终决定不击杀茅场"`);
        allPassed = false;
    }

    // 6. Verify 2025年1月时间线 through 2026年3月时间线 all exist
    const timelineCheck = [
        '2025年1月时间线', '2025年2月时间线', '2025年3月时间线',
        '2025年4月时间线', '2025年5月时间线', '2025年6月时间线',
        '2025年7月时间线', '2025年8月时间线', '2025年9月时间线',
        '2025年10月时间线', '2025年11月时间线', '2025年12月时间线',
        '2026年1月时间线', '2026年2月时间线', '2026年3月时间线',
    ];
    console.log(`  [6] Check timeline entries (2025年1月 - 2026年3月):`);
    for (const tc of timelineCheck) {
        const found = verifyObj.data.character_book.entries.find(e => e.comment === tc);
        if (found) {
            console.log(`      ✓ ${tc} exists`);
        } else {
            console.log(`      ✗ ${tc} NOT FOUND`);
            allPassed = false;
        }
    }

    // 7. node --check on the new script
    console.log(`  [7] node --check on fill-floors-and-timelines.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // 8. Check for timeline entries 2024年12月 through 2026年3月
    const timelineCheck2 = [
        '2024年12月时间线',
        '2025年1月时间线', '2025年2月时间线', '2025年3月时间线',
        '2025年4月时间线', '2025年5月时间线', '2025年6月时间线',
        '2025年7月时间线', '2025年8月时间线', '2025年9月时间线',
        '2025年10月时间线', '2025年11月时间线', '2025年12月时间线',
        '2026年1月时间线', '2026年2月时间线', '2026年3月时间线',
    ];
    console.log(`  [8] Check 2024年12月 - 2026年3月 all present:`);
    let allTimelinePresent = true;
    for (const tc of timelineCheck2) {
        const found = verifyObj.data.character_book.entries.find(e => e.comment === tc);
        if (!found) {
            console.log(`      ✗ ${tc} NOT FOUND`);
            allTimelinePresent = false;
            allPassed = false;
        }
    }
    if (allTimelinePresent) {
        console.log('      ✓ All 16 timeline entries (2024年12月 - 2026年3月) present');
    }

    // ── Final summary ────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Backup: ${BAK_PATH} (${fs.existsSync(BAK_PATH) ? fs.statSync(BAK_PATH).size : 'not found'} bytes)`);
    console.log(`Floor entries: ${floorReplaced} replaced, ${floorAdded} added (total ${FLOOR_ENTRIES.length} processed)`);
    console.log(`Timeline entries: ${timelineReplaced} replaced, ${timelineAdded} added (total ${TIMELINE_ENTRIES.length} processed)`);
    console.log(`Entries: ${beforeCount} → ${afterCount} (+${afterCount - beforeCount})`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
