// SAO Companion - 运行时 NPC 档案生成器
// 当 extractAll 发现新 NPC 时，fire-and-forget 调用 LLM 生成 characterProfile
// 写入 char.data.character_book.entries（内存，不写 PNG）

import { callSpecialist } from './sao-models.js';
import { log, safeJsonParse, getCurrentCharacter } from './sao-core.js';
import { getNpcByName } from './sao-store-npc.js';
import { extractNarrativeBody } from './sao-specialists.js';

/**
 * 判断是否需要为该 NPC 生成档案（世界书已有条目则跳过）。
 * @param {string} npcName
 * @returns {boolean}
 */
export function shouldGenerateProfile(npcName) {
    if (!npcName) return false;

    // 检查 character_book.entries 是否已有该 NPC 条目
    const char = getCurrentCharacter();
    const entries = char?.data?.character_book?.entries;
    if (Array.isArray(entries)) {
        const exists = entries.some(e =>
            (e.comment || '').includes(npcName) ||
            (e.keys || []).some(k => k === npcName)
        );
        if (exists) return false;
    }

    return true;
}

/**
 * 校验 LLM 返回的 characterProfile JSON。
 * @param {string|object} content - LLM 返回的原始内容
 * @param {string} expectedName - 期望的 NPC 名称
 * @returns {object|null} 解析后的 characterProfile 对象或 null
 */
export function _validateProfileOutput(content, expectedName) {
    if (!content) return null;
    try {
        const cleaned = typeof content === 'string'
            ? content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
            : content;
        const parsed = typeof cleaned === 'string' ? safeJsonParse(cleaned) : cleaned;
        if (!parsed) return null;

        const profile = parsed.characterProfile || parsed;
        if (!profile || typeof profile !== 'object') return null;
        if (!profile.characterName || typeof profile.characterName !== 'string') return null;
        if (profile.characterName !== expectedName) return null;

        return profile;
    } catch { return null; }
}

/**
 * 将 characterProfile 写入 char.data.character_book.entries。
 * @param {string} npcName - NPC 名称
 * @param {object} profile - characterProfile 对象
 */
export function _writeProfileToEntries(npcName, profile) {
    const char = getCurrentCharacter();
    if (!char?.data?.character_book?.entries) return false;
    const entries = char.data.character_book.entries;

    // 二次检查：避免并发写入时重复
    const exists = entries.some(e =>
        (e.comment || '').includes(npcName) ||
        (e.keys || []).some(k => k === npcName)
    );
    if (exists) return false;

    // 从 npcStore 获取别名
    const npc = getNpcByName(npcName);
    const aliases = npc?.aliases || [];

    entries.push({
        comment: npcName,
        keys: [npcName, ...aliases],
        content: '```json\n' + JSON.stringify({ characterProfile: profile }, null, 2) + '\n```',
        disable: true,
        use_regex: true,
        selective: true,
        constant: false,
        position: 'before_char',
        insertion_order: 100,
        uid: '',
        secondary_keys: [],
        extensions: {},
    });

    log(`NPC 档案已写入世界书: ${npcName}`);
    return true;
}

/**
 * 为新发现的 NPC 批量生成 characterProfile 档案。
 * fire-and-forget 调用，非阻塞。
 * @param {string[]} newNpcNames - 新 NPC 名称列表
 * @param {string} narrativeContext - 叙事上下文（用于推断 NPC 设定）
 * @returns {Promise<number>} 成功生成的档案数量
 */
export async function generateNpcProfiles(newNpcNames, narrativeContext) {
    if (!Array.isArray(newNpcNames) || newNpcNames.length === 0) return 0;

    const contextSnippet = extractNarrativeBody(narrativeContext);
    let generated = 0;

    for (const name of newNpcNames) {
        // 跳过已有世界书条目的 NPC
        if (!shouldGenerateProfile(name)) continue;

        const systemPrompt = `你是 SAO 游戏 NPC 档案生成器。根据 NPC 名字和出现的叙事上下文，生成一份 characterProfile JSON 档案。

## 输入
- NPC 名字
- 出现的叙事片段

## 输出格式（严格 JSON，用 \`\`\`json 围栏包裹）
{
  "characterProfile": {
    "characterName": "NPC名",
    "profileVersion": "SAO - 游戏内生成",
    "basicInfo": { "realName": "", "gender": "", "age": null, "occupation": "" },
    "appearance": { "height": "", "hair": "", "eyes": "", "build": "", "clothing": "", "distinguishingFeatures": "" },
    "personality": { "traits": [], "likes": [], "dislikes": [], "speechStyle": "" },
    "background": "",
    "combatInfo": { "weapon": "", "fightingStyle": "", "skillLevel": "" }
  }
}

## 规则
- 基于叙事上下文推断设定，不要凭空捏造与上下文矛盾的设定
- 如果叙事信息不足，留空字段而非猜测
- characterName 必须与输入一致
- 输出必须是合法 JSON`;

        const userPrompt = `NPC 名字: ${name}\n\n叙事片段:\n${contextSnippet}`;

        try {
            const content = await callSpecialist('npcBackground', [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ], 1024, { temperature: 0.4, jsonSchema: true, timeoutMs: 25000 });

            const profile = _validateProfileOutput(content, name);
            if (!profile) {
                log(`NPC 档案生成: ${name} 校验失败，跳过`, 'warn');
                continue;
            }

            if (_writeProfileToEntries(name, profile)) {
                generated++;
            }
        } catch (e) {
            log(`NPC 档案生成失败 (${name}): ${e.message}`, 'warn');
        }
    }

    if (generated > 0) {
        log(`NPC 档案生成完成: ${generated}/${newNpcNames.length} 个`);
    }
    return generated;
}
