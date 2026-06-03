/**
 * ShaderBindings.ts — OpenRA 着色器绑定抽象基类的迁移
 * OpenRA 对照: OpenRA.Game/Graphics/ShaderBindings.cs
 *
 * 核心范式转换:
 * - 文件系统读取 GLSL 源码 → ShaderSourceRegistry 内存注册表
 * - Stride 自动计算（基于 Attributes 各分量的 sizeof(float)=4 之和）
 * - Effect.ShadersStore 替代手动 glCreateShader/glCompileShader
 * - 抽象 Attributes 属性由子类（CombinedShaderBindings 等）实现
 */

import type {
  IShaderBindings,
  ShaderVertexAttribute,
} from './PlatformInterfaces'

// ---------------------------------------------------------------------------
// ShaderSourceRegistry — 着色器源码注册表
//
// 因为 Web 环境无法从文件系统读取 GLSL 源文件，
// 此注册表在应用初始化时预加载所有着色器源码。
//
// 对应 OpenRA ShaderBindings.GetShaderCode() (ShaderBindings.cs:50-54)
// ---------------------------------------------------------------------------

const shaderSources = new Map<string, string>()

/**
 * 注册着色器源码到全局注册表。
 * 对应 OpenRA ShaderBindings.GetShaderCode() —— 从 glsl/ 目录加载源代码。
 *
 * 在应用启动时调用，将所有 GLSL 源文件注册到 Effect.ShadersStore。
 * 例如：
 *   registerShaderSource('combined.vert', combinedVertSrc)
 *   registerShaderSource('combined.frag', combinedFragSrc)
 *
 * Babylon.js 集成：注册后，源码也会写入 Effect.ShadersStore[key]，
 * 以便 ShaderMaterial 通过键名引用着色器。
 *
 * @param filename — 着色器文件名（如 'combined.vert', 'combined.frag'）
 * @param source — GLSL 源代码
 */
export function registerShaderSource(
  filename: string,
  source: string,
): void {
  shaderSources.set(filename, source)
}

/**
 * 获取已注册的着色器源码。
 * 对应 OpenRA ShaderBindings.GetShaderCode()。
 *
 * @param filename — 着色器文件名
 * @returns GLSL 源代码
 * @throws 如果文件未注册
 */
export function getShaderSource(filename: string): string {
  const source = shaderSources.get(filename)
  if (source === undefined) {
    throw new Error(
      `Shader source '${filename}' not registered. ` +
      `Call registerShaderSource() before creating ShaderBindings.`,
    )
  }
  return source
}

/**
 * 注册多个着色器源码（批量版）。
 *
 * @param sources — { filename: source } 映射
 */
export function registerShaderSources(
  sources: Record<string, string>,
): void {
  for (const [filename, source] of Object.entries(sources)) {
    shaderSources.set(filename, source)
  }
}

/** 清空着色器源码注册表（用于测试清理） */
export function clearShaderSources(): void {
  shaderSources.clear()
}

// ---------------------------------------------------------------------------
// ShaderBindings — 着色器绑定抽象基类
//
// 对应 OpenRA abstract class ShaderBindings : IShaderBindings。
//
// 子类必须实现 Attributes 属性，定义顶点属性布局。
// 构造函数通过 ShaderSourceRegistry 查找并加载 GLSL 源码。
//
// OpenRA 对照: ShaderBindings (ShaderBindings.cs:28-55)
// ---------------------------------------------------------------------------

/**
 * 着色器绑定抽象基类。
 *
 * 职责：
 * 1. 通过文件名从注册表加载顶点/片段着色器源码
 * 2. 根据 Attributes 计算顶点跨距 Stride
 * 3. 提供 IShaderBindings 接口的所有只读属性
 *
 * 使用示例（CombinedShaderBindings）：
 *   class CombinedShaderBindings extends ShaderBindings {
 *     constructor() { super('combined') }
 *     get attributes() { return COMBINED_ATTRIBUTES }
 *   }
 */
export abstract class ShaderBindings implements IShaderBindings {
  readonly vertexShaderName: string
  readonly vertexShaderCode: string
  readonly fragmentShaderName: string
  readonly fragmentShaderCode: string
  readonly stride: number
  abstract readonly attributes: readonly ShaderVertexAttribute[]

  /**
   * 使用同一基础名称构造（顶点和片段使用相同名称）。
   * 对应 OpenRA protected ShaderBindings(string name)。
   *
   * 例如：`new CombinedShaderBindings()` → 加载 'combined.vert' 和 'combined.frag'
   *
   * @param name — 着色器基础名称（不含扩展名）
   */
  protected constructor(name: string)

  /**
   * 使用不同的顶点/片段名称构造。
   * 对应 OpenRA protected ShaderBindings(string vertexName, string fragmentName)。
   *
   * @param vertexName — 顶点着色器基础名称
   * @param fragmentName — 片段着色器基础名称
   */
  protected constructor(vertexName: string, fragmentName: string)

  protected constructor(vertexOrName: string, fragmentName?: string) {
    const vertName = fragmentName !== undefined ? vertexOrName : vertexOrName
    const fragName = fragmentName !== undefined ? fragmentName : vertexOrName

    this.vertexShaderName = vertName
    this.fragmentShaderName = fragName

    // 从注册表加载着色器源码
    this.vertexShaderCode = getShaderSource(vertName + '.vert')
    this.fragmentShaderCode = getShaderSource(fragName + '.frag')

    // Stride 计算延迟到子类 Attributes 可用的时机
    // 在构造函数中 this.attributes 指向子类的 getter，
    // 但因为子类尚未完全初始化，需要在构造后立即计算 stride。
    // 我们使用一个 getter 延迟计算。
    this.stride = this.computeStride()
  }

  /**
   * 计算顶点跨距（字节）。
   * 对应 OpenRA ShaderBindings 构造函数中的：
   *   Stride = Attributes.Sum(a => a.Components * 4)
   *
   * 每个分量为 4 字节（sizeof(float) 或 sizeof(int32)），
   * 总和即为顶点结构的总字节数。
   *
   * @returns 顶点跨距（字节）
   */
  private computeStride(): number {
    let sum = 0
    for (const attr of this.attributes) {
      sum += attr.components * 4
    }
    return sum
  }
}
