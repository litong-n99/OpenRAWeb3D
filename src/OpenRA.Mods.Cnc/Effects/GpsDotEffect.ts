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
 *
 * Ch24 Phase D: Add actual Babylon.js Billboard mesh with StandardMaterial.
 * When a Scene is provided, a small colored Billboard plane is created at the
 * actor's world position and toggled based on dot visibility. Without a Scene,
 * the existing plain-data GpsDotRenderable behavior is preserved (backward
 * compatible).
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Constants,
  Mesh,
  type Scene,
} from '@babylonjs/core'
import { RenderGroup } from '../../OpenRA.Game/Graphics/WorldRenderer.js'

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
 *
 * Ch24 Phase D: When a Babylon.js Scene is provided, a Billboard mesh
 * is created for GPU rendering. Without a Scene, the original plain-data
 * GpsDotRenderable behavior is preserved.
 */
export class GpsDotEffect implements IEffect, IEffectAnnotation {
  private readonly _actor: IGameActor
  private readonly _info: GpsDotInfo
  private readonly _dotStates: Map<string, DotState>
  private readonly _visibilityModifiers: VisibilityModifierLike[]
  private _playerCount: number = 0

  // ---------------------------------------------------------------------------
  // Ch24 Phase D: Babylon.js Billboard resources
  // ---------------------------------------------------------------------------

  /** Optional Babylon.js Scene for GPU resource creation.
   *
   * When null, the effect operates in plain-data mode (backward compatible).
   */
  private readonly _scene: Scene | null = null

  /** Billboard mesh for the GPS dot (created lazily on first visible render). */
  private _billboard: Mesh | null = null

  /** Material for the Billboard mesh (created together with the mesh). */
  private _billboardMaterial: StandardMaterial | null = null

  /** Cached GpsDotRenderable (reused across frames, avoids per-frame allocation).
   *
   * OpenRA 对照: IRenderable yield-return pattern — OpenRA creates new objects
   * per-frame, but TS avoids this via object pooling.
   */
  private _cachedRenderable: GpsDotRenderable | null = null

  constructor(actor: IGameActor, info: GpsDotInfo, scene?: Scene) {
    this._actor = actor
    this._info = info
    this._scene = scene ?? null

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
   * Ch24 Phase D: When a Scene was provided at construction, returns the
   * actual Babylon.js Billboard mesh as an IRenderable for GPU rendering
   * (matching the AnimationStub pattern). Without a Scene, returns the
   * plain-data GpsDotRenderable for backward compatibility.
   *
   * @param worldRenderer — the world renderer (unused, render player resolved from actor)
   * @returns array with the renderable, or empty if not visible
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const renderable = this._createRenderable()
    if (!renderable) return []

    // When Scene is available and Billboard exists, return the actual mesh
    // so it renders on GPU (matches AnimationStub pattern).
    if (this._scene && this._billboard) {
      return [this._billboard as unknown as IRenderable]
    }

    // Backward compatible: return plain-data renderable
    return [renderable]
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
   * Returns the same Billboard mesh as render() since annotation
   * rendering shares the GPS dot visual in the 3D paradigm.
   *
   * Ch24 Phase D: When a Scene is available, returns the actual Billboard
   * mesh. Without a Scene, returns the plain-data renderable.
   *
   * @param worldRenderer — the world renderer (unused, render player resolved from actor)
   * @returns array with the GPS dot renderable, or empty if not visible
   */
  renderAnnotation(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const renderable = this._createRenderable()
    if (!renderable) return []

    if (this._scene && this._billboard) {
      return [this._billboard as unknown as IRenderable]
    }

    return [renderable]
  }

  // ---------------------------------------------------------------------------
  // _resolveOwnerName — extract the effective owner name for the actor
  // ---------------------------------------------------------------------------

  /**
   * Resolve the effective owner name for palette color selection.
   *
   * Prefers effectiveOwner.owner over owner for disguised actors.
   *
   * @returns the owner's InternalName, or "Neutral" if none found
   */
  private _resolveOwnerName(): string {
    const effectiveOwner =
      (this._actor as unknown as {
        effectiveOwner?: { owner?: PlayerStub & { internalName?: string } }
      }).effectiveOwner?.owner ??
      (this._actor as unknown as { owner?: PlayerStub & { internalName?: string } }).owner

    return (effectiveOwner as unknown as { internalName?: string })?.internalName ?? 'Neutral'
  }

  // ---------------------------------------------------------------------------
  // _ensureBillboard — lazy-create the Babylon.js Billboard mesh
  // Ch24 Phase D
  // ---------------------------------------------------------------------------

  /**
   * Create the Billboard mesh and material if not yet created.
   *
   * Requires a Scene to be available at construction time. Idempotent —
   * subsequent calls are no-ops once the Billboard exists.
   *
   * The Billboard is a small plane (0.3 x 0.3 world units) that always
   * faces the camera, rendered in the Annotation render group (GPS dots
   * are a minimap/annotation overlay, not a regular Actor effect).
   *
   * NOTE — Lifecycle deviation from OpenRA:
   * OpenRA creates the dot renderable via INotifyAddedToWorld.AddedToWorld().
   * We use lazy creation on first visible render() instead. Rationale:
   * 1. Avoids coupling to the World lifecycle — GpsDotEffect works with or
   *    without a full World/Scene setup (critical for backward compatibility).
   * 2. Mesh creation is cheap (one plane + one StandardMaterial); no
   *    measurable frame impact from lazy init.
   * 3. Simplifies testing — no need to simulate World/Scene lifecycle events.
   */
  private _ensureBillboard(): void {
    if (!this._scene || this._billboard) return

    const actorId = this._actor.actorId

    // Create the Billboard plane
    this._billboard = MeshBuilder.CreatePlane(
      `gpsDot_${actorId}`,
      { width: 0.3, height: 0.3 },
      this._scene,
    )
    this._billboard.billboardMode = Mesh.BILLBOARDMODE_ALL
    // GPS dot is a minimap/annotation overlay — use Annotation layer (3)
    this._billboard.renderingGroupId = RenderGroup.Annotation

    // Create material with color derived from palette prefix
    this._billboardMaterial = new StandardMaterial(
      `gpsDot_mat_${actorId}`,
      this._scene,
    )
    this._billboardMaterial.emissiveColor = this._resolveColor()
    // Prevent scene lighting from tinting the dot: pure emissive-only
    this._billboardMaterial.diffuseColor = Color3.Black()
    this._billboardMaterial.specularColor = Color3.Black()
    this._billboardMaterial.alphaMode = Constants.ALPHA_PREMULTIPLIED
    this._billboardMaterial.backFaceCulling = false

    // Assign material to mesh
    this._billboard.material = this._billboardMaterial
  }

  // ---------------------------------------------------------------------------
  // _resolveColor — map palette prefix to a Color3
  // Ch24 Phase D
  // ---------------------------------------------------------------------------

  /**
   * Resolve the dot color from the indicator palette prefix.
   *
   * - "player" prefix → player-specific deterministic color from owner name
   * - Default → orange GPS dot (Color3(1, 0.5, 0))
   *
   * @returns the Babylon.js Color3 for the dot material emissive color
   */
  private _resolveColor(): Color3 {
    if (this._info.indicatorPalettePrefix === 'player') {
      const ownerName = this._resolveOwnerName()
      return this._playerColorFromName(ownerName)
    }
    // Default: orange GPS dot
    return new Color3(1, 0.5, 0)
  }

  // ---------------------------------------------------------------------------
  // _playerColorFromName — deterministic color from player name
  // Ch24 Phase D
  // ---------------------------------------------------------------------------

  /**
   * Derive a deterministic Color3 from a player name using a simple hash.
   *
   * Uses a small palette of 8 distinct colors to ensure different players
   * get visually distinguishable dot colors.
   *
   * @param name — player internal name (e.g. "Multi0", "Multi1")
   * @returns a Color3 from the deterministic palette
   */
  private _playerColorFromName(name: string): Color3 {
    // djb2-like hash for deterministic color selection
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i)
      hash >>>= 0 // Convert to unsigned 32-bit integer
    }

    // Small palette of distinct, vibrant colors
    const palette: Color3[] = [
      new Color3(1, 0.2, 0.2),   // red
      new Color3(0.2, 0.6, 1),   // blue
      new Color3(0.2, 1, 0.2),   // green
      new Color3(1, 1, 0.2),     // yellow
      new Color3(1, 0.2, 1),     // magenta
      new Color3(0.2, 1, 1),     // cyan
      new Color3(1, 0.5, 0),     // orange
      new Color3(0.8, 0.8, 0.8), // white
    ]

    return palette[Math.abs(hash) % palette.length]!
  }

  // ---------------------------------------------------------------------------
  // _createRenderable — creates the GPS dot renderable + syncs Billboard
  // ---------------------------------------------------------------------------

  /**
   * Create or reuse a GpsDotRenderable for the current render player if the
   * dot is visible to them.
   *
   * Ch24 Phase D: When a Scene is available, manages a Babylon.js Billboard
   * mesh as a side effect — creating it on first visibility, updating its
   * world position each frame, and toggling enabled state.
   *
   * PERF: Reuses a cached GpsDotRenderable across frames. A new object is
   * only allocated when the dot becomes visible, changes position, or when
   * the owner changes. This avoids per-frame allocation on the hot path.
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
    if (!renderPlayer) {
      // No render player — hide Billboard
      if (this._billboard) this._billboard.setEnabled(false)
      // Invalidate cache
      this._cachedRenderable = null
      return null
    }

    const key = (renderPlayer as unknown as { internalName: string }).internalName
    if (!key) {
      if (this._billboard) this._billboard.setEnabled(false)
      this._cachedRenderable = null
      return null
    }

    const state = this._dotStates.get(key)
    const centerPos = actorAny.centerPosition

    if (!state?.visible || !centerPos) {
      // Dot not visible or no position — hide Billboard
      if (this._billboard) this._billboard.setEnabled(false)
      this._cachedRenderable = null
      return null
    }

    // -----------------------------------------------------------------------
    // Ch24 Phase D: Sync the Billboard mesh
    // -----------------------------------------------------------------------

    this._ensureBillboard()
    if (this._billboard) {
      this._billboard.position.set(centerPos.X, centerPos.Y, centerPos.Z)
      this._billboard.setEnabled(true)
    }

    // -----------------------------------------------------------------------
    // Reuse cached renderable if position unchanged (avoid per-frame allocation)
    // -----------------------------------------------------------------------

    if (this._cachedRenderable) {
      const cp = this._cachedRenderable.position
      if (cp.X === centerPos.X && cp.Y === centerPos.Y && cp.Z === centerPos.Z) {
        return this._cachedRenderable
      }
    }

    // Position changed or first time — create new renderable
    const ownerName = this._resolveOwnerName()

    this._cachedRenderable = new GpsDotRenderable(
      centerPos,
      this._info.indicatorPalettePrefix,
      ownerName,
      this._info.image,
    )

    return this._cachedRenderable
  }

  // ---------------------------------------------------------------------------
  // Dispose — clean up resources
  // ---------------------------------------------------------------------------

  /**
   * Dispose the effect, cleaning up GPU resources and state.
   *
   * Ch24 Phase D: Disposes the Billboard mesh and its material. Idempotent —
   * safe to call multiple times.
   *
   * Scene-disposal guard: If the Babylon.js Scene has already been disposed
   * (e.g. engine shutdown before effect teardown), skip GPU resource disposal
   * to avoid errors from calling dispose on resources whose WebGL context is
   * already destroyed.
   */
  dispose(): void {
    this._dotStates.clear()
    this._cachedRenderable = null

    // Ch24 Phase D: Dispose GPU resources (guarded against scene disposal)
    const sceneDisposed = this._scene?.isDisposed ?? true
    if (!sceneDisposed) {
      if (this._billboardMaterial) {
        this._billboardMaterial.dispose()
        this._billboardMaterial = null
      }
      if (this._billboard) {
        this._billboard.dispose()
        this._billboard = null
      }
    } else {
      // Scene already disposed — GPU resources are already freed.
      // Just drop references to prevent dangling pointers.
      this._billboardMaterial = null
      this._billboard = null
    }
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

  // ---------------------------------------------------------------------------
  // Ch24 Phase D: Billboard accessors (for testing)
  // ---------------------------------------------------------------------------

  /** The Billboard mesh (for testing). Null until first visible render. */
  get billboard(): Mesh | null {
    return this._billboard
  }

  /** The Billboard material (for testing). Null until first visible render. */
  get billboardMaterial(): StandardMaterial | null {
    return this._billboardMaterial
  }

  /** The Babylon.js Scene (for testing). Null if no scene was provided. */
  get scene(): Scene | null {
    return this._scene
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
