/**
 * gravity-bomb-3d/main.ts -- GravityBomb projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/GravityBomb.cs
 * GLSL对照: 无直接Shader映射（GravityBomb使用StandardMaterial + LinesMesh trail）
 *           弹道轨迹线通过 LinesMesh.color + alpha 渲染
 *           引爆闪光通过 StandardMaterial.alpha 插值实现
 *
 * Verifies:
 *   G1. Horizontal velocity (XY plane) remains constant per tick (no drag)
 *   G2. Vertical position follows Euler integration: Z(t+1) = Z(t) + Vz(t), Vz(t+1) = Vz(t) + Az
 *   G3. Bomb detonates when pos.Z <= target terrain height
 *   G4. Impact position on XY plane matches predicted landing point within 2 world units
 *   G5. Weapon.impact() called exactly once at detonation tick
 *
 * 坐标系约定: WAngle 0=North (WPos -Y), CCW. Babylon: x=WX/1024, y=WZ/512, z=WY/1024
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  LinesMesh,
  VertexBuffer,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub, MersenneTwisterStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'
import {
  GravityBomb,
  GravityBombFactory,
  type GravityBombInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/GravityBomb.js'
import type {
  ProjectileArgs,
  WeaponStub,
} from '../../../../OpenRA.Mods.Common/Projectiles/Bullet.js'

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function createStubActor(pos?: WPos): IGameActor {
  const centerPos = pos ?? WPos.Zero
  const owner: PlayerStub = { playerName: 'TestPlayer' }
  const raw = {
    actorId: Math.floor(Math.random() * 10000),
    isInWorld: true, isDead: false, generation: 0, disposed: false,
    owner,
    world: null as unknown as GameWorldManager,
    centerPosition: centerPos,
    isTargetableBy(_targeter: unknown): boolean { return true },
    tick(_world: GameWorldManager): void {},
    dispose(): void {},
    get traits(): never { throw new Error('not implemented') },
    trait<T>(): T { throw new Error('not implemented') },
    traitsImplementing<T>(): T[] { return [] },
    getTargetablePositions(): readonly WPos[] { return [centerPos] },
  }
  return raw as unknown as IGameActor
}

function createStubRandom(seed: number = 42): { next(): number; get last(): number } {
  let s = seed
  return {
    next(): number { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s },
    get last(): number { return s },
  }
}

function createStubWorld(): {
  world: GameWorldManager
  events: string[]
  flushFrameEnd: () => void
} {
  const events: string[] = []
  const frameEndActions: (() => void)[] = []
  let effects: unknown[] = []

  const world: GameWorldManager = {
    addFrameEndTask(action: () => void): void {
      frameEndActions.push(action)
    },
    removeEffect(effect: unknown): void {
      effects = effects.filter(e => e !== effect)
      events.push(`removeEffect: ${(effect as GravityBomb).constructor.name}`)
    },
    get effects(): unknown[] { return effects },
    sharedRandom: createStubRandom(),
    get localRandom() { return createStubRandom() },
    actors: new Map(),
    players: new Map(),
    tickCount: 0,
    gameComplete: false,
    gamePaused: false,
    fogOfWar: { isVisible(_x: number, _y: number): boolean { return true } },
    traitsImplementing<T>(_ctor: unknown): T[] { return [] },
    addActor(_actor: unknown): void {},
    removeActor(_actor: unknown): void {},
    getActorById(_id: number): IGameActor | undefined { return undefined },
    getActors(): IGameActor[] { return [] },
    getPlayerById(_id: number): unknown { return undefined },
  } as unknown as GameWorldManager

  return {
    world,
    events,
    flushFrameEnd() {
      const actions = frameEndActions.splice(0)
      for (const action of actions) action()
    },
  }
}

function createStubWeapon(
  onImpact: (target: Target) => void = () => {},
): WeaponStub {
  return {
    weaponKey: 'testWeapon',
    warheads: [],
    impactCount: 0,
    impact(target: Target, _args: unknown): void {
      (this as { impactCount: number }).impactCount++
      onImpact(target)
    },
  } as unknown as WeaponStub
}

// ---------------------------------------------------------------------------
// Shared scene resources (lazy-init, never disposed individually)
// ---------------------------------------------------------------------------

let sharedSrcMarkerMat: StandardMaterial | null = null
function getSrcMarkerMat(scene: Scene): StandardMaterial {
  if (!sharedSrcMarkerMat) {
    sharedSrcMarkerMat = new StandardMaterial('srcMarkerMat', scene)
    sharedSrcMarkerMat.diffuseColor = new Color3(0.3, 0.8, 1)
    sharedSrcMarkerMat.emissiveColor = new Color3(0.15, 0.4, 0.5)
    sharedSrcMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSrcMarkerMat
}

let sharedTgtMarkerMat: StandardMaterial | null = null
function getTgtMarkerMat(scene: Scene): StandardMaterial {
  if (!sharedTgtMarkerMat) {
    sharedTgtMarkerMat = new StandardMaterial('tgtMarkerMat', scene)
    sharedTgtMarkerMat.diffuseColor = new Color3(1, 0.2, 0.2)
    sharedTgtMarkerMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
    sharedTgtMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedTgtMarkerMat
}

let sharedGroundMat: StandardMaterial | null = null
function getGroundMat(scene: Scene): StandardMaterial {
  if (!sharedGroundMat) {
    sharedGroundMat = new StandardMaterial('groundMat', scene)
    sharedGroundMat.diffuseColor = new Color3(0.25, 0.35, 0.2)
    sharedGroundMat.specularColor = new Color3(0, 0, 0)
    sharedGroundMat.alpha = 0.7
  }
  return sharedGroundMat
}

// ---------------------------------------------------------------------------
// Pre-allocated objects for per-frame mutation (no GC pressure)
// ---------------------------------------------------------------------------

const _bombPosV3 = new Vector3()

// ---------------------------------------------------------------------------
// Main test application
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.06, 0.08, 0.14, 1)

  // --- Camera ---
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 25, Vector3.Zero(), scene)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 80
  camera.attachControl(canvas, true)

  // --- Light ---
  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.8

  // --- Ground plane ---
  const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene)
  ground.material = getGroundMat(scene)
  ground.position.y = -0.02

  // --- Grid lines on ground (10x10 grid, world-unit spacing) ---
  const gridLines: Vector3[][] = []
  for (let i = -10; i <= 10; i++) {
    gridLines.push([new Vector3(i, 0, -10), new Vector3(i, 0, 10)])
    gridLines.push([new Vector3(-10, 0, i), new Vector3(10, 0, i)])
  }
  MeshBuilder.CreateLineSystem('grid', { lines: gridLines, colors: gridLines.map(() => [
    new Color4(0.3, 0.3, 0.3, 0.25), new Color4(0.3, 0.3, 0.3, 0.25),
  ]) }, scene)

  // --- Source marker (drop point, high altitude) ---
  const srcMarker = MeshBuilder.CreateSphere('srcMarker', { diameter: 0.25, segments: 8 }, scene)
  srcMarker.material = getSrcMarkerMat(scene)

  // --- Target marker (ground level) ---
  const tgtMarker = MeshBuilder.CreateTorus('tgtMarker', { diameter: 0.4, thickness: 0.06, tessellation: 16 }, scene)
  tgtMarker.material = getTgtMarkerMat(scene)
  tgtMarker.rotation.x = Math.PI / 2

  // --- Bomb mesh (sphere) ---
  const bombMesh = MeshBuilder.CreateSphere('bomb', { diameter: 0.3, segments: 12 }, scene)
  const bombMat = new StandardMaterial('bombMat', scene)
  bombMat.diffuseColor = new Color3(0.1, 0.1, 0.1)
  bombMat.emissiveColor = new Color3(0.6, 0.3, 0.05)
  bombMat.specularColor = new Color3(0.3, 0.2, 0.1)
  bombMesh.material = bombMat
  bombMesh.isVisible = false

  // --- Trail line (updatable LinesMesh, pre-allocated vertex buffer) ---
  let trailLine: LinesMesh | null = null
  const trailPositions: Vector3[] = []
  let _trailVertsBuf = new Float32Array(0)

  // --- Impact flash sphere (shown on detonation) ---
  const flashSphere = MeshBuilder.CreateSphere('flash', { diameter: 0.5, segments: 16 }, scene)
  const flashMat = new StandardMaterial('flashMat', scene)
  flashMat.diffuseColor = new Color3(1, 0.6, 0.1)
  flashMat.emissiveColor = new Color3(1, 0.4, 0.05)
  flashMat.specularColor = new Color3(0, 0, 0)
  flashMat.alpha = 0.7
  flashSphere.material = flashMat
  flashSphere.isVisible = false
let flashFadeTicksRemaining = 0

  // --- State ---
  let gravityBomb: GravityBomb | null = null
  let { world, events: worldEvents, flushFrameEnd } = createStubWorld()
  let bombStopped = false
  let tickCounter = 0
  let weaponImpactCount = 0
  let impactTarget: WPos | null = null

  // Config defaults
  const config = {
    velocity: new WVec(384, 0, 0),   // horizontal eastward velocity
    acceleration: new WVec(0, 0, -15), // downward gravity
    altitude: 2048,                    // drop height in su
    targetZ: 0,                        // target terrain height
    sourcePos: new WPos(0, 0, 2048),
    targetPos: new WPos(8192, 0, 0),   // target XY
    facing: WAngle.fromDegrees(270),    // east (270° CCW from North = +X)
  }

  function updateMarkers(): void {
    srcMarker.position = wPosToVector3(config.sourcePos.X, config.sourcePos.Y, config.sourcePos.Z)
    tgtMarker.position = wPosToVector3(config.targetPos.X, config.targetPos.Y, config.targetPos.Z)
    // Move camera to look at midpoint between source XY and target
    const midX = (config.sourcePos.X + config.targetPos.X) / 2 * WORLD_SCALE
    const midZ = (config.sourcePos.Y + config.targetPos.Y) / 2 * WORLD_SCALE
    camera.target.set(midX, 0, midZ)
  }

  function resetScene(): void {
    gravityBomb = null
    bombStopped = false
    tickCounter = 0
    weaponImpactCount = 0
    impactTarget = null
    bombMesh.isVisible = false
    flashSphere.isVisible = false
    flashFadeTicksRemaining = 0
    trailPositions.length = 0
    if (trailLine) {
      trailLine.dispose()
      trailLine = null
      _trailVertsBuf = new Float32Array(0)
    }
    worldEvents.length = 0
    const fresh = createStubWorld()
    world = fresh.world
    worldEvents = fresh.events
    flushFrameEnd = fresh.flushFrameEnd
    updateMarkers()
    updateDiagnostics()
    clearLog()
    addLog('info', 'Scene reset. Ready to drop bomb.')
  }

  function fireBomb(
    _from?: WPos,
    velOverride?: WVec,
    accOverride?: WVec,
  ): void {
    resetScene()
    const source = _from ?? config.sourcePos
    const velocity = velOverride ?? config.velocity
    const acceleration = accOverride ?? config.acceleration

    config.sourcePos = source
    config.velocity = velocity
    config.acceleration = acceleration
    config.altitude = source.Z
    config.targetPos = new WPos(config.targetPos.X, config.targetPos.Y, config.targetZ)

    const bombInfo: GravityBombInfo = {
      image: null,
      sequences: ['idle'],
      openSequence: null,
      palette: 'effect',
      isPlayerPalette: false,
      shadow: false,
      shadowColor: [140, 0, 0, 0],
      velocity,
      acceleration,
    }

    const weapon = createStubWeapon((target: Target) => {
      weaponImpactCount++
      impactTarget = target.centerPosition
    })

    const args: ProjectileArgs = {
      source,
      passiveTarget: config.targetPos,
      sourceActor: createStubActor(source),
      facing: config.facing,
      weapon: weapon as unknown as WeaponStub,
      inaccuracySource: WDist.Zero,
      random: createStubRandom() as unknown as MersenneTwisterStub,
      guidedTarget: Target.fromPos(config.targetPos),
      rangeModifiers: [],
    }

    gravityBomb = GravityBombFactory.create(args, bombInfo)
    bombMesh.isVisible = true
    const startV3 = wPosToVector3(source.X, source.Y, source.Z)
    bombMesh.position.copyFrom(startV3)
    trailPositions.push(new Vector3(startV3.x, startV3.y, startV3.z))

    addLog('info', `Bomb dropped: vel=(${velocity.X},${velocity.Y},${velocity.Z}) acc=(${acceleration.X},${acceleration.Y},${acceleration.Z})`)
    addLog('info', `Source: (${source.X}, ${source.Y}, ${source.Z}) Target: (${config.targetPos.X}, ${config.targetPos.Y}, ${config.targetZ})`)
  }

  // --- Diagnostics ---
  function updateDiagnostics(): void {
    const setVal = (id: string, text: string, highlight = false) => {
      const el = document.getElementById(id)
      if (el) {
        el.textContent = text
        el.className = highlight ? 'diag-value highlight' : 'diag-value'
      }
    }

    if (gravityBomb && !bombStopped) {
      const p = gravityBomb.pos
      const v = gravityBomb.velocity
      setVal('diag-tick', String(tickCounter), false)
      setVal('diag-pos', `(${p.X}, ${p.Y}, ${p.Z})`, false)
      setVal('diag-vel', `(${v.X}, ${v.Y}, ${v.Z})`, false)
      setVal('diag-altitude', `${p.Z} su (${(p.Z * HEIGHT_SCALE).toFixed(3)} wu)`, false)
      setVal('diag-ground', String(config.targetZ), false)
      setVal('diag-status', p.Z <= config.targetZ ? 'DETONATING' : 'FALLING', p.Z <= config.targetZ)
      setVal('diag-impact-count', String(weaponImpactCount), false)
      setVal('diag-hv', `${Math.hypot(v.X, v.Y).toFixed(1)} su/t`, false)
    } else if (bombStopped) {
      setVal('diag-tick', String(tickCounter), false)
      setVal('diag-status', 'DETONATED', true)
      setVal('diag-impact-count', String(weaponImpactCount), false)
      if (impactTarget) {
        setVal('diag-pos', `(${impactTarget.X}, ${impactTarget.Y}, ${impactTarget.Z})`, true)
      }
    } else {
      setVal('diag-tick', '-', false)
      setVal('diag-pos', '-', false)
      setVal('diag-vel', '-', false)
      setVal('diag-altitude', '-', false)
      setVal('diag-ground', String(config.targetZ), false)
      setVal('diag-status', 'IDLE', false)
      setVal('diag-impact-count', '0', false)
      setVal('diag-hv', '-', false)
    }
  }

  // --- Event log ---
  function addLog(cls: string, msg: string): void {
    const container = document.getElementById('event-log')
    if (!container) return
    const row = document.createElement('div')
    row.className = `log-row log-${cls}`
    row.textContent = `[t=${tickCounter}] ${msg}`
    container.appendChild(row)
    container.scrollTop = container.scrollHeight
  }

  function clearLog(): void {
    const container = document.getElementById('event-log')
    if (container) container.innerHTML = ''
  }

  // --- Update trail visual (no per-tick mesh allocation) ---
  function updateTrail(): void {
    if (!gravityBomb || bombStopped) return
    const p = gravityBomb.pos
    const v3 = wPosToVector3(p.X, p.Y, p.Z)
    trailPositions.push(v3)

    const n = trailPositions.length
    if (n >= 2) {
      if (!trailLine) {
        trailLine = MeshBuilder.CreateLines('trail', { points: trailPositions, updatable: true }, scene)
        trailLine.color = new Color3(0.9, 0.6, 0.15)
      } else {
        // In-place vertex update — pre-allocated buffer, no CreateLines call
        const nFloats = n * 3
        if (_trailVertsBuf.length < nFloats) _trailVertsBuf = new Float32Array(nFloats)
        for (let i = 0; i < n; i++) {
          const pt = trailPositions[i]!
          _trailVertsBuf[i * 3] = pt.x
          _trailVertsBuf[i * 3 + 1] = pt.y
          _trailVertsBuf[i * 3 + 2] = pt.z
        }
        trailLine.updateVerticesData(VertexBuffer.PositionKind, _trailVertsBuf, false, false)
      }
    }
  }

  // --- Render loop ---
  let tickAccumulator = 0
  const TICK_INTERVAL_MS = 40 // 25 ticks/sec

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime()

    if (gravityBomb && !bombStopped) {
      tickAccumulator += dt
      while (tickAccumulator >= TICK_INTERVAL_MS) {
        tickAccumulator -= TICK_INTERVAL_MS
        tickCounter++

        if (!gravityBomb.isDestroyed) {
          gravityBomb.tick(world)
          updateTrail()

          if (gravityBomb.isDestroyed) {
            bombStopped = true
            flushFrameEnd()
            addLog('impact', `DETONATED at tick ${tickCounter} — pos=(${gravityBomb.pos.X}, ${gravityBomb.pos.Y}, ${gravityBomb.pos.Z})`)
            addLog('impact', `Impact count: ${weaponImpactCount}`)
            // Show flash
            const ip = gravityBomb.pos
            flashSphere.position = wPosToVector3(ip.X, ip.Y, ip.Z)
            flashSphere.isVisible = true

            // Flash fade — MAJOR fix: tick-based counter instead of setInterval
            flashFadeTicksRemaining = 17  // ~500ms at 30fps (17 frames × 0.06 alpha step ≈ 1.0)
            flashMat.alpha = 1.0

            // Hide bomb
            bombMesh.isVisible = false
          }
        }

        updateDiagnostics()

        if (bombStopped) break
      }

      // Smooth bomb position between ticks
      if (!bombStopped && gravityBomb) {
        const p = gravityBomb.pos
        const v = gravityBomb.velocity
        const frac = tickAccumulator / TICK_INTERVAL_MS
        _bombPosV3.set(
          (p.X + v.X * frac) * WORLD_SCALE,
          (p.Z + v.Z * frac) * HEIGHT_SCALE,
          (p.Y + v.Y * frac) * WORLD_SCALE,
        )
        bombMesh.position.copyFrom(_bombPosV3)
      }
    }

    // Flash fade — MAJOR fix: tick-based counter (setInterval replaced)
    if (flashFadeTicksRemaining > 0) {
      flashFadeTicksRemaining--
      const fa = flashFadeTicksRemaining / 17
      flashMat.alpha = Math.max(0, fa)
      flashSphere.isVisible = flashFadeTicksRemaining > 0
    }

    scene.render()

    // Update environment info
    const fps = engine.getFps().toFixed(1)
    const fpsEl = document.getElementById('info-fps')
    if (fpsEl) fpsEl.textContent = fps
  })

  // --- Environment info (one-time) ---
  document.getElementById('info-ua')!.textContent = navigator.userAgent.substring(0, 60)
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = 'WebGL 2.0 (Babylon.js)'
  document.getElementById('info-time')!.textContent = new Date().toISOString().replace('T', ' ').substring(0, 19)

  // --- Event handlers ---
  document.getElementById('btn-fire')!.addEventListener('click', () => {
    fireBomb()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetScene()
  })

  // --- Config slider handlers ---
  function bindSlider(id: string, update: (v: number) => void, format: (v: number) => string): void {
    const slider = document.getElementById(id) as HTMLInputElement
    const updateVal = () => {
      const v = parseFloat(slider.value)
      update(v)
      const valEl = document.getElementById('val-' + id.replace('config-', ''))
      if (valEl) valEl.textContent = format(v)
    }
    slider.addEventListener('input', updateVal)
    updateVal()
  }

  bindSlider('config-velx', (v) => { config.velocity = new WVec(v, config.velocity.Y, config.velocity.Z) }, v => `${v} su/t`)
  bindSlider('config-vely', (v) => { config.velocity = new WVec(config.velocity.X, v, config.velocity.Z) }, v => `${v} su/t`)
  bindSlider('config-accz', (v) => { config.acceleration = new WVec(config.acceleration.X, config.acceleration.Y, v) }, v => `${v} su/t²`)
  bindSlider('config-alt', (v) => {
    config.altitude = v
    config.sourcePos = new WPos(config.sourcePos.X, config.sourcePos.Y, v)
    updateMarkers()
  }, v => `${v} su (${(v * HEIGHT_SCALE).toFixed(2)} wu)`)
  bindSlider('config-targetx', (v) => {
    config.targetPos = new WPos(v, config.targetPos.Y, config.targetZ)
    updateMarkers()
  }, v => `${v} su (${(v * WORLD_SCALE).toFixed(2)} wu)`)

  // --- Initial setup ---
  updateMarkers()
  addLog('info', 'Ready. Configure bomb parameters and press FIRE BOMB.')

  // Engine.dispose() recursively disposes all scene objects
  window.addEventListener('beforeunload', () => {
    engine.dispose()
  })

  // ---------------------------------------------------------------------------
  // __testHarness API (for Playwright automated verification)
  // ---------------------------------------------------------------------------
  // Expose a stable API on window for Playwright tests to call via page.evaluate().
  // This avoids coupling tests to internal Babylon.js state.

  ;(window as any).__testHarness = {
    /** Drop a bomb with the current config. Returns true if bomb created. */
    dropBomb(from?: { X: number; Y: number; Z: number }, velocity?: { X: number; Y: number; Z: number }, acceleration?: { X: number; Y: number; Z: number }): boolean {
      const wFrom = from ? new WPos(from.X, from.Y, from.Z) : undefined
      const wVel = velocity ? new WVec(velocity.X, velocity.Y, velocity.Z) : undefined
      const wAcc = acceleration ? new WVec(acceleration.X, acceleration.Y, acceleration.Z) : undefined
      fireBomb(wFrom, wVel, wAcc)
      return gravityBomb !== null
    },

    /** Get current bomb position in WPos coords, or null if no bomb. */
    getBombPosition(): { X: number; Y: number; Z: number } | null {
      if (!gravityBomb) return null
      const p = gravityBomb.pos
      return { X: p.X, Y: p.Y, Z: p.Z }
    },

    /** Get current bomb velocity in WVec coords, or null. */
    getBombVelocity(): { X: number; Y: number; Z: number } | null {
      if (!gravityBomb) return null
      const v = gravityBomb.velocity
      return { X: v.X, Y: v.Y, Z: v.Z }
    },

    /** Whether the bomb has detonated. */
    hasDetonated(): boolean { return bombStopped },

    /** Number of times weapon.impact() was called. */
    getImpactCount(): number { return weaponImpactCount },

    /** Impact position (WPos coords), or null if not yet detonated. */
    getImpactPosition(): { X: number; Y: number; Z: number } | null {
      if (!impactTarget) return null
      return { X: impactTarget.X, Y: impactTarget.Y, Z: impactTarget.Z }
    },

    /** Current tick counter. */
    getTickCount(): number { return tickCounter },

    /** Get acceleration config. */
    getAcceleration(): { X: number; Y: number; Z: number } {
      return { X: config.acceleration.X, Y: config.acceleration.Y, Z: config.acceleration.Z }
    },

    /** Reset the scene. */
    resetScene(): void { resetScene() },

    /** Step N ticks synchronously (fast-forward for test). */
    stepTicks(n: number): void {
      for (let i = 0; i < n; i++) {
        if (!gravityBomb || bombStopped) break
        tickCounter++
        if (!gravityBomb.isDestroyed) {
          gravityBomb.tick(world)
          updateTrail()
          if (gravityBomb.isDestroyed) {
            bombStopped = true
            flushFrameEnd()
            const ip = gravityBomb.pos
            flashSphere.position = wPosToVector3(ip.X, ip.Y, ip.Z)
            flashSphere.isVisible = true
            flashFadeTicksRemaining = 17  // start flash fade (R3 fix: stepTicks path)
            flashMat.alpha = 1.0
            bombMesh.isVisible = false
          }
        }
        if (bombStopped) break
      }
      updateDiagnostics()
    },

    /** Get current horizontal speed (XY magnitude). */
    getHorizontalSpeed(): number | null {
      if (!gravityBomb) return null
      const v = gravityBomb.velocity
      return Math.hypot(v.X, v.Y)
    },

    /** Get the world events log (array of strings). */
    getWorldEvents(): string[] { return [...worldEvents] },

    /** Get current config values. */
    getConfig(): {
      velocity: { X: number; Y: number; Z: number }
      acceleration: { X: number; Y: number; Z: number }
      altitude: number
      targetZ: number
      sourcePos: { X: number; Y: number; Z: number }
      targetPos: { X: number; Y: number; Z: number }
    } {
      return {
        velocity: { X: config.velocity.X, Y: config.velocity.Y, Z: config.velocity.Z },
        acceleration: { X: config.acceleration.X, Y: config.acceleration.Y, Z: config.acceleration.Z },
        altitude: config.altitude,
        targetZ: config.targetZ,
        sourcePos: { X: config.sourcePos.X, Y: config.sourcePos.Y, Z: config.sourcePos.Z },
        targetPos: { X: config.targetPos.X, Y: config.targetPos.Y, Z: config.targetPos.Z },
      }
    },
  }
}

main().catch(console.error)
