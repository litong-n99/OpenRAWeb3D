/**
 * EntersTunnels.ts -- Tunnel entry order handling trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/EntersTunnels.cs
 *
 * 核心范式转换:
 * - C# EnterTunnelOrderTargeter : UnitOrderTargeter → TypeScript class
 *   implementing IOrderTargeter directly (UnitOrderTargeter not yet migrated)
 * - C# IMove.MoveTo(CPos, int, Actor?, bool, Color?) → stub activity
 *   (full MoveActivity deferred to Ch14)
 * - C# IObservesVariables → TypeScript IObservesVariables with VariableObserver
 * - C# BooleanExpression.Evaluate → inline condition evaluation
 * - C# ShowTargetLines() → no-op (3D rendering is declarative)
 * - C# ShroudObscures check → deferred to Ch12
 *
 * NOTE: Tunnel entry activities are stubs. Full movement activities
 * through tunnels will be implemented in Ch14 (Activity Implementation).
 */

import type {
  IGameActor,
  IIssueOrder,
  IResolveOrder,
  IOrderVoice,
  IOrderTargeter,
  IObservesVariables,
  VariableObserver,
  VariableObserverNotifier,
  Order,
  TargetStub,
  ColorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { TargetModifiers, TargetModifiersExts } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { CPos } from '../../OpenRA.Game/CPos'
import { TunnelEntrance } from './TunnelEntrance'

// ---------------------------------------------------------------------------
// EntersTunnelsInfo -- Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the EntersTunnels trait.
 *
 * OpenRA 对照: EntersTunnelsInfo : TraitInfo, Requires<IMoveInfo>,
 *   IObservesVariablesInfo
 *
 * Attached to actors that can interact with TunnelEntrances to move
 * through TerrainTunnels.
 */
export class EntersTunnelsInfo {
  /** Cursor to display when able to enter target tunnel.
   *
   * OpenRA 对照: EntersTunnelsInfo.EnterCursor
   */
  readonly enterCursor: string

  /** Cursor to display when unable to enter target tunnel.
   *
   * OpenRA 对照: EntersTunnelsInfo.EnterBlockedCursor
   */
  readonly enterBlockedCursor: string

  /** Voice phrase to play when tunnel entry order is given.
   *
   * OpenRA 对照: EntersTunnelsInfo.Voice
   */
  readonly voice: string

  /** Color to use for the target line while in tunnels.
   *
   * OpenRA 对照: EntersTunnelsInfo.TargetLineColor
   */
  readonly targetLineColor: ColorStub

  /** Boolean expression defining the condition under which the regular
   * (non-force) enter cursor is disabled.
   *
   * OpenRA 对照: EntersTunnelsInfo.RequireForceMoveCondition
   */
  readonly requireForceMoveCondition: string | null

  constructor(params: {
    enterCursor?: string
    enterBlockedCursor?: string
    voice?: string
    targetLineColor?: ColorStub
    requireForceMoveCondition?: string | null
  } = {}) {
    this.enterCursor = params.enterCursor ?? 'enter'
    this.enterBlockedCursor = params.enterBlockedCursor ?? 'enter-blocked'
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? { r: 0, g: 1, b: 0, a: 1 }
    this.requireForceMoveCondition = params.requireForceMoveCondition ?? null
  }
}

// ---------------------------------------------------------------------------
// EnterTunnelOrderTargeter -- Inner class for tunnel entry orders
// ---------------------------------------------------------------------------

/**
 * Order targeter for "EnterTunnel" orders.
 *
 * OpenRA 对照: EntersTunnels.EnterTunnelOrderTargeter : UnitOrderTargeter
 *
 * When the player clicks a TunnelEntrance with a unit that has the
 * EntersTunnels trait, this targeter determines whether the tunnel
 * entry is valid and provides the appropriate cursor.
 *
 * NOTE: Extends IOrderTargeter directly since UnitOrderTargeter
 * is not yet migrated.
 */
export class EnterTunnelOrderTargeter implements IOrderTargeter {
  readonly orderID: string = 'EnterTunnel'
  readonly orderPriority: number = 6

  private readonly _enterCursor: string
  private readonly _enterBlockedCursor: string
  private readonly _canTarget: (target: IGameActor, modifiers: TargetModifiers) => boolean
  private readonly _useEnterCursor: (target: IGameActor) => boolean
  private _isQueued: boolean = false

  constructor(
    enterCursor: string,
    enterBlockedCursor: string,
    canTarget: (target: IGameActor, modifiers: TargetModifiers) => boolean,
    useEnterCursor: (target: IGameActor) => boolean,
  ) {
    this._enterCursor = enterCursor
    this._enterBlockedCursor = enterBlockedCursor
    this._canTarget = canTarget
    this._useEnterCursor = useEnterCursor
  }

  get isQueued(): boolean {
    return this._isQueued
  }

  targetOverridesSelection(
    _actor: IGameActor,
    target: TargetStub,
    _actorsAt: readonly IGameActor[],
    _xy: CPos,
    modifiers: TargetModifiers,
  ): boolean {
    // Always prioritise tunnel entry orders over selecting other units
    if (TargetModifiersExts.hasModifier(modifiers, TargetModifiers.ForceMove)) {
      return true
    }

    // Check if target is a valid tunnel entrance
    const targetActor = (target as unknown as Record<string, unknown>)['actor'] as IGameActor | undefined
    if (targetActor && !targetActor.isDead) {
      const tunnel = this._getTunnelEntrance(targetActor)
      if (tunnel !== null && tunnel.exit !== null) {
        return true
      }
    }

    return false
  }

  canTarget(
    _actor: IGameActor,
    target: TargetStub,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    this._isQueued = TargetModifiersExts.hasModifier(modifiers, TargetModifiers.ForceQueue)

    const targetActor = (target as unknown as Record<string, unknown>)['actor'] as IGameActor | undefined
    if (!targetActor || targetActor.isDead) return false

    return this.canTargetActor(_actor, targetActor, modifiers, '' as unknown as { ref: string })
  }

  /**
   * Check if the target actor is a valid tunnel entrance.
   *
   * OpenRA 对照: EnterTunnelOrderTargeter.CanTargetActor()
   *
   * Validates:
   * 1. Target is not null and not dead
   * 2. Target has a TunnelEntrance trait
   * 3. Target's tunnel entrance has a valid exit
   * 4. Force-move condition is satisfied (if required)
   *
   * @param _self -- the actor issuing the order
   * @param target -- the target actor
   * @param modifiers -- targeting modifiers (ForceMove, ForceQueue)
   * @param cursorRef -- mutable cursor string (hack: object with ref property)
   * @returns true if the target is a valid tunnel entrance
   */
  canTargetActor(
    _self: IGameActor,
    target: IGameActor,
    modifiers: TargetModifiers,
    cursorRef: { ref: string },
  ): boolean {
    if (!target || target.isDead || !this._canTarget(target, modifiers)) {
      return false
    }

    const tunnel = this._getTunnelEntrance(target)
    if (tunnel === null) return false

    // HACK: The engine does not support HiddenUnderFog combined with buildings
    // that use the "_" footprint. We therefore have to use AlwaysVisible and
    // then force-disable interacting with the entrance under shroud.
    // TODO-12.A.1: Implement ShroudObscures check when fog-of-war is migrated.
    // const buildingInfo = target.info?.TraitInfoOrDefault<BuildingInfo>();
    // if (buildingInfo != null) {
    //   const footprint = buildingInfo.PathableTiles(target.Location);
    //   if (footprint.All(self.World.ShroudObscures)) return false;
    // }

    if (tunnel.exit === null) {
      cursorRef.ref = this._enterBlockedCursor
      return false
    }

    cursorRef.ref = this._useEnterCursor(target) ? this._enterCursor : this._enterBlockedCursor
    return true
  }

  /**
   * Check if a frozen actor (fog-of-war ghost) is a valid tunnel entrance.
   *
   * OpenRA 对照: EnterTunnelOrderTargeter.CanTargetFrozenActor()
   *
   * NOTE: Delegates to CanTargetActor using the real actor behind the frozen
   * actor. FrozenActor system is deferred to Ch12.
   */
  canTargetFrozenActor(
    self: IGameActor,
    frozenTarget: IGameActor,
    modifiers: TargetModifiers,
    cursorRef: { ref: string },
  ): boolean {
    // When FrozenActor is fully migrated, this would resolve the real actor
    // and call CanTargetActor. For now, treat frozen actors as invalid for
    // tunnel entry unless they resolve to a valid target.
    return this.canTargetActor(self, frozenTarget, modifiers, cursorRef)
  }

  /**
   * Extract the TunnelEntrance trait from an actor if present.
   *
   * @param actor -- the actor to check
   * @returns the TunnelEntrance trait, or null if not present
   */
  private _getTunnelEntrance(actor: IGameActor): TunnelEntrance | null {
    // HACK: Trait lookup via generic trait accessor pattern.
    // This mirrors C# `target.TraitOrDefault<TunnelEntrance>()`.
    const traits = (actor as unknown as Record<string, unknown>)['_traits'] as
      Map<string, unknown[]> | undefined
    const tunnelTraits = traits?.get('TunnelEntrance')
    if (tunnelTraits && tunnelTraits.length > 0) {
      return tunnelTraits[0] as TunnelEntrance
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// EntersTunnels -- Trait implementation
// ---------------------------------------------------------------------------

/**
 * Trait that allows an actor to enter terrain tunnels via TunnelEntrance
 * structures.
 *
 * OpenRA 对照: EntersTunnels : IIssueOrder, IResolveOrder, IOrderVoice,
 *   IObservesVariables
 *
 * When the player clicks a TunnelEntrance with an actor that has this trait,
 * the actor queues movement activities through the tunnel: first to the
 * entrance staging point, then to the exit staging point.
 */
export class EntersTunnels implements IIssueOrder, IResolveOrder, IOrderVoice, IObservesVariables {
  /** Configuration info. */
  readonly info: EntersTunnelsInfo

  /** Whether force-move is required (evaluated from condition). */
  private _requireForceMove: boolean = false

  constructor(info: EntersTunnelsInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // IIssueOrder
  // ---------------------------------------------------------------------------

  /**
   * The set of order targeters this trait provides.
   *
   * OpenRA 对照: EntersTunnels.Orders
   */
  get orders(): readonly IOrderTargeter[] {
    return [
      new EnterTunnelOrderTargeter(
        this.info.enterCursor,
        this.info.enterBlockedCursor,
        this._canEnterTunnel.bind(this),
        () => true, // Always use enter cursor when targeting
      ),
    ]
  }

  /**
   * Issue an EnterTunnel order.
   *
   * OpenRA 对照: EntersTunnels.IssueOrder()
   *
   * @param self -- the actor issuing the order
   * @param order -- the order targeter
   * @param target -- the target of the order
   * @param queued -- whether this is a queued order
   * @returns the Order, or null if not applicable
   */
  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    target: TargetStub,
    queued: boolean,
  ): Order {
    if (order.orderID !== 'EnterTunnel') {
      return null as unknown as Order
    }

    const targetActor = (target as unknown as Record<string, unknown>)['actor'] as IGameActor | undefined
    return {
      orderName: 'EnterTunnel',
      targetString: targetActor ? `actor:${targetActor.actorId}` : '',
      extraData: { target, queued, suppressVisualFeedback: true },
    } as unknown as Order
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // ---------------------------------------------------------------------------

  /**
   * Resolve an EnterTunnel order by queuing movement activities.
   *
   * OpenRA 对照: EntersTunnels.ResolveOrder()
   *
   * Queues two movement activities:
   * 1. Move to the entrance rally point
   * 2. Move to the exit rally point
   *
   * @param self -- the actor resolving the order
   * @param order -- the order to resolve
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName !== 'EnterTunnel') return

    const extra = order.extraData as Record<string, unknown> | undefined
    const target = extra?.['target'] as Record<string, unknown> | undefined
    const targetType = (target as Record<string, unknown>)?.['type'] as number | undefined

    // C# checks order.Target.Type != TargetType.Actor → return
    // TargetType.Actor = 1
    if (targetType !== 1) return

    const targetActor = (target as Record<string, unknown>)?.['actor'] as IGameActor | undefined
    if (!targetActor) return

    const tunnel = this._getTunnelEntrance(targetActor)
    if (tunnel === null || tunnel.exit === null) return

    const queued = (extra?.['queued'] as boolean) ?? false

    // HACK: Resolve IMove from self. In C#: self.Trait<IMove>().
    const move = this._resolveIMove(self)

    if (move) {
      // Queue move to entrance, then move to exit
      const nearEnough = tunnel.nearEnough
      const entranceCell = tunnel.entrance
      const exitCell = tunnel.exit

      // NOTE: C# uses move.MoveTo(CPos, int, targetLineColor: Color?) for entrance
      // and move.MoveTo(CPos, int, targetLineColor: Color?) for exit with different
      // colors. The first uses IMoveInfo.GetTargetLineColor(), the second uses
      // EntersTunnelsInfo.TargetLineColor.
      if (self.queueActivity) {
        // Activity 1: Move to entrance staging point
        // TODO-14.A: Replace stub with real MoveActivity
        const moveInfo = this._resolveMoveInfo(self)
        const entranceColor = typeof moveInfo?.getTargetLineColor === 'function'
          ? (moveInfo.getTargetLineColor as () => ColorStub)()
          : this.info.targetLineColor

        self.queueActivity(
          this._createMoveActivity(move, entranceCell, nearEnough, entranceColor),
        )

        // Activity 2: Move to exit staging point (through the tunnel)
        if (queued) {
          // HACK: Activity queueing — in C# this would use QueueActivity(queued, ...)
          self.queueActivity(
            this._createMoveActivity(move, exitCell, nearEnough, this.info.targetLineColor),
          )
        } else {
          self.queueActivity(
            this._createMoveActivity(move, exitCell, nearEnough, this.info.targetLineColor),
          )
        }

        // Show target lines (no-op in 3D rendering system)
        // NOTE: self.ShowTargetLines() is a visual 2D thing; in Babylon.js
        // target lines are part of the render pipeline.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IOrderVoice
  // ---------------------------------------------------------------------------

  /**
   * Get the voice phrase for a tunnel entry order.
   *
   * OpenRA 对照: EntersTunnels.VoicePhraseForOrder()
   *
   * @param _self -- the actor
   * @param order -- the order
   * @returns the voice phrase string, or empty string if not applicable
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (order.orderName === 'EnterTunnel') {
      return this.info.voice
    }
    return ''
  }

  // ---------------------------------------------------------------------------
  // IObservesVariables
  // ---------------------------------------------------------------------------

  /**
   * Register variable observers for condition-based behavior.
   *
   * OpenRA 对照: EntersTunnels.GetVariableObservers()
   *
   * Observes the requireForceMoveCondition expression.
   */
  getVariableObservers(): readonly VariableObserver[] {
    const observers: VariableObserver[] = []

    if (this.info.requireForceMoveCondition) {
      const notifier: VariableObserverNotifier = (
        _actor: IGameActor,
        conditions: ReadonlyMap<string, number>,
      ) => {
        this._requireForceMove = this._evaluateCondition(
          this.info.requireForceMoveCondition!,
          conditions,
        )
      }
      observers.push({
        notifier,
        variables: this._extractVariables(this.info.requireForceMoveCondition),
      })
    }

    return observers
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if this actor can enter a tunnel at the given target.
   *
   * OpenRA 对照: EntersTunnels.CanEnterTunnel()
   *
   * When requireForceMove is active, the ForceMove modifier must be pressed.
   *
   * @param _target -- the tunnel entrance actor
   * @param modifiers -- targeting modifiers
   * @returns true if the tunnel can be entered
   */
  private _canEnterTunnel(
    _target: IGameActor,
    modifiers: TargetModifiers,
  ): boolean {
    return !this._requireForceMove ||
      TargetModifiersExts.hasModifier(modifiers, TargetModifiers.ForceMove)
  }

  /**
   * Extract the TunnelEntrance trait from an actor.
   */
  private _getTunnelEntrance(actor: IGameActor): TunnelEntrance | null {
    const traits = (actor as unknown as Record<string, unknown>)['_traits'] as
      Map<string, unknown[]> | undefined
    const tunnelTraits = traits?.get('TunnelEntrance')
    if (tunnelTraits && tunnelTraits.length > 0) {
      return tunnelTraits[0] as TunnelEntrance
    }
    return null
  }

  /**
   * Resolve the IMove trait from an actor.
   */
  private _resolveIMove(self: IGameActor): Record<string, unknown> | null {
    const traits = (self as unknown as Record<string, unknown>)['_traits'] as
      Map<string, unknown[]> | undefined
    const moveTraits = traits?.get('IMove')
    if (moveTraits && moveTraits.length > 0) {
      return moveTraits[0] as Record<string, unknown>
    }
    return null
  }

  /**
   * Resolve the IMoveInfo trait info from an actor.
   */
  private _resolveMoveInfo(self: IGameActor): Record<string, unknown> | null {
    const info = (self as unknown as Record<string, unknown>)['info'] as
      Record<string, unknown> | undefined
    const traitInfos = info?.['traitInfos'] as Record<string, unknown>[] | undefined
    if (traitInfos) {
      for (const ti of traitInfos) {
        if (ti && typeof ti['getTargetLineColor'] === 'function') {
          return ti
        }
      }
    }
    return null
  }

  /**
   * Create a stub move activity for tunnel movement.
   *
   * TODO-14.A: Replace with real MoveActivity when Ch14 is implemented.
   *
   * @param move -- the IMove trait
   * @param cell -- the destination cell
   * @param nearEnough -- minimum approach distance
   * @param _color -- target line color (unused in stubs)
   * @returns a simple stub activity object
   */
  private _createMoveActivity(
    move: Record<string, unknown>,
    cell: CPos,
    nearEnough: number,
    _color: ColorStub,
  ): { tick: () => boolean; cancel: () => void; queue: (a: unknown) => void; onActorDisposeOuter: () => void } {
    // Try to call move.moveToCell if available
    if (typeof move['moveToCell'] === 'function') {
      return (move['moveToCell'] as (c: CPos, n: number) => unknown)(cell, nearEnough) as {
        tick: () => boolean; cancel: () => void; queue: (a: unknown) => void; onActorDisposeOuter: () => void
      }
    }

    // Fallback stub
    return {
      tick: () => true,
      cancel: () => { /* no-op */ },
      queue: () => { /* no-op */ },
      onActorDisposeOuter: () => { /* no-op */ },
    }
  }

  /**
   * Evaluate a BooleanExpression string against a variable map.
   *
   * OpenRA 对照: BooleanExpression.Evaluate()
   *
   * Supports: variable names, ! (NOT), && (AND), || (OR).
   *
   * @param expr -- the condition expression string
   * @param conditions -- map of variable name to token count
   * @returns the boolean result of evaluation
   */
  private _evaluateCondition(
    expr: string,
    conditions: ReadonlyMap<string, number>,
  ): boolean {
    // Simple negation: !variable
    if (expr.startsWith('!')) {
      const varName = expr.slice(1).trim()
      return !conditions.has(varName) || (conditions.get(varName) ?? 0) <= 0
    }

    // AND: a && b
    const andParts = expr.split(/\s*&&\s*/)
    if (andParts.length > 1) {
      return andParts.every((part) =>
        this._evaluateCondition(part.trim(), conditions),
      )
    }

    // OR: a || b
    const orParts = expr.split(/\s*\|\|\s*/)
    if (orParts.length > 1) {
      return orParts.some((part) =>
        this._evaluateCondition(part.trim(), conditions),
      )
    }

    // Simple variable: must exist and be > 0
    return conditions.has(expr) && (conditions.get(expr) ?? 0) > 0
  }

  /**
   * Extract variable names from a BooleanExpression string.
   *
   * OpenRA 对照: BooleanExpression.Variables
   *
   * @param expr -- the condition expression string
   * @returns array of unique variable names
   */
  private _extractVariables(expr: string): readonly string[] {
    const cleaned = expr.replace(/\s+/g, '')
    if (!cleaned) return []

    const orSegments = cleaned.split('||')
    const andSegments = orSegments.flatMap((s) => s.split('&&'))

    const vars = new Set<string>()
    for (const seg of andSegments) {
      const name = seg.startsWith('!') ? seg.slice(1) : seg
      if (name) vars.add(name)
    }

    return Array.from(vars)
  }
}
