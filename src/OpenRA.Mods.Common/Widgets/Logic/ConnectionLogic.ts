/**
 * ConnectionLogic.ts — Connection state display and transition logic
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/ConnectionLogic.cs (282 lines)
 *
 * 核心范式转换:
 * - C# ConnectionStateChanged event handler → TypeScript event listener pattern
 * - C# Ui.OpenWindow/CONNECTING_PANEL → Ui.openWindow with widgetArgs
 * - C# FluentProvider.GetMessage → inline string (Fluent deferred TODO-16.C.1)
 * - C# Game.ConnectionStateChanged += handler → observable subscription pattern
 * - C# Game.JoinServer static call → simplified connection API
 * - C# CurrentServerSettings.ServerExternalMod → external mod handling (stub)
 */

import { ChromeLogic } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import { Ui } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ButtonWidget } from '../../Widgets/ButtonWidget.js'
import type { LabelWidget } from '../../Widgets/LabelWidget.js'
import type { LogicTickerWidget } from '../../Widgets/LogicTickerWidget.js'

// ---------------------------------------------------------------------------
// Helper: access child widget by ID from widget tree
// ---------------------------------------------------------------------------

function widgetChild<T extends Widget = Widget>(parent: Widget, id: string): T | undefined {
  return (parent as unknown as Record<string, unknown>)[id] as T | undefined
}

// ---------------------------------------------------------------------------
// ConnectionState — connection lifecycle states
// ---------------------------------------------------------------------------

export const ConnectionState = {
  NotConnected: 'NotConnected',
  Connecting: 'Connecting',
  Connected: 'Connected',
} as const

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState]

// ---------------------------------------------------------------------------
// ConnectionTarget / NetworkConnection
// ---------------------------------------------------------------------------

export interface ConnectionTarget {
  readonly host: string
  readonly port: number
}

export interface NetworkConnection {
  readonly target: ConnectionTarget
  readonly connectionState: ConnectionState
  readonly errorMessage: string | null
}

// ---------------------------------------------------------------------------
// ConnectionLogic — connection progress screen
// OpenRA 对照: ConnectionLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class ConnectionLogic extends ChromeLogic {
  private readonly _onConnect: () => void
  private readonly _onAbort: () => void
  private readonly _onRetry: (password: string) => void
  private _disposed = false

  private _connectionStateHandler:
    ((om: unknown, password: string, conn: NetworkConnection) => void) | null = null

  constructor(
    widget: Widget,
    _modData: unknown,
    endpoint: ConnectionTarget,
    onConnect: () => void,
    onAbort: () => void,
    onRetry: (password: string) => void,
  ) {
    super()
    this._onConnect = onConnect
    this._onAbort = onAbort
    this._onRetry = onRetry

    // NOTE: endpoint stored for reference ('endpoint' is used by FluentMessage in full migration)

    this._connectionStateHandler = (_om, _password, connection) => {
      if (connection.connectionState === ConnectionState.Connected) {
        this._closeWindow()
        this._onConnect()
      } else if (connection.connectionState === ConnectionState.NotConnected) {
        this._closeWindow()
        Ui.openWindow('CONNECTIONFAILED_PANEL', {
          onAbort: this._onAbort,
          onRetry: this._onRetry,
          connection,
        })
      }
    }

    this._registerConnectionListener(this._connectionStateHandler)

    const abortButton = widgetChild<ButtonWidget>(widget, 'ABORT_BUTTON')
    if (abortButton) {
      abortButton.onClick = () => {
        this._closeWindow()
        this._onAbort()
      }
    }

    const connectingDesc = widgetChild<LabelWidget>(widget, 'CONNECTING_DESC')
    if (connectingDesc) {
      connectingDesc.getText = () => `Connecting to ${endpoint.host}:${endpoint.port}`
    }
  }

  static connect(
    endpoint: ConnectionTarget,
    password: string,
    onConnect: () => void,
    onAbort: () => void,
  ): void {
    const onRetry = (newPassword: string) =>
      ConnectionLogic.connect(endpoint, newPassword, onConnect, onAbort)

    Ui.openWindow('CONNECTING_PANEL', {
      endpoint,
      onConnect,
      onAbort,
      onRetry,
      password,
    })
  }

  private _closeWindow(): void {
    if (this._connectionStateHandler) {
      this._unregisterConnectionListener(this._connectionStateHandler)
      this._connectionStateHandler = null
    }
    Ui.closeWindow()
  }

  tick(): void {
    // No per-frame logic needed
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
    if (this._connectionStateHandler) {
      this._unregisterConnectionListener(this._connectionStateHandler)
      this._connectionStateHandler = null
    }
  }

  private static _listeners: Array<
    (om: unknown, password: string, conn: NetworkConnection) => void
  > = []

  private _registerConnectionListener(
    handler: (om: unknown, password: string, conn: NetworkConnection) => void,
  ): void {
    ConnectionLogic._listeners.push(handler)
  }

  private _unregisterConnectionListener(
    handler: (om: unknown, password: string, conn: NetworkConnection) => void,
  ): void {
    const idx = ConnectionLogic._listeners.indexOf(handler)
    if (idx >= 0) ConnectionLogic._listeners.splice(idx, 1)
  }

  static notifyConnectionStateChanged(
    orderManager: unknown,
    password: string,
    connection: NetworkConnection,
  ): void {
    for (const listener of ConnectionLogic._listeners) {
      listener(orderManager, password, connection)
    }
  }
}

// ---------------------------------------------------------------------------
// ConnectionFailedLogic — connection failure screen
// OpenRA 对照: ConnectionFailedLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class ConnectionFailedLogic extends ChromeLogic {
  private _disposed = false

  constructor(
    widget: Widget,
    _modData: unknown,
    orderManager: { serverError: string | null; authenticationFailed: boolean },
    connection: NetworkConnection,
    password: string,
    onAbort: (() => void) | null,
    onQuit: (() => void) | null,
    onRetry: ((password: string) => void) | null,
  ) {
    super()

    let leaving = false

    const abortButton = widgetChild<ButtonWidget>(widget, 'ABORT_BUTTON')
    if (abortButton) {
      abortButton.visible = onAbort !== null
      abortButton.isDisabled = () => leaving
      abortButton.onClick = () => {
        Ui.closeWindow()
        onAbort?.()
      }
    }

    const quitButton = widgetChild<ButtonWidget>(widget, 'QUIT_BUTTON')
    if (quitButton) {
      quitButton.visible = onQuit !== null
      quitButton.isDisabled = () => leaving
      quitButton.onClick = () => {
        onQuit?.()
        leaving = true
      }
    }

    const retryButton = widgetChild<ButtonWidget>(widget, 'RETRY_BUTTON')
    const passwordField = widgetChild(widget, 'PASSWORD') as (Widget & {
      text?: string
      isVisible?: () => boolean
    }) | undefined

    if (retryButton) {
      retryButton.visible = onRetry !== null
      retryButton.isDisabled = () => leaving
      retryButton.onClick = () => {
        const pass = passwordField && passwordField.isVisible?.()
          ? (passwordField.text || password)
          : password
        Ui.closeWindow()
        onRetry?.(pass)
      }
    }

    const connectingDesc = widgetChild<LabelWidget>(widget, 'CONNECTING_DESC')
    if (connectingDesc) {
      connectingDesc.getText = () =>
        `Could not connect to ${connection.target.host}:${connection.target.port}`
    }

    const connectionError = widgetChild<LabelWidget>(widget, 'CONNECTION_ERROR')
    if (connectionError) {
      connectionError.getText = () =>
        orderManager.serverError || connection.errorMessage || 'Unknown error'
    }

    const panelTitle = widgetChild<LabelWidget>(widget, 'TITLE')
    if (panelTitle) {
      panelTitle.getText = () =>
        orderManager.authenticationFailed ? 'Password Required' : 'Connection Failed'
    }

    if (passwordField) {
      passwordField.isVisible = () => orderManager.authenticationFailed

      const passwordLabel = widgetChild(widget, 'PASSWORD_LABEL')
      if (passwordLabel) {
        passwordLabel.isVisible = passwordField.isVisible
      }

      ;(passwordField as unknown as Record<string, unknown>).onEnterKey = () => {
        retryButton?.onClick()
        return true
      }
      ;(passwordField as unknown as Record<string, unknown>).onEscKey = () => {
        abortButton?.onClick()
        return true
      }
    }

    // Password offset adjustment ticker
    let passwordOffsetAdjusted = false
    const ticker = widgetChild<LogicTickerWidget>(widget, 'CONNECTION_FAILED_TICKER')
    if (ticker && passwordField && connectionError) {
      ticker.onTick = () => {
        if (passwordField.isVisible?.() && !passwordOffsetAdjusted) {
          const offset = passwordField.bounds.y - connectionError.bounds.y
          if (abortButton) abortButton.bounds.y += offset
          if (retryButton) retryButton.bounds.y += offset
          widget.bounds.height += offset
          widget.bounds.y -= offset / 2

          const background = widgetChild(widget, 'CONNECTION_BACKGROUND')
          if (background) background.bounds.height += offset

          passwordOffsetAdjusted = true
        }
      }
    }
  }

  tick(): void {
    // No per-frame logic needed
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
  }
}

// ---------------------------------------------------------------------------
// ConnectionSwitchModLogic — external mod switch screen
// OpenRA 对照: ConnectionSwitchModLogic : ChromeLogic
// ---------------------------------------------------------------------------

export class ConnectionSwitchModLogic extends ChromeLogic {
  private _disposed = false

  constructor(
    widget: Widget,
    _orderManager: unknown,
    _connection: NetworkConnection,
    onAbort: (() => void) | null,
    _onRetry: ((password: string) => void) | null,
  ) {
    super()

    const abortButton = widgetChild<ButtonWidget>(widget, 'ABORT_BUTTON')
    if (abortButton) {
      abortButton.visible = onAbort !== null
      abortButton.onClick = () => {
        Ui.closeWindow()
        onAbort?.()
      }
    }

    const switchButton = widgetChild<ButtonWidget>(widget, 'SWITCH_BUTTON')
    if (switchButton) {
      switchButton.onClick = () => {
        Ui.closeWindow()
      }
    }
  }

  tick(): void {
    // No per-frame logic needed
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
  }
}
