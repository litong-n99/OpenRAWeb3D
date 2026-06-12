/**
 * HitShape.ts -- Shape of actor for targeting and damage calculations
 * OpenRA 对照: OpenRA.Mods.Common/Traits/HitShape.cs (177 lines)
 *
 * 核心范式转换:
 * - C# HitShape : ConditionalTrait<HitShapeInfo>, ITargetablePositions
 *   → TS ConditionalTrait<HitShapeInfo>, ITargetablePositions
 * - C# IHitShape Type field (loaded by shape name) → TS IHitShape instance
 * - C# BodyOrientation, Turreted, ITargetableCells → TS duck-typed access
 * - C# cache with value tuple key → TS cache with JSON string key
 */

import {
  type IGameActor,
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ITargetablePositions } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CircleShape } from './HitShape/CircleShape.js'
import type { IHitShape } from './HitShape/IHitShape.js'

// ---------------------------------------------------------------------------
// HitShapeInfo
// OpenRA 对照: HitShapeInfo (ConditionalTraitInfo, Requires<BodyOrientationInfo>)
// ---------------------------------------------------------------------------

/** Configuration for the HitShape trait.
 *
 *  OpenRA 对照: HitShapeInfo
 */
export class HitShapeInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Name of turret this shape is linked to. Leave empty to link shape to body.
   *
   *  OpenRA 对照: HitShapeInfo.Turret
   */
  readonly turret: string | null = null

  /** Create a targetable position for each offset listed here (relative to CenterPosition).
   *
   *  OpenRA 对照: HitShapeInfo.TargetableOffsets
   */
  readonly targetableOffsets: readonly WVec[] = [WVec.Zero]

  /** Create a targetable position at the center of each occupied cell.
   *
   *  OpenRA 对照: HitShapeInfo.UseTargetableCellsOffsets
   */
  readonly useTargetableCellsOffsets: boolean = false

  /** Which armor types apply (if none, all armor types are valid).
   *
   *  OpenRA 对照: HitShapeInfo.ArmorTypes
   */
  readonly armorTypes: ReadonlySet<string> = new Set()

  /** The hit shape type instance.
   *
   *  OpenRA 对照: HitShapeInfo.Type (IHitShape)
   */
  readonly type: IHitShape

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    turret?: string | null
    targetableOffsets?: WVec[]
    useTargetableCellsOffsets?: boolean
    armorTypes?: ReadonlySet<string>
    type?: IHitShape
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.turret = params.turret ?? null
    this.targetableOffsets = params.targetableOffsets ?? [WVec.Zero]
    this.useTargetableCellsOffsets = params.useTargetableCellsOffsets ?? false
    this.armorTypes = params.armorTypes ?? new Set()
    this.type = params.type ?? new CircleShape()
    this.type.initialize()
  }
}

// ---------------------------------------------------------------------------
// HitShape
// OpenRA 对照: HitShape
// ---------------------------------------------------------------------------

/** Shape of actor for targeting and damage calculations.
 *
 *  OpenRA 对照: HitShape (ConditionalTrait<HitShapeInfo>, ITargetablePositions)
 */
export class HitShape
  extends ConditionalTrait<HitShapeInfo>
  implements ITargetablePositions
{
  // Duck-typed traits
  private targetableCells: { targetableCells(): Array<unknown> } | null = null
  private turret: unknown | null = null

  // Cache for targetable positions
  private cacheKey: string = ''
  private cachedTargetablePositions: WPos[] | null = null

  constructor(info: HitShapeInfo) {
    super(info)
  }

  /** Initialize after actor creation: find related traits.
   *
   *  OpenRA 对照: HitShape.Created()
   */
  created(self: IGameActor): void {
    // Duck-typed access for BodyOrientation
    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }

    // BodyOrientation is required (Requires<BodyOrientationInfo>)
    // Accessed via duck-typing when needed

    // ITargetableCells (optional)
    this.targetableCells = null

    // Turreted (optional, by name match)
    const turrets = actorAny.getTraits?.<unknown>('turreted') ?? []
    this.turret = this.info.turret
      ? turrets.find(
          t =>
            (t as { name?: string }).name === this.info.turret,
        ) ?? null
      : null
  }

  // ---------------------------------------------------------------------------
  // ITargetablePositions
  // OpenRA 对照: ITargetablePositions.TargetablePositions()
  // ---------------------------------------------------------------------------

  /** All positions available to target for range checks.
   *
   *  OpenRA 对照: ITargetablePositions.TargetablePositions(Actor)
   */
  targetablePositions(self: IGameActor): readonly WPos[] {
    if (this.isTraitDisabled) return []

    const newCacheKey = this.computeCacheKey(self)
    if (
      this.cachedTargetablePositions === null ||
      this.cacheKey !== newCacheKey
    ) {
      this.cachedTargetablePositions = this.computeTargetablePositions(self)
      this.cacheKey = newCacheKey
    }

    return this.cachedTargetablePositions
  }

  // ---------------------------------------------------------------------------
  // Distance calculation
  // ---------------------------------------------------------------------------

  /** Distance from the hit shape edge to a world position.
   *
   *  OpenRA 对照: HitShape.DistanceFromEdge(Actor, WPos)
   */
  distanceFromEdge(self: IGameActor, pos: WPos): WDist {
    const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero

    const posAccess = self as unknown as {
      centerPosition?: WPos
      orientation?: WRot
    }

    const origin = this.turret
      ? WPos.add(
          centerPos,
          (this.turret as { position?: (s: unknown) => WVec }).position?.(self) ?? WVec.Zero,
        )
      : centerPos

    const orientation = this.turret
      ? ((this.turret as { worldOrientation?: WRot }).worldOrientation ?? WRot.None)
      : (posAccess.orientation ?? WRot.None)

    return this.info.type.distanceFromEdge(pos, origin, orientation)
  }

  // ---------------------------------------------------------------------------
  // Debug annotations (deferred for rendering integration)
  // ---------------------------------------------------------------------------

  // TODO-8.D.HITSHAPE-DEFER: RenderDebugAnnotations and RenderDebugOverlay
  // require LineAnnotationRenderable and WorldRenderer which are deferred
  // to Phase E rendering integration.

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Compute all targetable positions for this hit shape.
   *
   *  OpenRA 对照: HitShape.TargetablePositions(Actor)
   */
  private computeTargetablePositions(self: IGameActor): WPos[] {
    const result: WPos[] = []

    const posAccess = self as unknown as {
      centerPosition?: WPos
      orientation?: WRot
    }
    const centerPos = posAccess.centerPosition ?? WPos.Zero

    // Cell-based positions (if available)
    if (this.info.useTargetableCellsOffsets && this.targetableCells) {
      // NOTE: Requires world.Map.CenterOfCell() which is not yet wired
      // TODO-8.D.HITSHAPE-DEFER: Cell-based targetable positions
    }

    // Offset-based positions
    for (const offset of this.info.targetableOffsets) {
      const worldOffset = this.calculateTargetableOffset(self, offset)
      result.push(WPos.add(centerPos, worldOffset))
    }

    // Always include at least center position
    if (result.length === 0) {
      result.push(centerPos)
    }

    return result
  }

  /** Calculate the world-space offset from a local offset.
   *
   *  OpenRA 对照: HitShape.CalculateTargetableOffset(Actor, WVec)
   */
  private calculateTargetableOffset(self: IGameActor, offset: WVec): WVec {
    let localOffset = offset

    const posAccess = self as unknown as {
      orientation?: WRot
    }
    const orientation = posAccess.orientation ?? WRot.None

    // Quantize body orientation (8-direction)
    const quantizedOrientation = this.quantizeOrientation(orientation)

    // Apply turret transform if present
    if (this.turret) {
      const turretAny = this.turret as {
        localOrientation?: WRot
        offset?: WVec
      }
      if (turretAny.localOrientation) {
        localOffset = localOffset.rotate(turretAny.localOrientation)
      }
      if (turretAny.offset) {
        localOffset = WVec.add(localOffset, turretAny.offset)
      }
    }

    // Body orientation to world
    return localOffset.rotate(quantizedOrientation)
  }

  /** Quantize orientation to 8 discrete directions.
   *
   *  OpenRA 对照: BodyOrientation.QuantizeOrientation(WRot)
   */
  private quantizeOrientation(orientation: WRot): WRot {
    const facing = orientation.yaw.facing
    const quantized = Math.round(facing / 32) * 32
    return WRot.fromFacing((quantized + 256) % 256)
  }

  /** Compute a cache key for targetable positions invalidation.
   *
   *  OpenRA 对照: HitShape cacheInput tuple comparison
   */
  private computeCacheKey(self: IGameActor): string {
    const posAccess = self as unknown as {
      centerPosition?: WPos
      orientation?: WRot
    }
    const cp = posAccess.centerPosition?.toString() ?? ''
    const or = posAccess.orientation?.toString() ?? ''
    const to = this.turret
      ? (this.turret as { localOrientation?: WRot }).localOrientation?.toString() ?? ''
      : ''
    const tOff = this.turret
      ? (this.turret as { offset?: WVec }).offset?.toString() ?? ''
      : ''
    // NOTE: Concatenation used instead of JSON.stringify for hot-path perf
    return `${cp}|${or}|${to}|${tOff}`
  }
}
