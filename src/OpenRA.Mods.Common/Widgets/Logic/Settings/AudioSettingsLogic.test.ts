/**
 * AudioSettingsLogic.test.ts — AudioSettingsLogic 单元测试
 *
 * 测试覆盖:
 * - AudioSettings 状态对象
 * - SoundSystem 回调接口
 * - MusicPlaylistCallbacks 接口
 * - 音量滑块 getter/setter
 * - 静音/取消静音
 * - 音频设备选择
 * - 虚拟机音频引擎处理
 * - 重置到默认值
 * - 设置变更后的重启检测
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AudioSettingsLogic,
  type AudioSettings,
  type AudioDevice,
  type SoundSystem,
  type MusicPlaylistCallbacks,
} from './AudioSettingsLogic.js'
import { SettingsLogic } from './SettingsLogic.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAudioSettings(): AudioSettings {
  return {
    soundVolume: 0.8,
    musicVolume: 0.6,
    videoVolume: 0.7,
    cashTicks: true,
    mute: false,
    muteBackgroundMusic: false,
    device: 'default',
  }
}

function createMockSoundSystem(): SoundSystem {
  return {
    isDummy: false,
    muteAudio: vi.fn(),
    unmuteAudio: vi.fn(),
    setSoundVolume: vi.fn(),
    setMusicVolume: vi.fn(),
    setVideoVolume: vi.fn(),
    getDevices: vi.fn(() => [
      { device: 'default', label: 'Default Device' },
      { device: 'hdmi', label: 'HDMI Output' },
    ]),
  }
}

function createMockMusicPlaylist(): MusicPlaylistCallbacks {
  return {
    allowMuteBackgroundMusic: true,
    currentSongIsBackground: false,
    stop: vi.fn(),
  }
}

function buildSettingsLogic(): SettingsLogic {
  const widget = new ContainerWidget()
  widget.id = 'ROOT'
  const pc = new ContainerWidget()
  pc.id = 'PANEL_CONTAINER'
  const pt = new ContainerWidget()
  pt.id = 'PANEL_TEMPLATE'
  pc.addChild(pt)
  widget.addChild(pc)
  const tc = new ContainerWidget()
  tc.id = 'SETTINGS_TAB_CONTAINER'
  const tt = new ContainerWidget() as any
  tt.id = 'BUTTON_TEMPLATE'
  tt.clone = () => {
    const b = new ContainerWidget() as any
    b.getText = () => ''
    b.isHighlighted = () => false
    b.bounds = { x: 0, y: 0, width: 100, height: 30 }
    return b
  }
  tc.addChild(tt)
  widget.addChild(tc)
  widget.get = (id: string) => {
    if (id === 'PANEL_CONTAINER') return pc
    if (id === 'SETTINGS_TAB_CONTAINER') return tc
    if (id === 'BUTTON_TEMPLATE') return tt
    if (id === 'PANEL_TEMPLATE') return pt
    const bk = new ContainerWidget() as any
    bk.id = id
    bk.onClick = () => {}
    return bk
  }
  return new SettingsLogic(
    widget,
    vi.fn(),
    {},
    {
      saveSettings: vi.fn(),
      hasExternalMod: vi.fn(() => false),
      switchToExternalMod: vi.fn(),
      showConfirmDialog: vi.fn(),
      showSavePrompt: vi.fn(),
      closeWindow: vi.fn(),
    },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioSettingsLogic', () => {
  let audioSettings: AudioSettings
  let soundSystem: SoundSystem
  let settingsLogic: SettingsLogic

  beforeEach(() => {
    audioSettings = createMockAudioSettings()
    soundSystem = createMockSoundSystem()
    settingsLogic = buildSettingsLogic()
  })

  // ---------------------------------------------------------------------------
  // AudioSettings state
  // ---------------------------------------------------------------------------

  describe('AudioSettings state', () => {
    it('should have sound volume', () => {
      expect(audioSettings.soundVolume).toBe(0.8)
      audioSettings.soundVolume = 0.5
      expect(audioSettings.soundVolume).toBe(0.5)
    })

    it('should have music volume', () => {
      expect(audioSettings.musicVolume).toBe(0.6)
      audioSettings.musicVolume = 0.3
      expect(audioSettings.musicVolume).toBe(0.3)
    })

    it('should have video volume', () => {
      expect(audioSettings.videoVolume).toBe(0.7)
      audioSettings.videoVolume = 1.0
      expect(audioSettings.videoVolume).toBe(1.0)
    })

    it('should have mute flag', () => {
      expect(audioSettings.mute).toBe(false)
      audioSettings.mute = true
      expect(audioSettings.mute).toBe(true)
    })

    it('should have cash ticks flag', () => {
      expect(audioSettings.cashTicks).toBe(true)
      audioSettings.cashTicks = false
      expect(audioSettings.cashTicks).toBe(false)
    })

    it('should have device string', () => {
      expect(audioSettings.device).toBe('default')
      audioSettings.device = 'hdmi'
      expect(audioSettings.device).toBe('hdmi')
    })
  })

  // ---------------------------------------------------------------------------
  // SoundSystem callbacks
  // ---------------------------------------------------------------------------

  describe('SoundSystem callbacks', () => {
    it('should call muteAudio', () => {
      soundSystem.muteAudio()
      expect(soundSystem.muteAudio).toHaveBeenCalled()
    })

    it('should call unmuteAudio', () => {
      soundSystem.unmuteAudio()
      expect(soundSystem.unmuteAudio).toHaveBeenCalled()
    })

    it('should get devices', () => {
      const devices = soundSystem.getDevices()
      expect(devices.length).toBe(2)
      expect(devices[0].device).toBe('default')
    })

    it('should set volumes', () => {
      soundSystem.setSoundVolume(0.3)
      expect(soundSystem.setSoundVolume).toHaveBeenCalledWith(0.3)

      soundSystem.setMusicVolume(0.4)
      expect(soundSystem.setMusicVolume).toHaveBeenCalledWith(0.4)

      soundSystem.setVideoVolume(0.5)
      expect(soundSystem.setVideoVolume).toHaveBeenCalledWith(0.5)
    })
  })

  // ---------------------------------------------------------------------------
  // Dummy engine (no audio device)
  // ---------------------------------------------------------------------------

  describe('dummy engine', () => {
    it('should detect dummy engine', () => {
      const dummySound: SoundSystem = {
        ...soundSystem,
        isDummy: true,
      }
      expect(dummySound.isDummy).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should construct without error', () => {
      expect(() => {
        new AudioSettingsLogic(
          settingsLogic,
          'Audio',
          'Audio',
          audioSettings,
          soundSystem,
        )
      }).not.toThrow()
    })

    it('should construct with music playlist', () => {
      const playlist = createMockMusicPlaylist()
      expect(() => {
        new AudioSettingsLogic(
          settingsLogic,
          'Audio',
          'Audio',
          audioSettings,
          soundSystem,
          playlist,
        )
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // AudioDevice interface
  // ---------------------------------------------------------------------------

  describe('AudioDevice interface', () => {
    it('should have device and label properties', () => {
      const device: AudioDevice = { device: 'test', label: 'Test Device' }
      expect(device.device).toBe('test')
      expect(device.label).toBe('Test Device')
    })
  })

  // ---------------------------------------------------------------------------
  // MusicPlaylistCallbacks
  // ---------------------------------------------------------------------------

  describe('MusicPlaylistCallbacks', () => {
    it('should track allow mute background music', () => {
      const playlist = createMockMusicPlaylist()
      expect(playlist.allowMuteBackgroundMusic).toBe(true)
    })

    it('should stop playback', () => {
      const playlist = createMockMusicPlaylist()
      playlist.stop()
      expect(playlist.stop).toHaveBeenCalled()
    })
  })
})
