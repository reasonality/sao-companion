#!/usr/bin/env node
'use strict';

/**
 * compact-worldbook-entries.js
 * Reformats all 239 world book entries from decorated Markdown to compact format.
 * Content information is 100% preserved — only format/structure changes.
 *
 * Entry types:
 *  Type 1: Floor entries (sao-第N层)
 *  Type 2: Timeline entries (YYYY年M月时间线/时间表)
 *  Type 3: NPC profiles (```json / characterProfile) — UNCHANGED
 *  Type 4: Directive entries (<directive) — minimal cleanup
 *  Type 5-7: Other sao-/mixed entries with markdown — compact cleanup
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.png';
const JSON_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0_extracted.json';
const BAK_PATH = 'C:/Users/23934/Desktop/AI/SAO-card/2.0.0.before_compact.png';

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

// ── Common transformations ─────────────────────────────────────────────

function removeBold(text) {
    // Remove ** bold markers but keep text inside
    return text.replace(/\*\*([^*]+?)\*\*/g, '$1');
}

function removeHR(text) {
    // Remove --- horizontal rules (line that is just --- with optional whitespace)
    return text.replace(/^---\s*$/gm, '');
}

function collapseBlankLines(text) {
    // Collapse 3+ consecutive blank lines to 2 (one empty line)
    return text.replace(/\n{3,}/g, '\n\n');
}

function removeIndentation(text) {
    // Remove all leading indentation (spaces/tabs at line start)
    return text.replace(/^[ \t]+/gm, '');
}

function trimLines(text) {
    // Trim trailing whitespace on each line
    return text.replace(/[ \t]+$/gm, '');
}

function cleanFinal(text) {
    text = trimLines(text);
    text = collapseBlankLines(text);
    text = text.trim();
    return text;
}

// ── Type classification ────────────────────────────────────────────────

const TYPE_FLOOR = 1;
const TYPE_TIMELINE = 2;
const TYPE_NPC = 3;
const TYPE_DIRECTIVE = 4;
const TYPE_OTHER = 5;

function classifyEntry(entry) {
    const comment = entry.comment || '';
    const content = entry.content || '';

    // Type 3: NPC profiles (JSON)
    if (content.startsWith('```json') || content.includes('characterProfile') || content.includes('characterLook')) {
        return TYPE_NPC;
    }

    // Type 4: Directive entries (XML)
    if (content.includes('<directive')) {
        return TYPE_DIRECTIVE;
    }

    // Type 1: Floor entries
    if (/^sao-第\d+层$/.test(comment)) {
        return TYPE_FLOOR;
    }

    // Type 2: Timeline entries
    if (/\d{4}年\d{1,2}月(时间线|时间表)/.test(comment)) {
        return TYPE_TIMELINE;
    }

    // Type 5: Other entries with markdown
    return TYPE_OTHER;
}

// ── Type 1: Floor entry transformation ─────────────────────────────────

function transformFloorEntry(content, comment) {
    let text = content;

    // ── PHASE 1: Structural transforms (bold markers still present) ──

    // Remove --- horizontal rules
    text = removeHR(text);

    // Remove ### **【AI核心指令：...】** heading line
    text = text.replace(/^###\s*\*\*【AI核心指令：.*?】\*\*\s*$/gm, '');

    // Remove **[系统提示：...]** line
    text = text.replace(/^\*\*\[系统提示：.*?\]\*\*\s*$/gm, '');

    // Remove #### **核心原则：...** heading, keep paragraph text after
    text = text.replace(/^####\s*\*\*核心原则：.*?\*\*\s*$/gm, '');

    // Remove **AI核心理解：** prefix labels — keep the text
    text = text.replace(/\*\*AI核心理解：\*\*\s*/g, '');

    // Remove #### **地理与聚落 (Settlements)** heading
    text = text.replace(/^####\s*\*\*地理与聚落.*?\*\*\s*$/gm, '');

    // Remove ##### **主城區：【...】** — replace with 主城: 城镇名
    text = text.replace(/^#####\s*\*\*主城區?：【(.+?)】.*?\*\*\s*$/gm, '主城: $1');

    // Convert labeled bullet items (with bold): *   **描述：** etc
    text = text.replace(/^\*\s+\*\*描述[：:]\*\*\s*/gm, '描述: ');
    text = text.replace(/^\*\s+\*\*氛围[：:]\*\*\s*/gm, '氛围: ');
    text = text.replace(/^\*\s+\*\*位置[：:]\*\*\s*/gm, '位置: ');
    text = text.replace(/^\*\s+\*\*功能[：:]\*\*\s*/gm, '功能: ');
    text = text.replace(/^\*\s+\*\*地貌[：:]\*\*\s*/gm, '地貌: ');
    text = text.replace(/^\*\s+\*\*怪物[：:]\*\*\s*/gm, '怪物: ');
    text = text.replace(/^\*\s+\*\*内部设施[：:]\*\*\s*/gm, '内部设施: ');
    text = text.replace(/^\*\s+\*\*特殊区域[：:]\*\*\s*/gm, '特殊区域: ');
    text = text.replace(/^\*\s+\*\*核心区域[：:]\*\*\s*/gm, '核心区域: ');
    text = text.replace(/^\*\s+\*\*核心建筑[：:]\*\*\s*/gm, '核心建筑: ');

    // Remove #### **核心挑战** heading
    text = text.replace(/^####\s*\*\*核心挑战.*?\*\*\s*$/gm, '');

    // Remove *   **守关Boss (Floor Boss)：** — replace with Boss:
    text = text.replace(/^\*\s+\*\*守关Boss.*?：\*\*\s*/gm, 'Boss:');

    // Remove *   **名称：【...】** etc labels
    text = text.replace(/^\*\s+\*\*名称[：:]\s*【(.+?)】.*?\*\*/gm, '名称: $1');
    text = text.replace(/^\*\s+\*\*名称[：:]\*\*\s*/gm, '名称: ');
    text = text.replace(/^\*\s+\*\*外形[：:]\*\*\s*/gm, '外形: ');
    text = text.replace(/^\*\s+\*\*战斗模式[：:]\*\*\s*/gm, '战斗模式: ');
    text = text.replace(/^\*\s+\*\*攻略要点[：:]\*\*\s*/gm, '攻略要点: ');
    text = text.replace(/^\*\s+\*\*描述[：:]\*\*\s*/gm, '描述: ');
    text = text.replace(/^\*\s+\*\*触发[：:]\*\*\s*/gm, '触发: ');

    // Remove ##### **著名地点 (Landmarks)** heading — use 地标:
    text = text.replace(/^#####\s*\*\*著名地点.*?\*\*\s*$/gm, '地标:');

    // Remove ##### **攻略据点：...** — use 攻略据点: 名称
    text = text.replace(/^#####\s*\*\*攻略据点[：:]【(.+?)】.*?\*\*\s*$/gm, '攻略据点: $1');
    text = text.replace(/^#####\s*\*\*攻略据点[：:](.+?)\*\*\s*$/gm, '攻略据点: $1');

    // Remove ##### **新手村落** heading — use 新手村落:
    text = text.replace(/^#####\s*\*\*新手村落\*\*\s*$/gm, '新手村落:');

    // Remove ##### **【...】** deep headings — convert to inline labels
    text = text.replace(/^#####\s*\*\*【(.+?)】.*?\*\*\s*$/gm, '$1');
    text = text.replace(/^#####\s*\*\*(.+?)\*\*\s*$/gm, '$1');

    // Remove #### **传说之地与被扭曲的机制** heading
    text = text.replace(/^####\s*\*\*传说之地与被扭曲的机制.*?\*\*\s*$/gm, '');

    // Remove #### **核心挑战 (Challenges)** heading
    text = text.replace(/^####\s*\*\*核心挑战.*?\*\*\s*$/gm, '');

    // Remove *   **迷宫区 (Labyrinth)：** label — use 迷宫区:
    text = text.replace(/^\*\s+\*\*迷宫区.*?：\*\*\s*/gm, '迷宫区:');

    // Remove #### **...** remaining headings (with bold)
    text = text.replace(/^####\s*\*\*(.+?)\*\*\s*$/gm, '$1');

    // Remove remaining #### headings (after bold removed by earlier patterns)
    text = text.replace(/^####\s+(.+)$/gm, '$1');

    // Remove remaining ##### headings
    text = text.replace(/^#####\s+(.+)$/gm, '$1');

    // ── PHASE 2: Remove ALL bold markers ──
    text = removeBold(text);

    // ── PHASE 2b: Post-bold heading cleanup (####/##### that lost their bold) ──
    text = text.replace(/^#{2,5}\s+(.+)$/gm, '$1');

    // ── PHASE 3: Remove bullet prefixes ──
    // Remove "    *   " indented bullets (preserve content)
    text = text.replace(/^(\s{2,})\*\s+/gm, '');
    // Remove "*   " or "* " at start of line
    text = text.replace(/^\*\s+/gm, '');
    // Remove inline "*   " that appears after a label on the same line
    text = text.replace(/\*\s{2,}(?=\S)/g, '');

    // Remove indentation (leading spaces/tabs)
    text = removeIndentation(text);

    // ── PHASE 4: Extract bracket title ──
    const titleMatch = content.match(/###\s*\*\*【AI核心指令：(.+?)】/);
    let bracketTitle = '';
    if (titleMatch) {
        bracketTitle = `[${titleMatch[1].trim()}]\n\n`;
    }

    // ── PHASE 5: Replace ```worldbook-data block with single line ──
    text = text.replace(/```worldbook-data\n([\s\S]*?)\n```/g, (match, jsonStr) => {
        try {
            const data = JSON.parse(jsonStr);
            const parts = [];
            if (data.floor_number != null) parts.push(`floor=${data.floor_number}`);
            if (data.theme) parts.push(`theme=${data.theme}`);
            if (data.mainTown) parts.push(`town=${data.mainTown}`);
            if (data.labyrinth) parts.push(`labyrinth=${data.labyrinth}`);
            if (data.boss) parts.push(`boss=${data.boss}`);
            if (data.notes) parts.push(`notes=${data.notes}`);
            if (data.source) parts.push(`source=${data.source}`);
            return '数据: ' + parts.join(' ');
        } catch (e) {
            return match;
        }
    });

    // ── PHASE 6: Final cleanup ──
    text = cleanFinal(text);
    text = bracketTitle + text;

    return text;
}

// ── Type 2: Timeline entry transformation ──────────────────────────────

function transformTimelineEntry(content, comment) {
    let text = content;

    // ── PHASE 1: Structural transforms (bold still present) ──
    text = removeHR(text);

    // Remove ### **【世界历史背景：...】** heading — extract for bracket title
    const titleMatch = text.match(/###\s*\*\*【世界历史背景[：:](.+?)】/);
    text = text.replace(/^###\s*\*\*【世界历史背景：.*?】\*\*\s*$/gm, '');

    // Remove **[AI参考：...]** meta-instruction line
    text = text.replace(/^\*\*\[AI参考[：:].*?\]\*\*\s*$/gm, '');

    // Remove #### **M月D日...** headings → M月D日...:  (handle (星期X) between date and dash)
    text = text.replace(/^####\s*\*\*(\d+月\d+日[^*]*?)\*\*\s*$/gm, '$1:');

    // Handle #### **M月总结** → M月总结:
    text = text.replace(/^####\s*\*\*(\d+月总结)\*\*\s*$/gm, '$1:');

    // Remove bold labels
    text = text.replace(/\*\*事件[：:]\*\*\s*/g, '');
    text = text.replace(/\*\*战斗详情[：:]\*\*\s*/g, '');
    text = text.replace(/\*\*地点[：:]\*\*\s*/g, '');
    text = text.replace(/\*\*详细描述[：:]\*\*\s*/g, '');

    // Remove **第一部分：...** **第二部分：...** section dividers
    text = text.replace(/\*\*第[一二三四五六七八九十]+部分[：:].*?\*\*/g, '');

    // Remove *   **[世界状态]:** etc bracketed labels
    text = text.replace(/^\*\s+\*\*\[世界状态\][：:]\*\*\s*/gm, '');
    text = text.replace(/^\*\s+\*\*\[玩家普遍认知\][：:]\*\*\s*/gm, '');
    text = text.replace(/^\*\s+\*\*\[隐藏的规则.*?\][：:]\*\*\s*/gm, '');
    text = text.replace(/^\*\s+\*\*\[关键事件\][：:]\*\*\s*/gm, '');
    text = text.replace(/^\*\s+\*\*\[现实世界\][：:]\*\*\s*/gm, '');

    // Remove ### **...** and ### headings
    text = text.replace(/^###\s*\*\*(.+?)\*\*\s*$/gm, '$1');
    text = text.replace(/^###\s+(.+)$/gm, '$1');

    // ── PHASE 2: Remove bold markers ──
    text = removeBold(text);

    // ── PHASE 2b: Post-bold heading cleanup ──
    text = text.replace(/^#{2,5}\s+(.+)$/gm, '$1');

    // ── PHASE 3: Remove bullets and indentation ──
    text = text.replace(/^(\s{2,})\*\s+/gm, '');
    text = text.replace(/^\*\s+/gm, '');
    text = text.replace(/\*\s{2,}(?=\S)/g, '');
    text = removeIndentation(text);

    // ── PHASE 4: Final cleanup ──
    text = cleanFinal(text);

    if (titleMatch) {
        text = `[${titleMatch[1].trim()}]\n\n` + text;
    }

    return text;
}

// ── Type 4: Directive entry transformation ─────────────────────────────

function transformDirectiveEntry(content) {
    let text = content;

    // ── PHASE 1: Structural transforms ──
    text = removeHR(text);

    // Remove <!--- ... ---> HTML comment blocks (meta-instructions)
    text = text.replace(/<!---[\s\S]*?--->/g, '');
    // Also handle <!-- ... --> style with intent/understanding
    text = text.replace(/<!--\s*\[意图[：:].*?\s*-->/gs, '');
    text = text.replace(/<!--\s*\[AI核心理解[：:].*?\s*-->/gs, '');

    // Remove ### **...** markdown headings → plain text
    text = text.replace(/^###\s*\*\*(.+?)\*\*\s*$/gm, '$1');
    text = text.replace(/^###\s+(.+)$/gm, '$1');

    // Remove #### **...** headings
    text = text.replace(/^####\s*\*\*(.+?)\*\*\s*$/gm, '$1');
    text = text.replace(/^####\s+(.+)$/gm, '$1');

    // Remove ##### **...** headings
    text = text.replace(/^#####\s*\*\*(.+?)\*\*\s*$/gm, '$1');

    // ── PHASE 2: Remove bold markers ──
    text = removeBold(text);

    // ── PHASE 2b: Post-bold heading cleanup ──
    text = text.replace(/^#{2,5}\s+(.+)$/gm, '$1');

    // ── PHASE 3: Remove bullets and indentation ──
    text = text.replace(/^(\s{2,})\*\s+/gm, '');
    text = text.replace(/^\*\s+/gm, '');
    text = text.replace(/\*\s{2,}(?=\S)/g, '');
    text = removeIndentation(text);

    // ── PHASE 4: Final cleanup ──
    text = cleanFinal(text);

    return text;
}

// ── Type 5: Other entries transformation ───────────────────────────────

function transformOtherEntry(content, comment) {
    let text = content;

    // ── PHASE 1: Structural transforms ──
    text = removeHR(text);

    // Remove ### **【AI核心指令：...】** heading
    const titleMatch = text.match(/###\s*\*\*【AI核心指令[：:](.+?)】/);
    text = text.replace(/^###\s*\*\*【AI核心指令：.*?】\*\*\s*$/gm, '');

    // Remove **[系统提示：...]** line
    text = text.replace(/^\*\*\[系统提示：.*?\]\*\*\s*$/gm, '');

    // Remove #### **...** headings
    text = text.replace(/^####\s*\*\*(.+?)\*\*\s*$/gm, '$1');
    text = text.replace(/^####\s+(.+)$/gm, '$1');

    // Remove ##### **...** headings
    text = text.replace(/^#####\s*\*\*(.+?)\*\*\s*$/gm, '$1');

    // Remove ### **...** headings
    text = text.replace(/^###\s*\*\*(.+?)\*\*\s*$/gm, '$1');
    text = text.replace(/^###\s+(.+)$/gm, '$1');

    // Remove <!--- ... ---> meta comments
    text = text.replace(/<!---[\s\S]*?--->/g, '');
    text = text.replace(/<!--\s*\[意图[：:].*?\s*-->/gs, '');
    text = text.replace(/<!--\s*\[AI核心理解[：:].*?\s*-->/gs, '');

    // ── PHASE 2: Remove bold markers ──
    text = removeBold(text);

    // ── PHASE 2b: Post-bold heading cleanup ──
    text = text.replace(/^#{2,5}\s+(.+)$/gm, '$1');

    // ── PHASE 3: Remove bullets and indentation ──
    text = text.replace(/^(\s{2,})\*\s+/gm, '');
    text = text.replace(/^\*\s+/gm, '');
    text = text.replace(/\*\s{2,}(?=\S)/g, '');
    text = removeIndentation(text);

    // ── PHASE 4: Final cleanup ──
    text = cleanFinal(text);

    if (titleMatch) {
        text = `[${titleMatch[1].trim()}]\n\n` + text;
    }

    return text;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log('=== compact-worldbook-entries ===\n');

    // ── Step 0: Backup ──────────────────────────────────────────────────
    console.log('Step 0: Backup...');
    const originalPngBuf = fs.readFileSync(PNG_PATH);
    console.log(`  Original PNG size: ${originalPngBuf.length} bytes (${(originalPngBuf.length / 1024).toFixed(1)} KB)`);

    if (fs.existsSync(BAK_PATH)) {
        console.log(`  Backup already exists: ${BAK_PATH} — preserving`);
    } else {
        fs.copyFileSync(PNG_PATH, BAK_PATH);
        console.log(`  ✓ Backup created: ${BAK_PATH}`);
    }

    // ── Read & decode PNG ────────────────────────────────────────────────
    console.log('\nReading PNG chunks...');
    const chunks = readPngChunks(PNG_PATH);
    console.log(`  PNG chunks: ${chunks.length}`);

    let charaIdx = -1;
    let ccv3Idx = -1;
    for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].type === 'tEXt') {
            const ni = chunks[i].data.indexOf(0);
            if (ni !== -1) {
                const keyword = chunks[i].data.slice(0, ni).toString('latin1');
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

    // ── Step 1: Classify and transform entries ──────────────────────────
    console.log('\nStep 1: Classify and transform entries...');
    const entries = obj.data.character_book.entries;
    console.log(`  Total entries: ${entries.length}`);

    const typeCounts = { [TYPE_FLOOR]: 0, [TYPE_TIMELINE]: 0, [TYPE_NPC]: 0, [TYPE_DIRECTIVE]: 0, [TYPE_OTHER]: 0 };
    const typeLabels = { [TYPE_FLOOR]: 'Floor', [TYPE_TIMELINE]: 'Timeline', [TYPE_NPC]: 'NPC', [TYPE_DIRECTIVE]: 'Directive', [TYPE_OTHER]: 'Other' };
    const grew = [];

    let totalLenBefore = 0;
    for (const e of entries) totalLenBefore += (e.content || '').length;
    console.log(`  Total content length before: ${totalLenBefore} chars`);

    for (const entry of entries) {
        const type = classifyEntry(entry);
        typeCounts[type]++;
        const origLen = (entry.content || '').length;

        switch (type) {
            case TYPE_FLOOR:
                entry.content = transformFloorEntry(entry.content, entry.comment);
                break;
            case TYPE_TIMELINE:
                entry.content = transformTimelineEntry(entry.content, entry.comment);
                break;
            case TYPE_NPC:
                break;
            case TYPE_DIRECTIVE:
                entry.content = transformDirectiveEntry(entry.content);
                break;
            case TYPE_OTHER:
                entry.content = transformOtherEntry(entry.content, entry.comment);
                break;
        }

        const newLen = (entry.content || '').length;
        if (type !== TYPE_NPC && newLen > origLen) {
            grew.push({ comment: entry.comment, type: typeLabels[type], before: origLen, after: newLen });
        }
    }

    console.log('\n  Entry counts by type:');
    for (const [type, count] of Object.entries(typeCounts)) {
        console.log(`    ${typeLabels[type]}: ${count}`);
    }

    let totalLenAfter = 0;
    for (const e of entries) totalLenAfter += (e.content || '').length;
    console.log(`\n  Total content length after: ${totalLenAfter} chars`);
    console.log(`  Reduction: ${totalLenBefore - totalLenAfter} chars (${((1 - totalLenAfter / totalLenBefore) * 100).toFixed(1)}%)`);

    if (grew.length > 0) {
        console.log(`\n  ⚠ Entries that grew: ${grew.length}`);
        for (const g of grew) {
            console.log(`    ${g.comment} (${g.type}): ${g.before} → ${g.after}`);
        }
    }

    // ── Step 2: Sanity checks on content ───────────────────────────────
    console.log('\nStep 2: Sanity checks on content...');
    let allPassed = true;

    // Check 3: sao-第1层 should NOT contain --- or ** or [系统提示
    const floor1 = entries.find(e => e.comment === 'sao-第1层');
    const f1Content = floor1.content;
    const f1HasHR = /^---\s*$/m.test(f1Content);
    const f1HasBold = /\*\*[^*]+\*\*/.test(f1Content);
    const f1HasSysPrompt = f1Content.includes('[系统提示');
    console.log(`  [3] sao-第1层: HR=${f1HasHR}, Bold=${f1HasBold}, SysPrompt=${f1HasSysPrompt} (expect all false)`);
    if (f1HasHR || f1HasBold || f1HasSysPrompt) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 4: sao-第1层 key info preserved
    const f1HasKey1 = f1Content.includes('起始之镇');
    const f1HasKey2 = f1Content.includes('黑铁宫') || f1Content.includes('黑鐵宮');
    const f1HasKey3 = f1Content.includes('伊尔方') || f1Content.includes('伊爾方');
    const f1HasKey4 = f1Content.includes('生命纪念碑') || f1Content.includes('生命紀念碑');
    console.log(`  [4] sao-第1层 key info: 起始之镇=${f1HasKey1}, 黑铁宫=${f1HasKey2}, 伊尔方=${f1HasKey3}, 生命纪念碑=${f1HasKey4}`);
    if (!f1HasKey1 || !f1HasKey2 || !f1HasKey3 || !f1HasKey4) {
        console.log('      ✗ FAIL: Missing key info');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 5: 2022年11月时间表 should NOT contain --- or ** or [AI参考
    const tl11 = entries.find(e => e.comment === '2022年11月时间表');
    const tl11Content = tl11.content;
    const tl11HasHR = /^---\s*$/m.test(tl11Content);
    const tl11HasBold = /\*\*[^*]+\*\*/.test(tl11Content);
    const tl11HasAIRef = tl11Content.includes('[AI参考');
    console.log(`  [5] 2022年11月时间表: HR=${tl11HasHR}, Bold=${tl11HasBold}, AIRef=${tl11HasAIRef} (expect all false)`);
    if (tl11HasHR || tl11HasBold || tl11HasAIRef) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 6: 2022年11月时间表 key info preserved
    const tl11Key1 = tl11Content.includes('宣告日');
    const tl11Key2 = tl11Content.includes('茅场');
    const tl11Key3 = tl11Content.includes('213人');
    const tl11Key4 = tl11Content.includes('桐人');
    const tl11Key5 = tl11Content.includes('亚丝娜');
    console.log(`  [6] 2022年11月时间表 key info: 宣告日=${tl11Key1}, 茅场=${tl11Key2}, 213人=${tl11Key3}, 桐人=${tl11Key4}, 亚丝娜=${tl11Key5}`);
    if (!tl11Key1 || !tl11Key2 || !tl11Key3 || !tl11Key4 || !tl11Key5) {
        console.log('      ✗ FAIL: Missing key info');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 7: NPC profiles unchanged
    const asuna = entries.find(e => e.comment === 'sao-亚丝娜');
    console.log(`  [7] sao-亚丝娜 starts with json: ${asuna.content.startsWith('```json')} (expect true)`);
    if (!asuna.content.startsWith('```json')) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 8: Directive entries still contain <directive
    const pk = entries.find(e => e.comment === 'sao-PK机制');
    console.log(`  [8] sao-PK机制 has <directive: ${pk.content.includes('<directive')} (expect true)`);
    if (!pk.content.includes('<directive')) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    // Check 9: Total content 40-60% shorter
    const reductionPct = (1 - totalLenAfter / totalLenBefore) * 100;
    console.log(`  [9] Content reduction: ${reductionPct.toFixed(1)}% (expect 40-60%)`);
    if (reductionPct < 35 || reductionPct > 65) {
        console.log('      ⚠ Outside expected range');
    } else {
        console.log('      ✓ Pass');
    }

    // ── Step 3: Write PNG ────────────────────────────────────────────────
    console.log('\nStep 3: Write updated PNG...');
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

    // ── Step 4: Sync extracted JSON ──────────────────────────────────────
    console.log('\nStep 4: Sync extracted JSON...');
    fs.writeFileSync(JSON_PATH, compactJson, 'utf8');
    console.log(`  ✓ Updated ${JSON_PATH} (${compactJson.length} bytes)`);

    // ── Step 5: Run verify ───────────────────────────────────────────────
    console.log('\nStep 5: Verify...');
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

    // ── Step 6: Final sanity checks ──────────────────────────────────────
    console.log('\nStep 6: Final sanity checks...');

    const newSize = fs.statSync(PNG_PATH).size;
    console.log(`  [1] PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    if (newSize >= originalPngBuf.length) {
        console.log('      ⚠ New PNG is not smaller');
    } else {
        console.log('      ✓ New PNG is smaller');
    }

    const verifyChunks = readPngChunks(PNG_PATH);
    const verifyChara = findTextChunk(verifyChunks, 'chara');
    const verifyObj = decodeTextChunkData(verifyChara);
    const entryCount = verifyObj.data.character_book.entries.length;
    console.log(`  [2] Entry count: ${entryCount} (expected 239)`);
    if (entryCount !== 239) {
        console.log('      ✗ FAIL');
        allPassed = false;
    } else {
        console.log('      ✓ Pass');
    }

    console.log(`  [10] node --check on compact-worldbook-entries.js...`);
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
    console.log(`Entry counts by type:`);
    for (const [type, count] of Object.entries(typeCounts)) {
        console.log(`  ${typeLabels[type]}: ${count}`);
    }
    console.log(`Total entries: ${entries.length}`);
    console.log(`Content length: ${totalLenBefore} → ${totalLenAfter} (${reductionPct.toFixed(1)}% reduction)`);
    console.log(`PNG size: ${originalPngBuf.length} → ${newSize} (${newSize - originalPngBuf.length} bytes)`);
    console.log(`All sanity checks: ${allPassed ? '✓ PASSED' : '✗ SOME FAILED'}`);

    if (grew.length > 0) {
        console.log(`\nEntries that grew: ${grew.length}`);
        for (const g of grew) {
            console.log(`  ${g.comment} (${g.type}): ${g.before} → ${g.after}`);
        }
    }

    if (!allPassed) {
        console.log('\n⚠ Some sanity checks failed — review output above.');
        process.exit(1);
    }

    console.log('\n✓ Done!');
}

main();
