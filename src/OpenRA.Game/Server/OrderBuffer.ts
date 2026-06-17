/**
 * OrderBuffer.ts -- Dynamic order timing system for multiplayer game
 * synchronization. Tracks per-player order timestamps, computes median
 * deltas against the fastest (baseline) connection, and produces per-player
 * TickScale values (1.0-1.1 range) to slow down fast connections so that
 * slower connections can keep up.
 *
 * OpenRA 对照: OpenRA.Game/Server/OrderBuffer.cs (139 lines C#)
 *
 * 核心范式转换:
 * - C# ConcurrentDictionary<int, long> timestamps ->
 *   Map<number, number> (single-threaded, no concurrent access)
 * - C# ConcurrentDictionary<int, Queue<long>> deltas ->
 *   Map<number, number[]> (array as queue, single-threaded)
 * - C# Stopwatch.ElapsedMilliseconds ->
 *   performance.now() for high-resolution monotonic timing
 * - C# Interlocked.Exchange(ref baselinePlayer) ->
 *   Direct assignment (single-threaded)
 * - C# IEnumerable<(int, float)> yield return ->
 *   Array<{ playerIndex: number; tickScale: number }>
 * - C# tickScale.Clamp(1f, MaxTickScale) ->
 *   Math.max(1.0, Math.min(MaxTickScale, value))
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameSpeed } from './Server.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of frames of history to keep for each player's delta queue. */
const NumberOfFrames = 20

/** Interval in milliseconds for recomputing tick scales. */
const Interval = 1000

/** Maximum tick scale multiplier (10% slowdown max). */
const MaxTickScale = 1.1

/** Sentinel value indicating no timestamp has been recorded for a player. */
const EmptyValue = -1

// ---------------------------------------------------------------------------
// OrderBuffer Class
// ---------------------------------------------------------------------------

/**
 * Dynamic order timing system. Measures per-player network latency deltas
 * relative to the baseline (fastest) player and computes per-player
 * TickScale values to synchronize game speed across connections of
 * varying quality.
 *
 * OpenRA 对照: class OrderBuffer
 */
export class OrderBuffer {
  // ---- Private State ----

  /** Next timestamp at which tick scales should be recomputed. */
  private _nextUpdate = 0

  /** Game timestep in milliseconds (e.g., 40ms for "faster" speed). */
  private _timestep = 0

  /** Ticks per Interval (1000 / timestep). */
  private _ticksPerInterval = 0

  /** Player index of the baseline (reference) connection. */
  private _baselinePlayer = 0

  /** Active player indices. */
  private _players: number[] = []

  /**
   * Per-player timestamp map. playerIndex -> last order timestamp (ms),
   * or EmptyValue (-1) if no timestamp has been recorded for the current
   * measurement cycle.
   */
  private _timestamps: Map<number, number> = new Map()

  /**
   * Per-player delta queue. playerIndex -> array of recent delta values
   * (capped at NumberOfFrames). Each delta is the time difference between
   * the baseline player's timestamp and this player's timestamp for a
   * given measurement cycle.
   */
  private _deltas: Map<number, number[]> = new Map()

  // ---------------------------------------------------------------------------
  // addOrderTimestamp (对应 C# AddOrderTimestamp)
  // ---------------------------------------------------------------------------

  /**
   * Record a timestamp for a player's most recent order. When all players
   * have reported, computes delta values and resets for the next cycle.
   *
   * OpenRA 对照: OrderBuffer.AddOrderTimestamp(int)
   *
   * @param playerIndex -- Index of the player who sent an order
   */
  addOrderTimestamp(playerIndex: number): void {
    if (!this._timestamps.has(playerIndex)) return

    this._timestamps.set(playerIndex, performance.now())

    // Check if ALL players have reported this cycle
    let allPresent = true
    for (const ts of this._timestamps.values()) {
      if (ts === EmptyValue) {
        allPresent = false
        break
      }
    }

    if (allPresent) {
      const baseline = this._timestamps.get(this._baselinePlayer)!

      for (const [player, timestamp] of this._timestamps) {
        // dt = how much slower/faster this player is vs baseline
        // Negative dt means the player is SLOWER than baseline
        const dt = baseline - timestamp

        const queue = this._deltas.get(player)!
        queue.push(dt)
        if (queue.length > NumberOfFrames) {
          queue.shift()
        }

        // Reset for next measurement cycle
        this._timestamps.set(player, EmptyValue)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // start (对应 C# Start)
  // ---------------------------------------------------------------------------

  /**
   * Initialize the order buffer with a game speed configuration and
   * player list.
   *
   * OpenRA 对照: OrderBuffer.Start(GameSpeed, IEnumerable<int>)
   *
   * @param gameSpeed -- Game speed configuration (timestep, orderLatency)
   * @param players   -- Player indices to track
   */
  start(gameSpeed: GameSpeed, players: Iterable<number>): void {
    this._timestep = gameSpeed.timestep
    this._ticksPerInterval = Interval / this._timestep

    this._players = [...players]
    this._baselinePlayer = this._players.length > 0 ? this._players[0] : 0

    // Initialize timestamp and delta maps for all players
    this._timestamps.clear()
    this._deltas.clear()

    for (const player of this._players) {
      this._timestamps.set(player, EmptyValue)
      this._deltas.set(player, [])
    }

    this._nextUpdate = performance.now() + Interval
  }

  // ---------------------------------------------------------------------------
  // getTickScales (对应 C# GetTickScales)
  // ---------------------------------------------------------------------------

  /**
   * Compute per-player tick scale values. Called periodically by the
   * server tick loop. Returns empty array if the update interval has not
   * elapsed or if there is insufficient data to compute reliable scales.
   *
   * Algorithm:
   * 1. Compute median delta for each player's delta queue
   * 2. Find the minimum (most-negative) median delta
   * 3. Compute offset = abs(minDelta) if minDelta < 0, else 0
   *    (This shifts all deltas so the slowest player gets tickScale = 1.0)
   * 4. For each player: tickScale = (timestep + (delta + offset) / ticksPerInterval) / timestep
   * 5. Clamp to [1.0, MaxTickScale]
   *
   * OpenRA 对照: OrderBuffer.GetTickScales() -> IEnumerable<(int, float)>
   *
   * @returns Array of { playerIndex, tickScale } objects, empty if not ready
   */
  getTickScales(): Array<{ playerIndex: number; tickScale: number }> {
    const now = performance.now()

    // Return empty if interval hasn't elapsed
    if (now < this._nextUpdate) {
      return []
    }

    this._nextUpdate = now + Interval

    // Need at least one delta queue
    if (this._deltas.size === 0) {
      return []
    }

    // All queues must be full (NumberOfFrames elements) for reliable statistics
    let allReady = true
    for (const queue of this._deltas.values()) {
      if (queue.length !== NumberOfFrames) {
        allReady = false
        break
      }
    }
    if (!allReady) {
      return []
    }

    // Compute median for each player
    const medians: Array<{ playerIndex: number; delta: number }> = []
    for (const [playerIndex, queue] of this._deltas) {
      medians.push({ playerIndex, delta: OrderBuffer.median(queue) })
    }

    // Find the minimum (most-negative) median -- the slowest connection
    const minDelta = Math.min(...medians.map((m) => m.delta))
    const offset = minDelta < 0 ? Math.abs(minDelta) : 0

    // Compute tick scales
    const results: Array<{ playerIndex: number; tickScale: number }> = []
    for (const { playerIndex, delta } of medians) {
      const deltaPerTick = (delta + offset) / this._ticksPerInterval
      const tickScale = (this._timestep + deltaPerTick) / this._timestep
      const adjusted = Math.max(1.0, Math.min(MaxTickScale, tickScale))
      results.push({ playerIndex, tickScale: adjusted })
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // removePlayer (对应 C# RemovePlayer)
  // ---------------------------------------------------------------------------

  /**
   * Remove a player from tracking (e.g., on disconnect).
   * Reassigns the baseline player if the removed player was the baseline.
   *
   * OpenRA 对照: OrderBuffer.RemovePlayer(int)
   *
   * @param playerIndex -- Player index to remove
   */
  removePlayer(playerIndex: number): void {
    this._players = this._players.filter((p) => p !== playerIndex)

    // Reassign baseline if the baseline player was removed and others remain
    if (playerIndex === this._baselinePlayer && this._players.length > 0) {
      this._baselinePlayer = this._players[0]
    }

    this._timestamps.delete(playerIndex)
    this._deltas.delete(playerIndex)
  }

  // ---------------------------------------------------------------------------
  // median (static) — 对应 C# static long Median(long[])
  // ---------------------------------------------------------------------------

  /**
   * Compute the median of a numeric array.
   *
   * Creates a sorted copy to avoid mutating the input.
   *
   * OpenRA 对照: static long Median(long[] a)
   *   Array.Sort(a), if odd -> a[n/2], else -> (a[(n-1)/2] + a[n/2]) / 2
   *
   * @param a -- Array of numbers (order timestamps in ms)
   * @returns The median value
   */
  static median(a: readonly number[]): number {
    const n = a.length
    if (n === 0) return 0
    if (n === 1) return a[0]

    const sorted = [...a].sort((x, y) => x - y)
    const mid = Math.floor(n / 2)

    if (n % 2 !== 0) {
      return sorted[mid]
    }

    return (sorted[mid - 1] + sorted[mid]) / 2
  }
}
