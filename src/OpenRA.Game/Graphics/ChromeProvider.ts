/**
 * ChromeProvider.ts — UI 皮肤资源管理器
 * OpenRA 对照: OpenRA.Game/Graphics/ChromeProvider.cs (305 lines)
 *
 * 核心范式转换:
 * - OpenRA Sheet / Sprite[] 9 片面板 → CSS border-image with border-image-slice
 * - OpenRA SheetForCollection DPI 选择 → CSS image-set() for responsive image selection
 * - OpenRA GetImage → resolveImage 解析 DPI 感知的 URL
 * - OpenRA PanelRegion int[] → PanelRegion 接口 + getPanelSliceCss
 * - OpenRA cachedSheets / cachedSprites → 无运行时缓存（CSS 处理）
 * - OpenRA Sprite.TryGetImage → 无运行时 Sprite 对象（纯 URL 解析）
 */

import type { Manifest } from '../Manifest.js'
import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// PanelSides — 面板边框面位掩码
// OpenRA 对照: PanelSides enum (ChromeProvider.cs:22-34)
// ---------------------------------------------------------------------------

/** 面板边框面位掩码常量。OpenRA 对照: PanelSides enum */
export const PanelSides = {
  Left: 1,
  Top: 2,
  Right: 4,
  Bottom: 8,
  Center: 16,
  Edges: 1 | 2 | 4 | 8,
  All: 1 | 2 | 4 | 8 | 16,
} as const

/** 面板边框面位掩码类型。 */
export type PanelSides = number

// ---------------------------------------------------------------------------
// hasSide — 位掩码成员检测
// OpenRA 对照: PanelSidesExts.HasSide
// ---------------------------------------------------------------------------

/** 检查 self 是否包含 side 的所有位。
 *
 * OpenRA 对照: PanelSidesExts.HasSide(this PanelSides, PanelSides)
 *
 * 用法: hasSide(PanelSides.Edges, PanelSides.Left) → true
 *
 * @param self — 包含位掩码的面
 * @param side — 要检查的位
 * @returns 如果 self 包含 side 的所有位则返回 true
 */
export function hasSide(self: PanelSides, side: PanelSides): boolean {
  return (self & side) === side
}

// ---------------------------------------------------------------------------
// PanelRegion — 9 片面板布局参数
// OpenRA 对照: Collection.PanelRegion (ImmutableArray<int>)
// ---------------------------------------------------------------------------

/** 9 片面板布局参数。
 *
 * 8 个整数定义了面板的 9 片切分:
 * `[x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom]`
 *
 * ```
 * ┌─────┬───────────┬─────┐
 * │ TL  │    Top    │ TR  │   hTop
 * ├─────┼───────────┼─────┤
 * │  L  │  Center   │  R  │   hCenter
 * ├─────┼───────────┼─────┤
 * │ BL  │  Bottom   │ BR  │   hBottom
 * └─────┴───────────┴─────┘
 *   wTop    wCenter    wBottom
 * ```
 *
 * OpenRA 对照: Collection.PanelRegion (int[])
 */
export interface PanelRegion {
  /** 8 个整数: [x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom] */
  readonly region: readonly number[]
  /** 此集合的面位掩码（决定哪些切片可见）。 */
  readonly sides: PanelSides
}

// ---------------------------------------------------------------------------
// Collection — UI 皮肤资源集合
// OpenRA 对照: ChromeProvider.Collection
// ---------------------------------------------------------------------------

/** UI 皮肤资源集合。
 *
 * 定义一个命名皮肤，包含图像引用、9 片面板参数和命名区域。
 *
 * OpenRA 对照: ChromeProvider.Collection
 */
export class Collection {
  /** 1x DPI 图像 URL。OpenRA 对照: Collection.Image */
  readonly image: string | null

  /** 2x DPI 图像 URL。OpenRA 对照: Collection.Image2x */
  readonly image2x: string | null

  /** 3x DPI 图像 URL。OpenRA 对照: Collection.Image3x */
  readonly image3x: string | null

  /** 9 片面板区域参数（如果有）。OpenRA 对照: Collection.PanelRegion */
  readonly panelRegion: PanelRegion | null

  /** 面板侧面位掩码。OpenRA 对照: Collection.PanelSides */
  readonly panelSides: PanelSides

  /** 命名矩形区域映射。OpenRA 对照: Collection.Regions (FrozenDictionary<string, Rectangle>) */
  readonly regions: Map<string, { x: number; y: number; width: number; height: number }>

  /**
   * 从 JSON 对象构造 Collection。
   *
   * @param json — 从 chrome YAML 预编译的 JSON 对象
   */
  constructor(json: Record<string, unknown>) {
    this.image = typeof json['Image'] === 'string' ? (json['Image'] as string) : null
    this.image2x = typeof json['Image2x'] === 'string' ? (json['Image2x'] as string) : null
    this.image3x = typeof json['Image3x'] === 'string' ? (json['Image3x'] as string) : null

    // Parse PanelRegion
    const pr = json['PanelRegion']
    if (Array.isArray(pr) && pr.length === 8) {
      this.panelRegion = {
        region: pr.map(Number),
        sides: typeof json['PanelSides'] === 'number'
          ? (json['PanelSides'] as number)
          : PanelSides.All,
      }
    } else {
      this.panelRegion = null
    }

    this.panelSides = typeof json['PanelSides'] === 'number'
      ? (json['PanelSides'] as number)
      : PanelSides.All

    // Parse Regions
    this.regions = new Map()
    const regionsRaw = json['Regions']
    if (regionsRaw && typeof regionsRaw === 'object' && !Array.isArray(regionsRaw)) {
      for (const [name, rect] of Object.entries(
        regionsRaw as Record<string, unknown>,
      )) {
        if (rect && typeof rect === 'object' && !Array.isArray(rect)) {
          const r = rect as Record<string, unknown>
          this.regions.set(name, {
            x: Number(r['X'] ?? r['x'] ?? 0),
            y: Number(r['Y'] ?? r['y'] ?? 0),
            width: Number(r['Width'] ?? r['width'] ?? 0),
            height: Number(r['Height'] ?? r['height'] ?? 0),
          })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ChromeProvider — UI 皮肤资源管理器
// OpenRA 对照: ChromeProvider static class
// ---------------------------------------------------------------------------

/** UI 皮肤资源管理器。
 *
 * 提供命名皮肤集合的访问，以及 DPI 感知的图像 URL 解析。
 *
 * CSS 集成:
 * - PanelRegion → CSS border-image with border-image-slice
 * - HiDPI → CSS image-set() for responsive image selection
 * - Sprite 引用 → CSS background-image / border-image rules
 *
 * TS 版本不创建运行时 sprite — 所有视觉输出通过 CSS 实现。
 *
 * OpenRA 对照: static class ChromeProvider
 */
export class ChromeProvider {
  /** 皮肤集合映射: 集合名 → Collection。 */
  private static _collections = new Map<string, Collection>()

  /** DPI 缩放比例（默认 1）。OpenRA 对照: dpiScale */
  private static _dpiScale: number = 1

  /** 是否已初始化。 */
  private static _initialized = false

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** 获取所有已注册的集合（只读）。OpenRA 对照: ChromeProvider.Collections */
  static get collections(): ReadonlyMap<string, Collection> {
    return ChromeProvider._collections
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // OpenRA 对照: Initialize / Deinitialize
  // ---------------------------------------------------------------------------

  /** 从 mod manifest 初始化。
   *
   * 加载 manifest.chrome 中列出的所有 chrome YAML 文件（已预编译为 JSON），
   * 解析为 Collection 对象。
   *
   * OpenRA 对照: ChromeProvider.Initialize(ModData)
   *
   * @param manifest — mod 清单
   * @param fileSystem — 用于读取 chrome JSON 文件的文件系统
   */
  static async initialize(
    manifest: Manifest,
    fileSystem: IReadOnlyFileSystem,
  ): Promise<void> {
    ChromeProvider.deinitialize()

    for (const file of manifest.chrome) {
      const data = await fileSystem.openAsync(file)
      if (!data) {
        // Skip files that can't be opened (matching OpenRA's graceful handling
        // through MiniYaml.Merge which skips missing files silently)
        continue
      }
      const text = new TextDecoder().decode(data)
      const json = JSON.parse(text) as Record<string, unknown>

      for (const [key, value] of Object.entries(json)) {
        // Skip keys starting with '^' (overlay/merge markers)
        if (key.startsWith('^')) continue

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          ChromeProvider._collections.set(
            key,
            new Collection(value as Record<string, unknown>),
          )
        }
      }
    }

    ChromeProvider._initialized = true
  }

  /** 清理所有数据。OpenRA 对照: ChromeProvider.Deinitialize() */
  static deinitialize(): void {
    ChromeProvider._collections.clear()
    ChromeProvider._dpiScale = 1
    ChromeProvider._initialized = false
  }

  // ---------------------------------------------------------------------------
  // Image Resolution
  // OpenRA 对照: SheetForCollection / GetImage / TryGetImage
  // ---------------------------------------------------------------------------

  /** 解析 DPI 感知的图像 URL。
   *
   * 根据当前 DPI 缩放比例选择 image1x、image2x 或 image3x。
   *
   * OpenRA 对照: ChromeProvider.SheetForCollection
   *
   * @param image1x — 1x 分辨率图像 URL（或 null）
   * @param image2x — 2x 分辨率图像 URL（或 null）
   * @param image3x — 3x 分辨率图像 URL（或 null）
   * @returns 最适合当前 DPI 缩放的图像 URL
   */
  static resolveImage(
    image1x: string | null,
    image2x: string | null,
    image3x: string | null,
  ): string {
    if (ChromeProvider._dpiScale > 2 && image3x) {
      return image3x
    }
    if (ChromeProvider._dpiScale > 1 && image2x) {
      return image2x
    }
    return image1x ?? ''
  }

  /** 获取指定集合的主图像 URL（已解析 DPI）。
   *
   * OpenRA 对照: ChromeProvider.GetImage(string, string) — 简化版
   *
   * @param collectionName — 集合名称
   * @returns 图像 URL，如果集合不存在或无图像则返回空字符串
   */
  static getImage(collectionName: string): string {
    const collection = ChromeProvider._collections.get(collectionName)
    if (!collection) return ''

    return ChromeProvider.resolveImage(
      collection.image,
      collection.image2x,
      collection.image3x,
    )
  }

  // ---------------------------------------------------------------------------
  // Panel Region
  // OpenRA 对照: TryGetPanelImages / GetPanelImages
  // ---------------------------------------------------------------------------

  /** 获取 9 片面板区域参数。
   *
   * OpenRA 对照: ChromeProvider.TryGetPanelImages (返回 PanelRegion 而非 Sprite[])
   *
   * @param collectionName — 集合名称
   * @returns PanelRegion 对象，如果未找到则返回 null
   */
  static getPanelRegion(collectionName: string): PanelRegion | null {
    const collection = ChromeProvider._collections.get(collectionName)
    if (!collection) return null
    return collection.panelRegion
  }

  /** 获取面板 CSS border-image-slice 值。
   *
   * 将 PanelRegion 转换为适合 CSS border-image-slice 的字符串。
   * 格式: `hTop wRight hBottom wLeft fill`
   *
   * 例如 PanelRegion [0, 0, 50, 20, 100, 60, 50, 20] → "20 50 20 50 fill"
   *
   * NOTE: CSS border-image-slice 使用 上 右 下 左 的顺序，与 PanelRegion 不同。
   *
   * OpenRA 对照: 无 — 这是纯 CSS 的替代方案
   *
   * @param collectionName — 集合名称
   * @returns CSS border-image-slice 值字符串，如果无 PanelRegion 则返回 null
   */
  static getPanelSliceCss(collectionName: string): string | null {
    const region = ChromeProvider.getPanelRegion(collectionName)
    if (!region || region.region.length !== 8) return null

    const r = region.region
    // PanelRegion: [x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom]
    // CSS border-image-slice: top right bottom left fill
    const hTop = r[3]  // hTop = border-top-width
    const wRight = r[6]  // wBottom ≈ wRight (right side width)
    const hBottom = r[7]  // hBottom = border-bottom-width
    const wLeft = r[2]  // wTop ≈ wLeft (left side width)

    return `${hTop} ${wRight} ${hBottom} ${wLeft} fill`
  }

  /** 获取面板 CSS border-image 规则。
   *
   * 生成完整的 CSS border-image 属性值，支持 image-set() 实现 HiDPI。
   * 使用 hasSide() 确定哪些边应包含在图像切片中。
   *
   * @param collectionName — 集合名称
   * @returns CSS border-image 属性字符串，如果无效则返回 null
   */
  static getPanelCss(collectionName: string): string | null {
    const slice = ChromeProvider.getPanelSliceCss(collectionName)
    if (!slice) return null

    const collection = ChromeProvider._collections.get(collectionName)
    if (!collection) return null

    const imageSource = ChromeProvider._buildImageSetCss(
      collection.image,
      collection.image2x,
      collection.image3x,
    )
    if (!imageSource) return null

    return `${imageSource} ${slice} stretch`
  }

  /** 构建 CSS image-set() 字符串用于 HiDPI。
   *
   * 当有多个分辨率可用时生成 `image-set(url(...) 1x, url(...) 2x, ...)`，
   * 否则回退到普通的 `url(...)`。
   *
   * @param image1x — 1x 分辨率 URL
   * @param image2x — 2x 分辨率 URL（可选）
   * @param image3x — 3x 分辨率 URL（可选）
   * @returns CSS 图像源字符串，如果所有图像均为 null 则返回 null
   */
  private static _buildImageSetCss(
    image1x: string | null,
    image2x: string | null,
    image3x: string | null,
  ): string | null {
    // Collect available resolutions
    const sources: { url: string; density: string }[] = []
    if (image1x) sources.push({ url: image1x, density: '1x' })
    if (image2x) sources.push({ url: image2x, density: '2x' })
    if (image3x) sources.push({ url: image3x, density: '3x' })

    if (sources.length === 0) return null
    if (sources.length === 1) return `url("${sources[0].url}")`

    // Multiple resolutions → use image-set()
    const parts = sources.map((s) => `url("${s.url}") ${s.density}`)
    return `image-set(${parts.join(', ')})`
  }

  // ---------------------------------------------------------------------------
  // Minimum Panel Size
  // OpenRA 对照: GetMinimumPanelSize
  // ---------------------------------------------------------------------------

  /** 获取最小面板尺寸（边角尺寸之和）。
   *
   * 计算: width = wTop + wBottom, height = hTop + hBottom
   * （基于 PanelRegion 的 [wTop(index 2), hTop(index 3), hBottom(index 7)])
   *
   * 实际上是左上角宽度 + 右下角宽度，以及顶边高度 + 底边高度。
   *
   * OpenRA 对照: ChromeProvider.GetMinimumPanelSize(string)
   *
   * @param collectionName — 集合名称
   * @returns 最小宽度和高度
   */
  static getMinimumPanelSize(
    collectionName: string,
  ): { width: number; height: number } {
    if (!collectionName) return { width: 0, height: 0 }

    const region = ChromeProvider.getPanelRegion(collectionName)
    if (!region || region.region.length !== 8) return { width: 0, height: 0 }

    const pr = region.region
    // PanelRegion: [x, y, wTop(2), hTop(3), wCenter(4), hCenter(5), wBottom(6), hBottom(7)]
    // Minimum width = left edge width + right edge width = wTop + wBottom
    // Minimum height = top edge height + bottom edge height = hTop + hBottom
    return {
      width: pr[2] + pr[6],
      height: pr[3] + pr[7],
    }
  }

  // ---------------------------------------------------------------------------
  // DPI Scale
  // OpenRA 对照: SetDPIScale
  // ---------------------------------------------------------------------------

  /** 设置 DPI 缩放比例。
   *
   * OpenRA 对照: ChromeProvider.SetDPIScale(float)
   *
   * @param scale — 新的 DPI 缩放比例
   */
  static setDPIScale(scale: number): void {
    if (ChromeProvider._dpiScale === scale) return
    ChromeProvider._dpiScale = scale
    // NOTE: 在 TS/CSS 版本中，清除缓存在 CSS 端处理。
    // 图像 URL 在每次调用 resolveImage 时根据 _dpiScale 动态选择。
  }

  /** 获取当前 DPI 缩放比例。 */
  static get dpiScale(): number {
    return ChromeProvider._dpiScale
  }

  /** 获取是否已初始化。 */
  static get initialized(): boolean {
    return ChromeProvider._initialized
  }
}
