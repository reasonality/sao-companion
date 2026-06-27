// battle/battleMath.js — A-class pure math functions extracted from battleLogic.js
// Zero dependencies. Can be imported by battleLogic.js, battleCore.js, and test files.
// Extracted in P4a per SAO_COMPANION_2_AGENT_ARCHITECTURE.md §5.12

/**
 * applyStatBuffs - Apply strBoost/agiBoost/intBoost/endBoost buffs to base stats
 * @param {{str:number,agi:number,int:number,end:number}} base - mutable base stats
 * @param {Array} buffs - buff array
 */
export function applyStatBuffs(base, buffs) {
  if (!buffs) return;
  for (let i = 0; i < buffs.length; i++) {
    const buff = buffs[i];
    switch (buff.type) {
      case 'strBoost': base.str += buff.value; break;
      case 'agiBoost': base.agi += buff.value; break;
      case 'intBoost': base.int += buff.value; break;
      case 'endBoost': base.end += buff.value; break;
    }
  }
}

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

/**
 * getActualStats - Unified stat calculation with buff application
 * @param {Object} entity - entity with str, agi, int, vit/end, buffs
 * @param {boolean} [useEndKey=false] - return 'end' instead of 'vit' for the 4th stat
 */
export function getActualStats(entity, useEndKey) {
  const base = {
    str: entity.str || 0,
    agi: entity.agi || 0,
    int: entity.int || 0,
    end: entity.vit || 0,
  };

  applyStatBuffs(base, entity.buffs);

  const derivedStats = calculateDerivedStats(base.str, base.agi, base.int, base.end);
  const fourthKey = useEndKey ? 'end' : 'vit';
  return {
    str: base.str, agi: base.agi, int: base.int,
    [fourthKey]: base.end,
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

export function getTeammateActualStats(teammate) {
  return getActualStats(teammate, true);
}

export function getEnemyActualStats(enemy) {
  return getActualStats(enemy, false);
}
