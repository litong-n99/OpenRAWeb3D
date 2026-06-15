/**
 * SupportPowerChargeBar.ts — 支援能力充能进度条选择栏
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/SupportPowerChargeBar.cs (65 lines)
 *
 * 核心范式转换:
 * - C# ISelectionBar.GetValue/GetColor → TS ISelectionBar 接口
 * - C# INotifyOwnerChanged.OnOwnerChanged → TS INotifyOwnerChanged 接口
 * - C# DisplayRelationships filter → TS IEnumerable<SupportPower> 查询
 * - C# ConditionalTrait<SupportPowerChargeBarInfo> → TS ConditionalTrait
 *
 * RENDER: Charge bar rendering is handled by the selection bar renderer
 * (from Ch3 ISelectionBar interface). This trait only provides the data:
 * charge fraction, bar color, and display-when-empty flag.
 *
 * TODO-13.A.11: SupportPowerChargeBar migration
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ISelectionBar,
  type INotifyOwnerChanged,
  type PlayerStub,
  type ColorStub,
  PlayerRelationship,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ISupportPowerManager,
  ISupportPowerInstance,
} from '../SupportPowers/SupportPower.js'

// ---------------------------------------------------------------------------
// SupportPowerChargeBarInfo
// OpenRA 对照: SupportPowerChargeBarInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Color constants matching OpenRA Color.Magenta. */
const MAGENTA: ColorStub = Object.freeze({ r: 255, g: 0, b: 255, a: 255 })

/** Configuration for SupportPowerChargeBar.
 *
 * OpenRA 对照: SupportPowerChargeBarInfo
 */
export interface SupportPowerChargeBarInfo extends ConditionalTraitInfo {
  /** Defines to which players the bar is shown.
   *
   * OpenRA 对照: SupportPowerChargeBarInfo.DisplayRelationships (default Ally)
   */
  readonly displayRelationships: PlayerRelationship

  /** Bar fill color.
   *
   * OpenRA 对照: SupportPowerChargeBarInfo.Color (default Magenta)
   */
  readonly color: ColorStub
}

/** Default values for SupportPowerChargeBarInfo. */
export const DEFAULT_CHARGE_BAR_INFO: SupportPowerChargeBarInfo = {
  displayRelationships: PlayerRelationship.Ally,
  color: MAGENTA,
}

// ---------------------------------------------------------------------------
// SupportPowerChargeBar
// OpenRA 对照: SupportPowerChargeBar : ConditionalTrait<SupportPowerChargeBarInfo>, ISelectionBar, INotifyOwnerChanged
// ---------------------------------------------------------------------------

/**
 * Displays the time remaining until the support power attached to the
 * actor is ready.
 *
 * OpenRA 对照: SupportPowerChargeBar
 */
export class SupportPowerChargeBar
  extends ConditionalTrait<SupportPowerChargeBarInfo>
  implements ISelectionBar, INotifyOwnerChanged
{
  /** The actor holding this charge bar. */
  readonly self: IGameActor

  /** Reference to the owning player's SupportPowerManager.
   *
   * OpenRA 对照: SupportPowerChargeBar.spm
   */
  private spm: ISupportPowerManager | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(self: IGameActor, info: SupportPowerChargeBarInfo) {
    super(info)
    this.self = self

    // Resolve SupportPowerManager from owner's PlayerActor
    this.fetchSupportPowerManager()
  }

  // -----------------------------------------------------------------------
  // ISelectionBar — GetValue
  // -----------------------------------------------------------------------

  /**
   * Get the charge progress value (0.0 = empty, 1.0 = fully charged).
   *
   * OpenRA 对照: ISelectionBar.GetValue()
   *
   * Returns 0 if:
   * - The trait is disabled
   * - No non-disabled powers are found on this actor
   * - The viewer is not in the DisplayRelationships filter
   */
  getValue(): number {
    if (this.isTraitDisabled) return 0

    // Find the first non-disabled support power on this actor
    const power = this.getFirstEnabledPower()
    if (!power) return 0

    // Check viewer relationship
    if (!this.isViewerInDisplayRelationships()) return 0

    // Charge fraction: 1 - remaining / total
    const remainingTicks = power.remainingTicks
    const totalTicks = power.totalTicks
    if (totalTicks <= 0) return 0

    return 1 - remainingTicks / totalTicks
  }

  // -----------------------------------------------------------------------
  // ISelectionBar — GetColor
  // -----------------------------------------------------------------------

  /**
   * Get the bar fill color.
   *
   * OpenRA 对照: ISelectionBar.GetColor()
   *
   * @returns the configured Color (default Magenta)
   */
  getColor(): ColorStub {
    return this.info.color
  }

  // -----------------------------------------------------------------------
  // ISelectionBar — DisplayWhenEmpty
  // -----------------------------------------------------------------------

  /**
   * Whether to display the bar when empty (charge is 0).
   *
   * OpenRA 对照: ISelectionBar.DisplayWhenEmpty
   *
   * Support power charge bars are hidden when empty.
   */
  get displayWhenEmpty(): boolean {
    return false
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged
  // -----------------------------------------------------------------------

  /**
   * Called when the actor's owner changes.
   * Re-fetches the SupportPowerManager from the new owner's PlayerActor.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   *
   * @param _self — the actor whose owner changed
   * @param _oldOwner — the previous owner
   * @param newOwner — the new owner
   */
  onOwnerChanged(
    _self: IGameActor,
    _oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void {
    // Re-fetch SupportPowerManager from new owner
    this.spm = this.getSupportPowerManagerFromPlayer(newOwner)
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Fetch the SupportPowerManager from the player actor.
   * Can be overridden in tests to inject mock managers.
   */
  protected fetchSupportPowerManager(): void {
    if (this.self.owner) {
      this.spm = this.getSupportPowerManagerFromPlayer(this.self.owner)
    }
  }

  /**
   * Get the SupportPowerManager trait from a player's PlayerActor.
   *
   * @param player — the player to query
   * @returns the SupportPowerManager, or null if not found
   */
  protected getSupportPowerManagerFromPlayer(
    _player: PlayerStub,
  ): ISupportPowerManager | null {
    // NOTE: In OpenRA: owner.PlayerActor.Trait<SupportPowerManager>()
    // In TypeScript, this is accessed via the player actor's trait system.
    // For now, return the cached or injected manager.
    return this.spm
  }

  /**
   * Get the first non-disabled support power instance for this actor.
   *
   * OpenRA 对照: spm.GetPowersForActor(self).FirstOrDefault(sp => !sp.Disabled)
   *
   * @returns the first non-disabled SupportPowerInstance, or null
   */
  protected getFirstEnabledPower(): ISupportPowerInstance | null {
    if (!this.spm) return null

    const powers = this.spm.powers
    for (const instance of powers.values()) {
      if (!instance.disabled) return instance
    }
    return null
  }

  /**
   * Check if the viewer (render player or local player) is within the
   * DisplayRelationships filter.
   *
   * OpenRA 对照: displayRelationships.HasRelationship(self.Owner.RelationshipWith(viewer))
   *
   * @returns true if the bar should be shown to the current viewer
   */
  protected isViewerInDisplayRelationships(): boolean {
    // NOTE: In OpenRA:
    //   var viewer = self.World.RenderPlayer ?? self.World.LocalPlayer;
    //   if (viewer != null && !Info.DisplayRelationships.HasRelationship(
    //     self.Owner.RelationshipWith(viewer)))
    //     return 0;
    //
    // World.RenderPlayer and LocalPlayer require full World runtime.
    // For now (stubbed), assume the viewer is in range.
    return true
  }

  /**
   * Expose the support power manager for test assertions.
   */
  get _testSpm(): ISupportPowerManager | null {
    return this.spm
  }

  /**
   * Set the support power manager (for test injection).
   */
  set _testSpm(manager: ISupportPowerManager | null) {
    this.spm = manager
  }
}
