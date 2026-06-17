/**
 * WithVoxelBarrel.test.ts — WithVoxelBarrel unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WithVoxelBarrel, type WithVoxelBarrelInfo, type IArmament } from './WithVoxelBarrel'
import type { ITurreted } from './WithVoxelTurret'
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

function createMockTurreted(): ITurreted {
  return {
    name: 'primary',
    position: () => new WVec(0, 0, 256),
    worldOrientation: () => new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(32)),
  }
}

function createMockArmament(): IArmament {
  return {
    name: 'primary',
    recoil: 0,
    turretName: 'primary',
  }
}

function createMockRenderer(): ModelRenderer {
  return new ModelRenderer(
    { renderBufferSize: 2048 },
    createMockModelCache(),
    VoxelNormalsPalette.createTS(),
  )
}

describe('WithVoxelBarrel', () => {
  let renderer: ModelRenderer
  let renderVoxels: RenderVoxels
  let modelCache: IModelCache
  let armament: IArmament
  let turreted: ITurreted
  let info: WithVoxelBarrelInfo

  beforeEach(() => {
    renderer = createMockRenderer()
    modelCache = createMockModelCache()
    renderVoxels = new RenderVoxels(
      defaultRenderVoxelsInfo(),
      renderer,
      WAngle.fromDegrees(85),
      'testActor',
    )
    armament = createMockArmament()
    turreted = createMockTurreted()
    info = {
      sequence: 'barrel',
      armament: 'primary',
      localOffset: new WVec(256, 0, 0),
      localOrientation: WRot.None,
      showShadow: true,
    }
  })

  describe('construction', () => {
    it('creates and registers barrel with RenderVoxels', () => {
      const barrel = new WithVoxelBarrel(
        info, renderVoxels, modelCache,
        armament, turreted,
        () => new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(64)),
      )
      expect(barrel.modelAnimation).toBeDefined()
      expect(renderVoxels.components).toHaveLength(1)
    })

    it('applies recoil to barrel offset', () => {
      const recoilArmament = { ...armament, recoil: 100 }
      const barrel = new WithVoxelBarrel(
        info, renderVoxels, modelCache,
        recoilArmament, turreted,
        () => WRot.None,
      )
      const offset = barrel.modelAnimation.offsetFunc()
      expect(offset).toBeDefined()
    })

    it('computes barrel rotation', () => {
      const barrel = new WithVoxelBarrel(
        info, renderVoxels, modelCache,
        armament, turreted,
        () => WRot.None,
      )
      const rotation = barrel.modelAnimation.rotationFunc()
      expect(rotation).toBeDefined()
    })
  })

  describe('disabled state', () => {
    it('defaults to not disabled', () => {
      const barrel = new WithVoxelBarrel(
        info, renderVoxels, modelCache,
        armament, turreted,
        () => WRot.None,
      )
      expect(barrel.disabled).toBe(false)
    })

    it('can be set disabled', () => {
      const barrel = new WithVoxelBarrel(
        info, renderVoxels, modelCache,
        armament, turreted,
        () => WRot.None,
      )
      barrel.disabled = true
      expect(barrel.disabled).toBe(true)
    })
  })

  describe('renderPreview (static)', () => {
    it('returns preview animation array', () => {
      const result = WithVoxelBarrel.renderPreview(
        modelCache, 'testImage', 'barrel',
        () => new WVec(256, 0, 0),
        () => WRot.None,
        true,
      )
      expect(result).toHaveLength(1)
    })
  })
})
