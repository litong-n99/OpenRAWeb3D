/**
 * IReadOnlyPackage.ts — 文件系统包接口（重新导出）
 * OpenRA 对照: OpenRA.Game/FileSystem/IReadOnlyPackage.cs
 *
 * 核心范式转换:
 * - 现在从新的 IPackage.ts 模块重新导出所有接口
 * - 此文件保留以保持向后兼容性 — 现有导入仍然有效
 * - IReadWritePackage 作为 IPackage 的别名重新导出（与 OpenRA 命名匹配）
 */

export {
  type IReadOnlyPackage,
  type IPackage,
  type IPackageLoader,
  type IReadOnlyFileSystem,
} from './IPackage.js'

/** 遗留别名: IReadWritePackage 映射到 IPackage */
export type { IPackage as IReadWritePackage } from './IPackage.js'
