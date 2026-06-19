/**
 * attack-animation/main.ts — Attack animation visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Render/WithAttackAnimation.cs
 *            OpenRA.Mods.Common/Traits/Render/WithAttackOverlay.cs
 *
 * Verifies:
 *   A1. Attack animation starts within 1 tick of fire command
 *   A2. Sequence completes full cycle before returning to idle
 *   A3. Overlay sprite matches configured sequence name
 *   A4. Frame rate matches configured value (default 25fps)
 *   A5. Multiple bursts each trigger fresh animation cycle
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
const camera = new ArcRotateCamera('cam', -Math.PI / 2.5, Math.PI / 3.5, 8, new Vector3(3, 1.5, 3), scene)
camera.lowerRadiusLimit = 3; camera.upperRadiusLimit = 25; camera.attachControl(canvas, true)
new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene).intensity = 0.85

// Ground
const gnd = MeshBuilder.CreateGround('gnd', { width: 12, height: 12 }, scene)
gnd.position.y = -0.02
const gm = new StandardMaterial('gm', scene)
gm.diffuseColor = new Color3(0.08, 0.11, 0.16); gm.specularColor = new Color3(0, 0, 0); gm.alpha = 0.75
gnd.material = gm

// Actor body (box that changes color to simulate "animation frames")
const actorBody = MeshBuilder.CreateBox('actor', { width: 0.8, height: 0.6, depth: 0.5 }, scene)
actorBody.position = new Vector3(3, 0.5, 3)
const bodyMat = new StandardMaterial('bodyMat', scene)
bodyMat.diffuseColor = new Color3(0.2, 0.5, 0.7) // idle color (blue-gray)
bodyMat.specularColor = new Color3(0, 0, 0)
actorBody.material = bodyMat

// Overlay plane (billboard attached to actor, shows during attack)
const overlayMesh = MeshBuilder.CreatePlane('overlay', { width: 0.6, height: 0.6 }, scene)
overlayMesh.position = new Vector3(3, 0.9, 3)
overlayMesh.setEnabled(false)
const overlayMat = new StandardMaterial('overlayMat', scene)
overlayMat.diffuseColor = new Color3(1, 0.3, 0.1) // attack overlay color (red-orange)
overlayMat.emissiveColor = new Color3(0.5, 0.1, 0.02)
overlayMat.specularColor = new Color3(0, 0, 0)
overlayMat.disableLighting = true
overlayMesh.material = overlayMat

// Animation state
type AnimState = 'idle' | 'attacking' | 'cooldown'
let animState: AnimState = 'idle'
let animFrame = 0
let animTotalFrames = 8  // configurable
let animFps = 25          // configurable (ms per frame = 1000/fps)
let cooldownFrames = 5    // cooldown after attack before returning to idle
let burstCount = 0
let fireCount = 0

// Pre-allocated Color3 for mutations
const _tmpColor = new Color3()

function triggerAttack(): void {
  fireCount++
  if (animState === 'attacking') {
    // Re-trigger during attack: reset frame counter
    burstCount++
  } else {
    burstCount = 1
  }
  animState = 'attacking'
  animFrame = 0
}

function updateAnimation(): void {
  if (animState === 'attacking') {
    animFrame++
    // Simulate frame-based color change (cycles through "frames")
    const t = animFrame / animTotalFrames
    // idle→attack transition: blue→orange→red→blue
    if (t < 0.33) {
      _tmpColor.set(1, 0.3 + 0.4 * t * 3, 0.1)
    } else if (t < 0.66) {
      _tmpColor.set(1, 0.7 - 0.4 * (t - 0.33) * 3, 0.1 + 0.4 * (t - 0.33) * 3)
    } else {
      _tmpColor.set(1 - 0.8 * (t - 0.66) * 3, 0.3, 0.5 + 0.2 * (t - 0.66) * 3)
    }
    bodyMat.diffuseColor = _tmpColor
    overlayMesh.setEnabled(true)

    if (animFrame >= animTotalFrames) {
      animState = 'cooldown'
      animFrame = 0
      overlayMesh.setEnabled(false)
      _tmpColor.set(0.2, 0.5, 0.7); bodyMat.diffuseColor = _tmpColor // back to idle
    }
  } else if (animState === 'cooldown') {
    animFrame++
    if (animFrame >= cooldownFrames) {
      animState = 'idle'
      animFrame = 0
    }
  }
}

function resetAnim(): void {
  animState = 'idle'; animFrame = 0; burstCount = 0; fireCount = 0
  overlayMesh.setEnabled(false)
  _tmpColor.set(0.2, 0.5, 0.7); bodyMat.diffuseColor = _tmpColor
}

// Render loop at configured fps (ANIM_TICK_MS declared in UI section)
let lastAnimTick = performance.now()
let lastFps = 0; let cachedFps = '0'

engine.runRenderLoop(() => {
  const n = performance.now()
  while (n - lastAnimTick >= ANIM_TICK_MS) {
    lastAnimTick += ANIM_TICK_MS
    updateAnimation()
  }
  scene.render()
  if (n - lastFps > 500) { cachedFps = engine.getFps().toFixed(1); lastFps = n }
  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v }
  set('diagState', animState); set('diagFrame', animState !== 'idle' ? String(animFrame) : '-')
  set('diagBursts', String(burstCount)); set('diagFires', String(fireCount))
  set('diagColor', `${bodyMat.diffuseColor.r.toFixed(2)},${bodyMat.diffuseColor.g.toFixed(2)},${bodyMat.diffuseColor.b.toFixed(2)}`)
  set('diagOverlay', overlayMesh.isEnabled() ? 'YES' : 'no')
  set('info-fps', cachedFps); set('info-ua', navigator.userAgent.slice(0, 60))
  set('info-viewport', window.innerWidth + 'x' + window.innerHeight)
  set('info-engine', 'WebGL 2.0'); set('info-time', new Date().toLocaleTimeString())
})

// UI
document.getElementById('btnAttack')!.addEventListener('click', triggerAttack)
document.getElementById('sldFrames')!.addEventListener('input', function(this: HTMLInputElement) {
  animTotalFrames = parseInt(this.value); document.getElementById('valFrames')!.textContent = animTotalFrames + 'f'
})
const animTickMs = () => Math.round(1000 / animFps)
let ANIM_TICK_MS = animTickMs() // mutable for FPS slider changes
document.getElementById('sldFps')!.addEventListener('input', function(this: HTMLInputElement) {
  animFps = parseInt(this.value); document.getElementById('valFps')!.textContent = animFps + 'fps'
  ANIM_TICK_MS = animTickMs(); lastAnimTick = performance.now()
})
document.getElementById('btnReset')!.addEventListener('click', resetAnim)

// Test harness
;(window as any).__testHarness = {
  triggerAttack(): void { triggerAttack() },
  getCurrentSequence(): string { return animState },
  getOverlaySequence(): string { return overlayMesh.isEnabled() ? 'attack_overlay_active' : 'none' },
  getSequenceProgress(): number { return animState === 'attacking' ? animFrame / animTotalFrames : 0 },
  getAnimationFrame(): number { return animFrame },
  getAnimState(): string { return animState },
  getBurstCount(): number { return burstCount },
  getFireCount(): number { return fireCount },
  getConfig(): { totalFrames: number; fps: number; cooldown: number } {
    return { totalFrames: animTotalFrames, fps: animFps, cooldown: cooldownFrames }
  },
  reset(): void { resetAnim() },
}

window.addEventListener('resize', () => engine.resize())
