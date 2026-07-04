#!/usr/bin/env node
'use strict';

/**
 * trim-format-entries.js
 * 1. Deletes 4 redundant disabled format entries from character_book
 * 2. Fixes entry 150's npc_thoughts inconsistency (title says 去掉, content still has it)
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
    console.log('=== trim-format-entries ===\n');

    // ── Step 0: Record original size ────────────────────────────────────
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`Step 0: Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    // Verify JSON matches
    const jsonContent = fs.readFileSync(JSON_PATH, 'utf8');
    const jsonObj = JSON.parse(jsonContent);
    console.log(`  Extracted JSON entries: ${jsonObj.data.character_book.entries.length}`);

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

    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // ── Step 1a: Delete 4 redundant entries ─────────────────────────────
    console.log('\nStep 1a: Delete 4 redundant entries...');
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;

    const DELETE_COMMENTS = [
        'sao格式全部版，记得关之前的sao格式开双优先思维链和sao公会',
        'sao格式（去掉行动action，记得关sao格式和行动2）',
        'sao注意事项（可能的错误）',
        'sao战斗流程设定',
    ];

    const deleted = [];
    for (const comment of DELETE_COMMENTS) {
        const idx = entries.findIndex(e => e.comment === comment);
        if (idx === -1) {
            console.log(`  ⚠ NOT FOUND: "${comment}"`);
        } else {
            console.log(`  ✓ Found at index ${idx}: "${comment}"`);
            deleted.push({ index: idx, comment });
        }
    }

    if (deleted.length !== DELETE_COMMENTS.length) {
        throw new Error(`Expected to find ${DELETE_COMMENTS.length} entries, found ${deleted.length}`);
    }

    obj.data.character_book.entries = entries.filter(e => !DELETE_COMMENTS.includes(e.comment));
    const afterCount = obj.data.character_book.entries.length;
    console.log(`  Entries: ${beforeCount} → ${afterCount} (deleted ${beforeCount - afterCount})`);

    // Verify keepers still exist
    const KEEP_COMMENTS = [
        'sao-格式（去掉<map><npc_thoughts><guild>）',
        'sao-注意事项（可能的错误）',
        'sao-战斗流程设定',
    ];
    for (const comment of KEEP_COMMENTS) {
        const idx = obj.data.character_book.entries.findIndex(e => e.comment === comment);
        if (idx === -1) {
            throw new Error(`KEPT entry missing: "${comment}"`);
        }
        console.log(`  ✓ Kept: "${comment}" (index ${idx})`);
    }

    // ── Step 1b: Fix entry 150 npc_thoughts ─────────────────────────────
    console.log('\nStep 1b: Fix entry 150 npc_thoughts...');
    const targetComment = 'sao-格式（去掉<map><npc_thoughts><guild>）';
    const entry150 = obj.data.character_book.entries.find(e => e.comment === targetComment);
    if (!entry150) {
        throw new Error(`Could not find entry with comment: "${targetComment}"`);
    }

    const origContent = entry150.content;

    // Count npc_thoughts occurrences before
    const npcCountBefore = (origContent.match(/npc_thoughts/g) || []).length;
    console.log(`  npc_thoughts occurrences before: ${npcCountBefore}`);

    // Fix 1: Remove `-> \`<npc_thoughts>\`` from the Inside Content line
    let newContent = origContent.replace(
        /`<dice>` -> `<npc_thoughts>` -> Narrative/g,
        '`<dice>` -> Narrative'
    );

    // Fix 2: Remove the <npc_thoughts> block in the Ultra-Compact Example
    // Pattern: <npc_thoughts>\n... (Optional) ...\n</npc_thoughts>\n
    // We need to remove the block plus surrounding blank lines that would create double-blanks
    newContent = newContent.replace(
        /<npc_thoughts>\n[^\n]*\(Optional\)[^\n]*\n<\/npc_thoughts>\n?/g,
        ''
    );

    // Clean up any double blank lines that may have resulted
    newContent = newContent.replace(/\n{3,}/g, '\n\n');

    const npcCountAfter = (newContent.match(/npc_thoughts/g) || []).length;
    console.log(`  npc_thoughts occurrences after: ${npcCountAfter}`);

    if (npcCountAfter !== 0) {
        throw new Error(`Still found ${npcCountAfter} npc_thoughts occurrences — fix incomplete`);
    }

    entry150.content = newContent;
    console.log('  ✓ All npc_thoughts references removed');

    // ── Step 1c: Write PNG + sync JSON ──────────────────────────────────
    console.log('\nStep 1c: Write PNG + sync JSON...');
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

    // Atomic write PNG
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

    // Sync JSON
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH}`);

    // ── Step 2: Verify ──────────────────────────────────────────────────
    console.log('\nStep 2: Verify...');
    const verifyScriptPath = path.join(__dirname, 'verify-card-regex.js');
    const { execSync } = require('child_process');
    try {
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

    // ── Step 3: Sanity checks ───────────────────────────────────────────
    console.log('\nStep 3: Sanity checks...');
    let allPassed = true;

    // 1. PNG size
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);

    // 2. Entry count = 241
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (expected 241)`);
    if (entryCount !== 241) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 3. Deleted entries should NOT exist
    for (const comment of DELETE_COMMENTS) {
        const found = verifyObj.data.character_book.entries.some(e => e.comment === comment);
        console.log(`  [3] "${comment.substring(0, 30)}..." exists: ${found} (expected false)`);
        if (found) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }
    }

    // 4. Kept entries should STILL exist
    for (const comment of KEEP_COMMENTS) {
        const found = verifyObj.data.character_book.entries.some(e => e.comment === comment);
        console.log(`  [4] "${comment.substring(0, 30)}..." exists: ${found} (expected true)`);
        if (!found) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }
    }

    // 5. Entry 150 content should NOT contain npc_thoughts
    const e150 = verifyObj.data.character_book.entries.find(e => e.comment === targetComment);
    const npcInContent = (e150.content.match(/npc_thoughts/g) || []).length;
    console.log(`  [5] npc_thoughts in entry 150 content: ${npcInContent} (expected 0)`);
    if (npcInContent !== 0) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 6. Entry 150 content should still have core tags
    const hasOutputInstruction = e150.content.includes('<output_instruction>');
    const hasTime = e150.content.includes('<time>');
    const hasDice = e150.content.includes('<dice>');
    console.log(`  [6] <output_instruction>: ${hasOutputInstruction}, <time>: ${hasTime}, <dice>: ${hasDice}`);
    if (!hasOutputInstruction || !hasTime || !hasDice) { console.log('      ✗ FAIL'); allPassed = false; } else { console.log('      ✓ Pass'); }

    // 7. node --check on this script
    console.log(`  [7] node --check on trim-format-entries.js...`);
    try {
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('      ✓ Pass');
    } catch (e) {
        console.log(`      ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // ── Final summary ───────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Entries deleted: ${deleted.length}`);
    for (const d of deleted) console.log(`  - [${d.index}] "${d.comment}"`);
    console.log(`Entry 150 fix: removed ${npcCountBefore} npc_thoughts references`);
    console.log(`  - Line ~19: removed "-> \`<npc_thoughts>\`" from Inside Content sequence`);
    console.log(`  - Lines ~58-60: removed <npc_thoughts>...</npc_thoughts> example block`);
    console.log(`Entries: ${beforeCount} → ${afterCount}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
