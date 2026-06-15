/**
 * CrateAction.ts — 宝箱动作基类
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Crates/CrateAction.cs (104 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<CrateActionInfo> → TS ConditionalTrait<CrateActionInfo>
 * - C# Game.Sound.Play / PlayNotification / TextNotificationsManager → TS 桩
 * - C# World.AddFrameEndTask(w => w.Add(SpriteEffect)) → TS 桩
 * - C# TechTree.HasPrerequisites(…) → TS 桩
 *
 * NOTE: Audio, SpriteEffect, and TechTree integration are stubbed.
 *   Subclasses override Activate() for crate-specific effects.
 *
 * Added: Chapter 13 Phase A Batch 3 (TODO-13.A.14 dependency)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CrateActionInfo — 宝箱动作配置
// OpenRA 对照: CrateActionInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for a crate action.
 *
 * OpenRA 对照: CrateActionInfo
 */
export interface CrateActionInfo extends ConditionalTraitInfo {
  /** Chance weight for this action (assumes collector is compatible).
   *
   * OpenRA 对照: CrateActionInfo.SelectionShares (default 10)
   */
  readonly selectionShares: number

  /** Image containing the crate effect animation sequence.
   *
   * OpenRA 对照: CrateActionInfo.Image (default "crate-effects")
   */
  readonly image?: string

  /** Animation sequence played when collected. Empty for no effect.
   *
   * OpenRA 对照: CrateActionInfo.Sequence (default null)
   */
  readonly sequence?: string | null

  /** Palette to draw the animation in.
   *
   * OpenRA 对照: CrateActionInfo.Palette (default "effect")
   */
  readonly palette?: string

  /** Audio clip to play when the crate is collected.
   *
   * OpenRA 对照: CrateActionInfo.Sound (default null)
   */
  readonly sound?: string | null

  /** Speech notification to play when the crate is collected.
   *
   * OpenRA 对照: CrateActionInfo.Notification (default null)
   */
  readonly notification?: string | null

  /** Text notification to display when the crate is collected.
   *
   * OpenRA 对照: CrateActionInfo.TextNotification (default null)
   */
  readonly textNotification?: string | null

  /** Earliest time (ticks) that this crate action can occur.
   *
   * OpenRA 对照: CrateActionInfo.TimeDelay (default 0)
   */
  readonly timeDelay?: number

  /** Prerequisites required on the collector for this action.
   *
   * OpenRA 对照: CrateActionInfo.Prerequisites
   */
  readonly prerequisites?: readonly string[]

  /** Actor types excluded from receiving this action.
   *
   * OpenRA 对照: CrateActionInfo.ExcludedActorTypes
   */
  readonly excludedActorTypes?: readonly string[]
}

/** Default values for CrateActionInfo. */
export const DEFAULT_CRATE_ACTION_INFO: Partial<CrateActionInfo> = {
  selectionShares: 10,
  image: 'crate-effects',
  palette: 'effect',
  timeDelay: 0,
}

// ---------------------------------------------------------------------------
// CrateAction — 宝箱动作基类
// OpenRA 对照: CrateAction : ConditionalTrait<CrateActionInfo>
// ---------------------------------------------------------------------------

/**
 * Base class for all crate actions.
 *
 * OpenRA 对照: CrateAction
 *
 * Subclasses must override Activate() to define what happens when a collector
 * picks up the crate. They may override GetSelectionShares() to customize
 * the selection weight based on the collector.
 */
export abstract class CrateAction
  extends ConditionalTrait<CrateActionInfo>
{
  /** The actor holding this crate action. */
  readonly self: IGameActor

  constructor(self: IGameActor, info: CrateActionInfo) {
    super(info)
    this.self = self
  }

  // -----------------------------------------------------------------------
  // Selection logic
  // -----------------------------------------------------------------------

  /**
   * Outer wrapper that filters by disabled, time delay, prerequisites,
   * and excluded actor types before delegating to GetSelectionShares().
   *
   * OpenRA 对照: CrateAction.GetSelectionSharesOuter(Actor)
   *
   * @param collector — the actor collecting the crate
   * @returns the weighted selection share, or 0 if this action is ineligible
   */
  getSelectionSharesOuter(collector: IGameActor): number {
    if (this.isTraitDisabled) return 0

    // NOTE: TimeDelay check requires World.WorldTick — stubbed, always passes
    // In OpenRA: if (self.World.WorldTick < Info.TimeDelay) return 0

    // Excluded actor types
    if (this.info.excludedActorTypes && collector.info?.name) {
      if (this.info.excludedActorTypes.includes(collector.info.name)) {
        return 0
      }
    }

    // Prerequisites check
    if (
      this.info.prerequisites &&
      this.info.prerequisites.length > 0
    ) {
      // NOTE: TechTree.HasPrerequisites() — stubbed, always passes for now
    }

    return this.getSelectionShares(collector)
  }

  /**
   * Get the selection weight for this action.
   *
   * OpenRA 对照: CrateAction.GetSelectionShares(Actor) (virtual)
   *
   * Override to customize weight based on collector state.
   * Default returns info.selectionShares.
   *
   * @param _collector — the actor collecting the crate
   * @returns the selection weight
   */
  getSelectionShares(_collector: IGameActor): number {
    return this.info.selectionShares
  }

  // -----------------------------------------------------------------------
  // Activation
  // -----------------------------------------------------------------------

  /**
   * Activate this crate action when a collector picks up the crate.
   *
   * OpenRA 对照: CrateAction.Activate(Actor) (virtual)
   *
   * Plays Sound, Notification, TextNotification, and spawns a SpriteEffect
   * if configured. Subclasses MUST call super.Activate(collector) to get
   * the default effects, then add their own.
   *
   * @param collector — the actor collecting the crate
   */
  activate(_collector: IGameActor): void {
    // NOTE: Game.Sound.Play(SoundType.World, Info.Sound, self.CenterPosition)
    // Audio playback stubbed — see Ch7 Phase D.

    // NOTE: Game.Sound.PlayNotification(…) — speech notification stubbed

    // NOTE: TextNotificationsManager.AddTransientLine(…) — text notification stubbed

    // NOTE: SpriteEffect spawning via world.AddFrameEndTask stubbed
    // In OpenRA: if (Info.Image != null && Info.Sequence != null)
    //   collector.World.AddFrameEndTask(w =>
    //     w.Add(new SpriteEffect(collector, w, Info.Image, Info.Sequence, Info.Palette)))
  }

  // -----------------------------------------------------------------------
  // Helpers — override for testing
  // -----------------------------------------------------------------------

  /**
   * Check whether the collector's owner has the specified TechTree prerequisites.
   * Stubbed — always returns true.
   */
  protected checkPrerequisites(
    _owner: PlayerStub,
    _prerequisites: readonly string[],
  ): boolean {
    // NOTE: owner.PlayerActor.Trait<TechTree>().HasPrerequisites(prerequisites)
    return true
  }
}
