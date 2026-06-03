/**
 * HardwarePalette.ts — OpenRA 硬件调色板到 Babylon.js RawTexture 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/HardwarePalette.cs
 *
 * 核心范式转换:
 * - ITexture 延迟创建 (Game.Renderer.Context.CreateTexture) → RawTexture 延迟构造
 * - byte[] buffer → Uint8Array buffer（256×N RGBA 像素数据）
 * - float[] colorShiftBuffer → Float32Array colorShiftBuffer（2×N RGBA 浮点数据）
 * - SetData/SetFloatData → RawTexture.update() 直接上传
 * - NextPowerOf2 调色板高度 → NPOT 原生支持（WebGL 2.0）
 * - GL_NEAREST 采样 → NEAREST_SAMPLINGMODE（无 mipmap，调色板查找需精确采样）
 *
 * 纹理布局:
 *   调色板纹理: 256 像素宽 × Height 像素高，RGBA 8-bit/通道
 *   颜色偏移纹理: 2 像素宽 × Height 像素高，RGBA 32-bit 浮点/通道
 *
 *   每行格式（颜色偏移纹理）:
 *     Texel(0, row): [minHue, maxHue, 0, 0]
 *     Texel(1, row): [hueOffset, satOffset, valueMultiplier, 0]
 *
 *   Row 0: 保留给非索引 RGBA 精灵（无颜色偏移），始终为空。
 */

import { RawTexture } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

import { PALETTE_SIZE, ImmutablePalette, MutablePalette, asReadOnly } from './Palette'
import type { IPalette } from './Palette'
import { PaletteReference } from './PaletteReference'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 颜色偏移纹理每行浮点数。
 *
 * 每行 8 个 float（2 texel × 4 通道）:
 *   [0]: minHue, [1]: maxHue, [2]: 0, [3]: 0
 *   [4]: hueOffset, [5]: satOffset, [6]: valueMultiplier, [7]: 0
 */
const COLOR_SHIFT_STRIDE = 8

/** 颜色偏移纹理宽度（texel） */
const COLOR_SHIFT_WIDTH = 2

// ---------------------------------------------------------------------------
// IPaletteModifier 接口
//
// 对应 OpenRA IPaletteModifier（Trait 接口，定义于 Traits/World/PlayerPalette.cs）
//
// 用于在运行时修改调色板（如环境光照、闪烁效果等）。
// ---------------------------------------------------------------------------

/**
 * 调色板修改器接口。
 *
 * 对应 OpenRA IPaletteModifier 接口。
 * 在 HardwarePalette.ApplyModifiers() 期间调用，修改可变调色板。
 */
export interface IPaletteModifier {
  /**
   * 调整可变调色板。
   *
   * @param mutablePalettes — 可变调色板映射（名称 → MutablePalette）
   */
  adjustPalette(mutablePalettes: ReadonlyMap<string, MutablePalette>): void
}

// ---------------------------------------------------------------------------
// HardwarePalette 类
//
// 对应 OpenRA class HardwarePalette : IDisposable (HardwarePalette.cs:18-161)
//
// 管理两层 GPU 纹理：
//   1. 调色板纹理（Palette Texture）: 256×N RGBA 8-bit，用于着色器中的颜色查找
//   2. 颜色偏移纹理（ColorShifts Texture）: 2×N RGBA Float32，用于玩家颜色替换
// ---------------------------------------------------------------------------

export class HardwarePalette {
  // -----------------------------------------------------------------------
  // 公共属性（与 OpenRA 完全一致）
  // -----------------------------------------------------------------------

  /** 调色板纹理高度（行数）。Row 0 保留。 */
  height = 1

  /** 调色板纹理（256×N RGBA，NEAREST 采样，无 mipmap） */
  private _texture: RawTexture | null = null

  /** 颜色偏移纹理（2×N RGBA Float32，NEAREST 采样，无 mipmap） */
  private _colorShiftsTexture: RawTexture | null = null

  /**
   * 调色板纹理的 Scene 引用。
   *
   * 与 OpenRA 的关键差异:
   *   OpenRA 通过 Game.Renderer.Context 访问全局渲染上下文。
   *   迁移版需要显式的 Scene 引用以创建 Babylon.js 纹理。
   *   延迟设置以便测试和模块化。
   */
  private _scene: Scene | null = null

  // -----------------------------------------------------------------------
  // 内部状态
  // -----------------------------------------------------------------------

  /** 不可变调色板映射（名称 → ImmutablePalette） */
  private readonly _palettes = new Map<string, ImmutablePalette>()

  /** 可变调色板映射（名称 → MutablePalette，仅 allowModifiers 的调色板） */
  private readonly _mutablePalettes = new Map<string, MutablePalette>()

  /** 调色板名称 → 纹理行索引映射 */
  private readonly _indices = new Map<string, number>()

  /** 调色板纹理 CPU 缓冲区（256×Height RGBA 8-bit） */
  private _buffer: Uint8Array = new Uint8Array(0)

  /** 颜色偏移纹理 CPU 缓冲区（Height × 8 float32） */
  private _colorShiftBuffer: Float32Array = new Float32Array(0)

  /** 是否已释放 */
  private _disposed = false

  // -----------------------------------------------------------------------
  // 构造
  //
  // OpenRA 对照: HardwarePalette() 构造函数 (HardwarePalette.cs:30-34)
  //
  // OpenRA 在构造时立即通过 Game.Renderer.Context 创建纹理。
  // 迁移版延迟创建：仅在 getTexture() / getColorShiftsTexture() 调用或
  // Initialize() 调用时创建。原因：避免在 Scene 可用前创建 GPU 资源。
  // -----------------------------------------------------------------------

  /**
   * 构造 HardwarePalette。
   *
   * OpenRA 对照: public HardwarePalette()
   *
   * 纹理延迟创建；在使用前必须调用 initialize(scene) 或 setScene(scene)。
   */
  constructor() {
    // 初始时不创建纹理（延迟到 initialize() 调用）
  }

  // -----------------------------------------------------------------------
  // Scene 设置（迁移特有 — OpenRA 使用全局 Game.Renderer.Context）
  // -----------------------------------------------------------------------

  /**
   * 设置 Babylon.js Scene 引用。
   *
   * 必须在调用 getTexture() / getColorShiftsTexture() / initialize() 之前设置。
   * 迁移特有方法（OpenRA 无对应方法——使用全局 Game.Renderer.Context）。
   *
   * @param scene — Babylon.js Scene 实例
   */
  setScene(scene: Scene): void {
    this._scene = scene
  }

  // -----------------------------------------------------------------------
  // 纹理访问（与 OpenRA 一致）
  // -----------------------------------------------------------------------

  /**
   * 获取调色板纹理（256×N RGBA，NEAREST 采样）。
   *
   * OpenRA 对照: HardwarePalette.Texture (public ITexture Texture)
   *
   * 首次调用时延迟创建 RawTexture。
   *
   * @returns 调色板 RawTexture，若 Scene 未设置则返回 null
   */
  getTexture(): RawTexture | null {
    this._ensureTexture()
    return this._texture
  }

  /**
   * 获取颜色偏移纹理（2×N RGBA Float32，NEAREST 采样）。
   *
   * OpenRA 对照: HardwarePalette.ColorShifts (public ITexture ColorShifts)
   *
   * 首次调用时延迟创建 RawTexture。
   *
   * @returns 颜色偏移 RawTexture，若 Scene 未设置则返回 null
   */
  getColorShiftsTexture(): RawTexture | null {
    this._ensureTexture()
    return this._colorShiftsTexture
  }

  // -----------------------------------------------------------------------
  // 调色板管理
  // -----------------------------------------------------------------------

  /**
   * 查询调色板是否已注册。
   *
   * OpenRA 对照: HardwarePalette.Contains(string name)
   *
   * @param name — 调色板名称
   * @returns true 如果调色板存在
   */
  contains(name: string): boolean {
    return this._mutablePalettes.has(name) || this._palettes.has(name)
  }

  /**
   * 通过名称获取调色板。
   *
   * OpenRA 对照: HardwarePalette.GetPalette(string name)
   *
   * 优先返回可变调色板（作为只读包装），其次返回不可变调色板。
   *
   * @param name — 调色板名称
   * @returns IPalette 实例
   * @throws Error 如果调色板不存在
   */
  getPalette(name: string): IPalette {
    const mutable = this._mutablePalettes.get(name)
    if (mutable) return asReadOnly(mutable)
    const immutable = this._palettes.get(name)
    if (immutable) return immutable
    throw new Error(`Palette \`${name}\` does not exist`)
  }

  /**
   * 通过名称获取调色板的纹理行索引。
   *
   * OpenRA 对照: HardwarePalette.GetPaletteIndex(string name)
   *
   * @param name — 调色板名称
   * @returns 纹理行索引 (1-based, row 0 reserved)
   * @throws Error 如果调色板不存在
   */
  getPaletteIndex(name: string): number {
    const ret = this._indices.get(name)
    if (ret === undefined) {
      throw new Error(`Palette \`${name}\` does not exist`)
    }
    return ret
  }

  /**
   * 添加调色板到硬件调色板。
   *
   * OpenRA 对照: HardwarePalette.AddPalette(string name, ImmutablePalette p, bool allowModifiers)
   *
   * Row 0 保留给非索引 RGBA 精灵（无颜色偏移）。
   * 新调色板分配从 row 1 开始递增。
   *
   * 若 allowModifiers=true，创建对应的 MutablePalette 副本（初始值从 ImmutablePalette 复制）。
   * 若 allowModifiers=false，直接将调色板数据复制到 CPU 缓冲区。
   *
   * @param name — 调色板名称（必须唯一）
   * @param p — 不可变调色板数据
   * @param allowModifiers — 是否允许运行时修改
   * @returns PaletteReference 引用对象
   * @throws Error 如果名称已存在
   */
  addPalette(
    name: string,
    p: ImmutablePalette,
    allowModifiers: boolean,
  ): PaletteReference {
    if (this._palettes.has(name)) {
      throw new Error(`Palette \`${name}\` has already been defined`)
    }

    // 行 0 保留给非索引精灵；索引从 1 开始
    const index = this._palettes.size + 1
    this._indices.set(name, index)
    this._palettes.set(name, p)

    // 若需要扩容，扩展 CPU 缓冲区
    if (index >= this.height) {
      // NPOT 高度（WebGL 2.0 原生支持，不强制 2 的幂）
      this.height = index + 1

      // 扩展调色板缓冲区: height × 256 × 4 bytes
      const newBuffer = new Uint8Array(this.height * PALETTE_SIZE * 4)
      newBuffer.set(this._buffer)
      this._buffer = newBuffer

      // 扩展颜色偏移缓冲区: height × 8 floats
      const newShiftBuffer = new Float32Array(this.height * COLOR_SHIFT_STRIDE)
      newShiftBuffer.set(this._colorShiftBuffer)
      this._colorShiftBuffer = newShiftBuffer
    }

    if (allowModifiers) {
      this._mutablePalettes.set(name, new MutablePalette(p))
    } else {
      this._copyPaletteToBuffer(index, p)
    }

    return new PaletteReference(name, index, p, this)
  }

  /**
   * 替换已有调色板。
   *
   * OpenRA 对照: HardwarePalette.ReplacePalette(string name, IPalette p)
   *
   * 如果该调色板有可变副本（allowModifiers=true），则同时更新
   * 可变调色板并从不可变调色板复制到 CPU 缓冲区。
   * 如果只有不可变副本，直接复制到 CPU 缓冲区。
   *
   * 替换后自动上传到 GPU。
   *
   * @param name — 调色板名称
   * @param p — 新的调色板数据
   * @throws Error 如果调色板不存在
   */
  replacePalette(name: string, p: IPalette): void {
    const idx = this._indices.get(name)
    if (idx === undefined) {
      throw new Error(`Palette \`${name}\` does not exist`)
    }

    if (this._mutablePalettes.has(name)) {
      const newImmutable = ImmutablePalette.fromPalette(p)
      this._palettes.set(name, newImmutable)
      const newMutable = new MutablePalette(p)
      this._mutablePalettes.set(name, newMutable)
      this._copyPaletteToBuffer(idx, newMutable)
    } else if (this._palettes.has(name)) {
      const newImmutable = ImmutablePalette.fromPalette(p)
      this._palettes.set(name, newImmutable)
      this._copyPaletteToBuffer(idx, newImmutable)
    }

    this._copyBufferToTexture()
  }

  // -----------------------------------------------------------------------
  // 颜色偏移管理（对应 OpenRA HardwarePalette.SetColorShift / HasColorShift）
  // -----------------------------------------------------------------------

  /**
   * 设置调色板的颜色偏移参数。
   *
   * OpenRA 对照: HardwarePalette.SetColorShift(string name, float hueOffset, float satOffset, float valueMultiplier, float minHue, float maxHue)
   *
   * 颜色偏移用于玩家颜色替换：在 HSV 色彩空间中，
   * 将 [minHue, maxHue] 范围内的颜色偏移 (hueOffset, satOffset, valueMultiplier)。
   *
   * @param name — 调色板名称
   * @param hueOffset — 色调偏移
   * @param satOffset — 饱和度偏移
   * @param valueMultiplier — 亮度乘数
   * @param minHue — 色调范围最小值
   * @param maxHue — 色调范围最大值
   */
  setColorShift(
    name: string,
    hueOffset: number,
    satOffset: number,
    valueMultiplier: number,
    minHue: number,
    maxHue: number,
  ): void {
    const index = this.getPaletteIndex(name)
    const offset = 8 * index
    // Texel(0, row): [minHue, maxHue, 0, 0]
    this._colorShiftBuffer[offset] = minHue
    this._colorShiftBuffer[offset + 1] = maxHue
    this._colorShiftBuffer[offset + 2] = 0
    this._colorShiftBuffer[offset + 3] = 0
    // Texel(1, row): [hueOffset, satOffset, valueMultiplier, 0]
    this._colorShiftBuffer[offset + 4] = hueOffset
    this._colorShiftBuffer[offset + 5] = satOffset
    this._colorShiftBuffer[offset + 6] = valueMultiplier
    this._colorShiftBuffer[offset + 7] = 0
  }

  /**
   * 查询调色板是否有颜色偏移。
   *
   * OpenRA 对照: HardwarePalette.HasColorShift(string name)
   *
   * 检查颜色偏移纹理中对应行的 minHue 或 maxHue 是否为非零。
   *
   * @param name — 调色板名称
   * @returns true 如果存在颜色偏移
   */
  hasColorShift(name: string): boolean {
    const index = this.getPaletteIndex(name)
    const offset = 8 * index
    return this._colorShiftBuffer[offset] !== 0
      || this._colorShiftBuffer[offset + 1] !== 0
  }

  // -----------------------------------------------------------------------
  // 初始化与 GPU 上传
  //
  // 对应 OpenRA HardwarePalette.Initialize() / CopyBufferToTexture()
  // -----------------------------------------------------------------------

  /**
   * 初始化硬件调色板纹理并上传所有数据到 GPU。
   *
   * OpenRA 对照: HardwarePalette.Initialize()
   *
   * 操作步骤:
   *   1. 将所有可变调色板复制到 CPU 缓冲区
   *   2. 上传 CPU 缓冲区到 GPU 纹理
   *
   * 必须在所有调色板添加完毕后调用。
   */
  initialize(): void {
    this._copyModifiablePalettesToBuffer()
    this._copyBufferToTexture()
  }

  /**
   * 应用调色板修改器。
   *
   * OpenRA 对照: HardwarePalette.ApplyModifiers(IEnumerable<IPaletteModifier> paletteMods)
   *
   * 操作步骤:
   *   1. 对每个修改器调用 AdjustPalette（修改可变调色板）
   *   2. 将修改后的可变调色板复制到 CPU 缓冲区
   *   3. 上传 CPU 缓冲区到 GPU 纹理
   *   4. 重置可变调色板回原始值（准备下一次修改周期）
   *
   * @param paletteMods — 调色板修改器列表
   */
  applyModifiers(paletteMods: Iterable<IPaletteModifier>): void {
    // 步骤 1: 应用所有修改器
    for (const mod of paletteMods) {
      mod.adjustPalette(this._mutablePalettes)
    }

    // 步骤 2-3: 上传修改后的数据到 GPU
    this._copyModifiablePalettesToBuffer()
    this._copyBufferToTexture()

    // 步骤 4: 重置可变调色板回原始值
    for (const [key, mutable] of this._mutablePalettes) {
      const original = this._palettes.get(key)
      if (original) {
        mutable.setFromPalette(original)
      }
    }
  }

  // -----------------------------------------------------------------------
  // 资源释放（对应 OpenRA HardwarePalette.Dispose()）
  // -----------------------------------------------------------------------

  /**
   * 释放硬件调色板及其 GPU 资源。
   *
   * OpenRA 对照: HardwarePalette.Dispose()
   *
   * 释放调色板纹理和颜色偏移纹理。
   * 此方法是幂等的。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._texture) {
      this._texture.dispose()
      this._texture = null
    }
    if (this._colorShiftsTexture) {
      this._colorShiftsTexture.dispose()
      this._colorShiftsTexture = null
    }

    this._palettes.clear()
    this._mutablePalettes.clear()
    this._indices.clear()
    this._buffer = new Uint8Array(0)
    this._colorShiftBuffer = new Float32Array(0)
  }

  // -----------------------------------------------------------------------
  // 私有方法（与 OpenRA 私有方法对应）
  // -----------------------------------------------------------------------

  /**
   * 将 IPalette 数据复制到 CPU 缓冲区的指定行。
   *
   * OpenRA 对照: HardwarePalette.CopyPaletteToBuffer(int index, IPalette p)
   *
   * @param index — 纹理行索引
   * @param p — 调色板数据
   */
  private _copyPaletteToBuffer(index: number, p: IPalette): void {
    // 创建 Uint32Array 视图以便于批量复制
    const buffer32 = new Uint32Array(
      this._buffer.buffer,
      this._buffer.byteOffset,
      this._buffer.byteLength / 4,
    )
    const destOffset = index * PALETTE_SIZE
    p.copyToArray(buffer32, destOffset)
  }

  /**
   * 将所有可变调色板复制到 CPU 缓冲区。
   *
   * OpenRA 对照: HardwarePalette.CopyModifiablePalettesToBuffer()
   */
  private _copyModifiablePalettesToBuffer(): void {
    for (const [key, mutable] of this._mutablePalettes) {
      const index = this._indices.get(key)
      if (index !== undefined) {
        this._copyPaletteToBuffer(index, mutable)
      }
    }
  }

  /**
   * 将 CPU 缓冲区上传到 GPU 纹理。
   *
   * OpenRA 对照: HardwarePalette.CopyBufferToTexture()
   *
   * 上传两个纹理：
   *   1. 调色板纹理 (256×Height RGBA 8-bit) — RawTexture.update()
   *   2. 颜色偏移纹理 (2×Height RGBA Float32) — RawTexture.update()
   *
   * 若缓冲区为空（高度=1 且无数据），延迟上传直到有数据。
   */
  private _copyBufferToTexture(): void {
    this._ensureTexture()

    if (this._texture && this._buffer.length > 0) {
      this._texture.update(this._buffer)
    }

    if (this._colorShiftsTexture && this._colorShiftBuffer.length > 0) {
      this._colorShiftsTexture.update(this._colorShiftBuffer)
    }

  }

  /**
   * 确保 GPU 纹理已创建（延迟构造）。
   *
   * 仅在 Scene 可用时才创建纹理。
   * 若尚未设置 Scene，静默跳过（将在 initialize() 时创建）。
   */
  private _ensureTexture(): void {
    if (!this._scene) return

    if (!this._texture) {
      // 创建调色板纹理（256×Height RGBA 8-bit，NEAREST 采样，无 mipmap）
      // 对应 OpenRA: Texture = Game.Renderer.Context.CreateTexture()
      //              Texture.SetData(buffer, Palette.Size, Height)
      //
      // 使用 CreateRGBATexture 工厂方法（匹配 Sheet.ts 的模式）
      const initData = this._buffer.length > 0
        ? this._buffer
        : new Uint8Array(PALETTE_SIZE * this.height * 4)

      this._texture = RawTexture.CreateRGBATexture(
        initData,
        PALETTE_SIZE,   // width = 256
        this.height,
        this._scene,
        false,  // no mipmap (NEAREST sampling for palette lookup)
        false,  // invertY
        // NOTE: RawTexture.CreateRGBATexture 第 8 个参数为 samplingMode
        // 使用 NEAREST 确保调色板查找精确（无插值）
      )

      // 设置像素艺术缩放（NEAREST + NEAREST_MIPLINEAR 的组合）
      // 确保调色板纹理在所有缩放级别下都是最近邻采样
      this._texture.updateSamplingMode(1) // NEAREST_SAMPLINGMODE
    }

    if (!this._colorShiftsTexture) {
      // 创建颜色偏移纹理（2×Height RGBA Float32，NEAREST 采样）
      // 对应 OpenRA: ColorShifts = Game.Renderer.Context.CreateTexture()
      //              ColorShifts.SetFloatData(colorShiftBuffer, 2, Height)
      //
      // 使用 RawTexture 构造器（Float32 纹理必须用构造器，CreateRGBATexture 仅支持 Uint8）
      const initFloatData = this._colorShiftBuffer.length > 0
        ? this._colorShiftBuffer
        : new Float32Array(COLOR_SHIFT_WIDTH * this.height * 4)

      this._colorShiftsTexture = new RawTexture(
        initFloatData,
        COLOR_SHIFT_WIDTH,    // width = 2
        this.height,
        5,  // Engine.TEXTUREFORMAT_RGBA = 5
        this._scene,
        false,  // no mipmap
        false,  // invertY
        1,  // TEXTURE_NEAREST_SAMPLINGMODE
        1,  // Engine.TEXTURETYPE_FLOAT = 1
      )
    }
  }
}
