/**
 * EdibleByLeap.ts — 标记可被跳跃攻击吞噬的单位
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/EdibleByLeap.cs (37 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<EdibleByLeap> → TypeScript ITraitInfo with create()
 * - C# Actor leaper tracking → TypeScript IGameActor | null reference
 * - C# IsDead check → TypeScript isDead property check
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// EdibleByLeapInfo
// OpenRA 对照: EdibleByLeapInfo : TraitInfo<EdibleByLeap>
// ---------------------------------------------------------------------------

/** Configuration for the EdibleByLeap marker trait.
 *
 * OpenRA 对照: EdibleByLeapInfo
 */
export class EdibleByLeapInfo implements ITraitInfo {
  create(_init: IGameActor): EdibleByLeap {
    return new EdibleByLeap()
  }
}

// ---------------------------------------------------------------------------
// EdibleByLeap
// OpenRA 对照: EdibleByLeap
// ---------------------------------------------------------------------------

/** Allows this actor to be the target of an attack leap.
 *
 * OpenRA 对照: EdibleByLeap
 *
 * Tracks which actor is currently leaping at this actor. Only one leaper
 * can target this actor at a time, unless the previous leaper is dead.
 */
export class EdibleByLeap {
  /** The actor currently leaping at this one.
   *
   * OpenRA 对照: EdibleByLeap.leaper (Actor)
   */
  private leaper: IGameActor | null = null

  /** Check whether the given targeter can leap at this actor.
   *
   * OpenRA 对照: EdibleByLeap.CanLeap(Actor)
   *
   * @param targeter — the actor attempting to leap
   * @returns true if the leap is allowed (no current leaper, dead leaper, or same leaper)
   */
  canLeap(targeter: IGameActor): boolean {
    return this.leaper === null || this.leaper.isDead || this.leaper === targeter
  }

  /** Attempt to claim this actor as a leap target.
   *
   * OpenRA 对照: EdibleByLeap.GetLeapAtBy(Actor)
   *
   * @param targeter — the actor attempting to leap
   * @returns true if the claim succeeded
   */
  getLeapAtBy(targeter: IGameActor): boolean {
    if (this.leaper !== null && !this.leaper.isDead && this.leaper !== targeter) {
      return false
    }

    this.leaper = targeter
    return true
  }
}
