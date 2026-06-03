/**
 * PlatformInterfaces.ts — OpenRA 平台抽象接口到 TypeScript 的迁移
 * OpenRA 对照: OpenRA.Game/Graphics/PlatformInterfaces.cs
 *
 * 核心范式转换:
 * - C# 接口 (interface) → TypeScript 接口 (interface)
 * - GLProfile 枚举保留（Babylon.js Engine 内部映射 WebGL 2.0）
 * - IShader → 由 ShaderMaterial 包装实现（不再手动 GL 程序管理）
 * - IGraphicsContext → BABYLON.Engine 内部管理
 * - IFrameBuffer → BABYLON.RenderTargetTexture
 * - IVertexBuffer<T> → BABYLON.VertexBuffer
 * - ITexture → BABYLON.Texture / RawTexture
 */

// ---------------------------------------------------------------------------
// 基础类型（对应 OpenRA.Primitives）
// ---------------------------------------------------------------------------

/** 对应 OpenRA Size 结构 */
export interface Size {
  width: number
  height: number
}

/** 对应 OpenRA int2 结构 */
export interface Int2 {
  x: number
  y: number
}

/** 对应 OpenRA Rectangle 结构 */
export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

/** 对应 OpenRA Color 结构 (RGBA, 0-255 每通道) */
export interface Color {
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// GLProfile 枚举
// ---------------------------------------------------------------------------

export const GLProfile = {
  Automatic: 'Automatic',
  ANGLE: 'ANGLE',
  Modern: 'Modern',
  Embedded: 'Embedded',
} as const
export type GLProfile = (typeof GLProfile)[keyof typeof GLProfile]

// ---------------------------------------------------------------------------
// BlendMode 枚举（OpenRA 原生定义，包含 10 种混合模式）
//
// NOTE: SpriteRenderer.ts 中的 BlendMode 使用字符串值（'None', 'Alpha' 等），
// 此处的枚举使用数字值以匹配 OpenRA C# 的 byte 枚举语义。
// 两个模块应逐步统一到此定义。
// ---------------------------------------------------------------------------

export const BlendMode = {
  None: 0,
  Alpha: 1,
  Additive: 2,
  Subtractive: 3,
  Multiply: 4,
  Multiplicative: 5,
  DoubleMultiplicative: 6,
  LowAdditive: 7,
  Screen: 8,
  Translucent: 9,
} as const
export type BlendMode = (typeof BlendMode)[keyof typeof BlendMode]

// ---------------------------------------------------------------------------
// TextureScaleFilter 枚举
// ---------------------------------------------------------------------------

export const TextureScaleFilter = {
  Nearest: 'Nearest',
  Linear: 'Linear',
} as const
export type TextureScaleFilter =
  (typeof TextureScaleFilter)[keyof typeof TextureScaleFilter]

// ---------------------------------------------------------------------------
// PrimitiveType 枚举
// ---------------------------------------------------------------------------

export const PrimitiveType = {
  PointList: 'PointList',
  LineList: 'LineList',
  TriangleList: 'TriangleList',
} as const
export type PrimitiveType = (typeof PrimitiveType)[keyof typeof PrimitiveType]

// ---------------------------------------------------------------------------
// WindowMode 枚举
// ---------------------------------------------------------------------------

export const WindowMode = {
  Windowed: 'Windowed',
  Fullscreen: 'Fullscreen',
  PseudoFullscreen: 'PseudoFullscreen',
} as const
export type WindowMode = (typeof WindowMode)[keyof typeof WindowMode]

// ---------------------------------------------------------------------------
// ShaderVertexAttributeType 枚举
//
// 对应 OpenRA ShaderVertexAttributeType，值匹配 OpenGL 枚举：
// GL_FLOAT=0x1406, GL_INT=0x1404, GL_UNSIGNED_INT=0x1405
// ---------------------------------------------------------------------------

export const ShaderVertexAttributeType = {
  Float: 0x1406,
  Int: 0x1404,
  UInt: 0x1405,
} as const
export type ShaderVertexAttributeType =
  (typeof ShaderVertexAttributeType)[keyof typeof ShaderVertexAttributeType]

// ---------------------------------------------------------------------------
// ShaderVertexAttribute 接口
//
// 对应 OpenRA readonly record struct ShaderVertexAttribute
// ---------------------------------------------------------------------------

export interface ShaderVertexAttribute {
  readonly name: string
  readonly type: ShaderVertexAttributeType
  readonly components: number
  readonly offset: number
}

// ---------------------------------------------------------------------------
// IHardwareCursor 接口
// ---------------------------------------------------------------------------

export interface IHardwareCursor {
  dispose(): void
}

// ---------------------------------------------------------------------------
// IFont 与 FontGlyph
// ---------------------------------------------------------------------------

export interface FontGlyph {
  offset: Int2
  size: Size
  advance: number
  data: Uint8Array
}

export interface IFont {
  createGlyph(c: string, size: number, deviceScale: number): FontGlyph
  dispose(): void
}

// ---------------------------------------------------------------------------
// IShader 接口
//
// 对应 OpenRA IShader 接口 —— 8 个公开方法。
// 迁移方案：由 Shader.ts (ShaderMaterial 包装) 实现此接口。
//
// OpenRA 对照: IShader (PlatformInterfaces.cs:133-144)
// ---------------------------------------------------------------------------

export interface IShader {
  /**
   * 设置 bool 类型的 uniform 变量。
   * 对应 OpenRA IShader.SetBool(string name, bool value)。
   */
  setBool(name: string, value: boolean): void

  /**
   * 设置 float 类型的 uniform 变量（1 分量）。
   * 对应 OpenRA IShader.SetVec(string name, float x)。
   */
  setVec(name: string, x: number): void

  /**
   * 设置 vec2 类型的 uniform 变量（2 分量）。
   * 对应 OpenRA IShader.SetVec(string name, float x, float y)。
   */
  setVec(name: string, x: number, y: number): void

  /**
   * 设置 vec3 类型的 uniform 变量（3 分量）。
   * 对应 OpenRA IShader.SetVec(string name, float x, float y, float z)。
   */
  setVec(name: string, x: number, y: number, z: number): void

  /**
   * 设置向量类型的 uniform 变量（N 分量数组）。
   * 对应 OpenRA IShader.SetVec(string name, ReadOnlyMemory<float> vec, int length)。
   *
   * @param length — 分量数 (1, 2, 3, 或 4)
   */
  setVec(name: string, vec: Readonly<Float32Array>, length: number): void

  /**
   * 将纹理绑定到着色器的 sampler2D uniform。
   * 对应 OpenRA IShader.SetTexture(string param, ITexture texture)。
   */
  setTexture(param: string, texture: ITexture): void

  /**
   * 设置 4x4 矩阵 uniform。
   * 对应 OpenRA IShader.SetMatrix(string param, float[] mtx)。
   *
   * @param mtx — 长度必须为 16 的 Float32Array（列主序）
   */
  setMatrix(param: string, mtx: Readonly<Float32Array>): void

  /**
   * 准备渲染：激活着色器程序、绑定纹理、设置渲染状态。
   * 对应 OpenRA IShader.PrepareRender()。
   *
   * 在 Babylon.js 中，此方法在 Scene.render() 内部自动执行；
   * 迁移版本保留此 API 以兼容现有调用代码，实际委托给 ShaderMaterial 的内部机制。
   */
  prepareRender(): void

  /**
   * 绑定顶点属性指针（设置 vertex attribute layout）。
   * 对应 OpenRA IShader.Bind()。
   *
   * 在 Babylon.js 中，顶点属性绑定由 VertexBuffer + Mesh 自动管理；
   * 迁移版本保留此 API 以兼容现有调用代码。
   */
  bind(): void
}

// ---------------------------------------------------------------------------
// IShaderBindings 接口
//
// 对应 OpenRA IShaderBindings 接口。
// ---------------------------------------------------------------------------

export interface IShaderBindings {
  readonly vertexShaderName: string
  readonly vertexShaderCode: string
  readonly fragmentShaderName: string
  readonly fragmentShaderCode: string
  /** 顶点结构跨距（字节） */
  readonly stride: number
  /** 顶点属性布局数组 */
  readonly attributes: readonly ShaderVertexAttribute[]
}

// ---------------------------------------------------------------------------
// ITexture 接口
//
// 对应 OpenRA ITexture 接口。
// 迁移方案：由 Texture.ts (BABYLON.Texture / RawTexture 包装) 实现。
// ---------------------------------------------------------------------------

export interface ITexture {
  setData(colors: Uint8Array, width: number, height: number): void
  setFloatData(data: Float32Array, width: number, height: number): void
  setDataFromReadBuffer(rect: Rectangle): void
  getData(): Uint8Array
  readonly size: Size
  scaleFilter: TextureScaleFilter
  dispose(): void
}

// ---------------------------------------------------------------------------
// IFrameBuffer 接口
//
// 对应 OpenRA IFrameBuffer 接口。
// 迁移方案：由 FrameBuffer.ts (RenderTargetTexture 包装) 实现。
// ---------------------------------------------------------------------------

export interface IFrameBuffer {
  bind(): void
  unbind(): void
  enableScissor(rect: Rectangle): void
  disableScissor(): void
  readonly texture: ITexture
  dispose(): void
}

// ---------------------------------------------------------------------------
// IVertexBuffer<T> 接口
//
// 对应 OpenRA IVertexBuffer<T> 接口。
// 迁移方案：由 VertexBuffer.ts (BABYLON.VertexBuffer 包装) 实现。
// ---------------------------------------------------------------------------

export interface IVertexBuffer<T> {
  bind(): void
  setData(vertices: T[], length: number): void
  setData(vertices: T[], offset: number, start: number, length: number): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// IIndexBuffer 接口
//
// 对应 OpenRA IIndexBuffer 接口。
// 迁移方案：由 StaticIndexBuffer.ts (BABYLON.IndexBuffer 包装) 实现。
// ---------------------------------------------------------------------------

export interface IIndexBuffer {
  bind(): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// IGraphicsContext 接口
//
// 对应 OpenRA IGraphicsContext 接口。
// 迁移方案：BABYLON.Engine 内部管理，不公开暴露。
// 保留接口定义以保持目录结构一致性和文档作用。
// ---------------------------------------------------------------------------

export interface IGraphicsContext {
  createEmptyVertexBuffer<T>(size: number): IVertexBuffer<T>
  createVertexBuffer<T>(data: T[], dynamic?: boolean): IVertexBuffer<T>
  createVertices<T>(size: number): T[]
  createIndexBuffer(indices: Uint32Array): IIndexBuffer
  createTexture(): ITexture
  createFrameBuffer(s: Size): IFrameBuffer
  createFrameBuffer(s: Size, clearColor: Color): IFrameBuffer
  createShader(shaderBindings: IShaderBindings): IShader
  enableScissor(x: number, y: number, width: number, height: number): void
  disableScissor(): void
  present(): void
  drawPrimitives(
    pt: PrimitiveType, firstVertex: number, numVertices: number,
  ): void
  drawElements(numIndices: number, offset: number): void
  clear(): void
  enableDepthBuffer(): void
  disableDepthBuffer(): void
  clearDepthBuffer(): void
  setBlendMode(mode: BlendMode): void
  setVSyncEnabled(enabled: boolean): void
  readonly glVersion: string
  dispose(): void
}

// ---------------------------------------------------------------------------
// IRenderer 接口（引擎主渲染器接口）
// ---------------------------------------------------------------------------

export interface IRenderer {
  beginFrame(): void
  endFrame(): void
  setPalette(palette: unknown): void
}

// ---------------------------------------------------------------------------
// IPlatformWindow 与 IPlatform 接口（前向声明）
// ---------------------------------------------------------------------------

export interface IPlatformWindow {
  readonly context: IGraphicsContext
  readonly nativeWindowSize: Size
  readonly effectiveWindowSize: Size
  readonly nativeWindowScale: number
  readonly effectiveWindowScale: number
  readonly surfaceSize: Size
  readonly displayCount: number
  readonly currentDisplay: number
  readonly hasInputFocus: boolean
  readonly isSuspended: boolean
  readonly glProfile: GLProfile
  readonly supportedGLProfiles: readonly GLProfile[]

  onWindowScaleChanged?:
    (a: number, b: number, c: number, d: number) => void

  pumpInput(inputHandler: unknown): void
  getClipboardText(): string
  setClipboardText(text: string): boolean
  tryOpenUrl(url: string): boolean
  grabWindowMouseFocus(): void
  releaseWindowMouseFocus(): void
  createHardwareCursor(
    name: string, size: Size, data: Uint8Array,
    hotspot: Int2, pixelDouble: boolean,
  ): IHardwareCursor
  setHardwareCursor(cursor: IHardwareCursor): void
  setWindowTitle(title: string): void
  setRelativeMouseMode(mode: boolean): void
  setScaleModifier(scale: number): void
  dispose(): void
}

export interface IPlatform {
  createWindow(
    size: Size, windowMode: WindowMode, scaleModifier: number,
    vertexBatchSize: number, indexBatchSize: number,
    videoDisplay: number, profile: GLProfile,
  ): IPlatformWindow
  createSound(device: string): unknown
  createFont(data: Uint8Array): IFont
}
