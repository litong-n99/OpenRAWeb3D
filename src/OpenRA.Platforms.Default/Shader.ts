/**
 * Shader.ts — OpenRA 着色器平台实现的 TypeScript/Babylon.js 迁移
 * OpenRA 对照: OpenRA.Platforms.Default/Shader.cs
 *
 * 核心范式转换:
 * - 手动 glCreateShader / glCompileShader / glLinkProgram → ShaderMaterial 自动管理
 * - uniform 位置缓存 (Dictionary<string, int>) → Effect 系统自动缓存
 * - 纹理单元跟踪 (samplers + textures + unbindTextures) → setTexture() 直接绑定
 * - ThreadAffine 线程亲和验证 → 已移除（浏览器单线程）
 * - GLSL {VERSION} 模板替换 → WebGL 2.0 固定 #version 300 es
 * - Bind() 设置 glVertexAttribPointer → VertexBuffer + Mesh 自动管理
 * - PrepareRender() 手动纹理绑定 + glUseProgram → Scene.render() 内部自动执行
 */

import {
  ShaderMaterial,
  Effect,
  Matrix,
  Vector2,
  Vector3,
  type Scene,
  type BaseTexture,
} from '@babylonjs/core'
import type {
  IShader,
  IShaderBindings,
  ITexture,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// ShaderMaterial 配置常量
//
// 对应 OpenRA combined.vert / combined.frag 中使用的所有属性和 uniform。
// ---------------------------------------------------------------------------

/** 顶点属性名称（与 CombinedShaderBindings 的 4 个属性一致） */
const SHADER_ATTRIBUTES = [
  'aVertexPosition',
  'aVertexTexCoord',
  'aVertexAttributes',
  'aVertexTint',
]

/** 自定义 uniform 名称（Babylon.js 自动注入 worldViewProjection 等矩阵） */
const SHADER_UNIFORMS = [
  'PaletteRows',
  'EnableDepthPreview',
  'DepthPreviewParams',
  'DepthTextureScale',
  'EnablePixelArtScaling',
]

/** 采样器/纹理 uniform 名称 */
const SHADER_SAMPLERS = [
  'Texture0', 'Texture1', 'Texture2', 'Texture3',
  'Texture4', 'Texture5', 'Texture6', 'Texture7',
  'Palette',
  'ColorShifts',
]

// ---------------------------------------------------------------------------
// 辅助：从 ITexture 提取 Babylon.js BaseTexture
//
// NOTE: ITexture 是迁移中的抽象接口，其具体实现（Texture.ts）将在内部持有
// BABYLON.Texture / BABYLON.RawTexture。在完整 Texture 模块迁移前，
// 此处通过类型断言桥接。
// ---------------------------------------------------------------------------

/**
 * 从 ITexture 中提取底层 Babylon.js BaseTexture。
 *
 * 约定：ITexture 的具体实现应暴露 `babylonTexture` 属性，
 * 或自身即是 Babylon.js Texture 的子类。
 *
 * @throws 如果无法提取底层纹理
 */
function getBabylonTexture(tex: ITexture): BaseTexture {
  // 通过约定的 babylonTexture 属性获取底层 Babylon.js 纹理
  // 使用 unknown 中间类型避免 ITexture 与 Record 类型不兼容的 TS 错误
  const maybeTex = tex as unknown as { babylonTexture?: BaseTexture }
  if (maybeTex.babylonTexture) {
    return maybeTex.babylonTexture
  }
  throw new Error(
    'Cannot extract Babylon.js texture from ITexture. ' +
    'Ensure the ITexture implementation exposes a `babylonTexture` property.',
  )
}

// ---------------------------------------------------------------------------
// Shader — IShader 接口的具体实现
//
// 对应 OpenRA sealed class Shader : ThreadAffine, IShader。
//
// 包装单个 BABYLON.ShaderMaterial 实例，将 IShader 的 8 个方法
// 委托给 ShaderMaterial 的对应 API。
//
// 生命周期:
//   1. 构造时注册 GLSL 源码到 Effect.ShadersStore
//   2. 创建 ShaderMaterial（自动编译/链接）
//   3. 通过 setVec/setTexture/setMatrix 设置 uniform
//   4. 渲染循环中 Babylon.js 自动执行 prepareRender 和 bind
//   5. dispose() 清理 ShaderMaterial（释放 GPU 资源）
//
// OpenRA 对照: Shader (Shader.cs:20-261)
// ---------------------------------------------------------------------------

export class Shader implements IShader {
  /** Babylon.js ShaderMaterial 实例 */
  readonly material: ShaderMaterial

  /** 着色器绑定元数据 */
  readonly bindings: IShaderBindings

  /** 关联的 Babylon.js Scene */
  readonly scene: Scene

  /** 是否已销毁 */
  private disposed = false

  /**
   * 构造 Shader 实例。
   *
   * 对应 OpenRA public Shader(IShaderBindings bindings)。
   *
   * 执行步骤（迁移版）：
   * 1. 将着色器源码注册到 Effect.ShadersStore
   * 2. 创建 ShaderMaterial（Babylon.js 内部编译/链接）
   *
   * 与 OpenRA 的关键差异：
   * - 无手动 glCreateShader / glCompileShader / glLinkProgram
   * - 无 uniform 位置缓存（Effect 系统自动管理）
   * - 无纹理单元分配（ShaderMaterial 内部管理采样器绑定）
   * - 无 ThreadAffine 验证（已移除）
   * - 无 fragColor 绑定（WebGL 2.0 使用 layout(location=0) out）
   *
   * @param bindings — 着色器绑定元数据（顶点/片段源码 + 属性布局）
   * @param scene — Babylon.js Scene 实例
   */
  constructor(bindings: IShaderBindings, scene: Scene) {
    this.bindings = bindings
    this.scene = scene

    // Step 1: 注册着色器源码到 Effect.ShadersStore
    // Babylon.js 命名约定: "{name}VertexShader" / "{name}FragmentShader"
    const vertexKey = bindings.vertexShaderName + 'VertexShader'
    const fragmentKey = bindings.fragmentShaderName + 'FragmentShader'

    if (!Effect.ShadersStore[vertexKey]) {
      Effect.ShadersStore[vertexKey] = bindings.vertexShaderCode
    }
    if (!Effect.ShadersStore[fragmentKey]) {
      Effect.ShadersStore[fragmentKey] = bindings.fragmentShaderCode
    }

    // Step 2: 创建 ShaderMaterial
    // Babylon.js 使用 Effect 系统自动编译/链接 GLSL
    this.material = new ShaderMaterial(
      `shader_${bindings.vertexShaderName}_${bindings.fragmentShaderName}`,
      scene,
      {
        vertex: bindings.vertexShaderName,
        fragment: bindings.fragmentShaderName,
      },
      {
        attributes: SHADER_ATTRIBUTES,
        uniforms: SHADER_UNIFORMS,
        samplers: SHADER_SAMPLERS,
        needAlphaBlending: true,
        needAlphaTesting: true,
      },
    )
  }

  // -----------------------------------------------------------------------
  // IShader 接口实现
  // -----------------------------------------------------------------------

  /**
   * 设置 bool 类型的 uniform 变量。
   *
   * 对应 OpenRA Shader.SetBool(string name, bool value)。
   * 迁移版：使用 shaderMaterial.setFloat(name, value ? 1.0 : 0.0)。
   *
   * @param name — uniform 变量名
   * @param value — bool 值
   */
  setBool(name: string, value: boolean): void {
    this.ensureNotDisposed()
    this.material.setFloat(name, value ? 1.0 : 0.0)
  }

  /**
   * 设置 float 类型的 uniform 变量（1 分量）。
   *
   * 对应 OpenRA Shader.SetVec(string name, float x)。
   * 迁移版：使用 shaderMaterial.setFloat()。
   */
  setVec(name: string, x: number): void
  /**
   * 设置 vec2 类型的 uniform 变量（2 分量，重载）。
   *
   * 对应 OpenRA Shader.SetVec(string name, float x, float y)。
   * 迁移版：使用 shaderMaterial.setVector2()。
   */
  setVec(name: string, x: number, y: number): void
  /**
   * 设置 vec3 类型的 uniform 变量（3 分量，重载）。
   *
   * 对应 OpenRA Shader.SetVec(string name, float x, float y, float z)。
   * 迁移版：使用 shaderMaterial.setVector3()。
   */
  setVec(name: string, x: number, y: number, z: number): void
  /**
   * 设置向量类型的 uniform 变量（N 分量数组，重载）。
   *
   * 对应 OpenRA Shader.SetVec(string name, ReadOnlyMemory<float> vec, int length)。
   * 迁移版：根据 length 调用 setFloat / setVector2 / setVector3 / setVector4 / setFloats。
   *
   * @throws 如果 length 不在 1-4 范围内
   */
  setVec(name: string, vec: Readonly<Float32Array>, length: number): void

  // 实现
  setVec(
    name: string,
    xOrVec: number | Readonly<Float32Array>,
    y?: number,
    z?: number,
    length?: number,
  ): void {
    this.ensureNotDisposed()

    if (typeof xOrVec === 'number') {
      // 标量重载
      if (y === undefined) {
        this.material.setFloat(name, xOrVec)
      } else if (z === undefined) {
        this.material.setVector2(name, new Vector2(xOrVec, y))
      } else {
        this.material.setVector3(name, new Vector3(xOrVec, y, z))
      }
    } else {
      // 数组重载 — 对应 OpenRA SetVec(name, ReadOnlyMemory<float>, length)
      const vecLength = length ?? xOrVec.length
      if (vecLength < 1 || vecLength > 4) {
        throw new Error(
          `Invalid vector length: ${vecLength}. Must be 1-4. ` +
          `(对应 OpenRA: InvalidDataException "Invalid vector length")`,
        )
      }
      // ShaderMaterial.setFloats 期望 number[]；转换 Float32Array
      this.material.setFloats(name, Array.from(xOrVec))
    }
  }

  /**
   * 将纹理绑定到着色器的 sampler2D uniform。
   *
   * 对应 OpenRA Shader.SetTexture(string name, ITexture t)。
   *
   * 与 OpenRA 的差异：
   * - OpenRA 通过采样器名称查找纹理单元索引，延迟到 PrepareRender() 绑定
   * - 迁移版直接调用 material.setTexture() 即时绑定
   * - null 纹理在 OpenRA 中直接返回；迁移版相同
   *
   * @param name — 采样器 uniform 名称（如 'Texture0', 'Palette'）
   * @param texture — ITexture 实例或 null（跳过绑定）
   */
  setTexture(name: string, texture: ITexture): void {
    this.ensureNotDisposed()
    // 对应 OpenRA: if (t == null) return;
    if (!texture) return

    const babylonTex = getBabylonTexture(texture)
    this.material.setTexture(name, babylonTex)
  }

  /**
   * 设置 4x4 矩阵 uniform。
   *
   * 对应 OpenRA Shader.SetMatrix(string name, float[] mtx)。
   *
   * 验证矩阵长度为 16（4x4），将 Float32Array 转换为 Babylon.js Matrix 后设置。
   *
   * @param name — uniform 变量名
   * @param mtx — 长度 16 的 Float32Array（列主序 4x4 矩阵）
   * @throws 如果矩阵长度不是 16
   */
  setMatrix(name: string, mtx: Readonly<Float32Array>): void {
    this.ensureNotDisposed()
    // 对应 OpenRA: if (mtx.Length != 16) throw ...
    if (mtx.length !== 16) {
      throw new Error(
        `Invalid 4x4 matrix: expected 16 elements, got ${mtx.length}. ` +
        `(对应 OpenRA: InvalidDataException "Invalid 4x4 matrix")`,
      )
    }
    // Babylon.js Matrix.FromArray 期望列主序 16 元素数组
    const matrix = Matrix.FromArray(mtx as Float32Array)
    this.material.setMatrix(name, matrix)
  }

  /**
   * 准备渲染：激活着色器程序、绑定纹理、设置渲染状态。
   *
   * 对应 OpenRA Shader.PrepareRender()。
   *
   * 在 Babylon.js 中，此操作在 Scene.render() 的渲染循环中自动执行。
   * ShaderMaterial 在绑定时会自动：
   * 1. 调用 glUseProgram
   * 2. 绑定所有纹理到对应采样器
   * 3. 设置所有 uniform 值
   * 4. 驱逐已销毁的纹理（Babylon.js 内部处理引用计数）
   *
   * 迁移版保留此 API 以兼容现有调用代码，实际为 no-op。
   * 若需强制同步材质状态，可在此处调用 shaderMaterial.bind()。
   */
  prepareRender(): void {
    this.ensureNotDisposed()
    // 对应 OpenRA PrepareRender:
    //   - VerifyThreadAffinity() → 已移除
    //   - glUseProgram(program) → Babylon.js 在渲染时自动调用
    //   - 遍历 textures 绑定/驱逐 → Babylon.js 内部管理
    //
    // Babylon.js ShaderMaterial 在每次绘制前由引擎自动执行等效操作。
    // 无需手动干预。
  }

  /**
   * 绑定顶点属性指针。
   *
   * 对应 OpenRA Shader.Bind()。
   *
   * OpenRA 实现（Shader.cs:134-145）：
   * - 遍历 bindings.Attributes，调用 glVertexAttribPointer / glVertexAttribIPointer
   * - Float 类型使用 glVertexAttribPointer
   * - Int/UInt 类型使用 glVertexAttribIPointer
   *
   * 迁移版：顶点属性绑定由 Babylon.js Mesh + VertexBuffer 自动管理。
   * 每个 VertexBuffer 指定其属性名称、组件数、数据类型和偏移，
   * 引擎在渲染时自动调用 glVertexAttribPointer。
   *
   * 此方法保留 API 兼容性，实际为 no-op。
   */
  bind(): void {
    this.ensureNotDisposed()
    // 对应 OpenRA Bind:
    //   - 遍历 Attributes 设置 glVertexAttribPointer
    //   - Float → glVertexAttribPointer(GL_FLOAT)
    //   - UInt → glVertexAttribIPointer(GL_UNSIGNED_INT)
    //
    // 在 Babylon.js 中，顶点属性绑定由 VertexData 和 VertexBuffer 管理：
    //
    //   const vertexData = new VertexData()
    //   vertexData.positions = positions  // → 自动创建 'position' attribute
    //   vertexData.uvs = texCoords         // → 自动创建 'uv' attribute
    //   // 自定义属性:
    //   mesh.setVerticesData('aVertexTexCoord', texCoords)
    //   mesh.setVerticesData('aVertexAttributes', attrs)
    //   mesh.setVerticesData('aVertexTint', tints)
    //
    // ShaderMaterial 在编译时会验证 Mesh 提供的属性是否匹配着色器声明。
  }

  // -----------------------------------------------------------------------
  // 生命周期管理
  // -----------------------------------------------------------------------

  /**
   * 释放 ShaderMaterial 占用的 GPU 资源。
   *
   * 对应 OpenRA Shader 的 IDisposable 模式（C# 中通过 GC + finalizer）。
   *
   * 调用后此 Shader 实例不可再使用。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.material.dispose()
  }

  /** 检查是否已销毁，已销毁则抛出错误 */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error(
        `Shader '${this.bindings.vertexShaderName}' has been disposed. ` +
        `(对应 OpenRA ObjectDisposedException)`,
      )
    }
  }
}
