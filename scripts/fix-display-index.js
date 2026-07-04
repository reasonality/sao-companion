#!/usr/bin/env node
'use strict';

/**
 * fix-display-index.js
 * Fixes extensions.display_index in all world book entries to match their
 * current array position. ST sorts entries by displayIndex (from
 * extensions.display_index), not by array order. The array was reordered by
 * category but display_index still holds old values, causing ST to display
 * entries in wrong order.
 *
 * For each entry at array index i:
 *   1. Ensure entry.extensions exists (if not, create empty object)
 *   2. Set entry.extensions.display_index = i
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
    console.log('=== fix-display-index ===\n');

    // ── Step 0: Read PNG ───────────────────────────────────────────────
    console.log('Step 0: Reading PNG...');
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

    // ── Step 1: Fix display_index ──────────────────────────────────────
    console.log('\nStep 1: Fix display_index...');
    const entries = obj.data.character_book.entries;
    const entryCount = entries.length;
    console.log(`  Total entries: ${entryCount}`);

    let fixed = 0;
    let created = 0;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.extensions) {
            entry.extensions = {};
            created++;
        }
        const oldVal = entry.extensions.display_index;
        entry.extensions.display_index = i;
        if (oldVal !== i) {
            fixed++;
        }
    }
    console.log(`  Extensions created: ${created}`);
    console.log(`  display_index values fixed: ${fixed}`);

    // ── Step 2: Write PNG + sync JSON ──────────────────────────────────
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
    console.log('\nStep 2b: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 3: Verify ─────────────────────────────────────────────────
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

    // ── Step 4: Sanity checks ──────────────────────────────────────────
    console.log('\nStep 4: Sanity checks...');
    let allPassed = true;

    // Re-read from PNG to verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const verifyEntries = verifyObj.data.character_book.entries;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log('      ✓ Pass');

    // 2. Entry count = 239
    const entryCountCheck = verifyEntries.length;
    console.log(`  [2] Entry count: ${entryCountCheck} (expected 239)`);
    if (entryCountCheck !== 239) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. Entry[0].extensions.display_index should be 0
    const e0di = verifyEntries[0].extensions?.display_index;
    console.log(`  [3] Entry[0] display_index: ${e0di}, comment: ${verifyEntries[0].comment}`);
    if (e0di !== 0) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 4. Entry[1].extensions.display_index should be 1
    const e1di = verifyEntries[1].extensions?.display_index;
    console.log(`  [4] Entry[1] display_index: ${e1di}, comment: ${verifyEntries[1].comment}`);
    if (e1di !== 1) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 5. Entry[57].extensions.display_index should be 57
    const e57di = verifyEntries[57].extensions?.display_index;
    console.log(`  [5] Entry[57] display_index: ${e57di}, comment: ${verifyEntries[57].comment}`);
    if (e57di !== 57) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 6. Entry[156].extensions.display_index should be 156
    const e156di = verifyEntries[156].extensions?.display_index;
    console.log(`  [6] Entry[156] display_index: ${e156di}, comment: ${verifyEntries[156].comment}`);
    if (e156di !== 156) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 7. Entry[157].extensions.display_index should be 157
    const e157di = verifyEntries[157].extensions?.display_index;
    console.log(`  [7] Entry[157] display_index: ${e157di}, comment: ${verifyEntries[157].comment}`);
    if (e157di !== 157) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 8. Entry[238].extensions.display_index should be 238
    const e238di = verifyEntries[238].extensions?.display_index;
    console.log(`  [8] Entry[238] display_index: ${e238di}, comment: ${verifyEntries[238].comment}`);
    if (e238di !== 238) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 9. No entry should have display_index that doesn't match its array index
    let mismatchCount = 0;
    for (let i = 0; i < verifyEntries.length; i++) {
        if (verifyEntries[i].extensions?.display_index !== i) {
            mismatchCount++;
            if (mismatchCount <= 5) {
                console.log(`      Mismatch at [${i}]: display_index=${verifyEntries[i].extensions?.display_index}, comment=${verifyEntries[i].comment}`);
            }
        }
    }
    console.log(`  [9] Mismatched display_index values: ${mismatchCount} (expected 0)`);
    if (mismatchCount !== 0) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 10. node --check on this script
    console.log(`  [10] node --check on fix-display-index.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Final summary ──────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Entries updated: ${fixed}`);
    console.log(`Extensions created: ${created}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
