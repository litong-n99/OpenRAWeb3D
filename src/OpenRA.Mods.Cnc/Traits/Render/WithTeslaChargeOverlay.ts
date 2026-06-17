/**
 * WithTeslaChargeOverlay.ts — 特斯拉充能叠加动画（充能时显示，结束后自动隐藏）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithTeslaChargeOverlay.cs (72 lines)
 *
 * 核心范式转换:
 * - C# Animation + AnimationWithOffset + RenderSprites.Add → TS duck-typed equivalents
 * - C# INotifyTeslaCharging / INotifyDamageStateChanged / INotifySold → TS same interfaces
 * - C# Animation.PlayThen with callback → TS duck-typed playThen
 * - C# RenderSprites.NormalizeSequence → TS normalizeSequence helper
 *
 * 特斯拉充能时，显示一个叠加动画（如电光效果）。充能完成后回调自动隐藏。
 * 售出时立即隐藏叠加层。损伤状态变化时更新叠加动画序列。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyTeslaCharging } from './WithTeslaChargeAnimation.js'

// ---------------------------------------------------------------------------
// DamageState enum (from TraitsInterfaces)
// ---------------------------------------------------------------------------

export const DamageState = {
  Undamaged: 0,
  Light: 1,
  Medium: 2,
  Heavy: 3,
  Critical: 4,
} as const
export type DamageState = (typeof DamageState)[keyof typeof DamageState]

/** Damage prefix mapping matching RenderSprites.DamagePrefixes.
 *
 * OpenRA 对照: RenderSprites.DamagePrefixes
 */
const DAMAGE_PREFIXES: readonly { readonly state: DamageState; readonly prefix: string }[] = [
  { state: DamageState.Critical, prefix: 'critical-' },
  { state: DamageState.Heavy, prefix: 'damaged-' },
  { state: DamageState.Medium, prefix: 'scratched-' },
  { state: DamageState.Light, prefix: 'scuffed-' },
]

/** Normalize a sequence name for the current damage state.
 *
 * OpenRA 对照: RenderSprites.NormalizeSequence(Animation, DamageState, string)
 *
 * Prepend damage prefix if the damage-prefixed sequence exists.
 */
function normalizeSequence(
  anim: ITeslaOverlayAnimation,
  damageState: number,
  sequence: string,
): string {
  for (const { state, prefix } of DAMAGE_PREFIXES) {
    if (damageState >= state) {
      const candidate = prefix + sequence
      if (anim.hasSequence(candidate)) return candidate
    }
  }
  return sequence
}

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface for overlay playback.
 *
 * OpenRA 对照: Animation
 */
export interface ITeslaOverlayAnimation {
  readonly name: string
  readonly currentSequence: { readonly name: string }
  hasSequence(sequence: string): boolean
  playThen(sequence: string, onComplete: () => void): void
}

/** Minimal RenderSprites interface.
 *
 * OpenRA 对照: RenderSprites
 */
export interface ITeslaOverlayRenderSprites {
  add(
    anim: unknown,
    palette?: string | null,
    isPlayerPalette?: boolean,
  ): void
  getImage(self: IGameActor): string
}

/** Minimal AnimationWithOffset handle.
 *
 * OpenRA 对照: AnimationWithOffset
 */
export interface ITeslaOverlayAnimWithOffset {
  // opaque
}

// ---------------------------------------------------------------------------
// WithTeslaChargeOverlayInfo
// OpenRA 对照: WithTeslaChargeOverlayInfo : TraitInfo, Requires<RenderSpritesInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithTeslaChargeOverlay.
 *
 * OpenRA 对照: WithTeslaChargeOverlayInfo
 */
export class WithTeslaChargeOverlayInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Sequence name to use (default "active").
   *
   * OpenRA 对照: WithTeslaChargeOverlayInfo.Sequence
   */
  readonly sequence: string

  /** Custom palette name.
   *
   * OpenRA 对照: WithTeslaChargeOverlayInfo.Palette
   */
  readonly palette: string | null

  /** Custom palette is a player palette BaseName.
   *
   * OpenRA 对照: WithTeslaChargeOverlayInfo.IsPlayerPalette (default false)
   */
  readonly isPlayerPalette: boolean

  constructor(params: {
    instanceName?: string
    sequence?: string
    palette?: string | null
    isPlayerPalette?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.sequence = params.sequence ?? 'active'
    this.palette = params.palette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithTeslaChargeOverlayInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithTeslaChargeOverlay {
    return new WithTeslaChargeOverlay(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithTeslaChargeOverlay
// OpenRA 对照: WithTeslaChargeOverlay : INotifyTeslaCharging, INotifyDamageStateChanged, INotifySold
// ---------------------------------------------------------------------------

/** Renders a charge overlay animation together with AttackTesla.
 *
 * OpenRA 对照: WithTeslaChargeOverlay
 *
 * The overlay animation is added to RenderSprites with a visibility
 * function that returns true (hidden) when the actor is not charging.
 */
export class WithTeslaChargeOverlay implements INotifyTeslaCharging {
  readonly info: WithTeslaChargeOverlayInfo
  private readonly _overlay: ITeslaOverlayAnimation
  private readonly _renderSprites: ITeslaOverlayRenderSprites

  /** Whether the actor is currently charging.
   *
   * OpenRA 对照: WithTeslaChargeOverlay.charging
   */
  private _charging: boolean = false

  constructor(self: IGameActor, info: WithTeslaChargeOverlayInfo) {
    this.info = info
    this._renderSprites = (self as any).trait?.('RenderSprites') as ITeslaOverlayRenderSprites

    // Create the overlay animation
    // C#: overlay = new Animation(init.World, renderSprites.GetImage(init.Self));
    const image = this._renderSprites?.getImage?.(self) ?? ''
    this._overlay = {
      name: image,
      currentSequence: { name: '' },
      hasSequence(_seq: string): boolean {
        return true // Duck-typed
      },
      playThen(seq: string, onComplete: () => void): void {
        void seq
        setTimeout(onComplete, 100) // Simulate animation
      },
    }

    // Register with RenderSprites
    // C#: renderSprites.Add(new AnimationWithOffset(overlay, null, () => !charging), info.Palette, info.IsPlayerPalette);
    if (this._renderSprites?.add) {
      this._renderSprites.add(
        {
          _visibleFn: () => !this._charging,
        },
        info.palette,
        info.isPlayerPalette,
      )
    }
  }

  // -------------------------------------------------------------------------
  // INotifyTeslaCharging
  // 对照: INotifyTeslaCharging.Charging(Actor self, in Target target)
  // -------------------------------------------------------------------------

  /** Start charge overlay when Tesla begins charging.
   *
   * OpenRA 对照: INotifyTeslaCharging.Charging(Actor, in Target)
   */
  charging(self: IGameActor, _target: unknown): void {
    this._charging = true
    const damageState = (self as any).getDamageState?.() ?? DamageState.Undamaged
    const sequence = normalizeSequence(this._overlay, damageState, this.info.sequence)
    this._overlay.playThen(sequence, () => {
      this._charging = false
    })
  }

  // -------------------------------------------------------------------------
  // INotifyDamageStateChanged
  // 对照: INotifyDamageStateChanged.DamageStateChanged(Actor, AttackInfo)
  // -------------------------------------------------------------------------

  /** Update overlay sequence when damage state changes.
   *
   * OpenRA 对照: INotifyDamageStateChanged.DamageStateChanged(Actor, AttackInfo)
   *
   * @param _self — the actor
   * @param e — attack info containing the new damage state
   */
  damageStateChanged(_self: IGameActor, e: { readonly damageState: number }): void {
    const sequence = normalizeSequence(this._overlay, e.damageState, this.info.sequence)
    if (this._overlay.currentSequence.name !== sequence) {
      ;(this._overlay as any).replaceAnim?.(sequence)
    }
  }

  // -------------------------------------------------------------------------
  // INotifySold
  // 对照: INotifySold.Sold / Selling
  // -------------------------------------------------------------------------

  /** No-op: nothing to do on sold completion.
   *
   * OpenRA 对照: INotifySold.Sold(Actor)
   */
  sold(_self: IGameActor): void {
    // Intentional no-op
  }

  /** Stop charging when actor begins selling.
   *
   * OpenRA 对照: INotifySold.Selling(Actor)
   */
  selling(_self: IGameActor): void {
    this._charging = false
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the overlay is currently charging.
   *
   * OpenRA 对照: WithTeslaChargeOverlay.charging
   */
  get isCharging(): boolean {
    return this._charging
  }

  /** Set charging state (for testing). */
  setCharging(value: boolean): void {
    this._charging = value
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
