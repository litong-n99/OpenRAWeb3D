/**
 * Sound.ts — 音频管理核心（声音播放、音量链、音乐管理、SoundPool 调度）
 * OpenRA 对照: OpenRA.Game/Sound/Sound.cs (481 lines)
 *
 * 核心范式转换:
 * - C# OpenAL ISoundEngine → Howler.js WebAudioEngine（接口化，可注入）
 * - C# Cache<string, ISoundSource> → Map<string, ISoundSource>（懒加载缓存）
 * - C# ImmutableArray<string>.Random(LocalRandom) → 普通数组 + Math.random()（音频非同步）
 * - C# ISoundLoader / ISoundFormat PCM 解析 → 浏览器原生解码（Howler.js）
 * - C# IReadOnlyFileSystem → IReadOnlyFileSystem 异步接口（已迁移 Ch5）
 * - C# Game.Settings.Sound → 本地音量属性（不再依赖全局 Game 单例）
 * - C# Game.CosmeticRandom.Next() → Math.random()（音频不受锁步同步影响）
 * - C# Log.Write() → console.warn / console.log
 *
 * 音量链路（完全保留 OpenRA 的乘法模型）:
 *   finalVolume = SoundVolume × soundVolumeModifier × volumeModifier × pool.VolumeModifier
 *
 * SoundPool 中断策略:
 *   Overlap   → 总是播放新音频（可重叠）
 *   Interrupt → 停止旧音频，播放新音频
 *   DoNotPlay → 如果旧音频仍在播放，跳过新音频
 */

import { WPos } from '../WPos.js'
import type { ISound, ISoundEngine, ISoundSource, SoundDevice } from './SoundDevice.js'

// ---------------------------------------------------------------------------
// IReadOnlyFileSystemCompat
// ---------------------------------------------------------------------------

/** Sound 类使用的文件系统最小接口。
 *
 * 与 src/OpenRA.Game/FileSystem/IPackage.ts 中的 IReadOnlyFileSystem 兼容。
 */
export interface IReadOnlyFileSystemCompat {
  exists(filename: string): boolean
  openAsync(filename: string): Promise<ArrayBuffer | null>
}

// ---------------------------------------------------------------------------
// SoundType 枚举
// OpenRA 对照: SoundType enum { World, UI }
// ---------------------------------------------------------------------------

/** 音频类型（决定空间化模式）。
 *
 * OpenRA 对照: SoundType
 *
 * - `World` (=0): 3D 空间音频（位置相关，有距离衰减）
 * - `UI` (=1): 2D 无空间音频（UI 操作反馈，无位置）
 */
export const SoundType = {
  World: 0,
  UI: 1,
} as const
export type SoundType = (typeof SoundType)[keyof typeof SoundType]

// ---------------------------------------------------------------------------
// SoundPool.InterruptType 枚举
// OpenRA 对照: SoundPool.InterruptType
// ---------------------------------------------------------------------------

/** 音频中断策略。
 *
 * OpenRA 对照: SoundPool.InterruptType
 *
 * - `DoNotPlay` (=0): 如果同池音频仍在播放，不播放新音频
 * - `Interrupt` (=1): 停止同池旧音频，播放新音频
 * - `Overlap` (=2): 总是播放新音频（可与旧音频重叠）
 */
export const InterruptType = {
  DoNotPlay: 0,
  Interrupt: 1,
  Overlap: 2,
} as const
export type InterruptType = (typeof InterruptType)[keyof typeof InterruptType]

// ---------------------------------------------------------------------------
// SoundPool
// OpenRA 对照: OpenRA.GameRules.SoundPool (SoundInfo.cs)
// ---------------------------------------------------------------------------

/** 音频池，管理一组音频剪辑的轮转播放和中断策略。
 *
 * OpenRA 对照: SoundPool
 *
 * 每个 SoundPool 关联一组音频剪辑（如 "Move" 对应的多个移动语音），
 * 通过 `getNext()` 随机选择下一剪辑并避免连续重复。
 */
export class SoundPool {
  /** 默认中断策略。
   *
   * OpenRA 对照: SoundPool.DefaultInterruptType = DoNotPlay
   */
  static readonly DefaultInterruptType = InterruptType.DoNotPlay

  /** 池音量修正系数（叠加在音量链末端）。
   *
   * OpenRA 对照: SoundPool.VolumeModifier
   */
  readonly volumeModifier: number

  /** 中断策略。
   *
   * OpenRA 对照: SoundPool.Type
   */
  readonly type: InterruptType

  /** 原始剪辑名称列表（不可变）。
   *
   * OpenRA 对照: SoundPool.clips (ImmutableArray<string>)
   */
  readonly clips: readonly string[]

  /** 当前活跃的剪辑名称列表（用于轮转，无重复选择）。
   *
   * OpenRA 对照: SoundPool.liveclips (List<string>)
   */
  private liveclips: string[]

  /**
   * @param volumeModifier — 音量修正系数
   * @param interruptType — 中断策略
   * @param clips — 剪辑名称数组
   */
  constructor(
    volumeModifier: number,
    interruptType: InterruptType,
    clips: readonly string[],
  ) {
    this.volumeModifier = volumeModifier
    this.type = interruptType
    this.clips = clips
    this.liveclips = []
  }

  /** 获取下一个要播放的剪辑名称。
   *
   * OpenRA 对照: SoundPool.GetNext()
   *
   * 从 liveclips 中随机选取一个剪辑并移除，
   * 当 liveclips 为空时重新填充所有剪辑。
   *
   * @returns 剪辑名称，或 null（如果 clips 为空）
   */
  getNext(): string | null {
    if (this.liveclips.length === 0) {
      this.liveclips = [...this.clips]
    }

    // 避免因没有剪辑而崩溃
    if (this.liveclips.length === 0) {
      return null
    }

    const i = Math.floor(Math.random() * this.liveclips.length)
    const s = this.liveclips[i]
    this.liveclips.splice(i, 1)
    return s
  }

  /** 重置 liveclips（恢复所有剪辑可选）。 */
  reset(): void {
    this.liveclips = []
  }
}

// ---------------------------------------------------------------------------
// SoundInfo (音频规则定义)
// OpenRA 对照: OpenRA.GameRules.SoundInfo (SoundInfo.cs)
// ---------------------------------------------------------------------------

/** 音频规则定义 —— 包含变体、前缀、语音/通知池的完整配置。
 *
 * OpenRA 对照: OpenRA.GameRules.SoundInfo
 *
 * @todo : 将 GoRules/SoundInfo 完全迁移为独立文件，
 *   包括 MiniYAML 解析逻辑。当前 Sound 类内联定义以满足 Phase D 需求。
 */
export interface SoundInfo {
  /** 变体映射 (variantId → 后缀数组)。
   *
   * OpenRA 对照: SoundInfo.Variants
   */
  readonly variants: ReadonlyMap<string, readonly string[]>

  /** 前缀映射 (variantId → 前缀数组)。
   *
   * OpenRA 对照: SoundInfo.Prefixes
   */
  readonly prefixes: ReadonlyMap<string, readonly string[]>

  /** 默认音频后缀。
   *
   * OpenRA 对照: SoundInfo.DefaultVariant (默认 ".aud")
   */
  readonly defaultVariant: string

  /** 默认音频前缀。
   *
   * OpenRA 对照: SoundInfo.DefaultPrefix (默认 "")
   */
  readonly defaultPrefix: string

  /** 禁用变体的定义集合。
   *
   * OpenRA 对照: SoundInfo.DisableVariants
   */
  readonly disableVariants: ReadonlySet<string>

  /** 禁用前缀的定义集合。
   *
   * OpenRA 对照: SoundInfo.DisablePrefixes
   */
  readonly disablePrefixes: ReadonlySet<string>

  /** 语音池（定义 → SoundPool）。
   *
   * OpenRA 对照: SoundInfo.VoicePools
   */
  readonly voicePools: ReadonlyMap<string, SoundPool>

  /** 通知池（定义 → SoundPool）。
   *
   * OpenRA 对照: SoundInfo.NotificationsPools
   */
  readonly notificationsPools: ReadonlyMap<string, SoundPool>
}

// ---------------------------------------------------------------------------
// MusicInfo 兼容接口
// OpenRA 对照: OpenRA.GameRules.MusicInfo
// ---------------------------------------------------------------------------

/** 音乐轨道信息。
 *
 * OpenRA 对照: MusicInfo
 *
 * 使用 Ruleset.ts 中已有的 MusicInfo 子集 —— 仅需 filename/exists/volumeModifier。
 * 完整 MusicInfo 迁移推迟至第 8 章。
 */
export interface MusicInfoCompat {
  /** 音频文件路径。 */
  readonly filename: string
  /** 音量修正系数。 */
  readonly volumeModifier: number
  /** 文件是否存在。 */
  readonly exists: boolean
}

// ---------------------------------------------------------------------------
// Ruleset 音频接口（PlayPredefined 需要的最小 Ruleset 子集）
// ---------------------------------------------------------------------------

/** Ruleset 中音频相关的最小接口（供 Sound.PlayPredefined 使用）。
 *
 * 与 src/OpenRA.Game/GameRules/Ruleset.ts 中的完整 Ruleset 兼容。
 * PlayPredefined 仅访问 voices / notifications 字典中的 SoundInfo。
 */
export interface IAudioRuleset {
  readonly voices: ReadonlyMap<string, SoundInfo> | null
  readonly notifications: ReadonlyMap<string, SoundInfo> | null
}

// ---------------------------------------------------------------------------
// Lightweight actor reference (for PlayPredefined)
// ---------------------------------------------------------------------------

/** PlayPredefined 使用的最小 Actor 接口。
 *
 * 与完整的 GameActor 兼容，
 * PlayPredefined 仅访问 actorID 和 world.selection。
 */
export interface ISoundActor {
  readonly actorID: number
  readonly world: {
    readonly selection: { contains(actor: ISoundActor): boolean }
    readonly localPlayer: unknown
  } | null
}

// ---------------------------------------------------------------------------
// SoundSettings
// ---------------------------------------------------------------------------

/** 音频设置（构造时传入）。
 *
 * 替代 C# Game.Settings.Sound 引用。
 *
 * @todo : 集成到 Game.Settings.Sound 全局设置系统，
 *   当前使用直接赋值以支持独立测试。
 */
export interface SoundSettings {
  /** 音效音量 (0.0-1.0)。 */
  soundVolume: number
  /** 音乐音量 (0.0-1.0)。 */
  musicVolume: number
  /** 视频音量 (0.0-1.0)。 */
  videoVolume: number
  /** 是否循环音乐。 */
  repeat: boolean
  /** 是否静音。 */
  mute: boolean
  /** 音频设备名称（浏览器环境下通常为 "default"）。 */
  device: string
}

// ---------------------------------------------------------------------------
// Sound
// OpenRA 对照: Sound sealed class
// ---------------------------------------------------------------------------

/** 音频管理器 —— 声音播放、音量链、音乐管理、SoundPool 调度。
 *
 * OpenRA 对照: Sound class
 *
 * 集中管理所有游戏音频的加载、缓存、播放和生命周期。
 * 通过 ISoundEngine 接口与底层音频 API 解耦。
 *
 * ## 音量链路
 * ```
 * InternalSoundVolume = SoundVolume × soundVolumeModifier
 * FinalVolume = InternalSoundVolume × volumeModifier × pool.VolumeModifier
 * ```
 *
 * ## 音乐管理
 * - PlayMusic / StopMusic / PauseMusic / PlayMusicThen
 * - 自动检测音乐播放完毕（Tick 检查）
 * - MusicSeekPosition 查询播放进度
 *
 * ## 线程安全性
 * OpenRA C# 中音频操作在非同步线程执行。TypeScript 单线程环境下
 * 所有操作为同步或 Promise-based，无需额外线程安全措施。
 */
export class Sound {
  /** 底层音频引擎。
   *
   * OpenRA 对照: Sound.soundEngine (readonly ISoundEngine)
   */
  private readonly soundEngine: ISoundEngine

  /** 是否为虚拟引擎。
   *
   * OpenRA 对照: Sound.DummyEngine
   */
  readonly dummyEngine: boolean

  // ---------------------------------------------------------------------------
  // 音频缓存
  // ---------------------------------------------------------------------------

  /** 已加载音频源缓存（文件名 → ISoundSource）。
   *
   * OpenRA 对照: Sound.sounds (Cache<string, ISoundSource>)
   */
  private sounds: Map<string, ISoundSource> | null = null

  /** 文件系统引用（用于加载音频文件）。
   *
   * OpenRA 对照: Sound.fileSystem (IReadOnlyFileSystem)
   */
  private fileSystem: IReadOnlyFileSystemCompat | null = null

  // ---------------------------------------------------------------------------
  // 活跃音频追踪
  // ---------------------------------------------------------------------------

  /** 当前活跃的语音（actorId → ISound）。
   *
   * OpenRA 对照: Sound.currentSounds (Dictionary<uint, ISound>)
   */
  private currentSounds: Map<number, ISound> = new Map()

  /** 当前活跃的通知（name → ISound）。
   *
   * OpenRA 对照: Sound.currentNotifications (Dictionary<string, ISound>)
   */
  private currentNotifications: Map<string, ISound> = new Map()

  // ---------------------------------------------------------------------------
  // 音频源（视频/音乐专用）
  // ---------------------------------------------------------------------------

  /** 视频音频源。
   *
   * OpenRA 对照: Sound.videoSource
   */
  private videoSource: ISoundSource | null = null

  /** 当前音乐实例。
   *
   * OpenRA 对照: Sound.music
   */
  private music: ISound | null = null

  /** 当前视频音频实例。
   *
   * OpenRA 对照: Sound.video
   */
  private video: ISound | null = null

  // ---------------------------------------------------------------------------
  // 音量属性
  // ---------------------------------------------------------------------------

  /** 音效音量修正系数（临时性，如暂停菜单衰减）。
   *
   * OpenRA 对照: Sound.soundVolumeModifier (默认 1.0)
   */
  get soundVolumeModifier(): number {
    return this._soundVolumeModifier
  }

  set soundVolumeModifier(value: number) {
    this._soundVolumeModifier = value
    this.soundEngine.setSoundVolume(
      this.internalSoundVolume,
      this.music,
      this.video,
    )
  }

  private _soundVolumeModifier = 1.0

  /** 内部音效音量 = SoundVolume × soundVolumeModifier。
   *
   * OpenRA 对照: Sound.InternalSoundVolume
   */
  private get internalSoundVolume(): number {
    return this._soundVolume * this._soundVolumeModifier
  }

  /** 音效音量（0.0-1.0）。
   *
   * OpenRA 对照: Sound.SoundVolume → Game.Settings.Sound.SoundVolume
   */
  get soundVolume(): number {
    return this._soundVolume
  }

  set soundVolume(value: number) {
    this._soundVolume = value
    this.soundEngine.setSoundVolume(
      this.internalSoundVolume,
      this.music,
      this.video,
    )
  }

  private _soundVolume: number

  /** 音乐音量（0.0-1.0）。
   *
   * OpenRA 对照: Sound.MusicVolume → Game.Settings.Sound.MusicVolume
   */
  get musicVolume(): number {
    return this._musicVolume
  }

  set musicVolume(value: number) {
    this._musicVolume = value
    if (this.music !== null) {
      this.music.volume = value
    }
  }

  private _musicVolume: number

  /** 视频音量（0.0-1.0）。
   *
   * OpenRA 对照: Sound.VideoVolume → Game.Settings.Sound.VideoVolume
   */
  get videoVolume(): number {
    return this._videoVolume
  }

  set videoVolume(value: number) {
    this._videoVolume = value
    if (this.video !== null) {
      this.video.volume = value
    }
  }

  private _videoVolume: number

  /** 音乐循环标志（缓存自 Settings）。
   *
   * OpenRA 对照: Game.Settings.Sound.Repeat
   */
  private _repeat: boolean

  // ---------------------------------------------------------------------------
  // 音乐状态
  // ---------------------------------------------------------------------------

  /** 音乐播放完毕回调。
   *
   * OpenRA 对照: Sound.onMusicComplete (Action)
   */
  private onMusicComplete: (() => void) | null = null

  /** 是否正在播放音乐。
   *
   * OpenRA 对照: Sound.MusicPlaying
   */
  musicPlaying = false

  /** 当前音乐信息。
   *
   * OpenRA 对照: Sound.CurrentMusic
   */
  currentMusic: MusicInfoCompat | null = null

  // ---------------------------------------------------------------------------
  // 全局开关
  // ---------------------------------------------------------------------------

  /** 禁用所有音频。
   *
   * OpenRA 对照: Sound.DisableAllSounds
   */
  disableAllSounds = false

  /** 禁用世界音频（仅 World 类型）。
   *
   * OpenRA 对照: Sound.DisableWorldSounds
   */
  disableWorldSounds = false

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  /**
   * @param soundEngine — 底层音频引擎（DI 注入）
   * @param settings — 音频设置
   */
  constructor(
    soundEngine: ISoundEngine,
    settings: SoundSettings,
  ) {
    this.soundEngine = soundEngine
    this.dummyEngine = soundEngine.dummy

    this._soundVolume = settings.soundVolume
    this._musicVolume = settings.musicVolume
    this._videoVolume = settings.videoVolume
    this._repeat = settings.repeat

    if (settings.mute) {
      this.muteAudio()
    }
  }

  // ---------------------------------------------------------------------------
  // Initialize
  // OpenRA 对照: Sound.Initialize(ISoundLoader[], IReadOnlyFileSystem)
  // ---------------------------------------------------------------------------

  /** 初始化音频系统：停止当前音频、清空缓存、设置文件系统。
   *
   * OpenRA 对照: Sound.Initialize(ISoundLoader[], IReadOnlyFileSystem)
   *
   * @param fileSystem — 文件系统引用（用于加载音频文件）
   */
  initialize(fileSystem: IReadOnlyFileSystemCompat): void {
    this.stopMusic()
    this.soundEngine.stopAllSounds()

    if (this.sounds !== null) {
      for (const soundSource of this.sounds.values()) {
        soundSource.dispose()
      }
    }

    this.fileSystem = fileSystem
    this.sounds = new Map()
    this.currentSounds.clear()
    this.currentNotifications.clear()
    this.video = null
  }

  // ---------------------------------------------------------------------------
  // LoadSound（内部）
  // OpenRA 对照: Sound.LoadSound<T>(string, Func<ISoundFormat, T>)
  // ---------------------------------------------------------------------------

  /** 从文件系统异步加载音频文件到音频源缓存。
   *
   * OpenRA 对照: Sound.LoadSound<T>(string, Func<ISoundFormat, T>)
   *
   * 使用 Howler.js 原生解码（浏览器 Web Audio API），
   * 无需 ISoundLoader 链（AUD/VOC/WAV 格式由浏览器自动处理）。
   *
   * @param filename — 音频文件名
   * @returns ISoundSource 或 null（文件不存在）
   */
  async loadSound(filename: string): Promise<ISoundSource | null> {
    if (!this.fileSystem) {
      console.warn(`[Sound] LoadSound failed: no fileSystem: ${filename}`)
      return null
    }

    if (!this.fileSystem.exists(filename)) {
      console.warn(`[Sound] LoadSound, file does not exist: ${filename}`)
      return null
    }

    try {
      const data = await this.fileSystem.openAsync(filename)
      if (data === null) {
        console.warn(`[Sound] LoadSound, failed to read: ${filename}`)
        return null
      }

      // 默认参数（Howler.js 自动检测实际格式）
      return this.soundEngine.addSoundSourceFromMemory(data, 1, 16, 22050)
    } catch (err) {
      console.warn(`[Sound] LoadSound, error loading ${filename}:`, err)
      return null
    }
  }

  /** 确保音频已加载到缓存（同步版本 —— 适用于已预加载的音频）。 */
  private getCachedSound(filename: string): ISoundSource | undefined {
    if (this.sounds === null) return undefined
    return this.sounds.get(filename)
  }

  /** 将音频源存入缓存（供外部预加载使用）。
   *
   * OpenRA 对照: Cache<string, ISoundSource> 的隐式缓存写入
   */
  setCachedSound(filename: string, source: ISoundSource): void {
    if (this.sounds === null) {
      this.sounds = new Map()
    }
    this.sounds.set(filename, source)
  }

  // ---------------------------------------------------------------------------
  // AvailableDevices
  // OpenRA 对照: Sound.AvailableDevices()
  // ---------------------------------------------------------------------------

  /** 枚举可用音频设备。
   *
   * OpenRA 对照: Sound.AvailableDevices()
   */
  availableDevices(): SoundDevice[] {
    return this.soundEngine.availableDevices()
  }

  // ---------------------------------------------------------------------------
  // SetListenerPosition
  // OpenRA 对照: Sound.SetListenerPosition(WPos)
  // ---------------------------------------------------------------------------

  /** 设置音频监听器位置（每帧调用）。
   *
   * OpenRA 对照: Sound.SetListenerPosition(WPos)
   */
  setListenerPosition(position: WPos): void {
    this.soundEngine.setListenerPosition(position)
  }

  // ---------------------------------------------------------------------------
  // Play（核心路径）
  // OpenRA 对照: Sound.Play(SoundType, Player, string, bool, WPos, float, bool)
  // ---------------------------------------------------------------------------

  /** 播放指定名称的音频（内部核心方法）。
   *
   * OpenRA 对照: Sound.Play(SoundType type, Player player, string name,
   *   bool headRelative, WPos pos, float volumeModifier, bool loop)
   *
   * @param type — 音频类型（World=3D, UI=2D）
   * @param name — 音频源名称
   * @param pos — 世界坐标位置（headRelative=true 时忽略）
   * @param headRelative — true=2D 无空间化，false=3D 空间化
   * @param volumeModifier — 音量修正系数
   * @param loop — 是否循环
   * @param player — 玩家过滤（非本地玩家不播放）
   * @returns ISound 实例或 null
   */
  private playCore(
    type: SoundType,
    name: string | null | undefined,
    pos: WPos,
    headRelative: boolean,
    volumeModifier: number,
    loop: boolean,
    player: { world: { localPlayer: unknown } } | null,
  ): ISound | null {
    if (!name || this.disableAllSounds || (this.disableWorldSounds && type === SoundType.World)) {
      return null
    }

    if (player !== null && player !== player.world.localPlayer) {
      return null
    }

    const soundSource = this.getCachedSound(name)
    if (!soundSource) {
      console.warn(`[Sound] Play failed: sound not cached: ${name}`)
      return null
    }

    return this.soundEngine.play2D(
      soundSource,
      loop,
      headRelative,
      pos,
      this.internalSoundVolume * volumeModifier,
      true,
    )
  }

  // ---------------------------------------------------------------------------
  // Play 重载
  // OpenRA 对照: Sound.Play(...) overloads
  // ---------------------------------------------------------------------------

  /** 播放 2D 音频（UI 类型，简单调用）。
   *
   * OpenRA 对照: Sound.Play(SoundType, string)
   */
  play(type: SoundType, name: string): ISound | null

  /** 播放 3D 世界位置音频。
   *
   * OpenRA 对照: Sound.Play(SoundType, string, WPos)
   */
  play(type: SoundType, name: string, pos: WPos): ISound | null

  /** 播放 2D 音频（指定音量修正）。
   *
   * OpenRA 对照: Sound.Play(SoundType, string, float)
   */
  play(type: SoundType, name: string, volumeModifier: number): ISound | null

  /** 播放 3D 世界位置音频（指定音量修正）。
   *
   * OpenRA 对照: Sound.Play(SoundType, string, WPos, float)
   */
  play(type: SoundType, name: string, pos: WPos, volumeModifier: number): ISound | null

  play(
    type: SoundType,
    name: string,
    posOrVolume?: WPos | number,
    volumeModifier?: number,
  ): ISound | null {
    if (typeof posOrVolume === 'number') {
      // Play(SoundType, string, float)
      return this.playCore(type, name, WPos.Zero, true, posOrVolume, false, null)
    }
    if (posOrVolume instanceof WPos) {
      if (typeof volumeModifier === 'number') {
        // Play(SoundType, string, WPos, float)
        return this.playCore(type, name, posOrVolume, false, volumeModifier, false, null)
      }
      // Play(SoundType, string, WPos)
      return this.playCore(type, name, posOrVolume, false, 1.0, false, null)
    }
    // Play(SoundType, string)
    return this.playCore(type, name, WPos.Zero, true, 1.0, false, null)
  }

  // ---------------------------------------------------------------------------
  // Play(ISoundFormat) / Play(ISoundFormat, float) — PCM 流式播放
  // OpenRA 对照: Sound.Play(ISoundFormat) / Sound.Play(ISoundFormat, float)
  //
  // @todo : 实现 ISoundFormat → Play2DStream 桥接。
  //   在 OpenRA C# 中，Play(ISoundFormat) 调用 soundEngine.Play2DStream()
  //   直接播放 PCM 流（用于音乐和自定义音频）。Web 环境下，浏览器原生解码
  //   替代了 PCM 流式传输。需要：
  //   1. 定义 ISoundFormat 接口（Channels, SampleBits, SampleRate, LengthInSeconds,
  //      GetPCMInputStream）
  //   2. 实现 PCM → ArrayBuffer 转换，再通过 addSoundSourceFromMemory 播放
  //   3. 或在 ISoundEngine 接口中添加 Play2DStream 方法返回 ISound
  //   当前：Play(ISoundFormat) 和 Play(ISoundFormat, float) 重载暂不实现，
  //   音乐播放通过 PlayMusic(MusicInfoCompat) 走独立的音乐管理路径。
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // PlayToPlayer
  // OpenRA 对照: Sound.PlayToPlayer(SoundType, Player, string)
  //   / PlayToPlayer(SoundType, Player, string, WPos)
  // ---------------------------------------------------------------------------

  /** 向指定玩家播放 2D 音频。
   *
   * OpenRA 对照: Sound.PlayToPlayer(SoundType, Player, string)
   */
  playToPlayer(
    type: SoundType,
    player: { world: { localPlayer: unknown } },
    name: string,
  ): ISound | null {
    return this.playCore(type, name, WPos.Zero, true, 1.0, false, player)
  }

  /** 向指定玩家播放 3D 位置音频。
   *
   * OpenRA 对照: Sound.PlayToPlayer(SoundType, Player, string, WPos)
   */
  playToPlayerAt(
    type: SoundType,
    player: { world: { localPlayer: unknown } },
    name: string,
    pos: WPos,
  ): ISound | null {
    return this.playCore(type, name, pos, false, 1.0, false, player)
  }

  // ---------------------------------------------------------------------------
  // PlayLooped
  // OpenRA 对照: Sound.PlayLooped(SoundType, string) / PlayLooped(SoundType, string, WPos)
  // ---------------------------------------------------------------------------

  /** 循环播放 2D 音频。
   *
   * OpenRA 对照: Sound.PlayLooped(SoundType, string)
   */
  playLooped(type: SoundType, name: string): ISound | null {
    return this.playCore(type, name, WPos.Zero, true, 1.0, true, null)
  }

  /** 循环播放 3D 位置音频。
   *
   * OpenRA 对照: Sound.PlayLooped(SoundType, string, WPos)
   */
  playLoopedAt(type: SoundType, name: string, pos: WPos): ISound | null {
    return this.playCore(type, name, pos, false, 1.0, true, null)
  }

  // ---------------------------------------------------------------------------
  // Play (随机选取) — ImmutableArray<string> 适配
  // OpenRA 对照: Sound.Play(SoundType, ImmutableArray<string>, World, Player?, float)
  //   / Play(SoundType, ImmutableArray<string>, World, WPos, Player?, float)
  // ---------------------------------------------------------------------------

  /** 从名称数组中随机选取并播放 2D 音频。
   *
   * OpenRA 对照: Sound.Play(SoundType, ImmutableArray<string>, World, Player?, float)
   *
   * @param type — 音频类型
   * @param names — 候选名称数组
   * @param volumeModifier — 音量修正系数
   * @param player — 玩家过滤
   * @returns ISound 实例或 null
   */
  playRandom(
    type: SoundType,
    names: readonly string[],
    volumeModifier = 1.0,
    player: { world: { localPlayer: unknown } } | null = null,
  ): ISound | null {
    if (names.length === 0) return null
    const i = Math.floor(Math.random() * names.length)
    return this.playCore(type, names[i], WPos.Zero, true, volumeModifier, false, player)
  }

  /** 从名称数组中随机选取并播放 3D 位置音频。
   *
   * OpenRA 对照: Sound.Play(SoundType, ImmutableArray<string>, World, WPos, Player?, float)
   */
  playRandomAt(
    type: SoundType,
    names: readonly string[],
    pos: WPos,
    volumeModifier = 1.0,
    player: { world: { localPlayer: unknown } } | null = null,
  ): ISound | null {
    if (names.length === 0) return null
    const i = Math.floor(Math.random() * names.length)
    return this.playCore(type, names[i], pos, false, volumeModifier, false, player)
  }

  // ---------------------------------------------------------------------------
  // StopAudio / SetLooped / SetPosition
  // ---------------------------------------------------------------------------

  /** 停止所有音频。
   *
   * OpenRA 对照: Sound.StopAudio()
   */
  stopAudio(): void {
    this.soundEngine.stopAllSounds()
  }

  /** 设置音频循环状态。
   *
   * OpenRA 对照: Sound.SetLooped(ISound, bool)
   */
  setLooped(sound: ISound, looped: boolean): void {
    this.soundEngine.setSoundLooping(looped, sound)
  }

  /** 设置音频 3D 位置。
   *
   * OpenRA 对照: Sound.SetPosition(ISound, WPos)
   */
  setPosition(sound: ISound, position: WPos): void {
    this.soundEngine.setSoundPosition(sound, position)
  }

  // ---------------------------------------------------------------------------
  // 静音控制
  // OpenRA 对照: Sound.MuteAudio() / Sound.UnmuteAudio()
  // ---------------------------------------------------------------------------

  /** 静音（设置引擎音量为 0）。
   *
   * OpenRA 对照: Sound.MuteAudio()
   */
  muteAudio(): void {
    this.soundEngine.volume = 0
  }

  /** 取消静音（恢复引擎音量）。
   *
   * OpenRA 对照: Sound.UnmuteAudio()
   */
  unmuteAudio(): void {
    this.soundEngine.volume = 1
  }

  // ---------------------------------------------------------------------------
  // StopSound
  // OpenRA 对照: Sound.StopSound(ISound)
  // ---------------------------------------------------------------------------

  /** 停止指定音频。
   *
   * OpenRA 对照: Sound.StopSound(ISound)
   */
  stopSound(sound: ISound | null): void {
    if (sound !== null) {
      this.soundEngine.stopSound(sound)
    }
  }

  // ---------------------------------------------------------------------------
  // 音乐管理
  // OpenRA 对照: Sound music-related methods
  // ---------------------------------------------------------------------------

  /** 设置音乐循环状态。
   *
   * OpenRA 对照: Sound.SetMusicLooped(bool)
   */
  setMusicLooped(loop: boolean): void {
    this._repeat = loop
    if (this.music !== null) {
      this.soundEngine.setSoundLooping(loop, this.music)
    }
  }

  /** 播放音乐然后执行回调。
   *
   * OpenRA 对照: Sound.PlayMusicThen(MusicInfo, Action)
   *
   * @param m — 音乐轨道信息
   * @param then — 音乐结束时回调
   */
  playMusicThen(m: MusicInfoCompat | null, then: () => void): void {
    if (m === null || !m.exists) return

    this.onMusicComplete = then

    if (m === this.currentMusic && this.music !== null) {
      this.soundEngine.pauseSound(this.music, false)
      this.musicPlaying = true
      return
    }

    this.playMusicInternal(m, this._repeat)
  }

  /** 播放音乐。
   *
   * OpenRA 对照: Sound.PlayMusic(MusicInfo, bool)
   *
   * @param m — 音乐轨道信息
   * @param looped — 是否循环
   */
  playMusic(m: MusicInfoCompat | null, looped = false): void {
    if (m === null || !m.exists) return

    this.stopMusic()

    const sound = this.playMusicInternal(m, looped)
    if (sound === null) {
      this.onMusicComplete = null
    }
  }

  /** 内部音乐播放逻辑。
   *
   * OpenRA 对照: Sound.PlayMusic 内部实现
   */
  private playMusicInternal(m: MusicInfoCompat, looped: boolean): ISound | null {
    // 异步加载音乐并播放
    // NOTE: 在浏览器环境下，音乐文件通过 URL 加载（非流式 PCM）
    // 使用同步缓存查找或标记为待加载
    const soundSource = this.getCachedSound(m.filename)
    if (!soundSource) {
      // 音乐尚未缓存 —— 记录并跳过
      // 实现异步音乐预加载队列
      console.warn(`[Sound] Music not preloaded: ${m.filename}`)
      return null
    }

    const musicSound = this.soundEngine.play2D(
      soundSource,
      looped,
      true, // headRelative = true（音乐无空间定位）
      WPos.Zero,
      this._musicVolume * m.volumeModifier,
      false, // 不衰减
    )

    if (musicSound !== null) {
      this.music = musicSound
      this.currentMusic = m
      this.musicPlaying = true
    }

    return musicSound
  }

  /** 恢复播放暂停的音乐。
   *
   * OpenRA 对照: Sound.PlayMusic()
   */
  resumeMusic(): void {
    if (this.music === null) return

    this.musicPlaying = true
    this.soundEngine.pauseSound(this.music, false)
  }

  /** 停止音乐。
   *
   * OpenRA 对照: Sound.StopMusic()
   */
  stopMusic(): void {
    if (this.music !== null) {
      this.soundEngine.stopSound(this.music)
      this.music = null
    }

    this.currentMusic = null
    this.musicPlaying = false
  }

  /** 暂停音乐。
   *
   * OpenRA 对照: Sound.PauseMusic()
   */
  pauseMusic(): void {
    if (this.music === null) return

    this.musicPlaying = false
    this.soundEngine.pauseSound(this.music, true)
  }

  /** 音乐播放进度（秒）。
   *
   * OpenRA 对照: Sound.MusicSeekPosition
   */
  get musicSeekPosition(): number {
    return this.music?.seekPosition ?? 0
  }

  // ---------------------------------------------------------------------------
  // 视频音频管理
  // OpenRA 对照: Sound video-related methods
  // ---------------------------------------------------------------------------

  /** 播放视频音频轨道。
   *
   * OpenRA 对照: Sound.PlayVideo(byte[], int, int, int)
   *
   * @param raw — 原始音频数据
   * @param channels — 声道数
   * @param sampleBits — 采样位深
   * @param sampleRate — 采样率
   */
  playVideo(
    raw: ArrayBuffer,
    channels: number,
    sampleBits: number,
    sampleRate: number,
  ): void {
    this.stopVideo()
    this.videoSource = this.soundEngine.addSoundSourceFromMemory(
      raw,
      channels,
      sampleBits,
      sampleRate,
    )
    this.video = this.soundEngine.play2D(
      this.videoSource,
      false,
      true,
      WPos.Zero,
      this.internalSoundVolume,
      false,
    )
  }

  /** 恢复视频播放。
   *
   * OpenRA 对照: Sound.PlayVideo()
   */
  resumeVideo(): void {
    if (this.video !== null) {
      this.soundEngine.pauseSound(this.video, false)
    }
  }

  /** 暂停视频。
   *
   * OpenRA 对照: Sound.PauseVideo()
   */
  pauseVideo(): void {
    if (this.video !== null) {
      this.soundEngine.pauseSound(this.video, true)
    }
  }

  /** 停止视频并释放资源。
   *
   * OpenRA 对照: Sound.StopVideo()
   */
  stopVideo(): void {
    if (this.video !== null) {
      this.soundEngine.stopSound(this.video)
      this.videoSource?.dispose()
      this.videoSource = null
      this.video = null
    }
  }

  /** 视频播放进度（秒）。
   *
   * OpenRA 对照: Sound.VideoSeekPosition
   */
  get videoSeekPosition(): number {
    return this.video?.seekPosition ?? 0
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: Sound.Tick()
  // ---------------------------------------------------------------------------

  /** 每帧更新（检测音乐播放完毕）。
   *
   * OpenRA 对照: Sound.Tick()
   */
  tick(): void {
    // 音乐播放完毕检测
    if (this.musicPlaying && this.music !== null && this.music.complete) {
      this.stopMusic()
      if (this.onMusicComplete) {
        const cb = this.onMusicComplete
        this.onMusicComplete = null
        cb()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PlayPredefined
  // OpenRA 对照: Sound.PlayPredefined(SoundType, Ruleset, Player, Actor,
  //   string type, string definition, string variant, bool relative,
  //   WPos pos, float volumeModifier, bool attenuateVolume)
  // ---------------------------------------------------------------------------

  /** 播放预定义音频（通过 Ruleset 中的 SoundPool 管理语音/通知）。
   *
   * OpenRA 对照: Sound.PlayPredefined()
   *
   * 完整实现了 OpenRA 的 SoundPool 中断策略和变体/前缀逻辑。
   *
   * @param soundType — 音频类型（World=语音, UI=通知）
   * @param ruleset — 音频规则容器
   * @param player — 玩家过滤（非本地玩家不播放）
   * @param voicedActor — 发声单位（可选，用于语音池查找）
   * @param type — 音频类别（如 "Move", "Attack"）
   * @param definition — 池定义键（如 "Move"）
   * @param variant — 变体标识符（可选）
   * @param relative — true=2D 无空间化
   * @param pos — 世界坐标
   * @param volumeModifier — 音量修正系数
   * @param attenuateVolume — 是否启用距离衰减
   * @returns true=播放成功，false=未播放
   */
  playPredefined(
    soundType: SoundType,
    ruleset: IAudioRuleset | null,
    player: { world: { localPlayer: unknown } } | null,
    voicedActor: ISoundActor | null,
    type: string,
    definition: string | null,
    variant: string | null,
    relative: boolean,
    pos: WPos,
    volumeModifier: number,
    attenuateVolume: boolean,
  ): boolean {
    if (ruleset === null) return false

    if (
      definition === null
      || this.disableAllSounds
      || (this.disableWorldSounds && soundType === SoundType.World)
    ) {
      return false
    }

    if (ruleset.voices === null || ruleset.notifications === null) {
      return false
    }

    const rules = voicedActor !== null
      ? ruleset.voices.get(type)
      : ruleset.notifications.get(type)
    if (rules === undefined) return false

    const id = voicedActor?.actorID ?? 0

    // OpenRA 对照: Sound.PlayPredefined line 409
    // Shared voice channel: all selected units use actorId=0 so only one
    // sound plays for the group (prevents 5 simultaneous Move sounds from 5 riflemen)
    const currentSoundsKey = (
      voicedActor !== null
        && voicedActor.world !== null
        && voicedActor.world.selection.contains(voicedActor)
    ) ? 0 : id

    let pool: SoundPool
    let suffix = rules.defaultVariant
    let prefix = rules.defaultPrefix

    if (voicedActor !== null) {
      const p = rules.voicePools.get(definition)
      if (p === undefined) {
        throw new Error(`Can't find ${definition} in voice pool.`)
      }
      pool = p
    } else {
      const p = rules.notificationsPools.get(definition)
      if (p === undefined) {
        throw new Error(`Can't find ${definition} in notification pool.`)
      }
      pool = p
    }

    const clip = pool.getNext()
    if (!clip) return false

    if (variant !== null) {
      if (!rules.disableVariants.has(definition)) {
        const v = rules.variants.get(variant)
        if (v !== undefined) {
          suffix = v[id % v.length]
        }
      }
      if (!rules.disablePrefixes.has(definition)) {
        const p = rules.prefixes.get(variant)
        if (p !== undefined) {
          prefix = p[id % p.length]
        }
      }
    }

    const name = prefix + clip + suffix

    // 检查玩家过滤
    if (player !== null && player !== player.world.localPlayer) {
      return true // 非本地玩家，静默跳过但不返回 false（OpenRA 行为一致）
    }

    if (!name) return false

    const playSound = (): ISound | null => {
      const volume = this.internalSoundVolume * volumeModifier * pool.volumeModifier
      const soundSource = this.getCachedSound(name)
      if (!soundSource) {
        console.warn(`[Sound] PlayPredefined: sound not cached: ${name}`)
        return null
      }
      return this.soundEngine.play2D(
        soundSource,
        false, // loop=false（预定义音频不循环）
        relative,
        pos,
        volume,
        attenuateVolume,
      )
    }

    if (pool.type === InterruptType.Overlap) {
      const sound = playSound()
      if (sound === null) return false
    } else if (voicedActor === null) {
      // 通知处理
      const currentNotification = this.currentNotifications.get(name)
      if (currentNotification !== undefined && !currentNotification.complete) {
        if (pool.type === InterruptType.Interrupt) {
          this.soundEngine.stopSound(currentNotification)
        } else {
          // DoNotPlay
          return false
        }
      }

      const sound = playSound()
      if (sound === null) return false
      this.currentNotifications.set(name, sound)
    } else {
      // 语音处理（按 currentSoundsKey 追踪 —— 选中单位共享 channel 0）
      const currentSound = this.currentSounds.get(currentSoundsKey)
      if (currentSound !== undefined && !currentSound.complete) {
        if (pool.type === InterruptType.Interrupt) {
          this.soundEngine.stopSound(currentSound)
        } else {
          return false
        }
      }

      const sound = playSound()
      if (sound === null) return false
      this.currentSounds.set(currentSoundsKey, sound)
    }

    return true
  }

  /** 播放通知（PlayPredefined 的 UI 便捷封装）。
   *
   * OpenRA 对照: Sound.PlayNotification(Ruleset, Player, string, string, string)
   *
   * @returns true=播放成功
   */
  playNotification(
    ruleset: IAudioRuleset | null,
    player: { world: { localPlayer: unknown } } | null,
    type: string | null,
    notification: string | null,
    variant: string | null,
  ): boolean {
    if (ruleset === null) return false
    if (type === null || notification === null) return false

    return this.playPredefined(
      SoundType.UI,
      ruleset,
      player,
      null, // 无发声单位
      type.toLowerCase(),
      notification,
      variant,
      true, // relative
      WPos.Zero,
      1.0, // volumeModifier
      false, // 不衰减
    )
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // OpenRA 对照: Sound.Dispose()
  // ---------------------------------------------------------------------------

  /** 释放所有音频资源。
   *
   * OpenRA 对照: Sound.Dispose()
   */
  dispose(): void {
    this.stopAudio()

    if (this.sounds !== null) {
      for (const soundSource of this.sounds.values()) {
        soundSource.dispose()
      }
      this.sounds.clear()
      this.sounds = null
    }

    this.currentSounds.clear()
    this.currentNotifications.clear()
    this.videoSource?.dispose()
    this.videoSource = null
    this.video = null
    this.music = null
    this.currentMusic = null
    this.musicPlaying = false
    this.onMusicComplete = null

    this.soundEngine.dispose()
  }
}
