/**
 * SelectDirectionalTarget.ts — 方向性支援能力拖拽瞄准 OrderGenerator
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/SelectDirectionalTarget.cs (180 lines)
 *
 * 核心范式转换:
 * - C# IOrderGenerator interface → TS 独立类（实现 OrderGenerator 模式）
 * - C# MouseInput/MouseButton events → TS MouseEvent union type
 * - C# float2 for drag direction → TS {x: number, y: number}
 * - C# Game.Cursor.Lock()/Unlock() → TS cursor lock 回调
 * - C# MouseAttachmentWidget.SetAttachment() → TS 回调设置光标附着
 * - C# Ui.Root.Get<MouseAttachmentWidget>() → TS 通过依赖注入传入
 * - C# Arrow[] record struct → TS Arrow 接口数组
 * - C# WAngle.FromDegrees(angle) → TS WAngleStub (avoiding circular deps)
 * - C# GameSettings mouse button resolution → TS 桩（默认左右键）
 * - C# Map.Sequences.GetSequence().GetSprite() → TS sprite 桩
 *
 * SelectDirectionalTarget implements drag-to-set-direction targeting.
 * The player clicks, drags to set the approach direction, and releases.
 * If the drag distance exceeds MinDragThreshold, ExtraData is set to
 * the arrow's facing angle. If drag is too short, ExtraData = uint.MaxValue.
 *
 * Arrow directions (CCW, 8 directions, starting from N = (0,-1)):
 *   0: N   1: NW   2: W   3: SW   4: S   5: SE   6: E   7: NE
 * Angles (0 = North, increasing clockwise from top-down view):
 *   N=0, NW=45, W=90, SW=135, S=180, SE=225, E=270, NE=315
 */

import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { OrderStub } from './SupportPower.js'
import type { SupportPowerManager, SupportPowerInstance } from './SupportPowerManager.js'
import type { DirectionalSupportPowerInfo } from './DirectionalSupportPower.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum drag threshold in pixels (below = no direction, ExtraData = uintMax).
 *
 * OpenRA 对照: MinDragThreshold = 20
 */
const MIN_DRAG_THRESHOLD = 20

/** Maximum drag threshold in pixels (above = clamped).
 *
 * OpenRA 对照: MaxDragThreshold = 75
 */
const MAX_DRAG_THRESHOLD = 75

/** Value used when drag is too short to determine a direction.
 *
 * OpenRA 对照: uint.MaxValue (0xFFFFFFFF)
 */
const NO_DIRECTION = 0xffffffff

// ---------------------------------------------------------------------------
// ArrowDirection — WAngle stub for Arrow.direction
// OpenRA 对照: WAngle (used as direction in Arrow record)
// ---------------------------------------------------------------------------

/**
 * Minimal WAngle-like interface for Arrow direction.
 *
 * OpenRA 对照: WAngle.FromDegrees(angle)
 *
 * Only the `facing` property is needed for setting Order.ExtraData.
 * This avoids importing the full WAngle class which has lookup table deps.
 */
export interface ArrowDirection {
  /** The WAngle facing value (0-1023 representing 0-360 degrees).
   *
   * OpenRA 对照: WAngle.Facing
   */
  readonly facing: number
}

// ---------------------------------------------------------------------------
// Arrow — direction arrow metadata
// OpenRA 对照: sealed record Arrow(Sprite Sprite, double EndAngle, WAngle Direction)
// ---------------------------------------------------------------------------

/** Directional arrow metadata.
 *
 * OpenRA 对照: Arrow record
 *
 * Each arrow covers an angular sector. EndAngle is the upper bound of the
 * sector (exclusive at the high end, inclusive at the low end). Direction
 * is the WAngle facing produced when this arrow is selected.
 */
export interface Arrow {
  /** Sprite reference (stubbed — no real sprite yet).
   *
   * OpenRA 对照: Arrow.Sprite
   */
  readonly sprite: unknown

  /** Upper bound angle of this arrow's sector (degrees, 0-360).
   *
   * OpenRA 对照: Arrow.EndAngle (double)
   */
  readonly endAngle: number

  /** The direction produced when this arrow is selected.
   *
   * OpenRA 对照: Arrow.Direction (WAngle)
   */
  readonly direction: ArrowDirection
}

// ---------------------------------------------------------------------------
// MouseDragState
// ---------------------------------------------------------------------------

/**
 * Internal drag state tracked during directional targeting.
 */
interface DragState {
  /** The cell position where the drag started. */
  targetCell: CPos | null
  /** The starting mouse position. */
  targetLocation: { x: number; y: number } | null
  /** Accumulated drag direction vector. */
  dragDirection: { x: number; y: number }
  /** Whether the mouse button has been pressed. */
  activated: boolean
  /** Whether drag has started (accumulated enough movement). */
  dragStarted: boolean
  /** The currently selected arrow based on drag angle. */
  currentArrow: Arrow | null
}

// ---------------------------------------------------------------------------
// SelectDirectionalTarget
// OpenRA 对照: SelectDirectionalTarget : IOrderGenerator
// ---------------------------------------------------------------------------

/**
 * OrderGenerator for directional drag-to-aim support power targeting.
 *
 * OpenRA 对照: SelectDirectionalTarget
 *
 * Mouse interaction phases:
 *   1. Action button down → lock cursor, record target cell
 *   2. Mouse move (while activated) → accumulate drag, compute angle,
 *      select arrow sprite, update cursor
 *   3. Action button up → if drag is long enough, yield Order with facing;
 *      if too short, yield Order with NO_DIRECTION
 *
 * Cancel button at any time → exit targeting mode.
 */
export class SelectDirectionalTarget {
  /** The power key for order generation. */
  readonly orderKey: string

  private readonly manager: SupportPowerManager
  private readonly info: DirectionalSupportPowerInfo
  private readonly directionArrows: Arrow[]
  private readonly dragState: DragState

  constructor(
    order: string,
    manager: SupportPowerManager,
    info: DirectionalSupportPowerInfo,
    arrows?: Arrow[],
  ) {
    this.orderKey = order
    this.manager = manager
    this.info = info

    // Load direction arrows if not provided (for testing)
    this.directionArrows =
      arrows ??
      SelectDirectionalTarget.loadArrows(
        info.arrows ?? [],
        info.directionArrowAnimation ?? null,
      )

    // Initialize drag state
    this.dragState = {
      targetCell: null,
      targetLocation: null,
      dragDirection: { x: 0, y: 0 },
      activated: false,
      dragStarted: false,
      currentArrow: null,
    }
  }

  // -----------------------------------------------------------------------
  // Mouse input processing
  // -----------------------------------------------------------------------

  /**
   * Process a mouse button down event.
   *
   * OpenRA 对照: ActionButton + MouseInputEvent.Down branch
   *
   * @param cell — the map cell under the cursor
   * @param location — the mouse pixel location
   */
  onActionDown(cell: CPos, location: { x: number; y: number }): void {
    if (!this.dragState.activated) {
      this.dragState.targetCell = cell
      this.dragState.targetLocation = location
      this.dragState.activated = true
      // NOTE: Game.Cursor.Lock() — cursor lock deferred to UI integration
    }
  }

  /**
   * Process a mouse move event while drag is active.
   *
   * OpenRA 对照: MouseInputEvent.Move branch
   *
   * Accumulates drag delta, computes angle, selects arrow.
   *
   * @param delta — the mouse delta since the last move event
   */
  onMouseMove(delta: { x: number; y: number }): void {
    if (!this.dragState.activated) return

    // Accumulate drag direction
    this.dragState.dragDirection.x += delta.x
    this.dragState.dragDirection.y += delta.y

    // Compute angle from drag direction
    const angle = SelectDirectionalTarget.angleOf(this.dragState.dragDirection)

    // Clamp drag magnitude
    const length = SelectDirectionalTarget.vectorLength(this.dragState.dragDirection)
    if (length > MAX_DRAG_THRESHOLD) {
      const scale = -MAX_DRAG_THRESHOLD / length
      this.dragState.dragDirection.x *= scale
      this.dragState.dragDirection.y *= scale
    }

    // Select the arrow for this angle
    this.dragState.currentArrow = SelectDirectionalTarget.getArrow(
      angle,
      this.directionArrows,
    )

    // NOTE: In OpenRA: mouseAttachment.SetAttachment(targetLocation, arrow.Sprite, palette)
    // Mouse attachment is deferred to UI integration.

    this.dragState.dragStarted = true
  }

  /**
   * Process a mouse button up event — generate the order.
   *
   * OpenRA 对照: ActionButton + MouseInputEvent.Up branch
   *
   * @param _cell — the map cell under the cursor
   * @returns an Order, or null if no valid target
   */
  onActionUp(_cell: CPos): OrderStub | null {
    const isOutsideDragZone =
      this.dragState.dragStarted &&
      SelectDirectionalTarget.vectorLength(this.dragState.dragDirection) > MIN_DRAG_THRESHOLD

    const extraData = isOutsideDragZone && this.dragState.currentArrow
      ? this.dragState.currentArrow.direction.facing
      : NO_DIRECTION

    const order: OrderStub = {
      orderName: this.orderKey,
      extraData,
      targetString: null,
      target: this.dragState.targetCell
        ? {
            cell: this.dragState.targetCell,
            type: 2, // TargetType.Terrain
          }
        : null,
    }

    this.deactivate()
    return order
  }

  /**
   * Cancel the directional targeting mode.
   *
   * OpenRA 对照: CancelButton → world.CancelInputMode()
   */
  cancel(): void {
    this.deactivate()
  }

  /**
   * Deactivate — clean up drag state, release cursor.
   *
   * OpenRA 对照: IOrderGenerator.Deactivate()
   */
  deactivate(): void {
    if (this.dragState.activated) {
      // NOTE: mouseAttachment.Reset() — deferred to UI integration
      // NOTE: Game.Cursor.Unlock() — deferred to UI integration
    }

    // Reset drag state
    this.dragState.targetCell = null
    this.dragState.targetLocation = null
    this.dragState.dragDirection = { x: 0, y: 0 }
    this.dragState.activated = false
    this.dragState.dragStarted = false
    this.dragState.currentArrow = null
  }

  /**
   * Tick — cancel targeting if power becomes unavailable.
   *
   * OpenRA 对照: IOrderGenerator.Tick(World)
   *
   * @returns true if targeting is still valid
   */
  tick(): boolean {
    const instance: SupportPowerInstance | undefined = this.manager.powers.get(this.orderKey)
    if (!instance || !instance.active || !instance.ready) {
      return false
    }
    return true
  }

  /**
   * Get the cursor string for a cell.
   *
   * OpenRA 对照: IOrderGenerator.GetCursor(World, CPos, int2, MouseInput)
   *
   * @param _cell — the map cell under the cursor
   * @returns cursor name string
   */
  getCursor(_cell: CPos): string {
    return this.info.cursor ?? 'ability'
  }

  /**
   * Handle a keyboard event.
   *
   * OpenRA 对照: IOrderGenerator.HandleKeyPress(KeyInput)
   *
   * TODO: When full OrderGenerator integration is wired, this stub should
   * consume hotkeys (e.g., Esc to cancel). Currently returns false which
   * prevents cancellation via keyboard.
   *
   * @returns false — this generator does not yet consume key presses
   */
  handleKeyPress(): boolean {
    return false
  }

  /**
   * Get the currently selected arrow (for UI display).
   */
  get currentArrow(): Arrow | null {
    return this.dragState.currentArrow
  }

  /**
   * Whether drag is currently active.
   */
  get isActivated(): boolean {
    return this.dragState.activated
  }

  // -----------------------------------------------------------------------
  // Static helpers — Angle computation
  // -----------------------------------------------------------------------

  /**
   * Compute the angle (degrees) from a drag vector.
   *
   * OpenRA 对照: SelectDirectionalTarget.AngleOf(float2)
   *
   * Converts a 2D vector to a clockwise angle from North (0 = N, 90 = E, etc.).
   * This matches the OpenRA coordinate system where (0,-1) = North = 0 degrees.
   *
   * @param delta — the drag vector
   * @returns angle in degrees (0-360)
   */
  static angleOf(delta: { x: number; y: number }): number {
    const radian = Math.atan2(delta.y, delta.x)
    let d = radian * (180 / Math.PI)
    if (d < 0.0) d += 360.0
    let angle = 270.0 - d
    if (angle < 0) angle += 360.0

    return angle
  }

  /**
   * Find the arrow for a given angle.
   *
   * OpenRA 对照: SelectDirectionalTarget.GetArrow(double)
   *
   * Uses first-over-threshold: returns the first arrow whose EndAngle
   * is >= the given angle. If none match, returns the first arrow.
   *
   * @param degree — the angle in degrees (0-360)
   * @param arrows — the arrow array to search
   * @returns the matching arrow
   */
  static getArrow(degree: number, arrows: readonly Arrow[]): Arrow {
    for (const arrow of arrows) {
      if (arrow.endAngle >= degree) return arrow
    }
    return arrows[0]
  }

  /**
   * Load direction arrows from sequence data.
   *
   * OpenRA 对照: SelectDirectionalTarget.LoadArrows(string, World, int)
   *
   * Creates an Arrow array evenly dividing 360 degrees among the given count.
   * Each arrow covers a sector of 360/N degrees centered on its facing angle.
   *
   * @param arrowNames — the sequence names for each arrow
   * @param _animation — the animation name (unused, sprites stubbed)
   * @returns array of Arrow objects
   */
  static loadArrows(
    arrowNames: readonly string[],
    _animation: string | null,
  ): Arrow[] {
    const noOfPoints = arrowNames.length
    if (noOfPoints === 0) return []

    const points: Arrow[] = []
    const partAngle = 360 / noOfPoints
    const i1 = partAngle / 2

    for (let i = 0; i < noOfPoints; i++) {
      // NOTE: In OpenRA, sprite is loaded from Sequences:
      //   world.Map.Sequences.GetSequence(cursorAnimation, arrows[i]).GetSprite(0)
      // In TypeScript, sprite loading is deferred.
      const sprite: unknown = null

      const angle = i * partAngle
      const direction = SelectDirectionalTargetDirectionStub.fromDegrees(angle)
      const endAngle = angle + i1

      points.push({ sprite, endAngle, direction })
    }

    return points
  }

  /**
   * Compute the length of a 2D vector.
   */
  static vectorLength(v: { x: number; y: number }): number {
    return Math.sqrt(v.x * v.x + v.y * v.y)
  }
}

// ---------------------------------------------------------------------------
// SelectDirectionalTargetDirectionStub — WAngle stub for Arrow.direction
// ---------------------------------------------------------------------------

/**
 * Minimal WAngle stub used by SelectDirectionalTarget.loadArrows().
 *
 * OpenRA 对照: WAngle.FromDegrees(angle)
 *
 * Provides the `facing` property used to set Order.ExtraData.
 * Not exported — use ArrowDirection interface for type compatibility.
 */
class SelectDirectionalTargetDirectionStub implements ArrowDirection {
  /** The WAngle facing value (0-1023 representing 0-360 degrees). */
  readonly facing: number

  private constructor(facing: number) {
    this.facing = facing
  }

  /**
   * Create from angle in degrees.
   * Converts degrees (0-360) to WAngle range (0-1024).
   */
  static fromDegrees(degrees: number): ArrowDirection {
    const facing = Math.round(((degrees % 360) * 1024) / 360) & 0x3ff
    return new SelectDirectionalTargetDirectionStub(facing)
  }
}
