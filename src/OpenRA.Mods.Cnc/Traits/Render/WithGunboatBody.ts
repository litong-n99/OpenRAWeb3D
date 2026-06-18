/**
 * WithGunboatBody.ts — 炮艇精灵主体（左右朝向+尾波动画）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithGunboatBody.cs (98 lines)
 *
 * 核心范式转换:
 * - C# WithSpriteBody (base class with ITick) → TS duck-typed base
 * - C# IFacing.Facing.Angle <= 512 判断朝向 → TS WAngle comparison
 * - C# Animation.ReplaceAnim → TS duck-typed replaceAnim
 * - C# RenderSprites.Add wake animation → TS duck-typed registration
 *
 * 炮艇是 TD (Tiberian Dawn) 中的特殊海军单位。它的精灵有左右两个方向，
 * 以及对应的左/右尾波动画。当朝向改变时，会替换为匹配的动画序列。
 */

import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Damage state constants (corresponds to OpenRA DamageState)
// ---------------------------------------------------------------------------

/** Damage state levels for sequence normalization.
 *
 * OpenRA 对照: DamageState enum (OpenRA.Game/Traits/TraitsInterfaces.cs)
 *
 * Ordered from highest to lowest severity for prefix priority.
 * NormalizeSequence checks from Critical down to Light — the first
 * matching damage-prefixed sequence wins.
 */
export const GunboatDamageState = {
  Undamaged: 0,
  Light: 1,
  Medium: 2,
  Heavy: 3,
  Critical: 4,
} as const
export type GunboatDamageState = (typeof GunboatDamageState)[keyof typeof GunboatDamageState]

/** Damage prefixes ordered from highest to lowest severity.
 *
 * OpenRA 对照: RenderSprites.DamagePrefixes (RenderSprites.cs:84-90)
 *
 * When normalizing a sequence name, these prefixes are tried in order.
 * The first prefix whose damage threshold is met AND whose sequence exists
 * on the animation is used.
 */
const DAMAGE_PREFIXES: readonly { readonly state: GunboatDamageState; readonly prefix: string }[] = [
  { state: GunboatDamageState.Critical, prefix: 'critical-' },
  { state: GunboatDamageState.Heavy, prefix: 'damaged-' },
  { state: GunboatDamageState.Medium, prefix: 'scratched-' },
  { state: GunboatDamageState.Light, prefix: 'scuffed-' },
]

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface.
 *
 * OpenRA 对照: Animation
 */
export interface IGunboatAnimation {
  readonly name: string
  readonly currentSequence: { readonly name: string; readonly facings: number }
  playFetchIndex(sequence: string, indexFn: () => number): void
  playRepeating(sequence: string): void
  replaceAnim(sequence: string): void
  hasSequence(sequence: string): boolean
}

/** Minimal IFacing trait.
 *
 * OpenRA 对照: IFacing
 */
export interface IGunboatFacing {
  readonly facing: WAngle
}

/** Minimal Turreted trait.
 *
 * OpenRA 对照: Turreted
 */
export interface IGunboatTurreted {
  readonly name: string
  readonly worldOrientation: { readonly yaw: WAngle }
  quantizedFacings: number
}

/** Minimal RenderSprites trait.
 *
 * OpenRA 对照: RenderSprites
 */
export interface IGunboatRenderSprites {
  getImage(self: IGameActor): string
  add(
    anim: unknown,
    palette?: string | null,
    isPlayerPalette?: boolean,
  ): void
}

/** Minimal AnimationWithOffset handle.
 *
 * OpenRA 对照: AnimationWithOffset
 */
export interface IGunboatAnimWithOffset {
  // opaque
}

// ---------------------------------------------------------------------------
// WithGunboatBodyInfo
// OpenRA 对照: WithGunboatBodyInfo : WithSpriteBodyInfo, Requires<BodyOrientationInfo>, Requires<IFacingInfo>, Requires<TurretedInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithGunboatBody.
 *
 * OpenRA 对照: WithGunboatBodyInfo
 */
export class WithGunboatBodyInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly enabledByDefault: boolean

  /** Turreted 'Turret' key to display (default "primary").
   *
   * OpenRA 对照: WithGunboatBodyInfo.Turret
   */
  readonly turret: string

  /** Sequence for left-facing (default "left").
   *
   * OpenRA 对照: WithGunboatBodyInfo.LeftSequence
   */
  readonly leftSequence: string

  /** Sequence for right-facing (default "right").
   *
   * OpenRA 对照: WithGunboatBodyInfo.RightSequence
   */
  readonly rightSequence: string

  /** Wake sequence for left-facing (default "wake-left").
   *
   * OpenRA 对照: WithGunboatBodyInfo.WakeLeftSequence
   */
  readonly wakeLeftSequence: string

  /** Wake sequence for right-facing (default "wake-right").
   *
   * OpenRA 对照: WithGunboatBodyInfo.WakeRightSequence
   */
  readonly wakeRightSequence: string

  constructor(params: {
    instanceName?: string
    enabledByDefault?: boolean
    turret?: string
    leftSequence?: string
    rightSequence?: string
    wakeLeftSequence?: string
    wakeRightSequence?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.enabledByDefault = params.enabledByDefault ?? true
    this.turret = params.turret ?? 'primary'
    this.leftSequence = params.leftSequence ?? 'left'
    this.rightSequence = params.rightSequence ?? 'right'
    this.wakeLeftSequence = params.wakeLeftSequence ?? 'wake-left'
    this.wakeRightSequence = params.wakeRightSequence ?? 'wake-right'
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithGunboatBodyInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithGunboatBody {
    return new WithGunboatBody(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithGunboatBody
// OpenRA 对照: WithGunboatBody : WithSpriteBody, ITick
// ---------------------------------------------------------------------------

/** Gunboat sprite body with left/right facing and wake animation.
 *
 * OpenRA 对照: WithGunboatBody
 *
 * On each tick, checks the facing angle to determine left vs right.
 * Updates both the body animation and the wake animation accordingly.
 */
export class WithGunboatBody {
  readonly info: WithGunboatBodyInfo
  private readonly _facing: IGunboatFacing
  private readonly _turret: IGunboatTurreted
  private readonly _body: {
    readonly info: { readonly name: string }
    readonly defaultAnimation: IGunboatAnimation
  }

  /** The wake animation instance.
   *
   * OpenRA 对照: WithGunboatBody.wake (Animation field)
   */
  private _wakeAnimation: IGunboatAnimation | null = null

  constructor(self: IGameActor, info: WithGunboatBodyInfo) {
    this.info = info
    const rs = (self as any).trait?.('RenderSprites') as IGunboatRenderSprites | null
    this._facing = (self as any).trait?.('IFacing') as IGunboatFacing

    // Find the named turret
    const turrets = (self as any).traitsImplementing?.('Turreted') as IGunboatTurreted[] | undefined
    const matchedTurret = turrets?.find((t) => t.name === info.turret)
    if (!matchedTurret) {
      throw new Error(
        `WithGunboatBody requires a Turreted trait with name="${info.turret}"`,
      )
    }
    this._turret = matchedTurret

    // Duck-typed body reference
    this._body = (self as any) as { readonly info: { readonly name: string }; readonly defaultAnimation: IGunboatAnimation }

    // Create the wake animation
    // C#: wake = new Animation(init.World, name); wake.PlayRepeating(info.WakeLeftSequence);
    // The wake animation tracks its current sequence via a mutable state object,
    // matching OpenRA's Animation.CurrentSequence.Name tracking for ReplaceAnim.
    if (rs) {
      const image = rs.getImage(self)
      const wakeSeqState = { name: info.wakeLeftSequence, facings: 8 }
      const wakeAnim: IGunboatAnimation = {
        name: image,
        currentSequence: wakeSeqState,
        playFetchIndex(seq, fn) { void seq; void fn },
        playRepeating(seq) { wakeSeqState.name = seq },
        replaceAnim(seq) {
          wakeSeqState.name = seq
          // In production, would delegate to Animation.ReplaceAnim(seq)
          // which looks up the sequence, resets timeUntilNextFrame,
          // and adjusts frame position modulo the new sequence length.
        },
        hasSequence(_seq) { return true },
      }
      this._wakeAnimation = wakeAnim

      // Register wake with RenderSprites
      rs.add(
        {
          _anim: wakeAnim,
          _zOffset: -87,
        },
        null,
        false,
      )
    }
  }

  // -------------------------------------------------------------------------
  // TraitEnabled (overrides base)
  // 对照: TraitEnabled(Actor self)
  // -------------------------------------------------------------------------

  /** Update turret quantized facings when trait is enabled.
   *
   * OpenRA 对照: WithGunboatBody.TraitEnabled(Actor)
   */
  traitEnabled(_self: IGameActor): void {
    this._turret.quantizedFacings =
      this._body.defaultAnimation.currentSequence.facings
  }

  // -------------------------------------------------------------------------
  // ITick
  // 对照: ITick.Tick(Actor self)
  // -------------------------------------------------------------------------

  /** Update animations based on facing direction.
   *
   * OpenRA 对照: WithGunboatBody.ITick.Tick(Actor self)
   *
   * The cutoff is `facing.Angle <= 512` (half of 1024 WAngle units).
   * This maps to: angle 0-512 (right half) vs 513-1023 (left half).
   *
   * Sequence names are normalized through the damage-prefix lookup
   * (critical, damaged, scratched, scuffed) to support damaged-state
   * sprite variants for gunboats.
   */
  tick(self: IGameActor): void {
    const isRight = this._facing.facing.angle <= 512
    const bodyAnim = this._body.defaultAnimation

    if (isRight) {
      const right = this.normalizeSequence(self, this.info.rightSequence)
      if (bodyAnim.currentSequence.name !== right) {
        bodyAnim.replaceAnim(right)
      }
      if (
        this._wakeAnimation &&
        this._wakeAnimation.currentSequence.name !== this.info.wakeRightSequence
      ) {
        this._wakeAnimation.replaceAnim(this.info.wakeRightSequence)
      }
    } else {
      const left = this.normalizeSequence(self, this.info.leftSequence)
      if (bodyAnim.currentSequence.name !== left) {
        bodyAnim.replaceAnim(left)
      }
      if (
        this._wakeAnimation &&
        this._wakeAnimation.currentSequence.name !== this.info.wakeLeftSequence
      ) {
        this._wakeAnimation.replaceAnim(this.info.wakeLeftSequence)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Normalize a sequence name for the current damage state.
   *
   * OpenRA 对照: WithSpriteBody.NormalizeSequence (calls RenderSprites.NormalizeSequence)
   *
   * The normalization process:
   * 1. Strip any existing damage prefix from the sequence name (unnormalize)
   * 2. Get the actor's damage state via getDamageState()
   * 3. For each damage prefix (from highest to lowest severity), check if
   *    the damage state meets the threshold AND the defaultAnimation has
   *    the damage-prefixed sequence
   * 4. Return the first match, or the unnormalized sequence if no match
   *
   * Damage prefixes: critical- > damaged- > scratched- > scuffed-
   *
   * @param self — the actor (used to query damage state)
   * @param sequence — the sequence name to normalize
   * @returns the normalized sequence name with appropriate damage prefix
   */
  normalizeSequence(self: IGameActor, sequence: string): string {
    // Step 1: Remove existing damage prefix (unnormalize)
    let unnormalized = sequence
    for (const { prefix } of DAMAGE_PREFIXES) {
      if (unnormalized.startsWith(prefix)) {
        unnormalized = unnormalized.slice(prefix.length)
        break
      }
    }

    // Step 2: Get the actor's damage state
    const damageState: number =
      (self as any).getDamageState?.() ?? GunboatDamageState.Undamaged
    const anim = this._body.defaultAnimation

    // Step 3: Try damage prefixes from highest to lowest severity
    for (const { state, prefix } of DAMAGE_PREFIXES) {
      if (damageState >= state && anim.hasSequence(prefix + unnormalized)) {
        return prefix + unnormalized
      }
    }

    // Step 4: No damage-prefixed sequence found, return unnormalized
    return unnormalized
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** The turret being driven. */
  get turret(): IGunboatTurreted {
    return this._turret
  }

  /** The wake animation instance. */
  get wakeAnimation(): IGunboatAnimation | null {
    return this._wakeAnimation
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
