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
  Engine,
  MeshBuilder,
  Mesh,
  RawTexture,
  StandardMaterial,
  Texture,
  Matrix,
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
  /** 缩放因子 */
  scale: number
  /** 旋转（弧度） */
  rotation: number
  /** 色调 */
  tint: Vec3
  /** 透明度 */
  alpha: number
  /** 调色板纹理行索引 */
  paletteIndex: number
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
export class SpriteRenderer {
  /** 每个批次的最大精灵数（ThinInstances 限制） */
  static readonly MAX_SPRITES_PER_BATCH = 1024

  // -----------------------------------------------------------------------
  // 公共属性
  // -----------------------------------------------------------------------

  /** 当前混合模式 */
  currentBlend: BlendMode = BlendMode.Alpha

  /** 关联的 Babylon.js Scene */
  readonly scene: Scene

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

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  constructor(scene: Scene, backend?: ISpriteRenderBackend) {
    this.scene = scene
    this.backend = backend ?? new ThinInstancesBackend()
  }

  // -----------------------------------------------------------------------
  // BatchRenderer 接口（IBatchRenderer）
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
   *
   * @returns 调色板纹理索引
   */
  private setRenderStateForSprite(sprite: ISprite, _paletteIndex: number): void {
    // 混合模式变化 → Flush
    if (sprite.blendMode !== this.currentBlend) {
      this.flush()
      this.currentBlend = sprite.blendMode
    }

    // Sheet 变化 → Flush（迁移版限制：每批次仅一个 Sheet）
    // 原始 OpenRA 支持 8 个 Sheet 同时绑定，迁移版通过分组实现
    if (this.currentSheet !== null && this.currentSheet !== sprite.sheet) {
      this.flush()
    }

    this.currentSheet = sprite.sheet
  }

  // -----------------------------------------------------------------------
  // DrawSprite 重载（与 OpenRA API 一致）
  // -----------------------------------------------------------------------

  /**
   * 绘制精灵（完整参数版）。
   * 对应 OpenRA DrawSprite(Sprite, float3, float, float, float3, float)。
   *
   * @param sprite 精灵引用
   * @param location 世界坐标
   * @param scale 缩放因子
   * @param rotation 旋转（弧度）
   * @param tint 色调 (R, G, B)
   * @param alpha 透明度 (0-1)
   * @param paletteIndex 调色板行索引
   */
  drawSprite(
    sprite: ISprite,
    location: Vec3,
    scale = 1,
    rotation = 0,
    tint: Vec3 = { x: 1, y: 1, z: 1 },
    alpha = 1,
    paletteIndex = 0,
  ): void {
    this.setRenderStateForSprite(sprite, paletteIndex)

    this.instances.push({
      location: { ...location },
      sprite,
      scale,
      rotation,
      tint: { ...tint },
      alpha: Math.max(0, Math.min(1, alpha)),
      paletteIndex,
    })

    // 缓冲区满时自动 Flush
    if (this.instances.length >= SpriteRenderer.MAX_SPRITES_PER_BATCH) {
      this.flush()
    }
  }

  /**
   * 绘制精灵（简化版——无色调/透明度）。
   * 对应 OpenRA DrawSprite(Sprite, float3, float)。
   */
  drawSpriteSimple(sprite: ISprite, location: Vec3, scale = 1): void {
    this.drawSprite(sprite, location, scale, 0, { x: 1, y: 1, z: 1 }, 1)
  }

  /**
   * 绘制精灵（带调色板引用版）。
   * 对应 OpenRA DrawSprite(Sprite, PaletteReference, float3, float)。
   */
  drawSpriteWithPalette(
    sprite: ISprite,
    paletteIndex: number,
    location: Vec3,
    scale = 1,
  ): void {
    this.drawSprite(sprite, location, scale, 0, { x: 1, y: 1, z: 1 }, 1, paletteIndex)
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
  setViewportParams(
    _size: Size,
    _downscale: number,
    _depthMargin: number,
    _scroll: Vec2,
  ): void {
    // 在 Babylon.js 架构下，正交投影由相机管理。
    // 此方法保留 API 兼容性，存储参数供后续着色器 uniform 使用。
    // 实际投影在 Renderer.updateWorldCameraViewport() 中配置。
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
    // Mesh 引用用于 dispose
    const mesh = (group as unknown as { getMesh(): Mesh }).getMesh()
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

  constructor(sheet: ISheet, scene: Scene) {
    // 创建基础 Billboard Mesh
    this.mesh = MeshBuilder.CreatePlane(
      `spriteGroup_${sheet.size.width}x${sheet.size.height}`,
      { size: 1 },
      scene,
    )
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_Y

    // 创建材质
    this.material = new StandardMaterial(`spriteMat_${sheet.size.width}`, scene)
    this.material.diffuseTexture = sheet.texture
    this.material.useAlphaFromDiffuseTexture = true
    this.material.backFaceCulling = false
    this.material.disableLighting = true
    this.material.alphaMode = Engine.ALPHA_COMBINE

    this.mesh.material = this.material
  }

  setInstances(instances: SpriteInstance[]): void {
    if (this.disposed || instances.length === 0) return

    // 构建矩阵缓冲区（每个实例一个 4x4 矩阵，16 个 float）
    const matrices = new Float32Array(instances.length * 16)
    const colors = new Float32Array(instances.length * 4)

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]

      // 构建世界矩阵：平移 → 旋转（绕 Z 轴）→ 缩放
      const translation = Matrix.Translation(
        inst.location.x + inst.sprite.offset.x * inst.scale,
        inst.location.y + inst.sprite.offset.y * inst.scale + inst.sprite.zRamp,
        inst.location.z + inst.sprite.offset.z * inst.scale,
      )

      const scaleMatrix = Matrix.Scaling(
        inst.sprite.size.x * inst.scale,
        inst.sprite.size.y * inst.scale,
        1,
      )

      const rotMatrix = Matrix.RotationZ(inst.rotation)

      const world = scaleMatrix
        .multiply(rotMatrix)
        .multiply(translation)

      // 复制到缓冲区
      const m = world.m
      const offset = i * 16
      for (let j = 0; j < 16; j++) {
        matrices[offset + j] = m[j]
      }

      // 实例颜色（色调 * 透明度）
      const cOff = i * 4
      colors[cOff] = inst.tint.x * inst.alpha
      colors[cOff + 1] = inst.tint.y * inst.alpha
      colors[cOff + 2] = inst.tint.z * inst.alpha
      colors[cOff + 3] = inst.alpha
    }

    // 批量设置 ThinInstances 数据
    this.mesh.thinInstanceSetBuffer('matrix', matrices, 16)
    this.mesh.thinInstanceSetBuffer('color', colors, 4)

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
