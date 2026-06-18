/**
 * GpsDotEffect.ts — GPS minimap dot indicator (renders enemy positions when GPS active)
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/GpsDotEffect.cs (119 lines)
 *
 * 核心范式转换:
 * - C# IEffect + IEffectAnnotation → TypeScript IEffect + IEffectAnnotation
 * - C# PlayerDictionary<DotState> → TypeScript Map<string, DotState> per player
 * - C# FrozenActorLayer → TypeScript stub (deferred to Ch12 integration)
 * - C# Animation.RenderUI → Billboard-based GPS dot renderable (3D world overlay)
 * - C# IVisibilityModifier array → TypeScript visitor modifier array
 * - C# Shroud.CellVisibility enum → TypeScript bitmask
 * - C# Viewport.WorldToViewPx → world-position Billboard at actor CenterPosition
 *
 * Phase B.8: Implement actual rendering via Billboard IRenderable instead of
 * returning empty arrays. The visibility logic (tick/ShouldRender) was already
 * fully migrated in Phase A.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { WorldRendererStub, IRenderable, IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IEffect, IEffectAnnotation } from '../../OpenRA.Game/Effects/IEffect.js'

// ---------------------------------------------------------------------------
// Shroud visibility flags (stub)
// OpenRA 对照: Shroud.CellVisibility enum
// ---------------------------------------------------------------------------

/** Bit flags for cell visibility through the shroud.
 *
 * OpenRA 对照: Shroud.CellVisibility
 */
export const ShroudVisibility = {
  None: 0,
  Explored: 1,
  Visible: 2,
} as const

export type ShroudVisibility = (typeof ShroudVisibility)[keyof typeof ShroudVisibility]

// ---------------------------------------------------------------------------
// GpsDotRenderable — Billboard-based IRenderable for the GPS dot
// OpenRA 对照: Animation.RenderUI returns IRenderable for minimap overlay
// ---------------------------------------------------------------------------

/**
 * Billboard renderable for a GPS dot on the minimap/world overlay.
 *
 * OpenRA 对照: Animation.RenderUI yields SpriteRenderable-like objects
 *
 * In the 3D Babylon.js paradigm, GPS dots are rendered as oriented
 * Billboard sprites at the actor's world position, visible through
 * the shroud (fog of war) when GPS is active.
 *
 * Mock-friendly: holds Billboard-like properties as plain data so
 * tests can inspect position, palette, and visibility without WebGL.
 */
export class GpsDotRenderable implements IRenderable {
  /** Discriminant for type-narrowing in tests. */
  readonly type = 'gpsDot' as const

  /** World position of the GPS dot (actor CenterPosition). */
  readonly position: { readonly X: number; readonly Y: number; readonly Z: number }

  /** Palette prefix for color lookup (e.g. "player"). */
  readonly palettePrefix: string

  /** Player identifier used for palette color resolution. */
  readonly playerName: string

  /** Image/sprite name for the dot symbol. */
  readonly image: string

  /** Whether this renderable has been disposed. */
  private _disposed: boolean = false

  constructor(
    position: { readonly X: number; readonly Y: number; readonly Z: number },
    palettePrefix: string,
    playerName: string,
    image: string,
  ) {
    this.position = position
    this.palettePrefix = palettePrefix
    this.playerName = playerName
    this.image = image
  }

  /** Clean up resources. */
  dispose(): void {
    this._disposed = true
  }

  get disposed(): boolean {
    return this._disposed
  }
}

// ---------------------------------------------------------------------------
// GpsDotInfo
// OpenRA 对照: GpsDotInfo
// ---------------------------------------------------------------------------

/** Configuration for the GPS minimap dot indicator.
 *
 * OpenRA 对照: GpsDotInfo
 */
export interface GpsDotInfo {
  readonly image: string
  readonly string_: string
  readonly indicatorPalettePrefix: string
}

// ---------------------------------------------------------------------------
// DotState
// OpenRA 对照: GpsDotEffect.DotState
// ---------------------------------------------------------------------------

/** Per-player state for the GPS dot.
 *
 * OpenRA 对照: GpsDotEffect.DotState
 */
class DotState {
  readonly watcher: GpsWatcherLike
  readonly frozenActorWithRenderables: boolean
  visible: boolean = false

  constructor(watcher: GpsWatcherLike, frozenLayer: FrozenActorLayerLike | null) {
    this.watcher = watcher
    if (frozenLayer !== null) {
      this.frozenActorWithRenderables = false
      // OpenRA: frozenActor.HasRenderables check
      // NOTE: FrozenActorLayer integration deferred
    } else {
      this.frozenActorWithRenderables = false
    }
  }
}

// ---------------------------------------------------------------------------
// Trait interfaces (duck-typed)
// ---------------------------------------------------------------------------

interface GpsWatcherLike {
  granted: boolean
  grantedAllies: boolean
}

interface FrozenActorLayerLike {
  // stub
}

interface VisibilityModifierLike {
  isVisible(actor: unknown, toPlayer: unknown): boolean
}

// ---------------------------------------------------------------------------
// GpsDotEffect — effect implementation
// OpenRA 对照: GpsDotEffect : IEffect, IEffectAnnotation
// ---------------------------------------------------------------------------

/**
 * GPS minimap dot visual effect for a single actor.
 *
 * OpenRA 对照: GpsDotEffect
 *
 * Renders a small colored dot on the minimap/radar for enemy actors
 * when GPS is active. Visibility depends on player alliance, shroud
 * state, watcher grants, and visibility modifiers.
 */
export class GpsDotEffect implements IEffect, IEffectAnnotation {
  private readonly _actor: IGameActor
  private readonly _info: GpsDotInfo
  private readonly _dotStates: Map<string, DotState>
  private readonly _visibilityModifiers: VisibilityModifierLike[]
  private _playerCount: number = 0

  constructor(actor: IGameActor, info: GpsDotInfo) {
    this._actor = actor
    this._info = info

    // Collect visibility modifiers
    const actorAny = actor as unknown as {
      traitsImplementing?: <T>(_name: string) => T[]
    }
    this._visibilityModifiers =
      actorAny.traitsImplementing?.<VisibilityModifierLike>(
        'IVisibilityModifier',
      ) ?? []

    // Build PlayerDictionary<DotState>
    this._dotStates = new Map()

    // NOTE: In OpenRA, PlayerDictionary is created with a factory per player
    // We initialize lazily in tick().
  }

  // ---------------------------------------------------------------------------
  // ShouldRender
  // OpenRA 对照: GpsDotEffect.ShouldRender(DotState, Player)
  // ---------------------------------------------------------------------------

  /**
   * Determine if the GPS dot should be visible for the given player.
   *
   * OpenRA 对照: GpsDotEffect.ShouldRender(DotState, Player)
   */
  private _shouldRender(state: DotState, toPlayer: PlayerStub): boolean {
    // Hide if frozen actor portrait is visible
    if (state.frozenActorWithRenderables) return false

    // Hide if no watchers available
    if (!state.watcher.granted && !state.watcher.grantedAllies) return false

    // Hide if actor appears owned by an allied player
    const owner = (this._actor as unknown as { effectiveOwner?: { owner?: PlayerStub } }).effectiveOwner?.owner
    if (owner !== null && owner !== undefined && (toPlayer as unknown as { isAlliedWith?: (o: unknown) => boolean }).isAlliedWith?.(owner)) {
      return false
    }

    // Check shroud visibility
    const centerPos = (this._actor as unknown as { centerPosition: WPosStub }).centerPosition
    const shroud = (toPlayer as unknown as { shroud?: ShroudStub }).shroud
    if (!shroud) return false

    const visibility = shroud.getVisibility?.(centerPos) ?? ShroudVisibility.None
    if (!(visibility & ShroudVisibility.Explored)) return false
    if (visibility & ShroudVisibility.Visible) return false

    // Check visibility modifiers
    for (const modifier of this._visibilityModifiers) {
      if (!modifier.isVisible(this._actor, toPlayer)) return false
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Tick (IEffect)
  // OpenRA 对照: GpsDotEffect.Tick(World)
  // ---------------------------------------------------------------------------

  /**
   * Update visibility state for all players.
   *
   * OpenRA 对照: GpsDotEffect.Tick(World)
   */
  tick(world: GameWorldManager): void {
    const players: PlayerStub[] = (world as unknown as { players: PlayerStub[] }).players ?? []
    this._playerCount = players.length

    for (const player of players) {
      // Key by player internal name (survives player join/leave/reorder)
      const key = (player as unknown as { internalName: string }).internalName
      if (!key) continue

      let state = this._dotStates.get(key)

      // Lazy-init player state
      if (!state) {
        const watcher = (player as unknown as { playerActor?: { traits?: Map<string, unknown> } })
          .playerActor?.traits?.get('GpsWatcher') as unknown as GpsWatcherLike

        state = new DotState(
          watcher ?? { granted: false, grantedAllies: false },
          null, // FrozenActorLayer deferred
        )
        this._dotStates.set(key, state)
      }

      state.visible = this._shouldRender(state, player)
    }
  }

  // ---------------------------------------------------------------------------
  // Render (IEffect)
  // OpenRA 对照: GpsDotEffect.Render(WorldRenderer) → SpriteRenderable.None
  // ---------------------------------------------------------------------------

  /**
   * Returns the GPS dot billboard renderable when the dot is visible to
   * the current render player.
   *
   * OpenRA 对照: GpsDotEffect.Render → SpriteRenderable.None (world space)
   *
   * In the 3D paradigm, the GPS dot is rendered as a Billboard at the actor's
   * world position so it appears above the terrain through fog of war.
   *
   * @param worldRenderer — the world renderer (unused, render player resolved from actor)
   * @returns array with the GPS dot renderable, or empty if not visible
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const renderable = this._createRenderable()
    return renderable ? [renderable] : []
  }

  // ---------------------------------------------------------------------------
  // RenderAnnotation (IEffectAnnotation)
  // OpenRA 对照: GpsDotEffect.RenderAnnotation(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Render the GPS dot in the annotation (UI) layer.
   *
   * OpenRA 对照: GpsDotEffect.RenderAnnotation(WorldRenderer)
   *
   * Only renders if the current render player should see the dot.
   * Returns the same Billboard renderable as render() since annotation
   * rendering shares the GPS dot visual in the 3D paradigm.
   *
   * @param worldRenderer — the world renderer (unused, render player resolved from actor)
   * @returns array with the GPS dot renderable, or empty if not visible
   */
  renderAnnotation(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const renderable = this._createRenderable()
    return renderable ? [renderable] : []
  }

  // ---------------------------------------------------------------------------
  // _createRenderable — creates the GPS dot Billboard renderable
  // ---------------------------------------------------------------------------

  /**
   * Create a GpsDotRenderable for the current render player if the dot is
   * visible to them.
   *
   * @returns the renderable, or null if the dot should not be visible
   */
  private _createRenderable(): GpsDotRenderable | null {
    // Determine the render player (observer or active player)
    const actorAny = this._actor as unknown as {
      world?: {
        renderPlayer?: PlayerStub & { internalName?: string }
      }
      centerPosition?: { X: number; Y: number; Z: number }
    }
    const renderPlayer = actorAny.world?.renderPlayer
    if (!renderPlayer) return null

    const key = (renderPlayer as unknown as { internalName: string }).internalName
    if (!key) return null

    const state = this._dotStates.get(key)
    if (!state?.visible) return null

    const centerPos = actorAny.centerPosition
    if (!centerPos) return null

    // Resolve owner for palette color
    const effectiveOwner =
      (this._actor as unknown as {
        effectiveOwner?: { owner?: PlayerStub & { internalName?: string } }
      }).effectiveOwner?.owner ??
      (this._actor as unknown as { owner?: PlayerStub & { internalName?: string } }).owner

    const ownerName = (effectiveOwner as unknown as { internalName?: string })?.internalName ?? 'Neutral'

    return new GpsDotRenderable(
      centerPos,
      this._info.indicatorPalettePrefix,
      ownerName,
      this._info.image,
    )
  }

  // ---------------------------------------------------------------------------
  // Dispose — clean up resources
  // ---------------------------------------------------------------------------

  /**
   * Dispose the effect, cleaning up any GPU resources.
   *
   * In the full Babylon.js integration, this would dispose the Billboard
   * mesh. For now, we clear the dot state map.
   */
  dispose(): void {
    this._dotStates.clear()
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  /** Per-player visibility state. Keyed by player InternalName. */
  get dotStates(): Map<string, DotState> {
    return this._dotStates
  }

  /** Number of players (for testing). */
  get playerCount(): number {
    return this._playerCount
  }

  /** The actor this effect belongs to. */
  get actor(): IGameActor {
    return this._actor
  }

  /** Configuration info. */
  get info(): GpsDotInfo {
    return this._info
  }
}

// ---------------------------------------------------------------------------
// Stub types for Shroud / WPos
// ---------------------------------------------------------------------------

interface WPosStub {
  X: number
  Y: number
  Z: number
}

interface ShroudStub {
  getVisibility(pos: WPosStub): ShroudVisibility
}
