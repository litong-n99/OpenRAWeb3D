/**
 * button-states/main.ts — Button visual state acceptance test
 * OpenRA对照: ButtonWidget (Ch16 UI Widget Extensions)
 * Verifies: hover brightness +20%, press darkness -20%, disabled no-click
 */
let clickCount = 0
function getBg(el: HTMLElement): string { return getComputedStyle(el).backgroundColor }
function rgbToArr(rgb: string): number[] {
  const m = rgb.match(/[\d.]+/g); return m ? m.map(Number) : [0,0,0]
}
function brightness(rgb: string): number { const c = rgbToArr(rgb); return (c[0]!+c[1]!+c[2]!)/3 }

const btn = document.getElementById('btnDefault')!; const btnH = document.getElementById('btnHover')!
const btnP = document.getElementById('btnPress')!; const btnD = document.getElementById('btnDisabled')! as HTMLButtonElement
const defBg = getBg(btn)

// Compute brightness ratios for hover/press vs default (used in console verification)
setTimeout(() => {
  const defBri = brightness(defBg)
  const hBri = brightness(getBg(btnH))
  const pBri = brightness(getBg(btnP))
  const dBri = brightness(getBg(btnD))
  console.log(`[button-states] Brightness: default=${defBri.toFixed(1)} hover=${hBri.toFixed(1)} (ratio=${(hBri/defBri).toFixed(3)}) press=${pBri.toFixed(1)} (ratio=${(pBri/defBri).toFixed(3)}) disabled=${dBri.toFixed(1)}`)
}, 500)

// Track hover
let hoverBg = ''; btnH.addEventListener('mouseenter',()=>{hoverBg=getBg(btnH);updDiag()})
btnH.addEventListener('mouseleave',updDiag)
// Track press (using mousedown/mouseup)
let pressBg = ''; btnP.addEventListener('mousedown',()=>{pressBg=getBg(btnP);updDiag()})
btnP.addEventListener('mouseup',updDiag)
// Clicks
btn.addEventListener('click',()=>{clickCount++;updDiag()})
btnD.addEventListener('click',(e)=>{e.preventDefault();clickCount++;updDiag()}) // should not fire

function updDiag():void{
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('dBg',defBg); const hb=hoverBg||getBg(btnH); s('dHov',hb)
  s('dPrs',pressBg||getBg(btnP)); s('dDis',getBg(btnD))
  s('dClick',btnD.disabled?'disabled (no click)':'enabled'); s('dCnt',String(clickCount))
}
updDiag()
document.getElementById('info-ua')!.textContent=navigator.userAgent.slice(0,60)
document.getElementById('info-viewport')!.textContent=window.innerWidth+'x'+window.innerHeight
document.getElementById('info-time')!.textContent=new Date().toLocaleTimeString()

// Harness
;(window as any).__testHarness = {
  setButtonState(id:string,state:'default'|'hover'|'press'|'disabled'):void{
    // Try exact id match first, then btn+id prefix, then btn+StateName fallback
    let el=document.getElementById(id) ?? document.getElementById('btn'+id) ??
      document.getElementById('btn'+{default:'Default',hover:'Hover',press:'Press',disabled:'Disabled'}[state])
    if(!el){console.warn('[testHarness] Button not found:',id);return}
    if(state==='hover')el.dispatchEvent(new MouseEvent('mouseenter'))
    else if(state==='press')el.dispatchEvent(new MouseEvent('mousedown'))
    else if(state==='disabled'){(el as HTMLButtonElement).disabled=true}
    else{(el as HTMLButtonElement).disabled=false;el.dispatchEvent(new MouseEvent('mouseleave'))}
  },
  getButtonBackground(id:string):string{return getBg(document.getElementById('btn'+id)!)},
  getButtonTextColor(id:string):string{return getComputedStyle(document.getElementById('btn'+id)!).color},
  isButtonClickable(id:string):boolean{return!(document.getElementById('btn'+id)!as HTMLButtonElement).disabled},
  reset():void{clickCount=0;(document.getElementById('btnDisabled')!as HTMLButtonElement).disabled=true;updDiag()},
}
