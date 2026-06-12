/**
 * SoundDevice.ts — 音频引擎接口定义（ISoundEngine / ISound / ISoundSource）
 * OpenRA 对照: OpenRA.Game/Sound/SoundDevice.cs (46 lines)
 *
 * 核心范式转换:
 * - C# OpenAL ISoundEngine → Howler.js / Web Audio API 适配层
 * - C# AL.ListenerPosition → Howler.pos(x, y, z) 或 AudioListener 位置
 * - C# AL.Source (ISound) → Howl 实例 + soundId
 * - C# AL.Buffer (ISoundSource) → Howl 实例（内置解码）
 * - C# SoundDevice record → TypeScript interface
 * - C# byte[] PCM data → ArrayBuffer（浏览器原生）
 * - C# DISPOSABLE 模式 → dispose() 方法（释放 AudioContext/Howl 实例）
 */

import type { WPos } from '../WPos.js'

// ---------------------------------------------------------------------------
// SoundDevice
// OpenRA 对照: SoundDevice record (string Device, string Label)
// ---------------------------------------------------------------------------

/** 音频输出设备描述符。
 *
 * OpenRA 对照: SoundDevice record
 *
 * 浏览器环境限制：大多数浏览器仅返回默认设备。
 * 通过 `navigator.mediaDevices.enumerateDevices()` 可获取更多设备信息。
 */
export interface SoundDevice {
  /** 设备标识符。
   *
   * OpenRA 对照: SoundDevice.Device
   */
  readonly device: string

  /** 人类可读的设备标签。
   *
   * OpenRA 对照: SoundDevice.Label
   */
  readonly label: string
}

// ---------------------------------------------------------------------------
// ISoundSource
// OpenRA 对照: ISoundSource : IDisposable (marker interface)
// ---------------------------------------------------------------------------

/** 已加载的音频源，可供播放。
 *
 * OpenRA 对照: ISoundSource
 *
 * 实现为 Howl 实例的包装器，封装了解码后的音频数据和播放参数。
 * 每个 ISoundSource 可被多次播放（通过 play2D 创建多个 ISound 实例）。
 */
export interface ISoundSource {
  /** 释放音频资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   *
   * 对于 Howl 实现：调用 howl.unload() 释放内部 AudioBuffer。
   * 调用后此 ISoundSource 不应再使用。
   */
  dispose(): void
}

// ---------------------------------------------------------------------------
// ISound
// OpenRA 对照: ISound interface
// ---------------------------------------------------------------------------

/** 正在播放的音频实例。
 *
 * OpenRA 对照: ISound
 *
 * 每个 ISound 代表一个活跃的播放实例（= Howl 的一个 soundId）。
 * 同一 ISoundSource 可同时产生多个 ISound（重叠播放）。
 */
export interface ISound {
  /** 音量（0.0-1.0）。
   *
   * OpenRA 对照: ISound.Volume
   */
  volume: number

  /** 当前播放位置（秒）。
   *
   * OpenRA 对照: ISound.SeekPosition
   *
   * 用于音乐/视频进度查询。Howler.js 通过 `howl.seek(soundId)` 获取。
   */
  readonly seekPosition: number

  /** 是否已播放完毕。
   *
   * OpenRA 对照: ISound.Complete
   *
   * 当 soundId 不再活跃或 Howl 已停止时返回 true。
   */
  readonly complete: boolean

  /** 设置 3D 空间位置。
   *
   * OpenRA 对照: ISound.SetPosition(WPos)
   *
   * @param pos — 世界坐标位置
   */
  setPosition(pos: WPos): void
}

// ---------------------------------------------------------------------------
// ISoundEngine
// OpenRA 对照: ISoundEngine : IDisposable
// ---------------------------------------------------------------------------

/** 音频引擎抽象接口。
 *
 * OpenRA 对照: ISoundEngine
 *
 * 封装底层音频 API（OpenAL → Howler.js / Web Audio API）。
 * 负责设备枚举、音频加载、2D/3D 播放、监听器位置管理。
 *
 * ## 浏览器注意事项
 * - AudioContext 在用户交互前处于 suspended 状态（自动播放策略）
 * - Howler.autoUnlock = true 可处理自动恢复
 * - 3D 空间音频使用 Howler.pos() + HRTF 空间化
 *
 * ## OpenRA 方法对照与省略说明
 * - `Play2DStream(Stream, ...)` → **有意省略**。OpenRA C# 通过流式 PCM 输入
 *   实现音乐/视频播放（AUD/VOC/WAV 解码为原始 PCM）。浏览器环境下，
 *   Howler.js / Web Audio API 原生支持所有主流音频格式的流式解码（WebM,
 *   MP3, OGG, WAV），无需手动 PCM 流式传输。流式播放通过 Howl 构造函数
 *   的 URL 参数或 `addSoundSourceFromMemory()` 的 Blob URL 自动处理。
 *
 * @todo TODO-7.D.5: WebAudioEngine 实现类 —— 基于 Howler.js 的 ISoundEngine
 *   具体实现。封装 Howler 全局实例、AudioContext 生命周期管理、
 *   WPos → Howler 坐标转换（Y-up → Z-forward）、距离衰减模型配置。
 *   当前阶段：ISoundEngine 作为接口单独存在，Sound 类的 mock 实现用于测试。
 */
export interface ISoundEngine {
  /** 枚举可用音频输出设备。
   *
   * OpenRA 对照: ISoundEngine.AvailableDevices()
   *
   * @returns 可用设备列表（浏览器通常仅返回默认设备）
   */
  availableDevices(): SoundDevice[]

  /** 从内存数据创建音频源。
   *
   * OpenRA 对照: ISoundEngine.AddSoundSourceFromMemory(byte[], int, int, int)
   *
   * @param data — PCM 或编码音频数据（WAV/WebM/MP3）
   * @param channels — 声道数（1=单声道，2=立体声）
   * @param sampleBits — 采样位深（8/16/32）
   * @param sampleRate — 采样率（Hz，如 22050/44100/48000）
   * @returns 可播放的音频源
   */
  addSoundSourceFromMemory(
    data: ArrayBuffer,
    channels: number,
    sampleBits: number,
    sampleRate: number,
  ): ISoundSource

  /** 播放音频（2D 无空间化 或 3D 空间化）。
   *
   * OpenRA 对照: ISoundEngine.Play2D(ISoundSource, bool loop, bool relative, WPos pos, float volume, bool attenuateVolume)
   *
   * @param sound — 要播放的音频源
   * @param loop — 是否循环播放
   * @param relative — true=2D 无空间定位（UI 音效），false=3D 空间定位（世界音效）
   * @param pos — 世界坐标位置（relative=true 时忽略）
   * @param volume — 音量（0.0-1.0）
   * @param attenuateVolume — 是否启用距离衰减（3D 空间化）
   * @returns 播放实例，失败返回 null
   */
  play2D(
    sound: ISoundSource,
    loop: boolean,
    relative: boolean,
    pos: WPos,
    volume: number,
    attenuateVolume: boolean,
  ): ISound | null

  /** 是否为虚拟引擎（无真实音频输出）。
   *
   * OpenRA 对照: ISoundEngine.Dummy
   *
   * 当 AudioContext 不可用或配置为静默模式时返回 true。
   * Dummy 引擎的所有播放操作均为空操作。
   */
  readonly dummy: boolean

  /** 主音量（0.0-1.0）。
   *
   * OpenRA 对照: ISoundEngine.Volume
   *
   * 同时影响所有正在播放和未来播放的音频。
   * 设置为 0 等同于静音（但不停止音频处理）。
   */
  volume: number

  /** 暂停/恢复单个音频。
   *
   * OpenRA 对照: ISoundEngine.PauseSound(ISound, bool)
   *
   * @param sound — 目标音频实例
   * @param paused — true=暂停，false=恢复
   */
  pauseSound(sound: ISound, paused: boolean): void

  /** 停止单个音频并释放其资源。
   *
   * OpenRA 对照: ISoundEngine.StopSound(ISound)
   *
   * @param sound — 目标音频实例
   */
  stopSound(sound: ISound): void

  /** 暂停/恢复所有音频。
   *
   * OpenRA 对照: ISoundEngine.SetAllSoundsPaused(bool)
   *
   * @param paused — true=全部暂停，false=全部恢复
   */
  setAllSoundsPaused(paused: boolean): void

  /** 停止所有音频。
   *
   * OpenRA 对照: ISoundEngine.StopAllSounds()
   */
  stopAllSounds(): void

  /** 设置监听器位置（用于 3D 空间音频）。
   *
   * OpenRA 对照: ISoundEngine.SetListenerPosition(WPos)
   *
   * 对应相机/玩家的世界位置。每帧调用一次以更新 3D 音频空间化。
   * 映射关系：WPos → Howler.pos(x, y, z)
   *
   * @param position — 监听器世界坐标
   */
  setListenerPosition(position: WPos): void

  /** 设置音频音量（批量更新 music + video）。
   *
   * OpenRA 对照: ISoundEngine.SetSoundVolume(float, ISound, ISound)
   *
   * @param volume — 新的音效音量
   * @param music — 当前音乐实例（可为 null）
   * @param video — 当前视频实例（可为 null）
   */
  setSoundVolume(volume: number, music: ISound | null, video: ISound | null): void

  /** 设置音频循环状态。
   *
   * OpenRA 对照: ISoundEngine.SetSoundLooping(bool, ISound)
   *
   * @param looping — 是否循环
   * @param sound — 目标音频实例
   */
  setSoundLooping(looping: boolean, sound: ISound): void

  /** 设置音频的 3D 空间位置。
   *
   * OpenRA 对照: ISoundEngine.SetSoundPosition(ISound, WPos)
   *
   * @param sound — 目标音频实例
   * @param position — 新的世界坐标位置
   */
  setSoundPosition(sound: ISound, position: WPos): void

  /** 释放所有音频资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   *
   * 停止所有音频，释放 AudioContext，卸载所有 Howl 实例。
   */
  dispose(): void
}
