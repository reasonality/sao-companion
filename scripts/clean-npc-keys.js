#!/usr/bin/env node
'use strict';

/**
 * clean-npc-keys.js
 * Removes 9 high-risk short keys from 7 world book entries in the SAO character card.
 *
 * Removals:
 *  1. 桐人sao-桐谷和人 → remove `和人`
 *  2. 桐子sao-桐谷和子 → remove `和人`
 *  3. 桐人现实-桐谷和人 → remove `和人`
 *  4. 桐子现实-桐谷和子 → remove `和人`
 *  5. sao-希兹克利夫 → remove `团长`
 *  6. sao-阿尔戈 → remove `老鼠`
 *  7. 现实-阿尔戈 → remove `老鼠`
 *  8. 现实-安施恩 → remove `An` AND remove `施恩`
 *
 * Both chara and ccv3 tEXt chunks are updated identically.
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

// ── Key removal rules ──────────────────────────────────────────────────

const REMOVAL_RULES = [
    { comment: '桐人sao-桐谷和人', removeKeys: ['和人'] },
    { comment: '桐子sao-桐谷和子', removeKeys: ['和人'] },
    { comment: '桐人现实-桐谷和人', removeKeys: ['和人'] },
    { comment: '桐子现实-桐谷和子', removeKeys: ['和人'] },
    { comment: 'sao-希兹克利夫', removeKeys: ['团长'] },
    { comment: 'sao-阿尔戈', removeKeys: ['老鼠'] },
    { comment: '现实-阿尔戈', removeKeys: ['老鼠'] },
    { comment: '现实-安施恩', removeKeys: ['An', '施恩'] },
];

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== clean-npc-keys ===\n');

    // ── Step 0: Measure PNG size ────────────────────────────────────────
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    // ── Read & decode PNG ────────────────────────────────────────────────
    console.log('\nReading PNG chunks...');
    const chunks = readPngChunks(PNG_PATH);
    console.log(`  PNG chunks: ${chunks.length}`);

    let charaIdx = -1;
    let ccv3Idx = -1;
    for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].type === 'tEXt') {
            const ni = chunks[i].data.indexOf(0);
            if (ni !== -1) {
                const keyword = chunks[i].data.slice(0, ni).toString('latin1');
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

    // ── Step 1: Remove keys ──────────────────────────────────────────────
    console.log('\nStep 1: Removing keys from entries...');
    const entries = obj.data.character_book.entries;
    const entryCountBefore = entries.length;
    let totalRemoved = 0;

    for (const rule of REMOVAL_RULES) {
        const entry = entries.find(e => e.comment === rule.comment);
        if (!entry) {
            console.log(`  ⚠ Entry not found: "${rule.comment}"`);
            continue;
        }

        for (const keyToRemove of rule.removeKeys) {
            const idx = entry.keys.indexOf(keyToRemove);
            if (idx !== -1) {
                entry.keys.splice(idx, 1);
                totalRemoved++;
                console.log(`  ✓ Removed "${keyToRemove}" from "${rule.comment}"`);
            } else {
                console.log(`  ⚠ Key "${keyToRemove}" not found in "${rule.comment}" (already removed?)`);
            }
        }
    }

    const entryCountAfter = entries.length;
    console.log(`\n  Total keys removed: ${totalRemoved}`);
    console.log(`  Entry count: ${entryCountBefore} → ${entryCountAfter} (should be unchanged)`);

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
    console.log('\n  Syncing extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 3: Verify ──────────────────────────────────────────────────
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

    // Re-read from PNG to verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const vEntries = verifyObj.data.character_book.entries;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    if (newSize === originalPngBuf.length) {
        console.log('      (same size — expected for small key removals)');
    }

    // 2. Entry count should remain 239
    console.log(`  [2] Entry count: ${vEntries.length} (expected 239)`);
    if (vEntries.length !== 239) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 3. 桐人sao-桐谷和人 keys should NOT contain 和人
    const e1 = vEntries.find(e => e.comment === '桐人sao-桐谷和人');
    const hasHeren = e1 && e1.keys.includes('和人');
    console.log(`  [3] 桐人sao-桐谷和人 contains 和人: ${hasHeren} (expected false)`);
    if (hasHeren) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 4. 桐人sao-桐谷和人 keys should STILL contain all expected keys
    const expected1 = ['桐谷', '桐人', '桐谷和人', '封弊者', '黑色剑士', '黑小子', '黑漆漆', 'Kirito', 'Kirigaya', 'Kazuto'];
    const missing1 = expected1.filter(k => !e1.keys.includes(k));
    console.log(`  [4] 桐人sao-桐谷和人 missing expected keys: ${missing1.length === 0 ? 'none' : missing1.join(', ')}`);
    if (missing1.length > 0) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 5. sao-希兹克利夫 keys should NOT contain 团长
    const e5 = vEntries.find(e => e.comment === 'sao-希兹克利夫');
    const hasTuanzhang = e5 && e5.keys.includes('团长');
    console.log(`  [5] sao-希兹克利夫 contains 团长: ${hasTuanzhang} (expected false)`);
    if (hasTuanzhang) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 6. sao-希兹克利夫 keys should STILL contain expected keys
    const expected5 = ['希兹克利夫', '最强的男人', 'KoB', 'Heathcliff'];
    const missing5 = expected5.filter(k => !e5.keys.includes(k));
    console.log(`  [6] sao-希兹克利夫 missing expected keys: ${missing5.length === 0 ? 'none' : missing5.join(', ')}`);
    if (missing5.length > 0) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 7. sao-幸 keys should STILL contain 幸
    const e7 = vEntries.find(e => e.comment === 'sao-幸');
    const hasSachi = e7 && e7.keys.includes('幸');
    console.log(`  [7] sao-幸 contains 幸: ${hasSachi} (expected true)`);
    if (!hasSachi) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 8. 敦 entry should STILL contain 敦
    const e8 = vEntries.find(e => e.comment === '敦');
    const hasDun = e8 && e8.keys.includes('敦');
    console.log(`  [8] 敦 contains 敦: ${hasDun} (expected true)`);
    if (!hasDun) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 9. 现实-柏坂日和 should STILL contain 日和
    const e9 = vEntries.find(e => e.comment === '现实-柏坂日和');
    const hasHiyori = e9 && e9.keys.includes('日和');
    console.log(`  [9] 现实-柏坂日和 contains 日和: ${hasHiyori} (expected true)`);
    if (!hasHiyori) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 10. 现实-香莲 should STILL contain 莲
    const e10 = vEntries.find(e => e.comment === '现实-香莲');
    const hasRen = e10 && e10.keys.includes('莲');
    console.log(`  [10] 现实-香莲 contains 莲: ${hasRen} (expected true)`);
    if (!hasRen) { console.log('       ✗ FAIL'); allPassed = false; } else { console.log('       ✓ Pass'); }

    // 11. 现实-安施恩 should NOT contain An or 施恩
    const e11 = vEntries.find(e => e.comment === '现实-安施恩');
    const hasAn = e11 && e11.keys.includes('An');
    const hasShien = e11 && e11.keys.includes('施恩');
    console.log(`  [11] 现实-安施恩 contains An: ${hasAn}, 施恩: ${hasShien} (both expected false)`);
    if (hasAn || hasShien) { console.log('       ✗ FAIL'); allPassed = false; } else { console.log('       ✓ Pass'); }

    // 12. node --check on this script
    console.log(`  [12] node --check on clean-npc-keys.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('       ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`       ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Keys removed: ${totalRemoved} across ${REMOVAL_RULES.length} entries`);
    for (const rule of REMOVAL_RULES) {
        console.log(`  ${rule.comment}: ${rule.removeKeys.join(', ')}`);
    }
    console.log(`Entry count: ${entryCountBefore} (unchanged)`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
