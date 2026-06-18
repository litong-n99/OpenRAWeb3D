/**
 * MediaGlobal.ts — ScriptGlobal for audio, video, and text display
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/MediaGlobal.cs
 *
 * 核心范式转换:
 * - C# Game.Sound.PlayNotification() → stub audio dispatch
 * - C# MusicPlaylist trait → stub playlist
 * - C# Media.PlayFMVFullscreen/InRadar → stub video dispatch
 * - C# TextNotificationsManager → stub text notification dispatch
 * - C# LuaFunction onPlayComplete → TriggerCallback function reference
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { ScriptColor } from './ColorUtils.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class MediaGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Media')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'PlaySpeechNotification',
        description: 'Play an announcer voice listed in notifications.yaml',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'notification', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._playSpeechNotification(args[0] as PlayerStub, args[1] as string),
      },
      {
        memberType: 'method',
        name: 'PlaySoundNotification',
        description: 'Play a sound listed in notifications.yaml',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'notification', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._playSoundNotification(args[0] as PlayerStub, args[1] as string),
      },
      {
        memberType: 'method',
        name: 'PlaySound',
        description: 'Play a sound file',
        returnType: 'nil',
        parameters: [
          { name: 'file', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._playSound(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'PlayMusic',
        description: 'Play track defined in music.yaml or map.yaml, or keep track empty for playing a random song.',
        returnType: 'nil',
        parameters: [
          { name: 'track', type: 'string', optional: true, defaultValue: null },
          { name: 'onPlayComplete', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._playMusic(args[0] as string | null, args[1] as (() => void) | null),
      },
      {
        memberType: 'method',
        name: 'SetBackgroundMusic',
        description: 'Play track defined in music.yaml or map.yaml as background music. If music is already playing use Media.StopMusic() to stop it and the background music will start automatically. Keep the track empty to disable background music.',
        returnType: 'nil',
        parameters: [
          { name: 'track', type: 'string', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._setBackgroundMusic(args[0] as string | null),
      },
      {
        memberType: 'method',
        name: 'StopMusic',
        description: 'Stop the current song.',
        returnType: 'nil',
        parameters: [],
        invoke: () => this._stopMusic(),
      },
      {
        memberType: 'method',
        name: 'PlayMovieFullscreen',
        description: 'Play a video fullscreen. File name has to include the file extension.',
        returnType: 'nil',
        parameters: [
          { name: 'videoFileName', type: 'string', optional: false },
          { name: 'onPlayComplete', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._playMovieFullscreen(args[0] as string, args[1] as (() => void) | null),
      },
      {
        memberType: 'method',
        name: 'PlayMovieInRadar',
        description: 'Play a video in the radar window. File name has to include the file extension.',
        returnType: 'nil',
        parameters: [
          { name: 'videoFileName', type: 'string', optional: false },
          { name: 'onPlayComplete', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._playMovieInRadar(args[0] as string, args[1] as (() => void) | null),
      },
      {
        memberType: 'method',
        name: 'DisplayMessage',
        description: 'Display a text message to all players.',
        returnType: 'nil',
        parameters: [
          { name: 'text', type: 'string', optional: false },
          { name: 'prefix', type: 'string', optional: true, defaultValue: 'Mission' },
          { name: 'color', type: 'Color', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._displayMessage(args[0] as string, args[1] as string, args[2] as ScriptColor | null),
      },
      {
        memberType: 'method',
        name: 'DisplayMessageToPlayer',
        description: 'Display a text message only to this player.',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'text', type: 'string', optional: false },
          { name: 'prefix', type: 'string', optional: true, defaultValue: 'Mission' },
          { name: 'color', type: 'Color', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._displayMessageToPlayer(args[0] as PlayerStub, args[1] as string, args[2] as string, args[3] as ScriptColor | null),
      },
      {
        memberType: 'method',
        name: 'DisplaySystemMessage',
        description: 'Display a system message to the player. If prefix is nil the default system prefix is used.',
        returnType: 'nil',
        parameters: [
          { name: 'text', type: 'string', optional: false },
          { name: 'prefix', type: 'string', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._displaySystemMessage(args[0] as string, args[1] as string | null),
      },
      {
        memberType: 'method',
        name: 'Debug',
        description: 'Displays a debug message to the player, if "Show Map Debug Messages" is checked in the settings.',
        returnType: 'nil',
        parameters: [
          { name: 'format', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._debug(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'FloatingText',
        description: 'Display a text message at the specified location.',
        returnType: 'nil',
        parameters: [
          { name: 'text', type: 'string', optional: false },
          { name: 'position', type: 'WPos', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 30 },
          { name: 'color', type: 'Color', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._floatingText(args[0] as string, args[1] as WPos, args[2] as number | undefined, args[3] as ScriptColor | null),
      },
    ]
  }

  // --- Private implementations ---

  private _playSpeechNotification(player: PlayerStub, notification: string): void {
    this.context.logDebug(`PlaySpeechNotification: player=${(player as unknown as { playerName: string }).playerName}, notification=${notification}`)
  }

  private _playSoundNotification(player: PlayerStub, notification: string): void {
    this.context.logDebug(`PlaySoundNotification: player=${(player as unknown as { playerName: string }).playerName}, notification=${notification}`)
  }

  private _playSound(file: string): void {
    this.context.logDebug(`PlaySound: file=${file}`)
  }

  private _playMusic(track: string | null, onPlayComplete: (() => void) | null): void {
    if (!track || track === '') {
      this.context.logDebug('PlayMusic: random track')
    } else {
      this.context.logDebug(`PlayMusic: track=${track}`)
    }
    // Use wrapped onComplete callback
    const onComplete = this._wrapOnPlayComplete(onPlayComplete)
    onComplete()
  }

  private _setBackgroundMusic(track: string | null): void {
    if (!track || track === '') {
      this.context.logDebug('SetBackgroundMusic: disabled')
    } else {
      this.context.logDebug(`SetBackgroundMusic: track=${track}`)
    }
  }

  private _stopMusic(): void {
    this.context.logDebug('StopMusic')
  }

  private _playMovieFullscreen(videoFileName: string, onPlayComplete: (() => void) | null): void {
    this.context.logDebug(`PlayMovieFullscreen: ${videoFileName}`)
    const onComplete = this._wrapOnPlayComplete(onPlayComplete)
    onComplete()
  }

  private _playMovieInRadar(videoFileName: string, onPlayComplete: (() => void) | null): void {
    this.context.logDebug(`PlayMovieInRadar: ${videoFileName}`)
    const onComplete = this._wrapOnPlayComplete(onPlayComplete)
    onComplete()
  }

  private _displayMessage(text: string, prefix: string, _color: ScriptColor | null): void {
    if (!text) return
    this.context.logDebug(`DisplayMessage: [${prefix}] ${text}`)
  }

  private _displayMessageToPlayer(player: PlayerStub, text: string, prefix: string, color: ScriptColor | null): void {
    if (this._world.localPlayer !== player) return
    this._displayMessage(text, prefix, color)
  }

  private _displaySystemMessage(text: string, prefix: string | null): void {
    if (!text) return
    if (prefix) {
      this.context.logDebug(`SystemMessage: [${prefix}] ${text}`)
    } else {
      this.context.logDebug(`SystemMessage: ${text}`)
    }
  }

  private _debug(format: string): void {
    if (!format) return
    this.context.logDebug(`Debug: ${format}`)
  }

  private _floatingText(text: string, position: WPos, duration?: number, _color?: ScriptColor | null): void {
    if (!text) return
    const dur = duration ?? 30
    // Check if position is within map bounds
    if (!this._world.map.contains(position)) return
    this.context.logDebug(`FloatingText: "${text}" at (${position.X}, ${position.Y}, ${position.Z}) for ${dur} ticks`)
  }

  /**
   * Wrap an onPlayComplete callback to handle errors.
   *
   * OpenRA 对照: MediaGlobal.WrapOnPlayComplete(LuaFunction)
   */
  private _wrapOnPlayComplete(onPlayComplete: (() => void) | null): () => void {
    if (onPlayComplete) {
      return () => {
        try {
          onPlayComplete()
        } catch (e) {
          this.context.fatalError(e instanceof Error ? e : new Error(String(e)))
        }
      }
    }
    return () => {}
  }
}

ScriptRegistry.registerGlobal('Media', MediaGlobal, 'Audio, video, and text display')
