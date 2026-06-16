/**
 * AudioSettingsLogic.ts — 音频设置面板逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/AudioSettingsLogic.cs (173 lines)
 *
 * 核心范式转换:
 * - C# SoundSettings (SoundVolume, MusicVolume, VideoVolume, CashTicks, Mute, MuteBackgroundMusic, Device)
 *   → TypeScript AudioSettings 接口
 * - C# SoundDevice (Device, Label) → AudioDevice 接口
 * - C# Game.Sound.DummyEngine → soundSystem.isDummy 布尔值
 * - C# Game.Sound.MuteAudio / UnmuteAudio → soundSystem 回调
 * - C# Game.Sound.AvailableDevices() → soundSystem.getDevices()
 * - C# Game.Sound.SoundVolume / MusicVolume / VideoVolume → soundSystem 回调
 * - C# MusicPlaylist → musicPlaylist 回调
 * - C# CachedTransform<SoundDevice, string> → 闭包缓存
 * - C# WidgetUtils.TruncateText → 简单字符串截断
 */

import { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { SettingsLogic } from './SettingsLogic.js'
import { SettingsUtils } from './SettingsUtils.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { SliderWidget } from '../../SliderWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../ScrollItemWidget.js'

// ---------------------------------------------------------------------------
// AudioDevice — 音频设备接口
// OpenRA 对照: SoundDevice readonly struct
// ---------------------------------------------------------------------------

/** 音频设备信息。
 *
 * OpenRA 对照: readonly struct SoundDevice
 */
export interface AudioDevice {
  /** 设备标识符。 */
  device: string
  /** 设备显示标签。 */
  label: string
}

// ---------------------------------------------------------------------------
// AudioSettings — 音频设置状态
// OpenRA 对照: SoundSettings
// ---------------------------------------------------------------------------

/** 音频设置状态对象。OpenRA 对照: SoundSettings */
export interface AudioSettings {
  soundVolume: number
  musicVolume: number
  videoVolume: number
  cashTicks: boolean
  mute: boolean
  muteBackgroundMusic: boolean
  device: string
}

// ---------------------------------------------------------------------------
// SoundSystem — 音频系统回调接口
// OpenRA 对照: Game.Sound
// ---------------------------------------------------------------------------

/** 音频系统回调接口（可替换用于测试）。
 *
 * OpenRA 对照: Game.Sound
 */
export interface SoundSystem {
  /** 是否为虚拟音频引擎（无实际音频设备）。 */
  isDummy: boolean
  /** 静音所有音频。 */
  muteAudio(): void
  /** 取消静音。 */
  unmuteAudio(): void
  /** 设置音效音量（0-1）。 */
  setSoundVolume(volume: number): void
  /** 设置音乐音量（0-1）。 */
  setMusicVolume(volume: number): void
  /** 设置视频音量（0-1）。 */
  setVideoVolume(volume: number): void
  /** 获取可用音频设备列表。 */
  getDevices(): AudioDevice[]
}

// ---------------------------------------------------------------------------
// MusicPlaylistCallbacks — 音乐播放列表回调接口
// OpenRA 对照: MusicPlaylist trait
// ---------------------------------------------------------------------------

/** 音乐播放列表回调接口。
 *
 * OpenRA 对照: MusicPlaylist.AllowMuteBackgroundMusic / CurrentSongIsBackground / Stop()
 */
export interface MusicPlaylistCallbacks {
  /** 是否允许静音背景音乐。 */
  allowMuteBackgroundMusic: boolean
  /** 当前歌曲是否为背景音乐。 */
  currentSongIsBackground: boolean
  /** 停止当前播放。 */
  stop(): void
}

// ---------------------------------------------------------------------------
// AudioSettingsLogic — 音频设置面板
// OpenRA 对照: public class AudioSettingsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 音频设置面板逻辑。
 *
 * 绑定音量滑块、静音复选框、音频设备选择等控件。
 *
 * OpenRA 对照: public class AudioSettingsLogic : ChromeLogic
 */
export class AudioSettingsLogic {
  private readonly audioSettings: AudioSettings
  private readonly soundSystem: SoundSystem
  private readonly musicPlaylist: MusicPlaylistCallbacks | null

  /** 原始音频设置（用于变更检测）。 */
  private readonly originalAudioSettings: AudioSettings

  /** 当前选中的音频设备。 */
  private selectedDevice: AudioDevice | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 构造音频设置面板。
   *
   * @param settingsLogic — 父设置路由
   * @param panelID — 面板 ID
   * @param label — 面板标签
   * @param audioSettings — 音频设置状态
   * @param soundSystem — 音频系统回调
   * @param musicPlaylist — 音乐播放列表回调（可选）
   */
  constructor(
    settingsLogic: SettingsLogic,
    panelID: string,
    label: string,
    audioSettings: AudioSettings,
    soundSystem: SoundSystem,
    musicPlaylist?: MusicPlaylistCallbacks,
  ) {
    this.audioSettings = audioSettings
    this.soundSystem = soundSystem
    this.musicPlaylist = musicPlaylist ?? null

    this.originalAudioSettings = { ...audioSettings }

    settingsLogic.registerSettingsPanel(
      panelID,
      label,
      (panel) => this.initPanel(panel),
      (panel) => this.resetPanel(panel),
    )
  }

  // ---------------------------------------------------------------------------
  // InitPanel
  // ---------------------------------------------------------------------------

  private initPanel(panel: Widget): () => boolean {
    const scrollPanel =
      panel.get<ScrollPanelWidget>('SETTINGS_SCROLLPANEL')

    // ---- 复选框绑定 ----
    SettingsUtils.bindCheckboxPref(
      panel,
      'CASH_TICKS',
      () => this.audioSettings.cashTicks,
      (v) => {
        this.audioSettings.cashTicks = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'MUTE_SOUND',
      () => this.audioSettings.mute,
      (v) => {
        this.audioSettings.mute = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'MUTE_BACKGROUND_MUSIC',
      () => this.audioSettings.muteBackgroundMusic,
      (v) => {
        this.audioSettings.muteBackgroundMusic = v
      },
    )

    // ---- 滑块绑定 ----
    SettingsUtils.bindSliderPref(
      panel,
      'SOUND_VOLUME',
      () => this.audioSettings.soundVolume,
      (v) => {
        this.audioSettings.soundVolume = v
      },
    )

    SettingsUtils.bindSliderPref(
      panel,
      'MUSIC_VOLUME',
      () => this.audioSettings.musicVolume,
      (v) => {
        this.audioSettings.musicVolume = v
      },
    )

    SettingsUtils.bindSliderPref(
      panel,
      'VIDEO_VOLUME',
      () => this.audioSettings.videoVolume,
      (v) => {
        this.audioSettings.videoVolume = v
      },
    )

    // ---- 静音复选框特殊处理 ----
    const muteCheckbox = panel.get<CheckboxWidget>('MUTE_SOUND')
    const origIsChecked = muteCheckbox.isChecked
    muteCheckbox.isChecked = () =>
      origIsChecked() || this.soundSystem.isDummy
    muteCheckbox.isDisabled = () => this.soundSystem.isDummy
    const origMuteOnClick = muteCheckbox.onClick
    muteCheckbox.onClick = () => {
      origMuteOnClick()
      if (this.audioSettings.mute) {
        this.soundSystem.muteAudio()
      } else {
        this.soundSystem.unmuteAudio()
      }
    }

    // ---- 背景音乐静音复选框特殊处理 ----
    if (this.musicPlaylist) {
      const muteBgmCheckbox = panel.get<CheckboxWidget>(
        'MUTE_BACKGROUND_MUSIC',
      )
      const origBgmOnClick = muteBgmCheckbox.onClick
      muteBgmCheckbox.onClick = () => {
        origBgmOnClick()
        if (!this.musicPlaylist?.allowMuteBackgroundMusic) return
        if (this.musicPlaylist.currentSongIsBackground) {
          this.musicPlaylist.stop()
        }
      }
    }

    // ---- 无音频设备提示 ----
    const noDeviceLabel = panel.getOrNull('NO_AUDIO_DEVICE_CONTAINER')
    if (noDeviceLabel) {
      noDeviceLabel.visible = this.soundSystem.isDummy
    }

    // 当音频引擎为虚拟时隐藏控件（在 open 设置中为可见时自动应用）
    panel.get('CASH_TICKS_CONTAINER').visible = !this.soundSystem.isDummy
    panel.get('MUTE_SOUND_CONTAINER').visible = !this.soundSystem.isDummy
    panel
      .get('MUTE_BACKGROUND_MUSIC_CONTAINER')
      .visible = !this.soundSystem.isDummy
    panel
      .get('SOUND_VOLUME_CONTAINER')
      .visible = !this.soundSystem.isDummy
    panel
      .get('MUSIC_VOLUME_CONTAINER')
      .visible = !this.soundSystem.isDummy
    panel
      .get('VIDEO_VOLUME_CONTAINER')
      .visible = !this.soundSystem.isDummy

    // ---- 音量滑块实时更新 ----
    const soundVolumeSlider =
      panel.get<SliderWidget>('SOUND_VOLUME')
    const origSoundOnChange = soundVolumeSlider.onChange
    soundVolumeSlider.onChange = (x: number) => {
      if (origSoundOnChange) origSoundOnChange(x)
      this.soundSystem.setSoundVolume(x)
    }

    const musicVolumeSlider =
      panel.get<SliderWidget>('MUSIC_VOLUME')
    const origMusicOnChange = musicVolumeSlider.onChange
    musicVolumeSlider.onChange = (x: number) => {
      if (origMusicOnChange) origMusicOnChange(x)
      this.soundSystem.setMusicVolume(x)
    }

    const videoVolumeSlider =
      panel.get<SliderWidget>('VIDEO_VOLUME')
    const origVideoOnChange = videoVolumeSlider.onChange
    videoVolumeSlider.onChange = (x: number) => {
      if (origVideoOnChange) origVideoOnChange(x)
      this.soundSystem.setVideoVolume(x)
    }

    // ---- 音频设备下拉菜单 ----
    const devices = this.soundSystem.getDevices()
    this.selectedDevice =
      devices.find((d) => d.device === this.audioSettings.device) ??
      (devices.length > 0 ? devices[0] : null)

    const audioDeviceDropdown =
      panel.get<DropDownButtonWidget>('AUDIO_DEVICE')
    audioDeviceDropdown.onMouseDown = () =>
      this.showAudioDeviceDropdown(
        audioDeviceDropdown,
        devices,
        scrollPanel,
      )
    audioDeviceDropdown.getText = () =>
      this.selectedDevice
        ? this.truncateText(
            this.selectedDevice.label,
            audioDeviceDropdown.usableWidth,
          )
        : 'No Device'

    // ---- 重启提示 ----
    const restartDesc = panel.get('AUDIO_RESTART_REQUIRED_DESC')
    restartDesc.isVisible = () =>
      this.selectedDevice?.device !==
      this.originalAudioSettings.device

    SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

    return () => {
      if (this.selectedDevice) {
        this.audioSettings.device = this.selectedDevice.device
      }
      return (
        this.audioSettings.device !==
        this.originalAudioSettings.device
      )
    }
  }

  // ---------------------------------------------------------------------------
  // ResetPanel
  // ---------------------------------------------------------------------------

  private resetPanel(panel: Widget): () => void {
    return () => {
      this.audioSettings.soundVolume = 0.5
      this.audioSettings.musicVolume = 0.5
      this.audioSettings.videoVolume = 0.5
      this.audioSettings.cashTicks = true
      this.audioSettings.mute = false
      this.audioSettings.muteBackgroundMusic = false
      this.audioSettings.device = ''

      // 更新滑块值
      panel.get<SliderWidget>('SOUND_VOLUME').value =
        this.audioSettings.soundVolume
      this.soundSystem.setSoundVolume(this.audioSettings.soundVolume)
      panel.get<SliderWidget>('MUSIC_VOLUME').value =
        this.audioSettings.musicVolume
      this.soundSystem.setMusicVolume(this.audioSettings.musicVolume)
      panel.get<SliderWidget>('VIDEO_VOLUME').value =
        this.audioSettings.videoVolume
      this.soundSystem.setVideoVolume(this.audioSettings.videoVolume)
      this.soundSystem.unmuteAudio()

      // 默认设备
      const devices = this.soundSystem.getDevices()
      this.selectedDevice =
        devices.length > 0 ? devices[0] : null
    }
  }

  // ---------------------------------------------------------------------------
  // Show Audio Device Dropdown
  // ---------------------------------------------------------------------------

  private showAudioDeviceDropdown(
    dropdown: DropDownButtonWidget,
    devices: AudioDevice[],
    _scrollPanel: ScrollPanelWidget,
  ): void {
    const options = devices.map((d, i) => ({
      key: i.toString(),
      device: d,
    }))

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.selectedDevice === option.device,
          () => {
            this.selectedDevice = option.device
          },
        )
        item.text = option.device.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // TruncateText — 截断文本以适应可用宽度
  // ---------------------------------------------------------------------------

  private truncateText(text: string, _maxWidth: number): string {
    // NOTE: OpenRA uses WidgetUtils.TruncateText with font measurement.
    // In DOM-based rendering, text truncation is handled by CSS text-overflow.
    return text
  }
}
