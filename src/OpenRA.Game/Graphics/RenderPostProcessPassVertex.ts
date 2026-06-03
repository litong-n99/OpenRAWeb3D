/**
 * RenderPostProcessPassVertex.ts — 后处理通道顶点格式定义
 * OpenRA 对照: OpenRA.Game/Graphics/RenderPostProcessPassVertex.cs
 *
 * 核心范式转换:
 * - C# readonly record struct → TypeScript interface (纯数据，无方法)
 * - OpenRA 手动全屏三角形顶点 → Babylon.js PostProcess 自动处理全屏四边形
 * - ShaderBindings 子类 → 着色器注册由 Effect.ShadersStore 管理
 *
 * 此文件定义后处理渲染中使用的顶点格式。
 * 在实际 Babylon.js 使用中，PostProcess 类自动生成全屏四边形，
 * 这些类型主要用于文档目的和自定义后处理着色器的顶点属性参考。
 */

// ---------------------------------------------------------------------------
// RenderPostProcessPassVertex — 无纹理后处理顶点
// 对应 OpenRA RenderPostProcessPassVertex(float X, float Y)
//
// 顶点属性:
//   aVertexPosition: vec2 (float, float) offset 0
// 跨距: 8 字节 (2 floats)
// ---------------------------------------------------------------------------

/**
 * 后处理全屏四边形顶点（无纹理坐标）。
 *
 * 对应 OpenRA `readonly record struct RenderPostProcessPassVertex(float X, float Y)`
 * 用于: chronoshift, flash, menufade, tint 等简单全屏效果。
 */
export interface RenderPostProcessPassVertex {
  /** 顶点 X 坐标（NDC 空间，通常 -1..1） */
  x: number
  /** 顶点 Y 坐标（NDC 空间，通常 -1..1） */
  y: number
}

export const RenderPostProcessPassVertexLayout = {
  /** 顶点跨距（字节）：2 个 float32 */
  stride: 8 as const,
  /** 顶点属性定义 */
  attributes: [
    {
      name: 'aVertexPosition',
      type: 0x1406, // ShaderVertexAttributeType.Float (GL_FLOAT)
      components: 2,
      offset: 0,
    },
  ] as const,
} as const

// ---------------------------------------------------------------------------
// RenderPostProcessPassTexturedVertex — 纹理化后处理顶点
// 对应 OpenRA RenderPostProcessPassTexturedVertex(float X, float Y, float S, float T)
//
// 顶点属性:
//   aVertexPosition: vec2 (float, float) offset 0
//   aVertexTexCoord:  vec2 (float, float) offset 8
// 跨距: 16 字节 (4 floats)
// ---------------------------------------------------------------------------

/**
 * 后处理全屏四边形顶点（带纹理坐标）。
 *
 * 对应 OpenRA `readonly record struct RenderPostProcessPassTexturedVertex(float X, float Y, float S, float T)`
 * 用于: sonic, vortex 等需要 UV 查找的纹理化后处理效果。
 */
export interface RenderPostProcessPassTexturedVertex {
  /** 顶点 X 坐标（NDC 空间） */
  x: number
  /** 顶点 Y 坐标（NDC 空间） */
  y: number
  /** 纹理 S 坐标 (U) */
  s: number
  /** 纹理 T 坐标 (V) */
  t: number
}

export const RenderPostProcessPassTexturedVertexLayout = {
  /** 顶点跨距（字节）：4 个 float32 */
  stride: 16 as const,
  /** 顶点属性定义 */
  attributes: [
    {
      name: 'aVertexPosition',
      type: 0x1406, // ShaderVertexAttributeType.Float (GL_FLOAT)
      components: 2,
      offset: 0,
    },
    {
      name: 'aVertexTexCoord',
      type: 0x1406, // ShaderVertexAttributeType.Float (GL_FLOAT)
      components: 2,
      offset: 8,
    },
  ] as const,
} as const

// ---------------------------------------------------------------------------
// ShaderBindings — 后处理着色器绑定描述
// 对应 OpenRA:
//   RenderPostProcessPassShaderBindings     → "postprocess" + "postprocess_NAME"
//   RenderPostProcessPassTexturedShaderBindings → "postprocess_textured" + "postprocess_textured_NAME"
//
// 在 Babylon.js 中，着色器名称用于 Effect.ShadersStore 注册。
// 例如:
//   Effect.ShadersStore["postprocess_chronoshiftVertexShader"] = postprocessVertSource
//   Effect.ShadersStore["postprocess_chronoshiftFragmentShader"] = chronoshiftFragSource
// ---------------------------------------------------------------------------

/**
 * 创建简单后处理着色器绑定描述。
 *
 * 对应 OpenRA `new RenderPostProcessPassShaderBindings(name)`
 *
 * @param name — 后处理效果名称（如 "chronoshift", "flash", "tint"）
 * @returns 着色器绑定信息
 */
export function createPostProcessShaderBindings(name: string) {
  return {
    vertexShaderName: 'postprocess',
    fragmentShaderName: `postprocess_${name}`,
    stride: RenderPostProcessPassVertexLayout.stride,
    attributes: RenderPostProcessPassVertexLayout.attributes,
  } as const
}

/**
 * 创建纹理化后处理着色器绑定描述。
 *
 * 对应 OpenRA `new RenderPostProcessPassTexturedShaderBindings(name)`
 *
 * @param name — 后处理效果名称（如 "sonic", "vortex"）
 * @returns 着色器绑定信息
 */
export function createPostProcessTexturedShaderBindings(name: string) {
  return {
    vertexShaderName: 'postprocess_textured',
    fragmentShaderName: `postprocess_textured_${name}`,
    stride: RenderPostProcessPassTexturedVertexLayout.stride,
    attributes: RenderPostProcessPassTexturedVertexLayout.attributes,
  } as const
}
