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

    // Decode chara
    if (charaChunk) {
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

    // 5. Check regex scripts with scriptName containing "战斗1.30"
    const jsonForRegex = charaJson || fileJson;
    if (jsonForRegex) {
        const regexScripts = jsonForRegex.data?.extensions?.regex_scripts ||
                             jsonForRegex.data?.extensions?.regexScripts ||
                             jsonForRegex.extensions?.regex_scripts ||
                             jsonForRegex.extensions?.regexScripts ||
                             [];
        const targetScripts = regexScripts.filter(s => 
            s.scriptName && s.scriptName.includes('战斗1.30')
        );
        for (const script of targetScripts) {
            const replaceStr = script.replaceString || '';
            const len = replaceStr.length;
            const startsFence = replaceStr.startsWith('```');
            const endsFence = replaceStr.endsWith('```');
            // premature: </head></html> followed by <body>
            const premature = /<\/head><\/html>\s*<body>/i.test(replaceStr);
            console.log(`${script.scriptName} len ${len} startsFence ${startsFence} endsFence ${endsFence} premature ${premature}`);
            const ok = !premature; // we consider it a failure if premature is true
            results.push({ name: script.scriptName, ok });
            if (!ok) failures++;
        }
        if (targetScripts.length === 0) {
            console.log('No regex scripts with "战斗1.30" found');
        }
    } else {
        console.log('No JSON available to check regex scripts');
    }

    // 6. Check migrated scripts are disabled (Phase 1/2/3 migration)
    const MIGRATED_SCRIPTS = [
        // Phase 1 display (5)
        '日期', '角色状态栏', '装备栏', '剑技栏', '地图2',
        // Phase 2 battle (1)
        '战斗1.30电脑',
        // Phase 3 promptOnly (11)
        '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
        '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏', '隐藏回复', '隐藏预告',
    ];
    // Scripts that should STAY enabled (whitelist)
    const WHITELIST_SCRIPTS = ['摘要', '公会状态栏', '快速回复', '开场白'];
    if (jsonForRegex) {
        const regexScripts2 = jsonForRegex.data?.extensions?.regex_scripts || [];
        const byName = {};
        for (const s of regexScripts2) byName[s.scriptName] = s;

        // 6a. Migrated scripts must be disabled:true
        for (const name of MIGRATED_SCRIPTS) {
            const s = byName[name];
            if (!s) {
                console.log(`${name} not_found`);
                results.push({ name: `${name}_disabled`, ok: false });
                failures++;
            } else {
                const ok = s.disabled === true;
                console.log(`${name} disabled ${s.disabled} ${ok ? 'PASS' : 'FAIL'}`);
                results.push({ name: `${name}_disabled`, ok });
                if (!ok) failures++;
            }
        }
        // 6b. 战斗1.30手机 must stay disabled:true (user-manual)
        const mobile = byName['战斗1.30手机'];
        if (mobile) {
            const ok = mobile.disabled === true;
            console.log(`战斗1.30手机 disabled ${mobile.disabled} ${ok ? 'PASS' : 'FAIL'}`);
            results.push({ name: '战斗1.30手机_disabled', ok });
            if (!ok) failures++;
        }
        // 6c. Whitelist scripts must stay enabled (disabled:false)
        for (const name of WHITELIST_SCRIPTS) {
            const s = byName[name];
            if (s) {
                const ok = s.disabled === false;
                console.log(`${name} disabled ${s.disabled} ${ok ? 'PASS' : 'FAIL'}`);
                results.push({ name: `${name}_enabled`, ok });
                if (!ok) failures++;
            }
        }
    }

    // 7. Summary
    console.log('=== 验收结果 ===');
    if (failures === 0) {
        console.log('全部通过');
    } else {
        console.log(`有 ${failures} 项失败`);
    }

    process.exit(failures === 0 ? 0 : 1);
}

main();