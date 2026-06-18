/**
 * MoveActorAction.ts — Editor undo/redo action for actor movement
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class MoveActorAction : IEditorAction (lines 543-588)
 *
 * 核心范式转换:
 * - C# from/to CPos tracking → TypeScript readonly/private fields
 * - C# Execute() empty (movement during drag) → same in TS
 * - C# FluentProvider.GetMessage → template literal string
 *
 * Migration: TODO-21.B.2 — Chapter 21 Phase B
 */

import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { EditorActorLayer } from '../../Traits/World/EditorActorLayer.js'
import type { EditorActorPreview } from '../../Traits/World/EditorActorPreview.js'

/**
 * Tracks an actor drag-move operation for undo/redo.
 *
 * OpenRA 对照: sealed class MoveActorAction : IEditorAction
 *
 * Movement is performed during the drag (via the Move() method), not on execute.
 * Execute() is a no-op. Do() moves the actor to the final position.
 * Undo() moves the actor back to the original position.
 * HasMoved is true when the actor's position has actually changed.
 */
export class MoveActorAction implements IEditorAction {
  /** Human-readable description, updated on Move().
   *
   * OpenRA 对照: MoveActorAction.Text { get; private set; }
   */
  text: string

  /** The actor being moved. */
  private readonly actor: EditorActorPreview

  /** The editor actor layer (for moveActor calls). */
  private readonly layer: EditorActorLayer

  /** Original position (before move). */
  private readonly from: CPos

  /** Current/destination position. */
  private to: CPos

  /**
   * Create a MoveActorAction.
   *
   * OpenRA 对照: MoveActorAction(EditorActorPreview, EditorActorLayer)
   *
   * Records the actor's current position as the "from" position.
   * The "to" starts equal to "from" — it is updated by Move() during the drag.
   *
   * @param actor — the actor being moved
   * @param layer — the editor actor layer
   */
  constructor(actor: EditorActorPreview, layer: EditorActorLayer) {
    this.actor = actor
    this.layer = layer
    this.from = actor.location
    this.to = this.from

    // NOTE: C# uses FluentProvider.GetMessage("notification-moved-actor", ...)
    // Since FluentProvider is not yet migrated, hardcoded English strings are used.
    // TODO-21.B.1-DEFER-1: Replace with FluentProvider when migrated.
    this.text = `Moved actor: ${actor.id} (${this.from.X},${this.from.Y})→(${this.to.X},${this.to.Y})`
  }

  /**
   * Execute is a no-op — movement was already applied during drag.
   *
   * OpenRA 对照: MoveActorAction.Execute() — empty body
   */
  execute(): void {
    // Movement already applied by Move() during drag
  }

  /**
   * Ensure the actor is at the final (to) position.
   *
   * OpenRA 对照: MoveActorAction.Do()
   */
  redo(): void {
    this.layer.moveActor(this.actor, this.to)
  }

  /**
   * Move the actor back to the original (from) position.
   *
   * OpenRA 对照: MoveActorAction.Undo()
   */
  undo(): void {
    this.layer.moveActor(this.actor, this.from)
  }

  /**
   * Whether the actor has actually moved from its original position.
   *
   * OpenRA 对照: MoveActorAction.HasMoved => from != to
   */
  get hasMoved(): boolean {
    return this.from.X !== this.to.X || this.from.Y !== this.to.Y
  }

  /**
   * Move the actor to a new position during the drag.
   *
   * OpenRA 对照: MoveActorAction.Move(CPos to)
   *
   * Called each frame during a drag-move. Updates the actor position
   * immediately via EditorActorLayer.moveActor() and records the new
   * destination for undo/redo.
   *
   * @param newTo — the new target cell position
   */
  move(newTo: CPos): void {
    this.to = newTo
    this.layer.moveActor(this.actor, this.to)

    this.text =
      `Moved actor: ${this.actor.id} (${this.from.X},${this.from.Y})→(${this.to.X},${this.to.Y})`
  }
}
