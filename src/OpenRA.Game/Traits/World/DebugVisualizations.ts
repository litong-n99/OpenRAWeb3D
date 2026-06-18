/**
 * DebugVisualizations.ts — 全局调试可视化开关管理器
 * OpenRA 对照: OpenRA.Game/Traits/World/DebugVisualizations.cs
 *
 * 核心范式转换:
 * - C# 静态单例（通过 TraitInfo 附加到 World Actor） → TypeScript 单例类
 * - C# Game.Renderer.WorldSpriteRenderer.SetDepthPreview() → TODO: 3D 深度调试渲染
 * - C# bool 字段 + getter/setter 属性 → TypeScript getter/setter + 内部脏标志
 * - 深度缓冲区调试功能在 WebGL 中有不同的实现路径（使用 Babylon.js DepthRenderer 或
 *   PostProcess），因此此处的 SetDepthPreview 留作占位符
 *
 * DebugVisualizations 附加到 World Actor（以及 EditorWorld Actor），
 * 提供全局调试覆盖层的切换开关：战斗几何体、渲染几何体、屏幕映射、
 * Actor 标签和深度缓冲区可视化。
 */

// ---------------------------------------------------------------------------
// DebugVisualizationsInfo — 特质配置标记（对应 OpenRA DebugVisualizationsInfo）
// ---------------------------------------------------------------------------

/**
 * 调试可见性特质的配置标记类。
 *
 * OpenRA 对照: DebugVisualizationsInfo : TraitInfo<DebugVisualizations>
 *
 * 此 Info 类不包含配置属性 — 仅作为标记，允许
 * DebugVisualizations 特质附加到 World Actor。
 */
export class DebugVisualizationsInfo {
  readonly instanceName?: string

  constructor(params?: { instanceName?: string }) {
    this.instanceName = params?.instanceName
  }
}

// ---------------------------------------------------------------------------
// DebugVisualizations — 全局调试开关管理器（对应 OpenRA DebugVisualizations）
// ---------------------------------------------------------------------------

/**
 * 全局调试可视化切换开关管理器。
 *
 * OpenRA 对照: OpenRA.Traits.DebugVisualizations
 *
 * 提供可在运行时切换的全局布尔标志，以显示各种调试覆盖层。
 * 附加到 World Actor（SystemActors.World | SystemActors.EditorWorld），
 * 任何游戏系统都可以通过 World Actor 访问此单例来查询开关状态。
 *
 * 调试覆盖层类型：
 * - CombatGeometry: 显示武器射程圆、炮弹轨迹
 * - RenderGeometry: 显示精灵边界框、命中框
 * - ScreenMap: 显示屏幕映射分区格
 * - ActorTags: 显示 Actor ID/名称标签
 * - DepthBuffer: 显示深度缓冲区预览（用于调试 Z-fighting / 排序问题）
 */
export class DebugVisualizations {
  // -----------------------------------------------------------------------
  // 公共调试开关
  // -----------------------------------------------------------------------

  /** 显示战斗几何体（武器射程等）。OpenRA 对照: CombatGeometry */
  combatGeometry: boolean = false

  /** 显示渲染几何体（精灵边界、命中框）。OpenRA 对照: RenderGeometry */
  renderGeometry: boolean = false

  /** 显示屏幕映射格。OpenRA 对照: ScreenMap */
  screenMap: boolean = false

  /** 显示 Actor 标签（ID/名称覆盖层）。OpenRA 对照: ActorTags */
  actorTags: boolean = false

  // -----------------------------------------------------------------------
  // 深度缓冲区调试（对应 OpenRA DepthBuffer / DepthBufferContrast / DepthBufferOffset）
  // -----------------------------------------------------------------------

  /**
   * 深度缓冲区在前一帧可能已被启用，初始化为脏标志以强制在首次
   * 渲染前重置默认渲染状态。
   *
   * OpenRA 对照: depthBufferDirty 字段
   */
  private depthBufferDirty: boolean = true

  private _depthBuffer: boolean = false

  /** 深度缓冲区调试预览的对比度。OpenRA 对照: depthBufferContrast */
  private _depthBufferContrast: number = 1.0

  /** 深度缓冲区调试预览的偏移。OpenRA 对照: depthBufferOffset */
  private _depthBufferOffset: number = 0.0

  /**
   * 是否启用深度缓冲区调试预览。
   *
   * OpenRA 对照: DebugVisualizations.DepthBuffer
   */
  get depthBuffer(): boolean {
    return this._depthBuffer
  }

  set depthBuffer(value: boolean) {
    this._depthBuffer = value
    this.depthBufferDirty = true
  }

  /**
   * 深度缓冲区预览对比度。
   *
   * OpenRA 对照: DebugVisualizations.DepthBufferContrast
   */
  get depthBufferContrast(): number {
    return this._depthBufferContrast
  }

  set depthBufferContrast(value: number) {
    this._depthBufferContrast = value
    this.depthBufferDirty = true
  }

  /**
   * 深度缓冲区预览偏移。
   *
   * OpenRA 对照: DebugVisualizations.DepthBufferOffset
   */
  get depthBufferOffset(): number {
    return this._depthBufferOffset
  }

  set depthBufferOffset(value: number) {
    this._depthBufferOffset = value
    this.depthBufferDirty = true
  }

  // -----------------------------------------------------------------------
  // UpdateDepthBuffer — 应用深度预览设置（对应 OpenRA UpdateDepthBuffer）
  // -----------------------------------------------------------------------

  /**
   * 如果深度缓冲区设置自上次更新以来已更改，则将其应用于渲染器。
   *
   * OpenRA 对照: DebugVisualizations.UpdateDepthBuffer()
   *
   * OpenRA 调用方式:
   *   Game.Renderer.WorldSpriteRenderer.SetDepthPreview(
   *     DepthBuffer, DepthBufferContrast, DepthBufferOffset);
   *
* Babylon.js 深度预览等效项尚未实现。
   * 可能的方法（非互斥）:
   *   a) 使用 Babylon.js DepthRenderer 附加到场景
   *   b) 自定义 PostProcess 着色器可视化深度纹理
   *   c) 使用 engine.setDepthBuffer() 启用写入，然后读取回深度纹理
   */
  updateDepthBuffer(): void {
    if (this.depthBufferDirty) {
      // NOTE: 在 OpenRA 中，这会设置 SpriteRenderer 的深度预览模式。
      // 在 Babylon.js 中，深度可视化需要不同的方法 — 可能是场景级别的
      // DepthRenderer 或自定义 PostProcess。
      // 目前仅在深度设置更改时重置脏标志。
      this.depthBufferDirty = false
    }
  }

  // -----------------------------------------------------------------------
  // 便捷方法
  // -----------------------------------------------------------------------

  /**
   * 重置所有调试开关为 false（关闭所有覆盖层）。
   *
   * OpenRA 对照: 无直接对应。在 C# 中通过单独的 DevCommands 处理。
   */
  resetAll(): void {
    this.combatGeometry = false
    this.renderGeometry = false
    this.screenMap = false
    this.actorTags = false
    this.depthBuffer = false
    this._depthBufferContrast = 1.0
    this._depthBufferOffset = 0.0
  }

  /**
   * 启用所有调试开关。
   *
   * OpenRA 对照: 无直接对应。在 C# 中通过单独的 DevCommands 处理。
   */
  enableAll(): void {
    this.combatGeometry = true
    this.renderGeometry = true
    this.screenMap = true
    this.actorTags = true
  }
}
