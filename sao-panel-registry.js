// SAO Companion - 面板注册表（Phase A 重构）
// 单一事实来源：面板渲染顺序 + 标签清单。
// 纯数据模块，不导入任何渲染器（避免循环依赖）；渲染器在 renderAllTags 调用时按 tag 映射到本地函数。

/**
 * 面板注册表（有序）。顺序 = 渲染顺序 = 消息中标签的原始顺序。
 * - tag: SAO 自定义标签名
 * - isSpecial: true 表示渲染器自行定位锚点（如 battle 面板查找 zd_status），不传 refNode
 */
export const PANEL_REGISTRY = [
    { tag: 'equip' },
    { tag: 'swordskill' },
    { tag: 'user_status' },
    { tag: 'map' },
    { tag: 'calendar' },
    { tag: 'zd_status', isSpecial: true },
    { tag: 'digest' },
];

/** 所有面板标签的扁平数组（顺序无关，用于 DOMPurify/cleanup 成员判断） */
export const PANEL_TAGS = PANEL_REGISTRY.map(e => e.tag);
