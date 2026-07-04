#!/usr/bin/env node
'use strict';

/**
 * update-version.js
 * Updates version strings in the SAO character card from v1.9.5 to v2.0.0.
 *
 * Targets:
 *   1. data.character_book.name  — "刀剑神域SAO v1.9.5" → "刀剑神域SAO v2.0.0"
 *   2. data.extensions.world     — "刀剑神域SAO v1.9.5" → "刀剑神域SAO v2.0.0"
 *
 * Does NOT change data.name ("刀剑神域SAO" without version).
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

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== update-version ===\n');

    // ── Read original PNG size ──────────────────────────────────────────
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

    // ── Find version strings ────────────────────────────────────────────
    console.log('\nScanning for version strings...');
    const fullJson = JSON.stringify(obj);
    const versionMatches = [...new Set(fullJson.match(/v\d+\.\d+\.\d+/g) || [])];
    console.log(`  Version strings found: ${JSON.stringify(versionMatches)}`);

    const OLD_VERSION = 'v1.9.5';
    const NEW_VERSION = 'v2.0.0';

    // ── Step 1: Update character_book.name ──────────────────────────────
    console.log('\nStep 1: Update character_book.name...');
    const bookName = obj.data.character_book?.name;
    console.log(`  Current: "${bookName}"`);
    if (bookName && bookName.includes(OLD_VERSION)) {
        obj.data.character_book.name = bookName.replace(OLD_VERSION, NEW_VERSION);
        console.log(`  Updated: "${obj.data.character_book.name}"`);
    } else {
        console.log('  ⚠ No version string found in character_book.name');
    }

    // ── Step 2: Update extensions.world ─────────────────────────────────
    console.log('\nStep 2: Update extensions.world...');
    const worldName = obj.data.extensions?.world;
    console.log(`  Current: "${worldName}"`);
    if (worldName && worldName.includes(OLD_VERSION)) {
        obj.data.extensions.world = worldName.replace(OLD_VERSION, NEW_VERSION);
        console.log(`  Updated: "${obj.data.extensions.world}"`);
    } else {
        console.log('  ⚠ No version string found in extensions.world');
    }

    // ── Step 3: Verify data.name unchanged ──────────────────────────────
    console.log('\nStep 3: Verify data.name unchanged...');
    console.log(`  data.name: "${obj.data.name}"`);
    if (obj.data.name.includes(NEW_VERSION)) {
        throw new Error(`data.name unexpectedly contains ${NEW_VERSION}`);
    }
    console.log('  ✓ data.name does NOT contain version string');

    // ── Step 4: Verify no remaining old version strings ─────────────────
    console.log('\nStep 4: Verify no remaining old version strings...');
    const updatedJson = JSON.stringify(obj);
    if (updatedJson.includes(OLD_VERSION)) {
        throw new Error(`Old version string ${OLD_VERSION} still found in JSON!`);
    }
    console.log(`  ✓ No "${OLD_VERSION}" remaining`);

    const newVersionCount = (updatedJson.match(new RegExp(NEW_VERSION.replace('.', '\\.'), 'g')) || []).length;
    console.log(`  ${NEW_VERSION} occurrences: ${newVersionCount}`);

    // ── Step 5: Write PNG ───────────────────────────────────────────────
    console.log('\nStep 5: Write updated PNG...');
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

    // ── Step 6: Sync extracted JSON ─────────────────────────────────────
    console.log('\nStep 6: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Summary ─────────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`PNG size: ${originalPngBuf.length} → ${newPng.length} (${newPng.length - originalPngBuf.length} bytes)`);
    console.log(`Fields updated:`);
    console.log(`  - data.character_book.name: "${obj.data.character_book.name}"`);
    console.log(`  - data.extensions.world: "${obj.data.extensions.world}"`);
    console.log(`  - data.name: "${obj.data.name}" (unchanged)`);
    console.log(`\n✓ Done!`);
}

main();
