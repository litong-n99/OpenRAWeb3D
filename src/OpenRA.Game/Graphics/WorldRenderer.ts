/**
 * WorldRenderer.ts — OpenRA 世界渲染器到 Babylon.js 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/WorldRenderer.cs
 *
 * 核心范式转换:
 * - 六阶段手动渲染流程 → BABYLON.Scene.render() + renderingGroupId 分层
 * - CPU 端视口遍历筛选 → 内置 Frustum Culling
 * - Y-sort 手动排序 → scene.transparentSortCompareFn
 * - HardwarePalette 手动管理 → RawTexture + ShaderMaterial
 * - 手动后处理通道 → DefaultRenderingPipeline / custom PostProcess
 */

import {
  DefaultRenderingPipeline,
  type Camera,
} from '@babylonjs/core'
import type { Renderer } from '../Renderer'

// ---------------------------------------------------------------------------
// 坐标原语（对应 OpenRA WPos / WVec / int2 / float2 / float3）
// ---------------------------------------------------------------------------

export interface WPos {
  x: number
  y: number
  z: number
}

export interface WVec {
  x: number
  y: number
  z: number
}

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Int2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// 渲染阶段枚举（对应 OpenRA PostProcessPassType）
// ---------------------------------------------------------------------------

export const PostProcessPassType = {
  AfterActors: 'AfterActors',
  AfterWorld: 'AfterWorld',
  AfterShroud: 'AfterShroud',
  AfterAnnotations: 'AfterAnnotations',
} as const
export type PostProcessPassType = (typeof PostProcessPassType)[keyof typeof PostProcessPassType]

// ---------------------------------------------------------------------------
// 渲染分组 ID（对应 OpenRA renderingGroupId 分层）
// ---------------------------------------------------------------------------

export const RenderGroup = {
  /** 地形层 */
  Terrain: 0,
  /** 普通对象层（Actor、特效） */
  Actor: 1,
  /** 覆盖层（血条、选择框） */
  Overlay: 2,
  /** 注释层（调试信息） */
  Annotation: 3,
} as const
export type RenderGroup = (typeof RenderGroup)[keyof typeof RenderGroup]

// ---------------------------------------------------------------------------
// 调色板接口（HardwarePalette 模块迁移前的类型占位）
// ---------------------------------------------------------------------------

export interface IPalette {
  /** 调色板名称 */
  name: string
  /** 调色板在纹理中的行索引 */
  index: number
  /** 调色板 RGBA 数据 */
  colors: Uint8Array
  /** 是否允许颜色修饰器 */
  allowModifiers: boolean
}

export interface IHardwarePalette {
  /** 添加调色板 */
  addPalette(name: string, palette: IPalette, allowModifiers?: boolean): void
  /** 替换调色板 */
  replacePalette(name: string, palette: IPalette): void
  /** 获取调色板 */
  getPalette(name: string): IPalette | undefined
  /** 获取调色板索引 */
  getPaletteIndex(name: string): number
  /** 是否包含调色板 */
  contains(name: string): boolean
  /** 调色板纹理高度（行数） */
  readonly height: number
  /** 设置颜色偏移 */
  setColorShift(
    name: string,
    hueOffset: number,
    satOffset: number,
    valueModifier: number,
    minHue: number,
    maxHue: number,
  ): void
  /** 应用所有调色板修饰器 */
  applyModifiers(_modifiers: unknown[]): void
  /** 初始化调色板 */
  initialize(): void
  /** 释放 GPU 资源 */
  dispose(): void
}

export interface IPaletteReference {
  /** 调色板名称 */
  readonly name: string
  /** 调色板索引 */
  readonly index: number
  /** 当前调色板数据 */
  palette: IPalette
  /** 所属的调色板管理器 */
  readonly hardwarePalette: IHardwarePalette
}

// ---------------------------------------------------------------------------
// 渲染对象接口（对应 OpenRA IRenderable / IFinalizedRenderable）
// ---------------------------------------------------------------------------

export interface IRenderable {
  /** 世界坐标 */
  readonly pos: WPos
  /** Z 轴排序偏移 */
  readonly zOffset: number
  /** 是否为装饰性渲染（不受战争迷雾影响） */
  readonly isDecoration: boolean

  /** 准备渲染：将 IRenderable 转换为 IFinalizedRenderable */
  prepareRender(wr: WorldRenderer): IFinalizedRenderable

  /** 创建带新 Z 偏移的副本 */
  withZOffset(newOffset: number): IRenderable

  /** 创建偏移后的副本 */
  offsetBy(offset: WVec): IRenderable

  /** 创建装饰性副本 */
  asDecoration(): IRenderable
}

/**
 * Z 排序键计算函数（对应 RenderableZPositionComparisonKey）
 *
 * Z_key = Pos.Y + Pos.Z + ZOffset
 * 按世界 Y 坐标、Z 高度与手动偏移量之和升序排列，
 * 确保 screen-space 中"下方"的对象先绘制。
 */
export function renderableZPositionComparisonKey(r: IRenderable): number {
  return r.pos.y + r.pos.z + r.zOffset
}

export interface IFinalizedRenderable {
  /** 执行渲染 */
  render(wr: WorldRenderer): void
  /** 渲染调试几何 */
  renderDebugGeometry(wr: WorldRenderer): void
  /** 获取屏幕包围盒 */
  screenBounds(wr: WorldRenderer): Rect
}

// ---------------------------------------------------------------------------
// 地形渲染器接口（对应 OpenRA IRenderTerrain）
// ---------------------------------------------------------------------------

export interface IRenderTerrain {
  /** 渲染地形 */
  renderTerrain(wr: WorldRenderer, viewport: IViewport): void
}

// ---------------------------------------------------------------------------
// 地形光照接口（对应 OpenRA ITerrainLighting）
// ---------------------------------------------------------------------------

export interface ITerrainLighting {
  /** 获取指定位置的光照色调 */
  tintAt(pos: WPos): Vec3
}

// ---------------------------------------------------------------------------
// 视口接口（Viewport 模块迁移前的类型占位）
// ---------------------------------------------------------------------------

export interface IViewport {
  /** 视口左上角世界坐标 */
  readonly topLeft: Vec2
  /** 视口右下角世界坐标 */
  readonly bottomRight: Vec2
  /** 视口尺寸（逻辑像素） */
  readonly size: { width: number; height: number }
  /** 世界坐标 → 视口像素坐标 */
  worldToViewPx(worldPos: Vec2): Vec2
  /** 视口像素坐标 → 世界坐标 */
  viewToWorldPx(viewPos: Int2): WPos
  /** 获取裁剪矩形 */
  getScissorBounds(isWorld: boolean): Rect
}

// ---------------------------------------------------------------------------
// 矩形
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// 后处理通道接口（对应 OpenRA IRenderPostProcessPass）
// ---------------------------------------------------------------------------

export interface IPostProcessPass {
  /** 后处理类型 */
  readonly type: PostProcessPassType
  /** 是否启用 */
  readonly enabled: boolean
  /** 执行后处理 */
  draw(wr: WorldRenderer): void
}

// ---------------------------------------------------------------------------
// World 相关接口（World 模块迁移前的类型占位）
// ---------------------------------------------------------------------------

export const WorldType = {
  Regular: 'Regular',
  Editor: 'Editor',
  Shellmap: 'Shellmap',
} as const
export type WorldType = (typeof WorldType)[keyof typeof WorldType]

export interface IWorldActor {
  readonly disposed: boolean
  traitOrDefault<T>(): T | undefined
  traitsImplementing<T>(): T[]
  /** 世界 Actor 自身的渲染对象（对应 OpenRA World.WorldActor.Render()） */
  render(wr: WorldRenderer): IRenderable[]
}

export interface IActor {
  readonly isInWorld: boolean
  readonly disposed: boolean
  /** 收集 Actor 的渲染对象 */
  render(wr: WorldRenderer): IRenderable[]
}

export interface IEffect {
  /** 收集特效的渲染对象 */
  render(wr: WorldRenderer): IRenderable[]
}

export interface IOrderGenerator {
  render(wr: WorldRenderer, world: IWorld): IRenderable[]
  renderAboveShroud(wr: WorldRenderer, world: IWorld): IRenderable[]
  renderAnnotations(wr: WorldRenderer, world: IWorld): IRenderable[]
}

export interface IScreenMap {
  renderableActorsInBox(topLeft: Vec2, bottomRight: Vec2): IActor[]
  renderableEffectsInBox(topLeft: Vec2, bottomRight: Vec2): IEffect[]
}

export interface ISelection {
  readonly actors: IActor[]
}

export interface IWorld {
  /** 地图瓦片尺寸 */
  readonly tileSize: { width: number; height: number }
  /** 瓦片缩放 */
  readonly tileScale: number
  /** 世界类型 */
  readonly type: WorldType
  /** 是否已释放 */
  readonly disposed: boolean
  /** 本地玩家 */
  readonly renderPlayer: unknown | null
  /** 世界 Actor */
  readonly worldActor: IWorldActor
  /** 空间索引 */
  readonly screenMap: IScreenMap
  /** 未分区特效 */
  readonly unpartitionedEffects: IEffect[]
  /** 已分区特效 */
  readonly effects: IEffect[]
  /** 指令生成器 */
  readonly orderGenerator: IOrderGenerator | null
  /** 选择集 */
  readonly selection: ISelection
  /** 释放 */
  dispose(): void
}

// ---------------------------------------------------------------------------
// WorldRenderer 主类
// ---------------------------------------------------------------------------

/**
 * WorldRenderer 负责将游戏世界中的所有可视元素——
 * 地形、Actor（单位/建筑）、特效、选择框、调试信息——
 * 组织成有序的渲染序列。
 *
 * 迁移要点：
 *   1. BABYLON.Scene.render() 替代六阶段 Draw()
 *   2. renderingGroupId 分层替代手动渲染阶段
 *   3. transparentSortCompareFn 实现 Y-sort
 *   4. RawTexture 替代 HardwarePalette
 *   5. 内置 Frustum Culling 替代 CPU 端视口遍历
 *   6. DefaultRenderingPipeline 实现后处理
 */
export class WorldRenderer {
  // -----------------------------------------------------------------------
  // 公共属性
  // -----------------------------------------------------------------------

  /** 瓦片尺寸 */
  readonly tileSize: { width: number; height: number }

  /** 瓦片缩放 */
  readonly tileScale: number

  /** 关联的世界 */
  readonly world: IWorld

  /** 关联的 Renderer */
  readonly renderer: Renderer

  /** 关联的 Babylon.js Scene（world 内容渲染在此场景中） */
  readonly scene: import('@babylonjs/core').Scene

  /** 地形光照（可选） */
  terrainLighting: ITerrainLighting | null = null

  /** 视口（初始化为默认值，World 迁移后由真实 Viewport 替换） */
  viewport: IViewport

  // -----------------------------------------------------------------------
  // 调色板管理
  // -----------------------------------------------------------------------

  /** 调色板引用缓存 */
  private readonly paletteRefs: Map<string, IPaletteReference> = new Map()

  /** 调色板失效事件 */
  paletteInvalidated: (() => void) | null = null

  // -----------------------------------------------------------------------
  // 渲染对象缓存
  // -----------------------------------------------------------------------

  private preparedRenderables: IFinalizedRenderable[] = []
  private preparedOverlayRenderables: IFinalizedRenderable[] = []
  private preparedAnnotationRenderables: IFinalizedRenderable[] = []

  /** 屏幕上的 Actor 集合（视口内可见） */
  private onScreenActors: Set<IActor> = new Set()

  // -----------------------------------------------------------------------
  // 后处理
  // -----------------------------------------------------------------------

  private postProcessPasses: IPostProcessPass[] = []
  private defaultPipeline: DefaultRenderingPipeline | null = null

  // -----------------------------------------------------------------------
  // 深度缓冲
  // -----------------------------------------------------------------------

  private enableDepthBuffer: boolean

  /** 获取是否启用深度缓冲（从 MapGrid 读取） */
  get depthBufferEnabled(): boolean {
    return this.enableDepthBuffer
  }

  // -----------------------------------------------------------------------
  // Y-sort 缓存
  // -----------------------------------------------------------------------

  /**
   * 自定义透明排序比较函数（对应 OpenRA Y-sort）。
   *
   * 排序键：Z_key = Pos.Y + Pos.Z + ZOffset
   * 确保 screen-space 中 Y 坐标较小的对象先绘制（"下方"先画）。
   *
   * 注意：此函数在 Babylon.js 中通过 scene.setRenderingOrder() 或
   * transparentSortCompareFn 设置，配合 renderingGroupId 使用。
   */
  static readonly renderableZPositionComparisonKey = renderableZPositionComparisonKey

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  constructor(renderer: Renderer, world: IWorld) {
    this.renderer = renderer
    this.world = world
    this.tileSize = world.tileSize
    this.tileScale = world.tileScale

    // worldScene 是渲染游戏世界内容的场景
    this.scene = renderer.worldScene

    // 配置场景渲染层级（renderingGroupId 替代手动渲染阶段）
    this.configureRenderingGroups()

    // 配置 Y-sort（对应 RenderableZPositionComparisonKey）
    this.configureYSort()

    this.enableDepthBuffer = false // 默认关闭；World 迁移后从 MapGrid 读取

    // 初始化默认视口
    this.viewport = {
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      worldToViewPx: (wp) => ({ x: wp.x, y: wp.y }),
      viewToWorldPx: (vp) => ({ x: vp.x, y: vp.y, z: 0 }),
      getScissorBounds: (_isWorld) => ({ x: 0, y: 0, width: 0, height: 0 }),
    }
  }

  // -----------------------------------------------------------------------
  // 场景渲染层级配置
  // -----------------------------------------------------------------------

  /**
   * 配置场景的 renderingGroupId 分层（替代手动渲染阶段）。
   *
   * 映射:
   *   - RenderGroup.Terrain (0)    → 地形
   *   - RenderGroup.Actor (1)      → 普通对象（Actor、特效）
   *   - RenderGroup.Overlay (2)    → 覆盖层（血条、选择框）
   *   - RenderGroup.Annotation (3) → 注释/调试
   */
  private configureRenderingGroups(): void {
    // Babylon.js 的 renderingGroupId 在 mesh/material 级别设置
    // 此处仅声明分组常量，实际分组由各渲染对象的 Mesh 设置
    // 例如: terrainMesh.renderingGroupId = RenderGroup.Terrain
  }

  /**
   * 配置自定义 Y-sort 透明排序（对应 OpenRA RenderableZPositionComparisonKey）。
   *
   * 排序键公式：Z_key = Pos.Y + Pos.Z + ZOffset
   * 升序排列 → screen-space 中"下方"对象先绘制。
   */
  private configureYSort(): void {
    // 存储排序键到 mesh 的 metadata 中，供自定义排序函数使用
    // 实际排序通过 scene.transparentSortCompareFn 在迁移后续模块时设置
    //
    // 示例用法（需在 WorldRenderer 初始化时设置）:
    //   this.scene.transparentSortCompareFn = (a, b) => {
    //     const aKey = (a.metadata?.sortKey as number) ?? 0
    //     const bKey = (b.metadata?.sortKey as number) ?? 0
    //     return aKey - bKey
    //   }
  }

  // -----------------------------------------------------------------------
  // 帧管理
  // -----------------------------------------------------------------------

  /**
   * 帧开始时调用（替代 OpenRA BeginFrame）。
   * 通知所有子渲染器进入新帧。
   */
  beginFrame(): void {
    // 子渲染器（SpriteRenderer 等）迁移后在此通知
    // foreach (var r in renderers) r.BeginFrame();
  }

  /**
   * 帧结束时调用（替代 OpenRA EndFrame）。
   * 通知所有子渲染器结束当前帧。
   */
  endFrame(): void {
    // 子渲染器（SpriteRenderer 等）迁移后在此通知
    // foreach (var r in renderers) r.EndFrame();
  }

  // -----------------------------------------------------------------------
  // 玩家调色板更新
  // -----------------------------------------------------------------------

  /**
   * 为指定玩家更新调色板（替代 OpenRA UpdatePalettesForPlayer）。
   *
   * TODO: ILoadsPlayerPalettes trait 迁移后实现
   */
  updatePalettesForPlayer(
    _internalName: string,
    _color: import('@babylonjs/core').Color4,
    _replaceExisting: boolean,
  ): void {
    // foreach (var pal in World.WorldActor.TraitsImplementing<ILoadsPlayerPalettes>())
    //   pal.LoadPlayerPalettes(this, internalName, color, replaceExisting);
  }

  // -----------------------------------------------------------------------
  // 调色板管理
  // -----------------------------------------------------------------------

  /** 创建调色板引用 */
  private createPaletteReference(name: string): IPaletteReference {
    const index = this.paletteRefs.size
    return {
      name,
      index,
      palette: { name, index, colors: new Uint8Array(256 * 4), allowModifiers: false },
      hardwarePalette: {
        height: 0,
        addPalette: () => {},
        replacePalette: () => {},
        getPalette: () => undefined,
        getPaletteIndex: () => 0,
        contains: () => false,
        setColorShift: () => {},
        applyModifiers: () => {},
        initialize: () => {},
        dispose: () => {},
      },
    }
  }

  /**
   * 获取或创建调色板引用（替代 OpenRA Palette(string name)）。
   */
  palette(name: string): IPaletteReference | null {
    if (!name) return null

    let ref = this.paletteRefs.get(name)
    if (!ref) {
      ref = this.createPaletteReference(name)
      this.paletteRefs.set(name, ref)
    }
    return ref
  }

  /**
   * 添加调色板（替代 OpenRA AddPalette）。
   */
  addPalette(
    name: string,
    _pal: IPalette,
    _allowModifiers = false,
    allowOverwrite = false,
  ): void {
    if (allowOverwrite && this.paletteRefs.has(name)) {
      this.replacePalette(name, _pal)
      return
    }

    const oldHeight = this.paletteRefs.size
    const ref = this.createPaletteReference(name)
    ref.palette = _pal
    this.paletteRefs.set(name, ref)

    if (oldHeight !== this.paletteRefs.size) {
      this.paletteInvalidated?.()
    }
  }

  /**
   * 替换调色板（替代 OpenRA ReplacePalette）。
   */
  replacePalette(name: string, pal: IPalette): void {
    const paletteRef = this.paletteRefs.get(name)
    if (paletteRef) {
      paletteRef.palette = pal
    }
  }

  /**
   * 设置调色板颜色偏移（替代 OpenRA SetPaletteColorShift）。
   *
   * TODO: HardwarePalette 迁移后调用对应方法
   */
  setPaletteColorShift(
    _name: string,
    _hueOffset: number,
    _satOffset: number,
    _valueModifier: number,
    _minHue: number,
    _maxHue: number,
  ): void {
    // TODO: HardwarePalette 迁移后调用 hardwarePalette.setColorShift(...)
  }

  /**
   * 刷新调色板（替代 OpenRA RefreshPalette）。
   *
   * **关键优化 (TODO-2.2.7)**：仅在调色板实际变化时调用 RawTexture.update()，
   * 避免每帧上传 GPU 纹理数据。
   */
  refreshPalette(): void {
    // TODO: HardwarePalette + IPaletteModifier 迁移后实现
    // const isDirty = palette.applyModifiers(world.worldActor.traitsImplementing<IPaletteModifier>())
    // if (isDirty) {
    //   paletteTexture.update(paletteData)
    // }
    // renderer.setPalette(palette)
  }

  // -----------------------------------------------------------------------
  // 渲染对象收集（替代 OpenRA GenerateRenderables / PrepareRenderables）
  // -----------------------------------------------------------------------

  /**
   * 生成普通渲染对象列表（替代 OpenRA GenerateRenderables）。
   *
   * 收集屏幕上所有 Actor、世界 Actor、特效的 IRenderable，
   * 按 Y-sort 排序后转换为 IFinalizedRenderable。
   *
   * 迁移说明：Babylon.js 通过内置 Frustum Culling +
   * transparentSortCompareFn 自动完成视口筛选和排序。
   * 此方法保留用于需要 CPU 端干预的特殊逻辑。
   */
  generateRenderables(): void {
    if (this.world.worldActor.disposed) return

    const buffer: IRenderable[] = []

    // 屏幕上的 Actor 渲染对象
    for (const actor of this.onScreenActors) {
      buffer.push(...actor.render(this))
    }

    // 世界 Actor 的渲染对象
    buffer.push(...this.world.worldActor.render(this))

    // 未分区特效
    for (const effect of this.world.unpartitionedEffects) {
      buffer.push(...effect.render(this))
    }

    // 屏幕范围内的已分区特效
    for (const effect of this.world.screenMap.renderableEffectsInBox(
      this.viewport.topLeft,
      this.viewport.bottomRight,
    )) {
      buffer.push(...effect.render(this))
    }

    // 稳定排序（使用稳定的排序算法避免闪烁伪影）
    // 创建 (sortKey, index, renderable) 三元组，按 sortKey 排序，相同 key 保序
    const indexed = buffer.map((r, i) => ({
      key: renderableZPositionComparisonKey(r),
      index: i,
      renderable: r,
    }))

    indexed.sort((a, b) => {
      if (a.key !== b.key) return a.key - b.key
      return a.index - b.index // 稳定排序：key 相同保持原始顺序
    })

    // 准备渲染对象
    for (const item of indexed) {
      this.preparedRenderables.push(item.renderable.prepareRender(this))
    }
  }

  /**
   * 生成覆盖层渲染对象（替代 OpenRA GenerateOverlayRenderables）。
   *
   * TODO: IRenderAboveShroud / IRenderAboveShroudWhenSelected trait 迁移后实现
   */
  generateOverlayRenderables(): void {
    // TODO: trait 系统迁移后实现
  }

  /**
   * 生成注释渲染对象（替代 OpenRA GenerateAnnotationRenderables）。
   *
   * TODO: IRenderAnnotations / IRenderAnnotationsWhenSelected trait 迁移后实现
   */
  generateAnnotationRenderables(): void {
    // TODO: trait 系统迁移后实现
  }

  /**
   * 准备所有渲染对象（替代 OpenRA PrepareRenderables）。
   */
  prepareRenderables(): void {
    if (this.world.worldActor.disposed) return

    this.refreshPalette()

    // 收集屏幕上可见的 Actor
    this.onScreenActors.clear()
    const actors = this.world.screenMap.renderableActorsInBox(
      this.viewport.topLeft,
      this.viewport.bottomRight,
    )
    for (const actor of actors) {
      this.onScreenActors.add(actor)
    }

    this.generateRenderables()
    this.generateOverlayRenderables()
    this.generateAnnotationRenderables()
  }

  // -----------------------------------------------------------------------
  // 渲染执行（替代 OpenRA Draw）
  // -----------------------------------------------------------------------

  /**
   * 执行世界渲染（替代 OpenRA Draw 六阶段流程）。
   *
   * 在 Babylon.js 架构下，渲染由 scene.render() 自动处理：
   *   1. 地形（renderingGroupId = 0）
   *   2. 普通对象（renderingGroupId = 1），按 Y-sort 排序
   *   3. 覆盖层（renderingGroupId = 2）
   *   4. 注释（renderingGroupId = 3）
   *
   * 后处理在场景渲染后通过 DefaultRenderingPipeline 自动应用。
   */
  draw(): void {
    if (this.world.worldActor.disposed) return

    // 在 Babylon.js 架构下，实际渲染由 Renderer 的帧循环中
    // worldScene.render() 执行，此方法主要负责：
    //   1. 验证世界未释放
    //   2. 提供 API 兼容性（调用方代码无需修改）
    //
    // 原始六阶段流程在 Babylon.js 中的等价映射：
    //   1. terrainRenderer.RenderTerrain → Mesh + renderingGroupId=0
    //   2. preparedRenderables[i].Render  → Mesh + renderingGroupId=1 + Y-sort
    //   3. AfterActors post-processing     → DefaultRenderingPipeline
    //   4. RenderAboveWorld               → renderingGroupId=1
    //   5. RenderShroud                   → renderingGroupId=2
    //   6. AfterShroud post-processing    → DefaultRenderingPipeline
  }

  /**
   * 绘制注释（替代 OpenRA DrawAnnotations）。
   */
  drawAnnotations(): void {
    // 渲染调试几何（renderingGroupId = 3 的 mesh 自动由 scene.render() 处理）

    // 应用 AfterAnnotations 后处理
    this.applyPostProcessing(PostProcessPassType.AfterAnnotations)

    // 清空渲染对象缓存（释放引用）
    this.clearRenderableBuffers()
  }

  /** 清空所有渲染对象缓存 */
  private clearRenderableBuffers(): void {
    this.preparedRenderables.length = 0
    this.preparedOverlayRenderables.length = 0
    this.preparedAnnotationRenderables.length = 0
  }

  // -----------------------------------------------------------------------
  // 后处理
  // -----------------------------------------------------------------------

  /**
   * 应用后处理通道（替代 OpenRA ApplyPostProcessing）。
   */
  private applyPostProcessing(type: PostProcessPassType): void {
    for (const pass of this.postProcessPasses) {
      if (pass.type !== type || !pass.enabled) continue
      this.renderer.flush()
      pass.draw(this)
    }
  }

  /**
   * 添加后处理通道。
   */
  addPostProcessPass(pass: IPostProcessPass): void {
    this.postProcessPasses.push(pass)
  }

  /**
   * 移除后处理通道。
   */
  removePostProcessPass(pass: IPostProcessPass): void {
    const idx = this.postProcessPasses.indexOf(pass)
    if (idx >= 0) {
      this.postProcessPasses.splice(idx, 1)
    }
  }

  /** 获取后处理通道列表 */
  getPostProcessPasses(): readonly IPostProcessPass[] {
    return this.postProcessPasses
  }

  /**
   * 初始化默认渲染管线（泛光、色调映射等）。
   *
   * TODO-2.2.6: 集成 DefaultRenderingPipeline
   * 需要在实际渲染环境中创建（依赖 Engine + Scene）。
   * 在 mock 测试环境中创建可能失败，调用方需处理。
   */
  initializeDefaultPipeline(camera: Camera): DefaultRenderingPipeline | null {
    if (this.defaultPipeline) return this.defaultPipeline

    try {
      this.defaultPipeline = new DefaultRenderingPipeline(
        'worldPipeline',
        true, // hdr
        this.scene,
        [camera],
      )
      // 泛光配置（与 OpenRA 后处理视觉风格对齐）
      this.defaultPipeline.bloomEnabled = true
      this.defaultPipeline.bloomThreshold = 0.8
      this.defaultPipeline.bloomWeight = 0.3
      // 色调映射
      this.defaultPipeline.imageProcessingEnabled = true
      this.defaultPipeline.imageProcessing.toneMappingEnabled = true
    } catch {
      // 测试/mock 环境忽略
      this.defaultPipeline = null
    }

    return this.defaultPipeline
  }

  /** 获取默认渲染管线 */
  getDefaultPipeline(): DefaultRenderingPipeline | null {
    return this.defaultPipeline
  }

  // -----------------------------------------------------------------------
  // 坐标转换方法（与 OpenRA 完全一致）
  // -----------------------------------------------------------------------

  /**
   * 世界坐标 → 屏幕坐标（2D）。
   * 对应 OpenRA ScreenPosition(WPos)。
   */
  screenPosition(pos: WPos): Vec2 {
    return {
      x: (this.tileSize.width * pos.x) / this.tileScale,
      y: (this.tileSize.height * (pos.y - pos.z)) / this.tileScale,
    }
  }

  /**
   * 世界坐标 → 屏幕坐标（float2 重载）。
   * 对应 OpenRA ScreenPosition(float2)。
   */
  screenPositionFloat2(pos: Vec2): Vec2 {
    return {
      x: (this.tileSize.width * pos.x) / this.tileScale,
      y: (this.tileSize.height * pos.y) / this.tileScale,
    }
  }

  /**
   * 世界坐标 → 3D 屏幕坐标。
   * 对应 OpenRA Screen3DPosition。
   *
   * 注意：世界 Y 和 Z 坐标到屏幕的映射关系是非直觉的：
   *   - 世界 Y 增加 → 屏幕 Y 增加 + 屏幕 Z（深度）同步增加
   *   - 世界 Z 增加 → 屏幕 Y 减小，屏幕 Z 不变
   */
  screen3DPosition(pos: WPos): Vec3 {
    const z = (pos.y * this.tileSize.height) / this.tileScale
    return {
      x: (this.tileSize.width * pos.x) / this.tileScale,
      y: (this.tileSize.height * (pos.y - pos.z)) / this.tileScale,
      z,
    }
  }

  /**
   * 世界坐标 → 屏幕像素坐标（四舍五入）。
   * 对应 OpenRA ScreenPxPosition。
   */
  screenPxPosition(pos: WPos): Int2 {
    const px = this.screenPosition(pos)
    return { x: Math.round(px.x), y: Math.round(px.y) }
  }

  /**
   * 世界坐标 → 3D 屏幕像素坐标（四舍五入）。
   * 对应 OpenRA Screen3DPxPosition。
   */
  screen3DPxPosition(pos: WPos): Vec3 {
    const px = this.screen3DPosition(pos)
    return { x: Math.round(px.x), y: Math.round(px.y), z: px.z }
  }

  /**
   * 世界向量 → 屏幕向量分量。
   * 对应 OpenRA ScreenVectorComponents。
   */
  screenVectorComponents(vec: WVec): Vec3 {
    return {
      x: (this.tileSize.width * vec.x) / this.tileScale,
      y: (this.tileSize.height * (vec.y - vec.z)) / this.tileScale,
      z: (this.tileSize.height * vec.z) / this.tileScale,
    }
  }

  /**
   * 世界向量 → 屏幕向量（4 分量数组）。
   * 对应 OpenRA ScreenVector。
   */
  screenVector(vec: WVec): [number, number, number, number] {
    const xyz = this.screenVectorComponents(vec)
    return [xyz.x, xyz.y, xyz.z, 1]
  }

  /**
   * 世界向量 → 屏幕像素偏移（四舍五入）。
   * 对应 OpenRA ScreenPxOffset。
   */
  screenPxOffset(vec: WVec): Int2 {
    const xyz = this.screenVectorComponents(vec)
    return { x: Math.round(xyz.x), y: Math.round(xyz.y) }
  }

  /**
   * 屏幕像素坐标 → 世界坐标（无高度）。
   * 对应 OpenRA ProjectedPosition。
   *
   * 注意：同一屏幕位置对应无数个世界位置（不同高度），
   * 此方法返回高度为 0 的位置。
   */
  projectedPosition(screenPx: Int2): WPos {
    return {
      x: (this.tileScale * screenPx.x) / this.tileSize.width,
      y: (this.tileScale * screenPx.y) / this.tileSize.height,
      z: 0,
    }
  }

  // -----------------------------------------------------------------------
  // 渲染对象缓存 访问器（供测试使用）
  // -----------------------------------------------------------------------

  /** 获取已准备的普通渲染对象数量 */
  get preparedRenderablesCount(): number {
    return this.preparedRenderables.length
  }

  /** 获取已准备的覆盖层渲染对象数量 */
  get preparedOverlayRenderablesCount(): number {
    return this.preparedOverlayRenderables.length
  }

  /** 获取已准备的注释渲染对象数量 */
  get preparedAnnotationRenderablesCount(): number {
    return this.preparedAnnotationRenderables.length
  }

  /** 获取屏幕上可见的 Actor 数量 */
  get onScreenActorCount(): number {
    return this.onScreenActors.size
  }

  // -----------------------------------------------------------------------
  // 资源释放
  // -----------------------------------------------------------------------

  dispose(): void {
    // 注意：原始 OpenRA 中 WorldRenderer.Dispose() 会释放 World，
    // 这与所有权模式有关。迁移版中 World 的生命周期应独立管理。
    // 此处不调用 this.world.dispose()。
    this.defaultPipeline?.dispose()
    this.defaultPipeline = null

    this.clearRenderableBuffers()
    this.onScreenActors.clear()
    this.paletteRefs.clear()
    this.postProcessPasses.length = 0
  }
}
