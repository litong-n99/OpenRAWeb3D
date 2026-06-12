/**
 * InstantHit.ts — 零飞行时间抛射体（即时命中，如狙击步枪、机枪）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/InstantHit.cs
 *
 * 核心范式转换:
 * - C# InstantHit.Tick() 单次调用武器 Impact → TypeScript 同样逻辑
 * - C# BlocksProjectiles.AnyBlockingActorsBetween → BlockingActorsChecker 回调
 * - C# Target.CenterPosition / ValidFor → TypeScript Target 对应方法
 * - C# 无视觉渲染 → TypeScript render() 返回空数组
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  type IProjectile,
  type ProjectileArgs,
  type WarheadArgsStub,
  type BlockingActorsChecker,
  InaccuracyType,
} from './Bullet.js'

// ---------------------------------------------------------------------------
// InstantHitInfo — projectile configuration
// OpenRA 对照: InstantHitInfo class
// ---------------------------------------------------------------------------

/**
 * Configuration for the InstantHit projectile.
 *
 * OpenRA 对照: InstantHitInfo class
 */
export interface InstantHitInfo {
  /** Maximum inaccuracy distance. */
  inaccuracy: WDist
  /** How inaccuracy scales with range. */
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  /** Whether projectile can be blocked. */
  blockable: boolean
  /** Width of projectile for collision. */
  width: WDist
  /** Scan radius for blocking actors (-1 = auto-scale). */
  blockerScanRadius: WDist
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

export const DEFAULT_INSTANT_HIT_INFO: InstantHitInfo = {
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Maximum,
  blockable: false,
  width: new WDist(1),
  blockerScanRadius: new WDist(-1),
}

// ---------------------------------------------------------------------------
// InstantHit — projectile implementation
// OpenRA 对照: InstantHit class
// ---------------------------------------------------------------------------

export class InstantHit implements IProjectile {
  readonly info: InstantHitInfo
  readonly args: ProjectileArgs
  target: Target
  isDestroyed: boolean
  private readonly _checkBlocking: BlockingActorsChecker | null

  /**
   * Construct an InstantHit projectile.
   *
   * OpenRA 对照: InstantHit.InstantHit(InstantHitInfo, ProjectileArgs)
   */
  constructor(
    info: InstantHitInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
  ) {
    this.info = info
    this.args = args
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null

    if (this._isWeaponTargetActorCenter()) {
      this.target = args.guidedTarget
    } else if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const maxInaccuracyOffset = this._getProjectileInaccuracy(
        info.inaccuracy,
        info.inaccuracyType,
        args,
      )
      const inaccuracyOffset = this._applyInaccuracy(args, maxInaccuracyOffset)
      this.target = Target.fromPos(WPos.add(args.passiveTarget, inaccuracyOffset))
    } else {
      this.target = Target.fromPos(args.passiveTarget)
    }
  }

  /** Tick — apply warheads and self-destruct in a single tick.
   *
   * OpenRA 对照: InstantHit.Tick(World world)
   */
  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    if (this.target.type === 0) {
      this.target = Target.fromPos(this.args.passiveTarget)
    }

    const targetPos = this.target.centerPosition

    if (
      this.info.blockable &&
      this._checkBlocking &&
      this.args.sourceActor?.owner
    ) {
      const blockedPos = this._checkBlocking(
        world,
        this.args.sourceActor.owner,
        this.args.source,
        targetPos,
        this.info.width,
      )
      if (blockedPos !== null) {
        this.target = Target.fromPos(blockedPos)
      }
    }

    const impactPos = this.target.centerPosition

    const warheadArgs: WarheadArgsStub = {
      firedBy: this.args.sourceActor,
      facing: this.args.facing,
      impactOrientation: new WRot(
        WAngle.Zero,
        this._getVerticalAngle(this.args.source, impactPos),
        this.args.facing,
      ),
      impactPosition: impactPos,
      weapon: this.args.weapon,
    }

    this.args.weapon.impact(this.target, warheadArgs)
    this.isDestroyed = true

    world.addFrameEndTask(() => {
      world.removeEffect(this)
    })
  }

  /** No visual rendering. */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return []
  }

  dispose(): void {
    this.isDestroyed = true
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private _isWeaponTargetActorCenter(): boolean {
    return (this.args.weapon as unknown as Record<string, unknown>).targetActorCenter === true
  }

  private _getProjectileInaccuracy(
    inaccuracy: WDist,
    type: typeof InaccuracyType[keyof typeof InaccuracyType],
    args: ProjectileArgs,
  ): number {
    const range = WPos.subtract(args.passiveTarget, args.source).length
    switch (type) {
      case InaccuracyType.Maximum:
        return Math.min(
          inaccuracy.length,
          Math.trunc(range / Math.max(1, args.inaccuracySource.length)),
        )
      case InaccuracyType.PerCellIncrement: {
        const cells = Math.max(0, Math.trunc(range / 1024))
        return cells * inaccuracy.length
      }
      case InaccuracyType.Absolute:
        return inaccuracy.length
      default:
        return 0
    }
  }

  private _applyInaccuracy(args: ProjectileArgs, maxInaccuracyOffset: number): WVec {
    const ax = -(args.random.next() % (2 * maxInaccuracyOffset + 1)) + maxInaccuracyOffset
    const ay = -(args.random.next() % (2 * maxInaccuracyOffset + 1)) + maxInaccuracyOffset
    return new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0)
  }

  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const delta = WPos.subtract(to, from)
    const horizontalDelta = delta.horizontalLength
    if (horizontalDelta === 0) return WAngle.Zero
    const verticalVector = new WVec(-delta.Z, -horizontalDelta, 0)
    return verticalVector.yaw
  }
}

// ---------------------------------------------------------------------------
// InstantHitFactory
// ---------------------------------------------------------------------------

export const InstantHitFactory = {
  create(
    args: ProjectileArgs,
    overrides?: Partial<InstantHitInfo>,
    checkBlocking?: BlockingActorsChecker | null,
  ): InstantHit {
    const info: InstantHitInfo = { ...DEFAULT_INSTANT_HIT_INFO, ...overrides }
    return new InstantHit(info, args, checkBlocking)
  },
}
