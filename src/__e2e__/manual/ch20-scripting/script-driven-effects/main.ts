/**
 * script-driven-effects/main.ts — Lua script-triggered visual effects acceptance test
 * OpenRA对照: Ch20 Scripting System (ScriptTriggers, LuaScript)
 * Verifies: S1. Camera move, S2. Actor animation, S3. Dialogue text,
 *           S4. Timed sequence execution, S5. Error handling
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
} from '@babylonjs/core'

// Scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)
const camera = new ArcRotateCamera('cam', -Math.PI/2.5, Math.PI/3.5, 12, new Vector3(3,2,3), scene)
camera.lowerRadiusLimit=3;camera.upperRadiusLimit=30;camera.attachControl(canvas,true)
new HemisphericLight('hemi',new Vector3(0.5,1,0.3),scene).intensity=0.85

// Ground
const gnd=MeshBuilder.CreateGround('gnd',{width:14,height:14},scene);gnd.position.y=-0.02
const gm=new StandardMaterial('gm',scene)
gm.diffuseColor=new Color3(0.08,0.11,0.16);gm.specularColor=new Color3(0,0,0);gm.alpha=0.75;gnd.material=gm
for(let i=-3;i<=9;i++){const l=MeshBuilder.CreateLines('gx'+i,{points:[new Vector3(i,0.005,-3),new Vector3(i,0.005,9)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=i%3===0?0.25:0.06}
for(let j=-3;j<=9;j++){const l=MeshBuilder.CreateLines('gz'+j,{points:[new Vector3(-3,0.005,j),new Vector3(9,0.005,j)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=j%3===0?0.25:0.06}

// Actor
const actor=MeshBuilder.CreateBox('actor',{width:0.8,height:0.6,depth:0.5},scene)
actor.position=new Vector3(3,0.5,3)
const am=new StandardMaterial('am',scene);am.diffuseColor=new Color3(0.2,0.5,0.7);am.specularColor=new Color3(0,0,0);actor.material=am

// Dialogue overlay
const dialogueEl=document.getElementById('dialogue')!

// Script engine
interface ScriptStep { type:'camera'|'anim'|'dialogue'|'delay'; data:Record<string,unknown> }
let scriptRunning=false;let scriptStep=0;let scriptQueue:ScriptStep[]=[]
let eventsCount=0;let animName='idle'

// Preallocated
const _targetPos=new Vector3();const _tmpColor=new Color3()

function showDialogue(text:string,duration=2000):void{
  dialogueEl.textContent=text;dialogueEl.style.opacity='1'
  setTimeout(()=>{dialogueEl.style.opacity='0'},duration)
}
function runScript(steps:ScriptStep[]):void{
  if(scriptRunning)return;scriptQueue=steps;scriptRunning=true;scriptStep=0;eventsCount=0
  processNextStep()
}
function processNextStep():void{
  if(scriptStep>=scriptQueue.length){scriptRunning=false;updDiag();return}
  const step=scriptQueue[scriptStep]!;eventsCount++
  switch(step.type){
    case'camera':{
      const pos=step.data as {x:number;y:number;z:number}
      _targetPos.set(pos.x,pos.y,pos.z);camera.target=_targetPos.clone()
      scriptStep++;processNextStep();break
    }
    case'anim':{
      animName=step.data.name as string
      const color=step.data.color as string||'0.2,0.5,0.7'
      const[c1,c2,c3]=color.split(',').map(Number) as number[]
      _tmpColor.set(c1!,c2!,c3!);am.diffuseColor=_tmpColor
      scriptStep++;processNextStep();break
    }
    case'dialogue':{
      showDialogue(step.data.text as string,(step.data.duration as number)||2000)
      scriptStep++;setTimeout(processNextStep,1200);break
    }
    case'delay':{
      scriptStep++;setTimeout(processNextStep,step.data.ms as number);break
    }
    default:scriptStep++;processNextStep()
  }
  updDiag()
}
function updDiag():void{
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('dRunning',scriptRunning?'running':'idle');s('dStep',scriptRunning?String(scriptStep):'-')
  s('dCam',`${camera.target.x.toFixed(1)},${camera.target.y.toFixed(1)},${camera.target.z.toFixed(1)}`)
  s('dAnim',animName);s('dColor',`${am.diffuseColor.r.toFixed(2)},${am.diffuseColor.g.toFixed(2)},${am.diffuseColor.b.toFixed(2)}`)
  s('dEvents',String(eventsCount))
}

// Render
let lf=0;let cfps='0'
engine.runRenderLoop(()=>{scene.render();const n=performance.now();if(n-lf>500){cfps=engine.getFps().toFixed(1);lf=n}
  const s=(id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('info-fps',cfps);s('info-ua',navigator.userAgent.slice(0,60))
  s('info-viewport',window.innerWidth+'x'+window.innerHeight);s('info-engine','WebGL 2.0')
  s('info-time',new Date().toISOString())
})

// UI
document.getElementById('btnCamera')!.addEventListener('click',()=>runScript([{type:'camera',data:{x:6,y:1,z:6}}]))
document.getElementById('btnAnim')!.addEventListener('click',()=>runScript([{type:'anim',data:{name:'attack',color:'1,0.3,0.1'}}]))
document.getElementById('btnDialogue')!.addEventListener('click',()=>runScript([{type:'dialogue',data:{text:'Hello Commander!',duration:3000}}]))
document.getElementById('btnSequence')!.addEventListener('click',()=>runScript([
  {type:'camera',data:{x:6,y:1.5,z:5}},
  {type:'delay',data:{ms:500}},
  {type:'dialogue',data:{text:'Moving to target...',duration:2000}},
  {type:'anim',data:{name:'move',color:'0.2,0.7,0.3'}},
  {type:'delay',data:{ms:1000}},
  {type:'anim',data:{name:'idle',color:'0.2,0.5,0.7'}},
  {type:'dialogue',data:{text:'Sequence complete.',duration:2000}},
]))
document.getElementById('btnReset')!.addEventListener('click',()=>{scriptRunning=false;scriptQueue=[];scriptStep=0;eventsCount=0;animName='idle';camera.target=new Vector3(3,2,3);_tmpColor.set(0.2,0.5,0.7);am.diffuseColor=_tmpColor;updDiag()})

// Harness
;(window as any).__testHarness={
  runScript(steps:ScriptStep[]){runScript(steps)},
  getCameraPosition():{x:number;y:number;z:number}{return{x:camera.target.x,y:camera.target.y,z:camera.target.z}},
  getActorAnimation():string{return animName},
  getDialogueText():string{return dialogueEl.textContent||''},
  getScriptStatus():string{return scriptRunning?'running':'idle'},
  getEventsCount():number{return eventsCount},
  isDialogueVisible():boolean{return dialogueEl.style.opacity==='1'},
  reset(){document.getElementById('btnReset')!.click()},
}
updDiag()
window.addEventListener('beforeunload',()=>engine.dispose())
window.addEventListener('resize',()=>engine.resize())
