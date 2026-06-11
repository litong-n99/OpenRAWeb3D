/**
 * Folder.ts — HTTP 后备文件夹包实现
 * OpenRA 对照: OpenRA.Game/FileSystem/Folder.cs
 *
 * 核心范式转换:
 * - C# Directory.GetFiles → 静态文件名 → URL 映射 (Map<string, string>)
 * - C# File.OpenRead → fetch(url).then(r => r.arrayBuffer())
 * - C# 同步 GetStream → 异步 open()
 * - C# Folder 不包含子包 (OpenPackage 尝试加载 ZIP/MIX)
 *   → 浏览器端 return null（文件夹不包含嵌套包，子包通过 FileSystem 加载）
 * - C# IReadWritePackage.Update/Delete → 浏览器端不实现写入（只读 Folder）
 *
 * NOTE: Folder 在浏览器中只读 — 不支持 update() 和 delete()。
 * 这是由于浏览器无法写入任意文件系统路径。
 * Folder 实现 IReadOnlyPackage 而非 IPackage。
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem } from './IPackage.js'

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

/**
 * 基于 HTTP fetch 的文件夹包 — 将文件名映射到 URL 并通过 fetch 加载。
 *
 * OpenRA 对照: OpenRA.FileSystem.Folder
 *
 * 与 OpenRA 的 Folder（访问本地磁盘目录）不同，此实现
 * 使用预定义的 filename → URL 映射表。这对于浏览器环境是必要的，
 * 因为无法枚举远程目录。
 */
export class Folder implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → 绝对 URL 映射。 */
  private _fileListing: Map<string, string>

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[]

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * 创建一个 Folder 包。
   *
   * OpenRA 对照: Folder(string path)
   *
   * @param name — 包的显示名称
   * @param fileListing — 文件名 → URL 映射表
   */
  constructor(name: string, fileListing: Map<string, string>) {
    this.name = name
    this._fileListing = fileListing
    this._contents = [...fileListing.keys()].sort()
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Contents
  // -----------------------------------------------------------------------

  /** 包中包含的文件名列表（已排序）。OpenRA 对照: Folder.Contents */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在包中。
   *
   * OpenRA 对照: Folder.Contains(string)
   */
  contains(filename: string): boolean {
    return this._fileListing.has(filename)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Open
  // -----------------------------------------------------------------------

  /**
   * 通过 HTTP fetch 打开文件。对缺失的文件返回 null（不抛出异常）。
   *
   * OpenRA 对照: Folder.GetStream(string)
   *
   * @param filename — 文件名
   * @param _files — 文件系统上下文（未使用，但符合接口要求）
   * @returns 文件内容的 ArrayBuffer，如果未找到或 HTTP 错误则返回 null
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    const url = this._fileListing.get(filename)
    if (!url) return null

    try {
      const response = await fetch(url)
      if (!response.ok) return null
      return response.arrayBuffer()
    } catch {
      // 网络错误、CORS 问题等 — 全部静默返回 null
      return null
    }
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — OpenPackage
  // -----------------------------------------------------------------------

  /**
   * 从文件夹中打开子包。
   *
   * OpenRA 对照: Folder.OpenPackage(string, FileSystem)
   *
   * 在浏览器环境中，文件夹不直接包含子包。
   * 子包加载由 FileSystem 通过其加载器链处理。
   *
   * @returns 始终返回 null
   */
  openPackage(_filename: string, _files?: IReadOnlyFileSystem): IReadOnlyPackage | null {
    return null
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放文件夹持有的资源（清除文件列表）。
   *
   * OpenRA 对照: Folder.Dispose()
   */
  dispose(): void {
    this._fileListing.clear()
    this._contents = []
  }

  // -----------------------------------------------------------------------
  // Static Factory
  // -----------------------------------------------------------------------

  /**
   * 从 manifest JSON 对象创建 Folder。
   *
   * 将相对路径映射到绝对 URL。这是浏览器环境中创建 Folder 的推荐方式，
   * 因为它不依赖于服务器端的目录列表功能。
   *
   * @param baseUrl — 基础 URL（例如 "https://example.com/assets/"）
   * @param manifest — 相对路径 → 文件名 的映射表
   * @returns 一个新的 Folder 实例
   *
   * @example
   * ```typescript
   * const folder = Folder.fromManifest('/assets/', {
   *   'tileset.yaml': 'tileset.yaml',
   *   'sprites/unit.png': 'sprites/unit.png',
   * })
   * ```
   */
  static fromManifest(baseUrl: string, manifest: Record<string, string>): Folder {
    // 确保 baseUrl 以 '/' 结尾
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'

    const listing = new Map<string, string>()
    for (const [relative, _filename] of Object.entries(manifest)) {
      // 规范化路径：移除开头的 '/'
      const cleanPath = relative.startsWith('/') ? relative.slice(1) : relative
      const absoluteUrl = normalizedBase + cleanPath
      listing.set(cleanPath, absoluteUrl)
    }

    return new Folder(baseUrl, listing)
  }

  // -----------------------------------------------------------------------
  // Debug / Utility
  // -----------------------------------------------------------------------

  /**
   * 获取文件数量。
   */
  get fileCount(): number {
    return this._fileListing.size
  }

  /**
   * 获取文件的 URL（用于调试）。
   *
   * @param filename — 文件名
   * @returns 绝对 URL，如果文件未列出则返回 undefined
   */
  getUrl(filename: string): string | undefined {
    return this._fileListing.get(filename)
  }
}
