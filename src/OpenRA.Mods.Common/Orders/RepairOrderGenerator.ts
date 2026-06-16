/**
 * RepairOrderGenerator.ts — 维修序生成器：进入维修光标模式，点击友方单位/建筑发出维修指令
 * OpenRA 对照: OpenRA.Mods.Common/Orders/RepairOrderGenerator.cs (87 lines)
 *
 * 核心范式转换:
 * - C# ScreenMap.ActorsAtMouse(mi) → TS ActorMap.getActorsAt(cell) (UnitOrderGenerator 已建立)
 * - C# underCursor.GetDamageState() → TS getDamageState() 方法调用
 * - C# underCursor.TraitOrDefault<Repairable>() → TS traitsImplementing + trait 查找
 * - C# world.CancelInputMode() on game over → TS 直接调用
 * - C# 利用 OrderInner 检查游标 (Any()) → TS 同样模式
 *
 * 维修模式：点击受损的友方建筑→发出 RepairBuilding 指令，
 * 点击受损的友方单位→发出 Repair 或 RepairNear 指令（取决于单位特性）。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IMouseSettings,
  WorldStub,
  WorldRendererStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  MouseActionType,
  TargetModifiers,
  TargetModifiersExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import {
  OrderGenerator,
  type IOrderGeneratorWorld,
} from './OrderGenerator.js'
import type {
  IUnitOrderPlayer,
  IUnitOrderActor,
  IUnitOrderMouseInput,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// Trait stub interfaces (minimal — full impl in Chapters 11/14)
// ---------------------------------------------------------------------------

/**
 * Minimal repairable trait interface.
 *
 * OpenRA 对照: Repairable (Ch14 stub)
 */
interface IRepairableStub {
  findRepairBuilding(actor: IUnitOrderActor): IUnitOrderActor | null
}

/**
 * Minimal repairableNear trait interface.
 *
 * OpenRA 对照: RepairableNear (Ch14 stub)
 */
interface IRepairableNearStub {
  findRepairBuilding(actor: IUnitOrderActor): IUnitOrderActor | null
}

/**
 * Damage state enum (minimal — only Undamaged is checked).
 *
 * OpenRA 对照: DamageState enum
 */
const DamageState = {
  Undamaged: 0,
} as const

// ---------------------------------------------------------------------------
// RepairOrderGeneratorWorld — extended world interface
// ---------------------------------------------------------------------------

/**
 * World interface required by RepairOrderGenerator.
 *
 * Extends IOrderGeneratorWorld with actorMap, shroud, localPlayer, isGameOver.
 */
export interface IRepairOrderGeneratorWorld extends IOrderGeneratorWorld {
  readonly actorMap: {
    getActorsAt(cell: CPos): readonly IGameActor[]
  }
  readonly shroud: {
    fogObscures(actor: IGameActor): boolean
  } | null
  readonly localPlayer: IUnitOrderPlayer | null
  readonly isGameOver: boolean
  cancelInputMode(): void
}

// ---------------------------------------------------------------------------
// RepairOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator for repair cursor mode.
 *
 * OpenRA 对照: RepairOrderGenerator : OrderGenerator
 *
 * When active, clicking on a friendly damaged actor dispatches:
 * - "RepairBuilding" → if the target has RepairableBuildingInfo (building repair)
 * - "Repair" → if the target has Repairable trait (unit returns to repair facility)
 * - "RepairNear" → if the target has RepairableNear trait (unit repaired in-place nearby)
 *
 * Auto-cancels when the game is over (WinState != Undefined).
 */
export class RepairOrderGenerator extends OrderGenerator {
  // ---------------------------------------------------------------------------
  // Instance
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.GlobalCommand

  /** Typed world reference for actor lookups. */
  private readonly _rw: IRepairOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param world — the game world with actorMap, shroud, etc.
   * @param settings — mouse settings for button resolution
   */
  constructor(
    world: IRepairOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super('RepairOrderGenerator', world, settings)
    this._rw = world
  }

  // ---------------------------------------------------------------------------
  // orderInner — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Produce repair orders for the clicked cell.
   *
   * OpenRA 对照: protected override IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *
   * Logic:
   * 1. Find a friendly, non-fog-obscured actor under the cursor
   * 2. If no actor or actor is undamaged → no order
   * 3. If actor has RepairableBuildingInfo → RepairBuilding order
   * 4. If actor is not owned by local player → no further orders
   * 5. Check Repairable trait → Repair order
   * 6. Check RepairableNear trait → RepairNear order
   * 7. If no repair building found → no order
   *
   * @param _world — the game world (unused — use typed _rw)
   * @param cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers (unused for repair)
   * @param mi — mouse input event
   */
  protected *orderInner(
    _world: WorldStub,
    cell: CPos,
    _modifiers: TargetModifiers,
    mi: unknown,
  ): Generator<Order | null> {
    const input = mi as IUnitOrderMouseInput | undefined
    if (!input) return

    const localPlayer = this._rw.localPlayer
    if (!localPlayer) return

    // 1. Find friendly, non-fog-obscured actor under cursor
    // OpenRA 对照: world.ScreenMap.ActorsAtMouse(mi).Select(a => a.Actor)
    //   .FirstOrDefault(a => a.AppearsFriendlyTo(world.LocalPlayer.PlayerActor) && !world.FogObscures(a))
    const actorsAtCell = this._rw.actorMap.getActorsAt(cell)
    const underCursor = actorsAtCell.find((a) => {
      const actor = a as unknown as IUnitOrderActor
      // AppearsFriendlyTo check: same player or allied
      if (!actor.owner || !localPlayer.isAlliedWith(actor.owner)) return false
      // Fog check
      if (this._rw.shroud?.fogObscures(a)) return false
      return true
    }) as unknown as IUnitOrderActor | undefined

    if (!underCursor) return

    // 2. Check damage state: skip undamaged actors
    // OpenRA 对照: if (underCursor.GetDamageState() == DamageState.Undamaged) yield break
    //
    // NOTE: getDamageState() is guaranteed by the C# IHealth interface at compile time.
    // In TS, since we use duck-type stubs, we defensive-call via optional chaining
    // (?.()) as the trait interface is not yet fully migrated.
    const damageState = (underCursor as unknown as { getDamageState?(): number }).getDamageState?.()
    if (damageState === DamageState.Undamaged) return

    // 3. Building repair check
    // OpenRA 对照: if (underCursor.Info.HasTraitInfo<RepairableBuildingInfo>())
    //   yield return new Order("RepairBuilding", world.LocalPlayer.PlayerActor, Target.FromActor(underCursor), false)
    if (underCursor.info?.hasTraitInfo('RepairableBuildingInfo')) {
      yield {
        orderName: 'RepairBuilding',
        targetString: localPlayer.playerName,
        extraData: {
          subject: localPlayer.playerActor,
          target: Target.fromActor(underCursor as unknown as IActorRef),
          queued: false,
        },
      }
    }

    // 4. Don't command allied units beyond repair-building check
    // OpenRA 对照: if (underCursor.Owner != world.LocalPlayer) yield break
    if (underCursor.owner !== localPlayer) return

    // 5-6. Repairable / RepairableNear trait check
    // OpenRA 对照: var repairable = underCursor.TraitOrDefault<Repairable>()
    //   if (repairable != null) repairBuilding = repairable.FindRepairBuilding(underCursor)
    //   else { var repairableNear = ...; orderId = "RepairNear"; ... }
    let repairBuilding: IUnitOrderActor | null = null
    let orderId = 'Repair'

    const traits = (underCursor.traitsImplementing?.('Repairable') ?? []) as IRepairableStub[]
    if (traits.length > 0) {
      repairBuilding = traits[0].findRepairBuilding(underCursor)
    } else {
      const nearTraits = (underCursor.traitsImplementing?.('RepairableNear') ?? []) as IRepairableNearStub[]
      if (nearTraits.length > 0) {
        orderId = 'RepairNear'
        repairBuilding = nearTraits[0].findRepairBuilding(underCursor)
      }
    }

    // 7. No repair building found → no order
    if (!repairBuilding) return

    // OpenRA 对照: yield return new Order(orderId, underCursor, Target.FromActor(repairBuilding), Target.FromActor(underCursor), queued)
    const queued = TargetModifiersExts.hasModifier(
      input.modifiers,
      TargetModifiers.ForceQueue,
    )
    yield {
      orderName: orderId,
      targetString: repairBuilding.owner?.playerName ?? '',
      extraData: {
        subject: underCursor,
        target: Target.fromActor(repairBuilding as unknown as IActorRef),
        selfTarget: Target.fromActor(underCursor as unknown as IActorRef),
        queued,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // tick — auto-cancel on game over
  // ---------------------------------------------------------------------------

  /**
   * Auto-cancel this generator when the game is over.
   *
   * OpenRA 对照: protected override void Tick(World)
   *   if (world.LocalPlayer != null && world.LocalPlayer.WinState != WinState.Undefined)
   *     world.CancelInputMode()
   */
  override tick(_world: WorldStub): void {
    const localPlayer = this._rw.localPlayer
    if (localPlayer && localPlayer.winState !== 0) {
      this._rw.cancelInputMode()
    }
  }

  // ---------------------------------------------------------------------------
  // getCursor — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Return the cursor name for the current cell.
   *
   * OpenRA 对照: protected override string GetCursor(World, CPos, int2, MouseInput)
   *   return OrderInner(world, cell, worldPixel, mi).Any() ? "repair" : "repair-blocked"
   */
  getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string {
    // Check if orderInner would produce any orders
    if (!mi) return 'repair-blocked'

    // Collect orders to see if any are produced
    const orders: (Order | null)[] = []
    for (const o of this['orderInner'](_world, cell, TargetModifiers.None, mi)) {
      orders.push(o)
    }

    return orders.length > 0 ? 'repair' : 'repair-blocked'
  }

  // ---------------------------------------------------------------------------
  // Render — no-op
  // ---------------------------------------------------------------------------

  /**
   * Render above-shroud visual feedback. No-op.
   *
   * OpenRA 对照: protected override IEnumerable<IRenderable> RenderAboveShroud(...) { yield break; }
   */
  renderAboveShroud(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }

  /**
   * Render annotations. No-op.
   *
   * OpenRA 对照: protected override IEnumerable<IRenderable> RenderAnnotations(...) { yield break; }
   */
  renderAnnotations(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }
}
