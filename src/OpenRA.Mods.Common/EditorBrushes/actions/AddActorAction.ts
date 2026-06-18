/**
 * AddActorAction.ts — Add actor to editor layer undo/redo action
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorActorBrush.cs
 *   sealed class AddActorAction : IEditorAction (lines 142-179)
 *
 * 核心范式转换:
 * - C# ActorReference.Clone() → Map shallow copy (ActorReferenceMap)
 * - C# FluentProvider.GetMessage → template literal
 *
 * Migration:  — Chapter 21 Phase B Wave 2
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { EditorActorLayer } from '../../Traits/World/EditorActorLayer.js'
import { EditorActorPreview } from '../../Traits/World/EditorActorPreview.js'
import type { ActorReferenceMap } from '../../Traits/World/EditorActorPreview.js'

/**
 * Adds an actor to the editor layer at a specified position.
 *
 * OpenRA 对照: AddActorAction (inner class in EditorActorBrush.cs)
 *
 * Stores an immutable copy of the ActorReference. On execute/redo, adds the
 * actor to EditorActorLayer. On undo, removes it.
 */
export class AddActorAction implements IEditorAction {
  text: string

  private readonly editorLayer: EditorActorLayer
  private readonly actor: ActorReferenceMap
  private editorActorPreview: EditorActorPreview | null = null

  /**
   * Create a new AddActorAction.
   *
   * @param editorLayer — the editor actor layer
   * @param actor — the actor reference (shallow-copied for immutability)
   */
  constructor(editorLayer: EditorActorLayer, actor: ActorReferenceMap) {
    this.editorLayer = editorLayer
    this.actor = new Map(actor) // Immutable copy
    this.text = 'Adding actor...'
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.editorActorPreview = this.editorLayer.add(this.actor)
    const actorType =
      typeof this.actor.get('type') === 'string'
        ? (this.actor.get('type') as string)
        : this.editorActorPreview.type
    this.text = `Added actor: ${actorType} (${this.editorActorPreview.id})`
  }

  undo(): void {
    if (this.editorActorPreview) {
      this.editorLayer.remove(this.editorActorPreview)
      this.editorActorPreview = null
    }
  }
}
