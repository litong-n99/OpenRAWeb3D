/**
 * MusicPlayerLogic.ts — 音乐播放器控制面板逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MusicPlayerLogic.cs (170 lines)
 *
 * 核心范式转换:
 * - OpenRA MusicPlaylist trait (C# World Actor trait) → IMusicPlaylist 接口
 * - OpenRA Game.Sound.PlayMusic / StopMusic / PauseMusic → Sound 实例方法
 * - OpenRA Game.Settings.Sound (全局设置) → 通过接口注入
 * - OpenRA WidgetUtils.TruncateLabelToTooltip → LabelWidget.getText 委托
 * - OpenRA LogicTickerWidget.OnTick → ChromeLogic.tick() 每帧检测
 * - OpenRA SliderWidget.OnChange + Value → onChange 回调 + value 属性
 */

import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import { ChromeLogic, Ui } from '../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// MusicTrackInfo — 音乐轨道信息（扩展接口）
// OpenRA 对照: MusicTrackInfo (OpenRA.GameRules)
//
// NOTE: 此接口合并了 Ruleset.MusicTrackInfo（filename/volume）和 MusicTrackInfo 类（title/length）
// 以支持 MusicPlayerLogic 的完整需求。
// ---------------------------------------------------------------------------

/** 音乐轨道信息。
 *
 * OpenRA 对照: MusicTrackInfo class + MusicTrackInfo interface
 */
export interface MusicTrackInfo {
  /** 音频文件路径。 */
  readonly filename: string
  /** 人类可读的轨道标题。 */
  readonly title: string
  /** 轨道时长（秒）。 */
  readonly length: number
  /** 音量修正系数。 */
  readonly volume: number
  /** 文件是否存在。 */
  readonly exists: boolean
  /** 是否隐藏。 */
  readonly hidden: boolean
  /** 音量修正系数（MusicTrackInfo 类字段）。 */
  readonly volumeModifier: number
}

// ---------------------------------------------------------------------------
// IMusicPlaylist — 音乐播放列表 trait 接口
// OpenRA 对照: MusicPlaylist trait (OpenRA.Mods.Common/Traits/)
// ---------------------------------------------------------------------------

/** 音乐播放列表接口。
 *
 * OpenRA 对照: MusicPlaylist class
 */
export interface IMusicPlaylist {
  /** 是否可用音乐。 */
  isMusicAvailable: boolean

  /** 当前歌曲是否为背景音乐（不可跳过）。 */
  currentSongIsBackground: boolean

  /** 获取可用播放列表。 */
  availablePlaylist(): MusicTrackInfo[]

  /** 获取当前播放的歌曲。 */
  currentSong(): MusicTrackInfo | null

  /** 获取下一首歌曲。 */
  getNextSong(): MusicTrackInfo | null

  /** 获取上一首歌曲。 */
  getPrevSong(): MusicTrackInfo | null

  /** 播放指定歌曲。 */
  play(song: MusicTrackInfo): void

  /** 停止播放。 */
  stop(): void
}

// ---------------------------------------------------------------------------
// IMusicPlayerSound — MusicPlayerLogic 所需的 Sound 子集
// OpenRA 对照: Game.Sound
// ---------------------------------------------------------------------------

/** 音乐播放器所需的 Sound 接口。
 *
 * OpenRA 对照: Sound class (music-related members)
 */
export interface IMusicPlayerSound {
  /** 当前播放的音乐。 */
  currentMusic: MusicTrackInfo | null

  /** 是否正在播放音乐。 */
  musicPlaying: boolean

  /** 音乐播放进度（秒）。 */
  musicSeekPosition: number

  /** 音乐音量 (0.0-1.0)。 */
  musicVolume: number

  /** 设置音乐音量。 */
  setMusicVolume(volume: number): void

  /** 播放音乐。 */
  playMusic(m: MusicTrackInfo | null, looped?: boolean): void

  /** 暂停音乐。 */
  pauseMusic(): void

  /** 恢复音乐。 */
  resumeMusic(): void

  /** 停止音乐。 */
  stopMusic(): void

  /** 设置音乐循环。 */
  setMusicLooped(loop: boolean): void
}

// ---------------------------------------------------------------------------
// IMusicPlayerSettings — 音乐相关设置
// OpenRA 对照: Game.Settings.Sound
// ---------------------------------------------------------------------------

/** 音乐播放器所需的设置接口。 */
export interface IMusicPlayerSettings {
  mute: boolean
  shuffle: boolean
  repeat: boolean
  /** 持久化设置。 */
  save(): void
}

// ---------------------------------------------------------------------------
// FluentProvider 存根
// ---------------------------------------------------------------------------

function fluentMsg(key: string): string {
  return key
}

// ---------------------------------------------------------------------------
// MusicPlayerLogic
// OpenRA 对照: MusicPlayerLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 音乐播放器控制面板逻辑 — 管理曲目列表、播放控制、随机/重复切换。
 *
 * OpenRA 对照: class MusicPlayerLogic : ChromeLogic
 */
export class MusicPlayerLogic extends ChromeLogic {
  private readonly _musicPlaylist: IMusicPlaylist
  private readonly _sound: IMusicPlayerSound
  private readonly _settings: IMusicPlayerSettings
  private readonly _onExit: () => void

  /** 当前选中的歌曲（不同于 Sound.currentMusic — 用户交互状态）。 */
  private _currentSong: MusicTrackInfo | null = null

  /** 曲目列表 widget。 */
  private readonly _musicList: Widget & { removeChildren(): void; addChild(w: Widget): void }

  // ---- 构造 ----

  /**
   * @param widget — 根 widget 节点
   * @param world — 世界对象
   * @param _modData — mod 运行时数据
   * @param onExit — 退出回调
   * @param musicPlaylist — 音乐播放列表 trait
   * @param sound — 音频管理器
   * @param settings — 音乐设置
   */
  constructor(
    widget: Widget,
    world: unknown,
    _modData: unknown,
    onExit: () => void,
    musicPlaylist: IMusicPlaylist,
    sound: IMusicPlayerSound,
    settings: IMusicPlayerSettings,
  ) {
    super()

    this._musicPlaylist = musicPlaylist
    this._sound = sound
    this._settings = settings
    this._onExit = onExit

    // 预留 world 引用（将来可能用于 MusicPlaylist trait 访问）
    void world

    // 获取 UI widget
    this._musicList = widget.get<Widget & any>('MUSIC_LIST')
    const panel = widget

    this._buildMusicTable()

    // "没有音乐" 标签
    const noMusicFn = () =>
      !this._musicPlaylist.isMusicAvailable ||
      this._musicPlaylist.currentSongIsBackground ||
      this._currentSong === null

    try {
      const noMusicLabel = panel.get<Widget & { isVisible?: () => boolean }>('NO_MUSIC_LABEL')
      noMusicLabel.isVisible = () => !this._musicPlaylist.isMusicAvailable
    } catch { /* 标签不存在时跳过 */ }

    // 静音标签
    try {
      const muteLabel = panel.get<Widget & { getText?: () => string }>('MUTE_LABEL')
      if (this._musicPlaylist.isMusicAvailable) {
        muteLabel.getText = () => (this._settings.mute ? fluentMsg('label-sound-muted') : '')
      }
    } catch { /* 标签不存在时跳过 */ }

    // 按钮: 播放
    try {
      const playButton = panel.get<Widget & { onClick?: () => void; isDisabled?: () => boolean; isVisible?: () => boolean }>('BUTTON_PLAY')
      playButton.onClick = () => this._play()
      playButton.isDisabled = noMusicFn
      playButton.isVisible = () => !this._sound.musicPlaying
    } catch { /* 按钮不存在时跳过 */ }

    // 按钮: 暂停
    try {
      const pauseButton = panel.get<Widget & { onClick?: () => void; isDisabled?: () => boolean; isVisible?: () => boolean }>('BUTTON_PAUSE')
      pauseButton.onClick = () => this._sound.pauseMusic()
      pauseButton.isDisabled = noMusicFn
      pauseButton.isVisible = () => this._sound.musicPlaying
    } catch { /* 按钮不存在时跳过 */ }

    // 按钮: 停止
    try {
      const stopButton = panel.get<Widget & { onClick?: () => void; isDisabled?: () => boolean }>('BUTTON_STOP')
      stopButton.onClick = () => this._musicPlaylist.stop()
      stopButton.isDisabled = noMusicFn
    } catch { /* 按钮不存在时跳过 */ }

    // 按钮: 下一首
    try {
      const nextButton = panel.get<Widget & { onClick?: () => void; isDisabled?: () => boolean }>('BUTTON_NEXT')
      nextButton.onClick = () => {
        this._currentSong = this._musicPlaylist.getNextSong()
        this._play()
      }
      nextButton.isDisabled = noMusicFn
    } catch { /* 按钮不存在时跳过 */ }

    // 按钮: 上一首
    try {
      const prevButton = panel.get<Widget & { onClick?: () => void; isDisabled?: () => boolean }>('BUTTON_PREV')
      prevButton.onClick = () => {
        this._currentSong = this._musicPlaylist.getPrevSong()
        this._play()
      }
      prevButton.isDisabled = noMusicFn
    } catch { /* 按钮不存在时跳过 */ }

    // 随机复选框
    try {
      const shuffleCheckbox = panel.get<Widget & { isChecked?: () => boolean; onClick?: () => void; isDisabled?: () => boolean }>('SHUFFLE')
      shuffleCheckbox.isChecked = () => this._settings.shuffle
      shuffleCheckbox.onClick = () => {
        (this._settings as any).shuffle = !this._settings.shuffle
      }
      shuffleCheckbox.isDisabled = () => this._musicPlaylist.currentSongIsBackground
    } catch { /* 复选框不存在时跳过 */ }

    // 重复复选框
    try {
      const repeatCheckbox = panel.get<Widget & { isChecked?: () => boolean; onClick?: () => void; isDisabled?: () => boolean }>('REPEAT')
      repeatCheckbox.isChecked = () => this._settings.repeat
      repeatCheckbox.onClick = () => {
        const newRepeat = !this._settings.repeat
        ;(this._settings as any).repeat = newRepeat
        this._sound.setMusicLooped(!newRepeat)
      }
      repeatCheckbox.isDisabled = () => this._musicPlaylist.currentSongIsBackground
    } catch { /* 复选框不存在时跳过 */ }

    // 时间标签
    try {
      const timeLabel = panel.get<Widget & { getText?: () => string }>('TIME_LABEL')
      timeLabel.getText = () => this._getTimeLabel()
    } catch { /* 标签不存在时跳过 */ }

    // 标题标签
    const noSongPlaying = fluentMsg('label-no-song-playing')
    const musicTitle = panel.getOrNull<Widget & { getText?: () => string }>('TITLE_LABEL')
    if (musicTitle) {
      musicTitle.getText = () =>
        this._currentSong !== null ? this._currentSong.title : noSongPlaying
    }

    // 音量滑块
    try {
      const musicSlider = panel.get<Widget & { onChange?: (v: number) => void; value?: number; Value?: number }>('MUSIC_SLIDER')
      if (musicSlider.onChange) {
        const origOnChange = musicSlider.onChange
        musicSlider.onChange = (v: number) => {
          origOnChange(v)
          this._sound.setMusicVolume(v)
        }
      }
      // 设置初始值
      if (musicSlider.value !== undefined) musicSlider.value = this._sound.musicVolume
      else if (musicSlider.Value !== undefined) (musicSlider as any).Value = this._sound.musicVolume
    } catch { /* 滑块不存在时跳过 */ }

    // 返回按钮
    const backButton = panel.getOrNull<Widget & { onClick?: () => void }>('BACK_BUTTON')
    if (backButton) {
      backButton.onClick = () => {
        this._settings.save()
        Ui.closeWindow()
        this._onExit()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 构建曲目表
  // ---------------------------------------------------------------------------

  /** 构建曲目列表。
   *
   * OpenRA 对照: BuildMusicTable()
   */
  private _buildMusicTable(): void {
    if (!this._musicPlaylist.isMusicAvailable) return

    const allMusic = this._musicPlaylist.availablePlaylist()
    this._currentSong = this._musicPlaylist.currentSong()

    this._musicList.removeChildren()

    for (const song of allMusic) {
      const itemTemplate = (this._musicList as Widget).getOrNull('MUSIC_TEMPLATE')
      if (!itemTemplate) continue

      const item = (itemTemplate as unknown as { clone(): Widget }).clone()

      // 设置选中状态
      ;(item as any).isSelected = () => this._currentSong === song

      // 点击选中并播放
      ;(item as any).onClick = () => {
        this._currentSong = song
        this._play()
      }

      // 设置标题
      try {
        const label = (item as Widget).get<Widget & { getText?: () => string }>('TITLE')
        if (label && label.getText) {
          label.getText = () => song.title
        }
      } catch { /* 标签不存在时跳过 */ }

      // 设置时长标签
      try {
        const lengthLabel = (item as Widget).get<Widget & { getText?: () => string }>('LENGTH')
        if (lengthLabel && lengthLabel.getText) {
          lengthLabel.getText = () => MusicPlayerLogic.songLengthLabel(song)
        }
      } catch { /* 标签不存在时跳过 */ }

      this._musicList.addChild(item)
    }
  }

  // ---------------------------------------------------------------------------
  // 播放控制
  // ---------------------------------------------------------------------------

  /** 播放当前选中歌曲。
   *
   * OpenRA 对照: Play()
   */
  private _play(): void {
    if (!this._currentSong) return

    this._musicPlaylist.play(this._currentSong)
  }

  // ---------------------------------------------------------------------------
  // 标签格式化
  // ---------------------------------------------------------------------------

  /** 获取时间标签文本（"MM:SS / MM:SS" 格式）。
   *
   * OpenRA 对照: TIME_LABEL.GetText 委托
   */
  private _getTimeLabel(): string {
    if (this._currentSong === null || this._musicPlaylist.currentSongIsBackground) {
      return ''
    }

    const seek = this._sound.musicSeekPosition
    const minutes = Math.floor(seek / 60)
    const seconds = Math.floor(seek % 60)
    const totalMinutes = Math.floor(this._currentSong.length / 60)
    const totalSeconds = this._currentSong.length % 60

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} / ${String(totalMinutes).padStart(2, '0')}:${String(totalSeconds).padStart(2, '0')}`
  }

  /** 格式化歌曲时长为 "M:SS"。
   *
   * OpenRA 对照: SongLengthLabel(MusicTrackInfo)
   */
  static songLengthLabel(song: { length: number }): string {
    const totalMinutes = Math.floor(song.length / 60)
    const totalSeconds = song.length % 60
    return `${totalMinutes}:${String(totalSeconds).padStart(2, '0')}`
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic 接口
  // ---------------------------------------------------------------------------

  /** 每帧 tick — 检测当前播放歌曲变化。
   *
   * OpenRA 对照: LogicTickerWidget.SONG_WATCHER.OnTick
   */
  override tick(): void {
    // 如果当前是背景音乐，清除选中
    if (this._musicPlaylist.currentSongIsBackground && this._currentSong !== null) {
      this._currentSong = null
    }

    // 检测歌曲变化
    if (
      this._sound.currentMusic === null ||
      this._currentSong === this._sound.currentMusic ||
      this._musicPlaylist.currentSongIsBackground
    ) {
      return
    }

    this._currentSong = this._sound.currentMusic
  }

  override dispose(): void {
    super.dispose()
  }
}
