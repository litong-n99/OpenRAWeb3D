/**
 * ControlGroupsWidget.ts — 编队热键控件: Ctrl+数字编组, 双击居中, 编队选择
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ControlGroupsWidget.cs (173 lines)
 *
 * 核心范式转换:
 * - C# HotkeyReference[] 5 组热键 → TS HotkeyReference 接口 (Ch7 Phase B)
 * - C# KeyInput.IsActivatedBy(e) → TS HotkeyReference.isActivatedBy(keyEvent)
 * - C# world.ControlGroups.SelectControlGroup(i) → TS controlGroups 委托
 * - C# worldRenderer.Viewport.Center(actors) → TS viewportCenterDelegate
 * - 无 Draw() 方法 → render() 返回隐藏 div (纯热键监听器, 无视觉输出)
 * - C# e.MultiTapCount >= 2 双击检测 → TS multiTapCount 字段
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { HotkeyReference } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { keyName } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'

// ---------------------------------------------------------------------------
// ControlGroupsDelegate — 编队操作委托接口
// OpenRA 对照: ControlGroups (world.ControlGroups)
// ---------------------------------------------------------------------------

/**
 * Delegate interface for control group operations.
 *
 * OpenRA 对照: ControlGroups class (world.ControlGroups)
 *
 * Implementors handle the actual actor group management.
 */
export interface ControlGroupsDelegate {
  /** Get the number of control group slots (typically 10). */
  readonly groupCount: number

  /** Select all actors in control group i. */
  selectControlGroup(i: number): void

  /** Create a new control group from current selection. */
  createControlGroup(i: number): void

  /** Add current selection to existing control group. */
  addSelectionToControlGroup(i: number): void

  /** Combine current selection with control group i. */
  combineSelectionWithControlGroup(i: number): void

  /** Get actors in control group i (for center-on-jump). */
  getActorsInControlGroup(i: number): unknown[]
}

// ---------------------------------------------------------------------------
// ControlGroupsWidget
// OpenRA 对照: ControlGroupsWidget : Widget
// ---------------------------------------------------------------------------

/**
 * Widget that handles control group hotkeys (Ctrl+0-9, Shift+0-9, etc.).
 *
 * OpenRA 对照: ControlGroupsWidget
 *
 * This widget has no visual output (render() returns a hidden div).
 * It intercepts keyboard events to manage control groups:
 * - SelectGroupKey: select group (double-tap centers camera)
 * - CreateGroupKey: create group from selection
 * - AddToGroupKey: add selection to group
 * - CombineWithGroupKey: combine selection with group
 * - JumpToGroupKey: center camera on group
 */
export class ControlGroupsWidget extends Widget {
  /** Prefix for select-group hotkeys (e.g., "ControlGroup").
   *
   * OpenRA 对照: ControlGroupsWidget.SelectGroupKeyPrefix
   */
  selectGroupKeyPrefix: string | null = null

  /** Prefix for create-group hotkeys.
   *
   * OpenRA 对照: ControlGroupsWidget.CreateGroupKeyPrefix
   */
  createGroupKeyPrefix: string | null = null

  /** Prefix for add-to-group hotkeys.
   *
   * OpenRA 对照: ControlGroupsWidget.AddToGroupKeyPrefix
   */
  addToGroupKeyPrefix: string | null = null

  /** Prefix for combine-with-group hotkeys.
   *
   * OpenRA 对照: ControlGroupsWidget.CombineWithGroupKeyPrefix
   */
  combineWithGroupKeyPrefix: string | null = null

  /** Prefix for jump-to-group hotkeys.
   *
   * OpenRA 对照: ControlGroupsWidget.JumpToGroupKeyPrefix
   */
  jumpToGroupKeyPrefix: string | null = null

  /** Delegate for control group operations.
   *
   * OpenRA 对照: world.ControlGroups
   */
  controlGroups: ControlGroupsDelegate | null = null

  /** Delegate for centering viewport on a group of actors.
   *
   * OpenRA 对照: worldRenderer.Viewport.Center(actors)
   */
  viewportCenterDelegate: ((actors: unknown[]) => void) | null = null

  /** Hotkey resolver: translates prefix + index to HotkeyReference.
   *
   * OpenRA 对照: modData.Hotkeys[string]
   */
  hotkeyResolver: ((keyName: string) => HotkeyReference | null) | null = null

  // ---- Initialized hotkey arrays ----

  private _selectGroupHotkeys: (HotkeyReference | null)[] = []
  private _createGroupHotkeys: (HotkeyReference | null)[] = []
  private _addToGroupHotkeys: (HotkeyReference | null)[] = []
  private _combineWithGroupHotkeys: (HotkeyReference | null)[] = []
  private _jumpToGroupHotkeys: (HotkeyReference | null)[] = []

  /** Number of control group slots.
   *
   * OpenRA 对照: ControlGroupsWidget.hotkeyCount
   */
  private _hotkeyCount: number = 0

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // OpenRA 对照: ControlGroupsWidget.Initialize(WidgetArgs)
  // ---------------------------------------------------------------------------

  /**
   * Initialize widget and resolve hotkey references.
   *
   * OpenRA 对照: ControlGroupsWidget.Initialize(WidgetArgs)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)

    this._hotkeyCount = this.controlGroups?.groupCount ?? 0
    if (this._hotkeyCount === 0) return

    this._selectGroupHotkeys = this._resolveHotkeys(this.selectGroupKeyPrefix, this._hotkeyCount)
    this._createGroupHotkeys = this._resolveHotkeys(this.createGroupKeyPrefix, this._hotkeyCount)
    this._addToGroupHotkeys = this._resolveHotkeys(this.addToGroupKeyPrefix, this._hotkeyCount)
    this._combineWithGroupHotkeys = this._resolveHotkeys(this.combineWithGroupKeyPrefix, this._hotkeyCount)
    this._jumpToGroupHotkeys = this._resolveHotkeys(this.jumpToGroupKeyPrefix, this._hotkeyCount)
  }

  /**
   * Resolve array of hotkey references for a given prefix and count.
   *
   * @param prefix — hotkey prefix (e.g., "ControlGroup")
   * @param count — number of hotkeys to resolve
   * @returns Array of HotkeyReference or null
   */
  private _resolveHotkeys(prefix: string | null, count: number): (HotkeyReference | null)[] {
    if (!prefix) return new Array(count).fill(null)
    if (!this.hotkeyResolver) return new Array(count).fill(null)

    const result: (HotkeyReference | null)[] = []
    for (let i = 0; i < count; i++) {
      const keyName = `${prefix}${String(i + 1).padStart(2, '0')}`
      result.push(this.hotkeyResolver(keyName))
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Key press handling
  // OpenRA 对照: ControlGroupsWidget.HandleKeyPress(KeyInput)
  // ---------------------------------------------------------------------------

  /**
   * Check if a WidgetEvent activates a given HotkeyReference.
   *
   * Matches the ButtonWidget pattern: compare keyName + modifiers directly.
   *
   * @param hotkeyRef — the hotkey reference to check
   * @param event — the widget event
   * @returns true if the event activates this hotkey
   */
  private _isActivatedBy(hotkeyRef: HotkeyReference | null, event: WidgetEvent): boolean {
    if (!hotkeyRef) return false

    const hotkey = hotkeyRef.getValue()
    if (!hotkey.isValid()) return false

    // Compare key name
    const hotkeyKey = keyName(hotkey.key).toLowerCase()
    const eventKey = (event.key ?? '').toLowerCase()
    if (eventKey !== hotkeyKey) return false

    // Compare modifiers
    let eventMods = Modifiers.None
    const ev = event as unknown as { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }
    if (ev.ctrlKey) eventMods |= Modifiers.Ctrl
    if (ev.altKey) eventMods |= Modifiers.Alt
    if (ev.shiftKey) eventMods |= Modifiers.Shift
    if (ev.metaKey) eventMods |= Modifiers.Meta

    return eventMods === hotkey.modifiers
  }

  /**
   * Handle keyboard events for control group operations.
   *
   * OpenRA 对照: ControlGroupsWidget.HandleKeyPress(KeyInput)
   *
   * @param event — widget event (keydown type)
   * @returns true if event was handled
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (event.type !== 'keydown' || this._hotkeyCount === 0) return false

    const multiTap = (event.multiTapCount as number) ?? 1

    for (let i = 0; i < this._hotkeyCount; i++) {
      // Select group (double-tap = center)
      if (this._isActivatedBy(this._selectGroupHotkeys[i], event)) {
        this.controlGroups?.selectControlGroup(i)

        if (multiTap >= 2) {
          const actors = this.controlGroups?.getActorsInControlGroup(i) ?? []
          if (actors.length > 0) {
            this.viewportCenterDelegate?.(actors)
          }
        }
        return true
      }

      // Create group
      if (this._isActivatedBy(this._createGroupHotkeys[i], event)) {
        this.controlGroups?.createControlGroup(i)
        return true
      }

      // Add to group
      if (this._isActivatedBy(this._addToGroupHotkeys[i], event)) {
        this.controlGroups?.addSelectionToControlGroup(i)
        return true
      }

      // Combine with group
      if (this._isActivatedBy(this._combineWithGroupHotkeys[i], event)) {
        this.controlGroups?.combineSelectionWithControlGroup(i)
        return true
      }

      // Jump to group
      if (this._isActivatedBy(this._jumpToGroupHotkeys[i], event)) {
        const actors = this.controlGroups?.getActorsInControlGroup(i) ?? []
        if (actors.length > 0) {
          this.viewportCenterDelegate?.(actors)
        }
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Render (no visual output)
  // OpenRA 对照: ControlGroupsWidget has no Draw() override
  // ---------------------------------------------------------------------------

  /**
   * Render this widget. Returns a hidden div (no visual output).
   *
   * OpenRA 对照: ControlGroupsWidget has no Draw() — intercepts keys only
   *
   * @returns HTMLElement — hidden placeholder div
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'control-groups-widget')
    el.style.display = 'none'
    return el
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Dispose widget resources.
   */
  override dispose(): void {
    this.controlGroups = null
    this.viewportCenterDelegate = null
    this.hotkeyResolver = null
    this._selectGroupHotkeys = []
    this._createGroupHotkeys = []
    this._addToGroupHotkeys = []
    this._combineWithGroupHotkeys = []
    this._jumpToGroupHotkeys = []
    super.dispose()
  }
}
