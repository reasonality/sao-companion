#!/usr/bin/env node
'use strict';

/**
 * remove-post-sao-timelines.js
 * Removes all post-SAO timeline world book entries from the SAO character card PNG.
 * SAO death game ends 2024-11-07. All timeline entries from 2024年12月 onward
 * describe post-SAO real-world events (Ordinal Scale, ALO, GGO, etc.).
 *
 * Deletes 18 entries (2024年12月 through 2026年5月).
 * Keeps 26 entries (2022年10月时间表 through 2024年11月时间线).
 * Keeps all non-timeline entries unchanged.
 * Does NOT reindex uids.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_timeline_trim.png';

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

// ── Timeline entry detection ───────────────────────────────────────────

const POST_SAO_TIMELINE_COMMENTS = new Set([
    '2024年12月时间线',
    '2025年1月时间线',
    '2025年2月时间线',
    '2025年3月时间线',
    '2025年4月时间线',
    '2025年5月时间线',
    '2025年6月时间线',
    '2025年7月时间线',
    '2025年8月时间线',
    '2025年9月时间线',
    '2025年10月时间线',
    '2025年11月时间线',
    '2025年12月时间线',
    '2026年1月时间线',
    '2026年2月时间线',
    '2026年3月时间线',
    '2026年4月时间线',
    '2026年5月时间线',
]);

function isPostSaoTimeline(entry) {
    return POST_SAO_TIMELINE_COMMENTS.has(entry.comment || '');
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== remove-post-sao-timelines ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        const bakSize = fs.statSync(BAK_PATH).size;
        if (bakSize === originalPngBuf.length) {
            console.log(`  Backup already exists and size matches: ${BAK_PATH} (${bakSize} bytes) — OK`);
        } else {
            console.log(`  ABORT: Backup exists but size mismatch! Original: ${originalPngBuf.length}, Backup: ${bakSize}`);
            process.exit(1);
        }
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

    // ── Step 1: Delete post-SAO timeline entries ────────────────────────
    console.log('\nStep 1: Delete post-SAO timeline entries...');
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;

    // Count and list entries to delete
    const toDelete = entries.filter(e => isPostSaoTimeline(e));
    console.log(`  Total entries: ${beforeCount}`);
    console.log(`  Post-SAO timeline entries to delete: ${toDelete.length}`);
    for (const e of toDelete) {
        console.log(`    - ${e.comment}`);
    }

    obj.data.character_book.entries = entries.filter(e => !isPostSaoTimeline(e));
    const afterCount = obj.data.character_book.entries.length;
    console.log(`  Entries: ${beforeCount} → ${afterCount} (deleted ${beforeCount - afterCount})`);

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
        allPassed = false;
    } else {
        console.log('      ✓ New PNG is smaller');
    }

    // 2. Entry count = 225
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (expected 225)`);
    if (entryCount !== 225) {
        console.log('      ✗ FAIL: Expected 225');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. No entry comment matches ^(2024年1[2-9]月|2025年|2026年)
    const postSaoRemaining = verifyObj.data.character_book.entries.filter(e => {
        const c = e.comment || '';
        return /^(2024年1[2-9]月|2025年|2026年)/.test(c);
    });
    console.log(`  [3] Post-SAO entries remaining: ${postSaoRemaining.length} (expected 0)`);
    if (postSaoRemaining.length !== 0) {
        console.log('      ✗ FAIL: Post-SAO entries still present:');
        for (const e of postSaoRemaining) console.log(`        - ${e.comment}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 4. Timeline entries remaining = 26
    const timelineRemaining = verifyObj.data.character_book.entries.filter(e => /时间[线表]/.test(e.comment || ''));
    console.log(`  [4] Timeline entries remaining: ${timelineRemaining.length} (expected 26)`);
    if (timelineRemaining.length !== 26) {
        console.log('      ✗ FAIL: Expected 26');
        for (const e of timelineRemaining) console.log(`        - ${e.comment}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 5. 2024年11月时间线 exists
    const hasNov2024 = verifyObj.data.character_book.entries.some(e => e.comment === '2024年11月时间线');
    console.log(`  [5] 2024年11月时间线 exists: ${hasNov2024} (expected true)`);
    if (!hasNov2024) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 6. 2022年10月时间表 exists
    const hasOct2022 = verifyObj.data.character_book.entries.some(e => e.comment === '2022年10月时间表');
    console.log(`  [6] 2022年10月时间表 exists: ${hasOct2022} (expected true)`);
    if (!hasOct2022) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 7. node --check on the script itself
    console.log(`  [7] node --check on remove-post-sao-timelines.js...`);
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
    console.log(`Backup: ${BAK_PATH} (${fs.existsSync(BAK_PATH) ? fs.statSync(BAK_PATH).size : 'not found'} bytes)`);
    console.log(`Entries deleted: ${beforeCount - afterCount}`);
    for (const e of toDelete) console.log(`  - ${e.comment}`);
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
