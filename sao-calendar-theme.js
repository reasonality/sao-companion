/**
 * 共享日历主题 CSS —— 控制台日历与聊天消息日历共用同一套样式。
 * 单一来源：改这里，两处同步生效。
 *
 * 与 panel.html 内嵌 `.sao-cal-*` 规则一致，但聊天日历格子高度用 84px（per-message 经济），
 * 控制台仍用 140px（panel.html 内嵌规则覆盖此值）。
 * Shadow DOM 内 !important 不会泄漏到主文档，安全。
 */
export const SAO_CALENDAR_CSS = `
:host{display:block;margin:0;padding:0;box-sizing:border-box;}
.sao-cal-grid{display:grid!important;grid-template-columns:repeat(7,1fr)!important;grid-template-rows:22px!important;grid-auto-rows:minmax(84px,84px)!important;gap:3px!important;position:relative!important;}
.sao-cal-header{text-align:center!important;padding:0!important;font-family:"Rajdhani","Noto Sans SC",sans-serif!important;font-size:0.65em!important;font-weight:700!important;color:rgba(255,255,255,0.7)!important;text-transform:uppercase!important;letter-spacing:0.08em!important;border-bottom:1px solid rgba(0,210,255,0.18)!important;display:flex!important;align-items:center!important;justify-content:center!important;min-height:0!important;height:100%!important;}
.sao-cal-cell{height:84px!important;min-height:0!important;box-sizing:border-box!important;padding:4px 5px!important;background:rgba(22,30,46,0.6)!important;border:1px solid rgba(255,255,255,0.06)!important;border-radius:6px!important;position:relative!important;cursor:pointer!important;display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important;gap:2px!important;transition:border-color 0.2s ease,background 0.2s ease,box-shadow 0.2s ease!important;box-shadow:0 2px 6px rgba(0,0,0,0.2)!important;overflow-y:auto!important;min-width:0!important;}
.sao-cal-cell:hover{border-color:rgba(0,210,255,0.3)!important;background:rgba(28,38,58,0.7)!important;box-shadow:0 4px 12px rgba(0,210,255,0.12)!important;}
.sao-cal-cell.sao-cal-today{background:rgba(0,214,138,0.12)!important;border:1px solid rgba(0,214,138,0.5)!important;box-shadow:0 0 10px rgba(0,214,138,0.15)!important;}
.sao-cal-cell.sao-cal-today:hover{background:rgba(0,214,138,0.18)!important;box-shadow:0 4px 14px rgba(0,214,138,0.2)!important;}
.sao-cal-cell.sao-cal-other-month{background:rgba(15,21,34,0.3)!important;border-color:rgba(255,255,255,0.03)!important;box-shadow:none!important;}
.sao-cal-day-num{font-family:"Orbitron","Noto Sans SC",sans-serif!important;font-size:0.85em!important;font-weight:700!important;color:var(--text-primary,#eaf2ff)!important;line-height:1!important;display:flex!important;align-items:center!important;}
.sao-cal-today .sao-cal-day-num{color:#00d68a!important;}
.sao-cal-other-month .sao-cal-day-num{color:#5c6b85!important;}
.sao-cal-dots{display:inline-flex!important;gap:2px!important;margin-left:4px!important;align-items:center!important;}
.sao-cal-dot{width:4px!important;height:4px!important;border-radius:50%!important;display:inline-block!important;}
.sao-cal-dot-canon{background:#00d68a!important;}
.sao-cal-dot-apt{background:#ffb800!important;}
.sao-cal-event-text{font-family:"Rajdhani","Noto Sans SC",sans-serif!important;font-size:0.62em!important;font-weight:500!important;line-height:1.2!important;color:rgba(232,238,255,0.85)!important;white-space:normal!important;word-break:break-word!important;display:block!important;flex:1!important;overflow:hidden!important;}
.sao-cal-event-line{font-family:"Rajdhani","Noto Sans SC",sans-serif!important;font-size:0.62em!important;font-weight:500!important;line-height:1.25!important;color:rgba(232,238,255,0.85)!important;word-break:break-word!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;margin-top:1px!important;padding-left:5px!important;border-left:2px solid rgba(0,210,255,0.35)!important;}
.sao-cal-event-sub{color:rgba(180,200,230,0.7)!important;font-size:0.58em!important;font-weight:400!important;border-left-color:rgba(0,210,255,0.2)!important;}
.sao-cal-event-more{font-family:"Rajdhani","Noto Sans SC",sans-serif!important;font-size:0.56em!important;color:rgba(0,210,255,0.7)!important;font-weight:600!important;margin-top:1px!important;padding-left:7px!important;}
.sao-cal-details>summary{cursor:pointer;color:#00d2ff;font-family:"Rajdhani","Noto Sans SC",sans-serif;font-weight:700;font-size:0.9em;padding:6px 10px;background:rgba(15,21,34,0.6);border:1px solid rgba(0,210,255,0.2);border-radius:6px;list-style:none;display:flex;align-items:center;gap:6px;}
.sao-cal-details>summary::-webkit-details-marker{display:none;}
.sao-cal-details>summary::before{content:"\\25B6";font-size:0.7em;transition:transform 0.2s;}
.sao-cal-details[open]>summary::before{transform:rotate(90deg);}
.sao-cal-details[open]>summary{margin-bottom:10px;border-bottom:1px solid rgba(0,210,255,0.15);padding-bottom:6px;}
.sao-cal-placeholder{padding:8px;text-align:center;color:#8c785d;font-size:13px;}
.sao-cal-nav{display:inline-flex;gap:2px;margin-left:auto;}
.sao-cal-nav-btn{background:rgba(0,210,255,0.1);border:1px solid rgba(0,210,255,0.2);color:#00d2ff;border-radius:3px;cursor:pointer;font-size:0.8em;padding:1px 6px;line-height:1;}
.sao-cal-nav-btn:hover{background:rgba(0,210,255,0.2);}
.sao-cal-details summary{display:flex;align-items:center;gap:6px;}
@media(max-width:640px){
.sao-cal-grid{grid-template-rows:18px!important;grid-auto-rows:70px!important;gap:2px!important;}
.sao-cal-cell{height:70px!important;padding:3px 4px!important;border-radius:4px!important;}
.sao-cal-day-num{font-size:0.8em!important;}
.sao-cal-event-text{font-size:0.85em!important;gap:1px!important;}
.sao-cal-event-line{font-size:0.85em!important;padding:0 3px!important;}
.sao-cal-event-sub{font-size:0.78em!important;}
.sao-cal-event-more{font-size:0.75em!important;}
.sao-cal-header{font-size:0.6em!important;}
.sao-cal-dot{width:3px!important;height:3px!important;}
}
`;
