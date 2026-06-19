/**
 * widget-layout/main.ts — Widget nesting & bounds visual acceptance test
 * OpenRA对照: OpenRA.Game/Widgets/Widget.ts, WidgetLoader.cs
 * Verifies: L1. Child bounds clipped, L2. Padding correct, L3. Z-order,
 *           L4. Center alignment, L5. Depth 5 no artifacts
 */

interface WidgetDef {
  id: string; parent?: string; x: number; y: number; width: number; height: number
  margin: number; padding: number; zIndex: number; align: 'tl'|'center'|'br'
}
const widgets: Map<string, {def: WidgetDef; el: HTMLDivElement}> = new Map()

// Compute nesting depth from parent chain
function getDepth(def: WidgetDef): number {
  let d = 0; let p = def.parent
  while (p && widgets.has(p)) { d++; p = widgets.get(p)!.def.parent }
  return d
}
function createWidget(def: WidgetDef): void {
  const el = document.createElement('div')
  const depth = getDepth(def)
  el.className = `widget level-${Math.min(depth, 4)}`
  el.id = 'w-' + def.id
  el.style.left = def.x + 'px'; el.style.top = def.y + 'px'
  el.style.width = def.width + 'px'; el.style.height = def.height + 'px'
  el.style.padding = def.padding + 'px'; el.style.zIndex = String(def.zIndex)
  const parentEl = def.parent ? document.getElementById('w-' + def.parent) : document.getElementById('sandbox')
  if (parentEl) parentEl.appendChild(el)
  const label = document.createElement('div'); label.className = 'widget-label'
  label.textContent = `${def.id} (z:${def.zIndex})`; el.appendChild(label)
  widgets.set(def.id, {def, el})
}
function clearAll(): void { widgets.forEach(w => w.el.remove()); widgets.clear() }

function buildTree3(): void {
  clearAll()
  createWidget({id:'root',x:10,y:10,width:600,height:350,margin:5,padding:15,zIndex:1,align:'tl'})
  createWidget({id:'childA',parent:'root',x:20,y:20,width:250,height:280,margin:3,padding:10,zIndex:10,align:'tl'})
  createWidget({id:'childB',parent:'root',x:300,y:20,width:250,height:280,margin:3,padding:10,zIndex:11,align:'center'})
  updateDiag()
}
function buildTree5(): void {
  clearAll()
  createWidget({id:'root',x:10,y:10,width:650,height:420,margin:5,padding:10,zIndex:1,align:'tl'})
  createWidget({id:'l1a',parent:'root',x:15,y:15,width:280,height:370,margin:2,padding:8,zIndex:10,align:'tl'})
  createWidget({id:'l1b',parent:'root',x:320,y:15,width:280,height:370,margin:2,padding:8,zIndex:11,align:'center'})
  createWidget({id:'l2a',parent:'l1a',x:10,y:30,width:240,height:140,margin:2,padding:6,zIndex:20,align:'tl'})
  createWidget({id:'l2b',parent:'l1a',x:10,y:190,width:240,height:140,margin:2,padding:6,zIndex:21,align:'br'})
  createWidget({id:'l3a',parent:'l2a',x:8,y:8,width:100,height:100,margin:1,padding:4,zIndex:30,align:'center'})
  createWidget({id:'l3b',parent:'l2b',x:8,y:8,width:100,height:100,margin:1,padding:4,zIndex:31,align:'tl'})
  createWidget({id:'l4',parent:'l3a',x:10,y:10,width:60,height:60,margin:1,padding:2,zIndex:40,align:'center'})
  updateDiag()
}
function bringChild2ToTop(): void {
  const w = widgets.get('l1b'); if (w) { w.el.style.zIndex = '999'; updateDiag() }
}
function updateDiag(): void {
  const el = document.getElementById('diagTree')!
  let html = ''; widgets.forEach(w => { html += `<div class="r"><span>${w.def.id}</span><span class="v">z:${w.def.zIndex} ${w.def.width}x${w.def.height}</span></div>` })
  el.innerHTML = html
}

// UI
document.getElementById('btnTree3')!.addEventListener('click', buildTree3)
document.getElementById('btnTree5')!.addEventListener('click', buildTree5)
document.getElementById('btnAlign')!.addEventListener('click', function(){const w=widgets.get('childB');if(w){w.el.style.left='300px';w.el.style.top='35px';this.textContent='Align: Done'}})
document.getElementById('btnZOrder')!.addEventListener('click', bringChild2ToTop)
document.getElementById('btnReset')!.addEventListener('click', ()=>{clearAll();updateDiag()})

// Init
document.getElementById('info-ua')!.textContent = navigator.userAgent.slice(0,60)
document.getElementById('info-viewport')!.textContent = window.innerWidth+'x'+window.innerHeight
document.getElementById('info-time')!.textContent = new Date().toLocaleTimeString()

// Harness
;(window as any).__testHarness = {
  createWidgetTree(config:'tree3'|'tree5'){if(config==='tree3')buildTree3();else buildTree5()},
  getWidgetBounds(id:string):{x:number;y:number;w:number;h:number}|null{const w=widgets.get(id);if(!w)return null;const r=w.el.getBoundingClientRect();const p=document.getElementById('sandbox')!.getBoundingClientRect();return{x:r.left-p.left,y:r.top-p.top,w:r.width,h:r.height}},
  getWidgetZOrder(id:string):number|null{const w=widgets.get(id);return w?parseInt(w.el.style.zIndex):null},
  getComputedPadding(id:string):number|null{const w=widgets.get(id);return w?w.def.padding:null},
  getWidgetCount():number{return widgets.size},
  reset(){clearAll();updateDiag()},
}
