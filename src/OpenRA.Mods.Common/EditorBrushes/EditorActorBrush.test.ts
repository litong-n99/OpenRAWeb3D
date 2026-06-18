/**
 * EditorActorBrush.test.ts — EditorActorBrush migration unit tests
 *
 * Tests focus on: owner resolution, center offset, subcell sharing,
 * footprint validation, mouse input handling, AddActorAction do/undo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { MouseInputEvent, MouseButton } from '../../OpenRA.Game/Input/IInputHandler.js'
import type { MouseInput } from '../../OpenRA.Game/Input/IInputHandler.js'
import { EditorActorBrush, AddActorAction } from './EditorActorBrush.js'
import { EditorActorPreview } from '../Traits/World/EditorActorPreview.js'
import type { ActorReferenceMap } from '../Traits/World/EditorActorPreview.js'
import { PlayerReference } from '../../OpenRA.Game/Map/PlayerReference.js'
import { SubCell } from '../../OpenRA.Game/Traits/SubCell.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEditorWidget() {
  return {
    clearBrush: vi.fn(),
  } as unknown as { clearBrush: () => void } & Record<string, unknown>
}

function makeActorInfo(overrides?: {
  name?: string
  sharesCell?: boolean
  validOwnerNames?: string[]
  hasFacing?: boolean
  centerOffset?: number
}) {
  return {
    name: overrides?.name ?? 'TestActor',
    traitInfoOrDefault<T>(name: string): T | undefined {
      if (name === 'IOccupySpaceInfo') {
        return {
          sharesCell: overrides?.sharesCell ?? false,
        } as unknown as T
      }
      if (name === 'BuildingInfo') {
        return {
          sharesCell: overrides?.sharesCell ?? false,
          centerOffset: overrides?.centerOffset ?? 0,
        } as unknown as T
      }
      if (name === 'RequiresSpecificOwnersInfo') {
        if (overrides?.validOwnerNames) {
          return {
            validOwnerNames: overrides.validOwnerNames,
          } as unknown as T
        }
        return undefined
      }
      return undefined
    },
    hasTraitInfo(name: string): boolean {
      if (name === 'IFacingInfo') return overrides?.hasFacing ?? false
      return false
    },
  }
}

function makeActorLayer() {
  const previews: EditorActorPreview[] = []
  return {
    previews,
    Info: { DefaultActorFacing: 384 },
    freeSubCellAt(_cell: CPos): number {
      return SubCell.FullCell
    },
    add(reference: ActorReferenceMap): EditorActorPreview {
      const preview = new EditorActorPreview(
        {} as any,
        'Actor0',
        reference,
        new PlayerReference({ name: 'Neutral', faction: 'Random' }),
        { name: 'TestActor' },
      )
      previews.push(preview)
      return preview
    },
    remove(preview: EditorActorPreview): void {
      const idx = previews.indexOf(preview)
      if (idx >= 0) previews.splice(idx, 1)
    },
  }
}

function makeActionManager() {
  const actions: unknown[] = []
  return {
    actions,
    Add(action: unknown): void {
      actions.push(action)
    },
  }
}

function makeMockMap() {
  return {
    contains(_cell: CPos): boolean {
      return true // All cells in bounds
    },
  }
}

function makeWorldRenderer(actorLayer: ReturnType<typeof makeActorLayer>, actionMgr: ReturnType<typeof makeActionManager>) {
  return {
    viewport: {
      viewToWorld(vp: { readonly x: number; readonly y: number }): CPos {
        return new CPos(Math.floor(vp.x / 1024), Math.floor(vp.y / 1024))
      },
      worldToViewPx(wp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
        return { x: wp.x * 1024, y: wp.y * 1024 }
      },
      viewToWorldPx(vp: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number; readonly z: number } {
        return { x: vp.x * 1024, y: vp.y * 1024, z: 0 }
      },
      lastMousePos: { x: 0, y: 0 },
    },
    world: {
      worldActor: {
        editorActorLayer: actorLayer,
        editorActionManager: actionMgr,
      },
      map: makeMockMap(),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests: AddActorAction
// ---------------------------------------------------------------------------

describe('AddActorAction', () => {
  let actorLayer: ReturnType<typeof makeActorLayer>

  beforeEach(() => {
    actorLayer = makeActorLayer()
  })

  it('adds actor on redo and sets text', () => {
    const reference: ActorReferenceMap = new Map()
    reference.set('LocationInit', { type: 'LocationInit', value: new CPos(0, 0) })
    reference.set('OwnerInit', { type: 'OwnerInit', value: 'Neutral' })
    reference.set('type', 'TestActor')

    const action = new AddActorAction(actorLayer as unknown as any, reference)
    action.redo()

    expect(action.text).toContain('TestActor')
    expect(actorLayer.previews.length).toBe(1)
  })

  it('undo removes actor', () => {
    const reference: ActorReferenceMap = new Map()
    reference.set('LocationInit', { type: 'LocationInit', value: new CPos(0, 0) })
    reference.set('OwnerInit', { type: 'OwnerInit', value: 'Neutral' })
    reference.set('type', 'TestActor')

    const action = new AddActorAction(actorLayer as unknown as any, reference)
    action.redo()
    expect(actorLayer.previews.length).toBe(1)

    action.undo()
    expect(actorLayer.previews.length).toBe(0)
  })

  it('execute calls redo', () => {
    const reference: ActorReferenceMap = new Map()
    reference.set('LocationInit', { type: 'LocationInit', value: new CPos(0, 0) })
    reference.set('OwnerInit', { type: 'OwnerInit', value: 'Neutral' })
    reference.set('type', 'TestActor')

    const action = new AddActorAction(actorLayer as unknown as any, reference)
    action.execute()
    expect(actorLayer.previews.length).toBe(1)
  })

  it('undo is safe when called before redo', () => {
    const reference: ActorReferenceMap = new Map()
    reference.set('LocationInit', { type: 'LocationInit', value: new CPos(0, 0) })
    reference.set('OwnerInit', { type: 'OwnerInit', value: 'Neutral' })

    const action = new AddActorAction(actorLayer as unknown as any, reference)
    expect(() => action.undo()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: EditorActorBrush
// ---------------------------------------------------------------------------

describe('EditorActorBrush', () => {
  let actorLayer: ReturnType<typeof makeActorLayer>
  let actionMgr: ReturnType<typeof makeActionManager>
  let editorWidget: ReturnType<typeof makeEditorWidget>

  beforeEach(() => {
    actorLayer = makeActorLayer()
    actionMgr = makeActionManager()
    editorWidget = makeEditorWidget()
  })

  function createBrush(overrides?: {
    sharesCell?: boolean
    validOwnerNames?: string[]
    hasFacing?: boolean
    centerOffset?: number
  }) {
    const actorInfo = makeActorInfo(overrides)
    const owner = new PlayerReference({ name: 'Neutral', faction: 'Random' })
    const wr = makeWorldRenderer(actorLayer, actionMgr)
    return new EditorActorBrush(
      editorWidget as unknown as any,
      actorInfo as any,
      owner,
      wr as unknown as any,
    )
  }

  it('creates brush with preview actor', () => {
    const brush = createBrush()
    expect(brush.preview).toBeDefined()
    expect(brush.preview.type).toBe('TestActor')
  })

  it('resolves owner from RequiresSpecificOwners when current owner is invalid', () => {
    const brush = createBrush({ validOwnerNames: ['Allies', 'Soviet'] })
    // Owner should be 'Allies' (first valid), not 'Neutral'
    expect(brush.preview.owner.name).toBe('Allies')
  })

  it('keeps current owner when valid', () => {
    const brush = createBrush({ validOwnerNames: ['Neutral', 'Allies'] })
    // Owner should remain 'Neutral' (it's valid)
    expect(brush.preview.owner.name).toBe('Neutral')
  })

  it('applies default facing when actor has facing', () => {
    const brush = createBrush({ hasFacing: true })
    const facingInit = brush.preview.getInitOrDefault('FacingInit') as { value: number } | undefined
    expect(facingInit?.value).toBe(384)
  })

  it('does not apply facing when actor has no facing', () => {
    const brush = createBrush()
    const facingInit = brush.preview.getInitOrDefault('FacingInit')
    expect(facingInit).toBeUndefined()
  })

  it('assigns free subcell when sharing', () => {
    // Override freeSubCellAt to return a specific subcell
    actorLayer.freeSubCellAt = () => SubCell.First

    const brush = createBrush({ sharesCell: true })
    const subCellInit = brush.preview.getInitOrDefault('SubCellInit') as { value: number } | undefined
    expect(subCellInit?.value).toBe(SubCell.First)
  })

  it('omits subcell when sharing but no free subcell', () => {
    actorLayer.freeSubCellAt = () => SubCell.Invalid

    const brush = createBrush({ sharesCell: true })
    const subCellInit = brush.preview.getInitOrDefault('SubCellInit')
    expect(subCellInit).toBeUndefined()
  })

  it('left click places actor', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Left,
      location: { x: 512, y: 512 }, // center of cell (0,0)
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)
    expect(actionMgr.actions.length).toBe(1)
  })

  it('right click clears brush', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Up,
      button: MouseButton.Right,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(true)
    expect(editorWidget.clearBrush).toHaveBeenCalledOnce()
  })

  it('non-left/right button returns false', () => {
    const brush = createBrush()

    const mi: MouseInput = {
      event: MouseInputEvent.Down,
      button: MouseButton.Middle,
      location: { x: 0, y: 0 },
      delta: { x: 0, y: 0 },
      modifiers: 0,
      multiTapCount: 0,
    }

    const consumed = brush.handleMouseInput(mi)
    expect(consumed).toBe(false)
  })

  it('renderAboveShroud returns preview renderables', () => {
    const brush = createBrush()
    const result = brush.renderAboveShroud({} as any[0], {} as any[1])
    expect(Array.isArray(result)).toBe(true)
  })

  it('renderAnnotations returns preview annotation renderables', () => {
    const brush = createBrush()
    const result = brush.renderAnnotations({} as any[0], {} as any[1])
    expect(Array.isArray(result)).toBe(true)
  })

  it('tick is no-op', () => {
    const brush = createBrush()
    expect(() => brush.tick()).not.toThrow()
  })

  it('dispose does not throw', () => {
    const brush = createBrush()
    expect(() => brush.dispose()).not.toThrow()
  })
})
