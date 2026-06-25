// battle/battleTemplate.js
// HTML 模板 + CSS 字符串 - 从卡片正则迁移
// 原始 HTML 中 $1 是正则替换占位符，已移除（数据通过 JS 传入）

export function getBattleTemplate() {
    return `
<link rel="stylesheet" href="/css/fontawesome.min.css" />
<link rel="stylesheet" href="/css/solid.min.css" />
    <div id="status-data-source" style="display: none"></div>
    <div class="container">
      <details id="preparation-details" class="preparation-details">
        <summary class="preparation-summary">战前准备</summary>
        <div id="preparation-screen" class="status-bar" style="overflow: hidden; max-height: 0">
          <div class="status-header">
            <h2 id="status-title">战斗准备</h2>
          </div>
          <div id="player-status" class="player-status"></div>
          <div id="pilots-container" class="pilots-container"></div>
          <div id="combat-controls" style="margin-top: 10px; text-align: center"></div>
        </div>
      </details>
    </div>
    <div id="combat-interface" class="container">
      <h3 id="combat-title">战斗中</h3>
      
      <div id="action-order-container" class="action-order-container">
        <div class="action-order-title"><i class="fas fa-list-ol"></i> 行动顺序</div>
        <div id="action-order-display" class="action-order-display"></div>
      </div>
      <div id="combat-display">
        <div id="combat-player-panel"></div>
        <div id="combat-enemy-panel"></div>
      </div>
      <div id="combat-player-actions">
        <div class="weapons-title"><i class="fas fa-tasks"></i> 选择行动</div>
        <div class="weapon-category-toggle">
          <div id="melee-toggle" class="category-button active"><i class="fas fa-sword"></i> 剑技</div>
          <div id="items-toggle" class="category-button"><i class="fas fa-box-archive"></i> 道具</div>
          <div id="stats-toggle" class="category-button"><i class="fas fa-chart-bar"></i> 详细属性</div>
        </div>
        <div id="melee-panel" class="weapon-panel active">
          <div id="melee-weapon-list" class="weapon-buttons"></div>
        </div>
        <div id="items-panel" class="weapon-panel">
          <div id="items-list" class="item-buttons"></div>
        </div>
        <div id="stats-panel" class="weapon-panel">
          <div id="detailed-stats-display"></div>
        </div>
        <div class="attack-controls">
          <button id="attack-btn" class="attack-button" disabled><i class="fas fa-hand-fist"></i> 攻击选中目标</button>
          <button id="next-round-btn" class="next-round-button">
            <i class="fas fa-arrow-right-to-bracket"></i> 跳过当前行动
          </button>
          <button id="mid-action-btn" class="mid-action-button"><i class="fas fa-pause"></i> 中途行动</button>
        </div>
      </div>
      <div id="combat-log-container">
        <div class="weapons-title"><i class="fas fa-scroll"></i> 战斗记录</div>
        <div id="combat-log"></div>
      </div>
    </div>
    <div id="result-modal" class="result-modal">
      <div class="result-content">
        <h2 class="result-title"><i class="fas fa-flag-checkered"></i> 战斗结果</h2>
        <div id="result-summary" class="result-summary"></div>
        
        <div class="result-extra-text">
          <textarea id="extra-result-text" placeholder="在此输入额外文字，将与战斗结果一起发送"></textarea>
        </div>
        <button id="send-result" class="btn" style="background-color: var(--success-color)">
          <i class="fas fa-paper-plane"></i> 发送结果
        </button>
        <button id="close-result" class="btn" style="margin-left: 10px"><i class="fas fa-times"></i> 取消</button>
      </div>
    </div>    `;
}

export function getBattleCSS() {
    return `

      
      :root {
        --bg-color: #1a1a2e;
        --bg-secondary: #16213e;
        --bg-tertiary: #0f172a;
        --card-bg: rgba(30, 41, 59, 0.8);
        --card-bg-solid: #1e293b;
        --card-border: #334155;
        --primary-color: #8b5cf6;
        --primary-light: #a78bfa;
        --primary-dark: #7c3aed;
        --secondary-color: #ef4444;
        --accent-color: #06b6d4;
        --text-color: #e2e8f0;
        --text-light: #94a3b8;
        --text-muted: #64748b;
        --border-color: #374151;
        --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
        --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
        --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
        --shadow-glow: 0 0 20px rgba(139, 92, 246, 0.3);
        --font-rpg: system-ui, -apple-system, sans-serif;
        --health-color: #ef4444;
        --health-bg: rgba(239, 68, 68, 0.2);
        --mana-color: #3b82f6;
        --mana-bg: rgba(59, 130, 246, 0.2);
        --success-color: #10b981;
        --heal-color: #10b981;
        --fire-color: #f97316;
        --ice-color: #0ea5e9;
        --lightning-color: #a855f7;
        --gradient-primary: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
        --gradient-secondary: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
      }
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  background: transparent;
  color: var(--text-color);
  font-family: var(--font-rpg);
  padding: 5px;
  font-size: 14px;
  margin: 0;
}
.container {
  width: 100%;
  max-width: 800px;
  border-radius: 15px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  background: rgba(30, 41, 59, 0.95);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(51, 65, 85, 0.8);
  margin: 0 auto 5px;
}
.status-bar {
  width: 100%;
  background: rgba(30, 41, 59, 0.9);
  border-radius: 15px;
  padding: 10px;
  border: 1px solid rgba(51, 65, 85, 0.6);
  backdrop-filter: blur(10px);
}
.status-header {
  text-align: center;
  margin-bottom: 5px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}
.status-header h2 {
  font-size: 18px;
  color: var(--primary-color);
  text-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
  font-weight: 600;
}
.player-status,
.pilots-container,
.teammates-status {
  margin-bottom: 5px;
  padding: 8px;
  background: rgba(22, 33, 62, 0.8);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  border: 1px solid rgba(51, 65, 85, 0.5);
  backdrop-filter: blur(8px);
}
.teammates-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-height: 110px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 0;
}
.teammate-item {
  padding: 6px;
  background: rgba(30, 41, 59, 0.7);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--primary-color);
  transition: all 0.3s ease;
  backdrop-filter: blur(5px);
}
.teammate-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
  border-color: var(--primary-light);
}
.teammate-item.selectable {
  cursor: pointer;
}
.teammate-item:not(.selected) {
  opacity: 0.6;
  filter: grayscale(30%);
}
.teammate-item.selected {
  opacity: 1;
  filter: none;
}
.teammate-name {
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 4px;
  color: var(--primary-light);
  text-shadow: 0 0 5px rgba(167, 139, 250, 0.3);
}
.teammate-hp,
.teammate-mp,
.teammate-ap {
  display: flex;
  align-items: center;
  margin-bottom: 4px; 
}
.teammate-agility,
.teammate-speed,
.teammate-stats {
  font-size: 11px;
  color: var(--text-light);
  margin-top: 5px;
  display: inline-block;
  padding: 3px 6px;
  background: var(--bg-color);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  cursor: help;
  margin-right: 5px;
}
.teammate-weapons h4 {
  font-size: 11px;
  margin: 4px 0;
  color: #6366f1;
}

.teammate-item .weapons-list {
  max-height: 120px;
  overflow-y: auto;
  padding-right: 3px;
  margin-bottom: 5px;
}
.teammate-item .weapon-item {
  padding: 4px;
  margin-bottom: 3px;
}
.teammate-item .weapon-name {
  font-size: 10px;
  margin-bottom: 2px;
}
.teammate-item .weapon-stats {
  font-size: 8px;
}
.teammate-item .weapon-effect-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 3px;
}
.teammate-item .weapon-effect-code {
  font-size: 8px;
  padding: 1px 3px;
  border-radius: 3px;
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid #6366f1;
  position: relative;
  cursor: help;
}
.player-info {
  margin-bottom: 10px;
}
.player-name {
  font-size: 15px;
  font-weight: bold;
  margin-bottom: 8px;
  color: var(--primary-color);
}
.player-hp,
.player-mp,
.player-ap {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.hp-label,
.mp-label {
  width: 25px;
  font-weight: bold;
  font-size: 11px;
}
.hp-bar,
.mp-bar,
.ap-bar {
  flex-grow: 1;
  height: 18px;
  background: var(--bg-tertiary);
  border-radius: 10px;
  overflow: hidden;
  margin: 0 8px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  position: relative;
  border: 1px solid var(--border-color);
}
.hp-fill {
  height: 100%;
  background: var(--gradient-secondary);
  border-radius: 10px;
  transition: width 0.5s ease;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.3);
}
.mp-fill {
  height: 100%;
  background: var(--gradient-primary);
  border-radius: 10px;
  transition: width 0.5s ease;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
}
.ap-fill {
  height: 100%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  border-radius: 10px;
  transition: width 0.5s ease;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.3);
}
.hp-text,
.mp-text,
.ap-text {
  min-width: 120px;
  text-align: right;
  font-weight: bold;
  font-size: 11px;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.player-agility,
.player-stats,
.teammate-agility,
.teammate-speed,
.teammate-stats {
  font-size: 11px;
  color: var(--text-light);
  margin-top: 5px;
  display: inline-block;
  padding: 3px 6px;
  background: var(--bg-tertiary);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  cursor: help;
  margin-right: 8px;
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
}
.player-agility:hover,
.player-stats:hover,
.teammate-agility:hover,
.teammate-speed:hover,
.teammate-stats:hover {
  background: var(--primary-color);
  color: white;
  transform: translateY(-1px);
}
.tooltip {
  position: relative;
  display: inline-block;
}
.tooltip .tooltip-text {
  visibility: hidden;
  width: 180px;
  background: rgba(0, 0, 0, 0.9);
  color: #ffffff;
  text-align: center;
  border-radius: 6px;
  padding: 6px;
  position: absolute;
  z-index: 999;
  bottom: 125%;
  left: 50%;
  margin-left: -90px;
  opacity: 0;
  transition: opacity 0.3s;
  font-size: 11px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  border: 1px solid var(--primary-color);
  pointer-events: none;
  backdrop-filter: blur(10px);
}
.tooltip .tooltip-text::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: rgba(0, 0, 0, 0.9) transparent transparent transparent;
}
.tooltip:hover .tooltip-text {
  visibility: visible;
  opacity: 1;
}
.fa,
.fas,
.far,
.fal,
.fad,
.fab,
.fa-solid {
  margin-right: 5px;
  vertical-align: middle;
}
.player-weapons h3,
.player-items h3 {
  font-size: 14px;
  margin-bottom: 8px;
  color: var(--primary-light);
}
.weapons-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
  max-height: 140px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 5px;
}
.weapon-item {
  padding: 8px;
  background: rgba(30, 41, 59, 0.7);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  transition: all 0.3s ease;
  border: 1px solid var(--border-color);
  position: relative;
  backdrop-filter: blur(5px);
}
.weapon-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
  border-color: var(--primary-color);
}
.weapon-name {
  font-weight: bold;
  margin-bottom: 4px;
  color: var(--primary-light);
  font-size: 12px;
}
.weapon-type {
  font-size: 10px;
  margin-bottom: 4px;
  color: var(--text-muted);
  display: inline-block;
  padding: 2px 5px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}
.weapon-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 9px;
  margin-top: 5px;
}
.weapon-stat {
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  color: var(--text-light);
  position: relative;
  border: 1px solid var(--border-color);
  font-size: 9px;
}
.pilots-container h3 {
  font-size: 14px;
  margin-bottom: 8px;
  color: var(--secondary-color);
}
.enemies-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
  max-height: 140px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 5px;
}
.enemy-item {
  padding: 8px;
  background: rgba(30, 41, 59, 0.7);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(5px);
}
.enemy-item:not(.selected) {
  opacity: 0.6;
  border-color: var(--text-muted);
}
.enemy-item.selected {
  border-color: var(--secondary-color);
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);
  opacity: 1;
}
.enemy-item:hover {
  transform: translateY(-2px);
  opacity: 1;
}
.enemy-name {
  font-weight: bold;
  margin-bottom: 4px;
  color: var(--secondary-color);
  font-size: 12px;
}
.enemy-hp {
  display: flex;
  align-items: center;
  margin-bottom: 5px;
}
.enemy-agility {
  font-size: 10px;
  margin-bottom: 4px;
  color: var(--text-muted);
  display: inline-block;
  padding: 2px 5px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  cursor: help;
  border: 1px solid var(--border-color);
}
.enemy-skills {
  font-size: 10px;
  color: var(--text-light);
  margin-top: 4px;
  padding: 4px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  border: 1px solid var(--border-color);
}
.battle-button {
  display: block;
  margin: 0 auto;
  padding: 7px 14px;
  background: var(--gradient-primary);
  color: white;
  border: none;
  border-radius: 16px;
  font-family: var(--font-rpg);
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: all 0.3s ease;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.battle-button:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-glow);
  background: var(--gradient-secondary);
}
.battle-button:active {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
#combat-interface {
  width: 100%;
  max-width: 800px;
  display: none;
  border-radius: 15px;
  overflow: hidden;
  background: rgba(30, 41, 59, 0.95);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(51, 65, 85, 0.8);
}
#combat-display {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 8px;
}
#combat-player-panel {
  max-height: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 5px;
}
.combat-entity {
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 6px;
  position: relative;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid transparent;
}
.combat-entity.player {
  border-color: var(--primary-color);
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.2);
}
.combat-entity.teammate {
  border-color: var(--accent-color);
  padding: 6px;
  margin-bottom: 4px;
}
.combat-entity.teammate.current-teammate {
  box-shadow: 0 0 20px rgba(6, 182, 212, 0.4);
  transform: translateY(-2px);
}
.combat-entity.enemy {
  border-color: var(--secondary-color);
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
}
.combat-entity.selected {
  border-color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
  transform: translateY(-2px);
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.3);
}
.combat-entity.current-actor {
  box-shadow: 0 0 25px rgba(251, 191, 36, 0.5);
  animation: pulse-gold 2s infinite;
}

      @keyframes pulse-gold {
        0% {
          box-shadow: 0 0 25px rgba(251, 191, 36, 0.5);
        }
        50% {
          box-shadow: 0 0 35px rgba(251, 191, 36, 0.8);
        }
        100% {
          box-shadow: 0 0 25px rgba(251, 191, 36, 0.5);
        }
      }
      .entity-header {
        margin-bottom: 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border-color);
      }
      .entity-name {
        font-size: 13px;
        font-weight: bold;
        color: var(--primary-light);
      }
      .combat-entity.enemy .entity-name {
        color: var(--secondary-color);
      }
      .entity-stats {
        margin-bottom: 6px;
      }
      .hp-bar-container,
      .mp-bar-container,
      .ap-bar-container,
      .shield-bar-container {
        display: flex;
        align-items: center;
        margin-bottom: 4px;
      }
      .hp-bar-label,
      .mp-bar-label,
      .ap-bar-label,
      .shield-bar-label {
        font-weight: bold;
        width: 25px;
        margin-right: 8px;
        font-size: 11px;
        color: var(--text-light);
      }
      .hp-bar-combat,
      .mp-bar-combat,
      .ap-bar-combat,
      .shield-bar-combat {
        flex-grow: 1;
        height: 14px;
        background: var(--bg-tertiary);
        border-radius: 7px;
        overflow: visible;
        position: relative;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border-color);
        min-width: 150px;
      }
      .hp-fill-combat {
        height: 100%;
        background: var(--gradient-secondary);
        border-radius: 7px;
        transition: width 0.5s ease;
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
      }
      .mp-fill-combat {
        height: 100%;
        background: var(--gradient-primary);
        border-radius: 7px;
        transition: width 0.5s ease;
        box-shadow: 0 0 8px rgba(59, 130, 246, 0.3);
      }
      .ap-fill-combat {
        height: 100%;
        background: linear-gradient(135deg, #fbbf24, #f59e0b);
        border-radius: 7px;
        transition: width 0.5s ease;
        box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
      }
      .shield-bar-combat {
        background: rgba(6, 182, 212, 0.15);
        border: 1px solid rgba(6, 182, 212, 0.4);
        border-radius: 7px;
        overflow: visible;
        position: relative;
      }
      .hp-text-combat,
      .mp-text-combat,
      .ap-text-combat,
      .shield-text-combat {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: var(--text-color);
        font-weight: bold;
        font-size: 9px;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        white-space: nowrap;
        width: max-content;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .shield-text-combat {
        color: #06b6d4;
      }
      .stat-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 6px;
      }
      .stat-box {
        padding: 5px;
        background-color: var(--card-bg);
        border-radius: 5px;
        box-shadow: var(--shadow-sm);
        text-align: center;
        cursor: help;
      }
      
      .stat-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1px 4px;
        margin: 1px 0;
        font-size: 10px;
        line-height: 1.2;
        border-radius: 3px;
        transition: background-color 0.2s ease;
      }
      .stat-row:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }
      .stat-row-label {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: 9px;
        opacity: 0.9;
      }
      .stat-row-label i {
        font-size: 8px;
        width: 12px;
        text-align: center;
      }
      .stat-row-value {
        font-size: 10px;
        font-weight: 500;
        text-align: right;
      }
      
      #detailed-stats-display .stat-row {
        padding: 3px 6px;
        margin: 2px 0;
        font-size: 12px;
        line-height: 1.4;
      }
      #detailed-stats-display .stat-row-label {
        gap: 4px;
        font-size: 11px;
      }
      #detailed-stats-display .stat-row-label i {
        font-size: 10px;
        width: 14px;
      }
      #detailed-stats-display .stat-row-value {
        font-size: 12px;
        font-weight: 600;
      }
      
      #detailed-stats-display .category-title {
        font-size: 12px;
      }
      #detailed-stats-display .stat-badge {
        font-size: 12px;
        padding: 8px 10px;
      }
      #detailed-stats-display .stat-badge i {
        font-size: 13px;
      }
      
      .stat-row.str-based {
        border-left: 2px solid #ff6b6b;
      }
      .stat-row.agi-based {
        border-left: 2px solid #4ecdc4;
      }
      .stat-row.int-based {
        border-left: 2px solid #45b7d1;
      }
      .stat-row.vit-based {
        border-left: 2px solid #96ceb4;
      }
      .stat-row.resistance {
        border-left: 2px solid #feca57;
      }
      .stat-row.recovery {
        border-left: 2px solid #ec4899;
      }
      
      .stat-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 8px;
        background: rgba(139, 92, 246, 0.15);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        color: var(--text-color);
        transition: all 0.3s ease;
        text-align: center;
      }
      .stat-badge:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(139, 92, 246, 0.3);
      }
      .stat-badge.str-based {
        background: rgba(239, 68, 68, 0.15);
        border-color: rgba(239, 68, 68, 0.4);
        color: #fca5a5;
      }
      .stat-badge.agi-based {
        background: rgba(16, 185, 129, 0.15);
        border-color: rgba(16, 185, 129, 0.4);
        color: #6ee7b7;
      }
      .stat-badge.int-based {
        background: rgba(139, 92, 246, 0.15);
        border-color: rgba(139, 92, 246, 0.4);
        color: #c4b5fd;
      }
      .stat-badge.vit-based {
        background: rgba(245, 158, 11, 0.15);
        border-color: rgba(245, 158, 11, 0.4);
        color: #fcd34d;
      }
      .stat-badge i {
        font-size: 11px;
      }
      
      .character-selector {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px;
        background: var(--bg-tertiary);
        border-radius: 10px;
        margin-bottom: 10px;
        border: 1px solid var(--border-color);
      }
      .char-select-btn {
        flex: 1;
        min-width: 80px;
        padding: 8px 12px;
        background: rgba(139, 92, 246, 0.1);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 8px;
        color: var(--text-light);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .char-select-btn:hover {
        background: rgba(139, 92, 246, 0.2);
        border-color: rgba(139, 92, 246, 0.5);
        color: var(--text-color);
        transform: translateY(-1px);
      }
      .char-select-btn.active {
        background: var(--gradient-primary);
        border-color: var(--primary-light);
        color: white;
        box-shadow: var(--shadow-glow);
        font-weight: 600;
      }
      .char-select-btn.enemy {
        background: rgba(239, 68, 68, 0.1);
        border-color: rgba(239, 68, 68, 0.3);
      }
      .char-select-btn.enemy:hover {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.5);
      }
      .char-select-btn.enemy.active {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        border-color: #f87171;
      }
      .char-select-btn i {
        font-size: 12px;
      }
      
      .stats-compact {
        max-height: 180px;
        overflow-y: auto;
        padding: 3px;
      }
      .stats-compact::-webkit-scrollbar {
        width: 4px;
      }
      .stats-compact::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
      }
      .stats-compact::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 2px;
      }
      .stats-compact::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.5);
      }
      .stat-label {
        font-size: 9px;
        color: var(--text-light);
        margin-bottom: 2px;
      }
      .stat-value {
        font-size: 11px;
        font-weight: bold;
        color: var(--text-color);
      }
      
      .stat-category {
        grid-column: 1 / -1;
        margin-bottom: 8px;
      }
      .category-title {
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color);
        margin-bottom: 4px;
        text-align: center;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 2px;
      }
      .stat-row {
        display: flex;
        justify-content: space-around;
        font-size: 10px;
        color: var(--text-color);
      }
      .stat-name {
        font-weight: bold;
      }
      
      .str-based {
        border-left: 3px solid #ff6b6b; 
      }
      .agi-based {
        border-left: 3px solid #4ecdc4; 
      }
      .int-based {
        border-left: 3px solid #45b7d1; 
      }
      .vit-based {
        border-left: 3px solid #96ceb4; 
      }
      .resistance {
        border-left: 3px solid #feca57; 
      }
      .entity-next-attack {
        margin-bottom: 8px;
        padding: 6px;
        background-color: var(--card-bg);
        border-radius: 5px;
        box-shadow: var(--shadow-sm);
      }
      .next-attack-title,
      .weapons-title {
        font-size: 11px;
        font-weight: bold;
        margin-bottom: 5px;
        color: var(--text-light);
      }
      .next-attack-name {
        font-size: 12px;
        font-weight: bold;
        color: var(--secondary-color);
      }
      
      .skill-stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin-top: 6px;
      }
      .skill-stat-item {
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
        text-align: center;
        transition: all 0.2s ease;
        position: relative;
        border: 1px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
      }
      .skill-stat-item i {
        font-size: 9px;
        width: 12px;
        text-align: center;
      }
      
      .skill-attack {
        background: linear-gradient(135deg, #ff6b6b20, #ff6b6b10);
        color: #d63031;
        border-color: #ff6b6b40;
      }
      .skill-accuracy {
        background: linear-gradient(135deg, #4dabf720, #4dabf710);
        color: #0984e3;
        border-color: #4dabf740;
      }
      .skill-targets {
        background: linear-gradient(135deg, #00b89420, #00b89410);
        color: #00a085;
        border-color: #00b89440;
      }
      .skill-times {
        background: linear-gradient(135deg, #a29bfe20, #a29bfe10);
        color: #6c5ce7;
        border-color: #a29bfe40;
      }
      
      .skill-stat-item:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        border-color: var(--secondary-color);
      }
      .skill-attack:hover {
        background: linear-gradient(135deg, #ff6b6b30, #ff6b6b20);
        border-color: #ff6b6b;
      }
      .skill-accuracy:hover {
        background: linear-gradient(135deg, #4dabf730, #4dabf720);
        border-color: #4dabf7;
      }
      .skill-targets:hover {
        background: linear-gradient(135deg, #00b89430, #00b89420);
        border-color: #00b894;
      }
      .skill-times:hover {
        background: linear-gradient(135deg, #a29bfe30, #a29bfe20);
        border-color: #a29bfe;
      }
      
      .stats-toggle-btn {
        background: rgba(139, 92, 246, 0.2);
        border: 1px solid var(--primary-color);
        color: var(--primary-light);
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-bottom: 6px;
        width: 100%;
        text-align: center;
      }
      .stats-toggle-btn:hover {
        background: rgba(139, 92, 246, 0.3);
        transform: translateY(-1px);
      }
      .stats-collapsible {
        overflow: hidden;
        transition: max-height 0.3s ease;
        max-height: 0;
      }
      .stats-collapsible.expanded {
        max-height: 200px;
      }
      .stats-toggle-btn .toggle-icon {
        transition: transform 0.3s ease;
        display: inline-block;
        margin-left: 4px;
      }
      .stats-toggle-btn.expanded .toggle-icon {
        transform: rotate(180deg);
      }
      .entity-buffs {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 6px;
      }
      
      .entity-hate-list {
        margin-top: 6px;
        padding: 6px;
        background: var(--bg-tertiary);
        border-radius: 8px;
        border: 1px solid var(--border-color);
      }
      .hate-list-title {
        font-size: 11px;
        font-weight: bold;
        color: var(--secondary-color);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .hate-list-content {
        max-height: 80px;
        overflow-y: auto;
      }
      .hate-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 6px;
        margin-bottom: 2px;
        background: var(--card-bg);
        border-radius: 6px;
        font-size: 10px;
        border: 1px solid var(--border-color);
        transition: all 0.2s ease;
      }
      .hate-item.current-target {
        background: rgba(239, 68, 68, 0.2);
        border-color: var(--secondary-color);
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
      }
      .hate-item.no-target {
        text-align: center;
        color: var(--text-light);
        font-style: italic;
        background: transparent;
        border: 1px dashed var(--border-color);
      }
      .hate-target-name {
        font-weight: bold;
        color: var(--text-color);
      }
      .hate-value {
        background: var(--secondary-color);
        color: white;
        padding: 1px 4px;
        border-radius: 4px;
        font-size: 9px;
        font-weight: bold;
        min-width: 20px;
        text-align: center;
      }
      .buff {
        padding: 3px 6px;
        border-radius: 10px;
        font-size: 10px;
        display: flex;
        align-items: center;
        cursor: help;
      }
      .buff.positive {
        background-color: var(--mana-bg);
        color: var(--mana-color);
      }
      .buff.negative {
        background-color: var(--health-bg);
        color: var(--health-color);
      }
      .buff.fire {
        background-color: #ffedd5;
        color: var(--fire-color);
      }
      .buff.ice {
        background-color: #e0f2fe;
        color: var(--ice-color);
      }
      .buff.lightning {
        background-color: #f3e8ff;
        color: var(--lightning-color);
      }
      .buff-name {
        margin-right: 4px;
        font-weight: bold;
      }
      .buff-duration {
        font-size: 8px;
        background-color: rgba(255, 255, 255, 0.5);
        padding: 1px 3px;
        border-radius: 5px;
      }
      
      .weapon-category-toggle {
        display: flex;
        justify-content: space-around;
        margin-bottom: 8px;
        background: var(--bg-tertiary);
        border-radius: 12px;
        padding: 3px;
        border: 1px solid var(--border-color);
      }
      .category-button {
        padding: 6px 12px;
        background: transparent;
        border: none;
        border-radius: 10px;
        font-family: var(--font-rpg);
        cursor: pointer;
        font-weight: bold;
        transition: all 0.3s ease;
        flex: 1;
        margin: 0 2px;
        text-align: center;
        color: var(--text-light);
        font-size: 12px;
      }
      .category-button.active {
        background: var(--gradient-primary);
        color: white;
        box-shadow: var(--shadow-md);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .category-button:hover:not(.active) {
        background: var(--card-bg);
        color: var(--text-color);
      }
      
      .weapon-panel {
        display: none;
        padding: 8px;
        background: var(--bg-secondary);
        border-radius: 10px;
        margin-bottom: 8px;
        border: 1px solid var(--border-color);
      }
      .weapon-panel.active {
        display: block;
      }
      .weapon-buttons,
      .item-buttons {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 6px;
        margin-bottom: 6px;
        max-height: 120px;
        overflow-y: auto;
        padding-right: 5px;
      }
      .weapon-button,
      .item-button {
        padding: 6px;
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        font-family: var(--font-rpg);
        cursor: pointer;
        text-align: left;
        box-shadow: var(--shadow-sm);
        font-size: 10px;
        position: relative;
        transition: all 0.3s ease;
        color: var(--text-color);
      }
      .weapon-button:hover:not(.used),
      .item-button:hover:not(.used) {
        transform: translateY(-2px);
        box-shadow: var(--shadow-glow);
        border-color: var(--primary-color);
      }
      .weapon-button.selected,
      .item-button.selected {
        background: var(--gradient-primary);
        color: white;
        box-shadow: var(--shadow-glow);
        border-color: var(--primary-light);
      }
      .weapon-button.used,
      .item-button.used {
        opacity: 0.4;
        cursor: not-allowed;
        background: var(--bg-tertiary);
        filter: brightness(0.6);
        border-color: var(--text-muted);
      }
      .weapon-button-name {
        font-weight: bold;
        margin-bottom: 4px;
        font-size: 11px;
      }
      .weapon-button-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        font-size: 9px;
        margin-bottom: 3px; 
      }
      .weapon-effect-codes {
        margin-top: 3px;
        font-size: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
      }
      .weapon-effect-code {
        padding: 1px 2px;
        background-color: rgba(0, 0, 0, 0.05);
        border-radius: 2px;
        position: relative;
      }
      .weapon-button.selected .weapon-effect-code {
        background-color: rgba(255, 255, 255, 0.2);
      }
      .item-button {
        padding: 6px;
        background-color: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        font-family: var(--font-rpg);
        cursor: pointer;
        text-align: left;
        box-shadow: var(--shadow-sm);
        font-size: 10px;
        position: relative;
        transition: all 0.2s ease;
      }
      .item-button:hover:not(.used) {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }
      .item-button.selected {
        background-color: var(--primary-color);
        color: white;
        box-shadow: var(--shadow-md);
        border-color: var(--primary-color);
      }
      .item-button.used {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: #2a2a2a;
        color: #666;
      }
      .item-button-name {
        font-weight: bold;
        margin-bottom: 4px;
        font-size: 11px;
      }
      .item-button-count {
        display: inline-block;
        background-color: rgba(0, 0, 0, 0.1);
        padding: 1px 4px;
        border-radius: 10px;
        font-size: 9px;
        margin-left: 4px;
      }
      .item-button-effect {
        font-size: 9px;
        color: var(--text-light);
        margin-top: 4px;
      }
      .item-button.selected .item-button-effect {
        color: rgba(255, 255, 255, 0.8);
      }
      .attack-controls {
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 8px;
      }
      .attack-button,
      .next-round-button,
      .mid-action-button {
        padding: 6px 12px;
        border: none;
        border-radius: 14px;
        font-family: var(--font-rpg);
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: var(--shadow-md);
        transition: all 0.3s ease;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .attack-button {
        background: var(--gradient-secondary);
        color: white;
      }
      .attack-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: var(--shadow-glow);
      }
      .attack-button:disabled {
        background: var(--text-muted);
        opacity: 0.5;
        cursor: not-allowed;
      }
      .next-round-button {
        background: var(--gradient-primary);
        color: white;
      }
      .next-round-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: var(--shadow-glow);
      }
      .mid-action-button {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: white;
      }
      .mid-action-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
      }
      #combat-log-container {
        margin: 8px;
        padding: 8px;
        background: var(--bg-secondary);
        border-radius: 10px;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-color);
      }
      #combat-log {
        height: 150px;
        overflow-y: auto;
        background: var(--bg-tertiary);
        border-radius: 8px;
        padding: 6px;
        font-size: 11px;
        color: var(--text-color);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        margin-top: 5px;
        border: 1px solid var(--border-color);
      }
      .log-entry {
        margin-bottom: 4px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border-color);
      }
      .result-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(5px);
        justify-content: center;
        align-items: center;
        z-index: 2147483647;
      }
      .result-content {
        width: 90%;
        max-width: 400px;
        background: rgba(30, 41, 59, 0.95);
        border-radius: 20px;
        padding: 25px;
        box-shadow: var(--shadow-lg);
        text-align: center;
        border: 1px solid rgba(51, 65, 85, 0.8);
        backdrop-filter: blur(15px);
      }
      .result-title {
        font-size: 18px;
        margin-bottom: 15px;
        color: var(--primary-light);
      }
      .victory {
        color: var(--success-color);
      }
      .defeat {
        color: var(--secondary-color);
      }
      .result-summary {
        margin-bottom: 20px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-light);
      }
      .btn {
        padding: 10px 20px;
        background: var(--gradient-primary);
        color: white;
        border: none;
        border-radius: 18px;
        font-family: var(--font-rpg);
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: var(--shadow-md);
        transition: all 0.3s ease;
        margin: 0 5px;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-glow);
      }
      
      ::-webkit-scrollbar {
        width: 6px;
      }
      ::-webkit-scrollbar-track {
        background: var(--bg-tertiary);
        border-radius: 6px;
      }
      ::-webkit-scrollbar-thumb {
        background: var(--primary-color);
        border-radius: 6px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--primary-light);
      }
      
      .action-order-container {
        margin: 10px;
        padding: 8px;
        background-color: var(--bg-color);
        border-radius: 8px;
        box-shadow: var(--shadow-sm);
      }
      .action-order-title {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 8px;
        color: var(--primary-color);
      }
      .action-order-display {
        display: flex;
        overflow-x: auto;
        padding: 5px 0;
        margin-bottom: 5px;
      }
      .action-order-item {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 0 5px;
        padding: 5px;
        border-radius: 5px;
        min-width: 60px;
        position: relative;
      }
      .action-order-item.player,
      .action-order-item.teammate {
        background-color: rgba(99, 102, 241, 0.1);
        border: 1px solid var(--primary-color);
      }
      .action-order-item.enemy {
        background-color: rgba(244, 63, 94, 0.1);
        border: 1px solid var(--secondary-color);
      }
      .action-order-item.current {
        transform: translateY(-5px);
        box-shadow: var(--shadow-md);
      }
      .action-order-item.player.current,
      .action-order-item.teammate.current {
        background-color: rgba(99, 102, 241, 0.2);
      }
      .action-order-item.enemy.current {
        background-color: rgba(244, 63, 94, 0.2);
      }
      .action-order-name {
        font-size: 11px;
        font-weight: bold;
        margin-bottom: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 80px;
      }
      .action-order-item.player .action-order-name,
      .action-order-item.teammate .action-order-name {
        color: var(--primary-color);
      }
      .action-order-item.enemy .action-order-name {
        color: var(--secondary-color);
      }
      .action-order-speed {
        font-size: 9px;
        color: var(--text-light);
      }
      .action-order-number {
        position: absolute;
        top: -8px;
        right: -8px;
        background-color: var(--card-bg);
        border-radius: 50%;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: bold;
        box-shadow: var(--shadow-sm);
      }
      .action-order-item.player .action-order-number,
      .action-order-item.teammate .action-order-number {
        color: var(--primary-color);
        border: 1px solid var(--primary-color);
      }
      .action-order-item.enemy .action-order-number {
        color: var(--secondary-color);
        border: 1px solid var(--secondary-color);
      }
      .action-order-arrow {
        margin: 0 -2px;
        color: var(--text-light);
        align-self: center;
        font-size: 12px;
      }
      
      .preparation-details {
        border: none;
        width: 100%;
        margin: 0;
        padding: 0;
        color: var(--text-color);
        font-family: var(--font-rpg);
      }
      .preparation-summary {
        display: flex;
        align-items: center;
        width: 100%;
        cursor: pointer;
        font-weight: bold;
        list-style: none;
        outline: none;
        transition: all 0.3s ease;
        position: relative;
        box-sizing: border-box;
      }
      
      .preparation-summary::-webkit-details-marker,
      .preparation-summary::marker {
        display: none;
        content: '';
      }
      
      .preparation-summary::before {
        content: '';
        display: inline-block;
        line-height: 1;
        font-size: 1.1em;
        margin-right: 6px;
      }
      
      .preparation-details:not([open]) > .preparation-summary {
        padding: 4px 8px 5px 8px;
        font-size: 16px;
        line-height: 1.2;
        margin-bottom: 0;
        background: var(--gradient-primary);
        color: white;
        border-radius: 8px;
        border: none !important;
        box-shadow: var(--shadow-md);
        justify-content: flex-start;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      
      .preparation-details:not([open]) > .preparation-summary:hover {
        background: var(--gradient-secondary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-glow);
      }
      
      .preparation-details[open] > .preparation-summary {
        padding: 10px 8px;
        font-size: 18px;
        line-height: initial;
        margin-bottom: 5px;
        border: 2px solid var(--primary-light);
        border-radius: 5px;
        background: var(--gradient-primary);
        color: white;
        justify-content: flex-start;
        box-shadow: var(--shadow-glow);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        left: 1px;
      }
      
      .preparation-details > .preparation-summary:active {
        padding: 10px 8px;
        font-size: 18px;
        line-height: initial;
        background-color: var(--primary-dark);
        color: white;
        box-shadow: inset 1px 1px 0px 1px rgba(255, 255, 255, 0.2), inset -1px -1px 0px 1px rgba(0, 0, 0, 0.2);
        filter: drop-shadow(1px 1px 0px rgba(0, 0, 0, 0.3));
        top: 1px;
        left: 1px;
        border: 2px solid var(--primary-dark);
        border-radius: 5px;
        justify-content: flex-start;
        margin-bottom: 5px;
      }
      
      .preparation-details > div {
        overflow: hidden;
        transition: max-height 0.3s ease-out;
      }
      
      .preparation-details[open] > .preparation-summary::before,
      .preparation-details > .preparation-summary:active::before {
        margin-right: 8px;
      }
      #combat-enemy-panel {
        display: grid;
        grid-template-columns: repeat(2, 1fr); 
        gap: 8px;
        max-height: 180px; 
        overflow-y: auto;
        overflow-x: hidden;
      }
      #combat-title {
        text-align: center;
        color: var(--primary-light);
        font-family: var(--font-rpg);
        margin: 20px 0;
        font-size: 18px;
        text-shadow: 0 0 10px rgba(167, 139, 250, 0.5);
      }
      .status-effect {
        cursor: help;
        position: relative;
      }
      .status-effect .effect-tooltip {
        visibility: hidden;
        width: 180px;
        background: rgba(0, 0, 0, 0.9);
        color: #ffffff;
        text-align: center;
        border-radius: 6px;
        padding: 6px;
        position: absolute;
        z-index: 999;
        bottom: 125%;
        left: 50%;
        margin-left: -90px;
        opacity: 0;
        transition: opacity 0.3s;
        font-size: 10px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--primary-color);
        pointer-events: none;
        white-space: normal;
        word-wrap: break-word;
        backdrop-filter: blur(10px);
      }
      .status-effect .effect-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -5px;
        border-width: 5px;
        border-style: solid;
        border-color: rgba(0, 0, 0, 0.9) transparent transparent transparent;
      }
      .status-effect:hover .effect-tooltip {
        visibility: visible;
        opacity: 1;
      }
      #combat-player-actions {
        margin: 8px;
        padding: 8px;
        background-color: var(--bg-color);
        border-radius: 8px;
        box-shadow: var(--shadow-sm);
      }
      .self-target-indicator {
        position: absolute;
        top: 5px;
        right: 5px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        border-radius: 12px;
        padding: 3px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.3px;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.3);
        opacity: 0;
        transition: all 0.3s ease;
        white-space: nowrap;
      }
      
      .self-target-indicator i {
        font-size: 9px;
        margin-right: 1px;
      }
      .combat-entity.player.selectable .self-target-indicator,
      .combat-entity.teammate.selectable .self-target-indicator {
        opacity: 1;
      }
      
      .combat-entity.selectable:hover .self-target-indicator {
        background: linear-gradient(135deg, #34d399, #10b981);
        box-shadow: 0 2px 12px rgba(16, 185, 129, 0.6);
        transform: scale(1.05);
      }
      @keyframes attack-forward {
        0% {
          transform: translateX(0);
        }
        50% {
          transform: translateX(30px);
        }
        100% {
          transform: translateX(0);
        }
      }
      @keyframes attack-backward {
        0% {
          transform: translateX(0);
        }
        50% {
          transform: translateX(-30px);
        }
        100% {
          transform: translateX(0);
        }
      }
      .attack-animation-forward {
        animation: attack-forward 0.8s ease;
      }
      .attack-animation-backward {
        animation: attack-backward 0.8s ease;
      }
      @keyframes shake {
        0% {
          transform: translateX(0);
        }
        25% {
          transform: translateX(-12px);
        }
        50% {
          transform: translateX(12px);
        }
        75% {
          transform: translateX(-8px);
        }
        100% {
          transform: translateX(0);
        }
      }
      .shake-animation {
        animation: shake 0.8s ease;
      }
      @keyframes damage-number {
        0% {
          opacity: 0;
          transform: translateY(0);
        }
        10% {
          opacity: 1;
          transform: translateY(-5px);
        }
        80% {
          opacity: 1;
          transform: translateY(-25px);
        }
        100% {
          opacity: 0;
          transform: translateY(-40px);
        }
      }
      .damage-number {
        position: absolute;
        color: var(--secondary-color);
        font-weight: bold;
        font-size: 16px;
        z-index: 10;
        pointer-events: none;
        animation: damage-number 1.2s forwards;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }
      .damage-number.critical {
        color: var(--health-color);
        font-size: 18px;
        text-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
      }
      .heal-number {
        position: absolute;
        color: var(--heal-color);
        font-weight: bold;
        font-size: 16px;
        z-index: 10;
        pointer-events: none;
        animation: damage-number 1.2s forwards;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }
      @keyframes hp-change {
        0% {
          opacity: 0.3;
        }
        50% {
          opacity: 1;
          background-color: #ffb3b3;
        }
        100% {
          opacity: 1;
        }
      }
      .hp-change-animation {
        animation: hp-change 0.8s ease;
      }
      @keyframes heal-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
        }
        70% {
          box-shadow: 0 0 0 15px rgba(16, 185, 129, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
        }
      }
      .heal-pulse-animation {
        animation: heal-pulse 0.8s ease;
      }
      @keyframes death-flash {
        0% {
          opacity: 0;
        }
        50% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }
      .death-flash {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0) 70%);
        opacity: 0;
        animation: death-flash 1s forwards;
        pointer-events: none;
        z-index: 5;
      }
      @keyframes particle-fade {
        0% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translateY(-50px) scale(0);
        }
      }
      .death-particle {
        position: absolute;
        background: rgba(255, 255, 255, 0.8);
        border-radius: 50%;
        pointer-events: none;
        z-index: 6;
        animation: particle-fade 1.5s ease-out forwards;
      }
      .result-extra-text {
        margin-top: 10px;
        margin-bottom: 10px;
        width: 100%;
      }
      .result-extra-text textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--border-color);
        border-radius: 12px;
        font-family: var(--font-rpg);
        font-size: 13px;
        resize: vertical;
        min-height: 70px;
        background: var(--bg-tertiary);
        color: var(--text-color);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      .result-extra-text textarea:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
      }

/* === 响应式布局（替代 战斗1.30手机） === */
@media (max-width: 600px) {
  /* 战斗界面：双列 → 单列 */
  #combat-display {
    grid-template-columns: 1fr !important;
    gap: 6px !important;
  }

  /* 敌人面板：2列 → 单列 */
  #combat-enemy-panel {
    grid-template-columns: 1fr !important;
    max-height: 200px !important;
  }

  /* 队友列表：3列 → 2列 */
  .teammates-list {
    grid-template-columns: repeat(2, 1fr) !important;
    max-height: 140px !important;
  }

  /* 武器/道具按钮网格缩小 */
  .weapons-list,
  .enemies-list {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) !important;
  }
  .weapon-buttons,
  .item-buttons {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
  }

  /* 数值条文本缩小 */
  .hp-text, .mp-text, .ap-text {
    min-width: 80px !important;
    font-size: 10px !important;
  }
  .hp-text-combat, .mp-text-combat, .ap-text-combat {
    font-size: 8px !important;
    max-width: 150px !important;
  }

  /* 战斗属性按钮缩小 */
  .player-agility, .player-stats,
  .teammate-agility, .teammate-stats {
    font-size: 10px !important;
    padding: 2px 4px !important;
    margin-right: 4px !important;
  }

  /* 详细属性面板缩小 */
  .stat-badge {
    padding: 4px 6px !important;
    font-size: 9px !important;
  }

  /* 攻击控制按钮缩小 */
  .attack-button, .next-round-button, .mid-action-button {
    font-size: 11px !important;
    padding: 5px 10px !important;
  }

  /* 战斗记录缩小 */
  #combat-log {
    height: 100px !important;
    font-size: 10px !important;
  }

  /* 结果弹窗适配 */
  .result-content {
    max-width: 95vw !important;
    padding: 15px !important;
  }
  .result-title {
    font-size: 16px !important;
  }

  /* 技能按钮缩小 */
  .weapon-button-stats {
    font-size: 8px !important;
    gap: 2px !important;
  }
  .weapon-button-name {
    font-size: 10px !important;
  }

  /* 行动顺序横向滚动 */
  .action-order-item {
    min-width: 50px !important;
    padding: 3px !important;
  }
  .action-order-name {
    font-size: 10px !important;
    max-width: 60px !important;
  }
}

@media (max-width: 400px) {
  /* 超窄屏：进一步压缩 */
  :host {
    font-size: 12px;
  }
  .teammates-list {
    grid-template-columns: 1fr !important;
  }
  .hp-label, .mp-label {
    width: 18px !important;
    font-size: 9px !important;
  }
}
        `;
}
