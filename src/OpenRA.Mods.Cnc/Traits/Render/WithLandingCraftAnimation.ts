/**
 * WithLandingCraftAnimation.ts — 登陆艇开合动画（靠近沙滩时打开舱门）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithLandingCraftAnimation.cs (97 lines)
 *
 * 核心范式转换:
 * - C# ITick + IMove + Cargo + WithSpriteBody → TS duck-typed equivalents
 * - C# HashSet<string> OpenTerrainTypes → TS ReadonlySet<string>
 * - C# WithSpriteBody.PlayCustomAnimation / PlayCustomAnimationRepeating → TS duck-typed
 * - C# MovementType.None check → TS duck-typed movement type
 *
 * 登陆艇在靠近开放地形（如沙滩）时自动打开舱门（OpenSequence），
 * 打开后循环播放卸载动画（UnloadSequence）。离开时则播放关闭动画。
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MovementType = {
  None: 0,
  Horizontal: 1,
  Vertical: 2,
  Turn: 4,
} as const
export type MovementType = (typeof MovementType)[keyof typeof MovementType]

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

/** Minimal IMove interface.
 *
 * OpenRA 对照: IMove
 */
export interface ILandingCraftMove {
  readonly currentMovementTypes: MovementType
}

/** Minimal Cargo interface.
 *
 * OpenRA 对照: Cargo
 */
export interface ILandingCraftCargo {
  currentAdjacentCells(): unknown[]
}

/** Minimal WithSpriteBody interface.
 *
 * OpenRA 对照: WithSpriteBody
 */
export interface ILandingCraftSpriteBody {
  readonly info: { readonly name: string }
  readonly defaultAnimation: {
    readonly name: string
    readonly currentSequence: { readonly name: string }
    hasSequence(sequence: string): boolean
    replaceAnim(sequence: string): void
  }
  playCustomAnimation(
    self: IGameActor,
    sequence: string,
    onComplete?: () => void,
  ): void
  playCustomAnimationRepeating(self: IGameActor, sequence: string): void
}

/** Minimal Map interface.
 *
 * OpenRA 对照: Map
 */
export interface ILandingCraftMap {
  contains(cell: unknown): boolean
  distanceAboveTerrain(pos: unknown): { length: number }
  getTerrainInfo(cell: unknown): { type: string }
}

// ---------------------------------------------------------------------------
// WithLandingCraftAnimationInfo
// OpenRA 对照: WithLandingCraftAnimationInfo : TraitInfo, Requires<IMoveInfo>, Requires<WithSpriteBodyInfo>, Requires<CargoInfo>
// ---------------------------------------------------------------------------

/** Configuration for WithLandingCraftAnimation.
 *
 * OpenRA 对照: WithLandingCraftAnimationInfo
 */
export class WithLandingCraftAnimationInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Terrain types that the landing craft can open on.
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.OpenTerrainTypes (FrozenSet<string>)
   */
  readonly openTerrainTypes: ReadonlySet<string>

  /** Sequence to play when opening (default "open").
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.OpenSequence
   */
  readonly openSequence: string

  /** Sequence to play when closing (default "close").
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.CloseSequence
   */
  readonly closeSequence: string

  /** Sequence to play for unload loop (default "unload").
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.UnloadSequence
   */
  readonly unloadSequence: string

  /** Which sprite body to play the animation on (default "body").
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.Body
   */
  readonly body: string

  constructor(params: {
    instanceName?: string
    openTerrainTypes?: ReadonlySet<string>
    openSequence?: string
    closeSequence?: string
    unloadSequence?: string
    body?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.openTerrainTypes = params.openTerrainTypes ?? new Set(['Clear'])
    this.openSequence = params.openSequence ?? 'open'
    this.closeSequence = params.closeSequence ?? 'close'
    this.unloadSequence = params.unloadSequence ?? 'unload'
    this.body = params.body ?? 'body'
  }

  /** Create the trait instance.
   *
   * OpenRA 对照: WithLandingCraftAnimationInfo.Create(ActorInitializer)
   */
  create(init: IGameActor): WithLandingCraftAnimation {
    return new WithLandingCraftAnimation(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithLandingCraftAnimation
// OpenRA 对照: WithLandingCraftAnimation : ITick
// ---------------------------------------------------------------------------

/** Controls landing craft open/close animation based on terrain.
 *
 * OpenRA 对照: WithLandingCraftAnimation
 *
 * On each tick, checks if the landing craft should be open (near valid terrain
 * and not moving). If state changed, plays the appropriate open/close animation.
 */
export class WithLandingCraftAnimation {
  readonly info: WithLandingCraftAnimationInfo
  private readonly _cargo: ILandingCraftCargo
  private readonly _move: ILandingCraftMove
  private readonly _wsb: ILandingCraftSpriteBody
  private readonly _self: IGameActor

  /** Whether the landing craft is currently open.
   *
   * OpenRA 对照: WithLandingCraftAnimation.open
   */
  private _open: boolean = false

  constructor(self: IGameActor, info: WithLandingCraftAnimationInfo) {
    this.info = info
    this._self = self
    this._cargo = (self as any).trait?.('Cargo') as ILandingCraftCargo
    this._move = (self as any).trait?.('IMove') as ILandingCraftMove ?? (self as any) as ILandingCraftMove

    // Find the named WithSpriteBody
    const bodies =
      ((self as any).traitsImplementing?.('WithSpriteBody') as ILandingCraftSpriteBody[]) ?? []
    const matched = bodies.find((b) => b.info.name === info.body)
    if (!matched) {
      throw new Error(
        `WithLandingCraftAnimation requires a WithSpriteBody with name="${info.body}"`,
      )
    }
    this._wsb = matched
  }

  // -------------------------------------------------------------------------
  // ShouldBeOpen (对应 C# ShouldBeOpen)
  // -------------------------------------------------------------------------

  /** Check if the landing craft should be open.
   *
   * OpenRA 对照: WithLandingCraftAnimation.ShouldBeOpen()
   *
   * Returns false if moving or airborne. Returns true if adjacent to
   * a cell of a valid open terrain type.
   */
  shouldBeOpen(): boolean {
    const actor = this._self
    const world = (actor as any).world as { map: ILandingCraftMap } | undefined
    const map = world?.map
    if (!map) return false

    // Check if moving or airborne
    if (
      this._move.currentMovementTypes !== MovementType.None ||
      map.distanceAboveTerrain?.({ length: 0 }).length > 0
    ) {
      return false
    }

    // Check adjacent cells for open terrain types
    const adjacentCells = this._cargo.currentAdjacentCells()
    return adjacentCells.some(
      (c) =>
        map.contains(c) &&
        this.info.openTerrainTypes.has(map.getTerrainInfo(c).type),
    )
  }

  // -------------------------------------------------------------------------
  // Open / Close
  // 对照: Open() / Close()
  // -------------------------------------------------------------------------

  /** Play the opening animation.
   *
   * OpenRA 对照: WithLandingCraftAnimation.Open()
   */
  private open(): void {
    if (this._open || !this._wsb.defaultAnimation.hasSequence(this.info.openSequence)) return

    this._open = true
    this._wsb.playCustomAnimation(this._self, this.info.openSequence, () => {
      if (this._wsb.defaultAnimation.hasSequence(this.info.unloadSequence)) {
        this._wsb.playCustomAnimationRepeating(this._self, this.info.unloadSequence)
      }
    })
  }

  /** Play the closing animation.
   *
   * OpenRA 对照: WithLandingCraftAnimation.Close()
   */
  private close(): void {
    if (!this._open || !this._wsb.defaultAnimation.hasSequence(this.info.closeSequence)) return

    this._open = false
    this._wsb.playCustomAnimation(this._self, this.info.closeSequence)
  }

  // -------------------------------------------------------------------------
  // ITick
  // 对照: ITick.Tick(Actor self)
  // -------------------------------------------------------------------------

  /** Update open/close state on each tick.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(_self: IGameActor): void {
    if (this.shouldBeOpen()) {
      this.open()
    } else {
      this.close()
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the landing craft is currently open. */
  get isOpen(): boolean {
    return this._open
  }

  /** Set open state (for testing). */
  setOpen(value: boolean): void {
    this._open = value
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  dispose(): void {
    // No GPU resources owned directly
  }
}
