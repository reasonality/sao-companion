#!/usr/bin/env node
'use strict';

/**
 * remove-non-sao-entries.js
 * Deletes 5 non-SAO format/status directive entries from the character card.
 * These are real-world format/status bar entries that are NOT NPC profiles.
 *
 * Targets (by exact comment match):
 *   1. 现实-{{user}}状态栏
 *   2. 现实-npc状态栏
 *   3. 现实-zd_status
 *   4. 现实-格式
 *   5. 现实格式去掉action，记得关现实格式和行动2
 *
 * KEEP all 现实-XXX entries that are NPC PROFILES (e.g. 现实-亚丝娜, 现实-桐谷直叶, etc.)
 *
 * Both chara and ccv3 tEXt chunks are updated identically.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_non_sao_trim.png';

const TARGET_COMMENTS = [
    '现实-{{user}}状态栏',
    '现实-npc状态栏',
    '现实-zd_status',
    '现实-格式',
    '现实格式去掉action，记得关现实格式和行动2',
];

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
    console.log('=== remove-non-sao-entries ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        console.log(`  ⚠ Backup already exists: ${BAK_PATH} — ABORTING to prevent overwrite`);
        process.exit(1);
    }
    fs.copyFileSync(PNG_PATH, BAK_PATH);
    const bakSize = fs.statSync(BAK_PATH).size;
    if (bakSize !== originalPngBuf.length) {
        throw new Error(`Backup size mismatch: expected ${originalPngBuf.length}, got ${bakSize}`);
    }
    console.log(`  ✓ Backup created: ${BAK_PATH} (${bakSize} bytes)`);

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

    // Decode chara chunk
    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // ── Step 1: Delete target entries ───────────────────────────────────
    console.log('\nStep 1: Delete non-SAO format/status entries...');
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;

    // Verify each target exists
    const foundTargets = [];
    const missingTargets = [];
    for (const t of TARGET_COMMENTS) {
        const found = entries.some(e => e.comment === t);
        if (found) {
            foundTargets.push(t);
        } else {
            missingTargets.push(t);
        }
    }

    console.log(`  Found ${foundTargets.length} of ${TARGET_COMMENTS.length} targets:`);
    for (const t of foundTargets) console.log(`    ✓ ${t}`);
    if (missingTargets.length > 0) {
        console.log(`  Missing (already deleted or never existed):`);
        for (const t of missingTargets) console.log(`    - ${t}`);
    }

    obj.data.character_book.entries = entries.filter(e => !TARGET_COMMENTS.includes(e.comment));
    const afterCount = obj.data.character_book.entries.length;
    const deleted = beforeCount - afterCount;
    console.log(`  Entries: ${beforeCount} → ${afterCount} (deleted ${deleted})`);

    // Verify NPC profiles still exist
    const npcCheck = ['现实-亚丝娜', '现实-桐谷直叶'];
    for (const npc of npcCheck) {
        const exists = obj.data.character_book.entries.some(e => e.comment === npc);
        console.log(`  NPC profile "${npc}": ${exists ? '✓ still present' : '✗ MISSING!'}`);
        if (!exists) throw new Error(`NPC profile "${npc}" was accidentally deleted!`);
    }

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

    // ── Step 3: Sync extracted JSON ──────────────────────────────────────
    console.log('\nStep 3: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 4: Verification ─────────────────────────────────────────────
    console.log('\nStep 4: Verify...');
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

    // ── Step 5: Sanity checks ────────────────────────────────────────────
    console.log('\nStep 5: Sanity checks...');
    let allPassed = true;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    if (newSize >= originalPngBuf.length) {
        console.log('      ⚠ New PNG is not smaller — unexpected');
    } else {
        console.log('      ✓ New PNG is smaller');
    }

    // 2. Entry count
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    const expectedCount = beforeCount - deleted;
    console.log(`  [2] Entry count: ${entryCount} (expected ${expectedCount})`);
    if (entryCount !== expectedCount) {
        console.log(`      ✗ FAIL: Expected ${expectedCount}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. No target entries remain
    let remainingTargets = 0;
    for (const t of foundTargets) {
        if (verifyObj.data.character_book.entries.some(e => e.comment === t)) {
            console.log(`      ✗ "${t}" still present!`);
            remainingTargets++;
            allPassed = false;
        }
    }
    if (remainingTargets === 0) {
        console.log(`  [3] No target entries remain: ✓ Pass`);
    } else {
        console.log(`  [3] ${remainingTargets} target entries still present: ✗ FAIL`);
    }

    // 4. NPC profiles still exist
    const npcStillExist = npcCheck.every(npc =>
        verifyObj.data.character_book.entries.some(e => e.comment === npc)
    );
    console.log(`  [4] NPC profiles preserved: ${npcStillExist ? '✓ Pass' : '✗ FAIL'}`);
    if (!npcStillExist) allPassed = false;

    // 5. node --check on the new script
    console.log(`  [5] node --check on remove-non-sao-entries.js...`);
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
    console.log(`Backup: ${BAK_PATH} (${bakSize} bytes)`);
    console.log(`Entries deleted: ${deleted}`);
    for (const t of foundTargets) console.log(`  - ${t}`);
    if (missingTargets.length > 0) {
        console.log(`Entries already absent: ${missingTargets.length}`);
        for (const t of missingTargets) console.log(`  - ${t}`);
    }
    console.log(`Entries remaining: ${afterCount}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
