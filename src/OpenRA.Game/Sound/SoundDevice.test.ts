/**
 * SoundDevice.test.ts — ISoundEngine / ISound / ISoundSource 接口实现验证
 *
 * 由于 happy-dom 不支持 WebGL 或 Web Audio，
 * 所有依赖接口均通过模拟实现测试。
 * 测试重点：接口契约验证、mock 实现正确性。
 */

import { describe, it, expect } from 'vitest'
import { WPos } from '../WPos.js'
import type {
  ISound,
  ISoundEngine,
  ISoundSource,
  SoundDevice,
} from './SoundDevice.js'

// ---------------------------------------------------------------------------
// Mock WPos.Zero
// ---------------------------------------------------------------------------

const Zero = new WPos(0, 0, 0)

// ---------------------------------------------------------------------------
// Mock ISound 实现
// ---------------------------------------------------------------------------

class MockSound implements ISound {
  volume = 1.0
  seekPosition = 0
  complete = false
  private _pos = Zero

  setPosition(pos: WPos): void {
    this._pos = pos
  }

  get position(): WPos {
    return this._pos
  }
}

// ---------------------------------------------------------------------------
// Mock ISoundSource 实现
// ---------------------------------------------------------------------------

class MockSoundSource implements ISoundSource {
  disposed = false

  dispose(): void {
    this.disposed = true
  }
}

// ---------------------------------------------------------------------------
// Mock ISoundEngine 实现
// ---------------------------------------------------------------------------

class MockSoundEngine implements ISoundEngine {
  volume = 1.0
  dummy = false
  disposed = false
  allSoundsPaused = false

  // 追踪方法调用
  readonly play2DCalls: Array<{
    sound: ISoundSource
    loop: boolean
    relative: boolean
    pos: WPos
    volume: number
    attenuateVolume: boolean
  }> = []

  readonly stopSoundCalls: ISound[] = []
  readonly pauseSoundCalls: Array<{ sound: ISound; paused: boolean }> = []
  readonly listenerPositions: WPos[] = []
  readonly soundPositions: Array<{ sound: ISound; position: WPos }> = []
  readonly volumeSettings: Array<{ volume: number; music: ISound | null; video: ISound | null }> = []
  readonly loopingSettings: Array<{ looping: boolean; sound: ISound }> = []
  readonly addedSources: Array<{
    data: ArrayBuffer
    channels: number
    sampleBits: number
    sampleRate: number
  }> = []

  // 控制 play2D 的返回值
  nextSoundResult: ISound | null = null

  availableDevices(): SoundDevice[] {
    return [{ device: 'default', label: 'Default Device' }]
  }

  addSoundSourceFromMemory(
    data: ArrayBuffer,
    channels: number,
    sampleBits: number,
    sampleRate: number,
  ): ISoundSource {
    this.addedSources.push({ data, channels, sampleBits, sampleRate })
    return new MockSoundSource()
  }

  play2D(
    sound: ISoundSource,
    loop: boolean,
    relative: boolean,
    pos: WPos,
    volume: number,
    attenuateVolume: boolean,
  ): ISound | null {
    this.play2DCalls.push({ sound, loop, relative, pos, volume, attenuateVolume })
    return this.nextSoundResult
  }

  pauseSound(sound: ISound, paused: boolean): void {
    this.pauseSoundCalls.push({ sound, paused })
  }

  stopSound(sound: ISound): void {
    this.stopSoundCalls.push(sound)
  }

  setAllSoundsPaused(paused: boolean): void {
    this.allSoundsPaused = paused
  }

  stopAllSounds(): void {
    // tracked via stopSoundCalls for verification
  }

  setListenerPosition(position: WPos): void {
    this.listenerPositions.push(position)
  }

  setSoundVolume(volume: number, music: ISound | null, video: ISound | null): void {
    this.volumeSettings.push({ volume, music, video })
  }

  setSoundLooping(looping: boolean, sound: ISound): void {
    this.loopingSettings.push({ looping, sound })
  }

  setSoundPosition(sound: ISound, position: WPos): void {
    this.soundPositions.push({ sound, position })
  }

  dispose(): void {
    this.disposed = true
  }
}

// ---------------------------------------------------------------------------
// SoundDevice 接口测试
// ---------------------------------------------------------------------------

describe('SoundDevice', () => {
  it('should have device and label properties', () => {
    const device: SoundDevice = { device: 'default', label: 'Speakers' }
    expect(device.device).toBe('default')
    expect(device.label).toBe('Speakers')
  })
})

// ---------------------------------------------------------------------------
// ISoundSource 测试
// ---------------------------------------------------------------------------

describe('ISoundSource', () => {
  it('should call dispose and mark as disposed', () => {
    const source = new MockSoundSource()
    expect(source.disposed).toBe(false)
    source.dispose()
    expect(source.disposed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ISound 测试
// ---------------------------------------------------------------------------

describe('ISound', () => {
  it('should have volume, seekPosition, complete properties', () => {
    const sound = new MockSound()
    expect(sound.volume).toBe(1.0)
    expect(sound.seekPosition).toBe(0)
    expect(sound.complete).toBe(false)
  })

  it('setPosition should update position', () => {
    const sound = new MockSound()
    const newPos = new WPos(100, 200, 50)
    sound.setPosition(newPos)
    expect(sound.position).toBe(newPos)
  })

  it('should allow modifying volume', () => {
    const sound = new MockSound()
    sound.volume = 0.5
    expect(sound.volume).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// ISoundEngine 测试
// ---------------------------------------------------------------------------

describe('ISoundEngine', () => {
  let engine: MockSoundEngine

  beforeEach(() => {
    engine = new MockSoundEngine()
  })

  it('availableDevices should return default device', () => {
    const devices = engine.availableDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0].device).toBe('default')
  })

  it('addSoundSourceFromMemory should create source and track params', () => {
    const data = new ArrayBuffer(16)
    const source = engine.addSoundSourceFromMemory(data, 2, 16, 44100)
    expect(source).toBeDefined()
    expect(engine.addedSources).toHaveLength(1)
    expect(engine.addedSources[0].channels).toBe(2)
    expect(engine.addedSources[0].sampleBits).toBe(16)
    expect(engine.addedSources[0].sampleRate).toBe(44100)
  })

  it('play2D should track calls with correct parameters', () => {
    const source = new MockSoundSource()
    engine.nextSoundResult = new MockSound()
    const sound = engine.play2D(source, true, false, Zero, 0.8, true)
    expect(sound).toBeDefined()
    expect(engine.play2DCalls).toHaveLength(1)
    expect(engine.play2DCalls[0].loop).toBe(true)
    expect(engine.play2DCalls[0].relative).toBe(false)
    expect(engine.play2DCalls[0].volume).toBe(0.8)
    expect(engine.play2DCalls[0].attenuateVolume).toBe(true)
  })

  it('play2D should return null when nextSoundResult is null', () => {
    const source = new MockSoundSource()
    engine.nextSoundResult = null
    const sound = engine.play2D(source, false, true, Zero, 1.0, false)
    expect(sound).toBeNull()
  })

  it('dummy should default to false', () => {
    expect(engine.dummy).toBe(false)
  })

  it('volume should be settable', () => {
    engine.volume = 0.5
    expect(engine.volume).toBe(0.5)
  })

  it('pauseSound should track paused state', () => {
    const sound = new MockSound()
    engine.pauseSound(sound, true)
    expect(engine.pauseSoundCalls).toHaveLength(1)
    expect(engine.pauseSoundCalls[0].paused).toBe(true)
  })

  it('stopSound should track stopped sound', () => {
    const sound = new MockSound()
    engine.stopSound(sound)
    expect(engine.stopSoundCalls).toHaveLength(1)
  })

  it('setAllSoundsPaused should update state', () => {
    engine.setAllSoundsPaused(true)
    expect(engine.allSoundsPaused).toBe(true)
    engine.setAllSoundsPaused(false)
    expect(engine.allSoundsPaused).toBe(false)
  })

  it('setListenerPosition should track positions', () => {
    const pos = new WPos(10, 20, 30)
    engine.setListenerPosition(pos)
    expect(engine.listenerPositions).toHaveLength(1)
    expect(engine.listenerPositions[0]).toBe(pos)
  })

  it('setSoundVolume should track volume settings', () => {
    const music = new MockSound()
    const video = new MockSound()
    engine.setSoundVolume(0.7, music, video)
    expect(engine.volumeSettings).toHaveLength(1)
    expect(engine.volumeSettings[0].volume).toBe(0.7)
    expect(engine.volumeSettings[0].music).toBe(music)
    expect(engine.volumeSettings[0].video).toBe(video)
  })

  it('setSoundVolume should accept null music/video', () => {
    engine.setSoundVolume(0.5, null, null)
    expect(engine.volumeSettings[0].music).toBeNull()
    expect(engine.volumeSettings[0].video).toBeNull()
  })

  it('setSoundLooping should track looping settings', () => {
    const sound = new MockSound()
    engine.setSoundLooping(true, sound)
    expect(engine.loopingSettings).toHaveLength(1)
    expect(engine.loopingSettings[0].looping).toBe(true)
  })

  it('setSoundPosition should track position updates', () => {
    const sound = new MockSound()
    const pos = new WPos(50, 60, 70)
    engine.setSoundPosition(sound, pos)
    expect(engine.soundPositions).toHaveLength(1)
    expect(engine.soundPositions[0].position).toBe(pos)
  })

  it('dispose should mark as disposed', () => {
    engine.dispose()
    expect(engine.disposed).toBe(true)
  })

  it('stopAllSounds should be callable without error', () => {
    expect(() => engine.stopAllSounds()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// ISoundEngine 集成流程测试
// ---------------------------------------------------------------------------

describe('ISoundEngine integration flow', () => {
  it('full lifecycle: addSource → play → pause → stop → dispose', () => {
    const engine = new MockSoundEngine()

    // Add source
    const data = new ArrayBuffer(32)
    const source = engine.addSoundSourceFromMemory(data, 1, 8, 22050)
    expect(source).toBeDefined()
    expect(engine.addedSources).toHaveLength(1)

    // Play
    engine.nextSoundResult = new MockSound()
    const sound = engine.play2D(source, false, true, Zero, 1.0, false)
    expect(sound).toBeDefined()
    expect(engine.play2DCalls).toHaveLength(1)

    // Pause
    engine.pauseSound(sound!, true)
    expect(engine.pauseSoundCalls[0].paused).toBe(true)

    // Stop
    engine.stopSound(sound!)
    expect(engine.stopSoundCalls).toHaveLength(1)

    // Dispose
    engine.dispose()
    expect(engine.disposed).toBe(true)
  })

  it('setListenerPosition should track multiple calls', () => {
    const engine = new MockSoundEngine()
    engine.setListenerPosition(new WPos(0, 0, 0))
    engine.setListenerPosition(new WPos(100, 0, 0))
    engine.setListenerPosition(new WPos(200, 0, 0))
    expect(engine.listenerPositions).toHaveLength(3)
  })
})
