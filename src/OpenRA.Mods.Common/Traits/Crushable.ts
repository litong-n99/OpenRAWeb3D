/**
 * Crushable.ts -- Trait that makes an actor crushable by other actors (e.g., infantry by tanks)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Crushable.cs (97 lines)
 *
 * 核心范式转换:
 * - C# CrushableInfo : ConditionalTraitInfo → TS ConditionalTraitInfo
 * - C# Crushable : ConditionalTrait<CrushableInfo>, ICrushable, INotifyCrushed →
 *   TS ConditionalTrait with interface impl
 * - C# BitSet<CrushClass> → TS BitSet<CrushClass> (with marker type)
 * - C# LongBitSet<PlayerBitMask> → TS LongBitSet<PlayerBitMask>
 * - C# Game.Sound.Play() → TODO-8.D.SOUND-DEFER
 * - C# self.Kill() → duck-typed kill() on actor
 */

import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import { LongBitSet } from '../../OpenRA.Game/Primitives/LongBitSet.js'
import type { PlayerBitMask } from '../../OpenRA.Game/Player.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ICrushable,
  type INotifyCrushed,
  type BitSetStub,
  type LongBitSetStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type CrushClass,
  CRUSH_CLASS_TYPENAME,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// CrushableInfo
// OpenRA 对照: CrushableInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for Crushable trait.
 *
 *  OpenRA 对照: CrushableInfo
 */
export class CrushableInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Sound to play when being crushed.
   *
   *  OpenRA 对照: CrushableInfo.CrushSound (default null)
   */
  readonly crushSound: string | null = null

  /** Which crush classes this actor belongs to.
   *
   *  OpenRA 对照: CrushableInfo.CrushClasses (default BitSet<CrushClass>("infantry"))
   */
  readonly crushClasses: BitSet<CrushClass>

  /** Probability of mobile actors noticing and evading a crush attempt.
   *
   *  OpenRA 对照: CrushableInfo.WarnProbability (default 75)
   */
  readonly warnProbability: number = 75

  /** Will friendly units just crush me instead of pathing around.
   *
   *  OpenRA 对照: CrushableInfo.CrushedByFriendlies (default false)
   */
  readonly crushedByFriendlies: boolean = false

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    crushSound?: string | null
    crushClasses?: readonly string[]
    warnProbability?: number
    crushedByFriendlies?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.crushSound = params.crushSound ?? null
    this.crushClasses = new BitSet<CrushClass>(
      CRUSH_CLASS_TYPENAME,
      ...(params.crushClasses ?? ['infantry']),
    )
    this.warnProbability = params.warnProbability ?? 75
    this.crushedByFriendlies = params.crushedByFriendlies ?? false
  }
}

// ---------------------------------------------------------------------------
// Crushable
// OpenRA 对照: Crushable (ConditionalTrait<CrushableInfo>, ICrushable, INotifyCrushed)
// ---------------------------------------------------------------------------

/** This actor is crushable by other actors.
 *
 *  OpenRA 对照: Crushable
 */
export class Crushable
  extends ConditionalTrait<CrushableInfo>
  implements ICrushable, INotifyCrushed
{
  constructor(info: CrushableInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Component lifecycle override — capture actor reference
  // -----------------------------------------------------------------------

  protected override traitEnabled(_actor: IGameActor): void {
    super.traitEnabled(_actor)
    // OpenRA: self.World.ActorMap.UpdateOccupiedCells(self.OccupiesSpace)
    const a = this._actor ?? _actor
    ;(a as unknown as {
      world?: {
        actorMap?: {
          updateOccupiedCells?(ios: unknown): void
        }
      }
      occupiesSpace?: unknown
    }).world?.actorMap?.updateOccupiedCells?.(
      (a as unknown as { occupiesSpace?: unknown }).occupiesSpace,
    )
  }

  protected override traitDisabled(_actor: IGameActor): void {
    super.traitDisabled(_actor)
    // OpenRA: self.World.ActorMap.UpdateOccupiedCells(self.OccupiesSpace)
    const a = this._actor ?? _actor
    ;(a as unknown as {
      world?: {
        actorMap?: {
          updateOccupiedCells?(ios: unknown): void
        }
      }
      occupiesSpace?: unknown
    }).world?.actorMap?.updateOccupiedCells?.(
      (a as unknown as { occupiesSpace?: unknown }).occupiesSpace,
    )
  }

  // -----------------------------------------------------------------------
  // ICrushable — crushableBy (single-player check)
  // OpenRA 对照: ICrushable.CrushableBy(Actor, Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  crushableBy(
    _actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): boolean {
    return this._crushableInner(crushClasses, crusher.owner)
  }

  // -----------------------------------------------------------------------
  // ICrushable — crushableByPlayerMask (returns player mask)
  // OpenRA 对照: ICrushable.CrushableBy(Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  crushableByPlayerMask(
    actor: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): LongBitSetStub<unknown> {
    if (this.isTraitDisabled || !this._overlaps(crushClasses)) {
      return (actor as unknown as {
        world?: { noPlayersMask: LongBitSetStub<unknown> }
      }).world?.noPlayersMask ?? new LongBitSet<PlayerBitMask>('PlayerBitMask' as string, 0n) as unknown as LongBitSetStub<unknown>
    }

    const world = (actor as unknown as {
      world?: {
        allPlayersMask: LongBitSet<PlayerBitMask>
        noPlayersMask: LongBitSet<PlayerBitMask>
      }
    }).world

    if (!world) return new LongBitSet<PlayerBitMask>('PlayerBitMask' as string, 0n) as unknown as LongBitSetStub<unknown>

    if (this.info.crushedByFriendlies) {
      return world.allPlayersMask as unknown as LongBitSetStub<unknown>
    }

    return world.allPlayersMask.except(
      ((actor as unknown as { owner?: { alliedPlayersMask: LongBitSet<PlayerBitMask> } }).owner?.alliedPlayersMask
        ?? new LongBitSet<PlayerBitMask>('PlayerBitMask' as string, 0n)),
    ) as unknown as LongBitSetStub<unknown>
  }

  // -----------------------------------------------------------------------
  // INotifyCrushed — warnCrush (evasion warning)
  // OpenRA 对照: INotifyCrushed.WarnCrush(Actor, Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  warnCrush(
    actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): void {
    if (!this._crushableInner(crushClasses, crusher.owner)) return

    // OpenRA: mobile.TraitOrDefault<Mobile>() + Nudge activity
    // TODO-8.D.NUDGE: Queue Nudge activity when Mobile trait is migrated
    const a = actor as unknown as {
      traitOrDefault?: <T>(_tag: string) => T | null
      world?: { sharedRandom?: { next(max?: number): number } }
      queueActivity?: (next: unknown) => void
    }
    const mobile = a.traitOrDefault?.<{ _mobileBrand: unknown }>('Mobile')
    if (mobile !== null && mobile !== undefined) {
      const rand = a.world?.sharedRandom?.next(100) ?? 0
      if (rand <= this.info.warnProbability) {
        // NOTE: In OpenRA, this queues a Nudge activity.
        // In TS, we defer to the activity system migration.
        // a.queueActivity?.(new Nudge(crusher))
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyCrushed — onCrush (kill this actor)
  // OpenRA 对照: INotifyCrushed.OnCrush(Actor, Actor, BitSet<CrushClass>)
  // -----------------------------------------------------------------------

  onCrush(
    actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): void {
    if (!this._crushableInner(crushClasses, crusher.owner)) return

    // TODO-8.D.SOUND-DEFER: Game.Sound.Play(SoundType.World, Info.CrushSound, crusher.CenterPosition)

    const c = crusher as unknown as {
      traitOrDefault?: <T>(_tag: string) => T | null
    }
    const crusherMobile = c.traitOrDefault?.<{
      info?: { locomotorInfo?: { crushDamageTypes?: BitSetStub<unknown> } }
    }>('Mobile')

    const damageTypes: BitSetStub<unknown> = crusherMobile?.info?.locomotorInfo?.crushDamageTypes
      ?? { contains: () => false, isEmpty: () => true }

    ;(actor as unknown as { kill?: (attacker: IGameActor, dmgTypes: BitSetStub<unknown>) => void }).kill?.(
      crusher,
      damageTypes,
    )
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Check if this actor is crushable by a given crusher.
   *
   *  OpenRA 对照: Crushable.CrushableInner(BitSet<CrushClass>, Player)
   */
  private _crushableInner(
    crushClasses: BitSetStub<unknown>,
    crushOwner: unknown,
  ): boolean {
    if (this.isTraitDisabled) return false

    const selfActor = this._actor
    if (!selfActor) return false

    if (!this.info.crushedByFriendlies) {
      const owner = selfActor.owner as unknown as {
        isAlliedWith?(other: unknown): boolean
      } | undefined
      if (owner?.isAlliedWith?.(crushOwner)) return false
    }

    return this._overlaps(crushClasses)
  }

  /** Check if crushClasses overlap with this actor's crush classes.
   *
   *  OpenRA 对照: BitSet<CrushClass>.Overlaps()
   */
  private _overlaps(crushClasses: BitSetStub<unknown>): boolean {
    // BitSet overlaps: check if there's any common bit.
    // Duck-typed objects may have isEmpty as a method, a boolean property,
    // or not at all (undefined → treat as empty/safe default).
    const isEmptyType = typeof crushClasses.isEmpty
    const empty = isEmptyType === 'function'
      ? (crushClasses.isEmpty as () => boolean)()
      : isEmptyType === 'boolean'
        ? (crushClasses.isEmpty as unknown as boolean)
        : true
    if (empty) return false
    return this.info.crushClasses.overlaps(
      crushClasses as unknown as BitSet<CrushClass>,
    )
  }
}
