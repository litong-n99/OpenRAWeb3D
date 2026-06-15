/**
 * CreatesShroud.ts — Generate fog-of-war shroud for enemy players (Gap Generator)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/CreatesShroud.cs
 *
 * 核心范式转换:
 * - C# self.Owner.RelationshipWith(p) → TS self.owner.relationshipWith(p) with PlayerStub→Player cast
 * - C# Shroud.SourceType.Shroud enum → TS SourceType.Shroud const
 * - C# ICreatesShroudModifier range modifiers → TS traitsImplementing('ICreatesShroudModifier')
 * - C# HasRelationship extension method → TS PlayerRelationshipExts.hasRelationship
 * - C# IEnumerable<int> rangeModifiers (lazy) → TS number[] (collected once in created())
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import { PPos } from '../../OpenRA.Game/MPos.js'
import {
  AffectsShroud,
  AffectsShroudInfo,
  VisibilityType,
} from './AffectsShroud.js'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
  type INotifyCreated,
  type IGameActor,
  type ICreatesShroudModifier,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { SourceType } from '../../OpenRA.Game/Traits/Player/Shroud.js'
import { applyPercentageModifiers } from '../Projectiles/MissileMath.js'
import type { Player } from '../../OpenRA.Game/Player.js'

// ---------------------------------------------------------------------------
// CreatesShroudInfo (对应 OpenRA CreatesShroudInfo)
// ---------------------------------------------------------------------------

/** Configuration for CreatesShroud trait.
 *
 * OpenRA 对照: CreatesShroudInfo : AffectsShroudInfo
 *
 * CreatesShroud generates shroud (darkness / fog of war) for players whose
 * relationship matches the validRelationships mask. It is used by structures
 * like the Gap Generator to create stealthy darkness areas.
 */
export class CreatesShroudInfo extends AffectsShroudInfo {
  /** Relationship the watching player needs to see the generated shroud.
   *
   * OpenRA 对照: CreatesShroudInfo.ValidRelationships (default Neutral | Enemy)
   */
  readonly validRelationships: PlayerRelationship

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    minRange?: WDist
    range?: WDist
    maxHeightDelta?: number
    moveRecalculationThreshold?: WDist
    type?: VisibilityType
    validRelationships?: PlayerRelationship
  } = {}) {
    super(params)
    this.validRelationships = params.validRelationships ?? ((PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship)
  }
}

// ---------------------------------------------------------------------------
// CreatesShroud (对应 OpenRA CreatesShroud)
// ---------------------------------------------------------------------------

/** Generates fog-of-war shroud for enemy and neutral players.
 *
 * OpenRA 对照: CreatesShroud : AffectsShroud
 *
 * When active, this trait adds shroud (darkness) for players that match
 * the {@link CreatesShroudInfo.validRelationships} mask. This is used
 * for structures like the Gap Generator that produce stealthy darkness.
 *
 * Most logic (projectedCells, tick, position tracking, lifecycle hooks)
 * is inherited from {@link AffectsShroud}. This subclass only handles the
 * relationship check and source type selection in the abstract method
 * implementations.
 */
export class CreatesShroud
  extends AffectsShroud<CreatesShroudInfo>
  implements INotifyCreated
{
  /** Trait dictionary registration keys.
   *
   * OpenRA 对照: N/A (C# uses reflection; TS uses explicit string registration)
   */
  static readonly interfaces: string[] = [
    'ISync',
    'ITick',
    'INotifyAddedToWorld',
    'INotifyRemovedFromWorld',
    'INotifyCenterPositionChanged',
    'INotifyFinishedMoving',
    'INotifyCreated',
    'CreatesShroud',
    'AffectsShroud',
    'ConditionalTrait',
    'component',
  ]

  /** Collected range percentage modifiers from ICreatesShroudModifier traits.
   *
   * OpenRA 对照: CreatesShroud.rangeModifiers (IEnumerable<int>)
   *
   * Populated in {@link created} after the actor is fully initialized.
   * Applied in the {@link range} getter via {@link applyPercentageModifiers}.
   */
  private _rangeModifiers: number[] = []

  constructor(info: CreatesShroudInfo) {
    super(info)
  }

  // -------------------------------------------------------------------------
  // INotifyCreated (对应 OpenRA Created)
  // -------------------------------------------------------------------------

  /** Collect range modifiers after the actor is fully initialized.
   *
   * OpenRA 对照: CreatesShroud.Created(Actor self)
   *
   * Queries the actor's trait dictionary for ICreatesShroudModifier traits
   * and collects their percentage modifier values. These are applied in the
   * {@link range} getter via {@link applyPercentageModifiers}.
   */
  created(self: IGameActor): void {
    // Collect ICreatesShroudModifier range modifiers.
    // SAFETY: traitsImplementing is optional on IGameActor but exists at
    // runtime on all real actor implementations via the trait dictionary.
    const traitAny = self as any
    const modifierTraits = traitAny.traitsImplementing?.('ICreatesShroudModifier') ?? []
    this._rangeModifiers = (modifierTraits as ICreatesShroudModifier[]).map(
      (m) => m.getCreatesShroudModifier(),
    )
  }

  // -------------------------------------------------------------------------
  // Abstract method implementations (对应 OpenRA overrides)
  // -------------------------------------------------------------------------

  /** Add shroud cells for a player.
   *
   * OpenRA 对照: CreatesShroud.AddCellsToPlayerShroud(Actor, Player, PPos[])
   *
   * Only adds the shroud source if the relationship between the actor's owner
   * and the target player matches the configured validRelationships mask.
   * Uses {@link SourceType.Shroud} to generate darkness.
   */
  protected addCellsToPlayerShroud(
    self: IGameActor,
    player: Player,
    cells: readonly PPos[],
  ): void {
    const owner = self.owner as Player | undefined
    if (!owner) return

    const relationship = owner.relationshipWith(player)
    if (!PlayerRelationshipExts.hasRelationship(this.info.validRelationships, relationship)) {
      return
    }

    player.shroud.addSource(this, SourceType.Shroud, cells)
  }

  /** Remove this actor's shroud from a player.
   *
   * OpenRA 对照: CreatesShroud.RemoveCellsFromPlayerShroud(Actor, Player)
   *
   * Removes the source unconditionally — relationship filtering only
   * applies when adding cells (matching OpenRA behavior).
   */
  protected removeCellsFromPlayerShroud(
    _self: IGameActor,
    player: Player,
  ): void {
    player.shroud.removeSource(this)
  }

  // -------------------------------------------------------------------------
  // Range (对应 OpenRA Range property override)
  // -------------------------------------------------------------------------

  /** Effective range when the trait is enabled.
   *
   * OpenRA 对照: CreatesShroud.Range
   *
   * Returns WDist.Zero when the trait was disabled in the previous tick.
   * Otherwise, applies ICreatesShroudModifier percentage modifiers to the
   * configured range via {@link applyPercentageModifiers}.
   */
  override get range(): WDist {
    if (this.cachedTraitDisabled) return WDist.Zero

    // NOTE: Only apply modifiers when there are actual modifiers to apply.
    // If no modifiers are registered, skip the applyPercentageModifiers call
    // to avoid unnecessary computation.
    if (this._rangeModifiers.length > 0) {
      const modified = applyPercentageModifiers(
        this.info.range.length,
        this._rangeModifiers,
      )
      return new WDist(modified)
    }

    return this.info.range
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    this._rangeModifiers = []
    super.dispose()
  }
}
