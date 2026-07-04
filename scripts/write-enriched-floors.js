#!/usr/bin/env node
'use strict';

/**
 * write-enriched-floors.js
 * Replaces content+keys for 27 floor entries (65, 66, 75-100) with enriched v2 data.
 * Keeps all other entry fields (disable, uid, position, insertion_order, etc.) unchanged.
 * Does NOT add or delete entries — only content+keys replace.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';

// ── Load v2 floor data (ES module → strip export → eval) ────────────────

const floorsV2Path = path.join(__dirname, 'fill-data', 'floors-data-v2.js');
const floorsSrc = fs.readFileSync(floorsV2Path, 'utf8').replace(/^export\s+const\s+/gm, 'const ');
const FLOOR_ENTRIES = (new Function(floorsSrc + '\nreturn FLOOR_ENTRIES;'))();

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
    console.log('=== write-enriched-floors ===\n');

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

    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;
    console.log(`\n  Current entry count: ${beforeCount}`);
    console.log(`  FLOOR_ENTRIES (v2) to process: ${FLOOR_ENTRIES.length}`);

    // ── Step 1: Replace content+keys for each floor entry ────────────────
    console.log('\nStep 1: Replace content+keys for floor entries...');
    let replaced = 0;
    let notFound = [];

    for (const newEntry of FLOOR_ENTRIES) {
        const existingIdx = entries.findIndex(e => e.comment === newEntry.comment);
        if (existingIdx !== -1) {
            entries[existingIdx].content = newEntry.content;
            entries[existingIdx].keys = newEntry.keys;
            replaced++;
            console.log(`  [REPLACE] ${newEntry.comment} (content: ${newEntry.content.length} chars)`);
        } else {
            notFound.push(newEntry.comment);
            console.log(`  [NOT FOUND] ${newEntry.comment}`);
        }
    }

    console.log(`\n  Results: ${replaced} replaced, ${notFound.length} not found`);
    if (notFound.length > 0) {
        console.log(`  ⚠ Missing entries: ${notFound.join(', ')}`);
    }

    const afterCount = entries.length;
    console.log(`  Entry count: ${beforeCount} → ${afterCount} (delta: ${afterCount - beforeCount})`);

    // ── Step 2: Write PNG ────────────────────────────────────────────────
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

    // ── Step 3: Sync extracted JSON ──────────────────────────────────────
    console.log('\nStep 3: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 4: Sanity checks ────────────────────────────────────────────
    console.log('\nStep 4: Sanity checks...');
    let allPassed = true;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);

    // 2. Entry count should remain 239
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (expected: ${beforeCount})`);
    if (entryCount !== beforeCount) {
        console.log(`      ✗ FAIL: Entry count changed!`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass (no add/delete)');
    }

    // 3. sao-第76层 content length > 1000
    const e76 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第76层');
    if (e76) {
        console.log(`  [3] sao-第76层 content length: ${e76.content.length} (expected >1000)`);
        if (e76.content.length > 1000) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL: too short');
            allPassed = false;
        }
    } else {
        console.log('  [3] ✗ FAIL: sao-第76层 NOT FOUND');
        allPassed = false;
    }

    // 4. sao-第100层 content length > 1500
    const e100 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第100层');
    if (e100) {
        console.log(`  [4] sao-第100层 content length: ${e100.content.length} (expected >1500)`);
        if (e100.content.length > 1500) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL: too short');
            allPassed = false;
        }
    } else {
        console.log('  [4] ✗ FAIL: sao-第100层 NOT FOUND');
        allPassed = false;
    }

    // 5. sao-第65层 content length > 1000
    const e65 = verifyObj.data.character_book.entries.find(e => e.comment === 'sao-第65层');
    if (e65) {
        console.log(`  [5] sao-第65层 content length: ${e65.content.length} (expected >1000)`);
        if (e65.content.length > 1000) {
            console.log('      ✓ Pass');
        } else {
            console.log('      ✗ FAIL: too short');
            allPassed = false;
        }
    } else {
        console.log('  [5] ✗ FAIL: sao-第65层 NOT FOUND');
        allPassed = false;
    }

    // 6. All 27 entries' keys should match v2 data
    console.log(`  [6] Verify keys match v2 data for all ${FLOOR_ENTRIES.length} entries:`);
    let keysMismatch = 0;
    for (const newEntry of FLOOR_ENTRIES) {
        const existing = verifyObj.data.character_book.entries.find(e => e.comment === newEntry.comment);
        if (existing) {
            const existingKeys = JSON.stringify(existing.keys);
            const expectedKeys = JSON.stringify(newEntry.keys);
            if (existingKeys !== expectedKeys) {
                console.log(`      ✗ ${newEntry.comment}: keys mismatch`);
                keysMismatch++;
                allPassed = false;
            }
        }
    }
    if (keysMismatch === 0) {
        console.log(`      ✓ All ${FLOOR_ENTRIES.length} entries have correct keys`);
    }

    // 7. node --check the script
    console.log(`  [7] node --check on write-enriched-floors.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Final summary ────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Floor entries: ${replaced} replaced, ${notFound.length} not found (total ${FLOOR_ENTRIES.length} processed)`);
    console.log(`Entries: ${beforeCount} → ${afterCount} (delta: ${afterCount - beforeCount})`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
