/**
 * InstantHit.ts — 零飞行时间抛射体（即时命中，如狙击步枪、机枪）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/InstantHit.cs
 *
 * 核心范式转换:
 * - C# InstantHit.Tick() 单次调用武器 Impact → TypeScript 同样逻辑
 * - C# BlocksProjectiles.AnyBlockingActorsBetween → BlockingActorsChecker 回调
 * - C# Target.CenterPosition / ValidFor → TypeScript Target 对应方法
 * - C# 无视觉渲染 → TypeScript render() 返回空数组
 * - C# Util.GetVerticalAngle / Util.GetProjectileInaccuracy → MissileMath.ts 共享函数
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
} from './Bullet.js'
import {
  InaccuracyType,
  getVerticalAngle,
  getProjectileInaccuracy,
} from './MissileMath.js'

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
  /** Scan radius for blocking actors (-1 = auto-scale from weapon range).
   *
   * OpenRA 对照: InstantHitInfo.BlockerScanRadius
   *
   * MINOR: When negative, auto-scale to weapon range; otherwise use the specified value.
   * TODO: Integrate weapon range lookup for auto-scaling.
   */
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
   *
   * @param info — projectile configuration
   * @param args — construction arguments
   * @param checkBlocking — optional blocking actor checker
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
      // MAJOR 13: use shared getProjectileInaccuracy from MissileMath
      const range = WPos.subtract(args.passiveTarget, args.source).length
      const maxInaccuracyOffset = getProjectileInaccuracy(
        info.inaccuracy.length,
        info.inaccuracyType,
        range,
        args.inaccuracySource.length,
      )
      const inaccuracyOffset = this._applyInaccuracy(args, maxInaccuracyOffset)
      this.target = Target.fromPos(WPos.add(args.passiveTarget, inaccuracyOffset))
    } else {
      this.target = Target.fromPos(args.passiveTarget)
    }

    // MINOR: blockerScanRadius handling
    // When blockerScanRadius is -1 (default), the scan radius should auto-scale
    // to the weapon range. This requires weapon range lookup (deferred).
    // OpenRA C#: if (Info.BlockerScanRadius > WDist.Zero) { ... use explicit value ... }
    // else { ... auto-scale from weapon range ... }
    // TODO-8.B.12-SCANRADIUS: Implement auto-scaling for blockerScanRadius
  }

  /** Tick — apply warheads and self-destruct in a single tick.
   *
   * OpenRA 对照: InstantHit.Tick(World world)
   *
   * @param world — the game world manager
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
      // MAJOR 12: use shared getVerticalAngle from MissileMath
      impactOrientation: new WRot(
        WAngle.Zero,
        getVerticalAngle(this.args.source, impactPos),
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

  private _applyInaccuracy(args: ProjectileArgs, maxInaccuracyOffset: number): WVec {
    const ax = -(args.random.next() % (2 * maxInaccuracyOffset + 1)) + maxInaccuracyOffset
    const ay = -(args.random.next() % (2 * maxInaccuracyOffset + 1)) + maxInaccuracyOffset
    return new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0)
  }
}

// ---------------------------------------------------------------------------
// InstantHitFactory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating InstantHit projectiles with default configuration.
 *
 * OpenRA 对照: InstantHitInfo.Create(ProjectileArgs)
 */
export const InstantHitFactory = {
  /**
   * Create an InstantHit with default configuration.
   *
   * OpenRA 对照: InstantHitInfo.Create(ProjectileArgs)
   *
   * @param args — projectile construction arguments
   * @param overrides — optional config overrides
   * @param checkBlocking — optional blocking actor checker
   * @returns a new InstantHit instance
   */
  create(
    args: ProjectileArgs,
    overrides?: Partial<InstantHitInfo>,
    checkBlocking?: BlockingActorsChecker | null,
  ): InstantHit {
    const info: InstantHitInfo = { ...DEFAULT_INSTANT_HIT_INFO, ...overrides }
    return new InstantHit(info, args, checkBlocking)
  },
}
