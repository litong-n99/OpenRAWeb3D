/**
 * SharpBilinearPostProcess.ts — 像素艺术锐利双线性缩放后处理
 * OpenRA 对照: OpenRA.Game/SpriteRenderer.cs — EnablePixelArtScaling / SharpBilinearShader
 *
 * 核心范式转换:
 * - OpenRA OpenGL 自定义 shader (GLSL 1.50) → Babylon.js PostProcess (GLSL ES 3.0)
 * - OpenRA 手动 world→screen compositor → PostProcess 自动管线集成
 * - C# shader uniform setter → TypeScript uniform proxy via onApply
 *
 * ## 算法说明
 *
 * Sharp Bilinear 结合了双线性采样与 unsharp mask 锐化:
 *   1. 以纹理自身分辨率双线性采样 (Babylon.js PostProcess 默认)
 *   2. 对相邻 4 像素做 box blur (平均)
 *   3. 应用 unsharp mask: output = center + sharpness * (center - blur)
 *
 * 效果:
 *   - sharpness = 0.0: 纯双线性 (平滑但模糊)
 *   - sharpness = 1.0: 最大锐化 (保留像素艺术边缘)
 *   - 推荐默认值 0.5: 平衡平滑与锐度
 *
 * ## 使用方式
 *
 * ```typescript
 * const sp = new SharpBilinearPostProcess(
 *   'sharpBilinear',
 *   scene,
 *   { width: 1920, height: 1080 },
 * )
 * sp.sharpness = 0.7
 * ```
 *
 * ## 视觉验收测试
 *
 * 此效果需要 GPU 上下文进行验证。应在 __e2e__/manual/ 下创建验收测试页面，
 * 对比 NEAREST / BILINEAR / SharpBilinear 三种采样模式在同一测试图案上的效果。
 */

import { PostProcess, Engine } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// GLSL ES 3.0 Fragment Shader
// ---------------------------------------------------------------------------

/**
 * Sharp Bilinear 片段着色器。
 *
 * 输入: 通过 PostProcess 的标准 textureSampler (sampler2D)。
 * 输出: 锐化后的像素颜色。
 *
 * Uniforms:
 *   texelSize  — vec2(1.0/width, 1.0/height)，用于邻域采样偏移
 *   sharpness  — float 0.0-1.0，控制锐化强度
 *
 * OpenRA 对照: glsl/world_downscale.vert + 内嵌 sharpen
 */
const SHARP_BILINEAR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

// Babylon.js PostProcess automatically provides:
//   in vec2 vUV — texture coordinates
//   uniform sampler2D textureSampler — input texture

uniform vec2 texelSize;
uniform float sharpness;

out vec4 fragColor;

void main(void) {
    // 双线性采样中心像素 (PostProcess 默认使用 BILINEAR 采样)
    vec4 center = texture(textureSampler, vUV);

    // 采样 4 个正交邻域像素 (用于 box blur)
    vec4 left   = texture(textureSampler, vUV + vec2(-texelSize.x, 0.0));
    vec4 right  = texture(textureSampler, vUV + vec2( texelSize.x, 0.0));
    vec4 top    = texture(textureSampler, vUV + vec2(0.0, -texelSize.y));
    vec4 bottom = texture(textureSampler, vUV + vec2(0.0,  texelSize.y));

    // Box blur: 4-邻域平均
    vec4 blur = (left + right + top + bottom) * 0.25;

    // Unsharp mask: sharpened = center + sharpness * (center - blur)
    // center - blur 提取高频细节 (边缘)
    // sharpness 控制细节增强量
    vec4 detail = center - blur;
    vec4 sharpened = center + sharpness * detail;

    // 钳位到有效范围，防止过曝/色偏
    fragColor = clamp(sharpened, 0.0, 1.0);
}
`

// ---------------------------------------------------------------------------
// SharpBilinearPostProcess
// ---------------------------------------------------------------------------

/**
 * 像素艺术锐利双线性缩放后处理。
 *
 * 在 world→screen 缩放阶段应用 sharp bilinear 滤镜，
 * 结合双线性平滑与 unsharp mask 锐化，保持像素艺术视觉风格。
 *
 * OpenRA 对照: SpriteRenderer 的 SharpBilinearShader + EnablePixelArtScaling()
 *
 * 生命周期:
 *   1. 构造时创建 Babylon.js PostProcess 并编译 GLSL shader
 *   2. 通过 sharpness getter/setter 调整锐化强度
 *   3. dispose() 清理 GPU 资源
 *
 * @example
 * ```typescript
 * const sp = new SharpBilinearPostProcess('sharp', scene, { width: 1024, height: 768 })
 * sp.sharpness = 0.5  // 中等锐化
 * ```
 */
export class SharpBilinearPostProcess {
  /** Babylon.js PostProcess 实例 */
  private readonly _postProcess: PostProcess

  /** 纹理尺寸 (用于计算 texelSize) */
  private readonly _textureSize: { width: number; height: number }

  /** 当前锐化强度 0.0 (无) - 1.0 (最大) */
  private _sharpness = 0.5

  /** 是否已销毁 */
  private _disposed = false

  // -------------------------------------------------------------------------
  // 构造函数
  // -------------------------------------------------------------------------

  /**
   * 创建 Sharp Bilinear 后处理实例。
   *
   * @param name — 后处理名称 (用于调试/日志)
   * @param sceneOrEngine — Babylon.js Scene 或 Engine 实例
   *   - 传入 Scene: PostProcess 挂载到该场景的渲染管线
   *   - 传入 Engine: 创建独立 PostProcess (手动管理)
   * @param textureSize — 输入纹理尺寸 (用于计算 texelSize uniform)
   * @param samplingMode — 采样模式，默认 BILINEAR
   */
  constructor(
    name: string,
    sceneOrEngine: import('@babylonjs/core').Scene | Engine,
    textureSize: { width: number; height: number },
    samplingMode?: number,
  ) {
    this._textureSize = { width: textureSize.width, height: textureSize.height }

    // Babylon.js PostProcess 构造:
    //   PostProcess(name, fragmentShader, uniforms, samplers, options, camera, samplingMode, engine, reusable)
    //
    // 传入 Scene 时 PostProcess 自动挂载到 activeCamera 的管线。
    // options 参数用于设置尺寸 (1.0 = 全分辨率)。
    this._postProcess = new PostProcess(
      name,
      SHARP_BILINEAR_FRAGMENT_SHADER,
      // uniforms 名称数组 (对应 shader 中的 uniform 变量)
      ['texelSize', 'sharpness'],
      // samplers — null (无额外 sampler，只使用默认 textureSampler)
      null,
      // options — 1.0 = 全分辨率 (与输入纹理相同)
      1.0,
      // camera — null 使用场景默认 activeCamera
      null,
      // samplingMode — BILINEAR 以启用双线性纹理采样
      samplingMode ?? 2, // TEXTURE_BILINEAR_SAMPLINGMODE
      // engine — 从 scene 提取或直接传入
      'getEngine' in sceneOrEngine ? sceneOrEngine.getEngine() : sceneOrEngine,
    )

    // 初始化 uniforms
    this.updateTexelSize()
    this.updateSharpness()

    // 绑定 onApply 回调以在每帧应用前更新 uniforms
    this._postProcess.onApply = (_effect: import('@babylonjs/core').Effect) => {
      this.updateTexelSize()
      this.updateSharpness()
    }
  }

  // -------------------------------------------------------------------------
  // 公开属性
  // -------------------------------------------------------------------------

  /**
   * 锐化强度。
   *
   * 范围: 0.0 (纯双线性，无锐化) 到 1.0 (最大锐化)。
   * 推荐默认: 0.5 (平衡平滑与锐度)。
   *
   * OpenRA 对照: SpriteRenderer 内部 sharpen 参数
   */
  get sharpness(): number {
    return this._sharpness
  }

  set sharpness(value: number) {
    if (this._disposed) return
    // 钳位到有效范围
    this._sharpness = Math.max(0, Math.min(1, value))
    this.updateSharpness()
  }

  /**
   * 输入纹理尺寸。
   *
   * 更改尺寸后自动更新 texelSize uniform。
   */
  get textureSize(): { width: number; height: number } {
    return { ...this._textureSize }
  }

  set textureSize(value: { width: number; height: number }) {
    if (this._disposed) return
    this._textureSize.width = value.width
    this._textureSize.height = value.height
    this.updateTexelSize()
  }

  /**
   * 底层 Babylon.js PostProcess 实例。
   *
   * 用于手动管线集成 (挂载到特定 camera 或自定义渲染流程)。
   */
  get postProcess(): PostProcess {
    return this._postProcess
  }

  // -------------------------------------------------------------------------
  // 资源释放
  // -------------------------------------------------------------------------

  /**
   * 释放 GPU 资源 (shader, framebuffer, 纹理)。
   *
   * 幂等操作 — 重复调用无副作用。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._postProcess.dispose()
  }

  // -------------------------------------------------------------------------
  // 私有方法
  // -------------------------------------------------------------------------

  /**
   * 更新 texelSize uniform (vec2: 1/width, 1/height)。
   *
   * texelSize 用于在片段着色器中计算正交邻域采样偏移。
   * 必须在纹理尺寸变化后调用。
   */
  private updateTexelSize(): void {
    if (this._disposed || !this._postProcess) return
    const uniform = this._postProcess.getEffect()
    if (uniform) {
      uniform.setFloat2(
        'texelSize',
        1.0 / this._textureSize.width,
        1.0 / this._textureSize.height,
      )
    }
  }

  /**
   * 更新 sharpness uniform (float 0.0-1.0)。
   */
  private updateSharpness(): void {
    if (this._disposed || !this._postProcess) return
    const uniform = this._postProcess.getEffect()
    if (uniform) {
      uniform.setFloat('sharpness', this._sharpness)
    }
  }
}
