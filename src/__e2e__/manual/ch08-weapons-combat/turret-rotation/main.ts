/**
 * turret-rotation/main.ts — Turret rotation tracking & turn rate acceptance test
 * OpenRA对照: OpenRA.Mods.Common/Traits/Turreted.cs, AttackTurreted.cs
 * Verifies: T1. Turn rate limit, T2. Shortest path, T3. Target tracking,
 *           T4. Multi-turret independence, T5. No oscillation
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh, TransformNode,
} from '@babylonjs/core'

// Scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)
const camera = new ArcRotateCamera('cam', -Math.PI/2.5, Math.PI/3, 12, new Vector3(3,2,3), scene)
camera.lowerRadiusLimit=3; camera.upperRadiusLimit=30; camera.attachControl(canvas, true)
new HemisphericLight('hemi', new Vector3(0.5,1,0.3), scene).intensity = 0.85

// Ground
const gnd = MeshBuilder.CreateGround('gnd',{width:14,height:14},scene); gnd.position.y=-0.02
const gm = new StandardMaterial('gm',scene)
gm.diffuseColor=new Color3(0.08,0.11,0.16);gm.specularColor=new Color3(0,0,0);gm.alpha=0.75;gnd.material=gm
for(let i=-3;i<=9;i++){const l=MeshBuilder.CreateLines('gx'+i,{points:[new Vector3(i,0.005,-3),new Vector3(i,0.005,9)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=i%3===0?0.25:0.06}
for(let j=-3;j<=9;j++){const l=MeshBuilder.CreateLines('gz'+j,{points:[new Vector3(-3,0.005,j),new Vector3(9,0.005,j)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=j%3===0?0.25:0.06}

// Tank body
const body = MeshBuilder.CreateBox('body',{width:1.2,height:0.4,depth:0.8},scene)
body.position = new Vector3(3,0.3,3)
const bm = new StandardMaterial('bm',scene);bm.diffuseColor=new Color3(0.15,0.5,0.2);bm.specularColor=new Color3(0,0,0);body.material=bm

// Turret pivots
function createTurret(parentY: number, color: Color3, name: string): {pivot: TransformNode; barrel: Mesh; angle: number; targetAngle: number; mat: StandardMaterial} {
  const pivot = new TransformNode(name+'Pivot',scene); pivot.parent = body; pivot.position.y = parentY
  const barrel = MeshBuilder.CreateCylinder(name+'Barrel',{height:0.5,diameter:0.08,tessellation:10},scene)
  barrel.parent = pivot; barrel.position = new Vector3(0,0.05,0.25); barrel.rotation.x = Math.PI/2
  const mat = new StandardMaterial(name+'Mat',scene); mat.diffuseColor=color; mat.emissiveColor=color.scale(0.3)
  mat.specularColor=new Color3(0,0,0); barrel.material=mat
  return {pivot,barrel,angle:0,targetAngle:0,mat}
}
const turret0 = createTurret(0.4, new Color3(0.2,0.6,1), 't0') // blue
const turret1 = createTurret(0.6, new Color3(1,0.35,0.15), 't1') // orange

// Target actor (movable)
let targetPos = new Vector3(6,0.3,3)
const targetMesh = MeshBuilder.CreateSphere('target',{diameter:0.35},scene)
targetMesh.position = targetPos
const tm = new StandardMaterial('tm',scene); tm.diffuseColor=new Color3(1,0.2,0.2); tm.emissiveColor=new Color3(0.4,0.05,0.02); tm.specularColor=new Color3(0,0,0); targetMesh.material=tm

// Simulation
let turnRateDeg = 25 // degrees per tick (WAngle equivalent)
let ticksElapsed = 0
let movingTarget = false

function normalizeAngle(a: number): number { while(a>180)a-=360; while(a<-180)a+=360; return a }

function angleDiffDeg(current: number, target: number): number { return normalizeAngle(target - current) }

function getTargetBearing(pivot: TransformNode): number {
  const wp = pivot.getAbsolutePosition()
  const dx = targetPos.x - wp.x; const dz = targetPos.z - wp.z
  return Math.atan2(dx, -dz) * (180/Math.PI) // 0=North (0°), CW
}

function updateTurret(t: typeof turret0, dt: number): void {
  const targetBearing = getTargetBearing(t.pivot)
  t.targetAngle = targetBearing
  let diff = angleDiffDeg(t.angle, targetBearing)
  const maxStep = turnRateDeg * dt
  if (Math.abs(diff) <= maxStep) { t.angle = targetBearing }
  else { t.angle += Math.sign(diff) * maxStep }
  t.angle = normalizeAngle(t.angle)
  t.pivot.rotation.y = t.angle * (Math.PI/180) // deg→rad, Y-axis rotation
}
function isFacing(t: typeof turret0): boolean { return Math.abs(angleDiffDeg(t.angle, t.targetAngle)) <= 1.0 }

// Render loop at 20 TPS
const TICK_MS = 50; let lt = performance.now(); let lf = 0; let cfps = '0'
engine.runRenderLoop(() => {
  const n = performance.now()
  while (n - lt >= TICK_MS) { lt += TICK_MS; ticksElapsed++
    updateTurret(turret0, 1); updateTurret(turret1, 1)
    if (movingTarget) { const phase = ticksElapsed * 0.05; targetPos.x = 3 + 4*(Math.sin(phase)*0.5+0.5); targetMesh.position = targetPos }
  }
  scene.render()
  if (n - lf > 500) { cfps = engine.getFps().toFixed(1); lf = n }
  updDiag()
})

function updDiag(): void {
  const s = (id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  const fmt = (t:typeof turret0,i:number)=>{s('dA'+i,t.angle.toFixed(1)+'°');s('dT'+i,t.targetAngle.toFixed(1)+'°');s('dF'+i,isFacing(t)?'YES':'no')}
  fmt(turret0,0); fmt(turret1,1)
  s('dRate',turnRateDeg+'°/t'); s('dTicks',String(ticksElapsed))
  s('info-fps',cfps); s('info-ua',navigator.userAgent.slice(0,60))
  s('info-viewport',window.innerWidth+'x'+window.innerHeight); s('info-engine','WebGL 2.0')
}

// UI
function setTargetDeg(deg: number) {
  const rad = deg*(Math.PI/180); const dist = 3
  targetPos = new Vector3(3 + Math.sin(rad)*dist, 0.3, 3 - Math.cos(rad)*dist)
  targetMesh.position = targetPos
}
document.getElementById('btnTarget')!.addEventListener('click',()=>setTargetDeg(0))
document.getElementById('btnTarget90')!.addEventListener('click',()=>setTargetDeg(90))
document.getElementById('btnTarget180')!.addEventListener('click',()=>setTargetDeg(180))
document.getElementById('btnTarget270')!.addEventListener('click',()=>setTargetDeg(270))
document.getElementById('sldRate')!.addEventListener('input',function(this:HTMLInputElement){turnRateDeg=parseInt(this.value);document.getElementById('valRate')!.textContent=this.value})
document.getElementById('chkMoving')!.addEventListener('change',function(this:HTMLInputElement){movingTarget=this.checked;document.getElementById('lblMoving')!.textContent=this.checked?'ON':'OFF'})
document.getElementById('btnReset')!.addEventListener('click',()=>{turret0.angle=0;turret0.pivot.rotation.y=0;turret1.angle=0;turret1.pivot.rotation.y=0;ticksElapsed=0;setTargetDeg(0)})

// Harness
;(window as any).__testHarness = {
  setTarget(_actor:unknown, pos:{x:number;y:number;z:number}){targetPos=new Vector3(pos.x,pos.y,pos.z);targetMesh.position=targetPos},
  getTurretAngle(idx:number):number{return idx===0?turret0.angle:turret1.angle},
  getTurretTurnRate():number{return turnRateDeg},
  isTurretFacingTarget(idx:number):boolean{return isFacing(idx===0?turret0:turret1)},
  getTargetBearing(idx:number):number{return getTargetBearing(idx===0?turret0.pivot:turret1.pivot)},
  setTurnRate(deg:number){turnRateDeg=deg},
  setMovingTarget(on:boolean){movingTarget=on},
  reset(){turret0.angle=0;turret0.pivot.rotation.y=0;turret1.angle=0;turret1.pivot.rotation.y=0;ticksElapsed=0;setTargetDeg(0)},
}
window.addEventListener('resize',()=>engine.resize())
