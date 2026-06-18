/**
 * DebugChromeRegions.ts — 为 UI 皮肤图像生成交互式调试叠加层
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/DebugChromeRegions.cs (185 lines)
 *
 * 核心范式转换:
 * - C# Sheet.SheetData → base64 编码的 PNG 字节（通过 FileSystem 读取）
 * - C# ChromeProvider.Collections 迭代 → ChromeProvider.collections (TypeScript ReadonlyMap)
 * - C# Rectangle (X, Y, Width, Height) → { x, y, width, height } 接口
 * - C# PanelSides.HasSide() 位掩码检查 → hasSide() 工具函数
 * - C# File.WriteAllLines → 返回 HTML 字符串（调用方处理 I/O）
 *
 * 此命令生成一个独立的 HTML 页面，在画布上渲染皮肤图像，
 * 并用黄色矩形叠加每个 chrome 区域。悬停时在控制台中输出区域名称。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { ChromeProvider, hasSide } from '../../OpenRA.Game/Graphics/ChromeProvider.js'
import { PanelSides } from '../../OpenRA.Game/Graphics/ChromeProvider.js'

// ---------------------------------------------------------------------------
// ChromeRegion — 用于 HTML 生成的 chrome 区域描述符
// ---------------------------------------------------------------------------

/**
 * 序列化的 chrome 区域，用于 HTML/画布渲染。
 *
 * OpenRA 对照: [name, x, y, width, height] 元组格式
 */
export interface ChromeRegion {
  /** 区域名称（例如 "button.default" 或 "dialog2.<Top, Left>"）。 */
  readonly name: string
  /** 区域左上角的 X 坐标。 */
  readonly x: number
  /** 区域左上角的 Y 坐标。 */
  readonly y: number
  /** 区域宽度。 */
  readonly width: number
  /** 区域高度。 */
  readonly height: number
}

// ---------------------------------------------------------------------------
// HTML 模板 — 内联脚本在画布上渲染皮肤图像 + 区域矩形
// OpenRA 对照: HtmlTemplate string[] 数组，使用 JoinWith + FormatInvariant 拼接
// ---------------------------------------------------------------------------

/** 生成完整的 HTML 页面字符串。
 *
 * OpenRA 对照: HtmlTemplate.JoinWith("\n").FormatInvariant(zoom, base64Image, regionsJson)
 */
export function buildChromeDebugPage(
  zoom: number,
  base64Image: string,
  regions: readonly ChromeRegion[],
): string {
  // 将区域序列化为 JSON 字符串以嵌入到 JS 中
  // 格式: [name, x, y, width, height] 元组数组
  const regionsJson = JSON.stringify(
    regions.map((r) => [r.name, r.x, r.y, r.width, r.height]),
  )

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8"/>',
    '</head>',
    '<body>',
    '<canvas id="canvas" style="cursor: crosshair;"></canvas>',
    '<script>',
    `var zoom = ${zoom};`,
    `var chromeImage = "data:image/png;base64,${base64Image}";`,
    `var chromeRegions = ${regionsJson}`,
    'function setup() {',
    '  var c = document.getElementById("canvas");',
    '  var ctx = c.getContext("2d");',
    '  var image = new Image;',
    '  image.onload = function() {',
    '    c.width = zoom*image.width;',
    '    c.height = zoom*image.height;',
    '    ctx.fillStyle = "#dddddd";',
    '    for (var j = 0; j < ctx.canvas.height / 4; j++)',
    '      for (var i = j % 2; i < ctx.canvas.width / 4; i += 2)',
    '        ctx.fillRect(4 * i, 4 * j, 4, 4);',
    '    ctx.imageSmoothingEnabled = false;',
    '    ctx.drawImage(image, 0, 0, c.width, c.height);',
    '    ctx.strokeStyle = "#ffff00";',
    '    ctx.lineWidth = 1;',
    '    for (var i = 0; i < chromeRegions.length; i++) {',
    '      var r = chromeRegions[i];',
    '      ctx.strokeRect(zoom*r[1], zoom*r[2], zoom*r[3], zoom*r[4]);',
    '    }',
    '  };',
    '  var mouseover = undefined;',
    "  c.addEventListener('mousemove', function(e) {",
    '    var cr = c.getBoundingClientRect();',
    '    var x = (e.clientX - cr.left) / (cr.right - cr.left) * c.width / zoom;',
    '    var y = (e.clientY - cr.top) / (cr.bottom - cr.top) * c.height / zoom;',
    '    var lastover = mouseover;',
    '    mouseover = undefined;',
    '    for (var i = 0; i < chromeRegions.length; i++) {',
    '      var r = chromeRegions[i];',
    '      if (x >= r[1] && x < r[1] + r[3] && y >= r[2] && y < r[2] + r[4])',
    '        mouseover = r[0];',
    '    }',
    '    if (lastover != mouseover && mouseover)',
    '      console.log(mouseover);',
    '  });',
    '  image.src = chromeImage;',
    '}',
    'window.onload = setup;',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// PanelSide 区域 — 用于 9 片面板的区域生成
// OpenRA 对照: DebugChromeRegions.Run() 内的内联 "sides" 数组
// ---------------------------------------------------------------------------

/**
 * 为单个名称生成 9 片面板区域。
 *
 * 给定一个 PanelRegion 数组 [x, y, wTL, hTop, wC, hC, wBR, hBottom]
 * 和显示哪一侧（PanelSides 位掩码），返回该侧包含的区域。
 *
 * OpenRA 对照: 9 元素 "sides" 数组，构造自:
 * ```
 * (PanelSides.Top | PanelSides.Left, new Rectangle(pr[0], pr[1], pr[2], pr[3])),
 * (PanelSides.Top, new Rectangle(pr[0] + pr[2], pr[1], pr[4], pr[3])),
 * ...
 * ```
 *
 * @param name — 基础区域名称（例如 "dialog2"）
 * @param panelRegion — 8 个元素的区域数组 [x,y,wTL,hTop,wC,hC,wBR,hBottom]
 * @param sides — PanelSides 位掩码，选择哪些面板边框有效
 * @returns 有效面板边框对应的 ChromeRegion 条目数组
 */
export function generatePanelSides(
  name: string,
  panelRegion: readonly number[],
  sides: number,
): ChromeRegion[] {
  if (panelRegion.length !== 8) return []

  const pr = panelRegion

  // 9 个面板边框条目: (PanelSides, Rectangle)
  const sideEntries: { sides: number; x: number; y: number; w: number; h: number; nameSuffix: string }[] = [
    { sides: PanelSides.Top | PanelSides.Left,   x: pr[0],                     y: pr[1],                         w: pr[2], h: pr[3], nameSuffix: '<Top, Left>' },
    { sides: PanelSides.Top,                      x: pr[0] + pr[2],             y: pr[1],                         w: pr[4], h: pr[3], nameSuffix: '<Top>' },
    { sides: PanelSides.Top | PanelSides.Right,   x: pr[0] + pr[2] + pr[4],    y: pr[1],                         w: pr[6], h: pr[3], nameSuffix: '<Top, Right>' },
    { sides: PanelSides.Left,                     x: pr[0],                     y: pr[1] + pr[3],                 w: pr[2], h: pr[5], nameSuffix: '<Left>' },
    { sides: PanelSides.Center,                   x: pr[0] + pr[2],             y: pr[1] + pr[3],                 w: pr[4], h: pr[5], nameSuffix: '<Center>' },
    { sides: PanelSides.Right,                    x: pr[0] + pr[2] + pr[4],    y: pr[1] + pr[3],                 w: pr[6], h: pr[5], nameSuffix: '<Right>' },
    { sides: PanelSides.Bottom | PanelSides.Left, x: pr[0],                     y: pr[1] + pr[3] + pr[5],        w: pr[2], h: pr[7], nameSuffix: '<Bottom, Left>' },
    { sides: PanelSides.Bottom,                   x: pr[0] + pr[2],             y: pr[1] + pr[3] + pr[5],        w: pr[4], h: pr[7], nameSuffix: '<Bottom>' },
    { sides: PanelSides.Bottom | PanelSides.Right,x: pr[0] + pr[2] + pr[4],    y: pr[1] + pr[3] + pr[5],        w: pr[6], h: pr[7], nameSuffix: '<Bottom, Right>' },
  ]

  const results: ChromeRegion[] = []
  for (const entry of sideEntries) {
    // 仅当面板边框集合包含此条目时包含 — hasSide 检查集合层面板是否覆盖此条目侧
    if (hasSide(sides, entry.sides)) {
      results.push({
        name: `${name}.${entry.nameSuffix}`,
        x: entry.x,
        y: entry.y,
        width: entry.w,
        height: entry.h,
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// DebugChromeRegions
// ---------------------------------------------------------------------------

/**
 * Chrome 区域调试可视化命令。
 *
 * 用法: --debug-chrome-regions IMAGE ZOOM
 *
 * 生成一个独立的 HTML 页面，在画布上渲染皮肤图像，
 * 并用黄色矩形叠加每个 chrome 区域。区域名称在悬停时输出到控制台。
 *
 * 输出: 基于输入图像路径的 `.html` 文件（或字符串，供调用方写入）。
 *
 * OpenRA 对照: sealed class DebugChromeRegions : IUtilityCommand
 */
export class DebugChromeRegions implements IUtilityCommand {
  readonly name = '--debug-chrome-regions'

  validateArguments(args: string[]): boolean {
    return args.length === 3
  }

  /**
   * 执行 chrome 区域调试生成。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文（提供 FileSystem 访问）
   * @param args — 参数数组 [commandName, image, zoom]
   */
  run(_utility: Utility, args: string[]): void {
    const imageFn = args[1]
    const zoom = parseInt(args[2], 10)

    if (isNaN(zoom) || zoom < 1) {
      throw new Error(`Invalid zoom value: ${args[2]}. Must be a positive integer.`)
    }

    // 检查 ChromeProvider 是否已初始化
    // NOTE: 在完整的 CLI 环境中，ChromeProvider.initialize(manifest, fileSystem)
    // 应在调用此命令之前已经调用。
    if (!ChromeProvider.initialized) {
      console.warn(
        'DebugChromeRegions: ChromeProvider not initialized. ' +
          'Call ChromeProvider.initialize() first.',
      )
    }

    // 按图像筛选集合并构建区域列表
    const regions: ChromeRegion[] = []
    for (const [collectionKey, collection] of ChromeProvider.collections) {
      // 检查此集合是否引用目标图像
      const collImage = collection.image
      if (!collImage || collImage !== imageFn) {
        // NOTE: OpenRA 通过 ChromeProvider.SheetForCollection() 比较 "image" 参数，
        // 它将 sheet.Bitmap 映射到其原始文件名。
        // 我们的 Collection 直接存储图像 URL，因此直接比较。
        continue
      }

      // 生成面板区域（如果存在 PanelRegion）
      const pr = collection.panelRegion
      if (pr && pr.region.length === 8) {
        const panelSides = generatePanelSides(collectionKey, pr.region, pr.sides)
        for (const ps of panelSides) {
          regions.push(ps)
        }
      }

      // 按名称排序生成命名区域
      const sortedRegionKeys = [...collection.regions.keys()].sort()
      for (const regionKey of sortedRegionKeys) {
        const r = collection.regions.get(regionKey)
        if (r) {
          regions.push({
            name: `${collectionKey}.${regionKey}`,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          })
        }
      }
    }

    // 通过 FileSystem 读取 imageFn 的 PNG 字节。
    // 在完整的 CLI 环境中:
    // ```
    // const data = modData.modFiles.open(imageFn)?.readAllBytes()
    // const base64Image = base64Encode(data)
    // ```
    // 目前，调用方通过 generatePage() 提供 base64 编码的图像数据。
    console.warn(
      `DebugChromeRegions: Found ${regions.length} region(s) for image '${imageFn}'. ` +
        `Use generatePage() with base64-encoded image data to produce the HTML output.`,
    )

    // 输出区域摘要
    for (const region of regions) {
      console.log(`  ${region.name}: (${region.x}, ${region.y}, ${region.width}x${region.height})`)
    }
  }

  /**
   * 生成完整的 HTML 调试页面。
   *
   * 与 run() 不同，此方法接受 base64 编码的图像数据，
   * 并返回完整的 HTML 字符串。
   *
   * @param imageFn — 图像文件名（用于日志）
   * @param zoom — 缩放乘数
   * @param base64Image — base64 编码的 PNG 数据
   * @returns 完整的 HTML 页面字符串
   */
  generatePage(imageFn: string, zoom: number, base64Image: string): string {
    const regions: ChromeRegion[] = []

    for (const [collectionKey, collection] of ChromeProvider.collections) {
      const collImage = collection.image
      if (!collImage || collImage !== imageFn) {
        continue
      }

      const pr = collection.panelRegion
      if (pr && pr.region.length === 8) {
        const panelSides = generatePanelSides(collectionKey, pr.region, pr.sides)
        for (const ps of panelSides) {
          regions.push(ps)
        }
      }

      const sortedRegionKeys = [...collection.regions.keys()].sort()
      for (const regionKey of sortedRegionKeys) {
        const r = collection.regions.get(regionKey)
        if (r) {
          regions.push({
            name: `${collectionKey}.${regionKey}`,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          })
        }
      }
    }

    return buildChromeDebugPage(zoom, base64Image, regions)
  }
}
