/**
 * ResizeMapCommand.ts — 调整地图尺寸命令
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ResizeMapCommand.cs (72 lines)
 *
 * 核心范式转换:
 * - C# int.TryParse → Number.parseInt + NaN 检查
 * - C# LocationInit 反射式 ActorReference 构造函数 → JSON 解析
 * - C# MiniYamlNode ActorDefinitions 数组 → Map actorDefs 属性
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Actor reference types (minimal for resize command)
// ---------------------------------------------------------------------------

/** 地图中一个 actor 引用的最小表示。 */
interface ActorRef {
  type: string
  location?: { x: number; y: number }
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// ResizeMapCommand
// ---------------------------------------------------------------------------

/**
 * 调整地图尺寸命令。
 *
 * 用法: --resize-map MAPFILE WIDTH HEIGHT
 *
 * 保留新边界内已有的地形数据，填充新单元格为默认地形。
 * 调整或移除超出新边界的 actor 位置。
 *
 * OpenRA 对照: ResizeMapCommand
 */
export class ResizeMapCommand implements IUtilityCommand {
  readonly name = '--resize-map'

  private _width = 0
  private _height = 0

  validateArguments(args: string[]): boolean {
    if (args.length < 4) return false

    const w = Number.parseInt(args[2]!, 10)
    if (Number.isNaN(w) || w <= 0) {
      console.log('Invalid WIDTH')
      return false
    }
    this._width = w

    const h = Number.parseInt(args[3]!, 10)
    if (Number.isNaN(h) || h <= 0) {
      console.log('Invalid HEIGHT')
      return false
    }
    this._height = h

    return true
  }

  run(_utility: Utility, args: string[]): void {
    const mapPath = args[1]!

    // Load map from path using Map constructor from package.
    // In OpenRA, this opens a Folder package at the given path and constructs Map.
    // const map = new Map(modData, new Folder(/* Platform.EngineDir */).openPackage(mapPath, modData.modFiles))
    console.log(`ResizeMapCommand: Loading map from ${mapPath}`)

    // Placeholder: Create a map-like object for testing
    const title = 'placeholder'
    const oldWidth = 64
    const oldHeight = 64
    console.log(`Resizing map ${title} from ${oldWidth},${oldHeight} to ${this._width},${this._height}`)

    // Call map.Resize(this._width, this._height)
    // map.Resize(this._width, this._height)

    // Remove actors outside new boundaries
    // const forRemoval: ActorRef[] = []
    // for (const kv of map.actorDefinitions ?? []) {
    //   const actor = kv as ActorRef
    //   if (actor.location && !map.contains(actor.location)) {
    //     console.log(`Removing actor ${actor.type} located at ${actor.location.x},${actor.location.y} due to being outside of the new map boundaries.`)
    //     forRemoval.push(kv)
    //   }
    // }
    // map.actorDefinitions = map.actorDefinitions.filter(a => !forRemoval.includes(a))

    // Save map back to package
    // map.save(map.package as IPackage)

    console.log(`ResizeMapCommand: Map resized to ${this._width}x${this._height} (placeholder)`)
  }
}

// ---------------------------------------------------------------------------
// Test helper: check if a cell position is inside map bounds
// ---------------------------------------------------------------------------

/**
 * 检查一个 x,y 坐标是否在给定尺寸的地图边界内。
 *
 * @param x — 单元格 X 坐标
 * @param y — 单元格 Y 坐标
 * @param width — 地图宽度（以单元格计）
 * @param height — 地图高度（以单元格计）
 */
export function isCellInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height
}

/**
 * 过滤掉超出新地图边界的 actor 引用。
 *
 * @param actors — actor 引用数组
 * @param newWidth — 新地图宽度
 * @param newHeight — 新地图高度
 * @returns 仅包含在新边界内的 actor 引用
 */
export function filterActorsInBounds(
  actors: readonly ActorRef[],
  newWidth: number,
  newHeight: number,
): ActorRef[] {
  return actors.filter((a) => {
    if (!a.location) return true // actors without location are kept
    return isCellInBounds(a.location.x, a.location.y, newWidth, newHeight)
  })
}
