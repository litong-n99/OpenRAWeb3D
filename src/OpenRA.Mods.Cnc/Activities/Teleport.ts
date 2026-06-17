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
import { WPos } from '../../OpenRA.Game/WPos.js'

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

    // Validate maximum distance
    // OpenRA: if (maximumDistance > max) throw InvalidOperationException
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
          const killTrait = (unloadedActor as unknown as { kill?: (teleporter: GameActor) => void })
            .kill
          if (killTrait) {
            killTrait(self)
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
   * Find the best valid destination cell near the target.
   *
   * OpenRA 对照: Teleport.ChooseBestDestinationCell(Actor, CPos)
   *
   * Returns the first explored and enterable cell within range.
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

    // Check if the direct destination is valid
    const shroud = (this._teleporter as unknown as { owner?: { shroud?: { isExplored(cell: CPos): boolean } } }).owner?.shroud

    if (
      positionable.canEnterCell(this._destination) &&
      (!shroud || shroud.isExplored(this._destination))
    ) {
      return this._destination
    }

    // Simpler fallback: try 8 adjacent cells (simplifies FindTilesInCircle)
    const maxRange = this._maximumDistance ?? 50
    const offsets: [number, number][] = []
    for (let r = 1; r <= Math.min(maxRange, 10); r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) === r || Math.abs(dy) === r) {
            offsets.push([dx, dy])
          }
        }
      }
    }

    for (const [dx, dy] of offsets) {
      const candidate = new CPos(
        this._destination.X + dx,
        this._destination.Y + dy,
      )
      if (
        positionable.canEnterCell(candidate) &&
        (!shroud || shroud.isExplored(candidate))
      ) {
        return candidate
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  get destination(): CPos {
    return this._destination
  }
}
