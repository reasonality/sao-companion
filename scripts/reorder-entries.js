#!/usr/bin/env node
'use strict';

/**
 * reorder-entries.js
 * Reorders the world book entries array in the SAO character card so that
 * entries of the same category are grouped together.
 *
 * Categories (in display order):
 *  1. Format/protocol (io=1)
 *  2. Core rules (io=10)
 *  3. Gameplay rules (io=20)
 *  4. Real-world NPC profiles (io=50)
 *  5. SAO NPC profiles (io=100, has characterProfile, specific comment prefixes)
 *  6. Floor entries (sao-第N层, sorted by N)
 *  7. Timeline entries (YYYY年M月时间线/时间表, sorted by date)
 *  8. All remaining entries (data rules, thought chains, misc)
 *
 * Does NOT modify any entry fields — only reorders the array.
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

// ── Category classification ────────────────────────────────────────────

/**
 * Classify an entry into a category number (1-8).
 * Lower numbers sort first.
 */
function classify(entry) {
    const comment = entry.comment || '';
    const content = entry.content || '';

    // 1. Format/protocol (io=1)
    if (entry.insertion_order === 1) return 1;

    // 2. Core rules (io=10)
    if (entry.insertion_order === 10) return 2;

    // 3. Gameplay rules (io=20)
    if (entry.insertion_order === 20) return 3;

    // 4. Real-world NPC profiles (io=50)
    if (entry.insertion_order === 50) return 4;

    // From here on, everything is io=100 (or unset)

    // 5. SAO NPC profiles: starts with specific prefixes AND has characterProfile
    const isSaoNpcPrefix =
        comment.startsWith('sao-') ||
        comment.startsWith('桐人sao') ||
        comment.startsWith('桐子sao') ||
        comment.startsWith('茅场') ||
        comment.startsWith('恭二') ||
        comment.startsWith('昌一') ||
        comment.startsWith('敦');
    if (isSaoNpcPrefix && content.includes('characterProfile')) return 5;

    // 6. Floor entries: sao-第N层
    if (/^sao-第\d+层$/.test(comment)) return 6;

    // 7. Timeline entries: YYYY年M月时间线/时间表
    if (/^\d{4}年\d{1,2}月(时间线|时间表)$/.test(comment)) return 7;

    // 8. Everything else
    return 8;
}

/**
 * Extract a sort key within a category for natural ordering.
 */
function sortKey(entry) {
    const comment = entry.comment || '';
    const cat = classify(entry);

    switch (cat) {
        case 6: {
            // Floor: extract floor number
            const m = comment.match(/第(\d+)层/);
            return m ? parseInt(m[1], 10) : 999999;
        }
        case 7: {
            // Timeline: extract year and month for chronological sort
            const m = comment.match(/(\d{4})年(\d{1,2})月/);
            if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
            return 999999;
        }
        default:
            // Alphabetical by comment for all other categories
            return comment;
    }
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== reorder-entries ===\n');

    // ── Step 0: Record original PNG size ─────────────────────────────
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    const originalSize = originalPngBuf.length;
    console.log(`Original PNG size: ${originalSize} bytes (${(originalSize / 1024).toFixed(1)} KB)`);

    // ── Read & decode PNG ────────────────────────────────────────────
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

    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;
    console.log(`  Entry count before reorder: ${beforeCount}`);

    // ── Step 1: Classify and count ───────────────────────────────────
    console.log('\nStep 1: Classifying entries...');
    const categoryNames = {
        1: 'Format/protocol',
        2: 'Core rules',
        3: 'Gameplay rules',
        4: 'Real-world NPC profiles',
        5: 'SAO NPC profiles',
        6: 'Floor entries',
        7: 'Timeline entries',
        8: 'Data rules/misc'
    };
    const categoryCounts = {};
    for (const entry of entries) {
        const cat = classify(entry);
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    for (const [cat, name] of Object.entries(categoryNames)) {
        console.log(`  ${cat}. ${name}: ${categoryCounts[cat] || 0} entries`);
    }

    // ── Step 2: Sort ─────────────────────────────────────────────────
    console.log('\nStep 2: Sorting entries...');
    const reordered = [...entries].sort((a, b) => {
        const catA = classify(a);
        const catB = classify(b);
        if (catA !== catB) return catA - catB;

        // Same category: use category-specific sort key
        const keyA = sortKey(a);
        const keyB = sortKey(b);

        // Numeric keys (floors, timelines)
        if (typeof keyA === 'number' && typeof keyB === 'number') {
            return keyA - keyB;
        }

        // String keys (alphabetical)
        return String(keyA).localeCompare(String(keyB), 'zh-CN');
    });

    const afterCount = reordered.length;
    console.log(`  Entry count after reorder: ${afterCount}`);
    if (afterCount !== beforeCount) {
        console.error(`  ✗ ERROR: Entry count changed! ${beforeCount} → ${afterCount}`);
        process.exit(1);
    }
    console.log('  ✓ Entry count preserved');

    // ── Step 3: Assign to obj and write PNG ──────────────────────────
    console.log('\nStep 3: Writing updated PNG...');
    obj.data.character_book.entries = reordered;
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
    console.log(`  Size change: ${newPng.length - originalSize} bytes`);

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

    // ── Step 4: Sync extracted JSON ──────────────────────────────────
    console.log('\nStep 4: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 5: Sanity checks ────────────────────────────────────────
    console.log('\nStep 5: Sanity checks...');
    let allPassed = true;

    function check(name, pass, detail) {
        if (pass) {
            console.log(`  ✓ ${name}${detail ? ': ' + detail : ''}`);
        } else {
            console.log(`  ✗ FAIL: ${name}${detail ? ': ' + detail : ''}`);
            allPassed = false;
        }
    }

    // Re-read from PNG to verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const vEntries = verifyObj.data.character_book.entries;

    // 1. PNG size similar
    const newSize = fs.statSync(PNG_PATH).size;
    const sizeDiff = Math.abs(newSize - originalSize);
    check('PNG size similar', sizeDiff < 5000,
        `${originalSize} → ${newSize} (${newSize - originalSize} bytes)`);

    // 2. Entry count = 239
    check('Entry count = 239', vEntries.length === 239, `got ${vEntries.length}`);

    // Compute actual category boundaries
    const boundaries = {}; // cat -> {start, end}
    let curCat = -1, catStart = 0;
    vEntries.forEach((e, i) => {
        const c = classify(e);
        if (c !== curCat) {
            if (curCat !== -1) boundaries[curCat] = { start: catStart, end: i - 1 };
            curCat = c;
            catStart = i;
        }
    });
    boundaries[curCat] = { start: catStart, end: vEntries.length - 1 };
    console.log('  Category boundaries:');
    for (const [cat, name] of Object.entries(categoryNames)) {
        const b = boundaries[cat];
        if (b) console.log(`    ${cat}. ${name}: [${b.start}..${b.end}] (${b.end - b.start + 1} entries)`);
    }

    // 3. First entries should be format/core/gameplay rules (cats 1-3)
    const rulesEnd = boundaries[3] ? boundaries[3].end : -1;
    const rulesSlice = vEntries.slice(0, rulesEnd + 1);
    const rulesAllOk = rulesSlice.every(e => {
        const c = classify(e);
        return c >= 1 && c <= 3;
    });
    check('First entries are format/core/gameplay rules',
        rulesAllOk, `[0..${rulesEnd}], ${rulesSlice.length} entries`);
    console.log('    First 5:');
    vEntries.slice(0, 5).forEach((e, i) => {
        console.log(`      [${i}] ${e.comment} (cat ${classify(e)}, io=${e.insertion_order})`);
    });

    // 4. Real-world NPC profiles section
    const realB = boundaries[4];
    if (realB) {
        const realSlice = vEntries.slice(realB.start, realB.end + 1);
        const realAllOk = realSlice.every(e => classify(e) === 4);
        check(`Real-world NPC profiles [${realB.start}..${realB.end}]`,
            realAllOk, `${realSlice.length} entries, all cat 4=${realAllOk}`);
    }

    // 5. SAO NPC profiles section
    const saoB = boundaries[5];
    if (saoB) {
        const saoSlice = vEntries.slice(saoB.start, saoB.end + 1);
        const saoAllOk = saoSlice.every(e => classify(e) === 5);
        check(`SAO NPC profiles [${saoB.start}..${saoB.end}]`,
            saoAllOk, `${saoSlice.length} entries, all cat 5=${saoAllOk}`);
    }

    // 6. Floor entries section
    const floorB = boundaries[6];
    if (floorB) {
        const floorSlice = vEntries.slice(floorB.start, floorB.end + 1);
        const floorAllOk = floorSlice.every(e => classify(e) === 6);
        const floorSorted = floorSlice.every((e, i, arr) => {
            if (i === 0) return true;
            const prevN = parseInt(arr[i - 1].comment.match(/第(\d+)层/)[1]);
            const curN = parseInt(e.comment.match(/第(\d+)层/)[1]);
            return curN >= prevN;
        });
        check(`Floor entries [${floorB.start}..${floorB.end}]`,
            floorAllOk && floorSorted,
            `${floorSlice.length} entries, sorted=${floorSorted}`);
    }

    // 7. Timeline entries section
    const tlB = boundaries[7];
    if (tlB) {
        const tlSlice = vEntries.slice(tlB.start, tlB.end + 1);
        const tlAllOk = tlSlice.every(e => classify(e) === 7);
        const tlSorted = tlSlice.every((e, i, arr) => {
            if (i === 0) return true;
            const pm = arr[i - 1].comment.match(/(\d{4})年(\d{1,2})月/);
            const cm = e.comment.match(/(\d{4})年(\d{1,2})月/);
            if (!pm || !cm) return true;
            return (parseInt(cm[1]) * 100 + parseInt(cm[2])) >= (parseInt(pm[1]) * 100 + parseInt(pm[2]));
        });
        check(`Timeline entries [${tlB.start}..${tlB.end}]`,
            tlAllOk && tlSorted,
            `${tlSlice.length} entries, sorted=${tlSorted}`);
    }

    // 8. Data rules/misc section
    const miscB = boundaries[8];
    if (miscB) {
        const miscSlice = vEntries.slice(miscB.start, miscB.end + 1);
        const miscAllOk = miscSlice.every(e => classify(e) === 8);
        check(`Data rules/misc [${miscB.start}..${miscB.end}]`,
            miscAllOk, `${miscSlice.length} entries, all cat 8=${miscAllOk}`);
    }

    // 9. All floor entries consecutive and sorted
    const allFloors = vEntries.filter(e => classify(e) === 6);
    const floorIndices = allFloors.map((_, i) => vEntries.indexOf(allFloors[i]));
    const floorsConsecutive = floorIndices.every((idx, i) => {
        if (i === 0) return true;
        return idx === floorIndices[i - 1] + 1;
    });
    const floorsSorted = allFloors.every((e, i, arr) => {
        if (i === 0) return true;
        const prevN = parseInt(arr[i - 1].comment.match(/第(\d+)层/)[1]);
        const curN = parseInt(e.comment.match(/第(\d+)层/)[1]);
        return curN > prevN;
    });
    check(`All ${allFloors.length} floor entries consecutive and sorted`,
        floorsConsecutive && floorsSorted,
        `consecutive=${floorsConsecutive}, sorted=${floorsSorted}`);

    // 10. All timeline entries consecutive and sorted
    const allTimelines = vEntries.filter(e => classify(e) === 7);
    const timelineIndices = allTimelines.map((_, i) => vEntries.indexOf(allTimelines[i]));
    const timelinesConsecutive = timelineIndices.every((idx, i) => {
        if (i === 0) return true;
        return idx === timelineIndices[i - 1] + 1;
    });
    const timelinesSorted = allTimelines.every((e, i, arr) => {
        if (i === 0) return true;
        const pm = arr[i - 1].comment.match(/(\d{4})年(\d{1,2})月/);
        const cm = e.comment.match(/(\d{4})年(\d{1,2})月/);
        if (!pm || !cm) return true;
        return (parseInt(cm[1]) * 100 + parseInt(cm[2])) > (parseInt(pm[1]) * 100 + parseInt(pm[2]));
    });
    check(`All ${allTimelines.length} timeline entries consecutive and sorted`,
        timelinesConsecutive && timelinesSorted,
        `consecutive=${timelinesConsecutive}, sorted=${timelinesSorted}`);

    // 11. node --check on this script
    console.log('  [11] node --check on reorder-entries.js...');
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Final summary ────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Category counts:`);
    for (const [cat, name] of Object.entries(categoryNames)) {
        console.log(`  ${cat}. ${name}: ${categoryCounts[cat] || 0}`);
    }
    console.log(`\nFirst 10 entries after reorder:`);
    vEntries.slice(0, 10).forEach((e, i) => {
        console.log(`  [${i}] ${e.comment} (cat ${classify(e)}, io=${e.insertion_order})`);
    });
    console.log(`\nLast 10 entries:`);
    vEntries.slice(-10).forEach((e, i) => {
        const idx = vEntries.length - 10 + i;
        console.log(`  [${idx}] ${e.comment} (cat ${classify(e)}, io=${e.insertion_order})`);
    });
    console.log(`\nPNG size: ${originalSize} → ${newSize} (${newSize - originalSize} bytes)`);
    console.log(`Entry count: ${beforeCount} → ${afterCount}`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
