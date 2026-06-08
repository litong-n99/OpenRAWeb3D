/**
 * SpriteRenderer.ts — OpenRA 精灵批量渲染器到 Babylon.js 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/SpriteRenderer.cs
 *
 * 核心范式转换:
 * - 手动顶点缓冲 + DrawQuadBatch → ThinInstances 批量矩阵更新
 * - 8 纹理单元 samplers → 按 Sheet 分组的 ThinInstances
 * - 手动 BlendMode GL 状态 → material.alphaMode
 * - CPU 端顶点生成 (FastCreateQuad) → GPU 端 ThinInstances 矩阵
 * - 正交投影 SetViewportParams → 委托给 OrthographicCamera
 */

import {
  Color3,
  Engine,
  MeshBuilder,
  Mesh,
  Quaternion,
  RawTexture,
  StandardMaterial,
  Texture,
  Matrix,
  Vector3,
  type Scene,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// BlendMode 枚举（与 OpenRA 完全一致）
// ---------------------------------------------------------------------------

export const BlendMode = {
  None: 'None',
  Alpha: 'Alpha',
  Additive: 'Additive',
  Subtractive: 'Subtractive',
  Multiply: 'Multiply',
  Multiplicative: 'Multiplicative',
  DoubleMultiplicative: 'DoubleMultiplicative',
  LowAdditive: 'LowAdditive',
  Screen: 'Screen',
  Translucent: 'Translucent',
} as const
export type BlendMode = (typeof BlendMode)[keyof typeof BlendMode]

/**
 * 将 OpenRA BlendMode 映射到 Babylon.js 的 alphaMode。
 * 不是所有 BlendMode 都有直接的 Babylon.js 等效项，
 * 对于复杂的混合模式（Subtractive/Multiply 等），需要自定义 ShaderMaterial。
 */
export function blendModeToAlphaMode(blend: BlendMode): number {
  switch (blend) {
    case BlendMode.None:
      return Engine.ALPHA_DISABLE
    case BlendMode.Alpha:
    case BlendMode.Translucent:
      return Engine.ALPHA_COMBINE
    case BlendMode.Additive:
    case BlendMode.LowAdditive:
      return Engine.ALPHA_ADD
    case BlendMode.Subtractive:
      return Engine.ALPHA_SUBTRACT
    case BlendMode.Multiply:
    case BlendMode.Multiplicative:
    case BlendMode.DoubleMultiplicative:
      return Engine.ALPHA_MULTIPLY
    case BlendMode.Screen:
      return Engine.ALPHA_SCREENMODE
    default:
      return Engine.ALPHA_COMBINE
  }
}

// ---------------------------------------------------------------------------
// TextureChannel 枚举（与 OpenRA 一致）
// ---------------------------------------------------------------------------

export const TextureChannel = {
  Red: 0,
  Green: 1,
  Blue: 2,
  Alpha: 3,
  RGBA: 4,
} as const
export type TextureChannel = (typeof TextureChannel)[keyof typeof TextureChannel]

// ---------------------------------------------------------------------------
// 坐标与尺寸类型
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Sheet 接口（Sheet 模块迁移前的类型占位）
// ---------------------------------------------------------------------------

export interface ISheet {
  /** 纹理尺寸（像素） */
  readonly size: Size
  /** Babylon.js GPU 纹理 */
  readonly texture: Texture
}

// ---------------------------------------------------------------------------
// Sprite 接口（与 OpenRA Sprite 一致）
// ---------------------------------------------------------------------------

export interface ISprite {
  /** 所属纹理图集 */
  readonly sheet: ISheet
  /** 在图集中的包围盒（像素坐标） */
  readonly bounds: Rect
  /** 混合模式 */
  readonly blendMode: BlendMode
  /** 纹理通道 */
  readonly channel: TextureChannel
  /** Z 渐变值（用于地形高度） */
  readonly zRamp: number
  /** 精灵偏移（相对于 Actor 位置） */
  readonly offset: Vec3
  /** 精灵尺寸 */
  readonly size: Vec3
  /** 归一化纹理坐标 */
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

// ---------------------------------------------------------------------------
// 调色板接口（HardwarePalette 迁移前的类型占位）
// ---------------------------------------------------------------------------

export interface IPaletteTexture {
  /** 调色板 GPU 纹理 */
  readonly texture: RawTexture
  /** 调色板行数 */
  readonly height: number
}

// ---------------------------------------------------------------------------
// 精灵实例数据（单次 DrawSprite 调用的累积数据）
// ---------------------------------------------------------------------------

interface SpriteInstance {
  /** 世界坐标 */
  location: Vec3
  /** 精灵引用 */
  sprite: ISprite
  /** 缩放因子（三维非均匀缩放，对应 OpenRA float3 scale） */
  scale: Vec3
  /** 旋转（弧度） */
  rotation: number
  /** 色调 */
  tint: Vec3
  /** 透明度 */
  alpha: number
  /** 调色板纹理行索引 */
  paletteIndex: number
  /** 4 角点模式（非 null 时使用自定义顶点位置） */
  corners?: [Vec3, Vec3, Vec3, Vec3]
}

// ---------------------------------------------------------------------------
// 批量渲染后端接口（用于测试注入）
// ---------------------------------------------------------------------------

export interface ISpriteRenderBackend {
  /** 创建或获取一个 Sheet 对应的渲染组 */
  getOrCreateGroup(sheet: ISheet, scene: Scene): ISpriteRenderGroup
  /** 销毁所有 GPU 资源 */
  dispose(): void
}

export interface ISpriteRenderGroup {
  /** 设置实例数据（矩阵 + UV + 色调） */
  setInstances(instances: SpriteInstance[]): void
  /** 设置混合模式 */
  setBlendMode(blend: BlendMode): void
  /** 设置调色板纹理 */
  setPalette(palette: IPaletteTexture | null): void
  /** 是否启用像素艺术缩放 */
  setPixelArtScaling(enabled: boolean): void
  /** 获取底层 Babylon.js Mesh（用于注册到 Scene 等） */
  getMesh?(): Mesh
  /** 销毁 GPU 资源 */
  dispose(): void
}

// ---------------------------------------------------------------------------
// 主类: SpriteRenderer
// ---------------------------------------------------------------------------

/**
 * SpriteRenderer 是渲染管线中最频繁调用的类，
 * 实现高性能的精灵批量渲染。
 *
 * 设计核心（与 OpenRA 一致）：
 *   - 延迟提交：精灵数据累积到缓冲区，仅在状态变化或显式 Flush 时提交 GPU
 *   - Sheet 分组：按纹理图集分组，每组对应一个 ThinInstances Mesh
 *   - 混合模式切换：BlendMode 变化时自动 Flush
 *
 * 迁移说明：
 *   - 原始支持最多 8 个 Sheet 同时绑定（多纹理采样器）
 *   - 迁移版使用 ThinInstances：每个 Sheet 一组，通过 buffer 批量更新矩阵
 *   - 多 Sheet 场景通过分组实现（而非单个 DrawCall 中的多纹理）
 */
// IBatchRenderer 接口引用（来自 Renderer）
export interface IBatchRenderer {
  flush(): void
}

export class SpriteRenderer implements IBatchRenderer {
  /** 每个批次的最大精灵数（ThinInstances 限制） */
  static readonly MAX_SPRITES_PER_BATCH = 1024
  /** 最大同时绑定的 Sheet 数量（迁移版按 Sheet 分组，原始为 8） */
  static readonly SHEET_COUNT = 8

  // -----------------------------------------------------------------------
  // 公共属性
  // -----------------------------------------------------------------------

  /** 当前混合模式 */
  currentBlend: BlendMode = BlendMode.Alpha

  /** 关联的 Babylon.js Scene */
  readonly scene: Scene

  /** 关联的 Renderer（用于注册 CurrentBatchRenderer） */
  private renderer: { batchRenderer: IBatchRenderer | null; flush: () => void } | null

  // -----------------------------------------------------------------------
  // 内部状态
  // -----------------------------------------------------------------------

  /** 当前批次的精灵实例缓存 */
  private instances: SpriteInstance[] = []

  /** 当前批次中的 Sheet 集合（用于检测 Sheet 变化） */
  private currentSheet: ISheet | null = null

  /** 渲染后端（可注入用于测试） */
  private readonly backend: ISpriteRenderBackend

  /** 渲染组缓存（按 Sheet 分组） */
  private groups: Map<ISheet, ISpriteRenderGroup> = new Map()

  /** 调色板纹理 */
  private palette: IPaletteTexture | null = null

  /** 像素艺术缩放标志 */
  private pixelArtScaling = true

  /** 视口参数缓存 */
  private viewportParams: {
    size: Size
    downscale: number
    depthMargin: number
    scroll: Vec2
  } | null = null

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  /**
   * @param scene Babylon.js Scene
   * @param renderer Renderer 引用（用于注册 IBatchRenderer）
   * @param backend 渲染后端（可注入用于测试）
   */
  constructor(
    scene: Scene,
    renderer?: { batchRenderer: IBatchRenderer | null; flush: () => void } | null,
    backend?: ISpriteRenderBackend,
  ) {
    this.scene = scene
    this.renderer = renderer ?? null
    this.backend = backend ?? new ThinInstancesBackend()
  }

  // -----------------------------------------------------------------------
  // 静态工具方法
  // -----------------------------------------------------------------------

  /**
   * 解析精灵的调色板纹理索引（替代 OpenRA ResolveTextureIndex）。
   *
   * 优化：RGBA 精灵不需要调色板查找时跳过索引，
   * 减少不必要的纹理绑定。
   *
   * @returns 调色板纹理行索引，不需要时返回 0
   */
  static resolveTextureIndex(
    sprite: ISprite,
    paletteIndex: number,
    hasColorShift: boolean,
  ): number {
    if (paletteIndex <= 0) return 0
    if (sprite.channel === TextureChannel.RGBA && !hasColorShift) return 0
    return paletteIndex
  }

  // -----------------------------------------------------------------------
  // IBatchRenderer 接口
  // -----------------------------------------------------------------------

  /** 强制提交当前批次（替代 OpenRA Flush） */
  flush(): void {
    if (this.instances.length === 0) return

    const groups = new Map<ISheet, SpriteInstance[]>()
    for (const inst of this.instances) {
      const list = groups.get(inst.sprite.sheet)
      if (!list) groups.set(inst.sprite.sheet, [inst])
      else list.push(inst)
    }

    for (const [sheet, sheetInstances] of groups) {
      const group = this.getGroup(sheet)
      group.setBlendMode(this.currentBlend)
      if (this.palette) {
        group.setPalette(this.palette)
      }
      group.setPixelArtScaling(this.pixelArtScaling)
      group.setInstances(sheetInstances)
    }

    this.instances.length = 0
    this.currentSheet = null
  }

  // -----------------------------------------------------------------------
  // 渲染状态管理
  // -----------------------------------------------------------------------

  /**
   * 为精灵设置渲染状态（替代 OpenRA SetRenderStateForSprite）。
   * 检测混合模式/Sheet 变化，必要时自动 Flush。
   * 同时注册自身为 Renderer 的活跃 IBatchRenderer。
   */
  private setRenderStateForSprite(sprite: ISprite): void {
    // 注册为当前批量渲染器（对应 OpenRA renderer.CurrentBatchRenderer = this）
    if (this.renderer) {
      this.renderer.batchRenderer = this
    }

    // 混合模式变化 → Flush
    if (sprite.blendMode !== this.currentBlend) {
      this.flush()
      this.currentBlend = sprite.blendMode
    }

    // Sheet 变化 → Flush
    // 设计决策：原始 OpenRA 支持单个 draw call 中同时绑定最多 8 个 Sheet 纹理
    // （通过着色器的 8 个 sampler）。迁移版按 Sheet 分组 ThinInstances，
    // Sheet 变化时自动 Flush，会导致更多 draw call。
    // 在 WebGL 2.0 环境下（支持 16+ 纹理单元），未来可通过自定义 ShaderMaterial
    // 恢复多纹理绑定以减少 draw call。当前简化以优先保证正确性。
    if (this.currentSheet !== null && this.currentSheet !== sprite.sheet) {
      this.flush()
    }

    this.currentSheet = sprite.sheet
  }

  // -----------------------------------------------------------------------
  // DrawSprite 重载（与 OpenRA API 一致）
  // -----------------------------------------------------------------------

  /**
   * 绘制精灵（完整参数版，float3 scale 非均匀缩放）。
   * 对应 OpenRA DrawSprite(Sprite, int, float3, float3, float, float3, float)。
   *
   * @param sprite 精灵引用
   * @param paletteIndex 调色板纹理行索引
   * @param location 世界坐标
   * @param scale 三维非均匀缩放
   * @param rotation 旋转（弧度）
   * @param tint 色调 (R, G, B)
   * @param alpha 透明度 (0-1)
   */
  drawSprite(
    sprite: ISprite,
    paletteIndex: number,
    location: Vec3,
    scale: Vec3 | number = 1,
    rotation = 0,
    tint: Vec3 = { x: 1, y: 1, z: 1 },
    alpha = 1,
  ): void {
    this.setRenderStateForSprite(sprite)

    const scaleVec: Vec3 = typeof scale === 'number'
      ? { x: scale, y: scale, z: 1 }
      : { ...scale }

    this.instances.push({
      location: { ...location },
      sprite,
      scale: scaleVec,
      rotation,
      tint: { ...tint },
      alpha: Math.max(0, Math.min(1, alpha)),
      paletteIndex,
    })

    if (this.instances.length >= SpriteRenderer.MAX_SPRITES_PER_BATCH) {
      this.flush()
    }
  }

  /**
   * 绘制精灵（简化版——仅位置）。
   * 对应 OpenRA DrawSprite(Sprite, float3, float)。
   */
  drawSpriteSimple(sprite: ISprite, location: Vec3, scale = 1): void {
    this.drawSprite(sprite, 0, location, { x: scale, y: scale, z: 1 })
  }

  /**
   * 绘制精灵（带 PaletteReference 版）。
   * 对应 OpenRA DrawSprite(Sprite, PaletteReference, float3, float)。
   */
  drawSpriteWithPalette(
    sprite: ISprite,
    paletteIndex: number,
    location: Vec3,
    scale = 1,
  ): void {
    this.drawSprite(sprite, paletteIndex, location, { x: scale, y: scale, z: 1 })
  }

  /**
   * 4 角点精灵绘制（任意四边形、变形效果）。
   * 对应 OpenRA DrawSprite(Sprite, int, float3, float3, float3, float3, float3, float)。
   */
  drawSpriteCorners(
    sprite: ISprite,
    paletteIndex: number,
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    tint: Vec3 = { x: 1, y: 1, z: 1 },
    alpha = 1,
  ): void {
    this.setRenderStateForSprite(sprite)

    // 使用 4 角点的最小坐标作为 location，scale 为 1
    const minX = Math.min(a.x, b.x, c.x, d.x)
    const minY = Math.min(a.y, b.y, c.y, d.y)
    const minZ = Math.min(a.z, b.z, c.z, d.z)

    this.instances.push({
      location: { x: minX, y: minY, z: minZ },
      sprite,
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      tint: { ...tint },
      alpha: Math.max(0, Math.min(1, alpha)),
      paletteIndex,
      corners: [
        { x: a.x - minX, y: a.y - minY, z: a.z - minZ },
        { x: b.x - minX, y: b.y - minY, z: b.z - minZ },
        { x: c.x - minX, y: c.y - minY, z: c.z - minZ },
        { x: d.x - minX, y: d.y - minY, z: d.z - minZ },
      ],
    })

    if (this.instances.length >= SpriteRenderer.MAX_SPRITES_PER_BATCH) {
      this.flush()
    }
  }

  /**
   * 绘制纯色 RGBA 四边形（供 RgbaColorRenderer 使用）。
   * 对应 OpenRA DrawRGBAQuad(Vertex[], BlendMode)。
   */
  drawRGBAQuad(_vertices: unknown[], blendMode: BlendMode): void {
    // 注册为当前批量渲染器
    if (this.renderer) {
      this.renderer.batchRenderer = this
    }

    if (this.currentBlend !== blendMode || this.instances.length + 4 > SpriteRenderer.MAX_SPRITES_PER_BATCH) {
      this.flush()
    }
    this.currentBlend = blendMode

    // TODO: RGBA 四边形顶点追加到批量管线
    // 需要使用无纹理模式（paletteIndex 设为特殊值表示 RGBA 模式）
    // RgbaColorRenderer 模块迁移后实现完整顶点追加逻辑
  }

  /**
   * 绘制预构建的顶点缓冲（通用批量渲染入口）。
   * 对应 OpenRA DrawVertexBuffer(IVertexBuffer<Vertex>, IIndexBuffer, int, int, IEnumerable<Sheet>, BlendMode)。
   *
   * TODO: Vertex/IndexBuffer 模块迁移后实现完整逻辑。
   * 当前保留 API 兼容性存根。
   */
  drawVertexBuffer(
    _buffer: unknown,
    _indices: unknown,
    _start: number,
    _length: number,
    _sheets: ISheet[],
    blendMode: BlendMode,
  ): void {
    if (this.renderer) {
      this.renderer.batchRenderer = this
    }

    if (this.currentBlend !== blendMode) {
      this.flush()
    }
    this.currentBlend = blendMode

    // TODO: VertexBuffer + IndexBuffer 模块迁移后实现
    // renderer.DrawBatch(vertices, indices, start, length, sheets, blendMode)
  }

  // -----------------------------------------------------------------------
  // 调色板
  // -----------------------------------------------------------------------

  /**
   * 设置调色板纹理（替代 OpenRA SetPalette）。
   */
  setPalette(palette: IPaletteTexture | null): void {
    this.flush()
    this.palette = palette
  }

  // -----------------------------------------------------------------------
  // 视口参数（替代 OpenRA SetViewportParams）
  // -----------------------------------------------------------------------

  /**
   * 设置视口/投影参数（替代 OpenRA SetViewportParams）。
   *
   * 原始 OpenRA 实现正交投影变换：
   *   p1 = (2/(downscale*width), 2/(downscale*height), -2/(downscale*(height+depthMargin)))
   *   p2 = (-1, -1, 1)
   *
   * 在 Babylon.js 架构下，投影由 OrthographicCamera 内部管理，
   * 此方法保留 API 兼容性，存储参数供后续着色器使用。
   *
   * @param _size 纹理图集尺寸
   * @param _downscale 降采样因子
   * @param _depthMargin 深度边距
   * @param _scroll 视口滚动偏移
   */
  /**
   * 设置视口/投影参数（替代 OpenRA SetViewportParams）。
   *
   * 原始 OpenRA 计算正交投影参数并设置 shader uniform：
   *   shader.SetVec("DepthTextureScale", 128 * depth)
   *   shader.SetVec("Scroll", scroll.X, scroll.Y, ...)
   *   shader.SetVec("p1", width, height, -depth)
   *   shader.SetVec("p2", -1, -1, ...)
   *
   * 在 Babylon.js 架构下，正交投影由 OrthographicCamera 管理。
   * 此方法存储参数供后续 ShaderMaterial uniform 设置使用。
   * Shader 模块迁移后需在此处设置对应 uniform。
   */
  setViewportParams(
    size: Size,
    downscale: number,
    depthMargin: number,
    scroll: Vec2,
  ): void {
    this.viewportParams = {
      size: { ...size },
      downscale,
      depthMargin,
      scroll: { ...scroll },
    }
    // TODO: Shader 模块迁移后设置 uniform
    // if (shader) {
    //   shader.setVector3("p1", p1_x, p1_y, p1_z)
    //   shader.setVector3("p2", p2_x, p2_y, p2_z)
    //   shader.setVector2("Scroll", scroll.x, scroll.y)
    //   shader.setFloat("DepthTextureScale", 128 * depth)
    // }
  }

  /** 获取视口参数 */
  getViewportParams(): {
    size: Size; downscale: number; depthMargin: number; scroll: Vec2
  } | null {
    return this.viewportParams
  }

  // -----------------------------------------------------------------------
  // 像素艺术缩放（替代 OpenRA EnablePixelArtScaling）
  // -----------------------------------------------------------------------

  /**
   * 启用/禁用像素艺术缩放（替代 OpenRA EnablePixelArtScaling）。
   *
   * - true  → NEAREST 采样（锐利像素艺术）
   * - false → BILINEAR 采样（平滑）
   */
  enablePixelArtScaling(enabled: boolean): void {
    this.flush()
    this.pixelArtScaling = enabled
  }

  /** 获取像素艺术缩放状态 */
  getPixelArtScaling(): boolean {
    return this.pixelArtScaling
  }

  // -----------------------------------------------------------------------
  // 深度预览（替代 OpenRA SetDepthPreview）
  // -----------------------------------------------------------------------

  /**
   * 设置深度预览模式（替代 OpenRA SetDepthPreview）。
   * TODO: Shader 模块迁移后通过 uniform 控制
   */
  setDepthPreview(_enabled: boolean, _near: number, _far: number): void {
    this.flush()
    // TODO: 着色器迁移后通过 ShaderMaterial.setFloat/setVector3 控制
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 获取或创建 Sheet 对应的渲染组 */
  private getGroup(sheet: ISheet): ISpriteRenderGroup {
    let group = this.groups.get(sheet)
    if (!group) {
      group = this.backend.getOrCreateGroup(sheet, this.scene)
      this.groups.set(sheet, group)
    }
    return group
  }

  /** 当前批次精灵数量 */
  get batchSize(): number {
    return this.instances.length
  }

  /** 活跃的渲染组数量 */
  get groupCount(): number {
    return this.groups.size
  }

  // -----------------------------------------------------------------------
  // 资源释放
  // -----------------------------------------------------------------------

  dispose(): void {
    this.flush()
    for (const group of this.groups.values()) {
      group.dispose()
    }
    this.groups.clear()
    this.backend.dispose()
    this.instances.length = 0
  }
}

// ---------------------------------------------------------------------------
// ThinInstances 渲染后端实现
// ---------------------------------------------------------------------------

/**
 * 基于 Babylon.js ThinInstances 的渲染后端。
 *
 * 每个 Sheet 创建一个 Billboard Mesh + ShaderMaterial 组合，
 * 通过 thinInstanceSetBuffer 批量更新所有实例的变换矩阵。
 */
export class ThinInstancesBackend implements ISpriteRenderBackend {
  private groups: Map<ISpriteRenderGroup, Mesh> = new Map()

  getOrCreateGroup(sheet: ISheet, scene: Scene): ISpriteRenderGroup {
    const group = new ThinInstancesGroup(sheet, scene)
    // Mesh 引用用于 dispose（通过接口的 getMesh() 方法而非类型强转）
    const mesh = group.getMesh?.()
    if (mesh) this.groups.set(group, mesh)
    return group
  }

  dispose(): void {
    for (const mesh of this.groups.values()) {
      mesh.dispose()
    }
    this.groups.clear()
  }
}

/**
 * 单个 Sheet 的 ThinInstances 渲染组。
 *
 * 创建一个 Billboard Plane 作为基础 Mesh，
 * 所有精灵作为 ThinInstances 渲染。
 *
 * Billboard 模式:
 *   - BILLBOARDMODE_Y: 精灵仅在 Y 轴旋转面向相机（保持直立，RTS 推荐）
 *   - 通过 rotation.z 实现平面内旋转来模拟单位朝向
 */
class ThinInstancesGroup implements ISpriteRenderGroup {
  private readonly mesh: Mesh
  private readonly material: StandardMaterial
  private currentBlend: BlendMode = BlendMode.Alpha
  private disposed = false

  // 预分配缓冲区：复用 Float32Array 避免每帧 GC 分配
  // 仅在精灵数增长时扩容，常态下零分配
  private matrixBuffer: Float32Array = new Float32Array(0)
  private colorBuffer: Float32Array = new Float32Array(0)

  // 可复用的临时对象：ToRef 变体零分配
  private readonly _scaleV = new Vector3()
  private readonly _quat = new Quaternion()
  private readonly _transV = new Vector3()
  private readonly _worldMatrix = new Matrix()

  constructor(sheet: ISheet, scene: Scene) {
    // 创建基础地面 Mesh（XZ 水平面，直接面向俯视正交摄像机）
    // NOTE: 使用 CreateGround 替代 CreatePlane，因为 ThinInstances 不会
    // 继承 billboardMode。XZ 平面直接面向顶视角摄像机(0,50,0)。
    this.mesh = MeshBuilder.CreateGround(
      `spriteGroup_${sheet.size.width}x${sheet.size.height}`,
      { width: 1, height: 1 },
      scene,
    )

    // 创建材质
    this.material = new StandardMaterial(`spriteMat_${sheet.size.width}`, scene)
    this.material.diffuseTexture = sheet.texture
    // NOTE: Babylon.js 9.x 在 disableLighting=true 时仅输出 emissive 通道，
    // 必须同时设置 emissiveTexture + emissiveColor，否则所有精灵渲染为黑色。
    this.material.emissiveTexture = sheet.texture
    this.material.emissiveColor = new Color3(1, 1, 1)
    this.material.useAlphaFromDiffuseTexture = true
    this.material.backFaceCulling = false
    this.material.disableLighting = true
    this.material.alphaMode = Engine.ALPHA_COMBINE

    this.mesh.material = this.material

    // NOTE: ThinInstances 基础 mesh 仅 1×1 单位，但精灵分布在大区域中。
    // 设置 alwaysSelectAsActiveMesh 防止基础 mesh 原点离开视口时整批被裁剪。
    this.mesh.alwaysSelectAsActiveMesh = true
  }

  setInstances(instances: SpriteInstance[]): void {
    if (this.disposed || instances.length === 0) return

    // 按需扩容预分配缓冲区（常态下零分配）
    const matrixNeeded = instances.length * 16
    if (this.matrixBuffer.length < matrixNeeded) {
      this.matrixBuffer = new Float32Array(matrixNeeded)
    }
    const colorNeeded = instances.length * 4
    if (this.colorBuffer.length < colorNeeded) {
      this.colorBuffer = new Float32Array(colorNeeded)
    }

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]

      // 缩放（ToRef 变体：复用 _scaleV，零分配）
      this._scaleV.set(
        inst.sprite.size.x * inst.scale.x,
        inst.sprite.size.y * inst.scale.y,
        inst.scale.z,
      )

      // 旋转：Y 轴旋转用于地面 XZ 平面上的精灵旋转
      // NOTE: CreateGround 输出 XZ 平面，精灵旋转为绕 Y（上）轴
      Quaternion.RotationYawPitchRollToRef(inst.rotation, 0, 0, this._quat)

      // 平移（含 zRamp —— OpenRA 地形高度渐变）
      const scaledZRamp = inst.sprite.zRamp * inst.scale.y
      this._transV.set(
        inst.location.x + inst.sprite.offset.x * inst.scale.x,
        inst.location.y + inst.sprite.offset.y * inst.scale.y + scaledZRamp,
        inst.location.z + inst.sprite.offset.z * inst.scale.z,
      )

      // 组合世界矩阵：T * R * S（ToRef 变体，零分配）
      Matrix.ComposeToRef(this._scaleV, this._quat, this._transV, this._worldMatrix)
      this._worldMatrix.copyToArray(this.matrixBuffer, i * 16)

      // 实例颜色（色调 * 透明度）
      const cOff = i * 4
      this.colorBuffer[cOff] = inst.tint.x * inst.alpha
      this.colorBuffer[cOff + 1] = inst.tint.y * inst.alpha
      this.colorBuffer[cOff + 2] = inst.tint.z * inst.alpha
      this.colorBuffer[cOff + 3] = inst.alpha
    }

    // 批量设置 ThinInstances 数据（subarray 确保传递精确大小）
    this.mesh.thinInstanceSetBuffer('matrix', this.matrixBuffer.subarray(0, matrixNeeded), 16)
    this.mesh.thinInstanceSetBuffer('color', this.colorBuffer.subarray(0, colorNeeded), 4)

    // 刷新包围盒信息
    this.mesh.refreshBoundingInfo()
    this.mesh.isVisible = true
  }

  setBlendMode(blend: BlendMode): void {
    if (this.currentBlend === blend) return
    this.currentBlend = blend
    this.material.alphaMode = blendModeToAlphaMode(blend)
  }

  setPalette(palette: IPaletteTexture | null): void {
    // TODO: Shader 模块迁移后，使用 ShaderMaterial 并将 palette.texture
    // 作为第二个 sampler2D 绑定。当前 StandardMaterial 不支持自定义调色板查找。
    void palette
  }

  setPixelArtScaling(enabled: boolean): void {
    this.material.diffuseTexture?.updateSamplingMode(
      enabled ? Texture.NEAREST_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE,
    )
  }

  getMesh(): Mesh {
    return this.mesh
  }

  dispose(): void {
    this.disposed = true
    this.material.dispose()
    this.mesh.dispose()
  }
}
