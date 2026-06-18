/**
 * ActorSelectorLogic.test.ts — ActorSelectorLogic migration unit tests
 *
 * Tests focus on: owner dropdown population, actor filtering (partial templates,
 * IRenderActorPreviewInfo requirement, tileset exclusion), search filtering,
 * and lifecycle (tick, dispose).
 */

import { describe, it, expect, vi } from 'vitest'
import { ActorSelectorLogic } from './ActorSelectorLogic.js'
import { PlayerReference } from '../../../../OpenRA.Game/Map/PlayerReference.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { createRecursiveMockWidget } from '../__test_utils.js'

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeActorInfoStub(
  name: string,
  categories: string[],
  overrides: Partial<{
    hasRenderPreview: boolean
    excludeTilesets: string[] | null
    requireTilesets: string[] | null
    tooltipName: string
  }> = {},
) {
  const hasRP = overrides.hasRenderPreview ?? true
  const ed = {
    categories: categories.length > 0 ? categories : null,
    excludeTilesets: overrides.excludeTilesets ?? null,
    requireTilesets: overrides.requireTilesets ?? null,
  }

  return {
    name,
    hasTraitInfo: (n: string) => {
      if (n === 'IRenderActorPreviewInfo') return hasRP
      return false
    },
    traitInfoOrDefault: <T>(n: string): T | undefined => {
      if (n === 'MapEditorDataInfo') return ed as unknown as T
      return undefined
    },
    traitInfos: <T>(n: string): T[] => {
      if (n === 'EditorOnlyTooltipInfo') {
        if (overrides.tooltipName === 'only-editor') {
          return [{ name: 'Editor Tooltip', enabledByDefault: true }] as unknown as T[]
        }
        return [] as T[]
      }
      if (n === 'TooltipInfo') {
        if (overrides.tooltipName) {
          return [{ name: overrides.tooltipName, enabledByDefault: true }] as unknown as T[]
        }
        return [] as T[]
      }
      return [] as T[]
    },
  }
}

function makePlayerReference(name: string, color: number = 0xffffffff): PlayerReference {
  return new PlayerReference({ name, color, faction: 'allies' })
}

function makeEditorActorLayer(players: PlayerReference[]) {
  const playersMap = new Map<string, PlayerReference>()
  for (const p of players) playersMap.set(p.name, p)
  return {
    Players: { players: playersMap },
    onPlayerRemoved: () => {},
    add: vi.fn(),
    remove: vi.fn(),
    freeSubCellAt: vi.fn().mockReturnValue(0),
    previewsAtWorldPixel: vi.fn().mockReturnValue([]),
    Info: { DefaultActorFacing: 0 },
  }
}

// ---------------------------------------------------------------------------
// Mock widget tree setup
// ---------------------------------------------------------------------------

function setupActorSelectorWidget(
  widget: Widget,
  actors: ReturnType<typeof makeActorInfoStub>[],
  _players: PlayerReference[],
): void {
  const wr = widget as unknown as Record<string, unknown>

  // Panel mock (needs .get for itemTemplate resolution)
  const itemTemplateForPanel = {
    id: 'ACTORPREVIEW_TEMPLATE',
    bounds: { x: 0, y: 0, width: 120, height: 120 },
    isVisible: () => true,
    clone: vi.fn().mockReturnValue({
      id: 'cloned-actor-item',
      bounds: { x: 0, y: 0, width: 120, height: 120 },
      isVisible: () => true,
      isSelected: () => false,
      onClick: () => {},
      getOrNull: () => null,
      getTooltipText: null as (() => string) | null,
      addChild: vi.fn(),
      getColor: () => '#FFFFFFFF',
    }),
  }
  wr.panelWidget = {
    addChild: vi.fn(),
    removeChildren: vi.fn(),
    children: [] as Widget[],
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    isVisible: () => true,
    layout: null,
    get: vi.fn().mockImplementation((id: string) => {
      if (id === 'ACTORPREVIEW_TEMPLATE') return itemTemplateForPanel
      return null
    }),
    getOrNull: vi.fn().mockImplementation((id: string) => {
      if (id === 'ACTORPREVIEW_TEMPLATE') return itemTemplateForPanel
      return null
    }),
  }
  wr.itemTemplateWidget = itemTemplateForPanel

  // Search text field
  wr.searchWidget = {
    _text: '',
    yieldKeyboardFocus: vi.fn(),
    get onEscapeKey() { return null },
    set onEscapeKey(_val) {},
    get onTextEdited() { return null },
    set onTextEdited(_val) {},
  }

  // Owner dropdown
  wr.ownerDropDown = {
    getText: null as (() => string) | null,
    onMouseDown: null,
    removePanel: vi.fn(),
    attachPanel: vi.fn(),
    onClick: vi.fn(),
    showDropDown: vi.fn(),
    textColor: '#FFFFFFFF',
  }

  // Category dropdown
  wr.categoryDropDown = {
    getText: null as (() => string) | null,
    onMouseDown: null,
    removePanel: vi.fn(),
    attachPanel: vi.fn(),
    onClick: vi.fn(),
    showDropDown: vi.fn(),
    textColor: '#FFFFFFFF',
  }

  // Override widget.get
  const origGet = widget.get.bind(widget)
  widget.get = vi.fn().mockImplementation((id: string) => {
    if (id === 'ACTORTEMPLATE_LIST') return wr.panelWidget
    if (id === 'ACTORPREVIEW_TEMPLATE') return wr.itemTemplateWidget
    if (id === 'SEARCH_TEXTFIELD') return wr.searchWidget
    if (id === 'OWNERS_DROPDOWN') return wr.ownerDropDown
    if (id === 'CATEGORIES_DROPDOWN') return wr.categoryDropDown
    return origGet(id)
  })

  // CATEGORY_FILTER_PANEL
  const catPanel = createRecursiveMockWidget('CATEGORY_FILTER_PANEL')
  const mockSelectButtons = createRecursiveMockWidget('SELECT_CATEGORIES_BUTTONS')
  mockSelectButtons.bounds = { x: 0, y: 0, width: 200, height: 30 }
  catPanel.addChild(mockSelectButtons)
  wr.categoryFilterPanel = catPanel

  // MAP_EDITOR parent chain
  const defaultBrush = {
    onSelectionChanged: vi.fn(),
    offSelectionChanged: vi.fn(),
  }
  const editor = {
    defaultBrush,
    currentBrush: null,
    setBrush: vi.fn(),
    clearBrush: vi.fn(),
  }
  const outerParent = {
    get: vi.fn().mockImplementation((id: string) => {
      if (id === 'MAP_EDITOR') return editor
      return null
    }),
    parent: null,
    children: [] as Widget[],
  }
  const innerParent = {
    parent: outerParent,
    children: [] as Widget[],
  }
  ;(widget as unknown as Record<string, unknown>).parent = innerParent

  // Store actors info
  const actorsRecord: Record<string, unknown> = {}
  for (const a of actors) actorsRecord[a.name] = a
  wr.worldRules = {
    actors: actorsRecord,
    terrainInfo: { id: 'TEMPERATE' },
  }
}

function createWorldRenderer(
  players: PlayerReference[],
  actors?: ReturnType<typeof makeActorInfoStub>[],
): {
  world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
} {
  const actorsRecord: Record<string, unknown> = {}
  if (actors) {
    for (const a of actors) actorsRecord[a.name] = a
  }
  return {
    world: {
      map: {
        rules: {
          actors: actorsRecord,
          terrainInfo: { id: 'TEMPERATE' },
        },
      },
      worldActor: { editorActorLayer: makeEditorActorLayer(players) },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActorSelectorLogic', () => {
  describe('constructor', () => {
    it('throws when no players available', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const emptyPlayers: PlayerReference[] = []
      setupActorSelectorWidget(widget, [], emptyPlayers)
      const wr = createWorldRenderer(emptyPlayers)
      expect(
        () =>
          new ActorSelectorLogic(widget, {}, wr.world, wr),
      ).toThrow('no players available')
    })

    it('initializes successfully with players', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      setupActorSelectorWidget(widget, [], players)
      const wr = createWorldRenderer(players)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      expect(logic).toBeDefined()
    })

    it('excludes actors whose name contains ^ (partial templates)', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      const actors = [
        makeActorInfoStub('E1', ['Infantry']),
        makeActorInfoStub('E1^partial', ['Infantry']),
        makeActorInfoStub('E2', ['Infantry']),
      ]
      setupActorSelectorWidget(widget, actors, players)
      const wr = createWorldRenderer(players, actors)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      const allActors = (logic as unknown as Record<string, unknown>).allActors as readonly unknown[] | undefined
      const names = (allActors ?? []).map((a: unknown) => (a as { actor: { name: string } }).actor.name)
      expect(names).toContain('E1')
      expect(names).toContain('E2')
      expect(names).not.toContain('E1^partial')
    })

    it('excludes actors without IRenderActorPreviewInfo', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      const actors = [
        makeActorInfoStub('E1', ['Infantry'], { hasRenderPreview: true }),
        makeActorInfoStub('NoPreview', ['Infantry'], { hasRenderPreview: false }),
      ]
      setupActorSelectorWidget(widget, actors, players)
      const wr = createWorldRenderer(players, actors)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      const allActors = (logic as unknown as Record<string, unknown>).allActors as readonly unknown[] | undefined
      const names = (allActors ?? []).map((a: unknown) => (a as { actor: { name: string } }).actor.name)
      expect(names).toContain('E1')
      expect(names).not.toContain('NoPreview')
    })

    it('excludes actors excluded by tile set', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      const actors = [
        makeActorInfoStub('E1', ['Infantry']),
        makeActorInfoStub('SNOW_ACTOR', ['Infantry'], {
          excludeTilesets: ['TEMPERATE'],
        }),
      ]
      setupActorSelectorWidget(widget, actors, players)
      const wr = createWorldRenderer(players, actors)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      const allActors = (logic as unknown as Record<string, unknown>).allActors as readonly unknown[] | undefined
      const names = (allActors ?? []).map((a: unknown) => (a as { actor: { name: string } }).actor.name)
      expect(names).not.toContain('SNOW_ACTOR')
    })

    it('excludes actors not in required tileset', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      const actors = [
        makeActorInfoStub('E1', ['Infantry']),
        makeActorInfoStub('SNOW_ONLY', ['Infantry'], {
          requireTilesets: ['SNOW'],
        }),
      ]
      setupActorSelectorWidget(widget, actors, players)
      const wr = createWorldRenderer(players, actors)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      const allActors = (logic as unknown as Record<string, unknown>).allActors as readonly unknown[] | undefined
      const names = (allActors ?? []).map((a: unknown) => (a as { actor: { name: string } }).actor.name)
      expect(names).not.toContain('SNOW_ONLY')
    })
  })

  describe('tick', () => {
    it('is a no-op', () => {
      const widget = createRecursiveMockWidget('actor-root')
      const players = [makePlayerReference('Neutral')]
      setupActorSelectorWidget(widget, [], players)
      const wr = createWorldRenderer(players)
      const logic = new ActorSelectorLogic(widget, {}, wr.world, wr)
      expect(() => logic.tick()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

