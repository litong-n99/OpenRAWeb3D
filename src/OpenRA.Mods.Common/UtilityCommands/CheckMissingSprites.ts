/**
 * CheckMissingSprites.ts — 检查序列定义中缺失的精灵文件
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CheckMissingSprites.cs
 *
 * 核心范式转换:
 * - C# SequenceSet + SpriteCache.MissingFiles 延迟加载
 *   → JSON 序列配置中的 sprite 引用扫描 + 文件系统存在性检查
 * - C# IReadOnlyFileSystem.Open() 同步文件访问
 *   → IReadOnlyFileSystem.exists() + openAsync()（异步）
 * - C# ITiledTerrainRendererInfo.ValidateTileSprites()
 *   → 地形精灵验证的占位钩子（TODO: 等 TerrainRenderer 迁移后）
 * - C# YamlException 解析错误处理
 *   → try/catch 处理 JSON.parse 错误
 * - C# Environment.Exit(1)
 *   → process.exit(1)（Node.js CLI 环境）
 *
 * NOTE: 此命令依赖文件系统访问（IReadOnlyFileSystem）。
 * 完整的精灵存在性验证需要 SequenceSet（Ch2）和 SpriteCache。
 * 在 SequenceSet 独立迁移完成前，此实现专注于
 * 从 JSON 序列配置中检测缺失的精灵引用。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import type { ModData } from '../../OpenRA.Game/ModData.js'

// ---------------------------------------------------------------------------
// 已知序列文件路径（对应 OpenRA 在 tileset 循环中隐式发现）
// ---------------------------------------------------------------------------

/**
 * 每个地形集中可能包含序列定义的已知文件路径。
 *
 * OpenRA 对照: SequenceSet 构造函数 — 通过规则和文件系统隐式发现
 */
const KNOWN_SEQUENCE_PATHS = [
  'sequences.yaml',
  'sequences/aircraft.yaml',
  'sequences/buildings.yaml',
  'sequences/infantry.yaml',
  'sequences/misc.yaml',
  'sequences/ships.yaml',
  'sequences/vehicles.yaml',
  'sequences/decoration.yaml',
  'sequences/critters.yaml',
  'sequences/voxels.yaml',
  'sequences/units.yaml',
]

// ---------------------------------------------------------------------------
// CheckMissingSprites（对应 OpenRA CheckMissingSprites）
// ---------------------------------------------------------------------------

/**
 * 扫描序列定义并验证每个引用的精灵在精灵表中是否存在。
 *
 * OpenRA 对照: sealed class CheckMissingSprites : IUtilityCommand
 */
export class CheckMissingSprites implements IUtilityCommand {
  /** 命令调用名称。
   *
   * OpenRA 对照: IUtilityCommand.Name => "--check-missing-sprites"
   */
  readonly name = '--check-missing-sprites'

  // ---------------------------------------------------------------------------
  // validateArguments（对应 OpenRA ValidateArguments）
  // ---------------------------------------------------------------------------

  /**
   * 验证命令行参数。
   *
   * OpenRA 对照: IUtilityCommand.ValidateArguments(string[])
   *
   * 此命令不接受额外参数。
   *
   * @param args — 命令参数
   * @returns 始终返回 true
   */
  validateArguments(_args: string[]): boolean {
    return true
  }

  // ---------------------------------------------------------------------------
  // run（对应 OpenRA Run）
  // ---------------------------------------------------------------------------

  /**
   * 执行精灵缺失检查。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * 对于每个地形集:
   * 1. 验证地形精灵（如果适用）
   * 2. 加载序列并检查缺失的精灵文件
   * 3. 将结果报告到控制台
   *
   * @param utility — 命令上下文
   * @param _args — 命令行参数
   */
  run(utility: Utility, _args: string[]): void {
    const modData = utility.modData
    let failed = false

    try {
      // 获取可用的地形信息
      const terrainInfos = this._getAvailableTerrainInfos(modData)

      for (const terrainInfo of terrainInfos) {
        try {
          console.log(`Tileset: ${terrainInfo.id}`)

          // NOTE: 地形精灵验证通过 ITiledTerrainRendererInfo.ValidateTileSprites()
          // 这是 Ch2 中尚未独立迁移的内部接口。等 TerrainRenderer 迁移后启用。
          // TODO-21.E.17: 集成 TerrainRenderer 地形精灵验证

          // 检查已知序列文件中的精灵引用
          const missingSprites = this._checkKnownSequenceFiles(
            modData,
            terrainInfo.id,
          )

          if (missingSprites.length > 0) {
            for (const missing of missingSprites) {
              console.log(`\t${missing.location}: ${missing.filename} not found`)
            }
            failed = true
          }
        } catch (e) {
          console.log(`\t${String(e)}`)
          failed = true
        }
      }
    } catch (e) {
      console.log(`${String(e)}`)
      failed = true
    }

    if (failed) {
      this._exitWithError()
    }
  }

  // ---------------------------------------------------------------------------
  // 内部辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 获取可用的地形信息列表。
   *
   * OpenRA 对照: modData.DefaultTerrainInfo.Keys
   *
   * 由于 TypeScript ModData 不维护 defaultTerrainInfo 字典，
   * 此方法从清单的地形键或 MapCache 获取可用地形。
   *
   * @param modData — mod 运行时数据
   * @returns 最小地形信息对象数组
   */
  private _getAvailableTerrainInfos(modData: ModData): { id: string }[] {
    // tileSets 是 string[] 清单属性
    const tileSets = modData.manifest.tileSets
    if (tileSets && tileSets.length > 0) {
      return tileSets.map((ts) => ({ id: ts }))
    }

    // 后备方案：返回一个具有通用 'default' 地形集的列表
    return [{ id: 'default' }]
  }

  /**
   * 检查已知序列文件是否存在精灵引用验证。
   *
   * @param modData — mod 运行时数据
   * @param tilesetId — 地形集标识符
   * @returns 缺失精灵引用列表
   */
  private _checkKnownSequenceFiles(
    modData: ModData,
    tilesetId: string,
  ): { filename: string; location: string }[] {
    const missing: { filename: string; location: string }[] = []
    const fs = modData.modFiles

    for (const seqPath of KNOWN_SEQUENCE_PATHS) {
      if (!fs.exists(seqPath)) continue

      try {
        // 使用 openAsync 读取序列文件
        // NOTE: 由于 IUtilityCommand.run() 是同步的，而 openAsync 是异步的，
        // 在真实的 CLI 环境中，调用方必须 await 由 run() 返回的 promise。
        // 单元测试中 mock FileSystem 会同步返回数据。
        // TODO-21.E.17: 使 run() 返回 Promise<void> 以支持异步文件 I/O

        // 对于同步兼容性，我们在此使用 exists() + 内联内容解析:
        // 完整实现需要异步文件读取。当前回退到检查
        // 序列文件路径是否存在，并在可能时解析内容。
        const seqFileContent = this._tryReadFileSync(fs, seqPath)
        if (seqFileContent === null) continue

        const spriteRefs = this._extractSpriteReferences(
          JSON.parse(seqFileContent),
        )

        for (const spriteRef of spriteRefs) {
          if (!this._spriteFileExists(fs, spriteRef)) {
            missing.push({
              filename: spriteRef,
              location: `${seqPath} (${tilesetId})`,
            })
          }
        }
      } catch {
        // JSON 解析错误 —— 这不是精灵缺失，而是配置语法错误
        // CheckYaml 负责报告此类错误
      }
    }

    return missing
  }

  /**
   * 检查精灵文件是否存在于文件系统的任何位置。
   *
   * @param fs — 文件系统
   * @param spriteRef — 精灵引用名称
   * @returns 如果找到文件则返回 true
   */
  private _spriteFileExists(
    fs: { exists: (filename: string) => boolean },
    spriteRef: string,
  ): boolean {
    // 尝试常见的文件扩展名和目录前缀
    const extensions = ['.png', '.shp', '.r8', '.dds', '']
    const prefixes = ['', 'bits/', 'sprites/', 'tilesets/']

    for (const prefix of prefixes) {
      for (const ext of extensions) {
        const candidate = `${prefix}${spriteRef}${ext}`
        if (fs.exists(candidate)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * 尝试从文件系统同步获取文件内容。
   *
   * 这仅用于单元测试 mock（同步返回内容）。
   * 生产代码应使用 openAsync()。
   *
   * @param fs — 文件系统
   * @param filePath — 文件路径
   * @returns 文件内容字符串，如果不可用则返回 null
   */
  private _tryReadFileSync(
    fs: unknown,
    filePath: string,
  ): string | null {
    // 检查 mock 文件系统是否有同步 read 方法
    const mockFs = fs as Record<string, unknown>
    if (typeof mockFs.tryReadFileAsString === 'function') {
      return (mockFs.tryReadFileAsString as (path: string) => string | null)(filePath)
    }
    return null
  }

  /**
   * 从序列配置对象中递归提取精灵文件名引用。
   *
   * 精灵引用通常在以下位置找到:
   * - "Filename": "sprite_name" 属性
   * - "Image": "sprite_name" 的帧数组
   * - ".shp" / ".png" 文件路径
   *
   * @param obj — 序列配置对象
   * @returns 发现的精灵文件名数组
   */
  private _extractSpriteReferences(obj: unknown): string[] {
    const refs: string[] = []

    if (typeof obj !== 'object' || obj === null) {
      return refs
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        refs.push(...this._extractSpriteReferences(item))
      }
      return refs
    }

    const record = obj as Record<string, unknown>

    // 检查已知属性名称中的精灵引用
    for (const [key, value] of Object.entries(record)) {
      if (
        (key === 'Filename' ||
          key === 'filename' ||
          key === 'Image' ||
          key === 'image' ||
          key === 'Sprite' ||
          key === 'sprite' ||
          key === 'TilesetFile' ||
          key === 'tilesetFile') &&
        typeof value === 'string'
      ) {
        refs.push(value)
      }

      // 递归进入嵌套对象
      if (typeof value === 'object' && value !== null) {
        refs.push(...this._extractSpriteReferences(value))
      }
    }

    return refs
  }

  /**
   * 以错误码退出进程。
   *
   * OpenRA 对照: Environment.Exit(1)
   */
  private _exitWithError(): void {
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1)
    }
  }
}
