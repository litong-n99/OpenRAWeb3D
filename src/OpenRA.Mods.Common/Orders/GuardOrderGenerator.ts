/**
 * GuardOrderGenerator.ts — 守卫序生成器：进入守卫模式，将选中单位指派去保护友方目标
 * OpenRA 对照: OpenRA.Mods.Common/Orders/GuardOrderGenerator.cs (85 lines)
 *
 * 核心范式转换:
 * - C# ScreenMap.ActorsAtMouse(mi) → TS ActorMap.getActorsAt(cell) CPU 空间哈希
 * - C# AppearsFriendlyTo → TS isAlliedWith() 检查（owner 对 localPlayer 的同盟关系）
 * - C# HasTraitInfo<GuardableInfo>() → TS hasTraitInfo('GuardableInfo')
 * - C# HasTraitInfo<GuardInfo>() → TS hasTraitInfo('GuardInfo')
 * - C# HasTraitInfo<AutoTargetInfo>() → TS hasTraitInfo('AutoTargetInfo')
 * - C# subjects.Where(s => s != target) → TS subjects.filter(s => s !== target)
 * - C# world.CancelInputMode() → TS 注入的 _world.cancelInputMode()
 *
 * 守卫模式：选中可守卫的单位，点击友方单位使其去保护该目标。
 * 需要守卫单位有 GuardInfo 和 AutoTargetInfo 特性，
 * 目标必须友好、存活、且具有 GuardableInfo 特性。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IMouseSettings,
  WorldStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  MouseActionType,
  TargetModifiers,
  TargetModifiersExts,
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import {
  UnitOrderGenerator,
  type IUnitOrderGeneratorWorld,
  type IUnitOrderPlayer,
  type IUnitOrderActor,
  type IUnitOrderMouseInput,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// GuardOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator for guard command mode.
 *
 * OpenRA 对照: GuardOrderGenerator : UnitOrderGenerator
 *
 * When active, selecting units and clicking on a friendly guardable unit
 * dispatches a guard order to all selected subjects (excluding the target).
 * Auto-cancels after issuing the order unless Shift is held (queued mode).
 *
 * Guarding requires the selected subjects to have GuardInfo and AutoTargetInfo,
 * and the target must be friendly, alive, and have GuardableInfo.
 */
export class GuardOrderGenerator extends UnitOrderGenerator {
  // ---------------------------------------------------------------------------
  // Instance fields
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.ConfirmOrder

  /** The order name to issue (e.g., "Guard").
   *
   * OpenRA 对照: readonly string orderName
   */
  private readonly _orderName: string

  /** The cursor name to display when guarding is possible.
   *
   * OpenRA 对照: readonly string cursor
   */
  private readonly _cursor: string

  /** The currently selected guard-eligible actors.
   *
   * OpenRA 对照: IEnumerable<Actor> subjects
   */
  private _subjects: readonly IUnitOrderActor[]

  /** Typed world reference for cancelInputMode and actorMap access.
   *
   * Stored separately from the parent's private _uow for direct access.
   */
  private readonly _gw: IUnitOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param world — the game world with actorMap, localPlayer, etc.
   * @param settings — mouse settings for button resolution
   * @param subjects — the initially selected actors to guard
   * @param orderName — the order name to issue (e.g., "Guard")
   * @param cursor — the cursor name to display when guarding is possible
   */
  constructor(
    world: IUnitOrderGeneratorWorld,
    settings: IMouseSettings,
    subjects: readonly IUnitOrderActor[],
    orderName: string,
    cursor: string,
  ) {
    // OpenRA 对照: base(world)
    // Use default cursor names from UnitOrderGenerator since guard mode
    // overrides cursor resolution entirely.
    super(world, settings)
    this._gw = world
    this._orderName = orderName
    this._cursor = cursor
    this._subjects = subjects
  }

  // ---------------------------------------------------------------------------
  // orderInner — produce guard orders
  // ---------------------------------------------------------------------------

  /**
   * Produce a guard order for the clicked target.
   *
   * OpenRA 对照: protected override IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *
   * Logic:
   * 1. Find the first friendly guardable unit under the cursor
   * 2. If no valid target → no order
   * 3. Check if queued (Shift held)
   * 4. If not queued → cancel input mode (guard mode is one-shot)
   * 5. Yield guard order targeting the guardable unit, with subjects (excluding target)
   *
   * @param _world — the game world (unused — use typed _gw)
   * @param cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers (unused — extracted from mi)
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

    // 1. Find first friendly guardable unit under cursor
    // OpenRA 对照: var target = FriendlyGuardableUnits(world, mi).FirstOrDefault()
    const targets = GuardOrderGenerator.friendlyGuardableUnits(this._gw, cell)
    if (targets.length === 0) return

    const target = targets[0]

    // 2. Queued check
    // OpenRA 对照: var queued = mi.Modifiers.HasModifier(Modifiers.Shift)
    const queued = TargetModifiersExts.hasModifier(
      input.modifiers,
      TargetModifiers.ForceQueue,
    )

    // 3. If not queued, cancel input mode (one-shot behavior)
    // OpenRA 对照: if (!queued) world.CancelInputMode()
    if (!queued) {
      this._gw.cancelInputMode()
    }

    // 4. Yield guard order
    // OpenRA 对照: yield return new Order(orderName, null, Target.FromActor(target), queued,
    //                                     null, subjects.Where(s => s != target).ToArray())
    yield {
      orderName: this._orderName,
      targetString: '',
      extraData: {
        target: Target.fromActor(target as unknown as IActorRef),
        queued,
        subjects: this._subjects.filter((s) => s !== target),
      },
    }
  }

  // ---------------------------------------------------------------------------
  // selectionChanged — validate selection
  // ---------------------------------------------------------------------------

  /**
   * React to selection changes by filtering subjects to guard-eligible actors.
   *
   * OpenRA 对照: public override void SelectionChanged(World, IEnumerable<Actor>)
   *
   * Filters subjects to non-dead actors with GuardInfo trait.
   * If no remaining subject has AutoTargetInfo → cancels input mode
   * (guarding doesn't work without auto-targeting).
   */
  override selectionChanged(
    _world: WorldStub,
    selected: readonly unknown[],
  ): void {
    // OpenRA 对照: subjects = selected.Where(s => !s.IsDead && s.Info.HasTraitInfo<GuardInfo>())
    const actors = selected as readonly IUnitOrderActor[]
    this._subjects = actors.filter(
      (s) => !s.isDead && s.info?.hasTraitInfo('GuardInfo'),
    )

    // OpenRA 对照: if (!subjects.Any(s => s.Info.HasTraitInfo<AutoTargetInfo>()))
    //               world.CancelInputMode()
    if (!this._subjects.some((s) => s.info?.hasTraitInfo('AutoTargetInfo'))) {
      this._gw.cancelInputMode()
    }
  }

  // ---------------------------------------------------------------------------
  // getCursor — cursor resolution
  // ---------------------------------------------------------------------------

  /**
   * Return the cursor name for the current cell.
   *
   * OpenRA 对照: public override string GetCursor(World, CPos, int2, MouseInput)
   *
   * Returns the configured cursor if a guard target is available,
   * "move-blocked" if no valid guard targets exist, or an empty
   * string if there are no subjects (null in C# → empty string in TS).
   */
  getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    _mi?: unknown,
  ): string {
    // OpenRA 对照: if (!subjects.Any()) return null
    if (this._subjects.length === 0) return ''

    // OpenRA 对照: var multiple = subjects.Count() > 1
    const multiple = this._subjects.length > 1

    // OpenRA 对照: var canGuard = FriendlyGuardableUnits(world, mi)
    //   .Any(a => multiple || a != subjects.First())
    const friendlyUnits = GuardOrderGenerator.friendlyGuardableUnits(
      this._gw,
      cell,
    )
    const first = this._subjects[0]
    const canGuard = friendlyUnits.some(
      (a) => multiple || a !== first,
    )

    // OpenRA 对照: return canGuard ? cursor : "move-blocked"
    return canGuard ? this._cursor : 'move-blocked'
  }

  // ---------------------------------------------------------------------------
  // inputOverridesSelection — always override
  // ---------------------------------------------------------------------------

  /**
   * Custom order generators always override selection.
   *
   * OpenRA 对照: public override bool InputOverridesSelection(...) => true
   */
  override inputOverridesSelection(
    _world: IUnitOrderGeneratorWorld,
    _xy: { readonly x: number; readonly y: number },
    _mi: IUnitOrderMouseInput,
  ): boolean {
    return true
  }

  // ---------------------------------------------------------------------------
  // clearSelectionOnLeftClick — false
  // ---------------------------------------------------------------------------

  /**
   * Left-click should not clear selection during guard mode.
   *
   * OpenRA 对照: public override bool ClearSelectionOnLeftClick => false
   */
  override get clearSelectionOnLeftClick(): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // Render / tick — no-op (inherits from UnitOrderGenerator)
  // ---------------------------------------------------------------------------

  /**
   * Render above-shroud visual feedback. No-op — inherits from UnitOrderGenerator.
   *
   * OpenRA 对照: GuardOrderGenerator does not override RenderAboveShroud
   */
  // renderAboveShroud: inherited no-op from UnitOrderGenerator
  // renderAnnotations: inherited no-op from UnitOrderGenerator

  // ---------------------------------------------------------------------------
  // deactivate — cleanup
  // ---------------------------------------------------------------------------

  /**
   * Deactivate this generator. Clears subject references.
   *
   * OpenRA 对照: implicit — subjects cleared via GC
   */
  override deactivate(): void {
    this._subjects = []
    super.deactivate()
  }

  // ---------------------------------------------------------------------------
  // Static helper — friendlyGuardableUnits
  // ---------------------------------------------------------------------------

  /**
   * Find all friendly guardable units at the given cell.
   *
   * OpenRA 对照: static IEnumerable<Actor> FriendlyGuardableUnits(World, MouseInput)
   *
   * Filters actors at the cell by:
   * - Not dead
   * - Friendly to the local player (AppearsFriendlyTo check)
   * - Has GuardableInfo trait
   * - Not obscured by fog of war
   *
   * NOTE: The C# version uses ScreenMap.ActorsAtMouse(mi) for pixel-precise
   * lookup. The TS version uses cell-based ActorMap.getActorsAt(cell) instead
   * (see ADR-15.2). This is sufficient for RTS gameplay at cell granularity.
   *
   * @param world — the game world
   * @param cell — the map cell to query
   * @returns friendly guardable actors at the cell
   */
  static friendlyGuardableUnits(
    world: IUnitOrderGeneratorWorld,
    cell: CPos,
  ): readonly IUnitOrderActor[] {
    // OpenRA 对照: world.ScreenMap.ActorsAtMouse(mi).Select(a => a.Actor)
    const actorsAtCell = world.actorMap.getActorsAt(cell)
    const localPlayer = world.localPlayer

    // OpenRA 对照:
    //   .Where(a => !a.IsDead &&
    //     a.AppearsFriendlyTo(world.LocalPlayer.PlayerActor) &&
    //     a.Info.HasTraitInfo<GuardableInfo>() &&
    //     !world.FogObscures(a))
    return actorsAtCell.filter((a) => {
      const actor = a as unknown as IUnitOrderActor

      // IsDead check
      if (actor.isDead) return false

      // AppearsFriendlyTo check: the actor's owner must be allied with the local player
      if (!localPlayer) return false
      if (!actor.owner) return false
      if (!this.isFriendly(actor.owner, localPlayer)) return false

      // HasTraitInfo<GuardableInfo> check
      if (!actor.info?.hasTraitInfo('GuardableInfo')) return false

      // FogObscures check
      if (world.shroud?.fogObscures(a)) return false

      return true
    }) as unknown as IUnitOrderActor[]
  }

  // ---------------------------------------------------------------------------
  // Private helper — isFriendly
  // ---------------------------------------------------------------------------

  /**
   * Check if an actor appears friendly to another — matches
   * the C# ActorExts.AppearsFriendlyTo extension method.
   *
   * OpenRA 对照: ActorExts.AppearsFriendlyTo(this Actor self, Actor toActor)
   *
   * Returns true if actorOwner is allied with observerPlayer.
   *
   * @param actorOwner — the owner of the actor being checked
   * @param observerPlayer — the player whose perspective to check from
   */
  private static isFriendly(
    actorOwner: IUnitOrderPlayer,
    observerPlayer: IUnitOrderPlayer,
  ): boolean {
    return actorOwner.relationshipWith(observerPlayer) === PlayerRelationship.Ally
  }
}
