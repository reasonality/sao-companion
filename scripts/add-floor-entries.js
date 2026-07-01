#!/usr/bin/env node
'use strict';

/**
 * add-floor-entries.js
 * Adds 64 missing floor worldbook entries (floors 12-18,21,23,26,29-34,36-38,
 * 41-45,51-54,56,58,60,62-64,66-71,73,76-99) to the SAO character card PNG.
 *
 * Reads floor data from _patches/floor_data_collected.json, generates entries
 * matching the format of existing floor entries, and re-embeds into PNG.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_floor_fill.png';
const FLOOR_DATA_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/sao-companion/_patches/floor_data_collected.json';

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

// ── Chinese number helpers ─────────────────────────────────────────────

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CHINESE_UNITS = ['', '', '十', '百'];

function toChineseNumber(n) {
    if (n === 0) return '零';
    if (n === 10) return '十';
    if (n === 100) return '一百';

    let result = '';
    const s = String(n);
    const digits = s.split('').map(Number);

    if (digits.length === 1) {
        return CHINESE_DIGITS[digits[0]];
    }

    if (digits.length === 2) {
        const tens = digits[0];
        const ones = digits[1];
        if (tens === 1) {
            result = '十';
        } else {
            result = CHINESE_DIGITS[tens] + '十';
        }
        if (ones !== 0) {
            result += CHINESE_DIGITS[ones];
        }
        return result;
    }

    if (digits.length === 3) {
        result = CHINESE_DIGITS[digits[0]] + '百';
        const tens = digits[1];
        const ones = digits[2];
        if (tens === 0 && ones === 0) return result;
        if (tens === 0) {
            result += '零' + CHINESE_DIGITS[ones];
        } else {
            if (tens === 1) {
                result += '十';
            } else {
                result += CHINESE_DIGITS[tens] + '十';
            }
            if (ones !== 0) {
                result += CHINESE_DIGITS[ones];
            }
        }
        return result;
    }

    return String(n);
}

// ── Content generation ─────────────────────────────────────────────────

function generateContent(floorNum, floorData, chineseName) {
    const d = floorData;
    const hasName = d.name && d.name.length > 0;
    const hasMainTown = d.main_town && d.main_town.length > 0;
    const hasLabyrinth = d.labyrinth && d.labyrinth.length > 0;
    const hasBoss = d.boss && d.boss.length > 0;
    const hasNotes = d.notes && d.notes.length > 0;
    const hasUndetailedNotes = hasNotes && d.notes.includes('原作未详细描写');
    const isUndetailed = (!hasName && !hasMainTown && !hasLabyrinth) && (!hasBoss || hasUndetailedNotes);
    const themeName = hasName ? d.name : (isUndetailed ? '未知领域' : '未命名领域');

    let lines = [];

    lines.push('---');
    lines.push('');
    lines.push(`### **【AI核心指令：第${chineseName}层世界设定 - ${themeName}】**`);
    lines.push('');
    lines.push(`**[系统提示：AI，在本次角色扮演中，当【{{user}}】处于艾恩葛朗特第${chineseName}层时，你必须严格遵守以下所有设定来描绘场景、NPC和挑战。]**`);
    lines.push('');
    lines.push('---');

    // Core principle section
    lines.push('');
    if (isUndetailed) {
        // Check for special notes
        const specialNotes = [];
        if (d.notes) {
            // Extract any meaningful info from notes
            if (d.notes.includes('Sleeping Knights')) specialNotes.push('在"新艾恩葛朗特"篇中，Sleeping Knights公会曾攻略此层。');
            if (d.notes.includes('Cardinal')) specialNotes.push('从这一层起，Cardinal系统开始学习玩家的战术模式，怪物的算法不确定性开始增加。');
            if (d.notes.includes('大意翻滚')) specialNotes.push('据传桐人在攻略该层Boss时曾因大意翻滚到Boss面前。');
            if (d.notes.includes('Boss战中玩家死亡') || d.notes.includes('难度极高')) specialNotes.push('此层是74层之前最后一次有玩家在Boss战中阵亡的楼层，攻略难度极高。');
            if (d.notes.includes('独特技能') || d.notes.includes('解锁')) specialNotes.push('原计划到达此层后，除二刀流与神圣剑外的独特技能将解锁。');
            if (d.notes.includes('安全区设定取消') || d.notes.includes('安全区')) specialNotes.push('原计划到达此层后，全楼层的安全区设定将被取消。');
        }

        lines.push('#### **核心原则：原作未详细描写**');
        lines.push('');
        lines.push(`*   **AI核心理解：** 第${chineseName}层在原作中未被详细描写。我的任务是在保持SAO世界观一致性的前提下，根据楼层编号推断其大致难度和主题，并为玩家提供符合当前进度的挑战与体验。`);

        if (specialNotes.length > 0) {
            lines.push(`*   **已知信息：** ${specialNotes[0]}`);
            for (let i = 1; i < specialNotes.length; i++) {
                lines.push(`    *   ${specialNotes[i]}`);
            }
        }

        lines.push('');
        lines.push('---');

        // Geography section
        lines.push('');
        lines.push('#### **地理与聚落 (Settlements)**');
        lines.push('');

        if (hasMainTown) {
            lines.push(`##### **主城區：【${d.main_town}】**`);
            lines.push(`*   **描述：** 第${chineseName}层的中心城市。原作中未提供详细的建筑风格或环境描述。在叙事中，应将其描绘为一个符合当前楼层等级的标准城镇，拥有必要的设施（传送门广场、商店、旅馆等）。`);
        } else {
            lines.push(`##### **主城區：未知**`);
            lines.push(`*   **描述：** 原作中未提及第${chineseName}层主城的名称或具体描述。在叙事中，可将其设定为一个符合楼层等级的中型城镇。`);
        }

        lines.push('');

        // Labyrinth section
        lines.push('#### **核心挑战 (Challenges)**');
        lines.push('');
        lines.push('*   **迷宫区 (Labyrinth)：**');
        if (hasLabyrinth) {
            lines.push(`    *   **描述：** ${d.labyrinth}。`);
        } else {
            lines.push('    *   **描述：** 原作中未提及该层迷宫区的具体描述。可根据楼层主题自由设计。');
        }
        lines.push('');

        // Boss section
        lines.push('*   **守关Boss (Floor Boss)：**');
        if (hasBoss) {
            lines.push(`    *   **名称：【${d.boss}】**`);
            lines.push('    *   **描述：** 该层的守关Boss。具体战斗细节原作未详，可根据叙事需要自由设计战斗场景。');
        } else {
            lines.push('    *   **描述：** 原作中未提及该层守关Boss的具体信息。在叙事中，可设计一个与楼层主题相符的Boss。');
        }
        lines.push('');
        lines.push('---');
    } else {
        // Detailed entry for floors with known data
        lines.push(`#### **核心原则：${hasName ? d.name : '第' + chineseName + '层的特色'}**`);
        lines.push('');
        lines.push(`*   **AI核心理解：** 我需要描绘第${chineseName}层${hasName ? '——' + d.name + '——' : ''}的独特世界。${hasNotes ? d.notes : ''}`);

        lines.push('');
        lines.push('---');

        // Geography section
        lines.push('');
        lines.push('#### **地理与聚落 (Settlements)**');
        lines.push('');

        if (hasMainTown) {
            lines.push(`##### **主城區：【${d.main_town}】**`);
            lines.push(`*   **描述：** 第${chineseName}层${hasName ? '「' + d.name + '」' : ''}的中心城市。`);
        }

        lines.push('');

        // Labyrinth section
        lines.push('#### **核心挑战 (Challenges)**');
        lines.push('');
        lines.push('*   **迷宫区 (Labyrinth)：**');
        if (hasLabyrinth) {
            lines.push(`    *   **描述：** ${d.labyrinth}。`);
        } else {
            lines.push('    *   **描述：** 原作中未详细描述。');
        }
        lines.push('');

        // Boss section
        lines.push('*   **守关Boss (Floor Boss)：**');
        if (hasBoss) {
            lines.push(`    *   **名称：【${d.boss}】**`);
            lines.push('    *   **描述：** 该层的守关Boss。');
        } else {
            lines.push('    *   **描述：** 原作中未提及该层守关Boss。');
        }
        lines.push('');
        lines.push('---');
    }

    return lines.join('\n');
}

// ── Entry builder ──────────────────────────────────────────────────────

function buildFloorEntry(floorNum, floorData, startId, startDisplayIndex) {
    const chineseName = toChineseNumber(floorNum);
    const content = generateContent(floorNum, floorData, chineseName);

    // Keys: ["第N层", "第 N层", "第X层"]
    const keys = [`第${floorNum}层`, `第 ${floorNum}层`, `第${chineseName}层`];

    return {
        id: startId + floorNum,
        keys: keys,
        secondary_keys: [],
        comment: `sao-第${floorNum}层`,
        content: content,
        constant: false,
        selective: true,
        insertion_order: 71,
        enabled: true,
        position: 'before_char',
        use_regex: true,
        extensions: {
            position: 0,
            exclude_recursion: true,
            display_index: startDisplayIndex + floorNum,
            probability: 100,
            useProbability: true,
            depth: 4,
            selectiveLogic: 0,
            outlet_name: '',
            group: '',
            group_override: false,
            group_weight: 100,
            prevent_recursion: true,
            delay_until_recursion: false,
            scan_depth: null,
            match_whole_words: null,
            use_group_scoring: false,
            case_sensitive: null,
            automation_id: '',
            role: 0,
            vectorized: false,
            sticky: 0,
            cooldown: 0,
            delay: 0,
            match_persona_description: false,
            match_character_description: false,
            match_character_personality: false,
            match_character_depth_prompt: false,
            match_scenario: false,
            match_creator_notes: false,
            triggers: [],
            ignore_budget: false
        }
    };
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== add-floor-entries ===\n');

    // (1) Read floor data
    console.log('Reading floor data...');
    const floorDataRaw = JSON.parse(fs.readFileSync(FLOOR_DATA_PATH, 'utf8'));
    const floorData = floorDataRaw.floors;
    console.log(`  Loaded data for ${Object.keys(floorData).length} floors`);

    // (2) Read existing PNG and decode
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

    // (3) Determine missing floors
    console.log('\nAnalyzing existing floor entries...');
    const entries = obj.data?.character_book?.entries || [];
    console.log(`  Total entries: ${entries.length}`);

    const floorEntries = entries.filter(e => /sao-第\d+层/.test(e.comment || ''));
    console.log(`  Existing floor entries: ${floorEntries.length}`);

    const existingFloorNums = new Set();
    for (const e of floorEntries) {
        const m = e.comment.match(/sao-第(\d+)层/);
        if (m) existingFloorNums.add(parseInt(m[1]));
    }
    // Also handle the merged 65/66 entry
    const merged6566 = entries.find(e => e.comment === 'sao-第65层第66层');
    if (merged6566) {
        existingFloorNums.add(65);
        existingFloorNums.add(66);
    }

    const missingFloors = [];
    for (let i = 1; i <= 100; i++) {
        if (!existingFloorNums.has(i)) {
            missingFloors.push(i);
        }
    }
    console.log(`  Missing floors: ${missingFloors.length}`);
    console.log(`  Missing: ${missingFloors.join(', ')}`);

    // (4) Create new entries
    console.log('\nCreating new floor entries...');
    // Find max id and display_index in existing entries
    const maxId = Math.max(...entries.map(e => e.id ?? 0));
    const maxDisplayIndex = Math.max(...entries.map(e => e.extensions?.display_index ?? 0));
    console.log(`  Max existing id: ${maxId}, max display_index: ${maxDisplayIndex}`);

    const newEntries = [];
    for (const floorNum of missingFloors) {
        const data = floorData[String(floorNum)] || { name: '', main_town: '', labyrinth: '', boss: '', notes: '' };
        const entry = buildFloorEntry(floorNum, data, maxId, maxDisplayIndex);
        newEntries.push(entry);
    }
    console.log(`  Created ${newEntries.length} new entries`);

    // (5) Add new entries to the end
    entries.push(...newEntries);
    obj.data.character_book.entries = entries;
    console.log(`  Total entries now: ${entries.length}`);

    // (6) Backup PNG
    console.log('\nBacking up PNG...');
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH}`);
    }

    // (7) Write back to PNG
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

    // (8) Update extracted JSON
    console.log('\nUpdating extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // (9) Verification
    console.log('\n=== Verification ===');

    // Re-read PNG and verify
    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyCharaChunk = findTextChunk(verifyChunks, 'chara');
    if (!verifyCharaChunk) throw new Error('Verification failed: chara tEXt chunk not found');
    const verifyObj = decodeTextChunkData(verifyCharaChunk);
    const verifyEntries = verifyObj.data?.character_book?.entries || [];

    const verifyFloorEntries = verifyEntries.filter(e => /sao-第\d+层/.test(e.comment || '') || e.comment === 'sao-第65层第66层');
    console.log(`  Total entries in PNG: ${verifyEntries.length}`);
    console.log(`  Floor-related entries: ${verifyFloorEntries.length}`);

    // Verify all 100 floors are covered
    const verifyFloorNums = new Set();
    for (const e of verifyFloorEntries) {
        const matches = e.comment.match(/第(\d+)层/g);
        if (matches) {
            for (const m of matches) {
                const n = parseInt(m.replace(/[^0-9]/g, ''));
                verifyFloorNums.add(n);
            }
        }
    }

    const stillMissing = [];
    for (let i = 1; i <= 100; i++) {
        if (!verifyFloorNums.has(i)) stillMissing.push(i);
    }

    if (stillMissing.length > 0) {
        console.error(`  ⚠ Still missing floors: ${stillMissing.join(', ')}`);
    } else {
        console.log('  ✓ All 100 floors are covered');
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

    // Show a sample of new entries
    console.log('\n=== Sample new entries ===');
    const sampleFloors = [12, 27, 75, 99];
    for (const n of sampleFloors) {
        const e = verifyEntries.find(x => x.comment === `sao-第${n}层`);
        if (e) {
            const preview = e.content.substring(0, 80).replace(/\n/g, ' ');
            console.log(`  sao-第${n}层: ${preview}...`);
        }
    }

    console.log('\n=== Done ===');
    console.log(`Backup: ${BAK_PATH}`);
    console.log(`New entries added: ${newEntries.length}`);
    console.log(`Original PNG: ${originalPngBuf.length} bytes`);
    console.log(`New PNG: ${newPng.length} bytes`);
    console.log(`Missing floors: ${missingFloors.join(', ')}`);
    if (stillMissing.length === 0) {
        console.log('✓ All 100 floors are now covered!');
    }
}

main();
