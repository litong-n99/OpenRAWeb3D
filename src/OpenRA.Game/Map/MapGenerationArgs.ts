/**
 * MapGenerationArgs.ts — 程序化地图生成参数数据类
 * OpenRA 对照: OpenRA.Game/Map/MapGenerationArgs.cs
 *
 * 核心范式转换:
 * - C# [FieldLoader.Require] 属性 → JSDoc 文档说明（TypeScript 无运行时必填验证）
 * - C# MiniYaml Settings → JSON object (unknown 类型)
 * - C# List<MiniYamlNode> Serialize() → { key: string; value: unknown }[]
 * - C# Size 结构体 → Size interface { width, height }
 */

import type { Size } from '../Primitives/Size.js'

// ---------------------------------------------------------------------------
// MapGenerationArgs
// ---------------------------------------------------------------------------

/**
 * 程序化地图生成的参数。
 *
 * OpenRA 对照: MapGenerationArgs class
 *
 * 保存地图生成器的配置：UID、生成器类型、地形集、尺寸、标题、作者和设置。
 * 从 JSON 对象反序列化（OpenRA 中使用 MiniYaml）。
 *
 * NOTE: TypeScript 没有 [FieldLoader.Require] 的运行时等价物。
 * 所有字段在构造后均为必填项，但构造函数接受 Partial 对象以允许
 * 增量构建。调用方应确保在将实例传递给生成器之前设置所有字段。
 */
export class MapGenerationArgs {
  /** 地图唯一标识符。 */
  uid: string
  /** 生成器类型标识符。 */
  generator: string
  /** 地形集标识符。 */
  tileset: string
  /** 地图尺寸（宽 × 高，以单元格为单位）。 */
  size: Size
  /** 地图标题。 */
  title: string
  /** 地图作者。 */
  author: string
  /** 生成器特定设置（JSON 对象，OpenRA 中为 MiniYaml）。 */
  settings: unknown

  /**
   * 从部分对象构造 MapGenerationArgs。
   *
   * OpenRA 对照: 隐式 FieldLoader.Load 模式
   *
   * @param data — 包含字段值的部分对象
   */
  constructor(data: Partial<MapGenerationArgs> = {}) {
    this.uid = data.uid ?? ''
    this.generator = data.generator ?? ''
    this.tileset = data.tileset ?? ''
    this.size = data.size ?? { width: 0, height: 0 }
    this.title = data.title ?? ''
    this.author = data.author ?? ''
    this.settings = data.settings ?? null
  }

  /**
   * 将参数序列化为键值对数组。
   *
   * OpenRA 对照: MapGenerationArgs.Serialize() → List<MiniYamlNode>
   *
   * 返回一个 { key, value } 对象数组，对应序列化的 MiniYaml 节点。
   * Size 被格式化为 "宽度,高度" 字符串。
   *
   * @returns 键值对数组
   */
  serialize(): { key: string; value: unknown }[] {
    return [
      { key: 'Uid', value: this.uid },
      { key: 'Generator', value: this.generator },
      { key: 'Tileset', value: this.tileset },
      { key: 'Size', value: `${this.size.width},${this.size.height}` },
      { key: 'Settings', value: this.settings },
      { key: 'Title', value: this.title },
      { key: 'Author', value: this.author },
    ]
  }
}
