/**
 * CreateEffectWarhead.ts -- Spawns visual effect (sprite + sound) on impact
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/CreateEffectWarhead.cs
 *
 * 核心范式转换:
 * - C# SpriteEffect via world.AddFrameEndTask → SpriteEffectData deferred effect
 * - C# Game.Sound.Play via global Sound → SoundEffectData deferred effect
 * - C# WorldUtils.FindActorsOnCircle(pos, WDist.Zero) → findActorsOnCircle()
 * - C# Map.DistanceAboveTerrain → duck-typed map.distanceAboveTerrain()
 * - C# TargetTypeAir for airburst → Warhead.airThreshold check
 * - C# ImmutableArray.RandomOrDefault → array random element selection
 * - C# WVec.FromPDF inaccuracy → simplified random inaccuracy
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  Warhead,
  ImpactActorType,
  StandardTargetTypes,
  type WarheadArgs,
  type WarheadEffect,
  type SpriteEffectData,
  type SoundEffectData,
  type WarheadActorLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CreateEffectWarhead (对应 OpenRA CreateEffectWarhead)
// ---------------------------------------------------------------------------

/**
 * Spawns a visual sprite effect and optional sound on impact.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.CreateEffectWarhead
 *
 * Features:
 * - Explosion animation sequence at impact position
 * - Player-color palette remap support
 * - Impact sounds with configurable chance
 * - Actor validation (skip if only invalid actors at impact)
 * - Terrain validation for empty-impact positions
 * - Air burst detection (airThreshold)
 * - Positional inaccuracy
 */
export class CreateEffectWarhead extends Warhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** List of explosion sequence names (randomly selected).
   *
   * OpenRA 对照: CreateEffectWarhead.Explosions
   */
  explosions: string[] = []

  /** Image containing explosion effect sequence.
   *
   * OpenRA 对照: CreateEffectWarhead.Image
   */
  image: string = 'explosion'

  /** Palette to use for explosion effect.
   *
   * OpenRA 对照: CreateEffectWarhead.ExplosionPalette
   */
  explosionPalette: string = 'effect'

  /** Remap explosion to player color if art supports it.
   *
   * OpenRA 对照: CreateEffectWarhead.UsePlayerPalette
   */
  usePlayerPalette: boolean = false

  /** Display explosion at ground level regardless of altitude.
   *
   * OpenRA 对照: CreateEffectWarhead.ForceDisplayAtGroundLevel
   */
  forceDisplayAtGroundLevel: boolean = false

  /** List of sounds that can be played on impact.
   *
   * OpenRA 对照: CreateEffectWarhead.ImpactSounds
   */
  impactSounds: string[] = []

  /** Chance of impact sound to play (0-100).
   *
   * OpenRA 对照: CreateEffectWarhead.ImpactSoundChance
   */
  impactSoundChance: number = 100

  /** Whether to consider actors for explosion validation.
   *
   * OpenRA 对照: CreateEffectWarhead.ImpactActors
   */
  impactActors: boolean = true

  /** Maximum inaccuracy of effect spawn position.
   *
   * OpenRA 对照: CreateEffectWarhead.Inaccuracy
   */
  inaccuracy: WDist = WDist.Zero

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Explosions !== undefined) this.explosions = json.Explosions as string[]
    if (json.Image !== undefined) this.image = json.Image as string
    if (json.ExplosionPalette !== undefined) this.explosionPalette = json.ExplosionPalette as string
    if (json.UsePlayerPalette !== undefined) this.usePlayerPalette = !!json.UsePlayerPalette
    if (json.ForceDisplayAtGroundLevel !== undefined) this.forceDisplayAtGroundLevel = !!json.ForceDisplayAtGroundLevel
    if (json.ImpactSounds !== undefined) this.impactSounds = json.ImpactSounds as string[]
    if (json.ImpactSoundChance !== undefined) this.impactSoundChance = json.ImpactSoundChance as number
    if (json.ImpactActors !== undefined) this.impactActors = !!json.ImpactActors
    if (json.Inaccuracy !== undefined) this.inaccuracy = new WDist(json.Inaccuracy as number)
  }

  // -----------------------------------------------------------------------
  // Override: isValidAgainst (simplified — skips AffectsParent check)
  // -----------------------------------------------------------------------

  /**
   * ActorTypeAtImpact already checks AffectsParent beforehand,
   * to avoid parent HitShape look-ups (and to prevent returning
   * ImpactActorType.Invalid on AffectsParent = false).
   *
   * OpenRA 对照: CreateEffectWarhead.IsValidAgainst(Actor victim, Actor firedBy)
   */
  override isValidAgainst(victim: IGameActor, firedBy: IGameActor): boolean {
    const relationship = this._getDuckRelationship(firedBy.owner, victim.owner)
    if (!this._hasValidRelationship(relationship)) return false

    const targetTypes = (victim as unknown as WarheadActorLike).getEnabledTargetTypes?.()
    if (!this.isValidTarget(targetTypes)) return false

    return true
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Spawn visual and sound effects at the impact position.
   *
   * OpenRA 对照: CreateEffectWarhead.DoImpact(in Target target, WarheadArgs args)
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    _args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: (SpriteEffectData | SoundEffectData)[] = []

    // Check actor presence at impact position
    const actorAtImpact = this.impactActors
      ? this._actorTypeAtImpact(pos, firedBy)
      : ImpactActorType.None

    // Ignore if only invalid actors at impact
    if (actorAtImpact === ImpactActorType.Invalid) return []

    // Check terrain validity if no actors present
    if (actorAtImpact === ImpactActorType.None && !this._isValidAgainstTerrain(pos, firedBy)) {
      return []
    }

    // Select random explosion sequence
    const explosion = this._randomPick(this.explosions)
    if (this.image && explosion) {
      let effectPos = pos

      // Apply inaccuracy
      if (this.inaccuracy.length > 0) {
        effectPos = this._applyInaccuracy(effectPos)
      }

      // Force to ground level
      if (this.forceDisplayAtGroundLevel) {
        const world = (firedBy as unknown as WarheadActorLike).world
        if (world?.map) {
          const dat = world.map.distanceAboveTerrain(effectPos)
          effectPos = new WPos(
            effectPos.X,
            effectPos.Y,
            effectPos.Z - dat.length,
          )
        }
      }

      // Compute palette
      let palette = this.explosionPalette
      if (this.usePlayerPalette && firedBy.owner) {
        palette += (firedBy.owner as unknown as { internalName?: string }).internalName ?? ''
      }

      effects.push({
        type: 'sprite',
        pos: effectPos,
        image: this.image,
        sequence: explosion,
        palette,
      } as SpriteEffectData)
    }

    // Play sound
    const impactSound = this._randomPick(this.impactSounds)
    if (impactSound && this._randomRange(0, 100) < this.impactSoundChance) {
      effects.push({
        type: 'sound',
        name: impactSound,
        pos,
      } as SoundEffectData)
    }

    return effects
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check actor types at the impact position.
   *
   * OpenRA 对照: CreateEffectWarhead.ActorTypeAtImpact(World world, WPos pos, Actor firedBy)
   */
  private _actorTypeAtImpact(pos: WPos, firedBy: IGameActor): ImpactActorType {
    const world = (firedBy as unknown as WarheadActorLike).world
    if (!world || !world.findActorsOnCircle) return ImpactActorType.None

    let anyInvalidActor = false

    // Check actors at exactly the impact position (radius = 0)
    const victims = world.findActorsOnCircle(pos, WDist.Zero)
    if (!victims || victims.length === 0) return ImpactActorType.None

    for (const victim of victims) {
      if (!this.affectsParent && (victim as unknown) === (firedBy as unknown)) continue

      // Check if victim's HitShape contains the impact point
      const hasHitAtPos = this._hasHitShapeAtPos(victim, pos)
      if (!hasHitAtPos) continue

      if (this.isValidAgainst(victim as unknown as IGameActor, firedBy))
        return ImpactActorType.Valid

      anyInvalidActor = true
    }

    return anyInvalidActor ? ImpactActorType.Invalid : ImpactActorType.None
  }

  /**
   * Check if a victim has any active HitShape that covers the given position.
   */
  private _hasHitShapeAtPos(victim: WarheadActorLike, pos: WPos): boolean {
    const positions = victim.enabledTargetablePositions
    if (!positions) return false

    for (const tp of positions) {
      const shape = tp as { distanceFromEdge?: (v: unknown, p: WPos) => WDist }
      if (shape.distanceFromEdge) {
        const d = shape.distanceFromEdge(victim as unknown as IGameActor, pos)
        if (d.length <= 0) return true
      }
    }

    return false
  }

  /**
   * Check if the warhead is valid against the terrain at impact position.
   *
   * OpenRA 对照: CreateEffectWarhead.IsValidAgainstTerrain(World world, WPos pos)
   */
  private _isValidAgainstTerrain(pos: WPos, firedBy: IGameActor): boolean {
    const world = (firedBy as unknown as WarheadActorLike).world
    if (!world?.map) return false

    const map = world.map
    const cell = map.cellContaining(pos)
    if (!map.contains(cell)) return false

    const dat = map.distanceAboveTerrain(pos)

    if (dat.length > this.airThreshold.length) {
      // Air burst: check Air target type
      const airSet = new Set([StandardTargetTypes.Air])
      return this.isValidTarget(airSet)
    }

    // Ground: check terrain target types
    const terrainInfo = map.getTerrainInfo(cell)
    return this.isValidTarget(terrainInfo.targetTypes)
  }

  /**
   * Apply random inaccuracy to a position.
   *
   * OpenRA 对照: WVec.FromPDF(SharedRandom, 2) * Inaccuracy.Length / 1024
   *
   * NOTE: Simplified implementation using Math.random().
   * Full MersenneTwister-based FromPDF will replace this when the
   * random system is migrated.
   */
  private _applyInaccuracy(pos: WPos): WPos {
    // Box-Muller transform for 2D Gaussian-like distribution
    const u1 = Math.random()
    const u2 = Math.random()
    const safeU1 = Math.max(u1, 0.0001)
    const r = Math.sqrt(-2 * Math.log(safeU1))
    const theta = 2 * Math.PI * u2
    const scale = this.inaccuracy.length / 1024

    return new WPos(
      pos.X + Math.trunc(r * Math.cos(theta) * scale),
      pos.Y + Math.trunc(r * Math.sin(theta) * scale),
      pos.Z,
    )
  }

  /**
   * Pick a random element from an array (or null if empty).
   *
   * OpenRA 对照: ImmutableArray.RandomOrDefault(Random)
   */
  private _randomPick<T>(arr: T[]): T | null {
    if (arr.length === 0) return null
    return arr[Math.floor(Math.random() * arr.length)]
  }

  /**
   * Generate a random number in [min, max).
   */
  private _randomRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min
  }

  /**
   * Duck-typed relationship check between two player stubs.
   */
  private _getDuckRelationship(
    from: unknown,
    to: unknown,
  ): number {
    const fromAny = from as Record<string, unknown> | undefined
    if (fromAny && typeof fromAny['relationshipWith'] === 'function') {
      return (fromAny['relationshipWith'] as (o: unknown) => number)(to)
    }
    // Default: different players = Enemy
    return from === to ? 4 /* Ally */ : 1 /* Enemy */
  }

  /**
   * Check if the warhead's valid relationships include the given one.
   */
  private _hasValidRelationship(rel: number): boolean {
    return (this.validRelationships & rel) === rel
  }
}
