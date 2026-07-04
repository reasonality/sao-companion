#!/usr/bin/env node
'use strict';

/**
 * remove-ggo-content.js
 * Removes all GGO content from the SAO character card PNG.
 * Keeps sao / real chapters only.
 *
 * Changes:
 *  1. Delete 14 GGO world book entries (by comment pattern)
 *  2. Edit "开场白" replaceString to remove GGO UI/JS references
 *  3. Delete alternate_greetings[2] (ggo开场白)
 *
 * Both chara and ccv3 tEXt chunks are updated identically.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_ggo_removal.png';

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

// ── GGO detection helpers ──────────────────────────────────────────────

function isGgoEntry(entry) {
    const c = entry.comment || '';
    return c.startsWith('ggo') ||
           /^桐人ggo/.test(c) ||
           /^桐子ggo/.test(c);
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

        // --- 1. Delete GGO world-option div (lines ~397-400) ---
        if (trimmed.includes('class="timeline-option world-option"') &&
            trimmed.includes('data-world="ggo"')) {
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                const opens = (l.match(/<div[\s>]/g) || []).length;
                const closes = (l.match(/<\/div>/g) || []).length;
                depth += opens - closes;
                i++;
                if (depth <= 0) break;
            }
            changesMade.push('Deleted GGO world-option div');
            continue;
        }

        // --- 2. Delete GGO篇 timeline-category block (lines ~445-454) ---
        if (trimmed === '<!-- GGO篇 -->') {
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('<div class="timeline-category"')) {
                i++;
            }
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
            while (i < lines.length && lines[i].trim() === '') i++;
            changesMade.push('Deleted GGO篇 timeline-category block');
            continue;
        }

        // --- 3. Delete GGO game-info section (lines ~519-577) ---
        if (trimmed === '<!-- GGO 游戏信息 -->') {
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('<section')) i++;
            if (i < lines.length) {
                let depth = 0;
                while (i < lines.length) {
                    const l = lines[i];
                    const opens = (l.match(/<section[\s>]/g) || []).length;
                    const closes = (l.match(/<\/section>/g) || []).length;
                    depth += opens - closes;
                    i++;
                    if (depth <= 0) break;
                }
            }
            while (i < lines.length && lines[i].trim() === '') i++;
            changesMade.push('Deleted GGO game-info section');
            continue;
        }

        // --- 4. Delete GGO elements comment+refs (lines ~616-624) ---
        if (trimmed === '// GGO 元素') {
            i++;
            while (i < lines.length) {
                const cl = lines[i].trim();
                if (cl.startsWith('gameNameGgo:') ||
                    cl.startsWith('hpCurrentGgo:') ||
                    cl.startsWith('hpMaxGgo:') ||
                    cl.startsWith('attrStrGgo:') ||
                    cl.startsWith('attrAgiGgo:') ||
                    cl.startsWith('attrVitGgo:')) {
                    i++;
                } else {
                    break;
                }
            }
            changesMade.push('Deleted GGO elements comment+refs');
            continue;
        }

        // --- 5. Delete orphaned GGO element refs (staCurrent, staMax, attrDex, attrLuk) ---
        if (/^\s+staCurrent:/.test(line) ||
            /^\s+staMax:/.test(line) ||
            /^\s+attrDex:/.test(line) ||
            /^\s+attrLuk:/.test(line)) {
            i++;
            changesMade.push('Deleted orphaned GGO element ref');
            continue;
        }

        // --- 6. Delete ggo entry from worldConfigs (lines ~648-652) ---
        if (/^\s+ggo:\s*\{/.test(line)) {
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                const opens = (l.match(/\{/g) || []).length;
                const closes = (l.match(/\}/g) || []).length;
                depth += opens - closes;
                i++;
                if (depth <= 0) break;
            }
            if (i < lines.length && /^\s*,\s*$/.test(lines[i])) {
                i++;
            }
            changesMade.push('Deleted ggo from worldConfigs');
            continue;
        }

        // --- 7. Remove GGO from toggleGameInfo (lines ~694-702) ---
        if (trimmed.startsWith('const ggo = document.getElementById')) {
            i++;
            changesMade.push('Removed ggo element ref from toggleGameInfo');
            continue;
        }
        if (/^\s*ggo\.style\.display\s*=\s*'none';/.test(line)) {
            i++;
            changesMade.push('Removed ggo.style.display = none from toggleGameInfo');
            continue;
        }
        if (trimmed.startsWith("} else if (world === 'ggo')")) {
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
                i++;
                if (depth <= 0) break;
            }
            changesMade.push('Removed ggo branch from toggleGameInfo');
            continue;
        }

        // --- 8. Delete generateCharacterProfile ggo block (lines ~825-837) ---
        if (trimmed.startsWith("} else if (characterData.world === 'ggo')")) {
            let depth = 0;
            while (i < lines.length) {
                const l = lines[i];
                depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
                i++;
                if (depth <= 0) break;
            }
            changesMade.push('Deleted ggo block from generateCharacterProfile');
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
    console.log('=== remove-ggo-content ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        console.error(`  ✗ ABORT: Backup already exists: ${BAK_PATH}`);
        console.error('  Remove it manually if you want to re-run this script.');
        process.exit(1);
    }
    fs.copyFileSync(PNG_PATH, BAK_PATH);
    const bakSize = fs.statSync(BAK_PATH).size;
    if (bakSize !== originalPngBuf.length) {
        console.error(`  ✗ ABORT: Backup size mismatch: expected ${originalPngBuf.length}, got ${bakSize}`);
        process.exit(1);
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

    const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
    const obj = JSON.parse(Buffer.from(charaText, 'base64').toString('utf8'));

    // ── Step 1a: Delete GGO world book entries ──────────────────────────
    console.log('\nStep 1a: Delete GGO world book entries...');
    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;

    let countGgo = 0;
    let countTongrenGgo = 0;
    let countTongziGgo = 0;

    for (const e of entries) {
        const c = e.comment || '';
        if (c.startsWith('ggo')) countGgo++;
        else if (/^桐人ggo/.test(c)) countTongrenGgo++;
        else if (/^桐子ggo/.test(c)) countTongziGgo++;
    }

    console.log(`  ggo* entries: ${countGgo}`);
    console.log(`  桐人ggo* entries: ${countTongrenGgo}`);
    console.log(`  桐子ggo* entries: ${countTongziGgo}`);
    console.log(`  Total GGO entries to delete: ${countGgo + countTongrenGgo + countTongziGgo}`);

    obj.data.character_book.entries = entries.filter(e => !isGgoEntry(e));
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

    const hasDataWorldGgo = newRs.includes('data-world="ggo"');
    const hasWorldGgoCondition = /world\s*===\s*['"]ggo['"]/.test(newRs);
    console.log(`  data-world="ggo" remaining: ${hasDataWorldGgo}`);
    console.log(`  world === 'ggo' condition remaining: ${hasWorldGgoCondition}`);

    const hasSao = newRs.includes('data-world="sao"');
    const hasReal = newRs.includes('data-world="reality"');
    console.log(`  data-world="sao" present: ${hasSao}`);
    console.log(`  data-world="reality" present: ${hasReal}`);

    // ── Step 1c: Delete alternate_greetings[2] ──────────────────────────
    console.log('\nStep 1c: Delete alternate_greetings[2]...');
    const greetings = obj.data.alternate_greetings;
    console.log(`  Before: ${greetings.length} greetings`);
    console.log(`  [2] preview: ${greetings[2].substring(0, 80)}...`);

    if (!greetings[2].includes('ggo')) {
        throw new Error(`alternate_greetings[2] does not contain 'ggo': ${greetings[2].substring(0, 100)}`);
    }

    obj.data.alternate_greetings = [greetings[0], greetings[1]];
    console.log(`  After: ${obj.data.alternate_greetings.length} greetings`);
    console.log(`  ✓ Deleted index [2] (ggo开场白), kept [0]=prologue, [1]=现实`);

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
    console.log(`  [2] Entry count: ${entryCount} (expected 243)`);
    if (entryCount !== 243) {
        console.log('      ✗ FAIL: Expected 243');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. alternate_greetings length
    const greetLen = verifyObj.data.alternate_greetings.length;
    console.log(`  [3] alternate_greetings.length: ${greetLen} (expected 2)`);
    if (greetLen !== 2) {
        console.log('      ✗ FAIL: Expected 2');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 4. No data-world="ggo" in replaceString
    const openerRs = verifyObj.data.extensions.regex_scripts.find(r => r.scriptName === '开场白').replaceString;
    const hasGgoDataWorld = openerRs.includes('data-world="ggo"');
    console.log(`  [4] data-world="ggo" in opener: ${hasGgoDataWorld} (expected false)`);
    if (hasGgoDataWorld) {
        console.log('      ✗ FAIL: GGO data-world still present');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 5. sao/reality still present
    const hasSaoCheck = openerRs.includes('data-world="sao"');
    const hasRealCheck = openerRs.includes('data-world="reality"');
    console.log(`  [5] data-world="sao": ${hasSaoCheck}, "reality": ${hasRealCheck}`);
    if (!hasSaoCheck || !hasRealCheck) {
        console.log('      ✗ FAIL: Missing expected world options');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 6. No GGO world book entries
    const ggoEntries = verifyObj.data.character_book.entries.filter(e => isGgoEntry(e));
    console.log(`  [6] Remaining GGO entries: ${ggoEntries.length} (expected 0)`);
    if (ggoEntries.length !== 0) {
        console.log('      ✗ FAIL: GGO entries still present');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 7. node --check on the script itself
    console.log(`  [7] node --check on remove-ggo-content.js...`);
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
    console.log(`Entries deleted: ${beforeCount - afterCount} (${countGgo} ggo* + ${countTongrenGgo} 桐人ggo* + ${countTongziGgo} 桐子ggo*)`);
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
