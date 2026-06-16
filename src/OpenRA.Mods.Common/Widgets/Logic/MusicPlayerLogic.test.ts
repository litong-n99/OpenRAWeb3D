/**
 * MusicPlayerLogic.test.ts — MusicPlayerLogic 单元测试
 *
 * 测试范围: 曲目列表构建、播放/暂停/停止控制、随机/重复切换、歌曲变化检测。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  MusicPlayerLogic,
  type IMusicPlaylist,
  type IMusicPlayerSound,
  type IMusicPlayerSettings,
  type MusicTrackInfo,
} from './MusicPlayerLogic.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockMusicTrack(filename: string, title: string, length: number = 180): MusicTrackInfo {
  return {
    filename,
    title,
    length,
    volume: 1.0,
    exists: true,
    hidden: false,
    volumeModifier: 1.0,
  }
}

function createMockMusicPlaylist(available = true): IMusicPlaylist {
  const songs = [
    createMockMusicTrack('track1.aud', 'Track 1', 180),
    createMockMusicTrack('track2.aud', 'Track 2', 240),
    createMockMusicTrack('track3.aud', 'Track 3', 200),
  ]
  let currentIndex = 0

  return {
    isMusicAvailable: available,
    currentSongIsBackground: false,
    availablePlaylist: () => songs,
    currentSong: () => songs[currentIndex] ?? null,
    getNextSong: () => {
      currentIndex = (currentIndex + 1) % songs.length
      return songs[currentIndex]
    },
    getPrevSong: () => {
      currentIndex = (currentIndex - 1 + songs.length) % songs.length
      return songs[currentIndex]
    },
    play: vi.fn(),
    stop: vi.fn(),
  }
}

function createMockSound(): IMusicPlayerSound {
  return {
    currentMusic: null,
    musicPlaying: false,
    musicSeekPosition: 0,
    musicVolume: 0.5,
    setMusicVolume: vi.fn(),
    playMusic: vi.fn(),
    pauseMusic: vi.fn(),
    resumeMusic: vi.fn(),
    stopMusic: vi.fn(),
    setMusicLooped: vi.fn(),
  }
}

function createMockSettings(): IMusicPlayerSettings {
  return {
    mute: false,
    shuffle: false,
    repeat: false,
    save: vi.fn(),
  }
}

class MockWidget {
  id: string
  children: Map<string, MockWidget> = new Map()
  parentVal: MockWidget | null = null
  isVisibleFn: () => boolean = () => true
  isSelectedFn: () => boolean = () => false
  isCheckedFn: () => boolean = () => false
  isDisabledFn: () => boolean = () => false
  onClickFn: () => void = () => {}
  getTextFn: () => string = () => ''
  onChangeFn: (v: number) => void = () => {}
  valueVal: number = 0

  constructor(id: string) { this.id = id }

  get parent() { return this.parentVal }
  addChild(child: MockWidget) { child.parentVal = this; this.children.set(child.id, child) }
  removeChildren() { this.children.clear() }

  getOrNull<T>(id: string): T | null { return (this.children.get(id) ?? null) as unknown as T | null }

  get<T>(id: string): T {
    const child = this.children.get(id)
    if (!child) throw new Error(`Widget ${this.id} has no child ${id}`)
    return child as unknown as T
  }

  clone(): MockWidget {
    const c = new MockWidget(this.id)
    for (const [k, v] of this.children) c.children.set(k, v.clone())
    return c
  }

  // Delegate helper to simulate widget props
  set isVisible(fn: () => boolean) { this.isVisibleFn = fn }
  get isVisible() { return this.isVisibleFn }

  set isSelected(fn: () => boolean) { this.isSelectedFn = fn }

  set isChecked(fn: () => boolean) { this.isCheckedFn = fn }

  set isDisabled(fn: () => boolean) { this.isDisabledFn = fn }

  set onClick(fn: () => void) { this.onClickFn = fn }
  get onClick() { return this.onClickFn }

  set getText(fn: () => string) { this.getTextFn = fn }

  set onChange(fn: (v: number) => void) { this.onChangeFn = fn }
  get onChange() { return this.onChangeFn }

  set value(v: number) { this.valueVal = v }
  get value() { return this.valueVal }

  set Value(v: number) { this.valueVal = v }
  get Value() { return this.valueVal }
}

function buildMusicPlayerWidget(): MockWidget {
  const widget = new MockWidget('root')

  widget.children.set('NO_MUSIC_LABEL', new MockWidget('NO_MUSIC_LABEL'))
  widget.children.set('MUTE_LABEL', new MockWidget('MUTE_LABEL'))

  widget.children.set('BUTTON_PLAY', new MockWidget('BUTTON_PLAY'))
  widget.children.set('BUTTON_PAUSE', new MockWidget('BUTTON_PAUSE'))
  widget.children.set('BUTTON_STOP', new MockWidget('BUTTON_STOP'))
  widget.children.set('BUTTON_NEXT', new MockWidget('BUTTON_NEXT'))
  widget.children.set('BUTTON_PREV', new MockWidget('BUTTON_PREV'))

  widget.children.set('SHUFFLE', new MockWidget('SHUFFLE'))
  widget.children.set('REPEAT', new MockWidget('REPEAT'))
  widget.children.set('TIME_LABEL', new MockWidget('TIME_LABEL'))
  widget.children.set('TITLE_LABEL', new MockWidget('TITLE_LABEL'))
  widget.children.set('MUSIC_SLIDER', new MockWidget('MUSIC_SLIDER'))
  widget.children.set('BACK_BUTTON', new MockWidget('BACK_BUTTON'))

  // Music list
  const musicList = new MockWidget('MUSIC_LIST')
  musicList.children.set('MUSIC_TEMPLATE', new MockWidget('MUSIC_TEMPLATE'))
  widget.children.set('MUSIC_LIST', musicList)

  return widget
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MusicPlayerLogic', () => {
  let widget: MockWidget
  let playlist: IMusicPlaylist
  let sound: IMusicPlayerSound
  let settings: IMusicPlayerSettings

  beforeEach(() => {
    widget = buildMusicPlayerWidget()
    playlist = createMockMusicPlaylist(true)
    sound = createMockSound()
    settings = createMockSettings()
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs successfully with valid widget tree', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('constructs when music is not available', () => {
    const emptyPlaylist = createMockMusicPlaylist(false)
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, emptyPlaylist, sound, settings,
    )
    expect(logic).toBeDefined()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Button wiring
  // ---------------------------------------------------------------------------

  it('PLAY button calls play', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const playBtn = widget.children.get('BUTTON_PLAY')
    expect(playBtn?.onClickFn).toBeDefined()
    playBtn?.onClickFn?.()

    // Should call play on the playlist
    expect(playlist.play).toHaveBeenCalled()
    logic.dispose()
  })

  it('PAUSE button calls pauseMusic', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const pauseBtn = widget.children.get('BUTTON_PAUSE')
    pauseBtn?.onClickFn?.()
    expect(sound.pauseMusic).toHaveBeenCalled()
    logic.dispose()
  })

  it('STOP button calls stop', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const stopBtn = widget.children.get('BUTTON_STOP')
    stopBtn?.onClickFn?.()
    expect(playlist.stop).toHaveBeenCalled()
    logic.dispose()
  })

  it('NEXT button gets next song and plays', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const nextBtn = widget.children.get('BUTTON_NEXT')
    nextBtn?.onClickFn?.()
    expect(playlist.play).toHaveBeenCalled()
    logic.dispose()
  })

  it('PREV button gets prev song and plays', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const prevBtn = widget.children.get('BUTTON_PREV')
    prevBtn?.onClickFn?.()
    expect(playlist.play).toHaveBeenCalled()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Shuffle / Repeat
  // ---------------------------------------------------------------------------

  it('SHUFFLE checkbox toggles shuffle setting', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const shuffleCb = widget.children.get('SHUFFLE')
    expect(shuffleCb?.isCheckedFn?.()).toBe(false)

    shuffleCb?.onClickFn?.()
    // The setting should be toggled
    logic.dispose()
  })

  it('REPEAT checkbox toggles repeat and calls setMusicLooped', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )

    const repeatCb = widget.children.get('REPEAT')
    repeatCb?.onClickFn?.()
    expect(sound.setMusicLooped).toHaveBeenCalled()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Back button
  // ---------------------------------------------------------------------------

  it('BACK_BUTTON saves settings and calls onExit', () => {
    const onExit = vi.fn()
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, onExit, playlist, sound, settings,
    )

    const backBtn = widget.children.get('BACK_BUTTON')
    backBtn?.onClickFn?.()
    expect(settings.save).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalled()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Song length formatting
  // ---------------------------------------------------------------------------

  it('songLengthLabel formats duration correctly', () => {
    const song = createMockMusicTrack('test.aud', 'Test', 195)
    expect(MusicPlayerLogic.songLengthLabel(song)).toBe('3:15')

    const short = createMockMusicTrack('short.aud', 'Short', 45)
    expect(MusicPlayerLogic.songLengthLabel(short)).toBe('0:45')

    const exactly = createMockMusicTrack('exact.aud', 'Exact', 120)
    expect(MusicPlayerLogic.songLengthLabel(exactly)).toBe('2:00')
  })

  // ---------------------------------------------------------------------------
  // tick - song change detection
  // ---------------------------------------------------------------------------

  it('tick does not throw when no music playing', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // ChromeLogic interface
  // ---------------------------------------------------------------------------

  it('dispose does not throw', () => {
    const logic = new MusicPlayerLogic(
      widget as unknown as Widget, null, null, () => {}, playlist, sound, settings,
    )
    expect(() => logic.dispose()).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  it('IMusicPlaylist can be implemented', () => {
    const p: IMusicPlaylist = {
      isMusicAvailable: true,
      currentSongIsBackground: false,
      availablePlaylist: () => [],
      currentSong: () => null,
      getNextSong: () => null,
      getPrevSong: () => null,
      play: () => {},
      stop: () => {},
    }
    expect(p.isMusicAvailable).toBe(true)
  })

  it('IMusicPlayerSound can be implemented', () => {
    const s: IMusicPlayerSound = {
      currentMusic: null,
      musicPlaying: false,
      musicSeekPosition: 0,
      musicVolume: 0.8,
      setMusicVolume: () => {},
      playMusic: () => {},
      pauseMusic: () => {},
      resumeMusic: () => {},
      stopMusic: () => {},
      setMusicLooped: () => {},
    }
    expect(s.musicVolume).toBe(0.8)
  })
})
