/**
 * dropdown-menu/main.ts — Dropdown menu acceptance test
 * OpenRA对照: DropDownWidget (Ch16 UI Widget Extensions)
 * Verifies: open/close animation, item select, outside-click close, scroll
 */
const dd = document.getElementById('dd')!; const toggle = document.getElementById('ddToggle')!
const menu = document.getElementById('ddMenu')!; const label = document.getElementById('ddLabel')!
let isOpen = false; let selectedIdx = -1

function open(): void { dd.classList.add('open'); isOpen = true; updDiag() }
function close(): void { dd.classList.remove('open'); isOpen = false; updDiag() }
function selectItem(idx: number): void {
  selectedIdx = idx; menu.querySelectorAll('.dropdown-item').forEach((el,i)=>{el.classList.toggle('selected',i===idx)})
  label.textContent = (menu.children[idx] as HTMLElement)?.textContent || 'Select Item'; close()
}

toggle.addEventListener('click',(e)=>{e.stopPropagation();isOpen?close():open()})
menu.addEventListener('click',(e)=>{const el=(e.target as HTMLElement).closest('.dropdown-item') as HTMLElement|null;if(el){const idx=parseInt(el.dataset.idx!);selectItem(idx)}})
document.addEventListener('click',()=>{if(isOpen)close()})
function updDiag():void{
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('dOpen',isOpen?'YES':'no'); s('dSel',selectedIdx>=0?String(selectedIdx):'-')
  s('dH',menu.scrollHeight+'px')
}
updDiag()
document.getElementById('info-ua')!.textContent=navigator.userAgent.slice(0,60)
document.getElementById('info-viewport')!.textContent=window.innerWidth+'x'+window.innerHeight
document.getElementById('info-time')!.textContent=new Date().toLocaleTimeString()

// Harness
;(window as any).__testHarness = {
  openDropdown():void{open()},
  selectItem(_id:string,idx:number):void{selectItem(idx)},
  getSelectedItem():number{return selectedIdx},
  getMenuHeight():number{return menu.scrollHeight},
  isMenuOpen():boolean{return isOpen},
  reset():void{selectedIdx=-1;label.textContent='Select Item';close();menu.querySelectorAll('.dropdown-item').forEach(el=>el.classList.remove('selected'));updDiag()},
}
