/**
 * D2kActorPreviewPlaceBuildingPreview.test.ts — D2K building preview migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  D2kActorPreviewPlaceBuildingPreview,
  D2kActorPreviewPlaceBuildingPreviewInfo,
  D2kActorPreviewPlaceBuildingPreviewPreview,
  PlaceBuildingCellType,
  type IWorldRendererPreviewMinimal,
  type IActorInfoMinimal,
  type ISequenceMinimal,
} from './D2kActorPreviewPlaceBuildingPreview.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

function createMockSeq(): ISequenceMinimal {
  return { getSprite: vi.fn(() => ({})), getAlpha: vi.fn(() => 0.8) }
}

function createMockWr(): IWorldRendererPreviewMinimal {
  return {
    world: {
      map: {
        sequences: { getSequence: vi.fn(() => createMockSeq()) },
        centerOfCell: vi.fn((c: CPos) => new WPos(c.X * 1024, c.Y * 1024, 0)),
        contains: vi.fn(() => true),
        getTerrainInfo: vi.fn((c: CPos) => ({ type: c.X === 0 ? 'Rock' : 'Sand' })),
      },
    },
    palette: vi.fn(() => ({ name: 'terrain' })),
  }
}

describe('D2kActorPreviewPlaceBuildingPreview', () => {
  describe('D2kActorPreviewPlaceBuildingPreviewInfo', () => {
    it('has defaults', () => {
      const info = new D2kActorPreviewPlaceBuildingPreviewInfo()
      expect(info.image).toBe('overlay')
      expect(info.unsafeTerrainTypes.has('Rock')).toBe(true)
    })
  })

  describe('PlaceBuildingCellType', () => {
    it('has valid, invalid, and lineBuild', () => {
      expect(PlaceBuildingCellType.Valid).toBe(1)
      expect(PlaceBuildingCellType.Invalid).toBe(2)
      expect(PlaceBuildingCellType.LineBuild).toBe(4)
    })
  })

  describe('createPreview', () => {
    it('creates preview', () => {
      const wr = createMockWr()
      const ai = {
        traitInfo: vi.fn(() => ({ terrainTypes: new Set(), occupiedTiles: () => [] })),
      } as unknown as IActorInfoMinimal
      const info = new D2kActorPreviewPlaceBuildingPreviewInfo()
      const init = { get: vi.fn(() => undefined) }

      const preview = D2kActorPreviewPlaceBuildingPreview.createPreview(wr, ai, info, init)
      expect(preview).toBeInstanceOf(D2kActorPreviewPlaceBuildingPreviewPreview)
    })
  })

  describe('renderFootprint', () => {
    it('renders valid footprint cells', () => {
      const wr = createMockWr()
      const ai = {
        traitInfo: vi.fn(() => ({ terrainTypes: new Set(), occupiedTiles: () => [] })),
      } as unknown as IActorInfoMinimal
      const info = new D2kActorPreviewPlaceBuildingPreviewInfo()
      const init = { get: vi.fn(() => undefined) }
      const preview = new D2kActorPreviewPlaceBuildingPreviewPreview(wr, ai, info, init)

      const fp = new Map<string, number>([['3,3', PlaceBuildingCellType.Valid]])
      const entries = preview.renderFootprint(new CPos(3, 3), fp)
      expect(entries.length).toBeGreaterThan(0)
    })

    it('filters by cell type', () => {
      const wr = createMockWr()
      const ai = {
        traitInfo: vi.fn(() => ({ terrainTypes: new Set(), occupiedTiles: () => [] })),
      } as unknown as IActorInfoMinimal
      const info = new D2kActorPreviewPlaceBuildingPreviewInfo()
      const init = { get: vi.fn(() => undefined) }
      const preview = new D2kActorPreviewPlaceBuildingPreviewPreview(wr, ai, info, init)

      const fp = new Map<string, number>([
        ['2,2', PlaceBuildingCellType.Valid],
        ['3,2', PlaceBuildingCellType.Invalid],
      ])
      expect(preview.renderFootprint(new CPos(2, 2), fp, PlaceBuildingCellType.Valid).length).toBeGreaterThanOrEqual(1)
    })
  })
})
