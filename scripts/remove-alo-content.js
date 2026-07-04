#!/usr/bin/env node
'use strict';

/**
 * remove-alo-content.js
 * Removes all ALO (旧alo / 新生alo) content from the SAO character card PNG.
 * Keeps sao / ggo / real chapters only.
 *
 * Changes:
 *  1. Delete 45 ALO world book entries (by comment pattern)
 *  2. Edit "开场白" replaceString to remove ALO UI/JS references
 *  3. Delete alternate_greetings[2] (旧alo开场白)
 *
 * Both chara and ccv3 tEXt chunks are updated identically.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_alo_removal.png';

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

// ── ALO detection helpers ──────────────────────────────────────────────

function isAloEntry(entry) {
    const c = entry.comment || '';
    return c.startsWith('旧alo') ||
           c.startsWith('新生alo') ||
           /^桐人.*alo/.test(c) ||
           /^桐子.*alo/.test(c);
}

// ── Opener replaceString editing ───────────────────────────────────────

function editOpenerReplaceString(rs) {
    const lines = rs.split('\n');
    const result = [];
    let i = 0;
    let changesMade = [];

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // --- 1. Delete ALO world-option div (lines ~401-404) ---
        // Match: <div class="timeline-option world-option" data-world="alo">
        // through its closing </div> (the one with timeline-desc inside)
        if (trimmed.includes('class="timeline-option world-option"') &&
            trimmed.includes('data-world="alo"')) {
            // Skip this div and its children until we hit the closing </div>
            // The structure is: <div ...> ... <div class="timeline-title">...</div> ... <div class="timeline-desc">...</div> ... </div>
            // We need to find the matching closing </div>
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                // Count div opens/closes
                const opens = (l.match(/<div[\s>]/g) || []).length;
                const closes = (l.match(/<\/div>/g) || []).length;
                depth += opens - closes;
                i++;
                if (depth <= 0) break;
            }
            changesMade.push('Deleted ALO world-option div');
            continue;
        }

        // --- 2. Delete ALO篇 timeline-category block (lines ~449-461) ---
        // Match: <!-- ALO篇 --> comment or the <div class="timeline-category"> with 🧚 ALO篇
        if (trimmed === '<!-- ALO篇 -->') {
            // Skip the comment line, then the following timeline-category div
            i++;
            // Now we should be at <div class="timeline-category">
            while (i < lines.length && !lines[i].trim().startsWith('<div class="timeline-category"')) {
                i++;
            }
            // Now at the <div class="timeline-category"> — skip until its closing </div>
            if (i < lines.length) {
                let depth = 0;
                while (i < lines.length) {
                    const l = lines[i];
                    const opens = (l.match(/<div[\s>]/g) || []).length;
                    const closes = (l.match(/<\/div>/g) || []).length;
                    depth += opens - closes;
                    i++;
                    if (depth <= 0) break;
                }
            }
            // Also skip any blank line after
            while (i < lines.length && lines[i].trim() === '') i++;
            changesMade.push('Deleted ALO篇 timeline-category block');
            continue;
        }

        // --- 3. Delete alo entry from worldConfigs (lines ~671-675) ---
        // Pattern: lines like "        alo: {" followed by name/prefix/displayName and closing "        },"
        if (/^\s+alo:\s*\{/.test(line)) {
            // Skip until we find the closing "},"
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                const opens = (l.match(/\{/g) || []).length;
                const closes = (l.match(/\}/g) || []).length;
                depth += opens - closes;
                i++;
                if (depth <= 0) {
                    // Skip trailing comma line if present (it's on the same line as })
                    break;
                }
            }
            // Also skip a trailing comma-only line
            if (i < lines.length && /^\s*,\s*$/.test(lines[i])) {
                i++;
            }
            changesMade.push('Deleted alo from worldConfigs');
            continue;
        }

        // --- 4. Simplify toggleGameInfo: remove "|| world === 'alo'" ---
        // Line: if (world === 'sao' || world === 'alo') {
        if (line.includes("world === 'sao' || world === 'alo'") ||
            line.includes("world === \"sao\" || world === \"alo\"")) {
            result.push(line.replace(/ \|\| world === 'alo'/, '').replace(/ \|\| world === "alo"/, ''));
            i++;
            changesMade.push('Simplified toggleGameInfo condition');
            continue;
        }

        // --- 5. Simplify generateCharacterProfile: remove "|| characterData.world === 'alo'" ---
        if (line.includes("characterData.world === 'sao' || characterData.world === 'alo'") ||
            line.includes("characterData.world === \"sao\" || characterData.world === \"alo\"")) {
            result.push(line.replace(/ \|\| characterData.world === 'alo'/, '').replace(/ \|\| characterData.world === "alo"/, ''));
            i++;
            changesMade.push('Simplified generateCharacterProfile condition');
            continue;
        }

        // --- 6. Update comment "// SAO/ALO 元素" → "// SAO 元素" ---
        if (line.includes('// SAO/ALO 元素')) {
            result.push(line.replace('// SAO/ALO 元素', '// SAO 元素'));
            i++;
            changesMade.push('Updated SAO/ALO comment to SAO');
            continue;
        }

        // --- 7. Update comment "<!-- SAO/ALO 游戏信息 -->" → "<!-- SAO 游戏信息 -->" ---
        if (line.includes('<!-- SAO/ALO 游戏信息 -->')) {
            result.push(line.replace('<!-- SAO/ALO 游戏信息 -->', '<!-- SAO 游戏信息 -->'));
            i++;
            changesMade.push('Updated SAO/ALO game-info comment');
            continue;
        }

        // Default: keep the line
        result.push(line);
        i++;
    }

    return { text: result.join('\n'), changesMade };
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== remove-alo-content ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        const bakSize = fs.statSync(BAK_PATH).size;
        console.log(`  Backup already exists: ${BAK_PATH} (${bakSize} bytes) — preserving existing backup`);
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

    // ── Step 1a: Delete ALO world book entries ──────────────────────────
    console.log('\nStep 1a: Delete ALO world book entries...');
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;

    // Count by category for reporting
    let countJialo = 0;
    let countXinShengAlo = 0;
    let countTongrenAlo = 0;
    let countTongziAlo = 0;

    for (const e of entries) {
        const c = e.comment || '';
        if (c.startsWith('旧alo')) countJialo++;
        else if (c.startsWith('新生alo')) countXinShengAlo++;
        else if (/^桐人.*alo/.test(c)) countTongrenAlo++;
        else if (/^桐子.*alo/.test(c)) countTongziAlo++;
    }

    console.log(`  旧alo entries: ${countJialo}`);
    console.log(`  新生alo entries: ${countXinShengAlo}`);
    console.log(`  桐人*alo entries: ${countTongrenAlo}`);
    console.log(`  桐子*alo entries: ${countTongziAlo}`);
    console.log(`  Total ALO entries to delete: ${countJialo + countXinShengAlo + countTongrenAlo + countTongziAlo}`);

    obj.data.character_book.entries = entries.filter(e => !isAloEntry(e));
    const afterCount = obj.data.character_book.entries.length;
    console.log(`  Entries: ${beforeCount} → ${afterCount} (deleted ${beforeCount - afterCount})`);

    // ── Step 1b: Edit opener replaceString ───────────────────────────────
    console.log('\nStep 1b: Edit "开场白" replaceString...');
    const openerIdx = obj.data.extensions.regex_scripts.findIndex(r => r.scriptName === '开场白');
    if (openerIdx === -1) throw new Error('Could not find 开场白 regex script');

    const opener = obj.data.extensions.regex_scripts[openerIdx];
    const origRsLen = opener.replaceString.length;

    const { text: newRs, changesMade } = editOpenerReplaceString(opener.replaceString);
    opener.replaceString = newRs;

    console.log(`  Original replaceString length: ${origRsLen}`);
    console.log(`  New replaceString length: ${newRs.length}`);
    console.log(`  Changes made: ${changesMade.length}`);
    for (const c of changesMade) {
        console.log(`    ✓ ${c}`);
    }

    // Verify no ALO references remain in critical patterns
    const hasDataWorldAlo = newRs.includes('data-world="alo"');
    const hasWorldAloCondition = /world\s*===\s*['"]alo['"]/.test(newRs);
    console.log(`  data-world="alo" remaining: ${hasDataWorldAlo}`);
    console.log(`  world === 'alo' condition remaining: ${hasWorldAloCondition}`);

    // Verify sao/ggo/real still present
    const hasSao = newRs.includes('data-world="sao"');
    const hasGgo = newRs.includes('data-world="ggo"');
    const hasReal = newRs.includes('data-world="reality"');
    console.log(`  data-world="sao" present: ${hasSao}`);
    console.log(`  data-world="ggo" present: ${hasGgo}`);
    console.log(`  data-world="reality" present: ${hasReal}`);

    // ── Step 1c: Delete alternate_greetings[2] ──────────────────────────
    console.log('\nStep 1c: Delete alternate_greetings[2]...');
    const greetings = obj.data.alternate_greetings;
    console.log(`  Before: ${greetings.length} greetings`);
    console.log(`  [2] preview: ${greetings[2].substring(0, 80)}...`);

    // Verify index 2 is the ALO greeting
    if (!greetings[2].includes('旧alo')) {
        throw new Error(`alternate_greetings[2] does not contain '旧alo': ${greetings[2].substring(0, 100)}`);
    }

    obj.data.alternate_greetings = [greetings[0], greetings[1], greetings[3]];
    console.log(`  After: ${obj.data.alternate_greetings.length} greetings`);
    console.log(`  ✓ Deleted index [2] (旧alo开场白), kept [0]=prologue, [1]=现实, [2]=ggo`);

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

    // 1. File size
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
    console.log(`  [2] Entry count: ${entryCount} (expected 257)`);
    if (entryCount !== 257) {
        console.log('      ✗ FAIL: Expected 257');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. alternate_greetings length
    const greetLen = verifyObj.data.alternate_greetings.length;
    console.log(`  [3] alternate_greetings.length: ${greetLen} (expected 3)`);
    if (greetLen !== 3) {
        console.log('      ✗ FAIL: Expected 3');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 4. No data-world="alo" in replaceString
    const openerRs = verifyObj.data.extensions.regex_scripts.find(r => r.scriptName === '开场白').replaceString;
    const hasAloDataWorld = openerRs.includes('data-world="alo"');
    console.log(`  [4] data-world="alo" in opener: ${hasAloDataWorld} (expected false)`);
    if (hasAloDataWorld) {
        console.log('      ✗ FAIL: ALO data-world still present');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 5. sao/ggo/real still present
    const hasSaoCheck = openerRs.includes('data-world="sao"');
    const hasGgoCheck = openerRs.includes('data-world="ggo"');
    const hasRealCheck = openerRs.includes('data-world="reality"');
    console.log(`  [5] data-world="sao": ${hasSaoCheck}, "ggo": ${hasGgoCheck}, "reality": ${hasRealCheck}`);
    if (!hasSaoCheck || !hasGgoCheck || !hasRealCheck) {
        console.log('      ✗ FAIL: Missing expected world options');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 6. No ALO world book entries
    const aloEntries = verifyObj.data.character_book.entries.filter(e => isAloEntry(e));
    console.log(`  [6] Remaining ALO entries: ${aloEntries.length} (expected 0)`);
    if (aloEntries.length !== 0) {
        console.log('      ✗ FAIL: ALO entries still present');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 7. node --check on the script itself
    console.log(`  [7] node --check on remove-alo-content.js...`);
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
    console.log(`Entries deleted: ${beforeCount - afterCount} (${countJialo} 旧alo + ${countXinShengAlo} 新生alo + ${countTongrenAlo} 桐人*alo + ${countTongziAlo} 桐子*alo)`);
    console.log(`Entries remaining: ${afterCount}`);
    console.log(`Opener changes: ${changesMade.length}`);
    for (const c of changesMade) console.log(`  - ${c}`);
    console.log(`alternate_greetings: ${greetings.length} → ${obj.data.alternate_greetings.length}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
