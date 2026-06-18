/**
 * ServerListLogic.ts — Multiplayer server browser screen logic
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/ServerListLogic.cs (892 lines)
 *
 * 核心范式转换:
 * - C# HttpQueryBuilder + HttpClient.GetAsync → fetch API (simplified stub)
 * - C# MiniYaml server list parsing → JSON (simplified by GameServer interface)
 * - C# BeaconLib.Probe (LAN UDP discovery) → simplified LAN probe stub
 * - C# Game.RunAfterTick → setTimeout / requestAnimationFrame
 * - C# ScrollPanelWidget with CachedTransform → TypeScript widget delegates
 * - C# MPGameFilters enum → bitmask type from LobbyTypes
 * - C# Game.Settings.Game.MPGameFilters → settings object
 */

import { ChromeLogic } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ScrollPanelWidget } from '../../Widgets/ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../Widgets/ScrollItemWidget.js'
import type { ButtonWidget } from '../../Widgets/ButtonWidget.js'
import type { LabelWidget } from '../../Widgets/LabelWidget.js'
import type { ImageWidget } from '../../Widgets/ImageWidget.js'
import type { LabelWithTooltipWidget } from '../../Widgets/LabelWithTooltipWidget.js'
import type { LogicTickerWidget } from '../../Widgets/LogicTickerWidget.js'
import { WidgetUtils } from '../../Widgets/WidgetUtils.js'
import {
  CachedTransform,
  MPGameFilters,
  ServerState,
  type GameServer,
  type GameClient,
} from './Lobby/LobbyTypes.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID
// ---------------------------------------------------------------------------

function wc<T extends Widget = Widget>(parent: Widget, id: string): T | undefined {
  return (parent as unknown as Record<string, unknown>)[id] as T | undefined
}

// ---------------------------------------------------------------------------
// Fluent message stub ()
// ---------------------------------------------------------------------------

function fluentMsg(key: string, ..._args: string[]): string {
  return key
}

// ---------------------------------------------------------------------------
// SearchStatus
// ---------------------------------------------------------------------------

const SearchStatus = {
  Fetching: 'Fetching',
  Failed: 'Failed',
  NoGames: 'NoGames',
  Hidden: 'Hidden',
} as const
type SearchStatus = (typeof SearchStatus)[keyof typeof SearchStatus]

// ---------------------------------------------------------------------------
// ServerListLogic — server browser
// OpenRA 对照: ServerListLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class ServerListLogic extends ChromeLogic {
  private _disposed = false
  private readonly _onJoin: (server: GameServer) => void
  private readonly _settings: { mpGameFilters: number; allowDownloading: boolean }

  private _searchStatus: SearchStatus = SearchStatus.Fetching
  private _currentServer: GameServer | null = null
  private _currentMap: { uid: string; title: string; status: string; class: string } | null = null
  private _showNotices: boolean = false
  private _playerCount: number = 0
  private _activeQuery: boolean = false

  private readonly _serverList: ScrollPanelWidget
  private readonly _serverTemplate: ScrollItemWidget
  private readonly _headerTemplate: ScrollItemWidget
  private readonly _joinButton: ButtonWidget | null = null

  constructor(
    widget: Widget,
    _modData: unknown,
    onJoin: (server: GameServer) => void,
  ) {
    super()
    this._onJoin = onJoin
    this._settings = {
      mpGameFilters: MPGameFilters.Waiting | MPGameFilters.Started | MPGameFilters.Protected,
      allowDownloading: true,
    }

    this._serverList = wc<ScrollPanelWidget>(widget, 'SERVER_LIST')!
    this._headerTemplate = wc<ScrollItemWidget>(this._serverList, 'HEADER_TEMPLATE')!
    this._serverTemplate = wc<ScrollItemWidget>(this._serverList, 'SERVER_TEMPLATE')!

    // Join button
    this._joinButton = wc<ButtonWidget>(widget, 'JOIN_BUTTON') ?? null
    if (this._joinButton) {
      this._joinButton.isVisible = () => this._currentServer !== null
      this._joinButton.isDisabled = () => !this._currentServer?.isJoinable
      this._joinButton.onClick = () => {
        if (this._currentServer) this._onJoin(this._currentServer)
      }
    }

    // Progress label
    const progressText = wc<LabelWidget>(widget, 'PROGRESS_LABEL')
    if (progressText) {
      progressText.isVisible = () => this._searchStatus !== SearchStatus.Hidden
      progressText.getText = () => this._progressLabelText()
    }

    // Reload button
    const reloadButton = wc<ButtonWidget>(widget, 'RELOAD_BUTTON')
    if (reloadButton) {
      reloadButton.isDisabled = () => this._searchStatus === SearchStatus.Fetching
      reloadButton.onClick = () => this.refreshServerList()
    }

    // Players count label
    const playersLabel = wc<LabelWidget>(widget, 'PLAYER_COUNT')
    if (playersLabel) {
      const playersText = new CachedTransform<number, string>(
        p => fluentMsg('label-players-online-count', 'players', String(p)),
      )
      playersLabel.isVisible = () => this._playerCount !== 0
      playersLabel.getText = () => playersText.update(this._playerCount)
    }

    // Map title
    const mapTitle = wc<LabelWithTooltipWidget>(widget, 'SELECTED_MAP')
    if (mapTitle) {
      const font = '14px Arial'
      const title = new CachedTransform<string, string>(t =>
        WidgetUtils.truncateText(t, mapTitle.bounds.width, font),
      )
      mapTitle.getText = () => {
        if (!this._currentMap) return 'No server selected'
        if (this._currentMap.status === 'Searching') return 'Searching...'
        if (this._currentMap.class === 'Unknown') return 'Unknown map'
        return title.update(this._currentMap.title)
      }
    }

    // IP
    const ip = wc<LabelWidget>(widget, 'SELECTED_IP')
    if (ip) {
      ip.isVisible = () => this._currentServer !== null
      ip.getText = () => this._currentServer?.address || ''
    }

    // Status
    const status = wc<LabelWidget>(widget, 'SELECTED_STATUS')
    if (status) {
      status.isVisible = () => this._currentServer !== null
      status.getText = () => this._currentServer ? this._getStateLabel(this._currentServer) : ''
      status.getColor = () => this._currentServer ? this._getStateColor(this._currentServer) : 'FFFFFF'
    }

    // Mod version
    const modVersion = wc<LabelWidget>(widget, 'SELECTED_MOD_VERSION')
    if (modVersion) {
      const font = '14px Arial'
      const version = new CachedTransform<GameServer, string>(
        s => WidgetUtils.truncateText(s.modLabel, modVersion.bounds.width, font),
      )
      modVersion.isVisible = () => this._currentServer !== null
      modVersion.getText = () => this._currentServer ? version.update(this._currentServer) : ''
    }

    // Selected players
    const selectedPlayers = wc<LabelWidget>(widget, 'SELECTED_PLAYERS')
    if (selectedPlayers) {
      selectedPlayers.isVisible = () =>
        this._currentServer !== null && this._currentServer.clients.length === 0
      selectedPlayers.getText = () => this._currentServer ? this._playerLabel(this._currentServer) : ''
    }

    // Notice container
    const noticeContainer = wc(widget, 'NOTICE_CONTAINER')
    if (noticeContainer) {
      noticeContainer.isVisible = () => this._showNotices
    }

    const noticeWatcher = wc<LogicTickerWidget>(widget, 'NOTICE_WATCHER')
    if (noticeWatcher && noticeContainer) {
      const containerHeight = noticeContainer.bounds.height
      noticeWatcher.onTick = () => {
        const _show = false
        if (_show !== this._showNotices) {
          this._serverList.bounds.y += _show ? containerHeight : -containerHeight
          this._serverList.bounds.height -= _show ? containerHeight : -containerHeight
          this._showNotices = _show
        }
      }
    }

    this.refreshServerList()
  }

  private _progressLabelText(): string {
    switch (this._searchStatus) {
      case SearchStatus.Failed: return fluentMsg('label-search-status-failed')
      case SearchStatus.NoGames: return fluentMsg('label-search-status-no-games')
      default: return ''
    }
  }

  private _playerLabel(game: GameServer): string {
    let label = fluentMsg('label-players-count', 'players', String(game.players))
    if (game.bots > 0) label += ' ' + fluentMsg('label-bots-count', 'bots', String(game.bots))
    if (game.spectators > 0) label += ' ' + fluentMsg('label-spectators-count', 'spectators', String(game.spectators))
    return label
  }

  private _getStateLabel(game: GameServer): string {
    if (game.state === ServerState.GameStarted) {
      return fluentMsg('label-in-progress-for', 'minutes', String(Math.ceil(game.playTime / 60)))
    }
    if (game.state === ServerState.WaitingPlayers) {
      return game.protected
        ? fluentMsg('label-password-protected')
        : fluentMsg('label-waiting-for-players')
    }
    if (game.state === ServerState.ShuttingDown) {
      return fluentMsg('label-server-shutting-down')
    }
    return fluentMsg('label-unknown-server-state')
  }

  private _getStateColor(game: GameServer): string {
    if (!game.protected && game.state === ServerState.WaitingPlayers) return '00FF00'
    if (game.protected && game.state === ServerState.WaitingPlayers) return 'FF8800'
    if (game.state === ServerState.GameStarted) return '888888'
    return 'FFFFFF'
  }

  refreshServerList(): void {
    if (this._activeQuery) return
    this._searchStatus = SearchStatus.Fetching
    this._activeQuery = true

    setTimeout(() => {
      const games = this._generateSampleServers()
      this._refreshServerListInner(games)
      this._activeQuery = false
    }, 500)
  }

  private _refreshServerListInner(games: GameServer[]): void {
    this._serverList.removeChildren()
    this._selectServer(null)

    if (games.length === 0) {
      this._searchStatus = SearchStatus.NoGames
      return
    }

    this._searchStatus = SearchStatus.Hidden
    const rows = this._loadGameRows(games)
    for (const row of rows) {
      this._serverList.addChild(row)
    }
    this._playerCount = games.reduce((sum, g) => sum + g.players, 0)
  }

  private _loadGameRows(games: GameServer[]): Widget[] {
    const rows: Widget[] = []
    const modGroups = new Map<string, GameServer[]>()
    for (const game of games) {
      if (this._filtered(game)) continue
      const list = modGroups.get(game.modLabel) || []
      list.push(game)
      modGroups.set(game.modLabel, list)
    }

    for (const [modLabel, modGames] of modGroups) {
      if (modGames.every(g => this._filtered(g))) continue

      const header = ScrollItemWidget.setup(this._headerTemplate, () => false, () => {})
      ;(header as unknown as Record<string, unknown>)['getText'] = () => modLabel
      rows.push(header)

      const sorted = [...modGames].sort((a, b) => {
        const orderA = this._listOrder(a)
        const orderB = this._listOrder(b)
        if (orderA !== orderB) return orderA - orderB
        if (orderA === 2) return b.started - a.started
        return b.players - a.players
      })

      for (const game of sorted) {
        if (this._filtered(game)) continue

        const canJoin = game.isJoinable
        const item = ScrollItemWidget.setupWithDoubleClick(
          this._serverTemplate,
          () => this._currentServer === game,
          () => this._selectServer(game),
          () => this._onJoin(game),
        )

        const title = wc<LabelWithTooltipWidget>(item, 'TITLE')
        if (title) {
          WidgetUtils.truncateLabelToTooltip(title, game.name)
          ;(title as unknown as Record<string, unknown>)['getColor'] = () =>
            canJoin ? 'FFFFFF' : 'FF4444'
        }

        const passwordIcon = wc<ImageWidget>(item, 'PASSWORD_PROTECTED')
        if (passwordIcon) {
          passwordIcon.isVisible = () => game.protected
          passwordIcon.getImageName = () => canJoin ? 'protected' : 'protected-disabled'
        }

        const players = wc<LabelWithTooltipWidget>(item, 'PLAYERS')
        if (players) {
          const label = `${game.players + game.bots} / ${game.maxPlayers + game.bots}` +
            (game.spectators > 0 ? ` + ${game.spectators}` : '')
          players.getText = () => label
          ;(players as unknown as Record<string, unknown>)['getColor'] = () =>
            canJoin ? 'FFFFFF' : 'FF4444'
        }

        const state = wc<LabelWidget>(item, 'STATUS')
        if (state) {
          state.getText = () =>
            game.state >= ServerState.GameStarted ? 'Playing' : 'Waiting'
        }

        const location = wc<LabelWidget>(item, 'LOCATION')
        if (location) {
          location.getText = () =>
            WidgetUtils.truncateText(game.location || '', location.bounds.width, '14px Arial')
        }

        rows.push(item)
      }
    }
    return rows
  }

  private _listOrder(game: GameServer): number {
    if (game.state === ServerState.WaitingPlayers && game.players > 0) return 0
    if (game.state === ServerState.WaitingPlayers && game.spectators > 0) return 1
    if (game.state >= ServerState.GameStarted) return 2
    return 3
  }

  private _selectServer(server: GameServer | null): void {
    this._currentServer = server
    this._currentMap = null
  }

  private _filtered(game: GameServer): boolean {
    const filters = this._settings.mpGameFilters
    if (game.state === ServerState.GameStarted && !(filters & MPGameFilters.Started)) return true
    if (
      game.state === ServerState.WaitingPlayers &&
      !(filters & MPGameFilters.Waiting) &&
      game.players + game.spectators !== 0
    ) return true
    if (game.players + game.spectators === 0 && !(filters & MPGameFilters.Empty)) return true
    if (!game.isCompatible && !(filters & MPGameFilters.Incompatible)) return true
    if (game.protected && !(filters & MPGameFilters.Protected)) return true
    return false
  }

  /** Generate sample servers for testing. : Replace with real master server query. */
  private _generateSampleServers(): GameServer[] {
    const servers: GameServer[] = []
    const names = [
      'Open Warfare', 'CnC Forever', 'All Out War', 'Tiberium Dawn',
      'Red Alert Classic', 'Quick Match', 'No Rush 20min', 'Tournament Game',
    ]
    const locations = ['US East', 'EU West', 'Asia Pacific', 'South America']

    for (let i = 0; i < 12; i++) {
      const state = i < 4
        ? ServerState.WaitingPlayers
        : i < 10 ? ServerState.GameStarted : ServerState.ShuttingDown

      const playerCount = Math.min(6, Math.floor(Math.random() * 6) + 1)
      const clients: GameClient[] = []
      for (let j = 0; j < playerCount; j++) {
        clients.push({
          name: `Player${j + 1}`,
          color: 'FFFFFF',
          faction: 'random',
          team: j < 3 ? 1 : 2,
          spawnPoint: j + 1,
          isBot: false,
          isSpectator: false,
        })
      }

      servers.push({
        id: -1,
        name: names[i % names.length],
        address: `192.168.1.${100 + i}:1234`,
        state,
        players: playerCount,
        bots: 0,
        spectators: i % 3 === 0 ? 1 : 0,
        maxPlayers: 8,
        map: 'test-map',
        mod: 'ra',
        modLabel: 'Red Alert',
        version: 'release-20250301',
        location: locations[i % locations.length],
        started: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3600),
        playTime: Math.floor(Math.random() * 18000),
        protected: i % 3 === 0,
        authentication: false,
        isJoinable: state === ServerState.WaitingPlayers,
        isCompatible: true,
        clients,
        disabledSpawnPoints: [],
      })
    }
    return servers
  }

  tick(): void { /* No per-frame logic */ }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
  }
}
