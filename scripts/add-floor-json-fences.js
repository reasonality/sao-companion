#!/usr/bin/env node
'use strict';

/**
 * add-floor-json-fences.js
 * Appends a ```worldbook-data JSON fence to each of the 99 floor worldbook
 * entries in the SAO character card, providing structured floor data alongside
 * the existing markdown prose (dual-format).
 *
 * Reads floor data from _patches/floor_data_collected.json, then for each
 * entry whose comment contains "第N层":
 *   - Parses floor number(s)
 *   - Looks up floor data
 *   - Appends a compact JSON fenced block to the entry's content
 *   - Skips entries that already have the fence (idempotent)
 *
 * Special handling for the merged 65/66 entry (comment="sao-第65层第66层").
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_json_fence.png';
const FLOOR_DATA_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/sao-companion/_patches/floor_data_collected.json';

const FENCE_OPEN = '```worldbook-data';
const FENCE_CLOSE = '```';

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

// ── Floor fence helpers ────────────────────────────────────────────────

/**
 * Parse floor numbers from a comment string.
 * "sao-第1层" → [1]
 * "sao-第65层第66层" → [65, 66]
 * Returns null if no floor numbers found.
 */
function parseFloorNumbers(comment) {
    if (!comment) return null;
    const matches = comment.match(/第(\d+)层/g);
    if (!matches || matches.length === 0) return null;
    return matches.map(m => parseInt(m.replace(/[^0-9]/g, '')));
}

/**
 * Build the compact JSON object for one floor from floor_data_collected.json.
 */
function buildFloorJsonObject(floorNum, floorData) {
    const d = floorData[String(floorNum)] || {};
    return {
        floor_number: floorNum,
        theme: d.name || '',
        mainTown: d.main_town || '',
        labyrinth: d.labyrinth || '',
        boss: d.boss || '',
        notes: d.notes || '',
        source: 'external'
    };
}

/**
 * Build the fenced block to append.
 * For a single floor: one JSON object.
 * For merged floors (65/66): an array of objects.
 */
function buildFenceBlock(floorNums, floorData) {
    let jsonObj;
    if (floorNums.length === 1) {
        jsonObj = buildFloorJsonObject(floorNums[0], floorData);
    } else {
        // Merged entry: array of objects
        jsonObj = floorNums.map(n => buildFloorJsonObject(n, floorData));
    }
    const compactJson = JSON.stringify(jsonObj);
    return `\n\n${FENCE_OPEN}\n${compactJson}\n${FENCE_CLOSE}\n`;
}

/**
 * Check if content already has a worldbook-data fence at the end (idempotent).
 */
function hasExistingFence(content) {
    // Look for ```worldbook-data ... ``` near the end
    // Be lenient: allow trailing whitespace after the closing fence
    const regex = /```worldbook-data\s*\n[\s\S]*?\n\s*```\s*$/;
    return regex.test(content);
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== add-floor-json-fences ===\n');

    // (1) Read floor data
    console.log('Reading floor data...');
    const floorDataRaw = JSON.parse(fs.readFileSync(FLOOR_DATA_PATH, 'utf8'));
    const floorData = floorDataRaw.floors;
    console.log(`  Loaded data for ${Object.keys(floorData).length} floors`);

    // (2) Read existing PNG
    console.log('\nReading existing PNG...');
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

    // Decode chara chunk
    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // (3) Process entries
    const entries = obj.data?.character_book?.entries || [];
    console.log(`\nTotal worldbook entries: ${entries.length}`);

    // Find floor entries by comment pattern
    const FLOOR_COMMENT_RE = /第(\d+)层/;
    let processed = 0;
    let skipped = 0;
    let alreadyHasFence = 0;
    const processedEntries = [];

    for (const entry of entries) {
        const comment = entry.comment || '';
        if (!FLOOR_COMMENT_RE.test(comment)) continue;

        const floorNums = parseFloorNumbers(comment);
        if (!floorNums) {
            console.log(`  ⚠ Could not parse floor numbers from: "${comment}"`);
            continue;
        }

        // Check for existing fence (idempotent)
        if (hasExistingFence(entry.content || '')) {
            alreadyHasFence++;
            skipped++;
            console.log(`  ↷ ${comment}: already has worldbook-data fence, skipping`);
            continue;
        }

        // Build fence block
        const fenceBlock = buildFenceBlock(floorNums, floorData);

        // Append to content
        const oldLen = (entry.content || '').length;
        entry.content = (entry.content || '') + fenceBlock;
        processed++;
        processedEntries.push({
            comment,
            floorNums,
            oldLen,
            newLen: entry.content.length,
            addedLen: fenceBlock.length
        });
    }

    console.log(`\n  Processed: ${processed} entries`);
    console.log(`  Already had fence (skipped): ${alreadyHasFence}`);
    console.log(`  Total floor entries found: ${processed + alreadyHasFence}`);

    // (4) Backup PNG
    console.log('\nBacking up PNG...');
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH}`);
    }

    // (5) Write back to PNG
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
    console.log(`  Size change: +${newPng.length - originalPngBuf.length} bytes (+${((newPng.length - originalPngBuf.length) / 1024).toFixed(1)} KB)`);

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

    // (6) Update extracted JSON
    console.log('\nUpdating extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // (7) Verification
    console.log('\n=== Verification ===');

    // Re-read PNG and verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyCharaChunk = findTextChunk(verifyChunks, 'chara');
    if (!verifyCharaChunk) throw new Error('Verification failed: chara tEXt chunk not found');
    const verifyObj = decodeTextChunkData(verifyCharaChunk);
    const verifyEntries = verifyObj.data?.character_book?.entries || [];

    // Count entries with worldbook-data fences
    let fencedCount = 0;
    let parsedJsonCount = 0;
    let failedJsonParses = [];

    for (const entry of verifyEntries) {
        const comment = entry.comment || '';
        if (!FLOOR_COMMENT_RE.test(comment)) continue;

        if (hasExistingFence(entry.content || '')) {
            fencedCount++;

            // Extract and verify the JSON inside the fence
            const fenceMatch = (entry.content || '').match(/```worldbook-data\s*\n([\s\S]*?)\n\s*```/);
            if (fenceMatch) {
                try {
                    const parsed = JSON.parse(fenceMatch[1]);
                    // Check if it's an array (merged entry) or single object
                    if (Array.isArray(parsed)) {
                        for (const obj of parsed) {
                            if (typeof obj.floor_number !== 'number') throw new Error('Missing floor_number');
                            if (obj.source !== 'external') throw new Error('Missing source=external');
                        }
                    } else {
                        if (typeof parsed.floor_number !== 'number') throw new Error('Missing floor_number');
                        if (parsed.source !== 'external') throw new Error('Missing source=external');
                    }
                    parsedJsonCount++;
                } catch (e) {
                    failedJsonParses.push({ comment, error: e.message });
                }
            }
        }
    }

    console.log(`  Total entries: ${verifyEntries.length}`);
    console.log(`  Floor entries with worldbook-data fence: ${fencedCount}`);
    console.log(`  Successfully parsed JSON fences: ${parsedJsonCount}`);

    if (failedJsonParses.length > 0) {
        console.error(`  ⚠ Failed to parse ${failedJsonParses.length} fence(s):`);
        for (const f of failedJsonParses) {
            console.error(`    ${f.comment}: ${f.error}`);
        }
    } else {
        console.log('  ✓ All fence JSONs parsed successfully');
    }

    // Verify PNG signature
    const verifyBuf = fs.readFileSync(PNG_PATH);
    if (!verifyBuf.slice(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Verification failed: PNG has invalid signature!');
    }
    console.log('  ✓ PNG signature valid');

    // Verify chara and ccv3 produce same JSON
    const verifyCcv3Chunk = findTextChunk(verifyChunks, 'ccv3');
    if (!verifyCcv3Chunk) throw new Error('Verification failed: ccv3 tEXt chunk not found');
    const verifyCcv3Obj = decodeTextChunkData(verifyCcv3Chunk);
    const charaCompact = JSON.stringify(verifyObj);
    const ccv3Compact = JSON.stringify(verifyCcv3Obj);
    if (charaCompact !== ccv3Compact) {
        throw new Error('Verification failed: chara and ccv3 JSON differ!');
    }
    console.log('  ✓ chara and ccv3 JSON are consistent');

    // Verify JSON file matches PNG
    const jsonFile = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    if (JSON.stringify(jsonFile) !== charaCompact) {
        throw new Error('Verification failed: extracted JSON does not match PNG!');
    }
    console.log('  ✓ Extracted JSON matches PNG');

    // Sample a few entries
    console.log('\n=== Sample fenced entries ===');
    const sampleComments = ['sao-第1层', 'sao-第75层', 'sao-第65层第66层'];
    for (const sc of sampleComments) {
        const e = verifyEntries.find(x => x.comment === sc);
        if (e) {
            const fenceMatch = (e.content || '').match(/```worldbook-data\s*\n([\s\S]*?)\n\s*```/);
            if (fenceMatch) {
                const parsed = JSON.parse(fenceMatch[1]);
                console.log(`  ${sc}:`);
                console.log(`    ${JSON.stringify(parsed)}`);
            }
        }
    }

    // (8) Run verify-card-regex.js if it exists
    console.log('\n=== Running verify-card-regex.js ===');
    const verifyScriptPath = path.join(__dirname, 'verify-card-regex.js');
    if (fs.existsSync(verifyScriptPath)) {
        try {
            const { execSync } = require('child_process');
            const result = execSync(`node "${verifyScriptPath}"`, {
                encoding: 'utf8',
                cwd: path.dirname(PNG_PATH)
            });
            console.log(result);
        } catch (e) {
            console.error(`  ⚠ verify-card-regex.js exited with code ${e.status}`);
            console.error(e.stdout || '');
            console.error(e.stderr || '');
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Backup: ${BAK_PATH}`);
    console.log(`Fences appended: ${processed}`);
    console.log(`Already had fence (skipped): ${alreadyHasFence}`);
    console.log(`Total fenced: ${fencedCount}`);
    console.log(`Original PNG: ${originalPngBuf.length} bytes`);
    console.log(`New PNG: ${newPng.length} bytes`);
    console.log(`Size change: +${newPng.length - originalPngBuf.length} bytes`);

    if (fencedCount === processed + alreadyHasFence && failedJsonParses.length === 0) {
        console.log('\n✓ All floor entries have valid worldbook-data fences!');
    } else {
        console.log('\n⚠ Some entries may need attention — see warnings above.');
        process.exit(1);
    }
}

main();
