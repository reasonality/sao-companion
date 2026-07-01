#!/usr/bin/env node
'use strict';

/**
 * disable-rules.js
 * Disables 7 worldbook entries that are technical/expert instructions
 * not needed by the main LLM (they are already inlined into specialist prompts).
 *
 * Targets (matched by exact comment):
 *   1. sao-技能
 *   2. sao-等级
 *   3. sao-真实骰子规则
 *   4. sao-NPC档案构建规则 （sao）
 *   5. sao-剑技获取
 *   6. 行动2
 *   7. sao-房屋
 *
 * Idempotent: entries already disabled are skipped.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_disable_rules.png';

const TARGET_COMMENTS = [
    'sao-技能',
    'sao-等级',
    'sao-真实骰子规则',
    'sao-NPC档案构建规则 （sao）',
    'sao-剑技获取',
    '行动2',
    'sao-房屋',
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
    console.log('=== disable-rules ===\n');

    // (1) Read and decode PNG
    console.log('Reading PNG...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    const chunks = readPngChunks(PNG_PATH);
    console.log(`  PNG chunks: ${chunks.length}`);

    // Find chara and ccv3 chunks
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

    // (2) Process entries
    const entries = obj.data?.character_book?.entries || [];
    console.log(`\nTotal entries: ${entries.length}`);

    const targetSet = new Set(TARGET_COMMENTS);
    let disabledCount = 0;
    let alreadyDisabled = 0;
    const notFound = [];

    for (const entry of entries) {
        if (targetSet.has(entry.comment)) {
            if (entry.disable === true) {
                alreadyDisabled++;
                console.log(`  [skip] already disabled: ${entry.comment} (uid=${entry.id})`);
            } else {
                entry.disable = true;
                disabledCount++;
                console.log(`  [done] disabled: ${entry.comment} (uid=${entry.id})`);
            }
            targetSet.delete(entry.comment);
        }
    }

    // Check for any not found
    for (const missing of targetSet) {
        notFound.push(missing);
        console.error(`  [WARN] not found: ${missing}`);
    }

    console.log(`\n  Disabled: ${disabledCount}`);
    console.log(`  Already disabled: ${alreadyDisabled}`);
    console.log(`  Not found: ${notFound.length}`);

    if (notFound.length > 0) {
        throw new Error(`Could not find entries: ${notFound.join(', ')}`);
    }

    if (disabledCount === 0 && alreadyDisabled === 7) {
        console.log('\nAll 7 entries already disabled — idempotent skip, no write needed.');
        return;
    }

    // (3) Backup PNG
    console.log('\nBacking up PNG...');
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH}`);
    }

    // (4) Write back to PNG
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

    // (5) Sync extracted JSON
    console.log('\nUpdating extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // (6) Verification
    console.log('\n=== Verification ===');

    // Re-read PNG
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyCharaChunk = findTextChunk(verifyChunks, 'chara');
    if (!verifyCharaChunk) throw new Error('Verification failed: chara tEXt chunk not found');
    const verifyObj = decodeTextChunkData(verifyCharaChunk);
    const verifyEntries = verifyObj.data?.character_book?.entries || [];
    console.log(`  Total entries in PNG: ${verifyEntries.length}`);

    // Verify 7 targets are disabled
    let verifyDisabled = 0;
    let verifyEnabled = 0;
    for (const entry of verifyEntries) {
        if (TARGET_COMMENTS.includes(entry.comment)) {
            if (entry.disable === true) {
                verifyDisabled++;
            } else {
                console.error(`  ✗ Entry NOT disabled: ${entry.comment} (uid=${entry.id})`);
                verifyEnabled++;
            }
        }
    }
    console.log(`  Target entries disabled: ${verifyDisabled}/7`);
    if (verifyEnabled > 0) {
        throw new Error(`${verifyEnabled} target entries are still enabled!`);
    }
    console.log('  ✓ All 7 target entries are disabled');

    // Verify other entries are unchanged
    const otherEntries = verifyEntries.filter(e => !TARGET_COMMENTS.includes(e.comment));
    const otherDisabled = otherEntries.filter(e => e.disable === true);
    console.log(`  Other entries: ${otherEntries.length} (${otherDisabled.length} with disable=true)`);

    // Verify PNG signature
    const verifyBuf = fs.readFileSync(PNG_PATH);
    if (!verifyBuf.slice(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Verification failed: PNG has invalid signature!');
    }
    console.log('  ✓ PNG signature valid');

    // Verify chara and ccv3 are consistent
    const verifyCcv3Chunk = findTextChunk(verifyChunks, 'ccv3');
    if (!verifyCcv3Chunk) throw new Error('Verification failed: ccv3 tEXt chunk not found');
    const verifyCcv3Obj = decodeTextChunkData(verifyCcv3Chunk);
    if (JSON.stringify(verifyObj) !== JSON.stringify(verifyCcv3Obj)) {
        throw new Error('Verification failed: chara and ccv3 JSON differ!');
    }
    console.log('  ✓ chara and ccv3 JSON are consistent');

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Backup: ${BAK_PATH}`);
    console.log(`Entries disabled: ${disabledCount}`);
    console.log(`Entries already disabled: ${alreadyDisabled}`);
    console.log(`Original PNG: ${originalPngBuf.length} bytes`);
    console.log(`New PNG: ${newPng.length} bytes`);
    console.log(`Size change: ${newPng.length - originalPngBuf.length} bytes`);
    console.log('\n=== Done ===');
}

main();
