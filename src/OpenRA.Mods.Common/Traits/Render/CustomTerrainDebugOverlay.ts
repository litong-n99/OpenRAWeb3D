/**
 * CustomTerrainDebugOverlay.ts — 自定义地形调试覆盖层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/CustomTerrainDebugOverlay.cs
 *
 * 核心范式转换:
 * - C# IWorldLoaded + IChatCommand + IRenderAnnotations 多接口实现
 *   → TypeScript implements IWorldLoaded, IRenderAnnotations + IChatCommand 桩
 * - C# Game.Renderer.Fonts[info.Font] (SpriteFont bitmap font)
 *   → TODO: CSS/Canvas 文本渲染替代（无 bitmap 字体加载器）
 * - C# TextAnnotationRenderable (2D 文本精灵)
 *   → TODO: Babylon.js GUI TextBlock 或动态纹理文本
 * - C# yield return (迭代器) → TypeScript 数组收集模式
 * - C# byte.MaxValue (255) → 字面量 0xFF
 *
 * CustomTerrainDebugOverlay 在自定义地形单元格上绘制彩色文本覆盖层。
 * 通过 "/custom-terrain" 聊天命令切换启用/禁用。
 */

import type {
  IWorldLoaded,
  IRenderAnnotations,
  IRenderable,
  WorldStub,
  WorldRendererStub,
  IGameActor,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IChatCommand — 聊天命令接口桩（未迁移系统）
// ---------------------------------------------------------------------------

/**
 * 聊天命令接口桩。
 *
 * OpenRA 对照: OpenRA.Traits.IChatCommand
 *
* 完整的 IChatCommand 系统（ChatCommands 注册表、
 * 命令解析、权限检查）在后续 Phase E 迁移。当前提供最小桩接口
 * 以满足 CustomTerrainDebugOverlay 的结构需求。
 *
 * 命令格式: "/<CommandName> [args]"
 */
export interface IChatCommandStub {
  /** 调用聊天命令。OpenRA 对照: IChatCommand.InvokeCommand */
  invokeCommand(name: string, arg: string): void
}

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlayInfo（对应 OpenRA CustomTerrainDebugOverlayInfo）
// ---------------------------------------------------------------------------

/**
 * CustomTerrainDebugOverlay 特质配置。
 *
 * OpenRA 对照: CustomTerrainDebugOverlayInfo : TraitInfo
 *
 * [TraitLocation(SystemActors.World)]
 * [Desc("Displays custom terrain types.")]
 */
export class CustomTerrainDebugOverlayInfo {
  readonly instanceName?: string

  /**
   * 用于地形标签渲染的字体名称。
   *
   * OpenRA 对照: CustomTerrainDebugOverlayInfo.Font (默认 "TinyBold")
   */
  readonly font: string

  constructor(params?: { instanceName?: string; font?: string }) {
    this.instanceName = params?.instanceName
    this.font = params?.font ?? 'TinyBold'
  }
}

// ---------------------------------------------------------------------------
// CustomTerrainDebugOverlay（对应 OpenRA CustomTerrainDebugOverlay）
// ---------------------------------------------------------------------------

/**
 * 在自定义地形单元格上绘制彩色文本覆盖层。
 *
 * OpenRA 对照: OpenRA.Mods.Common.Traits.CustomTerrainDebugOverlay
 *
 * 实现:
 * - IWorldLoaded: 在 World 加载时注册聊天命令
 * - IChatCommand: 处理 "/custom-terrain" 命令切换覆盖层
 * - IRenderAnnotations: 在每个可见的自定义地形单元格上渲染文本标签
 *
 * 行为:
 * - 默认禁用，通过 "/custom-terrain" 命令切换
 * - 仅在 DeveloperMode.Enabled 为 true 时生效
 * - 跳过被战争迷雾遮挡的单元格
 * - 跳过没有自定义地形的单元格（值 = 0xFF / 255）
 * - 在每个单元格中心渲染地形类型文本，颜色使用 TerrainInfo.Color
 */
export class CustomTerrainDebugOverlay
  implements IWorldLoaded, IChatCommandStub, IRenderAnnotations {
  // -----------------------------------------------------------------------
  // 常量（对应 OpenRA 中的 const 字段）
  // -----------------------------------------------------------------------

  /** 聊天命令名称。OpenRA 对照: CommandName */
  static readonly CommandName = 'custom-terrain'

  /** Order 名称。OpenRA 对照: OrderName */
  static readonly OrderName = 'DevCustomTerrain'

  // -----------------------------------------------------------------------
  // 公共状态
  // -----------------------------------------------------------------------

  /** 覆盖层是否已启用。OpenRA 对照: Enabled */
  enabled: boolean = false

  // -----------------------------------------------------------------------
  // 私有状态
  // -----------------------------------------------------------------------

  /**
   * 字体名称（来自 Info）。
   *
   * OpenRA 对照: font
   *
   * NOTE: 当前仅存储字体名称。当 SpriteFont 系统迁移完成后（），
   * 此字段将解析为实际的字体渲染对象，用于 TextAnnotationRenderable。
   */
  readonly fontName: string

  /** 开发者模式特质引用。OpenRA 对照: devMode */
  private _devMode: { readonly enabled: boolean } | null = null

  /** World 引用（WorldLoaded 时缓存）。OpenRA 对照: world */
  private _world: WorldStub | null = null

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 构造 CustomTerrainDebugOverlay。
   *
   * OpenRA 对照: CustomTerrainDebugOverlay(CustomTerrainDebugOverlayInfo info)
   *
   * OpenRA: font = Game.Renderer.Fonts[info.Font];
   * TypeScript: 在 HTTP 环境中，字体通过 CSS font-family 处理。
* 当 SpriteFont / 字体系统迁移完毕后，将 _fontName
   * 解析为实际的字体渲染对象。
   *
   * @param info — 特质配置
   */
  constructor(info: CustomTerrainDebugOverlayInfo) {
    this.fontName = info.font
  }

  // -----------------------------------------------------------------------
  // IWorldLoaded（对应 OpenRA IWorldLoaded.WorldLoaded）
  // -----------------------------------------------------------------------

  /**
   * World 加载时初始化：缓存 World 引用、获取 DeveloperMode、
   * 注册聊天命令和帮助文本。
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World w, WorldRenderer wr)
   *
* 完整的 ChatCommands.RegisterCommand() 和
   * HelpCommand.RegisterHelp() 注册需要聊天命令系统迁移（Phase E）。
   * 当前仅缓存 World 引用和 DeveloperMode。
   *
   * @param w — World 实例
   * @param _wr — WorldRenderer 实例
   */
  worldLoaded(w: WorldStub, _wr: WorldRendererStub): void {
    this._world = w

    // 获取 DeveloperMode 特质（如果可用）
    // OpenRA: devMode = world.LocalPlayer?.PlayerActor.Trait<DeveloperMode>();
    // TypeScript: 通过本地玩家的 PlayerActor 的 trait 字典获取
    const localPlayer = (w as any).localPlayer as PlayerStub | null | undefined
    if (localPlayer) {
      const playerActor = (localPlayer as any).playerActor as IGameActor | null
      if (playerActor && typeof (playerActor as any).trait === 'function') {
        this._devMode = (playerActor as any).trait('DeveloperMode') as
          | { readonly enabled: boolean }
          | null
      }
    }

    // 注册聊天命令
    //   const console = w.worldActor?.trait?.('ChatCommands')
    //   const help = w.worldActor?.trait?.('HelpCommand')
    //   if (console && help && devMode) {
    //     console.registerCommand(CommandName, this)
    //     help.registerHelp(CommandName, CommandDescription)
    //   }
  }

  // -----------------------------------------------------------------------
  // IChatCommand（对应 OpenRA IChatCommand.InvokeCommand）
  // -----------------------------------------------------------------------

  /**
   * 处理聊天命令。
   *
   * OpenRA 对照: IChatCommand.InvokeCommand(string name, string arg)
   *
   * 行为:
   * 1. 验证命令名称匹配 CommandName
   * 2. 检查 DeveloperMode.Enabled（需要开发者模式）
   * 3. 切换 enabled 布尔值
   * 4. 显示切换通知（启用/禁用）
   *
* TextNotificationsManager 和 FluentProvider 消息
   * 系统尚未迁移。当前仅切换 enabled 标志。
   *
   * @param name — 命令名称
   * @param _arg — 命令参数（未使用）
   */
  invokeCommand(name: string, _arg: string): void {
    if (name !== CustomTerrainDebugOverlay.CommandName) {
      return
    }

    // 检查开发者模式
    if (!this._devMode || !this._devMode.enabled) {
      // TextNotificationsManager.Debug(
      //   FluentProvider.GetMessage(CheatsDisabled))
      return
    }

    // 切换覆盖层
    this.enabled = !this.enabled

    // 显示通知
    //   const notification = Enabled ? CheatEnabled : CheatDisabled
    //   const playerName = world.LocalPlayer?.ResolvedPlayerName ?? ""
    //   TextNotificationsManager.Debug(FluentProvider.GetMessage(
    //     notification, "cheat", OrderName, "player", playerName))
  }

  // -----------------------------------------------------------------------
  // IRenderAnnotations（对应 OpenRA IRenderAnnotations.RenderAnnotations）
  // -----------------------------------------------------------------------

  /**
   * 渲染注释：在自定义地形单元格上绘制文本标签。
   *
   * OpenRA 对照: IRenderAnnotations.RenderAnnotations(Actor self, WorldRenderer wr)
   *
   * 迭代视口内的所有可见单元格，跳过被战争迷雾遮挡的单元格
   * (ShroudObscures)，仅处理具有自定义地形的单元格（customTerrain != 0xFF）。
   *
   * 每个匹配的单元格渲染一个 TextAnnotationRenderable，显示地形类型
   * 文本，颜色使用 TerrainInfo.Color。
   *
* 完整的文本渲染需要：
   *   a) SpriteFont 系统迁移（bitmap 字体 → CSS/Canvas）
   *   b) TextAnnotationRenderable 迁移（OpenRA 2D 文本 → Babylon.js GUI TextBlock）
   *   c) ShroudObscures(uv) 检查（需要 Ch12 Shroud 系统）
   *   d) Viewport.VisibleCellsInsideBounds（需要完整 Viewport 迁移）
   * 当前返回空数组并进行基础逻辑检查。
   *
   * @param _self — actor 实例（World Actor）
   * @param _wr — WorldRenderer 实例
   * @returns 可渲染对象数组（当前始终为空，待文本渲染系统迁移）
   */
  renderAnnotations(
    _self: IGameActor,
    _wr: WorldRendererStub,
  ): readonly IRenderable[] {
    // 快速路径：覆盖层未启用
    if (!this.enabled) {
      return []
    }

    // NOTE: 在完整的 OpenRA 实现中，此方法：
    //   foreach (var uv in wr.Viewport.VisibleCellsInsideBounds.CandidateMapCoords)
    //   {
    //     if (self.World.ShroudObscures(uv)) continue;
    //     var cell = uv.ToCPos(wr.World.Map);
    //     var center = wr.World.Map.CenterOfCell(cell);
    //     var terrainType = self.World.Map.CustomTerrain[cell];
    //     if (terrainType == byte.MaxValue) continue;
    //     var info = wr.World.Map.GetTerrainInfo(cell);
    //     yield return new TextAnnotationRenderable(font, center, 0, info.Color, info.Type);
    //   }

    // 实现完整的渲染逻辑。当前返回空数组。
    // 依赖项（均未迁移）:
    //   - Viewport.VisibleCellsInsideBounds ()
    //   - Map.ShroudObscures (Ch12 Shroud 系统)
    //   - Map.CenterOfCell (坐标转换)
    //   - Map.CustomTerrain cell indexer
    //   - Map.GetTerrainInfo (地形信息查询)
    //   - TextAnnotationRenderable (2D 文本精灵)
    //   - SpriteFont (bitmap 字体渲染)

    return []
  }

  /**
   * 注释是否参与空间分区。
   *
   * OpenRA 对照: IRenderAnnotations.SpatiallyPartitionable => false
   *
   * 返回 false 因为每个单元格的覆盖层标签是动态的且数量可变。
   */
  get spatiallyPartitionable(): boolean {
    return false
  }

  /**
   * 返回 WorldLoaded 时缓存的 World 引用。
   *
   * OpenRA 对照: world 字段
   *
   * 供将来完整的 RenderAnnotations 实现使用（），
   * 以访问 Map.CustomTerrain、Map.GetTerrainInfo、Map.CenterOfCell 等。
   *
   * @returns 缓存的 World 实例，若 worldLoaded 尚未调用则为 null
   */
  get world(): WorldStub | null {
    return this._world
  }
}
