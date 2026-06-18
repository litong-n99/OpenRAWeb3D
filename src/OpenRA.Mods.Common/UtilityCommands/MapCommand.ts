/**
 * MapCommand.ts — 地图实用工具命令，支持 refresh/unpack/repack 子命令
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/MapCommand.cs (91 lines)
 *
 * 核心范式转换:
 * - C# Console.WriteLine → Node.js console.log
 * - C# MapCache.LoadMaps + MapLocations 迭代 → MapCache.mapLocations + package.contents
 * - C# (IReadWritePackage)mapPackage → IPackage 类型转换
 * - C# ZipFileLoader.ReadWriteZipFile → fflate-based zip read/write
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// MapCommand
// ---------------------------------------------------------------------------

/**
 * 地图实用工具命令，支持三个子命令:
 * - refresh: 重新格式化 map.yaml 并重新生成预览
 * - unpack: 将 .oramap 文件解包到文件夹
 * - repack: 将文件夹重新打包为 .oramap 文件
 *
 * OpenRA 对照: MapCommand (sealed class, implements IUtilityCommand)
 */
export class MapCommand implements IUtilityCommand {
  readonly name = '--map'

  validateArguments(args: string[]): boolean {
    if (args.length < 2) return false
    const validSubcommands = new Set(['refresh', 'unpack', 'repack'])
    if (!validSubcommands.has(args[1]!)) return false
    if (args.length >= 3) {
      try {
        new RegExp(args[2]!)
      } catch {
        return false
      }
    }
    return true
  }

  run(utility: Utility, args: string[]): void {
    const subcommand = args[1]! as 'refresh' | 'unpack' | 'repack'
    let filenameRegex: RegExp | null = null
    if (args.length >= 3) {
      filenameRegex = new RegExp(args[2]!)
    }

    const modData = utility.modData
    const mapCache = modData.mapCache

    // NOTE: In OpenRA, MapCache.LoadMaps must be called before iterating MapLocations.
    // Our MapCache's loadMaps() requires a ModDataStub (getOrCreate + mapFolders).
    // The caller should load maps before invoking this command.
    // TODO-21.E.6: Either add mapFolders to ModData or create ModDataStub adapter.

    // mapLocations: ReadonlyMap<IReadOnlyPackage, MapClassification>
    // keys are packages, values are MapClassification enum values.
    // We iterate over each package's contents (filenames) to find matching maps.
    const locations = mapCache.mapLocations
    for (const [pkg] of locations) {
      for (const mapFilename of pkg.contents) {
        if (filenameRegex && !filenameRegex.test(mapFilename)) continue

        const mapPackage = pkg.openPackage(mapFilename, modData.modFiles)
        if (!mapPackage) {
          console.warn(`MapCommand: Could not open package for ${mapFilename}`)
          continue
        }

        try {
          // TODO-21.E.6: Create Map from ModData and package.
          // const map = new Map(modData, mapPackage)

          switch (subcommand) {
            case 'refresh':
              // TODO-21.E.6: map.Save(mapPackage as IPackage)
              console.log(`MapCommand: refresh ${mapFilename} — TODO: Map.Save() not yet implemented`)
              break

            case 'unpack':
              // TODO-21.E.6: If mapPackage is a ZipFile, save to Folder
              console.log(`MapCommand: unpack ${mapFilename} — TODO: zip→folder conversion not yet implemented`)
              break

            case 'repack':
              // TODO-21.E.6: If mapPackage is a Folder, repack to zip
              console.log(`MapCommand: repack ${mapFilename} — TODO: folder→zip conversion not yet implemented`)
              break
          }
        } finally {
          mapPackage.dispose?.()
        }
      }
    }
  }
}
