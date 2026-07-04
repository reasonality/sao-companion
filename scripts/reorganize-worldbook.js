#!/usr/bin/env node
'use strict';

/**
 * reorganize-worldbook.js
 * Reorganizes ALL world book entries in the SAO character card per Plan A:
 *  1. DELETE 2 dead entries
 *  2. SET disable per Plan A (data disabled, format/protocol enabled, real NPC enabled)
 *  3. SET insertion_order per category
 *  4. SET use_regex = true for ALL entries
 *  5. SET constant/selective per category
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

// ── Classification helpers ─────────────────────────────────────────────

// Dead entries to delete (exact comment match)
const DEAD_COMMENTS = new Set([
    '主角设定',
    '桐子-娘化桐人开这个和角色',
]);

// Data rule entries (disabled, plugin reads directly)
const DATA_RULE_COMMENTS = new Set([
    'sao-剑技和词条生成sao',
    'sao-特殊效果编号',
    'sao-装备词条',
    'sao-装备/武器生成规则',
    '剑技生成sao1',
    '剑技词条列表sao1',
    'sao-道具系统',
    'sao-任务经验',
    'sao-剑技获取',
    'sao-冥想',
    'sao-房屋',
    'sao公会',
    'sao-战斗流程设定',
    'sao-zd_status',
    'sao-{{user}}状态栏',
    'npc状态栏token多sao',
    'sao-npc状态栏token低',
    'saonpc状态栏token低（锁一人）',
    'digest2',
    '日历',
    '固定地图',
    '半随机地图',
    '随机地图',
    '行动1',
    '行动2',
    'sao-真实骰子规则',
    'sao剧情推动',
    'sao-技能',
]);

// Enabled format/protocol/core-rules entries (constant: true)
const FORMAT_PROTOCOL_COMMENTS = new Set([
    'sao-格式（去掉<map><npc_thoughts><guild>）',
    'sao-数值由系统计算(插件接管)',
    'sao-标签输出与数值委托协议(插件)',
]);

const CORE_RULES_COMMENTS = new Set([
    'sao-世界设定',
    'sao-注意事项（可能的错误）',
    'sao-NPC档案构建规则 （sao）',
]);

const GAMEPLAY_RULES_COMMENTS = new Set([
    'sao-PK机制',
    'sao-经济系统',
    'sao-等级',
]);

// Thought chains (keep disabled, leave as-is)
const THOUGHT_CHAIN_COMMENTS = new Set([
    '群体npc思维链',
    '单一npc思维链',
    '双优先思维链',
    '五优先思维链',
]);

function isFloorEntry(comment) {
    return /^sao-第\d+层$/.test(comment);
}

function isTimelineEntry(comment) {
    return /\d{4}年\d{1,2}月(时间线|时间表)/.test(comment);
}

function hasCharacterProfile(content) {
    return content.includes('characterProfile');
}

function isRealWorldNpcProfile(entry) {
    const c = entry.comment || '';
    const content = entry.content || '';
    // 现实-XXX entries (check prefix; some have characterProfile, some have characterLook)
    if (c.startsWith('现实-') && (hasCharacterProfile(content) || content.includes('characterLook'))) return true;
    // 桐人现实-XXX and 桐子现实-XXX
    if ((c.startsWith('桐人现实-') || c.startsWith('桐子现实-')) && (hasCharacterProfile(content) || content.includes('characterLook'))) return true;
    return false;
}

function isSaoNpcProfile(entry) {
    const c = entry.comment || '';
    const content = entry.content || '';
    // sao-XXX with characterProfile (but not 现实- or data rules)
    if (c.startsWith('sao-') && hasCharacterProfile(content)) return true;
    // 桐人sao-XXX, 桐子sao-XXX with characterProfile
    if ((c.startsWith('桐人sao-') || c.startsWith('桐子sao-')) && hasCharacterProfile(content)) return true;
    // Special SAO NPC profiles that don't start with sao-
    const specialSaoNpcs = ['茅场晶彦', '恭二', '昌一', '敦'];
    if (specialSaoNpcs.includes(c) && hasCharacterProfile(content)) return true;
    return false;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== reorganize-worldbook ===\n');

    // ── Step 0: Verify PNG is valid ─────────────────────────────────────
    console.log('Step 0: Verify PNG...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);
    if (originalPngBuf.length === 0) {
        throw new Error('PNG file is empty!');
    }
    console.log('  ✓ PNG is valid (size > 0)');

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

    const entries = obj.data.character_book.entries;
    const beforeCount = entries.length;
    console.log(`  Total entries before: ${beforeCount}`);

    // ── Rule 1: DELETE dead entries ──────────────────────────────────────
    console.log('\nRule 1: Delete dead entries...');
    let deletedCount = 0;
    const deletedComments = [];
    obj.data.character_book.entries = entries.filter(e => {
        const c = e.comment || '';
        if (DEAD_COMMENTS.has(c)) {
            deletedComments.push(c);
            deletedCount++;
            return false;
        }
        return true;
    });
    console.log(`  Deleted ${deletedCount} entries: ${deletedComments.join(', ')}`);
    console.log(`  Entries after deletion: ${obj.data.character_book.entries.length}`);

    // ── Rules 2-5: Apply to every remaining entry ───────────────────────
    console.log('\nRules 2-5: Applying changes to all entries...');
    const allEntries = obj.data.character_book.entries;

    let disabledCount = 0;
    let enabledCount = 0;
    let ioChangedCount = 0;
    let regexChangedCount = 0;
    let constantChangedCount = 0;
    const enabledComments = [];

    for (const entry of allEntries) {
        const comment = entry.comment || '';
        const content = entry.content || '';

        // ── Rule 4: use_regex = true for ALL ────────────────────────────
        if (entry.use_regex !== true) {
            regexChangedCount++;
            entry.use_regex = true;
        }

        // ── Rule 2: Set disable per Plan A ──────────────────────────────
        let shouldBeDisabled = false;
        let category = 'unknown';

        if (isFloorEntry(comment)) {
            shouldBeDisabled = true;
            category = 'floor';
        } else if (isTimelineEntry(comment)) {
            shouldBeDisabled = true;
            category = 'timeline';
        } else if (DATA_RULE_COMMENTS.has(comment)) {
            shouldBeDisabled = true;
            category = 'data_rule';
        } else if (THOUGHT_CHAIN_COMMENTS.has(comment)) {
            shouldBeDisabled = true;
            category = 'thought_chain';
        } else if (isSaoNpcProfile(entry)) {
            shouldBeDisabled = true;
            category = 'sao_npc';
        } else if (isRealWorldNpcProfile(entry)) {
            shouldBeDisabled = false;
            category = 'real_npc';
        } else if (FORMAT_PROTOCOL_COMMENTS.has(comment)) {
            shouldBeDisabled = false;
            category = 'format_protocol';
        } else if (CORE_RULES_COMMENTS.has(comment)) {
            shouldBeDisabled = false;
            category = 'core_rules';
        } else if (GAMEPLAY_RULES_COMMENTS.has(comment)) {
            shouldBeDisabled = false;
            category = 'gameplay_rules';
        } else {
            // Unknown entry — leave as-is, but log it
            console.log(`  ⚠ Unknown entry: "${comment}" (disable=${entry.disable})`);
            category = 'unknown';
        }

        if (shouldBeDisabled) {
            if (entry.disable !== true) {
                entry.disable = true;
            }
            disabledCount++;
        } else {
            if (entry.disable !== false) {
                entry.disable = false;
            }
            enabledCount++;
            enabledComments.push(comment);
        }

        // ── Rule 3: Set insertion_order per category ────────────────────
        let targetIo;
        switch (category) {
            case 'format_protocol':
                targetIo = 1;
                break;
            case 'core_rules':
                targetIo = 10;
                break;
            case 'gameplay_rules':
                targetIo = 20;
                break;
            case 'real_npc':
                targetIo = 50;
                break;
            case 'floor':
            case 'timeline':
            case 'data_rule':
            case 'thought_chain':
            case 'sao_npc':
            case 'unknown':
            default:
                targetIo = 100;
                break;
        }
        if (entry.insertion_order !== targetIo) {
            ioChangedCount++;
            entry.insertion_order = targetIo;
        }

        // ── Rule 5: Set constant/selective per category ─────────────────
        if (category === 'format_protocol' || category === 'core_rules') {
            // Enabled non-NPC entries: constant: true
            if (entry.constant !== true) {
                constantChangedCount++;
                entry.constant = true;
            }
            entry.selective = true;
        } else if (category === 'gameplay_rules') {
            // Gameplay rules: constant: false (they have keys)
            if (entry.constant !== false) {
                constantChangedCount++;
                entry.constant = false;
            }
            entry.selective = true;
        } else if (category === 'real_npc') {
            // Real-world NPC profiles: constant: false, selective: true
            if (entry.constant !== false) {
                constantChangedCount++;
                entry.constant = false;
            }
            entry.selective = true;
        }
        // Disabled entries: leave constant/selective as-is
    }

    console.log(`  Disabled: ${disabledCount}`);
    console.log(`  Enabled: ${enabledCount}`);
    console.log(`  insertion_order changed: ${ioChangedCount}`);
    console.log(`  use_regex changed: ${regexChangedCount}`);
    console.log(`  constant changed: ${constantChangedCount}`);

    // ── Step 2: Write PNG + sync JSON ───────────────────────────────────
    console.log('\nStep 2: Write updated PNG + JSON...');
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

    // Sync extracted JSON
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 3: Verify ──────────────────────────────────────────────────
    console.log('\nStep 3: Verify...');
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
            process.exit(1);
        }
    } else {
        console.log('  verify-card-regex.js not found, skipping');
    }

    // ── Step 4: Sanity checks ───────────────────────────────────────────
    console.log('\nStep 4: Sanity checks...');
    let allPassed = true;

    // Re-read from PNG to verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const verifyEntries = verifyObj.data.character_book.entries;

    // 1. PNG size before/after
    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log('      ✓ Pass');

    // 2. Entry count should be 239
    const entryCount = verifyEntries.length;
    console.log(`  [2] Entry count: ${entryCount} (expected 239)`);
    if (entryCount !== 239) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 3. 主角设定 should NOT exist
    const dead1 = verifyEntries.filter(e => e.comment === '主角设定');
    console.log(`  [3] 主角设定 count: ${dead1.length} (expected 0)`);
    if (dead1.length !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 4. 桐子-娘化桐人开这个和角色 should NOT exist
    const dead2 = verifyEntries.filter(e => e.comment === '桐子-娘化桐人开这个和角色');
    console.log(`  [4] 桐子-娘化桐人开这个和角色 count: ${dead2.length} (expected 0)`);
    if (dead2.length !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 5. Enabled count (disable != true)
    const enabledEntries = verifyEntries.filter(e => e.disable !== true);
    console.log(`  [5] Enabled count: ${enabledEntries.length} (expected ~32)`);
    console.log(`      Enabled comments: ${enabledEntries.map(e => e.comment).join(', ')}`);
    console.log('      ✓ Pass (see count)');

    // 6. Disabled count (disable == true)
    const disabledEntries = verifyEntries.filter(e => e.disable === true);
    console.log(`  [6] Disabled count: ${disabledEntries.length} (expected ~207)`);
    console.log('      ✓ Pass (see count)');

    // 7. All floor entries should be disabled
    const enabledFloor = verifyEntries.filter(e => /^sao-第\d+层$/.test(e.comment || '') && e.disable !== true);
    console.log(`  [7] Enabled floor entries: ${enabledFloor.length} (expected 0)`);
    if (enabledFloor.length !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 8. All timeline entries should be disabled
    const enabledTimeline = verifyEntries.filter(e => /\d{4}年\d{1,2}月(时间线|时间表)/.test(e.comment || '') && e.disable !== true);
    console.log(`  [8] Enabled timeline entries: ${enabledTimeline.length} (expected 0)`);
    if (enabledTimeline.length !== 0) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 9. All SAO NPC profiles should be disabled
    const enabledSaoNpc = verifyEntries.filter(e => {
        const c = e.comment || '';
        const content = e.content || '';
        if (!content.includes('characterProfile')) return false;
        if (c.startsWith('现实-') || c.startsWith('桐人现实-') || c.startsWith('桐子现实-')) return false;
        return e.disable !== true;
    });
    console.log(`  [9] Enabled SAO NPC profiles: ${enabledSaoNpc.length} (expected 0)`);
    if (enabledSaoNpc.length !== 0) {
        console.log(`      ✗ FAIL: ${enabledSaoNpc.map(e => e.comment).join(', ')}`);
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // 10. All 现实-XXX entries should be enabled
    const disabledRealNpc = verifyEntries.filter(e => {
        const c = e.comment || '';
        return (c.startsWith('现实-') || c.startsWith('桐人现实-') || c.startsWith('桐子现实-')) && e.disable === true;
    });
    console.log(`  [10] Disabled real-world NPC profiles: ${disabledRealNpc.length} (expected 0)`);
    if (disabledRealNpc.length !== 0) {
        console.log(`       ✗ FAIL: ${disabledRealNpc.map(e => e.comment).join(', ')}`);
        allPassed = false;
    } else {
        console.log('       ✓ Pass');
    }

    // 11. sao-格式 should be enabled, constant=true, insertion_order=1
    const formatEntry = verifyEntries.find(e => e.comment === 'sao-格式（去掉<map><npc_thoughts><guild>）');
    if (formatEntry) {
        const ok = formatEntry.disable === false && formatEntry.constant === true && formatEntry.insertion_order === 1;
        console.log(`  [11] sao-格式: disable=${formatEntry.disable}, constant=${formatEntry.constant}, io=${formatEntry.insertion_order} ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) {
            allPassed = false;
        } else {
            console.log('       ✓ Pass');
        }
    } else {
        console.log('  [11] sao-格式 not found — ✗ FAIL');
        allPassed = false;
    }

    // 12. All entries should have use_regex == true
    const falseRegex = verifyEntries.filter(e => e.use_regex !== true);
    console.log(`  [12] Entries with use_regex != true: ${falseRegex.length} (expected 0)`);
    if (falseRegex.length !== 0) {
        console.log('       ✗ FAIL');
        allPassed = false;
    } else {
        console.log('       ✓ Pass');
    }

    // 13. node --check the new script
    console.log(`  [13] node --check on reorganize-worldbook.js...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node --check "${__filename}"`, { encoding: 'utf8' });
        console.log('       ✓ Pass (no syntax errors)');
    } catch (e) {
        console.log(`       ✗ FAIL: ${e.message}`);
        allPassed = false;
    }

    // 14. Insertion order distribution
    const ioDist = {};
    for (const e of verifyEntries) {
        const io = e.insertion_order;
        ioDist[io] = (ioDist[io] || 0) + 1;
    }
    console.log(`  [14] Insertion order distribution:`);
    for (const [io, count] of Object.entries(ioDist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        console.log(`       io=${io}: ${count} entries`);
    }
    console.log('       ✓ Pass (see distribution)');

    // ── Final summary ────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Entries deleted: ${deletedCount} (${deletedComments.join(', ')})`);
    console.log(`Entries disabled: ${disabledCount}`);
    console.log(`Entries enabled: ${enabledCount}`);
    console.log(`Enabled comments: ${enabledComments.join(', ')}`);
    console.log(`insertion_order changed: ${ioChangedCount}`);
    console.log(`use_regex changed: ${regexChangedCount}`);
    console.log(`constant changed: ${constantChangedCount}`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
