/**
 * WithCrumbleOverlay.ts — D2K 建筑低血量崩塌覆盖动画
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/Render/WithCrumbleOverlay.cs (68 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<WithCrumbleOverlayInfo> + Requires<RenderSpritesInfo>
 *   → TS ConditionalTrait<WithCrumbleOverlayInfo> (already migrated)
 * - C# Animation + AnimationWithOffset + renderSprites.Add()
 *   → TS Animation + AnimationWithOffset + RenderSprites.add()
 * - C# SkipMakeAnimsInit check → TS init parameter check
 * - C# World.AddFrameEndTask(w => renderSprites.Remove(animation))
 *   → TS self.World.addFrameEndTask callback
 */

import {
  ConditionalTrait,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Animation } from '../../../OpenRA.Game/Graphics/Animation.js'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'

// ---------------------------------------------------------------------------
// Minimized RenderSprites interface (duck-typed, to avoid circular dep)
// ---------------------------------------------------------------------------

interface IRenderSpritesMinimal {
  getImage(actor: IGameActor): string
  add(anim: AnimationWithOffset, palette?: string | null, isPlayerPalette?: boolean): void
  remove(anim: AnimationWithOffset): void
}

// ---------------------------------------------------------------------------
// SkipMakeAnimsInit — marker init
// 对应 OpenRA SkipMakeAnimsInit
// ---------------------------------------------------------------------------

/** Marker for skipping "make" animations during actor creation.
 *
 * OpenRA 对照: SkipMakeAnimsInit
 */
export class SkipMakeAnimsInit {
  readonly name = 'SkipMakeAnimsInit'
}

// ---------------------------------------------------------------------------
// WithCrumbleOverlayInfo
// ---------------------------------------------------------------------------

/** Configuration for the crumble overlay trait.
 *
 * OpenRA 对照: WithCrumbleOverlayInfo : ConditionalTraitInfo, Requires<RenderSpritesInfo>
 */
export class WithCrumbleOverlayInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Sequence name to use for the crumble overlay.
   *
   * OpenRA 对照: WithCrumbleOverlayInfo.Sequence
   */
  readonly sequence: string

  /** Custom palette name.
   *
   * OpenRA 对照: WithCrumbleOverlayInfo.Palette
   */
  readonly palette: string | null

  /** Whether the custom palette is a player palette BaseName.
   *
   * OpenRA 对照: WithCrumbleOverlayInfo.IsPlayerPalette
   */
  readonly isPlayerPalette: boolean

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    sequence?: string
    palette?: string | null
    isPlayerPalette?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.sequence = params.sequence ?? 'crumble-overlay'
    this.palette = params.palette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
  }
}

// ---------------------------------------------------------------------------
// WithCrumbleOverlay
// ---------------------------------------------------------------------------

/** Renders a crumble overlay animation when the building is at low HP.
 *
 * OpenRA 对照: WithCrumbleOverlay : ConditionalTrait<WithCrumbleOverlayInfo>
 *
 * The overlay animation plays once and then auto-removes itself.
 * SkipMakeAnimsInit suppresses overlay when the actor is first constructed
 * (makes the "make" animation look clean).
 */
export class WithCrumbleOverlay extends ConditionalTrait<WithCrumbleOverlayInfo> {
  readonly info: WithCrumbleOverlayInfo

  private readonly _renderSprites: IRenderSpritesMinimal | null
  private readonly _overlay: Animation | null
  private readonly _animation: AnimationWithOffset | null

  constructor(
    init: { self: IGameActor; world?: { sequenceProvider?: unknown }; contains?: (name: string) => boolean },
    info: WithCrumbleOverlayInfo,
  ) {
    super(info)
    this.info = info

    // Skip if SkipMakeAnimsInit is present
    if (init.contains?.('SkipMakeAnimsInit')) {
      this._renderSprites = null
      this._overlay = null
      this._animation = null
      return
    }

    const self = init.self
    const rs = (self as unknown as Record<string, unknown>)['RenderSprites'] as IRenderSpritesMinimal | undefined
    if (!rs) {
      this._renderSprites = null
      this._overlay = null
      this._animation = null
      return
    }
    this._renderSprites = rs

    // Create overlay animation
    const image = rs.getImage(self)
    const world = self.world as unknown as {
      addFrameEndTask?: (fn: (w: unknown) => void) => void
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AnimationCtor = ((self as any).constructor as any).__worldAnimationClass as { new(world: unknown, image: string): Animation } | undefined
    // Fallback: create a minimal animation-like object
    const overlay: Animation = AnimationCtor
      ? new AnimationCtor(world, image)
      : createMinimalAnimation(image)

    this._overlay = overlay

    this._animation = new AnimationWithOffset(
      overlay,
      null, // offset function (no offset)
      () => this.isTraitDisabled,
    )
  }

  // -----------------------------------------------------------------------
  // TraitEnabled (对应 OpenRA WithCrumbleOverlay.TraitEnabled)
  // -----------------------------------------------------------------------

  /** Called when the trait is enabled (condition satisfied).
   *
   * OpenRA 对照: WithCrumbleOverlay.TraitEnabled(Actor self)
   *
   * Adds the overlay animation to RenderSprites, plays once,
   * and auto-removes when complete.
   */
  protected override traitEnabled(self: IGameActor): void {
    if (!this._overlay || !this._animation || !this._renderSprites) return

    this._renderSprites.add(
      this._animation,
      this.info.palette,
      this.info.isPlayerPalette,
    )

    // Remove the animation once it is complete
    const overlay = this._overlay
    const animation = this._animation
    const rs = this._renderSprites

    // HACK: Use setTimeout-like frame-end task to auto-remove
    // In full migration, self.World.AddFrameEndTask() is used
    overlay.playThen?.(this.info.sequence, () => {
      const w = self.world as unknown as { addFrameEndTask?: (fn: (w: unknown) => void) => void }
      if (w.addFrameEndTask) {
        w.addFrameEndTask(() => {
          rs.remove(animation)
        })
      } else {
        rs.remove(animation)
      }
    })
  }

  // -----------------------------------------------------------------------
  // TraitDisabled (对应 OpenRA WithCrumbleOverlay.TraitDisabled)
  // -----------------------------------------------------------------------

  /** Called when the trait is disabled (condition revoked).
   *
   * OpenRA 对照: ConditionalTrait.TraitDisabled(Actor self)
   */
  protected override traitDisabled(_self: IGameActor): void {
    if (this._animation && this._renderSprites) {
      this._renderSprites.remove(this._animation)
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal Animation factory (for environments without full Animation class)
// ---------------------------------------------------------------------------

/** Create a minimal Animation-like object for testing/stub environments.
 *
 * OpenRA 对照: OpenRA.Game.Graphics.Animation
 *
 * @param _image — the sprite image name
 * @returns a duck-typed Animation object
 */
function createMinimalAnimation(_image: string): Animation {
  const obj = {
    image: _image,
    currentSequence: null as { name: string } | null,
    hasSequence(_seq: string): boolean { return true },
    play(_seq: string): void { obj.currentSequence = { name: _seq } },
    playThen(_seq: string, callback: () => void): void {
      obj.currentSequence = { name: _seq }
      callback()
    },
    tick(): void { /* no-op */ },
  }
  return obj as unknown as Animation
}

/** Type guard for checking if a value is an IGameActor with RenderSprites.
 *
 * @param actor — the actor to check
 */
export function hasRenderSprites(actor: unknown): actor is { RenderSprites: unknown } {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    'RenderSprites' in (actor as Record<string, unknown>)
  )
}
