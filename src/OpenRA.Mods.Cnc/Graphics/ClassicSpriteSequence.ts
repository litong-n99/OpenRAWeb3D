/**
 * ClassicSpriteSequence.ts — 经典 C&C 精灵序列（第一代 Westwood 游戏的 32 方向非线性映射）
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ClassicSpriteSequence.cs (48 lines)
 *
 * 核心范式转换:
 * - C# DefaultSpriteSequence (base class) → TS ClassicSpriteSequence matching ISpriteSequence shape
 * - C# SpriteSequenceField<T> static field descriptors → TS config booleans
 * - C# Util.ClassicIndexFacing vs Common.Util.IndexFacing → TS classicIndexFacing function
 * - C# MiniYaml parse hierarchy → TS JSON config merging via mergeConfig helper
 *
 * 第一代 Westwood 游戏（TD, RA）的精灵有 32 个方向，但使用非线性映射。
 *
 * NOTE: Cannot explicitly `implements ISpriteSequence` because the Sprite type
 * is a concrete class requiring a real Sheet. Shape-compatible instead.
 */

import { classicIndexFacing } from '../Traits/ClassicFacingBodyOrientation.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { classicQuantizeFacing } from '../Traits/ClassicFacingBodyOrientation.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// Sequence loader configuration
// ---------------------------------------------------------------------------

export interface ClassicSpriteSequenceConfig {
  useClassicFacings?: boolean
  facings?: number
  length?: number
  tick?: number
  zOffset?: number
  scale?: number
  start?: number
  stride?: number
  shadowStart?: number
  transpose?: boolean
  reverseFacings?: boolean
  blendMode?: number
  ignoreWorldTint?: boolean
}

export function mergeConfig(
  data: ClassicSpriteSequenceConfig,
  defaults: ClassicSpriteSequenceConfig = {},
): ClassicSpriteSequenceConfig {
  return {
    useClassicFacings: data.useClassicFacings ?? defaults.useClassicFacings ?? false,
    facings: data.facings ?? defaults.facings ?? 1,
    length: data.length ?? defaults.length ?? 1,
    tick: data.tick ?? defaults.tick ?? 40,
    zOffset: data.zOffset ?? defaults.zOffset ?? 0,
    scale: data.scale ?? defaults.scale ?? 1,
    start: data.start ?? defaults.start ?? 0,
    stride: data.stride ?? defaults.stride,
    shadowStart: data.shadowStart ?? defaults.shadowStart ?? -1,
    transpose: data.transpose ?? defaults.transpose ?? false,
    reverseFacings: data.reverseFacings ?? defaults.reverseFacings ?? false,
    blendMode: data.blendMode ?? defaults.blendMode ?? 0,
    ignoreWorldTint: data.ignoreWorldTint ?? defaults.ignoreWorldTint ?? false,
  }
}

// ---------------------------------------------------------------------------
// ClassicSpriteSequence
// ---------------------------------------------------------------------------

export class ClassicSpriteSequence {
  readonly image: string
  private readonly _name: string
  readonly useClassicFacings: boolean
  readonly facings: number
  readonly length: number
  readonly tick: number
  readonly zOffset: number
  readonly shadowZOffset: number = -5
  readonly scale: number
  readonly ignoreWorldTint: boolean

  get bounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  private readonly _start: number
  private readonly _stride: number | undefined
  private readonly _shadowStart: number
  private readonly _transpose: boolean
  private readonly _reverseFacings: boolean
  private readonly _blendMode: number

  constructor(
    image: string,
    sequence: string,
    data: ClassicSpriteSequenceConfig,
    defaults: ClassicSpriteSequenceConfig = {},
  ) {
    const merged = mergeConfig(data, defaults)

    this.image = image
    this._name = sequence
    this.useClassicFacings = merged.useClassicFacings!
    this.facings = merged.facings!
    this.length = merged.length!
    this.tick = merged.tick!
    this.zOffset = merged.zOffset!
    this.scale = merged.scale!
    this.ignoreWorldTint = merged.ignoreWorldTint!
    this._start = merged.start!
    this._stride = merged.stride
    this._shadowStart = merged.shadowStart!
    this._transpose = merged.transpose!
    this._reverseFacings = merged.reverseFacings!
    this._blendMode = merged.blendMode!

    if (this.useClassicFacings && this.facings !== 32) {
      throw new Error(
        `Sequence ${image}.${sequence}: UseClassicFacings is only valid for 32 facings`,
      )
    }
  }

  get name(): string {
    return this._name
  }

  getFacingFrameOffset(facing: WAngle): number {
    if (this.useClassicFacings) {
      return classicIndexFacing(facing, this.facings)
    }
    return indexFacing(facing, this.facings)
  }

  getSprite(_frame: number, _facing: WAngle): Sprite {
    return {
      sheet: null as unknown as Sprite['sheet'],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      blendMode: this._blendMode as unknown as Sprite['blendMode'],
      channel: 4 as Sprite['channel'],
      zRamp: 0,
      size: { x: 0, y: 0, z: 0 },
      offset: { x: 0, y: 0, z: 0 },
      top: 0, left: 0, bottom: 1, right: 1,
    } as Sprite
  }

  getSpriteWithRotation(
    frame: number,
    facing: WAngle,
  ): { sprite: Sprite; rotation: number } {
    const quantizedFacing = classicQuantizeFacing(
      facing,
      this.facings > 0 ? this.facings : 1,
    )
    return {
      sprite: this.getSprite(frame, quantizedFacing),
      rotation: quantizedFacing.angle * Math.PI / 512,
    }
  }

  getAlpha(_frame: number): number { return 1 }

  getShadow(_frame: number, _facing: WAngle): Sprite | null {
    if (this._shadowStart < 0) return null
    return null
  }

  get config(): ClassicSpriteSequenceConfig {
    return {
      useClassicFacings: this.useClassicFacings,
      facings: this.facings,
      length: this.length,
      tick: this.tick,
      zOffset: this.zOffset,
      scale: this.scale,
      start: this._start,
      stride: this._stride,
      shadowStart: this._shadowStart,
      transpose: this._transpose,
      reverseFacings: this._reverseFacings,
      blendMode: this._blendMode,
      ignoreWorldTint: this.ignoreWorldTint,
    }
  }
}

// ---------------------------------------------------------------------------
// ClassicSpriteSequenceLoader
// ---------------------------------------------------------------------------

export class ClassicSpriteSequenceLoader {
  createSequence(
    image: string,
    sequence: string,
    data: ClassicSpriteSequenceConfig,
    defaults: ClassicSpriteSequenceConfig = {},
  ): ClassicSpriteSequence {
    return new ClassicSpriteSequence(image, sequence, data, defaults)
  }
}

// ---------------------------------------------------------------------------
// Standard linear facing index helper
// ---------------------------------------------------------------------------

function indexFacing(facing: WAngle, facings: number): number {
  const step = 1024 / facings
  const adjusted = ((facing.angle - step / 2 + 1024) % 1024)
  return Math.floor(adjusted / step) % facings
}
