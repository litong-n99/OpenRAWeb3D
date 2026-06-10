/**
 * IReadOnlyPackage.ts — 文件系统包接口存根
 * OpenRA 对照: OpenRA.Game/FileSystem/IReadOnlyPackage.cs
 *
 * 核心范式转换:
 * - C# IReadOnlyPackage 接口 → TypeScript 接口存根
 * - C# Stream OpenFile → 返回 ArrayBuffer 的异步方法
 * - C# IReadWritePackage 继承 IReadOnlyPackage → 单独接口存根
 *
 * NOTE: 这是 Chapter 6（资源管线）的存根。完整实现将在资源加载
 * 系统迁移时提供。
 * TODO-4.E.7: 替换为完整的 IReadOnlyPackage / IReadWritePackage 实现。
 */

// ---------------------------------------------------------------------------
// IReadOnlyPackage
// ---------------------------------------------------------------------------

/**
 * 只读文件系统包接口。
 *
 * OpenRA 对照: IReadOnlyPackage
 *
 * 表示一个包含命名文件的容器（目录、ZIP、ORAMAP 等）。
 * 这是文件系统抽象的最小存根，仅包含 MapCache 和 MapDirectoryTracker
 * 所需的成员。
 */
export interface IReadOnlyPackage {
  /** 包的名称（通常是文件系统路径）。 */
  readonly name: string

  /** 此包中包含的文件名列表。 */
  readonly contents: string[]

  /**
   * 从包中打开一个子包。
   *
   * OpenRA 对照: IReadOnlyPackage.OpenPackage(string, IReadOnlyFileSystem)
   *
   * @param name — 要打开的子包名称
   * @param files — 文件系统上下文
   * @returns 子包，如果无法打开则返回 null
   */
  openPackage(name: string, files?: unknown): IReadOnlyPackage | null
}

// ---------------------------------------------------------------------------
// IReadWritePackage
// ---------------------------------------------------------------------------

/**
 * 读写文件系统包接口。
 *
 * OpenRA 对照: IReadWritePackage
 *
 * 扩展 IReadOnlyPackage，添加写入功能。
 * 这是文件系统抽象的最小存根。
 */
export interface IReadWritePackage extends IReadOnlyPackage {
  /**
   * 将文件写入包中。
   *
   * OpenRA 对照: IReadWritePackage.Update(string, byte[])
   *
   * @param name — 文件名
   * @param data — 文件数据
   */
  update(name: string, data: Uint8Array): void

  /**
   * 从包中删除文件。
   *
   * OpenRA 对照: IReadWritePackage.Delete(string)
   *
   * @param name — 要删除的文件名
   */
  delete(name: string): void
}
