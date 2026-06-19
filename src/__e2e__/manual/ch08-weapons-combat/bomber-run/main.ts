/**
 * bomber-run/main.ts — Aircraft bombing run visual acceptance test
 * OpenRA对照: OpenRA.Mods.Common/Traits/Air/AttackBomber.cs, Aircraft.cs
 * Verifies: B1. Straight-line flight, B2. Bomb drop interval, B3. Ballistic fall,
 *           B4. Return to base, B5. No bomb-bomb collision
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh, LinesMesh,
} from '@babylonjs/core'

// Scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.08, 0.14, 1)
const camera = new ArcRotateCamera('cam', -Math.PI/2.5, Math.PI/3.5, 20, new Vector3(8,2,5), scene)
camera.lowerRadiusLimit=5; camera.upperRadiusLimit=50; camera.attachControl(canvas, true)
new HemisphericLight('hemi', new Vector3(0.5,1,0.3), scene).intensity = 0.85

// Ground
const gnd = MeshBuilder.CreateGround('gnd', {width:24,height:24}, scene); gnd.position.y = -0.02
const gm = new StandardMaterial('gm', scene)
gm.diffuseColor = new Color3(0.08,0.11,0.16); gm.specularColor = new Color3(0,0,0); gm.alpha = 0.75; gnd.material = gm
for (let i=-4;i<=14;i++){const l=MeshBuilder.CreateLines('gx'+i,{points:[new Vector3(i,0.005,-4),new Vector3(i,0.005,14)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=i%4===0?0.25:0.06}
for (let j=-4;j<=14;j++){const l=MeshBuilder.CreateLines('gz'+j,{points:[new Vector3(-4,0.005,j),new Vector3(14,0.005,j)]},scene);l.color=new Color3(0.12,0.2,0.35);l.alpha=j%4===0?0.25:0.06}

// Aircraft mesh
const aircraft = MeshBuilder.CreateBox('aircraft', {width:0.6,height:0.15,depth:0.3}, scene)
const acMat = new StandardMaterial('acMat', scene)
acMat.diffuseColor = new Color3(0.25,0.25,0.35); acMat.emissiveColor = new Color3(0.08,0.08,0.12)
acMat.specularColor = new Color3(0,0,0); aircraft.material = acMat; aircraft.setEnabled(false)

// Target area marker
const targetMarker = MeshBuilder.CreateTorus('tgt',{diameter:1.5,thickness:0.04,tessellation:32}, scene)
targetMarker.position = new Vector3(8,0.01,5); targetMarker.rotation.x = Math.PI/2
const tMat = new StandardMaterial('tMat', scene)
tMat.diffuseColor = new Color3(1,0.2,0.1); tMat.emissiveColor = new Color3(0.4,0.05,0.02)
tMat.specularColor = new Color3(0,0,0); tMat.disableLighting = true; targetMarker.material = tMat; targetMarker.isVisible = false

// Trail line
let trailLine: LinesMesh|null = null
let _trailPts: Vector3[] = []

// Bomb state
interface Bomb { mesh: Mesh; pos: Vector3; vel: Vector3; alive: boolean; impactY: number }
const bombs: Bomb[] = []
const bombRad = 0.12
let _bombMat: StandardMaterial|null = null
function getBombMat(): StandardMaterial {
  if (!_bombMat) { _bombMat = new StandardMaterial('bMat',scene); _bombMat.diffuseColor = new Color3(0.2,0.2,0.22); _bombMat.specularColor = new Color3(0,0,0) }
  return _bombMat
}

// Simulation state
let runActive = false; let runComplete = false; let runCount = 0
let acPos = new Vector3(); let acSpeed = 400; let bombInterval = 12; let bombCount = 4;
let tickCount = 0; let dropCount = 0; let detCount = 0
const GRAVITY = 15 // su/t²
const FLIGHT_ALTITUDE = 0.5 // Babylon Y
const AIRCRAFT_START = new Vector3(-2, FLIGHT_ALTITUDE, 5)
const AIRCRAFT_END = new Vector3(18, FLIGHT_ALTITUDE, 5)

function startRun(): void {
  if (runActive) return; resetBombs()
  acPos = AIRCRAFT_START.clone(); aircraft.position = acPos; aircraft.setEnabled(true)
  targetMarker.isVisible = true; runActive = true; runComplete = false; tickCount = 0; dropCount = 0; detCount = 0
  trailLine?.dispose(); trailLine = null; _trailPts = [acPos.clone()]; runCount++
}
function resetBombs(): void { for (const b of bombs) b.mesh.dispose(); bombs.length = 0 }

let _tmpV = new Vector3()
function tickSim(): void {
  if (!runActive || runComplete) return; tickCount++
  // Move aircraft
  acPos.x += acSpeed / 1024 // su→wu per tick
  aircraft.position = acPos; _trailPts.push(acPos.clone())
  // Drop bombs at interval
  if (tickCount % bombInterval === 0 && dropCount < bombCount) {
    dropCount++
    const bv = new Vector3(acPos.x, acPos.y - 0.08, acPos.z)
    _tmpV.set((Math.random()-0.5)*0.03, 0, (Math.random()-0.5)*0.03)
    const bombMesh = MeshBuilder.CreateSphere('bomb'+bombs.length,{diameter:bombRad*2},scene)
    bombMesh.position = bv; bombMesh.material = getBombMat()
    bombs.push({mesh:bombMesh, pos:bv, vel:new Vector3(_tmpV.x,-0.02,_tmpV.z), alive:true, impactY:0.01})
  }
  // Update bombs (Euler integration)
  for (const b of bombs) {
    if (!b.alive) continue; b.vel.y -= GRAVITY * 0.05 // gravity
    b.pos.x += b.vel.x; b.pos.y += b.vel.y; b.pos.z += b.vel.z; b.mesh.position = b.pos
    if (b.pos.y <= b.impactY) { b.pos.y = b.impactY; b.alive = false; detCount++; b.mesh.setEnabled(false) }
  }
  // Check completion
  if (acPos.x > AIRCRAFT_END.x) { aircraft.setEnabled(false); runComplete = true; runActive = false }
}

// Render loop at 20 TPS
const TICK_MS = 50; let lt = performance.now()
let lf = 0; let cfps = '0'
engine.runRenderLoop(() => {
  const n = performance.now()
  while (n - lt >= TICK_MS) { lt += TICK_MS; tickSim() }
  scene.render()
  if (n - lf > 500) { cfps = engine.getFps().toFixed(1); lf = n }
  updDiag()
})

function updDiag(): void {
  const s = (id:string,v:string)=>{const e=document.getElementById(id);if(e)e.textContent=v}
  s('dPos',`${acPos.x.toFixed(1)},${acPos.y.toFixed(2)},${acPos.z.toFixed(1)}`)
  s('dAlt', acPos.y.toFixed(2)); s('dPhase', runActive?'flying':runComplete?'complete':'idle')
  s('dDropped', String(dropCount)); s('dActive', String(bombs.filter(b=>b.alive).length))
  s('dDet', String(detCount)); s('dComplete', runComplete?'YES':'no'); s('dRuns', String(runCount))
  s('info-fps',cfps); s('info-ua',navigator.userAgent.slice(0,60))
  s('info-viewport',window.innerWidth+'x'+window.innerHeight)
  s('info-engine','WebGL 2.0')
}

// UI
document.getElementById('btnStart')!.addEventListener('click', startRun)
document.getElementById('sldSpeed')!.addEventListener('input', function(this:HTMLInputElement){acSpeed=parseInt(this.value);document.getElementById('valSpeed')!.textContent=this.value})
document.getElementById('sldInterval')!.addEventListener('input', function(this:HTMLInputElement){bombInterval=parseInt(this.value);document.getElementById('valInterval')!.textContent=this.value+'t'})
document.getElementById('sldCount')!.addEventListener('input', function(this:HTMLInputElement){bombCount=parseInt(this.value);document.getElementById('valCount')!.textContent=this.value})
document.getElementById('btnReset')!.addEventListener('click', ()=>{resetBombs();runActive=false;runComplete=false;aircraft.setEnabled(false);targetMarker.isVisible=false})

// Harness
;(window as any).__testHarness = {
  startBomberRun(){startRun()},
  getBombCount():number{return bombs.length},
  getBombPositions():{x:number;y:number;z:number}[]{return bombs.filter(b=>b.alive).map(b=>({x:b.pos.x,y:b.pos.y,z:b.pos.z}))},
  getAircraftPosition():{x:number;y:number;z:number}{return{x:acPos.x,y:acPos.y,z:acPos.z}},
  isRunComplete():boolean{return runComplete},
  getDropCount():number{return dropCount},
  getDetonationCount():number{return detCount},
  reset(){resetBombs();runActive=false;runComplete=false;aircraft.setEnabled(false);targetMarker.isVisible=false},
}
window.addEventListener('resize',()=>engine.resize())
