/**
 * AttackMove.ts -- Attack-move command: auto-engage targets while moving
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AttackMove.cs (179 lines)
 *
 * 核心范式转换:
 * - C# AttackMove : IResolveOrder, IOrderVoice → TS implements same interfaces
 * - C# AttackMoveOrderGenerator : UnitOrderGenerator → DEFERRED (TODO-9.D.DEFER-ORDERGEN)
 * - C# IFacing resolved from self → TS duck-typed access
 * - C# AttackMoveActivity → TS stub activity (full Ch14)
 * - C# Shroud.Explored / CTF → TS duck-typed (full Ch12)
 */

import type {
  IGameActor,
  IResolveOrder,
  IOrderVoice,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order, ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// AttackMoveInfo
// OpenRA 对照: AttackMoveInfo (TraitInfo, Requires<IMoveInfo>)
// ---------------------------------------------------------------------------

/** Configuration for AttackMove.
 *
 *  OpenRA 对照: AttackMoveInfo
 */
export class AttackMoveInfo {
  readonly instanceName?: string

  /** Voice phrase for attack-move orders.
   *
   *  OpenRA 对照: AttackMoveInfo.Voice (default "Action")
   */
  readonly voice: string

  /** Color for target line.
   *
   *  OpenRA 对照: AttackMoveInfo.TargetLineColor (default Color.OrangeRed)
   */
  readonly targetLineColor: ColorStub

  /** Condition granted while attack-move is active.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveCondition
   */
  readonly attackMoveCondition: string | null

  /** Condition granted while assault-move is active.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveCondition
   */
  readonly assaultMoveCondition: string | null

  /** Can the actor be ordered to move into shroud?
   *
   *  OpenRA 对照: AttackMoveInfo.MoveIntoShroud (default true)
   */
  readonly moveIntoShroud: boolean

  /** Cursor for attack-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveCursor (default "attackmove")
   */
  readonly attackMoveCursor: string

  /** Cursor for blocked attack-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveBlockedCursor (default "attackmove-blocked")
   */
  readonly attackMoveBlockedCursor: string

  /** Cursor for assault-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveCursor (default "assaultmove")
   */
  readonly assaultMoveCursor: string

  /** Cursor for blocked assault-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveBlockedCursor (default "assaultmove-blocked")
   */
  readonly assaultMoveBlockedCursor: string

  constructor(params: {
    instanceName?: string
    voice?: string
    targetLineColor?: ColorStub
    attackMoveCondition?: string | null
    assaultMoveCondition?: string | null
    moveIntoShroud?: boolean
    attackMoveCursor?: string
    attackMoveBlockedCursor?: string
    assaultMoveCursor?: string
    assaultMoveBlockedCursor?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? { r: 1, g: 0.27, b: 0, a: 1 }
    this.attackMoveCondition = params.attackMoveCondition ?? null
    this.assaultMoveCondition = params.assaultMoveCondition ?? null
    this.moveIntoShroud = params.moveIntoShroud ?? true
    this.attackMoveCursor = params.attackMoveCursor ?? 'attackmove'
    this.attackMoveBlockedCursor = params.attackMoveBlockedCursor ?? 'attackmove-blocked'
    this.assaultMoveCursor = params.assaultMoveCursor ?? 'assaultmove'
    this.assaultMoveBlockedCursor = params.assaultMoveBlockedCursor ?? 'assaultmove-blocked'
  }
}

// ---------------------------------------------------------------------------
// AttackMoveActivity stub (deferred to Ch14)
// OpenRA 对照: OpenRA.Mods.Common/Activities/AttackMoveActivity.cs
// ---------------------------------------------------------------------------

/**
 * Stub activity for attack-move behavior.
 *
 * OpenRA 对照: AttackMoveActivity
 *
 * TODO-14.A: Full AttackMoveActivity deferred to Ch14 (Activity Implementations).
 * This stub provides the minimal interface for queueActivity().
 */
export class AttackMoveActivity {
  isInterruptible: boolean = true
  isCanceling: boolean = false

  constructor(
    _self: IGameActor,
    _moveFn: () => unknown,
    _assaultMoving: boolean,
  ) {
    // Store the move-to activity for later expansion (Ch14)
    // this._assaultMoving = assaultMoving — used in Ch14 for condition toggling
    void _self
    void _assaultMoving
    void _moveFn
  }

  tick(): boolean {
    // STUB: Immediately complete (Ch14 will implement scan-and-engage loop)
    return true
  }

  cancel(): void {
    this.isCanceling = true
  }

  queue(_activity: unknown): void {
    // STUB: no-op
  }

  onActorDisposeOuter(): void {
    // STUB: no-op
  }
}

// ---------------------------------------------------------------------------
// AttackMove
// OpenRA 对照: AttackMove (IResolveOrder, IOrderVoice)
// ---------------------------------------------------------------------------

/**
 * Attack-move command: auto-engage viable targets while moving to destination.
 *
 * OpenRA 对照: AttackMove
 *
 * Provides the attack-move (A-click) and assault-move (Ctrl+A-click) orders.
 * When an attack-move order is received, queues an AttackMoveActivity that
 * combines movement with automatic target scanning/engagement.
 *
 * TODO-9.D.DEFER-ORDERGEN: AttackMoveOrderGenerator (UI order generator)
 * depends on UnitOrderGenerator, MouseInput, Modifiers (Ch15/Ch16).
 */
export class AttackMove implements IResolveOrder, IOrderVoice {
  /** Configuration for this trait. */
  readonly info: AttackMoveInfo

  /**
   * @param info — trait configuration
   */
  constructor(info: AttackMoveInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // OpenRA 对照: IOrderVoice.VoicePhraseForOrder()
  // ---------------------------------------------------------------------------

  /**
   * Get the voice phrase for attack-move or assault-move orders.
   *
   * OpenRA 对照: AttackMove.IOrderVoice.VoicePhraseForOrder()
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (!this.info.moveIntoShroud && order.targetString) {
      // Check shroud visibility for the target cell
      const selfAny = _self as unknown as Record<string, unknown>
      const owner = selfAny['owner'] as Record<string, unknown> | undefined
      const shroud = owner?.['shroud'] as Record<string, unknown> | undefined
      const world = selfAny['world'] as Record<string, unknown> | undefined
      const map = world?.['map'] as Record<string, unknown> | undefined

      // NOTE: Shroud.Explored check requires player-specific fog-of-war state.
      // Duck-typed access — full Shroud integration deferred to Ch12.
      if (shroud && typeof shroud['isExplored'] === 'function') {
        // Extract cell from target (duck-typed)
        const orderAny = order as unknown as Record<string, unknown>
        const target = orderAny['target'] as Record<string, unknown> | undefined
        const centerPos = target?.['centerPosition'] as { x: number; y: number; z: number } | undefined

        if (centerPos && map && typeof map['cellContaining'] === 'function') {
          const cell = (map['cellContaining'] as (p: unknown) => unknown)(centerPos)
          if (!(shroud['isExplored'] as (c: unknown) => boolean)(cell)) {
            return ''
          }
        }
      }
    }

    if (order.orderName === 'AttackMove' || order.orderName === 'AssaultMove') {
      return this.info.voice
    }

    return ''
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: IResolveOrder.ResolveOrder()
  // ---------------------------------------------------------------------------

  /**
   * Handle attack-move and assault-move orders.
   *
   * OpenRA 对照: AttackMove.IResolveOrder.ResolveOrder()
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName !== 'AttackMove' && order.orderName !== 'AssaultMove') {
      return
    }

    const selfAny = self as unknown as Record<string, unknown>

    // Validate target
    const orderAny = order as unknown as Record<string, unknown>
    const target = orderAny['target'] as Record<string, unknown> | undefined
    if (!target) return

    // Check if target is valid
    if (typeof target['isValidFor'] === 'function') {
      if (!(target['isValidFor'] as (a: unknown) => boolean)(self)) return
    }

    // Resolve world, map, and shroud
    const world = selfAny['world'] as Record<string, unknown> | undefined
    const map = world?.['map'] as Record<string, unknown> | undefined
    const owner = selfAny['owner'] as Record<string, unknown> | undefined
    const shroud = owner?.['shroud'] as Record<string, unknown> | undefined

    // Get center position from target
    const centerPos = target?.['centerPosition'] as { x: number; y: number; z: number } | undefined
    if (!centerPos) return

    // Clamp cell to map boundary
    let cell: unknown
    if (map && typeof map['clamp'] === 'function' && typeof map['cellContaining'] === 'function') {
      cell = map['clamp'](map['cellContaining'](centerPos))
    } else {
      // Fallback cell from target position
      cell = centerPos
    }

    // Shroud check
    if (!this.info.moveIntoShroud && shroud && typeof shroud['isExplored'] === 'function') {
      if (!(shroud['isExplored'] as (c: unknown) => boolean)(cell)) return
    }

    // Resolve nearest moveable cell from IMove trait
    let targetLocation: unknown = cell
    const imove = selfAny['getIMove'] as unknown as
      | { nearestMoveableCell: (s: unknown, c: unknown) => unknown }
      | undefined
    if (imove) {
      targetLocation = imove.nearestMoveableCell(self, cell)
    }

    const assaultMoving = order.orderName === 'AssaultMove'

    // TODO-14.A: this should scale with unit selection group size
    // Queue attack-move activity
    if (self.queueActivity) {
      const moveFn = (): unknown => {
        // Duck-typed moveTo call on IMove trait
        const imoveRec = imove as Record<string, unknown> | undefined
        if (imoveRec && typeof imoveRec['moveTo'] === 'function') {
          // moveTo returns an Activity
          return imoveRec['moveTo'](self, targetLocation)
        }
        return null
      }

      const activity = new AttackMoveActivity(self, moveFn, assaultMoving)
      self.queueActivity(activity as unknown as { queue(a: unknown): void; cancel(a: unknown): void; onActorDisposeOuter(a: unknown): void })
    }

    // Show target lines (duck-typed)
    if (typeof selfAny['showTargetLines'] === 'function') {
      selfAny['showTargetLines']()
    }
  }
}

// ---------------------------------------------------------------------------
// AttackMoveOrderGenerator — DEFERRED
// OpenRA 对照: AttackMoveOrderGenerator : UnitOrderGenerator
// ---------------------------------------------------------------------------

/**
 * AttackMoveOrderGenerator is deferred until Ch15 (Order Generators).
 *
 * OpenRA 对照: AttackMoveOrderGenerator (93 lines)
 *
 * TODO-9.D.DEFER-ORDERGEN: Depends on UnitOrderGenerator (Ch15), MouseInput (Ch16),
 * Modifiers (Ch15), and selection API (Ch7 Phase C currently complete).
 *
 * The generator:
 * - Subclasses UnitOrderGenerator
 * - Tracks a collection of AttackMove trait pairs for selected actors
 * - Generates AttackMove or AssaultMove (Ctrl modifier) orders
 * - Clamps cells outside playable area to map edge
 * - Requires at least one selected unit to have AutoTarget trait
 * - Provides attackmove/assaultmove cursors
 * - Overrides InputOverridesSelection to always return true
 * - ClearSelectionOnLeftClick is false
 */
