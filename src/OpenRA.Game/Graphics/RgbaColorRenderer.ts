/**
 * RgbaColorRenderer.ts — RGBA 颜色渲染器，使用动态 Mesh + ShaderMaterial 直接渲染
 * OpenRA 对照: OpenRA.Game/Graphics/RgbaColorRenderer.cs
 *
 * 核心范式转换:
 * - SpriteRenderer.DrawRGBAQuad() 批量提交 → 内部动态 Mesh + ShaderMaterial 顶点颜色
 * - Vertex 结构体 48 字节 → RgbaVertex 接口（位置 + 归一化颜色）
 * - 手动 GL 顶点上传 → Mesh.updateVerticesData()
 * - 逐线段 DrawRGBAQuad 调用 → 内部 quad 累积 + 一次性 flush
 */

import {
  Mesh,
  VertexData,
  ShaderMaterial,
  type Scene,
} from '@babylonjs/core'

import {
  BlendMode,
  type Vec2,
  type Vec3,
} from './SpriteRenderer'

// ---------------------------------------------------------------------------
// 内部类型定义
// ---------------------------------------------------------------------------

/**
 * RGBA 颜色（0-255 字节值，与 OpenRA Color 一致）。
 * 用于 RgbaColorRenderer 内部的颜色传递，避免依赖未迁移的 Color 类型。
 */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * RGBA 顶点（位置 + 归一化颜色）。
 * 对应 OpenRA Vertex 结构体中仅使用位置和颜色的情况（纹理字段为 0）。
 */
export interface RgbaVertex {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// 内部工具函数
// ---------------------------------------------------------------------------

/**
 * 预乘 Alpha（对应 OpenRA Util.PremultiplyAlpha）。
 *
 * 若 alpha 通道为 255，直接返回原色（热路径优化）。
 * 否则将 RGB 乘以 alpha/255，结果四舍五入。
 *
 * OpenRA 对照: Util.PremultiplyAlpha(Color)
 *
 * @param c — 输入颜色（0-255 分量）
 * @returns 预乘 Alpha 后的新颜色
 */
export function premultiplyAlpha(c: RgbaColor): RgbaColor {
  if (c.a === 255) return c
  const a = c.a / 255
  // NOTE: 使用 Math.floor(v + 0.5) 匹配 C# (byte)(float + 0.5f) 截断行为
  return {
    r: Math.floor(c.r * a + 0.5),
    g: Math.floor(c.g * a + 0.5),
    b: Math.floor(c.b * a + 0.5),
    a: c.a,
  }
}

/**
 * 从位置和颜色构造 RgbaVertex（对应 OpenRA VertexWithColor 静态方法）。
 *
 * 执行预乘 Alpha 并将颜色从字节范围 [0,255] 归一化到 [0,1]。
 *
 * OpenRA 对照: RgbaColorRenderer.VertexWithColor(float3, Color)
 *
 * @param xyz — 世界坐标
 * @param color — 0-255 分量颜色
 * @returns 归一化后的顶点数据
 */
export function vertexWithColor(xyz: Vec3, color: RgbaColor): RgbaVertex {
  const c = premultiplyAlpha(color)
  const inv255 = 1 / 255
  return {
    x: xyz.x,
    y: xyz.y,
    z: xyz.z,
    r: c.r * inv255,
    g: c.g * inv255,
    b: c.b * inv255,
    a: c.a * inv255,
  }
}

/**
 * 计算两条直线的 2D 交点（对应 OpenRA IntersectionOf）。
 *
 * 用于连接线段的斜接（miter join）计算。
 * 若两条线平行，行为不正确（OpenRA 文档原文："Will behave badly if the lines are parallel"）。
 * Z 位置取 a 和 b 的均值（忽略实际交点的 Z 坐标）。
 *
 * OpenRA 对照: RgbaColorRenderer.IntersectionOf(float3, float3, float3, float3)
 *
 * @param a — 第一条线的起点
 * @param da — 第一条线的方向向量
 * @param b — 第二条线的起点
 * @param db — 第二条线的方向向量
 * @returns 交点坐标
 */
export function intersectionOf(a: Vec3, da: Vec3, b: Vec3, db: Vec3): Vec3 {
  const crossA = a.x * (a.y + da.y) - a.y * (a.x + da.x)
  const crossB = b.x * (b.y + db.y) - b.y * (b.x + db.x)
  const x = da.x * crossB - db.x * crossA
  const y = da.y * crossB - db.y * crossA
  const d = da.x * db.y - da.y * db.x
  return { x: x / d, y: y / d, z: 0.5 * (a.z + b.z) }
}

// ---------------------------------------------------------------------------
// 顶点着色器（内联：顶点颜色直通）
// ---------------------------------------------------------------------------

const RGBA_VERTEX_SHADER = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec4 color;
varying vec4 vColor;
uniform mat4 worldViewProjection;
void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vColor = color;
}
`

const RGBA_FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec4 vColor;
void main(void) {
  gl_FragColor = vColor;
}
`

// ---------------------------------------------------------------------------
// RgbaColorRenderer
// ---------------------------------------------------------------------------

/**
 * RGBA 颜色渲染器。
 *
 * 用于绘制调试图形（线条、矩形、多边形、椭圆）和简单 UI 元素。
 * 所有形状通过四边形（quad）分解实现：线条 = 细长四边形，填充矩形 = 矩形四边形。
 *
 * 设计:
 * - 预分配 vertices[4] 数组（复用，无每帧分配）
 * - 每次绘制调用填充 vertices[0..3]，然后追加到 quads 累积缓冲区
 * - flush() 将累积的 quads 上传到动态 Mesh + ShaderMaterial
 *
 * 与 OpenRA 的关键差异:
 * - 不通过 SpriteRenderer.DrawRGBAQuad() 提交（内部直接管理 Mesh）
 * - 使用 ShaderMaterial 支持逐顶点颜色（而非 Uniform 单色）
 *
 * OpenRA 对照: OpenRA.Game/Graphics/RgbaColorRenderer.cs
 */
export class RgbaColorRenderer {
  // ---------------------------------------------------------------------------
  // 静态常量（对应 OpenRA static readonly float3 Offset）
  // ---------------------------------------------------------------------------

  /** 像素中心偏移（对应 OpenRA Offset = (0.5, 0.5, 0)） */
  static readonly Offset: Vec3 = { x: 0.5, y: 0.5, z: 0 }

  // ---------------------------------------------------------------------------
  // 实例字段
  // ---------------------------------------------------------------------------

  /** 预分配顶点数组（对应 OpenRA readonly Vertex[] vertices = new Vertex[4]） */
  private readonly vertices: [RgbaVertex, RgbaVertex, RgbaVertex, RgbaVertex] = [
    { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, a: 0 },
    { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, a: 0 },
    { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, a: 0 },
    { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, a: 0 },
  ]

  /** 累积的四边形顶点缓冲区 */
  private quads: RgbaVertex[] = []

  /** Babylon.js Scene */
  private readonly scene: Scene

  /** 动态 Mesh（在首次 flush 时创建） */
  private mesh: Mesh | null = null

  /** ShaderMaterial 用于逐顶点颜色 */
  private material: ShaderMaterial | null = null

  /** 当前混合模式（记录最后一个 quad 的 blendMode，用于 flush 时设置材质） */
  private currentBlend: BlendMode = BlendMode.Alpha

  /** 是否已释放 */
  private disposed = false

  // ---------------------------------------------------------------------------
  // 构造函数
  // ---------------------------------------------------------------------------

  /**
   * @param scene — Babylon.js Scene（用于创建 Mesh 和 ShaderMaterial）
   */
  constructor(scene: Scene) {
    this.scene = scene
  }

  // ---------------------------------------------------------------------------
  // 内部方法：将预分配顶点提交到累积缓冲区
  // ---------------------------------------------------------------------------

  /**
   * 将 vertices[0..3] 追加到 quads 累积缓冲区。
   * 并在必要时更新 currentBlend。
   *
   * 对应 OpenRA: parent.DrawRGBAQuad(vertices, blendMode)
   */
  private submitQuad(blendMode: BlendMode): void {
    this.currentBlend = blendMode
    // 浅拷贝即可——RgbaVertex 全是原始值类型（number）
    this.quads.push({ ...this.vertices[0] })
    this.quads.push({ ...this.vertices[1] })
    this.quads.push({ ...this.vertices[2] })
    this.quads.push({ ...this.vertices[3] })
  }

  // ---------------------------------------------------------------------------
  // 内部方法：线段绘制辅助
  // ---------------------------------------------------------------------------

  /**
   * 绘制不连接的线段序列（对应 OpenRA DrawDisconnectedLine）。
   *
   * 将点序列 {p0, p1, p2, p3, ...} 分解为独立线段：
   * p0→p1, p2→p3, ...（每对单独一条线段）
   *
   * OpenRA 对照: RgbaColorRenderer.DrawDisconnectedLine(IEnumerable<float3>, float, Color, BlendMode)
   */
  private drawDisconnectedLine(
    points: readonly Vec3[],
    width: number,
    color: RgbaColor,
    blendMode: BlendMode,
  ): void {
    if (points.length < 2) return

    // NOTE: OpenRA DrawDisconnectedLine 使用连续迭代（非配对）：
    // p0→p1, p1→p2, p2→p3, ...（n-1 条独立线段，无斜接连接）
    // 与 DrawConnectedLine 的区别仅在于不做角点斜接计算
    for (let i = 0; i < points.length - 1; i++) {
      this.drawLineInternal(points[i], points[i + 1], width, color, color, blendMode)
    }
  }

  /**
   * 绘制连接的线段序列（对应 OpenRA DrawConnectedLine）。
   *
   * 支持开放的折线和闭合的多边形（closed=true 时首尾相连）。
   * 在内角点处计算斜接（miter join）以确保连续线宽。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawConnectedLine(float3[], float, Color, bool, BlendMode)
   */
  private drawConnectedLine(
    points: readonly Vec3[],
    width: number,
    color: RgbaColor,
    closed: boolean,
    blendMode: BlendMode,
  ): void {
    // 不是一条线
    if (points.length < 2) return

    // 单段线
    if (points.length === 2) {
      this.drawLineInternal(points[0], points[1], width, color, color, blendMode)
      return
    }

    const c = premultiplyAlpha(color)
    const inv255 = 1 / 255
    const r = c.r * inv255
    const g = c.g * inv255
    const b = c.b * inv255
    const a = c.a * inv255

    const start = points[0]
    let end = points[1]
    let dir = normalizeXY(subtract(end, start))
    const hw = width / 2
    let corner = { x: -dir.y * hw, y: dir.x * hw, z: dir.z * hw }

    // 起始线段的角
    let ca: Vec3 = subtract(start, corner)
    let cb: Vec3 = add(start, corner)

    // 闭合环线：需要与前一段计算斜接
    if (closed) {
      const prev = points[points.length - 1]
      const prevDir = normalizeXY(subtract(start, prev))
      const prevCorner = {
        x: -prevDir.y * hw,
        y: prevDir.x * hw,
        z: prevDir.z * hw,
      }
      ca = intersectionOf(
        subtract(start, prevCorner), prevDir,
        subtract(start, corner), dir,
      )
      cb = intersectionOf(
        add(start, prevCorner), prevDir,
        add(start, corner), dir,
      )
    }

    const limit = closed ? points.length : points.length - 1
    for (let i = 0; i < limit; i++) {
      const next = points[(i + 2) % points.length]
      const nextDir = normalizeXY(subtract(next, end))
      const nextCorner = {
        x: -nextDir.y * hw,
        y: nextDir.x * hw,
        z: nextDir.z * hw,
      }

      // 连接 start→end 和 end→next 的角顶点
      const cc = closed || i < limit - 1
        ? intersectionOf(add(end, corner), dir, add(end, nextCorner), nextDir)
        : add(end, corner)
      const cd = closed || i < limit - 1
        ? intersectionOf(subtract(end, corner), dir, subtract(end, nextCorner), nextDir)
        : subtract(end, corner)

      // 填充线段四边形
      this.vertices[0] = {
        x: ca.x + RgbaColorRenderer.Offset.x,
        y: ca.y + RgbaColorRenderer.Offset.y,
        z: ca.z + RgbaColorRenderer.Offset.z,
        r, g, b, a,
      }
      this.vertices[1] = {
        x: cb.x + RgbaColorRenderer.Offset.x,
        y: cb.y + RgbaColorRenderer.Offset.y,
        z: cb.z + RgbaColorRenderer.Offset.z,
        r, g, b, a,
      }
      this.vertices[2] = {
        x: cc.x + RgbaColorRenderer.Offset.x,
        y: cc.y + RgbaColorRenderer.Offset.y,
        z: cc.z + RgbaColorRenderer.Offset.z,
        r, g, b, a,
      }
      this.vertices[3] = {
        x: cd.x + RgbaColorRenderer.Offset.x,
        y: cd.y + RgbaColorRenderer.Offset.y,
        z: cd.z + RgbaColorRenderer.Offset.z,
        r, g, b, a,
      }

      this.submitQuad(blendMode)

      // 推进线段
      end = next
      dir = nextDir
      corner = nextCorner

      ca = cd
      cb = cc
    }
  }

  /**
   * 内部单色/渐变线段绘制（对应 OpenRA 两个 DrawLine 重载的核心逻辑）。
   *
   * 将线段扩展为宽度为 width 的四边形：
   *   vertices[0] = start - corner  （线段左侧起点）
   *   vertices[1] = start + corner  （线段右侧起点）
   *   vertices[2] = end + corner    （线段右侧终点）
   *   vertices[3] = end - corner    （线段左侧终点）
   *
   * 其中 corner = width/2 * (-delta.y, delta.x) 为与线段方向垂直的半宽向量。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawLine(float3, float3, float, Color, Color, BlendMode)
   */
  private drawLineInternal(
    start: Vec3,
    end: Vec3,
    width: number,
    startColor: RgbaColor,
    endColor: RgbaColor,
    blendMode: BlendMode,
  ): void {
    const delta = subtract(end, start)
    const length = Math.sqrt(delta.x * delta.x + delta.y * delta.y)

    // OpenRA 不检查零长度线段（会生成退化的 NaN 四边形），
    // 使用最小安全长度避免除零，同时保持提交一个四边形（即使退化）
    const safeLen = length < 1e-9 ? 1e-9 : length
    const invLen = 1 / safeLen
    const dx = delta.x * invLen
    const dy = delta.y * invLen
    const dz = delta.z * invLen

    const hw = width / 2
    const corner: Vec3 = { x: -dy * hw, y: dx * hw, z: dz * hw }

    const sc = premultiplyAlpha(startColor)
    const inv255 = 1 / 255
    const sr = sc.r * inv255
    const sg = sc.g * inv255
    const sb = sc.b * inv255
    const sa = sc.a * inv255

    const ec = premultiplyAlpha(endColor)
    const er = ec.r * inv255
    const eg = ec.g * inv255
    const eb = ec.b * inv255
    const ea = ec.a * inv255

    const ox = RgbaColorRenderer.Offset.x
    const oy = RgbaColorRenderer.Offset.y
    const oz = RgbaColorRenderer.Offset.z

    // vertices[0]: start - corner
    this.vertices[0] = {
      x: start.x - corner.x + ox,
      y: start.y - corner.y + oy,
      z: start.z - corner.z + oz,
      r: sr, g: sg, b: sb, a: sa,
    }
    // vertices[1]: start + corner
    this.vertices[1] = {
      x: start.x + corner.x + ox,
      y: start.y + corner.y + oy,
      z: start.z + corner.z + oz,
      r: sr, g: sg, b: sb, a: sa,
    }
    // vertices[2]: end + corner
    this.vertices[2] = {
      x: end.x + corner.x + ox,
      y: end.y + corner.y + oy,
      z: end.z + corner.z + oz,
      r: er, g: eg, b: eb, a: ea,
    }
    // vertices[3]: end - corner
    this.vertices[3] = {
      x: end.x - corner.x + ox,
      y: end.y - corner.y + oy,
      z: end.z - corner.z + oz,
      r: er, g: eg, b: eb, a: ea,
    }

    this.submitQuad(blendMode)
  }

  // ---------------------------------------------------------------------------
  // 公共方法 1-2: DrawLine（线段）
  // ---------------------------------------------------------------------------

  /**
   * 绘制渐变颜色线段。
   *
   * 线段从 start 到 end，宽度为 width。
   * startColor 在起点，endColor 在终点，中间线性插值。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawLine(float3, float3, float, Color, Color, BlendMode)
   *
   * @param start — 起点坐标
   * @param end — 终点坐标
   * @param width — 线段宽度（像素）
   * @param startColor — 起点颜色（0-255 分量）
   * @param endColor — 终点颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  drawLine(
    start: Vec3,
    end: Vec3,
    width: number,
    startColor: RgbaColor,
    endColor: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    this.drawLineInternal(start, end, width, startColor, endColor, blendMode)
  }

  /**
   * 绘制纯色线段（单色重载）。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawLine(float3, float3, float, Color, BlendMode)
   *
   * @param start — 起点坐标
   * @param end — 终点坐标
   * @param width — 线段宽度（像素）
   * @param color — 线段颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  drawLineSolid(
    start: Vec3,
    end: Vec3,
    width: number,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    this.drawLineInternal(start, end, width, color, color, blendMode)
  }

  // ---------------------------------------------------------------------------
  // 公共方法 3: DrawLine（多点路径）
  // ---------------------------------------------------------------------------

  /**
   * 绘制多点线段路径。
   *
   * 若 connectSegments=false，点序列按对处理 (p0→p1, p2→p3, ...)。
   * 若 connectSegments=true，绘制连续的折线（不闭合）。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawLine(IEnumerable<float3>, float, Color, bool, BlendMode)
   *
   * @param points — 路径点序列
   * @param width — 线段宽度（像素）
   * @param color — 线段颜色（0-255 分量）
   * @param connectSegments — 是否连接线段（折线模式）
   * @param blendMode — 混合模式
   */
  drawPath(
    points: readonly Vec3[],
    width: number,
    color: RgbaColor,
    connectSegments = false,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    if (!connectSegments) {
      this.drawDisconnectedLine(points, width, color, blendMode)
    } else {
      this.drawConnectedLine(points, width, color, false, blendMode)
    }
  }

  // ---------------------------------------------------------------------------
  // 公共方法 4-5: DrawPolygon（闭合多边形轮廓）
  // ---------------------------------------------------------------------------

  /**
   * 绘制闭合多边形轮廓（float3 顶点数组）。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawPolygon(float3[], float, Color, BlendMode)
   *
   * @param vertices — 多边形顶点（3D 坐标）
   * @param width — 轮廓线宽度（像素）
   * @param color — 轮廓颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  drawPolygon(
    vertices: readonly Vec3[],
    width: number,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    this.drawConnectedLine(vertices, width, color, true, blendMode)
  }

  /**
   * 绘制闭合多边形轮廓（float2 顶点数组，z 默认为 0）。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawPolygon(float2[], float, Color, BlendMode)
   *
   * @param vertices — 多边形顶点（2D 坐标）
   * @param width — 轮廓线宽度（像素）
   * @param color — 轮廓颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  drawPolygon2D(
    vertices: readonly Vec2[],
    width: number,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    const v3: Vec3[] = vertices.map(v => ({ x: v.x, y: v.y, z: 0 }))
    this.drawConnectedLine(v3, width, color, true, blendMode)
  }

  // ---------------------------------------------------------------------------
  // 公共方法 6: DrawRect（矩形轮廓）
  // ---------------------------------------------------------------------------

  /**
   * 绘制矩形边框。
   *
   * 通过绘制 4 条边（tl→tr→br→bl→tl 闭合回路）实现。
   *
   * OpenRA 对照: RgbaColorRenderer.DrawRect(float3, float3, float, Color, BlendMode)
   *
   * @param tl — 左上角坐标
   * @param br — 右下角坐标
   * @param width — 边框线宽度（像素）
   * @param color — 边框颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  drawRect(
    tl: Vec3,
    br: Vec3,
    width: number,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    const tr: Vec3 = { x: br.x, y: tl.y, z: tl.z }
    const bl: Vec3 = { x: tl.x, y: br.y, z: br.z }
    this.drawPolygon([tl, tr, br, bl], width, color, blendMode)
  }

  // ---------------------------------------------------------------------------
  // 公共方法 7-9: FillRect（填充矩形）
  // ---------------------------------------------------------------------------

  /**
   * 填充矩形（左上角 + 右下角定义）。
   *
   * OpenRA 对照: RgbaColorRenderer.FillRect(float3, float3, Color, BlendMode)
   *
   * @param tl — 左上角坐标
   * @param br — 右下角坐标
   * @param color — 填充颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  fillRect(
    tl: Vec3,
    br: Vec3,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    const tr: Vec3 = { x: br.x, y: tl.y, z: tl.z }
    const bl: Vec3 = { x: tl.x, y: br.y, z: br.z }
    this.fillRect4P(tl, tr, br, bl, color, blendMode)
  }

  /**
   * 填充矩形（4 个角点，纯色）。
   *
   * OpenRA 对照: RgbaColorRenderer.FillRect(float3, float3, float3, float3, Color, BlendMode)
   *
   * @param a — 顶点 A（对应左上角）
   * @param b — 顶点 B（对应右上角）
   * @param c — 顶点 C（对应右下角）
   * @param d — 顶点 D（对应左下角）
   * @param color — 填充颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  fillRect4P(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    const pc = premultiplyAlpha(color)
    const inv255 = 1 / 255
    const cr = pc.r * inv255
    const cg = pc.g * inv255
    const cb = pc.b * inv255
    const ca = pc.a * inv255

    const ox = RgbaColorRenderer.Offset.x
    const oy = RgbaColorRenderer.Offset.y
    const oz = RgbaColorRenderer.Offset.z

    this.vertices[0] = { x: a.x + ox, y: a.y + oy, z: a.z + oz, r: cr, g: cg, b: cb, a: ca }
    this.vertices[1] = { x: b.x + ox, y: b.y + oy, z: b.z + oz, r: cr, g: cg, b: cb, a: ca }
    this.vertices[2] = { x: c.x + ox, y: c.y + oy, z: c.z + oz, r: cr, g: cg, b: cb, a: ca }
    this.vertices[3] = { x: d.x + ox, y: d.y + oy, z: d.z + oz, r: cr, g: cg, b: cb, a: ca }

    this.submitQuad(blendMode)
  }

  /**
   * 填充矩形（4 个角点 + 4 个角颜色，支持渐变）。
   *
   * OpenRA 对照: RgbaColorRenderer.FillRect(float3, float3, float3, float3, Color, Color, Color, Color, BlendMode)
   *
   * @param a — 顶点 A（对应左上角）
   * @param b — 顶点 B（对应右上角）
   * @param c — 顶点 C（对应右下角）
   * @param d — 顶点 D（对应左下角）
   * @param topLeftColor — 左上角颜色（0-255 分量）
   * @param topRightColor — 右上角颜色（0-255 分量）
   * @param bottomRightColor — 右下角颜色（0-255 分量）
   * @param bottomLeftColor — 左下角颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  fillRectGradient(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    topLeftColor: RgbaColor,
    topRightColor: RgbaColor,
    bottomRightColor: RgbaColor,
    bottomLeftColor: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return
    const ox = RgbaColorRenderer.Offset.x
    const oy = RgbaColorRenderer.Offset.y
    const oz = RgbaColorRenderer.Offset.z

    this.vertices[0] = vertexWithColor(
      { x: a.x + ox, y: a.y + oy, z: a.z + oz },
      topLeftColor,
    )
    this.vertices[1] = vertexWithColor(
      { x: b.x + ox, y: b.y + oy, z: b.z + oz },
      topRightColor,
    )
    this.vertices[2] = vertexWithColor(
      { x: c.x + ox, y: c.y + oy, z: c.z + oz },
      bottomRightColor,
    )
    this.vertices[3] = vertexWithColor(
      { x: d.x + ox, y: d.y + oy, z: d.z + oz },
      bottomLeftColor,
    )

    this.submitQuad(blendMode)
  }

  // ---------------------------------------------------------------------------
  // 公共方法 10: FillEllipse（填充椭圆）
  // ---------------------------------------------------------------------------

  /**
   * 填充椭圆。
   *
   * 通过逐行扫描线分解为一系列 1 像素高的水平线段来实现。
   * 每个扫描线调用 drawLineInternal 生成一个细四边形。
   *
   * NOTE: 与 OpenRA 一致，使用 1 像素宽线段堆叠的方式近似椭圆。
   * 对于大椭圆，这会产生大量四边形。
   *
   * OpenRA 对照: RgbaColorRenderer.FillEllipse(float3, float3, Color, BlendMode)
   *
   * @param tl — 包围盒左上角坐标
   * @param br — 包围盒右下角坐标
   * @param color — 填充颜色（0-255 分量）
   * @param blendMode — 混合模式
   */
  fillEllipse(
    tl: Vec3,
    br: Vec3,
    color: RgbaColor,
    blendMode: BlendMode = BlendMode.Alpha,
  ): void {
    if (this.disposed) return

    const a = (br.x - tl.x) / 2
    const b = (br.y - tl.y) / 2

    const xc = (br.x + tl.x) / 2
    const yc = (br.y + tl.y) / 2

    // OpenRA 原文中使用单精度 float 逐行遍历
    // 对于非整数坐标，通过线性插值计算每行的 Z
    const zRange = br.z - tl.z
    const yRange = br.y - tl.y

    const startY = Math.ceil(tl.y)
    const endY = Math.floor(br.y)

    for (let y = startY; y <= endY; y++) {
      const t = yRange > 1e-9 ? (y - tl.y) / yRange : 0
      const z = tl.z + t * zRange

      // 避免 b=0 除零：退化椭圆退化为单扫描线（dy=0, disc=1）
      const dy = b < 1e-9 ? 0 : (y - yc) / b
      const disc = 1 - dy * dy
      if (disc <= 0) continue
      const dx = a * Math.sqrt(disc)
      const lineStart: Vec3 = { x: xc - dx, y, z }
      const lineEnd: Vec3 = { x: xc + dx, y, z }
      this.drawLineInternal(lineStart, lineEnd, 1, color, color, blendMode)
    }
  }

  // ---------------------------------------------------------------------------
  // 渲染：flush / dispose
  // ---------------------------------------------------------------------------

  /**
   * 将累积的所有四边形上传到动态 Mesh。
   *
   * 首次调用时创建 Mesh + ShaderMaterial；后续调用更新 VertexData。
   * 若没有累积的四边形，则不执行任何操作。
   *
   * TODO-2.4.3: ShaderMaterial 自动使用预乘 Alpha（片段着色器中 vColor 已是预乘值，
   * 混合设置为 ALPHA_PREMULTIPLIED）。
   *
   * @param clearAfterFlush — 是否在刷新后清空累积缓冲区（默认 true）
   */
  flush(clearAfterFlush = true): void {
    if (this.disposed || this.quads.length === 0) return

    const quadCount = this.quads.length / 4
    const vertexCount = this.quads.length

    // 构建 positions 数组（x, y, z 交错）
    const positions = new Float32Array(vertexCount * 3)
    // 构建 colors 数组（r, g, b, a 交错）
    const colors = new Float32Array(vertexCount * 4)

    for (let i = 0; i < vertexCount; i++) {
      const v = this.quads[i]
      const pOff = i * 3
      const cOff = i * 4
      positions[pOff] = v.x
      positions[pOff + 1] = v.y
      positions[pOff + 2] = v.z
      colors[cOff] = v.r
      colors[cOff + 1] = v.g
      colors[cOff + 2] = v.b
      colors[cOff + 3] = v.a
    }

    // 构建索引数组（每 quad 6 个索引：0,1,2, 2,3,0）
    const indices = new Uint32Array(quadCount * 6)
    for (let q = 0; q < quadCount; q++) {
      const base = q * 4
      const iOff = q * 6
      indices[iOff] = base
      indices[iOff + 1] = base + 1
      indices[iOff + 2] = base + 2
      indices[iOff + 3] = base + 2
      indices[iOff + 4] = base + 3
      indices[iOff + 5] = base
    }

    // 创建或更新顶点数据
    const vertexData = new VertexData()
    vertexData.positions = positions
    vertexData.colors = colors
    vertexData.indices = indices

    if (!this.mesh) {
      // 首次：创建 Mesh + ShaderMaterial
      this.mesh = new Mesh('rgbaColorMesh', this.scene)

      this.material = new ShaderMaterial(
        'rgbaColorMat',
        this.scene,
        {
          vertexSource: RGBA_VERTEX_SHADER,
          fragmentSource: RGBA_FRAGMENT_SHADER,
        },
        {
          attributes: ['position', 'color'],
          uniforms: ['worldViewProjection'],
          needAlphaBlending: true,
        },
      )
      // 预乘 Alpha 混合（对应 TODO-2.4.3）
      this.material.setFloat('alpha', 1)
      // 调试图形：禁用深度写入 + 最高渲染组，避免 Z-fighting（对应 TODO-2.4.4）
      this.material.disableDepthWrite = true

      this.mesh.material = this.material
      this.mesh.isPickable = false
      this.mesh.renderingGroupId = 3 // 最高渲染组，覆盖所有场景图层
    }

    vertexData.applyToMesh(this.mesh, true) // true = 可更新

    if (clearAfterFlush) {
      this.quads.length = 0
    }
  }

  /**
   * 清空累积的四边形（不渲染）。
   *
   * 用于丢弃当前帧的绘制命令（例如视口变化时）。
   */
  clear(): void {
    this.quads.length = 0
  }

  /**
   * 获取当前累积的四边形数量（用于测试和调试）。
   */
  getQuadCount(): number {
    return this.quads.length / 4
  }

  /**
   * 获取累积的四边形的副本（用于单元测试验证几何数据）。
   *
   * @returns 顶点数组的浅拷贝（每个元素是 number 字段的对象，安全返回）
   */
  getVertexBuffer(): readonly RgbaVertex[] {
    return this.quads.map(v => ({ ...v }))
  }

  /**
   * 获取当前动态 Mesh（用于集成到 Scene 或设置其他属性）。
   * 在首次 flush() 调用前返回 null。
   */
  getMesh(): Mesh | null {
    return this.mesh
  }

  /**
   * 获取当前 ShaderMaterial（用于调试或自定义 uniform）。
   * 在首次 flush() 调用前返回 null。
   */
  getMaterial(): ShaderMaterial | null {
    return this.material
  }

  /** 获取最近一次提交的混合模式 */
  getCurrentBlend(): BlendMode {
    return this.currentBlend
  }

  /**
   * 释放所有 GPU 资源。
   *
   * 释放后不应再使用此实例的方法。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    this.quads.length = 0

    if (this.material) {
      this.material.dispose()
      this.material = null
    }

    if (this.mesh) {
      this.mesh.dispose()
      this.mesh = null
    }
  }
}

// ---------------------------------------------------------------------------
// 内部向量操作（避免每次调用时分配临时对象，但接受小幅分配以保持代码清晰）
// ---------------------------------------------------------------------------

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function normalizeXY(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len < 1e-9) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}
