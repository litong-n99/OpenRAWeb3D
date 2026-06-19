/**
 * muzzle-overlay/main.ts — Weapon muzzle flash visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Render/WithMuzzleOverlay.cs
 *
 * Verifies:
 *   M1. Flash at weapon hardpoint within 1 frame of fire
 *   M2. Flash visible for exactly configured duration
 *   M3. Dual-barrel alternates 0-1-0-1
 *   M4. Billboard faces camera (dot > 0.95)
 *   M5. Clean disposal with no residual
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, TransformNode,
} from '@babylonjs/core'

// Scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.07, 0.12, 1)
const camera = new ArcRotateCamera('cam', -Math.PI / 2.5, Math.PI / 3.5, 12, new Vector3(3, 1.5, 3), scene)
camera.lowerRadiusLimit = 3; camera.upperRadiusLimit = 30; camera.attachControl(canvas, true)
new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene).intensity = 0.85

// Ground + Grid
const gnd = MeshBuilder.CreateGround('gnd', { width: 16, height: 16 }, scene)
gnd.position.y = -0.02
const gm = new StandardMaterial('gm', scene)
gm.diffuseColor = new Color3(0.08, 0.11, 0.16); gm.specularColor = new Color3(0, 0, 0); gm.alpha = 0.75
gnd.material = gm
for (let i = -2; i <= 8; i++) {
  const l = MeshBuilder.CreateLines('gx', { points: [new Vector3(i, 0.005, -2), new Vector3(i, 0.005, 8)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = i % 3 === 0 ? 0.25 : 0.06
}
for (let j = -2; j <= 8; j++) {
  const l = MeshBuilder.CreateLines('gz', { points: [new Vector3(-2, 0.005, j), new Vector3(8, 0.005, j)] }, scene)
  l.color = new Color3(0.12, 0.2, 0.35); l.alpha = j % 3 === 0 ? 0.25 : 0.06
}

// Actor: box body + turret barrel
const actorRoot = new TransformNode('actor', scene)
actorRoot.position = new Vector3(3, 0.35, 3)
const body = MeshBuilder.CreateBox('body', { width: 1, height: 0.5, depth: 0.7 }, scene)
body.parent = actorRoot; body.position.y = 0.25
const bm = new StandardMaterial('bm', scene); bm.diffuseColor = new Color3(0.15, 0.55, 0.2)
bm.specularColor = new Color3(0, 0, 0); body.material = bm

const ring = MeshBuilder.CreateTorus('ring', { diameter: 0.5, thickness: 0.08, tessellation: 16 }, scene)
ring.parent = actorRoot; ring.position.y = 0.52
const rm = new StandardMaterial('rm', scene); rm.diffuseColor = new Color3(0.25, 0.25, 0.3)
rm.specularColor = new Color3(0, 0, 0); ring.material = rm

const barrelPivot = new TransformNode('bp', scene)
barrelPivot.parent = actorRoot; barrelPivot.position.y = 0.52
const barrel = MeshBuilder.CreateCylinder('b', { height: 0.7, diameter: 0.1, tessellation: 12 }, scene)
barrel.parent = barrelPivot; barrel.position = new Vector3(0, 0.15, 0.35); barrel.rotation.x = Math.PI / 2
const barm = new StandardMaterial('barm', scene); barm.diffuseColor = new Color3(0.3, 0.3, 0.35)
barm.specularColor = new Color3(0.05, 0.05, 0.05); barrel.material = barm

// Muzzle flash system
interface MuzzleSlot { mesh: Mesh | null; mat: StandardMaterial | null; remainingTicks: number }
const SLOT_OFFSETS = [new Vector3(-0.15, 0.38, 0.7), new Vector3(0.15, 0.38, 0.7)]
const slots: MuzzleSlot[] = [
  { mesh: null, mat: null, remainingTicks: 0 },
  { mesh: null, mat: null, remainingTicks: 0 },
]
let barrelMode: 'dual' | 'single' = 'dual'
let nextSlot = 0; let fireCount = 0; let configDur = 6; let configSize = 0.4

function createFlashMat(): StandardMaterial {
  const mat = new StandardMaterial('fm' + fireCount, scene)
  mat.diffuseColor = new Color3(1, 0.78, 0.24)
  mat.emissiveColor = new Color3(1, 0.5, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  return mat
}

function getSlotPos(idx: number): Vector3 {
  return Vector3.TransformCoordinates(SLOT_OFFSETS[idx % 2]!, barrelPivot.getWorldMatrix())
}

function fireWeapon(slot?: number): void {
  const idx = slot !== undefined ? slot : (barrelMode === 'single' ? 0 : nextSlot)
  if (slot === undefined && barrelMode === 'dual') nextSlot = (nextSlot + 1) % 2
  fireCount++
  const s = slots[idx]!; if (s.mesh) { s.mesh.dispose(); s.mesh = null }; if (s.mat) { s.mat.dispose(); s.mat = null }
  const pos = getSlotPos(idx)
  const f = MeshBuilder.CreatePlane('f' + idx, { width: configSize, height: configSize }, scene)
  f.position = pos; f.billboardMode = Mesh.BILLBOARDMODE_ALL
  const mat = createFlashMat(); f.material = mat; f.renderingGroupId = 1
  s.mesh = f; s.mat = mat; s.remainingTicks = configDur
}

function tickFlashes(): void {
  for (const s of slots) {
    if (s.remainingTicks > 0) {
      s.remainingTicks--
      if (s.remainingTicks <= 0) {
        if (s.mesh) { s.mesh.dispose(); s.mesh = null }; if (s.mat) { s.mat.dispose(); s.mat = null }
      } else if (s.mesh && s.mat) {
        s.mat.alpha = s.remainingTicks / configDur
      }
    }
  }
}

function resetAll(): void {
  for (const s of slots) { if (s.mesh) { s.mesh.dispose(); s.mesh = null }; if (s.mat) { s.mat.dispose(); s.mat = null }; s.remainingTicks = 0 }
  fireCount = 0; nextSlot = 0
}

// Render loop at 20 TPS
const TICK_MS = 50; let lastTick = performance.now()
engine.runRenderLoop(() => {
  const n = performance.now()
  while (n - lastTick >= TICK_MS) { lastTick += TICK_MS; tickFlashes() }
  scene.render(); updateDiag()
})

// Diagnostics
let lastFps = 0; let cachedFps = '0'
function updateDiag(): void {
  const n = performance.now()
  if (n - lastFps > 500) { cachedFps = engine.getFps().toFixed(1); lastFps = n }
  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('diagMode', barrelMode); set('diagNext', String(nextSlot)); set('diagFires', String(fireCount))
  set('diagS0vis', slots[0]!.remainingTicks > 0 ? 'YES' : 'no')
  set('diagS0rem', slots[0]!.remainingTicks > 0 ? String(slots[0]!.remainingTicks) : '-')
  set('diagS1vis', slots[1]!.remainingTicks > 0 ? 'YES' : 'no')
  set('diagS1rem', slots[1]!.remainingTicks > 0 ? String(slots[1]!.remainingTicks) : '-')
  let dot = '-'
  for (const s of slots) {
    if (s.mesh) {
      const cf = camera.getForwardRay().direction.normalize()
      dot = Math.abs(Vector3.Dot(s.mesh.forward.normalize(), cf)).toFixed(3); break
    }
  }
  set('diagDot', dot)
  set('info-fps', cachedFps); set('info-ua', navigator.userAgent.slice(0, 60))
  set('info-viewport', window.innerWidth + 'x' + window.innerHeight)
  set('info-engine', 'WebGL 2.0'); set('info-time', new Date().toLocaleTimeString())
}

// UI bindings
document.getElementById('btnFire')!.addEventListener('click', () => fireWeapon())
document.getElementById('btnFireS0')!.addEventListener('click', () => fireWeapon(0))
document.getElementById('btnFireS1')!.addEventListener('click', () => fireWeapon(1))
document.getElementById('selMode')!.addEventListener('change', function(this: HTMLSelectElement) {
  barrelMode = this.value as 'dual' | 'single'; nextSlot = 0
})
document.getElementById('sldDur')!.addEventListener('input', function(this: HTMLInputElement) {
  configDur = parseInt(this.value); document.getElementById('valDur')!.textContent = configDur + 't'
})
document.getElementById('sldSize')!.addEventListener('input', function(this: HTMLInputElement) {
  configSize = parseInt(this.value) / 100; document.getElementById('valSize')!.textContent = configSize.toFixed(2)
})
document.getElementById('btnReset')!.addEventListener('click', resetAll)

// Test harness (intentional global for Playwright access)
;(window as any).__testHarness = {
  fireWeapon(slot?: number): void { fireWeapon(slot) },
  getMuzzlePosition(idx: number): { x: number; y: number; z: number } | null {
    const s = slots[idx]; if (!s || !s.mesh) return null
    const p = s.mesh.position; return { x: p.x, y: p.y, z: p.z }
  },
  isMuzzleVisible(idx: number): boolean { return slots[idx]!.remainingTicks > 0 },
  getMuzzleDuration(): number { return configDur },
  getRemainingTicks(idx: number): number { return slots[idx]!.remainingTicks },
  getBarrelMode(): string { return barrelMode },
  getActiveSlotCount(): number { return slots.filter(s => s.remainingTicks > 0).length },
  getFireCount(): number { return fireCount },
  reset(): void { resetAll() },
}

updateDiag()
window.addEventListener('resize', () => engine.resize())
