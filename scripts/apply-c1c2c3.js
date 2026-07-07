#!/usr/bin/env node
'use strict';

/**
 * apply-c1c2c3.js
 * Applies 3 changes to the SAO character card PNG worldbook:
 *   C1: Add new protagonist entry (sao-主角设定)
 *   C2: Modify Asuna entry — replace 桐人 reference in one logic field
 *   C3: Modify Kirito entry — add uniqueSkill field
 */

const fs = require('fs');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/刀剑神域SAO V2.1.0.png';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/刀剑神域SAO V2.1.0.png.before_worldbook_c1c2c3';

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

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== apply-c1c2c3 ===\n');

    // (1) Backup
    if (!fs.existsSync(BAK_PATH)) {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`✓ Created backup: ${BAK_PATH}`);
    } else {
        console.log(`  Backup already exists: ${BAK_PATH}`);
    }

    const sizeBefore = fs.statSync(PNG_PATH).size;
    console.log(`  PNG size before: ${sizeBefore} bytes`);

    // (2) Read PNG and decode both chunks
    const chunks = readPngChunks(PNG_PATH);
    console.log(`  PNG chunks: ${chunks.length}`);

    const charaChunk = findTextChunk(chunks, 'chara');
    const ccv3Chunk = findTextChunk(chunks, 'ccv3');
    if (!charaChunk) throw new Error('chara tEXt chunk not found');
    if (!ccv3Chunk) throw new Error('ccv3 tEXt chunk not found');
    console.log('  Found chara and ccv3 chunks');

    const obj = decodeTextChunkData(charaChunk);
    const entries = obj.data?.character_book?.entries;
    if (!Array.isArray(entries)) throw new Error('character_book.entries is not an array');
    console.log(`  Total entries before: ${entries.length}`);

    // ── C1: Add protagonist entry ──────────────────────────────────────
    const c1Comment = 'sao-主角设定';
    const existingC1 = entries.find(e => e.comment === c1Comment);
    if (existingC1) {
        console.log(`  ⚠ C1: Entry "${c1Comment}" already exists (skipping)`);
    } else {
        const newEntry = {
            "comment": "sao-主角设定",
            "content": "# 主角设定（{{user}}）\n\n## 现实世界\n- 姓名：{{user}}（由用户设定）\n- 外貌：18岁白发红瞳少女。身高150cm，体重38KG，萝莉身材，A罩杯。皮肤白皙，长相极其可爱，像洋娃娃公主。私处是白虎一线天，未经历任何触碰。\n- 性格：内心善良；冷静果断；由于身体原因，与人的交流较少，但渴望有知己；和熟悉的人说话会比较幽默，也会带点小傲娇；和关系特别好的人在一起时会表现出少女的一面。\n- 体质：病弱，在15岁被诊断出罕见的哮喘病症后，一直在私人医院卧床。但{{user}}有着超乎常人的计算能力，可以在瞬间完成对当前状况的分析和最佳行动方式；与此同时，也有着很强的身体柔韧性，可以做出很多一般人做不到的动作。\n- 爱好：对电脑技术很感兴趣，是电子领域大神，很喜欢电子游戏。由于离谱的计算能力，{{user}}在各个游戏上的表现都很强。除此之外，{{user}}对做饭也比较感兴趣。\n- 性取向：因长得好还有能力，被许多男性追求，但{{user}}全都无感。{{user}}没有意识到自己是女同性恋，反而以为自己性冷淡。实际在恋爱关系中会是被动的一方。\n- 身世与经历：夜灵科技公司大小姐，同时也是公司在国内的总负责人。父母对{{user}}非常放心，常年在国外经营，国内全权交给{{user}}。在{{user}}进入SAO死亡世界后，凭借公司内极强的凝聚力，没有发生太大的震动。手下人全部按部就班忠心耿耿的维持着公司正常运作。{{user}}则在私人医院由一名贴身女仆照顾。\n\n## SAO游戏内\n- 封测时期：{{user}}是封测玩家，攻略进度一度排在最高。后来因身体原因被桐人超过，但依旧是攻略进度第二高的玩家。由于{{user}}总是独行且是罕见的女性高玩，被其他封测玩家称为\"碎月\"。\n- 战斗风格：擅长找到敌方弱点后进行刺杀，但在队伍缺少前排的时候充当闪避盾。无论哪种方式都是高风险高收益。{{user}}的战斗过程很美，凭借出色的身体柔韧性，宛如跳舞一般，也经常能做出一般人做不到的动作。{{user}}现实中的病弱身体偶尔会对游戏中的她造成影响。\n- 独特技能：{{user}}拥有独特技能「月蚀」，通过冥想修炼解锁。月蚀是与二刀流、神圣剑并列的SAO十大独特技能之一，获取条件为\"最强的计算能力\"。\n- 社交定位：{{user}}因身体原因对组队有所顾虑，倾向于独行。但内心渴望知己，一旦建立信任会非常珍视。",
            "constant": true,
            "selective": false,
            "keys": [],
            "disable": false,
            "order": 100,
            "position": "before_char"
        };
        entries.push(newEntry);
        console.log(`  ✓ C1: Added entry "${c1Comment}" (${newEntry.content.length} chars)`);
    }

    // ── C2: Modify Asuna entry ─────────────────────────────────────────
    const asunaEntry = entries.find(e => e.comment === 'sao-亚丝娜');
    if (!asunaEntry) {
        console.error('  ✗ C2: Entry "sao-亚丝娜" not found!');
    } else {
        const c2Old = '这也是她日后能够与桐人产生深刻羁绊、并展现出强大包容力的根源。';
        const c2New = '这也是她日后能够与值得信任的同伴产生深刻羁绊、并展现出强大包容力的根源。';
        if (asunaEntry.content.includes(c2Old)) {
            asunaEntry.content = asunaEntry.content.replace(c2Old, c2New);
            console.log('  ✓ C2: Replaced 桐人 reference in Asuna entry');
        } else if (asunaEntry.content.includes(c2New)) {
            console.log('  ⚠ C2: Already replaced (skipping)');
        } else {
            console.error('  ✗ C2: Target string not found in Asuna content!');
        }
    }

    // ── C3: Modify Kirito entry ────────────────────────────────────────
    const kiritoEntry = entries.find(e => e.comment === 'sao-桐谷和人');
    if (!kiritoEntry) {
        console.error('  ✗ C3: Entry "sao-桐谷和人" not found!');
    } else {
        // Parse the Kirito content — may be wrapped in ```json...``` fences
        let kiritoContent;
        let kiritoFences = null;
        try {
            kiritoContent = JSON.parse(kiritoEntry.content);
        } catch (e) {
            // Try stripping markdown code fences
            const fenceMatch = kiritoEntry.content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
            if (fenceMatch) {
                kiritoFences = { prefix: '```json\n', suffix: '\n```' };
                kiritoContent = JSON.parse(fenceMatch[1]);
            } else {
                console.error('  ✗ C3: Kirito content is not valid JSON and not fenced: ' + e.message);
                kiritoContent = null;
            }
        }

        if (kiritoContent?.characterProfile) {
            const cp = kiritoContent.characterProfile;
            if (cp.uniqueSkill) {
                console.log('  ⚠ C3: Kirito already has uniqueSkill field (skipping)');
            } else if (!cp.basicInfo) {
                console.error('  ✗ C3: Kirito characterProfile.basicInfo not found!');
            } else {
                // Insert uniqueSkill between basicInfo and appearanceDetails
                const newCp = {};
                for (const [key, value] of Object.entries(cp)) {
                    newCp[key] = value;
                    if (key === 'basicInfo') {
                        newCp.uniqueSkill = {
                            "name": "二刀流",
                            "description": "SAO十大独特技能之一，获取条件为\"反应速度最快的玩家\"。桐人在战斗中首次觉醒此技能，双持单手剑进行高速连击，代表性剑技为星爆气流斩（16连击）。"
                        };
                    }
                }
                kiritoContent.characterProfile = newCp;
                const innerJson = JSON.stringify(kiritoContent);
                kiritoEntry.content = kiritoFences
                    ? kiritoFences.prefix + innerJson + kiritoFences.suffix
                    : innerJson;
                console.log('  ✓ C3: Added uniqueSkill field to Kirito entry');
            }
        }
    }

    console.log(`  Total entries after: ${entries.length}`);

    // (3) Re-encode and write both chunks
    const compactJson = JSON.stringify(obj); // NO spacing
    const newBase64 = Buffer.from(compactJson, 'utf8').toString('base64');
    console.log(`  New base64 length: ${newBase64.length} bytes`);

    // Find chunk indices
    let charaIdx = -1, ccv3Idx = -1;
    for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].type === 'tEXt') {
            const ni = chunks[i].data.indexOf(0);
            if (ni !== -1) {
                const kw = chunks[i].data.slice(0, ni).toString('latin1');
                if (kw === 'chara') charaIdx = i;
                if (kw === 'ccv3') ccv3Idx = i;
            }
        }
    }

    const charaTextData = buildTextChunkData('chara', newBase64);
    const ccv3TextData = buildTextChunkData('ccv3', newBase64);
    chunks[charaIdx] = { type: 'tEXt', data: charaTextData };
    chunks[ccv3Idx] = { type: 'tEXt', data: ccv3TextData };

    // (4) Rebuild PNG and write atomically
    const newPng = buildPng(chunks);
    console.log(`  New PNG size: ${newPng.length} bytes (delta: ${newPng.length - sizeBefore})`);

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
    console.log(`✓ Wrote PNG atomically`);

    // (5) Verify: re-read and check both chunks
    const verifyChunks = readPngChunks(PNG_PATH);
    function verifyChunk(label) {
        const chunk = findTextChunk(verifyChunks, label);
        if (!chunk) throw new Error(`Verification failed: ${label} chunk not found`);
        const vObj = decodeTextChunkData(chunk);
        const vEntries = vObj.data?.character_book?.entries || [];

        // C1: protagonist entry exists
        const vC1 = vEntries.find(e => e.comment === 'sao-主角设定');
        if (!vC1) throw new Error(`Verify ${label}: C1 protagonist entry missing`);
        if (!vC1.content.includes('独特技能「月蚀」')) throw new Error(`Verify ${label}: C1 content missing 月蚀`);
        if (vC1.constant !== true) throw new Error(`Verify ${label}: C1 constant not true`);

        // C2: Asuna no longer has 桐人 in that specific string
        const vAsuna = vEntries.find(e => e.comment === 'sao-亚丝娜');
        if (!vAsuna) throw new Error(`Verify ${label}: C2 Asuna entry missing`);
        if (vAsuna.content.includes('与桐人产生深刻羁绊')) throw new Error(`Verify ${label}: C2 still has 桐人 reference`);
        if (!vAsuna.content.includes('与值得信任的同伴产生深刻羁绊')) throw new Error(`Verify ${label}: C2 replacement missing`);

        // C3: Kirito has uniqueSkill
        const vKirito = vEntries.find(e => e.comment === 'sao-桐谷和人');
        if (!vKirito) throw new Error(`Verify ${label}: C3 Kirito entry missing`);
        let vKiritoContent;
        try {
            vKiritoContent = JSON.parse(vKirito.content);
        } catch (e) {
            const fenceMatch = vKirito.content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
            if (fenceMatch) {
                vKiritoContent = JSON.parse(fenceMatch[1]);
            } else {
                throw new Error(`Verify ${label}: C3 Kirito content not JSON`);
            }
        }
        if (!vKiritoContent.characterProfile?.uniqueSkill) throw new Error(`Verify ${label}: C3 uniqueSkill missing`);
        if (vKiritoContent.characterProfile.uniqueSkill.name !== '二刀流') throw new Error(`Verify ${label}: C3 uniqueSkill.name wrong`);

        // Entry count
        if (vEntries.length !== 188) throw new Error(`Verify ${label}: Expected 188 entries, got ${vEntries.length}`);

        return vObj;
    }

    const verifyChara = verifyChunk('chara');
    const verifyCcv3 = verifyChunk('ccv3');

    // Verify both chunks are identical
    const charaJson = JSON.stringify(verifyChara);
    const ccv3Json = JSON.stringify(verifyCcv3);
    if (charaJson !== ccv3Json) throw new Error('Verification failed: chara and ccv3 JSON differ');

    console.log('\n✓ All verifications passed:');
    console.log('  - C1: protagonist entry added with 月蚀 content');
    console.log('  - C2: Asuna 桐人 reference replaced');
    console.log('  - C3: Kirito uniqueSkill field added');
    console.log('  - Entry count: 188');
    console.log('  - chara == ccv3: identical');

    const sizeAfter = fs.statSync(PNG_PATH).size;
    console.log(`\n  PNG size: ${sizeBefore} → ${sizeAfter} bytes (delta: ${sizeAfter - sizeBefore})`);
    console.log('\n=== Done ===');
}

main();
