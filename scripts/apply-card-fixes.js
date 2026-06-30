#!/usr/bin/env node
'use strict';

/**
 * apply-card-fixes.js
 * Applies 3 fixes to the SAO character card JSON and re-embeds into PNG.
 *
 * C1: Disable legacy worldbook entries (id 129, 5, 40, 171)
 * L16: Anchor "开场白" findRegex from "prologue" → "^prologue$"
 * L17: Move meta-instruction from alternate_greetings[0] to creator_notes
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.bak.png';

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

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== apply-card-fixes ===\n');

    // (1) Read JSON
    const jsonStr = fs.readFileSync(JSON_PATH, 'utf8');
    const obj = JSON.parse(jsonStr);
    const wb = obj.data?.character_book?.entries || [];
    let fixes = 0;

    // ── C1: Disable legacy worldbook entries ──
    const DISABLE_IDS = [129, 5, 40, 171];
    for (const id of DISABLE_IDS) {
        const entry = wb.find(e => e.id === id);
        if (!entry) {
            console.error(`  ⚠ worldbook entry id=${id} not found`);
            continue;
        }
        if (entry.enabled === false) {
            console.log(`  id=${id} (${entry.comment}) already disabled`);
        } else {
            entry.enabled = false;
            fixes++;
            console.log(`  ✓ id=${id} (${entry.comment}) → enabled: false`);
        }
    }

    // ── L16: Anchor "开场白" findRegex ──
    const scripts = obj.data?.extensions?.regex_scripts || [];
    const kaiScript = scripts.find(s => s.scriptName === '开场白');
    if (!kaiScript) {
        throw new Error('Regex script "开场白" not found');
    }
    const oldRegex = kaiScript.findRegex;
    if (oldRegex === 'prologue') {
        kaiScript.findRegex = '^prologue$';
        fixes++;
        console.log(`  ✓ 开场白 findRegex: "prologue" → "^prologue$"`);
    } else {
        console.log(`  ⚠ 开场白 findRegex is "${oldRegex}" (unexpected, skipping)`);
    }

    // ── L17: Move meta-instruction from alternate_greetings[0] ──
    const altGreetings = obj.data?.alternate_greetings || [];
    const greeting0 = altGreetings[0] || '';
    const triggerWord = 'prologue';
    const crlf = '\r\n';
    const expectedPrefix = triggerWord + crlf;

    if (greeting0.startsWith(expectedPrefix)) {
        const instructionText = greeting0.slice(expectedPrefix.length);
        // Append to creator_notes
        const existingNotes = obj.data.creator_notes || '';
        obj.data.creator_notes = existingNotes + '\n' + instructionText;
        // Keep greeting as just "prologue"
        altGreetings[0] = triggerWord;
        fixes++;
        console.log(`  ✓ alternate_greetings[0]: moved ${instructionText.length} chars of meta-instruction to creator_notes`);
        console.log(`    greeting[0] now: "${triggerWord}"`);
    } else if (greeting0 === triggerWord) {
        console.log(`  ⚠ alternate_greetings[0] already just "${triggerWord}"`);
    } else {
        console.log(`  ⚠ alternate_greetings[0] unexpected format, skipping`);
    }

    console.log(`\n  Total fixes applied: ${fixes}`);

    // (2) Re-embed into PNG first, then write JSON — so both succeed or both fail
    const compactJson = JSON.stringify(obj);
    console.log('\n--- PNG re-embed ---');

    // Backup original PNG
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`✓ Created backup: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH}`);
    }

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
    console.log(`  chara chunk: ${charaIdx}, ccv3 chunk: ${ccv3Idx}`);

    if (charaIdx === -1 || ccv3Idx === -1) {
        throw new Error('chara or ccv3 tEXt chunk not found in PNG');
    }

    // Base64 encode updated JSON
    const newBase64 = Buffer.from(compactJson, 'utf8').toString('base64');
    console.log(`  base64 length: ${newBase64.length} bytes`);

    // Replace both chunks
    const charaTextData = buildTextChunkData('chara', newBase64);
    const ccv3TextData = buildTextChunkData('ccv3', newBase64);
    chunks[charaIdx] = { type: 'tEXt', data: charaTextData };
    chunks[ccv3Idx] = { type: 'tEXt', data: ccv3TextData };

    // Rebuild PNG
    const newPng = buildPng(chunks);
    console.log(`  New PNG size: ${newPng.length} bytes`);

    // Atomic write with cleanup: write to .tmp, then rename
    const tmpPath = PNG_PATH + '.tmp';
    try {
        fs.writeFileSync(tmpPath, newPng);
        fs.renameSync(tmpPath, PNG_PATH);
    } catch (err) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore cleanup error */ }
        }
        throw err;
    }
    console.log(`✓ Wrote ${PNG_PATH} atomically`);

    // (3) Write JSON AFTER PNG succeeds — both succeed or both fail
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // (4) Verify: re-read PNG and check both chara and ccv3 chunks
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

    function verifyChunk(chunkLabel, verifyObj) {
        const entries = verifyObj.data?.character_book?.entries || [];
        for (const id of DISABLE_IDS) {
            const e = entries.find(x => x.id === id);
            if (e?.enabled !== false) {
                throw new Error(`Verification failed (${chunkLabel}): entry id=${id} is not disabled`);
            }
        }
        const vScript = verifyObj.data?.extensions?.regex_scripts?.find(s => s.scriptName === '开场白');
        if (vScript?.findRegex !== '^prologue$') {
            throw new Error(`Verification failed (${chunkLabel}): findRegex not updated`);
        }
        if (verifyObj.data?.alternate_greetings?.[0] !== 'prologue') {
            throw new Error(`Verification failed (${chunkLabel}): greeting[0] not updated`);
        }
    }

    const verifyChunks = readPngChunks(PNG_PATH);

    const verifyCharaChunk = findTextChunk(verifyChunks, 'chara');
    if (!verifyCharaChunk) throw new Error('Verification failed: chara tEXt chunk not found');
    verifyChunk('chara', decodeTextChunkData(verifyCharaChunk));

    const verifyCcv3Chunk = findTextChunk(verifyChunks, 'ccv3');
    if (!verifyCcv3Chunk) throw new Error('Verification failed: ccv3 tEXt chunk not found');
    verifyChunk('ccv3', decodeTextChunkData(verifyCcv3Chunk));

    console.log('\n✓ PNG verification passed — all fixes confirmed in both chara and ccv3');

    console.log('\n=== Done ===');
}

main();
