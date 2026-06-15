/**
 * AircraftActivityInterfaces.ts — 飞行器活动通知接口
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Interfaces (INotifyIdle, INotifyLanding, etc.)
 *
 * 核心范式转换:
 * - C# INotifyIdle / INotifyLanding / INotifyTakeOff / INotifyParachute → TypeScript interfaces
 * - Duck-typed trait access via actor traits Map
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// INotifyIdle — used by FlyIdle
// ---------------------------------------------------------------------------

/**
 * Trait that receives notification when the actor is idle.
 *
 * OpenRA 对照: INotifyIdle
 */
export interface INotifyIdle {
  /** Called each tick while the actor is idle.
   *
   * OpenRA 对照: INotifyIdle.TickIdle(Actor)
   */
  tickIdle(actor: GameActor): void
}

// ---------------------------------------------------------------------------
// INotifyLanding — used by Land
// ---------------------------------------------------------------------------

/**
 * Trait that receives notification when the actor is landing.
 *
 * OpenRA 对照: INotifyLanding
 */
export interface INotifyLanding {
  /** Called when the actor begins landing.
   *
   * OpenRA 对照: INotifyLanding.Landing(Actor)
   */
  landing(actor: GameActor): void
}

// ---------------------------------------------------------------------------
// INotifyTakeOff — used by TakeOff
// ---------------------------------------------------------------------------

/**
 * Trait that receives notification when the actor is taking off.
 *
 * OpenRA 对照: INotifyTakeOff
 */
export interface INotifyTakeOff {
  /** Called when the actor takes off.
   *
   * OpenRA 对照: INotifyTakeOff.TakeOff(Actor)
   */
  takeOff(actor: GameActor): void
}

// ---------------------------------------------------------------------------
// INotifyParachute — used by Parachute
// ---------------------------------------------------------------------------

/**
 * Trait that receives notification during parachute descent.
 *
 * OpenRA 对照: INotifyParachute
 */
export interface INotifyParachute {
  /** Called when the actor starts parachuting.
   *
   * OpenRA 对照: INotifyParachute.OnParachute(Actor)
   */
  onParachute(actor: GameActor): void

  /** Called when the actor lands after parachuting.
   *
   * OpenRA 对照: INotifyParachute.OnLanded(Actor)
   */
  onLanded(actor: GameActor): void
}
