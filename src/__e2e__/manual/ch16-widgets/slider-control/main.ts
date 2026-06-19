/**
 * slider-control/main.ts — Slider widget acceptance test
 * OpenRA对照: SliderWidget (Ch16 UI Widget Extensions)
 * Verifies: thumb linear mapping, track fill, step snap, bounds
 */
const track = document.getElementById('slider')!; const thumb = document.getElementById('thumb')!
const fill = document.getElementById('fill')!; const valEl = document.getElementById('val')!
let value = 50; const min = 0; const max = 100; const step = 5
let dragging = false

function valueToX(v: number): number {
  return ((v - min) / (max - min)) * track.clientWidth
}
function xToRawValue(x: number): number {
  return Math.max(min, Math.min(max, min + (x / track.clientWidth) * (max - min)))
}
function snapValue(v: number): number { return Math.round(v / step) * step }
let rawValue = value // continuous value during drag (MAJOR fix)
function updateUI(): void {
  const x = valueToX(value)
  thumb.style.left = x + 'px'; fill.style.width = x + 'px'; valEl.textContent = String(value)
}
function updDiag(): void {
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('dV',String(value)); s('dX',valueToX(value).toFixed(1)+'px')
  s('dW',fill.style.width); s('dS',String(step))
}

thumb.addEventListener('mousedown',(e)=>{dragging=true;e.preventDefault()})
document.addEventListener('mousemove',(e)=>{
  if(!dragging)return; const rect=track.getBoundingClientRect()
  rawValue=xToRawValue(e.clientX-rect.left);value=rawValue;updateUI();updDiag() // continuous during drag
})
document.addEventListener('mouseup',()=>{
  if(!dragging)return; dragging=false
  value=snapValue(rawValue);updateUI();updDiag() // snap to step on release
})
track.addEventListener('click',(e)=>{
  if(dragging)return; const rect=track.getBoundingClientRect()
  rawValue=xToRawValue(e.clientX-rect.left);value=snapValue(rawValue);updateUI();updDiag()
})
updateUI();updDiag()
document.getElementById('info-ua')!.textContent=navigator.userAgent.slice(0,60)
document.getElementById('info-viewport')!.textContent=window.innerWidth+'x'+window.innerHeight
document.getElementById('info-time')!.textContent=new Date().toLocaleTimeString()

// Harness
;(window as any).__testHarness = {
  setSliderValue(_id:string,v:number):void{value=Math.max(min,Math.min(max,Math.round(v/step)*step));updateUI();updDiag()},
  getSliderValue():number{return value},
  getThumbPosition():number{return valueToX(value)},
  getTrackFillWidth():number{return parseFloat(fill.style.width)||0},
  getStep():number{return step},
  reset():void{value=50;updateUI();updDiag()},
}
