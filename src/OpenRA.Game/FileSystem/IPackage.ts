/**
 * IPackage.ts — 文件系统包接口定义
 * OpenRA 对照: OpenRA.Game/FileSystem/IPackage.cs
 *
 * 核心范式转换:
 * - C# IReadOnlyPackage (name, contents, GetStream, Contains, OpenPackage, Dispose)
 *   → TypeScript interfaces (readonly name, contents: readonly string[], async open,
 *     contains, openPackage, dispose)
 * - C# Stream GetStream → open(): Promise<ArrayBuffer | null> (异步 I/O)
 * - C# IPackageLoader.TryParsePackage(out package) → tryParsePackage(): IReadOnlyPackage | null
 * - C# FileSystem context → IReadOnlyFileSystem forward declaration
 * - C# IReadWritePackage extends IReadOnlyPackage → IPackage extends IReadOnlyPackage
 */

// ---------------------------------------------------------------------------
// IReadOnlyFileSystem (forward declaration, implemented by FileSystem.ts)
// ---------------------------------------------------------------------------

/**
 * 只读文件系统接口，供包操作使用。
 *
 * OpenRA 对照: OpenRA.FileSystem.IReadOnlyFileSystem
 *
 * 这是 FileSystem 类所需的最小接口声明，用于在 IPackage 方法中传递上下文。
 * 完整实现见 FileSystem.ts。
 */
export interface IReadOnlyFileSystem {
  /**
   * 通过文件名异步打开文件。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Open(string)
   *
   * @param filename — 文件名
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  openAsync(filename: string): Promise<ArrayBuffer | null>

  /**
   * 检查指定文件是否存在于任何已挂载的包中。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Exists(string)
   *
   * @param filename — 文件名
   * @returns 如果文件存在则返回 true
   */
  exists(filename: string): boolean

  /**
   * 检查给定的文件名是否由已挂载的包所管理（即可从此 VFS 获取到）。
   *
   * OpenRA 对照: Partially mapped from IReadOnlyFileSystem.IsExternalFile(string),
   *   but with inverted semantics — OpenRA checks whether a path is *outside*
   *   the mod mount (returns true for external files), while TS checks whether
   *   a path is *inside* VFS management (found in explicitMounts or fileIndex).
   *   This is a simplification for the browser read-only environment.
   *
   * @param filename — 文件路径（可能包含 | 前缀）
   * @returns 如果文件在文件索引中或对应已挂载的显式包则返回 true
   */
  isMounted(filename: string): boolean
}

// ---------------------------------------------------------------------------
// IReadOnlyPackage
// ---------------------------------------------------------------------------

/**
 * 只读文件系统包接口。
 *
 * OpenRA 对照: OpenRA.FileSystem.IReadOnlyPackage
 *
 * 表示一个包含命名文件的容器（目录、ZIP、ORAMAP 等）。
 * 所有 I/O 操作都是异步的（浏览器特性）。
 */
export interface IReadOnlyPackage {
  /** 包的名称（通常是文件系统路径或 URL）。OpenRA 对照: IReadOnlyPackage.Name */
  readonly name: string

  /** 此包中包含的文件名列表（已排序）。OpenRA 对照: IReadOnlyPackage.Contents */
  readonly contents: readonly string[]

  /**
   * 检查包中是否包含指定文件。
   *
   * OpenRA 对照: IReadOnlyPackage.Contains(string)
   *
   * @param filename — 文件名
   * @returns 如果文件在包中则返回 true
   */
  contains(filename: string): boolean

  /**
   * 从包中打开文件并返回其内容。
   *
   * OpenRA 对照: IReadOnlyPackage.GetStream(string)
   *
   * **缓存安全约定**: 返回的 ArrayBuffer 必须是独立的副本，不得在多次调用间
   * 共享或复用底层缓冲区。这是因为调用方（如 FileSystem）可能会缓存返回值，
   * 而缓存条目必须与后续 `open()` 调用返回的值相互独立。实现者应确保每次调用
   * 返回新的 ArrayBuffer。
   *
   * @param filename — 文件名
   * @param files — 文件系统上下文（传递给子包）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  open(filename: string, files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null>

  /**
   * 从包中打开一个子包。
   *
   * OpenRA 对照: IReadOnlyPackage.OpenPackage(string, FileSystem)
   *
   * @param filename — 子包文件名
   * @param files — 文件系统上下文（用于递归解析）
   * @returns 子包，如果无法打开则返回 null
   */
  openPackage(filename: string, files?: IReadOnlyFileSystem): IReadOnlyPackage | null

  /**
   * 释放此包持有的所有资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   */
  dispose(): void
}

// ---------------------------------------------------------------------------
// IPackage (read-write package)
// ---------------------------------------------------------------------------

/**
 * 读写文件系统包接口。
 *
 * OpenRA 对照: OpenRA.FileSystem.IReadWritePackage
 *
 * 扩展 IReadOnlyPackage，添加写入功能。在浏览器环境中，
 * 写入功能通常仅限于内存中的包或 IndexedDB 后端。
 */
export interface IPackage extends IReadOnlyPackage {
  /**
   * 将文件写入包中。
   *
   * OpenRA 对照: IReadWritePackage.Update(string, byte[])
   *
   * @param filename — 文件名
   * @param data — 文件数据
   */
  update(filename: string, data: Uint8Array): void

  /**
   * 从包中删除文件。
   *
   * OpenRA 对照: IReadWritePackage.Delete(string)
   *
   * @param filename — 要删除的文件名
   */
  delete(filename: string): void
}

// ---------------------------------------------------------------------------
// IPackageLoader
// ---------------------------------------------------------------------------

/**
 * 包加载器接口 — 尝试从流中识别并解析特定格式的包。
 *
 * OpenRA 对照: OpenRA.FileSystem.IPackageLoader
 *
 * 加载器应检查文件扩展名和/或魔数来确定是否能处理该流。
 * 如果无法处理，应返回 null（不抛出异常）。
 */
export interface IPackageLoader {
  /**
   * 尝试将流解析为此加载器支持的包类型。
   *
   * OpenRA 对照: IPackageLoader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * @param filename — 文件名（用于扩展名检查）
   * @param stream — 文件内容
   * @param files — 文件系统上下文
   * @returns 解析的包，如果格式不匹配则返回 null
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null
}
