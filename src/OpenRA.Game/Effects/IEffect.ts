/**
 * IEffect.ts — Visual/non-visual effects that run outside the Actor system
 * OpenRA 对照: OpenRA.Game/Effects/IEffect.cs
 *
 * 核心范式转换:
 * - C# IEffect.Tick(World) + Render(WorldRenderer) returning
 *   IEnumerable<IRenderable> (yield return) → TypeScript typed interface
 *   with tick(world) + render(wr) returning IRenderable[]
 * - C# ISpatiallyPartitionable marker interface → empty TypeScript interface
 * - C# IEffectAboveShroud / IEffectAnnotation sub-interfaces with
 *   RenderAboveShroud/RenderAnnotation → direct TypeScript equivalents
 * - IGameEffect + IGameEffectSync moved from World.ts into this file
 *   (single source of truth for effect type hierarchy)
 * - Effects self-remove via world.addFrameEndTask(() => world.removeEffect(this))
 *   matching OpenRA's w.Remove(this) pattern — no isDone flag needed
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameWorldManager } from '../World.js'
import type { WorldRendererStub, IRenderable } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IGameEffect — base effect interface (moved from World.ts)
// 对应 OpenRA IEffect.Tick(World) — minimal tick-only view
// ---------------------------------------------------------------------------

/**
 * Base interface for effects ticked each game logic tick.
 *
 * OpenRA 对照: OpenRA.Game/Effects/IEffect.cs — IEffect.Tick(World)
 *
 * IGameEffect is the minimal interface used by GameWorldManager for the
 * tick phase. The full IEffect extends this with render() support.
 *
 * NOTE: Originally defined in World.ts; moved here as single source of
 * truth for the effect type hierarchy.
 */
export interface IGameEffect {
  /** Called every game logic tick.
   *
   * OpenRA 对照: IEffect.Tick(World)
   */
  tick(world: GameWorldManager): void
}

/**
 * Marker interface for sync-relevant effects.
 *
 * OpenRA 对照: ISync (marker interface)
 */
export interface IGameEffectSync extends IGameEffect {
  // intentionally empty — marker for SyncHash participation
}

// ---------------------------------------------------------------------------
// IEffect — full effect interface (对应 OpenRA IEffect)
// ---------------------------------------------------------------------------

/**
 * Interface for time-limited effects that run outside the Actor system.
 *
 * OpenRA 对照: OpenRA.Effects.IEffect
 *
 * Effects are ticked by World alongside Actors but are not Actors themselves.
 * Used for projectiles, explosions, screen shakes, delayed callbacks, and
 * other visual or non-visual one-shot operations.
 *
 * Effects self-remove via world.addFrameEndTask(() => world.removeEffect(this)),
 * matching OpenRA's `w.Remove(this)` pattern. No isDone flag is used — the
 * frameEndTask drain in World.tick() handles cleanup.
 */
export interface IEffect extends IGameEffect {
  /** Called each logic tick by GameWorldManager.
   *
   * OpenRA 对照: IEffect.Tick(World)
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void

  /** Collect renderables for this frame.
   *
   * OpenRA 对照: IEffect.Render(WorldRenderer)
   *
   * Returns an empty array for effects with no visual component.
   *
   * @param worldRenderer — the world renderer
   * @returns array of renderable objects (may be empty)
   */
  render(worldRenderer: WorldRendererStub): readonly IRenderable[]
}

// ---------------------------------------------------------------------------
// ISpatiallyPartitionable — marker for effects registered in ScreenMap
// (对应 OpenRA ISpatiallyPartitionable)
// ---------------------------------------------------------------------------

/**
 * Identifier interface for effects that are added to ScreenMap.
 *
 * OpenRA 对照: OpenRA.Effects.ISpatiallyPartitionable
 *
 * Effects implementing this interface will be registered in the spatial
 * index for screen-space queries (e.g., mouse hit-testing for tooltips).
 * This is a marker interface — no members required.
 */
export interface ISpatiallyPartitionable {
  // intentionally empty — marker interface
}

// ---------------------------------------------------------------------------
// IEffectAboveShroud — effects rendered above the shroud/fog layer
// (对应 OpenRA IEffectAboveShroud)
// ---------------------------------------------------------------------------

/**
 * Interface for effects that render above the shroud (fog of war) layer.
 *
 * OpenRA 对照: OpenRA.Effects.IEffectAboveShroud
 *
 * Renderables returned by renderAboveShroud() are drawn after the shroud
 * pass, ensuring they are visible even in fog-of-war areas.
 *
 * @example Cursor flash, selection indicators, range circles
 */
export interface IEffectAboveShroud {
  /** Collect renderables to draw above the shroud layer.
   *
   * OpenRA 对照: IEffectAboveShroud.RenderAboveShroud(WorldRenderer)
   *
   * @param wr — the world renderer
   * @returns array of renderable objects
   */
  renderAboveShroud(wr: WorldRendererStub): readonly IRenderable[]
}

// ---------------------------------------------------------------------------
// IEffectAnnotation — effects rendered as annotations (top-most layer)
// (对应 OpenRA IEffectAnnotation)
// ---------------------------------------------------------------------------

/**
 * Interface for effects that render as annotations (HUD overlay layer).
 *
 * OpenRA 对照: OpenRA.Effects.IEffectAnnotation
 *
 * Renderables returned by renderAnnotation() are drawn in the annotations
 * pass, which is the top-most rendering layer above all world geometry,
 * shroud, and fog.
 *
 * @example Floating text, HP bars, waypoint markers
 */
export interface IEffectAnnotation {
  /** Collect renderables to draw in the annotation layer.
   *
   * OpenRA 对照: IEffectAnnotation.RenderAnnotation(WorldRenderer)
   *
   * @param wr — the world renderer
   * @returns array of renderable objects
   */
  renderAnnotation(wr: WorldRendererStub): readonly IRenderable[]
}
