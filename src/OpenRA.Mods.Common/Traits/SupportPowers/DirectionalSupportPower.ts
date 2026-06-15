/**
 * DirectionalSupportPower.ts — 方向性支援能力基类 (拖拽瞄准)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/DirectionalSupportPower.cs (51 lines)
 *
 * 核心范式转换:
 * - C# SupportPower override SelectTarget → TS override selectTarget()
 * - C# SelectDirectionalTarget(IOrderGenerator) → TS SelectDirectionalTarget class
 * - C# World.OrderGenerator assignment → TS 通过 manager 桥接
 *
 * DirectionalSupportPower extends SupportPower to add directional targeting.
 * When UseDirectionalTarget is enabled, SelectTarget creates a
 * SelectDirectionalTarget OrderGenerator instead of SelectGenericPowerTarget.
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
} from './SupportPower.js'

// ---------------------------------------------------------------------------
// DirectionalSupportPowerInfo
// OpenRA 对照: DirectionalSupportPowerInfo : SupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for directional support powers.
 *
 * OpenRA 对照: DirectionalSupportPowerInfo (2 extra properties)
 *
 * Enables drag-to-set-direction targeting mode with arrow cursor sprites.
 *
 * Arrow order (CCW, 8 directions, starting from (0,-1)):
 *   N, NW, W, SW, S, SE, E, NE
 * OpenRA default: ["arrow-t", "arrow-tl", "arrow-l", "arrow-bl", "arrow-b", "arrow-br", "arrow-r", "arrow-tr"]
 */
export interface DirectionalSupportPowerInfo extends SupportPowerInfo {
  /** Enables the player directional targeting.
   *
   * OpenRA 对照: DirectionalSupportPowerInfo.UseDirectionalTarget
   */
  readonly useDirectionalTarget?: boolean

  /** Arrow sequence names (8 directions, CCW starting from N).
   *
   * OpenRA 对照: DirectionalSupportPowerInfo.Arrows (ImmutableArray<string>)
   *
   * Default: ["arrow-t", "arrow-tl", "arrow-l", "arrow-bl", "arrow-b", "arrow-br", "arrow-r", "arrow-tr"]
   */
  readonly arrows?: readonly string[]

  /** Animation used to render the direction arrows.
   *
   * OpenRA 对照: DirectionalSupportPowerInfo.DirectionArrowAnimation
   */
  readonly directionArrowAnimation?: string | null

  /** Palette for direction cursor animation.
   *
   * OpenRA 对照: DirectionalSupportPowerInfo.DirectionArrowPalette
   */
  readonly directionArrowPalette?: string
}

/** Default 8-direction arrow sequence names (CCW from N).
 *
 * OpenRA 对照: DirectionalSupportPowerInfo.Arrows default
 */
export const DEFAULT_DIRECTIONAL_ARROWS: readonly string[] = [
  'arrow-t',   // N  (0,-1)  -> angle 0
  'arrow-tl',  // NW (-1,-1) -> angle 45
  'arrow-l',   // W  (-1,0)  -> angle 90
  'arrow-bl',  // SW (-1,1)  -> angle 135
  'arrow-b',   // S  (0,1)   -> angle 180
  'arrow-br',  // SE (1,1)   -> angle 225
  'arrow-r',   // E  (1,0)   -> angle 270
  'arrow-tr',  // NE (1,-1)  -> angle 315
]

// ---------------------------------------------------------------------------
// DirectionalSupportPower
// OpenRA 对照: DirectionalSupportPower : SupportPower (10 lines of logic)
// ---------------------------------------------------------------------------

/**
 * Support power variant with directional drag-to-aim targeting.
 *
 * OpenRA 对照: DirectionalSupportPower
 *
 * Overrides SelectTarget to create a SelectDirectionalTarget when
 * UseDirectionalTarget is true. Otherwise delegates to the base
 * SelectGenericPowerTarget.
 */
export class DirectionalSupportPower extends SupportPower {
  /** Directional info (typed reference to the subclass info).
   *
   * OpenRA 对照: DirectionalSupportPower.info
   */
  readonly dirInfo: DirectionalSupportPowerInfo

  constructor(self: IGameActor, info: DirectionalSupportPowerInfo) {
    super(self, info)
    this.dirInfo = info
  }

  /**
   * Enter targeting mode.
   *
   * OpenRA 对照: DirectionalSupportPower.SelectTarget(Actor, string, SupportPowerManager)
   *
   * If UseDirectionalTarget is enabled, creates a SelectDirectionalTarget.
   * Otherwise delegates to the base (SelectGenericPowerTarget).
   */
  override selectTarget(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    if (this.dirInfo.useDirectionalTarget) {
      // NOTE: In OpenRA:
      //   self.World.OrderGenerator = new SelectDirectionalTarget(
      //     self.World, order, manager, info);
      // The SelectDirectionalTarget class handles drag-to-aim interaction.
      // In TypeScript, this is bridged through the order generator system.
      this.setDirectionalOrderGenerator(self, order, manager)
    } else {
      // Delegate to base SelectGenericPowerTarget
      super.selectTarget(self, order, manager)
    }
  }

  /**
   * Create a SelectDirectionalTarget OrderGenerator.
   *
   * In OpenRA, this creates: new SelectDirectionalTarget(world, order, manager, info)
   *
   * @param self — the actor holding this power
   * @param order — the power key (order string)
   * @param manager — the owning SupportPowerManager
   */
  protected setDirectionalOrderGenerator(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: Full SelectDirectionalTarget integration deferred.
    // The SelectDirectionalTarget class is implemented in
    // SelectDirectionalTarget.ts and handles the drag-to-aim UX.
    // When WorldInteractionControllerWidget is fully wired to handle
    // OrderGenerator transitions, this creates and activates the
    // directional target selector.
    this.setOrderGenerator(self, order, manager, this.dirInfo)
  }
}
