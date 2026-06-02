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
import type { Renderer, IRenderer as IRendererBase } from '../Renderer'

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
  /**
   * 获取渲染包围盒（调试用，对应原始 ScreenMap.RenderBounds）。
   * TODO: ScreenMap 迁移后实现
   */
  renderBounds?(renderPlayer: unknown): Rect[]
  /**
   * 获取鼠标检测包围盒（调试用，对应原始 ScreenMap.MouseBounds）。
   * TODO: ScreenMap 迁移后实现
   */
  mouseBounds?(renderPlayer: unknown): { vertices: Vec2[] }[]
}

export interface ISelection {
  readonly actors: IActor[]
}

export interface IPlayer {
  readonly internalName: string
  readonly color: { r: number; g: number; b: number; a: number }
  readonly playerActor: IActor
}

/**
 * Trait 回调类型：接收 Actor 和 Trait 实例，无返回值。
 * 对应 OpenRA World.ApplyToActorsWithTrait<T>(action) 的 action 参数。
 */
export type TraitAction<T> = (actor: IActor, trait: T) => void

export interface IWorld {
  /** 地图瓦片尺寸 */
  readonly tileSize: { width: number; height: number }
  /** 瓦片缩放 */
  readonly tileScale: number
  /** 世界类型 */
  readonly type: WorldType
  /** 是否已释放 */
  readonly disposed: boolean
  /** 渲染玩家 */
  readonly renderPlayer: IPlayer | null
  /** 本地玩家 */
  readonly localPlayer: IPlayer | null
  /** 所有玩家 */
  readonly players: IPlayer[]
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
  /**
   * 对所有拥有指定 Trait 的 Actor 执行操作。
   * 对应 OpenRA World.ApplyToActorsWithTrait<T>(action)。
   * TODO: Trait 系统迁移后实现
   */
  applyToActorsWithTrait?<T>(action: TraitAction<T>): void
  /** 释放 */
  dispose(): void
}

// ---------------------------------------------------------------------------
// 调试可视化接口（对应 OpenRA DebugVisualizations）
// ---------------------------------------------------------------------------

export interface IDebugVisualizations {
  /** 是否渲染调试几何 */
  readonly renderGeometry: boolean
  /** 是否显示 ScreenMap */
  readonly screenMap: boolean
  /** 更新深度缓冲可视化 */
  updateDepthBuffer(): void
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
  // 子渲染器与 Trait 实例（替代 OpenRA 从 WorldActor 获取的字段）
  // -----------------------------------------------------------------------

  /** 地形渲染器（从 WorldActor 的 IRenderTerrain trait 获取） */
  terrainRenderer: IRenderTerrain | null = null

  /** 子渲染器列表（从 WorldActor 的 IRenderer trait 获取） */
  private renderers: IRendererBase[] = []

  /** 调试可视化（从 WorldActor 的 DebugVisualizations trait 获取） */
  private debugVis: IDebugVisualizations | null = null

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

    // -------------------------------------------------------------------
    // 从 WorldActor 获取 Trait 实例（替代 OpenRA 构造函数的 trait 查询）
    // 这些字段需要 World + Trait 系统迁移完成后才能正确填充。
    // -------------------------------------------------------------------

    // TerrainLighting = world.WorldActor.TraitOrDefault<ITerrainLighting>()
    this.terrainLighting = world.worldActor.traitOrDefault<ITerrainLighting>() ?? null

    // terrainRenderer = world.WorldActor.TraitOrDefault<IRenderTerrain>()
    this.terrainRenderer = world.worldActor.traitOrDefault<IRenderTerrain>() ?? null

    // renderers = world.WorldActor.TraitsImplementing<IRenderer>().ToArray()
    this.renderers = world.worldActor.traitsImplementing<IRendererBase>()

    // debugVis = Exts.Lazy(world.WorldActor.TraitOrDefault<DebugVisualizations>)
    this.debugVis = world.worldActor.traitOrDefault<IDebugVisualizations>() ?? null

    // postProcessPasses = world.WorldActor.TraitsImplementing<IRenderPostProcessPass>().ToArray()
    this.postProcessPasses = world.worldActor.traitsImplementing<IPostProcessPass>()

    // enableDepthBuffer = mapGrid.EnableDepthBuffer
    // TODO: 从 MapGrid trait 读取；MapGrid 迁移后实现
    this.enableDepthBuffer = false

    // -------------------------------------------------------------------
    // Trait 驱动的初始化（需要在 Trait 系统迁移后实现）
    // TODO: foreach (ILoadsPalettes pal) pal.LoadPalettes(this)
    // TODO: palette.Initialize()
    // TODO: Player.SetupRelationshipColors(world.Players, world.LocalPlayer, this, true)
    // -------------------------------------------------------------------

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
    for (const r of this.renderers) {
      r.beginFrame?.()
    }
  }

  /**
   * 帧结束时调用（替代 OpenRA EndFrame）。
   * 通知所有子渲染器结束当前帧。
   */
  endFrame(): void {
    for (const r of this.renderers) {
      r.endFrame?.()
    }
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

  /**
   * 创建调色板引用。
   *
   * **重要警告**：返回的 IPaletteReference.hardwarePalette 当前是空操作占位对象。
   * 所有方法（addPalette、setColorShift 等）均为静默空操作，
   * 直到 HardwarePalette 模块迁移完成并注入真实实现。
   * 调用方不应依赖 hardwarePalette 的行为产生任何副作用。
   */
  private createPaletteReference(name: string): IPaletteReference {
    const index = this.paletteRefs.size
    return {
      name,
      index,
      palette: { name, index, colors: new Uint8Array(256 * 4), allowModifiers: false },
      // HACK: hardwarePalette 占位对象 — HardwarePalette 迁移后替换为真实实例
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
  /**
   * 生成普通渲染对象列表（替代 OpenRA GenerateRenderables）。
   *
   * 收集屏幕上所有 Actor、世界 Actor、玩家 Actor、指令生成器、
   * 特效的 IRenderable，按 Y-sort 稳定排序后转换为 IFinalizedRenderable。
   */
  generateRenderables(): void {
    if (this.world.worldActor.disposed) return

    const buffer: IRenderable[] = []

    // 1. 屏幕上的 Actor 渲染对象
    for (const actor of this.onScreenActors) {
      buffer.push(...actor.render(this))
    }

    // 2. 世界 Actor 的渲染对象
    buffer.push(...this.world.worldActor.render(this))

    // 3. 渲染玩家的 PlayerActor 渲染对象
    if (this.world.renderPlayer) {
      buffer.push(...this.world.renderPlayer.playerActor.render(this))
    }

    // 4. 指令生成器的渲染对象（放置预览、拖拽框等）
    if (this.world.orderGenerator) {
      buffer.push(...this.world.orderGenerator.render(this, this.world))
    }

    // 5. 未分区特效
    for (const effect of this.world.unpartitionedEffects) {
      buffer.push(...effect.render(this))
    }

    // 6. 屏幕范围内的已分区特效
    for (const effect of this.world.screenMap.renderableEffectsInBox(
      this.viewport.topLeft,
      this.viewport.bottomRight,
    )) {
      buffer.push(...effect.render(this))
    }

    // 稳定排序（使用稳定的排序算法避免闪烁伪影）
    // 创建 (sortKey, index, renderable) 三元组，按 sortKey 排序，相同 key 保序
    //
    // 性能说明：OpenRA 原始代码通过复用 renderablesBuffer 和
    // renderablesKeysBuffer 数组避免分配（PERF 注释标注）。
    // 迁移版使用 .map() 创建 indexed 数组会在每帧触发 GC。
    // 后续可优化为在 WorldRenderer 级别维护可复用缓冲区。
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
   * 原始代码从 4 个来源收集：
   *   1. IRenderAboveShroud trait 的 Actor
   *   2. 选中 Actor 的 IRenderAboveShroudWhenSelected trait
   *   3. IEffectAboveShroud 特效
   *   4. OrderGenerator.RenderAboveShroud()
   *
   * TODO: trait 系统（IRenderAboveShroud, IRenderAboveShroudWhenSelected,
   *       IEffectAboveShroud）迁移后实现完整收集逻辑。
   */
  generateOverlayRenderables(): void {
    // 1. IRenderAboveShroud actors
    this.world.applyToActorsWithTrait?.<{
      spatiallyPartitionable?: boolean
      renderAboveShroud(actor: IActor, wr: WorldRenderer): IRenderable[]
    }>((actor, trait) => {
      if (!actor.isInWorld || actor.disposed) return
      if (trait.spatiallyPartitionable && !this.onScreenActors.has(actor)) return

      for (const r of trait.renderAboveShroud(actor, this)) {
        this.preparedOverlayRenderables.push(r.prepareRender(this))
      }
    })

    // 2. 选中 Actor 的 IRenderAboveShroudWhenSelected
    for (const a of this.world.selection.actors) {
      if (!a.isInWorld || a.disposed) continue
      // TODO: a.traitsImplementing<IRenderAboveShroudWhenSelected>()
      //   → trait.RenderAboveShroud(a, this)
    }

    // 3. IEffectAboveShroud 特效
    // TODO: foreach (e in World.Effects) if (e is IEffectAboveShroud ea)
    //   → ea.RenderAboveShroud(this)
    void this.world.effects // 占位，trait 系统迁移后替换

    // 4. OrderGenerator.RenderAboveShroud
    if (this.world.orderGenerator) {
      for (const r of this.world.orderGenerator.renderAboveShroud(this, this.world)) {
        this.preparedOverlayRenderables.push(r.prepareRender(this))
      }
    }
  }

  /**
   * 生成注释渲染对象（替代 OpenRA GenerateAnnotationRenderables）。
   *
   * 原始代码从 4 个来源收集：
   *   1. IRenderAnnotations trait 的 Actor
   *   2. 选中 Actor 的 IRenderAnnotationsWhenSelected trait
   *   3. IEffectAnnotation 特效
   *   4. OrderGenerator.RenderAnnotations()
   *
   * TODO: trait 系统（IRenderAnnotations, IRenderAnnotationsWhenSelected,
   *       IEffectAnnotation）迁移后实现完整收集逻辑。
   */
  generateAnnotationRenderables(): void {
    // 1. IRenderAnnotations actors
    this.world.applyToActorsWithTrait?.<{
      spatiallyPartitionable?: boolean
      renderAnnotations(actor: IActor, wr: WorldRenderer): IRenderable[]
    }>((actor, trait) => {
      if (!actor.isInWorld || actor.disposed) return
      if (trait.spatiallyPartitionable && !this.onScreenActors.has(actor)) return

      for (const r of trait.renderAnnotations(actor, this)) {
        this.preparedAnnotationRenderables.push(r.prepareRender(this))
      }
    })

    // 2. 选中 Actor 的 IRenderAnnotationsWhenSelected
    for (const a of this.world.selection.actors) {
      if (!a.isInWorld || a.disposed) continue
      // TODO: a.traitsImplementing<IRenderAnnotationsWhenSelected>()
      //   → trait.RenderAnnotations(a, this)
    }

    // 3. IEffectAnnotation 特效
    // TODO: foreach (e in World.Effects) if (e is IEffectAnnotation ea)
    //   → ea.RenderAnnotation(this)
    void this.world.effects // 占位，trait 系统迁移后替换

    // 4. OrderGenerator.RenderAnnotations
    if (this.world.orderGenerator) {
      for (const r of this.world.orderGenerator.renderAnnotations(this, this.world)) {
        this.preparedAnnotationRenderables.push(r.prepareRender(this))
      }
    }
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
   * 原始 OpenRA Draw() 有 17 步渲染序列。在 Babylon.js 架构下，
   * GPU 端渲染由 scene.render() 自动处理，以下方法编排渲染阶段：
   *
   *   debugVis?.UpdateDepthBuffer → EnableScissor → EnableDepthBuffer →
   *   terrainRenderer.RenderTerrain → Flush →
   *   遍历 preparedRenderables → ClearDepthBuffer →
   *   AfterActors 后处理 → IRenderAboveWorld actors → ClearDepthBuffer →
   *   AfterWorld 后处理 → IRenderShroud actors → DisableDepthBuffer →
   *   DisableScissor → 遍历 preparedOverlayRenderables →
   *   AfterShroud 后处理 → Flush
   *
   * Babylon.js 等价映射：
   *   - 地形 (renderingGroupId=0) → scene.render() 自动渲染
   *   - Actor (renderingGroupId=1) → scene.render() + Y-sort
   *   - 后处理 → DefaultRenderingPipeline + custom PostProcess
   *   - 覆盖层 (renderingGroupId=2) → scene.render()
   */
  draw(): void {
    if (this.world.worldActor.disposed) return

    // 阶段 1: 深度缓冲可视化更新
    this.debugVis?.updateDepthBuffer()

    // 阶段 2: 裁剪与深度设置
    const bounds = this.viewport.getScissorBounds(this.world.type !== WorldType.Editor)
    this.renderer.enableScissor(bounds)

    if (this.enableDepthBuffer) {
      this.renderer.enableDepthBuffer()
    }

    // 阶段 3: 地形渲染
    if (this.terrainRenderer) {
      this.terrainRenderer.renderTerrain(this, this.viewport)
    }
    this.renderer.flush()

    // 阶段 4: 普通渲染对象（Actor、特效）
    for (const r of this.preparedRenderables) {
      r.render(this)
    }

    if (this.enableDepthBuffer) {
      this.renderer.clearDepthBuffer()
    }

    // 阶段 5: AfterActors 后处理
    this.applyPostProcessing(PostProcessPassType.AfterActors)

    // 阶段 6: IRenderAboveWorld actors（渲染在世界之上的内容）
    this.world.applyToActorsWithTrait?.<{ renderAboveWorld(actor: IActor, wr: WorldRenderer): void }>(
      (actor, trait) => {
        if (actor.isInWorld && !actor.disposed) {
          trait.renderAboveWorld(actor, this)
        }
      },
    )

    if (this.enableDepthBuffer) {
      this.renderer.clearDepthBuffer()
    }

    // 阶段 7: AfterWorld 后处理
    this.applyPostProcessing(PostProcessPassType.AfterWorld)

    // 阶段 8: IRenderShroud（战争迷雾渲染）
    this.world.applyToActorsWithTrait?.<{ renderShroud(wr: WorldRenderer): void }>(
      (_actor, trait) => {
        trait.renderShroud(this)
      },
    )

    if (this.enableDepthBuffer) {
      this.renderer.disableDepthBuffer()
    }

    this.renderer.disableScissor()

    // 阶段 9: 覆盖层渲染（按类型分组以保持与 OpenRA 一致）
    const grouped = new Map<string, IFinalizedRenderable[]>()
    for (const r of this.preparedOverlayRenderables) {
      const key = r.constructor?.name ?? 'unknown'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(r)
    }
    for (const group of grouped.values()) {
      for (const r of group) {
        r.render(this)
      }
    }

    // 阶段 10: AfterShroud 后处理
    this.applyPostProcessing(PostProcessPassType.AfterShroud)

    this.renderer.flush()
  }

  /**
   * 绘制注释（替代 OpenRA DrawAnnotations）。
   *
   * 原始流程:
   *   EnableAntialiasingFilter → 渲染注释 → DisableAntialiasingFilter →
   *   (如果 debugVis.RenderGeometry) 渲染所有调试几何 →
   *   (如果 debugVis.ScreenMap) 绘制 ScreenMap 边界框 →
   *   AfterAnnotations 后处理 → Flush → 清空缓存
   */
  drawAnnotations(): void {
    // 阶段 1: 渲染注释（启用抗锯齿滤镜）
    this.renderer.enableAntialiasingFilter()
    for (const r of this.preparedAnnotationRenderables) {
      r.render(this)
    }
    this.renderer.disableAntialiasingFilter()

    // 阶段 2: 调试几何（当 debugVis.RenderGeometry 启用时）
    if (this.debugVis?.renderGeometry) {
      // 渲染所有类型的调试几何
      for (const r of this.preparedRenderables) {
        r.renderDebugGeometry(this)
      }
      for (const r of this.preparedOverlayRenderables) {
        r.renderDebugGeometry(this)
      }
      for (const r of this.preparedAnnotationRenderables) {
        r.renderDebugGeometry(this)
      }
    }

    // 阶段 3: ScreenMap 调试渲染（当 debugVis.ScreenMap 启用时）
    if (this.debugVis?.screenMap && this.world.screenMap.renderBounds) {
      // TODO: 绘制 ScreenMap 的 RenderBounds 和 MouseBounds
      // 需要 RgbaColorRenderer 模块迁移后才能实现彩色线段/多边形绘制
      //
      // foreach (var r in World.ScreenMap.RenderBounds(World.RenderPlayer))
      //   Game.Renderer.RgbaColorRenderer.DrawRect(tl, br, 1, Color.MediumSpringGreen)
      //
      // foreach (var b in World.ScreenMap.MouseBounds(World.RenderPlayer))
      //   Game.Renderer.RgbaColorRenderer.DrawPolygon(points, 1, Color.OrangeRed)
    }

    // 阶段 4: AfterAnnotations 后处理
    this.applyPostProcessing(PostProcessPassType.AfterAnnotations)

    this.renderer.flush()

    // 清空所有渲染对象缓存（释放引用）
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
