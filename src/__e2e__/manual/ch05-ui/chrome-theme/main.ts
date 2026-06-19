/**
 * chrome-theme/main.ts — ChromeProvider theme acceptance test
 * OpenRA对照: OpenRA.Game/Graphics/ChromeProvider.cs, ChromeMetrics.cs
 * Verifies: C1. Panel border, C2. Button states, C3. Scrollbar, C4. Theme switch
 */

interface ThemeColors { panelBg: string; panelBorder: string; headerBg: string; btnBg: string; btnText: string; scrollTrack: string; scrollThumb: string }
const themes: Record<string, ThemeColors> = {
  ra:  {panelBg:'#2B2B2B',panelBorder:'#0f3460',headerBg:'#16213e',btnBg:'#1a1a2e',btnText:'#eee',scrollTrack:'#1a1a2e',scrollThumb:'#0f3460'},
  cnc: {panelBg:'#2B2000',panelBorder:'#8B6914',headerBg:'#3D2B00',btnBg:'#4A3500',btnText:'#FFD700',scrollTrack:'#2B2000',scrollThumb:'#8B6914'},
  d2k: {panelBg:'#1B1820',panelBorder:'#8B4513',headerBg:'#2B1A10',btnBg:'#3B2010',btnText:'#DEB887',scrollTrack:'#1B1820',scrollThumb:'#8B4513'},
}
let currentTheme = 'ra'

function applyTheme(name: string): void {
  currentTheme = name; const t = themes[name]!
  const panel = document.getElementById('testPanel')!; panel.style.background = t.panelBg; panel.style.border = `2px solid ${t.panelBorder}`
  document.getElementById('panelHdr')!.style.background = t.headerBg; document.getElementById('panelBody')!.style.background = t.panelBg
  document.querySelectorAll('.btn').forEach(b => { const be = b as HTMLElement; be.style.background = t.btnBg; be.style.color = t.btnText; be.style.border = `1px solid ${t.panelBorder}` })
  document.getElementById('scrollDemo')!.style.background = t.scrollTrack; document.getElementById('scrollDemo')!.style.color = t.btnText
  document.getElementById('scrollDemo')!.style.setProperty('scrollbar-color', `${t.scrollThumb} ${t.scrollTrack}`)
  updateDiag()
}
function getPanelStyle(): {bg:string;border:string;headerBg:string} { const t=themes[currentTheme]!; return {bg:t.panelBg,border:t.panelBorder,headerBg:t.headerBg} }
function getButtonStyle(state:'normal'|'hover'|'press'|'disabled'): {bg:string;text:string} {
  const t=themes[currentTheme]!; let bg=t.btnBg
  if(state==='hover'){const r=parseInt(t.btnBg.slice(1,3),16);bg='#'+Math.min(255,Math.round(r*1.2)).toString(16)+t.btnBg.slice(3)}
  if(state==='press'){const r=parseInt(t.btnBg.slice(1,3),16);bg='#'+Math.max(0,Math.round(r*0.8)).toString(16)+t.btnBg.slice(3)}
  if(state==='disabled') return {bg:t.btnBg,text:t.btnText}
  return {bg,text:t.btnText}
}
function getScrollbarStyle(): {thumbRatio:number;trackBg:string;thumbBg:string} {
  const t=themes[currentTheme]!; const el=document.getElementById('scrollDemo')!
  return {thumbRatio:el.clientHeight/(el.scrollHeight||1),trackBg:t.scrollTrack,thumbBg:t.scrollThumb}
}
function updateDiag(): void {
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  const t=themes[currentTheme]!;s('dName',currentTheme);s('dBorder',t.panelBorder);s('dHdrBg',t.headerBg)
  s('dBtnBg',t.btnBg);s('dBtnTxt',t.btnText);s('dThumb',getScrollbarStyle().thumbRatio.toFixed(2))
}

// UI
document.getElementById('selTheme')!.addEventListener('change', function(this:HTMLSelectElement){applyTheme(this.value)})
document.getElementById('btnHover')!.addEventListener('mouseenter', function(){updateDiag();document.getElementById('dBtnBg')!.textContent='hover:brighter'})
document.getElementById('btnHover')!.addEventListener('mouseleave', function(){updateDiag()})
document.getElementById('btnReset')!.addEventListener('click',()=>applyTheme('ra'))

// Init
applyTheme('ra')
document.getElementById('info-ua')!.textContent = navigator.userAgent.slice(0,60)
document.getElementById('info-viewport')!.textContent = window.innerWidth+'x'+window.innerHeight
document.getElementById('info-time')!.textContent = new Date().toLocaleTimeString()

// Harness
;(window as any).__testHarness = {
  loadTheme(name:'ra'|'cnc'|'d2k'){applyTheme(name)},
  getPanelStyle(){return getPanelStyle()},
  getButtonStyle(state:'normal'|'hover'|'press'|'disabled'){return getButtonStyle(state)},
  getScrollbarStyle(){return getScrollbarStyle()},
  getCurrentTheme():string{return currentTheme},
  reset(){applyTheme('ra')},
}
