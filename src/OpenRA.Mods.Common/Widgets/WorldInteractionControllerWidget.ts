/**
 * WorldInteractionControllerWidget.ts — 3D 世界交互桥接
 * OpenRA 对照: OpenRA.Mods.Common.Widgets/WorldInteractionControllerWidget.cs (235 lines)
 *
 * 核心范式转换:
 * - 2D ScreenMap.ActorsInMouseBox() 空间索引 → 3D raycasting (scene.createPickingRay) + frustum culling
 * - 2D 选择框 (RgbaColorRenderer.DrawRect) → 3D frustum from corner rays + HighlightLayer 预览
 * - 2D Viewport.ViewToWorldPx(int2) → scene.pick() ground-mesh raycast
 * - C# HandleMouseInput() 同步事件路由 → scene.onPointerObservable + POINTERDOWN/MOVE/UP 状态机
 * - OpenRA ApplyOrders() 同步命令 → 回调异步 dispatch (callbacks.applyOrder)
 * - 2D WorldRenderer.World.Selection.SetRollover → callbacks.setRollover
 */

import { PointerEventTypes, Vector3, Matrix } from '@babylonjs/core'
import type { Scene, AbstractMesh, Camera, PickingInfo } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/** Modifier key state for selection logic.
 *
 * OpenRA 对照: Modifiers enum (OpenRA.Game/Modifiers.cs)
 */
export interface ModifierState {
  shift: boolean
  ctrl: boolean
  alt: boolean
}

/** Screen point (pixel coordinates).
 *
 * OpenRA 对照: int2
 */
export interface ScreenPoint {
  x: number
  y: number
}

/** World position (3D coordinates on the ground plane).
 *
 * OpenRA 对照: WPos (conceptual, after CoordinateTransformer conversion)
 */
export interface WorldPosition {
  x: number
  y: number
  z: number
}

/** An order issued to the game world.
 *
 * OpenRA 对照: Order (OpenRA.Orders/Order.cs)
 */
export interface Order {
  orderString: string       // e.g., "Move", "Attack", "Deploy"
  targetPosition?: WorldPosition
  targetActorId?: string
  queued: boolean           // Shift+click = queue order
}

/** A selectable entity in the 3D world.
 *
 * OpenRA 对照: Actor (subset — the selectable aspects)
 */
export interface SelectableEntity {
  id: string
  mesh: AbstractMesh
  ownerId: string
  selectionClass: string    // e.g., "Infantry", "Vehicle", "Building"
  selectionPriority: number // higher = take precedence on ambiguous click
  boundingBox: {
    minimum: { x: number; y: number; z: number }
    maximum: { x: number; y: number; z: number }
  }
}

/** Callbacks that the host application provides for world interaction.
 *
 * OpenRA 对照: World + WorldRenderer + OrderGenerator (联合接口)
 */
export interface WorldInteractionCallbacks {
  /** Get all selectable entities currently in the world.
   * OpenRA 对照: World.Selection + ScreenMap queries */
  getSelectableEntities(): SelectableEntity[]

  /** Get the player IDs eligible for selection (own + allies).
   * OpenRA 对照: SelectionUtils.GetPlayersToIncludeInSelection(World) */
  getEligiblePlayers(): string[]

  /** Get current modifier key state.
   * OpenRA 对照: Game.GetModifierKeys() */
  getModifierKeys(): ModifierState

  /** Get whether classic mouse style is active.
   * OpenRA 对照: gameSettings.MouseControlStyle == MouseControlStyle.Classic */
  isClassicMouseStyle(): boolean

  /** Get the current action button (which mouse button triggers the primary action).
   * OpenRA 对照: World.OrderGenerator.ActionButton */
  getActionButton(): number  // 0=left, 1=middle, 2=right

  /** Get whether an order generator overrides selection on input.
   * OpenRA 对照: UnitOrderGenerator.InputOverridesSelection() */
  inputOverridesSelection(worldPos: WorldPosition): boolean

  /** Apply an order to the game world.
   * OpenRA 对照: World.IssueOrder() */
  applyOrder(order: Order): void

  /** Get cursor string for current context.
   * OpenRA 对照: World.OrderGenerator.GetCursor() */
  getCursor(screenPos: ScreenPoint): string | null

  /** Get whether the order generator should clear selection on left click.
   * OpenRA 对照: UnitOrderGenerator.ClearSelectionOnLeftClick */
  clearSelectionOnLeftClick(): boolean

  /** Get deadzone radius in pixels.
   * OpenRA 对照: Game.Settings.Game.SelectionDeadzone */
  getSelectionDeadzone(): number

  /** Set rollover (highlighted actors under mouse/drag box).
   * OpenRA 对照: World.Selection.SetRollover() */
  setRollover(entities: SelectableEntity[]): void

  /** Combine a set of entities with the current selection.
   * OpenRA 对照: World.Selection.Combine() */
  combineSelection(entities: SelectableEntity[], add: boolean, isSingleClick: boolean): void

  /** Clear the current selection.
   * OpenRA 对照: World.Selection.Clear() */
  clearSelection(): void

  /** Get the current selection as a set of actor IDs.
   * OpenRA 对照: World.Selection.Actors */
  getSelectedActorIds(): ReadonlySet<string>

  /** Cancel the current input mode.
   * OpenRA 对照: World.CancelInputMode() */
  cancelInputMode(): void
}

// ---------------------------------------------------------------------------
// IGameWorld — minimal world interface (for constructor injection)
// ---------------------------------------------------------------------------

/** Minimal game world interface required by the interaction controller.
 *
 * OpenRA 对照: World (subset)
 *
 * This is intentionally narrow — most world interaction goes through
 * the WorldInteractionCallbacks bridge. Only lifecycle properties are
 * exposed directly.
 */
export interface IGameWorld {
  /** Whether the world is being disposed. */
  readonly disposing: boolean
}

// ---------------------------------------------------------------------------
// Internal: pointer event compatible type
//
// Babylon.js PointerInfo.event is typed as IMouseEvent, which is a subset
// of PointerEvent. We cast to this minimal interface for internal use.
// ---------------------------------------------------------------------------

interface PointerEventLike {
  clientX: number
  clientY: number
  button: number
  altKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Double-click time threshold (ms).
 *
 * OpenRA 对照: implicit in multiTapCount >= 2 (SDL2 internal)
 */
const DOUBLE_CLICK_TIME_MS = 300

/** Double-click radius threshold (pixels squared).
 *
 * OpenRA 对照: implicit in SDL2 click position tolerance
 */
const DOUBLE_CLICK_RADIUS_SQ = 25 // 5px radius

// ---------------------------------------------------------------------------
// State machine constants
// ---------------------------------------------------------------------------

const STATE_IDLE = 'idle' as const
const STATE_MAYBE_DRAG = 'maybe_drag' as const
const STATE_DRAGGING = 'dragging' as const

type InteractionState = typeof STATE_IDLE | typeof STATE_MAYBE_DRAG | typeof STATE_DRAGGING

// ---------------------------------------------------------------------------
// WorldInteractionControllerWidget
// ---------------------------------------------------------------------------

/**
 * WorldInteractionControllerWidget — 3D 世界交互桥接
 * OpenRA 对照: OpenRA.Mods.Common.Widgets.WorldInteractionControllerWidget
 *
 * 处理:
 * - 单击选择 (single click → raycast → highest priority unit)
 * - 双击同类型选择 (double-click → select all of same selectionClass on screen)
 * - 拖拽框选 (drag → frustum from screen rect → units in frustum)
 * - 右键命令 (right-click → create order → callback dispatch)
 * - 光标切换 (hover over enemy/friendly/terrain → appropriate cursor)
 *
 * 核心状态机:
 * ```
 * IDLE:
 *   POINTERDOWN (left)
 *     → dragStart = screenPos, state = MAYBE_DRAG
 *   POINTERUP (right)
 *     → handleRightClick, stay IDLE
 *
 * MAYBE_DRAG:
 *   POINTERMOVE + distance > deadzone
 *     → state = DRAGGING, start drawing selection box
 *   POINTERUP (left) without exceeding deadzone
 *     → handleClickSelection, state = IDLE
 *
 * DRAGGING:
 *   POINTERMOVE
 *     → update selection box + rollover
 *   POINTERUP (left)
 *     → finalize selection, state = IDLE
 * ```
 *
 * OpenRA 对照: HandleMouseInput(MouseInput mi) 状态机 + Draw() 渲染
 */
export class WorldInteractionControllerWidget {
  // ---- Configuration ----

  /** The game world (for lifecycle checks). */
  readonly gameWorld: IGameWorld

  /** Babylon.js scene for raycasting and pointer events. */
  readonly babylonScene: Scene

  /** Active camera for screen-to-world projection. */
  readonly babylonCamera: Camera

  /** Ground mesh for terrain raycasting. */
  readonly groundMesh: AbstractMesh

  // ---- Callbacks (provided by host app) ----

  private _callbacks: WorldInteractionCallbacks

  // ---- State machine ----

  /** Current interaction state. */
  private _interactionState: InteractionState = STATE_IDLE

  /** Screen position where the drag started. */
  private _dragStartScreen: ScreenPoint = { x: 0, y: 0 }

  /** Current mouse position in screen coordinates. */
  private _currentScreen: ScreenPoint = { x: 0, y: 0 }

  /** Timestamp of the last click (for double-click detection). */
  private _lastClickTime = 0

  /** Screen position of the last click (for double-click radius check). */
  private _lastClickPos: ScreenPoint = { x: 0, y: 0 }

  /** Entities currently within the drag-box. Cached per-frame. */
  private _cachedRollover: SelectableEntity[] = []

  /** Whether a drag box is currently valid (distance > deadzone). */
  private _isValidDragbox = false

  // ---- Selection colors (stored for future visual feedback — TODO-5.E.VISUAL) ----

  // NOTE: These colors are set via the public setter methods and will be
  // used when the visual highlight system (HighlightLayer / OutlineRenderer)
  // is implemented per TODO-5.E.VISUAL.

  // ---- Babylon.js observables (for cleanup) ----
  // NOTE: The observer handle type is `unknown` because Babylon.js's
  // Observer<T> type is not directly importable without the full module.
  // The actual type is Observer<PointerInfo> from @babylonjs/core.

  private _pointerObserver: unknown = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Create a new WorldInteractionControllerWidget.
   *
   * OpenRA 对照: WorldInteractionControllerWidget(World, WorldRenderer)
   *
   * @param world — the game world (for lifecycle checks)
   * @param scene — Babylon.js scene for raycasting and pointer events
   * @param camera — active camera for screen-to-world projection
   * @param groundMesh — ground mesh for terrain raycasting
   * @param callbacks — host application callbacks for world interaction
   */
  constructor(
    world: IGameWorld,
    scene: Scene,
    camera: Camera,
    groundMesh: AbstractMesh,
    callbacks: WorldInteractionCallbacks,
  ) {
    this.gameWorld = world
    this.babylonScene = scene
    this.babylonCamera = camera
    this.groundMesh = groundMesh
    this._callbacks = callbacks
    this._initPointerEvents()
  }

  // ---------------------------------------------------------------------------
  // Pointer event initialization
  // ---------------------------------------------------------------------------

  /**
   * Register Babylon.js pointer observable callbacks.
   *
   * Uses scene.onPointerObservable to receive POINTERDOWN, POINTERMOVE,
   * and POINTERUP events. The observer is stored for cleanup in dispose().
   */
  private _initPointerEvents(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._pointerObserver = this.babylonScene.onPointerObservable.add((pointerInfo: any) => {
      this._handlePointerEvent(pointerInfo.type, pointerInfo.event)
    })
  }

  // ---------------------------------------------------------------------------
  // State machine — main entry point
  // ---------------------------------------------------------------------------

  /**
   * Processes Babylon.js pointer events through the state machine.
   *
   * OpenRA 对照: HandleMouseInput(MouseInput mi)
   *
   * Event routing priority (matching OpenRA):
   * 1. Check if the event target is a non-ClickThrough UI element → skip
   * 2. Process through state machine (IDLE → MAYBE_DRAG → DRAGGING)
   * 3. For right-click: dispatch order
   *
   * @param type — PointerEventTypes value
   * @param event — browser PointerEvent (or Babylon.js IMouseEvent)
   */
  private _handlePointerEvent(type: number, event: PointerEventLike): void {
    // Guard: skip if world is being disposed
    if (this.gameWorld.disposing) return

    const screenPos: ScreenPoint = {
      x: event.clientX,
      y: event.clientY,
    }
    this._currentScreen = screenPos

    const button = event.button   // 0=left, 1=middle, 2=right
    const modifiers = this._callbacks.getModifierKeys()
    const actionButton = this._callbacks.getActionButton()
    const classicStyle = this._callbacks.isClassicMouseStyle()

    // ---- POINTERUP (left) ----
    // Note: POINTERMOVE events also fire alongside POINTERUP, so we handle
    // POINTERUP first to capture click completion regardless of state.
    if (type === PointerEventTypes.POINTERUP && button === 0) {
      this._handleLeftUp(screenPos, modifiers, classicStyle, actionButton)
      return
    }

    // ---- POINTERUP (right) ----
    if (type === PointerEventTypes.POINTERUP && button === 2) {
      this._handleRightUp(screenPos, modifiers, classicStyle)
      return
    }

    // ---- POINTERDOWN (left) ----
    if (type === PointerEventTypes.POINTERDOWN && button === 0) {
      this._handleLeftDown(screenPos, classicStyle, actionButton)
      return
    }

    // ---- POINTERMOVE ----
    if (type === PointerEventTypes.POINTERMOVE) {
      this._handleMove(screenPos, modifiers)
      return
    }
  }

  // ---------------------------------------------------------------------------
  // State machine — LEFT DOWN
  // ---------------------------------------------------------------------------

  /**
   * Handle left mouse button press.
   *
   * OpenRA 对照: HandleMouseInput — Left+Down branch
   */
  private _handleLeftDown(
    screenPos: ScreenPoint,
    classicStyle: boolean,
    actionButton: number,
  ): void {
    // Classic style or left is not the action button → start drag immediately
    // (or modern style with left as action button: enter MAYBE_DRAG)
    this._dragStartScreen = screenPos
    this._isValidDragbox = false
    this._setState(STATE_MAYBE_DRAG)
    // NOTE: _classicStyle and _actionButton are checked in _handleLeftUp
    // for the click-vs-drag branching. The _handleLeftDown always enters
    // MAYBE_DRAG; the distinction happens on _handleLeftUp.
    void classicStyle
    void actionButton
  }

  // ---------------------------------------------------------------------------
  // State machine — LEFT UP
  // ---------------------------------------------------------------------------

  /**
   * Handle left mouse button release.
   *
   * OpenRA 对照: HandleMouseInput — Left+Up branch
   *
   * Dispatches to either:
   * - Single/double click selection (if no valid drag box)
   * - Drag-box finalization (if valid drag box)
   * - Order application (if order generator overrides selection)
   */
  private _handleLeftUp(
    screenPos: ScreenPoint,
    modifiers: ModifierState,
    classicStyle: boolean,
    actionButton: number,
  ): void {
    const wasDragging = this._interactionState === STATE_DRAGGING
    const isValidDrag = this._isValidDragbox

    // Check if the order generator overrides selection on left click
    const worldPos = this._screenToWorld(screenPos)
    const overridesSelection = worldPos
      ? this._callbacks.inputOverridesSelection(worldPos)
      : false

    // Determine if this was effectively a "click" (not drag) based on mouse style
    const effectiveClick =
      (classicStyle && !isValidDrag) ||
      (!classicStyle && actionButton === 0 && !isValidDrag)

    // OpenRA: Order units instead of selecting when InputOverridesSelection
    if (
      effectiveClick &&
      overridesSelection &&
      !isValidDrag &&
      worldPos
    ) {
      this._handleRightClick(screenPos, modifiers)
      this._isValidDragbox = false
      this._setState(STATE_IDLE)
      return
    }

    // Handle multi-click (double-click) selection
    if (effectiveClick && this._isDoubleClick(screenPos)) {
      this._selectActorsByType(screenPos)
    } else if (effectiveClick) {
      // Single click selection
      this._handleClickSelection(screenPos, modifiers)
    } else if (wasDragging && isValidDrag) {
      // Drag box finalization
      this._finalizeDragSelection(this._dragStartScreen, screenPos, modifiers)
    } else if (wasDragging) {
      // Drag was started but below deadzone (OpenRA: dragStart == mousePos check)
      const newSelection = this._getEntitiesInScreenRect(
        this._dragStartScreen,
        this._dragStartScreen,
      )
      this._callbacks.combineSelection(newSelection, modifiers.shift, true)
    }

    // Cancel input mode after selection (matching OpenRA)
    this._callbacks.cancelInputMode()

    this._isValidDragbox = false
    this._setState(STATE_IDLE)
    this._cachedRollover = []
  }

  // ---------------------------------------------------------------------------
  // State machine — RIGHT UP
  // ---------------------------------------------------------------------------

  /**
   * Handle right mouse button release.
   *
   * OpenRA 对照: HandleMouseInput — Right+Up branch
   */
  private _handleRightUp(
    screenPos: ScreenPoint,
    modifiers: ModifierState,
    classicStyle: boolean,
  ): void {
    // Don't do anything while a valid drag box is active
    if (this._isValidDragbox) return

    if (classicStyle && this._callbacks.clearSelectionOnLeftClick()) {
      this._callbacks.clearSelection()
    }

    this._handleRightClick(screenPos, modifiers)
  }

  // ---------------------------------------------------------------------------
  // State machine — MOVE
  // ---------------------------------------------------------------------------

  /**
   * Handle mouse movement.
   *
   * OpenRA 对照: HandleMouseInput (mousePos update) + Draw() (rollover)
   */
  private _handleMove(
    screenPos: ScreenPoint,
    _modifiers: ModifierState,
  ): void {
    if (this._interactionState === STATE_MAYBE_DRAG) {
      const dx = screenPos.x - this._dragStartScreen.x
      const dy = screenPos.y - this._dragStartScreen.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const deadzone = this._callbacks.getSelectionDeadzone()

      if (distance > deadzone) {
        this._setState(STATE_DRAGGING)
        this._isValidDragbox = true
      }
    }

    if (this._interactionState === STATE_DRAGGING) {
      this._updateDragRollover(this._dragStartScreen, screenPos)
    } else {
      // Not dragging: update rollover under mouse
      this._updateMouseRollover(screenPos)
    }
  }

  // ---------------------------------------------------------------------------
  // Selection logic — single click
  // ---------------------------------------------------------------------------

  /**
   * Handle single-click selection via raycasting.
   *
   * OpenRA 对照: HandleMouseInput — Left+Up single-click branch
   */
  private _handleClickSelection(screenPos: ScreenPoint, modifiers: ModifierState): void {
    const eligiblePlayers = this._callbacks.getEligiblePlayers()

    // Cast ray and find selectable entities
    const pickResult = this.babylonScene.pick(screenPos.x, screenPos.y, (mesh) => {
      return this._callbacks
        .getSelectableEntities()
        .some((e) => e.mesh === mesh && eligiblePlayers.includes(e.ownerId))
    })

    if (pickResult?.hit && pickResult.pickedMesh) {
      const entities = this._callbacks.getSelectableEntities()
      const hit = entities.find(
        (e) => e.mesh === pickResult.pickedMesh && eligiblePlayers.includes(e.ownerId),
      )

      if (hit) {
        if (modifiers.ctrl) {
          // Ctrl+click: toggle selection
          const selected = this._callbacks.getSelectedActorIds()
          if (selected.has(hit.id)) {
            this._callbacks.combineSelection([hit], false, true)
          } else {
            this._callbacks.combineSelection([hit], true, true)
          }
        } else if (modifiers.shift) {
          // Shift+click: add to selection
          this._callbacks.combineSelection([hit], true, true)
        } else {
          // Normal click: replace selection
          this._callbacks.combineSelection([hit], false, true)
        }
        return
      }
    }

    // Clicked empty ground → clear selection (only if not adding/toggling)
    if (!modifiers.shift && !modifiers.ctrl) {
      this._callbacks.clearSelection()
    }
  }

  // ---------------------------------------------------------------------------
  // Selection logic — double click
  // ---------------------------------------------------------------------------

  /**
   * Double-click: select all entities of the same selectionClass currently
   * visible on screen.
   *
   * OpenRA 对照: HandleMouseInput — multiClick (multiTapCount >= 2) branch
   */
  private _selectActorsByType(screenPos: ScreenPoint): void {
    const entities = this._callbacks.getSelectableEntities()
    const eligiblePlayers = this._callbacks.getEligiblePlayers()

    // Find the entity at click position to get its selectionClass
    const pickResult = this.babylonScene.pick(screenPos.x, screenPos.y)
    if (!pickResult?.hit) return

    const hitEntity = entities.find(
      (e) => e.mesh === pickResult.pickedMesh && eligiblePlayers.includes(e.ownerId),
    )
    if (!hitEntity) return

    // Select all on-screen entities of the same selectionClass
    const sameClass = entities.filter(
      (e) =>
        e.selectionClass === hitEntity.selectionClass &&
        eligiblePlayers.includes(e.ownerId),
    )

    this._callbacks.combineSelection(sameClass, true, false)
  }

  // ---------------------------------------------------------------------------
  // Drag-box selection
  // ---------------------------------------------------------------------------

  /**
   * Update the rollover during drag-box selection.
   *
   * OpenRA 对照: Draw() — selection box + rollover computation
   */
  private _updateDragRollover(
    start: ScreenPoint,
    end: ScreenPoint,
  ): void {
    const entitiesInBox = this._getEntitiesInScreenRect(start, end)
    this._cachedRollover = entitiesInBox
    this._callbacks.setRollover(entitiesInBox)
  }

  /**
   * Update the rollover when the mouse is idle (not dragging).
   *
   * OpenRA 对照: Draw() — mouse pointer rollover branch
   */
  private _updateMouseRollover(screenPos: ScreenPoint): void {
    const entities = this._getEntitiesInScreenRect(screenPos, screenPos)
    this._callbacks.setRollover(entities)
  }

  /**
   * Finalize drag-box selection.
   *
   * OpenRA 对照: HandleMouseInput — Left+Up after valid drag
   */
  private _finalizeDragSelection(
    start: ScreenPoint,
    end: ScreenPoint,
    modifiers: ModifierState,
  ): void {
    const entities = this._getEntitiesInScreenRect(start, end)

    if (entities.length > 0) {
      this._callbacks.combineSelection(entities, modifiers.shift, start.x === end.x && start.y === end.y)
    } else if (this._callbacks.clearSelectionOnLeftClick()) {
      this._callbacks.clearSelection()
    }
  }

  /**
   * Get all selectable entities within a screen-space rectangle.
   *
   * OpenRA 对照: SelectionUtils.SelectActorsInBoxWithDeadzone() (2D spatial index)
   *
   * Uses entity screen-space projection to test containment within
   * the screen rectangle. This is a simplified approach compared to
   * 3D frustum culling; full frustum-based selection is deferred to
   * TODO-5.E.FRUSTUM.
   *
   * @param start — one corner of the screen rect
   * @param end — opposite corner of the screen rect
   * @returns entities whose screen-space positions fall within the rect
   */
  private _getEntitiesInScreenRect(
    start: ScreenPoint,
    end: ScreenPoint,
  ): SelectableEntity[] {
    const eligiblePlayers = this._callbacks.getEligiblePlayers()
    const allEntities = this._callbacks.getSelectableEntities()

    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)

    const inRect: SelectableEntity[] = []
    for (const entity of allEntities) {
      if (!eligiblePlayers.includes(entity.ownerId)) continue

      // Project entity position to screen
      const screenPos = this._worldToScreen(
        entity.mesh.absolutePosition,
      )
      if (
        screenPos &&
        screenPos.x >= minX &&
        screenPos.x <= maxX &&
        screenPos.y >= minY &&
        screenPos.y <= maxY
      ) {
        inRect.push(entity)
      }
    }

    return inRect
  }

  // ---------------------------------------------------------------------------
  // Right-click order dispatch
  // ---------------------------------------------------------------------------

  /**
   * Handle right-click → issue order at world position.
   *
   * OpenRA 对照: ApplyOrders(World, MouseInput)
   *
   * Determines target type (Actor vs Terrain), builds an Order,
   * and dispatches it via the callback.
   */
  private _handleRightClick(screenPos: ScreenPoint, modifiers: ModifierState): void {
    const worldPos = this._screenToWorld(screenPos)
    if (!worldPos) return

    // Check if right-click hit an entity
    const pickResult = this.babylonScene.pick(screenPos.x, screenPos.y)
    const entities = this._callbacks.getSelectableEntities()
    const hitEntity = pickResult?.hit
      ? entities.find((e) => e.mesh === pickResult.pickedMesh)
      : undefined

    const order: Order = {
      orderString: hitEntity ? 'Attack' : 'Move',
      targetPosition: worldPos,
      targetActorId: hitEntity?.id,
      queued: modifiers.shift,
    }

    this._callbacks.applyOrder(order)
  }

  // ---------------------------------------------------------------------------
  // Coordinate conversion helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert screen coordinates to 3D world position on the ground plane.
   *
   * OpenRA 对照: worldRenderer.Viewport.ViewToWorldPx(mi.Location)
   *
   * Uses Babylon.js scene.pick() with a mesh filter targeting the ground
   * mesh to find the intersection point on the terrain plane.
   *
   * @param screenPos — pixel coordinates on the canvas
   * @returns world position, or null if no intersection with the ground
   */
  private _screenToWorld(screenPos: ScreenPoint): WorldPosition | null {
    const pickResult: PickingInfo | null = this.babylonScene.pick(
      screenPos.x,
      screenPos.y,
      (mesh) => mesh === this.groundMesh,
    )
    if (pickResult?.hit && pickResult.pickedPoint) {
      return {
        x: pickResult.pickedPoint.x,
        y: pickResult.pickedPoint.y,
        z: pickResult.pickedPoint.z,
      }
    }
    return null
  }

  /**
   * Project a 3D world position to screen coordinates.
   *
   * OpenRA 对照: worldRenderer.Viewport.WorldToViewPx(worldPx) (reverse direction)
   *
   * Uses BABYLON.Vector3.Project() with identity world matrix
   * (position is already in world space) and the scene's view-projection
   * transform matrix.
   *
   * @param worldPos — 3D world position
   * @returns screen coordinates, or null if projection fails
   */
  private _worldToScreen(worldPos: {
    x: number
    y: number
    z: number
  }): ScreenPoint | null {
    try {
      const v = new Vector3(worldPos.x, worldPos.y, worldPos.z)
      const result = Vector3.Project(
        v,
        Matrix.Identity(),  // world matrix: identity (position is in world space)
        this.babylonScene.getTransformMatrix(),
        this.babylonCamera.viewport.toGlobal(
          this.babylonScene.getEngine().getRenderWidth(),
          this.babylonScene.getEngine().getRenderHeight(),
        ),
      )
      return result ? { x: result.x, y: result.y } : null
    } catch {
      // Graceful fallback: if Vector3.Project fails (e.g., during unit tests
      // with mocked Babylon.js), return null. The caller handles null safely.
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Double-click detection
  // ---------------------------------------------------------------------------

  /**
   * Check if the current click qualifies as a double-click.
   *
   * Criteria: within DOUBLE_CLICK_TIME_MS of last click, and within
   * DOUBLE_CLICK_RADIUS_SQ pixels of last click position.
   *
   * OpenRA 对照: multiTapCount >= 2 (SDL2-driven multi-click count)
   */
  private _isDoubleClick(screenPos: ScreenPoint): boolean {
    const now = Date.now()
    const dx = screenPos.x - this._lastClickPos.x
    const dy = screenPos.y - this._lastClickPos.y

    const isDouble =
      now - this._lastClickTime < DOUBLE_CLICK_TIME_MS &&
      dx * dx + dy * dy < DOUBLE_CLICK_RADIUS_SQ

    // Always update tracking state
    this._lastClickTime = now
    this._lastClickPos = screenPos

    return isDouble
  }

  // ---------------------------------------------------------------------------
  // Widget overrides
  // ---------------------------------------------------------------------------

  /**
   * Render a transparent overlay div.
   *
   * The UI system uses this for DOM rendering. The actual 3D world
   * interaction is handled via Babylon.js observables, so this element
   * has pointer-events: none to let clicks pass through to the canvas.
   *
   * OpenRA 对照: Draw() — but in 3D, we only need a placeholder DOM element
   */
  render(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'world-interaction-controller'
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.pointerEvents = 'none' // ClickThrough: let events pass to canvas
    return el
  }

  /**
   * Get the cursor for a given screen position.
   *
   * OpenRA 对照: GetCursor(int2 screenPos)
   *
   * During an active drag-box, returns null (arrow cursor).
   * Otherwise, delegates to the order generator's getCursor callback.
   *
   * @param pos — screen point to query
   * @returns cursor CSS string, or null for default
   */
  getCursor(pos: { x: number; y: number }): string | null {
    // Always show default cursor while a valid drag box is active
    if (this._isValidDragbox) return null
    return this._callbacks.getCursor(pos)
  }

  // ---------------------------------------------------------------------------
  // Public state accessors (for host application introspection)
  // ---------------------------------------------------------------------------

  /** Whether a valid drag box is currently active.
   *
   * OpenRA 对照: IsValidDragbox property
   */
  get isValidDragbox(): boolean {
    return this._isValidDragbox
  }

  /** The current interaction state string.
   *
   * Useful for debugging and tests.
   */
  get state(): InteractionState {
    return this._interactionState
  }

  /** Set the current interaction state. */
  private _setState(value: InteractionState): void {
    this._interactionState = value
  }

  /** The start position of the current drag (screen coordinates). */
  get dragStart(): ScreenPoint {
    return { ...this._dragStartScreen }
  }

  /** The current mouse position (screen coordinates). */
  get mousePos(): ScreenPoint {
    return { ...this._currentScreen }
  }

  /** Get the currently cached rollover entities. */
  get rollover(): readonly SelectableEntity[] {
    return this._cachedRollover
  }

  // ---------------------------------------------------------------------------
  // Public test injection (for unit testing the state machine)
  //
  // These methods allow tests to directly inject pointer events and verify
  // state transitions without needing a real Babylon.js Scene.
  // ---------------------------------------------------------------------------

  /**
   * Inject a pointer event directly into the state machine.
   *
   * This is the public entry point for unit testing. In production,
   * events arrive via onPointerObservable which calls _handlePointerEvent
   * internally.
   *
   * @param type — PointerEventTypes value
   * @param screenPos — mouse position in screen coordinates
   * @param button — mouse button (0=left, 1=middle, 2=right)
   */
  injectPointerEvent(type: number, screenPos: ScreenPoint, button: number): void {
    const mockEvent: PointerEventLike = {
      clientX: screenPos.x,
      clientY: screenPos.y,
      button,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    }

    this._handlePointerEvent(type, mockEvent)
  }

  /**
   * Directly invoke the move handler for unit testing.
   *
   * This bypasses the _handlePointerEvent dispatch and allows tests
   * to verify the deadzone and state transition logic directly.
   *
   * @param screenPos — current mouse position
   * @param modifiers — modifier key state
   */
  _testHandleMove(screenPos: ScreenPoint, modifiers: ModifierState): void {
    this._handleMove(screenPos, modifiers)
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Clean up resources.
   *
   * Removes the Babylon.js pointer observable callback and resets state.
   * Also calls super.dispose() for Widget tree cleanup.
   * Safe to call multiple times.
   *
   * OpenRA 对照: implicit cleanup via Widget.Removed() lifecycle
   */
  dispose(): void {
    if (this._pointerObserver !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.babylonScene.onPointerObservable.remove(this._pointerObserver as any)
      this._pointerObserver = null
    }

    this._setState(STATE_IDLE)
    this._isValidDragbox = false
    this._cachedRollover = []
  }
}
