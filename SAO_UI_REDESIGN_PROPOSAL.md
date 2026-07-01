# SAO Companion — UI 美化设计方案

**状态:** 设计方案，待评审。**不在此文件实现。**
**范围:** SAO Companion 插件的 6 个组件美化 + 统一设计系统。
**基线 (用户认可的好风格):**
- `sao-render.js` 的 `renderUserStatus` Shadow DOM CSS — HUD 卡片范式
- `panel.html` 内嵌日历 CSS (Calendar V2) — 玻璃托盘 + 浮起瓦片 + 角部支架的范式

---

## 一、SAO UI 学习总结 (番剧/游戏关键设计元素)

经搜索 + 已读源码验证后归纳:

### 1.1 Color Cursor 与"上方光标"
SAO 原作 / Fatal Bullet / Memory Defrag 通用范式:
- **🟢 绿色** → 普通玩家/友方 (绿色六边形/箭头)
- **🟡 黄色** → NPC (在 wiki 中; 番剧早期使用)
- **🟠 橙色** → 犯罪者/敌对 (Fandom + Reddit 确认)
- **🔴 红色** → 红名 PK (本作变体, 在 anime/fandom 中常见)
- 形态: 小六边形框 (rotated square = diamond) 浮在角色头顶, **黑色半透明底盘** + 彩色发光边框, 内含无填充/小色点

### 1.2 主菜单/系统窗口
- 原作轻小说: **紫罗兰色发光矩形** (violet glow); 番剧动画: **白色 + 半透明**布局
- 总结: 长方形面板 + 微透 + 边框发光
- 通用特征: 顶部中央带渐变细条; 边框内嵌近似白色线; 角落带稍亮的"设备窗口"标记

### 1.3 HUD/角色上方状态面板
- VR HUD inventory overlay: 半透蓝面板 + 细白色边框 + 蓝字白文
- 物品槽: 4×5 网格; HP/等级条在顶部
- **生命周期线索**: 等级、HP、MP、副本突入值
- 没有 chrome 边饰/全息感 = **干净极简 style** (anime 经典)

### 1.4 技能/装备窗口
- 表格式 (Fat.al Bullet): 左侧树, 右侧详情
- 通用特征: 暗色侧栏 + 高亮选中行 + 数值用大字字体

### 1.5 光标 (Color Cursor) 设计 (本命要素)
- 半透六边形 (rotated square) 悬停在目标头顶
- 内填颜色 + 微光晕 (cyan + glow)
- 不悬停时退化为浅灰半透点

### 1.6 装饰元素
- **角部支架** (corner brackets): 屏幕角落 L 型支架 — SAO "selected" 的信号
- **顶熔金属条** (顶部 gradient line): 全宽水平渐变, 中间最亮
- **HUD 边框** (`HUD-styled border`): 1-2px 高亮线条随容器形状走
- **半透叠层**: 玻璃质感 (`backdrop-filter: blur()`)
- **科技线条 / 全息感**: 用 cyan → 半透明 → cyan 的 `linear-gradient` 模拟科技线条

---

## 二、组件设计方案

### 组件 1 — 使用/卸下按钮 (`.sao-equip-btn`)

#### 当前状态分析
`sao-render.js:924-951` 的 `.sao-equip-btn`:
```
background: transparent
border: 1px solid rgba(0,210,255,0.45)
color: var(--primary)  /* 青色 */
border-radius: 5px
padding: 1px 7px
font: Rajdhani 12px, 600
hover: bg rgba(0,210,255,0.12) + color: --primary-bright
```
**问题**: 透明背景 + 单边框, 与外层 `.sao-hud-card` (带背景渐变+左边框+顶光+阴影) 相比缺少 **深度和质感**, 看起来像 Web 1.0 表格按钮。

#### 新设计 — "Hex Tech Button" (六边形科技按钮)
**核心手法**: 加 `clip-path` 六边形 (rotated square) + 内层 cyan 渐变 + 顶光下滴阴影 + 微动画。

```css
.sao-equip-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 2px 9px 2px 10px;
    font-family: "Rajdhani", "Noto Sans SC", sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    /* 主形: 六边形 (旋转的胶囊) */
    color: var(--primary-bright);
    background: linear-gradient(180deg,
        rgba(0,210,255,0.18) 0%,
        rgba(0,148,180,0.10) 100%);
    border: 1px solid rgba(0,210,255,0.55);
    border-radius: 3px;
    /* 形态微调: clip-path 在两端切出斜角 */
    clip-path: polygon(
        6px 0, calc(100% - 6px) 0,
        100% 50%, calc(100% - 6px) 100%,
        6px 100%, 0 50%
    );
    cursor: pointer;
    position: relative;
    overflow: hidden;
    vertical-align: middle;
    line-height: 1.5;
    transition: transform 0.18s ease, box-shadow 0.22s ease, background 0.22s ease;
}
.sao-equip-btn::before {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
    transform: translateX(-100%);
    transition: transform 0.5s ease;
    pointer-events: none;
}
.sao-equip-btn:hover {
    background: linear-gradient(180deg,
        rgba(0,210,255,0.32) 0%,
        rgba(0,148,180,0.18) 100%);
    border-color: var(--primary);
    color: #ffffff;
    box-shadow:
        0 0 12px rgba(0,210,255,0.55),
        inset 0 1px 0 rgba(255,255,255,0.18);
    text-shadow: 0 0 6px rgba(0,210,255,0.7);
    transform: translateY(-1px);
}
.sao-equip-btn:hover::before { transform: translateX(100%); }
.sao-equip-btn:active {
    transform: translateY(0) scale(0.97);
    box-shadow: 0 0 6px rgba(0,210,255,0.35);
}
.sao-equip-btn[disabled],
.sao-equip-btn[aria-disabled="true"] {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.12);
    color: var(--text-tertiary);
    cursor: not-allowed;
    clip-path: none;
    border-radius: 3px;
}
```

**视觉要点**:
- `clip-path: polygon()` 形成两端斜切, 类似 **菱形边框的微缩版** — 体现 SAO 的「非纯矩形」设计语言
- hover 时扫光 (sweep) 模拟全息投影
- 与 `.sao-hud-card` 的「左 cyan 边 + 顶光条 + 渐变背景」遥相呼应, 同语言同深度
- 可选添加 `:before` 的 ⌖ / + / − 小符号 (用 data-sao-action 决定)
- 卸下按钮可加 `:not([data-sao-action="equip"])` 红色变体 (`sao-equip-btn.sao-equip-btn-unequip`) — 用 `--danger`

**文件改动**:
- `sao-render.js:924-951` 替换为新版 CSS (在 `renderUserStatus` 的 Shadow DOM 内, 仍走 Shadow DOM scope)

---

### 组件 2 — 玩家与世界状态并列布局

#### 当前状态分析
- `panel.html` 侧栏: 已经用 `.sao-grid-2` 把玩家/世界并列 (line 49-89). **用户感知为"上下堆叠"的最大可能是**:
  1. 响应式断点 (768px 以下) 把 grid 退化为单列 (style.css line 187-192)
  2. 世界状态栏内部 5 个 `.sao-world-row` 是单列, 行数过多 → "看起来像长清单"
- `sao-render.js` 聊天消息: `renderUserStatus` 和 `renderMap` 通过 `PANEL_REGISTRY` 顺序插入, 每个都包在各自的 Shadow DOM host 中, **垂直堆叠** (不是并排)

#### 新设计 — 两处都要改

**A. 聊天消息内的并排**
- 在 `panels-registry.map` 的 `user_status` 之后, 紧接 `map` 时, 加一个 group container
- 推荐方案: **保留各自的 Shadow host**, 在两者父级加一个 `display: grid; grid-template-columns: 1fr 1fr; gap: 8px;` 的容器

```css
/* style.css 或 panel.html 顶层 */
.sao-status-map-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-items: start;
}
.sao-status-map-grid > .sao-render-host {
    margin: 0;
    min-width: 0;
}
@media (max-width: 720px) {
    .sao-status-map-grid { grid-template-columns: 1fr; }
}
```

实现思路:
- `index.js` 或 `sao-render.js` 加一个 `bindStatusMapGroup()` 函数, 在 `renderAllTags` 完成后, 找到两个相邻的 `[data-sao-section="user_status"]` 和 `[data-sao-section="map"]` 的 host, 把它们的父级包装进 `.sao-status-map-grid`
- 或者: `PANEL_REGISTRY` 增加一个 `group` 字段, 表示相邻同类应合并容器

**B. 侧栏世界状态内部分行**
- 当前世界状态 5 行全单列. 改为: **2 列网格**, 一行可放 2 个 `.sao-world-row`
- 行顺序: 位置 + 天气 / 区域 + 攻略 / 事件 (单行)

```css
/* style.css 新增 */
.sao-world-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 14px;
    row-gap: 0;
}
.sao-world-grid > .sao-world-row {
    border-bottom: 1px solid rgba(255,255,255,0.05);
    /* 让每行有自己的宽度, 不会被截 */
}
@media (max-width: 560px) {
    .sao-world-grid { grid-template-columns: 1fr; }
}
```

HTML 改造 (panel.html line 81-87):
```html
<div class="sao-card">
  <div class="sao-world-grid">
    <div class="sao-world-row"><span class="sao-world-label">📍 位置</span><span class="sao-world-value" id="sao_world_location">-</span></div>
    <div class="sao-world-row"><span class="sao-world-label">🌤 天气</span><span class="sao-world-value" id="sao_world_weather">-</span></div>
    <div class="sao-world-row"><span class="sao-world-label">⚠ 区域</span><span class="sao-world-value" id="sao_world_area">-</span></div>
    <div class="sao-world-row"><span class="sao-world-label">🏰 攻略</span><span class="sao-world-value" id="sao_world_clearing">-</span></div>
    <div class="sao-world-row" style="grid-column: span 2">
      <span class="sao-world-label">📢 事件</span><span class="sao-world-value" id="sao_world_events">-</span>
    </div>
  </div>
</div>
```

**C. 聊天消息层面的重叠防御 — renderUserStatus 内部**
- renderUserStatus 的 vitals (HP/MP bars) 是 HUD 中最核心元素
- 用户的意思也可能是: 玩家 (在 renderUserStatus) 和世界 (在 renderMap) 在聊天消息中并列展示
- 上面 A 已经解决这个问题

---

### 组件 3 — 光标 (`.sao-cursor-badge` 和 `.sao-cursor-row`)

#### 当前状态分析
`sao-render.js:1041-1057` 的 `.sao-cursor-badge`:
```
padding: 3px 10px; border-radius: 12px;
font: Rajdhani 0.78em, 700, UPPER, letter-spacing 0.5px
border: 1px solid rgba(255,255,255,0.12)
box-shadow: 0 0 8px currentColor
green → rgba(0,214,138,0.12) bg + var(--success)
orange → rgba(255,184,0,0.12) bg + var(--warning)  (注: 实际是金色 → 与文档不一致, 但已可接受)
red → rgba(255,46,74,0.14) bg + var(--danger)
```
`style.css:47-71` 的 `.sao-cursor-row` (侧栏):
```
显示: 公文栏 flex (左 label "光标", 右 value "🟢 普通")
背景: rgba(8,12,20,0.55) 暗色 + 左侧 3px cyan 实线
```

**问题**: 形状普通 (pill), 没有 SAO 标志性 **「上方悬浮光标」** 的视觉感受. emoji 🟢 vs 真正的六边形光标相差很大.

#### 新设计 — "SAO Hex Cursor" (六边形浮标)

**核心**: 不只是 pill, 而是 **六边形 (rotated square) 标识 + 文本标签** 的二段式组合, 模拟角色头顶悬浮的光标.

```css
/* 替换 sao-cursor-badge 内容 */
.sao-cursor-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px 3px 8px;
    font-family: "Rajdhani", "Noto Sans SC", sans-serif;
    font-size: 0.78em;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    background: rgba(8,12,20,0.65);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 14px;
    box-shadow: 0 0 10px currentColor, inset 0 1px 0 rgba(255,255,255,0.08);
    white-space: nowrap;
}
/* 六边形指示符 */
.sao-cursor-badge::before {
    content: "";
    width: 10px;
    height: 10px;
    /* diamond = 正方形旋转 45° + 微透背景 + 发光 */
    background: currentColor;
    transform: rotate(45deg);
    border-radius: 2px;
    box-shadow:
        0 0 6px currentColor,
        inset 0 0 0 2px rgba(8,12,20,0.7);
    flex-shrink: 0;
    animation: sao-cursor-pulse 2.4s ease-in-out infinite;
}
@keyframes sao-cursor-pulse {
    0%, 100% { transform: rotate(45deg) scale(1); opacity: 1; }
    50%      { transform: rotate(45deg) scale(1.15); opacity: 0.85; }
}
.sao-cursor-green::before,
.sao-cursor-green {
    color: var(--success);
    background: rgba(0,214,138,0.12);
    box-shadow: 0 0 10px rgba(0,214,138,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
}
.sao-cursor-orange::before,
.sao-cursor-orange {
    /* 修正: orange 应该是暖橙 (区别于 warning 金), 用自定义值 */
    color: #ff8a3d;
    background: rgba(255,138,61,0.14);
    box-shadow: 0 0 10px rgba(255,138,61,0.5), inset 0 1px 0 rgba(255,255,255,0.08);
}
.sao-cursor-red::before,
.sao-cursor-red {
    color: var(--danger);
    background: rgba(255,46,74,0.16);
    box-shadow: 0 0 12px rgba(255,46,74,0.6), inset 0 1px 0 rgba(255,255,255,0.08);
}
```

**侧栏 (`.sao-cursor-row`)** 同步升级: 把文本 "🟢 普通" 替换成 `<span class="sao-cursor-badge sao-cursor-green">普通</span>` 同形状, 视觉一致.

**视觉要点**:
- ❇ 标识 = 旋转 45° 正方形 (`diamond`), 内层深色填底 → 像真实光标的「中心不透, 边缘发光」
- ↻ 微脉动 (`scale 1 → 1.15 → 1`, 2.4s) — 轻微, 不打扰阅读
- 🟠 orange 改用 **真正的暖橙 `#ff8a3d`** (区别于 gold warning `#ffb800`), 与 SAO 原作 criminal cursor 颜色一致
- 与日历今日 (today) 的 corner brackets + capsule 风格对照: 都是「一个对象」而非「状态」

**文件改动**:
- `sao-render.js:1041-1057` 替换 cursor badge CSS
- `style.css:47-71` 升级 `.sao-cursor-row` 内 cursor 显示形式, 或改 HTML 让侧栏 cursor 也用 badge 元素
- `panel.html:61` 的 `<span class="sao-cursor-value" id="sao_cursor_text">-</span>` → 改为 `<span class="sao-cursor-badge ..." id="sao_cursor_text">-</span>`

---

### 组件 4 — 聊天界面全面美化 (`.mes_text` + 嵌入状态栏)

#### 当前状态分析
`style.css:198-228` 的 R2 (现有):
```
.mes_text { padding-left: 14px; border-left: 2px solid rgba(0,210,255,0.18); }
.mes_text::before { 顶部渐变小条 (linear-gradient 180deg cyan->transparent) }
.mes_text:hover { border-left-color: 0.45 alpha }
.mes_text::after { 右下角 10x10 角部支架 (cyan 描边 2px L 型) }
```
**问题**: 装饰元素过少 (只有左侧一条 + 右下一角); 用户觉得 "太简单"; 嵌入状态栏散落, 没有视觉节奏.

#### 新设计 — "SAO Chat Frame" (HUD 框 + 嵌入整合)

**核心思路**: 把每条消息包成 **「科技面板」** 视觉, 嵌入状态栏 (renderUserStatus 等) 自然融入, 不会与正文打架.

```css
/* 替换 style.css 整个 R2 / R3 块 */
body.sao-card-active .mes {
    position: relative;
    /* 不改 .mes 容器, 只装饰 .mes_text */
}
body.sao-card-active .mes_text {
    position: relative;
    padding: 12px 18px 14px 22px;
    margin: 6px 4px;
    /* 整体: 半透明暗色面板 */
    background: linear-gradient(180deg,
        rgba(15,21,34,0.32) 0%,
        rgba(8,12,20,0.18) 100%);
    border-radius: 6px;
    /* 双线边框 = 科技面板标志 */
    border-left: 2px solid rgba(0,210,255,0.55);
    border-top: 1px solid rgba(0,210,255,0.08);
    border-right: 1px solid rgba(0,210,255,0.04);
    border-bottom: 1px solid rgba(0,210,255,0.04);
    box-shadow:
        inset 1px 0 0 rgba(0,210,255,0.25),
        inset -1px 0 0 rgba(0,210,255,0.05),
        0 2px 8px rgba(0,0,0,0.25);
    backdrop-filter: blur(2px);
    transition: border-color 0.25s ease, box-shadow 0.25s ease, background 0.3s ease;
}
/* 顶光条: 全宽渐变 */
body.sao-card-active .mes_text::before {
    content: "";
    position: absolute;
    top: 0; left: 14px; right: 14px;
    height: 1px;
    background: linear-gradient(90deg,
        transparent 0%,
        var(--primary) 30%,
        var(--primary-bright) 50%,
        var(--primary) 70%,
        transparent 100%);
    opacity: 0.7;
    pointer-events: none;
}
/* 4 角支架 (corner brackets) - 通过 ::after + 复杂 background 实现 */
body.sao-card-active .mes_text::after {
    content: "";
    position: absolute;
    inset: 5px;
    pointer-events: none;
    background-image:
        linear-gradient(to right, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to bottom, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to left, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to bottom, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to right, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to top, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to left, rgba(0,210,255,0.55) 0 10px, transparent 10px),
        linear-gradient(to top, rgba(0,210,255,0.55) 0 10px, transparent 10px);
    background-size:
        10px 2px, 2px 10px,
        10px 2px, 2px 10px,
        10px 2px, 2px 10px,
        10px 2px, 2px 10px;
    background-position:
        0 0, 0 0,
        100% 0, 100% 0,
        0 100%, 0 100%,
        100% 100%, 100% 100%;
    background-repeat: no-repeat;
    opacity: 0.45;
}
/* hover 时支架高亮 + 边框加深 */
body.sao-card-active .mes_text:hover {
    background: linear-gradient(180deg,
        rgba(15,21,34,0.55) 0%,
        rgba(8,12,20,0.32) 100%);
    border-left-color: rgba(0,210,255,0.85);
    box-shadow:
        inset 1px 0 0 rgba(0,210,255,0.5),
        0 0 14px rgba(0,210,255,0.12),
        0 2px 12px rgba(0,0,0,0.35);
}
body.sao-card-active .mes_text:hover::after { opacity: 0.85; }
```

**嵌入状态栏视觉整合**:
- 嵌入状态栏 (Shadow DOM `.character-status-wrapper`) 已经有顶部 cyan 发光条 (`::before` 顶部渐变 2px)
- 新 `.mes_text` 也带顶部光条 → 两者 **垂直串联成一根连续的视觉轴**, "光 → 面板" 指向
- 状态栏的外层 `border-accent` (1px cyan) 应能无缝过渡到 `.mes_text` 的 `border-left: 2px solid cyan` → "主面板 + 边栏装饰" 的关系, 而不是 "贴上去的盒子"

**响应式 / 移动端**:
- max-width 560px: 4 角支架变 2 角 (top-left + bottom-right), 边框变细 1px, padding 缩 8px -> 14px, 14px -> 18px

**文件改动**:
- `style.css:198-228` R2 段全部替换为新版 CSS
- 嵌入状态栏无需改动 (用户态栏已统一语言)

**否决项给 reviewer**: 是否同意「4 角支架全部点亮」? 这是大装饰. 若觉得太花哨, 可改为「仅 2 角 (左上 + 右下)」保守版.

---

### 组件 5 — 新剑技/新装备/NPC/世界状态栏 重新设计

#### 当前状态分析

**A. `renderEquipment` + `renderSwordSkill` (`sao-render.js:1584-1647`)**
- 使用 `SHARED_STARDEW_CSS` (sao-render.js line 56-87) = **米色/像素风格主题** (`.stardew-text-wrapper`)
- 严重不符: SAO 主题应是 navy/cyan/glass, 而非 Stardew Valley cream/beige
- 装饰手法: pressed-button 风格 (双 inset 阴影 + drop shadow 模拟按下) — 显得 "复古游戏截图"
- 通用 details 折叠: `details-character-bar` / `details-affinity-button`, 用 emoji 🎒 / ✨ 作为图标

**B. `renderMap` (`sao-render.js:1649-1830`)** 
- 完全独立的 `.map-status-wrapper` 米色主题 (cream/beige 配色)
- 用 emoji 📍 等图标, 同样 "拼贴感"

**C. NPC 状态栏 (`sao-npc-card` in `sao-state-projection.js` → `sao-render.js:1343-1383`)**
- **已在用户态栏 HUD 体系中**, 视觉与其他卡片 (`.sao-hud-card`) 一致
- 问题不大, 但: `<details>` 内 NPC 区没有角色头图/位置 indicator, 信息密度低

#### 新设计 — 统一「SAO Panel」(完全替换 stardew + map 单元)

**核心原则**: 与 `renderUserStatus`/`renderCalendar` 完全共享同一套语言 — `.sao-hud-card` 模式 + 同色 token + 同字体栈.

**新 SHARED_SAO_PANEL_CSS** (替换 stardew):
```css
/* 在 sao-render.js 新增 SHARED_SAO_PANEL_CSS, 复用 #sao_panel_overlay 已有 token */
const SHARED_SAO_PANEL_CSS = `
    @import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Exo+2:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap");
    :host { display: block; margin: 0; padding: 0; }
    
    .sao-panel-wrapper {
        /* 复用 user_status 已建立的 token, 此处只重声明作为 Shadow scope 隔离 */
        --primary: #00d2ff;
        --primary-dim: #0094b4;
        --primary-bright: #66e8ff;
        --success: #00d68a;
        --warning: #ffb800;
        --danger: #ff2e4a;
        --bg-base: #080c14;
        --bg-elevated: #0f1522;
        --bg-panel: #161e2e;
        --bg-glass: rgba(22,30,46,0.82);
        --text-primary: #eaf2ff;
        --text-secondary: #9fb0cc;
        --text-tertiary: #5c6b85;
        --border-subtle: rgba(255,255,255,0.08);
        --border-accent: rgba(0,210,255,0.35);
        
        background-color: rgba(12,18,28,0.94);
        border: 1px solid var(--border-accent);
        border-radius: 8px;
        max-width: min(100%, 861px);
        margin: 6px auto;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;
        position: relative;
        box-shadow: 
            0 0 18px rgba(0,210,255,0.12), 
            0 8px 24px rgba(0,0,0,0.45);
        font-family: "Exo 2", "Noto Sans SC", "Rajdhani", "Microsoft YaHei", sans-serif;
        color: var(--text-primary);
    }
    /* 顶发光 */
    .sao-panel-wrapper::before {
        content: "";
        position: absolute;
        top: 0; left: 0; right: 0; height: 2px;
        background: linear-gradient(90deg,
            transparent 0%, var(--primary) 20%,
            var(--primary-bright) 50%, var(--primary) 80%, transparent 100%);
        opacity: 0.85;
        pointer-events: none;
    }
    
    /* 通用 details/summary 容器, 与 user_status 完全一致 */
    .sao-panel-details {
        border: none; margin: 0; padding: 0; color: inherit;
    }
    .sao-panel-details > summary {
        display: flex; align-items: center; width: 100%;
        cursor: pointer; outline: none; list-style: none;
        font-family: "Rajdhani", "Noto Sans SC", sans-serif;
        font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
        transition: all 0.2s ease; position: relative;
        box-sizing: border-box;
    }
    .sao-panel-details > summary::-webkit-details-marker,
    .sao-panel-details > summary::marker { display: none; content: ''; }
    .sao-panel-details > summary::before {
        content: '▸';
        display: inline-block;
        color: var(--primary);
        margin-right: 8px; font-size: 12px;
        transition: transform 0.2s ease;
    }
    .sao-panel-details[open] > summary::before { content: '▾'; }
    
    /* 闭合态: 暗色按钮条 + 左 cyan 边 + ▸ 箭头 */
    .sao-panel-details:not([open]) > summary {
        padding: 6px 12px;
        font-size: 15px; line-height: 1.3;
        margin: 5px 0 0 0;
        background: rgba(15,21,34,0.92);
        border: 1px solid rgba(0,210,255,0.22);
        border-left: 3px solid var(--primary);
        border-radius: 5px;
        color: var(--text-secondary);
        box-shadow: -2px 0 6px rgba(0,210,255,0.18), 0 1px 4px rgba(0,0,0,0.25);
    }
    .sao-panel-details:not([open]) > summary:hover {
        color: var(--primary-bright);
        background: rgba(22,30,46,0.95);
        border-color: rgba(0,210,255,0.45);
        box-shadow: -2px 0 10px rgba(0,210,255,0.28), 0 0 10px rgba(0,210,255,0.12);
    }
    /* 展开态: cyan 标题 + cyan 发光 + 下方渐变分隔 */
    .sao-panel-details[open] > summary {
        padding: 10px 12px;
        font-size: 16px; line-height: 1.3;
        margin: 5px 0 8px 0;
        background: transparent; border: none;
        border-left: 3px solid var(--primary);
        border-radius: 0;
        color: var(--primary);
        box-shadow: -2px 0 10px rgba(0,210,255,0.35);
        text-shadow: 0 0 10px rgba(0,210,255,0.35);
    }
    .sao-panel-details[open] > summary::after {
        content: ""; position: absolute;
        bottom: -4px; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg, var(--primary), transparent);
        opacity: 0.6;
    }
    /* 内容区: HUD 玻璃卡 */
    .sao-panel-details > div {
        padding: 10px 12px;
        margin: 0 4px 5px 4px;
        font-size: 14.5px; line-height: 1.55;
        background: var(--bg-glass);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        color: var(--text-primary);
        backdrop-filter: blur(4px);
        text-shadow: none !important;
    }
`;
```

**`renderEquipment` 新主体** (替换 stardew 流):
```js
function renderEquipment(messageEl, rawText, messageId, refNode) {
    /* ...same panel/last-resort html extraction... */
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            /* renderEquipment 独有: 装备品质等级色彩 */
            .sao-rarity-common  { color: var(--sao-r-common, #9ca3af); }
            .sao-rarity-uncommon{ color: var(--sao-r-uncommon, #00d68a); }
            .sao-rarity-rare    { color: var(--sao-r-rare, #00d2ff); text-shadow: 0 0 8px rgba(0,210,255,0.35); }
            .sao-rarity-epic    { color: var(--sao-r-epic, #a855f7); text-shadow: 0 0 10px rgba(168,85,247,0.45); }
            .sao-rarity-legendary{ 
                color: var(--sao-r-legendary, #ffb800); 
                text-shadow: 0 0 12px rgba(255,184,0,0.55); 
            }
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>⚔ 新装备</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `;
}
```

**`renderSwordSkill` 新主体**:
```js
function renderSwordSkill(messageEl, rawText, messageId, refNode) {
    /* ...same... */
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            /* 剑技特效行 - 数字 cyane 发光 */
            .sao-skill-stat { 
                font-family: "Orbitron", sans-serif;
                color: var(--primary); 
                text-shadow: 0 0 6px rgba(0,210,255,0.4); 
            }
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>✨ 新剑技</summary>
                <div>${itemsHtml}</div>
            </details>
        </div>
    `;
}
```

**`renderMap` 新主体** (drop map-status-wrapper, 替换为 sao-panel-wrapper):
```js
function renderMap(messageEl, rawText, messageId, refNode) {
    /* ...same... */
    shadow.innerHTML = `
        <style>
            ${SHARED_SAO_CSS}
            ${SHARED_SAO_PANEL_CSS}
            /* 楼层信息: 大字 Orbitron + cyan */
            .sao-map-floor {
                font-family: "Orbitron", "Noto Sans SC", sans-serif;
                font-size: 1.5em;
                font-weight: 900;
                color: var(--primary);
                text-shadow: 0 0 12px rgba(0,210,255,0.45);
            }
        </style>
        <div class="sao-panel-wrapper">
            <details class="sao-panel-details" open>
                <summary>🗺 世界状态</summary>
                <div>${safeContent}</div>
            </details>
        </div>
    `;
}
```

**`.sao-npc-card` 升级** (在 renderUserStatus shadow 内, 当前已存在但简朴):
```css
.sao-npc-card {
    background: linear-gradient(180deg, rgba(22,30,46,0.92), rgba(15,21,34,0.92));
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--success);  /* NPC = 绿色左边界, 区别于 player cyan */
    border-radius: 6px;
    padding: 9px 12px;
    margin-bottom: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04);
    position: relative;
}
.sao-npc-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, var(--success), transparent 70%);
    opacity: 0.4;
    pointer-events: none;
}
.sao-npc-card:last-child { margin-bottom: 0; }
.sao-npc-card:hover {
    border-color: rgba(0,214,138,0.4);
    border-left-color: var(--success);
    box-shadow: 0 0 12px rgba(0,214,138,0.15), 0 4px 14px rgba(0,0,0,0.35);
}
.sao-npc-name {
    font-family: "Orbitron", "Noto Sans SC", sans-serif;
    font-weight: 700;
    font-size: 1.05em;
    color: var(--text-primary);
    letter-spacing: 0.4px;
    /* 与玩家一致的 Orbitron 标题 */
}
```

**视觉要点**:
- 删除 `SHARED_STARDEW_CSS` (sao-render.js:55-87) 全部, 整段替成 `SHARED_SAO_PANEL_CSS`
- 删除 `stardewDetailsSharedCSS` 函数 (sao-render.js:97-203), 整段替成 `saoPanelDetailsCSS` = SHARED_SAO_PANEL_CSS 的 details 块
- 删除 `.map-status-wrapper` 全部 (sao-render.js:1665-1687)
- 4 个 renderer (renderEquipment, renderSwordSkill, renderMap, renderUserStatus) 共用同一个 SHARED_SAO_PANEL_CSS, 仅 summary 文字 (icon) 与内容区辅助样式不同
- NPC 卡片用 **绿色左边界** (`--success`), 玩家用 **青蓝** (`--primary`), 显式区分语义角色

**文件改动量** (预估):
- 删除 ~280 行 stardew + map 旧 CSS
- 新增 ~120 行 SHARED_SAO_PANEL_CSS
- 4 个 renderer 各改 ~10 行模板
- 净减约 150 行

---

### 组件 6 — 整体配色/字体/装饰元素统一 (设计系统)

#### 设计语言陈述 (语言哲学)
> **「暗夜浮起的科技面板」**: 在近黑色 navy (`#080c14`/`#0f1522`) 上, 用半透明玻璃卡 (`backdrop-filter`) 浮起浅一档 (`.sao-hud-card`, `.sao-panel-wrapper`), 关键边缘用 cyan (`#00d2ff`) 描出"科技窗口"框架, 装饰元素都源于 **发光 (`box-shadow` 多层叠) + 半透 (`rgba 0.1-0.55`) + 边缘 (`border-left 3-4px`)** 三板斧, 字体用 **Orbitron 标示** + **Rajdhani UI** + **Exo 2 正文** + **Noto Sans SC 中文**, 间隔使用 4/8/12/16 三档.

#### 6.1 配色 Token (统一, 不引入新 hex)

| 类别 | 名称 | 值 | 用途 |
|---|---|---|---|
| **基础背景** | `--bg-base` | `#080c14` | 文字主色 (深色背景的反色文字); 默认 page |
| | `--bg-elevated` | `#0f1522` | 一级容器 (卡片, .sao-card) |
| | `--bg-panel` | `#161e2e` | 二级容器 (内部 nested) |
| | `--bg-glass` | `rgba(20,28,44,0.72)` | 玻璃面板基底 (半透) |
| **品牌色** | `--primary` | `#00d2ff` | cyan; 主强调, 角部, 数据高亮 |
| | `--primary-dim` | `#0094b4` | 暗 cyan; 渐变次停 |
| | `--primary-bright` | `#66e8ff` | 亮 cyan; hover 高亮 |
| **状态色** | `--success` | `#00d68a` | 绿; canon, NPC, today (光伏) |
| | `--warning` | `#ffb800` | 金黄; 预约 appointment, 传说 rarity |
| | `--danger` | `#ff2e4a` | 红; 错误, 红名, hp-low 警示 |
| | `--cursor-criminal` *(新)* | `#ff8a3d` | **暖橙**; (用在 cursor, 区别于 gold warning) |
| **文字** | `--text-primary` | `#eaf2ff` | 主文字 (~ 95% 对比) |
| | `--text-secondary` | `#9fb0cc` | 次文字 ~ 60% 对比 |
| | `--text-tertiary` | `#5c6b85` | 弱文字 ~ 40% 对比 |
| **边框** | `--border-subtle` | `rgba(255,255,255,0.08)` | 1px hairline |
| | `--border-accent` | `rgba(0,210,255,0.35)` | 1px cyane 强调边 |
| **阴影** | `--shadow-glow` | `0 0 18px rgba(0,210,255,0.25)` | cyan glow, 用于 hover/focus |
| | `--shadow-soft` | `0 8px 32px rgba(0,0,0,0.45)` | 通用深度阴影 |
| **稀有度** *(沿用)* | `--sao-r-common` | `#9ca3af` | 灰 |
| | `--sao-r-uncommon` | `#00d68a` | 绿 |
| | `--sao-r-rare` | `#00d2ff` | 青 |
| | `--sao-r-epic` | `#a855f7` | 紫 |
| | `--sao-r-legendary` | `#ffb800` | 金 |

> ⚠ 唯一新增: `--cursor-criminal` `#ff8a3d`. 用途专一, 不污染 `--warning`.

#### 6.2 字体 Token

| 角色 | 字体栈 | 用途 | 字重/字距 |
|---|---|---|---|
| **Display** | `"Orbitron", "Noto Sans SC", sans-serif` | 标题/大型数字 (装备名, 等级, 楼层) | 700-900, letter-spacing 0.4-1px, UPPER |
| **UI** | `"Rajdhani", "Noto Sans SC", sans-serif` | 按钮/标签/小写说明 | 600-700, letter-spacing 0.3-0.6px, 短 UPPER |
| **Body** | `"Exo 2", "Noto Sans SC", sans-serif` | 正文段落 | 400-500, letter-spacing normal |
| **CJK fallback** | `"Noto Sans SC", "Microsoft YaHei", sans-serif` | 中文回退 | 继承角色 |
| **Mono** (日志) | `Consolas, "Courier New", monospace` | 日志/log (已存在 style.css) | 400 |

#### 6.3 装饰元素清单 (Recurring patterns)

| 元素 | 描述 | 用在 |
|---|---|---|
| **顶发光条** | `.sao-xxx::before` 全宽 1-2px cyan 渐变 top sliver | user_status / panel / map / npc-card / equip-card, **所有面板外壳统一加** |
| **左 cyan 边** | `border-left: 3px solid var(--primary)` | `.sao-hud-card`, `.sao-panel-details:not([open]) > summary`, `.sao-equip-slot` (active) |
| **玻璃卡** | `background: linear-gradient(180deg, rgba(22,30,46,0.92), rgba(15,21,34,0.92))` + `backdrop-filter: blur(4px)` | 几乎所有 `.sao-hud-card` / `.sao-panel-details > div` |
| **角部支架** | 4 角 L-shape 2px, 10-12px 长, cyan 半透 | 日历 today cell, 聊天 `.mes_text`, 选中时显形 |
| **drop-shadow 多层叠** | `box-shadow: 0 1px 2px, 0 6px 14px, inset 0 1px 0, inset 0 -1px 0` (Material 3-layer) | 浮起瓦片 (calendar tile, hud card), 模拟"光照从上方打" |
| **状态色光晕** | `box-shadow: 0 0 10px currentColor` | `.sao-bar`, `.sao-cursor-badge`, hover 强调 |
| **扫光 hover** | `::before` translateX(-100% → 100%) 渐变横扫 0.4-0.5s | `.sao-btn`, `.sao-equip-btn` 新版 |
| **微脉动** | `@keyframes scale 1→1.15→1, 2.4s` | today cell, cursor diamond |
| **菱形/六边形指示符** | `transform: rotate(45deg)` small box, glow | cursor, today corner notch (某些变体) |
| **稀有度左色条** | `border-left: 3px solid var(--sao-r-...)` | 装备 / 物品 (按 rarity 上色) |

#### 6.4 间距/圆角/边框规范

| 量 | 值 | 用途 |
|---|---|---|
| **间距** | 4 / 8 / 12 / 16 / 24 px | tailwind-like 4 的倍数; padding/margin |
| **gap (grid)** | 8-12 px | 卡片间; 8 for dense, 12 for sparse |
| **圆角** | 4 (chip), 6 (card), 8 (panel), 10 (hover-lift), 12 (top-level panel) | 越外层越大 |
| **边框粗** | 1px (hairline), 2px (accent top-line), 3px (left-edge accent), 4px (active) | 越重要越粗 |
| **z-index** | 0 (默认), 1 (sticky top bar), 2 (decoration ::before), 3 (close button on top) | 分层清晰 |
| **字号** | 11 (chip), 12 (button), 13 (small text), 14.5 (body), 15 (summary closed), 17 (summary open), 1.05-1.5em (HUD value) | 5 档 |

#### 6.5 组件复用模式 (Patterns)

| 模式 | 类名 | 用途 | 例 |
|---|---|---|---|
| **HUD 卡片** | `.sao-hud-card` | 内嵌面板的内容块 (垂直渐变 + 顶光 +左 cyan 边) | vitals, equip, npc, skill |
| **面板外壳** | `.sao-panel-wrapper` / `.character-status-wrapper` | 一级面板整体 (relative, 顶发光 ::before) | user_status, map, equipment, swordskill |
| **可折叠 details** | `.sao-panel-details` | 通用折叠容器 (左右两态 summary + 内容 div) | 上面所有面板内 |
| **按钮 - 主** | `.sao-btn` | 主操作 (cyan 渐变 + 扫光) | 侧栏主要按钮 |
| **按钮 - 次** | `.sao-btn-secondary` | 次操作 (透明 + cyan 描边) | 侧栏次按钮 |
| **按钮 - 紧凑** | `.sao-equip-btn` (新版) | 行内小按钮 (六边形 clip-path) | 内部 chip 按钮 (equip/unequip/use) |
| **数据条** | `.sao-bar` + `.sao-bar-hp/mp/exp` | HP/MP/EXP 进度条 | 状态栏, 任务进度 |
| **数据方块** | `.sao-stat-item` | 小数据方块 (hover lift + cyan 顶光) | STR/AGI/INT/VIT, 内嵌度量 |
| **chip / tag** | `.sao-tag` + `.sao-tag-equip/skill/inv` | 物品/技能 chip | 背包物品, 标签 |
| **稀有度色条** | `.sao-rarity-{common\|uncommon\|rare\|epic\|legendary}` | 装备品质 (左色条 + 字号发光) | 装备列表 |
| **光标徽章** | `.sao-cursor-badge` (新版 hex diamond) | 光标类型 | user status 头部 chip, 侧栏 |

---

## 三、实施优先级 + 依赖关系

### 优先级分层

**Phase 1 (基础重设计, 必须先做 — 给整个设计系统铺底)**:
1. **组件 5 — 新剑技/新装备/NPC/世界状态栏** — 删除 stardew, 引入 `SHARED_SAO_PANEL_CSS`. 其它组件的 stamp/skeleton 都在这里统一.
2. **组件 6 — 整体设计规范** — Token, 字体, 装饰元素规范 (实现在 Phase 1 的 CSS 上落地).

**Phase 2 (核心交互元素 — 依赖 Phase 1 的统一语言)**:
3. **组件 1 — 使用/卸下按钮** — 升级 `.sao-equip-btn` 为六边形 chip; 依赖 Phase 1 的 token
4. **组件 3 — 光标 (hex diamond) 升级** — 升级 `.sao-cursor-badge`/`.sao-cursor-row`; 副作用小

**Phase 3 (视觉整合 — 依赖 Phase 1 + 2)**:
5. **组件 2 — 玩家/世界状态并列布局** — chat (renderUserStatus + renderMap) 改为 grid, panel.html 侧栏世界状态内部分 2 列
6. **组件 4 — 聊天表面美化 (R2 → R3)** — `.mes_text` 装饰升级, 4 角支架; 验证嵌入状态栏 «富视觉轴»

### 实施步骤 (推荐 Editor工作清单)

| 步骤 | 文件 | 改/加 | 行数 (近) | 风险 |
|---|---|---|---|---|
| 1 | `sao-render.js` | 加 `SHARED_SAO_PANEL_CSS` (与 user_status 同源) | +120 | 低 (新增) |
| 2 | `sao-render.js` | 删除 `SHARED_STARDEW_CSS` + `stardewDetailsSharedCSS` | -180 | 中 (跨 renderer, 需测试 equip + skill + map 各自 layout) |
| 3 | `sao-render.js` | `renderEquipment` 改用 `SHARED_SAO_PANEL_CSS` | ~10 | 低 |
| 4 | `sao-render.js` | `renderSwordSkill` 同 | ~10 | 低 |
| 5 | `sao-render.js` | `renderMap` 删除 `.map-status-wrapper`, 用 `.sao-panel-wrapper` | ~120 (删除 + ~30 重写) | 中 (map 内容 HTML 是否仍能解析; 需看 rawText/sample) |
| 6 | `sao-render.js` | `renderUserStatus` 内 `.sao-equip-btn` CSS 替换 (组件 1) | ~30 | 低 |
| 7 | `sao-render.js` | `renderUserStatus` 内 `.sao-cursor-badge` CSS 替换 (组件 3) | ~30 | 低 |
| 8 | `sao-render.js` | `renderUserStatus` 内 `.sao-npc-card` CSS 升级 (组件 5 NPC 部分) | ~20 | 低 |
| 9 | `panel.html` | `<span id="sao_cursor_text">` → 使用 `.sao-cursor-badge` 双形态 (组件 3 副作用) | 1 (HTML) + JS 渲染函数 | 低 |
| 10 | `style.css` | `.mes_text` R2 升级 → R3 (组件 4) | +60 | 中 (CSS specificity, 需验证消息 hover/focus 行为) |
| 11 | `style.css` | 加入 `.sao-status-map-grid` 容器 + `.sao-world-grid` (组件 2 A+B) | +20 | 中 (依赖 Phase 1 完成) |
| 12 | `panel.html` | `世界状态` 部分 HTML 改为 `sao-world-grid` (组件 2) | ~10 | 低 |
| 13 | `index.js` 或 `sao-render.js` | 在 `renderAllTags` 后调用 `bindStatusMapGroup()` 把 user_status + map 包成 grid (组件 2) | +30 | 中 (DOM 重组, 时序) |
| 14 | `sao-store-player.js` 或 `CURSOR_LABELS` | 添加 orange (#ff8a3d) fork | +2 | 极低 (纯数据) |

**总计**: ~ +10 行 CSS token 重用, +280 行新 CSS, -280 行旧 CSS, ~ +40 行 HTML/JS. 净变更 ~ +40 行, 影响 4 个文件, 0 个新文件.

### 风险与回归测试

| 风险点 | 检测方法 |
|---|---|
| **14 个改动步骤可能影响多 renderer** | 单元测试 `test/projection-html.test.js` + 手动测 4 个场景: equip (有穿戴有背包), skill (有可战斗数据), map (有楼层有天气), npc (有 relationship) |
| **`.mes_text` R3 升级可能与酒馆内已有消息主题冲突** | 验证 4 种 ST 主题 (default, dark, sci-fi, ...); CSS 需用 `!important` 因为 `.mes_text` 是 ST 已有元素 |
| **Shadow DOM 内 token 重声明** | user_status shadow 内已有 `--primary: #00d2ff` 等重声明 (sao-render.js line 674-689), SHARED_SAO_PANEL_CSS 同样要重声明以避免 leaky CSS |
| **CSS specificity** | 设计系统应避免过深嵌套; 推荐 BEM 变种 `.sao-{component}-{part}` |
| **用户偏好** | 4 角支架可能太"花"; 提供 2 角选项. Pulse 动画可能被嫌打扰, 提供静态选项 |

---

## 四、与用户审阅的开放问题

1. **顶部支架 4 角 vs 2 角**: chat surface (`mes_text`) 装饰的角部支架数量. **默认**: 4 角 (完整 HUD chrome 感). **备选**: 仅 2 角 (顶左 + 底右, 更保守).

2. **新光标 orange 颜色**: 真正的暖橙 `#ff8a3d` (与 gold `#ffb800` 区分), 还是保留现有 var(--warning)? **默认**: 暖橙, 但需在 token 新增 `--cursor-criminal` (#ff8a3d). 备选: 复用 `--warning`, 接受与橘色更接近金色.

3. **新光标是否需要脉动**: 给 diamond 加 2.4s 微脉动. **默认**: 是. **备选**: 关闭 (静态). 用户群对动效敏感度差异大.

4. **NPC 卡片左边界**: 是用绿色 (`--success` 体现 NPC/canon) 还是青色 (`--primary` 体现全局统一)? 语义建议: cyan 玩家 / green NPC. **默认**: green left border.

5. **装备稀有度色条**: 是否在渲染新装备内容时, 沿用 `--sao-r-*` token 给 `.sao-rarity-{rarity}` class 上色? 这与侧栏 `#sao_detail_modal` 已一致. **默认**: 是.

6. **是否在新组件中带微动画**: 扫光 hover / 角部支架 hover 高亮 / hover lift 等. **默认**: 是 (已是 baseline), 但把所有动画时长统一到同一帧 (≤ 0.5s, ≥ 1.8s).

---

## 五、文件交付清单 (本次交付, 仅方案文档)

- `SAO_UI_REDESIGN_PROPOSAL.md` (本文)
- 后续: `SAO_UI_REDESIGN_PROPOSAL_PHASE_1_IMPL.md` (Phase 1 实施技术细节 / diffs / 测试计划)
- 后续: `SAO_UI_REDESIGN_PROPOSAL_PHASE_2_3_IMPL.md` (Phase 2-3 实施技术细节)

**本次(§1§)不实现, 仅交付方案文档与设计原则.**

---

## 附录 A — 单一文档核心规则 (Style Bible)

> 当未来开发者添加新面板 (例如 "新成就" "新任务链") 时, 应遵循以下:

1. **外壳**: 必须 `.sao-panel-wrapper`, 顶部必须有 cyan 渐变 ::before, 整体必须有 1px cyan 描边 (`--border-accent`) + drop-shadow.
2. **折叠 summary**: 闭合态 = 暗色按钮条 + 左侧 3px cyan 实边 + ▸; 展开态 = 透明 bg + cyan 标题发光 + 底部 1px cyan 渐变分隔线.
3. **内容 div**: glass 半透 (`var(--bg-glass)`) + border-subtle + backdrop-filter blur(4px).
4. **按钮**: 主用 `.sao-btn`; 行内小按钮用 `.sao-equip-btn` (新版 clip-path).
5. **token**: 不用引入新的 hex 值, 复用既有 token; 若确需新色, 必须先加 token.
6. **字体**: 大标题 Orbitron, 按钮/小标签 Rajdhani, 正文 Exo 2.
7. **拒绝**: 米色/像素风 (Stardew), 无 token 引入, 中途换主题.

---

## 附录 B — 视觉对照表 (现状 → 目标)

| 元素 | 现状 (差) | 目标 (优) |
|---|---|---|
| 使用按钮 | 透明+1px cyan 描边, 平面 | clip-path hex 形 + 渐变 + 扫光 hover |
| 卸下按钮 | 同上 (无差别) | 同上但用 `--danger` 红色变体 |
| 光标徽章 | pill (圆角条) + 纯色背景 | hex diamond (旋转 45°) + 微脉动 + glow |
| 聊天表面 | 1 cyan border-left + 1 角 | 双线边 + 顶发光条 + **4 角支架 (hover 显亮)** |
| 新装备 | 米色 stardew (cream) + pixel pressed | SAO Panel (navy + cyan 渐变 + glass) |
| 新剑技 | 米色 stardew + ✨ emoji | SAO Panel + 数字 Orbitron 发光 |
| 世界状态 | 米色 map wrapper + 5 行单列 | SAO Panel + 2 列网格 |
| NPC 卡片 | sao-bg-elevated + 圆角 | linear-gradient + 左 **green** 边 + inset 光 |
| 玩家/世界布局 | 已 grid, 但用户感知为竖排 | (A) chat 内: 仍 grid; (B) 侧栏世界内部分 2 列 |
| Calendar | 玻璃托盘 + 浮起瓦片 (v2) ✅ | 保持 (作为 "好" 基线) |
| Character Status | HUD 卡 + cyan 边 (renderUserStatus) ✅ | 保持 (作为 "好" 基线), 仅替换 equip-btn / cursor-badge |

---

## 附录 C — "Don'ts" (绝对不要)

- ❌ 任何米色 / cream / beige 主题.
- ❌ 任何紫色 (purple) 主色 (仅 epic rarity 用 #a855f7).
- ❌ 任何 emoji 大表情作为组件主体 (small icon 行内 OK).
- ❌ 任何直角 border-radius (除极少数纯粹装饰元素).
- ❌ 任何未在 token 中定义的颜色 hex 识别 except 已有 (rarity + cursor-criminal).
- ❌ 任何全局 opacity dim (calendar v1 0.45 已废弃).
- ❌ 任何 hover 时放大超过 1.05 倍 (会抖动).
- ❌ 任何脉动动画时长超过 3s (calendar today 2.4-2.6 OK).
