/**
 * ShroudPalette.ts — C&C 硬编码迷雾/黑幕调色板
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/ShroudPalette.cs
 *
 * 核心范式转换:
 * - C# static readonly Color[] (System.Drawing.Color) → const readonly number[] (uint32 ARGB)
 * - C# Color.FromArgb(a, r, g, b) → toArgb(a, r, g, b) from Color.ts
 * - C# Enumerable.Range(0, Palette.Size).Select(i => c[i % 8].ToArgb())
 *   → for loop building number[] + ImmutablePalette.fromColors()
 * - C# TraitInfo.Create() factory → TypeScript constructor pattern
 * - C# IProvidesAssetBrowserPalettes → TODO-12.DEFERRED.17 (editor tooling only)
 *
 * NOTE: ShroudPalette is a C&C-specific world trait. It provides two hard-coded
 * 256-color palettes: "shroud" (unexplored terrain) and "fog" (fog of war).
 * Each palette cycles through 8 base colors using c[i % 8], giving a repeating
 * pattern of dark-to-black steps across all 256 entries.
 */

import { toArgb } from '../../../OpenRA.Game/Primitives/Color.js'
import { ImmutablePalette, PALETTE_SIZE, type IPalette } from '../../../OpenRA.Game/Graphics/Palette.js'
import {
  type ILoadsPalettes,
  type ITraitInfo,
  type WorldRendererStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IPaletteWorldRenderer — local extension of WorldRendererStub
//
// WorldRendererStub is intentionally minimal to avoid circular dependencies.
// This local interface adds the addPalette method used by palette-loading
// traits. At runtime, the actual WorldRenderer satisfies this interface.
// ---------------------------------------------------------------------------

/**
 * WorldRendererStub 的本地扩展，添加 addPalette 方法。
 *
 * 用于 ILoadsPalettes 实现。实际运行时 WorldRenderer 满足此接口。
 *
 * @internal
 */
export interface IPaletteWorldRenderer extends WorldRendererStub {
  /**
   * 添加调色板。
   *
   * OpenRA 对照: WorldRenderer.AddPalette(string name, ImmutablePalette pal)
   *
   * @param name — 调色板名称
   * @param pal — 调色板实例
   * @param allowModifiers — 是否允许玩家颜色修改器
   * @param allowOverwrite — 是否允许覆盖已有调色板
   */
  addPalette(name: string, pal: IPalette, allowModifiers?: boolean, allowOverwrite?: boolean): void
}

// ---------------------------------------------------------------------------
// 8 种基础颜色 — FOG
//
// OpenRA 对照: ShroudPalette.Fog[] (ShroudPalette.cs:48-56)
//
// Colors 0-3 are bright debug markers; colors 4-7 are semi-transparent
// black steps that create the fog-of-war darkening effect.
// ---------------------------------------------------------------------------

const FOG_BASE: readonly number[] = [
  toArgb(0, 0, 0, 0),       // [0] 完全透明
  toArgb(255, 0, 128, 0),   // [1] Green (System.Drawing.Color.Green)
  toArgb(255, 0, 0, 255),   // [2] 蓝色（调试可见）
  toArgb(255, 255, 255, 0), // [3] 黄色（调试可见）
  toArgb(128, 0, 0, 0),     // [4] 50% 黑色
  toArgb(96, 0, 0, 0),      // [5] 37.5% 黑色
  toArgb(64, 0, 0, 0),      // [6] 25% 黑色
  toArgb(32, 0, 0, 0),      // [7] 12.5% 黑色
]

// ---------------------------------------------------------------------------
// 8 种基础颜色 — SHROUD
//
// OpenRA 对照: ShroudPalette.Shroud[] (ShroudPalette.cs:58-66)
//
// Colors 0-3 are same bright debug markers as FOG; colors 4-7 differ:
// shroud starts from full black at [4] and steps to a darker final value.
// ---------------------------------------------------------------------------

const SHROUD_BASE: readonly number[] = [
  toArgb(0, 0, 0, 0),       // [0] 完全透明
  toArgb(255, 0, 128, 0),   // [1] Green (System.Drawing.Color.Green)
  toArgb(255, 0, 0, 255),   // [2] 蓝色（调试可见）
  toArgb(255, 255, 255, 0), // [3] 黄色（调试可见）
  toArgb(255, 0, 0, 0),     // [4] 黑色（完全）
  toArgb(160, 0, 0, 0),     // [5] ~62.5% 黑色
  toArgb(128, 0, 0, 0),     // [6] 50% 黑色
  toArgb(64, 0, 0, 0),      // [7] 25% 黑色
]

// ---------------------------------------------------------------------------
// ShroudPaletteInfo — 配置元数据
//
// OpenRA 对照: ShroudPaletteInfo (ShroudPalette.cs:23-34)
//
// TraitLocation: SystemActors.World | SystemActors.EditorWorld
// ---------------------------------------------------------------------------

/**
 * ShroudPalette trait 的配置信息。
 *
 * OpenRA 对照: ShroudPaletteInfo（TraitInfo 子类）
 *
 * [PaletteDefinition] [FieldLoader.Require]
 */
export class ShroudPaletteInfo implements ITraitInfo {
  /**
   * 可选的实例名称，用于同一 actor 上同一类型多个 trait 的消歧。
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /**
   * 内部调色板名称。
   *
   * OpenRA 对照: ShroudPaletteInfo.Name (string, default "shroud")
   *
   * [PaletteDefinition] [FieldLoader.Require]
   */
  readonly Name: string

  /**
   * 调色板类型。
   *
   * OpenRA 对照: ShroudPaletteInfo.Fog (bool, default false)
   *
   * - false: shroud palette (unexplored terrain — darker, starts from full black)
   * - true: fog palette (fog of war — lighter, starts from 50% black)
   */
  readonly Fog: boolean

  constructor(name = 'shroud', fog = false) {
    this.Name = name
    this.Fog = fog
  }
}

// ---------------------------------------------------------------------------
// ShroudPalette — 调色板加载
//
// OpenRA 对照: ShroudPalette (ShroudPalette.cs:36-69)
//
// Implements ILoadsPalettes.
// NOTE: IProvidesAssetBrowserPalettes is deferred (TODO-12.DEFERRED.17) —
// it is only needed for the map editor asset browser, not gameplay.
// ---------------------------------------------------------------------------

/**
 * 为世界提供硬编码迷雾/黑幕调色板。
 *
 * OpenRA 对照: ShroudPalette (ILoadsPalettes)
 *
 * 通过循环 8 种基础颜色生成完整的 256 色调色板。
 * 两个变体：
 * - "shroud"：未探索区域（从纯黑开始）
 * - "fog"：战争迷雾（从 50% 黑开始，更透明）
 *
 * Color[i] = base[i % 8]，i = 0..255
 *
 * NOTE: IProvidesAssetBrowserPalettes 已推迟。
 * TODO-12.DEFERRED.17: 实现 IProvidesAssetBrowserPalettes 用于编辑器资源浏览器集成。
 */
export class ShroudPalette implements ILoadsPalettes {
  readonly info: ShroudPaletteInfo

  /**
   * 从配置信息创建 ShroudPalette 实例。
   *
   * OpenRA 对照: ShroudPalette(ShroudPaletteInfo info) 构造函数
   */
  constructor(info: ShroudPaletteInfo) {
    this.info = info
  }

  /**
   * 加载调色板到世界渲染器。
   *
   * OpenRA 对照: ShroudPalette.LoadPalettes(WorldRenderer wr)
   *
   * 根据配置创建 shroud 或 fog 调色板：
   * 1. 选择基础颜色数组（SHROUD_BASE 或 FOG_BASE）
   * 2. 循环填充 256 个颜色：color[i] = base[i % 8]
   * 3. 创建 ImmutablePalette 并通过 wr.addPalette() 注册
   *
   * @param wr — 世界渲染器
   */
  loadPalettes(wr: WorldRendererStub): void {
    const c = this.info.Fog ? FOG_BASE : SHROUD_BASE
    const colors: number[] = new Array<number>(PALETTE_SIZE)
    for (let i = 0; i < PALETTE_SIZE; i++) {
      colors[i] = c[i % 8]!
    }
    // NOTE: 转换为 IPaletteWorldRenderer — 运行时 WorldRenderer 总是实现 addPalette
    (wr as IPaletteWorldRenderer).addPalette(this.info.Name, ImmutablePalette.fromColors(colors))
  }
}
