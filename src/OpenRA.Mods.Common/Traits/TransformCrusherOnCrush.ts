/**
 * TransformCrusherOnCrush.ts -- Replaces the crusher with a new actor when it crushes something
 * OpenRA 对照: OpenRA.Mods.Common/Traits/TransformCrusherOnCrush.cs (59 lines)
 *
 * 核心范式转换:
 * - C# TransformCrusherOnCrushInfo : TraitInfo → TS plain class (no ConditionalTrait)
 * - C# TransformCrusherOnCrush : INotifyCrushed → TS INotifyCrushed impl
 * - C# ActorInitializer → TS configuration object
 * - C# FactionInit → TS faction string parameter
 * - C# Transform activity → TODO-8.D.TRANSFORM-ACTIVITY
 * - C# IFacing → duck-typed facing query
 */

import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import type {
  IGameActor,
  BitSetStub,
  INotifyCrushed,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CrushClass } from './CombatInterfaces.js'
import { CRUSH_CLASS_TYPENAME } from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// TransformCrusherOnCrushInfo
// OpenRA 对照: TransformCrusherOnCrushInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for TransformCrusherOnCrush trait.
 *
 *  OpenRA 对照: TransformCrusherOnCrushInfo
 */
export class TransformCrusherOnCrushInfo {
  /** Actor type to transform into on crush.
   *
   *  OpenRA 对照: TransformCrusherOnCrushInfo.IntoActor (required)
   */
  readonly intoActor: string

  /** Whether to skip the make animation during transformation.
   *
   *  OpenRA 对照: TransformCrusherOnCrushInfo.SkipMakeAnims (default true)
   */
  readonly skipMakeAnims: boolean = true

  /** Crush class(es) that trigger transformation.
   *
   *  OpenRA 对照: TransformCrusherOnCrushInfo.CrushClasses (default empty)
   */
  readonly crushClasses: BitSet<CrushClass>

  constructor(params: {
    intoActor?: string
    skipMakeAnims?: boolean
    crushClasses?: readonly string[]
  } = {}) {
    this.intoActor = params.intoActor ?? ''
    this.skipMakeAnims = params.skipMakeAnims ?? true
    this.crushClasses = new BitSet<CrushClass>(
      CRUSH_CLASS_TYPENAME,
      ...(params.crushClasses ?? []),
    )
  }
}

// ---------------------------------------------------------------------------
// TransformCrusherOnCrush
// OpenRA 对照: TransformCrusherOnCrush (INotifyCrushed)
// ---------------------------------------------------------------------------

/** Put this on the actor that gets crushed to replace the crusher with a new actor.
 *
 *  OpenRA 对照: TransformCrusherOnCrush
 */
export class TransformCrusherOnCrush implements INotifyCrushed {
  readonly info: TransformCrusherOnCrushInfo

  /** The faction string for the replacement actor. */
  private readonly _faction: string

  constructor(info: TransformCrusherOnCrushInfo, faction?: string) {
    this.info = info
    // OpenRA: faction = init.GetValue<FactionInit, string>(init.Self.Owner.Faction.InternalName)
    this._faction = faction ?? ''
  }

  // -----------------------------------------------------------------------
  // INotifyCrushed — warnCrush (no-op for this trait)
  // OpenRA 对照: INotifyCrushed.WarnCrush(Actor, Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  warnCrush(
    _self: IGameActor,
    _crusher: IGameActor,
    _crushClasses: BitSetStub<unknown>,
  ): void {
    // Intentionally empty — this trait only acts on crush, not on warning
  }

  // -----------------------------------------------------------------------
  // INotifyCrushed — onCrush (transform the crusher)
  // OpenRA 对照: INotifyCrushed.OnCrush(Actor, Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  onCrush(
    _self: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): void {
    if (!this.info.crushClasses.overlaps(crushClasses as unknown as BitSet<CrushClass>)) {
      return
    }

    if (!this.info.intoActor || this.info.intoActor.length === 0) return

    // NOTE: In OpenRA, the crusher queues a Transform activity that replaces
    // the crusher with a new actor created from IntoActor.
    //
    // The Transform activity is defined in OpenRA.Mods.Common/Activities/Transform.cs
    // and handles the actor replacement logic. In TS, this is deferred.
    //
    // TODO-8.D.TRANSFORM-ACTIVITY: When activities (especially Transform) are
    // migrated, create the Transform activity and queue it on the crusher.

    // Get facing for the replacement
    const c = crusher as unknown as {
      traitOrDefault?: <T>(_tag: string) => T | null
      queueActivity?: (next: unknown) => void
    }
    const facing = c.traitOrDefault?.<{ facing: unknown }>('IFacing')
    const facingValue = facing?.facing ?? null

    // Create replacement via world.createActor
    const world = (_self as unknown as {
      world?: {
        createActor?(name: string, init?: Map<string, unknown>): IGameActor
      }
    }).world

    if (world?.createActor) {
      const init = new Map<string, unknown>()
      init.set('faction', this._faction)
      if (facingValue !== null) {
        init.set('facing', facingValue)
      }
      // NOTE: In OpenRA, the Transform activity handles SkipMakeAnims.
      // In TS, we'd pass it through the activity when migrated.

      // Create replacement actor AND dispose the crusher
      // NOTE: Full transformation requires the activity system for proper
      // lifecycle management. For now, we just create the new actor.
      world.createActor(this.info.intoActor, init)

      // NOTE: OpenRA would also remove the crusher here via the Transform activity.
      // crusher.dispose() or similar cleanup is deferred to the full activity system.
    }
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /** Dispose this trait (no GPU resources to clean up). */
  dispose(): void {
    // No resources to clean up — BitSet is GC-managed
  }
}
