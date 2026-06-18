/**
 * ScreenMap.ts — Maps screen coordinates to Actors for click detection and selection
 * OpenRA 对照: OpenRA.Game/Traits/World/ScreenMap.cs
 *
 * 核心范式转换:
 * - C# Dictionary<T, Rectangle>[] bins (ref return via CollectionsMarshal)
 *   → TypeScript SpatiallyPartitioned<T> grid-based spatial hash
 * - C# Cache<Player, SpatiallyPartitioned<FrozenActor>> → TypeScript Cache<K,V>
 * - C# HashSet<Actor> pending queues → TypeScript Set<GameActor>
 * - C# IEnumerable<FrozenActor> / IEnumerable<ActorBoundsPair> (LINQ)
 *   → TypeScript filtered arrays (no LINQ — imperative loops match OpenRA PERF)
 * - C# Polygon.Contains(int2) precise hit-test → TypeScript point-in-polygon
 *   utility function (even-odd rule)
 * - 2D screen-space spatial index operates in pixel coordinates; 3D adaptation
 *   keeps same coordinate system (WorldRenderer.ScreenPxPosition converts WPos → px)
 * - No per-frame allocation: pre-allocated filter result arrays, reuse Set for dedup
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Rectangle } from '../../Primitives/Rectangle.js'
import { SpatiallyPartitioned } from '../../Primitives/SpatiallyPartitioned.js'
import { Cache } from '../../Primitives/Cache.js'
import type { GameActor } from '../../Actor.js'
import type { Player } from '../../Player.js'
import type { PlayerStub } from '../../Traits/TraitsInterfaces.js'
import type { IEffect } from '../../Effects/IEffect.js'

// ---------------------------------------------------------------------------
// Local stub types (avoid circular imports; matching Actor.ts pattern)
// ---------------------------------------------------------------------------

/** 2D integer point. */
interface Vec2 { x: number; y: number }

/** 3D world position (minimal stub for ScreenPxPosition). */
interface WPosLike { x: number; y: number; z: number }

/** Size with width and height. */
interface SizeLike { width: number; height: number }

/** Minimal sprite stub for Add effect overloads. */
interface SpriteStub { size: { x: number; y: number } }

/** Mouse input stub (used by ActorsAtMouse / FrozenActorsAtMouse overloads). */
interface MouseInputStub { location: Vec2 }

/** Minimal rect type for screen bounds (matches Actor.RectLike). */
interface RectLike { x: number; y: number; width: number; height: number }

/**
 * Minimal FrozenActor stub.
 *
 * OpenRA 对照: OpenRA.Game/Traits/FrozenActor.cs
 *
 * ScreenMap needs IsValid, MouseBounds, and ScreenBounds from FrozenActor.
 * Full FrozenActor migration is  (fog of war / frozen-under-fog).
 */
interface FrozenActorStub {
  readonly isValid: boolean
  readonly mouseBounds: PolygonStub
  readonly screenBounds: readonly RectLike[]
}

/**
 * Minimal Polygon stub for mouse hit-test bounds.
 *
 * OpenRA 对照: OpenRA.Primitives/Polygon.cs
 *
 * Polygon.full migration is deferred ().
 * ScreenMap only needs: isEmpty check, bounding rectangle, and contains(point).
 */
interface PolygonStub {
  readonly vertices: readonly Vec2[]
  readonly isEmpty: boolean
  readonly boundingRect: Rectangle
  contains(point: Vec2): boolean
}

/**
 * Minimal WorldRenderer stub for screen-pixel conversion.
 *
 * OpenRA 对照: OpenRA.Game/Graphics/WorldRenderer.cs
 * Only the methods used by ScreenMap are included.
 */
interface WorldRendererStubForScreenMap {
  screenPxPosition(pos: WPosLike): Vec2
  viewport: {
    viewToWorldPx(viewPos: Vec2): Vec2
  }
}

// ---------------------------------------------------------------------------
// Helper: point-in-polygon test (even-odd rule)
// 对应 OpenRA Polygon.Contains(int2)
// ---------------------------------------------------------------------------

/**
 * Check whether a point is inside a polygon using the even-odd rule.
 *
 * OpenRA 对照: Polygon.Contains(int2)
 *
 * @param px — X coordinate of the point
 * @param py — Y coordinate of the point
 * @param vertices — polygon vertices
 * @returns true if the point is inside the polygon
 */
function pointInPolygon(px: number, py: number, vertices: readonly Vec2[]): boolean {
  let inside = false
  const n = vertices.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x
    const yi = vertices[i].y
    const xj = vertices[j].x
    const yj = vertices[j].y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ---------------------------------------------------------------------------
// Helper: union of rects (对应 OpenRA IEnumerable<Rectangle>.Union())
// ---------------------------------------------------------------------------

/**
 * Compute the union bounding box of an array of rects.
 *
 * OpenRA 对照: Exts.Union(IEnumerable<Rectangle>)
 *
 * @returns the union rectangle, or Rectangle.Empty if no rects
 */
function unionRects(rects: readonly RectLike[]): Rectangle {
  if (rects.length === 0) return Rectangle.Empty
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const r of rects) {
    left = Math.min(left, r.x)
    top = Math.min(top, r.y)
    right = Math.max(right, r.x + r.width)
    bottom = Math.max(bottom, r.y + r.height)
  }
  return Rectangle.fromLTRB(left, top, right, bottom)
}

// ---------------------------------------------------------------------------
// Helper: RectWithCorners (对应 OpenRA ScreenMap.RectWithCorners)
// ---------------------------------------------------------------------------

/**
 * Create a Rectangle from two corner points.
 *
 * OpenRA 对照: ScreenMap.RectWithCorners(int2, int2)
 */
function rectWithCorners(a: Vec2, b: Vec2): Rectangle {
  return Rectangle.fromLTRB(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
  )
}

// ---------------------------------------------------------------------------
// Helper: ValidBounds check (对应 OpenRA ScreenMap.ValidBounds)
// ---------------------------------------------------------------------------

/**
 * Check if bounds are valid (non-zero area).
 *
 * OpenRA 对照: ScreenMap.ValidBounds(Rectangle)
 */
function validBounds(r: Rectangle | RectLike): boolean {
  // Rectangle uses PascalCase (Width, Height), RectLike uses camelCase
  const w = (r as Rectangle).Width ?? (r as RectLike).width
  const h = (r as Rectangle).Height ?? (r as RectLike).height
  return w > 0 && h > 0
}

// ---------------------------------------------------------------------------
// ActorBoundsPair (对应 OpenRA ActorBoundsPair readonly struct)
// ---------------------------------------------------------------------------

/**
 * Wraps an Actor with its mouse hit-test polygon.
 *
 * OpenRA 对照: ActorBoundsPair
 */
export class ActorBoundsPair {
  /** The actor. */
  readonly actor: GameActor

  /** The mouse hit-test polygon. */
  readonly bounds: PolygonStub

  constructor(actor: GameActor, bounds: PolygonStub) {
    this.actor = actor
    this.bounds = bounds
  }

  /**
   * Human-readable representation.
   *
   * OpenRA 对照: ActorBoundsPair.ToString()
   */
  toString(): string {
    return `${this.actor.info?.name ?? 'Unknown'}->${this.bounds.vertices.constructor.name}`
  }
}

// ---------------------------------------------------------------------------
// ScreenMapConfig (对应 OpenRA ScreenMapInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for ScreenMap spatial partitioning.
 *
 * OpenRA 对照: ScreenMapInfo.TraitInfo
 */
export interface ScreenMapConfig {
  /** Width of the world in pixels (map width * tile width). */
  width: number

  /** Height of the world in pixels (map height * tile height). */
  height: number

  /** Size of each spatial partition bin in pixels. Default: 250. */
  binSize?: number
}

const DEFAULT_BIN_SIZE = 250

// ---------------------------------------------------------------------------
// ScreenMap (对应 OpenRA ScreenMap)
// ---------------------------------------------------------------------------

/**
 * Maps screen coordinates to Actors for click detection, selection boxes,
 * and render queries.
 *
 * OpenRA 对照: ScreenMap class
 *
 * Uses SpatiallyPartitioned<T> for spatial indexing. Maintains separate
 * indexes for:
 * - Mouse queries (actors + per-player frozen actors)
 * - Renderable queries (actors + effects + per-player frozen actors)
 *
 * Updates are batched and applied during TickRender() to ensure all bound
 * changes are consistent.
 *
 * ## 2D-to-3D Note
 *
 * OpenRA's ScreenMap operates in 2D screen-pixel coordinates. In the 3D
 * Babylon.js adaptation, the spatial index still uses screen-pixel
 * coordinates (via WorldRenderer.ScreenPxPosition). The spatial query
 * semantics remain identical — only the coordinate conversion layer changes.
 * GPU ray-picking is used for hover highlights (visual feedback); ScreenMap
 * remains the deterministic CPU-side index for selection logic.
 */
export class ScreenMap {
  // -----------------------------------------------------------------------
  // Static
  // -----------------------------------------------------------------------

  /** Sentinel: no frozen actors found. */
  static readonly NoFrozenActors: readonly FrozenActorStub[] = []

  /** Sentinel: no actors found. */
  static readonly NoActors: readonly ActorBoundsPair[] = []

  // -----------------------------------------------------------------------
  // Filters (corresponds to OpenRA readonly Func fields)
  // -----------------------------------------------------------------------

  private readonly frozenActorIsValid = (fa: FrozenActorStub): boolean => fa.isValid
  private readonly actorIsInWorld = (a: GameActor): boolean => a.isInWorld

  // -----------------------------------------------------------------------
  // Spatial indexes (对应 OpenRA SpatiallyPartitioned fields)
  // -----------------------------------------------------------------------

  /** Per-player spatially partitioned frozen actors for mouse queries. */
  private readonly partitionedMouseFrozenActors: Cache<Player, SpatiallyPartitioned<FrozenActorStub>>

  /** Spatially partitioned actors for mouse queries. */
  private readonly partitionedMouseActors: SpatiallyPartitioned<GameActor>

  /** Actor → pre-computed (Actor, Polygon) pair for mouse hit-testing. */
  private readonly partitionedMouseActorBounds = new Map<GameActor, ActorBoundsPair>()

  /** Per-player spatially partitioned frozen actors for render queries. */
  private readonly partitionedRenderableFrozenActors: Cache<Player, SpatiallyPartitioned<FrozenActorStub>>

  /** Spatially partitioned actors for render queries. */
  private readonly partitionedRenderableActors: SpatiallyPartitioned<GameActor>

  /** Spatially partitioned effects for render queries. */
  private readonly partitionedRenderableEffects: SpatiallyPartitioned<IEffect>

  // -----------------------------------------------------------------------
  // Pending update/remove queues (对应 OpenRA HashSet fields)
  // -----------------------------------------------------------------------

  private readonly addOrUpdateActors = new Set<GameActor>()
  private readonly removeActors = new Set<GameActor>()
  private readonly addOrUpdateFrozenActors: Cache<Player, Set<FrozenActorStub>>
  private readonly removeFrozenActors: Cache<Player, Set<FrozenActorStub>>

  // -----------------------------------------------------------------------
  // WorldRenderer reference (set via WorldLoaded)
  // -----------------------------------------------------------------------

  /** WorldRenderer for screen-pixel coordinate conversion. */
  private worldRenderer: WorldRendererStubForScreenMap | null = null

  // -----------------------------------------------------------------------
  // Constructor (对应 OpenRA ScreenMap constructor)
  // -----------------------------------------------------------------------

  /**
   * Create a ScreenMap for a world.
   *
   * OpenRA 对照: ScreenMap(World, ScreenMapInfo)
   *
   * @param config — map dimensions and bin size
   */
  constructor(config: ScreenMapConfig) {
    const { width, height, binSize = DEFAULT_BIN_SIZE } = config

    // Mouse query indexes
    this.partitionedMouseFrozenActors = new Cache<Player, SpatiallyPartitioned<FrozenActorStub>>(
      () => new SpatiallyPartitioned<FrozenActorStub>(width, height, binSize),
    )
    this.partitionedMouseActors = new SpatiallyPartitioned<GameActor>(width, height, binSize)

    // Render query indexes
    this.partitionedRenderableFrozenActors = new Cache<Player, SpatiallyPartitioned<FrozenActorStub>>(
      () => new SpatiallyPartitioned<FrozenActorStub>(width, height, binSize),
    )
    this.partitionedRenderableActors = new SpatiallyPartitioned<GameActor>(width, height, binSize)
    this.partitionedRenderableEffects = new SpatiallyPartitioned<IEffect>(width, height, binSize)

    // Deferred update queues (per-player for frozen actors via Cache)
    this.addOrUpdateFrozenActors = new Cache<Player, Set<FrozenActorStub>>(
      () => new Set<FrozenActorStub>(),
    )
    this.removeFrozenActors = new Cache<Player, Set<FrozenActorStub>>(
      () => new Set<FrozenActorStub>(),
    )
  }

  // -----------------------------------------------------------------------
  // WorldLoaded (对应 OpenRA IWorldLoaded.WorldLoaded)
  // -----------------------------------------------------------------------

  /**
   * Called after the world is fully loaded. Stores the WorldRenderer reference.
   *
   * OpenRA 对照: ScreenMap.WorldLoaded(World, WorldRenderer)
   */
  worldLoaded(_world: unknown, wr: WorldRendererStubForScreenMap): void {
    this.worldRenderer = wr
  }

  // -----------------------------------------------------------------------
  // FrozenActor management (对应 OpenRA AddOrUpdate / Remove for FrozenActor)
  // -----------------------------------------------------------------------

  /**
   * Schedule a frozen actor to be added or updated during the next TickRender.
   *
   * OpenRA 对照: ScreenMap.AddOrUpdate(Player, FrozenActor)
   */
  addOrUpdate(viewer: Player, fa: FrozenActorStub): void {
    this.removeFrozenActors.get(viewer).delete(fa)
    this.addOrUpdateFrozenActors.get(viewer).add(fa)
  }

  /**
   * Schedule a frozen actor for removal during the next TickRender.
   *
   * OpenRA 对照: ScreenMap.Remove(Player, FrozenActor)
   */
  remove(viewer: Player, fa: FrozenActorStub): void {
    this.removeFrozenActors.get(viewer).add(fa)
  }

  // -----------------------------------------------------------------------
  // Actor management (对应 OpenRA AddOrUpdate / Remove for Actor)
  // -----------------------------------------------------------------------

  /**
   * Schedule an actor to be added or updated during the next TickRender.
   *
   * OpenRA 对照: ScreenMap.AddOrUpdate(Actor)
   */
  addOrUpdateActor(a: GameActor): void {
    this.removeActors.delete(a)
    this.addOrUpdateActors.add(a)
  }

  /**
   * Schedule an actor for removal during the next TickRender.
   *
   * OpenRA 对照: ScreenMap.Remove(Actor)
   */
  removeActor(a: GameActor): void {
    this.removeActors.add(a)
  }

  // -----------------------------------------------------------------------
  // Effect management (对应 OpenRA Add / Update / Remove for IEffect)
  // -----------------------------------------------------------------------

  /**
   * Register an effect in the renderable spatial index.
   *
   * OpenRA 对照: ScreenMap.Add(IEffect, WPos, Size)
   *
   * Converts the world position to screen-pixel coordinates using
   * WorldRenderer.ScreenPxPosition, computes a centered bounding
   * rectangle, and adds the effect if the bounds are valid.
   *
   * @param effect — the effect to register
   * @param position — world-space position
   * @param size — screen-space size of the effect
   */
  addEffect(effect: IEffect, position: WPosLike, size: SizeLike): void {
    if (!this.worldRenderer) return

    const screenPos = this.worldRenderer.screenPxPosition(position)
    const screenWidth = Math.abs(size.width)
    const screenHeight = Math.abs(size.height)
    const screenBounds = new Rectangle(
      screenPos.x - Math.trunc(screenWidth / 2),
      screenPos.y - Math.trunc(screenHeight / 2),
      screenWidth,
      screenHeight,
    )

    if (validBounds(screenBounds)) {
      this.partitionedRenderableEffects.setItemBounds(effect, screenBounds)
    }
  }

  /**
   * Register an effect using a sprite for size.
   *
   * OpenRA 对照: ScreenMap.Add(IEffect, WPos, Sprite)
   */
  addEffectWithSprite(effect: IEffect, position: WPosLike, sprite: SpriteStub): void {
    const size: SizeLike = {
      width: Math.trunc(sprite.size.x),
      height: Math.trunc(sprite.size.y),
    }
    this.addEffect(effect, position, size)
  }

  /**
   * Update an effect's position and size (removes old entry and re-adds).
   *
   * OpenRA 对照: ScreenMap.Update(IEffect, WPos, Size)
   */
  updateEffect(effect: IEffect, position: WPosLike, size: SizeLike): void {
    this.removeEffect(effect)
    this.addEffect(effect, position, size)
  }

  /**
   * Update an effect using a sprite for size.
   *
   * OpenRA 对照: ScreenMap.Update(IEffect, WPos, Sprite)
   */
  updateEffectWithSprite(effect: IEffect, position: WPosLike, sprite: SpriteStub): void {
    this.removeEffect(effect)
    this.addEffectWithSprite(effect, position, sprite)
  }

  /**
   * Remove an effect from the renderable spatial index.
   *
   * OpenRA 对照: ScreenMap.Remove(IEffect)
   */
  removeEffect(effect: IEffect): void {
    this.partitionedRenderableEffects.remove(effect)
  }

  // -----------------------------------------------------------------------
  // Mouse query: FrozenActors (对应 OpenRA FrozenActorsAtMouse)
  // -----------------------------------------------------------------------

  /**
   * Get frozen actors at a world-pixel point (for a specific viewer).
   *
   * OpenRA 对照: ScreenMap.FrozenActorsAtMouse(Player, int2)
   */
  frozenActorsAtMouse(viewer: Player | null, worldPx: Vec2): readonly FrozenActorStub[] {
    if (!viewer) return ScreenMap.NoFrozenActors

    const partitioned = this.partitionedMouseFrozenActors.tryGet(viewer)
    if (!partitioned) return ScreenMap.NoFrozenActors

    return partitioned
      .at(worldPx.x, worldPx.y)
      .filter(this.frozenActorIsValid)
      .filter(x => x.mouseBounds.contains(worldPx))
  }

  /**
   * Get frozen actors at a mouse input position.
   *
   * OpenRA 对照: ScreenMap.FrozenActorsAtMouse(Player, MouseInput)
   */
  frozenActorsAtMouseFromInput(
    viewer: Player | null,
    mi: MouseInputStub,
  ): readonly FrozenActorStub[] {
    if (!viewer || !this.worldRenderer) return ScreenMap.NoFrozenActors
    return this.frozenActorsAtMouse(
      viewer,
      this.worldRenderer.viewport.viewToWorldPx(mi.location),
    )
  }

  // -----------------------------------------------------------------------
  // Mouse query: Actors (对应 OpenRA ActorsAtMouse)
  // -----------------------------------------------------------------------

  /**
   * Get actor-bounds pairs at a world-pixel point.
   *
   * OpenRA 对照: ScreenMap.ActorsAtMouse(int2)
   */
  actorsAtMouse(worldPx: Vec2): readonly ActorBoundsPair[] {
    const actors = this.partitionedMouseActors.at(worldPx.x, worldPx.y)
    if (actors.length === 0) return ScreenMap.NoActors

    const results: ActorBoundsPair[] = []
    for (const a of actors) {
      if (!a.isInWorld) continue
      const pair = this.partitionedMouseActorBounds.get(a)
      if (pair && pair.bounds.contains(worldPx)) {
        results.push(pair)
      }
    }
    return results
  }

  /**
   * Get actors at a mouse input position.
   *
   * OpenRA 对照: ScreenMap.ActorsAtMouse(MouseInput)
   */
  actorsAtMouseFromInput(mi: MouseInputStub): readonly ActorBoundsPair[] {
    if (!this.worldRenderer) return ScreenMap.NoActors
    return this.actorsAtMouse(
      this.worldRenderer.viewport.viewToWorldPx(mi.location),
    )
  }

  // -----------------------------------------------------------------------
  // Selection box query: Actors (对应 OpenRA ActorsInMouseBox)
  // -----------------------------------------------------------------------

  /**
   * Get all actors whose mouse bounds intersect a rectangle defined by
   * two corner points.
   *
   * OpenRA 对照: ScreenMap.ActorsInMouseBox(int2, int2)
   */
  actorsInMouseBox(a: Vec2, b: Vec2): readonly ActorBoundsPair[] {
    return this.actorsInMouseBoxRect(rectWithCorners(a, b))
  }

  /**
   * Get all actors whose mouse bounds intersect a rectangle.
   *
   * OpenRA 对照: ScreenMap.ActorsInMouseBox(Rectangle)
   */
  actorsInMouseBoxRect(r: Rectangle): readonly ActorBoundsPair[] {
    const actors = this.partitionedMouseActors.inBox(r)
    if (actors.length === 0) return ScreenMap.NoActors

    const results: ActorBoundsPair[] = []
    for (const a of actors) {
      if (!a.isInWorld) continue
      const pair = this.partitionedMouseActorBounds.get(a)
      if (pair && pair.bounds.boundingRect.intersectsWith(r)) {
        results.push(pair)
      }
    }
    return results
  }

  // -----------------------------------------------------------------------
  // Render query: Actors (对应 OpenRA RenderableActorsInBox)
  // -----------------------------------------------------------------------

  /**
   * Get all renderable actors whose screen bounds intersect the box
   * defined by two corner points.
   *
   * OpenRA 对照: ScreenMap.RenderableActorsInBox(int2, int2)
   */
  renderableActorsInBox(a: Vec2, b: Vec2): readonly GameActor[] {
    return this.partitionedRenderableActors
      .inBox(rectWithCorners(a, b))
      .filter(this.actorIsInWorld)
  }

  // -----------------------------------------------------------------------
  // Render query: Effects (对应 OpenRA RenderableEffectsInBox)
  // -----------------------------------------------------------------------

  /**
   * Get all renderable effects whose screen bounds intersect the box
   * defined by two corner points.
   *
   * OpenRA 对照: ScreenMap.RenderableEffectsInBox(int2, int2)
   */
  renderableEffectsInBox(a: Vec2, b: Vec2): readonly IEffect[] {
    return this.partitionedRenderableEffects.inBox(rectWithCorners(a, b))
  }

  // -----------------------------------------------------------------------
  // Render query: FrozenActors (对应 OpenRA RenderableFrozenActorsInBox)
  // -----------------------------------------------------------------------

  /**
   * Get all renderable frozen actors for a player within a box defined
   * by two corner points.
   *
   * OpenRA 对照: ScreenMap.RenderableFrozenActorsInBox(Player, int2, int2)
   */
  renderableFrozenActorsInBox(
    p: Player | null,
    a: Vec2,
    b: Vec2,
  ): readonly FrozenActorStub[] {
    if (!p) return ScreenMap.NoFrozenActors
    const partitioned = this.partitionedRenderableFrozenActors.tryGet(p)
    if (!partitioned) return ScreenMap.NoFrozenActors

    return partitioned
      .inBox(rectWithCorners(a, b))
      .filter(this.frozenActorIsValid)
  }

  // -----------------------------------------------------------------------
  // TickRender (对应 OpenRA ScreenMap.TickRender)
  // -----------------------------------------------------------------------

  /**
   * Process all pending actor and frozen-actor updates/removals.
   *
   * OpenRA 对照: ScreenMap.TickRender()
   *
   * Called once per frame before rendering. Applies all deferred
   * add/update/remove operations to the spatial indexes.
   *
   * NOTE: Requires worldRenderer to be set (via WorldLoaded).
   * If the renderer is not yet set, pending operations are skipped
   * (no-op) — matching OpenRA behavior where ScreenMap is inactive
   * until the WorldRenderer is available.
   */
  tickRender(): void {
    // If the renderer isn't available yet, skip — matches OpenRA where
    // WorldLoaded is called before any TickRender.
    if (!this.worldRenderer) return

    // --- Process actor updates ---
    for (const a of this.addOrUpdateActors) {
      // Compute mouse bounds (Polygon from IMouseBounds traits)
      const mouseBounds = this.getActorMouseBounds(a)
      if (!mouseBounds.isEmpty) {
        this.partitionedMouseActors.setItemBounds(a, mouseBounds.boundingRect)
        this.partitionedMouseActorBounds.set(a, new ActorBoundsPair(a, mouseBounds))
      } else {
        this.partitionedMouseActors.remove(a)
        this.partitionedMouseActorBounds.delete(a)
      }

      // Compute screen bounds (Rectangle[] from IRender traits)
      const screenBounds = this.getActorScreenBounds(a)
      // Match frozen actor path: check Width/Height > 0, not isEmpty.
      // Rectangle.isEmpty only returns true for (0,0,0,0) exactly;
      // a degenerate rect like (100,100,0,0) would not be caught.
      if (screenBounds.Width > 0 && screenBounds.Height > 0) {
        this.partitionedRenderableActors.setItemBounds(a, screenBounds)
      } else {
        this.partitionedRenderableActors.remove(a)
      }
    }

    // --- Process actor removals ---
    for (const a of this.removeActors) {
      this.partitionedMouseActors.remove(a)
      this.partitionedMouseActorBounds.delete(a)
      this.partitionedRenderableActors.remove(a)
    }

    this.addOrUpdateActors.clear()
    this.removeActors.clear()

    // --- Process frozen actor updates (per player) ---
    for (const [viewer, frozenSet] of this.addOrUpdateFrozenActors) {
      const mousePartitioned = this.partitionedMouseFrozenActors.get(viewer)
      const renderPartitioned = this.partitionedRenderableFrozenActors.get(viewer)

      for (const fa of frozenSet) {
        const faMouseBounds = fa.mouseBounds
        if (!faMouseBounds.isEmpty) {
          mousePartitioned.setItemBounds(fa, faMouseBounds.boundingRect)
        } else {
          mousePartitioned.remove(fa)
        }

        const faScreenBounds = unionRects(fa.screenBounds)
        const faBoundsSize = { width: faScreenBounds.Width, height: faScreenBounds.Height }
        if (faBoundsSize.width > 0 && faBoundsSize.height > 0) {
          renderPartitioned.setItemBounds(fa, faScreenBounds)
        } else {
          renderPartitioned.remove(fa)
        }
      }

      frozenSet.clear()
    }

    // --- Process frozen actor removals (per player) ---
    for (const [viewer, frozenSet] of this.removeFrozenActors) {
      const mousePartitioned = this.partitionedMouseFrozenActors.get(viewer)
      const renderPartitioned = this.partitionedRenderableFrozenActors.get(viewer)

      for (const fa of frozenSet) {
        mousePartitioned.remove(fa)
        renderPartitioned.remove(fa)
      }

      frozenSet.clear()
    }
  }

  // -----------------------------------------------------------------------
  // Internal: get actor bounds from game actor
  // -----------------------------------------------------------------------

  /**
   * Get the mouse hit-test polygon for an actor.
   *
   * OpenRA 对照: a.MouseBounds(worldRenderer)
   */
  private getActorMouseBounds(a: GameActor): PolygonStub {
    try {
      // GameActor.mouseBounds(wr) returns a PolygonLike (vertices only).
      // ScreenMap wraps it with computes for isEmpty, boundingRect, and contains.
      const wr = this.worldRenderer!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poly = (a as any).mouseBounds?.(wr)
      if (poly && poly.vertices) {
        return this.wrapPolygon(poly)
      }
    } catch {
      // Fall through to empty polygon
    }
    return EMPTY_POLYGON
  }

  /**
   * Get the unioned screen bounds for an actor.
   *
   * OpenRA 对照: a.ScreenBounds(worldRenderer).Union()
   */
  private getActorScreenBounds(a: GameActor): Rectangle {
    try {
      const wr = this.worldRenderer!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bounds: RectLike[] = (a as any).screenBounds?.(wr) ?? []
      return unionRects(bounds)
    } catch {
      return Rectangle.Empty
    }
  }

  /**
   * Wrap a raw PolygonLike (vertices array) into a PolygonStub with
   * computed isEmpty, boundingRect, and contains.
   */
  private wrapPolygon(raw: { vertices: readonly Vec2[] }): PolygonStub {
    const vertices = raw.vertices
    // isEmpty: true when the polygon has no vertices, or when all vertices
    // sit at (0,0) — matching OpenRA where an empty/bogus polygon from a
    // trait that produces no mouse bounds has all-zero coordinates.
    const isEmpty = vertices.length === 0 || vertices.every(v => v.x === 0 && v.y === 0)

    let _boundingRect: Rectangle | null = null

    return {
      vertices,
      isEmpty,
      get boundingRect(): Rectangle {
        if (!_boundingRect) {
          if (vertices.length === 0) {
            _boundingRect = Rectangle.Empty
          } else {
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            for (const v of vertices) {
              minX = Math.min(minX, v.x)
              minY = Math.min(minY, v.y)
              maxX = Math.max(maxX, v.x)
              maxY = Math.max(maxY, v.y)
            }
            _boundingRect = Rectangle.fromLTRB(minX, minY, maxX, maxY)
          }
        }
        return _boundingRect
      },
      contains(point: Vec2): boolean {
        return pointInPolygon(point.x, point.y, vertices)
      },
    }
  }

  // -----------------------------------------------------------------------
  // Debug: RenderBounds (对应 OpenRA ScreenMap.RenderBounds)
  // -----------------------------------------------------------------------

  /**
   * Get all render bounds for a viewer (debug visualization).
   *
   * OpenRA 对照: ScreenMap.RenderBounds(Player)
   *
   * Returns rectangles from: renderable actors + renderable effects,
   * and if a viewer is provided, renderable frozen actors.
   */
  renderBounds(viewer: PlayerStub | null): Rectangle[] {
    const results: Rectangle[] = []

    // Renderable actor bounds
    for (const bounds of this.partitionedRenderableActors.values()) {
      results.push(bounds)
    }

    // Renderable effect bounds
    for (const bounds of this.partitionedRenderableEffects.values()) {
      results.push(bounds)
    }

    // Renderable frozen actor bounds (per viewer)
    if (viewer) {
      const frozenPartitioned = this.partitionedRenderableFrozenActors.tryGet(viewer as Player)
      if (frozenPartitioned) {
        for (const bounds of frozenPartitioned.values()) {
          results.push(bounds)
        }
      }
    }

    return results
  }

  // -----------------------------------------------------------------------
  // Debug: MouseBounds (对应 OpenRA ScreenMap.MouseBounds)
  // -----------------------------------------------------------------------

  /**
   * Get all mouse hit-test polygons for a viewer (debug visualization).
   *
   * OpenRA 对照: ScreenMap.MouseBounds(Player)
   *
   * Returns polygons from: mouse actor bounds, and if a viewer is provided,
   * mouse frozen actor bounds.
   */
  mouseBounds(viewer: PlayerStub | null): PolygonStub[] {
    const results: PolygonStub[] = []

    // Mouse actor bounds (the polygons, not the rects)
    for (const pair of this.partitionedMouseActorBounds.values()) {
      results.push(pair.bounds)
    }

    // Mouse frozen actor bounds (per viewer)
    if (viewer) {
      const frozenPartitioned = this.partitionedMouseFrozenActors.tryGet(viewer as Player)
      if (frozenPartitioned) {
        for (const fa of frozenPartitioned.keys()) {
          results.push(fa.mouseBounds)
        }
      }
    }

    return results
  }

  // -----------------------------------------------------------------------
  // Select actor at point helper (corresponds to OpenRA ActorsAtMouse)
  // -----------------------------------------------------------------------

  /**
   * Get the cached ActorBoundsPair for an actor.
   *
   * OpenRA 对照: partitionedMouseActorBounds[a]
   */
  getMouseBoundsPair(a: GameActor): ActorBoundsPair | undefined {
    return this.partitionedMouseActorBounds.get(a)
  }
}

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const EMPTY_POLYGON: PolygonStub = {
  vertices: [],
  isEmpty: true,
  get boundingRect(): Rectangle {
    return Rectangle.Empty
  },
  contains(_point: Vec2): boolean {
    return false
  },
}
