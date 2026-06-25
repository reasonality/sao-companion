#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PNG_PATH = process.argv[2] || 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = process.argv[3] || 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';

// PNG signature
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parsePngTextChunks(filePath) {
    const buf = fs.readFileSync(filePath);
    if (!buf.slice(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Invalid PNG signature');
    }
    let offset = 8;
    const chunks = [];
    while (offset < buf.length) {
        if (offset + 8 > buf.length) break;
        const length = buf.readUInt32BE(offset);
        const type = buf.slice(offset + 4, offset + 8).toString('ascii');
        if (type === 'IEND') break;
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd > buf.length) break;
        const data = buf.slice(dataStart, dataEnd);
        if (type === 'tEXt') {
            const nullIdx = data.indexOf(0);
            if (nullIdx !== -1) {
                const keyword = data.slice(0, nullIdx).toString('latin1');
                const text = data.slice(nullIdx + 1).toString('latin1');
                chunks.push({ keyword, text });
            }
        }
        offset = dataEnd + 4; // skip CRC
    }
    return chunks;
}

function decodeBase64Json(b64) {
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
}

function getCharInfo(json) {
    const name = json.name || json.char_name || '';
    const id = json.id || json.char_id || name;
    return { name, id };
}

function getRegexScripts(json) {
    return json?.data?.extensions?.regex_scripts ||
           json?.data?.extensions?.regexScripts ||
           json?.extensions?.regex_scripts ||
           json?.extensions?.regexScripts ||
           [];
}

function main() {
    const results = [];
    let failures = 0;

    // 1. Parse PNG tEXt chunks
    let textChunks;
    try {
        textChunks = parsePngTextChunks(PNG_PATH);
    } catch (e) {
        console.error('Failed to parse PNG:', e.message);
        process.exit(1);
    }

    // Extract chara and ccv3
    const charaChunk = textChunks.find(c => c.keyword === 'chara');
    const ccv3Chunk = textChunks.find(c => c.keyword === 'ccv3');

    let charaJson = null;
    let ccv3Json = null;
    let charaRawBase64 = null;
    let ccv3RawBase64 = null;

    // Decode chara
    if (charaChunk) {
        charaRawBase64 = charaChunk.text;
        try {
            charaJson = decodeBase64Json(charaChunk.text);
            const info = getCharInfo(charaJson);
            console.log(`chara json_ok ${info.name} ${info.id}`);
            results.push({ name: 'chara_json', ok: true });
        } catch (e) {
            console.log(`chara json_fail`);
            results.push({ name: 'chara_json', ok: false });
            failures++;
        }
    } else {
        console.log('chara not_found');
        results.push({ name: 'chara_json', ok: false });
        failures++;
    }

    // Decode ccv3
    if (ccv3Chunk) {
        ccv3RawBase64 = ccv3Chunk.text;
        try {
            ccv3Json = decodeBase64Json(ccv3Chunk.text);
            const info = getCharInfo(ccv3Json);
            console.log(`ccv3 json_ok ${info.name} ${info.id}`);
            results.push({ name: 'ccv3_json', ok: true });
        } catch (e) {
            console.log(`ccv3 json_fail`);
            results.push({ name: 'ccv3_json', ok: false });
            failures++;
        }
    } else {
        console.log('ccv3 not_found');
        results.push({ name: 'ccv3_json', ok: false });
        failures++;
    }

    // 3. Compare chara and ccv3 JSON strings
    if (charaJson && ccv3Json) {
        const equal = JSON.stringify(charaJson) === JSON.stringify(ccv3Json);
        console.log(`chara_eq_ccv3 ${equal}`);
        results.push({ name: 'chara_eq_ccv3', ok: equal });
        if (!equal) failures++;
    } else {
        console.log('chara_eq_ccv3 False');
        results.push({ name: 'chara_eq_ccv3', ok: false });
        failures++;
    }

    // 4. Compare with extracted JSON file
    let fileJson = null;
    if (fs.existsSync(JSON_PATH)) {
        try {
            fileJson = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
            const equal = JSON.stringify(charaJson) === JSON.stringify(fileJson);
            console.log(`json_file_eq_png ${equal}`);
            results.push({ name: 'json_file_eq_png', ok: equal });
            if (!equal) failures++;
        } catch (e) {
            console.log('json_file_eq_png False (read error)');
            results.push({ name: 'json_file_eq_png', ok: false });
            failures++;
        }
    } else {
        console.log('json_file_eq_png False (file not found)');
        results.push({ name: 'json_file_eq_png', ok: false });
        failures++;
    }

    // 5. Check 战斗1.30 regex scripts should NOT exist (deleted)
    const jsonForRegex = charaJson || fileJson;
    if (jsonForRegex) {
        const regexScripts = getRegexScripts(jsonForRegex);
        const battleScripts = regexScripts.filter(s =>
            s.scriptName && s.scriptName.includes('战斗1.30')
        );
        for (const name of ['战斗1.30电脑', '战斗1.30手机']) {
            const found = battleScripts.find(s => s.scriptName === name);
            const ok = !found;
            console.log(`${name} deleted ${ok} ${ok ? 'PASS' : 'FAIL'}`);
            results.push({ name: `${name}_deleted`, ok });
            if (!ok) failures++;
        }
    }

    // 6. Check migrated scripts should NOT exist (deleted)
    const DELETED_SCRIPTS = [
        '战斗1.30电脑', '战斗1.30手机',
        '日期', '角色状态栏', '装备栏', '剑技栏', '地图2',
        '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
        '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏',
        '隐藏回复', '隐藏预告', '去除用户消息',
    ];

    if (jsonForRegex) {
        const regexScripts2 = getRegexScripts(jsonForRegex);
        const byName = {};
        for (const s of regexScripts2) byName[s.scriptName] = s;

        for (const name of DELETED_SCRIPTS) {
            const s = byName[name];
            const ok = !s;
            console.log(`${name} deleted ${ok} ${ok ? 'PASS' : 'FAIL'}`);
            results.push({ name: `${name}_deleted`, ok });
            if (!ok) failures++;
        }
    }

    // 7. Check remaining 8 scripts exist with correct disabled state
    const EXPECTED_SCRIPTS = [
        { name: 'npc状态栏', disabled: true },
        { name: '如果想玩桐子开这个正则，不是不开', disabled: true },
        { name: '去除前导空白', disabled: false },
        { name: '清理显示标签', disabled: false },
        { name: '摘要', disabled: false },
        { name: '公会状态栏', disabled: false },
        { name: '快速回复', disabled: false },
        { name: '开场白', disabled: false },
    ];

    if (jsonForRegex) {
        const regexScripts3 = getRegexScripts(jsonForRegex);
        const byName2 = {};
        for (const s of regexScripts3) byName2[s.scriptName] = s;

        console.log(`\nregex_scripts 总数: ${regexScripts3.length}`);
        for (const expected of EXPECTED_SCRIPTS) {
            const s = byName2[expected.name];
            if (!s) {
                console.log(`${expected.name} not_found FAIL`);
                results.push({ name: `${expected.name}_kept`, ok: false });
                failures++;
            } else {
                const ok = s.disabled === expected.disabled;
                console.log(`${expected.name} disabled=${s.disabled} ${ok ? 'PASS' : 'FAIL'}`);
                results.push({ name: `${expected.name}_kept`, ok });
                if (!ok) failures++;
            }
        }
    }

    // 8. Check JSON compact format (from base64 decoded content)
    if (charaRawBase64) {
        try {
            const decodedJson = Buffer.from(charaRawBase64, 'base64').toString('utf8');
            // Compact JSON: after first { the next char should be " (not \n + spaces)
            const isCompact = decodedJson.length > 1 && decodedJson[1] === '"';
            console.log(`json_compact_format ${isCompact} ${isCompact ? 'PASS' : 'FAIL'}`);
            results.push({ name: 'json_compact_format', ok: isCompact });
            if (!isCompact) failures++;
        } catch (e) {
            console.log('json_compact_format FAIL (decode error)');
            results.push({ name: 'json_compact_format', ok: false });
            failures++;
        }
    }

    // Summary
    console.log('\n=== 验收结果 ===');
    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    console.log(`通过: ${passed}/${total}`);
    if (failures === 0) {
        console.log('全部通过');
    } else {
        console.log(`有 ${failures} 项失败`);
    }

    process.exit(failures === 0 ? 0 : 1);
}

main();
