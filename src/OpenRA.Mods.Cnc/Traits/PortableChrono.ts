/**
 * PortableChrono.ts — 步兵便携式超时空传送装置
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/PortableChrono.cs (286 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<PortableChronoInfo> → TS ConditionalTrait with pause state
 * - C# Requires<IMoveInfo> → TS import of IMove from TraitsInterfaces
 * - C# IIssueOrder / IResolveOrder → TS same interfaces
 * - C# IOrderTargeter + OrderGenerator → TS forward stubs
 * - C# PortableChronoOrderTargeter (nested) → TS exported class
 * - C# PortableChronoOrderGenerator (nested) → TS exported class
 * - C# DeployOrderTargeter → TS stub (deployed from Ch15 OrderGenerators)
 * - C# Game.Sound / IOrderVoice → TS stub
 * - C# RangeCircleAnnotationRenderable → TS forward stub
 * - C# UnitOrderGenerator base → TS forward stub
 *
 * NOTE: The PortableChronoOrderGenerator, DeployOrderTargeter, and
 * RangeCircleAnnotationRenderable are deferred to Phase C / Ch15.
 * Their logic is documented but the visual rendering is stubbed.
 *
 * NOTE: The Teleport activity is deferred to TODO-19.C.5.
 * MoveTo / MoveWithinRange activities are deferred to Ch9/Ch14.
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo as IConditionalTraitInfo,
  IGameActor,
  ITick,
  ISync,
  ISelectionBar,
  ITraitInfo,
  ColorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Forward stubs
// ---------------------------------------------------------------------------

interface OrderStub {
  readonly orderString: string
  readonly subjectId?: number
  readonly target?: unknown
  readonly queued?: boolean
  readonly extraData?: number
}

interface TargetStub {
  readonly centerPosition?: unknown
  readonly type?: number
  readonly cell?: CPos | null
}

interface IOrderTargeterStub {
  readonly orderID: string
  readonly orderPriority: number
  readonly isQueued: boolean
  canTarget(
    actor: IGameActor,
    target: TargetStub,
    modifiers: TargetModifiersStub,
    cursor: string,
  ): boolean
  targetOverridesSelection(actor: IGameActor, target: TargetStub, actorsAt: readonly IGameActor[], xy: CPos, modifiers: TargetModifiersStub): boolean
}

type TargetModifiersStub = number & { readonly __brand: 'TargetModifiers' }

const TargetModifiers = {
  None: 0 as TargetModifiersStub,
  ForceMove: 1 as TargetModifiersStub,
  ForceQueue: 8 as TargetModifiersStub,
} as const

// ---------------------------------------------------------------------------
// PortableChronoInfo
// OpenRA 对照: PortableChronoInfo : PausableConditionalTraitInfo, Requires<IMoveInfo>
// ---------------------------------------------------------------------------

/**
 * Configuration for the portable chronoshift device.
 *
 * OpenRA 对照: PortableChronoInfo
 */
export class PortableChronoInfo implements ITraitInfo, IConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Cooldown in ticks until the unit can teleport again.
   *
   * OpenRA 对照: PortableChronoInfo.ChargeDelay
   */
  readonly chargeDelay: number

  /** Whether the unit has a maximum teleport distance.
   *
   * OpenRA 对照: PortableChronoInfo.HasDistanceLimit
   */
  readonly hasDistanceLimit: boolean

  /** Maximum distance in cells (only used if HasDistanceLimit = true).
   *
   * OpenRA 对照: PortableChronoInfo.MaxDistance
   */
  readonly maxDistance: number

  /** Sound played when teleporting.
   *
   * OpenRA 对照: PortableChronoInfo.ChronoshiftSound
   */
  readonly chronoshiftSound: string

  /** Cursor to display when able to deploy the actor.
   *
   * OpenRA 对照: PortableChronoInfo.DeployCursor
   */
  readonly deployCursor: string

  /** Cursor to display when unable to deploy.
   *
   * OpenRA 对照: PortableChronoInfo.DeployBlockedCursor
   */
  readonly deployBlockedCursor: string

  /** Cursor to display when targeting a teleport location.
   *
   * OpenRA 对照: PortableChronoInfo.TargetCursor
   */
  readonly targetCursor: string

  /** Cursor to display when the targeted location is blocked.
   *
   * OpenRA 对照: PortableChronoInfo.TargetBlockedCursor
   */
  readonly targetBlockedCursor: string

  /** Whether to kill cargo on teleporting.
   *
   * OpenRA 对照: PortableChronoInfo.KillCargo
   */
  readonly killCargo: boolean

  /** Whether to flash the screen on teleporting.
   *
   * OpenRA 对照: PortableChronoInfo.FlashScreen
   */
  readonly flashScreen: boolean

  /** Voice to play when issuing the order.
   *
   * OpenRA 对照: PortableChronoInfo.Voice
   */
  readonly voice: string

  /** Range circle color.
   *
   * OpenRA 对照: PortableChronoInfo.CircleColor
   */
  readonly circleColor: ColorStub

  /** Range circle line width.
   *
   * OpenRA 对照: PortableChronoInfo.CircleWidth
   */
  readonly circleWidth: number

  /** Range circle border color.
   *
   * OpenRA 对照: PortableChronoInfo.CircleBorderColor
   */
  readonly circleBorderColor: ColorStub

  /** Range circle border width.
   *
   * OpenRA 对照: PortableChronoInfo.CircleBorderWidth
   */
  readonly circleBorderWidth: number

  /** Color for the target line.
   *
   * OpenRA 对照: PortableChronoInfo.TargetLineColor
   */
  readonly targetLineColor: ColorStub

  constructor(params?: {
    instanceName?: string
    requiresCondition?: string
    chargeDelay?: number
    hasDistanceLimit?: boolean
    maxDistance?: number
    chronoshiftSound?: string
    deployCursor?: string
    deployBlockedCursor?: string
    targetCursor?: string
    targetBlockedCursor?: string
    killCargo?: boolean
    flashScreen?: boolean
    voice?: string
    circleColor?: ColorStub
    circleWidth?: number
    circleBorderColor?: ColorStub
    circleBorderWidth?: number
    targetLineColor?: ColorStub
  }) {
    this.instanceName = params?.instanceName
    this.requiresCondition = params?.requiresCondition
    this.chargeDelay = params?.chargeDelay ?? 500
    this.hasDistanceLimit = params?.hasDistanceLimit ?? true
    this.maxDistance = params?.maxDistance ?? 12
    this.chronoshiftSound = params?.chronoshiftSound ?? 'chrotnk1.aud'
    this.deployCursor = params?.deployCursor ?? 'deploy'
    this.deployBlockedCursor = params?.deployBlockedCursor ?? 'deploy-blocked'
    this.targetCursor = params?.targetCursor ?? 'chrono-target'
    this.targetBlockedCursor = params?.targetBlockedCursor ?? 'move-blocked'
    this.killCargo = params?.killCargo ?? true
    this.flashScreen = params?.flashScreen ?? false
    this.voice = params?.voice ?? 'Action'
    this.circleColor = params?.circleColor ?? { r: 124, g: 252, b: 0, a: 128 }
    this.circleWidth = params?.circleWidth ?? 1
    this.circleBorderColor = params?.circleBorderColor ?? { r: 0, g: 0, b: 0, a: 96 }
    this.circleBorderWidth = params?.circleBorderWidth ?? 3
    this.targetLineColor = params?.targetLineColor ?? { r: 124, g: 252, b: 0, a: 255 }
  }

  create(init: IGameActor): PortableChrono {
    return new PortableChrono(init, this)
  }
}

// ---------------------------------------------------------------------------
// PortableChrono
// OpenRA 对照: PortableChrono : PausableConditionalTrait<PortableChronoInfo>,
//   IIssueOrder, IResolveOrder, ITick, ISelectionBar, IOrderVoice, ISync
// ---------------------------------------------------------------------------

/**
 * Allows infantry to teleport using a portable chronoshift device.
 *
 * OpenRA 对照: PortableChrono
 *
 * The device has a cooldown between uses. The unit can target any
 * explored cell within range and will queue a Teleport activity.
 */
export class PortableChrono
  extends ConditionalTrait<PortableChronoInfo>
  implements ITick, ISync, ISelectionBar
{
  /** The actor holding this device.
   *
   * OpenRA 对照: PortableChrono.self (implicit via trait attachment)
   */
  readonly self: IGameActor

  /** Current charge tick countdown.
   *
   * OpenRA 对照: PortableChrono.chargeTick ([VerifySync])
   */
  chargeTick: number = 0

  constructor(self: IGameActor, info: PortableChronoInfo) {
    super(info)
    this.self = self
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Decrease charge tick each game tick.
   *
   * OpenRA 对照: PortableChrono.ITick.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    if (this.isTraitDisabled || this.isTraitPaused)
      return

    if (this.chargeTick > 0)
      this.chargeTick--
  }

  // -----------------------------------------------------------------------
  // Order targets (IIssueOrder)
  // -----------------------------------------------------------------------

  /** Get the available order targeters.
   *
   * OpenRA 对照: PortableChrono.Orders
   */
  get orders(): readonly IOrderTargeterStub[] {
    if (this.isTraitDisabled) return []

    return [
      new PortableChronoOrderTargeter(this.info.targetCursor),
      // DeployOrderTargeter: "PortableChronoDeploy", priority 5
      // cursor: CanTeleport ? Info.DeployCursor : Info.DeployBlockedCursor
    ]
  }

  /** Issue an order based on the targeter.
   *
   * OpenRA 对照: PortableChrono.IssueOrder(Actor, IOrderTargeter, Target, bool)
   */
  issueOrder(
    self: IGameActor,
    order: IOrderTargeterStub,
    target: TargetStub,
    queued: boolean,
  ): OrderStub | null {
    if (order.orderID === 'PortableChronoDeploy') {
      // OpenRA: Switch the global order generator instead of actually issuing an order
      // HACK: self.World.OrderGenerator = new PortableChronoOrderGenerator(self, this)
      // HACK: return fake Order to stop game complaining
      return {
        orderString: order.orderID,
        subjectId: self.actorId,
        target,
        queued,
      }
    }

    if (order.orderID === 'PortableChronoTeleport') {
      return {
        orderString: order.orderID,
        subjectId: self.actorId,
        target,
        queued,
      }
    }

    return null
  }

  /** Resolve an issued order.
   *
   * OpenRA 对照: PortableChrono.ResolveOrder(Actor, Order)
   */
  resolveOrder(_self: IGameActor, order: OrderStub): void {
    if (order.orderString !== 'PortableChronoTeleport') return
    if (!order.target) return

    // OpenRA: if (target.Type == TargetType.Invalid) return - check for null cell

    // NOTE: maxDistance from this.info.hasDistanceLimit / this.info.maxDistance

    if (!order.queued) {
      // self.CancelActivity()
      // TODO: Activity cancellation
    }

    // OpenRA: var cell = self.World.Map.CellContaining(order.Target.CenterPosition)
    // if (maxDistance != null)
    //   self.QueueActivity(move.MoveWithinRange(order.Target, WDist.FromCells(maxDistance.Value)))
    //
    // self.QueueActivity(new Teleport(self, cell, maxDistance, Info.KillCargo, Info.FlashScreen, Info.ChronoshiftSound))
    // self.QueueActivity(move.MoveTo(cell, 5))
    // self.ShowTargetLines()

    // Reset charge time after teleport
    this.resetChargeTime()
  }

  // -----------------------------------------------------------------------
  // IOrderVoice
  // -----------------------------------------------------------------------

  /** Get the voice phrase for the given order.
   *
   * OpenRA 对照: PortableChrono.IOrderVoice.VoicePhraseForOrder(Actor, Order)
   */
  voicePhraseForOrder(_self: IGameActor, order: OrderStub): string | null {
    return order.orderString === 'PortableChronoTeleport'
      ? this.info.voice
      : null
  }

  // -----------------------------------------------------------------------
  // Charge management
  // -----------------------------------------------------------------------

  /** Reset the charge cooldown to maximum.
   *
   * OpenRA 对照: PortableChrono.ResetChargeTime()
   */
  resetChargeTime(): void {
    this.chargeTick = this.info.chargeDelay
  }

  /** Whether the device can currently teleport.
   *
   * OpenRA 对照: PortableChrono.CanTeleport
   */
  get canTeleport(): boolean {
    return !this.isTraitDisabled && !this.isTraitPaused && this.chargeTick <= 0
  }

  /** Called when the trait is disabled.
   *
   * OpenRA 对照: PausableConditionalTrait.TraitDisabled(Actor)
   *
   * Resets the charge tick to zero.
   */
  protected override traitDisabled(_self: IGameActor): void {
    this.chargeTick = 0
  }

  // -----------------------------------------------------------------------
  // ISelectionBar
  // -----------------------------------------------------------------------

  /** Get the charge progress as a bar value (0.0 to 1.0).
   *
   * OpenRA 对照: PortableChrono.ISelectionBar.GetValue()
   *
   * Returns the fraction of charge completed.
   */
  getValue(): number {
    if (this.isTraitDisabled)
      return 0

    return (this.info.chargeDelay - this.chargeTick) / this.info.chargeDelay
  }

  /** Get the color of the selection bar.
   *
   * OpenRA 对照: PortableChrono.ISelectionBar.GetColor()
   */
  getColor(): ColorStub {
    return { r: 255, g: 0, b: 255, a: 255 } // Magenta
  }

  /** Whether to display the bar when empty.
   *
   * OpenRA 对照: PortableChrono.ISelectionBar.DisplayWhenEmpty
   */
  get displayWhenEmpty(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// PortableChronoOrderTargeter
// OpenRA 对照: PortableChronoOrderTargeter : IOrderTargeter
// ---------------------------------------------------------------------------

/**
 * Order targeter for the portable chronoshift teleport.
 *
 * OpenRA 对照: PortableChronoOrderTargeter (sealed nested class)
 */
export class PortableChronoOrderTargeter implements IOrderTargeterStub {
  readonly orderID = 'PortableChronoTeleport'
  readonly orderPriority = 5

  private _isQueued: boolean = false

  get isQueued(): boolean {
    return this._isQueued
  }

  constructor(targetCursor: string) {
    // NOTE: targetCursor stored for future use by Shroud.IsExplored check
    void targetCursor
  }

  /** Checks if the target is valid for teleport.
   *
   * OpenRA 对照: PortableChronoOrderTargeter.CanTarget(Actor, Target, TargetModifiers, ref string)
   *
   * Returns true only for ForceMove modifier on explored cells.
   */
  canTarget(
    self: IGameActor,
    _target: TargetStub,
    modifiers: TargetModifiersStub,
    cursor: string,
  ): boolean {
    if ((modifiers & TargetModifiers.ForceMove) !== 0) {
      // OpenRA: var xy = self.World.Map.CellContaining(target.CenterPosition)
      // IsQueued = modifiers.HasModifier(TargetModifiers.ForceQueue)
      // if (self.IsInWorld && self.Owner.Shroud.IsExplored(xy)) {
      //   cursor = targetCursor
      //   return true
      // }

      this._isQueued = (modifiers & TargetModifiers.ForceQueue) !== 0
      // NOTE: For stub purposes, always allow explored cells
      // TODO: Shroud.IsExplored check
      void self
      void cursor
      return true
    }

    return false
  }

  /** Whether targeting overrides default selection behavior.
   *
   * OpenRA 对照: PortableChronoOrderTargeter.TargetOverridesSelection
   */
  targetOverridesSelection(
    _self: IGameActor,
    _target: TargetStub,
    _actorsAt: readonly IGameActor[],
    _xy: CPos,
    _modifiers: TargetModifiersStub,
  ): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// PortableChronoOrderGenerator
// OpenRA 对照: PortableChronoOrderGenerator : UnitOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator for the portable chronoshift target selection.
 *
 * OpenRA 对照: PortableChronoOrderGenerator
 *
 * When active, generates PortableChronoTeleport orders for clicked cells.
 * Displays a range circle around the unit and a target cursor.
 *
 * NOTE: Extends UnitOrderGenerator which is migrated in Ch15.
 * This is a stub that implements the core logic without the UI rendering.
 */
export class PortableChronoOrderGenerator {
  /** The actor using the chronoshift device.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.self
   */
  readonly self: IGameActor

  /** The portable chronoshift trait.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.portableChrono
   */
  readonly portableChrono: PortableChrono

  /** The trait configuration.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.info
   */
  readonly info: PortableChronoInfo

  /** The mouse action type for this generator.
   *
   * OpenRA 对照: UnitOrderGenerator.ActionType
   */
  readonly actionType: string = 'ConfirmOrder'

  /** Whether to clear selection on left click.
   *
   * OpenRA 对照: UnitOrderGenerator.ClearSelectionOnLeftClick
   */
  readonly clearSelectionOnLeftClick: boolean = false

  constructor(self: IGameActor, portableChrono: PortableChrono) {
    this.self = self
    this.portableChrono = portableChrono
    this.info = portableChrono.info
  }

  /** Generate orders for the clicked cell.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.OrderInner(World, CPos, int2, MouseInput)
   */
  orderInner(cell: CPos, shiftHeld: boolean): OrderStub[] {
    const self = this.self
    if (!self.isInWorld) return []
    if (cell.Bits === selfLocation(self).Bits) return []
    if (!this.portableChrono.canTeleport) return []
    // OpenRA: self.Owner.Shroud.IsExplored(cell)
    // TODO: Shroud check

    // Cancel input mode (open world.CancelInputMode)
    return [{
      orderString: 'PortableChronoTeleport',
      subjectId: self.actorId,
      target: { cell },
      queued: shiftHeld,
    }]
  }

  /** Get the cursor for a given cell.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.GetCursor(World, CPos, int2, MouseInput)
   */
  getCursor(cell: CPos): string {
    const self = this.self
    if (!self.isInWorld) return this.info.targetBlockedCursor
    if (cell.Bits === selfLocation(self).Bits) return this.info.targetBlockedCursor
    if (!this.portableChrono.canTeleport) return this.info.targetBlockedCursor
    // OpenRA: self.Owner.Shroud.IsExplored(cell)
    // TODO: Shroud check
    return this.info.targetCursor
  }

  /** Called when the unit's selection changes.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.SelectionChanged(World, IEnumerable<Actor>)
   */
  selectionChanged(selected: readonly IGameActor[]): void {
    if (!selected.includes(this.self)) {
      // world.CancelInputMode()
      // TODO: Input mode cancellation
    }
  }

  /** Called each tick to check if the trait is still valid.
   *
   * OpenRA 对照: PortableChronoOrderGenerator.Tick(World)
   */
  tick(): void {
    if (this.portableChrono.isTraitDisabled || this.portableChrono.isTraitPaused) {
      // world.CancelInputMode()
      // TODO: Input mode cancellation
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: get actor cell location
// ---------------------------------------------------------------------------

function selfLocation(self: IGameActor): CPos {
  const actorAny = self as unknown as Record<string, unknown>
  const loc = actorAny['location'] as CPos | undefined
  return loc ?? CPos.Zero
}
