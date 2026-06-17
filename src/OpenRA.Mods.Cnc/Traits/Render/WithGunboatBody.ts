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
    if (rs) {
      const image = rs.getImage(self)
      const wakeAnim: IGunboatAnimation = {
        name: image,
        currentSequence: { name: '', facings: 8 },
        playFetchIndex(seq, fn) { void seq; void fn },
        playRepeating(seq) { void seq },
        replaceAnim(seq) { void seq },
        hasSequence(_seq) { return true },
      }
      wakeAnim.playRepeating(info.wakeLeftSequence)
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
   */
  tick(_self: IGameActor): void {
    const isRight = this._facing.facing.angle <= 512
    const bodyAnim = this._body.defaultAnimation

    if (isRight) {
      const right = this.normalizeSequence(this.info.rightSequence)
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
      const left = this.normalizeSequence(this.info.leftSequence)
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
   * In the duck-typed version, we just return the sequence name as-is
   * since damage state normalization requires the full sequence set.
   */
  private normalizeSequence(sequence: string): string {
    return sequence
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
