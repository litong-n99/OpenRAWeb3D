/**
 * AttackOrderPower.ts — 攻击指令支援能力（命令单位攻击目标）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/SupportPowers/AttackOrderPower.cs (157 lines)
 *
 * 核心范式转换:
 * - C# SupportPower (extends) → TypeScript SupportPower abstract class
 * - C# SelectAttackPowerTarget (OrderGenerator inner class) → TypeScript separate class
 * - C# Requires<AttackBaseInfo> → TypeScript composition check
 * - C# IRenderable yield return → TypeScript stub (deferred to Phase C)
 * - C# RangeCircleAnnotationRenderable → TypeScript stub
 * - C# INotifyBurstComplete → TypeScript burst complete notification
 */

import {
  SupportPower,
  type SupportPowerInfo,
  type OrderStub,
  type ISupportPowerManager,
  type ISupportPower,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// AttackOrderPowerInfo
// OpenRA 对照: AttackOrderPowerInfo : SupportPowerInfo, Requires<AttackBaseInfo>
// ---------------------------------------------------------------------------

/** Configuration for the Attack Order support power.
 *
 * OpenRA 对照: AttackOrderPowerInfo
 */
export class AttackOrderPowerInfo implements ITraitInfo {
  /** Range circle color.
   *
   * OpenRA 对照: AttackOrderPowerInfo.CircleColor
   */
  readonly circleColor: number

  /** Range circle line width.
   *
   * OpenRA 对照: AttackOrderPowerInfo.CircleWidth
   */
  readonly circleWidth: number

  /** Range circle border color.
   *
   * OpenRA 对照: AttackOrderPowerInfo.CircleBorderColor
   */
  readonly circleBorderColor: number

  /** Range circle border width.
   *
   * OpenRA 对照: AttackOrderPowerInfo.CircleBorderWidth
   */
  readonly circleBorderWidth: number

  /** Support power base fields. */
  readonly orderName: string = 'AttackOrderPowerInfoOrder'
  readonly chargeInterval: number = 0
  readonly cursor: string = 'attack'

  constructor(params?: {
    circleColor?: number
    circleWidth?: number
    circleBorderColor?: number
    circleBorderWidth?: number
    orderName?: string
    chargeInterval?: number
    cursor?: string
  }) {
    this.circleColor = params?.circleColor ?? 0xff0000ff // Red ARGB
    this.circleWidth = params?.circleWidth ?? 1
    this.circleBorderColor = params?.circleBorderColor ?? 0x60000000 // Semi-transparent black
    this.circleBorderWidth = params?.circleBorderWidth ?? 3
    if (params?.orderName) this.orderName = params.orderName
    if (params?.chargeInterval !== undefined) this.chargeInterval = params.chargeInterval
    if (params?.cursor) this.cursor = params.cursor
  }

  create(init: IGameActor): AttackOrderPower {
    return new AttackOrderPower(init, this)
  }
}

// ---------------------------------------------------------------------------
// AttackOrderPower
// OpenRA 对照: AttackOrderPower : SupportPower, INotifyCreated, INotifyBurstComplete
// ---------------------------------------------------------------------------

/** Target-and-attack support power.
 *
 * OpenRA 对照: AttackOrderPower
 *
 * Orders the target actor(s) to attack a specified position or actor.
 * Used for paradrop-attack, chrono-attack, and similar powers.
 */
export class AttackOrderPower extends SupportPower {
  declare readonly info: AttackOrderPowerInfo

  /** The AttackBase trait reference.
   *
   * OpenRA 对照: AttackOrderPower.attack (AttackBase)
   */
  private _attack: unknown = null

  constructor(self: IGameActor, info: AttackOrderPowerInfo) {
    const spInfo: SupportPowerInfo = {
      orderName: info.orderName,
      chargeInterval: info.chargeInterval,
      cursor: info.cursor,
    }
    super(self, spInfo)
    ;(this as any).info = info
  }

  // -------------------------------------------------------------------------
  // Lifecycle — Created
  // -------------------------------------------------------------------------

  /** Resolve the AttackBase trait after creation.
   *
   * OpenRA 对照: AttackOrderPower.Created(Actor)
   */
  protected override onCreated(self: IGameActor): void {
    // C#: attack = self.Trait<AttackBase>()
    this._attack = (self as any).traitsImplementing?.('AttackBase')?.[0] ?? null
  }

  // -------------------------------------------------------------------------
  // SelectTarget
  // -------------------------------------------------------------------------

  /** Enter targeting mode.
   *
   * OpenRA 对照: AttackOrderPower.SelectTarget(Actor, string, SupportPowerManager)
   *
   * Creates a SelectAttackPowerTarget OrderGenerator.
   */
  override selectTarget(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // C#: self.World.OrderGenerator = new SelectAttackPowerTarget(self, order, manager, info.Cursor, attack)
    const world = (self as any).world
    if (world) {
      const targeter = new SelectAttackPowerTarget(
        self,
        order,
        manager,
        this.info.cursor,
        this._attack,
      )
      // NOTE: OrderGenerator assignment deferred to WorldInteractionControllerWidget bridge
      void targeter
    }
  }

  // -------------------------------------------------------------------------
  // Activate
  // -------------------------------------------------------------------------

  /** Activate the power — issue attack order to the target.
   *
   * OpenRA 对照: AttackOrderPower.Activate(Actor, Order, SupportPowerManager)
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)
    this.playLaunchSounds()

    // C#: attack.AttackTarget(order.Target, AttackSource.Default, false, false, true)
    if (this._attack && typeof (this._attack as any).attackTarget === 'function') {
      ;(this._attack as any).attackTarget(order.target ?? null, 'Default', false, false, true)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyBurstComplete
  // -------------------------------------------------------------------------

  /** When the burst is complete, issue a Stop order.
   *
   * OpenRA 对照: INotifyBurstComplete.FiredBurst(Actor, Target, Armament)
   */
  firedBurst(self: IGameActor): void {
    // C#: self.World.IssueOrder(new Order("Stop", self, false))
    const issueOrder = (self as any).world?.issueOrder as
      | ((order: unknown) => void)
      | undefined
    if (issueOrder) {
      issueOrder({ orderName: 'Stop', subject: self, queued: false })
    }
  }

  /** Get the AttackBase reference (for testing).
   */
  get attack(): unknown {
    return this._attack
  }
}

// ---------------------------------------------------------------------------
// SelectAttackPowerTarget OrderGenerator
// OpenRA 对照: SelectAttackPowerTarget : OrderGenerator (inner class)
// ---------------------------------------------------------------------------

/** Order generator for selecting an attack target for the AttackOrderPower.
 *
 * OpenRA 对照: SelectAttackPowerTarget
 *
 * Validates that the selected cell is within attack range of at least one
 * unpaused power instance, and issues the attack order on valid selection.
 */
export class SelectAttackPowerTarget {
  readonly order: string
  readonly cursor: string
  readonly cursorBlocked: string

  private readonly _manager: ISupportPowerManager
  private readonly _attack: unknown
  /** Cached power entry for this order (contains instances list for range checks).
   *
   * OpenRA 对照: instance = manager.GetPowersForActor(self).FirstOrDefault()
   */
  private readonly _powerEntry: { active: boolean; ready: boolean; instances: ISupportPower[] } | undefined

  constructor(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
    cursor: string,
    attack: unknown,
  ) {
    this._manager = manager
    this.order = order
    this.cursor = cursor
    this._attack = attack
    this.cursorBlocked = `${cursor}-blocked`

    // C#: instance = manager.GetPowersForActor(self).FirstOrDefault()
    // Caches the power entry struct for this order so isValidTarget can iterate instances.
    this._powerEntry = manager.powers.get(order)
  }

  /** Check if a cell is a valid target.
   *
   * OpenRA 对照: IsValidTarget(World, CPos)
   *
   * @param world — the game world
   * @param cell — the candidate cell
   * @returns true if the cell is a valid attack target
   */
  isValidTarget(world: unknown, cell: { X: number; Y: number }): boolean {
    const w = world as any
    const map = w?.map
    if (!map?.contains(cell)) return false

    // C#: instance.Instances.Any(a => !a.IsTraitPaused && (a.Self.CenterPosition - pos).HorizontalLengthSquared < range)
    if (!this._powerEntry) return false

    const maxRange =
      typeof (this._attack as any)?.getMaximumRange === 'function'
        ? (this._attack as any).getMaximumRange()
        : 0
    const rangeSq = maxRange * maxRange

    const cellCenter = map.centerOfCell?.(cell)
    if (!cellCenter) return false

    const instances = this._powerEntry.instances ?? []
    for (const inst of instances) {
      if ((inst as any).isTraitPaused) continue

      const selfPos = (inst as any).self?.centerPosition
      if (!selfPos) continue

      const dx = selfPos.X - cellCenter.X
      const dy = selfPos.Y - cellCenter.Y
      const distSq = dx * dx + dy * dy

      if (distSq < rangeSq) return true
    }

    return false
  }

  /** Generate an order for the selected cell.
   *
   * OpenRA 对照: OrderInner(World, CPos, int2, MouseInput)
   *
   * @param world — the game world
   * @param cell — the selected cell
   * @returns array of orders (typically 1)
   */
  orderInner(world: unknown, cell: { X: number; Y: number }): unknown[] {
    if (!this.isValidTarget(world, cell)) return []

    return [
      {
        orderName: this.order,
        subject: this._manager.self,
        target: { type: 'cell', cell },
        queued: false,
        suppressVisualFeedback: true,
      },
    ]
  }

  /** Tick the order generator — cancel if power is no longer usable.
   *
   * OpenRA 对照: Tick(World)
   */
  tick(world: unknown): void {
    const power = this._manager.powers.get(this.order)
    if (!power || !(power as any).active || !(power as any).ready) {
      ;(world as any)?.cancelInputMode?.()
    }
  }

  /** Get cursor for the given cell.
   *
   * OpenRA 对照: GetCursor(World, CPos, int2, MouseInput)
   */
  getCursor(world: unknown, cell: { X: number; Y: number }): string {
    return this.isValidTarget(world, cell) ? this.cursor : this.cursorBlocked
  }
}
