/** MapGeneratorLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { MapGeneratorLogic, type IEditorMapGeneratorInfo, type MapGeneratorSettings } from './MapGeneratorLogic.js'
import type { MapGenerationArgsStub, MapPreviewStub } from './BrowserTypes.js'
import { MapStatus, MapClassification } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function mGen(): IEditorMapGeneratorInfo { return { name: 'Gen', tilesets: ['t1', 't2'], getSettings: (): MapGeneratorSettings => ({ get playerCount() { return 2 }, set playerCount(_v: number) {}, options: [{ type: 'boolean' as const, id: 'Water', label: 'W', value: true }, { type: 'integer' as const, id: 'Res', label: 'R', value: 5 }], randomize() {}, initialize() {}, compile(t, s): MapGenerationArgsStub { return { uid: `g-${Date.now()}`, tileset: t.id, size: s, seed: 42, settings: {} } } }), generate(_md, a): MapPreviewStub { return { uid: a.uid, title: 'G', author: 'G', playerCount: 4, bounds: a.size, status: MapStatus.Available, class: MapClassification.Generated, visibility: 0, categories: ['C'], modifiedDate: new Date() } } } }

describe('MapGeneratorLogic', () => {
  let w = createRecursiveMockWidget('GEN')
  let g: IEditorMapGeneratorInfo
  const md = { mapCache: {} as never, manifest: { id: '', metadata: { version: '' } } } as never
  beforeEach(() => { w = createRecursiveMockWidget('GEN'); g = mGen() })

  it('creates logic with default values', () => { const l = new MapGeneratorLogic(w, md, g); expect(l.selectedTerrain.id).toBe('t1'); expect(l.selectedSize).toBe('Medium') })
  it('starts with initialGenerationDone false', () => { expect(new MapGeneratorLogic(w, md, g).initialGenerationDone).toBe(false) })
  it('mapSizeLabel returns formatted string', () => { expect(MapGeneratorLogic.mapSizeLabel({ width: 80, height: 80 })).toContain('80x80') })
  it('randomizeSize generates valid size', () => { const l = new MapGeneratorLogic(w, md, g); l.randomizeSize(); expect(l.size.width).toBeGreaterThan(0) })
  it('refreshSettings does not throw', () => { expect(() => new MapGeneratorLogic(w, md, g).refreshSettings()).not.toThrow() })
  it('generateMap increments counter', () => { const l = new MapGeneratorLogic(w, md, g); const b = l.generationCounter; l.generateMap(); expect(l.generationCounter).toBe(b + 1) })
  it('generateMap calls onGenerate', () => { let c = false; const l = new MapGeneratorLogic(w, md, g, () => { c = true }); l.generateMap(); expect(c).toBe(true) })
  it('isGenerating is false when generationCounter equals lastGeneration', () => { const l = new MapGeneratorLogic(w, md, g); l.lastGeneration = l.generationCounter; expect(l.isGenerating).toBe(false) })
  it('tick triggers initial generation', () => { const l = new MapGeneratorLogic(w, md, g); expect(l.initialGenerationDone).toBe(false); l.tick(); expect(l.initialGenerationDone).toBe(true) })
  it('tick does not double-trigger', () => { const l = new MapGeneratorLogic(w, md, g); l.tick(); const c = l.generationCounter; l.tick(); expect(l.generationCounter).toBe(c) })
  it('dispose cleans counters', () => { const l = new MapGeneratorLogic(w, md, g); l.generateMap(); l.dispose(); expect(l.generationCounter).toBe(0); expect(l.lastGeneration).toBe(0) })
})
