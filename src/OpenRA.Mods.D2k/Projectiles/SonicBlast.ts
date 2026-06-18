/**
 * SonicBlast.ts — D2K 音波爆炸抛射体（直线传播的冲击波）
 * OpenRA 对照: OpenRA.Mods.D2k/Projectiles/SonicBlast.cs (157 lines)
 *
 * 核心范式转换:
 * - C# IProjectile + ISync → TS IProjectile implementation
 * - C# WPos.LerpQuadratic 弹道插值 → TS WPos.lerpQuadratic (deterministic)
 * - C# BlocksProjectiles.AnyBlockingActorsBetween → TS spatial query stub
 * - C# Inaccuracy via WVec.FromPDF → TS randomized offset calculation
 * - C# Falloff damage modifier → TS linear interpolation
 * - C# SonicBlastRenderable (2D sprite quad) → TS SonicBlastRenderable
 * - C# World.AddFrameEndTask(w => w.Remove(this)) → TS frame-end callback
 *
 * 音波爆炸是沿直线传播、在多个距离步中施加伤害的投射物。
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { IProjectile, ProjectileArgs } from '../../OpenRA.Mods.Common/Projectiles/Bullet.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WarheadArgs } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { ISonicBlastRendererAccess } from '../Graphics/SonicBlastRenderable.js'
import { SonicBlastRenderable } from '../Graphics/SonicBlastRenderable.js'
import { BlocksProjectiles } from '../../OpenRA.Mods.Common/Traits/BlocksProjectiles.js'

// ---------------------------------------------------------------------------
// InaccuracyType enum (对应 OpenRA InaccuracyType)
// ---------------------------------------------------------------------------

export const InaccuracyType = {
  Maximum: 'Maximum' as const,
  PerCellIncrement: 'PerCellIncrement' as const,
  Absolute: 'Absolute' as const,
}
export type InaccuracyType = (typeof InaccuracyType)[keyof typeof InaccuracyType]

// ---------------------------------------------------------------------------
// SonicBlastInfo
// ---------------------------------------------------------------------------

/** Configuration for the sonic blast projectile.
 *
 * OpenRA 对照: SonicBlastInfo : IProjectileInfo
 */
export class SonicBlastInfo {
  /** Projectile speed in WDist/tick. */
  readonly speed: readonly WDist[]

  /** Ticks between warhead impacts in the area of effect. */
  readonly damageInterval: number

  /** Minimum distance the blast travels. */
  readonly minDistance: WDist

  /** Width of projectile (for finding blocking actors). */
  readonly width: WDist

  /** Damage modifier applied at each range step. */
  readonly falloff: readonly number[]

  /** Ranges at which each Falloff step is defined. */
  readonly range: readonly WDist[]

  /** Inaccuracy amount. */
  readonly inaccuracy: WDist

  /** Inaccuracy type. */
  readonly inaccuracyType: InaccuracyType

  /** Whether this projectile can be blocked by actors with BlocksProjectiles. */
  readonly blockable: boolean

  constructor(params: {
    speed?: readonly { length: number }[]
    damageInterval?: number
    minDistance?: { length: number }
    width?: { length: number }
    falloff?: readonly number[]
    range?: readonly { length: number }[]
    inaccuracy?: { length: number }
    inaccuracyType?: string
    blockable?: boolean
  } = {}) {
    this.speed = (params.speed ?? []).map(s => new WDist(s.length))
    this.damageInterval = params.damageInterval ?? 1
    this.minDistance = params.minDistance
      ? new WDist(params.minDistance.length)
      : WDist.Zero
    this.width = params.width
      ? new WDist(params.width.length)
      : new WDist(650)
    this.falloff = params.falloff ?? [100, 100]
    this.range = (params.range ?? []).map(r => new WDist(r.length))
    this.inaccuracy = params.inaccuracy
      ? new WDist(params.inaccuracy.length)
      : WDist.Zero
    this.inaccuracyType = (params.inaccuracyType ?? 'Maximum') as InaccuracyType
    this.blockable = params.blockable ?? false
  }

  /** Create the runtime projectile instance. */
  create(args: ProjectileArgs): SonicBlast {
    return new SonicBlast(this, args)
  }
}

// ---------------------------------------------------------------------------
// SonicBlast
// ---------------------------------------------------------------------------

/** A sonic blast projectile — travels in a straight line from source to
 * target, applying damage at each step distance.
 *
 * OpenRA 对照: SonicBlast : IProjectile, ISync
 */
export class SonicBlast implements IProjectile {
  private readonly _info: SonicBlastInfo
  private readonly _args: ProjectileArgs

  private readonly _speed: WDist
  private readonly _renderer: ISonicBlastRendererAccess | null

  /** Current position of the blast front. */
  private _pos: WPos
  /** Final target position (after inaccuracy). */
  private _target: WPos
  /** Total tick count for the blast to reach its target. */
  private _length: number

  /** Elapsed ticks since creation. */
  private _ticks: number = 0

  /** Whether this projectile has been removed. */
  isDestroyed: boolean = false

  constructor(info: SonicBlastInfo, args: ProjectileArgs) {
    this._info = info
    this._args = args

    const world = args.sourceActor.world as unknown as {
      worldActor?: { trait?: <T>(name: string) => T | undefined }
      sharedRandom?: { next: (min: number, max: number) => number }
      addFrameEndTask?: (fn: (w: unknown) => void) => void
    }

    this._renderer = world.worldActor?.trait?.<ISonicBlastRendererAccess>('SonicBlastRenderer') ?? null

    // Pick speed
    if (info.speed.length > 1) {
      const minSpeed = info.speed[0]!.length
      const maxSpeed = info.speed[1]!.length
      this._speed = new WDist(
        world.sharedRandom
          ? world.sharedRandom.next(minSpeed, maxSpeed)
          : minSpeed + Math.trunc(Math.random() * (maxSpeed - minSpeed)),
      )
    } else {
      this._speed = info.speed[0] ?? new WDist(128)
    }

    this._pos = args.source
    this._target = args.passiveTarget

    // Apply inaccuracy (对应 OpenRA WVec.FromPDF + maxInaccuracyOffset / 1024)
    if (info.inaccuracy.length > 0) {
      const maxInaccuracyOffset = this._computeInaccuracy(info, args)
      const rng = world.sharedRandom
      // WVec.FromPDF(SharedRandom, 2): two independent Gaussian-like axes,
      // each averaging 2 uniform samples in [-1024, 1024). Per Central Limit
      // Theorem this approximates a normal distribution.
      // OpenRA: target += WVec.FromPDF(world.SharedRandom, 2) * maxInaccuracyOffset / 1024
      const pdfSamples = 2
      let sumX = 0, sumY = 0
      for (let s = 0; s < pdfSamples; s++) {
        sumX += rng
          ? rng.next(-1024, 1024)
          : Math.trunc(Math.random() * 2048) - 1024
        sumY += rng
          ? rng.next(-1024, 1024)
          : Math.trunc(Math.random() * 2048) - 1024
      }
      const offsetX = Math.trunc((sumX / pdfSamples) * maxInaccuracyOffset / 1024)
      const offsetY = Math.trunc((sumY / pdfSamples) * maxInaccuracyOffset / 1024)
      this._target = WPos.add(this._target, new WVec(offsetX, offsetY, 0))
    }

    // Extend target if MinDistance is larger than actual distance
    const direction = new WVec(0, -1024, 0).rotate(WRot.fromYaw(
      WPos.subtract(this._target, this._pos).yaw,
    ))
    const sourceCP = (args.sourceActor as unknown as { centerPosition: WPos }).centerPosition
    const dist = WPos.subtract(sourceCP, this._target).length
    let extraDist = 0
    if (info.minDistance.length > dist) {
      extraDist = info.minDistance.length - dist
    }
    this._target = WPos.add(
      this._target,
      WVec.multiply(direction, Math.trunc(extraDist / 1024)),
    )

    const travelDist = WPos.subtract(this._target, this._pos).length
    this._length = Math.max(Math.trunc(travelDist / this._speed.length), 1)
  }

  // -----------------------------------------------------------------------
  // Tick (对应 OpenRA SonicBlast.Tick)
  // -----------------------------------------------------------------------

  /** Advance the sonic blast by one game tick.
   *
   * OpenRA 对照: SonicBlast.Tick(World world)
   */
  tick(world: GameWorldManager): void {
    const w = world as unknown as {
      addFrameEndTask?: (fn: (w: unknown) => void) => void
    }

    if (this._ticks++ >= this._length) {
      this.isDestroyed = true
      if (w.addFrameEndTask) {
        w.addFrameEndTask(() => {
          ;(world as unknown as { remove: (obj: unknown) => void }).remove(this)
        })
      }
      return
    }

    this._pos = WPos.lerpQuadratic(this._args.source, this._target, WAngle.Zero, this._ticks, this._length)

    // Blocking check (BlocksProjectiles.AnyBlockingActorsBetween)
    // OpenRA 对照: SonicBlast.Tick → BlocksProjectiles.AnyBlockingActorsBetween
    if (this._info.blockable) {
      const sourceActor = this._args.sourceActor
      const owner = (sourceActor as unknown as { owner?: unknown }).owner
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const worldAny: any = sourceActor.world

      if (owner && worldAny.findBlockingActorsOnLine) {
        const outHit: { hit: unknown } = { hit: null }
        const blocked = BlocksProjectiles.anyBlockingActorsBetween(
          worldAny,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          owner as any,
          this._args.source,
          this._pos,
          this._info.width,
          outHit,
        )

        if (blocked) {
          this.isDestroyed = true
          if (w.addFrameEndTask) {
            w.addFrameEndTask(() => {
              worldAny.remove?.(this)
            })
          }
          return
        }
      }
    }

    // Apply warhead impacts at each damage interval
    if (this._ticks % this._info.damageInterval === 0) {
      const falloffMod = this._getFalloff(
        WPos.subtract(this._args.source, this._pos).length,
      )
      const adjustedModifiers = [...(this._args.damageModifiers ?? []), falloffMod]

      const warheadArgs: WarheadArgs = {
        sourceActor: this._args.sourceActor,
        damageModifiers: adjustedModifiers,
        impactPosition: this._pos,
        impactOrientation: new WRot(
          WAngle.Zero,
          this._getVerticalAngle(this._args.source, this._target),
          (this._args.weapon as unknown as { currentMuzzleFacing?: () => WAngle }).currentMuzzleFacing?.()
            ?? this._args.facing
            ?? WAngle.Zero,
        ),
        source: this._args.source,
        // HACK: weapon type cast — ProjectileArgs.weapon is WeaponInfo | undefined
        weapon: this._args.weapon as unknown as WarheadArgs['weapon'],
        weaponTarget: this._args.guidedTarget,
      }

      if (this._args.weapon) {
        this._args.weapon.impact(Target.fromPos(this._pos), warheadArgs)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Render (对应 OpenRA SonicBlast.Render)
  // -----------------------------------------------------------------------

  /** Return renderables for this projectile. */
  render(wr: { world?: { fogObscures?: (pos: WPos) => boolean } }): readonly IRenderable[] {
    if (wr.world?.fogObscures?.(this._pos)) {
      return []
    }
    if (!this._renderer) return []

    return [new SonicBlastRenderable(this._renderer, this._pos) as unknown as IRenderable]
  }

  // -----------------------------------------------------------------------
  // GetFalloff (对应 OpenRA SonicBlast.GetFalloff)
  // -----------------------------------------------------------------------

  /** Compute the damage falloff at a given distance. */
  private _getFalloff(distance: number): number {
    const range = this._info.range
    const falloff = this._info.falloff

    let inner = range[0]?.length ?? 0
    for (let i = 1; i < range.length; i++) {
      const outer = range[i]?.length ?? 0
      if (outer > distance) {
        // int2.Lerp(low, high, d, dh): low + (high - low) * d / dh
        const low = falloff[i - 1] ?? 100
        const high = falloff[i] ?? 100
        const d = distance - inner
        const dh = outer - inner
        return Math.trunc(low + (high - low) * d / dh)
      }
      inner = outer
    }

    return 0
  }

  // -----------------------------------------------------------------------
  // GetVerticalAngle (对应 OpenRA Util.GetVerticalAngle)
  // -----------------------------------------------------------------------

  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const dx = to.X - from.X
    const dy = to.Y - from.Y
    const dz = to.Z - from.Z
    const groundDistSq = dx * dx + dy * dy
    if (groundDistSq === 0) return WAngle.Zero
    const groundDist = Math.trunc(Math.sqrt(groundDistSq))
    return WAngle.arcTan(dz, groundDist)
  }

  // -----------------------------------------------------------------------
  // ComputeInaccuracy (对应 OpenRA Util.GetProjectileInaccuracy)
  // -----------------------------------------------------------------------

  private _computeInaccuracy(info: SonicBlastInfo, args: ProjectileArgs): number {
    const inaccuracy = info.inaccuracy.length
    let range = WPos.subtract(args.passiveTarget, args.source).length

    switch (info.inaccuracyType) {
      case InaccuracyType.Maximum:
        return Math.min(range * 2 / 3, inaccuracy)
      case InaccuracyType.PerCellIncrement:
        range = Math.trunc(range / 1024) * 1024
        return Math.min(range, inaccuracy)
      case InaccuracyType.Absolute:
      default:
        return inaccuracy
    }
  }
}
