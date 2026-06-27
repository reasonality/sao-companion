// battle/battleMath.js — A-class pure math functions extracted from battleLogic.js
// Zero dependencies. Can be imported by battleLogic.js, battleCore.js, and test files.
// Extracted in P4a per SAO_COMPANION_2_AGENT_ARCHITECTURE.md §5.12

export function calculateDerivedStats(str, agi, int, vit) {
    
    str = str || 0;
    agi = agi || 0;
    int = int || 0;
    vit = vit || 0;
    return {
      
      hpRegen: 10 + vit + Math.floor((vit * vit) / 100),
      mpRegen: 5 + Math.floor(int / 4),
      actionPoints: 2 + Math.floor(vit / 20),
      
      speed: 50 + agi * 2,
      evasionRate: agi * 0.005,
      damageBonus: str * 0.01,
      physicalReduction: str * 1,
      damageTakenRate: 50 / (50 + vit),
      extraHitRate: agi * 0.01,
      extraCritRate: int * 0.01,
      baseCritMultiplier: 1.5 + int * 0.01,
      critRateResistance: agi * 0.005 + int * 0.005,
      critDamageResistance: str * 0.005 + int * 0.005,
    };
}

export function calculateFinalHitRate(weaponHitRate, attackerStats, targetStats) {
    
    const baseHitRate = weaponHitRate / 100;
    
    const extraHitRate = attackerStats.extraHitRate;
    
    const targetEvasionRate = targetStats.evasionRate;
    
    const finalHitRate = baseHitRate + extraHitRate - targetEvasionRate;
    
    return Math.max(0, finalHitRate);
}

export function calculateFinalCritRate(weaponCritRate, attackerStats, targetStats, finalHitRate) {
    
    const baseCritRate = weaponCritRate / 100;
    
    const extraCritRate = attackerStats.extraCritRate;
    
    const overHitCritBonus = Math.max(0, finalHitRate - 1.0) * 0.5;
    
    const targetCritResistance = targetStats.critRateResistance;
    
    const finalCritRate = baseCritRate + extraCritRate + overHitCritBonus - targetCritResistance;
    
    return Math.min(1.0, Math.max(0, finalCritRate));
}

export function calculateFinalCritMultiplier(attackerStats, targetStats, finalCritRate) {
    
    const baseCritMultiplier = attackerStats.baseCritMultiplier;
    
    const overCritDamageBonus = Math.max(0, finalCritRate - 1.0) * 0.5;
    
    const targetCritDamageResistance = targetStats.critDamageResistance;
    
    const finalCritMultiplier = baseCritMultiplier + overCritDamageBonus - targetCritDamageResistance;
    
    return Math.max(1.0, finalCritMultiplier);
}

export function calculateFinalDamage(weaponDamage, attackerStats, targetStats, isCrit = false, critMultiplier = 1.0) {
    
    const damageBonus = attackerStats.damageBonus;
    
    const targetDamageTakenRate = targetStats.damageTakenRate;
    
    const targetPhysicalReduction = targetStats.physicalReduction;
    
    let finalDamage = weaponDamage * (1 + damageBonus) * targetDamageTakenRate;
    
    if (isCrit) {
      finalDamage *= critMultiplier;
    }
    
    finalDamage -= targetPhysicalReduction;
    
    return Math.max(0, Math.floor(finalDamage));
}

export function getTeammateActualStats(teammate) {
  let str = teammate.str || 0;
  let agi = teammate.agi || 0;
  let int = teammate.int || 0;
  let end = teammate.vit || 0; 
  
  if (teammate.buffs) {
    teammate.buffs.forEach(buff => {
      switch (buff.type) {
        case 'strBoost':
          str += buff.value;
          break;
        case 'agiBoost':
          agi += buff.value;
          break;
        case 'intBoost':
          int += buff.value;
          break;
        case 'endBoost':
          end += buff.value;
          break;
      }
    });
  }
  
  const derivedStats = calculateDerivedStats(str, agi, int, end);
  return {
    str,
    agi,
    int,
    end,
    hpRegen: derivedStats.hpRegen,
    mpRegen: derivedStats.mpRegen,
    actionPoints: derivedStats.actionPoints,
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
  };
}

export function getEnemyActualStats(enemy) {
  let str = enemy.str || 0;
  let agi = enemy.agi || 0;
  let int = enemy.int || 0;
  let vit = enemy.vit || 0;
  
  if (enemy.buffs) {
    enemy.buffs.forEach(buff => {
      switch (buff.type) {
        case 'strBoost':
          str += buff.value;
          break;
        case 'agiBoost':
          agi += buff.value;
          break;
        case 'intBoost':
          int += buff.value;
          break;
        case 'endBoost':
          vit += buff.value;
          break;
      }
    });
  }
  
  const derivedStats = calculateDerivedStats(str, agi, int, vit);
  return {
    str,
    agi,
    int,
    vit,
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
  };
}
