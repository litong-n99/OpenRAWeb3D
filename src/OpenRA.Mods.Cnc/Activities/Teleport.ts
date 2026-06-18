/**
 * Teleport.ts -- 超时空传送活动（带多阶段视觉延迟状态机）
 * OpenRA 对照: OpenRA.Mods.Cnc/Activities/Teleport.cs (144 lines)
 *
 * 核心范式转换:
 * - C# Teleport : Activity -> TypeScript Teleport extends Activity
 * - C# single-tick execution -> TypeScript multi-tick state machine
 *   (Init -> PreDelay -> DuringDelay -> Execute -> PostDelay -> Complete)
 * - C# self.Trait<IPositionable>().SetPosition() -> TypeScript duck-typed Mobile
 * - C# self.Generation++ -> TypeScript generation++ for sync invalidation
 * - C# Game.Sound.Play -> TypeScript audio stub (console.log)
 * - C# ChronoshiftPostProcessEffect.Enable() -> TypeScript screen flash stub
 * - C# PortableChrono.ResetChargeTime() -> TypeScript duck-typed trait call
 * - C# Cargo.Unload / self.Kill -> TypeScript duck-typed trait calls
 * - C# Map.FindTilesInCircle / CanEnterCell -> TypeScript simplified cell search
 *
 * 3D 视觉适配:
 * - PreDelay: 屏幕褪色效果（chronoshift pre-flash）
 * - DuringDelay: 时空漩涡动画（chrono vortex）
 * - PostDelay: 恢复期（screen recovery）
 *
 * NOTE: 3D visual effects (mesh fade-out + chrono vortex + mesh fade-in)
 * are deferred to Phase B/C rendering. The logic layer handles delay timing
 * and position change.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// TeleportPhase -- 传送阶段枚举
// ---------------------------------------------------------------------------

/**
 * Phases of the multi-tick teleport state machine.
 *
 * OpenRA 对照: (无 -- OpenRA 原始 Teleport 是单 tick 完成，多阶段是 3D 适配)
 */
export const TeleportPhase = {
  /** First tick: record origin, begin countdown. */
  Init: 0,
  /** Pre-teleport delay (screen flash effect window). */
  PreDelay: 1,
  /** Mid-teleport pause (chrono vortex effect window). */
  DuringDelay: 2,
  /** Execute the actual position change and cleanup. */
  Execute: 3,
  /** Post-teleport recovery delay (visual fade-in window). */
  PostDelay: 4,
  /** Activity is complete. */
  Complete: 5,
} as const

export type TeleportPhase = (typeof TeleportPhase)[keyof typeof TeleportPhase]

// ---------------------------------------------------------------------------
// Default phase durations (in ticks, 25 ticks/sec)
// ---------------------------------------------------------------------------

const DEFAULT_PRE_DELAY = 10
const DEFAULT_DURING_DELAY = 5
const DEFAULT_POST_DELAY = 10

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

/** Minimal Kill-like trait for damage types.
 *
 * OpenRA 对照: IKill (actor Kill method with damage types)
 */
interface KillLike {
  kill(actor: GameActor, damageTypes: Set<string>): void
}

// ---------------------------------------------------------------------------
// Trait lookup helper -- centralizes the duck-typed trait access pattern
// ---------------------------------------------------------------------------

/**
 * Look up a trait by name from an actor's duck-typed trait map.
 *
 * Centralizes the repeated pattern:
 *   (self as unknown as Record<string, unknown>).traits?.get(name) as T
 *
 * @param self -- the actor to query
 * @param name -- trait name (e.g. 'Mobile', 'Kill', 'PortableChrono')
 * @returns the trait cast to T, or undefined if not found
 */
function getTrait<T>(self: GameActor, name: string): T | undefined {
  return (self as unknown as { traits?: Map<string, unknown> }).traits?.get(name) as unknown as T | undefined
}

// ---------------------------------------------------------------------------
// Teleport -- activity implementation
// OpenRA 对照: Teleport : Activity
// ---------------------------------------------------------------------------

/**
 * Activity that teleports an actor with multi-tick visual delay phases.
 *
 * OpenRA 对照: Teleport
 *
 * The multi-tick state machine provides windows for 3D visual effects:
 * - PreDelay: screen desaturate / chrono flash
 * - DuringDelay: chrono vortex effect
 * - Execute: position change, cargo kill, charge consumption
 * - PostDelay: screen recovery
 *
 * When `useDelays` is false (legacy single-tick mode), the activity
 * completes in a single tick for backward compatibility.
 */
export class Teleport extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration fields (对应 OpenRA Teleport constructor params)
  // ---------------------------------------------------------------------------

  private readonly _teleporter: GameActor | null
  private readonly _maximumDistance: number | null
  private readonly _killOnFailure: boolean
  private readonly _killCargo: boolean
  private readonly _screenFlash: boolean
  private readonly _sound: string
  private readonly _killDamageTypes: Set<string>
  private readonly _returnToOrigin: boolean

  private _destination: CPos

  // ---------------------------------------------------------------------------
  // Phase state
  // ---------------------------------------------------------------------------

  private _phase: TeleportPhase = TeleportPhase.Init
  private _phaseTick: number = 0

  // ---------------------------------------------------------------------------
  // Phase durations (configurable, in ticks)
  // ---------------------------------------------------------------------------

  private readonly _preDelayTicks: number
  private readonly _duringDelayTicks: number
  private readonly _postDelayTicks: number

  // ---------------------------------------------------------------------------
  // Origin recording (for return-to-origin and testing)
  // ---------------------------------------------------------------------------

  private _origin: WPos | null = null
  private _originCell: CPos | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: Teleport(teleporter, destination, maximumDistance,
  //   killCargo, screenFlash, sound, interruptable, killOnFailure,
  //   killDamageTypes)
  // ---------------------------------------------------------------------------

  /**
   * Create a Teleport activity.
   *
   * OpenRA 对照: Teleport constructor
   *
   * @param teleporter -- the chronosphere building / actor casting the
   *   teleport, or null if self-teleporting (e.g., PortableChrono)
   * @param destination -- the target cell to teleport to
   * @param maximumDistance -- maximum allowed distance (null for no limit).
   *   Validated against map grid MaximumTileSearchRange.
   * @param killCargo -- whether passengers should be destroyed on teleport
   * @param screenFlash -- whether to trigger a screen flash effect
   * @param sound -- sound effect name to play
   * @param interruptable -- whether the activity can be interrupted
   *   (default: true)
   * @param killOnFailure -- whether to kill the actor if teleport fails
   *   (default: false)
   * @param killDamageTypes -- damage types for kill-on-failure
   *   (default: empty set)
   * @param returnToOrigin -- whether this is a return trip to the
   *   original position. Affects screen flash (suppressed on return)
   *   and origin recording. (default: false)
   * @param preDelayTicks -- ticks for PreDelay phase (default: 10)
   * @param duringDelayTicks -- ticks for DuringDelay phase (default: 5)
   * @param postDelayTicks -- ticks for PostDelay phase (default: 10)
   */
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
    preDelayTicks: number = DEFAULT_PRE_DELAY,
    duringDelayTicks: number = DEFAULT_DURING_DELAY,
    postDelayTicks: number = DEFAULT_POST_DELAY,
    returnToOrigin: boolean = false,
    maxTileSearchRange: number = 50,
  ) {
    super()

    // OpenRA: Validate maximumDistance against map's max tile search range
    // var max = teleporter.World.Map.Grid.MaximumTileSearchRange;
    //
    // TODO: Query teleporter.world.map.grid.MaximumTileSearchRange when World
    // reference is available. The hardcoded 50 is sufficient for standard maps
    // (128x128 with 50-cell teleport range) but may fail for very large maps
    // with non-rectangular grid types.
    const effectiveTileSearchRange = maxTileSearchRange
    if (maximumDistance !== null && maximumDistance > effectiveTileSearchRange) {
      throw new Error(
        `Teleport distance cannot exceed MaximumTileSearchRange (${effectiveTileSearchRange}). Got: ${maximumDistance}`,
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
    this._returnToOrigin = returnToOrigin
    this._preDelayTicks = Math.max(0, preDelayTicks)
    this._duringDelayTicks = Math.max(0, duringDelayTicks)
    this._postDelayTicks = Math.max(0, postDelayTicks)

    if (!interruptable) {
      this.isInterruptible = false
    }
  }

  // ---------------------------------------------------------------------------
  // Tick -- state machine
  // OpenRA 对照: Teleport.Tick(Actor)
  //
  // The C# original does everything in one tick. This TS adaptation uses a
  // multi-phase state machine to provide windows for 3D visual effects.
  // ---------------------------------------------------------------------------

  /**
   * Advance the teleport state machine by one tick.
   *
   * OpenRA 对照: Teleport.Tick(Actor)
   *
   * State machine phases:
   *   Init -> PreDelay -> DuringDelay -> Execute -> PostDelay -> Complete
   *
   * @returns true when the activity is complete
   */
  override tick(self: GameActor): boolean {
    // Check PortableChrono canTeleport (runs every tick, not just Execute)
    const pc = getTrait<PortableChronoLike>(self, 'PortableChrono')

    if (
      this._teleporter === self &&
      pc !== undefined &&
      (!pc.canTeleport || this.isCanceling)
    ) {
      if (this._killOnFailure) {
        const killTrait = getTrait<KillLike>(self, 'Kill')
        killTrait?.kill(self, this._killDamageTypes)
      }
      return true
    }

    // Advance through phases
    switch (this._phase) {
      case TeleportPhase.Init:
        return this._tickInit(self)

      case TeleportPhase.PreDelay:
        return this._tickPreDelay()

      case TeleportPhase.DuringDelay:
        return this._tickDuringDelay()

      case TeleportPhase.Execute:
        return this._tickExecute(self)

      case TeleportPhase.PostDelay:
        return this._tickPostDelay()

      case TeleportPhase.Complete:
        return true

      default:
        return true
    }
  }

  // ---------------------------------------------------------------------------
  // Phase tick methods
  // ---------------------------------------------------------------------------

  /**
   * Init phase: record origin, validate destination, and start pre-delay.
   */
  private _tickInit(self: GameActor): boolean {
    // Record origin position for return-to-origin and testing
    const actorAny = self as unknown as { centerPosition?: WPos; location?: CPos }
    if (this._origin === null) {
      this._origin = actorAny.centerPosition ?? WPos.Zero
      this._originCell = actorAny.location ?? CPos.Zero
    }

    // Validate the destination cell
    const bestCell = this._chooseBestDestinationCell(self)
    if (bestCell === null) {
      if (this._killOnFailure) {
        const killTrait = getTrait<KillLike>(self, 'Kill')
        killTrait?.kill(self, this._killDamageTypes)
      }
      return true
    }

    this._destination = bestCell

    this._phaseTick = this._preDelayTicks

    if (this._phaseTick > 0) {
      this._phase = TeleportPhase.PreDelay
      return false
    }

    // PreDelay is zero -- skip to DuringDelay
    this._phaseTick = this._duringDelayTicks
    if (this._phaseTick > 0) {
      this._phase = TeleportPhase.DuringDelay
      return false
    }

    // All pre-execute delays are zero -- execute immediately.
    // PostDelay is handled by _tickExecute after the teleport occurs.
    this._phase = TeleportPhase.Execute
    return this._tickExecute(self)
  }

  /**
   * PreDelay phase: countdown before teleport.
   * Window for screen desaturate / chrono flash effect.
   */
  private _tickPreDelay(): boolean {
    // NOTE: Screen flash trigger (3D visual effect) deferred to Phase B
    if (this._screenFlash && !this._returnToOrigin) {
      // OpenRA: foreach actorWithTrait<ChronoshiftPostProcessEffect> a.Trait.Enable()
      // TODO: 3D post-process screen flash
    }

    this._phaseTick--
    if (this._phaseTick <= 0) {
      this._phase = TeleportPhase.DuringDelay
      this._phaseTick = this._duringDelayTicks
      if (this._phaseTick <= 0) {
        this._phase = TeleportPhase.Execute
      }
    }
    return false
  }

  /**
   * DuringDelay phase: mid-teleport pause.
   * Window for chrono vortex / particle effect.
   */
  private _tickDuringDelay(): boolean {
    // NOTE: Chrono vortex effect (3D particle/visual) deferred to Phase B
    this._phaseTick--
    if (this._phaseTick <= 0) {
      this._phase = TeleportPhase.Execute
    }
    return false
  }

  /**
   * Execute phase: perform the actual teleport.
   * Sets position, kills cargo, consumes charges, triggers building animation.
   */
  private _tickExecute(self: GameActor): boolean {
    // Play sound at source and destination
    // OpenRA: Game.Sound.Play(SoundType.World, sound, self.CenterPosition)
    // OpenRA: Game.Sound.Play(SoundType.World, sound, world.Map.CenterOfCell(destination))
    // TODO: Play sound once at source and once at destination when Ch7 Sound system is wired in
    void this._sound

    // Set new position
    const pos = getTrait<PositionableLike>(self, 'Mobile')
    const fallbackPos = getTrait<PositionableLike>(self, 'OccupiesSpace')
    const positionable = pos ?? fallbackPos

    if (positionable) {
      positionable.setPosition(self, this._destination)
    }

    // Increment generation for sync-hash invalidation
    const actorAny = self as unknown as { generation: number }
    actorAny.generation = (actorAny.generation ?? 0) + 1

    // Kill cargo if needed
    if (this._killCargo) {
      const cargo = getTrait<CargoLike>(self, 'Cargo')
      if (cargo && this._teleporter !== null) {
        while (!cargo.isEmpty()) {
          const unloadedActor = cargo.unload(self)
          // Kill all units unloaded into the void
          // OpenRA: a.Kill(teleporter) -- death attributed to teleporter, not self
          const killTrait = (unloadedActor as unknown as { kill?: (teleporter: GameActor) => void })
            .kill
          if (killTrait && this._teleporter) {
            killTrait(this._teleporter)
          }
        }
      }
    }

    // Consume teleport charges (if self-teleporting via PortableChrono)
    const portableChrono = getTrait<PortableChronoLike>(self, 'PortableChrono')
    if (this._teleporter === self && portableChrono) {
      portableChrono.resetChargeTime()
    }

    // Screen flash effect (trigger on execute, suppressed for return trips)
    if (this._screenFlash && !this._returnToOrigin) {
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
      const building = getTrait<WithSpriteBodyLike>(this._teleporter, 'WithSpriteBody')
      if (
        building &&
        building.defaultAnimation.hasSequence('active')
      ) {
        building.playCustomAnimation(this._teleporter, 'active')
      }
    }

    // Advance to PostDelay or complete
    this._phaseTick = this._postDelayTicks

    if (this._phaseTick <= 0) {
      // No post-delay -- complete immediately
      this._phase = TeleportPhase.Complete
      this.state = ActivityState.Done
      return true
    }

    this._phase = TeleportPhase.PostDelay
    return false
  }

  /**
   * PostDelay phase: recovery delay after teleport.
   * Window for screen fade-in / actor materialization effect.
   */
  private _tickPostDelay(): boolean {
    // NOTE: Screen recovery effect (3D visual) deferred to Phase B
    this._phaseTick--
    if (this._phaseTick <= 0) {
      this._phase = TeleportPhase.Complete
      this.state = ActivityState.Done
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // OpenRA 对照: Activity.Cancel(Actor, bool)
  //
  // NOTE: OpenRA Teleport does NOT override Cancel() -- the base Activity
  // Cancel is sufficient (single-tick). The TS multi-tick version overrides
  // it to skip remaining delay phases when interrupted.
  // ---------------------------------------------------------------------------

  /**
   * Cancel the teleport activity.
   *
   * OpenRA 对照: (3D adaptation -- no override in C# single-tick version)
   *
   * If cancelled during delay phases (PreDelay, DuringDelay, PostDelay),
   * the teleport is either completed immediately (if Execute already ran)
   * or aborted without moving the actor.
   */
  override cancel(self: GameActor, keepQueue: boolean = false): void {
    // If already executed (past Execute phase), we're essentially done --
    // skip remaining delay and complete. The position change and cargo
    // kill are already committed and cannot be rolled back.
    if (
      this._phase === TeleportPhase.PostDelay ||
      this._phase === TeleportPhase.Complete
    ) {
      // Execute already happened -- let the base cancel logic mark us done
    }

    // If in Init/PreDelay/DuringDelay, the teleport hasn't executed yet.
    // The base cancel logic will interrupt and skip execution.
    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // OnLastRun
  // ---------------------------------------------------------------------------

  /**
   * Cleanup after activity completes or is cancelled.
   *
   * OpenRA 对照: (3D adaptation -- C# has no cleanup needed for single tick)
   */
  protected override onLastRun(_self: GameActor): void {
    // NOTE: Any 3D visual effect cleanup (remove vortex particles, restore
    // screen saturation) would go here. Deferred to Phase B.
    super.onLastRun(_self)
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
   * 1. If maximumDistance is set, restrict search to tiles within that radius
   *    of self.Location
   * 2. Start from desired destination, expand outward by distance via
   *    FindTilesInCircle
   * 3. Return the first explored + enterable cell
   */
  private _chooseBestDestinationCell(self: GameActor): CPos | null {
    if (this._teleporter === null) return null

    const pos = getTrait<PositionableLike>(self, 'Mobile')
    const fallbackPos = getTrait<PositionableLike>(self, 'OccupiesSpace')
    const positionable = pos ?? fallbackPos

    if (!positionable) return null

    const shroud = (this._teleporter as unknown as {
      owner?: { shroud?: { isExplored(cell: CPos): boolean } }
    }).owner?.shroud
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

    // NOTE: TS version finds nearest enterable cell via radial search from
    // original destination. C# first adjusts destination to closest cell
    // within restricted area via restrictTo.MinBy(x => (x - destination)
    // .LengthSquared) before radial search. The TS approach is equivalent
    // for the common case where the desired destination is within the
    // restricted area.

    // Generate all tiles within maxRadius once, sort by Manhattan distance
    // to destination (closest first).  This avoids O(r^3) duplicate checks
    // from regenerating + re-sorting tiles for each radius increment.
    const allTiles = this._findTilesInCircle(this._destination, maxRadius)
    allTiles.sort((a, b) => {
      const da =
        Math.abs(a.X - this._destination.X) +
        Math.abs(a.Y - this._destination.Y)
      const db =
        Math.abs(b.X - this._destination.X) +
        Math.abs(b.Y - this._destination.Y)
      return da - db
    })

    for (const tile of allTiles) {
      // Skip tiles outside the restricted area
      const key = tile.X * 65536 + tile.Y
      if (restrictTo !== null && !restrictTo.has(key)) continue

      // Check shroud explored
      if (shroud && !shroud.isExplored(tile)) continue

      // Check enterable
      if (!positionable.canEnterCell(tile)) continue

      return tile
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

  /** The current destination cell (may be adjusted from initial target).
   *
   * OpenRA 对照: (no equivalent -- C# Teleport has `destination` field)
   */
  get destination(): CPos {
    return this._destination
  }

  /** The current phase of the teleport state machine.
   *
   * OpenRA 对照: (3D adaptation -- no equivalent in C#)
   */
  get phase(): TeleportPhase {
    return this._phase
  }

  /** The current tick within the active phase.
   *
   * OpenRA 对照: (3D adaptation -- no equivalent in C#)
   */
  get phaseTick(): number {
    return this._phaseTick
  }

  /** The recorded origin position (set in onFirstRun).
   *
   * OpenRA 对照: (3D adaptation -- C# Teleport does not store origin)
   */
  get origin(): WPos | null {
    return this._origin
  }

  /** The recorded origin cell (set in onFirstRun).
   *
   * OpenRA 对照: (3D adaptation -- C# Teleport does not store origin)
   */
  get originCell(): CPos | null {
    return this._originCell
  }

  /** The teleporter actor (chronosphere building or self).
   *
   * OpenRA 对照: Teleport.teleporter
   */
  get teleporter(): GameActor | null {
    return this._teleporter
  }

  /** Whether this is a return-to-origin trip.
   *
   * OpenRA 对照: (3D adaptation -- no equivalent in C#)
   */
  get returnToOrigin(): boolean {
    return this._returnToOrigin
  }

  /** Whether cargo is killed on teleport.
   *
   * OpenRA 对照: Teleport.killCargo
   */
  get killCargo(): boolean {
    return this._killCargo
  }
}
