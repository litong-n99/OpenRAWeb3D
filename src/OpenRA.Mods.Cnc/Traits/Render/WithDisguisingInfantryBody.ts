/**
 * WithDisguisingInfantryBody.ts — 伪装步兵身体（伪装时切换到伪装对象的序列和图像）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithDisguisingInfantryBody.cs (78 lines)
 *
 * 核心范式转换:
 * - C# WithInfantryBody (base class with virtual GetDisplayInfo/Tick) → TS duck-typed base
 * - C# Disguise trait (AsActor, AsPlayer, AsFaction) → TS duck-typed Disguise
 * - C# Game.CosmeticRandom → TS Math.random (fine for cosmetic purposes)
 * - C# RenderSprites.UpdatePalette → TS duck-typed palette update
 *
 * 当步兵伪装时，会检测伪装目标的渲染信息和步兵身体信息，
 * 然后切换到伪装对象的图像和站立序列，实现视觉伪装效果。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal Animation interface.
 *
 * OpenRA 对照: Animation
 */
export interface IDisguiseAnimation {
  readonly name: string
  readonly currentSequence: { readonly name: string }
  getRandomExistingSequence(
    sequences: readonly string[],
    rng: { random(): number },
  ): string | null
  changeImage(image: string, sequence: string): void
  playFetchIndex(sequence: string, indexFn: () => number): void
}

/** Minimal RenderSprites interface.
 *
 * OpenRA 对照: RenderSprites
 */
export interface IDisguiseRenderSprites {
  getImage(self: IGameActor): string
  updatePalette(): void
}

/** Minimal Disguise trait interface.
 *
 * OpenRA 对照: Disguise
 */
export interface IDisguiseAccess {
  readonly asActor: { traitInfoOrDefault?(name: string): unknown } & Record<string, unknown> | null
  readonly asPlayer: { readonly faction?: { readonly internalName: string } } & Record<string, unknown> | null
}

/** Minimal WithInfantryBodyInfo-like trait info.
 *
 * OpenRA 对照: WithInfantryBodyInfo
 */
export interface IInfantryBodyInfoStub {
  readonly name: string
  readonly enabledByDefault: boolean
  readonly standSequences?: readonly string[]
}

/** Minimal RenderSpritesInfo-like trait info.
 *
 * OpenRA 对照: RenderSpritesInfo
 */
export interface IRenderSpritesInfoStub {
  readonly name: string
  getImage?(actor: unknown, factionInternalName: string): string
}

/** Minimal WithInfantryBody base trait.
 *
 * OpenRA 对照: WithInfantryBody
 */
export interface IDisguiseInfantryBody {
  readonly info: { readonly name: string; readonly standSequences: readonly string[] }
  readonly defaultAnimation: IDisguiseAnimation
  readonly renderSprites: IDisguiseRenderSprites
  playStandAnimation(self: IGameActor): void
  tick(self: IGameActor): void
  getDisplayInfo(): IInfantryBodyInfoStub & Record<string, unknown>
}

// ---------------------------------------------------------------------------
// WithDisguisingInfantryBodyInfo
// OpenRA 对照: WithDisguisingInfantryBodyInfo : WithInfantryBodyInfo, Requires<DisguiseInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithDisguisingInfantryBody.
 *
 * OpenRA 对照: WithDisguisingInfantryBodyInfo
 */
export class WithDisguisingInfantryBodyInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly enabledByDefault: boolean

  /** Stand animation sequences to choose from.
   *
   * OpenRA 对照: WithInfantryBodyInfo.StandSequences (default ["stand"])
   */
  readonly standSequences: readonly string[]

  constructor(params: {
    instanceName?: string
    enabledByDefault?: boolean
    standSequences?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.enabledByDefault = params.enabledByDefault ?? true
    this.standSequences = params.standSequences ?? ['stand']
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithDisguisingInfantryBodyInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithDisguisingInfantryBody {
    return new WithDisguisingInfantryBody(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithDisguisingInfantryBody
// OpenRA 对照: WithDisguisingInfantryBody : WithInfantryBody
// ---------------------------------------------------------------------------

/** Infantry body that changes rendering when disguised.
 *
 * OpenRA 对照: WithDisguisingInfantryBody
 *
 * Monitors the Disguise trait for changes. When the disguise target changes,
 * updates the animation image and sequence to match the disguise target,
 * selecting a random stand sequence from the target's StandSequences.
 */
export class WithDisguisingInfantryBody {
  readonly info: WithDisguisingInfantryBodyInfo
  private readonly _body: IDisguiseInfantryBody
  private readonly _disguise: IDisguiseAccess
  private readonly _renderSprites: IDisguiseRenderSprites

  /** Previous disguise target reference, used to detect changes.
   *
   * OpenRA 对照: WithDisguisingInfantryBody.disguiseActor / disguisePlayer
   */
  private _prevDisguiseActor: unknown = null
  private _prevDisguisePlayer: unknown = null
  private _disguiseImage: string | null = null
  private _disguiseInfantryBody: IInfantryBodyInfoStub | null = null

  constructor(self: IGameActor, info: WithDisguisingInfantryBodyInfo) {
    this.info = info
    this._body = (self as any) as IDisguiseInfantryBody
    this._disguise = (self as any).trait?.('Disguise') as IDisguiseAccess
    this._renderSprites = (self as any).trait?.('RenderSprites') as IDisguiseRenderSprites
  }

  // -------------------------------------------------------------------------
  // GetDisplayInfo (overrides WithInfantryBody.GetDisplayInfo)
  // 对照: GetDisplayInfo() override
  // -------------------------------------------------------------------------

  /** Return the disguised infantry body info, or the original if not disguised.
   *
   * OpenRA 对照: WithDisguisingInfantryBody.GetDisplayInfo()
   */
  getDisplayInfo(): IInfantryBodyInfoStub {
    return this._disguiseInfantryBody ?? this._body.getDisplayInfo()
  }

  // -------------------------------------------------------------------------
  // Tick (overrides WithInfantryBody.Tick)
  // 对照: WithDisguisingInfantryBody.Tick(Actor self)
  // -------------------------------------------------------------------------

  /** Check for disguise changes and update rendering accordingly.
   *
   * OpenRA 对照: WithDisguisingInfantryBody.Tick(Actor self)
   *
   * @param self — the actor
   */
  tick(self: IGameActor): void {
    const disguise = this._disguise

    if (
      disguise.asActor !== this._prevDisguiseActor ||
      disguise.asPlayer !== this._prevDisguisePlayer
    ) {
      // Force actor back to stand state to avoid mismatched sequences
      this._body.playStandAnimation(self)

      this._prevDisguiseActor = disguise.asActor
      this._prevDisguisePlayer = disguise.asPlayer
      this._disguiseImage = null
      this._disguiseInfantryBody = null

      if (disguise.asPlayer) {
        const disguiseActor = disguise.asActor as
          | { traitInfoOrDefault?(name: string): unknown; traitInfos?(name: string): IInfantryBodyInfoStub[] }
          | null

        // C#: var renderSprites = disguiseActor.TraitInfoOrDefault<RenderSpritesInfo>();
        // Look up disguised actor's RenderSprites info
        const rsInfo = disguiseActor?.traitInfoOrDefault?.('RenderSprites') as IRenderSpritesInfoStub | null

        // C#: var infantryBody = disguiseActor.TraitInfos<WithInfantryBodyInfo>()
        //   .FirstOrDefault(t => t.EnabledByDefault);
        const infantries = disguiseActor?.traitInfos?.('WithInfantryBody') ?? []
        const infantryBody = infantries.find((t: IInfantryBodyInfoStub) => t.enabledByDefault)

        if (rsInfo && infantryBody && disguise.asPlayer?.faction?.internalName) {
          this._disguiseImage =
            rsInfo.getImage?.(disguiseActor, disguise.asPlayer.faction.internalName) ?? null
          this._disguiseInfantryBody = infantryBody as IInfantryBodyInfoStub
        }
      }

      // Select a random stand sequence
      const displayInfo = this.getDisplayInfo()
      const standSeqs = displayInfo.standSequences ?? this.info.standSequences
      const sequence = this._body.defaultAnimation.getRandomExistingSequence(
        standSeqs,
        { random: () => Math.random() },
      )
      if (sequence) {
        this._body.defaultAnimation.changeImage(
          this._disguiseImage ?? this._renderSprites.getImage(self),
          sequence,
        )
      }

      this._renderSprites.updatePalette()
    }

    // Call base tick
    this._body.tick(self)
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Current disguise image. */
  get disguiseImage(): string | null {
    return this._disguiseImage
  }

  /** Current disguise infantry body info. */
  get disguiseInfantryBody(): IInfantryBodyInfoStub | null {
    return this._disguiseInfantryBody
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
