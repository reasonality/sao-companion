#!/usr/bin/env node
'use strict';

/**
 * reorder-by-io.js
 * Reorders world book entries and assigns sequential insertion_order + display_index.
 *
 * Order:
 *   Enabled (io 1-32):
 *     1. Format/protocol (3): comments matching sao-格式|sao-数值|sao-标签
 *     2. Core rules (3): sao-世界设定|sao-注意事项|sao-NPC档案构建
 *     3. Gameplay rules (3): sao-PK|sao-经济|sao-等级
 *     4. Real-world NPC profiles (23): comments starting with 现实- or 桐人现实 or 桐子现实
 *
 *   Disabled (io 33-239):
 *     5. SAO NPC profiles (25): sao-xxx / 桐人saoxxx / 桐子saoxxx / 茅场 / 恭二 / 昌一 / 敦 + characterProfile
 *     6. Floor entries (100): sao-第N层, sorted by N
 *     7. Timeline entries (50): 时间线|时间表, sorted by date
 *     8. Remaining disabled (32): sorted alphabetically by comment
 *
 * After reordering:
 *   - insertion_order = array_index + 1  (1-based, sequential 1-239)
 *   - display_index = array_index        (0-based, sequential 0-238)
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

/** Enabled categories (1-4) */
const FORMAT_RE = /sao-格式|sao-数值|sao-标签/;
const CORE_RE = /sao-世界设定|sao-注意事项|sao-NPC档案构建/;
const GAMEPLAY_RE = /sao-PK|sao-经济|sao-等级/;
function isRealWorldNpc(entry) {
    const c = entry.comment || '';
    return c.startsWith('现实-') || c.startsWith('桐人现实') || c.startsWith('桐子现实');
}

/** Disabled categories (5-8) */
const SAO_NPC_PREFIXES = ['sao-', '桐人sao', '桐子sao', '茅场', '恭二', '昌一', '敦'];
function isSaoNpcProfile(entry) {
    const c = entry.comment || '';
    return SAO_NPC_PREFIXES.some(p => c.startsWith(p)) && (entry.content || '').includes('characterProfile');
}
function isFloorEntry(entry) {
    return /^sao-第\d+层$/.test(entry.comment || '');
}
function isTimelineEntry(entry) {
    return /时间线|时间表/.test(entry.comment || '');
}

/**
 * Classify into group 1-4 (enabled) or 5-8 (disabled).
 * Returns [group, sortKey] where sortKey is number or string.
 */
function classify(entry) {
    const c = entry.comment || '';
    if (entry.enabled) {
        if (FORMAT_RE.test(c))   return [1, c];
        if (CORE_RE.test(c))     return [2, c];
        if (GAMEPLAY_RE.test(c)) return [3, c];
        if (isRealWorldNpc(entry)) return [4, c];
        // Fallback enabled entry (shouldn't happen with 32 expected)
        return [4, c];
    } else {
        if (isSaoNpcProfile(entry)) return [5, c];
        if (isFloorEntry(entry)) {
            const m = c.match(/第(\d+)层/);
            return [6, m ? parseInt(m[1], 10) : 999999];
        }
        if (isTimelineEntry(entry)) {
            const m = c.match(/(\d{4})年(\d{1,2})月/);
            return [7, m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 999999];
        }
        return [8, c];
    }
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== reorder-by-io ===\n');

    // ── Record original PNG size ──────────────────────────────────────
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    const originalSize = originalPngBuf.length;
    console.log(`Original PNG size: ${originalSize} bytes (${(originalSize / 1024).toFixed(1)} KB)`);

    // ── Read & decode PNG ─────────────────────────────────────────────
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
    console.log(`  Entry count: ${beforeCount}`);

    // ── Step 1: Classify and sort ─────────────────────────────────────
    console.log('\nStep 1: Classifying and sorting entries...');

    // Build decorated array: [group, sortKey, entry]
    const decorated = entries.map(e => {
        const [group, key] = classify(e);
        return { group, key, entry: e };
    });

    // Sort: by group first, then by sortKey within group
    decorated.sort((a, b) => {
        if (a.group !== b.group) return a.group - b.group;
        const ka = a.key, kb = b.key;
        if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
        return String(ka).localeCompare(String(kb), 'zh-CN');
    });

    const reordered = decorated.map(d => d.entry);

    // ── Step 2: Assign insertion_order and display_index ──────────────
    console.log('\nStep 2: Assigning insertion_order and display_index...');
    for (let i = 0; i < reordered.length; i++) {
        reordered[i].insertion_order = i + 1;
        if (!reordered[i].extensions) reordered[i].extensions = {};
        reordered[i].extensions.display_index = i;
    }

    // Count by group
    const groupNames = {
        1: 'Format/protocol (enabled)',
        2: 'Core rules (enabled)',
        3: 'Gameplay rules (enabled)',
        4: 'Real-world NPC profiles (enabled)',
        5: 'SAO NPC profiles (disabled)',
        6: 'Floor entries (disabled)',
        7: 'Timeline entries (disabled)',
        8: 'Remaining disabled (misc)'
    };
    const groupCounts = {};
    for (const d of decorated) {
        groupCounts[d.group] = (groupCounts[d.group] || 0) + 1;
    }
    for (const [g, name] of Object.entries(groupNames)) {
        console.log(`  ${g}. ${name}: ${groupCounts[g] || 0} entries`);
    }

    // ── Step 3: Write PNG ─────────────────────────────────────────────
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

    // ── Step 4: Sync extracted JSON ───────────────────────────────────
    console.log('\nStep 4: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 5: Run verify script ─────────────────────────────────────
    console.log('\nStep 5: Running verify-card-regex.js...');
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
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // ── Step 6: Sanity checks ─────────────────────────────────────────
    console.log('\nStep 6: Sanity checks...');
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

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    check('PNG size recorded', true, `before=${originalSize}, after=${newSize}, delta=${newSize - originalSize}`);

    // 2. Entry count = 239
    check('Entry count = 239', vEntries.length === 239, `got ${vEntries.length}`);

    // 3. Entry[0]: io=1, enabled=true, comment=sao-标签 or sao-格式 or sao-数值
    const e0 = vEntries[0];
    check('Entry[0] io=1, enabled=true, format comment',
        e0.insertion_order === 1 && e0.enabled === true && FORMAT_RE.test(e0.comment || ''),
        `io=${e0.insertion_order}, enabled=${e0.enabled}, comment=${e0.comment}`);

    // 4. Entry[8]: io=9, enabled=true, comment=桐人现实 or 现实- (first real NPC)
    const e8 = vEntries[8];
    check('Entry[8] io=9, enabled=true, real NPC',
        e8.insertion_order === 9 && e8.enabled === true && isRealWorldNpc(e8),
        `io=${e8.insertion_order}, enabled=${e8.enabled}, comment=${e8.comment}`);

    // 5. Entry[31]: io=32, enabled=true (last enabled entry)
    const e31 = vEntries[31];
    check('Entry[31] io=32, enabled=true (last enabled)',
        e31.insertion_order === 32 && e31.enabled === true,
        `io=${e31.insertion_order}, enabled=${e31.enabled}, comment=${e31.comment}`);

    // 6. Entry[32]: io=33, enabled=false (first disabled entry, should be SAO NPC)
    const e32 = vEntries[32];
    check('Entry[32] io=33, enabled=false, SAO NPC',
        e32.insertion_order === 33 && e32.enabled === false && isSaoNpcProfile(e32),
        `io=${e32.insertion_order}, enabled=${e32.enabled}, comment=${e32.comment}`);

    // 7. Entry[57]: io=58, enabled=false (should be sao-第1层 if SAO NPC count is 25)
    const e57 = vEntries[57];
    check('Entry[57] io=58, enabled=false, sao-第1层',
        e57.insertion_order === 58 && e57.enabled === false && isFloorEntry(e57) && /第1层/.test(e57.comment),
        `io=${e57.insertion_order}, enabled=${e57.enabled}, comment=${e57.comment}`);

    // 8. Entry[156]: io=157, enabled=false (should be sao-第100层)
    const e156 = vEntries[156];
    check('Entry[156] io=157, enabled=false, sao-第100层',
        e156.insertion_order === 157 && e156.enabled === false && isFloorEntry(e156) && /第100层/.test(e156.comment),
        `io=${e156.insertion_order}, enabled=${e156.enabled}, comment=${e156.comment}`);

    // 9. Entry[157]: io=158, enabled=false (first timeline entry 2022年10月)
    const e157 = vEntries[157];
    check('Entry[157] io=158, enabled=false, first timeline 2022年10月',
        e157.insertion_order === 158 && e157.enabled === false && isTimelineEntry(e157) && /2022年10月/.test(e157.comment),
        `io=${e157.insertion_order}, enabled=${e157.enabled}, comment=${e157.comment}`);

    // 10. Entry[206]: io=207, enabled=false (last timeline entry 2026年11月)
    const e206 = vEntries[206];
    check('Entry[206] io=207, enabled=false, last timeline 2026年11月',
        e206.insertion_order === 207 && e206.enabled === false && isTimelineEntry(e206) && /2026年11月/.test(e206.comment),
        `io=${e206.insertion_order}, enabled=${e206.enabled}, comment=${e206.comment}`);

    // 11. Entry[238]: io=239, enabled=false (last entry overall)
    const e238 = vEntries[238];
    check('Entry[238] io=239, enabled=false (last entry)',
        e238.insertion_order === 239 && e238.enabled === false,
        `io=${e238.insertion_order}, enabled=${e238.enabled}, comment=${e238.comment}`);

    // 12. All io values sequential 1-239 no gaps
    const ioValues = vEntries.map(e => e.insertion_order);
    const ioSequential = ioValues.every((v, i) => v === i + 1);
    check('All io values sequential 1-239', ioSequential,
        `first=${ioValues[0]}, last=${ioValues[ioValues.length - 1]}`);

    // 13. All display_index values sequential 0-238 no gaps
    const diValues = vEntries.map(e => e.extensions ? e.extensions.display_index : undefined);
    const diSequential = diValues.every((v, i) => v === i);
    check('All display_index values sequential 0-238', diSequential,
        `first=${diValues[0]}, last=${diValues[diValues.length - 1]}`);

    // 14. All enabled entries have io < 33
    const enabledEntries = vEntries.filter(e => e.enabled);
    const enabledAllSmallIo = enabledEntries.every(e => e.insertion_order < 33);
    check('All enabled entries have io < 33', enabledAllSmallIo,
        `enabled count=${enabledEntries.length}, max io=${Math.max(...enabledEntries.map(e => e.insertion_order))}`);

    // 15. All disabled entries have io >= 33
    const disabledEntries = vEntries.filter(e => !e.enabled);
    const disabledAllBigIo = disabledEntries.every(e => e.insertion_order >= 33);
    check('All disabled entries have io >= 33', disabledAllBigIo,
        `disabled count=${disabledEntries.length}, min io=${Math.min(...disabledEntries.map(e => e.insertion_order))}`);

    // 16. node --check on this script
    console.log('  [16] node --check on reorder-by-io.js...');
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        check('node --check', true, 'no syntax errors');
    } catch (e) {
        check('node --check', false, e.message);
    }

    // ── Final report ──────────────────────────────────────────────────
    console.log('\n=== Report ===');

    console.log('\nFirst 10 entries:');
    vEntries.slice(0, 10).forEach((e, i) => {
        console.log(`  [${i}] io=${e.insertion_order} di=${e.extensions.display_index} enabled=${e.enabled} comment=${e.comment}`);
    });

    console.log('\nBoundary entries (31/32, 56/57, 156/157, 206/207):');
    for (const i of [31, 32, 56, 57, 156, 157, 206, 207]) {
        const e = vEntries[i];
        console.log(`  [${i}] io=${e.insertion_order} di=${e.extensions.display_index} enabled=${e.enabled} comment=${e.comment}`);
    }

    console.log('\nLast 5 entries:');
    vEntries.slice(-5).forEach((e, i) => {
        const idx = vEntries.length - 5 + i;
        console.log(`  [${idx}] io=${e.insertion_order} di=${e.extensions.display_index} enabled=${e.enabled} comment=${e.comment}`);
    });

    console.log(`\nPNG size: ${originalSize} → ${newSize} (${newSize - originalSize} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
