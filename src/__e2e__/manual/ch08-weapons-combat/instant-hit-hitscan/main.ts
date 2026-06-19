/**
 * instant-hit-hitscan/main.ts -- InstantHit projectile visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Projectiles/InstantHit.cs
 * GLSL对照: 无直接Shader映射（InstantHit无视觉projectile，仅使用LinesMesh shot line）
 *           Shot line颜色通过 LinesMesh.color 设置（绿=命中，红=阻挡）
 *           阻挡者高亮通过 StandardMaterial.diffuseColor/emissiveColor 切换实现
 *
 * Verifies:
 *   H1. weapon.impact() called on tick 0 (same tick as fire, zero travel time)
 *   H2. Projectile self-disposes (isDestroyed=true) after single tick
 *   H3. No visual projectile mesh created (render() returns empty array)
 *   H4. Blocking actor between source and target prevents hit, redirects to blocker
 *   H5. Without blocking, impact lands at intended target position
 *   H6. Inaccuracy offset applied within configured maxInaccuracyOffset range
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
  Mesh,
} from '@babylonjs/core'

import { WPos } from '../../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub, MersenneTwisterStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../../../OpenRA.Game/World.js'

import {
  InstantHit,
  InstantHitFactory,
  type InstantHitInfo,
} from '../../../../OpenRA.Mods.Common/Projectiles/InstantHit.js'
import {
  InaccuracyType,
} from '../../../../OpenRA.Mods.Common/Projectiles/MissileMath.js'
import type {
  ProjectileArgs,
  WeaponStub,
  BlockingActorsChecker,
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
// 2D point-to-segment distance (OpenRA XY ground plane)
// ---------------------------------------------------------------------------

function pointToSegmentDist2D(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const abx = bx - ax, aby = by - ay
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = ax + t * abx, projY = ay + t * aby
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
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
      events.push(`removeEffect: ${(effect as InstantHit).constructor.name}`)
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

// ---------------------------------------------------------------------------
// Shared scene resources (lazy-init)
// ---------------------------------------------------------------------------

let sharedSrcMarkerMat: StandardMaterial | null = null
function getSrcMarkerMat(scene: Scene): StandardMaterial {
  if (!sharedSrcMarkerMat) {
    sharedSrcMarkerMat = new StandardMaterial('srcMarkerMat', scene)
    sharedSrcMarkerMat.diffuseColor = new Color3(0.3, 0.9, 0.4)
    sharedSrcMarkerMat.emissiveColor = new Color3(0.15, 0.45, 0.2)
    sharedSrcMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedSrcMarkerMat
}

let sharedTgtMarkerMat: StandardMaterial | null = null
function getTgtMarkerMat(scene: Scene): StandardMaterial {
  if (!sharedTgtMarkerMat) {
    sharedTgtMarkerMat = new StandardMaterial('tgtMarkerMat', scene)
    sharedTgtMarkerMat.diffuseColor = new Color3(1, 0.25, 0.25)
    sharedTgtMarkerMat.emissiveColor = new Color3(0.5, 0.12, 0.12)
    sharedTgtMarkerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedTgtMarkerMat
}

let sharedBlockerMat: StandardMaterial | null = null
function getBlockerMat(scene: Scene): StandardMaterial {
  if (!sharedBlockerMat) {
    sharedBlockerMat = new StandardMaterial('blockerMat', scene)
    sharedBlockerMat.diffuseColor = new Color3(0.6, 0.55, 0.45)
    sharedBlockerMat.emissiveColor = new Color3(0.3, 0.25, 0.2)
    sharedBlockerMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedBlockerMat
}

let sharedBlockerHitMat: StandardMaterial | null = null
function getBlockerHitMat(scene: Scene): StandardMaterial {
  if (!sharedBlockerHitMat) {
    sharedBlockerHitMat = new StandardMaterial('blockerHitMat', scene)
    sharedBlockerHitMat.diffuseColor = new Color3(1, 0.15, 0.15)
    sharedBlockerHitMat.emissiveColor = new Color3(0.6, 0.08, 0.08)
    sharedBlockerHitMat.specularColor = new Color3(0, 0, 0)
  }
  return sharedBlockerHitMat
}

// ---------------------------------------------------------------------------
// Main test application
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.06, 0.08, 0.14, 1)

  // --- Camera ---
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 20, new Vector3(4, 0, 0), scene)
  camera.lowerRadiusLimit = 3
  camera.upperRadiusLimit = 60
  camera.attachControl(canvas, true)

  // --- Light ---
  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.8

  // --- Ground plane ---
  const ground = MeshBuilder.CreateGround('ground', { width: 30, height: 30 }, scene)
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.2, 0.28, 0.18)
  groundMat.specularColor = new Color3(0, 0, 0)
  groundMat.alpha = 0.6
  ground.material = groundMat
  ground.position.y = -0.02

  // --- Grid lines ---
  const gridLines: Vector3[][] = []
  for (let i = -8; i <= 8; i++) {
    gridLines.push([new Vector3(i, 0, -8), new Vector3(i, 0, 8)])
    gridLines.push([new Vector3(-8, 0, i), new Vector3(8, 0, i)])
  }
  MeshBuilder.CreateLineSystem('grid', { lines: gridLines, colors: gridLines.map(() => [
    new Color4(0.3, 0.3, 0.3, 0.2), new Color4(0.3, 0.3, 0.3, 0.2),
  ]) }, scene)

  // --- Source marker ---
  const srcMarker = MeshBuilder.CreateSphere('srcMarker', { diameter: 0.3, segments: 8 }, scene)
  srcMarker.material = getSrcMarkerMat(scene)

  // --- Target marker ---
  const tgtMarker = MeshBuilder.CreateSphere('tgtMarker', { diameter: 0.3, segments: 8 }, scene)
  tgtMarker.material = getTgtMarkerMat(scene)

  // --- Blocking actor meshes (pre-allocated pool of 5) ---
  const blockerMeshes: Mesh[] = []
  const BLOCKER_POOL_SIZE = 5
  for (let i = 0; i < BLOCKER_POOL_SIZE; i++) {
    const box = MeshBuilder.CreateBox(`blocker${i}`, { width: 0.3, height: 0.3, depth: 0.3 }, scene)
    box.material = getBlockerMat(scene)
    box.isVisible = false
    blockerMeshes.push(box)
  }

  // --- Impact flash ---
  const flashSphere = MeshBuilder.CreateSphere('flash', { diameter: 0.4, segments: 16 }, scene)
  const flashMat = new StandardMaterial('flashMat', scene)
  flashMat.diffuseColor = new Color3(1, 0.8, 0.15)
  flashMat.emissiveColor = new Color3(0.8, 0.4, 0.05)
  flashMat.specularColor = new Color3(0, 0, 0)
  flashMat.alpha = 0.8
  flashSphere.material = flashMat
  flashSphere.isVisible = false

  // --- Shot line (source → impact) ---
  let shotLine: LinesMesh | null = null

  // --- State ---
  let instantHit: InstantHit | null = null
  let { world, events: worldEvents, flushFrameEnd } = createStubWorld()
  let shotFired = false
  let shotComplete = false
  let weaponImpactCount = 0
  let impactTargetPos: WPos | null = null
  let wasBlocked = false
  let blockedByPos: WPos | null = null
  let tickCount = 0

  // Config
  const config = {
    sourcePos: new WPos(0, 0, 0),
    targetPos: new WPos(8192, 0, 0),
    blockable: true,
    inaccuracy: WDist.Zero,
    width: new WDist(1),
    blockerScanRadius: new WDist(4096),
  }

  // Blocker positions array (editable via harness)
  const blockerPositions: WPos[] = [
    new WPos(4100, 0, 0),  // near midline, should block default shot
  ]

  // --- Blocking checker ---
  function makeBlockingChecker(): BlockingActorsChecker | null {
    if (!config.blockable || blockerPositions.length === 0) return null

    return (_world: GameWorldManager, _owner: PlayerStub, from: WPos, to: WPos, width: WDist): WPos | null => {
      let closestDist = Infinity
      let closestPos: WPos | null = null

      for (const bp of blockerPositions) {
        const dist = pointToSegmentDist2D(bp.X, bp.Y, from.X, from.Y, to.X, to.Y)
        const threshold = width.length / 2
        if (dist <= threshold && dist < closestDist) {
          closestDist = dist
          closestPos = bp
        }
      }

      if (closestPos) {
        blockedByPos = closestPos
        return closestPos
      }
      return null
    }
  }

  // --- Weapon stub ---
  function createStubWeapon(onImpact?: (target: Target) => void): WeaponStub {
    return {
      weaponKey: 'testWeapon',
      warheads: [],
      impactCount: 0,
      impact(target: Target, _args: unknown): void {
        (this as { impactCount: number }).impactCount++
        weaponImpactCount++
        impactTargetPos = target.centerPosition
        if (onImpact) onImpact(target)
      },
    } as unknown as WeaponStub
  }

  // --- Update markers ---
  function updateMarkers(): void {
    srcMarker.position = wPosToVector3(config.sourcePos.X, config.sourcePos.Y, config.sourcePos.Z)
    tgtMarker.position = wPosToVector3(config.targetPos.X, config.targetPos.Y, config.targetPos.Z)

    // Update blocking actor meshes
    for (let i = 0; i < BLOCKER_POOL_SIZE; i++) {
      const mesh = blockerMeshes[i]!
      if (i < blockerPositions.length) {
        const bp = blockerPositions[i]!
        mesh.position = wPosToVector3(bp.X, bp.Y, bp.Z)
        mesh.isVisible = true
        // Highlight if this blocker was hit
        mesh.material = (wasBlocked && blockedByPos && bp.X === blockedByPos.X && bp.Y === blockedByPos.Y)
          ? getBlockerHitMat(scene)
          : getBlockerMat(scene)
      } else {
        mesh.isVisible = false
      }
    }

    camera.target.set(
      (config.sourcePos.X + config.targetPos.X) / 2 * WORLD_SCALE,
      0,
      (config.sourcePos.Y + config.targetPos.Y) / 2 * WORLD_SCALE,
    )
  }

  // --- Update shot line ---
  function updateShotLine(impactPos: WPos): void {
    const srcV3 = wPosToVector3(config.sourcePos.X, config.sourcePos.Y, config.sourcePos.Z)
    const impV3 = wPosToVector3(impactPos.X, impactPos.Y, impactPos.Z)
    const points = [srcV3, impV3]
    const isBlocked = wasBlocked

    if (!shotLine) {
      shotLine = MeshBuilder.CreateLines('shotLine', { points, updatable: true }, scene)
    } else {
      shotLine = MeshBuilder.CreateLines('shotLine', { points, instance: shotLine }, scene)
    }
    shotLine.color = isBlocked ? new Color3(1, 0.3, 0.3) : new Color3(0.3, 0.9, 0.4)
  }

  // --- Fire ---
  function fireShot(
    fromOverride?: WPos,
    toOverride?: WPos,
    blockableOverride?: boolean,
  ): void {
    resetScene(false)

    if (fromOverride) config.sourcePos = fromOverride
    if (toOverride) config.targetPos = toOverride
    if (blockableOverride !== undefined) config.blockable = blockableOverride

    updateMarkers()

    const weapon = createStubWeapon()
    const blockingChecker = makeBlockingChecker()

    const info: InstantHitInfo = {
      inaccuracy: config.inaccuracy,
      inaccuracyType: InaccuracyType.Maximum,
      blockable: config.blockable,
      width: config.width,
      blockerScanRadius: config.blockerScanRadius,
    }

    const args: ProjectileArgs = {
      source: config.sourcePos,
      passiveTarget: config.targetPos,
      sourceActor: createStubActor(config.sourcePos),
      facing: WAngle.fromDegrees(0),
      weapon: weapon as unknown as WeaponStub,
      inaccuracySource: config.inaccuracy,
      random: createStubRandom() as unknown as MersenneTwisterStub,
      guidedTarget: Target.fromPos(config.targetPos),
      rangeModifiers: [],
    }

    instantHit = InstantHitFactory.create(args, info, blockingChecker)

    if (!instantHit.isDestroyed) {
      instantHit.tick(world)
      tickCount = 1

      if (instantHit.isDestroyed) {
        shotComplete = true
        flushFrameEnd()

        if (impactTargetPos) {
          updateShotLine(impactTargetPos)

          // Show flash at impact
          flashSphere.position = wPosToVector3(impactTargetPos.X, impactTargetPos.Y, impactTargetPos.Z)
          flashSphere.isVisible = true

          let flashAlpha = 1.0
          const flashFadeInterval = setInterval(() => {
            flashAlpha -= 0.1
            if (flashAlpha <= 0) {
              flashAlpha = 0
              flashSphere.isVisible = false
              clearInterval(flashFadeInterval)
            }
            flashMat.alpha = Math.max(0, flashAlpha)
          }, 50)
        }

        wasBlocked = blockedByPos !== null
        addLog('impact', wasBlocked
          ? `BLOCKED — shot redirected to blocker at (${impactTargetPos!.X}, ${impactTargetPos!.Y})`
          : `HIT — target impacted at (${impactTargetPos!.X}, ${impactTargetPos!.Y})`)
        addLog('info', `Tick: ${tickCount}, weapon.impact() count: ${weaponImpactCount}`)
      }
    }

    shotFired = true
    updateDiagnostics()
  }

  // --- Reset ---
  function resetScene(resetBlockers = true): void {
    instantHit = null
    shotFired = false
    shotComplete = false
    weaponImpactCount = 0
    impactTargetPos = null
    wasBlocked = false
    blockedByPos = null
    tickCount = 0
    flashSphere.isVisible = false
    if (shotLine) {
      shotLine.dispose()
      shotLine = null
    }
    worldEvents.length = 0

    const fresh = createStubWorld()
    world = fresh.world
    worldEvents = fresh.events
    flushFrameEnd = fresh.flushFrameEnd

    if (resetBlockers) {
      blockerPositions.length = 0
      blockerPositions.push(new WPos(4100, 0, 0))
    }

    updateMarkers()
    updateDiagnostics()
    clearLog()
    addLog('info', 'Ready. Configure shot and press FIRE.')
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

    if (shotComplete) {
      setVal('diag-tick', String(tickCount), false)
      setVal('diag-shot', wasBlocked ? 'BLOCKED' : 'DIRECT HIT', wasBlocked)
      setVal('diag-impact-count', String(weaponImpactCount), weaponImpactCount !== 1)
      if (impactTargetPos) {
        setVal('diag-impact-pos', `(${impactTargetPos.X}, ${impactTargetPos.Y}, ${impactTargetPos.Z})`, false)
      }
      setVal('diag-blocker', blockedByPos ? `(${blockedByPos.X}, ${blockedByPos.Y})` : 'none', wasBlocked)
      setVal('diag-travel', '0 ticks (instant)', true)
    } else if (shotFired) {
      setVal('diag-tick', 'Processing...', false)
    } else {
      setVal('diag-tick', '-', false)
      setVal('diag-shot', 'NOT FIRED', false)
      setVal('diag-impact-count', '0', false)
      setVal('diag-impact-pos', '-', false)
      setVal('diag-blocker', '-', false)
      setVal('diag-travel', '-', false)
    }

    setVal('diag-blockers', String(blockerPositions.length))
    setVal('diag-blockable', config.blockable ? 'ON' : 'OFF')
  }

  // --- Event log ---
  function addLog(cls: string, msg: string): void {
    const container = document.getElementById('event-log')
    if (!container) return
    const row = document.createElement('div')
    row.className = `log-row log-${cls}`
    row.textContent = msg
    container.appendChild(row)
    container.scrollTop = container.scrollHeight
  }

  function clearLog(): void {
    const container = document.getElementById('event-log')
    if (container) container.innerHTML = ''
  }

  // --- Render loop ---
  engine.runRenderLoop(() => {
    scene.render()
    const fps = engine.getFps().toFixed(1)
    const fpsEl = document.getElementById('info-fps')
    if (fpsEl) fpsEl.textContent = fps
  })

  // --- Env info ---
  document.getElementById('info-ua')!.textContent = navigator.userAgent.substring(0, 60)
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = 'WebGL 2.0 (Babylon.js)'
  document.getElementById('info-time')!.textContent = new Date().toISOString().replace('T', ' ').substring(0, 19)

  // --- UI handlers ---
  document.getElementById('btn-fire')!.addEventListener('click', () => fireShot())
  document.getElementById('btn-reset')!.addEventListener('click', () => resetScene())

  // Toggle blockable
  document.getElementById('btn-toggle-blockable')!.addEventListener('click', () => {
    config.blockable = !config.blockable
    const btn = document.getElementById('btn-toggle-blockable')!
    btn.textContent = config.blockable ? 'Blockable: ON' : 'Blockable: OFF'
    btn.className = config.blockable ? 'primary' : ''
    updateDiagnostics()
  })

  // Add blocker at clicked position (via harness or manual input)
  document.getElementById('btn-add-blocker')!.addEventListener('click', () => {
    const bx = parseInt((document.getElementById('input-blocker-x') as HTMLInputElement).value) || 4096
    const by = parseInt((document.getElementById('input-blocker-y') as HTMLInputElement).value) || 0
    blockerPositions.push(new WPos(bx, by, 0))
    updateMarkers()
    updateDiagnostics()
    addLog('info', `Blocker added at (${bx}, ${by}). Total: ${blockerPositions.length}`)
  })

  document.getElementById('btn-clear-blockers')!.addEventListener('click', () => {
    blockerPositions.length = 0
    resetScene(false)
    blockerPositions.length = 0
    updateMarkers()
    updateDiagnostics()
    addLog('info', 'All blockers cleared.')
  })

  // Config sliders
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

  bindSlider('config-inaccuracy', (v) => { config.inaccuracy = new WDist(v) }, v => `${v} su`)
  bindSlider('config-width', (v) => { config.width = new WDist(v) }, v => `${v} su (r=${(v * WORLD_SCALE / 2).toFixed(2)}wu)`)

  // --- Init ---
  updateMarkers()
  updateDiagnostics()
  addLog('info', 'Ready. Instant-hit test: configure blockers, toggle blockable, fire shot.')

  // Engine.dispose() recursively disposes all scene objects
  window.addEventListener('beforeunload', () => { engine.dispose() })

  // ---------------------------------------------------------------------------
  // __testHarness API
  // ---------------------------------------------------------------------------

  ;(window as any).__testHarness = {
    /** Fire an instant-hit shot. Returns true if shot created and processed. */
    fireHitscan(
      from?: { X: number; Y: number; Z: number },
      to?: { X: number; Y: number; Z: number },
      options?: { blockable?: boolean; inaccuracy?: number; width?: number },
    ): boolean {
      const wFrom = from ? new WPos(from.X, from.Y, from.Z) : undefined
      const wTo = to ? new WPos(to.X, to.Y, to.Z) : undefined
      if (options?.blockable !== undefined) config.blockable = options.blockable
      if (options?.inaccuracy !== undefined) config.inaccuracy = new WDist(options.inaccuracy)
      if (options?.width !== undefined) config.width = new WDist(options.width)
      fireShot(wFrom, wTo, config.blockable)
      return shotComplete
    },

    /** Whether the intended target was hit (not blocked). */
    isTargetHit(): boolean { return shotComplete && !wasBlocked },

    /** Whether the shot was blocked. */
    isBlocked(): boolean { return wasBlocked },

    /** Get the blocking actor position, or null. */
    getBlockingPosition(): { X: number; Y: number; Z: number } | null {
      if (!blockedByPos) return null
      return { X: blockedByPos.X, Y: blockedByPos.Y, Z: blockedByPos.Z }
    },

    /** Get actual impact position. */
    getImpactPosition(): { X: number; Y: number; Z: number } | null {
      if (!impactTargetPos) return null
      return { X: impactTargetPos.X, Y: impactTargetPos.Y, Z: impactTargetPos.Z }
    },

    /** Number of weapon.impact() calls. */
    getImpactCount(): number { return weaponImpactCount },

    /** Whether projectile is fully disposed. */
    hasDisposed(): boolean { return shotComplete },

    /** Get tick count (should be 1 for instant hit). */
    getTickCount(): number { return tickCount },

    /** Add a blocking actor at given position. */
    addBlocker(pos: { X: number; Y: number; Z: number }): void {
      blockerPositions.push(new WPos(pos.X, pos.Y, pos.Z))
      updateMarkers()
      updateDiagnostics()
    },

    /** Clear all blocking actors. */
    clearBlockers(): void {
      blockerPositions.length = 0
      updateMarkers()
      updateDiagnostics()
    },

    /** Get blocker positions. */
    getBlockers(): { X: number; Y: number; Z: number }[] {
      return blockerPositions.map(b => ({ X: b.X, Y: b.Y, Z: b.Z }))
    },

    /** Get target position. */
    getTargetPosition(): { X: number; Y: number; Z: number } {
      return { X: config.targetPos.X, Y: config.targetPos.Y, Z: config.targetPos.Z }
    },

    /** Reset scene (optionally keep blockers). */
    resetScene(keepBlockers?: boolean): void {
      const keep = keepBlockers === true
      if (keep) {
        const saved = blockerPositions.map(b => new WPos(b.X, b.Y, b.Z))
        resetScene(false)
        blockerPositions.length = 0
        for (const bp of saved) blockerPositions.push(bp)
      } else {
        resetScene(true)
      }
      updateMarkers()
      updateDiagnostics()
    },

    /** Get current config. */
    getConfig(): Record<string, unknown> {
      return {
        blockable: config.blockable,
        inaccuracy: config.inaccuracy.length,
        width: config.width.length,
        blockerPositions: blockerPositions.map(b => ({ X: b.X, Y: b.Y, Z: b.Z })),
      }
    },
  }
}

main().catch(console.error)
