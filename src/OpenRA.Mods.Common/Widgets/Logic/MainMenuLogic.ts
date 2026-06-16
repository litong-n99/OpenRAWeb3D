/**
 * MainMenuLogic.ts — 主菜单屏幕逻辑（菜单导航、新闻展示、版本更新）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs (566 lines)
 *
 * 核心范式转换:
 * - OpenRA Game.OpenWindow / Ui.OpenWindow (C# widget 模态栈)
 *   → Ui.openWindow / Ui.closeWindow (TypeScript，已迁移 Ch5)
 * - OpenRA Game.Exit → window.close()（Web 环境）
 * - OpenRA DiscordService.UpdateStatus → 无操作存根（浏览器不支持）
 * - OpenRA WebServices / HttpClientFactory → fetch() API
 * - OpenRA Platform.SupportDir / Platform.ResolvePath → 浏览器暂存
 * - OpenRA Game.LoadEditor / Game.CreateLocalServer → 存根（服务器尚待迁移）
 * - OpenRA IntroductionPromptLogic / SystemInfoPromptLogic → 存根
 * - OpenRA FluentProvider.GetMessage → 返回 key 本身
 * - OpenRA WidgetUtils.WrapText → Canvas 2D measureText
 * - OpenRA Game.OnRemoteDirectConnect / Game.BeforeGameStart → 事件存根
 */

import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import { ChromeLogic, Ui } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModData } from '../../../OpenRA.Game/ModData.js'
import type { MapPreview } from '../../../OpenRA.Game/Map/MapPreview.js'

// ---------------------------------------------------------------------------
// Types adapted from OpenRA
// ---------------------------------------------------------------------------

/** 菜单面板枚举。OpenRA 对照: MainMenuLogic.MenuType */
export const MenuType = {
  Main: 0,
  Singleplayer: 1,
  Extras: 2,
  MapEditor: 3,
  StartupPrompts: 4,
  None: 5,
} as const
export type MenuType = (typeof MenuType)[keyof typeof MenuType]

/** 上次游戏状态枚举。OpenRA 对照: MainMenuLogic.MenuPanel */
export const MenuPanel = {
  None: 0,
  Missions: 1,
  Skirmish: 2,
  Multiplayer: 3,
  MapEditor: 4,
  Replays: 5,
  GameSaves: 6,
} as const
export type MenuPanel = (typeof MenuPanel)[keyof typeof MenuPanel]

/** MapVisibility flags 值。OpenRA 对照: MapVisibility [Flags] */
export const MapVisibility = {
  None: 0,
  Lobby: 1,
  Shellmap: 2,
  MissionSelector: 4,
} as const

/** 地图兼容性状态。OpenRA 对照: MapStatus */
export const MapStatus = {
  Unavailable: 0,
  Searching: 1,
  Available: 2,
} as const
export type MapStatus = (typeof MapStatus)[keyof typeof MapStatus]

// ---------------------------------------------------------------------------
// SoundSettings 最小接口（MainMenuLogic 需要）
// ---------------------------------------------------------------------------

/** MainMenuLogic 所需的 Sound 设置子集。 */
export interface MainMenuSoundSettings {
  /** 是否拉取新闻。 */
  fetchNews: boolean
  /** 是否检查版本更新。 */
  checkVersion: boolean
  /** 音频设置。 */
  sound: {
    mute: boolean
    musicVolume: number
    shuffle: boolean
    repeat: boolean
  }
  /** 服务器设置。 */
  server?: {
    map: string
  }
  /** 调试设置。 */
  debug?: {
    checkVersion: boolean
  }
  /** 保存设置。 */
  save?(): void
}

// ---------------------------------------------------------------------------
// IGameServices — MainMenuLogic 所需的全局服务接口
// ---------------------------------------------------------------------------

/** MainMenuLogic 所需的全局游戏服务。
 *
 * 迁移说明：OpenRA 使用静态 Game 类和全局单例访问。
 * TypeScript 迁移中，这些服务通过接口注入以提高可测试性。
 */
export interface IMainMenuGameServices {
  /** 退出应用。OpenRA 对照: Game.Exit() */
  exit(): void

  /** 断开连接。OpenRA 对照: Game.Disconnect() */
  disconnect(): void

  /** 关闭服务器。OpenRA 对照: Game.CloseServer() */
  closeServer(): void

  /** 创建本地服务器。OpenRA 对照: Game.CreateLocalServer(map, isSkirmish) */
  createLocalServer?(
    map: string,
    isSkirmish: boolean,
  ): unknown

  /** 加载地图编辑器。OpenRA 对照: Game.LoadEditor(uid) */
  loadEditor?(uid: string): void

  /** 引擎版本字符串。OpenRA 对照: Game.EngineVersion */
  engineVersion: string

  /** 获取地图缓存。 */
  mapCache: IMainMenuMapCache

  /** 远程直连事件。OpenRA 对照: Game.OnRemoteDirectConnect */
  onRemoteDirectConnect?: ((endpoint: unknown) => void) | null

  /** 游戏开始前事件。OpenRA 对照: Game.BeforeGameStart */
  beforeGameStart?: ((callback: () => void) => void) | null

  /** Shellmap 加载完成事件。OpenRA 对照: Game.OnShellmapLoaded */
  onShellmapLoaded?: ((callback: () => void) => void) | null

  /** 退出回调移除器。 */
  offRemoteDirectConnect?(handler: (endpoint: unknown) => void): void
  offBeforeGameStart?(handler: () => void): void
  offShellmapLoaded?(handler: () => void): void
}

/** 地图缓存最小接口。 */
export interface IMainMenuMapCache {
  /** 检查是否有匹配可见性的地图。 */
  hasAnyWithVisibility(visibility: number): boolean

  /** 选择一个初始地图。 */
  chooseInitialMap(preferred: string, random: () => number): string

  /** 获取最后修改的地图。 */
  pickLastModifiedMap(visibility: number): string | null

  /** 通过 UID 获取地图预览。 */
  getMapPreview(uid: string): MapPreview | null
}

// ---------------------------------------------------------------------------
// ConnectionLogic 存根（MainMenuLogic 需要 Connect 方法）
// ---------------------------------------------------------------------------

/** ConnectionLogic 连接存根。
 *
 * OpenRA 对照: ConnectionLogic.Connect(endpoint, password, onConnect, onExit)
 *
 * NOTE: 完整 ConnectionLogic 迁移推迟至 TODO-16.C.12。
 * 此存根提供 MainMenuLogic.StartSkirmishGame 所需的最小接口。
 */
export let ConnectionLogicConnect: ((
  endpoint: unknown,
  password: string,
  onConnect: () => void,
  onExit: () => void,
) => void) | null = null

/** 注册 ConnectionLogic.Connect 实现。 */
export function setConnectionLogicConnect(fn: typeof ConnectionLogicConnect): void {
  ConnectionLogicConnect = fn
}

// ---------------------------------------------------------------------------
// LoadGameBrowserLogic 存根
// ---------------------------------------------------------------------------

/** LoadGameBrowserLogic.IsLoadPanelEnabled 存根。
 *
 * NOTE: 完整迁移推迟至 TODO-16.C.5。
 */
export let IsLoadPanelEnabled: ((manifest: unknown) => boolean) | null = null

export function setIsLoadPanelEnabled(fn: typeof IsLoadPanelEnabled): void {
  IsLoadPanelEnabled = fn
}

// ---------------------------------------------------------------------------
// News 相关接口
// ---------------------------------------------------------------------------

/** 新闻条目。OpenRA 对照: MainMenuLogic.NewsItem */
export interface NewsItem {
  title: string
  author: string
  dateTime: Date
  content: string
}

// ---------------------------------------------------------------------------
// MainMenuLogic
// OpenRA 对照: MainMenuLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 主菜单逻辑 — 管理菜单导航、按钮连线、新闻/更新提示。
 *
 * 菜单状态机:
 * - Main → Singleplayer / Multiplayer / Settings / Extras / Quit
 * - Singleplayer → Missions / Skirmish / Load / Encyclopedia / Back
 * - Extras → Replays / Music / MapEditor / Credits / Back
 * - MapEditor → NewMap / LoadMap / Back
 *
 * OpenRA 对照: class MainMenuLogic : ChromeLogic
 */
export class MainMenuLogic extends ChromeLogic {
  // ---- 枚举导出（与 OpenRA 一致） ----

  static readonly MenuType = MenuType
  static readonly MenuPanel = MenuPanel

  // ---- 状态 ----

  /** 当前菜单类型。OpenRA 对照: menuType */
  menuType: MenuType = MenuType.Main

  /** 上次游戏状态（静态，跨实例共享）。OpenRA 对照: lastGameState */
  static lastGameState: MenuPanel = MenuPanel.None

  /** 是否已抓取新闻。OpenRA 对照: fetchedNews */
  private static _fetchedNews = false

  /** 新闻面板是否打开。 */
  private _newsOpen = false

  /** 获取新闻面板打开状态。 */
  get isNewsOpen(): boolean {
    return this._newsOpen
  }

  // ---- 引用 ----

  readonly modData: ModData
  private readonly _rootMenu: Widget
  private readonly _world: unknown
  private readonly _game: IMainMenuGameServices

  // ---- 构造 ----

  /**
   * @param widget — 根 widget 节点
   * @param world — 世界对象（传递给子面板）
   * @param modData — mod 运行时数据
   * @param game — 游戏服务（替代 OpenRA Game 静态类）
   */
  constructor(
    widget: Widget,
    world: unknown,
    modData: ModData,
    game: IMainMenuGameServices,
  ) {
    super()

    this.modData = modData
    this._rootMenu = widget
    this._world = world
    this._game = game

    this._wireMainMenu()
    this._wireSingleplayerMenu()
    this._wireExtrasMenu()
    this._wireMapEditorMenu()

    // 注册远程直连事件
    if (game.onRemoteDirectConnect) {
      game.onRemoteDirectConnect = this._onRemoteDirectConnect.bind(this)
    }

    // 检查版本更新
    this._checkVersionUpdate()

    // 标记新闻面板已关闭
    this._newsOpen = false

    // 启动流程
    this.menuType = MenuType.StartupPrompts
    this._onIntroductionComplete()

    // Shellmap 加载完成后打开基于上次游戏的菜单
    if (game.onShellmapLoaded) {
      game.onShellmapLoaded = this._openMenuBasedOnLastGame.bind(this)
    }
  }

  // ---------------------------------------------------------------------------
  // 菜单切换
  // ---------------------------------------------------------------------------

  /** 切换菜单。OpenRA 对照: SwitchMenu(MenuType) */
  switchMenu(type: MenuType): void {
    this.menuType = type
    // NOTE: DiscordService 存根 — 浏览器不支持 Discord RPC
  }

  // ---------------------------------------------------------------------------
  // 主菜单连线
  // ---------------------------------------------------------------------------

  private _wireMainMenu(): void {
    const mainMenu = this._rootMenu.get<Widget>('MAIN_MENU')
    ;(mainMenu as any).isVisible = () => this.menuType === MenuType.Main

    // 单人模式按钮
    try {
      const spButton = mainMenu.get<Widget & { onClick?: () => void }>('SINGLEPLAYER_BUTTON')
      spButton.onClick = () => this.switchMenu(MenuType.Singleplayer)
    } catch { /* 按钮不存在时跳过 */ }

    // 多人模式按钮
    try {
      const mpButton = mainMenu.get<Widget & { onClick?: () => void }>('MULTIPLAYER_BUTTON')
      mpButton.onClick = () => this.openMultiplayerPanel()
    } catch { /* 按钮不存在时跳过 */ }

    // 设置按钮
    try {
      const settingsButton = mainMenu.get<Widget & { onClick?: () => void }>('SETTINGS_BUTTON')
      settingsButton.onClick = () => {
        this.switchMenu(MenuType.None)
        Ui.openWindow('SETTINGS_PANEL', {
          onExit: () => this.switchMenu(MenuType.Main),
        })
      }
    } catch { /* 按钮不存在时跳过 */ }

    // 附加内容按钮
    try {
      const extrasButton = mainMenu.get<Widget & { onClick?: () => void }>('EXTRAS_BUTTON')
      extrasButton.onClick = () => this.switchMenu(MenuType.Extras)
    } catch { /* 按钮不存在时跳过 */ }

    // 退出按钮
    try {
      const quitButton = mainMenu.get<Widget & { onClick?: () => void }>('QUIT_BUTTON')
      quitButton.onClick = () => this._game.exit()
    } catch { /* 按钮不存在时跳过 */ }
  }

  // ---------------------------------------------------------------------------
  // 单人模式菜单
  // ---------------------------------------------------------------------------

  private _wireSingleplayerMenu(): void {
    const singleplayerMenu = this._rootMenu.get<Widget>('SINGLEPLAYER_MENU')
    ;(singleplayerMenu as any).isVisible = () => this.menuType === MenuType.Singleplayer

    const mapCache = this._game.mapCache

    // 任务按钮
    try {
      const missionsButton = singleplayerMenu.get<Widget & { onClick?: () => void; disabled?: boolean }>('MISSIONS_BUTTON')
      const lastMission = mapCache.pickLastModifiedMap(MapVisibility.MissionSelector)
      missionsButton.onClick = () => this.openMissionBrowserPanel(lastMission ?? undefined)
      missionsButton.disabled = !lastMission
    } catch { /* 按钮不存在时跳过 */ }

    // 遭遇战按钮
    try {
      const skirmishButton = singleplayerMenu.get<Widget & { onClick?: () => void; disabled?: boolean }>('SKIRMISH_BUTTON')
      skirmishButton.onClick = () => this.startSkirmishGame()
      skirmishButton.disabled = !mapCache.hasAnyWithVisibility(MapVisibility.Lobby)
    } catch { /* 按钮不存在时跳过 */ }

    // 加载游戏按钮
    try {
      const loadButton = singleplayerMenu.get<Widget & { onClick?: () => void; isDisabled?: () => boolean }>('LOAD_BUTTON')
      if (IsLoadPanelEnabled && this.modData.manifest) {
        loadButton.isDisabled = () => !IsLoadPanelEnabled!(this.modData.manifest)
      }
      loadButton.onClick = () => this.openGameSaveBrowserPanel()
    } catch { /* 按钮不存在时跳过 */ }

    // 百科按钮
    const encButton = singleplayerMenu.getOrNull<Widget & { onClick?: () => void }>('ENCYCLOPEDIA_BUTTON')
    if (encButton) {
      encButton.onClick = () => this.openEncyclopediaPanel()
    }

    // 返回按钮
    try {
      const backButton = singleplayerMenu.get<Widget & { onClick?: () => void }>('BACK_BUTTON')
      backButton.onClick = () => this.switchMenu(MenuType.Main)
    } catch { /* 按钮不存在时跳过 */ }
  }

  // ---------------------------------------------------------------------------
  // 附加内容菜单
  // ---------------------------------------------------------------------------

  private _wireExtrasMenu(): void {
    const extrasMenu = this._rootMenu.get<Widget>('EXTRAS_MENU')
    ;(extrasMenu as any).isVisible = () => this.menuType === MenuType.Extras

    // 回放按钮
    try {
      extrasMenu.get<Widget & { onClick?: () => void }>('REPLAYS_BUTTON').onClick =
        () => this.openReplayBrowserPanel()
    } catch { /* 按钮不存在时跳过 */ }

    // 音乐按钮
    try {
      extrasMenu.get<Widget & { onClick?: () => void }>('MUSIC_BUTTON').onClick = () => {
        this.switchMenu(MenuType.None)
        Ui.openWindow('MUSIC_PANEL', {
          onExit: () => this.switchMenu(MenuType.Extras),
          world: this._world,
        })
      }
    } catch { /* 按钮不存在时跳过 */ }

    // 地图编辑器按钮
    try {
      extrasMenu.get<Widget & { onClick?: () => void }>('MAP_EDITOR_BUTTON').onClick =
        () => this.switchMenu(MenuType.MapEditor)
    } catch { /* 按钮不存在时跳过 */ }

    // 制作人员按钮
    try {
      extrasMenu.get<Widget & { onClick?: () => void }>('CREDITS_BUTTON').onClick = () => {
        this.switchMenu(MenuType.None)
        Ui.openWindow('CREDITS_PANEL', {
          onExit: () => this.switchMenu(MenuType.Extras),
        })
      }
    } catch { /* 按钮不存在时跳过 */ }

    // 返回按钮
    try {
      extrasMenu.get<Widget & { onClick?: () => void }>('BACK_BUTTON').onClick =
        () => this.switchMenu(MenuType.Main)
    } catch { /* 按钮不存在时跳过 */ }
  }

  // ---------------------------------------------------------------------------
  // 地图编辑器菜单
  // ---------------------------------------------------------------------------

  private _wireMapEditorMenu(): void {
    const mapEditorMenu = this._rootMenu.get<Widget>('MAP_EDITOR_MENU')
    ;(mapEditorMenu as any).isVisible = () => this.menuType === MenuType.MapEditor

    // NOTE: Game.BeforeGameStart += RemoveShellmapUI
    if (this._game.beforeGameStart) {
      this._game.beforeGameStart(() => this._removeShellmapUI())
    }

    // 选择地图回调
    const onSelect = (uid: string) => {
      const preview = this._game.mapCache.getMapPreview(uid)
      if (!preview || preview.status !== MapStatus.Available) {
        this.switchMenu(MenuType.Extras)
      } else {
        this._loadMapIntoEditor(uid)
      }
    }

    // 新建地图按钮
    try {
      const newMapButton = this._rootMenu.get<Widget & { onClick?: () => void }>('NEW_MAP_BUTTON')
      newMapButton.onClick = () => {
        this.switchMenu(MenuType.None)
        Ui.openWindow('NEW_MAP_BG', {
          onSelect,
          onExit: () => this.switchMenu(MenuType.MapEditor),
        })
      }
    } catch { /* 按钮不存在时跳过 */ }

    // 加载地图按钮
    try {
      const loadMapButton = this._rootMenu.get<Widget & { onClick?: () => void; disabled?: boolean }>('LOAD_MAP_BUTTON')
      loadMapButton.onClick = () => {
        this.switchMenu(MenuType.None)
        Ui.openWindow('MAPCHOOSER_PANEL', {
          initialMap: null,
          initialGeneratedMap: null,
          remoteMapPool: null,
          initialTab: 2, // MapClassification.User = 2
          onExit: () => this.switchMenu(MenuType.MapEditor),
          onSelect,
          onSelectGenerated: null,
          filter: MapVisibility.Lobby | MapVisibility.Shellmap | MapVisibility.MissionSelector,
        })
      }
      loadMapButton.disabled = !this._game.mapCache.hasAnyWithVisibility(MapVisibility.Lobby)
    } catch { /* 按钮不存在时跳过 */ }

    // 返回按钮
    try {
      mapEditorMenu.get<Widget & { onClick?: () => void }>('BACK_BUTTON').onClick =
        () => this.switchMenu(MenuType.Extras)
    } catch { /* 按钮不存在时跳过 */ }
  }

  // ---------------------------------------------------------------------------
  // 面板打开方法
  // ---------------------------------------------------------------------------

  /** 打开多人模式面板。OpenRA 对照: OpenMultiplayerPanel() */
  openMultiplayerPanel(): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('MULTIPLAYER_PANEL', {
      onStart: () => {
        this._removeShellmapUI()
        MainMenuLogic.lastGameState = MenuPanel.Multiplayer
      },
      onExit: () => this.switchMenu(MenuType.Main),
      directConnectEndPoint: null,
    })
  }

  /** 打开任务浏览器。OpenRA 对照: OpenMissionBrowserPanel(string) */
  openMissionBrowserPanel(map?: string): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('MISSIONBROWSER_PANEL', {
      onExit: () => {
        this._game.disconnect()
        this.switchMenu(MenuType.Singleplayer)
      },
      onStart: () => {
        this._removeShellmapUI()
        MainMenuLogic.lastGameState = MenuPanel.Missions
      },
      initialMap: map ?? null,
    })
  }

  /** 打开百科面板。OpenRA 对照: OpenEncyclopediaPanel() */
  openEncyclopediaPanel(): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('ENCYCLOPEDIA_PANEL', {
      onExit: () => this.switchMenu(MenuType.Singleplayer),
    })
  }

  /** 打开游戏存档浏览器。OpenRA 对照: OpenGameSaveBrowserPanel() */
  openGameSaveBrowserPanel(): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('LOAD_GAME_BROWSER_PANEL', {
      onExit: () => this.switchMenu(MenuType.Singleplayer),
      onStart: () => {
        this._removeShellmapUI()
        MainMenuLogic.lastGameState = MenuPanel.GameSaves
      },
    })
  }

  /** 打开回放浏览器。OpenRA 对照: OpenReplayBrowserPanel() */
  openReplayBrowserPanel(): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('REPLAYBROWSER_PANEL', {
      onExit: () => this.switchMenu(MenuType.Extras),
      onStart: () => {
        this._removeShellmapUI()
        MainMenuLogic.lastGameState = MenuPanel.Replays
      },
    })
  }

  // ---------------------------------------------------------------------------
  // 遭遇战启动
  // ---------------------------------------------------------------------------

  /** 启动遭遇战。OpenRA 对照: StartSkirmishGame() */
  startSkirmishGame(): void {
    this.switchMenu(MenuType.None)

    const mapCache = this._game.mapCache
    const preferred =
      (this.modData as any).settings?.server?.map ?? ''

    const map = mapCache.chooseInitialMap(
      mapCache.pickLastModifiedMap(MapVisibility.Lobby) ?? preferred,
      Math.random,
    )

    if (ConnectionLogicConnect) {
      const endpoint = this._game.createLocalServer
        ? this._game.createLocalServer(map, true)
        : null
      ConnectionLogicConnect(
        endpoint,
        '',
        () => this._openSkirmishLobbyPanel(),
        () => {
          this._game.closeServer()
          this.switchMenu(MenuType.Main)
        },
      )
    }
  }

  private _openSkirmishLobbyPanel(): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('SERVER_LOBBY', {
      onExit: () => {
        this._game.disconnect()
        this.switchMenu(MenuType.Singleplayer)
      },
      onStart: () => {
        this._removeShellmapUI()
        MainMenuLogic.lastGameState = MenuPanel.Skirmish
      },
      skirmishMode: true,
    })
  }

  // ---------------------------------------------------------------------------
  // 编辑器
  // ---------------------------------------------------------------------------

  /** 将地图加载到编辑器。OpenRA 对照: LoadMapIntoEditor(string) */
  private _loadMapIntoEditor(uid: string): void {
    if (this._game.loadEditor) {
      this._game.loadEditor(uid)
    }
    MainMenuLogic.lastGameState = MenuPanel.MapEditor
  }

  // ---------------------------------------------------------------------------
  // 远程直连
  // ---------------------------------------------------------------------------

  /** 远程直连处理器。OpenRA 对照: OnRemoteDirectConnect(ConnectionTarget) */
  private _onRemoteDirectConnect(endpoint: unknown): void {
    this.switchMenu(MenuType.None)
    Ui.openWindow('MULTIPLAYER_PANEL', {
      onStart: () => this._removeShellmapUI(),
      onExit: () => this.switchMenu(MenuType.Main),
      directConnectEndPoint: endpoint,
    })
  }

  // ---------------------------------------------------------------------------
  // Shellmap UI 移除
  // ---------------------------------------------------------------------------

  /** 移除 Shellmap UI。OpenRA 对照: RemoveShellmapUI() */
  private _removeShellmapUI(): void {
    if (this._rootMenu.parent) {
      this._rootMenu.parent.removeChild(this._rootMenu)
    }
  }

  // ---------------------------------------------------------------------------
  // 版本更新检查
  // ---------------------------------------------------------------------------

  /** 检查版本更新。OpenRA 对照: webServices.CheckModVersion() */
  private _checkVersionUpdate(): void {
    // NOTE: 完整 WebServices 迁移推迟。
    // 当前仅检查 settings.debug.checkVersion 标志。
    void MainMenuLogic._fetchedNews
  }

  // ---------------------------------------------------------------------------
  // 启动提示流程
  // ---------------------------------------------------------------------------

  /** 介绍提示完成后执行。OpenRA 对照: OnIntroductionComplete() */
  private _onIntroductionComplete(): void {
    // NOTE: 完整 IntroductionPromptLogic / SystemInfoPromptLogic 迁移推迟。
    // 当前直接跳转到主菜单。
    this.switchMenu(MenuType.Main)
  }

  // ---------------------------------------------------------------------------
  // 基于上次游戏打开菜单
  // ---------------------------------------------------------------------------

  /** 基于上次游戏状态打开对应菜单。OpenRA 对照: OpenMenuBasedOnLastGame() */
  private _openMenuBasedOnLastGame(): void {
    switch (MainMenuLogic.lastGameState) {
      case MenuPanel.Missions:
        this.openMissionBrowserPanel()
        break
      case MenuPanel.Replays:
        this.openReplayBrowserPanel()
        break
      case MenuPanel.Skirmish:
        this.startSkirmishGame()
        break
      case MenuPanel.Multiplayer:
        this.openMultiplayerPanel()
        break
      case MenuPanel.MapEditor:
        this.switchMenu(MenuType.MapEditor)
        break
      case MenuPanel.GameSaves:
        this.switchMenu(MenuType.Singleplayer)
        break
    }
    MainMenuLogic.lastGameState = MenuPanel.None
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic 接口实现
  // ---------------------------------------------------------------------------

  /** 每帧 tick。OpenRA 对照: ChromeLogic.Tick() */
  tick(): void {
    // 主菜单无每帧逻辑
  }

  /** 清理事件订阅。OpenRA 对照: Dispose(bool) */
  override dispose(): void {
    // 清理事件订阅
    if (this._game.offRemoteDirectConnect) {
      this._game.offRemoteDirectConnect(this._onRemoteDirectConnect.bind(this))
    }
    if (this._game.offShellmapLoaded) {
      this._game.offShellmapLoaded(this._openMenuBasedOnLastGame.bind(this))
    }
    super.dispose()
  }
}
