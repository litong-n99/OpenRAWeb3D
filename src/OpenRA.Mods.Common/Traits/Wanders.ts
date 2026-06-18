/**
 * Wanders.ts — 空闲时随机漫游的 AI 行为特质
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Wanders.cs (118 lines)
 *
 * 核心范式转换:
 * - C# WandersInfo : ConditionalTraitInfo, Requires<IMoveInfo> → TS
 *   WandersInfo with ConditionalTraitInfo
 * - C# Wanders : ConditionalTrait<WandersInfo>, INotifyIdle, INotifyBecomingIdle
 *   → TS Wanders extends ConditionalTrait, implements INotifyIdle, INotifyBecomingIdle
 * - C# shared random → TS getSharedRandomNext helper
 * - C# WVec.Rotate(WRot.FromFacing) → TS WVec.rotate(WRot.fromFacing)
 * - C# protected virtual methods → TS protected methods (overridable)
 *
 * Wanders provides autonomous patrol behavior: when idle, the actor picks
 * a random cell within wanderMoveRadius and moves there. Subclasses like
 * Sandworm and AttackWander override DoAction for custom movement behavior.
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyIdle,
  type INotifyBecomingIdle,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// WandersInfo
// OpenRA 对照: WandersInfo : ConditionalTraitInfo, Requires<IMoveInfo>
// ---------------------------------------------------------------------------

/** Configuration for the Wanders trait.
 *
 * OpenRA 对照: WandersInfo (public class)
 */
export class WandersInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Wander movement radius in cells.
   *
   * OpenRA 对照: WandersInfo.WanderMoveRadius (default 1)
   */
  readonly wanderMoveRadius: number

  /** Ticks to wait before reducing effective move radius.
   *
   * OpenRA 对照: WandersInfo.ReduceMoveRadiusDelay (default 5)
   */
  readonly reduceMoveRadiusDelay: number

  /** Minimum ticks before starting to wander.
   *
   * OpenRA 对照: WandersInfo.MinMoveDelay (default 0)
   */
  readonly minMoveDelay: number

  /** Maximum ticks before starting to wander.
   *
   * OpenRA 对照: WandersInfo.MaxMoveDelay (default 0)
   */
  readonly maxMoveDelay: number

  /** Terrain types to avoid wandering on.
   *
   * OpenRA 对照: WandersInfo.AvoidTerrainTypes
   */
  readonly avoidTerrainTypes: readonly string[]

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    wanderMoveRadius?: number
    reduceMoveRadiusDelay?: number
    minMoveDelay?: number
    maxMoveDelay?: number
    avoidTerrainTypes?: string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.wanderMoveRadius = params.wanderMoveRadius ?? 1
    this.reduceMoveRadiusDelay = params.reduceMoveRadiusDelay ?? 5
    this.minMoveDelay = params.minMoveDelay ?? 0
    this.maxMoveDelay = params.maxMoveDelay ?? 0
    this.avoidTerrainTypes = params.avoidTerrainTypes ?? []
  }
}

// ---------------------------------------------------------------------------
// Wanders
// OpenRA 对照: Wanders : ConditionalTrait<WandersInfo>, INotifyIdle, INotifyBecomingIdle
// ---------------------------------------------------------------------------

/** Wanders around aimlessly while idle.
 *
 * OpenRA 对照: Wanders (public class)
 *
 * When the actor has no other activity, it picks random cells within
 * wanderMoveRadius and moves to them. Subclasses can override DoAction()
 * to customize movement behavior (e.g., Sandworm noise-seeking,
 * AttackWander attack-moving).
 *
 * Key overridable methods:
 * - onBecomingIdle: reset wander countdown
 * - tickIdle: decrement countdown, pick target, call doAction
 * - pickTargetLocation: choose random cell within move radius
 * - doAction: execute the movement to target cell
 */
export class Wanders
  extends ConditionalTrait<WandersInfo>
  implements INotifyIdle, INotifyBecomingIdle
{
  /** Cached reference to IMove trait for movement operations. */
  protected readonly move: MoveStub

  // Wander state fields
  /** Current countdown until next wander action.
   *
   * OpenRA 对照: Wanders.countdown
   */
  private _countdown: number

  /** Ticks idle counter.
   *
   * OpenRA 对照: Wanders.ticksIdle
   */
  private _ticksIdle: number = 0

  /** Current effective move radius (reduced when stuck).
   *
   * OpenRA 对照: Wanders.effectiveMoveRadius
   */
  private _effectiveMoveRadius: number

  /** The owning actor (cached for world access). */
  protected readonly self: IGameActor

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: Wanders(Actor self, WandersInfo info) : base(info)
  // ---------------------------------------------------------------------------

  /** Create a new Wanders trait.
   *
   * OpenRA 对照: Wanders(Actor self, WandersInfo info)
   *
   * @param self — the actor that owns this trait
   * @param info — trait configuration
   */
  constructor(self: IGameActor, info: WandersInfo) {
    super(info)
    this.self = self
    this._effectiveMoveRadius = info.wanderMoveRadius
    this._countdown = this.getSharedRandomNext(
      info.minMoveDelay,
      info.maxMoveDelay,
    )
    this.move = this.resolveMove(self)
  }

  // ---------------------------------------------------------------------------
  // INotifyBecomingIdle.OnBecomingIdle
  // OpenRA 对照: INotifyBecomingIdle.OnBecomingIdle(Actor)
  // ---------------------------------------------------------------------------

  /** Reset wander countdown when actor becomes idle.
   *
   * OpenRA 对照: Wanders.OnBecomingIdle(Actor)
   *
   * @param self — the actor
   */
  onBecomingIdle(self: IGameActor): void {
    // NOTE: OpenRA uses protected virtual OnBecomingIdle + interface
    // implementation. We combine them here since TS interfaces can't
    // call protected methods.
    this._countdown = this.getSharedRandomNext(
      this.info.minMoveDelay,
      this.info.maxMoveDelay,
    )
    void self // used by subclass overrides via this.self
  }

  // ---------------------------------------------------------------------------
  // INotifyIdle.TickIdle
  // OpenRA 对照: INotifyIdle.TickIdle(Actor)
  // ---------------------------------------------------------------------------

  /** Tick during idle: decrement countdown, pick target, execute action.
   *
   * OpenRA 对照: Wanders.TickIdle(Actor)
   *
   * @param self — the actor
   */
  tickIdle(self: IGameActor): void {
    if (this.isTraitDisabled) return

    if (--this._countdown > 0) return

    const targetCell = this.pickTargetLocation(self)
    if (targetCell !== null) {
      this.doAction(self, targetCell)
    }
  }

  // ---------------------------------------------------------------------------
  // PickTargetLocation
  // OpenRA 对照: Wanders.PickTargetLocation(Actor) → CPos?
  // ---------------------------------------------------------------------------

  /** Pick a random target cell within the wander move radius.
   *
   * OpenRA 对照: Wanders.PickTargetLocation(Actor)
   *
   * Selects a cell at the wander move radius distance in a random
   * direction. Handles map bounds and avoid-terrain-type checks.
   * Reduces effective move radius on repeated failures.
   *
   * @param self — the actor
   * @returns target cell, or null if no valid cell found
   */
  protected pickTargetLocation(self: IGameActor): CPos | null {
    const centerPos = this.getCenterPosition(self)
    const offset = new WVec(0, -1024 * this._effectiveMoveRadius, 0)
    // Rotate offset by random facing angle
    // OpenRA: WRot.FromFacing(self.World.SharedRandom.Next(255))
    const randomFacing = this.getSharedRandomNext(0, 256)
    const rotatedOffset = offset.rotate(WRot.fromFacing(randomFacing))
    const target = WVec.add(centerPos, rotatedOffset)

    const map = this.getWorldMap()
    if (!map) return null

    const targetCell = map.cellContaining(target)
    if (!map.contains(targetCell)) {
      // If MoveRadius is too big there might not be a valid cell
      if (++this._ticksIdle % this.info.reduceMoveRadiusDelay === 0) {
        this._effectiveMoveRadius--
      }
      return null
    }

    if (this.info.avoidTerrainTypes.length > 0) {
      const terrainType = map.getTerrainInfo(targetCell)?.type
      if (terrainType && this.info.avoidTerrainTypes.includes(terrainType)) {
        return null
      }
    }

    this._ticksIdle = 0
    this._effectiveMoveRadius = this.info.wanderMoveRadius

    return targetCell
  }

  // ---------------------------------------------------------------------------
  // DoAction
  // OpenRA 对照: Wanders.DoAction(Actor, CPos) [virtual]
  // ---------------------------------------------------------------------------

  /** Execute the wander action: move to the target cell.
   *
   * OpenRA 对照: Wanders.DoAction(Actor self, CPos targetCell) [virtual]
   *
   * Default implementation queues a MoveTo activity. Subclasses can
   * override this for custom behavior (e.g., Sandworm noise-seeking,
   * AttackWander attack-moving).
   *
   * @param self — the actor
   * @param targetCell — the cell to move to
   */
  protected doAction(self: IGameActor, targetCell: CPos): void {
    this.queueActivity(self, this.move.moveTo(targetCell, 1))
  }

  // ---------------------------------------------------------------------------
  // Duck-typing helpers
  // ---------------------------------------------------------------------------

  /** Get the actor's center position. */
  protected getCenterPosition(self: IGameActor): WVec {
    const a = self as unknown as { centerPosition?: WVec }
    return a.centerPosition ?? WVec.Zero
  }

  /** Get the world map (duck-typed). */
  protected getWorldMap(): WorldMapStub | null {
    const world = this.self.world as Record<string, unknown> | undefined
    const map = world?.map as WorldMapStub | undefined
    return map ?? null
  }

  /** Get a random int in [min, max) from shared random. */
  protected getSharedRandomNext(min: number, max: number): number {
    const world = this.self.world as Record<string, unknown> | undefined
    const sr = world?.sharedRandom as
      | { next?: (min: number, max: number) => number }
      | undefined
    if (sr?.next) {
      return sr.next(min, max)
    }
    return min + Math.floor(Math.random() * (max - min))
  }

  /** Resolve the IMove trait (Mobile) from the actor. */
  private resolveMove(self: IGameActor): MoveStub {
    const selfAny = self as unknown as {
      trait?: <T>(name: string) => T | undefined
    }
    if (typeof selfAny.trait === 'function') {
      const m = selfAny.trait<MoveStub>('Mobile')
      if (m) return m
    }
    return defaultMoveStub
  }

  /** Queue an activity on the actor. */
  protected queueActivity(self: IGameActor, activity: unknown, queued?: boolean): void {
    const fn = (self as unknown as {
      queueActivity?: (activity: unknown, queued?: boolean) => void
    }).queueActivity
    fn?.(activity, queued)
  }
}

// ---------------------------------------------------------------------------
// Stub interfaces for duck-typing
// ---------------------------------------------------------------------------

/** Stub interface for the world map. */
interface WorldMapStub {
  contains(cell: CPos): boolean
  cellContaining(pos: WVec): CPos
  getTerrainInfo(cell: CPos): { type: string } | null
}

/** Stub interface for IMove/Mobile trait. */
interface MoveStub {
  moveTo(cell: CPos, nearEnough: number): unknown
  moveWithinRange?(target: unknown, range: unknown): unknown
  canEnterCell?(cell: CPos, actor: unknown, blockedByActor: number): boolean
}

const defaultMoveStub: MoveStub = {
  moveTo: () => null,
}
