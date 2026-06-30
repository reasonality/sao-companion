#!/usr/bin/env node
'use strict';

const fs = require('fs');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';

const SCRIPTS_TO_DELETE = [
    '战斗1.30电脑', '战斗1.30手机',
    '日期', '剑技栏', '装备栏', '角色状态栏', '地图2',
    '隐藏摘要', '隐藏npc', '隐藏日历', '隐藏战斗', '隐藏状态栏',
    '隐藏地图', '隐藏骰子', '隐藏npc思维链', '隐藏公会状态栏',
    '隐藏回复', '隐藏预告', '去除用户消息',
];

const SCRIPTS_TO_DELETE_SET = new Set(SCRIPTS_TO_DELETE);

// PNG CRC32 table
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

function filterScripts(obj) {
    // Check data.extensions.regex_scripts first, then extensions.regex_scripts
    let scripts = obj?.data?.extensions?.regex_scripts;
    if (scripts) {
        const before = scripts.length;
        obj.data.extensions.regex_scripts = scripts.filter(s => !SCRIPTS_TO_DELETE_SET.has(s.scriptName));
        const after = obj.data.extensions.regex_scripts.length;
        return { before, after, location: 'data.extensions.regex_scripts' };
    }
    scripts = obj?.extensions?.regex_scripts;
    if (scripts) {
        const before = scripts.length;
        obj.extensions.regex_scripts = scripts.filter(s => !SCRIPTS_TO_DELETE_SET.has(s.scriptName));
        const after = obj.extensions.regex_scripts.length;
        return { before, after, location: 'extensions.regex_scripts' };
    }
    return null;
}

function main() {
    const tmpPath = PNG_PATH + '.tmp';
    try {
        const originalPngBuf = fs.readFileSync(PNG_PATH);
        console.log(`原始 PNG 大小: ${originalPngBuf.length} bytes`);

        // Parse JSON from file to get original length
        const originalJsonStr = fs.readFileSync(JSON_PATH, 'utf8');
        console.log(`原始 JSON 长度: ${originalJsonStr.length} bytes`);

        // Read PNG chunks
        const chunks = readPngChunks(PNG_PATH);
        console.log(`PNG chunk 数量: ${chunks.length}`);

        // Find chara and ccv3 tEXt chunks
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
        console.log(`chara chunk index: ${charaIdx}, ccv3 chunk index: ${ccv3Idx}`);

        if (charaIdx === -1 || ccv3Idx === -1) {
            throw new Error('chara or ccv3 tEXt chunk not found');
        }

        // Decode chara
        const charaText = chunks[charaIdx].data.slice(chunks[charaIdx].data.indexOf(0) + 1).toString('latin1');
        const charaJsonStr = Buffer.from(charaText, 'base64').toString('utf8');
        const charaObj = JSON.parse(charaJsonStr);

        // Decode ccv3
        const ccv3Text = chunks[ccv3Idx].data.slice(chunks[ccv3Idx].data.indexOf(0) + 1).toString('latin1');
        const ccv3JsonStr = Buffer.from(ccv3Text, 'base64').toString('utf8');
        const ccv3Obj = JSON.parse(ccv3JsonStr);

        // Filter scripts in both
        const result1 = filterScripts(charaObj);
        const result2 = filterScripts(ccv3Obj);

        if (!result1 || !result2) {
            throw new Error('regex_scripts not found in JSON');
        }

        console.log(`\nchara: ${result1.location}`);
        console.log(`  删除前脚本数: ${result1.before}`);
        console.log(`  删除后脚本数: ${result1.after}`);
        console.log(`  删除了 ${result1.before - result1.after} 个脚本`);

        console.log(`\nccv3: ${result2.location}`);
        console.log(`  删除前脚本数: ${result2.before}`);
        console.log(`  删除后脚本数: ${result2.after}`);
        console.log(`  删除了 ${result2.before - result2.after} 个脚本`);

        // Verify remaining scripts
        const remainingScripts = charaObj.data.extensions.regex_scripts;
        console.log(`\n剩余脚本 (${remainingScripts.length}):`);
        for (const s of remainingScripts) {
            console.log(`  - ${s.scriptName} (disabled: ${s.disabled})`);
        }

        // Verify key scripts exist
        const keepNames = remainingScripts.map(s => s.scriptName);
        const requiredKeep = ['npc状态栏', '摘要', '公会状态栏', '快速回复', '开场白'];
        for (const name of requiredKeep) {
            if (!keepNames.includes(name)) {
                console.error(`ERROR: 必须保留的脚本 "${name}" 未找到!`);
                process.exit(1);
            }
        }
        console.log('\n✓ 关键保留脚本验证通过');

        // Convert to compact JSON
        const compactJson = JSON.stringify(charaObj);
        console.log(`\n紧凑 JSON 长度: ${compactJson.length} bytes`);
        console.log(`JSON 压缩比: ${((1 - compactJson.length / charaJsonStr.length) * 100).toFixed(1)}%`);

        // Verify chara and ccv3 produce same compact JSON
        const ccv3Compact = JSON.stringify(ccv3Obj);
        if (compactJson !== ccv3Compact) {
            throw new Error('chara and ccv3 compact JSON differ!');
        }
        console.log('✓ chara 和 ccv3 紧凑 JSON 一致');

        // Base64 encode
        const newBase64 = Buffer.from(compactJson, 'utf8').toString('base64');
        console.log(`base64 长度: ${newBase64.length} bytes`);

        // Build new tEXt chunk data for each keyword
        const charaTextData = buildTextChunkData('chara', newBase64);
        const ccv3TextData = buildTextChunkData('ccv3', newBase64);

        // Replace chara and ccv3 chunks with their respective keywords
        chunks[charaIdx] = { type: 'tEXt', data: charaTextData };
        chunks[ccv3Idx] = { type: 'tEXt', data: ccv3TextData };

        // Rebuild PNG
        const newPng = buildPng(chunks);
        console.log(`\n新 PNG 大小: ${newPng.length} bytes`);
        console.log(`PNG 压缩: ${originalPngBuf.length} → ${newPng.length} (${((1 - newPng.length / originalPngBuf.length) * 100).toFixed(1)}% 减少)`);

        // Belt-and-suspenders: backup before overwriting
        fs.copyFileSync(PNG_PATH, PNG_PATH + '.bak');

        // Atomic PNG write: write to .tmp first, then rename (atomic on NTFS)
        fs.writeFileSync(tmpPath, newPng);
        fs.renameSync(tmpPath, PNG_PATH);
        console.log(`\n✓ 已写入 ${PNG_PATH}`);

        // Write extracted JSON (compact)
        fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
        console.log(`✓ 已写入 ${JSON_PATH}`);

        // Final verification: re-read PNG and verify
        const verifyBuf = fs.readFileSync(PNG_PATH);
        if (!verifyBuf.slice(0, 8).equals(PNG_SIGNATURE)) {
            throw new Error('Written PNG has invalid signature!');
        }
        console.log('✓ PNG 签名验证通过');

        console.log('\n=== 完成 ===');
        console.log(`原始 PNG: ${originalPngBuf.length} bytes`);
        console.log(`新 PNG:   ${newPng.length} bytes`);
        console.log(`节省:     ${originalPngBuf.length - newPng.length} bytes (${((1 - newPng.length / originalPngBuf.length) * 100).toFixed(1)}%)`);
    } catch (err) {
        // Cleanup: if the .tmp file was left behind from a failed write, delete it
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
                console.error(`已清理临时文件 ${tmpPath}`);
            }
        } catch (_) {
            // ignore cleanup errors
        }
        throw err;
    }
}

main();
