/**
 * Drag.ts — 拖拽/推动活动（将 actor 从起点平滑移动到终点）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/Drag.cs
 *
 * 核心范式转换:
 * - C# IPositionable/IDisabledTrait/IMove casts → TypeScript type assertions
 * - C# WPos.Lerp → WPos.lerp (static method)
 * - C# QueueChild(Turn) → queueChild(new Turn(...))
 * - C# IsInterruptible = false → isInterruptible = false
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IPositionable, IDisabledTrait, IMove } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { Turn } from '../Turn'

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

/**
 * Smoothly drag an actor from a start position to an end position over a fixed number of ticks.
 *
 * OpenRA 对照: Drag activity
 *
 * Used for scripted movements, docking sequences, and cinematic transitions.
 * The actor's center position is interpolated each tick via WPos.lerp.
 * Optionally turns the actor to a desired facing before starting.
 */
export class Drag extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly positionable: IPositionable
  readonly disableable: IDisabledTrait | null
  readonly start: WPos
  readonly end: WPos
  readonly length: number
  readonly desiredFacing: WAngle | null

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private ticks: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new Drag activity.
   *
   * OpenRA 对照: Drag(Actor, WPos, WPos, int, WAngle?)
   *
   * @param self — the actor being dragged
   * @param start — the starting world position
   * @param end — the ending world position
   * @param length — number of ticks the drag should take
   * @param facing — optional desired facing angle
   */
  constructor(
    self: GameActor,
    start: WPos,
    end: WPos,
    length: number,
    facing: WAngle | null = null,
  ) {
    super()
    this.positionable = self as unknown as IPositionable
    const move = self as unknown as IMove
    this.disableable = (move as unknown as IDisabledTrait) ?? null
    this.start = start
    this.end = end
    this.length = length
    this.desiredFacing = facing
    this.isInterruptible = false
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Queue a Turn child if a desired facing was specified.
   *
   * OpenRA 对照: Drag.OnFirstRun()
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.desiredFacing !== null) {
      this.queueChild(new Turn(self, this.desiredFacing))
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Interpolate position each tick.
   *
   * OpenRA 对照: Drag.Tick(Actor)
   *
   * @param self — the actor being dragged
   * @returns true when the drag is complete
   */
  override tick(self: GameActor): boolean {
    if (this.disableable !== null && this.disableable.isTraitDisabled)
      return false

    const pos = this.length > 1
      ? WPos.lerp(this.start, this.end, this.ticks, this.length - 1)
      : this.end

    this.positionable.setCenterPosition(self, pos)
    this.ticks++
    return this.ticks >= this.length
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get targets for target line rendering.
   *
   * OpenRA 对照: Drag.GetTargets(Actor)
   */
  override getTargets(_self: GameActor): Target[] {
    return [Target.fromPos(this.end)]
  }

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: Drag.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    return [new TargetLineNode(Target.fromPos(this.end), { r: 0, g: 1, b: 0, a: 1 })]
  }
}
