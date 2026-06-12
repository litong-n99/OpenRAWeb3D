/**
 * AttackMove.ts -- Attack-move command behavior
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AttackMove.cs (179 lines)
 *
 * 核心范式转换:
 * - C# AttackMove : IResolveOrder, IOrderVoice → TS interfaces
 * - C# AttackMoveOrderGenerator : UnitOrderGenerator → DEFERRED (TODO-8.D.DEFER-ORDERGEN)
 * - C# IMove → TS duck-typed access
 * - C# AttackMoveActivity → TS stub (full activity in Ch9)
 */

import type {
  IGameActor,
  IResolveOrder,
  IOrderVoice,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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
   *  OpenRA 对照: AttackMoveInfo.Voice
   */
  readonly voice: string = 'Action'

  /** Color for target line.
   *
   *  OpenRA 对照: AttackMoveInfo.TargetLineColor
   */
  readonly targetLineColor: string = 'OrangeRed'

  /** Condition granted while attack-move is active.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveCondition
   */
  readonly attackMoveCondition: string | null = null

  /** Condition granted while assault-move is active.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveCondition
   */
  readonly assaultMoveCondition: string | null = null

  /** Can the actor move into shroud?
   *
   *  OpenRA 对照: AttackMoveInfo.MoveIntoShroud
   */
  readonly moveIntoShroud: boolean = true

  /** Cursor for attack-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveCursor
   */
  readonly attackMoveCursor: string = 'attackmove'

  /** Cursor for blocked attack-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AttackMoveBlockedCursor
   */
  readonly attackMoveBlockedCursor: string = 'attackmove-blocked'

  /** Cursor for assault-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveCursor
   */
  readonly assaultMoveCursor: string = 'assaultmove'

  /** Cursor for blocked assault-move.
   *
   *  OpenRA 对照: AttackMoveInfo.AssaultMoveBlockedCursor
   */
  readonly assaultMoveBlockedCursor: string = 'assaultmove-blocked'

  constructor(params: {
    instanceName?: string
    voice?: string
    targetLineColor?: string
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
    this.targetLineColor = params.targetLineColor ?? 'OrangeRed'
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
// AttackMove
// OpenRA 对照: AttackMove (IResolveOrder, IOrderVoice)
// ---------------------------------------------------------------------------

/** Attack-move command: auto-engage targets while moving to destination.
 *
 *  OpenRA 对照: AttackMove
 *
 *  TODO-8.D.DEFER-ORDERGEN: AttackMoveOrderGenerator (UI order generator)
 *  depends on UnitOrderGenerator, MouseInput, Modifiers (Ch15/Ch16).
 */
export class AttackMove implements IResolveOrder, IOrderVoice {
  /** Configuration for this trait. */
  readonly info: AttackMoveInfo

  constructor(info: AttackMoveInfo) {
    this.info = info
  }

  /** Initialize after construction: find IMove trait.
   *
   *  OpenRA 对照: AttackMove constructor (finds IMove)
   */
  attach(_self: IGameActor): void {
    // Duck-typed IMove will be resolved later (Ch9 - Movement)
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // ---------------------------------------------------------------------------

  /** Get the voice phrase for attack-move/assault-move orders.
   *
   *  OpenRA 对照: IOrderVoice.VoicePhraseForOrder()
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (!this.info.moveIntoShroud && order.targetString) {
      // Shroud check deferred (duck-typed)
    }

    if (order.orderName === 'AttackMove' || order.orderName === 'AssaultMove') {
      return this.info.voice
    }

    return ''
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // ---------------------------------------------------------------------------

  /** Handle attack-move and assault-move orders.
   *
   *  OpenRA 对照: IResolveOrder.ResolveOrder()
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (
      order.orderName === 'AttackMove' ||
      order.orderName === 'AssaultMove'
    ) {
      if (!order.targetString) return

      // Validate target
      // Duck-typed target validation

      if (!this.info.moveIntoShroud) {
        // Shroud check deferred
      }

      // Queue attack-move activity
      // TODO-8.D.DEFER-MOVE: AttackMoveActivity requires IMove.MoveTo()
      // which is not yet integrated (deferred to Ch9).
      const selfAny = self as unknown as {
        queueActivity?: (activity: unknown) => void
      }

      // Stub: create a simple activity marker
      selfAny.queueActivity?.({
        tick: () => true,
        cancel: () => {},
        queue: () => {},
        onActorDisposeOuter: () => {},
      })
    }
  }
}
