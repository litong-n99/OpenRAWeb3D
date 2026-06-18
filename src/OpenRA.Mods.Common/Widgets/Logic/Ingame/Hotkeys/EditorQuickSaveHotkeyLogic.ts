/**
 * EditorQuickSaveHotkeyLogic.ts — 编辑器快速保存热键 (Ctrl+S)
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Ingame/Hotkeys/EditorQuickSaveHotkeyLogic.cs (61 lines)
 *
 * 核心范式转换:
 * - C# extends SingleHotkeyBaseLogic → TypeScript extends SingleHotkeyBaseLogic
 * - C# EditorActionManager.Modified / SaveFailed → TypeScript Modified / SaveFailed
 * - C# EditorActorLayer.Save() / Players.ToMiniYaml() → TypeScript save() / Players
 * - C# IReadWritePackage cast → TypeScript type check
 * - C# SaveMapLogic.SaveMap() / SaveMapInner() → TypeScript static methods
 *
 * 监听 Ctrl+S 热键触发快速保存。检查地图是否被修改且上次保存未失败，
 * 收集 actor 和 player 定义，然后委托给 SaveMapLogic 执行保存。
 *
 * Migration:  — Chapter 21 Phase C Wave 1
 */
import type { Widget, WidgetArgs } from '../../../../../OpenRA.Game/Widgets/Widget.js'
import {
  SingleHotkeyBaseLogic,
  type KeyInputContext,
} from '../../SingleHotkeyBaseLogic.js'

// ---------------------------------------------------------------------------
// Minimal interfaces for editor traits used by save logic
// ---------------------------------------------------------------------------

/** Minimal EditorActionManager interface for save hotkey.
 *
 * OpenRA 对照: EditorActionManager { bool Modified, bool SaveFailed }
 */
export interface ISaveActionManager {
  readonly Modified: boolean
  readonly SaveFailed: boolean
}

/** Minimal EditorActorLayer interface for save hotkey.
 *
 * OpenRA 对照: EditorActorLayer { Save(), Players }
 */
export interface ISaveActorLayer {
  save(): { key: string; value: Record<string, unknown> }[] | null
  readonly Players: {
    toMiniYaml(): unknown[] | null
  } | null
}

/** Minimal Map interface for save hotkey.
 *
 * OpenRA 对照: Map { ActorDefinitions, PlayerDefinitions, Package }
 */
export interface ISaveMap {
  actorDefinitions: unknown[] | null
  playerDefinitions: unknown[] | null
  readonly package: { readonly name: string } | null
  readonly uid: string
}

/** Minimal World interface for save hotkey.
 *
 * OpenRA 对照: World { WorldActor, Map }
 */
export interface ISaveWorld {
  readonly worldActor: {
    traitOrDefault<T>(_traitClass: new () => T): T | null
  }
  readonly map: ISaveMap
}

/** Minimal ModData for save operations. */
export interface ISaveModData {
  // Reserved for future use
}

// ---------------------------------------------------------------------------
// Save callback type
// ---------------------------------------------------------------------------

/** Callback invoked with the combined save path.
 *
 * OpenRA 对照: void SaveMap(string combinedPath)
 */
export type SaveMapCallback = (combinedPath: string) => void

// ---------------------------------------------------------------------------
// EditorQuickSaveHotkeyLogic
// OpenRA 对照: public class EditorQuickSaveHotkeyLogic : SingleHotkeyBaseLogic
// ---------------------------------------------------------------------------

/**
 * 编辑器快速保存热键逻辑。
 *
 * 响应 Ctrl+S 热键，检查修改状态，收集数据并执行保存。
 *
 * OpenRA 对照: [ChromeLogicArgsHotkeys("EditorQuickSaveKey")]
 *   public class EditorQuickSaveHotkeyLogic : SingleHotkeyBaseLogic
 */
export class EditorQuickSaveHotkeyLogic extends SingleHotkeyBaseLogic {
  /** 世界引用。OpenRA 对照: readonly World world */
  private readonly world: ISaveWorld

  /** ModData 引用。OpenRA 对照: readonly ModData modData */
  private readonly _modData: ISaveModData

  /** 外部保存函数（用于测试注入）。 */
  private readonly _saveFn: EditorSaveFunction

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: EditorQuickSaveHotkeyLogic(Widget, ModData, World, Dictionary)
  // ---------------------------------------------------------------------------

  /**
   * 构造 EditorQuickSaveHotkeyLogic。
   *
   * OpenRA 对照: EditorQuickSaveHotkeyLogic(Widget widget, ModData modData,
   *   World world, Dictionary<string, MiniYaml> logicArgs)
   *   : base(widget, modData, "QuickSaveKey", "GLOBAL_KEYHANDLER", logicArgs)
   *
   * @param widget — 父 widget
   * @param modData — ModData（用于热键解析）
   * @param world — 游戏世界
   * @param logicArgs — 逻辑参数
   * @param hotkeyDisplay — 热键显示字符串覆盖（默认 "Ctrl+S"）
   * @param saveFn — 保存函数覆盖（用于测试）
   */
  constructor(
    widget: Widget,
    modData: unknown,
    world: ISaveWorld,
    logicArgs: WidgetArgs,
    hotkeyDisplay?: string,
    saveFn?: EditorSaveFunction,
  ) {
    super(widget, modData, 'QuickSaveKey', 'GLOBAL_KEYHANDLER', logicArgs, hotkeyDisplay ?? 'Ctrl+S')
    this.world = world
    this._modData = modData as ISaveModData
    this._saveFn = saveFn ?? defaultEditorSave
  }

  // ---------------------------------------------------------------------------
  // OnHotkeyActivated
  // OpenRA 对照: protected override bool OnHotkeyActivated(KeyInput keyInput)
  // ---------------------------------------------------------------------------

  /**
   * 当热键被激活时，检查修改状态并触发保存。
   *
   * OpenRA 对照: OnHotkeyActivated(KeyInput keyInput)
   *
   * @param _ctx — 按键上下文
   * @returns true 如果热键被处理（无论保存是否成功）
   */
  protected override onHotkeyActivated(_ctx: KeyInputContext): boolean {
    const actionManager = this.world.worldActor.traitOrDefault<ISaveActionManager>(
      EditorActionManagerPlaceholder as unknown as new () => ISaveActionManager,
    )
    if (actionManager && (!actionManager.Modified || actionManager.SaveFailed)) {
      return false
    }

    const map = this.world.map
    this._saveFn(this._modData, this.world, map, map.package?.name ?? null)
    return true
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 每帧更新（无需操作）。
   */
  override tick(): void {
    // No-op
  }
}

// ---------------------------------------------------------------------------
// EditorSaveFunction type
// ---------------------------------------------------------------------------

/**
 * Performs the full editor save operation.
 *
 * OpenRA 对照: SaveMapLogic.SaveMap(ModData, World, Map, string?, SaveMap)
 *
 * @param modData — ModData reference
 * @param world — the game world
 * @param map — the map being saved
 * @param path — the save path, or null to prompt
 */
export type EditorSaveFunction = (
  modData: ISaveModData,
  world: ISaveWorld,
  map: ISaveMap,
  path: string | null,
) => void

// ---------------------------------------------------------------------------
// Default save function (delegates to SaveMapLogic)
// ---------------------------------------------------------------------------

/**
 * Default editor save function.
 *
 * When SaveMapLogic is available, this collects actor and player definitions
 * and calls SaveMapLogic.saveMap(). For now, this is a stub that logs the
 * save operation.
 *
 * NOTE: Full save functionality will be enabled when SaveMapLogic is migrated
 * ().
 *
 * OpenRA 对照: inline SaveMap(string combinedPath) { ... SaveMapLogic.SaveMapInner(...) }
 */
const defaultEditorSave: EditorSaveFunction = (_modData, _world, _map, _path) => {
  // When SaveMapLogic is migrated, call
  //   const editorActorLayer = world.worldActor.trait<ISaveActorLayer>(...)
  //   const actorDefinitions = editorActorLayer.save()
  //   if (actorDefinitions) map.actorDefinitions = actorDefinitions
  //   const playerDefinitions = editorActorLayer.Players?.toMiniYaml()
  //   if (playerDefinitions) map.playerDefinitions = playerDefinitions
  //   SaveMapLogic.saveMap(modData, world, map, path, (combinedPath) => {
  //     const pkg = map.package as IReadWritePackage
  //     SaveMapLogic.saveMapInner(map, pkg, world, modData)
  //   })

  // Stub: log that save was triggered
  if (typeof console !== 'undefined') {
    console.debug('[EditorQuickSaveHotkeyLogic] Quick save triggered')
  }
}

// ---------------------------------------------------------------------------
// Placeholder class for EditorActionManager trait lookup
// ---------------------------------------------------------------------------

/** Placeholder for EditorActionManager type-based trait lookup.
 * In production, this would be replaced with the real EditorActionManager class.
 * @internal */
class EditorActionManagerPlaceholder {
  Modified: boolean = false
  SaveFailed: boolean = false
}
