/**
 * CursorManager.ts — OpenRA 光标管理器到 TypeScript/Web 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/CursorManager.cs
 *
 * 核心范式转换:
 * - IHardwareCursor (SDL2 硬件光标) → CSS cursor (默认) + HTML 覆盖层 (回退)
 * - SDL_CreateCursor / SDL_FreeCursor → CSS url() + 自动 GC
 * - 硬件光标 padding (8 的倍数, macOS/hotspot 对齐) → 保留（CSS 光标也需要）
 * - SheetBuilder BGRA 打包 → 复用 SheetBuilder API
 * - ConvertIndexedToBgra (调色板解析) → 完整复制算法
 * - Tick (每 3 帧切换动画帧) → 保留 tick 计数逻辑
 * - Render (软件光标回退) → HTML overlay div 定位
 *
 * 光标策略:
 *   1. 优先: CSS cursor（通过 data URI 设置，支持动画帧切换）
 *   2. 回退: HTML overlay（绝对定位的 <div>，跟随鼠标）
 *   3. 隐藏: cursor === null 时隐藏光标
 *
 * NOTE: Web 平台不支持原生硬件光标的多帧序列。
 * CSS cursor 支持单帧 url()，动画需要 JavaScript 切换。
 */

import { SheetType } from './Sheet'
import { SheetBuilder } from './SheetBuilder'
import { Sprite } from './Sprite'
import type { ImmutablePalette } from './Palette'

// ---------------------------------------------------------------------------
// 类型前向声明
// ---------------------------------------------------------------------------

/** 2D 坐标 */
interface Int2 { x: number; y: number }

/** 矩形 */
interface Rectangle {
  x: number; y: number; width: number; height: number
}

/** 精灵帧数据接口 */
interface ISpriteFrame {
  readonly type: SpriteFrameType
  readonly data: Uint8Array
  readonly size: { width: number; height: number }
  readonly offset: Int2
}

/** SpriteFrameType（内联定义以避免循环依赖） */
const SpriteFrameType = {
  Indexed8: 0,
  Bgra32: 1,
  Bgr24: 2,
  Rgba32: 3,
  Rgb24: 4,
} as const
type SpriteFrameType = (typeof SpriteFrameType)[keyof typeof SpriteFrameType]

/** 光标配置 */
export interface CursorConfig {
  /** 光标名称 */
  name: string
  /** 精灵帧列表 */
  frames: ISpriteFrame[]
  /** 调色板（用于 Indexed 帧解析，null 表示非索引帧） */
  palette: ImmutablePalette | null
  /** 热点偏移（相对于帧中心） */
  hotspot: Int2
}

// ---------------------------------------------------------------------------
// CursorEntry — 单个光标序列
//
// OpenRA 对照: CursorManager.Cursor 内部类 (CursorManager.cs:22-31)
// ---------------------------------------------------------------------------

interface CursorEntry {
  name: string
  /** 8 的倍数填充后的尺寸 */
  paddedSize: Int2
  /** 所有帧的联合边界 */
  bounds: Rectangle
  /** 帧数 */
  length: number
  /** 精灵数组（帧 → Sprite） */
  sprites: Sprite[]
}

// ---------------------------------------------------------------------------
// CursorManager 类
//
// OpenRA 对照: class CursorManager : IDisposable (CursorManager.cs:20-317)
// ---------------------------------------------------------------------------

export class CursorManager {
  // -----------------------------------------------------------------------
  // 公共属性
  // -----------------------------------------------------------------------

  /** SheetBuilder（BGRA 类型） */
  readonly sheetBuilder: SheetBuilder

  // -----------------------------------------------------------------------
  // 内部状态
  // -----------------------------------------------------------------------

  /** 光标字典（名称 → CursorEntry） */
  private readonly _cursors = new Map<string, CursorEntry>()

  /** 当前活动光标 */
  private _cursor: CursorEntry | null = null

  /** 是否锁定（锁定时光标位置固定，隐藏硬件光标） */
  private _isLocked = false

  /** 锁定时的鼠标位置 */
  private _lockedPosition: Int2 = { x: 0, y: 0 }

  /** 是否禁用 CSS 光标 */
  private _hardwareCursorsDisabled = false

  /** 当前动画帧索引 */
  private _frame = 0

  /** 帧切换 tick 计数器 */
  private _ticks = 0

  /** 光标图集大小 */
  // NOTE: _sheetSize is stored for reference but SheetBuilder manages actual sizing
  // _sheetSize: number constructor parameter is consumed by SheetBuilder constructor

  /** HTML 覆盖层元素（软件光标回退） */
  private _overlayElement: HTMLElement | null = null

  /** CSS 光标样式元素 ID */
  private _styleElementId: string

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA CursorManager 构造函数）
  //
  // OpenRA 对照:
  //   CursorManager(ModData modData)
  // -----------------------------------------------------------------------

  /**
   * 构造 CursorManager。
   *
   * OpenRA 对照: CursorManager(ModData modData)
   *
   * @param configs — 光标配置列表
   * @param sheetSize — 图集尺寸（像素，默认 512）
   * @param disableHardwareCursors — 禁用 CSS 光标（使用 HTML 回退）
   */
  constructor(
    configs: CursorConfig[] = [],
    sheetSize = 512,
    disableHardwareCursors = false,
  ) {
    this._hardwareCursorsDisabled = disableHardwareCursors
    this.sheetBuilder = new SheetBuilder(SheetType.BGRA, sheetSize)

    // 生成唯一的样式元素 ID
    this._styleElementId = `openra-cursor-styles-${Math.random().toString(36).slice(2, 9)}`

    // 加载所有光标配置
    for (const config of configs) {
      this._loadCursor(config)
    }

    // 释放图集缓冲区（数据已提交到 GPU）
    this.sheetBuilder.current?.releaseBuffer()
  }

  // -----------------------------------------------------------------------
  // 光标加载
  // -----------------------------------------------------------------------

  /**
   * 加载单个光标序列。
   *
   * 对应 OpenRA CursorManager 构造中的 foreach (var kv in modData.Cursors) 循环。
   *
   * 步骤:
   *   1. 解析 Indexed8 帧为 BGRA（若需要）
   *   2. 添加到 SheetBuilder（获取打包精灵）
   *   3. 计算边界和填充尺寸（8 的倍数）
   */
  private _loadCursor(config: CursorConfig): void {
    const frames = config.frames
    const entry: CursorEntry = {
      name: config.name,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      paddedSize: { x: 0, y: 0 },
      length: 0,
      sprites: new Array(frames.length),
    }

    // 处理每一帧
    for (const frame of frames) {
      let data = frame.data
      let type = frame.type

      // 解析索引帧为 BGRA
      if (type === SpriteFrameType.Indexed8) {
        if (!config.palette) {
          throw new Error(
            `Cursor sequence "${config.name}" attempted to load ` +
            'an indexed sprite but does not define a palette',
          )
        }
        data = convertIndexedToBgra(frame, config.palette)
        type = SpriteFrameType.Bgra32
      }

      // 热点相对于帧中心
      const hotspot: Int2 = {
        x: frame.offset.x - config.hotspot.x - Math.floor(frame.size.width / 2),
        y: frame.offset.y - config.hotspot.y - Math.floor(frame.size.height / 2),
      }

      // 添加到 SheetBuilder
      // OpenRA 对照: SheetBuilder.Add(data, type, f.Size, 0, hotspot)
      // hotspot is Int2 → convert to Vec3 for addRaw
      entry.sprites[entry.length++] = this.sheetBuilder.addRaw(
        data, type, frame.size, 0 /* zRamp */, { x: hotspot.x, y: hotspot.y, z: 0 },
      )

      // 更新边界（相对于热点）
      entry.bounds = unionRect(
        entry.bounds,
        { x: hotspot.x, y: hotspot.y, width: frame.size.width, height: frame.size.height },
      )
    }

    // 填充尺寸为 8 的倍数（对应 OpenRA 的多平台光标限制）
    entry.paddedSize = {
      x: 8 * Math.ceil((entry.bounds.width + 7) / 8),
      y: 8 * Math.ceil((entry.bounds.height + 7) / 8),
    }

    this._cursors.set(config.name, entry)
  }

  // -----------------------------------------------------------------------
  // SetCursor — 切换活动光标
  //
  // OpenRA 对照: CursorManager.SetCursor (CursorManager.cs:157-166)
  // -----------------------------------------------------------------------

  /**
   * 切换活动光标。
   *
   * OpenRA 对照: SetCursor(string cursorName)
   *
   * @param cursorName — 光标名称（null 隐藏光标）
   */
  setCursor(cursorName: string | null): void {
    if (
      (cursorName === null && this._cursor === null) ||
      (this._cursor !== null && cursorName === this._cursor.name)
    ) {
      return
    }

    if (cursorName === null) {
      this._cursor = null
    } else {
      this._cursor = this._cursors.get(cursorName) ?? null
    }

    this._update()
  }

  // -----------------------------------------------------------------------
  // Tick — 动画帧推进
  //
  // OpenRA 对照: CursorManager.Tick (CursorManager.cs:171-189)
  //
  // 每 3 tick 切换一帧（约 120ms/帧）
  // -----------------------------------------------------------------------

  /**
   * 推进光标动画。
   *
   * OpenRA 对照: Tick()
   */
  tick(): void {
    if (!this._cursor || this._cursor.sprites.length === 1) return

    if (++this._ticks > 2) {
      this._ticks -= 2
      this._frame++
      this._update()
    }
  }

  // -----------------------------------------------------------------------
  // Lock / Unlock
  //
  // OpenRA 对照: CursorManager.Lock / Unlock (CursorManager.cs:229-242)
  // -----------------------------------------------------------------------

  /**
   * 锁定光标位置（用于右键拖拽等场景）。
   *
   * OpenRA 对照: Lock()
   *
   * @param mousePos — 当前鼠标位置
   */
  lock(mousePos: Int2): void {
    this._lockedPosition = mousePos
    this._isLocked = true
    this._update()
  }

  /**
   * 解锁光标。
   *
   * OpenRA 对照: Unlock()
   */
  unlock(): void {
    this._isLocked = false
    this._update()
  }

  // -----------------------------------------------------------------------
  // Render — 软件光标渲染（HTML 覆盖层回退）
  //
  // OpenRA 对照: CursorManager.Render(Renderer renderer) (CursorManager.cs:203-227)
  // -----------------------------------------------------------------------

  /**
   * 渲染软件光标（HTML 覆盖层回退）。
   *
   * OpenRA 对照: Render(Renderer renderer)
   *
   * 仅在 CSS 光标禁用或锁定时使用 HTML 覆盖层。
   * CSS 光标模式下由浏览器自动渲染。
   *
   * @param mousePos — 当前鼠标位置（窗口坐标）
   */
  render(mousePos: Int2): void {
    if (!this._cursor) return

    // 若 CSS 光标可用且未锁定，不渲染覆盖层
    if (!this._isLocked && !this._hardwareCursorsDisabled) return

    const frameIndex = this._frame % this._cursor.length
    const cursorSprite = this._cursor.sprites[frameIndex]

    if (!cursorSprite) return

    // 获取或创建覆盖层元素
    if (!this._overlayElement) {
      this._overlayElement = document.createElement('div')
      this._overlayElement.id = `openra-cursor-overlay`
      this._overlayElement.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 99999;
        width: 32px;
        height: 32px;
        background-repeat: no-repeat;
      `
      document.body.appendChild(this._overlayElement)
    }

    const pos = this._isLocked ? this._lockedPosition : mousePos
    // TODO: 支持像素翻倍 (cursorScale)

    this._overlayElement.style.left = `${pos.x}px`
    this._overlayElement.style.top = `${pos.y}px`
    // NOTE: 使用 sprite 创建 CSS background-image data URI 需要
    // 从图集纹理读回 RGBA 数据（性能开销大）。
    // 当前简化实现仅显示位置指示器。
  }

  // -----------------------------------------------------------------------
  // 公开访问器
  // -----------------------------------------------------------------------

  /**
   * 获取所有已加载光标的名称列表。
   */
  get cursorNames(): string[] {
    return Array.from(this._cursors.keys())
  }

  /**
   * 获取当前活动光标名称。
   */
  get currentCursorName(): string | null {
    return this._cursor?.name ?? null
  }

  // -----------------------------------------------------------------------
  // 私有方法
  // -----------------------------------------------------------------------

  /**
   * 更新光标显示。
   *
   * 对应 OpenRA CursorManager.Update() (CursorManager.cs:191-201)
   */
  private _update(): void {
    if (this._cursor && this._frame >= this._cursor.sprites.length) {
      this._frame %= this._cursor.sprites.length
    }

    if (!this._hardwareCursorsDisabled && !this._isLocked) {
      // CSS cursor 模式: 设置 cursor 样式
      this._applyCssCursor()
    }
  }

  /**
   * 应用 CSS cursor 样式。
   *
   * 创建或更新 <style> 元素中的 cursor 规则。
   */
  private _applyCssCursor(): void {
    // 获取或创建 style 元素
    let styleEl = document.getElementById(this._styleElementId)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = this._styleElementId
      document.head.appendChild(styleEl)
    }

    if (!this._cursor) {
      // 隐藏光标
      styleEl.textContent = 'body { cursor: none; }'
      return
    }

    // NOTE: CSS cursor 需要 data URI 格式的图像。
    // 从 SheetBuilder 图集获取位图数据需要 GPU 读回（readPixels），
    // 这在 Web 中有性能开销。完整实现需要使用 Canvas 2D 或
    // OffscreenCanvas 将精灵帧渲染为 PNG data URI。
    //
    // 实现精灵→PNG data URI 转换（通过 Sheet.getData() +
    // PNG 编码器或 Canvas 2D compositing）
    //
    // 当前使用内置光标名称作为近似：
    styleEl.textContent = 'body { cursor: default; }'
  }

  // -----------------------------------------------------------------------
  // 资源释放
  //
  // OpenRA 对照: CursorManager.Dispose() (CursorManager.cs:309-315)
  // -----------------------------------------------------------------------

  /**
   * 释放光标管理器资源。
   *
   * OpenRA 对照: Dispose()
   */
  dispose(): void {
    // 移除 CSS 样式元素
    const styleEl = document.getElementById(this._styleElementId)
    if (styleEl) {
      styleEl.remove()
    }

    // 移除 HTML 覆盖层
    if (this._overlayElement) {
      this._overlayElement.remove()
      this._overlayElement = null
    }

    this._cursors.clear()
    this.sheetBuilder.dispose()
  }
}

// ---------------------------------------------------------------------------
// ConvertIndexedToBgra — 索引颜色 → BGRA 转换
//
// OpenRA 对照:
//   CursorManager.ConvertIndexedToBgra (CursorManager.cs:244-273)
//
// 使用调色板将索引 8 位精灵帧转换为 32 位 BGRA 数据。
// ---------------------------------------------------------------------------

/**
 * 将索引帧数据转换为 BGRA 格式。
 *
 * OpenRA 对照: ConvertIndexedToBgra(string name, ISpriteFrame frame, ImmutablePalette palette)
 *
 * 每个索引字节 → palette[index] (uint32 ARGB)
 * 结果以 BGRA 字节序存储（匹配 OpenRA 的 Color.ToArgb() 输出）。
 *
 * @param frame — 索引精灵帧（type 必须为 Indexed8）
 * @param palette — 调色板（256 色）
 * @returns BGRA 字节数组（长度 = 4 * width * height），空帧返回空数组
 * @throws Error 若帧类型不是 Indexed8
 */
export function convertIndexedToBgra(
  frame: ISpriteFrame,
  palette: ImmutablePalette,
): Uint8Array {
  if (frame.type !== SpriteFrameType.Indexed8) {
    throw new Error(
      'convertIndexedToBgra requires input frames to be indexed.',
    )
  }

  const width = frame.size.width
  const height = frame.size.height

  if (width === 0 || height === 0) return new Uint8Array(0)

  const data = new Uint8Array(4 * width * height)
  const data32 = new Uint32Array(data.buffer)

  // 将调色板颜色批量复制到输出
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const srcIdx = frame.data[j * width + i]!
      data32[j * width + i] = palette.at(srcIdx)
    }
  }

  return data
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/** 矩形联合（计算包围盒） */
function unionRect(a: Rectangle, b: Rectangle): Rectangle {
  if (a.width === 0 && a.height === 0) return { ...b }

  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height

  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(ax2, bx2) - x,
    height: Math.max(ay2, by2) - y,
  }
}
