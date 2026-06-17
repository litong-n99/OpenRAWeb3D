/**
 * Teleport.ts — 超时空传送活动（瞬间位置变换带视觉效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Activities/Teleport.cs (144 lines)
 *
 * 核心范式转换:
 * - C# Teleport : Activity → TypeScript Teleport extends Activity
 * - C# self.Trait<IPositionable>().SetPosition() → TypeScript duck-typed Mobile
 * - C# self.Generation++ → TypeScript generation++ for sync invalidation
 * - C# Game.Sound.Play → TypeScript audio stub
 * - C# ChronoshiftPostProcessEffect.Enable() → TypeScript screen flash stub
 * - C# PortableChrono.ResetChargeTime() → TypeScript duck-typed trait call
 * - C# Cargo.Unload / self.Kill → TypeScript duck-typed trait calls
 * - C# Map.FindTilesInCircle / CanEnterCell → TypeScript simplified cell search
 *
 * NOTE: 3D visual effect (mesh fade-out + chrono vortex + mesh fade-in)
 * is deferred to Phase C rendering. The logic layer handles position change.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Trait interfaces (duck-typed)
// ---------------------------------------------------------------------------

/** Minimal IPositionable for setPosition.
 *
 * OpenRA 对照: IPositionable
 */
interface PositionableLike {
  setPosition(self: GameActor, cell: CPos, subCell?: number): void
  canEnterCell(cell: CPos): boolean
}

/** Minimal PortableChrono for charge management.
 *
 * OpenRA 对照: PortableChrono
 */
interface PortableChronoLike {
  readonly canTeleport: boolean
  resetChargeTime(): void
}

/** Minimal Cargo for killCargo handling.
 *
 * OpenRA 对照: Cargo
 */
interface CargoLike {
  isEmpty(): boolean
  unload(self: GameActor): GameActor
}

/** Minimal WithSpriteBody for animation trigger.
 *
 * OpenRA 对照: WithSpriteBody
 */
interface WithSpriteBodyLike {
  readonly defaultAnimation: { hasSequence(seq: string): boolean }
  playCustomAnimation(self: GameActor, sequence: string): void
}

// ---------------------------------------------------------------------------
// Teleport — activity implementation
// OpenRA 对照: Teleport : Activity
// ---------------------------------------------------------------------------

/**
 * Activity that instantly teleports an actor from one cell to another.
 *
 * OpenRA 对照: Teleport
 *
 * Handles: position set, cargo kill, chrono charge consumption,
 * screen flash effect, and sound playback. Chooses the best available
 * destination cell near the target.
 */
export class Teleport extends Activity {
  private readonly _teleporter: GameActor | null
  private readonly _maximumDistance: number | null
  private readonly _killOnFailure: boolean
  private readonly _killCargo: boolean
  private readonly _screenFlash: boolean
  private readonly _sound: string
  private readonly _killDamageTypes: Set<string>

  private _destination: CPos

  constructor(
    teleporter: GameActor | null,
    destination: CPos,
    maximumDistance: number | null,
    killCargo: boolean,
    screenFlash: boolean,
    sound: string,
    interruptable: boolean = true,
    killOnFailure: boolean = false,
    killDamageTypes: Set<string> = new Set(),
  ) {
    super()

    // OpenRA: Validate maximumDistance against map's max tile search range
    // var max = teleporter.World.Map.Grid.MaximumTileSearchRange;
    const maxTileSearchRange = 50 // Default: OpenRA map grid max
    if (maximumDistance !== null && maximumDistance > maxTileSearchRange) {
      throw new Error(
        `Teleport distance cannot exceed MaximumTileSearchRange (${maxTileSearchRange}). Got: ${maximumDistance}`,
      )
    }

    this._teleporter = teleporter
    this._destination = destination
    this._maximumDistance = maximumDistance
    this._killCargo = killCargo
    this._screenFlash = screenFlash
    this._sound = sound
    this._killOnFailure = killOnFailure
    this._killDamageTypes = killDamageTypes

    if (!interruptable) {
      this.isInterruptible = false
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: Teleport.Tick(Actor)
  // ---------------------------------------------------------------------------

  /**
   * Execute the teleport in a single tick.
   *
   * OpenRA 对照: Teleport.Tick(Actor)
   *
   * @returns true (always completes in one tick)
   */
  override tick(self: GameActor): boolean {
    const selfAny = self as unknown as { traits?: Map<string, unknown> }

    // Check PortableChrono canTeleport
    const pc = selfAny.traits?.get('PortableChrono') as unknown as
      | PortableChronoLike
      | undefined

    if (
      this._teleporter === self &&
      pc !== undefined &&
      (!pc.canTeleport || this.isCanceling)
    ) {
      if (this._killOnFailure) {
        const killTrait = selfAny.traits?.get('Kill') as unknown as
          | { kill(actor: GameActor, damageTypes: Set<string>): void }
          | undefined
        killTrait?.kill(self, this._killDamageTypes)
      }
      return true
    }

    // Choose best destination cell
    const bestCell = this._chooseBestDestinationCell(self)
    if (bestCell === null) {
      if (this._killOnFailure) {
        const killTrait = selfAny.traits?.get('Kill') as unknown as
          | { kill(actor: GameActor, damageTypes: Set<string>): void }
          | undefined
        killTrait?.kill(self, this._killDamageTypes)
      }
      return true
    }

    this._destination = bestCell

    // Play sound at source and destination
    // OpenRA: Game.Sound.Play(SoundType.World, sound, self.CenterPosition)
    // OpenRA: Game.Sound.Play(SoundType.World, sound, world.Map.CenterOfCell(destination))
    void this._sound // deferred to audio system

    // Set new position
    const pos = selfAny.traits?.get('Mobile') as unknown as
      | PositionableLike
      | undefined
    const fallbackPos = selfAny.traits?.get('OccupiesSpace') as unknown as
      | PositionableLike
      | undefined
    const positionable = pos ?? fallbackPos

    if (positionable) {
      positionable.setPosition(self, this._destination)
    }

    // Increment generation for sync-hash invalidation
    const actorAny = self as unknown as { generation: number }
    actorAny.generation = (actorAny.generation ?? 0) + 1

    // Kill cargo if needed
    if (this._killCargo) {
      const cargo = selfAny.traits?.get('Cargo') as unknown as
        | CargoLike
        | undefined
      if (cargo && this._teleporter !== null) {
        while (!cargo.isEmpty()) {
          const unloadedActor = cargo.unload(self)
          // Kill all units unloaded into the void
          // OpenRA: a.Kill(teleporter) — death attributed to teleporter, not self
          const killTrait = (unloadedActor as unknown as { kill?: (teleporter: GameActor) => void })
            .kill
          if (killTrait && this._teleporter) {
            killTrait(this._teleporter)
          }
        }
      }
    }

    // Consume teleport charges
    if (this._teleporter === self && pc) {
      pc.resetChargeTime()
    }

    // Screen flash effect
    if (this._screenFlash) {
      // OpenRA: foreach actorsWithTrait ChronoshiftPostProcessEffect, call Enable()
      // NOTE: Screen flash deferred to Phase C rendering
      void self
    }

    // Trigger teleporter building animation
    if (
      this._teleporter !== null &&
      self !== this._teleporter &&
      !this._teleporter.disposed
    ) {
      const teleporterTraits = this._teleporter as unknown as {
        traits?: Map<string, unknown>
      }
      const building = teleporterTraits.traits?.get('WithSpriteBody') as unknown as
        | WithSpriteBodyLike
        | undefined
      if (
        building &&
        building.defaultAnimation.hasSequence('active')
      ) {
        building.playCustomAnimation(this._teleporter, 'active')
      }
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // ChooseBestDestinationCell (private)
  // OpenRA 对照: Teleport.ChooseBestDestinationCell()
  // ---------------------------------------------------------------------------

  /**
   * Find the best valid destination cell near the target using FindTilesInCircle.
   *
   * OpenRA 对照: Teleport.ChooseBestDestinationCell(Actor, CPos)
   *
   * OpenRA algorithm:
   * 1. If maximumDistance is set, restrict search to tiles within that radius of self.Location
   * 2. Start from desired destination, expand outward by distance via FindTilesInCircle
   * 3. Return the first explored + enterable cell
   */
  private _chooseBestDestinationCell(self: GameActor): CPos | null {
    if (this._teleporter === null) return null

    const selfAny = self as unknown as {
      location: CPos
      traits?: Map<string, unknown>
    }
    const pos = selfAny.traits?.get('Mobile') as unknown as
      | PositionableLike
      | undefined
    const fallbackPos = selfAny.traits?.get('OccupiesSpace') as unknown as
      | PositionableLike
      | undefined
    const positionable = pos ?? fallbackPos

    if (!positionable) return null

    const shroud = (this._teleporter as unknown as { owner?: { shroud?: { isExplored(cell: CPos): boolean } } }).owner?.shroud
    const selfLocation = (self as unknown as { location: CPos }).location

    // Build restricted tile set if maximumDistance is specified
    let restrictTo: Set<number> | null = null
    const maxRadius = this._maximumDistance ?? 50

    if (this._maximumDistance !== null) {
      restrictTo = new Set<number>()
      const tiles = this._findTilesInCircle(selfLocation, this._maximumDistance)
      for (const tile of tiles) {
        restrictTo.add(tile.X * 65536 + tile.Y)
      }
    }

    // Expand search from destination outward by increasing radius
    for (let r = 0; r <= maxRadius; r++) {
      const tiles = this._findTilesInCircle(this._destination, r)
      // Sort by distance to destination (closest first)
      tiles.sort((a, b) => {
        const da = Math.abs(a.X - this._destination.X) + Math.abs(a.Y - this._destination.Y)
        const db = Math.abs(b.X - this._destination.X) + Math.abs(b.Y - this._destination.Y)
        return da - db
      })

      for (const tile of tiles) {
        // Skip tiles outside the restricted area
        const key = tile.X * 65536 + tile.Y
        if (restrictTo !== null && !restrictTo.has(key)) continue

        // Check shroud explored
        if (shroud && !shroud.isExplored(tile)) continue

        // Check enterable
        if (!positionable.canEnterCell(tile)) continue

        return tile
      }
    }

    return null
  }

  /** Find all tiles within a given radius (Manhattan) of a center cell.
   *
   * OpenRA 对照: OpenRA.Map.FindTilesInCircle(CPos, int)
   */
  private _findTilesInCircle(center: CPos, radius: number): CPos[] {
    const result: CPos[] = []
    for (let dx = -radius; dx <= radius; dx++) {
      const maxDy = radius - Math.abs(dx)
      for (let dy = -maxDy; dy <= maxDy; dy++) {
        result.push(new CPos(center.X + dx, center.Y + dy))
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  get destination(): CPos {
    return this._destination
  }
}
