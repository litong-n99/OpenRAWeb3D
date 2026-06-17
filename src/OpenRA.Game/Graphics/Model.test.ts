/**
 * Model.test.ts — Model interfaces and types unit tests
 */

import { describe, it, expect } from 'vitest'
import { Rectangle } from '../Primitives/Rectangle'
import type {
  IModel,
  IModelCache,
  IModelCacheInfo,
  IModelWidget,
  ModelRenderData,
} from './Model'

describe('Model interfaces (type-level)', () => {
  it('ModelRenderData is a valid interface', () => {
    const rd: ModelRenderData = { start: 0, count: 4 }
    expect(rd.start).toBe(0)
    expect(rd.count).toBe(4)
  })

  it('IModelCacheInfo is a marker interface', () => {
    // Marker interface — just verify it can be implemented
    const info: IModelCacheInfo = {}
    expect(info).toBeDefined()
  })

  it('IModelWidget can be structurally typed', () => {
    const widget: IModelWidget = {
      palette: 'player',
      scale: 12,
      setup: () => {},
    }
    expect(widget.palette).toBe('player')
    expect(widget.scale).toBe(12)
  })
})

describe('Model mock implementations', () => {
  it('IModel can be structurally implemented', () => {
    const model: IModel = {
      frames: 1,
      sections: 1,
      transformationMatrix: () => new Float32Array(16),
      size: new Float32Array([1, 1, 1]),
      bounds: () => new Float32Array([0, 0, 0, 1, 1, 1]),
      renderData: () => ({ start: 0, count: 4 }),
      aggregateBounds: Rectangle.fromLTRB(0, 0, 2, 2),
    }
    expect(model.frames).toBe(1)
    expect(model.sections).toBe(1)
    expect(model.size[0]).toBe(1)
  })

  it('IModelCache can be structurally implemented', () => {
    const model = { frames: 1, sections: 1 } as unknown as IModel
    const cache: IModelCache = {
      getModel: () => model,
      getModelSequence: () => model,
      hasModelSequence: () => true,
    }
    expect(cache.getModel('test')).toBe(model)
    expect(cache.getModelSequence('test', 'idle')).toBe(model)
    expect(cache.hasModelSequence('test', 'idle')).toBe(true)
  })
})
