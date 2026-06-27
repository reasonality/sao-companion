import {
    calculateDerivedStats,
    calculateFinalHitRate,
    calculateFinalCritRate,
    calculateFinalCritMultiplier,
    calculateFinalDamage,
    getTeammateActualStats,
    getEnemyActualStats,
} from './battleMath.js';
import {
    getPlayerStatsCore,
    calculateActionOrderCore,
    handleDOTCore,
    handleHealOverTimeCore,
    handlePermanentShieldCore,
    handleTemporaryShieldCore,
    handleShieldOverTimeCore,
    processEnchantmentEffectsCore,
    healCore,
    manaRestoreCore,
    sacrificeBoostCore,
    a5MultiHitCore,
    hasDebuff,
    selectTargets,
    applyDamageToEnemy,
    executeStandardAttack,
    clearExpiredTempShields,
    decrementBuffTurns,
    removeExpiredBuffs,
    processEndOfRoundCore,
    performEnemyActionCore,
    executeTeammateAttackCore,
} from './battleCore.js';

/**
 * applyInstructionsToDom — Execute DOM operations from Core instruction lists
 * Processes instruction arrays returned by C-class Core functions (performEnemyActionCore,
 * executeTeammateAttackCore, etc.) and applies visual effects with appropriate timing.
 * @param {Array} instructions - Instruction list from Core function
 * @param {Object} options - { onComplete: Function } callback when all animations done
 */
function applyInstructionsToDom(instructions, options = {}) {
    if (!instructions || instructions.length === 0) {
        if (options.onComplete) options.onComplete();
        return;
    }

    let delay = 0;
    instructions.forEach((inst, index) => {
        setTimeout(() => {
            switch (inst.type) {
                case 'damage':
                    if (inst.fromEnemy) {
                        // Enemy attacking player/teammate
                        if (inst.targetId === 'player') {
                            showDamageNumber('player', inst.damage, inst.isCrit);
                            addHpChangeAnimation('player');
                        } else {
                            showDamageNumber('teammate', inst.damage, inst.isCrit, null, inst.targetId);
                            addHpChangeAnimation('teammate', inst.targetId);
                        }
                    } else {
                        // Player/teammate attacking enemy
                        showDamageNumber(inst.damage, inst.targetId, inst.isCrit);
                        addHpChangeAnimation('enemy', inst.targetId);
                    }
                    break;
                case 'heal':
                    if (inst.targetId === 'player') {
                        showHealNumber(inst.heal);
                        addHpChangeAnimation('player');
                    } else {
                        // Teammate heal
                        const healEl = document.createElement('div');
                        healEl.className = 'heal-number';
                        healEl.textContent = `+${inst.heal}`;
                        const tmEl = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${inst.targetId}"]`);
                        if (tmEl) {
                            tmEl.appendChild(healEl);
                            setTimeout(() => healEl.remove(), 1200);
                            addHpChangeAnimation('teammate', inst.targetId);
                        }
                    }
                    break;
                case 'miss':
                    // No visual effect for misses
                    break;
                case 'burnDamage':
                    showDamageNumber('enemy', inst.damage, false, inst.targetId);
                    addHpChangeAnimation('enemy', inst.targetId);
                    break;
                case 'stun':
                    // Stun handled by log only
                    break;
                case 'enemyDeath':
                    StateValidator.checkEnemyDeath({ id: inst.targetId });
                    break;
                case 'playerDeath':
                    // Handled by caller
                    break;
                case 'teammateDeath':
                    const tmDeathEl = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${inst.targetId}"]`);
                    if (tmDeathEl) createDeathEffect(tmDeathEl);
                    hateSystem.clearTargetHate(inst.targetId);
                    break;
                case 'sacrificeDamage':
                    showDamageNumber('player', inst.damage, false);
                    addHpChangeAnimation('player');
                    break;
            }

            // Call onComplete after last instruction
            if (index === instructions.length - 1 && options.onComplete) {
                options.onComplete();
            }
        }, delay);
        delay += inst.type === 'damage' || inst.type === 'heal' ? 300 : 100;
    });
}

// battle/battleLogic.js
// 战斗逻辑 - 从卡片正则迁移
// 原始代码在 <script> 标签中执行，直接用 document.* 操作 DOM
// 迁移后通过 domRoot 操作 Shadow DOM 内元素

let domRoot = document; // 初始化前回退到 document

// 项4：side effects 单例状态，防止重复注册 setInterval / resize / runCmd 补丁
const sideEffectsState = {
    initialized: false,
    intervalId: null,
    resizeHandler: null,
    runCmdPatched: false,
    beforeunloadHandler: null,
    unloadHandler: null,
    originalRunCmd: null,
};

export function setBattleDomRoot(root) {
    domRoot = root;
}

// === 以下为原始战斗逻辑（document → domRoot 替换后） ===

      
      function calculateExperienceForCharacter(characterLevel, teammateCount, defeatedEnemies) {
        let totalExp = 0;
        let expDetails = [];
        defeatedEnemies.forEach(enemy => {
          
          const baseExp = (enemy.grade || 1) * 8;
          
          const levelDiff = (enemy.grade || 1) - characterLevel;
          const levelMultiplier = Math.pow(1.2, levelDiff);
          
          const teamModifier = 1 / (1 + teammateCount * 0.1);
          
          const enemyExp = Math.floor(baseExp * levelMultiplier * teamModifier);
          totalExp += enemyExp;
          expDetails.push({
            enemyName: enemy.name,
            enemyLevel: enemy.grade || 1,
            baseExp: baseExp,
            levelDiff: levelDiff,
            levelMultiplier: levelMultiplier.toFixed(2),
            teamModifier: teamModifier.toFixed(2),
            finalExp: enemyExp,
          });
        });
        return {
          totalExp: totalExp,
          details: expDetails,
        };
      }
      
      function calculateTeamExperience(player, teammates, defeatedEnemies) {
        const teammateCount = teammates ? teammates.length : 0;
        
        const playerResult = calculateExperienceForCharacter(player.grade || 1, teammateCount, defeatedEnemies);
        
        const teammateResults = [];
        if (teammates && teammates.length > 0) {
          teammates.forEach(teammate => {
            const teammateResult = calculateExperienceForCharacter(teammate.grade || 1, teammateCount, defeatedEnemies);
            teammateResults.push({
              name: teammate.name,
              level: teammate.grade || 1,
              exp: teammateResult.totalExp,
              details: teammateResult.details,
            });
          });
        }
        return {
          playerExp: playerResult.totalExp,
          playerDetails: playerResult.details,
          teammateResults: teammateResults,
        };
      }
      
      function collectBattleStatistics() {
        
        const stats = {
          weaponStats: [],
          itemUsage: [],
          killedEnemies: [],
        };
        
        if (battleState.weaponUsage) {
          
          Object.entries(battleState.weaponUsage).forEach(([name, data]) => {
            stats.weaponStats.push({
              name: name,
              damage: data.damage || 0,
              kills: data.kills || 0,
            });
          });
          
          stats.weaponStats.sort((a, b) => b.damage - a.damage);
        }
        
        if (battleState.itemUsageStats) {
          Object.entries(battleState.itemUsageStats).forEach(([itemName, count]) => {
            stats.itemUsage.push({
              name: itemName,
              count: count,
            });
          });
        }
        
        if (battleState.killedEnemies) {
          stats.killedEnemies = [...battleState.killedEnemies];
        }
        return stats;
      }
      
      // B1 fix: DOM queries inlined — getters removed (ponytail: YAGNI wrappers)

      const weaponSpecialEffects = {
        A1: () => `伤害输出模板：攻击敌人`,
        A2: () => `生命恢复模板：恢复HP，可选自己或队友`,
        A3: () => `法力恢复模板：恢复MP，可选自己或队友`,
        A4: () => `牺牲增益模板：消耗HP获得强力增益，只能对自己使用`,
        A5: () => `终结技模板：持续攻击至AP耗尽，伤害逐次递减10%（最低50%）`,
      };
      
      const enchantmentEffects = {
        B1: percent => `生命窃取：攻击造成伤害的${percent}%转化为生命值`,
        B2: (duration, value) => `减益-命中：攻击命中时，目标在接下来${duration}个回合内命中率降低${value}%`,
        B3: (duration, value) => `增益-暴击：暴击后，你在接下来${duration}个回合内暴击率提高${value}%`,
        B4: duration => `触发-晕眩：暴击时晕眩敌人${duration}回合`,
        B5: (duration, damage) => `伤害-DOT：${duration}回合内每回合造成${damage}点持续伤害`,
        B6: (chance, duration) => `几率-晕眩：${chance}%几率晕眩目标${duration}回合`,
        B7: (chance, bonus) => `几率-额外伤害：${chance}%几率造成+${bonus}%额外伤害`,
        B8: (duration, bonus) => `增益-受伤加深：${duration}回合内目标受到伤害+${bonus.toString().replace('%', '')}%`,
        B9: mp => `恢复-法力：命中后恢复${mp}点MP`,
        B10: (duration, heal) => `恢复-生命(持续)：${duration}回合内每回合恢复${heal}点HP`,
        B11: (duration, str) => `增益-力量：攻击后${duration}回合内力量+${str}`,
        B12: (duration, agi) => `增益-敏捷：攻击后${duration}回合内敏捷+${agi}`,
        B13: (duration, int) => `增益-智力：攻击后${duration}回合内智力+${int}`,
        B14: (duration, end) => `增益-耐力：攻击后${duration}回合内耐力+${end}`,
        B15: bonus => `标记-易伤：命中后施加易伤标记，下次攻击+${bonus}%额外伤害`,
        B16: bonus => `标记-破绽：命中后施加破绽标记，下次攻击暴击率+${bonus}%`,
        B17: bonus => `标记-死点：命中后施加死点标记，下次攻击暴击伤害+${bonus}%`,
        B18: (stacks, damage) => `叠加-创伤：命中后施加${stacks}层创伤，每层每回合造成${damage}点伤害`,
        B19: (stacks, bonus) => `叠加-腐蚀：命中后施加${stacks}层腐蚀，每层使受到伤害+${bonus}%`,
        B20: shield => `护盾-固化：命中后获得${shield}点永久护盾，再次触发恢复至最大值`,
        B21: shield => `护盾-瞬发叠加：命中后获得${shield}点临时护盾（1回合），可叠加`,
        B22: (duration, shield) => `护盾-持续叠加：命中后${duration}回合内每回合获得${shield}点护盾，可叠加`,
      };

      const monsterEffects = {
        M1: percent => `吸血攻击：吸取造成伤害的${percent}转化为生命值`,
        M2: (duration, damage) => `持续伤害：${duration}回合内每回合造成${damage}点伤害`,
        M3: (duration, value) => `力量削弱：${duration}回合内目标力量降低${value}点`,
        M4: (duration, value) => `敏捷削弱：${duration}回合内目标敏捷降低${value}点`,
        M5: (duration, burn) => `法力燃烧：${duration}回合内每回合燃烧${burn}点MP`,
        M6: (duration, value) => `智力削弱：${duration}回合内目标智力降低${value}点`,
        M7: (duration, value) => `耐力削弱：${duration}回合内目标耐力降低${value}点`,
        M8: (duration, value) => `敏捷强化：${duration}回合内自身敏捷提升${value}点`,
        M9: (duration, heal) => `再生恢复：${duration}回合内每回合恢复${heal}点HP`,
        M10: (duration, value) => `狂暴激发：${duration}回合内自身力量提升${value}点`,
        M11: (duration, value) => `团队增益：${duration}回合内所有敌人力量提升${value}点`,
        M12: (chance, cost, name) => {
          const costNum = parseFloat(cost);
          const summonName = name || '衍生生物';
          if (costNum < 0) {
            return `召唤${summonName}：${chance}%概率消耗${Math.abs(costNum)}%HP`;
          } else if (costNum > 0) {
            return `召唤${summonName}：${chance}%概率恢复${costNum}%HP`;
          } else {
            return `召唤${summonName}：${chance}%概率`;
          }
        },
      };
function parseStatusData(data) {
  const battleData = {
    player: {
      name: '',
      grade: 0, 
      hp: 0,
      maxHp: 0,
      hpRegen: 0, 
      mp: 0,
      maxMp: 0,
      mpRegen: 0,
      agility: 0,
      speed: 0, 
      ap: 0, 
      maxAp: 0, 
      
      weapons: [],
      items: [],
    },
    teammates: [], 
    enemies: [],
  };
  
  const playerMatch = data.match(/\[PR:([^\]]+)\]/);
  if (playerMatch) battleData.player.name = playerMatch[1];
  
  const gradeMatch = data.match(/\[GR:(\d+)\]/);
  if (gradeMatch) battleData.player.grade = parseInt(gradeMatch[1]);
  const hpMatch = data.match(/\[HP:(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]/);
  if (hpMatch) {
    battleData.player.hp = parseFloat(hpMatch[1]);
    battleData.player.maxHp = parseFloat(hpMatch[2]);
  }
  const mpMatch = data.match(/\[MP:(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]/);
  if (mpMatch) {
    battleData.player.mp = parseFloat(mpMatch[1]);
    battleData.player.maxMp = parseFloat(mpMatch[2]);
  }
  
  const hpRegenMatch = data.match(/\[HPRE:(\d+(?:\.\d+)?)\]/);
  if (hpRegenMatch) battleData.player.hpRegen = parseFloat(hpRegenMatch[1]);
  const mpRegenMatch = data.match(/\[MPRE:(\d+(?:\.\d+)?)\]/);
  if (mpRegenMatch) battleData.player.mpRegen = parseFloat(mpRegenMatch[1]);

  const speedMatch = data.match(/\[SD:(\d+(?:\.\d+)?)\]/);
  if (speedMatch) battleData.player.speed = parseFloat(speedMatch[1]);
  
  const apMatch = data.match(/\[AP:(\d+(?:\.\d+)?)\]/);
  if (apMatch) {
    battleData.player.ap = parseFloat(apMatch[1]);
    battleData.player.maxAp = parseFloat(apMatch[1]);
  }
  
  const strMatch = data.match(/\[STR:(\d+)\]/);
  const agiMatch = data.match(/\[AGI:(\d+)\]/);
  const intMatch = data.match(/\[INT:(\d+)\]/);
  const vitMatch = data.match(/\[VIT:(\d+)\]/);
  if (strMatch) battleData.player.str = parseInt(strMatch[1]);
  if (agiMatch) battleData.player.agi = parseInt(agiMatch[1]);
  if (intMatch) battleData.player.int = parseInt(intMatch[1]);
  if (vitMatch) battleData.player.vit = parseInt(vitMatch[1]);
  
  const str = battleData.player.str || 0;
  const agi = battleData.player.agi || 0;
  const int = battleData.player.int || 0;
  const vit = battleData.player.vit || 0;
  
  const derivedStats = calculateDerivedStats(str, agi, int, vit);
  
  Object.assign(battleData.player, derivedStats);
  
  battleData.player.ap = derivedStats.actionPoints;
  battleData.player.maxAp = derivedStats.actionPoints;
  
  const itemRegex = /\[IT:([^,]+),(\d+)\]\[P(\d+),(\d+(?:\.\d+)?)(?:,(\d+))?\]/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(data)) !== null) {
    const item = {
      name: itemMatch[1],
      count: parseInt(itemMatch[2]),
      type: parseInt(itemMatch[3]), 
      value: parseFloat(itemMatch[4]), 
      duration: itemMatch[5] ? parseInt(itemMatch[5]) : null, 
      used: false,
    };
    battleData.player.items.push(item);
  }
  
  const weaponRegex =
    /\[WE:(.*?)\]\[ATK:(\d+(?:\.\d+)?)\]\[Hit%:(\d+(?:\.\d+)?)(?:%)?]\[Crit%:(\d+(?:\.\d+)?)(?:%)?]\[APT:(\d+)\]\[TPA:(\d+)\]\[MPCost:(-?\d+(?:\.\d+)?)\](?:\[CD:(\d+)\])?((?:\[(?:EN|WN):[^\]]+\])*)/g;
  let weaponMatch;
  while ((weaponMatch = weaponRegex.exec(data)) !== null) {
    const weapon = {
      name: weaponMatch[1],
      attack: parseFloat(weaponMatch[2]),
      hitRate: parseFloat(weaponMatch[3]),
      critRate: parseFloat(weaponMatch[4]),
      
      attacksPerTurn: parseInt(weaponMatch[5]),
      targetsPerAttack: parseInt(weaponMatch[6]),
      mpCost: Math.max(0, parseFloat(weaponMatch[7])), 
      cooldown: weaponMatch[8] ? parseInt(weaponMatch[8]) : 0, 
      currentCooldown: 0, 
      codes: [],
      used: false,
      isHealing: false,
    };
    
    if (weapon.name.includes('治疗')) {
      weapon.isHealing = true;
    }
    
    const codesStr = weaponMatch[9]; 
    const codeRegex = /\[(EN|WN):([^\]]+)\]/g;
    let codeMatch;
    while ((codeMatch = codeRegex.exec(codesStr)) !== null) {
      weapon.codes.push(`${codeMatch[1]}:${codeMatch[2]}`);
    }
    battleData.player.weapons.push(weapon);
  }
  
  const teammateRegex =
    /\[FRN:(.*?)\](?:\[FRGR:(\d+)\])?\[FRHP:(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]\[FRMP:(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\](?:\[FRSTR:(\d+)\])?(?:\[FRAGI:(\d+)\])?(?:\[FRINT:(\d+)\])?(?:\[FRVIT:(\d+)\])?/g;
  let teammateMatch;
  let teammateIndex = 0;
  while ((teammateMatch = teammateRegex.exec(data)) !== null) {
    
    const teammate = {
      id: teammateIndex++,
      name: teammateMatch[1],
      grade: teammateMatch[2] ? parseInt(teammateMatch[2]) : 1, 
      hp: parseFloat(teammateMatch[3]),
      maxHp: parseFloat(teammateMatch[4]),
      mp: parseFloat(teammateMatch[5]),
      maxMp: parseFloat(teammateMatch[6]),
      
      str: teammateMatch[7] ? parseInt(teammateMatch[7]) : 0,
      agi: teammateMatch[8] ? parseInt(teammateMatch[8]) : 0,
      int: teammateMatch[9] ? parseInt(teammateMatch[9]) : 0,
      vit: teammateMatch[10] ? parseInt(teammateMatch[10]) : 0, 
      ap: 0, 
      maxAp: 0, 
      weapons: [],
      buffs: [],
      skillUsed: false, 
    };
    
    const str = teammate.str || 0;
    const agi = teammate.agi || 0;
    const int = teammate.int || 0;
    const vit = teammate.vit || 0;
    
    const derivedStats = calculateDerivedStats(str, agi, int, vit);
    
    Object.assign(teammate, derivedStats);
    
    teammate.ap = derivedStats.actionPoints;
    teammate.maxAp = derivedStats.actionPoints;
    
    const startIndex = teammateMatch.index;
    let endIndex = data.indexOf('[FRN:', startIndex + 1);
    if (endIndex === -1) endIndex = data.length;
    const teammateData = data.substring(startIndex, endIndex);
    
    const weaponRegex =
      /\[FRWE:([^\]]+)\]\[ATK:(\d+(?:\.\d+)?)\]\[Hit%:(\d+(?:\.\d+)?)(?:%)?]\[Crit%:(\d+(?:\.\d+)?)(?:%)?]\[APT:(\d+)\]\[TPA:(\d+)\]\[MPCost:(-?\d+(?:\.\d+)?)\](?:\[CD:(\d+)\])?((?:\[(?:WN|EN):[^\]]+\])*)/g;
    let weaponMatch;
    while ((weaponMatch = weaponRegex.exec(teammateData)) !== null) {
      const weapon = {
        name: weaponMatch[1],
        type: '剑技', 
        attack: parseFloat(weaponMatch[2]),
        hitRate: parseFloat(weaponMatch[3]),
        critRate: parseFloat(weaponMatch[4]),
        
        attacksPerTurn: parseInt(weaponMatch[5]),
        targetsPerAttack: parseInt(weaponMatch[6]),
        mpCost: Math.max(0, parseFloat(weaponMatch[7])),
        cooldown: weaponMatch[8] ? parseInt(weaponMatch[8]) : 0, 
        currentCooldown: 0, 
        codes: [],
        used: false,
        isHealing: false,
      };
      
      if (weapon.name.includes('治疗')) {
        weapon.isHealing = true;
      }
      
      const codesStr = weaponMatch[9]; 
      const codeRegex = /\[(WN|EN):([^\]]+)\]/g;
      let codeMatch;
      while ((codeMatch = codeRegex.exec(codesStr)) !== null) {
        weapon.codes.push(`${codeMatch[1]}:${codeMatch[2]}`);
      }
      teammate.weapons.push(weapon);
    }
    battleData.teammates.push(teammate);
  }

  const enemyBlocks = data.match(/\[(ENN|DENN):.*?\[PN5A:[^\]]+\]/g);
  if (enemyBlocks) {
    let enemyIndex = 0; 
    
    enemyBlocks.forEach(block => {
      
      const isDerivative = block.startsWith('[DENN:');
      const nameMatch = isDerivative ? block.match(/\[DENN:(.*?)\]/) : block.match(/\[ENN:(.*?)\]/);

      const gradeMatch = block.match(/\[ENGR:(\d+)\]/);
      const hpMatch = block.match(/\[ENHP:(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]/);
      
      const strMatch = block.match(/\[ENSTR:(\d+)\]/);
      const agiMatch = block.match(/\[ENAGI:(\d+)\]/);
      const intMatch = block.match(/\[ENINT:(\d+)\]/);
      const vitMatch = block.match(/\[ENVIT:(\d+)\]/);
      
      const patternMatch = block.match(/\[PN5A:([^\]]+)\]/);
      if (nameMatch && hpMatch && (strMatch || agiMatch || intMatch || vitMatch)) {
        const enemy = {
          id: isDerivative ? 'template' : enemyIndex++, 
          name: nameMatch[1],
          grade: gradeMatch ? parseInt(gradeMatch[1]) : 1, 
          hp: parseFloat(hpMatch[1]),
          maxHp: parseFloat(hpMatch[2]),
          skills: [],
          attackPattern: [],
          nextAttackIndex: 0,
          buffs: [],
          marks: {}, 
          stacks: {}, 
          
          str: strMatch ? parseInt(strMatch[1]) : 0,
          agi: agiMatch ? parseInt(agiMatch[1]) : 0,
          int: intMatch ? parseInt(intMatch[1]) : 0,
          vit: vitMatch ? parseInt(vitMatch[1]) : 0,
        };
        
        const str = enemy.str || 0;
        const agi = enemy.agi || 0;
        const int = enemy.int || 0;
        const vit = enemy.vit || 0;
        
        const derivedStats = calculateDerivedStats(str, agi, int, vit);
        
        Object.assign(enemy, {
          speed: derivedStats.speed,
          evasionRate: derivedStats.evasionRate,
          damageBonus: derivedStats.damageBonus,
          physicalReduction: derivedStats.physicalReduction,
          damageTakenRate: derivedStats.damageTakenRate,
          extraHitRate: derivedStats.extraHitRate,
          extraCritRate: derivedStats.extraCritRate,
          baseCritMultiplier: derivedStats.baseCritMultiplier,
          critRateResistance: derivedStats.critRateResistance,
          critDamageResistance: derivedStats.critDamageResistance,
        });

        const skillRegex = /\[ENS:([^\]]+)\]\[ATK:(\d+(?:\.\d+)?)\]\[Hit%:(\d+(?:\.\d+)?)(?:%)?]\[Crit%:(\d+(?:\.\d+)?)(?:%)?]\[APT:(\d+)\](?:\[TPA:(\d+)\])?/g;
        let skillMatch;
        while ((skillMatch = skillRegex.exec(block)) !== null) {
          const skillName = skillMatch[1];
          const skillStartIndex = skillMatch.index;
          
          const nextSkillIndex = block.indexOf('[ENS:', skillStartIndex + 1);
          const pn5aIndex = block.indexOf('[PN5A:', skillStartIndex);
          
          let skillEndIndex;
          if (nextSkillIndex !== -1) {
            skillEndIndex = nextSkillIndex;
          } else if (pn5aIndex !== -1) {
            skillEndIndex = pn5aIndex;
          } else {
            skillEndIndex = block.length;
          }
          const skillBlock = block.substring(skillStartIndex, skillEndIndex);

          const mnCodes = [];
          let mnSearchPos = 0;
          while (true) {
            const mnStart = skillBlock.indexOf('[MN:', mnSearchPos);
            if (mnStart === -1) break;

            const nextMnPos = skillBlock.indexOf('[MN:', mnStart + 4);
            const mnEnd = nextMnPos === -1 ? skillBlock.length : nextMnPos;
            let mnContent = skillBlock.substring(mnStart + 4, mnEnd).trim();
            
            while (mnContent.endsWith(']')) {
              mnContent = mnContent.slice(0, -1);
            }
            mnCodes.push('MN:' + mnContent);
            mnSearchPos = mnStart + 4;
          }
          
          enemy.skills.push({
            name: skillMatch[1],
            attack: parseFloat(skillMatch[2]),
            hitRate: parseFloat(skillMatch[3]),
            critRate: parseFloat(skillMatch[4]),
            attacksPerTurn: parseInt(skillMatch[5]),
            targetsPerAttack: skillMatch[6] ? parseInt(skillMatch[6]) : 1,
            codes: mnCodes.length > 0 ? mnCodes : undefined
          });
        }
        
        if (patternMatch) {
          enemy.attackPattern = patternMatch[1].split(',').map(s => s.trim());
        } else if (enemy.skills.length > 0) {
          
          enemy.attackPattern = enemy.skills.map(skill => skill.name);
        }

        if (!isDerivative) {
          battleData.enemies.push(enemy);
        }
      }
    });

  }
  return battleData;
}

let battleState = {
  isActive: false,
  round: 1,
  currentItemUsed: false, 
  playerBuffs: [],
  player: null,
  teammates: [], 
  currentTeammate: null, 
  selectedTeammates: [], 
  enemies: [],
  selectedEnemies: [],
  currentWeapon: null,
  currentItem: null, 
  waitingForNextRound: false,
  healTarget: null, 
  selfTargetMode: false, 
  lastKilledBy: null, 
  highestDamageWeapon: null, 
  currentAttackCount: 0, 
  maxAttackCount: 0, 
  attackInProgress: false, 
  itemUsageStats: {}, 
  initialEnemies: [],
  fullCombatLog: [], 
  
  actionOrder: [], 
  currentActionIndex: 0, 
};

// ============================================================
// 战斗状态持久化：回调机制
// ============================================================
let _onBattleStateChange = null;
let _onBattleEnd = null;

export function setBattleStateChangeCallback(callback) {
    _onBattleStateChange = callback;
}

export function setBattleEndCallback(callback) {
    _onBattleEnd = callback;
}

function notifyBattleStateChange() {
    if (typeof _onBattleStateChange === 'function') {
        _onBattleStateChange();
    }
}

const hateSystem = {
  
  enemyHateLists: {},
  
  initializeEnemyHate: function (enemyId) {
    if (!this.enemyHateLists[enemyId]) {
      this.enemyHateLists[enemyId] = [];
    }
  },
  
  addHateToEnemy: function (enemyId, targetId, targetName, hateValue) {
    this.initializeEnemyHate(enemyId);
    
    const existingHate = this.enemyHateLists[enemyId].find(hate => hate.targetId === targetId);
    if (existingHate) {
      
      existingHate.hateValue += hateValue;
    } else {
      
      this.enemyHateLists[enemyId].push({
        targetId: targetId,
        targetName: targetName,
        hateValue: hateValue,
      });
    }
    
    this.enemyHateLists[enemyId].sort((a, b) => b.hateValue - a.hateValue);
    
  },
  
  getEnemyTarget: function (enemyId) {
    this.initializeEnemyHate(enemyId);
    const hateList = this.enemyHateLists[enemyId];
    if (!hateList || hateList.length === 0) {
      
      return null;
    }
    
    return hateList[0];
  },
  
  getAllEnemyHateLists: function () {
    return this.enemyHateLists;
  },
  
  clearEnemyHate: function (enemyId) {
    delete this.enemyHateLists[enemyId];
  },
  
  clearTargetHate: function (targetId) {
    Object.keys(this.enemyHateLists).forEach(enemyId => {
      this.enemyHateLists[enemyId] = this.enemyHateLists[enemyId].filter(hate => hate.targetId !== targetId);
    });
  },
};

function addDamageHate(attackerId, attackerName, targetEnemyId, damage) {
  
  const hateValue = damage;
  hateSystem.addHateToEnemy(targetEnemyId, attackerId, attackerName, hateValue);
}
function addHealHate(healerId, healerName, healAmount) {
  
  Object.keys(hateSystem.enemyHateLists).forEach(enemyId => {
    hateSystem.addHateToEnemy(enemyId, healerId, healerName, healAmount);
  });
}

function getEnemyTargetsByHate(enemyId, maxTargets) {
  if (maxTargets <= 0) return [];
  const hateList = hateSystem.enemyHateLists[enemyId] || [];
  const targets = [];
  
  for (const hateEntry of hateList) {
    if (targets.length >= maxTargets) break;
    
    if (hateEntry.targetId === 'player' && battleState.player.hp > 0) {
      targets.push({
        type: 'player',
        entity: battleState.player,
        name: battleState.player.name || 'User',
        hateValue: hateEntry.hateValue,
      });
    } else {
      const teammate = battleState.teammates.find(t => t.id === hateEntry.targetId && t.hp > 0);
      if (teammate) {
        targets.push({
          type: 'teammate',
          entity: teammate,
          name: teammate.name,
          hateValue: hateEntry.hateValue,
        });
      }
    }
  }
  
  if (targets.length < maxTargets) {
    
    const allPossibleTargets = [];
    
    if (battleState.player.hp > 0) {
      allPossibleTargets.push({
        type: 'player',
        entity: battleState.player,
        name: battleState.player.name || 'User',
        hateValue: 0,
      });
    }
    
    battleState.teammates.forEach(teammate => {
      if (teammate.hp > 0) {
        allPossibleTargets.push({
          type: 'teammate',
          entity: teammate,
          name: teammate.name,
          hateValue: 0,
        });
      }
    });
    
    const nonSelectedTargets = allPossibleTargets.filter(target => {
      return !targets.some(selectedTarget => {
        if (selectedTarget.type === 'player' && target.type === 'player') {
          return true;
        }
        if (selectedTarget.type === 'teammate' && target.type === 'teammate') {
          return selectedTarget.entity.id === target.entity.id;
        }
        return false;
      });
    });
    
    const remainingSlots = maxTargets - targets.length;
    targets.push(...nonSelectedTargets.slice(0, remainingSlots));
  }
  return targets;
}

let battleData = null;

async function sendBattleResult(message) {
  try {
    
    if (typeof runCmd === 'function') {
      
      try {
        await runCmd(`/send ${message} || /trigger`);
        return true;
      } catch (e) {
        
        if (window.parent && typeof window.parent.sendMessageProxy === 'function') {
          window.parent.sendMessageProxy(message.replace(/^<request:|>$/g, ''));
          return true;
        }
      }
    } else if (window.parent && typeof window.parent.sendMessageProxy === 'function') {
      
      window.parent.sendMessageProxy(message.replace(/^<request:|>$/g, ''));
      return true;
    } else {
      
      const textToCopy = message.replace(/^<request:|>$/g, '');
      if (navigator.clipboard && window.isSecureContext) {
        
        navigator.clipboard.writeText(textToCopy);
      } else {
        
        const tempInput = document.createElement('input');
        tempInput.value = textToCopy;
        try {
          document.body.appendChild(tempInput);
          tempInput.select();
          document.execCommand('copy');
        } finally {
          document.body.removeChild(tempInput);
        }
      }
      return false;
    }
  } catch (e) {
    return false;
  }
}

function initializeInterface(battleDataParam) {
  // B2 fix: accept optional param; fall back to module-level battleData
  const bd = battleDataParam || battleData;
  if (!bd) {
    console.error('[battleLogic] initializeInterface: no battleData available');
    return;
  }
  
  if (!lazyRenderManager.shouldRenderPreparation()) {
    return;
  }
  lazyRenderManager.safeUpdateInterface(() => {
    updatePlayerStatus(bd.player);
    updateTeammatesStatus(bd.teammates);
    updateEnemiesDisplay(bd.enemies);
    createBattleButton();
    domRoot.getElementById('combat-interface').style.display = 'none';
    lazyRenderManager.isPreparationRendered = true;
  }, 'preparation');
}

function updateTeammatesStatus(teammates) {
  if (!teammates || teammates.length === 0) return;
  
  if (!lazyRenderManager.shouldRenderPreparation()) {
    return;
  }
  
  const teammatesDiv = document.createElement('div');
  teammatesDiv.className = 'teammates-status';
  teammatesDiv.innerHTML = `<h3><i class="fas fa-users"></i> 队友 (点击选择)</h3>`;
  
  const teammatesList = document.createElement('div');
  teammatesList.className = 'teammates-list';
  
  teammates.forEach((teammate, index) => {
    const teammateItem = document.createElement('div');
    teammateItem.className = 'teammate-item selectable selected'; 
    teammateItem.setAttribute('data-teammate-index', index);
    let weaponsHtml = '';
    if (teammate.weapons && teammate.weapons.length > 0) {
      weaponsHtml = `<div class="teammate-weapons">
                        <h4>剑技</h4>
                        <div class="weapons-list">`;
      teammate.weapons.forEach(weapon => {
        
        const effectsHtml = TooltipGenerator.generateEffectCodeHtml(weapon.codes);
        weaponsHtml += `
                            <div class="weapon-item">
                                <div class="weapon-name">${weapon.name}</div>
                                <div class="weapon-stats">
                                    <span class="weapon-stat">${weapon.isHealing ? '治疗: ' : '攻击: '}${
          weapon.attack
        }</span>
                                    <span class="weapon-stat">命中: ${weapon.hitRate}%</span>
                                    <span class="weapon-stat">暴击: ${weapon.critRate}%</span>
                                    <span class="weapon-stat">次数: ${weapon.attacksPerTurn}</span>
                                    <span class="weapon-stat">目标: ${weapon.targetsPerAttack}</span>
                                    <span class="weapon-stat">MP: ${weapon.mpCost}</span>
                                    <span class="weapon-stat">冷却: ${weapon.cooldown || 0}回合</span>
                                </div>
                                ${effectsHtml ? `<div class="weapon-effect-codes">${effectsHtml}</div>` : ''}
                            </div>`;
      });
      weaponsHtml += `</div></div>`;
    }
    teammateItem.innerHTML = `
                    <div class="teammate-info">
                        <div class="teammate-name">${
                          teammate.name
                        } <span style="color: var(--accent-color); font-size: 10px;">[等级 ${
      teammate.grade || 1
    }]</span></div>
                        <div class="teammate-hp">
                            <div class="hp-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                            <div class="hp-bar">
                                <div class="hp-fill" style="width: ${(teammate.hp / teammate.maxHp) * 100}%"></div>
                            </div>
                            <div class="hp-text">${teammate.hp}/${teammate.maxHp} (+${teammate.hpRegen || 0}/回合)</div>
                        </div>
                        <div class="teammate-mp">
                            <div class="mp-label"><i class="fas fa-flask" style="color: var(--mana-color);"></i></div>
                            <div class="mp-bar">
                                <div class="mp-fill" style="width: ${(teammate.mp / teammate.maxMp) * 100}%"></div>
                            </div>
                            <div class="mp-text">${teammate.mp}/${teammate.maxMp} (+${teammate.mpRegen}/回合)</div>
                        </div>
                        <div class="teammate-ap">
                            <div class="ap-label"><i class="fas fa-bolt" style="color: var(--ap-color);"></i></div>
                            <div class="ap-bar">
                                <div class="ap-fill" style="width: ${
                                  teammate.maxAp > 0 ? (teammate.ap / teammate.maxAp) * 100 : 0
                                }%"></div>
                            </div>
                            <div class="ap-text">${teammate.ap || 0}/${teammate.maxAp || 0} 行动点</div>
                        </div>
                        
                        <div style="display: flex; gap: 3px; margin-bottom: 5px;">
                            <div class="tooltip">
                                <div class="teammate-agility status-effect"><i class="fas fa-fist-raised"></i>${
                                  teammate.str || 0
                                }
                                    <span class="effect-tooltip">物理伤害+生命恢复</span>
                                </div>
                            </div>
                            <div class="tooltip">
                                <div class="teammate-agility status-effect"><i class="fas fa-running"></i>${
                                  teammate.agi || 0
                                }
                                    <span class="effect-tooltip">速度+闪避+暴击</span>
                                </div>
                            </div>
                            <div class="tooltip">
                                <div class="teammate-agility status-effect"><i class="fas fa-brain"></i>${
                                  teammate.int || 0
                                }
                                    <span class="effect-tooltip">暴击+法力恢复</span>
                                </div>
                            </div>
                            <div class="tooltip">
                                <div class="teammate-agility status-effect"><i class="fas fa-shield-alt"></i>${
                                  teammate.vit || 0
                                }
                                    <span class="effect-tooltip">行动点+生命恢复</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${weaponsHtml}
                `;
    teammatesList.appendChild(teammateItem);
  });
  teammatesDiv.appendChild(teammatesList);
  
  const playerStatus = domRoot.getElementById('player-status');
  if (playerStatus && playerStatus.nextSibling) {
    playerStatus.parentNode.insertBefore(teammatesDiv, playerStatus.nextSibling);
  } else if (playerStatus) {
    playerStatus.parentNode.appendChild(teammatesDiv);
  }

  addTeammateSelectionListeners(teammates);
}

function addTeammateSelectionListeners(teammates) {
  
  battleState.selectedTeammates = [...teammates];

  domRoot.querySelectorAll('.teammate-item.selectable').forEach(teammateElement => {
    teammateElement.addEventListener('click', function () {
      const teammateIndex = parseInt(this.getAttribute('data-teammate-index'));
      const teammate = teammates[teammateIndex];
      if (!teammate) return;

      const index = battleState.selectedTeammates.findIndex(t => t.id === teammate.id);
      if (index === -1) {
        
        battleState.selectedTeammates.push(teammate);
        this.classList.add('selected');
      } else {
        
        battleState.selectedTeammates.splice(index, 1);
        this.classList.remove('selected');
      }

      updateBattleButtonState();
    });
  });
}

function updateBattleButtonState() {
  const startBattleBtn = domRoot.getElementById('start-battle');
  const quickBattleBtn = domRoot.getElementById('quick-battle');

  if (startBattleBtn && quickBattleBtn) {
    
    const selectedEnemies = domRoot.querySelectorAll('#pilots-container .enemy-item.selected');
    const hasSelectedEnemies = selectedEnemies.length > 0;
    const hasSelectedTeammates = battleState.selectedTeammates.length > 0;

    const isEnabled = hasSelectedEnemies;
    startBattleBtn.disabled = !isEnabled;
    quickBattleBtn.disabled = !isEnabled;

    if (!hasSelectedEnemies) {
      startBattleBtn.innerHTML = '<i class="fas fa-fist-raised"></i> 请选择敌人';
      quickBattleBtn.innerHTML = '<i class="fas fa-forward"></i> 请选择敌人';
    } else if (!hasSelectedTeammates) {
      startBattleBtn.innerHTML = '<i class="fas fa-fist-raised"></i> 单人战斗';
      quickBattleBtn.innerHTML = '<i class="fas fa-forward"></i> 单人快速战斗';
    } else {
      startBattleBtn.innerHTML = '<i class="fas fa-fist-raised"></i> 进入战斗';
      quickBattleBtn.innerHTML = '<i class="fas fa-forward"></i> 快速战斗';
    }
  }
}

function updatePlayerStatus(player) {
  
  if (!lazyRenderManager.shouldRenderPreparation()) {
    return;
  }
  let html = `
                <div class="player-info">
                    <div class="player-name">${
                      player.name || 'User'
                    } <span style="color: var(--accent-color); font-size: 12px;">[等级 ${
    player.grade || 1
  }]</span></div>
                    <div class="player-hp">
                        <div class="hp-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                        <div class="hp-bar">
                            <div class="hp-fill" style="width: ${(player.hp / player.maxHp) * 100}%"></div>
                        </div>
                        <div class="hp-text">${player.hp}/${player.maxHp} (+${player.hpRegen || 0}/回合)</div>
                    </div>
                    <div class="player-mp">
                        <div class="mp-label"><i class="fas fa-flask" style="color: var(--mana-color);"></i></div>
                        <div class="mp-bar">
                            <div class="mp-fill" style="width: ${(player.mp / player.maxMp) * 100}%"></div>
                        </div>
                        <div class="mp-text">${player.mp}/${player.maxMp} (+${player.mpRegen}/回合)</div>
                    </div>
                    <div class="player-ap">
                        <div class="ap-label"><i class="fas fa-bolt" style="color: var(--primary-color);"></i></div>
                        <div class="ap-bar">
                            <div class="ap-fill" style="width: ${
                              player.maxAp > 0 ? (player.ap / player.maxAp) * 100 : 0
                            }%"></div>
                        </div>
                        <div class="ap-text">${player.ap || 0}/${player.maxAp || 0} 行动点</div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-fist-raised"></i>力量: ${
                              player.str || 0
                            }
                                <span class="effect-tooltip">物理伤害+生命恢复</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-running"></i>敏捷: ${
                              player.agi || 0
                            }
                                <span class="effect-tooltip">速度+闪避+暴击</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-brain"></i>智力: ${
                              player.int || 0
                            }
                                <span class="effect-tooltip">暴击+法力恢复</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-shield-alt"></i>耐力: ${
                              player.vit || 0
                            }
                                <span class="effect-tooltip">行动点+生命恢复</span>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${(() => {
                          
                          const derivedStats = calculateDerivedStats(
                            player.str || 0,
                            player.agi || 0,
                            player.int || 0,
                            player.vit || 0,
                          );
                          return `
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-tachometer-alt"></i>速度: ${
                              derivedStats.speed
                            }
                                <span class="effect-tooltip">行动速度</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-shoe-prints"></i>闪避率: ${(
                              derivedStats.evasionRate * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">躲避攻击几率</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-stats status-effect"><i class="fas fa-fist-raised"></i>伤害加成: +${(
                              derivedStats.damageBonus * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">攻击伤害加成</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-shield-alt"></i>减伤值: ${
                              derivedStats.physicalReduction
                            }
                                <span class="effect-tooltip">物理伤害减免</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-heart-broken"></i>承伤率: ${(
                              derivedStats.damageTakenRate * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">受到伤害比例</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-crosshairs"></i>额外命中: +${(
                              derivedStats.extraHitRate * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">额外命中率</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-stats status-effect"><i class="fas fa-star"></i>额外暴击: +${(
                              derivedStats.extraCritRate * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">额外暴击率</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-stats status-effect"><i class="fas fa-fire"></i>暴击倍率: ${(
                              derivedStats.baseCritMultiplier * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">暴击伤害倍率</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-shield"></i>暴击抗性: ${(
                              derivedStats.critRateResistance * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">暴击率抵抗</span>
                            </div>
                        </div>
                        <div class="tooltip">
                            <div class="player-agility status-effect"><i class="fas fa-shield-virus"></i>暴伤抗性: ${(
                              derivedStats.critDamageResistance * 100
                            ).toFixed(1)}%
                                <span class="effect-tooltip">暴击伤害抵抗</span>
                            </div>
                        </div>
                          `;
                        })()}
                    </div>
        </div>`;
  
  if (player.items && player.items.length > 0) {
    html += `
        <div class="player-items">
            <h3><i class="fas fa-box-open"></i> 道具</h3>
            <div class="weapons-list">`;
    player.items.forEach(item => {
      let effectText = '';
      switch (item.type) {
        case 1: 
          effectText = `恢复 ${item.value} 点生命值`;
          break;
        case 2: 
          effectText = `恢复 ${item.value} 点法力值`;
          break;
        case 3: 
          effectText = `力量+${item.value}，持续${item.duration}回合`;
          break;
        case 4: 
          effectText = `敏捷+${item.value}，持续${item.duration}回合`;
          break;
        case 5: 
          effectText = `智力+${item.value}，持续${item.duration}回合`;
          break;
        case 6: 
          effectText = `耐力+${item.value}，持续${item.duration}回合`;
          break;
        default:
          effectText = '未知效果';
      }
      html += `
                <div class="weapon-item">
                    <div class="weapon-name">${item.name} <span style="float: right;">x${item.count}</span></div>
                    <div class="weapon-type">${effectText}</div>
                </div>`;
    });
    html += `</div></div>`;
  }
  html += `
                <div class="player-weapons">
                    <h3><i class="fas fa-hand-fist"></i> 剑技</h3>
                    <div class="weapons-list">`;
  player.weapons.forEach(weapon => {
    
    const effectsHtml = TooltipGenerator.generateEffectCodeHtml(weapon.codes);
    html += `
                    <div class="weapon-item">
                        <div class="weapon-name">${weapon.name}</div>
                        <div class="weapon-type">剑技</div>
                        <div class="weapon-stats">
                            <span class="weapon-stat">${weapon.isHealing ? '治疗: ' : '攻击: '}${weapon.attack}</span>
                            <span class="weapon-stat">命中: ${weapon.hitRate}%</span>
                            <span class="weapon-stat">暴击: ${weapon.critRate}%</span>
                            <span class="weapon-stat">次数: ${weapon.attacksPerTurn}</span>
                            <span class="weapon-stat">目标: ${weapon.targetsPerAttack}</span>
                            <span class="weapon-stat">MP: ${weapon.mpCost}</span>
                            <span class="weapon-stat">冷却: ${weapon.cooldown || 0}回合</span>
                            ${effectsHtml}
                        </div>
                    </div>`;
  });
  html += `</div></div>`;
  domRoot.getElementById('player-status').innerHTML = html;
}

function updateEnemiesDisplay(enemies) {
  
  if (!lazyRenderManager.shouldRenderPreparation()) {
    return;
  }
  let html = `<h3><i class="fas fa-skull-crossbones"></i> 敌人 (点击选择)</h3><div class="enemies-list">`;
  enemies.forEach((enemy, index) => {
    html += `
                    <div class="enemy-item selected" data-enemy-index="${index}">
                        <div class="enemy-name">${
                          enemy.name
                        } <span style="color: var(--accent-color); font-size: 10px;">[等级 ${
      enemy.grade || 1
    }]</span></div>
                        <div class="enemy-hp">
                            <div class="hp-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                            <div class="hp-bar">
                                <div class="hp-fill" style="width: ${(enemy.hp / enemy.maxHp) * 100}%"></div>
                            </div>
                            <div class="hp-text">${enemy.hp}/${enemy.maxHp}</div>
                        </div>
                        
                        <div style="display: flex; gap: 3px; margin-bottom: 5px;">
                            ${
                              enemy.str !== undefined
                                ? `
                        <div class="tooltip">
                                <div class="enemy-agility status-effect"><i class="fas fa-fist-raised"></i>${enemy.str}
                                    <span class="effect-tooltip">力量属性，影响攻击力</span>
                            </div>
                            </div>
                            `
                                : ''
                            }
                            ${
                              enemy.agi !== undefined
                                ? `
                            <div class="tooltip">
                                <div class="enemy-agility status-effect"><i class="fas fa-running"></i>${enemy.agi}
                                    <span class="effect-tooltip">敏捷属性，影响闪避率和暴击率</span>
                                </div>
                            </div>
                            `
                                : ''
                            }
                            ${
                              enemy.int !== undefined
                                ? `
                            <div class="tooltip">
                                <div class="enemy-agility status-effect"><i class="fas fa-brain"></i>${enemy.int}
                                    <span class="effect-tooltip">智力属性，影响暴击率和暴击伤害</span>
                                </div>
                            </div>
                            `
                                : ''
                            }
                            ${
                              enemy.vit !== undefined
                                ? `
                            <div class="tooltip">
                                <div class="enemy-agility status-effect"><i class="fas fa-shield-alt"></i>${enemy.vit}
                                    <span class="effect-tooltip">体力属性，影响生命值和行动点</span>
                                </div>
                            </div>
                            `
                                : ''
                            }
                        </div>
                        <div class="enemy-skills status-effect">
                            <i class="fas fa-bolt"></i>下次行动: ${enemy.attackPattern[enemy.nextAttackIndex] || '未知'}${
    (() => {
      const nextSkillName = enemy.attackPattern[enemy.nextAttackIndex];
      const nextSkill = enemy.skills.find(s => s.name === nextSkillName);
      if (nextSkill && nextSkill.codes && nextSkill.codes.length > 0) {
        const effectIcons = nextSkill.codes.map(code => {
          const match = code.match(/MN:(M\d+)/);
          if (match) {
            return `<span style="color: #ff6b6b; font-weight: bold; margin-left: 4px;">[${match[1]}]</span>`;
          }
          return '';
        }).join('');
        return effectIcons;
      }
      return '';
    })()
  }
                            <span class="effect-tooltip">敌人下一回合的技能${
    (() => {
      const nextSkillName = enemy.attackPattern[enemy.nextAttackIndex];
      const nextSkill = enemy.skills.find(s => s.name === nextSkillName);
      if (nextSkill && nextSkill.codes && nextSkill.codes.length > 0) {
        return ' | 特效: ' + nextSkill.codes.map(code => {
          const match = code.match(/MN:(M\d+),(.+)/);
          if (match && monsterEffects[match[1]]) {
            const params = match[2].split(',');
            return monsterEffects[match[1]](...params);
          }
          return code;
        }).join(' | ');
      }
      return '';
    })()
  }</span>
                        </div>
                    </div>`;
  });
  html += `</div>`;
  domRoot.getElementById('pilots-container').innerHTML = html;
  
  domRoot.querySelectorAll('#pilots-container .enemy-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      
      updateBattleButtonState();
    });
  });
}

function createBattleButton() {
  
  if (!lazyRenderManager.shouldRenderPreparation()) {
    return;
  }
  domRoot.getElementById('combat-controls').innerHTML = `
                <div style="display: flex; justify-content: center; gap: 10px;">
                    <button id="start-battle" class="battle-button"><i class="fas fa-fist-raised"></i> 进入战斗</button>
                    <button id="quick-battle" class="battle-button" style="background-color: var(--secondary-color);"><i class="fas fa-forward"></i> 快速战斗</button>
                </div>`;
  domRoot.getElementById('start-battle').addEventListener('click', startBattle);
  domRoot.getElementById('quick-battle').addEventListener('click', startQuickBattle);

  updateBattleButtonState();
}

      function startQuickBattle() {
        const data = domRoot.getElementById('status-data-source').textContent;
        const fullBattleData = parseStatusData(data);
        
        const selectedEnemyElements = domRoot.querySelectorAll('#pilots-container .enemy-item.selected');
        const selectedEnemyIndices = Array.from(selectedEnemyElements).map(el =>
          parseInt(el.getAttribute('data-enemy-index')),
        );
        const selectedEnemies = fullBattleData.enemies.filter((enemy, index) => selectedEnemyIndices.includes(index));
        if (selectedEnemies.length === 0) {
          alert('请至少选择一个敌人进行战斗！');
          return;
        }

        const selectedTeammates = battleState.selectedTeammates || [];

        const clonedEnemies = structuredClone(selectedEnemies);
        battleState = {
          round: 1,
          player: structuredClone(fullBattleData.player),
          teammates: structuredClone(selectedTeammates), 
          enemies: clonedEnemies,
          playerBuffs: [],
          weaponUsage: {}, 
          itemUsageStats: {}, 
          killedEnemies: [], 
          highestDamageWeapon: { name: '', damage: 0 },
          lastKilledBy: null,
          initialEnemies: clonedEnemies, 
        };
        
        showQuickBattleResults(simulateQuickBattle());
      }
      
      function simulateQuickBattle() {
        const MAX_ROUNDS = 30; 
        const result = {
          isVictory: false,
          rounds: 1,
          finalPlayerHP: battleState.player.hp,
          finalPlayerMP: battleState.player.mp,
        };
        
        while (battleState.player.hp > 0 && battleState.enemies.length > 0 && battleState.round <= MAX_ROUNDS) {
          
          simulatePlayerTurn();
          
          if (StateValidator.areAllEnemiesDead()) {
            result.isVictory = true;
            break;
          }
          simulateEnemyTurn();
          if (StateValidator.isPlayerDead()) break;
          
          simulateEndOfRound();
          battleState.round++;
        }
        
        result.rounds = battleState.round;
        result.finalPlayerHP = battleState.player.hp;
        result.finalPlayerMP = battleState.player.mp;
        return result;
      }
      
      function simulatePlayerTurn() {
        
        if (battleState.player.hp < battleState.player.maxHp * 0.3 && tryUseHealingItem()) {
          return true;
        }
        
        if (battleState.player.mp < battleState.player.maxMp * 0.2 && tryUseManaItem()) {
          return true;
        }
        
        const availableWeapons = battleState.player.weapons.filter(w => !w.used);
        if (availableWeapons.length === 0) {
          return false;
        }
        
        const attackWeapons = availableWeapons.filter(weapon => {
          const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
          return weaponTemplate !== 'A2' && weaponTemplate !== 'A3' && weaponTemplate !== 'A4';
        });
        
        if (attackWeapons.length === 0) {
          const healingWeapons = availableWeapons.filter(weapon => {
            const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
            return weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4';
          });
          if (healingWeapons.length > 0) {
            
            const weapon = healingWeapons[0];
            if (battleState.player.mp >= weapon.mpCost) {
              battleState.player.mp -= weapon.mpCost;
              const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
              if (weaponTemplate === 'A2') {
                battleState.player.hp = Math.min(battleState.player.hp + weapon.attack, battleState.player.maxHp);
              } else if (weaponTemplate === 'A3') {
                battleState.player.mp = Math.min(battleState.player.mp + weapon.attack, battleState.player.maxMp);
              } else if (weaponTemplate === 'A4') {
                
                battleState.player.hp = Math.min(battleState.player.hp + weapon.attack, battleState.player.maxHp);
                
              }
              weapon.used = true;
              return true;
            }
          }
          return false;
        }
        
        attackWeapons.sort((a, b) => {
          
          const aDamage = calculatePotentialDamage(a);
          const bDamage = calculatePotentialDamage(b);
          return bDamage - aDamage;
        });
        const weapon = attackWeapons[0];
        
        if (battleState.player.mp < weapon.mpCost) {
          weapon.used = true;
          return simulatePlayerTurn(); 
        }

        if (!battleState.weaponUsage[weapon.name]) {
          battleState.weaponUsage[weapon.name] = {
            name: weapon.name,
            damage: 0,
            kills: 0,
          };
        }
        
        if (weapon.isHealing) {
          const healAmount = weapon.attack;
          const oldHp = battleState.player.hp;
          battleState.player.hp = Math.min(battleState.player.hp + healAmount, battleState.player.maxHp);
          weapon.used = true;
          return true;
        }
        
        let targets = selectTargets(weapon);
        
        if (targets.length === 0) {
          weapon.used = true;
          return true;
        }
        
        for (let attackCount = 0; attackCount < weapon.attacksPerTurn; attackCount++) {
          
          if (battleState.player.mp < weapon.mpCost) {
            
            break;
          }
          
          for (const target of targets) {
            
            if (!StateValidator.isValidTarget(target)) continue;
            
            const attackerStats = {
              extraHitRate: (battleState.player.agi || 0) * 0.01,
              extraCritRate: (battleState.player.int || 0) * 0.01,
              baseCritMultiplier: 1.5 + (battleState.player.int || 0) * 0.01,
            };
            const targetStats = {
              evasionRate: (target.agi || 0) * 0.005,
              critRateResistance: (target.agi || 0) * 0.005 + (target.int || 0) * 0.005,
            };
            const finalHitRate = calculateFinalHitRate(weapon.hitRate, attackerStats, targetStats);
            const hitRoll = Math.random();
            
            if (hitRoll <= Math.min(1.0, finalHitRate)) {

              const finalCritRate = calculateFinalCritRate(weapon.critRate, attackerStats, targetStats, finalHitRate);
              const critRoll = Math.random();
              
              const isCrit = critRoll <= finalCritRate;
              
              let damage = calculateDamage(
                weapon,
                target,
                isCrit,
                battleState.player.str || 0,
                battleState.player.int || 0,
              );
              
              battleState.weaponUsage[weapon.name].damage += damage;
              
              if (damage > (battleState.highestDamageWeapon.damage || 0)) {
                battleState.highestDamageWeapon.name = weapon.name;
                battleState.highestDamageWeapon.damage = damage;
              }
              
              target.hp -= damage;
              
              if (StateValidator.isDead(target)) {
                
                battleState.weaponUsage[weapon.name].kills = (battleState.weaponUsage[weapon.name].kills || 0) + 1;
                battleState.killedEnemies.push(target.name);
                
                if (StateValidator.checkEnemyDeath(target)) {
                  break; 
                }
              }
            }
          }
          
          if (StateValidator.areAllEnemiesDead()) {
            break;
          }
          
          if (targets.length > battleState.enemies.length) {
            targets = selectTargets(weapon);
            
            if (targets.length === 0) {
              break;
            }
          }
          
          battleState.player.mp = Math.max(0, battleState.player.mp - weapon.mpCost);
        }
        
        weapon.used = true;
        return true;
      }
      
      function calculatePotentialDamage(weapon) {
        
        const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
        
        if (weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4') {
          return 0;
        }
        const baseDamage = weapon.attack * weapon.attacksPerTurn * weapon.targetsPerAttack;
        
        const critFactor = 1 + (weapon.critRate / 100) * 0.5; 
        return baseDamage * critFactor;
      }
      
      function selectTargets(weapon) {
        
        const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
        if (weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4') {
          return []; 
        }
        
        return weapon.targetsPerAttack > 1
          ? battleState.enemies.slice(0, weapon.targetsPerAttack)
          : [
              battleState.enemies.reduce(
                (lowest, current) => (current.hp < lowest.hp ? current : lowest),
                battleState.enemies[0],
              ),
            ];
      }
      
      function calculateDamage(weapon, target, isCrit, attackerStr = 0, attackerInt = 0) {
        
        const attackerStats = {
          damageBonus: attackerStr * 0.01,
          extraCritRate: 0, 
          baseCritMultiplier: 1.5 + attackerInt * 0.01, 
        };
        const targetStats = {
          damageTakenRate: 50 / (50 + (target.vit || 0)),
          physicalReduction: (target.str || 0) * 1,
          critDamageResistance: 0, 
        };
        
        const finalCritMultiplier = isCrit
          ? Math.max(1.0, attackerStats.baseCritMultiplier - targetStats.critDamageResistance)
          : 1.0;
        return calculateFinalDamage(weapon.attack, attackerStats, targetStats, isCrit, finalCritMultiplier);
      }
      
      function tryUseHealingItem() {
        if (!battleState.player.items || battleState.player.items.length === 0) {
          return false;
        }
        
        const healingItem = battleState.player.items.find(item => item.type === 1 && item.count > 0);
        if (healingItem) {
          
          const oldHp = battleState.player.hp;
          battleState.player.hp = Math.min(battleState.player.hp + healingItem.value, battleState.player.maxHp);
          
          if (!battleState.itemUsageStats[healingItem.name]) {
            battleState.itemUsageStats[healingItem.name] = 0;
          }
          battleState.itemUsageStats[healingItem.name]++;
          
          healingItem.count--;
          return true;
        }
        return false;
      }
      
      function tryUseManaItem() {
        if (!battleState.player.items || battleState.player.items.length === 0) {
          return false;
        }
        
        const mpItem = battleState.player.items.find(item => item.type === 2 && item.count > 0);
        if (mpItem) {
          
          const oldMp = battleState.player.mp;
          battleState.player.mp = Math.min(battleState.player.mp + mpItem.value, battleState.player.maxMp);
          
          if (!battleState.itemUsageStats[mpItem.name]) {
            battleState.itemUsageStats[mpItem.name] = 0;
          }
          battleState.itemUsageStats[mpItem.name]++;
          
          mpItem.count--;
          return true;
        }
        return false;
      }
      
      function simulateEnemyTurn() {
        for (const enemy of battleState.enemies) {
          
          const attackName = enemy.attackPattern[enemy.nextAttackIndex];
          const skill = enemy.skills.find(s => s.name === attackName);
          if (skill) {
            
            const currentPlayerStats = getPlayerActualStats();
            const enemyStats = {
              extraHitRate: (enemy.agi || 0) * 0.01,
              extraCritRate: (enemy.int || 0) * 0.01,
              baseCritMultiplier: 1.5 + (enemy.int || 0) * 0.01,
              damageBonus: (enemy.str || 0) * 0.01,
            };
            const finalHitRate = calculateFinalHitRate(skill.hitRate, enemyStats, currentPlayerStats);
            const hitRoll = Math.random();
            
            if (hitRoll <= Math.min(1.0, finalHitRate)) {

              const finalCritRate = calculateFinalCritRate(
                skill.critRate,
                enemyStats,
                currentPlayerStats,
                finalHitRate,
              );
              const critRoll = Math.random();
              
              const isCrit = critRoll <= finalCritRate;
              
              const finalCritMultiplier = isCrit
                ? calculateFinalCritMultiplier(enemyStats, currentPlayerStats, finalCritRate)
                : 1.0;
              
              let damage = calculateFinalDamage(
                skill.attack,
                enemyStats,
                currentPlayerStats,
                isCrit,
                finalCritMultiplier,
              );
              
              battleState.player.hp -= damage;
              
              if (StateValidator.isPlayerDead()) {
                battleState.lastKilledBy = skill.name;
                return;
              }
            }
            
            enemy.nextAttackIndex = (enemy.nextAttackIndex + 1) % enemy.attackPattern.length;
          }
        }
      }
      
      function simulateEndOfRound() {
        
        battleState.player.weapons.forEach(weapon => {
          weapon.used = false;
        });
        
        battleState.player.hp = Math.min(
          battleState.player.hp + (battleState.player.hpRegen || 0),
          battleState.player.maxHp,
        );
        
        battleState.player.mp = Math.min(battleState.player.mp + battleState.player.mpRegen, battleState.player.maxMp);
      }
      
      function showQuickBattleResults(result) {
        
        const stats = collectBattleStatistics();
        
        let summaryHtml = '';
        if (result.isVictory) {
          summaryHtml += `<h3 class="victory">战斗胜利！</h3>`;
          summaryHtml += `<p>用时 ${result.rounds} 回合</p>`;
          summaryHtml += `<p>剩余HP: ${result.finalPlayerHP}/${battleState.player.maxHp}</p>`;
          summaryHtml += `<p>剩余MP: ${result.finalPlayerMP}/${battleState.player.maxMp}</p>`;
          
          if (battleState.killedEnemies && battleState.killedEnemies.length > 0) {
            summaryHtml += `<p>击败的敌人: ${battleState.killedEnemies.join('、')}</p>`;

            const defeatedEnemies = battleState.initialEnemies.filter(enemy =>
              battleState.killedEnemies.includes(enemy.name),
            );
            const expResult = calculateTeamExperience(battleState.player, battleState.teammates, defeatedEnemies);
            summaryHtml += `<div style="margin-top: 15px; padding: 10px; background: rgba(6, 182, 212, 0.1); border-radius: 8px; border: 1px solid var(--accent-color);">`;
            summaryHtml += `<h4 style="color: var(--accent-color); margin: 0 0 10px 0;">📈 经验值获得</h4>`;
            summaryHtml += `<p><strong>${battleState.player.name || 'User'}</strong> (等级${
              battleState.player.grade || 1
            }) 获得经验值: <span style="color: var(--accent-color); font-weight: bold;">${
              expResult.playerExp
            } EXP</span></p>`;
            if (expResult.teammateResults && expResult.teammateResults.length > 0) {
              expResult.teammateResults.forEach(teammate => {
                summaryHtml += `<p><strong>${teammate.name}</strong> (等级${teammate.level}) 获得经验值: <span style="color: var(--accent-color); font-weight: bold;">${teammate.exp} EXP</span></p>`;
              });
            }
            summaryHtml += `</div>`;
          }
        } else {
          summaryHtml += `<h3 class="defeat">战斗失败！</h3>`;
          summaryHtml += `<p>坚持了 ${result.rounds} 回合</p>`;
          if (battleState.lastKilledBy) {
            summaryHtml += `<p>被 ${battleState.lastKilledBy} 击败</p>`;
          }
          
          if (battleState.killedEnemies && battleState.killedEnemies.length > 0) {
            summaryHtml += `<p>击败的敌人: ${battleState.killedEnemies.join('、')}</p>`;
          }
        }
        
        if (stats.weaponStats.length > 0) {
          summaryHtml += `<h4 style="margin-top: 10px;">武器统计:</h4>`;
          summaryHtml += `<ul style="text-align: left; padding-left: 20px;">`;
          stats.weaponStats.forEach(weapon => {
            summaryHtml += `<li>${weapon.name}: 造成 ${weapon.damage} 点伤害`;
            if (weapon.kills > 0) {
              summaryHtml += `，击败 ${weapon.kills} 个敌人`;
            }
            summaryHtml += `</li>`;
          });
          summaryHtml += `</ul>`;
        }
        
        if (stats.itemUsage && stats.itemUsage.length > 0) {
          summaryHtml += `<h4 style="margin-top: 10px;">道具使用:</h4>`;
          summaryHtml += `<ul style="text-align: left; padding-left: 20px;">`;
          stats.itemUsage.forEach(item => {
          summaryHtml += `<li>${item.name}: 使用了 ${item.count} 个</li>`;
        });
        summaryHtml += `</ul>`;
      }
      
      domRoot.getElementById('result-summary').innerHTML = summaryHtml;
      domRoot.getElementById('result-modal').style.display = 'flex';
      
      domRoot.getElementById('close-result').removeEventListener('click', closeResultHandler);
      domRoot.getElementById('send-result').removeEventListener('click', sendResultHandler);
      
      domRoot.getElementById('close-result').addEventListener('click', closeResultHandler);
      
      domRoot.getElementById('send-result').addEventListener('click', sendResultHandler);
    }
      function closeResultHandler() {
        domRoot.getElementById('result-modal').style.display = 'none';
        
        domRoot.getElementById('extra-result-text').value = '';
        
        battleState.isActive = false;
        battleState.attackInProgress = false;
      }
      
      function sendResultHandler() {
        
        const extraText = domRoot.getElementById('extra-result-text').value.trim();
        
        let message = '';
        if (StateValidator.isVictory()) {

          const allEnemyNames = battleState.initialEnemies.map(enemy => enemy.name).join('、');
          
          const stats = collectBattleStatistics();
          let weaponDamageStats = '';
          if (stats.weaponStats.length > 0) {
            weaponDamageStats =
              '，武器伤害统计: ' +
              stats.weaponStats
                .map(
                  weapon =>
                    `${weapon.name}伤害为${weapon.damage}${weapon.kills > 0 ? `(击败了${weapon.kills}个敌人)` : ''}`,
                )
                .join(', ');
          }
          
          let itemUsageStats = '';
          if (stats.itemUsage && stats.itemUsage.length > 0) {
            itemUsageStats = '，使用道具: ' + stats.itemUsage.map(item => `${item.name} ${item.count}个`).join('、');
          }
          
          let playerStatus = `{{user}}血量${battleState.player.hp}/${battleState.player.maxHp}，MP值${battleState.player.mp}/${battleState.player.maxMp}`;
          
          let teammatesStatus = '';
          if (battleState.teammates && battleState.teammates.length > 0) {
            teammatesStatus =
              '，队友状态: ' +
              battleState.teammates
                .map(
                  teammate =>
                    `${teammate.name}血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}`,
                )
                .join('；');
          }
          
          let expInfo = '';
          if (battleState.killedEnemies && battleState.killedEnemies.length > 0) {
            const defeatedEnemies = battleState.initialEnemies.filter(enemy =>
              battleState.killedEnemies.includes(enemy.name),
            );
            const expResult = calculateTeamExperience(battleState.player, battleState.teammates, defeatedEnemies);
            expInfo = `，{{user}}获得${expResult.playerExp}经验值`;
            if (expResult.teammateResults && expResult.teammateResults.length > 0) {
              const teammateExpInfo = expResult.teammateResults
                .map(teammate => `${teammate.name}获得${teammate.exp}经验值`)
                .join('，');
              expInfo += `，${teammateExpInfo}`;
            }
          }
          message = `<request:{{user}}赢得了战斗，${playerStatus}${teammatesStatus}，伤害最高武器为${
            stats.weaponStats.length > 0 ? stats.weaponStats[0].name : '无'
          }，击败了${allEnemyNames}${weaponDamageStats}${itemUsageStats}${expInfo}${
            extraText ? '，' + extraText : ''
          }>`;
        } else {
          
          const stats = collectBattleStatistics();
          let weaponDamageStats = '';
          if (stats.weaponStats.length > 0) {
            weaponDamageStats =
              '，武器伤害统计: ' +
              stats.weaponStats
                .map(
                  weapon =>
                    `${weapon.name}伤害为${weapon.damage}${weapon.kills > 0 ? `(击败了${weapon.kills}个敌人)` : ''}`,
                )
                .join(', ');
          }
          
          let itemUsageStats = '';
          if (stats.itemUsage && stats.itemUsage.length > 0) {
            itemUsageStats = '，使用道具: ' + stats.itemUsage.map(item => `${item.name} ${item.count}个`).join('、');
          }
          
          let defeatedEnemies = '';
          if (battleState.killedEnemies && battleState.killedEnemies.length > 0) {
            defeatedEnemies = `，击败了${battleState.killedEnemies.join('、')}`;
          }
          
          let teammatesStatus = '';
          if (battleState.teammates && battleState.teammates.length > 0) {
            teammatesStatus =
              '，队友状态: ' +
              battleState.teammates
                .map(
                  teammate =>
                    `${teammate.name}血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}`,
                )
                .join('；');
          }
          message = `<request:{{user}}被击败了，{{user}}血量变为0/${battleState.player.maxHp}，MP值${
            battleState.player.mp
          }/${battleState.player.maxMp}${teammatesStatus}${
            battleState.lastKilledBy ? '，被' + battleState.lastKilledBy + '击败' : ''
          }${defeatedEnemies}${weaponDamageStats}${itemUsageStats}${extraText ? '，' + extraText : ''}>`;
        }
        
        sendBattleResult(message)
          .then(success => {
            if (success) {
              
            } else {
              
            }
          })
          .catch(e => {
            console.error('发送战斗结果失败:', e);
          });
        
        domRoot.getElementById('result-modal').style.display = 'none';
        
        domRoot.getElementById('extra-result-text').value = '';
        
        battleState.isActive = false;
        battleState.attackInProgress = false;
      }
      
      function calculateActionOrder() {
        
        battleState.actionOrder = [];
        battleState.currentActionIndex = 0;
        const allParticipants = [];
        
        allParticipants.push({
          type: 'player',
          id: 'player',
          name: battleState.player.name || 'User',
          speed: battleState.player.speed,
          entity: battleState.player,
        });
        
        battleState.teammates.forEach(teammate => {
          allParticipants.push({
            type: 'teammate',
            id: teammate.id,
            name: teammate.name,
            speed: teammate.speed,
            entity: teammate,
          });
        });
        
        battleState.enemies.forEach(enemy => {
          allParticipants.push({
            type: 'enemy',
            id: enemy.id,
            name: enemy.name,
            speed: enemy.speed,
            entity: enemy,
          });
        });
        
        battleState.actionOrder = calculateActionOrderCore(allParticipants);
        
        let actionOrderText = '行动顺序: ';
        battleState.actionOrder.forEach((action, index) => {
          actionOrderText += `${index + 1}.${action.name}`;
          if (index < battleState.actionOrder.length - 1) {
            actionOrderText += ' → ';
          }
        });
        logBattleAction(actionOrderText);
        return battleState.actionOrder;
      }
      
      function startBattle() {
        const data = domRoot.getElementById('status-data-source').textContent;
        battleData = parseStatusData(data);
        const selectedEnemyElements = domRoot.querySelectorAll('#pilots-container .enemy-item.selected');
        const selectedEnemyIndices = Array.from(selectedEnemyElements).map(el =>
          parseInt(el.getAttribute('data-enemy-index')),
        );
        const selectedEnemies = battleData.enemies.filter((enemy, index) => selectedEnemyIndices.includes(index));
        if (selectedEnemies.length === 0) {
          alert('请至少选择一个敌人进行战斗！');
          return;
        }

        const selectedTeammates = battleState.selectedTeammates || [];
        battleState.isActive = true;
        battleState.round = 1;

        battleState.currentItemUsed = false;
        battleState.playerBuffs = [];
        battleState.player = structuredClone(battleData.player);
        battleState.teammates = structuredClone(selectedTeammates); 
        battleState.currentTeammate = null; 
        
        const clonedEnemies = structuredClone(selectedEnemies);
        battleState.enemies = clonedEnemies;
        battleState.initialEnemies = clonedEnemies; 
        battleState.selectedEnemies = [];
        battleState.selectedHealTargets = []; 
        battleState.currentWeapon = null;
        battleState.currentItem = null;
        battleState.waitingForNextRound = false;
        battleState.healTarget = null;
        battleState.selfTargetMode = false;
        battleState.lastKilledBy = null;
        battleState.itemUsageStats = {}; 
        battleState.highestDamageWeapon = {
          name: '',
          damage: 0,
        };
        battleState.actionOrder = []; 
        battleState.currentActionIndex = 0; 
        battleState.sacrificeBoostActive = null; 
        
        hateSystem.enemyHateLists = {}; 
        
        lazyRenderManager.isCombatRendered = true;
        domRoot.querySelector('.container').style.display = 'none';
        initializeBattleInterface();
        domRoot.getElementById('combat-interface').style.display = 'block';
        
        lazyRenderManager.safeUpdateInterface(() => {
          
          calculateActionOrder();
          logBattleAction(`第 ${battleState.round} 回合开始！`);
          
          setTimeout(() => {
            forceUpdateUI();
            showCurrentActor(); 
            updateHateDisplay(); 
          }, 100);
        }, 'combat');
        
        // 持久化：战斗开始后保存状态
        notifyBattleStateChange();
      }
      
      function showCurrentActor() {
        
        battleState.currentItemUsed = false;
        if (battleState.actionOrder.length === 0) {
          return;
        }
        if (battleState.currentActionIndex >= battleState.actionOrder.length) {
          battleState.currentActionIndex = 0;
        }
        const currentAction = battleState.actionOrder[battleState.currentActionIndex];
        if (!currentAction) {
          return;
        }
        
        let entityExists = false;
        if (currentAction.type === 'player') {
          
          entityExists = true;
        } else if (currentAction.type === 'teammate') {
          
          entityExists = battleState.teammates.some(t => t.id === currentAction.id);
        } else if (currentAction.type === 'enemy') {
          
          entityExists = battleState.enemies.some(e => e.id === currentAction.id);
        }
        
        if (!entityExists) {
          moveToNextAction();
          return;
        }
        logBattleAction(`${currentAction.name} 的行动回合！`);
        
        domRoot.querySelectorAll('.action-order-item').forEach(item => {
          const index = parseInt(item.getAttribute('data-action-index'));
          if (index === battleState.currentActionIndex) {
            item.classList.add('current');
          } else {
            item.classList.remove('current');
          }
        });
        
        domRoot.querySelectorAll('.combat-entity').forEach(entity => {
          entity.classList.remove('current-actor');
        });
        if (currentAction.type === 'player') {
          const playerEntity = domRoot.querySelector('.combat-entity.player');
          if (playerEntity) {
            playerEntity.classList.add('current-actor');
          }
          
          const currentPlayerStats = getPlayerActualStats();
          battleState.player.ap = currentPlayerStats.actionPoints; 
          battleState.player.maxAp = currentPlayerStats.actionPoints;
          battleState.currentItemUsed = false;
          
          battleState.player.weapons.forEach(weapon => {
            weapon.used = false;
          });
          battleState.player.items.forEach(item => {
            item.used = false;
          });
          
          battleState.currentTeammate = null;
          
          domRoot.getElementById('melee-toggle').innerHTML = '<i class="fas fa-sword"></i> 剑技';
          
          updatePlayerPanel(); 
          updateWeaponsList(); 
          updateItemsList(); 
          
          enablePlayerControls();
        } else if (currentAction.type === 'teammate') {
          
          const teammateEntity = domRoot.querySelector(
            `.combat-entity.teammate[data-teammate-id="${currentAction.id}"]`,
          );
          if (teammateEntity) {
            teammateEntity.classList.add('current-actor');
          }
          
          currentAction.entity.skillUsed = false;
          currentAction.entity.ap = currentAction.entity.maxAp; 
          currentAction.entity.weapons.forEach(weapon => {
            weapon.used = false;
          });
          
          battleState.currentTeammate = currentAction.entity;
          
          logBattleAction(`轮到 ${currentAction.name} 行动，请选择剑技进行攻击。`);
          
          updatePlayerPanel();
          
          domRoot.getElementById('melee-toggle').innerHTML = '<i class="fas fa-sword"></i> 队友剑技';

          updateTeammateWeaponsList();
          
          updateItemsList();
          
          setupSkipButton();
        } else if (currentAction.type === 'enemy') {
          const enemyEntity = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${currentAction.id}"]`);
          if (enemyEntity) {
            enemyEntity.classList.add('current-actor');
          }
          
          performEnemyAction(currentAction.entity);
        }
      }
      function initializeBattleInterface() {
        updateBattleUI({ player: true, enemy: true, weapons: true, items: true });
        domRoot.getElementById('combat-log').innerHTML = '';
        
        const actionOrderDisplay = domRoot.getElementById('action-order-display');
        if (actionOrderDisplay) {
          actionOrderDisplay.innerHTML = '';
        }
        
        battleState.fullCombatLog = [];
        
        const meleeToggle = domRoot.getElementById('melee-toggle');
        const itemsToggle = domRoot.getElementById('items-toggle');
        const attackBtn = domRoot.getElementById('attack-btn');
        const nextRoundBtn = domRoot.getElementById('next-round-btn');
        
        function clearEventListeners(element) {
          if (!element) return;
          const clone = element.cloneNode(true);
          if (element.parentNode) {
            element.parentNode.replaceChild(clone, element);
          }
          return clone;
        }
        
        const newMeleeToggle = clearEventListeners(meleeToggle);
        const newItemsToggle = clearEventListeners(itemsToggle);
        const statsToggle = domRoot.getElementById('stats-toggle');
        const newStatsToggle = clearEventListeners(statsToggle);
        const newAttackBtn = clearEventListeners(attackBtn);
        const newNextRoundBtn = clearEventListeners(nextRoundBtn);
        
        newMeleeToggle.addEventListener('click', function () {
          newMeleeToggle.classList.add('active');
          newItemsToggle.classList.remove('active');
          newStatsToggle.classList.remove('active');
          domRoot.getElementById('melee-panel').classList.add('active');
          domRoot.getElementById('items-panel').classList.remove('active');
          domRoot.getElementById('stats-panel').classList.remove('active');
        });
        newItemsToggle.addEventListener('click', function () {
          newItemsToggle.classList.add('active');
          newMeleeToggle.classList.remove('active');
          newStatsToggle.classList.remove('active');
          domRoot.getElementById('items-panel').classList.add('active');
          domRoot.getElementById('melee-panel').classList.remove('active');
          domRoot.getElementById('stats-panel').classList.remove('active');
        });
        newStatsToggle.addEventListener('click', function () {
          newStatsToggle.classList.add('active');
          newMeleeToggle.classList.remove('active');
          newItemsToggle.classList.remove('active');
          domRoot.getElementById('stats-panel').classList.add('active');
          domRoot.getElementById('melee-panel').classList.remove('active');
          domRoot.getElementById('items-panel').classList.remove('active');
          
          updateDetailedStatsPanel();
        });
        
        newAttackBtn.addEventListener('click', performPlayerAttack);
        
        // 5c: 事件委托替代 onclick="toggleStats(...)"（Shadow DOM 中无法访问模块级函数）
        domRoot.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-toggle-stats]');
            if (!btn) return;
            const targetId = btn.getAttribute('data-toggle-stats');
            const collapsible = domRoot.getElementById(targetId);
            if (collapsible) {
                collapsible.classList.toggle('expanded');
                btn.classList.toggle('expanded');
            }
        });
        
        battleState.attackInProgress = false;
      }
      
      function generateBuffTooltip(buff) {
        if (buff.type === 'critBoost') return `暴击率+${buff.value}%`;
        if (buff.type === 'healOverTime') return `每回合恢复${buff.value}HP`;
        if (buff.type === 'shieldOverTime') return `每回合获得${buff.value}点护盾`;
        if (buff.type === 'sacrificeBoost') return buff.tooltipText;
        if (buff.type === 'strBoost') return `力量+${buff.value}`;
        if (buff.type === 'agiBoost') return `敏捷+${buff.value}`;
        if (buff.type === 'intBoost') return `智力+${buff.value}`;
        if (buff.type === 'endBoost') return `耐力+${buff.value}`;
        
        if (buff.type === 'vulnerable') return `受伤+${buff.value}%`;
        if (buff.type === 'hitRateDown') return `命中率-${buff.value}%`;
        if (buff.type === 'burnOverTime') return `每回合-${buff.value}伤害`;
        if (buff.type === 'freeze') return `晕眩`;
        if (buff.type === 'permanentShield') return `固化护盾${buff.value}点`;
        if (buff.type === 'temporaryShield') return `临时护盾${buff.value}点`;
        
        if (buff.type === 'dot') return `每回合受到${buff.value}点伤害`;
        if (buff.type === 'strDebuff') return `力量-${buff.value}`;
        if (buff.type === 'stun') return `无法行动`;
        if (buff.type === 'agiDebuff') return `敏捷-${buff.value}`;
        if (buff.type === 'manaBurn') return `每回合损失${buff.value}点MP`;
        if (buff.type === 'intDebuff') return `智力-${buff.value}`;
        if (buff.type === 'vitDebuff') return `耐力-${buff.value}`;
        return '';
      }
      
      function generateBuffsHtml(buffs) {
        return buffs
          .map(buff => {
            const positiveTypes = ['healOverTime', 'shieldOverTime'];
            const buffClass = buff.isPositive || positiveTypes.includes(buff.type) ? 'positive' : 'negative';
            const tooltipText = generateBuffTooltip(buff);
            const duration = buff.duration === '本回合' ? buff.duration : buff.duration + '回合';
            return `
            <div class="buff ${buffClass} status-effect">
                <div class="buff-name">${buff.name}</div>
                <div class="buff-duration">${duration}</div>
                <span class="effect-tooltip">${tooltipText}</span>
            </div>`;
          })
          .join('');
      }
      
      function updatePlayerPanel() {
        
        if (!lazyRenderManager.shouldRenderCombat()) {
          return;
        }
        let html = ''; 
        
        const player = battleState.player;
        const playerStats = getPlayerActualStats();
        
        let allBuffs = [...battleState.playerBuffs];
        
        if (battleState.sacrificeBoostActive) {
          allBuffs.push({
            name: '牺牲增益',
            type: 'sacrificeBoost',
            isPositive: true,
            duration: '本回合',
            tooltipText: `攻击+${battleState.sacrificeBoostActive.attack}，命中+${battleState.sacrificeBoostActive.hitRate}%，暴击+${battleState.sacrificeBoostActive.critRate}%，次数+${battleState.sacrificeBoostActive.attacksPerTurn}，目标+${battleState.sacrificeBoostActive.targetsPerAttack}`,
          });
        }
        const buffsHtml = generateBuffsHtml(allBuffs);
        
        const isPlayerTurn = !battleState.currentTeammate;
        const weaponTemplate = battleState.currentWeapon?.codes
          ?.find(code => code.startsWith('WN:A'))
          ?.match(/WN:(A[1-5])/)?.[1];

        let canSelectPlayer = false;
        if (battleState.selfTargetMode) {
          if (weaponTemplate === 'A4') {
            
            canSelectPlayer = isPlayerTurn;
          } else if (weaponTemplate === 'A2' || weaponTemplate === 'A3') {
            
            canSelectPlayer = true;
          } else if (battleState.currentWeapon?.isHealing) {
            
            canSelectPlayer = true;
          }
          
        }
        const selfTargetClass = canSelectPlayer ? 'selectable' : '';
        
        html += `
                <div class="combat-entity player ${selfTargetClass}" data-entity-type="player">
                    <div class="entity-header">
                        <div class="entity-name">${player.name || 'User'}</div>
                    </div>
                    <div class="entity-stats">
                        <div class="hp-bar-container">
                            <div class="hp-bar-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                            <div class="hp-bar-combat">
                                <div class="hp-fill-combat" style="width: ${(player.hp / player.maxHp) * 100}%"></div>
                                <div class="hp-text-combat">${player.hp}/${player.maxHp} (+${
          playerStats.hpRegen
        }/回合)</div>
                            </div>
                        </div>
                        <div class="mp-bar-container">
                            <div class="mp-bar-label"><i class="fas fa-flask" style="color: var(--mana-color);"></i></div>
                            <div class="mp-bar-combat">
                                <div class="mp-fill-combat" style="width: ${(player.mp / player.maxMp) * 100}%"></div>
                                <div class="mp-text-combat">${player.mp}/${player.maxMp} (+${
          playerStats.mpRegen
        }/回合)</div>
                            </div>
                        </div>
                        <div class="ap-bar-container">
                            <div class="ap-bar-label"><i class="fas fa-bolt" style="color: var(--primary-color);"></i></div>
                            <div class="ap-bar-combat">
                                <div class="ap-fill-combat" style="width: ${
                                  player.maxAp > 0 ? (player.ap / player.maxAp) * 100 : 0
                                }%"></div>
                                <div class="ap-text-combat">${player.ap || 0}/${player.maxAp || 0} 行动点</div>
                            </div>
                        </div>
                        ${player.shield || player.tempShield ? `
                        <div class="shield-bar-container">
                            <div class="shield-bar-label"><i class="fas fa-shield-alt" style="color: #06b6d4;"></i></div>
                            <div class="shield-bar-combat">
                                <div class="shield-text-combat">${
                                  player.shield && player.tempShield 
                                    ? `护盾 ${player.shield} | 临时 ${player.tempShield}` 
                                    : player.shield 
                                      ? `护盾 ${player.shield}` 
                                      : `临时 ${player.tempShield}`
                                }</div>
                            </div>
                        </div>
                        ` : ''}
                        <button class="stats-toggle-btn" data-toggle-stats="player-stats">
                            <i class="fas fa-chart-bar"></i> 详细属性
                            <span class="toggle-icon">▼</span>
                        </button>
                        <div class="stats-collapsible" id="player-stats">
                            <div class="stats-compact">
                                
                                <div class="stat-category">
                                    <div class="category-title" style="font-size: 9px; margin-bottom: 3px;">
                                        STR:${playerStats.str} AGI:${playerStats.agi} INT:${playerStats.int} VIT:${
          playerStats.end
        }
                            </div>
                            </div>
                                
                                <div class="stat-row str-based">
                                    <div class="stat-row-label"><i class="fas fa-hand-fist"></i> 伤害加成</div>
                                    <div class="stat-row-value">+${(playerStats.damageBonus * 100).toFixed(1)}%</div>
                            </div>
                                <div class="stat-row str-based">
                                    <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 减伤值</div>
                                    <div class="stat-row-value">${playerStats.physicalReduction}</div>
                            </div>
                                
                                <div class="stat-row agi-based">
                                    <div class="stat-row-label"><i class="fas fa-shoe-prints"></i> 闪避率</div>
                                    <div class="stat-row-value">${(playerStats.evasionRate * 100).toFixed(2)}%</div>
                                </div>
                                <div class="stat-row agi-based">
                                    <div class="stat-row-label"><i class="fas fa-crosshairs"></i> 额外命中</div>
                                    <div class="stat-row-value">+${(playerStats.extraHitRate * 100).toFixed(1)}%</div>
                                </div>
                                <div class="stat-row agi-based">
                                    <div class="stat-row-label"><i class="fas fa-running"></i> 速度</div>
                                    <div class="stat-row-value">${playerStats.speed}</div>
                                </div>
                                
                                <div class="stat-row int-based">
                                    <div class="stat-row-label"><i class="fas fa-star"></i> 额外暴击</div>
                                    <div class="stat-row-value">+${(playerStats.extraCritRate * 100).toFixed(1)}%</div>
                                </div>
                                <div class="stat-row int-based">
                                    <div class="stat-row-label"><i class="fas fa-fire"></i> 暴击倍率</div>
                                    <div class="stat-row-value">${(playerStats.baseCritMultiplier * 100).toFixed(
                                      1,
                                    )}%</div>
                                </div>
                                
                                <div class="stat-row resistance">
                                    <div class="stat-row-label"><i class="fas fa-eye-slash"></i> 暴击率抵抗</div>
                                    <div class="stat-row-value">${(playerStats.critRateResistance * 100).toFixed(
                                      2,
                                    )}%</div>
                                </div>
                                <div class="stat-row resistance">
                                    <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 暴伤抵抗</div>
                                    <div class="stat-row-value">${(playerStats.critDamageResistance * 100).toFixed(
                                      2,
                                    )}%</div>
                                </div>
                                
                                <div class="stat-row vit-based">
                                    <div class="stat-row-label"><i class="fas fa-shield-virus"></i> 承伤率</div>
                                    <div class="stat-row-value">${(playerStats.damageTakenRate * 100).toFixed(1)}%</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="entity-buffs">
                        ${buffsHtml}
                    </div>
                    <div class="self-target-indicator">
                        <i class="fas fa-hand-pointer"></i>
                        <span>可选择</span>
                    </div>
                </div>
            `;
        
        if (battleState.teammates && battleState.teammates.length > 0) {
          battleState.teammates.forEach(teammate => {
            const teammateStats = getTeammateActualStats(teammate);
            
            const teammateBuffsHtml =
              teammate.buffs && teammate.buffs.length > 0
                ? teammate.buffs
                    .map(buff => {
                      const buffClass = buff.isPositive
                        ? 'positive'
                        : buff.type === 'healOverTime'
                        ? 'positive'
                        : 'negative';
                      const tooltipText =
                        generateBuffTooltip(buff) + (buff.type === 'endBoost' ? '（对队友无效）' : '');
                      return `
                            <div class="buff ${buffClass} status-effect">
                                <div class="buff-name">${buff.name}</div>
                                <div class="buff-duration">${buff.duration}回合</div>
                                <span class="effect-tooltip">${tooltipText}</span>
                            </div>`;
                    })
                    .join('')
                : '';
            
            const isTeammateTurn = battleState.currentTeammate && battleState.currentTeammate.id === teammate.id;
            
            const currentWeaponTemplate = battleState.currentWeapon?.codes
              ?.find(code => code.startsWith('WN:A'))
              ?.match(/WN:(A[1-5])/)?.[1];

            let canSelectTeammate = false;
            if (battleState.selfTargetMode) {
              if (currentWeaponTemplate === 'A4') {
                
                canSelectTeammate = isTeammateTurn;
              } else if (currentWeaponTemplate === 'A2' || currentWeaponTemplate === 'A3') {
                
                canSelectTeammate = true;
              } else if (battleState.currentWeapon?.isHealing) {
                
                canSelectTeammate = true;
              }
              
            }
            const teammateTargetClass = canSelectTeammate ? 'selectable' : '';
            const isCurrentTeammate = isTeammateTurn ? 'current-teammate' : '';
            
            html += `
                        <div class="combat-entity teammate ${teammateTargetClass} ${isCurrentTeammate}" data-teammate-id="${
              teammate.id
            }">
                            <div class="entity-header">
                                <div class="entity-name">${teammate.name}</div>
                            </div>
                            <div class="entity-stats">
                                <div class="hp-bar-container">
                                    <div class="hp-bar-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                                    <div class="hp-bar-combat">
                                        <div class="hp-fill-combat" style="width: ${
                                          (teammate.hp / teammate.maxHp) * 100
                                        }%"></div>
                                        <div class="hp-text-combat">${teammate.hp}/${teammate.maxHp} (+${
              teammateStats.hpRegen
            }/回合)</div>
                                    </div>
                                </div>
                                <div class="mp-bar-container">
                                    <div class="mp-bar-label"><i class="fas fa-flask" style="color: var(--mana-color);"></i></div>
                                    <div class="mp-bar-combat">
                                        <div class="mp-fill-combat" style="width: ${
                                          (teammate.mp / teammate.maxMp) * 100
                                        }%"></div>
                                        <div class="mp-text-combat">${teammate.mp}/${teammate.maxMp} (+${
              teammateStats.mpRegen
            })</div>
                                    </div>
                                </div>
                                <div class="ap-bar-container">
                                    <div class="ap-bar-label"><i class="fas fa-bolt" style="color: var(--primary-color);"></i></div>
                                    <div class="ap-bar-combat">
                                        <div class="ap-fill-combat" style="width: ${
                                          teammate.maxAp > 0 ? (teammate.ap / teammate.maxAp) * 100 : 0
                                        }%"></div>
                                        <div class="ap-text-combat">${teammate.ap || 0}/${
              teammate.maxAp || 0
            } 行动点</div>
                                    </div>
                                </div>
                                ${teammate.shield || teammate.tempShield ? `
                                <div class="shield-bar-container">
                                    <div class="shield-bar-label"><i class="fas fa-shield-alt" style="color: #06b6d4;"></i></div>
                                    <div class="shield-bar-combat">
                                        <div class="shield-text-combat">${
                                          teammate.shield && teammate.tempShield 
                                            ? `护盾 ${teammate.shield} | 临时 ${teammate.tempShield}` 
                                            : teammate.shield 
                                              ? `护盾 ${teammate.shield}` 
                                              : `临时 ${teammate.tempShield}`
                                        }</div>
                                    </div>
                                </div>
                                ` : ''}
                                <button class="stats-toggle-btn" data-toggle-stats="teammate-stats-${teammate.id}">
                                    <i class="fas fa-chart-bar"></i> 详细属性
                                    <span class="toggle-icon">▼</span>
                                </button>
                                <div class="stats-collapsible" id="teammate-stats-${teammate.id}">
                                    
                                    <div class="stats-compact">
                                        
                                        <div class="stat-category">
                                            <div class="category-title" style="font-size: 9px; margin-bottom: 3px;">
                                                STR:${teammateStats.str} AGI:${teammateStats.agi} INT:${
              teammateStats.int
            } VIT:${teammateStats.end}
                                            </div>
                                        </div>
                                        
                                        <div class="stat-row str-based">
                                            <div class="stat-row-label"><i class="fas fa-hand-fist"></i> 伤害加成</div>
                                            <div class="stat-row-value">+${(teammateStats.damageBonus * 100).toFixed(
                                              1,
                                            )}%</div>
                                        </div>
                                        <div class="stat-row str-based">
                                            <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 减伤值</div>
                                            <div class="stat-row-value">${teammateStats.physicalReduction}</div>
                                        </div>
                                        
                                        <div class="stat-row agi-based">
                                            <div class="stat-row-label"><i class="fas fa-shoe-prints"></i> 闪避率</div>
                                            <div class="stat-row-value">${(teammateStats.evasionRate * 100).toFixed(
                                              2,
                                            )}%</div>
                                        </div>
                                        <div class="stat-row agi-based">
                                            <div class="stat-row-label"><i class="fas fa-crosshairs"></i> 额外命中</div>
                                            <div class="stat-row-value">+${(teammateStats.extraHitRate * 100).toFixed(
                                              1,
                                            )}%</div>
                                        </div>
                                        <div class="stat-row agi-based">
                                            <div class="stat-row-label"><i class="fas fa-running"></i> 速度</div>
                                            <div class="stat-row-value">${teammateStats.speed}</div>
                                        </div>
                                        
                                        <div class="stat-row int-based">
                                            <div class="stat-row-label"><i class="fas fa-star"></i> 额外暴击</div>
                                            <div class="stat-row-value">+${(teammateStats.extraCritRate * 100).toFixed(
                                              1,
                                            )}%</div>
                                        </div>
                                        <div class="stat-row int-based">
                                            <div class="stat-row-label"><i class="fas fa-fire"></i> 暴击倍率</div>
                                            <div class="stat-row-value">${(
                                              teammateStats.baseCritMultiplier * 100
                                            ).toFixed(1)}%</div>
                                        </div>
                                        
                                        <div class="stat-row resistance">
                                            <div class="stat-row-label"><i class="fas fa-eye-slash"></i> 暴击率抵抗</div>
                                            <div class="stat-row-value">${(
                                              teammateStats.critRateResistance * 100
                                            ).toFixed(2)}%</div>
                                        </div>
                                        <div class="stat-row resistance">
                                            <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 暴伤抵抗</div>
                                            <div class="stat-row-value">${(
                                              teammateStats.critDamageResistance * 100
                                            ).toFixed(2)}%</div>
                                        </div>
                                        
                                        <div class="stat-row vit-based">
                                            <div class="stat-row-label"><i class="fas fa-shield-virus"></i> 承伤率</div>
                                            <div class="stat-row-value">${(teammateStats.damageTakenRate * 100).toFixed(
                                              1,
                                            )}%</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="entity-buffs">
                                ${teammateBuffsHtml}
                            </div>
                            <div class="self-target-indicator">
                                <i class="fas fa-hand-pointer"></i>
                                <span>可选择</span>
                            </div>
                        </div>
                    `;
          });
        }
        
        domRoot.getElementById('combat-player-panel').innerHTML = html;
        
        domRoot.querySelector('.combat-entity.player').addEventListener('click', function () {
          
          const weaponTemplate = battleState.currentWeapon?.codes
            ?.find(code => code.startsWith('WN:A'))
            ?.match(/WN:(A[1-5])/)?.[1];
          if (weaponTemplate === 'A4') {
            return; 
          }
          
          if (battleState.selfTargetMode) {
            
            const playerId = 'player';
            const index = battleState.selectedHealTargets.findIndex(t => t.id === playerId);
            if (index === -1) {
              
              if (battleState.selectedHealTargets.length < (battleState.currentWeapon?.targetsPerAttack || 1)) {
                battleState.selectedHealTargets.push({ id: playerId, type: 'player', entity: battleState.player });
                this.classList.add('selected');
                
                if (!battleState.healTarget) {
                  battleState.healTarget = 'player';
                }
              }
            } else {
              
              battleState.selectedHealTargets.splice(index, 1);
              this.classList.remove('selected');
              
              if (battleState.healTarget === 'player') {
                battleState.healTarget =
                  battleState.selectedHealTargets.length > 0 ? battleState.selectedHealTargets[0].id : null;
              }
            }
            
            battleState.selectedEnemies = [];
            domRoot.querySelectorAll('.combat-entity.enemy').forEach(el => {
              el.classList.remove('selected');
            });
            
            updateAttackButton();
          }
        });
        
        domRoot.querySelectorAll('.combat-entity.teammate').forEach(teammateElement => {
          teammateElement.addEventListener('click', function () {
            const teammateId = parseInt(this.getAttribute('data-teammate-id')); 
            const teammate = battleState.teammates.find(t => t.id === teammateId);
            
            const weaponTemplate = battleState.currentWeapon?.codes
              ?.find(code => code.startsWith('WN:A'))
              ?.match(/WN:(A[1-5])/)?.[1];
            
            if (weaponTemplate === 'A4') {
              return;
            }
            if (
              battleState.selfTargetMode &&
              battleState.currentWeapon &&
              (weaponTemplate === 'A2' || weaponTemplate === 'A3' || battleState.currentWeapon.isHealing)
            ) {

              const index = battleState.selectedHealTargets.findIndex(t => t.id === teammateId);
              if (index === -1) {
                
                if (battleState.selectedHealTargets.length < (battleState.currentWeapon?.targetsPerAttack || 1)) {
                  battleState.selectedHealTargets.push({ id: teammateId, type: 'teammate', entity: teammate });
                  this.classList.add('selected');
                  
                  if (!battleState.healTarget) {
                    battleState.healTarget = teammateId;
                  }
                }
              } else {
                
                battleState.selectedHealTargets.splice(index, 1);
                this.classList.remove('selected');
                
                if (battleState.healTarget === teammateId) {
                  battleState.healTarget =
                    battleState.selectedHealTargets.length > 0 ? battleState.selectedHealTargets[0].id : null;
                }
              }
              
              battleState.selectedEnemies = [];
              domRoot.querySelectorAll('.combat-entity.enemy').forEach(el => {
                el.classList.remove('selected');
              });
              
              updateAttackButton();
            } else {

            }
          });
        });
      }
      
      function updateEnemyPanel() {
        
        if (!lazyRenderManager.shouldRenderCombat()) {
          return;
        }
        domRoot.getElementById('combat-enemy-panel').innerHTML = battleState.enemies
          .map((enemy, index) => {
            
            const actualStats = getEnemyActualStats(enemy);
            const buffsHtml =
              enemy.buffs && enemy.buffs.length > 0
                ? enemy.buffs
                    .map(buff => {
                      
                      let buffClass = buff.isPositive ? 'positive' : 'negative';
                      
                      if (buff.type === 'freeze') buffClass = 'ice';
                      else if (buff.type === 'hitRateDown') buffClass = 'lightning';
                      else if (buff.type === 'burnOverTime') buffClass = 'fire';
                      
                      const tooltipText = generateBuffTooltip(buff);
                      return `
                    <div class="buff ${buffClass} status-effect">
                        <div class="buff-name">${buff.name}</div>
                        <div class="buff-duration">${buff.duration}回合</div>
                        <span class="effect-tooltip">${tooltipText}</span>
                    </div>`;
                    })
                    .join('')
                : '';
            
            const freezeHtml =
              enemy.pendingFreeze && enemy.pendingFreezeCount > 0
                ? `
                <div class="buff ice status-effect">
                    <div class="buff-name">晕眩</div>
                    <div class="buff-duration">${enemy.pendingFreezeCount}回合</div>
                    <span class="effect-tooltip">无法行动</span>
                </div>`
                : '';
            
            const marksHtml = enemy.marks
              ? Object.keys(enemy.marks)
                  .map(markType => {
                    let markName = '';
                    let markValue = enemy.marks[markType];
                    let markTooltip = '';
                    switch (markType) {
                      case 'vulnerability':
                        markName = '易伤';
                        markTooltip = `下次攻击+${markValue}%伤害`;
                        break;
                      case 'weakness':
                        markName = '破绽';
                        markTooltip = `下次攻击暴击率+${markValue}%`;
                        break;
                      case 'death':
                        markName = '死点';
                        markTooltip = `下次攻击暴击伤害+${markValue}%`;
                        break;
                    }
                    return `
                <div class="buff negative status-effect">
                    <div class="buff-name">${markName}</div>
                    <div class="buff-duration">标记</div>
                    <span class="effect-tooltip">${markTooltip}</span>
                </div>`;
                  })
                  .join('')
              : '';
            
            const stacksHtml = enemy.stacks
              ? Object.keys(enemy.stacks)
                  .map(stackType => {
                    let stackName = '';
                    let stackData = enemy.stacks[stackType];
                    let stackCount = typeof stackData === 'object' ? stackData.count : stackData; 
                    let stackTooltip = '';
                    let stackDisplay = '';
                    
                    switch (stackType) {
                      case 'trauma':
                        stackName = '创伤';
                        const damagePerStack = typeof stackData === 'object' ? stackData.damagePerStack : 3;
                        const totalTraumaDamage = stackCount * damagePerStack;
                        stackDisplay = `${stackCount}层 (${totalTraumaDamage}点/回合)`;
                        stackTooltip = `${stackCount}层，每层-${damagePerStack}HP/回合，总计-${totalTraumaDamage}HP/回合`;
                        break;
                      case 'corrosion':
                        stackName = '腐蚀';
                        const bonusPerStack = typeof stackData === 'object' ? stackData.bonusPerStack : 5;
                        const totalBonus = stackCount * bonusPerStack;
                        stackDisplay = `${stackCount}层 (+${totalBonus}%)`;
                        stackTooltip = `${stackCount}层，每层+${bonusPerStack}%受伤，总计+${totalBonus}%受伤`;
                        break;
                    }
                    return `
                <div class="buff negative status-effect">
                    <div class="buff-name">${stackName}</div>
                    <div class="buff-duration">${stackDisplay}</div>
                    <span class="effect-tooltip">${stackTooltip}</span>
                </div>`;
                  })
                  .join('')
              : '';
            
            const allEffectsHtml = buffsHtml + freezeHtml + marksHtml + stacksHtml;
            const nextSkill = enemy.skills.find(skill => skill.name === enemy.attackPattern[enemy.nextAttackIndex]);
            
            const enemyHateList = hateSystem.enemyHateLists[enemy.id] || [];
            const hateListHtml =
              enemyHateList.length > 0
                ? enemyHateList
                    .map(
                      (hate, index) => `
                  <div class="hate-item ${index === 0 ? 'current-target' : ''}">
                    <span class="hate-target-name">${hate.targetName}</span>
                    <span class="hate-value">${hate.hateValue}</span>
                  </div>
                `,
                    )
                    .join('')
                : '<div class="hate-item no-target">无仇恨目标</div>';
            return `
                    <div class="combat-entity enemy" data-enemy-id="${enemy.id}">
                        <div class="entity-header">
                            <div class="entity-name">${enemy.name}</div>
                        </div>
                        <div class="entity-stats">
                            <div class="hp-bar-container">
                                <div class="hp-bar-label"><i class="fas fa-heart" style="color: var(--health-color);"></i></div>
                                <div class="hp-bar-combat">
                                    <div class="hp-fill-combat" style="width: ${(enemy.hp / enemy.maxHp) * 100}%"></div>
                                    <div class="hp-text-combat">${enemy.hp}/${enemy.maxHp}</div>
                                </div>
                            </div>
                            <button class="stats-toggle-btn" data-toggle-stats="enemy-stats-${enemy.id}">
                                <i class="fas fa-chart-bar"></i> 详细属性
                                <span class="toggle-icon">▼</span>
                            </button>
                            <div class="stats-collapsible" id="enemy-stats-${enemy.id}">
                            <div class="stats-compact">
                                    
                                    <div class="stat-category">
                                        <div class="category-title" style="font-size: 9px; margin-bottom: 3px;">
                                            STR:${actualStats.str || 0} AGI:${actualStats.agi || 0} INT:${actualStats.int || 0} VIT:${
              actualStats.vit || 0
            }
                                        </div>
                                    </div>
                                    
                                    <div class="stat-row str-based">
                                        <div class="stat-row-label"><i class="fas fa-hand-fist"></i> 伤害加成</div>
                                        <div class="stat-row-value">+${(actualStats.damageBonus * 100).toFixed(1)}%</div>
                                    </div>
                                    <div class="stat-row str-based">
                                        <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 减伤值</div>
                                        <div class="stat-row-value">${actualStats.physicalReduction}</div>
                                    </div>
                                    
                                    <div class="stat-row agi-based">
                                        <div class="stat-row-label"><i class="fas fa-shoe-prints"></i> 闪避率</div>
                                        <div class="stat-row-value">${(actualStats.evasionRate * 100).toFixed(2)}%</div>
                                    </div>
                                    <div class="stat-row agi-based">
                                        <div class="stat-row-label"><i class="fas fa-crosshairs"></i> 额外命中</div>
                                        <div class="stat-row-value">+${(actualStats.extraHitRate * 100).toFixed(1)}%</div>
                                    </div>
                                    <div class="stat-row agi-based">
                                        <div class="stat-row-label"><i class="fas fa-running"></i> 速度</div>
                                        <div class="stat-row-value">${actualStats.speed}</div>
                                    </div>
                                    
                                    <div class="stat-row int-based">
                                        <div class="stat-row-label"><i class="fas fa-star"></i> 额外暴击</div>
                                        <div class="stat-row-value">+${(actualStats.extraCritRate * 100).toFixed(1)}%</div>
                                    </div>
                                    <div class="stat-row int-based">
                                        <div class="stat-row-label"><i class="fas fa-fire"></i> 暴击倍率</div>
                                        <div class="stat-row-value">${(actualStats.baseCritMultiplier * 100).toFixed(
                                          1,
                                        )}%</div>
                                    </div>
                                    
                                    <div class="stat-row resistance">
                                        <div class="stat-row-label"><i class="fas fa-eye-slash"></i> 暴击率抵抗</div>
                                        <div class="stat-row-value">${(actualStats.critRateResistance * 100).toFixed(
                                          2,
                                        )}%</div>
                                    </div>
                                    <div class="stat-row resistance">
                                        <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 暴伤抵抗</div>
                                        <div class="stat-row-value">${(actualStats.critDamageResistance * 100).toFixed(
                                          2,
                                        )}%</div>
                                    </div>
                                    
                                    <div class="stat-row vit-based">
                                        <div class="stat-row-label"><i class="fas fa-shield-virus"></i> 承伤率</div>
                                        <div class="stat-row-value">${(actualStats.damageTakenRate * 100).toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="entity-next-attack status-effect">
                            <div class="next-attack-title"><i class="fas fa-bolt"></i> 下次使用:</div>
                            <div class="next-attack-name">${enemy.attackPattern[enemy.nextAttackIndex]}${
              nextSkill && nextSkill.codes && nextSkill.codes.length > 0
                ? nextSkill.codes
                    .map(code => {
                      const match = code.match(/MN:(M\d+)/);
                      return match
                        ? ` <span style="color: #ff6b6b; font-weight: bold; font-size: 11px;">[${match[1]}]</span>`
                        : '';
                    })
                    .join('')
                : ''
            }</div>
                            ${
                              nextSkill
                                ? `
                                <div class="skill-stats-grid">
                                    <div class="skill-stat-item skill-attack" title="技能攻击力">
                                        <i class="fas fa-fist-raised"></i>
                                    <span>攻击: ${nextSkill.attack}</span>
                                    </div>
                                    <div class="skill-stat-item skill-accuracy" title="命中率">
                                        <i class="fas fa-crosshairs"></i>
                                    <span>命中: ${getEffectiveHitRate(nextSkill.hitRate, enemy)}%</span>
                                    </div>
                                    <div class="skill-stat-item skill-targets" title="目标数量">
                                        <i class="fas fa-users"></i>
                                        <span>目标: ${nextSkill.targetsPerAttack || 1}个</span>
                                    </div>
                                    <div class="skill-stat-item skill-times" title="攻击次数">
                                        <i class="fas fa-redo"></i>
                                        <span>次数: ${nextSkill.attacksPerTurn || 1}次</span>
                                    </div>
                                    ${
                                      nextSkill.codes && nextSkill.codes.length > 0
                                        ? `
                                    <div class="skill-stat-item skill-effects" style="grid-column: 1 / -1; color: #ff6b6b;">
                                        <i class="fas fa-fire-alt"></i>
                                        <span>特效: ${nextSkill.codes
                                          .map(code => {
                                            const match = code.match(/MN:(M\d+),(.+)/);
                                            if (match && monsterEffects[match[1]]) {
                                              const params = match[2].split(',');
                                              return monsterEffects[match[1]](...params);
                                            }
                                            return code;
                                          })
                                          .join(' | ')}</span>
                                    </div>
                                    `
                                        : ''
                                    }
                                </div>
                            `
                                : ''
                            }
                            <span class="effect-tooltip">下回合技能${
              nextSkill && nextSkill.codes && nextSkill.codes.length > 0
                ? ' | 特效: ' +
                  nextSkill.codes
                    .map(code => {
                      const match = code.match(/MN:(M\d+),(.+)/);
                      if (match && monsterEffects[match[1]]) {
                        const params = match[2].split(',');
                        return monsterEffects[match[1]](...params);
                      }
                      return code;
                    })
                    .join(' | ')
                : ''
            }</span>
                        </div>
                        <div class="entity-hate-list">
                            <div class="hate-list-title"><i class="fas fa-crosshairs"></i> 仇恨列表</div>
                            <div class="hate-list-content">
                                ${hateListHtml}
                            </div>
                        </div>
                        <div class="entity-buffs">
                            ${allEffectsHtml}
                        </div>
                    </div>
                `;
          })
          .join('');
        
        domRoot.querySelectorAll('.combat-entity.enemy').forEach(enemyElement => {
          enemyElement.addEventListener('click', function () {
            const enemyId = parseInt(this.getAttribute('data-enemy-id'));
            
            if (battleState.selfTargetMode && battleState.healTarget === 'player') {
              return;
            }
            
            domRoot.querySelector('.combat-entity.player')?.classList.remove('selected');
            battleState.healTarget = null;
            
            if (battleState.currentWeapon && !battleState.currentWeapon.used) {
              
              const weaponTemplate = battleState.currentWeapon.codes
                ?.find(code => code.startsWith('WN:A'))
                ?.match(/WN:(A[1-4])/)?.[1];
              if (weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4') {
                return; 
              }
              
              if (battleState.currentWeapon.targetsPerAttack > 1) {
                const index = battleState.selectedEnemies.indexOf(enemyId);
                if (index === -1) {
                  if (battleState.selectedEnemies.length < battleState.currentWeapon.targetsPerAttack) {
                    battleState.selectedEnemies.push(enemyId);
                    this.classList.add('selected');
                  }
                } else {
                  battleState.selectedEnemies.splice(index, 1);
                  this.classList.remove('selected');
                }
              } else {
                
                domRoot.querySelectorAll('.combat-entity.enemy').forEach(el => {
                  el.classList.remove('selected');
                });
                battleState.selectedEnemies = [enemyId];
                this.classList.add('selected');
              }
              updateAttackButton();
              
              const nextRoundBtn = domRoot.getElementById('next-round-btn');
              if (nextRoundBtn) {
                const currentAction = battleState.actionOrder[battleState.currentActionIndex];
                if (currentAction && (currentAction.type === 'player' || currentAction.type === 'teammate')) {
                  const isLastAction = battleState.currentActionIndex >= battleState.actionOrder.length - 1;
                  if (isLastAction) {
                    nextRoundBtn.innerHTML = "<i class='fas fa-forward'></i> 结束回合";
                  } else {
                    nextRoundBtn.innerHTML = "<i class='fas fa-forward'></i> 跳过当前行动";
                  }
                  nextRoundBtn.disabled = false;
                }
              }
            }
          });
        });
      }
      
      function updateDetailedStatsPanel(targetType = 'current', targetId = null) {
        
        let currentStats;
        let characterName = '';
        let entityType = targetType;
        let selectedId = targetId;

        if (targetId !== null && targetId !== 'player' && targetId !== undefined) {
          targetId = parseInt(targetId, 10);
          selectedId = targetId;
        }

        if (targetType === 'current') {
          if (battleState.currentTeammate) {
            currentStats = getTeammateActualStats(battleState.currentTeammate);
            characterName = battleState.currentTeammate.name || '队友';
            entityType = 'teammate';
            selectedId = battleState.currentTeammate.id;
          } else {
            currentStats = getPlayerActualStats();
            characterName = battleState.player.name || 'User';
            entityType = 'player';
            selectedId = 'player';
          }
        } else if (targetType === 'player') {
          
          currentStats = getPlayerActualStats();
          characterName = battleState.player.name || 'User';
          selectedId = 'player';
        } else if (targetType === 'teammate' && targetId !== null) {
          
          const teammate = battleState.teammates.find(t => t.id === targetId);
          if (teammate) {
            currentStats = getTeammateActualStats(teammate);
            characterName = teammate.name || '队友';
            selectedId = teammate.id;
          }
        } else if (targetType === 'enemy' && targetId !== null) {
          
          const enemy = battleState.enemies.find(e => e.id === targetId);
          if (enemy) {
            currentStats = enemy;
            characterName = enemy.name || '敌人';
            selectedId = enemy.id;
          }
        }
        
        if (!currentStats) return;

        let characterSelector = '<div class="character-selector">';

        const isPlayerActive = entityType === 'player';
        characterSelector += '<button class="char-select-btn ' + (isPlayerActive ? 'active' : '') + '" ' +
          'data-type="player">' +
          '<i class="fas fa-user"></i> ' + (battleState.player.name || 'User') +
        '</button>';

        if (battleState.teammates && battleState.teammates.length > 0) {
          battleState.teammates.forEach(function(teammate) {
            const isActive = entityType === 'teammate' && selectedId === teammate.id;
            const teammateId = teammate.id;
            const teammateName = teammate.name;
            characterSelector += '<button class="char-select-btn ' + (isActive ? 'active' : '') + '" ' +
              'data-type="teammate" data-id="' + teammateId + '">' +
              '<i class="fas fa-user-friends"></i> ' + teammateName +
            '</button>';
          });
        }

        if (battleState.enemies && battleState.enemies.length > 0) {
          battleState.enemies.forEach(function(enemy) {
            const isActive = entityType === 'enemy' && selectedId === enemy.id;
            const enemyId = enemy.id;
            const enemyName = enemy.name;
            characterSelector += '<button class="char-select-btn enemy ' + (isActive ? 'active' : '') + '" ' +
              'data-type="enemy" data-id="' + enemyId + '">' +
              '<i class="fas fa-skull"></i> ' + enemyName +
            '</button>';
          });
        }
        
        characterSelector += '</div>';

        const statsHtml = `
          ${characterSelector}
          <div class="stats-compact">
            
            <div class="stat-category" style="margin-bottom: 10px;">
              <div class="category-title" style="font-size: 16px; font-weight: bold; color: var(--primary-light); text-align: center;">
                <i class="fas fa-user"></i> ${characterName} 的详细属性
              </div>
            </div>

            <div class="stat-category">
              <div class="category-title" style="font-size: 13px; margin-bottom: 5px; color: var(--accent-color);">
                <i class="fas fa-chart-line"></i> 基础属性
              </div>
              <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px;">
                <div class="stat-badge str-based">
                  <i class="fas fa-fist-raised"></i> 力量: ${currentStats.str || 0}
                </div>
                <div class="stat-badge agi-based">
                  <i class="fas fa-running"></i> 敏捷: ${currentStats.agi || 0}
                </div>
                <div class="stat-badge int-based">
                  <i class="fas fa-brain"></i> 智力: ${currentStats.int || 0}
                </div>
                <div class="stat-badge vit-based">
                  <i class="fas fa-shield-alt"></i> 耐力: ${currentStats.end || 0}
                </div>
              </div>
            </div>

            <div class="stat-category">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #ef4444;">
                <i class="fas fa-hand-fist"></i> 力量系
              </div>
            </div>
            <div class="stat-row str-based">
              <div class="stat-row-label"><i class="fas fa-hand-fist"></i> 伤害加成</div>
              <div class="stat-row-value">+${(currentStats.damageBonus * 100).toFixed(1)}%</div>
            </div>
            <div class="stat-row str-based">
              <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 减伤值</div>
              <div class="stat-row-value">${currentStats.physicalReduction}</div>
            </div>

            <div class="stat-category" style="margin-top: 8px;">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #10b981;">
                <i class="fas fa-running"></i> 敏捷系
              </div>
            </div>
            <div class="stat-row agi-based">
              <div class="stat-row-label"><i class="fas fa-shoe-prints"></i> 闪避率</div>
              <div class="stat-row-value">${(currentStats.evasionRate * 100).toFixed(2)}%</div>
            </div>
            <div class="stat-row agi-based">
              <div class="stat-row-label"><i class="fas fa-crosshairs"></i> 额外命中</div>
              <div class="stat-row-value">+${(currentStats.extraHitRate * 100).toFixed(1)}%</div>
            </div>
            <div class="stat-row agi-based">
              <div class="stat-row-label"><i class="fas fa-tachometer-alt"></i> 速度</div>
              <div class="stat-row-value">${currentStats.speed}</div>
            </div>

            <div class="stat-category" style="margin-top: 8px;">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #8b5cf6;">
                <i class="fas fa-brain"></i> 智力系
              </div>
            </div>
            <div class="stat-row int-based">
              <div class="stat-row-label"><i class="fas fa-star"></i> 额外暴击</div>
              <div class="stat-row-value">+${(currentStats.extraCritRate * 100).toFixed(1)}%</div>
            </div>
            <div class="stat-row int-based">
              <div class="stat-row-label"><i class="fas fa-fire"></i> 暴击倍率</div>
              <div class="stat-row-value">${(currentStats.baseCritMultiplier * 100).toFixed(1)}%</div>
            </div>

            <div class="stat-category" style="margin-top: 8px;">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #06b6d4;">
                <i class="fas fa-shield"></i> 抵抗属性
              </div>
            </div>
            <div class="stat-row resistance">
              <div class="stat-row-label"><i class="fas fa-eye-slash"></i> 暴击率抵抗</div>
              <div class="stat-row-value">${(currentStats.critRateResistance * 100).toFixed(2)}%</div>
            </div>
            <div class="stat-row resistance">
              <div class="stat-row-label"><i class="fas fa-shield-alt"></i> 暴伤抵抗</div>
              <div class="stat-row-value">${(currentStats.critDamageResistance * 100).toFixed(2)}%</div>
            </div>

            <div class="stat-category" style="margin-top: 8px;">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #f59e0b;">
                <i class="fas fa-shield-virus"></i> 耐力系
              </div>
            </div>
            <div class="stat-row vit-based">
              <div class="stat-row-label"><i class="fas fa-shield-virus"></i> 承伤率</div>
              <div class="stat-row-value">${(currentStats.damageTakenRate * 100).toFixed(1)}%</div>
            </div>
            
            ${entityType !== 'enemy' ? `
            
            <div class="stat-category" style="margin-top: 8px;">
              <div class="category-title" style="font-size: 12px; margin-bottom: 3px; color: #ec4899;">
                <i class="fas fa-heart"></i> 回复系
              </div>
            </div>
            <div class="stat-row recovery">
              <div class="stat-row-label"><i class="fas fa-heart"></i> 生命回复</div>
              <div class="stat-row-value">+${currentStats.hpRegen || 0}/回合</div>
            </div>
            <div class="stat-row recovery">
              <div class="stat-row-label"><i class="fas fa-flask"></i> 法力回复</div>
              <div class="stat-row-value">+${currentStats.mpRegen || 0}/回合</div>
            </div>
            ` : ''}
          </div>
        `;

        const detailedStatsDisplay = domRoot.getElementById('detailed-stats-display');
        if (detailedStatsDisplay) {
          detailedStatsDisplay.innerHTML = statsHtml;

          const characterSelectorDiv = detailedStatsDisplay.querySelector('.character-selector');
          if (characterSelectorDiv) {
            characterSelectorDiv.addEventListener('click', function(e) {
              const button = e.target.closest('.char-select-btn');
              if (button) {
                const type = button.getAttribute('data-type');
                const id = button.getAttribute('data-id');
                if (type === 'player') {
                  updateDetailedStatsPanel('player', null);
                } else if (type && id) {
                  updateDetailedStatsPanel(type, parseInt(id, 10));
                }
              }
            });
          }
        }
      }
      function getEffectiveHitRate(baseHitRate, enemy) {
        let effectiveHitRate = baseHitRate;
        if (enemy.buffs) {
          enemy.buffs.forEach(buff => {
            if (buff.type === 'hitRateDown') {
              effectiveHitRate -= buff.value;
            }
          });
        }
        return Math.max(0, effectiveHitRate);
      }
      
      function updateAttackButton() {
        const attackBtn = domRoot.getElementById('attack-btn');
        if (attackBtn) {
          
          if (battleState.currentItem) {
            attackBtn.disabled = false;
            attackBtn.innerHTML = "<i class='fas fa-box-open'></i> 使用道具";
          }
          
          else if (battleState.currentWeapon) {
            const weaponTemplate = battleState.currentWeapon.codes
              ?.find(code => code.startsWith('WN:A'))
              ?.match(/WN:(A[1-4])/)?.[1];
            
            const hasHealTargets = (battleState.selectedHealTargets && battleState.selectedHealTargets.length > 0) || 
                                   battleState.healTarget === 'player' ||
                                   (battleState.healTarget && battleState.healTarget !== 'player');
            if (
              (weaponTemplate === 'A2' ||
                weaponTemplate === 'A3' ||
                weaponTemplate === 'A4' ||
                battleState.currentWeapon.isHealing) &&
              hasHealTargets
            ) {
              attackBtn.disabled = false;
              
              if (weaponTemplate === 'A2') {
                attackBtn.innerHTML = "<i class='fas fa-first-aid'></i> 生命恢复";
              } else if (weaponTemplate === 'A3') {
                attackBtn.innerHTML = "<i class='fas fa-magic'></i> 法力恢复";
              } else if (weaponTemplate === 'A4') {
                attackBtn.innerHTML = "<i class='fas fa-skull'></i> 牺牲增益";
              } else {
                attackBtn.innerHTML = "<i class='fas fa-first-aid'></i> 治疗目标";
              }
            }
            
            else {
              
              if (weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4') {
                attackBtn.disabled = true;
                attackBtn.innerHTML = "<i class='fas fa-ban'></i> 不能攻击敌人";
              } else {
                attackBtn.disabled =
                  battleState.selectedEnemies.length === 0 ||
                  battleState.selectedEnemies.length > (battleState.currentWeapon?.targetsPerAttack || 0);
                attackBtn.innerHTML = "<i class='fas fa-hand-fist'></i> 攻击选中目标";
              }
            }
          } else {
            attackBtn.disabled = true;
            attackBtn.innerHTML = "<i class='fas fa-hand-fist'></i> 选择武器或道具";
          }
        }
      }
      
      function updateWeaponsList() {
        
        if (!lazyRenderManager.shouldRenderCombat()) {
          return;
        }
        
        if (battleState.currentTeammate === null) {
          
          domRoot.getElementById('melee-panel').classList.add('active');
          domRoot.getElementById('items-panel').classList.remove('active');
          domRoot.getElementById('stats-panel').classList.remove('active');
          domRoot.getElementById('melee-toggle').classList.add('active');
          domRoot.getElementById('items-toggle').classList.remove('active');
          domRoot.getElementById('stats-toggle').classList.remove('active');
          
          domRoot.getElementById('melee-toggle').innerHTML = '<i class="fas fa-hand-fist"></i> 剑技';
        }
        
        const allWeapons = battleState.player.weapons || [];
        domRoot.getElementById('melee-weapon-list').innerHTML =
          allWeapons.length > 0
            ? allWeapons
                .map(weapon => {
                  let effectsHtml = '';
                  weapon.codes.forEach(code => {
                    const codeType = code.split(':')[0];
                    const codeValue = code.split(':')[1];
                    if (codeType === 'WN') {
                      const parts = codeValue.split(',');
                      const effectKey = parts[0];
                      
                      const tooltipText = TooltipGenerator.generateWeaponEffectTooltip(effectKey, parts);
                      if (tooltipText) {
                        effectsHtml += `<div class="weapon-effect-code status-effect">${effectKey}
                                        <span class="effect-tooltip">${tooltipText}</span>
                                    </div>`;
                      }
                    } else if (codeType === 'EN') {
                      const parts = codeValue.split(',');
                      const effectKey = parts[0];
                      
                      const tooltipText = TooltipGenerator.generateEnchantmentTooltip(effectKey, parts);
                      if (tooltipText) {
                        effectsHtml += `<div class="weapon-effect-code status-effect">${effectKey}
                                        <span class="effect-tooltip">${tooltipText}</span>
                                    </div>`;
                      }
                    }
                  });
                  
                  const isUsed = weapon.used || battleState.player.ap <= 0 || weapon.currentCooldown > 0;
                  const usedClass = isUsed ? 'used' : '';
                  const cooldownText = weapon.currentCooldown > 0 ? ` (冷却:${weapon.currentCooldown})` : '';
                  return `
                        <button class="weapon-button ${usedClass}" data-weapon-index="${battleState.player.weapons.indexOf(
                    weapon,
                  )}" ${isUsed ? 'disabled' : ''}>
                            <div class="weapon-button-name">${weapon.name}${cooldownText}</div>
                            <div class="weapon-button-stats">
                                <div>${weapon.isHealing ? '治疗: ' : '攻击: '}${weapon.attack}</div>
                                <div>命中: ${weapon.hitRate}%</div>
                                <div>暴击: ${weapon.critRate}%</div>
                                <div>次数: ${weapon.attacksPerTurn}</div>
                                <div>目标: ${weapon.targetsPerAttack}</div>
                                <div>MP: ${weapon.mpCost}</div>
                                <div>AP: 1</div>
                                <div>冷却: ${weapon.cooldown}回合</div>
                            </div>
                            <div class="weapon-effect-codes">
                                ${effectsHtml}
                            </div>
                        </button>
                    `;
                })
                .join('')
            : '<div style="text-align: center; padding: 10px;">没有可用的剑技</div>';
        
        const attackControls = domRoot.querySelector('.attack-controls');
        attackControls.innerHTML = `
                <button id="attack-btn" class="attack-button" disabled><i class="fas fa-hand-fist"></i> 攻击选中目标</button>
                <button id="next-round-btn" class="next-round-button"><i class="fas fa-arrow-right-to-bracket"></i> 跳过当前行动</button>
                <button id="mid-action-btn" class="mid-action-button"><i class="fas fa-pause"></i> 中途行动</button>
            `;
        
        EventManager.bindWeaponButtons(battleState.player.weapons);
        
        const attackBtn = domRoot.getElementById('attack-btn');
        if (attackBtn) {
          attackBtn.addEventListener('click', performPlayerAttack);
        }
        
        setupSkipButton();
      }
      
      function updateItemsList() {
        
        if (!lazyRenderManager.shouldRenderCombat()) {
          return;
        }
        const items = battleState.player.items || [];
        
        const itemsList = domRoot.getElementById('items-list');
        itemsList.innerHTML =
          items.length > 0
            ? items
                .map(item => {
                  
                  let effectText = '';
                  switch (item.type) {
                    case 1: 
                      effectText = `恢复 ${item.value} 点生命值`;
                      break;
                    case 2: 
                      effectText = `恢复 ${item.value} 点法力值`;
                      break;
                    case 3: 
                      effectText = `力量+${item.value}，持续${item.duration}回合`;
                      break;
                    case 4: 
                      effectText = `敏捷+${item.value}，持续${item.duration}回合`;
                      break;
                    case 5: 
                      effectText = `智力+${item.value}，持续${item.duration}回合`;
                      break;
                    case 6: 
                      effectText = `耐力+${item.value}，持续${item.duration}回合`;
                      break;
                    default:
                      effectText = '未知效果';
                  }
                  
                  const currentAction = battleState.actionOrder[battleState.currentActionIndex];
                  let isUsed = false; 
                  
                  isUsed = item.count <= 0 || battleState.currentItemUsed === true;
                  const usedClass = isUsed ? 'used' : '';
                  return `
                        <button class="item-button ${usedClass}" data-item-index="${battleState.player.items.indexOf(
                    item,
                  )}" ${isUsed ? 'disabled' : ''}>
                            <div class="item-button-name">
                                ${item.name}
                                <span class="item-button-count">x${item.count}</span>
                            </div>
                            <div class="item-button-effect">${effectText}</div>
                        </button>
                    `;
                })
                .join('')
            : '<div style="text-align: center; padding: 10px;">没有可用的道具</div>';
        
        EventManager.bindItemButtons(battleState.player.items);
      }
      
      function performAttack(isPlayer = true) {
        
        if (battleState.currentItem) {
          const user = isPlayer ? null : battleState.currentTeammate;
          useItem(battleState.currentItem, user);
          
          battleState.currentItemUsed = true;
          
          battleState.currentItem = null;
          
          setTimeout(
            () => {
              updatePlayerPanel();
              updateEnemyPanel();
              if (isPlayer) {
                updateItemsList();
              } else {
                
                updateTeammateWeaponsList();
                updateItemsList();
              }
            },
            isPlayer ? 1200 : 0,
          ); 
          
          setupSkipButton();
          
          return;
        }
        const attacker = isPlayer ? battleState.player : battleState.currentTeammate;
        const weapon = battleState.currentWeapon;
        if (!weapon || battleState.attackInProgress) {
          return;
        }
        
        if (isPlayer) {
          
          if (attacker.ap <= 0) {
            logBattleAction(`行动点不足，无法使用 ${weapon.name}！`);
            return;
          }
        } else {

          if (attacker.ap <= 0) {
            logBattleAction(`${attacker.name} 行动点不足，无法使用 ${weapon.name}！`);
            return;
          }
          const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-4])/)?.[1];
          
        }
        if (weapon.currentCooldown > 0) {
          logBattleAction(`${weapon.name} 还在冷却中，剩余 ${weapon.currentCooldown} 回合！`);
          return;
        }
        
        if (attacker.mp < weapon.mpCost) {
          logBattleAction(`MP不足，无法使用 ${weapon.name}！`);
          return;
        }
        
        const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
        
        if (weaponTemplate !== 'A5') {
          
          attacker.ap -= 1;
        }

        if (weapon.cooldown > 0) {
          weapon.currentCooldown = weapon.cooldown;
        }
        
        battleState.attackInProgress = true;
        
        const isHealingWeapon =
          weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4' || weapon.isHealing;
        if (isHealingWeapon) {
          
          if (isPlayer) {
            executeHealingSequence(weapon, weaponTemplate);
          } else {
            executeTeammateHealingSequence(attacker, weapon, weaponTemplate);
          }
          return;
        }
        
        if (weaponTemplate === 'A5') {
          if (isPlayer) {
            executeA5ContinuousAttack(weapon);
          } else {
            executeTeammateA5ContinuousAttack(attacker, weapon);
          }
          return;
        }
        
        if (isPlayer) {
          executeAttackSequence(weapon);
        } else {
          executeTeammateAttackSequence(attacker, weapon);
        }
      }
      
      function performPlayerAttack() {
        performAttack(true);
      }
      
      function performTeammateAttack() {
        performAttack(false);
      }
      
      function executeAttackSequence(weapon) {
        
        battleState.currentAttackCount = 0;
        
        function performNextAttack() {
          
          let actualAttacksPerTurn = weapon.attacksPerTurn;
          if (battleState.sacrificeBoostActive) {
            actualAttacksPerTurn += battleState.sacrificeBoostActive.attacksPerTurn;
          }
          
          if (battleState.player.mp < weapon.mpCost) {
            logBattleAction(`蓝量不足！无法继续攻击。已完成 ${battleState.currentAttackCount} 次攻击。`);
            
            weapon.used = true;
            
            battleState.currentWeapon = null;
            
            battleState.attackInProgress = false;
            
            updateBattleUI({ player: true, enemy: true, weapons: true });
            return;
          }
          
          if (
            StateValidator.shouldEndAttack(
              battleState.currentAttackCount,
              actualAttacksPerTurn,
              battleState.selectedEnemies.length > 0,
            )
          ) {
            
            weapon.used = true;
            
            battleState.currentWeapon = null;
            
            battleState.attackInProgress = false;
            
            updateBattleUI({ player: true, enemy: true, weapons: true });
            return;
          }
          
          battleState.currentAttackCount++;
          
          const attackNumber = battleState.currentAttackCount;
          
          if (actualAttacksPerTurn > 1) {
            logBattleAction(
              `${battleState.player.name || 'User'} 使用 ${weapon.name} 进行第 ${
                attackNumber + 1
              }/${actualAttacksPerTurn} 次攻击！`,
            );
          } else {
            logBattleAction(`${battleState.player.name || 'User'} 使用 ${weapon.name} 攻击！`);
          }
          
          const playerEntity = domRoot.querySelector('.combat-entity.player');
          playerEntity.classList.add('attack-animation-forward');
          
          setTimeout(() => {
            
            for (const enemyId of battleState.selectedEnemies) {
              const enemy = battleState.enemies.find(e => e.id === enemyId);
              if (enemy) {
                
                const playerStats = getPlayerActualStats();
                const enemyStats = getEnemyActualStats(enemy);
                
                const finalHitRate = calculateFinalHitRate(weapon.hitRate, playerStats, enemyStats);
                const hitRoll = Math.random();
                
                if (hitRoll <= Math.min(1.0, finalHitRate)) {
                  
                  logBattleAction(`攻击命中 ${enemy.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                  
                  const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemyId}"]`);
                  enemyElement.classList.add('shake-animation');
                  
                  let finalCritRate = calculateFinalCritRate(weapon.critRate, playerStats, enemyStats, finalHitRate);
                  
                  if (battleState.sacrificeBoostActive) {
                    finalCritRate += battleState.sacrificeBoostActive.critRate / 100;
                  }
                  
                  battleState.playerBuffs.forEach(buff => {
                    if (buff.type === 'critBoost') {
                      finalCritRate += buff.value / 100;
                    }
                  });
                  
                  if (enemy.marks && enemy.marks.weakness) {
                    finalCritRate += enemy.marks.weakness / 100;
                    logBattleAction(`破绽标记消耗！暴击率额外提升 ${enemy.marks.weakness}%！`);
                    delete enemy.marks.weakness;
                  }
                  
                  if (finalHitRate > 1.0) {
                    const overHitBonus = (finalHitRate - 1.0) * 0.5;
                    logBattleAction(
                      `超命中转换：命中率 ${(finalHitRate * 100).toFixed(1)}% → 暴击率额外 +${(
                        overHitBonus * 100
                      ).toFixed(1)}%`,
                    );
                  }
                  if (finalCritRate > 1.0) {
                    const overCritBonus = (finalCritRate - 1.0) * 0.5;
                    logBattleAction(
                      `超暴击转换：暴击率 ${(finalCritRate * 100).toFixed(1)}% → 暴击伤害额外 +${(
                        overCritBonus * 100
                      ).toFixed(1)}%`,
                    );
                  }
                  const critRoll = Math.random();
                  
                  const isCrit = critRoll <= finalCritRate;
                  
                  const finalCritMultiplier = isCrit
                    ? calculateFinalCritMultiplier(playerStats, enemyStats, finalCritRate)
                    : 1.0;
                  
                  let baseAttack = weapon.attack;
                  if (battleState.sacrificeBoostActive) {
                    baseAttack += battleState.sacrificeBoostActive.attack;
                    logBattleAction(`牺牲增益生效！攻击力增加 ${battleState.sacrificeBoostActive.attack}！`);
                  }
                  
                  let damage = calculateFinalDamage(baseAttack, playerStats, enemyStats, isCrit, finalCritMultiplier);
                  
                  if (enemy.marks) {
                    
                    if (enemy.marks.vulnerability) {
                      const bonusDamage = Math.floor(damage * (enemy.marks.vulnerability / 100));
                      damage += bonusDamage;
                      logBattleAction(`易伤标记消耗！额外造成 ${bonusDamage} 点伤害！`);
                      delete enemy.marks.vulnerability;
                    }
                    
                    if (enemy.marks.death && isCrit) {
                      const bonusCritDamage = Math.floor(damage * (enemy.marks.death / 100));
                      damage += bonusCritDamage;
                      logBattleAction(`死点标记消耗！暴击额外造成 ${bonusCritDamage} 点伤害！`);
                      delete enemy.marks.death;
                    }
                  }
                  
                  if (enemy.stacks && enemy.stacks.corrosion) {
                    
                    const corrosionData = enemy.stacks.corrosion;
                    const corrosionCount = typeof corrosionData === 'object' ? corrosionData.count : corrosionData; 
                    const bonusPerStack = typeof corrosionData === 'object' ? corrosionData.bonusPerStack : 5; 
                    
                    const totalCorrosionBonus = corrosionCount * bonusPerStack;
                    const bonusDamage = Math.floor(damage * (totalCorrosionBonus / 100));
                    damage += bonusDamage;
                    logBattleAction(`腐蚀效果！${corrosionCount} 层腐蚀（${bonusPerStack}%/层）造成额外 ${bonusDamage} 点伤害（+${totalCorrosionBonus}%）！`);
                  }
                  
                  const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-4])/)?.[1];
                  
                  if (weaponTemplate) {
                    switch (weaponTemplate) {
                      case 'A1':
                        
                        logBattleAction(
                          `使用${weapon.name}对${battleState.selectedEnemies
                            .map(id => battleState.enemies.find(e => e.id === id)?.name)
                            .join('、')}造成伤害！`,
                        );
                        break;
                      case 'A2':
                        
                        break;
                      case 'A3':
                        
                        break;
                      case 'A4':

                        logBattleAction(`使用${weapon.name}！牺牲自身换取强大增益！`);
                        break;
                    }
                  }
                  
                  if (isCrit) {
                    logBattleAction(
                      `暴击！造成 ${damage} 点伤害！(暴击率: ${(finalCritRate * 100).toFixed(
                        1,
                      )}%, 暴击倍率: ${finalCritMultiplier.toFixed(2)}x)`,
                    );
                    
                    showDamageNumber('enemy', damage, true, enemyId);
                    
                    if (weapon.codes.some(code => code.startsWith('EN:B4'))) {
                      const freezeMatch = weapon.codes.find(code => code.startsWith('EN:B4')).match(/EN:B4,(\d+)/);
                      const freezeDuration = freezeMatch ? parseInt(freezeMatch[1]) : 1;
                      
                      enemy.pendingFreeze = true;
                      enemy.pendingFreezeCount = freezeDuration;
                      logBattleAction(`冷狱特效触发！${enemy.name} 将在下次行动时被晕眩！`);
                    }
                    
                    if (weapon.codes.some(code => code.startsWith('EN:B3'))) {
                      const critBoostMatch = weapon.codes
                        .find(code => code.startsWith('EN:B3'))
                        .match(/EN:B3,(\d+),(\d+)%/);
                      if (critBoostMatch) {
                        const duration = parseInt(critBoostMatch[1]);
                        const boostAmount = parseInt(critBoostMatch[2]);
                        battleState.playerBuffs.push({
                          name: '乘胜加成',
                          type: 'critBoost',
                          value: boostAmount,
                          duration: duration,
                          isPositive: true,
                        });
                        logBattleAction(`乘胜特效触发！暴击率提升 ${boostAmount}% 持续 ${duration} 回合！`);
                      }
                    }
                  } else {
                    logBattleAction(`造成 ${damage} 点伤害！`);
                    showDamageNumber('enemy', damage, false, enemyId);
                  }
                  
                  const extraDamage = processEnchantmentEffects(weapon, enemy, damage, isCrit);
                  damage += extraDamage;
                  
                  if (enemy.buffs) {
                    const vulnerableBuff = enemy.buffs.find(buff => buff.type === 'vulnerable');
                    if (vulnerableBuff) {
                      const bonusDamage = Math.floor(damage * (vulnerableBuff.value / 100));
                      damage += bonusDamage;
                      logBattleAction(`${enemy.name} 处于易伤状态，额外受到 ${bonusDamage} 点伤害！`);
                    }
                  }
                  
                  if (damage > battleState.highestDamageWeapon.damage) {
                    battleState.highestDamageWeapon.name = weapon.name;
                    battleState.highestDamageWeapon.damage = damage;
                  }
                  
                  const oldHp = enemy.hp;
                  enemy.hp = Math.max(0, enemy.hp - damage);
                  
                  addDamageHate('player', battleState.player.name || 'User', enemyId, damage);
                  
                  addHpChangeAnimation('enemy', enemyId);
                  
                  if (StateValidator.checkEnemyDeath(enemy)) {
                    return; 
                  }
                  
                  setTimeout(() => {
                    if (enemyElement) {
                      enemyElement.classList.remove('shake-animation');
                    }
                  }, 800);
                } else {
                  
                  logBattleAction(`攻击未命中 ${enemy.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                }
              }
            }
            
            battleState.player.mp = Math.max(0, battleState.player.mp - weapon.mpCost);
            if (weapon.mpCost > 0) {
              logBattleAction(`消耗 ${weapon.mpCost} 点法力值。剩余法力值: ${battleState.player.mp}`);
            }
            
            playerEntity.classList.remove('attack-animation-forward');
            
            setTimeout(() => {
              updatePlayerPanel();
              updateEnemyPanel();
            }, 1500); 
            
            if (
              battleState.currentAttackCount < actualAttacksPerTurn &&
              battleState.selectedEnemies.length > 0 &&
              battleState.enemies.length > 0
            ) {
              
              setTimeout(performNextAttack, 800);
            } else {
              
              weapon.used = true;
              
              battleState.currentWeapon = null;
              
              battleState.attackInProgress = false;
              
              updateWeaponsList();
              enablePlayerControls();

              updatePlayerPanel();
              updateWeaponsList();
              enablePlayerControls();
            }
          }, 500); 
        }
        
        performNextAttack();
      }
      
      function performHealing(weapon, targetType, targetEntity = null) {
        const targetName =
          targetType === 'player'
            ? battleState.player.name || 'User'
            : targetType === 'teammate'
            ? targetEntity.name
            : targetType === 'enemy'
            ? targetEntity.name
            : 'Unknown';
        logBattleAction(`${battleState.player.name || 'User'} 使用 ${weapon.name} 治疗 ${targetName}！`);
        
        let healAmount = weapon.attack;
        
        const critRoll = Math.random() * 100;
        const isCrit = critRoll <= weapon.critRate;
        if (isCrit) {
          
          const playerStats = getPlayerActualStats();
          const critMultiplier = playerStats.baseCritMultiplier;
          healAmount = Math.floor(healAmount * critMultiplier);
          logBattleAction(`暴击治疗！恢复 ${healAmount} 点生命值！`);
        } else {
          logBattleAction(`恢复 ${healAmount} 点生命值！`);
        }
        
        if (targetType === 'player') {
          const oldHp = battleState.player.hp;
          battleState.player.hp = Math.min(battleState.player.hp + healAmount, battleState.player.maxHp);
          const actualHeal = battleState.player.hp - oldHp;
          
          showHealNumber(actualHeal);
          
          const playerHpBar = domRoot.querySelector('.combat-entity.player .hp-fill-combat');
          playerHpBar.classList.add('hp-change-animation');
          setTimeout(() => {
            playerHpBar.classList.remove('hp-change-animation');
          }, 800);
          
          const playerEntity = domRoot.querySelector('.combat-entity.player');
          playerEntity.classList.add('heal-pulse-animation');
          setTimeout(() => {
            playerEntity.classList.remove('heal-pulse-animation');
          }, 800);
        } else if (targetType === 'teammate' && targetEntity) {
          const oldHp = targetEntity.hp;
          targetEntity.hp = Math.min(targetEntity.hp + healAmount, targetEntity.maxHp);
          const actualHeal = targetEntity.hp - oldHp;
          
          logBattleAction(`实际恢复了 ${actualHeal} 点生命值！`);
          
          const teammateHpBar = domRoot.querySelector(
            `.combat-entity.teammate[data-teammate-id="${targetEntity.id}"] .hp-fill-combat`,
          );
          if (teammateHpBar) {
            
            const teammateElement = teammateHpBar.closest('.combat-entity.teammate');
            const teammateId = teammateElement ? parseInt(teammateElement.getAttribute('data-teammate-id')) : null;
            if (teammateId !== null && !isNaN(teammateId)) {
              addHpChangeAnimation('teammate', teammateId);
            }
          }
          
          const teammateElement = domRoot.querySelector(
            `.combat-entity.teammate[data-teammate-id="${targetEntity.id}"]`,
          );
          if (teammateElement) {
            teammateElement.classList.add('heal-pulse-animation');
            setTimeout(() => {
              teammateElement.classList.remove('heal-pulse-animation');
            }, 800);
          }
        } else if (targetType === 'enemy' && targetEntity) {
          const oldHp = targetEntity.hp;
          targetEntity.hp = Math.min(targetEntity.hp + healAmount, targetEntity.maxHp);
          const actualHeal = targetEntity.hp - oldHp;
          
          showHealNumberOnEnemy(actualHeal, targetEntity.id);
          
          const enemyHpBar = domRoot.querySelector(
            `.combat-entity.enemy[data-enemy-id="${targetEntity.id}"] .hp-fill-combat`,
          );
          if (enemyHpBar) {
            
            const enemyElement = enemyHpBar.closest('.combat-entity.enemy');
            const enemyId = enemyElement ? parseInt(enemyElement.getAttribute('data-enemy-id')) : null;
            if (enemyId !== null && !isNaN(enemyId)) {
              addHpChangeAnimation('enemy', enemyId);
            }
          }
          
          const enemyEntity = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${targetEntity.id}"]`);
          if (enemyEntity) {
            enemyEntity.classList.add('heal-pulse-animation');
            setTimeout(() => {
              enemyEntity.classList.remove('heal-pulse-animation');
            }, 800);
          }
        }
        
        addHealHate('player', battleState.player.name || 'User', healAmount);
        
        setTimeout(() => {
          updateBattleUI({ player: true, enemy: true, weapons: true });
          updateHateDisplay(); 
          
          if (battleState.currentWeapon && battleState.currentWeapon.template === 'A2' && battleState.isPlayerTurn) {
            moveToNextAction();
          }
        }, 1200); 
      }
      
      function performManaRestore(weapon, targetType, targetTeammate = null) {
        const targetName =
          targetType === 'player'
            ? battleState.player.name || 'User'
            : targetType === 'teammate'
            ? targetTeammate.name
            : 'Unknown';
        logBattleAction(`${battleState.player.name || 'User'} 使用 ${weapon.name} 恢复 ${targetName} 的法力！`);
        
        let manaAmount = weapon.attack;
        
        const critRoll = Math.random() * 100;
        const isCrit = critRoll <= weapon.critRate;
        if (isCrit) {
          
          const playerStats = getPlayerActualStats();
          const critMultiplier = playerStats.baseCritMultiplier;
          manaAmount = Math.floor(manaAmount * critMultiplier);
          logBattleAction(`暴击恢复！恢复 ${manaAmount} 点法力值！`);
        } else {
          logBattleAction(`恢复 ${manaAmount} 点法力值！`);
        }
        
        if (targetType === 'player') {
          const oldMp = battleState.player.mp;
          battleState.player.mp = Math.min(battleState.player.mp + manaAmount, battleState.player.maxMp);
          const actualRestore = battleState.player.mp - oldMp;
          
          logBattleAction(`实际恢复了 ${actualRestore} 点法力值！`);
        } else if (targetType === 'teammate' && targetTeammate) {
          const oldMp = targetTeammate.mp;
          targetTeammate.mp = Math.min(targetTeammate.mp + manaAmount, targetTeammate.maxMp);
          const actualRestore = targetTeammate.mp - oldMp;
          
          logBattleAction(`实际恢复了 ${actualRestore} 点法力值！`);
        }
        
        setTimeout(() => {
          updateBattleUI({ player: true, enemy: true, weapons: true });
          updateHateDisplay(); 
          
          if (battleState.currentWeapon && battleState.currentWeapon.template === 'A3' && battleState.isPlayerTurn) {
            moveToNextAction();
          }
        }, 1200); 
      }
      
      function performSacrificeBoost(weapon, targetType) {
        const targetName = targetType === 'player' ? battleState.player.name || 'User' : 'Unknown';
        logBattleAction(`${battleState.player.name || 'User'} 使用 ${weapon.name} 进行牺牲增益！`);
        
        const sacrificeDamage = Math.floor(weapon.attack * 0.5); 
        
        battleState.player.hp = Math.max(1, battleState.player.hp - sacrificeDamage); 
        logBattleAction(`牺牲了 ${sacrificeDamage} 点生命值！`);
        
        if (!battleState.sacrificeBoostActive) {
          battleState.sacrificeBoostActive = {
            attack: weapon.attack,
            hitRate: weapon.hitRate,
            critRate: weapon.critRate,
            attacksPerTurn: weapon.attacksPerTurn,
            targetsPerAttack: weapon.targetsPerAttack,
            weaponName: weapon.name,
          };
          logBattleAction(`获得强大增益！本回合所有攻击都将获得 ${weapon.name} 的属性加成！`);
          logBattleAction(
            `增益效果：攻击+${weapon.attack}，命中+${weapon.hitRate}%，暴击+${weapon.critRate}%，次数+${weapon.attacksPerTurn}，目标+${weapon.targetsPerAttack}`,
          );
        }
        
        setTimeout(() => {
          updateBattleUI({ player: true, enemy: true, weapons: true });
          updateHateDisplay(); 
          
          if (battleState.currentWeapon && battleState.currentWeapon.template === 'A4' && battleState.isPlayerTurn) {
            moveToNextAction();
          }
        }, 1200); 
      }

      function executeA5ContinuousAttack(weapon) {
        // Delegate pure calculation to a5MultiHitCore (P4a Core extraction)
        const aliveEnemies = battleState.enemies.filter(e => e.hp > 0);
        if (aliveEnemies.length === 0) {
          logBattleAction(`【终结技】没有可攻击的目标！`);
          weapon.used = true;
          battleState.currentWeapon = null;
          battleState.attackInProgress = false;
          updateBattleUI({ player: true, enemy: true, weapons: true });
          moveToNextAction();
          return;
        }

        if (!battleState.selectedEnemies || battleState.selectedEnemies.length === 0) {
          battleState.selectedEnemies = aliveEnemies.map(e => e.id);
          logBattleAction(`【终结技】自动选择所有敌人作为目标！`);
        }

        battleState.currentAttackCount = 0;
        const playerStats = getPlayerActualStats();
        const logArr = [];

        // Core handles all damage/hit/crit/enchantment calculations
        const instructions = a5MultiHitCore(battleState.player, weapon, battleState.enemies, playerStats, logArr);
        logArr.forEach(msg => logBattleAction(msg));

        if (instructions.length === 0) {
          weapon.used = true;
          battleState.currentWeapon = null;
          battleState.selectedEnemies = [];
          battleState.attackInProgress = false;
          updateBattleUI({ player: true, enemy: true, weapons: true });
          updateHateDisplay();
          moveToNextAction();
          return;
        }

        // Play back instructions with animation timing
        let delay = 0;
        instructions.forEach((inst, index) => {
          setTimeout(() => {
            if (inst.type === 'damage') {
              const playerEntity = domRoot.querySelector('.combat-entity.player');
              if (playerEntity) playerEntity.classList.add('attack-animation-forward');
              const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${inst.targetId}"]`);
              if (enemyElement) enemyElement.classList.add('shake-animation');
              showDamageNumber(inst.damage, inst.targetId, inst.isCrit);
              battleState.currentAttackCount++;
              setTimeout(() => {
                if (playerEntity) playerEntity.classList.remove('attack-animation-forward');
                updateBattleUI({ player: true, enemy: true });
              }, 200);
            } else if (inst.type === 'enemyDeath') {
              StateValidator.checkEnemyDeath({ id: inst.targetId });
            }

            if (index === instructions.length - 1) {
              setTimeout(() => {
                weapon.used = true;
                battleState.currentWeapon = null;
                battleState.selectedEnemies = [];
                battleState.attackInProgress = false;
                updateBattleUI({ player: true, enemy: true, weapons: true });
                updateHateDisplay();
                moveToNextAction();
              }, 400);
            }
          }, delay);
          delay += 300;
        });
      }

      function executeTeammateA5ContinuousAttack(teammate, weapon) {
        
        const aliveEnemies = battleState.enemies.filter(e => e.hp > 0);
        if (aliveEnemies.length === 0) {
          logBattleAction(`【终结技】没有可攻击的目标！`);
          weapon.used = true;
          battleState.currentWeapon = null;
          battleState.attackInProgress = false;
          updateBattleUI({ player: true, enemy: true, weapons: true });
          moveToNextAction();
          return;
        }

        if (battleState.selectedEnemies && battleState.selectedEnemies.length > 0) {
          const aliveEnemyIds = aliveEnemies.map(e => e.id);
          battleState.selectedEnemies = battleState.selectedEnemies.filter(id => aliveEnemyIds.includes(id));
        }

        if (!battleState.selectedEnemies || battleState.selectedEnemies.length === 0) {
          battleState.selectedEnemies = aliveEnemies.map(e => e.id);
          logBattleAction(`【终结技】自动选择所有敌人作为目标！`);
        }
        
        logBattleAction(`【终结技】${teammate.name} 使用 ${weapon.name}！消耗所有AP持续攻击！`);

        battleState.currentAttackCount = 0;

        function performNextA5Attack() {
          
          if (teammate.ap <= 0) {
            logBattleAction(`AP耗尽！${weapon.name} 结束，共攻击 ${battleState.currentAttackCount} 次！`);
            weapon.used = true;
            battleState.currentWeapon = null;
            battleState.selectedEnemies = [];
            battleState.attackInProgress = false;
            updateBattleUI({ player: true, enemy: true, weapons: true });
            updateHateDisplay();
            moveToNextAction();
            return;
          }

          if (teammate.mp < weapon.mpCost) {
            logBattleAction(`MP不足！${weapon.name} 提前结束，共攻击 ${battleState.currentAttackCount} 次！`);
            weapon.used = true;
            battleState.currentWeapon = null;
            battleState.selectedEnemies = [];
            battleState.attackInProgress = false;
            updateBattleUI({ player: true, enemy: true, weapons: true });
            updateHateDisplay();
            moveToNextAction();
            return;
          }

          const aliveEnemyIds = battleState.enemies.filter(e => e.hp > 0).map(e => e.id);
          battleState.selectedEnemies = battleState.selectedEnemies.filter(id => aliveEnemyIds.includes(id));

          if (battleState.selectedEnemies.length === 0) {
            logBattleAction(`所有目标已被击败！${weapon.name} 结束，共攻击 ${battleState.currentAttackCount} 次！`);
            weapon.used = true;
            battleState.currentWeapon = null;
            battleState.selectedEnemies = [];
            battleState.attackInProgress = false;
            updateBattleUI({ player: true, enemy: true, weapons: true });
            updateHateDisplay();
            moveToNextAction();
            return;
          }

          const damageModifier = Math.max(0.5, 1 - battleState.currentAttackCount * 0.1);

          if (battleState.currentAttackCount === 0) {
            logBattleAction(`第 ${battleState.currentAttackCount + 1} 击（威力100%）`);
          } else {
            logBattleAction(`第 ${battleState.currentAttackCount + 1} 击（威力${(damageModifier * 100).toFixed(0)}%）`);
          }

          teammate.ap -= 1;
          teammate.mp -= weapon.mpCost;

          setTimeout(() => {
            
            for (const enemyId of battleState.selectedEnemies) {
              const enemy = battleState.enemies.find(e => e.id === enemyId && e.hp > 0);
              if (enemy) {
                
                const modifiedWeapon = { ...weapon, attack: Math.floor(weapon.attack * damageModifier) };
                
                const teammateStats = getTeammateActualStats(teammate);
                const enemyStats = getEnemyActualStats(enemy);
                const finalHitRate = calculateFinalHitRate(modifiedWeapon.hitRate, teammateStats, enemyStats);
                const hitRoll = Math.random();
                
                if (hitRoll <= Math.min(1.0, finalHitRate)) {
                  logBattleAction(`${teammate.name} 攻击命中 ${enemy.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                  const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
                  if (enemyElement) {
                    enemyElement.classList.add('shake-animation');
                  }
                  
                  let finalCritRate = calculateFinalCritRate(modifiedWeapon.critRate, teammateStats, enemyStats, finalHitRate);
                  const critRoll = Math.random();
                  const isCrit = critRoll <= finalCritRate;
                  const finalCritMultiplier = isCrit ? calculateFinalCritMultiplier(teammateStats, enemyStats, finalCritRate) : 1.0;
                  
                  let damage = calculateFinalDamage(modifiedWeapon.attack, teammateStats, enemyStats, isCrit, finalCritMultiplier);

                  const hasEnchantments = weapon.codes && weapon.codes.some(code => code.startsWith('EN:'));
                  if (hasEnchantments) {
                    const enchantmentTriggerRoll = Math.random();
                    const enchantmentTriggerChance = damageModifier * 100;
                    if (enchantmentTriggerRoll <= damageModifier) {
                      
                      const extraDamage = processEnchantmentEffects(weapon, enemy, damage, isCrit);
                      damage += extraDamage;
                      if (extraDamage > 0) {
                        logBattleAction(`【终结技特效】特效触发成功！(触发概率: ${enchantmentTriggerChance.toFixed(0)}%) 额外伤害+${extraDamage}`);
                      } else {
                        logBattleAction(`【终结技特效】特效触发成功！(触发概率: ${enchantmentTriggerChance.toFixed(0)}%) 无额外伤害效果`);
                      }
                    } else {
                      logBattleAction(`【终结技特效】特效未触发 (触发概率: ${enchantmentTriggerChance.toFixed(0)}%)`);
                    }
                  }
                  
                  enemy.hp = Math.max(0, enemy.hp - damage);
                  
                  if (isCrit) {
                    logBattleAction(`暴击！对 ${enemy.name} 造成 ${damage} 点伤害！(暴击率: ${(finalCritRate * 100).toFixed(1)}%, 暴击倍率: ${finalCritMultiplier.toFixed(2)}x)`);
                  } else {
                    logBattleAction(`对 ${enemy.name} 造成 ${damage} 点伤害！(暴击率: ${(finalCritRate * 100).toFixed(1)}%)`);
                  }
                  
                  showDamageNumber(damage, enemy.id, isCrit);
                  
                  if (enemy.hp <= 0) {
                    logBattleAction(`${enemy.name} 被击败了！`);
                    
                    StateValidator.checkEnemyDeath(enemy);
                  }
                } else {
                  logBattleAction(`${teammate.name} 攻击未命中 ${enemy.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                }
              }
            }

            updateBattleUI({ player: true, enemy: true });

            battleState.currentAttackCount++;

            setTimeout(performNextA5Attack, 1000);
          }, 200);
        }

        performNextA5Attack();
      }
// ponytail: two enchantment dispatchers kept — different Core delegation (player calls processEnchantmentEffectsCore,
// teammate doesn't) + different handler targets (battleState.player vs teammate). Merging saves ~60 lines but adds
// isTeammate branching in 15+ case arms. Safe refactor if both paths converge on Core.
function processEnchantmentEffects(weapon, enemy, damage, isCrit) {
  if (!weapon.codes) return 0;
  let totalExtraDamage = 0;
  const coreLog = [];
  totalExtraDamage += processEnchantmentEffectsCore(weapon, enemy, damage, isCrit, coreLog, battleState.player, battleState.playerBuffs);
  coreLog.forEach(msg => logBattleAction(msg));
  weapon.codes.forEach(code => {
    if (!code.startsWith('EN:B')) return;
    const match = code.match(/EN:(B\d+),(.+)/);
    if (!match) return;
    const effectType = match[1];
    const params = match[2].split(',');
    switch (effectType) {
      case 'B1': 
        handleLifeSteal(params, damage);
        break;
      case 'B2': 
        handleHitRateDebuff(params, enemy);
        break;
      case 'B3': 
        if (isCrit) handleCritBoost(params);
        break;
      case 'B4': 
        if (isCrit) handleFreeze(params, enemy);
        break;
      // B5 handled by Core
      case 'B6': 
        handleChanceFreeze(params, enemy);
        break;
      case 'B7': 
        totalExtraDamage += handleChanceExtraDamage(params, damage);
        break;
      case 'B8': 
        handleVulnerability(params, enemy);
        break;
      case 'B9': 
        handleManaRestore(params);
        break;
      // B10 handled by Core
      case 'B11': 
        handleStrengthBoost(params);
        break;
      case 'B12': 
        handleAgilityBoost(params);
        break;
      case 'B13': 
        handleIntelligenceBoost(params);
        break;
      case 'B14': 
        handleEnduranceBoost(params);
        break;
      case 'B15': 
        handleVulnerabilityMark(params, enemy);
        break;
      case 'B16': 
        handleWeaknessMark(params, enemy);
        break;
      case 'B17': 
        handleDeathMark(params, enemy);
        break;
      case 'B18': 
        handleTraumaStack(params, enemy);
        break;
      case 'B19': 
        handleCorrosionStack(params, enemy);
        break;
      // B20-B22 handled by Core
    }
  });
  return totalExtraDamage;
}

function handleLifeSteal(params, damage) {
  BuffManager.handleLifeSteal(params, damage, battleState.player, true);
  addHpChangeAnimation('player');
}

function handleHitRateDebuff(params, enemy) {
  const duration = parseInt(params[0]);
  const value = parseInt(params[1].replace('%', ''));
  enemy.buffs = enemy.buffs || [];
  enemy.buffs.push({
    name: '命中降低',
    type: 'hitRateDown',
    value: value,
    duration: duration,
    isPositive: false,
  });
  logBattleAction(`命中降低效果触发！${enemy.name} 命中率降低 ${value}% 持续 ${duration} 回合！`);
}

function handleCritBoost(params) {
  BuffManager.handleCritBoost(params, battleState.player, true);
}

function handleFreeze(params, enemy) {
  const duration = parseInt(params[0]);
  
  enemy.pendingFreeze = true;
  enemy.pendingFreezeCount = duration;
  logBattleAction(`晕眩效果触发！${enemy.name} 将在下次行动时被晕眩！`);
}

function handleDOT(params, enemy) {
  const log = [];
  handleDOTCore(params, enemy, log);
  log.forEach(msg => logBattleAction(msg));
}

function handleChanceFreeze(params, enemy) {
  const chance = parseInt(params[0].replace('%', ''));
  const duration = parseInt(params[1]);
  if (Math.random() * 100 <= chance) {
    
    enemy.pendingFreeze = true;
    enemy.pendingFreezeCount = duration;
    logBattleAction(`几率晕眩触发！${enemy.name} 将在下次行动时被晕眩！`);
  }
}

function handleChanceExtraDamage(params, damage) {
  const chance = parseInt(params[0].replace('%', ''));
  const bonus = parseInt(params[1].replace('%', ''));
  if (Math.random() * 100 <= chance) {
    const extraDamage = Math.floor(damage * (bonus / 100));
    logBattleAction(`额外伤害触发！造成额外 ${extraDamage} 点伤害！`);
    return extraDamage;
  }
  return 0;
}

function handleVulnerability(params, enemy) {
  const duration = parseInt(params[0]);
  const bonus = parseInt(params[1].replace('%', ''));
  enemy.buffs = enemy.buffs || [];
  enemy.buffs.push({
    name: '易伤',
    type: 'vulnerable',
    value: bonus,
    duration: duration,
    isPositive: false,
  });
  logBattleAction(`易伤效果触发！${enemy.name} 受到伤害增加 ${bonus}% 持续 ${duration} 回合！`);
}

function handleManaRestore(params) {
  const mp = parseInt(params[0]);
  const oldMp = battleState.player.mp;
  battleState.player.mp = Math.min(battleState.player.mp + mp, battleState.player.maxMp);
  const actualRestore = battleState.player.mp - oldMp;
  logBattleAction(`法力恢复触发！恢复 ${actualRestore} 点法力值！`);
}

function handleHealOverTime(params) {
  const log = [];
  handleHealOverTimeCore(params, battleState.playerBuffs, log);
  log.forEach(msg => logBattleAction(msg));
}

const handleStrengthBoost = params => BuffManager.handleAttributeBoost(params, 'strBoost', '力量', true);
const handleAgilityBoost = params => BuffManager.handleAttributeBoost(params, 'agiBoost', '敏捷', true);
const handleIntelligenceBoost = params => BuffManager.handleAttributeBoost(params, 'intBoost', '智力', true);
const handleEnduranceBoost = params => BuffManager.handleAttributeBoost(params, 'endBoost', '耐力', true);

function handleVulnerabilityMark(params, enemy) {
  const bonus = parseInt(params[0].replace('%', ''));
  enemy.marks = enemy.marks || {};
  enemy.marks.vulnerability = bonus;
  logBattleAction(`易伤标记施加！${enemy.name} 下次受到攻击将额外承受 ${bonus}% 伤害！`);
}
function handleWeaknessMark(params, enemy) {
  const bonus = parseInt(params[0].replace('%', ''));
  enemy.marks = enemy.marks || {};
  enemy.marks.weakness = bonus;
  logBattleAction(`破绽标记施加！${enemy.name} 下次受到攻击暴击率额外提升 ${bonus}%！`);
}
function handleDeathMark(params, enemy) {
  const bonus = parseInt(params[0].replace('%', ''));
  enemy.marks = enemy.marks || {};
  enemy.marks.death = bonus;
  logBattleAction(`死点标记施加！${enemy.name} 下次受到攻击暴击伤害额外提升 ${bonus}%！`);
}

function handleTraumaStack(params, enemy) {
  const stacks = parseInt(params[0]);
  const damage = parseInt(params[1]);
  enemy.stacks = enemy.stacks || {};

  if (!enemy.stacks.trauma) {
    enemy.stacks.trauma = { count: 0, damagePerStack: damage };
  }

  enemy.stacks.trauma.count += stacks;
  enemy.stacks.trauma.damagePerStack = damage;
  
  const totalDamage = enemy.stacks.trauma.count * enemy.stacks.trauma.damagePerStack;
  logBattleAction(
    `创伤叠加！${enemy.name} 获得 ${stacks} 层创伤效果（总计 ${enemy.stacks.trauma.count} 层），每层每回合造成 ${damage} 点伤害（总计 ${totalDamage} 点/回合）！`,
  );
}
function handleCorrosionStack(params, enemy) {
  const stacks = parseInt(params[0]);
  const bonus = parseInt(params[1].replace('%', ''));
  enemy.stacks = enemy.stacks || {};

  if (!enemy.stacks.corrosion) {
    enemy.stacks.corrosion = { count: 0, bonusPerStack: bonus };
  }

  enemy.stacks.corrosion.count += stacks;
  enemy.stacks.corrosion.bonusPerStack = bonus;
  
  const totalBonus = enemy.stacks.corrosion.count * enemy.stacks.corrosion.bonusPerStack;
  logBattleAction(
    `腐蚀叠加！${enemy.name} 获得 ${stacks} 层腐蚀效果（总计 ${enemy.stacks.corrosion.count} 层），每层使受到伤害增加 ${bonus}%（总计 +${totalBonus}%）！`,
  );
}

function handlePermanentShield(params, target = battleState.player, targetName = null) {
  const log = [];
  handlePermanentShieldCore(params, target, log, targetName || (target === battleState.player ? '你' : null));
  log.forEach(msg => logBattleAction(msg));
}

function handleTemporaryShield(params, target = battleState.player, targetName = null) {
  const log = [];
  handleTemporaryShieldCore(params, target, log, targetName || (target === battleState.player ? '你' : null));
  log.forEach(msg => logBattleAction(msg));
}

function handleShieldOverTime(params, buffsArray = battleState.playerBuffs, targetName = null) {
  const log = [];
  handleShieldOverTimeCore(params, buffsArray, log, targetName || '你');
  log.forEach(msg => logBattleAction(msg));
}

function getPlayerActualStats() {
  return getPlayerStatsCore(battleState.player, battleState.playerBuffs, battleState.equipmentStats || {});
}

function processTeammateEnchantmentEffects(weapon, enemy, damage, isCrit, teammate) {
  if (!weapon.codes) return 0;
  let totalExtraDamage = 0;
  weapon.codes.forEach(code => {
    if (!code.startsWith('EN:B')) return;
    const match = code.match(/EN:(B\d+),(.+)/);
    if (!match) return;
    const effectType = match[1];
    const params = match[2].split(',');
    switch (effectType) {
      case 'B1': 
        handleTeammateLifeSteal(params, damage, teammate);
        break;
      case 'B2': 
        handleHitRateDebuff(params, enemy);
        break;
      case 'B3': 
        if (isCrit) handleTeammateCritBoost(params, teammate);
        break;
      case 'B4': 
        if (isCrit) handleFreeze(params, enemy);
        break;
      case 'B5': 
        handleDOT(params, enemy);
        break;
      case 'B6': 
        handleChanceFreeze(params, enemy);
        break;
      case 'B7': 
        totalExtraDamage += handleChanceExtraDamage(params, damage);
        break;
      case 'B8': 
        handleVulnerability(params, enemy);
        break;
      case 'B9': 
        handleTeammateManaRestoreEffect(params, teammate);
        break;
      case 'B10': 
        handleTeammateHealOverTime(params, teammate);
        break;
      case 'B11': 
        handleTeammateStrengthBoost(params, teammate);
        break;
      case 'B12': 
        handleTeammateAgilityBoost(params, teammate);
        break;
      case 'B13': 
        handleTeammateIntelligenceBoost(params, teammate);
        break;
      case 'B14': 
        handleTeammateVitalityBoost(params, teammate);
        break;
      case 'B15': 
        handleVulnerabilityMark(params, enemy);
        break;
      case 'B16': 
        handleWeaknessMark(params, enemy);
        break;
      case 'B17': 
        handleDeathMark(params, enemy);
        break;
      case 'B18': 
        handleTraumaStack(params, enemy);
        break;
      case 'B19': 
        handleCorrosionStack(params, enemy);
        break;
      case 'B20': 
        handlePermanentShield(params, teammate, teammate.name);
        break;
      case 'B21': 
        handleTemporaryShield(params, teammate, teammate.name);
        break;
      case 'B22': 
        if (!teammate.buffs) teammate.buffs = [];
        handleShieldOverTime(params, teammate.buffs, teammate.name);
        break;
    }
  });
  return totalExtraDamage;
}

const handleTeammateLifeSteal = (params, damage, teammate) =>
  BuffManager.handleLifeSteal(params, damage, teammate, false);
const handleTeammateCritBoost = (params, teammate) => BuffManager.handleCritBoost(params, teammate, false);
function handleTeammateManaRestoreEffect(params, teammate) {
  const mp = parseInt(params[0]);
  const oldMp = teammate.mp;
  teammate.mp = Math.min(teammate.mp + mp, teammate.maxMp);
  const actualRestore = teammate.mp - oldMp;
  logBattleAction(`${teammate.name} 法力恢复触发！恢复 ${actualRestore} 点法力值！`);
}
function handleTeammateHealOverTime(params, teammate) {
  const duration = parseInt(params[0]);
  const heal = parseInt(params[1]);
  teammate.buffs = teammate.buffs || [];
  teammate.buffs.push({
    name: '持续恢复',
    type: 'healOverTime',
    value: heal,
    duration: duration,
    isPositive: true,
  });
  logBattleAction(`${teammate.name} 持续恢复效果触发！将在 ${duration} 回合内每回合恢复 ${heal} 点生命值！`);
}

const handleTeammateStrengthBoost = (params, teammate) =>
  BuffManager.handleAttributeBoost(params, 'strBoost', '力量', false, teammate);
const handleTeammateAgilityBoost = (params, teammate) =>
  BuffManager.handleAttributeBoost(params, 'agiBoost', '敏捷', false, teammate);
const handleTeammateIntelligenceBoost = (params, teammate) =>
  BuffManager.handleAttributeBoost(params, 'intBoost', '智力', false, teammate);
const handleTeammateVitalityBoost = (params, teammate) =>
  BuffManager.handleAttributeBoost(params, 'vitBoost', '体力', false, teammate);

      function performEnemyTurn() {
        battleState.waitingForNextRound = false;
        logBattleAction(`敌人回合！`);
        
        for (const enemy of battleState.enemies) {
          
          if (enemy.pendingFreeze) {
            logBattleAction(`${enemy.name} 被晕眩，无法行动！`);
            enemy.pendingFreezeCount--;
            if (enemy.pendingFreezeCount <= 0) {
              enemy.pendingFreeze = false;
              enemy.pendingFreezeCount = 0;
              logBattleAction(`${enemy.name} 解除了晕眩状态！`);
            }
            continue;
          }
          
          let totalBurnDamage = 0;
          const burnBuffs = enemy.buffs ? enemy.buffs.filter(buff => buff.type === 'burnOverTime') : [];
          if (burnBuffs.length > 0) {
            
            burnBuffs.forEach(burnBuff => {
              totalBurnDamage += burnBuff.value;
            });
            if (totalBurnDamage > 0) {
              enemy.hp = Math.max(0, enemy.hp - totalBurnDamage);
              logBattleAction(`${enemy.name} 受到余烬效果，损失 ${totalBurnDamage} 点生命值！`);
              
              showDamageNumber('enemy', totalBurnDamage, false, enemy.id);
              
              addHpChangeAnimation('enemy', enemy.id);
              
              if (StateValidator.isDead(enemy)) {
                logBattleAction(`${enemy.name} 被余烬效果击败了！`);
                
                if (StateValidator.checkEnemyDeath(enemy)) {
                  return; 
                }
                
                continue;
              }
            }
          }
          
          const attackName = enemy.attackPattern[enemy.nextAttackIndex];
          const skill = enemy.skills.find(s => s.name === attackName);
          if (skill) {
            logBattleAction(`${enemy.name} 使用 ${skill.name} 攻击！`);
            
            const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
            enemyElement.classList.add('attack-animation-backward');
            
            setTimeout(() => {
              
              const effectiveHitRate = getEffectiveHitRate(skill.hitRate, enemy);
              
              const maxTargets = skill.targetsPerAttack || 1;
              const targets = getEnemyTargetsByHate(enemy.id, maxTargets);
              if (targets.length === 0) {
                logBattleAction(`${enemy.name} 找不到可攻击的目标！`);
                
                setTimeout(() => {
                  enemyElement.classList.remove('attack-animation-backward');
                }, 500);
                return;
              }
              if (maxTargets > 1) {
                logBattleAction(
                  `${enemy.name} 的 ${skill.name} 瞄准了 ${targets.length} 个目标：${targets
                    .map(t => t.name)
                    .join(', ')}`,
                );
              }
              
              targets.forEach((target, targetIndex) => {
                
                const enemyStats = getEnemyActualStats(enemy);
                let targetStats;
                if (target.entity === battleState.player) {
                  targetStats = getPlayerActualStats();
                } else {
                  
                  targetStats = getTeammateActualStats(target.entity);
                }
                
                const finalHitRate = calculateFinalHitRate(effectiveHitRate, enemyStats, targetStats);
                const hitRoll = Math.random();
                
                if (hitRoll <= Math.min(1.0, finalHitRate)) {
                  
                  logBattleAction(`攻击命中 ${target.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                  
                  const targetElement =
                    target.type === 'player'
                      ? domRoot.querySelector('.combat-entity.player')
                      : domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${target.entity.id}"]`);
                  if (targetElement) {
                    targetElement.classList.add('shake-animation');
                  }
                  
                  const finalCritRate = calculateFinalCritRate(skill.critRate, enemyStats, targetStats, finalHitRate);
                  const critRoll = Math.random();
                  
                  const isCrit = critRoll <= finalCritRate;
                  
                  const finalCritMultiplier = isCrit
                    ? calculateFinalCritMultiplier(enemyStats, targetStats, finalCritRate)
                    : 1.0;
                  
                  let damage = calculateFinalDamage(skill.attack, enemyStats, targetStats, isCrit, finalCritMultiplier);
                  
                  if (isCrit) {
                    logBattleAction(
                      `暴击！造成 ${damage} 点伤害！(暴击率: ${(finalCritRate * 100).toFixed(
                        1,
                      )}%, 暴击倍率: ${finalCritMultiplier.toFixed(2)}x)`,
                    );
                    if (target.type === 'player') {
                      showDamageNumber('player', damage, true);
                    } else {
                      
                      showDamageNumber('teammate', damage, true, null, target.entity.id);
                    }
                  } else {
                    logBattleAction(`造成 ${damage} 点伤害！`);
                    if (target.type === 'player') {
                      showDamageNumber('player', damage, false);
                    } else {
                      
                      showDamageNumber('teammate', damage, false, null, target.entity.id);
                    }
                  }
                  
                  let remainingDamage = damage;

                  if (target.entity.tempShield && target.entity.tempShield > 0) {
                    const tempShieldAbsorbed = Math.min(target.entity.tempShield, remainingDamage);
                    target.entity.tempShield -= tempShieldAbsorbed;
                    remainingDamage -= tempShieldAbsorbed;
                    if (tempShieldAbsorbed > 0) {
                      logBattleAction(`临时护盾吸收 ${tempShieldAbsorbed} 点伤害！（剩余临时护盾 ${target.entity.tempShield} 点）`);
                    }
                  }

                  if (remainingDamage > 0 && target.entity.shield && target.entity.shield > 0) {
                    const shieldAbsorbed = Math.min(target.entity.shield, remainingDamage);
                    target.entity.shield -= shieldAbsorbed;
                    remainingDamage -= shieldAbsorbed;
                    if (shieldAbsorbed > 0) {
                      logBattleAction(`护盾吸收 ${shieldAbsorbed} 点伤害！（剩余护盾 ${target.entity.shield} 点）`);
                    }
                  }

                  const oldHp = target.entity.hp;
                  target.entity.hp = Math.max(0, target.entity.hp - remainingDamage);
                  
                  if (target.type === 'player') {
                    addHpChangeAnimation('player');
                  } else {
                    addHpChangeAnimation('teammate', target.entity.id);
                  }
                  
                  setTimeout(() => {
                    if (targetElement) {
                      targetElement.classList.remove('shake-animation');
                    }
                  }, 800);
                  
                  if (StateValidator.isDead(target.entity)) {
                    if (target.type === 'player') {
                      
                      battleState.lastKilledBy = skill.name;
                      endBattle(false);
                      return;
                    } else {
                      
                      logBattleAction(`${target.name} 被击败了！`);
                      
                      createDeathEffect(targetElement);
                      
                      hateSystem.clearTargetHate(target.entity.id);
                      
                      battleState.teammates = battleState.teammates.filter(t => t.id !== target.entity.id);
                      
                      cleanupActionOrder('teammate', target.entity.id);
                      
                      updatePlayerPanel();
                    }
                  }
                } else {
                  
                  logBattleAction(`攻击未命中 ${target.name}！(最终命中率: ${(finalHitRate * 100).toFixed(1)}%)`);
                }
              }); 
              
              enemy.nextAttackIndex = (enemy.nextAttackIndex + 1) % enemy.attackPattern.length;
              
              enemyElement.classList.remove('attack-animation-backward');
            }, 500);
          }
        }
        
        setTimeout(() => {
          
          updatePlayerPanel();
          updateEnemyPanel();
          updateHateDisplay(); 
          
          startNextRound();
        }, 1500); 
      }
      
      function forceUpdateUI() {
        
        updateActionOrderDisplay();
        
        const currentAction = battleState.actionOrder[battleState.currentActionIndex];
        if (!currentAction) {
          return;
        }
        
        domRoot.querySelectorAll('.combat-entity').forEach(entity => {
          entity.classList.remove('current-actor');
        });
        if (currentAction.type === 'player') {
          const playerEntity = domRoot.querySelector('.combat-entity.player');
          if (playerEntity) {
            playerEntity.classList.add('current-actor');
          }
        } else if (currentAction.type === 'teammate') {
          const teammateEntity = domRoot.querySelector(
            `.combat-entity.teammate[data-teammate-id="${currentAction.id}"]`,
          );
          if (teammateEntity) {
            teammateEntity.classList.add('current-actor');
          }
          
          battleState.currentTeammate = currentAction.entity;
          updateTeammateWeaponsList(); 
        } else if (currentAction.type === 'enemy') {
          const enemyEntity = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${currentAction.id}"]`);
          if (enemyEntity) {
            enemyEntity.classList.add('current-actor');
          }
        }
        
        setupSkipButton();
        
        updateBattleUI({ player: true, enemy: true, weapons: false });
        updateHateDisplay(); 
      }
      
      function updateBattleUI(options = {}) {
        const {
          player = true,
          enemy = true,
          weapons = true,
          items = false,
          teammates = false,
          force = false,
        } = options;
        
        if (force || lazyRenderManager.shouldRenderCombat()) {
          if (player) updatePlayerPanel();
          if (enemy) updateEnemyPanel();
          if (weapons) updateWeaponsList();
          if (items) updateItemsList();
          if (teammates) updateTeammateWeaponsList();
        }
      }
      
      function startNextRound() {
        
        battleState.round++;
        
        battleState.currentItemUsed = false;
        
        battleState.player.weapons.forEach(weapon => {
          weapon.used = false;
          if (weapon.currentCooldown > 0) {
            weapon.currentCooldown--;
          }
        });
        battleState.player.items.forEach(item => {
          item.used = false;
        });
        
        battleState.teammates.forEach(teammate => {
          teammate.skillUsed = false;
          teammate.weapons.forEach(weapon => {
            weapon.used = false;
            
            if (weapon.currentCooldown > 0) {
              weapon.currentCooldown--;
            }
          });
        });
        
        const currentPlayerStats = getPlayerActualStats();
        battleState.player.hp = Math.min(battleState.player.hp + currentPlayerStats.hpRegen, battleState.player.maxHp);
        battleState.player.mp = Math.min(battleState.player.mp + currentPlayerStats.mpRegen, battleState.player.maxMp);
        
        battleState.teammates.forEach(teammate => {
          const currentTeammateStats = getTeammateActualStats(teammate);
          
          teammate.hp = Math.min(teammate.hp + (teammate.hpRegen || 0), teammate.maxHp);
          teammate.mp = Math.min(teammate.mp + currentTeammateStats.mpRegen, teammate.maxMp);
          
          if (teammate.buffs && teammate.buffs.length > 0) {
            teammate.buffs.forEach(buff => {
              if (buff.type === 'healOverTime') {
                const healAmount = buff.value;
                const oldHp = teammate.hp;
                teammate.hp = Math.min(teammate.hp + healAmount, teammate.maxHp);
                const actualHeal = teammate.hp - oldHp;
                if (actualHeal > 0) {
                  logBattleAction(`${teammate.name} 持续恢复效果触发，恢复 ${actualHeal} 点生命值！`);
                  showHealNumber(actualHeal);
                }
              }
              
              if (buff.type === 'shieldOverTime') {
                const shieldAmount = buff.value;
                
                if (!teammate.shield) {
                  teammate.shield = 0;
                  teammate.maxShield = 0;
                }
                
                teammate.shield += shieldAmount;
                logBattleAction(`${teammate.name}的护盾持续效果触发，获得 ${shieldAmount} 点护盾（当前护盾 ${teammate.shield} 点）！`);
              }
            });
          }
          
          if (teammate.tempShield) {
            logBattleAction(`${teammate.name}的临时护盾消散，失去 ${teammate.tempShield} 点临时护盾！`);
            teammate.tempShield = 0;
          }
        });
        
        const healOTBuff = battleState.playerBuffs.find(buff => buff.type === 'healOverTime');
        if (healOTBuff) {
          const healAmount = healOTBuff.value;
          const oldHp = battleState.player.hp;
          battleState.player.hp = Math.min(battleState.player.hp + healAmount, battleState.player.maxHp);
          const actualHeal = battleState.player.hp - oldHp;
          if (actualHeal > 0) {
            logBattleAction(`持续恢复效果触发，恢复 ${actualHeal} 点生命值！`);
            showHealNumber(actualHeal);
            
            addHpChangeAnimation('player');
            
            const playerEntity = domRoot.querySelector('.combat-entity.player');
            playerEntity.classList.add('heal-pulse-animation');
            setTimeout(() => {
              playerEntity.classList.remove('heal-pulse-animation');
            }, 800);
          }
        }
        
        const shieldOTBuff = battleState.playerBuffs.find(buff => buff.type === 'shieldOverTime');
        if (shieldOTBuff) {
          const shieldAmount = shieldOTBuff.value;
          
          if (!battleState.player.shield) {
            battleState.player.shield = 0;
            battleState.player.maxShield = 0;
          }
          
          battleState.player.shield += shieldAmount;
          logBattleAction(`护盾持续效果触发，获得 ${shieldAmount} 点护盾（当前护盾 ${battleState.player.shield} 点）！`);
        }
        
        if (battleState.player.tempShield) {
          logBattleAction(`临时护盾消散，失去 ${battleState.player.tempShield} 点临时护盾！`);
          battleState.player.tempShield = 0;
        }
        
        [battleState.player, ...battleState.teammates].forEach((entity, index) => {
          const isPlayer = index === 0;
          const entityBuffs = isPlayer ? battleState.playerBuffs : entity.buffs;
          if (entityBuffs && entityBuffs.length > 0) {
            entityBuffs.forEach(buff => {
              
              if (buff.type === 'dot') {
                const damage = buff.value;
                entity.hp = Math.max(0, entity.hp - damage);
                logBattleAction(`${isPlayer ? battleState.player.name || 'User' : entity.name} 受到持续伤害 ${damage} 点！`);
              }
              
              if (buff.type === 'manaBurn') {
                const mpLoss = buff.value;
                const oldMp = entity.mp;
                entity.mp = Math.max(0, entity.mp - mpLoss);
                const actualLoss = oldMp - entity.mp;
                if (actualLoss > 0) {
                  logBattleAction(`${isPlayer ? battleState.player.name || 'User' : entity.name} 法力燃烧！损失 ${actualLoss} 点MP！`);
                }
              }
            });
          }
        });

        battleState.enemies.forEach(enemy => {
          
          if (enemy.buffs && enemy.buffs.length > 0) {
            enemy.buffs.forEach(buff => {
              if (buff.type === 'dot') {
                const damage = buff.value;
                enemy.hp = Math.max(0, enemy.hp - damage);
                logBattleAction(`${enemy.name} 受到持续伤害 ${damage} 点！`);
                if (StateValidator.isDead(enemy)) {
                  logBattleAction(`${enemy.name} 因持续伤害死亡！`);
                }
              }
              
              if (buff.type === 'healOverTime') {
                const healAmount = buff.value;
                const oldHp = enemy.hp;
                enemy.hp = Math.min(enemy.hp + healAmount, enemy.maxHp);
                const actualHeal = enemy.hp - oldHp;
                if (actualHeal > 0) {
                  logBattleAction(`${enemy.name} 持续再生效果触发，恢复 ${actualHeal} 点生命值！`);
                }
              }
            });
          }
          
          if (enemy.stacks && enemy.stacks.trauma) {
            
            const traumaData = enemy.stacks.trauma;
            const traumaCount = typeof traumaData === 'object' ? traumaData.count : traumaData; 
            const damagePerStack = typeof traumaData === 'object' ? traumaData.damagePerStack : 3; 
            
            const traumaDamage = traumaCount * damagePerStack;
            enemy.hp = Math.max(0, enemy.hp - traumaDamage);
            logBattleAction(`${enemy.name} 受到创伤伤害 ${traumaDamage} 点（${traumaCount} 层 × ${damagePerStack} 点/层）！`);
            if (StateValidator.isDead(enemy)) {
              logBattleAction(`${enemy.name} 因创伤死亡！`);
            }
          }
        });
        
        if (battleState.playerBuffs.length > 0) {
          battleState.playerBuffs.forEach(buff => {
            if (buff.type === 'healOverTime') {
              const healAmount = buff.value;
              const oldHp = battleState.player.hp;
              battleState.player.hp = Math.min(battleState.player.hp + healAmount, battleState.player.maxHp);
              const actualHeal = battleState.player.hp - oldHp;
              if (actualHeal > 0) {
                logBattleAction(`持续恢复效果触发，恢复 ${actualHeal} 点生命值！`);
                showHealNumber(actualHeal);
              }
            }
          });
        }
        
        if (battleState.playerBuffs.length > 0) {
          battleState.playerBuffs.forEach(buff => {
            buff.duration--;
            
            if (buff.duration <= 0) {
              if (buff.type === 'strDebuff') battleState.player.str += buff.value;
              if (buff.type === 'agiDebuff') battleState.player.agi += buff.value;
              if (buff.type === 'intDebuff') battleState.player.int += buff.value;
              if (buff.type === 'vitDebuff') battleState.player.vit += buff.value;
              logBattleAction(`${buff.name} 效果已结束！`);
            }
          });
          
          battleState.playerBuffs = battleState.playerBuffs.filter(buff => buff.duration > 0);
        }
        battleState.enemies.forEach(enemy => {
          if (enemy.buffs && enemy.buffs.length > 0) {
            enemy.buffs.forEach(buff => {
              buff.duration--;
              
              if (buff.duration <= 0) {
                if (buff.type === 'strBoost') enemy.str -= buff.value;
                if (buff.type === 'agiBoost') enemy.agi -= buff.value;
                logBattleAction(`${enemy.name} 的 ${buff.name} 效果已结束！`);
              }
            });
            
            enemy.buffs = enemy.buffs.filter(buff => buff.duration > 0);
          }
        });
        
        battleState.teammates.forEach(teammate => {
          if (teammate.buffs && teammate.buffs.length > 0) {
            teammate.buffs.forEach(buff => {
              buff.duration--;
              
              if (buff.duration <= 0) {
                if (buff.type === 'strDebuff') teammate.str += buff.value;
                if (buff.type === 'agiDebuff') teammate.agi += buff.value;
                if (buff.type === 'intDebuff') teammate.int += buff.value;
                if (buff.type === 'vitDebuff') teammate.vit += buff.value;
                logBattleAction(`${teammate.name} 的 ${buff.name} 效果已结束！`);
              }
            });
            
            teammate.buffs = teammate.buffs.filter(buff => buff.duration > 0);
          }
        });
        
        const deadEnemies = battleState.enemies.filter(enemy => StateValidator.isDead(enemy));
        if (deadEnemies.length > 0) {
          
          if (StateValidator.checkBatchEnemyDeath(deadEnemies)) {
            return; 
          }
        }
        
        battleState.currentWeapon = null;
        battleState.selectedEnemies = [];
        battleState.selectedHealTargets = []; 
        battleState.healTarget = null;
        battleState.selfTargetMode = false;
        battleState.sacrificeBoostActive = null; 
        
        updateBattleUI({ player: true, enemy: true, weapons: false });
        updateWeaponsList();
        
        logBattleAction(`第 ${battleState.round} 回合开始！`);
        
        calculateActionOrder();
        
        battleState.currentActionIndex = 0;
        
        forceUpdateUI();
        
        showCurrentActor();
        
        // 持久化：新回合开始后保存状态
        notifyBattleStateChange();
      }
      
      function endBattle(isVictory) {
        
        domRoot
          .querySelectorAll('.weapon-button, .attack-button, .next-round-button, .mid-action-button, .item-button')
          .forEach(button => {
            button.disabled = true;
          });
        
        hateSystem.enemyHateLists = {};
        
        if (isVictory) {
          logBattleAction(`战斗胜利！你击败了所有敌人！`);
          
          const allEnemyNames = battleState.initialEnemies.map(enemy => enemy.name).join('、');
          
          const defeatedEnemies = battleState.initialEnemies;
          const expResult = calculateTeamExperience(battleState.player, battleState.teammates, defeatedEnemies);
          let victoryHtml = `
                      <h3 class="victory">战斗胜利！</h3>
                      <p>你击败了所有敌人！</p>
                      <p>剩余HP: ${battleState.player.hp}/${battleState.player.maxHp}</p>
                      <p>剩余MP: ${battleState.player.mp}/${battleState.player.maxMp}</p>
                      <p>伤害最高武器: ${battleState.highestDamageWeapon.name || '无'}</p>
          `;
          
          victoryHtml += `
                      <div style="margin-top: 15px; padding: 10px; background: rgba(6, 182, 212, 0.1); border-radius: 8px; border: 1px solid var(--accent-color);">
                          <h4 style="color: var(--accent-color); margin: 0 0 10px 0;">📈 经验值获得</h4>
                          <p><strong>${battleState.player.name || 'User'}</strong> (等级${
            battleState.player.grade || 1
          }) 获得经验值: <span style="color: var(--accent-color); font-weight: bold;">${
            expResult.playerExp
          } EXP</span></p>
          `;
          if (expResult.teammateResults && expResult.teammateResults.length > 0) {
            expResult.teammateResults.forEach(teammate => {
              victoryHtml += `<p><strong>${teammate.name}</strong> (等级${teammate.level}) 获得经验值: <span style="color: var(--accent-color); font-weight: bold;">${teammate.exp} EXP</span></p>`;
            });
          }
          victoryHtml += `</div>`;
          domRoot.getElementById('result-summary').innerHTML = victoryHtml;
        } else {
          logBattleAction(`战斗失败！你被击败了！`);
          domRoot.getElementById('result-summary').innerHTML = `
                      <h3 class="defeat">战斗失败！</h3>
                      <p>你被${battleState.lastKilledBy ? ' ' + battleState.lastKilledBy + ' ' : ''}击败了！</p>
                      <p>HP变为0</p>
                  `;
        }
        
        const battleStats = collectBattleStatistics();
        
        domRoot.getElementById('result-modal').style.display = 'flex';
        
        domRoot.getElementById('close-result').removeEventListener('click', closeResultHandler);
        domRoot.getElementById('send-result').removeEventListener('click', sendResultHandler);
        
        domRoot.getElementById('close-result').addEventListener('click', function () {
          domRoot.getElementById('result-modal').style.display = 'none';
          domRoot.getElementById('combat-interface').style.display = 'none';
          domRoot.querySelector('.container').style.display = 'block';
          battleState.isActive = false;
          // 持久化：战斗结束，清除保存的状态
          if (typeof _onBattleEnd === 'function') _onBattleEnd();
          
          domRoot.getElementById('extra-result-text').value = '';
          updatePlayerStatus(battleState.player);
          createBattleButton();
        });
        
        domRoot.getElementById('send-result').addEventListener('click', function () {
          
          const extraText = domRoot.getElementById('extra-result-text').value.trim();
          
          let message = '';
          
          let battleLogText = '';
          if (battleState.fullCombatLog && battleState.fullCombatLog.length > 0) {
            battleLogText = '，战斗记录：' + battleState.fullCombatLog.join(' → ');
          }
          if (isVictory) {
            
            const allEnemyNames = battleState.initialEnemies.map(enemy => enemy.name).join('、');
            
            let itemUsageStats = '';
            if (battleStats.itemUsage && battleStats.itemUsage.length > 0) {
              itemUsageStats =
                '，使用道具: ' + battleStats.itemUsage.map(item => `${item.name} ${item.count}个`).join('、');
            }
            
            let playerStatus = `{{user}}血量${battleState.player.hp}/${battleState.player.maxHp}，MP值${battleState.player.mp}/${battleState.player.maxMp}`;
            
            let teammatesStatus = '';
            if (battleState.teammates && battleState.teammates.length > 0) {
              teammatesStatus =
                '，队友状态: ' +
                battleState.teammates
                  .map(
                    teammate =>
                      `${teammate.name}血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}`,
                  )
                  .join('；');
            }
            
            let expInfo = '';
            const defeatedEnemies = battleState.initialEnemies;
            const expResult = calculateTeamExperience(battleState.player, battleState.teammates, defeatedEnemies);
            expInfo = `，{{user}}获得${expResult.playerExp}经验值`;
            if (expResult.teammateResults && expResult.teammateResults.length > 0) {
              const teammateExpInfo = expResult.teammateResults
                .map(teammate => `${teammate.name}获得${teammate.exp}经验值`)
                .join('，');
              expInfo += `，${teammateExpInfo}`;
            }
            message = `<request:{{user}}赢得了战斗，${playerStatus}${teammatesStatus}，伤害最高武器为${
              battleState.highestDamageWeapon.name || '无'
            }，击败了${allEnemyNames}${itemUsageStats}${expInfo}${extraText ? '，' + extraText : ''}${battleLogText}>`;
          } else {
            
            let itemUsageStats = '';
            if (battleStats.itemUsage && battleStats.itemUsage.length > 0) {
              itemUsageStats =
                '，使用道具: ' + battleStats.itemUsage.map(item => `${item.name} ${item.count}个`).join('、');
            }
            
            let defeatedEnemies = '';
            if (battleStats.killedEnemies && battleStats.killedEnemies.length > 0) {
              defeatedEnemies = `，击败了${battleStats.killedEnemies.join('、')}`;
            }
            
            let teammatesStatus = '';
            if (battleState.teammates && battleState.teammates.length > 0) {
              teammatesStatus =
                '，队友状态: ' +
                battleState.teammates
                  .map(
                    teammate =>
                      `${teammate.name}血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}`,
                  )
                  .join('；');
            }
            message = `<request:{{user}}被击败了，{{user}}血量变为0/${battleState.player.maxHp}，MP值${
              battleState.player.mp
            }/${battleState.player.maxMp}${teammatesStatus}${
              battleState.lastKilledBy ? '，被' + battleState.lastKilledBy + '击败' : ''
            }${defeatedEnemies}${itemUsageStats}${extraText ? '，' + extraText : ''}${battleLogText}>`;
          }
          
          sendBattleResult(message)
            .then(success => {
              if (success) {
                logBattleAction('已发送战斗结果！');
              } else {
                logBattleAction('发送失败，结果已复制到剪贴板！');
              }
            })
            .catch(e => {
              console.error('发送战斗结果失败:', e);
              logBattleAction('发送失败！');
            });
          
          domRoot.getElementById('result-modal').style.display = 'none';
          domRoot.getElementById('combat-interface').style.display = 'none';
          domRoot.querySelector('.container').style.display = 'block';
          battleState.isActive = false;
          // 持久化：战斗结束，清除保存的状态
          if (typeof _onBattleEnd === 'function') _onBattleEnd();
          
          domRoot.getElementById('extra-result-text').value = '';
          updatePlayerStatus(battleState.player);
          createBattleButton();
        });
      }
      
      function logBattleAction(message) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.textContent = message;
        
        const cl = domRoot.getElementById('combat-log');
        cl.appendChild(logEntry);
        cl.scrollTop = cl.scrollHeight;
        
        const COMBAT_LOG_MAX_LINES = 50;
        while (cl.children.length > COMBAT_LOG_MAX_LINES) {
          cl.removeChild(cl.firstChild);
        }
        
        if (battleState && battleState.fullCombatLog) {
          battleState.fullCombatLog.push(message);
          
          if (battleState.fullCombatLog.length > 200) {
            battleState.fullCombatLog = battleState.fullCombatLog.slice(-100); 
          }
        }
      }
      
      function showDamageNumber(target, amount, isCrit = false, enemyId = null, teammateId = null) {
        const damageElement = document.createElement('div');
        damageElement.className = `damage-number ${isCrit ? 'critical' : ''}`;
        damageElement.textContent = amount;
        let targetElement;
        if (target === 'player') {
          targetElement = domRoot.querySelector('.combat-entity.player');
        } else if (target === 'enemy') {
          targetElement = domRoot.querySelector(
            `.combat-entity.enemy[data-enemy-id="${enemyId || battleState.selectedEnemies[0]}"]`,
          );
        } else if (target === 'teammate') {
          targetElement = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${teammateId}"]`);
        }
        if (targetElement) {
          targetElement.appendChild(damageElement);
          
          const randomX = Math.floor(Math.random() * 30) - 15;
          const randomY = Math.floor(Math.random() * 15) - 5;
          damageElement.style.position = 'absolute';
          damageElement.style.top = `${50 + randomY}%`;
          damageElement.style.left = `${50 + randomX}%`;
          
          setTimeout(() => damageElement.remove(), 1200);
        }
      }
      
      function createDeathEffect(targetElement) {
        if (!targetElement) return;
        
        const flash = document.createElement('div');
        flash.className = 'death-flash';
        targetElement.appendChild(flash);
        
        const particleCount = 10; // ponytail: was capped at 50 - activeParticles.size, 10 is always ≤ 50
        for (let i = 0; i < particleCount; i++) {
          const particle = document.createElement('div');
          particle.className = 'death-particle';
          
          const randomX = Math.random() * 100;
          const randomY = Math.random() * 100;
          particle.style.left = `${randomX}%`;
          particle.style.top = `${randomY}%`;
          
          const size = Math.random() * 8 + 4;
          particle.style.width = `${size}px`;
          particle.style.height = `${size}px`;
          
          const delay = Math.random() * 0.5;
          particle.style.animationDelay = `${delay}s`;
          targetElement.appendChild(particle);
          
          setTimeout(() => particle.remove(), 2000 + delay * 1000);
        }
      }
      
      function addHpChangeAnimation(targetType, targetId = null) {
        let hpBar;
        if (targetType === 'player') {
          hpBar = domRoot.querySelector('.combat-entity.player .hp-fill-combat');
        } else if (targetType === 'enemy') {
          hpBar = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${targetId}"] .hp-fill-combat`);
        } else if (targetType === 'teammate') {
          hpBar = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${targetId}"] .hp-fill-combat`);
        }
        if (hpBar) {
          hpBar.classList.add('hp-change-animation');
          setTimeout(() => {
            hpBar.classList.remove('hp-change-animation');
          }, 500);
        }
      }

// ponytail: 5 manager singletons kept — each has real logic (12-27 call sites), inlining would increase size
const BuffManager = {
  
  addBuff(target, buffData, isPlayer = false) {
    if (isPlayer) {
      battleState.playerBuffs.push(buffData);
    } else {
      target.buffs = target.buffs || [];
      target.buffs.push(buffData);
    }
  },
  
  handleAttributeBoost(params, buffType, attributeName, isPlayer, target = null) {
    const duration = parseInt(params[0]);
    const value = parseInt(params[1]);
    const buffData = {
      name: `${attributeName}提升`,
      type: buffType,
      value: value,
      duration: duration,
      isPositive: true,
    };
    this.addBuff(target || battleState.player, buffData, isPlayer);
    const targetName = isPlayer ? battleState.player.name || 'User' : target ? target.name : '目标';
    logBattleAction(`${targetName} ${attributeName}提升效果触发！${attributeName}+${value} 持续 ${duration} 回合！`);
  },
  
  handleLifeSteal(params, damage, target, isPlayer = false) {
    const percent = parseInt(params[0]);
    const healAmount = Math.floor(damage * (percent / 100));
    if (healAmount > 0) {
      const oldHp = target.hp;
      target.hp = Math.min(target.hp + healAmount, target.maxHp);
      const actualHeal = target.hp - oldHp;
      const targetName = isPlayer ? battleState.player.name || 'User' : target.name;
      logBattleAction(`${targetName} 生命窃取触发！恢复 ${actualHeal} 点生命值！`);
      if (isPlayer) {
        showHealNumber(actualHeal);
      }
    }
  },
  
  handleManaRestore(params, target, isPlayer = false) {
    const mp = parseInt(params[0]);
    const oldMp = target.mp;
    target.mp = Math.min(target.mp + mp, target.maxMp);
    const actualRestore = target.mp - oldMp;
    const targetName = isPlayer ? battleState.player.name || 'User' : target.name;
    logBattleAction(`${targetName} 法力恢复触发！恢复 ${actualRestore} 点法力值！`);
  },
  
  handleHealOverTime(params, target, isPlayer = false) {
    const duration = parseInt(params[0]);
    const heal = parseInt(params[1]);
    const buffData = {
      name: '持续恢复',
      type: 'healOverTime',
      value: heal,
      duration: duration,
      isPositive: true,
    };
    this.addBuff(target, buffData, isPlayer);
    const targetName = isPlayer ? battleState.player.name || 'User' : target.name;
    logBattleAction(`${targetName} 持续恢复效果触发！将在 ${duration} 回合内每回合恢复 ${heal} 点生命值！`);
  },
  
  handleCritBoost(params, target, isPlayer = false) {
    const duration = parseInt(params[0]);
    const value = parseInt(params[1].replace('%', ''));
    const buffData = {
      name: '暴击提升',
      type: 'critBoost',
      value: value,
      duration: duration,
      isPositive: true,
    };
    this.addBuff(target, buffData, isPlayer);
    const targetName = isPlayer ? battleState.player.name || 'User' : target.name;
    logBattleAction(`${targetName} 暴击提升效果触发！暴击率提升 ${value}% 持续 ${duration} 回合！`);
  },
};

const EventManager = {
  
  listeners: new Map(),
  
  removeListener(element, event, handler) {
    if (element && handler) {
      element.removeEventListener(event, handler);
    }
  },
  
  addListener(element, event, handler, key = null) {
    if (!element) return;
    
    if (key && this.listeners.has(key)) {
      const oldHandler = this.listeners.get(key);
      this.removeListener(element, event, oldHandler);
    }
    element.addEventListener(event, handler);
    
    if (key) {
      this.listeners.set(key, handler);
    }
  },
  
  clearAll() {
    this.listeners.clear();
  },
  
  bindWeaponButtons(weapons, isTeammate = false) {
    const selector = isTeammate ? '.teammate-weapon:not(.used)' : '.weapon-button:not(.used)';
    domRoot.querySelectorAll(selector).forEach(button => {
      const weaponIndex = parseInt(button.getAttribute('data-weapon-index'));
      const weapon = weapons[weaponIndex];
      if (!weapon) return;
      this.addListener(button, 'click', () => {
        this.handleWeaponSelection(weapon, weaponIndex, isTeammate);
      });
    });
  },
  
  handleWeaponSelection(weapon, weaponIndex, isTeammate = false) {
    
    domRoot.querySelectorAll('.weapon-button, .item-button').forEach(btn => {
      btn.classList.remove('selected');
    });
    domRoot.querySelectorAll('.combat-entity').forEach(entity => {
      entity.classList.remove('selected');
    });
    
    battleState.currentWeapon = weapon;
    battleState.currentItem = null;
    battleState.selectedEnemies = [];
    battleState.selectedHealTargets = [];
    battleState.healTarget = null;
    battleState.maxAttackCount = weapon.attacksPerTurn;
    battleState.currentAttackCount = 0;
    
    const weaponTemplate = weapon.codes?.find(code => code.startsWith('WN:A'))?.match(/WN:(A[1-5])/)?.[1];
    
    battleState.selfTargetMode =
      weaponTemplate === 'A2' || weaponTemplate === 'A3' || weaponTemplate === 'A4' || weapon.isHealing;

    if (weaponTemplate === 'A4') {
      if (isTeammate && battleState.currentTeammate) {
        
        battleState.selectedHealTargets = [{ 
          id: battleState.currentTeammate.id, 
          type: 'teammate', 
          entity: battleState.currentTeammate 
        }];
        battleState.healTarget = battleState.currentTeammate.id;
      } else {
        
        battleState.selectedHealTargets = [{ 
          id: 'player', 
          type: 'player', 
          entity: battleState.player 
        }];
        battleState.healTarget = 'player';
      }
    }

    updatePlayerPanel();
    domRoot.querySelector(`[data-weapon-index="${weaponIndex}"]`).classList.add('selected');

    if (weaponTemplate === 'A4') {
      if (isTeammate && battleState.currentTeammate) {
        
        const teammateElement = domRoot.querySelector(
          `.combat-entity.teammate[data-teammate-id="${battleState.currentTeammate.id}"]`
        );
        if (teammateElement) {
          teammateElement.classList.add('selected');
        }
      } else {
        
        const playerElement = domRoot.querySelector('.combat-entity.player');
        if (playerElement) {
          playerElement.classList.add('selected');
        }
      }
    }
    
    updateAttackButton();
  },
  
  bindItemButtons(items) {
    domRoot.querySelectorAll('.item-button:not(.used)').forEach(button => {
      const itemIndex = parseInt(button.getAttribute('data-item-index'));
      const item = items[itemIndex];
      if (!item) return;
      this.addListener(button, 'click', () => {
        this.handleItemSelection(item, itemIndex);
      });
    });
  },
  
  handleItemSelection(item, itemIndex) {
    
    domRoot.querySelectorAll('.weapon-button, .item-button').forEach(btn => {
      btn.classList.remove('selected');
    });
    domRoot.querySelectorAll('.combat-entity').forEach(entity => {
      entity.classList.remove('selected');
    });
    
    battleState.currentWeapon = null;
    battleState.currentItem = item;
    battleState.selectedEnemies = [];
    
    const currentAction = battleState.actionOrder[battleState.currentActionIndex];
    if (currentAction && currentAction.type === 'teammate') {
      
      battleState.selfTargetMode = false;
      battleState.healTarget = currentAction.id;
      const teammateElement = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${currentAction.id}"]`);
      if (teammateElement) {
        teammateElement.classList.add('selected');
      }
    } else {
      
      battleState.selfTargetMode = true;
      battleState.healTarget = 'player';
      domRoot.querySelector('.combat-entity.player').classList.add('selected');
    }
    
    updatePlayerPanel();
    domRoot.querySelector(`[data-item-index="${itemIndex}"]`).classList.add('selected');
    
    const attackBtn = domRoot.getElementById('attack-btn');
    if (attackBtn) {
      attackBtn.disabled = false;
      attackBtn.innerHTML = "<i class='fas fa-box-open'></i> 使用道具";
    }
  },
};

const StateValidator = {
  
  isDead(entity) {
    return entity && entity.hp <= 0;
  },
  
  isPlayerDead() {
    return this.isDead(battleState.player);
  },
  
  areAllEnemiesDead() {
    return battleState.enemies.length === 0;
  },
  
  isBattleOver() {
    return this.isPlayerDead() || this.areAllEnemiesDead();
  },
  
  isVictory() {
    return !this.isPlayerDead() && this.areAllEnemiesDead();
  },
  
  isDefeat() {
    return this.isPlayerDead();
  },
  
  shouldEndAttack(currentCount, maxCount, hasTargets = true) {
    return currentCount >= maxCount || !hasTargets || this.areAllEnemiesDead();
  },
  
  isValidTarget(target) {
    return target && target.hp > 0;
  },
  
  processDeadEnemies() {
    const deadEnemies = battleState.enemies.filter(enemy => this.isDead(enemy));
    if (deadEnemies.length > 0) {
      
      deadEnemies.forEach(enemy => {
        logBattleAction(`${enemy.name} 被击败了！`);
        const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
        createDeathEffect(enemyElement);
        
        if (typeof hateSystem !== 'undefined') {
          hateSystem.clearEnemyHate(enemy.id);
        }
      });
      
      battleState.enemies = battleState.enemies.filter(enemy => !this.isDead(enemy));
      
      if (this.areAllEnemiesDead()) {
        endBattle(true);
        return true; 
      }
    }
    return false; 
  },
  
  checkEnemyDeath(enemy) {
    if (this.isDead(enemy)) {
      logBattleAction(`${enemy.name} 被击败了！`);
      const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
      createDeathEffect(enemyElement);
      
      battleState.enemies = battleState.enemies.filter(e => e.id !== enemy.id);
      
      if (typeof hateSystem !== 'undefined') {
        hateSystem.clearEnemyHate(enemy.id);
      }
      
      if (this.areAllEnemiesDead()) {
        endBattle(true);
        return true; 
      }
    }
    return false; 
  },

  checkBatchEnemyDeath(deadEnemies) {
    if (deadEnemies.length > 0) {
      
      deadEnemies.forEach(enemy => {
        logBattleAction(`${enemy.name} 被击败了！`);
        const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
        createDeathEffect(enemyElement);
        
        if (typeof hateSystem !== 'undefined') {
          hateSystem.clearEnemyHate(enemy.id);
        }
      });
      
      battleState.enemies = battleState.enemies.filter(enemy => !this.isDead(enemy));
      
      if (this.areAllEnemiesDead()) {
        endBattle(true);
        return true; 
      }
    }
    return false; 
  },
};

// 5a: TooltipGenerator 改为模块级（不再挂 window）
const TooltipGenerator = {
    generateWeaponEffectTooltip(effectKey, parts) {
      if (weaponSpecialEffects[effectKey]) {
        switch (effectKey) {
          case 'A1':
          case 'A2':
          case 'A3':
          case 'A4':
          case 'A5':
            return weaponSpecialEffects[effectKey]();
          default:
            return weaponSpecialEffects[effectKey] || effectKey;
        }
      }
      return '';
    },
    generateEnchantmentTooltip(effectKey, parts) {
      if (!enchantmentEffects[effectKey]) return '';
      switch (effectKey) {
        case 'B1':
        case 'B4':
        case 'B9':
        case 'B15':
        case 'B16':
        case 'B17':
          return parts.length >= 2 ? enchantmentEffects[effectKey](parts[1]) : '';
        case 'B2':
        case 'B3':
        case 'B5':
        case 'B6':
        case 'B7':
        case 'B8':
        case 'B10':
        case 'B11':
        case 'B12':
        case 'B13':
        case 'B14':
        case 'B18':
        case 'B19':
        case 'B22':
          return parts.length >= 3 ? enchantmentEffects[effectKey](parts[1], parts[2]) : '';
        case 'B20':
        case 'B21':
          return parts.length >= 2 ? enchantmentEffects[effectKey](parts[1]) : '';
        default:
          return enchantmentEffects[effectKey] || effectKey;
      }
    },
    generateEffectCodeHtml(codes) {
      let effectsHtml = '';
      codes.forEach(code => {
        const [codeType, codeValue] = code.split(':');
        const parts = codeValue.split(',');
        const effectKey = parts[0];
        let tooltipText = '';
        if (codeType === 'WN') {
          tooltipText = this.generateWeaponEffectTooltip(effectKey, parts);
        } else if (codeType === 'EN') {
          tooltipText = this.generateEnchantmentTooltip(effectKey, parts);
        }
        if (tooltipText) {
          effectsHtml += `<div class="weapon-effect-code status-effect">${effectKey}
                              <span class="effect-tooltip">${tooltipText}</span>
                          </div>`;
        }
      });
      return effectsHtml;
    },
    generateAttributeTooltip(attribute) {
      const tooltips = {
        str: '物理伤害+生命恢复',
        agi: '速度+闪避+暴击',
        int: '暴击+法力恢复',
        vit: '行动点+生命恢复',
      };
      return tooltips[attribute] || '';
    },
};

function showHealNumber(amount) {
  const healElement = document.createElement('div');
  healElement.className = 'heal-number';
  healElement.textContent = `+${amount}`;
  const targetElement = domRoot.querySelector('.combat-entity.player');
  if (targetElement) {
    targetElement.appendChild(healElement);
    
    const randomX = Math.floor(Math.random() * 30) - 15;
    healElement.style.position = 'absolute';
    healElement.style.top = '40%';
    healElement.style.left = `${50 + randomX}%`;
    
    setTimeout(() => healElement.remove(), 1200);
  }
}

function showHealNumberOnEnemy(amount, enemyId) {
  const healElement = document.createElement('div');
  healElement.className = 'heal-number';
  healElement.textContent = `+${amount}`;
  const targetElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemyId}"]`);
  if (targetElement) {
    targetElement.appendChild(healElement);
    
    const randomX = Math.floor(Math.random() * 30) - 15;
    healElement.style.position = 'absolute';
    healElement.style.top = '40%';
    healElement.style.left = `${50 + randomX}%`;
    
    setTimeout(() => healElement.remove(), 1200);
  }
}

function applyDamageWithShield(target, damage, targetName) {
  let remainingDamage = damage;
  let shieldDamage = 0;
  let tempShieldDamage = 0;
  let hpDamage = 0;

  if (target.tempShield && target.tempShield > 0) {
    tempShieldDamage = Math.min(target.tempShield, remainingDamage);
    target.tempShield -= tempShieldDamage;
    remainingDamage -= tempShieldDamage;
    
    if (tempShieldDamage > 0) {
      logBattleAction(`${targetName}的临时护盾抵挡了 ${tempShieldDamage} 点伤害！剩余临时护盾: ${target.tempShield}`);
    }
  }

  if (remainingDamage > 0 && target.shield && target.shield > 0) {
    shieldDamage = Math.min(target.shield, remainingDamage);
    target.shield -= shieldDamage;
    remainingDamage -= shieldDamage;
    
    if (shieldDamage > 0) {
      logBattleAction(`${targetName}的护盾抵挡了 ${shieldDamage} 点伤害！剩余护盾: ${target.shield}`);
    }
  }

  if (remainingDamage > 0) {
    hpDamage = remainingDamage;
    target.hp = Math.max(0, target.hp - hpDamage);
    logBattleAction(`${targetName}受到 ${hpDamage} 点伤害！当前HP: ${target.hp}/${target.maxHp}`);
  }
  
  return {
    totalDamage: damage,
    tempShieldDamage: tempShieldDamage,
    shieldDamage: shieldDamage,
    hpDamage: hpDamage,
    blocked: damage - hpDamage
  };
}

function applyHealingEffect(item, userEntity, isPlayer) {
  const oldHp = userEntity.hp;
  userEntity.hp = Math.min(userEntity.hp + item.value, userEntity.maxHp);
  const actualHeal = userEntity.hp - oldHp;
  logBattleAction(`${isPlayer ? '' : userEntity.name + ' '}恢复了 ${actualHeal} 点生命值！`);
  if (isPlayer) {
    showHealNumber(actualHeal);

    addHpChangeAnimation('player');
    
    const playerEntity = domRoot.querySelector('.combat-entity.player');
    if (playerEntity) {
      playerEntity.classList.add('heal-pulse-animation');
      setTimeout(() => playerEntity.classList.remove('heal-pulse-animation'), 800);
    }
  } else {
    
    const healElement = document.createElement('div');
    healElement.className = 'heal-number';
    healElement.textContent = `+${actualHeal}`;
    const teammateElement = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${userEntity.id}"]`);
    if (teammateElement) {
      teammateElement.appendChild(healElement);
      const randomX = Math.floor(Math.random() * 30) - 15;
      healElement.style.position = 'absolute';
      healElement.style.top = '40%';
      healElement.style.left = `${50 + randomX}%`;
      setTimeout(() => healElement.remove(), 1200);
      
      const teammateId = parseInt(teammateElement.getAttribute('data-teammate-id'));
      if (!isNaN(teammateId)) {
        addHpChangeAnimation('teammate', teammateId);
      }
      teammateElement.classList.add('heal-pulse-animation');
      setTimeout(() => teammateElement.classList.remove('heal-pulse-animation'), 800);
    }
  }
}
function applyManaRestoreEffect(item, userEntity, isPlayer) {
  const oldMp = userEntity.mp;
  userEntity.mp = Math.min(userEntity.mp + item.value, userEntity.maxMp);
  const actualRestore = userEntity.mp - oldMp;
  logBattleAction(`${isPlayer ? '' : userEntity.name + ' '}恢复了 ${actualRestore} 点法力值！`);
  
  const selector = isPlayer ? '.combat-entity.player' : `.combat-entity.teammate[data-teammate-id="${userEntity.id}"]`;
  const entityElement = domRoot.querySelector(selector);
  if (entityElement) {
    const mpBar = entityElement.querySelector('.mp-fill-combat');
    if (mpBar) {
      mpBar.classList.add('hp-change-animation');
      setTimeout(() => mpBar.classList.remove('hp-change-animation'), 800);
    }
  }
}
function applyAttributeBoost(item, userEntity, boostType, itemName, isPlayer) {
  const buffTarget = isPlayer ? battleState.playerBuffs : (userEntity.buffs = userEntity.buffs || []);
  buffTarget.push({
    name: itemName,
    type: boostType,
    value: item.value,
    duration: item.duration,
    isPositive: true,
  });
  const attributeName = boostType
    .replace('Boost', '')
    .replace('str', '力量')
    .replace('agi', '敏捷')
    .replace('int', '智力')
    .replace('end', '耐力');
  logBattleAction(
    `${isPlayer ? '' : userEntity.name + ' '}${attributeName}增加 ${item.value} 点，持续 ${item.duration} 回合！`,
  );
}

function useItem(item, user = null) {
  const isPlayer = !user;
  const userName = isPlayer ? battleState.player.name || 'User' : user.name;
  const userEntity = isPlayer ? battleState.player : user;
  logBattleAction(`${userName} 使用了 ${item.name}`);
  
  switch (item.type) {
    case 1: 
      applyHealingEffect(item, userEntity, isPlayer);
      break;
    case 2: 
      applyManaRestoreEffect(item, userEntity, isPlayer);
      break;
    case 3: 
      applyAttributeBoost(item, userEntity, 'strBoost', '力量药水', isPlayer);
      break;
    case 4: 
      applyAttributeBoost(item, userEntity, 'agiBoost', '敏捷药水', isPlayer);
      break;
    case 5: 
      applyAttributeBoost(item, userEntity, 'intBoost', '智力药水', isPlayer);
      break;
    case 6: 
      if (!isPlayer) {
        logBattleAction(`${userName} 无法使用耐力增益道具！`);
        return; 
      }
      applyAttributeBoost(item, userEntity, 'endBoost', '耐力药水', isPlayer);
      break;
    default:
      logBattleAction(`${userName} 使用了未知效果的道具：${item.type}`);
  }

  if (!battleState.itemUsageStats) {
    battleState.itemUsageStats = {};
  }
  if (!battleState.itemUsageStats[item.name]) {
    battleState.itemUsageStats[item.name] = 0;
  }
  battleState.itemUsageStats[item.name]++;
  
  item.count--;
  
  if (item.count <= 0) {
    battleState.player.items = battleState.player.items.filter(i => i !== item);
  }
  
  battleState.currentItemUsed = true;
  
  battleState.currentItem = null;
  
  updateBattleUI({ player: true, enemy: false, weapons: true });
}

function setupDetailsAnimation() {
  const detailsElement = domRoot.getElementById('preparation-details');
  const content = detailsElement.querySelector('#preparation-screen');
  
  // Calculate and apply initial state
  const recalculateHeight = () => {
    // Temporarily remove max-height to measure actual content height
    const prevMaxHeight = content.style.maxHeight;
    content.style.maxHeight = 'none';
    const height = content.offsetHeight + 'px';
    content.style.maxHeight = prevMaxHeight;
    return height;
  };
  
  // Set initial state (closed)
  content.style.maxHeight = '0';
  
  // 移除旧的 resize handler 再添加新的，防止重复注册
  if (sideEffectsState.resizeHandler) {
    window.removeEventListener('resize', sideEffectsState.resizeHandler);
  }
  sideEffectsState.resizeHandler = () => {
    if (detailsElement.open) {
      content.style.maxHeight = recalculateHeight();
    }
  };
  window.addEventListener('resize', sideEffectsState.resizeHandler);
  
  detailsElement.addEventListener('toggle', () => {
    if (detailsElement.open) {
      // Defer height measurement to next frame — lazy rendering (setupLazyRendering)
      // may populate content in the same toggle event, and the browser needs a
      // layout pass before offsetHeight reflects the actual content height.
      requestAnimationFrame(() => {
        content.style.maxHeight = recalculateHeight();
      });
    } else {
      content.style.maxHeight = '0';
    }
  });
}

function setupLazyRendering() {
  const preparationDetails = domRoot.getElementById('preparation-details');
  if (!preparationDetails || lazyRenderManager.isPreparationRendered) return;
  
  preparationDetails.addEventListener('toggle', function () {
    if (this.open && !lazyRenderManager.isPreparationRendered && battleData) {
      
      lazyRenderManager.safeUpdateInterface(() => {
        initializeInterface(battleData);
        lazyRenderManager.isPreparationRendered = true;
      }, 'preparation');
    }
  });
  
  if (preparationDetails.hasAttribute('open')) {
    lazyRenderManager.isPreparationRendered = true;
  }
}

function setupDataUpdateListener() {
  let lastDataContent = domRoot.getElementById('status-data-source').textContent;
  let isRendered = false;
  
  const observer = new MutationObserver(function (mutations) {
    const currentData = domRoot.getElementById('status-data-source').textContent;
    if (currentData !== lastDataContent) {
      lastDataContent = currentData;
      
      if (currentData) {
        battleData = parseStatusData(currentData);

        updatePreparationSummary(battleData.enemies);

        const preparationDetails = domRoot.getElementById('preparation-details');
        if (preparationDetails && preparationDetails.open) {
          
          initializeInterface(battleData);
        } else {
          
          lazyRenderManager.isPreparationRendered = false;
        }
      }
    }
  });
  
  observer.observe(domRoot.getElementById('status-data-source'), {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function updatePreparationSummary(enemies) {
  const summary = domRoot.querySelector('.preparation-summary');
  if (summary) {
    if (enemies && enemies.length > 0) {
      const enemyNames = enemies.map(e => e.name).join('、');
      
      const displayNames = enemies.length > 3 
        ? `${enemies.slice(0, 3).map(e => e.name).join('、')}等${enemies.length}个敌人`
        : enemyNames;
      summary.innerHTML = `战前准备 <span style="color: #ff6b6b; font-weight: bold; margin-left: 8px;">📍 ${displayNames}</span>`;
    } else {
      summary.textContent = '战前准备';
    }
  }
}

// DOMContentLoaded 替换为可导出的初始化函数
function initializeBattleDom() {
  const initialData = domRoot.getElementById('status-data-source').textContent;
  if (initialData) {
    battleData = parseStatusData(initialData);
    
    const preparationDetails = domRoot.getElementById('preparation-details');
    
    if (preparationDetails) {
      preparationDetails.removeAttribute('open');
    }

    updatePreparationSummary(battleData.enemies);

    setupDetailsAnimation();
    setupLazyRendering();
    
    setupDataUpdateListener();
  }
}

function updateActionOrderDisplay() {
  
  if (!lazyRenderManager.shouldRenderCombat()) {
    return;
  }
  const actionOrderDisplay = domRoot.getElementById('action-order-display');
  if (!actionOrderDisplay) return;
  
  actionOrderDisplay.innerHTML = '';
  
  if (battleState.currentActionIndex >= battleState.actionOrder.length) {
    battleState.currentActionIndex = 0;
  }
  
  battleState.actionOrder.forEach((action, index) => {
    const isCurrentAction = index === battleState.currentActionIndex;
    const actionItem = document.createElement('div');
    actionItem.className = `action-order-item ${action.type} ${isCurrentAction ? 'current' : ''}`;
    actionItem.setAttribute('data-action-index', index);
    
    const nameElement = document.createElement('div');
    nameElement.className = 'action-order-name';
    nameElement.textContent = action.name;
    actionItem.appendChild(nameElement);
    
    const speedElement = document.createElement('div');
    speedElement.className = 'action-order-speed';
    
    speedElement.textContent = `速度: ${action.speed || action.entity.speed}`;
    actionItem.appendChild(speedElement);
    
    const numberElement = document.createElement('div');
    numberElement.className = 'action-order-number';
    numberElement.textContent = `#${action.actionNumber || index + 1}`;
    actionItem.appendChild(numberElement);
    
    actionOrderDisplay.appendChild(actionItem);
    
    if (index < battleState.actionOrder.length - 1) {
      const arrowElement = document.createElement('div');
      arrowElement.className = 'action-order-arrow';
      arrowElement.innerHTML = '<i class="fas fa-chevron-right"></i>';
      actionOrderDisplay.appendChild(arrowElement);
    }
  });
  
  if (battleState.actionOrder.length > 0) {
    const currentItem = actionOrderDisplay.querySelector('.action-order-item.current');
    if (currentItem) {
      actionOrderDisplay.scrollLeft =
        currentItem.offsetLeft - actionOrderDisplay.clientWidth / 2 + currentItem.clientWidth / 2;
      
      setupSkipButton();
    }
  }
}

function updateHateDisplay() {
  
  if (!lazyRenderManager.shouldRenderCombat()) {
    return;
  }
  
  updateEnemyPanel();
}

function enablePlayerControls() {

  updateWeaponsList();
  
  const attackBtn = domRoot.getElementById('attack-btn');
  if (attackBtn) {
    attackBtn.disabled = true;
    attackBtn.innerHTML = "<i class='fas fa-hand-fist'></i> 攻击选中目标";
  }
  
  setupSkipButton();
}

function performEnemyAction(enemy) {
  
  disablePlayerControls();
  
  // Use Core version for pure calculation
  const logArr = [];
  const instructions = performEnemyActionCore(enemy, battleState.player, battleState.teammates, logArr);
  
  // Route Core log messages to UI log
  logArr.forEach(msg => logBattleAction(msg));
  
  // Apply instructions to DOM with animation timing
  setTimeout(() => {
    // Enemy attack animation
    const hasAttack = instructions.some(i => i.type === 'damage' || i.type === 'miss');
    if (hasAttack) {
      const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${enemy.id}"]`);
      if (enemyElement) {
        enemyElement.classList.add('attack-animation-backward');
        setTimeout(() => enemyElement.classList.remove('attack-animation-backward'), 1500);
      }
    }

    applyInstructionsToDom(instructions, {
      onComplete: () => {
        // Handle player death
        const playerDeath = instructions.find(i => i.type === 'playerDeath');
        if (playerDeath) {
          battleState.lastKilledBy = enemy.skills ? enemy.skills[0]?.name : enemy.name;
          endBattle(false);
          return;
        }

        // Handle teammate death (remove from battleState)
        instructions.filter(i => i.type === 'teammateDeath').forEach(inst => {
          battleState.teammates = battleState.teammates.filter(t => t.id !== inst.targetId);
          cleanupActionOrder('teammate', inst.targetId);
        });

        // UI updates
        setTimeout(() => {
          updatePlayerPanel();
          updateEnemyPanel();
          updateHateDisplay();
        }, 1500);

        notifyBattleStateChange();

        setTimeout(() => {
          moveToNextAction();
        }, 500);
      }
    });
  }, 800);
}

function disablePlayerControls() {
  domRoot.querySelectorAll('.weapon-button, .item-button').forEach(button => {
    button.disabled = true;
  });
  const attackBtn = domRoot.getElementById('attack-btn');
  if (attackBtn) {
    attackBtn.disabled = true;
  }
  const nextRoundBtn = domRoot.getElementById('next-round-btn');
  if (nextRoundBtn) {
    nextRoundBtn.disabled = true;
  }
  const midActionBtn = domRoot.getElementById('mid-action-btn');
  if (midActionBtn) {
    midActionBtn.disabled = true;
  }
}

function setupSkipButton() {
  
  const skipButton = domRoot.getElementById('next-round-btn');
  if (!skipButton) return;
  
  const currentAction = battleState.actionOrder[battleState.currentActionIndex];
  if (!currentAction) return;
  
  skipButton.onclick = null;
  
  if (currentAction.type === 'player' || currentAction.type === 'teammate') {
    
    skipButton.innerHTML = "<i class='fas fa-forward'></i> 跳过当前行动";
    skipButton.className = 'next-round-button';
    skipButton.disabled = false;
    
    skipButton.onclick = function () {
      moveToNextAction();
    };
  } else {
    
    skipButton.innerHTML = "<i class='fas fa-forward'></i> 等待敌人行动";
    skipButton.disabled = true;
  }
  
  setupMidActionButton();
}

function setupMidActionButton() {
  const midActionButton = domRoot.getElementById('mid-action-btn');
  if (!midActionButton) return;
  
  midActionButton.onclick = null;
  
  midActionButton.onclick = function () {
    showMidActionResult();
  };
}

function showMidActionResult() {
  
  let statusInfo = `<h3 style="color: var(--accent-color);">{{user}}状态</h3>`;
  
  statusInfo += `<p><strong>{{user}}状态：</strong>血量${battleState.player.hp}/${battleState.player.maxHp}，MP值${battleState.player.mp}/${battleState.player.maxMp}</p>`;
  
  if (battleState.teammates && battleState.teammates.length > 0) {
    statusInfo += `<p><strong>队友状态：</strong></p><div style="margin-left: 20px;">`;
    battleState.teammates.forEach(teammate => {
      statusInfo += `<p>${teammate.name}：血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}</p>`;
    });
    statusInfo += `</div>`;
  }
  
  if (battleState.enemies && battleState.enemies.length > 0) {
    statusInfo += `<p><strong>敌人状态：</strong></p><div style="margin-left: 20px;">`;
    battleState.enemies.forEach(enemy => {
      statusInfo += `<p>${enemy.name}：血量${enemy.hp}/${enemy.maxHp}</p>`;
    });
    statusInfo += `</div>`;
  }
  
  domRoot.getElementById('result-summary').innerHTML = statusInfo;
  domRoot.getElementById('result-modal').style.display = 'flex';
  
  domRoot.getElementById('close-result').removeEventListener('click', closeMidActionHandler);
  domRoot.getElementById('send-result').removeEventListener('click', sendMidActionHandler);
  
  domRoot.getElementById('close-result').addEventListener('click', closeMidActionHandler);
  
  domRoot.getElementById('send-result').addEventListener('click', sendMidActionHandler);
}

function closeMidActionHandler() {
  domRoot.getElementById('result-modal').style.display = 'none';
  
  domRoot.getElementById('extra-result-text').value = '';
}

function sendMidActionHandler() {
  
  const extraText = domRoot.getElementById('extra-result-text').value.trim();
  
  let playerStatus = `{{user}}血量${battleState.player.hp}/${battleState.player.maxHp}，MP值${battleState.player.mp}/${battleState.player.maxMp}`;
  
  let teammatesStatus = '';
  if (battleState.teammates && battleState.teammates.length > 0) {
    teammatesStatus =
      '，队友状态: ' +
      battleState.teammates
        .map(teammate => `${teammate.name}血量${teammate.hp}/${teammate.maxHp}，MP值${teammate.mp}/${teammate.maxMp}`)
        .join('；');
  }
  
  let enemiesStatus = '';
  if (battleState.enemies && battleState.enemies.length > 0) {
    enemiesStatus =
      '，敌人状态: ' + battleState.enemies.map(enemy => `${enemy.name}血量${enemy.hp}/${enemy.maxHp}`).join('；');
  }
  
  let battleLogText = '';
  if (battleState.fullCombatLog && battleState.fullCombatLog.length > 0) {
    battleLogText = '，战斗记录：' + battleState.fullCombatLog.join(' → ');
  }
  
  const message = `<request:${
    extraText ? extraText + '，' : ''
  }{{user}}状态，${playerStatus}${teammatesStatus}${enemiesStatus}${battleLogText}>`;
  
  sendBattleResult(message)
    .then(success => {
      if (success) {
        logBattleAction('已发送中途行动状态！');
      } else {
        logBattleAction('发送失败，结果已复制到剪贴板！');
      }
    })
    .catch(e => {
      console.error('发送中途行动状态失败:', e);
      logBattleAction('发送失败！');
    });
  
  domRoot.getElementById('result-modal').style.display = 'none';
  
  domRoot.getElementById('extra-result-text').value = '';

  domRoot.getElementById('combat-interface').style.display = 'none';
  domRoot.querySelector('.container').style.display = 'block';
  
  battleState.isActive = false;
  
  updatePlayerStatus(battleState.player);
  createBattleButton();
  
  autoCollapseAfterSend();
}

function moveToNextAction() {
  
  const currentAction = battleState.actionOrder[battleState.currentActionIndex];
  if (currentAction) {
    logBattleAction(`${currentAction.name} 结束当前行动！`);
    
    if (currentAction.type === 'teammate') {
      currentAction.entity.skillUsed = true;
    }
  }
  
  battleState.currentActionIndex++;
  
  battleState.currentItemUsed = false;
  
  if (battleState.currentActionIndex >= battleState.actionOrder.length) {
    startNextRound();
    return;
  }
  
  // 持久化：行动切换后保存状态（startNextRound 内已单独通知）
  notifyBattleStateChange();
  
  setTimeout(() => {
    
    forceUpdateUI();
    showCurrentActor();
  }, 50);
}

function cleanupActionOrder(deadEntityType, deadEntityId) {
  
  if (!battleState.actionOrder || !deadEntityId) return;
  
  const currentIndex = battleState.currentActionIndex;
  
  const newActionOrder = battleState.actionOrder.filter(
    action => !(action.type === deadEntityType && action.id === deadEntityId),
  );
  
  if (newActionOrder.length < battleState.actionOrder.length) {
    
    battleState.actionOrder = newActionOrder;
    
    if (currentIndex >= battleState.actionOrder.length) {
      battleState.currentActionIndex = battleState.actionOrder.length - 1;
    } else {
      
      let removedBeforeCurrent = 0;
      for (let i = 0; i <= currentIndex; i++) {
        const originalAction = battleState.actionOrder[i - removedBeforeCurrent];
        if (!originalAction || (originalAction.type === deadEntityType && originalAction.id === deadEntityId)) {
          removedBeforeCurrent++;
        }
      }
      
      battleState.currentActionIndex = Math.max(0, currentIndex - removedBeforeCurrent);
    }
    
    if (battleState.actionOrder.length === 0) {
      startNextRound();
      return;
    }
    
    updateActionOrderDisplay();
  }
}

function updateTeammateWeaponsList() {
  if (!battleState.currentTeammate) return;

  const weapons = battleState.currentTeammate.weapons || [];
  
  domRoot.getElementById('melee-panel').classList.add('active');
  domRoot.getElementById('items-panel').classList.remove('active');
  domRoot.getElementById('stats-panel').classList.remove('active');
  domRoot.getElementById('melee-toggle').classList.add('active');
  domRoot.getElementById('items-toggle').classList.remove('active');
  domRoot.getElementById('stats-toggle').classList.remove('active');
  
  const currentAction = battleState.actionOrder[battleState.currentActionIndex];
  if (currentAction && currentAction.type === 'teammate') {
        domRoot.getElementById('melee-toggle').innerHTML = `<i class="fas fa-hand-fist"></i> ${currentAction.name}的剑技`;
  } else {
    domRoot.getElementById('melee-toggle').innerHTML = '<i class="fas fa-hand-fist"></i> 队友剑技';
  }
  
  domRoot.getElementById('items-toggle').style.display = 'block'; 
  
  const meleeWeaponList = domRoot.getElementById('melee-weapon-list');
  
  if (!battleState.currentTeammate || !battleState.currentTeammate.weapons) {
    meleeWeaponList.innerHTML = '<div style="text-align: center; padding: 10px;">该队友没有可用的剑技</div>';
    return;
  }
  meleeWeaponList.innerHTML =
    battleState.currentTeammate.weapons.length > 0
      ? battleState.currentTeammate.weapons
          .map(weapon => {
            
            const effectsHtml = weapon.codes ? TooltipGenerator.generateEffectCodeHtml(weapon.codes) : '';

            const isUsed = weapon.used || weapon.currentCooldown > 0 || battleState.currentTeammate.ap <= 0;
            const usedClass = isUsed ? 'used' : '';
            const cooldownText = weapon.currentCooldown > 0 ? ` (冷却:${weapon.currentCooldown})` : '';
            return `
                        <button class="weapon-button teammate-weapon ${usedClass}" data-weapon-index="${battleState.currentTeammate.weapons.indexOf(
              weapon,
            )}" ${isUsed ? 'disabled' : ''}>
                            <div class="weapon-button-name">${weapon.name}${cooldownText}</div>
                            <div class="weapon-button-stats">
                                <div>${weapon.isHealing ? '治疗: ' : '攻击: '}${weapon.attack}</div>
                                <div>命中: ${weapon.hitRate}%</div>
                                <div>暴击: ${weapon.critRate}%</div>
                                <div>次数: ${weapon.attacksPerTurn}</div>
                                <div>目标: ${weapon.targetsPerAttack}</div>
                                <div>MP: ${weapon.mpCost}</div>
                                <div>冷却: ${weapon.cooldown || 0}回合</div>
                            </div>
                            <div class="weapon-effect-codes">
                                ${effectsHtml}
                            </div>
                        </button>
                    `;
          })
          .join('')
      : '<div style="text-align: center; padding: 10px;">该队友没有可用的剑技</div>';
  
  if (battleState.currentTeammate && battleState.currentTeammate.weapons) {
    EventManager.bindWeaponButtons(battleState.currentTeammate.weapons, true);
  }
  
  const attackControls = domRoot.querySelector('.attack-controls');
  attackControls.innerHTML = `
                <button id="attack-btn" class="attack-button" disabled><i class="fas fa-hand-fist"></i> 队友攻击选中目标</button>
                <button id="next-round-btn" class="next-round-button"><i class="fas fa-forward"></i> 跳过当前行动</button>
                <button id="mid-action-btn" class="mid-action-button"><i class="fas fa-pause"></i> 中途行动</button>
            `;
  
  const attackBtn = domRoot.getElementById('attack-btn');
  if (attackBtn) {
    attackBtn.addEventListener('click', performTeammateAttack);
  }
  
  updateAttackButton();
  
  setupSkipButton();
}

function executeTeammateAttackSequence(teammate, weapon) {
  // Delegate pure calculation to executeTeammateAttackCore (P4a Core extraction)
  battleState.currentAttackCount = 0;
  const logArr = [];

  // Core handles MP check, apt loop, hit/crit/damage, corrosion, enemy death
  const instructions = executeTeammateAttackCore(teammate, battleState.enemies, logArr);
  logArr.forEach(msg => logBattleAction(msg));

  // Apply teammate enchantments (UI-layer, uses battleState)
  if (instructions.some(i => i.type === 'damage')) {
    const target = battleState.enemies.find(e => e.hp > 0);
    if (target) {
      const extraDamage = processTeammateEnchantmentEffects(weapon, target, 0, false, teammate);
      // processTeammateEnchantmentEffects handles its own logging
    }
  }

  // Apply hate for damage dealt
  instructions.filter(i => i.type === 'damage').forEach(inst => {
    addDamageHate(teammate.id, teammate.name, inst.targetId, inst.damage);
  });

  // Play back instructions with animation timing
  const teammateElement = domRoot.querySelector(`.combat-entity.teammate[data-teammate-id="${teammate.id}"]`);
  if (teammateElement) teammateElement.classList.add('attack-animation-forward');

  let delay = 500;
  instructions.forEach((inst, index) => {
    setTimeout(() => {
      if (inst.type === 'damage') {
        const enemyElement = domRoot.querySelector(`.combat-entity.enemy[data-enemy-id="${inst.targetId}"]`);
        if (enemyElement) {
          enemyElement.classList.add('shake-animation');
          setTimeout(() => enemyElement.classList.remove('shake-animation'), 800);
        }
        showDamageNumber('enemy', inst.damage, inst.isCrit, inst.targetId);
        addHpChangeAnimation('enemy', inst.targetId);
      } else if (inst.type === 'enemyDeath') {
        StateValidator.checkEnemyDeath({ id: inst.targetId });
      }

      if (index === instructions.length - 1) {
        setTimeout(() => {
          if (teammateElement) teammateElement.classList.remove('attack-animation-forward');
          weapon.used = true;
          battleState.currentWeapon = null;
          battleState.attackInProgress = false;
          updatePlayerPanel();
          updateEnemyPanel();
          updateTeammateWeaponsList();
          updateHateDisplay();
        }, 800);
      }
    }, delay);
    delay += 300;
  });

  // If no instructions (MP insufficient or no enemies), finalize immediately
  if (instructions.length === 0) {
    weapon.used = true;
    battleState.currentWeapon = null;
    battleState.attackInProgress = false;
    updatePlayerPanel();
    updateEnemyPanel();
    updateTeammateWeaponsList();
  }
}

let lazyRenderManager = {
  isPreparationRendered: false,
  isCombatRendered: false,
  lastRenderTime: {
    preparation: 0,
    combat: 0,
  },
  
  shouldRenderPreparation() {
    const preparationDetails = domRoot.getElementById('preparation-details');
    return preparationDetails && preparationDetails.open;
  },
  
  shouldRenderCombat() {
    if (!this.isCombatRendered || !battleState || !battleState.isActive) {
      return false;
    }
    const combatInterface = domRoot.getElementById('combat-interface');
    return combatInterface && combatInterface.style.display !== 'none';
  },
  
  safeUpdateInterface(updateFunction, renderType) {
    try {
      const now = Date.now();
      
      if (now - this.lastRenderTime[renderType] < 16) {
        return;
      }
      if (renderType === 'preparation' && !this.shouldRenderPreparation()) {
        return;
      }
      if (renderType === 'combat' && !this.shouldRenderCombat()) {
        return;
      }
      updateFunction();
      this.lastRenderTime[renderType] = now;
    } catch (error) {
      
    }
  },
  
  reset() {
    this.isPreparationRendered = false;
    this.isCombatRendered = false;
    this.lastRenderTime.preparation = 0;
    this.lastRenderTime.combat = 0;
  },
};

// B3 fix: side effects moved to initializeBattleSideEffects()

function autoCollapseAfterSend() {
  if (battleState) {
    try {
      localStorage.setItem('battleState_backup', JSON.stringify(battleState));
    } catch (e) {}
  }
  const preparationDetails = domRoot.getElementById('preparation-details');
  if (preparationDetails && preparationDetails.open) {
    setTimeout(() => {
      preparationDetails.open = false;
    }, 100);
    
    setTimeout(() => {
      lazyRenderManager.reset();
    }, 60000);
  }
}

function setupSendDetection() {
  if (sideEffectsState.runCmdPatched) return;
  if (typeof window.runCmd === 'function') {
    const originalRunCmd = window.runCmd;
    sideEffectsState.originalRunCmd = originalRunCmd;
    window.runCmd = async function (...args) {
      const result = await originalRunCmd.apply(this, args);
      autoCollapseAfterSend();
      return result;
    };
    sideEffectsState.runCmdPatched = true;
  }
  setTimeout(() => {
    const sendButtons = domRoot.querySelectorAll('[id*="send"], [class*="send"], [onclick*="send"]');
    sendButtons.forEach(button => {
      button.addEventListener('click', () => {
        setTimeout(autoCollapseAfterSend, 200);
      });
    });
  }, 1000);
}
// B3 fix: setupSendDetection() moved to initializeBattleSideEffects()


function executeHealingSequence(weapon, weaponTemplate) {
  
  battleState.currentAttackCount = 0;
  
  function performNextHealing() {
    
    if (battleState.player.mp < weapon.mpCost) {
      logBattleAction(`蓝量不足！无法继续使用 ${weapon.name}。已完成 ${battleState.currentAttackCount} 次使用。`);
      
      weapon.used = true;
      
      battleState.currentWeapon = null;
      
      battleState.attackInProgress = false;
      
      updateBattleUI({ player: true, enemy: true, weapons: true, teammates: true });
      return;
    }
    
    let actualAttacksPerTurn = weapon.attacksPerTurn;
    if (battleState.sacrificeBoostActive) {
      actualAttacksPerTurn += battleState.sacrificeBoostActive.attacksPerTurn;
    }
    
    if (battleState.currentAttackCount >= actualAttacksPerTurn) {
      
      weapon.used = true;
      
      battleState.currentWeapon = null;
      
      battleState.attackInProgress = false;
      
      updateBattleUI({ player: true, enemy: true, weapons: true, teammates: true });
      return;
    }
    
    battleState.currentAttackCount++;
    
    const healingNumber = battleState.currentAttackCount;
    if (actualAttacksPerTurn > 1) {
      logBattleAction(
        `${battleState.player.name || 'User'} 使用 ${
          weapon.name
        } 进行第 ${healingNumber}/${actualAttacksPerTurn} 次治疗！`,
      );
    }
    
    executeHealingAction(weapon, weaponTemplate, () => {
      
      battleState.player.mp = Math.max(0, battleState.player.mp - weapon.mpCost);
      if (weapon.mpCost > 0) {
        logBattleAction(`消耗 ${weapon.mpCost} 点法力值。剩余法力值: ${battleState.player.mp}`);
      }
      
      if (battleState.currentAttackCount < actualAttacksPerTurn) {
        setTimeout(performNextHealing, 800);
      } else {
        
        weapon.used = true;
        battleState.currentWeapon = null;
        battleState.attackInProgress = false;
        updateBattleUI({ player: true, enemy: true, weapons: true, teammates: true });
      }
    });
  }
  
  performNextHealing();
}

function processSupportEnchantmentEffects(weapon, target, targetName) {
  if (!weapon.codes) return;
  
  weapon.codes.forEach(code => {
    if (!code.startsWith('EN:B')) return;
    const match = code.match(/EN:(B\d+),(.+)/);
    if (!match) return;
    
    const effectType = match[1];
    const params = match[2].split(',');
    const targetEntity = target.entity;
    const isPlayer = target.type === 'player';
    
    const buffsArray = isPlayer ? battleState.playerBuffs : (targetEntity.buffs = targetEntity.buffs || []);

    switch (effectType) {
      case 'B9': 
        {
          const mp = parseInt(params[0]);
          const oldMp = targetEntity.mp;
          targetEntity.mp = Math.min(targetEntity.mp + mp, targetEntity.maxMp);
          const actualRestore = targetEntity.mp - oldMp;
          logBattleAction(`${targetName} 法力恢复触发！恢复 ${actualRestore} 点法力值！`);
        }
        break;
      case 'B10': 
        {
          const duration = parseInt(params[0]);
          const heal = parseInt(params[1]);
          buffsArray.push({
            name: '持续恢复',
            type: 'healOverTime',
            value: heal,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 持续恢复效果触发！将在 ${duration} 回合内每回合恢复 ${heal} 点生命值！`);
        }
        break;
      case 'B11': 
        {
          const duration = parseInt(params[0]);
          const value = parseInt(params[1]);
          buffsArray.push({
            name: '力量增益',
            type: 'strBoost',
            value: value,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 力量增益触发！力量增加 ${value} 点，持续 ${duration} 回合！`);
        }
        break;
      case 'B12': 
        {
          const duration = parseInt(params[0]);
          const value = parseInt(params[1]);
          buffsArray.push({
            name: '敏捷增益',
            type: 'agiBoost',
            value: value,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 敏捷增益触发！敏捷增加 ${value} 点，持续 ${duration} 回合！`);
        }
        break;
      case 'B13': 
        {
          const duration = parseInt(params[0]);
          const value = parseInt(params[1]);
          buffsArray.push({
            name: '智力增益',
            type: 'intBoost',
            value: value,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 智力增益触发！智力增加 ${value} 点，持续 ${duration} 回合！`);
        }
        break;
      case 'B14': 
        {
          const duration = parseInt(params[0]);
          const value = parseInt(params[1]);
          buffsArray.push({
            name: '耐力增益',
            type: 'vitBoost',
            value: value,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 耐力增益触发！耐力增加 ${value} 点，持续 ${duration} 回合！`);
        }
        break;
      case 'B20': 
        {
          const shieldValue = parseInt(params[0]);
          
          if (!targetEntity.shield) {
            targetEntity.shield = 0;
            targetEntity.maxShield = shieldValue;
          }
          
          targetEntity.shield = targetEntity.maxShield;
          logBattleAction(`${targetName}的固化护盾触发！护盾值恢复至 ${targetEntity.maxShield} 点！`);
        }
        break;
      case 'B21': 
        {
          const shieldValue = parseInt(params[0]);
          
          if (!targetEntity.tempShield) {
            targetEntity.tempShield = 0;
          }
          
          targetEntity.tempShield += shieldValue;
          logBattleAction(`${targetName} 获得 ${shieldValue} 点临时护盾！（总计 ${targetEntity.tempShield} 点，持续1回合）`);
        }
        break;
      case 'B22': 
        {
          const duration = parseInt(params[0]);
          const shield = parseInt(params[1]);
          buffsArray.push({
            name: '持续护盾',
            type: 'shieldOverTime',
            value: shield,
            duration: duration,
            isPositive: true,
          });
          logBattleAction(`${targetName} 护盾持续效果触发！将在 ${duration} 回合内每回合获得 ${shield} 点护盾！`);
        }
        break;
    }
  });
}

function executeHealingAction(weapon, weaponTemplate, callback) {
  
  const targets = getHealingTargets(weapon, weaponTemplate, battleState.player);
  targets.forEach(target => {
    const targetName = target.type === 'player' ? battleState.player.name || 'User' : target.entity.name;

    if (weaponTemplate === 'A2') {
      performSingleHealing(weapon, target);
    } else if (weaponTemplate === 'A3') {
      performSingleManaRestore(weapon, target);
    } else if (weaponTemplate === 'A4') {
      performSingleSacrificeBoost(weapon, target, battleState.player);
    } else {
      performSingleHealing(weapon, target); 
    }

    processSupportEnchantmentEffects(weapon, target, targetName);
  });
  
  setTimeout(callback, 1200);
}

function getHealingTargets(weapon, weaponTemplate, attacker = null) {
  const targets = [];

  if (weaponTemplate === 'A4') {
    if (attacker === battleState.player || attacker === null) {
      
      targets.push({ type: 'player', entity: battleState.player });
    } else {
      
      targets.push({ type: 'teammate', entity: attacker });
    }
    return targets;
  }

  if (battleState.selectedHealTargets && battleState.selectedHealTargets.length > 0) {
    battleState.selectedHealTargets.forEach(target => {
      targets.push({ type: target.type, entity: target.entity });
    });
  } else {
    
    if (battleState.healTarget === 'player') {
      targets.push({ type: 'player', entity: battleState.player });
    } else if (battleState.healTarget && battleState.healTarget !== 'player') {
      const targetTeammate = battleState.teammates.find(t => t.id === battleState.healTarget);
      if (targetTeammate) {
        targets.push({ type: 'teammate', entity: targetTeammate });
      }
    }
  }
  
  return targets.slice(0, weapon.targetsPerAttack);
}

function performSingleHealing(weapon, target) {
  // Delegate pure calculation to healCore (P4a Core extraction)
  const playerStats = getPlayerActualStats();
  const logArr = [];
  const instructions = healCore(target, weapon, playerStats, logArr);
  logArr.forEach(msg => logBattleAction(msg));
  applyInstructionsToDom(instructions, {});
  // Hate system side-effect (UI-layer concern, not combat calculation)
  addHealHate('player', battleState.player.name || 'User', weapon.attack);
}

function performSingleManaRestore(weapon, target) {
  // Delegate pure calculation to manaRestoreCore (P4a Core extraction)
  const playerStats = getPlayerActualStats();
  const logArr = [];
  const instructions = manaRestoreCore(target, weapon, playerStats, logArr);
  logArr.forEach(msg => logBattleAction(msg));
  applyInstructionsToDom(instructions, {});
}

function performSingleSacrificeBoost(weapon, target, attacker = null) {
  // Delegate pure calculation to sacrificeBoostCore (P4a Core extraction)
  // Core handles player path (sacrificeBoostActive + HP reduction).
  // UI wrapper handles teammate path (teammate.buffs) and attacker resolution.
  if (target.type === 'player') {
    const player = attacker && attacker === battleState.player ? attacker : battleState.player;
    const logArr = [];
    const instructions = sacrificeBoostCore(player, weapon, logArr);
    logArr.forEach(msg => logBattleAction(msg));
    // Sync Core's player.sacrificeBoostActive to battleState
    if (player.sacrificeBoostActive) {
      battleState.sacrificeBoostActive = player.sacrificeBoostActive;
    }
    applyInstructionsToDom(instructions, {});
  } else {
    // Teammate path — keep original logic (Core only handles player sacrifice boost)
    const teammate = target.entity;
    let attackerName;
    if (attacker) {
      attackerName = attacker === battleState.player ? (battleState.player.name || 'User') : attacker.name;
    } else {
      attackerName = target.type === 'player' ? (battleState.player.name || 'User') : teammate.name;
    }
    const targetName = teammate.name;
    logBattleAction(`${attackerName} 对 ${targetName} 使用 ${weapon.name} 进行牺牲增益！`);
    const sacrificeDamage = Math.floor(weapon.attack * 0.5);
    const actualAttacker = attacker || teammate;
    actualAttacker.hp = Math.max(1, actualAttacker.hp - sacrificeDamage);
    logBattleAction(`${attackerName} 牺牲 ${sacrificeDamage} 点生命值！`);

    if (!teammate.buffs) teammate.buffs = [];
    const existingSacrificeBoost = teammate.buffs.find(buff => buff.type === 'sacrificeBoost');
    if (!existingSacrificeBoost) {
      const sacrificeBoostBuff = {
        name: '牺牲增益',
        type: 'sacrificeBoost',
        isPositive: true,
        duration: '本回合',
        attack: weapon.attack,
        hitRate: weapon.hitRate,
        critRate: weapon.critRate,
        attacksPerTurn: weapon.attacksPerTurn,
        targetsPerAttack: weapon.targetsPerAttack,
        weaponName: weapon.name,
        tooltipText: `攻击+${weapon.attack}，命中+${weapon.hitRate}%，暴击+${weapon.critRate}%，次数+${weapon.attacksPerTurn}，目标+${weapon.targetsPerAttack}`,
      };
      teammate.buffs.push(sacrificeBoostBuff);
      logBattleAction(`${targetName} 获得强大增益！本回合所有攻击都将获得 ${weapon.name} 的属性加成！`);
      logBattleAction(`增益效果：攻击+${weapon.attack}，命中+${weapon.hitRate}%，暴击+${weapon.critRate}%，次数+${weapon.attacksPerTurn}，目标+${weapon.targetsPerAttack}`);
    }
  }
}

function executeTeammateHealingSequence(teammate, weapon, weaponTemplate) {
  
  battleState.currentAttackCount = 0;
  
  function performNextHealing() {
    
    if (teammate.mp < weapon.mpCost) {
      logBattleAction(
        `${teammate.name} 蓝量不足！无法继续使用 ${weapon.name}。已完成 ${battleState.currentAttackCount} 次使用。`,
      );
      
      weapon.used = true;
      
      teammate.skillUsed = true;
      
      battleState.currentWeapon = null;
      
      battleState.attackInProgress = false;
      
      updatePlayerPanel();
      updateEnemyPanel();
      updateTeammateWeaponsList();
      return;
    }
    
    if (battleState.currentAttackCount >= weapon.attacksPerTurn) {
      
      weapon.used = true;
      
      teammate.skillUsed = true;
      
      battleState.currentWeapon = null;
      
      battleState.attackInProgress = false;
      
      updatePlayerPanel();
      updateEnemyPanel();
      updateTeammateWeaponsList();
      return;
    }
    
    battleState.currentAttackCount++;
    
    const healingNumber = battleState.currentAttackCount;
    if (weapon.attacksPerTurn > 1) {
      logBattleAction(`${teammate.name} 使用 ${weapon.name} 进行第 ${healingNumber}/${weapon.attacksPerTurn} 次治疗！`);
    }
    
    executeTeammateHealingAction(teammate, weapon, weaponTemplate, () => {
      
      teammate.mp = Math.max(0, teammate.mp - weapon.mpCost);
      if (weapon.mpCost > 0) {
        logBattleAction(`${teammate.name} 消耗 ${weapon.mpCost} 点法力值。剩余法力值: ${teammate.mp}`);
      }
      
      if (battleState.currentAttackCount < weapon.attacksPerTurn) {
        setTimeout(performNextHealing, 800);
      } else {
        
        weapon.used = true;
        teammate.skillUsed = true;
        battleState.currentWeapon = null;
        battleState.attackInProgress = false;
        updatePlayerPanel();
        updateEnemyPanel();
        updateTeammateWeaponsList();
      }
    });
  }
  
  performNextHealing();
}

function executeTeammateHealingAction(teammate, weapon, weaponTemplate, callback) {
  
  const targets = getHealingTargets(weapon, weaponTemplate, teammate);
  targets.forEach(target => {
    const targetName = target.type === 'player' ? battleState.player.name || 'User' : target.entity.name;

    if (weaponTemplate === 'A2') {
      performTeammateSingleHealing(teammate, weapon, target);
    } else if (weaponTemplate === 'A3') {
      performTeammateSingleManaRestore(teammate, weapon, target);
    } else if (weaponTemplate === 'A4') {
      performSingleSacrificeBoost(weapon, target, teammate);
    } else {
      performTeammateSingleHealing(teammate, weapon, target); 
    }

    processSupportEnchantmentEffects(weapon, target, targetName);
  });
  
  setTimeout(callback, 1200);
}

function performTeammateSingleHealing(teammate, weapon, target) {
  const targetName = target.type === 'player' ? battleState.player.name || 'User' : target.entity.name;
  
  let healAmount = weapon.attack;
  
  const critRoll = Math.random() * 100;
  const isCrit = critRoll <= weapon.critRate;
  if (isCrit) {
    const teammateStats = getTeammateActualStats(teammate);
    const critMultiplier = teammateStats.baseCritMultiplier;
    healAmount = Math.floor(healAmount * critMultiplier);
    logBattleAction(`${teammate.name} 暴击治疗！对 ${targetName} 恢复 ${healAmount} 点生命值！`);
  } else {
    logBattleAction(`${teammate.name} 对 ${targetName} 恢复 ${healAmount} 点生命值！`);
  }
  
  if (target.type === 'player') {
    const oldHp = battleState.player.hp;
    battleState.player.hp = Math.min(battleState.player.hp + healAmount, battleState.player.maxHp);
    const actualHeal = battleState.player.hp - oldHp;
    showHealNumber(actualHeal);
  } else if (target.type === 'teammate') {
    const oldHp = target.entity.hp;
    target.entity.hp = Math.min(target.entity.hp + healAmount, target.entity.maxHp);
    const actualHeal = target.entity.hp - oldHp;
    logBattleAction(`实际恢复了 ${actualHeal} 点生命值！`);
  } else if (target.type === 'enemy') {
    const oldHp = target.entity.hp;
    target.entity.hp = Math.min(target.entity.hp + healAmount, target.entity.maxHp);
    const actualHeal = target.entity.hp - oldHp;
    showHealNumberOnEnemy(actualHeal, target.entity.id);
  }
  
  addHealHate(teammate.id, teammate.name, healAmount);
}

function performTeammateSingleManaRestore(teammate, weapon, target) {
  const targetName = target.type === 'player' ? battleState.player.name || 'User' : target.entity.name;
  
  let manaAmount = weapon.attack;
  
  const critRoll = Math.random() * 100;
  const isCrit = critRoll <= weapon.critRate;
  if (isCrit) {
    const teammateStats = getTeammateActualStats(teammate);
    const critMultiplier = teammateStats.baseCritMultiplier;
    manaAmount = Math.floor(manaAmount * critMultiplier);
    logBattleAction(`${teammate.name} 暴击恢复！对 ${targetName} 恢复 ${manaAmount} 点法力值！`);
  } else {
    logBattleAction(`${teammate.name} 对 ${targetName} 恢复 ${manaAmount} 点法力值！`);
  }
  
  if (target.type === 'player') {
    const oldMp = battleState.player.mp;
    battleState.player.mp = Math.min(battleState.player.mp + manaAmount, battleState.player.maxMp);
    const actualRestore = battleState.player.mp - oldMp;
    logBattleAction(`实际恢复了 ${actualRestore} 点法力值！`);
  } else if (target.type === 'teammate') {
    const oldMp = target.entity.mp;
    target.entity.mp = Math.min(target.entity.mp + manaAmount, target.entity.maxMp);
    const actualRestore = target.entity.mp - oldMp;
    logBattleAction(`实际恢复了 ${actualRestore} 点法力值！`);
  }
}

    
// B3 fix: side effects wrapped into callable function (previously ran at import time)
// Item 4: 单例防护，防止重复注册 interval / runCmd 补丁
export function initializeBattleSideEffects() {
  if (sideEffectsState.initialized) return;

  // 5a: TooltipGenerator 已移至模块顶层，无需在此挂 window

  // ponytail: memoryManager removed — no cleanup handlers needed

  // Periodic lazy render state cleanup
  sideEffectsState.intervalId = setInterval(() => {
    try {
      if (!lazyRenderManager.shouldRenderPreparation()) {
        lazyRenderManager.isPreparationRendered = false;
      }
      if (!lazyRenderManager.shouldRenderCombat()) {
        lazyRenderManager.isCombatRendered = false;
      }
    } catch (error) {
      // silent
    }
  }, 60000);

  // Send detection
  setupSendDetection();

  sideEffectsState.initialized = true;
}

// Item 4: 清理所有 side effects（interval / resize handler / observer），重置 initialized
export function destroyBattleSideEffects() {
  if (sideEffectsState.intervalId) {
    clearInterval(sideEffectsState.intervalId);
    sideEffectsState.intervalId = null;
  }
  if (sideEffectsState.resizeHandler) {
    window.removeEventListener('resize', sideEffectsState.resizeHandler);
    sideEffectsState.resizeHandler = null;
  }
  if (sideEffectsState.beforeunloadHandler) {
    window.removeEventListener('beforeunload', sideEffectsState.beforeunloadHandler);
    sideEffectsState.beforeunloadHandler = null;
  }
  if (sideEffectsState.unloadHandler) {
    window.removeEventListener('unload', sideEffectsState.unloadHandler);
    sideEffectsState.unloadHandler = null;
  }
  if (sideEffectsState.runCmdPatched && sideEffectsState.originalRunCmd) {
    window.runCmd = sideEffectsState.originalRunCmd;
    sideEffectsState.originalRunCmd = null;
  }
  sideEffectsState.runCmdPatched = false;
  sideEffectsState.initialized = false;
}

// ============================================================
// 战斗状态序列化/反序列化（用于持久化到 chatMetadata）
// ============================================================

/**
 * 序列化战斗状态用于持久化
 * 剔除不可序列化的引用（如 DOM 元素、函数）
 */
export function serializeBattleState() {
    if (!battleState || !battleState.isActive) return null;
    try {
        return {
            isActive: battleState.isActive,
            round: battleState.round,
            player: battleState.player ? structuredClone(battleState.player) : null,
            teammates: battleState.teammates ? structuredClone(battleState.teammates) : [],
            enemies: battleState.enemies ? structuredClone(battleState.enemies) : [],
            initialEnemies: battleState.initialEnemies ? structuredClone(battleState.initialEnemies) : [],
            actionOrder: (battleState.actionOrder || []).map(a => ({
                type: a.type, id: a.id, name: a.name, speed: a.speed,
            })),
            currentActionIndex: battleState.currentActionIndex,
            playerBuffs: battleState.playerBuffs ? structuredClone(battleState.playerBuffs) : [],
            weaponUsage: battleState.weaponUsage ? structuredClone(battleState.weaponUsage) : {},
            itemUsageStats: battleState.itemUsageStats ? structuredClone(battleState.itemUsageStats) : {},
            killedEnemies: battleState.killedEnemies ? structuredClone(battleState.killedEnemies) : [],
            hateLists: typeof hateSystem !== 'undefined' && hateSystem.enemyHateLists ? structuredClone(hateSystem.enemyHateLists) : {},
        };
    } catch (e) {
        console.error('[BattleLogic] serializeBattleState 失败:', e);
        return null;
    }
}

/**
 * 从持久化数据恢复战斗状态
 * 重建 actionOrder 中的 entity 引用
 */
export function restoreBattleState(saved) {
    if (!saved || !saved.isActive) return false;
    try {
        battleState.isActive = true;
        battleState.round = saved.round;
        battleState.player = saved.player;
        battleState.teammates = saved.teammates || [];
        battleState.enemies = saved.enemies || [];
        battleState.initialEnemies = saved.initialEnemies || [];
        // 重建 actionOrder 中的 entity 引用
        battleState.actionOrder = (saved.actionOrder || []).map(a => {
            let entity = null;
            if (a.type === 'player') entity = battleState.player;
            else if (a.type === 'teammate') entity = battleState.teammates.find(t => t && t.id === a.id);
            else if (a.type === 'enemy') entity = battleState.enemies.find(e => e && e.id === a.id);
            return { ...a, entity };
        }).filter(a => a.entity);
        battleState.currentActionIndex = saved.currentActionIndex || 0;
        battleState.playerBuffs = saved.playerBuffs || [];
        battleState.weaponUsage = saved.weaponUsage || {};
        battleState.itemUsageStats = saved.itemUsageStats || {};
        battleState.killedEnemies = saved.killedEnemies || [];
        if (typeof hateSystem !== 'undefined' && saved.hateLists) {
            hateSystem.enemyHateLists = saved.hateLists;
        }
        return true;
    } catch (e) {
        console.error('[BattleLogic] restoreBattleState 失败:', e);
        return false;
    }
}

// 导出关键入口函数供渲染器调用
export { initializeInterface, startBattle, setupSendDetection, initializeBattleInterface, initializeBattleDom };