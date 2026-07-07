#!/usr/bin/env node
'use strict';

const fs = require('fs');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/刀剑神域SAO V2.1.0.png';

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

function readPngChunks(filePath) {
    const buf = fs.readFileSync(filePath);
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!buf.slice(0, 8).equals(sig)) throw new Error('Invalid PNG signature');
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

function decodeTextChunk(chunk) {
    const nul = chunk.data.indexOf(0);
    const keyword = chunk.data.slice(0, nul).toString('latin1');
    const value = chunk.data.slice(nul + 1).toString('latin1');
    return { keyword, json: JSON.parse(Buffer.from(value, 'base64').toString('utf8')) };
}

function main() {
    console.log('=== verify-c1c2c3 ===\n');

    const chunks = readPngChunks(PNG_PATH);
    const charaChunk = chunks.find(c => {
        if (c.type !== 'tEXt') return false;
        const n = c.data.indexOf(0);
        return n !== -1 && c.data.slice(0, n).toString('latin1') === 'chara';
    });
    const ccv3Chunk = chunks.find(c => {
        if (c.type !== 'tEXt') return false;
        const n = c.data.indexOf(0);
        return n !== -1 && c.data.slice(0, n).toString('latin1') === 'ccv3';
    });

    if (!charaChunk || !ccv3Chunk) throw new Error('chara or ccv3 not found');

    const { keyword: kw1, json: charaObj } = decodeTextChunk(charaChunk);
    const { keyword: kw2, json: ccv3Obj } = decodeTextChunk(ccv3Chunk);

    console.log('chara keyword:', kw1);
    console.log('ccv3 keyword:', kw2);

    const charaEntries = charaObj.data.character_book.entries;
    const ccv3Entries = ccv3Obj.data.character_book.entries;

    console.log('chara entry count:', charaEntries.length);
    console.log('ccv3 entry count:', ccv3Entries.length);

    // 7. Verify total entry count is 188
    if (charaEntries.length !== 188) throw new Error('Expected 188 chara entries, got ' + charaEntries.length);
    if (ccv3Entries.length !== 188) throw new Error('Expected 188 ccv3 entries, got ' + ccv3Entries.length);
    console.log('\n[OK] Entry count: 188');

    // 3. Verify protagonist entry
    const c1 = charaEntries.find(e => e.comment === 'sao-主角设定');
    if (!c1) throw new Error('C1 protagonist entry not found');
    if (!c1.constant) throw new Error('C1 constant not true');
    if (!c1.content.includes('独特技能「月蚀」')) throw new Error('C1 missing 月蚀');
    if (!c1.content.includes('碎月')) throw new Error('C1 missing 碎月');
    if (!c1.content.includes('{{user}}')) throw new Error('C1 missing {{user}}');
    console.log('[OK] C1: protagonist entry present with correct content');
    console.log('     Keys:', Object.keys(c1).join(', '));

    // 4. Verify Asuna entry
    const c2 = charaEntries.find(e => e.comment === 'sao-亚丝娜');
    if (!c2) throw new Error('C2 Asuna entry not found');
    if (c2.content.includes('与桐人产生深刻羁绊')) throw new Error('C2 still has old 桐人 string');
    if (!c2.content.includes('与值得信任的同伴产生深刻羁绊')) throw new Error('C2 replacement missing');
    console.log('[OK] C2: Asuna entry updated (no 桐人 in target string)');

    // 5. Verify Kirito entry
    const c3 = charaEntries.find(e => e.comment === 'sao-桐谷和人');
    if (!c3) throw new Error('C3 Kirito entry not found');
    let kiritoContent;
    try {
        kiritoContent = JSON.parse(c3.content);
    } catch (e) {
        const m = c3.content.match(/^```json\s*\n([\s\S]*?)\n```\s*$/);
        if (m) kiritoContent = JSON.parse(m[1]);
        else throw new Error('C3 Kirito content not JSON');
    }
    const us = kiritoContent.characterProfile.uniqueSkill;
    if (!us) throw new Error('C3 uniqueSkill missing');
    if (us.name !== '二刀流') throw new Error('C3 uniqueSkill.name wrong: ' + us.name);
    if (!us.description.includes('星爆气流斩')) throw new Error('C3 uniqueSkill.description missing 星爆气流斩');

    // Verify field ordering
    const keys = Object.keys(kiritoContent.characterProfile);
    const biIdx = keys.indexOf('basicInfo');
    const usIdx = keys.indexOf('uniqueSkill');
    const adIdx = keys.indexOf('appearanceDetails');
    if (biIdx === -1 || usIdx === -1 || adIdx === -1) throw new Error('C3 missing required fields');
    if (!(biIdx < usIdx && usIdx < adIdx)) throw new Error('C3 field order wrong: basicInfo(' + biIdx + ') -> uniqueSkill(' + usIdx + ') -> appearanceDetails(' + adIdx + ')');
    console.log('[OK] C3: Kirito entry has uniqueSkill (二刀流) between basicInfo and appearanceDetails');

    // 6. Verify both chunks have identical JSON
    const cj = JSON.stringify(charaObj);
    const vj = JSON.stringify(ccv3Obj);
    if (cj !== vj) throw new Error('chara and ccv3 JSON differ!');
    console.log('[OK] chara == ccv3: identical JSON (' + cj.length + ' chars)');

    // Verify no other entries were broken: check entry count and comment hash
    const ccv3CommentList = ccv3Entries.map(e => e.comment).join('|');
    const charaCommentList = charaEntries.map(e => e.comment).join('|');
    if (ccv3CommentList !== charaCommentList) throw new Error('Entry comment lists differ between chara and ccv3');
    console.log('[OK] chara and ccv3 entry comment lists identical (' + charaEntries.length + ' entries)');

    // File size
    const size = fs.statSync(PNG_PATH).size;
    const bakSize = fs.statSync(PNG_PATH.replace('.png', '.png.before_worldbook_c1c2c3')).size;
    console.log('\nFile size: ' + bakSize + ' -> ' + size + ' (delta: ' + (size - bakSize) + ')');

    console.log('\n=== ALL VERIFICATIONS PASSED ===');
}

main();
