/**
 * WithVoxelTurret.test.ts — WithVoxelTurret unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WithVoxelTurret, type WithVoxelTurretInfo, type ITurreted } from './WithVoxelTurret'
import { RenderVoxels, defaultRenderVoxelsInfo } from './RenderVoxels'
import { ModelRenderer } from '../World/ModelRenderer'
import { VoxelNormalsPalette } from '../World/VoxelNormalsPalette'
import { WRot } from '../../../OpenRA.Game/WRot'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import type { IModel, IModelCache } from '../../../OpenRA.Game/Graphics/Model'

function createMockModel(): IModel {
  return {
    frames: 1, sections: 1,
    transformationMatrix: () => new Float32Array(16),
    size: new Float32Array([1, 1, 1]),
    bounds: () => new Float32Array([-1, -1, -1, 1, 1, 1]),
    renderData: () => ({ start: 0, count: 4 }),
    aggregateBounds: { X: 0, Y: 0, Width: 2, Height: 2, Left: 0, Right: 2, Top: 0, Bottom: 2, isEmpty: false } as any,
  }
}

function createMockModelCache(): IModelCache {
  return {
    getModel: () => createMockModel(),
    getModelSequence: () => createMockModel(),
    hasModelSequence: () => true,
  }
}

function createMockTurreted(suffix = ''): ITurreted {
  return {
    name: `primary${suffix}`,
    position: () => new WVec(0, 0, 256),
    worldOrientation: () => new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(32)),
  }
}

function createMockRenderer(): ModelRenderer {
  return new ModelRenderer(
    { renderBufferSize: 2048 },
    createMockModelCache(),
    VoxelNormalsPalette.createTS(),
  )
}

describe('WithVoxelTurret', () => {
  let renderer: ModelRenderer
  let renderVoxels: RenderVoxels
  let modelCache: IModelCache
  let turreted: ITurreted
  let info: WithVoxelTurretInfo

  beforeEach(() => {
    renderer = createMockRenderer()
    modelCache = createMockModelCache()
    renderVoxels = new RenderVoxels(
      defaultRenderVoxelsInfo(),
      renderer,
      WAngle.fromDegrees(85),
      'testActor',
    )
    turreted = createMockTurreted()
    info = {
      sequence: 'turret',
      turret: 'primary',
      showShadow: true,
    }
  })

  describe('construction', () => {
    it('creates and registers turret with RenderVoxels', () => {
      const turret = new WithVoxelTurret(info, renderVoxels, modelCache, turreted)
      expect(turret.modelAnimation).toBeDefined()
      expect(turret.renderVoxels).toBe(renderVoxels)
      expect(renderVoxels.components).toHaveLength(1)
    })

    it('uses turret position and orientation callbacks', () => {
      const turret = new WithVoxelTurret(info, renderVoxels, modelCache, turreted)
      expect(turret.modelAnimation.offsetFunc()).toBeDefined()
      expect(turret.modelAnimation.rotationFunc()).toBeDefined()
    })
  })

  describe('disabled state', () => {
    it('defaults to not disabled', () => {
      const turret = new WithVoxelTurret(info, renderVoxels, modelCache, turreted)
      expect(turret.disabled).toBe(false)
    })

    it('can be set disabled', () => {
      const turret = new WithVoxelTurret(info, renderVoxels, modelCache, turreted)
      turret.disabled = true
      expect(turret.disabled).toBe(true)
    })
  })

  describe('renderPreview (static)', () => {
    it('returns preview animation array', () => {
      const result = WithVoxelTurret.renderPreview(
        modelCache, 'testImage', 'turret',
        () => new WVec(0, 0, 256),
        () => new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(16)),
        true,
      )
      expect(result).toHaveLength(1)
    })
  })
})
