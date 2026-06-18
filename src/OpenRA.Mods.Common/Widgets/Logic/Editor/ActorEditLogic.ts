/**
 * ActorEditLogic.ts — Actor 属性编辑器：动态属性网格、编辑预览、撤销/重做
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/ActorEditLogic.cs (602 lines)
 *
 * 核心范式转换:
 * - C# IEditorActorOptions trait infos 动态属性网格 → TypeScript 接口存根
 * - C# EditActorPreview / IEditActorHandle / EditorActorOptionActionHandle<T> → TS 独立类
 * - C# EditorActorLayer[actorId] indexer → TypeScript getById(actorId)
 * - C# SelectionChanged event → TypeScript 回调
 * - C# ActorIDStatus [Flags] enum → TypeScript bitmask 位检查
 * - C# FluentProvider.GetMessage → 硬编码字符串（TODO-21.C.10-DEFER-4）
 *
 * 提供行内属性编辑器，为当前选中的 actor 动态生成表单字段
 * （复选框、滑块、下拉框、文本字段）。管理编辑预览以跟踪脏状态，
 * 并通过 EditActorEditorAction 提供撤销/重做支持。
 *
 * Migration:  — Chapter 21 Phase C Wave 2b
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { EditorActorLayer } from '../../../Traits/World/EditorActorLayer.js'
import type { EditorActorPreview } from '../../../Traits/World/EditorActorPreview.js'
import type { PlayerReference } from '../../../../OpenRA.Game/Map/PlayerReference.js'
import type { IEditorAction, EditorActionManager } from '../../../Traits/World/EditorActionManager.js'
import { RemoveActorAction } from '../../../EditorBrushes/actions/RemoveActorAction.js'
import type { IEditorBrush } from '../../../Editor/IEditorBrush.js'
import type { ISelectionController } from '../../../EditorBrushes/types.js'

// ---------------------------------------------------------------------------
// Minimal interfaces for deferred dependencies
// ---------------------------------------------------------------------------

/** Minimal default brush with selection control.
 *
 * OpenRA 对照: EditorDefaultBrush { SelectionChanged, Selection, ClearSelection, SetSelection }
 */
export interface IActorEditDefaultBrush {
  readonly selectionChanged: Set<() => void>
  readonly selection: { readonly actor: EditorActorPreview | null; readonly area: unknown }
  clearSelection(updateSelectedTab?: boolean): void
  setSelection(selection: { readonly actor?: EditorActorPreview | null; readonly area?: unknown }): void
}

// NOTE: In C#, the brush is EditorDefaultBrush which has SelectionChanged event and
// Selection property. In TS, we cast defaultBrush to this interface for the logic.

/** Minimal viewport controller with brush access.
 *
 * OpenRA 对照: EditorViewportControllerWidget { DefaultBrush, SetBrush, ClearBrush, CurrentBrush }
 */
export interface IActorEditEditor {
  readonly defaultBrush: IActorEditDefaultBrush
  readonly currentBrush: IEditorBrush
  setBrush(brush: IEditorBrush | null): void
  clearBrush(): void
}

// ---------------------------------------------------------------------------
// Stub interfaces for IEditorActorOptions trait infos (TODO-21.C.10-DEFER-1)
// ---------------------------------------------------------------------------

/**
 * Base interface for all editor actor option types.
 *
 * OpenRA 对照: IEditorActorOptions.TraitInfos + ActorOptions()
 *
 * TODO-21.C.10-DEFER-1: Replace stubs with real IEditorActorOptions pipeline
 */
export interface IEditorActorOption {
  readonly displayOrder: number
  readonly name: string
}

/** Checkbox option. OpenRA 对照: EditorActorCheckbox */
export interface IEditorActorCheckbox extends IEditorActorOption {
  readonly getValue: (actor: EditorActorPreview) => boolean
  readonly onChange: (actor: EditorActorPreview, value: boolean) => void
}

/** Slider option. OpenRA 对照: EditorActorSlider */
export interface IEditorActorSlider extends IEditorActorOption {
  readonly minValue: number
  readonly maxValue: number
  readonly ticks: number
  readonly getValue: (actor: EditorActorPreview) => number
  readonly onChange: (actor: EditorActorPreview, value: number) => void
}

/** Dropdown option. OpenRA 对照: EditorActorDropdown */
export interface IEditorActorDropdown extends IEditorActorOption {
  readonly getLabels: (actor: EditorActorPreview) => ReadonlyMap<string, string>
  readonly getValue: (actor: EditorActorPreview, labels: ReadonlyMap<string, string>) => string
  readonly onChange: (actor: EditorActorPreview, value: string) => void
}

/** Text field option. OpenRA 对照: EditorActorTextField */
export interface IEditorActorTextField extends IEditorActorOption {
  readonly getValue: (actor: EditorActorPreview) => string
  readonly onChange: (actor: EditorActorPreview, value: string) => void
}

/** Union of all option types for type narrowing. */
export type EditorActorOption = IEditorActorCheckbox | IEditorActorSlider | IEditorActorDropdown | IEditorActorTextField

/**
 * Trait info that provides editor actor options.
 *
 * OpenRA 对照: IEditorActorOptions interface
 */
export interface IEditorActorOptionsInfo {
  readonly actorOptions: (info: unknown, world: unknown) => readonly EditorActorOption[]
}

// ---------------------------------------------------------------------------
// ActorIDStatus flags enum (对应 OpenRA ActorIDStatus [Flags])
// ---------------------------------------------------------------------------

/**
 * Actor ID validation states, with overlapping bits for layout reflow logic.
 *
 * OpenRA 对照: [Flags] enum ActorIDStatus { Normal=0, Duplicate=1, Empty=3 }
 *
 * The overlapping bit design (Empty=3=0b11) ensures transitions between
 * Duplicate and Empty (both error states) do NOT shift the layout — only
 * transitions to/from Normal trigger reflow.
 */
const ActorIDStatus = {
  Normal: 0,
  Duplicate: 1,
  Empty: 3,
} as const

type ActorIDStatus = (typeof ActorIDStatus)[keyof typeof ActorIDStatus]

// ---------------------------------------------------------------------------
// IEditActorHandle — edit handle interface (对应 OpenRA IEditActorHandle)
// ---------------------------------------------------------------------------

/**
 * A handle for tracking and applying an individual property edit.
 *
 * OpenRA 对照: IEditActorHandle
 */
export interface IEditActorHandle {
  /** Apply the current value to the actor. */
  do(actor: EditorActorPreview): void

  /** Revert the value to the initial state. */
  undo(actor: EditorActorPreview): void

  /** Whether this property has been modified from its initial value. */
  readonly isDirty: boolean

  /** Whether this handle should be applied on save (persistent changes). */
  readonly shouldDoOnSave: boolean
}

// ---------------------------------------------------------------------------
// EditorActorOptionActionHandle<T> (对应 OpenRA EditorActorOptionActionHandle<T>)
// ---------------------------------------------------------------------------

/**
 * Generic option action handle that tracks dirty state via equality comparison.
 *
 * OpenRA 对照: EditorActorOptionActionHandle<T> : IEditActorHandle
 *
 * Compares current value against initial value to determine IsDirty.
 * The change callback is called on Do() and Undo() to apply/revert the value.
 */
export class EditorActorOptionActionHandle<T> implements IEditActorHandle {
  private readonly change: (actor: EditorActorPreview, value: T) => void
  private value: T
  private readonly initialValue: T
  private dirty: boolean = false

  constructor(change: (actor: EditorActorPreview, value: T) => void, initialValue: T) {
    this.change = change
    this.value = initialValue
    this.initialValue = initialValue
  }

  /** Record a change and update dirty state.
   *
   * OpenRA 对照: EditorActorOptionActionHandle<T>.OnChange(T value)
   */
  onChanged(value: T): void {
    this.dirty = this.initialValue !== value
    this.value = value
  }

  /** Apply the current value.
   *
   * OpenRA 对照: EditorActorOptionActionHandle<T>.Do(ref EditorActorPreview actor)
   */
  do(actor: EditorActorPreview): void {
    this.change(actor, this.value)
  }

  /** Revert to the initial value.
   *
   * OpenRA 对照: EditorActorOptionActionHandle<T>.Undo(ref EditorActorPreview actor)
   */
  undo(actor: EditorActorPreview): void {
    this.change(actor, this.initialValue)
  }

  get isDirty(): boolean {
    return this.dirty
  }

  /** General option handles are not applied on save (only SetActorIdAction is). */
  get shouldDoOnSave(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// SetActorIdAction (对应 OpenRA SetActorIdAction : IEditActorHandle)
// ---------------------------------------------------------------------------

/**
 * Handle for actor ID changes — requires swapping the preview object entirely
 * because ID is the hash/equality key.
 *
 * OpenRA 对照: SetActorIdAction : IEditActorHandle
 */
export class SetActorIdAction implements IEditActorHandle {
  private readonly logic: ActorEditLogic
  private readonly editor: IActorEditEditor
  private readonly editorActorLayer: EditorActorLayer
  private readonly initial: string
  private newId: string
  private dirty: boolean = false

  constructor(
    logic: ActorEditLogic,
    editor: IActorEditEditor,
    editorActorLayer: EditorActorLayer,
    initial: string,
  ) {
    this.logic = logic
    this.editor = editor
    this.editorActorLayer = editorActorLayer
    this.initial = initial
    this.newId = initial
  }

  /** Set the new actor ID.
   *
   * OpenRA 对照: SetActorIdAction.Set(string actorId)
   */
  set(actorId: string): void {
    this.dirty = this.initial !== actorId
    this.newId = actorId
  }

  /** Apply the ID change by swapping the preview.
   *
   * OpenRA 对照: SetActorIdAction.Do(ref EditorActorPreview actor)
   */
  do(actor: EditorActorPreview): void {
    this.editorActorLayer.remove(actor)
    const newActor = actor.withId(this.newId)
    this.editorActorLayer.addPreview(newActor)
    this.logic.isChangingSelection = true
    this.editor.defaultBrush.setSelection({ actor: newActor })
    this.logic.isChangingSelection = false
  }

  /** Revert the ID change.
   *
   * OpenRA 对照: SetActorIdAction.Undo(ref EditorActorPreview actor)
   */
  undo(actor: EditorActorPreview): void {
    this.editorActorLayer.remove(actor)
    const originalActor = actor.withId(this.initial)
    this.editorActorLayer.addPreview(originalActor)
    this.logic.isChangingSelection = true
    this.editor.defaultBrush.setSelection({ actor: originalActor })
    this.logic.isChangingSelection = false
  }

  get isDirty(): boolean {
    return this.dirty
  }

  /** ID changes must be applied on save to persist the new ID. */
  get shouldDoOnSave(): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// EditActorPreview (对应 OpenRA EditActorPreview)
// ---------------------------------------------------------------------------

/**
 * Tracks the edit state for the currently selected actor.
 *
 * OpenRA 对照: EditActorPreview
 *
 * Maintains a list of IEditActorHandle instances and provides
 * IsDirty computation, Reset(), and GetDirtyHandles().
 */
export class EditActorPreview {
  private readonly setActorIdAction: SetActorIdAction
  private readonly handles: IEditActorHandle[] = []
  private actor: EditorActorPreview

  constructor(
    logic: ActorEditLogic,
    editor: IActorEditEditor,
    editorActorLayer: EditorActorLayer,
    actor: EditorActorPreview,
  ) {
    this.actor = actor
    this.setActorIdAction = new SetActorIdAction(logic, editor, editorActorLayer, actor.id)
    this.handles.push(this.setActorIdAction)
  }

  /** Whether any handle has been modified.
   *
   * OpenRA 对照: EditActorPreview.IsDirty
   */
  get isDirty(): boolean {
    return this.handles.some((h) => h.isDirty)
  }

  /** Set the actor ID via the dedicated handle.
   *
   * OpenRA 对照: EditActorPreview.SetActorID(string actorID)
   */
  setActorId(actorId: string): void {
    this.setActorIdAction.set(actorId)
  }

  /** Add a new edit handle.
   *
   * OpenRA 对照: EditActorPreview.Add(IEditActorHandle editActor)
   */
  add(editActor: IEditActorHandle): void {
    this.handles.push(editActor)
  }

  /** Get all handles that are currently dirty.
   *
   * OpenRA 对照: EditActorPreview.GetDirtyHandles()
   */
  getDirtyHandles(): readonly IEditActorHandle[] {
    return this.handles.filter((h) => h.isDirty)
  }

  /** Reset all dirty handles to their initial values.
   *
   * OpenRA 对照: EditActorPreview.Reset()
   */
  reset(): void {
    for (const handle of this.handles) {
      if (handle.isDirty) {
        handle.undo(this.actor)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// EditActorEditorAction (对应 OpenRA EditActorEditorAction : IEditorAction)
// ---------------------------------------------------------------------------

/**
 * Editor action that records a batch of property changes for undo/redo.
 *
 * OpenRA 对照: EditActorEditorAction : IEditorAction
 */
export class EditActorEditorAction implements IEditorAction {
  text: string

  private readonly actor: EditorActorPreview
  private readonly allHandles: readonly IEditActorHandle[]

  constructor(
    selectedActor: EditorActorPreview,
    handles: readonly IEditActorHandle[],
  ) {
    this.actor = selectedActor
    this.allHandles = handles
    // NOTE: C# uses FluentProvider.GetMessage("notification-edited-actor", ...)
    // Since FluentProvider is not yet migrated, hardcode the string.
    // TODO-21.C.10-DEFER-4: Replace with FluentProvider
    this.text = `Edited actor: ${selectedActor.info.name} (${selectedActor.id})`
  }

  /** Apply handles that have ShouldDoOnSave = true.
   *
   * OpenRA 对照: EditActorEditorAction.Execute()
   */
  execute(): void {
    for (const handle of this.allHandles) {
      if (handle.shouldDoOnSave) {
        handle.do(this.actor)
      }
    }
  }

  /** Apply all handles (redo).
   *
   * OpenRA 对照: EditActorEditorAction.Do()
   */
  redo(): void {
    for (const handle of this.allHandles) {
      handle.do(this.actor)
    }
  }

  /** Revert all handles (undo).
   *
   * OpenRA 对照: EditActorEditorAction.Undo()
   */
  undo(): void {
    for (const handle of this.allHandles) {
      handle.undo(this.actor)
    }
  }
}

// ---------------------------------------------------------------------------
// ActorEditLogic (对应 OpenRA ActorEditLogic : ChromeLogic)
// ---------------------------------------------------------------------------

// NOTE: We avoid importing heavyweight concrete widget classes here.
// The Widget system uses dynamic widget lookup via get/getOrNull,
// so we only need the base Widget type.

type AnyWidget = Widget

/**
 * The inline actor property editor for the map editor.
 *
 * OpenRA 对照: ActorEditLogic : ChromeLogic
 *
 * Dynamically generates form fields (checkboxes, sliders, dropdowns,
 * text fields) from IEditorActorOptions trait infos. Manages an edit
 * preview that tracks dirty state and provides undo/redo.
 */
export class ActorEditLogic extends ChromeLogic {
  // ---- Widget references ----
  private readonly editor: IActorEditEditor
  private readonly editorActorLayer: EditorActorLayer
  private readonly editorActionManager: EditorActionManager
  private readonly actorEditPanel: AnyWidget
  private readonly initContainer: AnyWidget
  private readonly buttonContainer: AnyWidget

  // ---- State ----
  private actorIdStatus: ActorIDStatus = ActorIDStatus.Normal
  private nextActorIdStatus: ActorIDStatus = ActorIDStatus.Normal
  private initialActorId: string = ''

  private editActorPreview: EditActorPreview | null = null

  /** Whether the editor is in the middle of changing selection (prevents re-entry). */
  isChangingSelection: boolean = false

  /** Property grid templates (removed from initContainer on construction). */
  private readonly dropdownOptionTemplate: AnyWidget

  /** Tracked typable fields for batch keyboard focus yield. */
  private readonly typableFields: Set<AnyWidget> = new Set()

  /** Callback for SelectionChanged event. */
  private readonly _handleSelectionChanged: () => void

  /** Get the currently selected actor.
   *
   * OpenRA 对照: SelectedActor => editor.DefaultBrush.Selection.Actor
   */
  private get selectedActor(): EditorActorPreview | null {
    return this.editor.defaultBrush.selection.actor ?? null
  }

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA ActorEditLogic constructor)
  // -------------------------------------------------------------------------

  /**
   * @param widget — the root widget for this logic
   * @param world — the world (provides EditorActorLayer, EditorActionManager)
   * @param editorActorLayer — the editor actor layer
   * @param editorActionManager — the editor action manager for undo/redo
   * @param editor — the viewport controller with brush access
   * @param actorEditPanel — the actor edit panel widget
   */
  constructor(
    _widget: AnyWidget,
    editorActorLayer: EditorActorLayer,
    editorActionManager: EditorActionManager,
    editor: IActorEditEditor,
    actorEditPanel: AnyWidget,
  ) {
    void _widget // unused — widget tree traversal done via actorEditPanel
    super()

    this.editorActorLayer = editorActorLayer
    this.editorActionManager = editorActionManager
    this.editor = editor
    this.actorEditPanel = actorEditPanel

    // Template extraction and removal (matching C# pattern)
    this.initContainer = (actorEditPanel as any).get('ACTOR_INIT_CONTAINER') as AnyWidget
    this.buttonContainer = (actorEditPanel as any).get('BUTTON_CONTAINER') as AnyWidget

    this.dropdownOptionTemplate = (this.initContainer as any).get('DROPDOWN_OPTION_TEMPLATE') as AnyWidget
    // NOTE: Other templates (CHECKBOX_OPTION_TEMPLATE, SLIDER_OPTION_TEMPLATE,
    //   TEXTFIELD_OPTION_TEMPLATE) are fetched at use-time when IEditorActorOptions
    //   pipeline is migrated (TODO-21.C.10-DEFER-1).
    ;(this.initContainer as any).removeChildren()

    // Wire selection changed listener
    this._handleSelectionChanged = () => this.handleSelectionChanged()
    this.editor.defaultBrush.selectionChanged.add(this._handleSelectionChanged)

    // Wire buttons
    const actorIdField = (actorEditPanel as any).get('ACTOR_ID') as AnyWidget
    const actorIdErrorLabel = (actorEditPanel as any).get('ACTOR_ID_ERROR_LABEL') as AnyWidget
    const typeLabel = (actorEditPanel as any).get('ACTOR_TYPE_LABEL') as AnyWidget
    void typeLabel // reserved for HandleSelectionChanged to set getText

    if (actorIdErrorLabel) {
      ;(actorIdErrorLabel as any).isVisible = () => this.actorIdStatus !== ActorIDStatus.Normal
      ;(actorIdErrorLabel as any).getText = () =>
        this.actorIdStatus === ActorIDStatus.Duplicate || this.nextActorIdStatus === ActorIDStatus.Duplicate
          ? 'Duplicate Actor ID'
          : 'Enter Actor ID'
    }

    const okButton = (actorEditPanel as any).get('OK_BUTTON') as AnyWidget
    if (okButton) {
      ;(okButton as any).isDisabled = () => !this.isValid() || this.editActorPreview === null || !this.editActorPreview.isDirty
      ;(okButton as any).onClick = () => this.save()
    }

    const cancelButton = (actorEditPanel as any).get('CANCEL_BUTTON') as AnyWidget
    if (cancelButton) {
      ;(cancelButton as any).onClick = () => this.cancel()
    }

    const deleteButton = (actorEditPanel as any).get('DELETE_BUTTON') as AnyWidget
    if (deleteButton) {
      ;(deleteButton as any).onClick = () => this.delete()
    }

    // BLOCKER-FIX: restored currentBrush === defaultBrush guard.
    // Use duck-typing since IEditorBrush and IActorEditDefaultBrush are
    // different TS types but the same object at runtime when defaultBrush is active.
    ;(actorEditPanel as any).isVisible = () =>
      this.editor.currentBrush === (this.editor.defaultBrush as unknown as IEditorBrush) &&
      this.selectedActor !== null

    // Wire actor ID field
    if (actorIdField) {
      ;(actorIdField as any).onEscKey = (_: unknown) => { (actorIdField as any).yieldKeyboardFocus(); return true }
      ;(actorIdField as any).onEnterKey = (_: unknown) => { (actorIdField as any).yieldKeyboardFocus(); return true }
      ;(actorIdField as any).onTextEdited = () => {
        const actorId = ((actorIdField as any).text as string ?? '').trim()
        if (actorId.length === 0) {
          this.nextActorIdStatus = ActorIDStatus.Empty
          return
        }

        // Check for duplicate actor ID (case-insensitive equality).
        // BLOCKER-FIX: replaced broken startsWith logic with case-insensitive equality.
        // Original C#: !SelectedActor.ID.Equals(actorId, StringComparison.OrdinalIgnoreCase)
        //   && editorActorLayer[actorId] != null
        if (
          this.selectedActor &&
          this.selectedActor.id.toLowerCase() !== actorId.toLowerCase() &&
          this.editorActorLayer.getById(actorId) !== undefined
        ) {
          this.nextActorIdStatus = ActorIDStatus.Duplicate
          return
        }

        this.setActorId(actorId)
      }

      ;(actorIdField as any).onLoseFocus = () => {
        if (this.actorIdStatus !== ActorIDStatus.Normal) {
          this.setActorId(this.initialActorId)
          ;(actorIdField as any).text = this.initialActorId
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose)
  // -------------------------------------------------------------------------

  // NOTE: dispose() must be public to match ChromeLogic base class
  override dispose(): void {
    this.editor.defaultBrush.selectionChanged.delete(this._handleSelectionChanged)
    super.dispose()
  }

  // -------------------------------------------------------------------------
  // HandleSelectionChanged (对应 OpenRA HandleSelectionChanged)
  // -------------------------------------------------------------------------

  /** Handle selection change — rebuild the property grid for the new actor.
   *
   * OpenRA 对照: HandleSelectionChanged()
   */
  handleSelectionChanged(): void {
    const actor = this.selectedActor
    if (actor !== null) {
      // Guard against re-entry when we are changing selection
      if (!this.isChangingSelection) {
        this.reset()
      }

      this.editActorPreview = new EditActorPreview(
        this,
        this.editor,
        this.editorActorLayer,
        actor,
      )

      this.initialActorId = actor.id
      // Set text field value if available
      const actorIdField = (this.actorEditPanel as any).get('ACTOR_ID') as AnyWidget
      if (actorIdField) {
        ;(actorIdField as any).text = actor.id
        ;(actorIdField as any).cursorPosition = actor.id.length
      }

      // Update type label
      const typeLabel = (this.actorEditPanel as any).get('ACTOR_TYPE_LABEL') as AnyWidget
      if (typeLabel) {
        const truncatedText = actor.descriptiveName
        ;(typeLabel as any).getText = () => truncatedText
      }

      this.nextActorIdStatus = ActorIDStatus.Normal

      // Remove old widgets
      const oldInitHeight = (this.initContainer as any).bounds?.height ?? 0
      ;(this.initContainer as any).bounds = { ...(this.initContainer as any).bounds, height: 0 }
      ;(this.initContainer as any).removeChildren()

      // ---- Add owner dropdown (always first) ----
      const ownerContainer = (this.dropdownOptionTemplate as any).clone() as AnyWidget
      const ownerLabel = (ownerContainer as any).get('LABEL') as AnyWidget
      if (ownerLabel) {
        ;(ownerLabel as any).getText = () => 'Owner'
      }
      const ownerDropdown = (ownerContainer as any).get('OPTION') as AnyWidget
      let selectedOwner = actor.owner

      const updateOwner = (preview: EditorActorPreview, reference: PlayerReference) => {
        preview.owner = reference
        preview.replaceInit('OwnerInit', { type: 'OwnerInit', value: reference.name })
      }

      const ownerHandler = new EditorActorOptionActionHandle<PlayerReference>(updateOwner, actor.owner)
      this.editActorPreview.add(ownerHandler)

      if (ownerDropdown) {
        ;(ownerDropdown as any).getText = () => selectedOwner.name
        ;(ownerDropdown as any).getColor = () => selectedOwner.color
        ;(ownerDropdown as any).onClick = () => {
          const players = this.editorActorLayer.Players
          if (!players) return
          void [...players.players.values()].sort((a, b) => a.name.localeCompare(b.name))
          // NOTE: ShowDropDown is replaced with a simplified callback
          // TODO-21.C.10-DEFER-5: Full dropdown widget ShowDropDown
        }
      }

      const ownerBounds = (ownerContainer as any).bounds
      if (ownerBounds) {
        ;(this.initContainer as any).bounds = {
          ...(this.initContainer as any).bounds,
          height: ((this.initContainer as any).bounds.height ?? 0) + (ownerBounds.height ?? 0),
        }
      }
      ;(this.initContainer as any).addChild(ownerContainer)

      // ---- Add property options from IEditorActorOptions traits ----
      // NOTE: IEditorActorOptions trait infos are not yet migrated.
      // Property grid generation is stubbed — only the owner dropdown is shown.
      // TODO-21.C.10-DEFER-1: When IEditorActorOptions and concrete option types
      //   (EditorActorCheckbox, EditorActorSlider, EditorActorDropdown,
      //    EditorActorTextField) are migrated, iterate TraitInfos<IEditorActorOptions>
      //   and generate the corresponding form rows from the templates.

      // Re-adjust button container position
      const newInitHeight = (this.initContainer as any).bounds?.height ?? 0
      if (this.buttonContainer && (this.buttonContainer as any).bounds) {
        ;(this.buttonContainer as any).bounds = {
          ...(this.buttonContainer as any).bounds,
          y: ((this.buttonContainer as any).bounds.y ?? 0) + newInitHeight - oldInitHeight,
        }
      }
    } else {
      // Selected actor is null — close the edit panel
      this.close()
    }
  }

  // -------------------------------------------------------------------------
  // Tick (对应 OpenRA Tick: ActorIDStatus state transition animation)
  // -------------------------------------------------------------------------

  /** Handle actor ID status change layout reflow.
   *
   * OpenRA 对照: override Tick()
   *
   * When the error label appears/disappears, shifts containers to make room.
   * Overlapping bit design ensures transitions between error states don't reflow.
   */
  override tick(): void {
    if (this.actorIdStatus !== this.nextActorIdStatus) {
      if ((this.actorIdStatus & this.nextActorIdStatus) === 0) {
        // Major state change (Normal <-> Error)
        const actorIdErrorLabel = (this.actorEditPanel as any).get('ACTOR_ID_ERROR_LABEL') as AnyWidget
        const errorLabelHeight = (actorIdErrorLabel as any)?.bounds?.height ?? 0
        const offset = this.nextActorIdStatus === ActorIDStatus.Normal ? -errorLabelHeight : errorLabelHeight

        if (this.initContainer && (this.initContainer as any).bounds) {
          ;(this.initContainer as any).bounds = {
            ...(this.initContainer as any).bounds,
            y: ((this.initContainer as any).bounds.y ?? 0) + offset,
          }
        }
        if (this.buttonContainer && (this.buttonContainer as any).bounds) {
          ;(this.buttonContainer as any).bounds = {
            ...(this.buttonContainer as any).bounds,
            y: ((this.buttonContainer as any).bounds.y ?? 0) + offset,
          }
        }
      }

      this.actorIdStatus = this.nextActorIdStatus
    }
  }

  // -------------------------------------------------------------------------
  // SetActorId (对应 OpenRA SetActorId)
  // -------------------------------------------------------------------------

  setActorId(actorId: string): void {
    this.editActorPreview?.setActorId(actorId)
    this.nextActorIdStatus = ActorIDStatus.Normal
  }

  // -------------------------------------------------------------------------
  // IsValid (对应 OpenRA IsValid)
  // -------------------------------------------------------------------------

  isValid(): boolean {
    return this.nextActorIdStatus === ActorIDStatus.Normal
  }

  // -------------------------------------------------------------------------
  // Delete (对应 OpenRA Delete)
  // -------------------------------------------------------------------------

  delete(): void {
    this.yieldFocus()
    const actor = this.selectedActor
    if (actor !== null) {
      this.editorActionManager.Add(
        new RemoveActorAction(this.editorActorLayer, actor, this.editor.defaultBrush as unknown as ISelectionController),
      )
    }
  }

  // -------------------------------------------------------------------------
  // Cancel (对应 OpenRA Cancel)
  // -------------------------------------------------------------------------

  cancel(): void {
    this.reset()
    this.close()
  }

  // -------------------------------------------------------------------------
  // Reset (对应 OpenRA Reset)
  // -------------------------------------------------------------------------

  reset(): void {
    this.editActorPreview?.reset()
  }

  // -------------------------------------------------------------------------
  // YieldFocus (对应 OpenRA YieldFocus)
  // -------------------------------------------------------------------------

  yieldFocus(): void {
    const actorIdField = (this.actorEditPanel as any).get('ACTOR_ID') as AnyWidget
    if (actorIdField) {
      ;(actorIdField as any).yieldKeyboardFocus()
    }
    for (const f of this.typableFields) {
      ;(f as any).yieldKeyboardFocus?.()
    }
  }

  // -------------------------------------------------------------------------
  // Close (对应 OpenRA Close)
  // -------------------------------------------------------------------------

  close(): void {
    this.yieldFocus()
    if (this.selectedActor !== null) {
      this.editor.defaultBrush.clearSelection(true)
    }
  }

  // -------------------------------------------------------------------------
  // Save (对应 OpenRA Save)
  // -------------------------------------------------------------------------

  save(): void {
    const actor = this.selectedActor
    if (actor !== null && this.editActorPreview) {
      this.editorActionManager.Add(
        new EditActorEditorAction(actor, this.editActorPreview.getDirtyHandles()),
      )
    }
    this.editActorPreview = null
    this.close()
  }
}
