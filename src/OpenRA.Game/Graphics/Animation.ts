/**
 * Animation.ts — OpenRA 精灵动画系统到 TypeScript 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/Animation.cs
 *
 * 核心范式转换:
 * - Tick-based 计时（非时间-based）→ 精确复制 OpenRA 的 timeUntilNextFrame 递减逻辑
 * - Action tickFunc 委托 → TypeScript 闭包/箭头函数
 * - Func<WAngle> facingFunc → () => number 回调
 * - Func<bool> paused → () => boolean 回调
 * - World/Map/SequenceSet 依赖 → 最小化接口抽象
 * - ISpriteSequence → 接口（OpenRA 完全迁移前的前向声明）
 *
 * 6 种播放模式（与 OpenRA 完全一致）:
 *   1. PlayRepeating:   正向循环（帧递增，到末尾归零）
 *   2. PlayThen:        正向播放一次，结束时调用 after 回调
 *   3. PlayBackwardsThen: 反向播放一次（backwards=true + PlayThen）
 *   4. PlayFetchIndex:  tickAlways=true，每 tick 调用 func 获取帧索引
 *   5. PlayFetchDirection: 根据方向回调前进/后退
 *   6. ReplaceAnim:     切换到新序列，保持当前帧位置（取模）
 *
 * Tick 计时:
 *   - tickAlways=true: 每 Tick() 直接调用 tickFunc（用于外部帧控制）
 *   - tickAlways=false: 累积 timeUntilNextFrame，到达 0 时调用 tickFunc
 *   - 默认帧间隔: DefaultTick=40ms（25 fps）
 *   - Tick(): 调用 Tick(40)
 */

import type { Sprite } from './Sprite'

// ---------------------------------------------------------------------------
// 最小化依赖接口（完整迁移前的前向声明）
//
// 这些接口捕获 OpenRA 的 World、Map、SequenceSet 和 ISpriteSequence
// 中 Animation 所需的全部成员。完整迁移将在后续阶段实现。
// ---------------------------------------------------------------------------

/** 面对方向角（WAngle，0-1023 表示 0-360 度） */
export type WAngle = number

/** 屏幕空间 2D 整数坐标 */
export interface Int2 { x: number; y: number }

/** 屏幕空间 2D 矩形 */
export interface Rectangle {
  x: number; y: number; width: number; height: number
}

/** 调色板引用前向声明 */
export interface IPaletteRef {
  readonly name: string
  readonly textureIndex: number
  readonly hasColorShift: boolean
}

/** 可渲染对象前向声明（迁移自 IRenderable） */
export interface IRenderable {
  readonly pos: any   // WPos
  readonly zOffset: number
}

/** 世界渲染器前向声明 */
export interface IWorldRenderer {
  screenPxPosition(pos: any): Int2
  screenPxOffset(offset: any): Int2
  screenVectorComponents(offset: any): { x: number; y: number; z: number }
}

/** 精灵序列接口 */
export interface ISpriteSequence {
  readonly name: string
  readonly length: number
  readonly tick: number
  readonly scale: number
  readonly zOffset: number
  readonly shadowZOffset: number
  readonly ignoreWorldTint: boolean
  readonly bounds: Rectangle
  getSprite(frame: number, facing: WAngle): Sprite
  getSpriteWithRotation(frame: number, facing: WAngle): { sprite: Sprite; rotation: number }
  getAlpha(frame: number): number
  getShadow(frame: number, facing: WAngle): Sprite | null
}

/** 序列集接口 */
export interface ISequenceSet {
  hasSequence(actorName: string, sequenceName: string): boolean
  getSequence(actorName: string, sequenceName: string): ISpriteSequence
}

// ---------------------------------------------------------------------------
// 默认帧间隔常量
//
// 对应 OpenRA: const int DefaultTick = 40; // 25 fps == 40 ms
// ---------------------------------------------------------------------------

const DEFAULT_TICK_MS = 40

// ---------------------------------------------------------------------------
// Animation 类
//
// 对应 OpenRA class Animation (Animation.cs:20-258)
// ---------------------------------------------------------------------------

export class Animation {
  // -----------------------------------------------------------------------
  // 公共属性（与 OpenRA 完全一致）
  // -----------------------------------------------------------------------

  /** 当前播放序列 */
  currentSequence: ISpriteSequence | null = null

  /** 动画名称（对应精灵序列集中的 Actor 名称） */
  name: string

  /** 是否为装饰（装饰物不受某些游戏规则影响） */
  isDecoration = false

  // -----------------------------------------------------------------------
  // 内部状态
  // -----------------------------------------------------------------------

  /** 当前帧索引 */
  private _frame = 0

  /** 是否反向播放 */
  private _backwards = false

  /** 是否每 Tick 都执行 tickFunc（而非累积时间） */
  private _tickAlways = false

  /** 距离下一帧的剩余时间（毫秒） */
  private _timeUntilNextFrame = 0

  /** 每 Tick 调用的帧更新函数 */
  private _tickFunc: (() => void) | null = null

  /** 面对方向回调 */
  private readonly _facingFunc: () => WAngle

  /** 暂停回调 */
  private readonly _paused: (() => boolean) | null

  /** 序列集引用 */
  private readonly _sequences: ISequenceSet

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA 四个构造重载）
  //
  // OpenRA 对照:
  //   Animation(World world, string name, Func<WAngle> facingFunc, Func<bool> paused)
  // -----------------------------------------------------------------------

  /**
   * 构造 Animation。
   *
   * OpenRA 对照: Animation(World world, string name, Func<WAngle> facingFunc, Func<bool> paused)
   *
   * @param sequences — 序列集（对应 World.Map.Sequences）
   * @param name — 动画名称（对应 Actor 名称，用于序列查找）
   * @param facingFunc — 面对方向回调（默认 0 = 北向）
   * @param paused — 暂停检查回调（null = 永不停）
   */
  constructor(
    sequences: ISequenceSet,
    name: string,
    facingFunc: () => WAngle = () => 0,
    paused: (() => boolean) | null = null,
  ) {
    this._sequences = sequences
    this.name = name.toLowerCase()
    this._facingFunc = facingFunc
    this._paused = paused
  }

  // -----------------------------------------------------------------------
  // CurrentFrame（计算属性，对应 OpenRA Animation.CurrentFrame）
  //
  // OpenRA 对照:
  //   public int CurrentFrame => backwards ? CurrentSequence.Length - frame - 1 : frame;
  // -----------------------------------------------------------------------

  /**
   * 获取当前帧索引（反向播放时从末尾计算）。
   *
   * OpenRA 对照: Animation.CurrentFrame
   */
  get currentFrame(): number {
    if (!this.currentSequence) return 0
    return this._backwards
      ? this.currentSequence.length - this._frame - 1
      : this._frame
  }

  // -----------------------------------------------------------------------
  // Image（对应 OpenRA Animation.Image）
  //
  // OpenRA 对照:
  //   public Sprite Image => CurrentSequence.GetSprite(CurrentFrame, facingFunc());
  // -----------------------------------------------------------------------

  /**
   * 获取当前帧的精灵。
   *
   * OpenRA 对照: Animation.Image
   */
  get image(): Sprite | null {
    if (!this.currentSequence) return null
    return this.currentSequence.getSprite(this.currentFrame, this._facingFunc())
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  /**
   * 获取当前序列的帧间隔（或默认值）。
   *
   * 对应 OpenRA CurrentSequenceTickOrDefault()
   *
   * @returns 帧间隔（毫秒），默认 40ms
   */
  private _currentSequenceTick(): number {
    return this.currentSequence?.tick ?? DEFAULT_TICK_MS
  }

  /**
   * 设置当前序列并重置帧计时。
   *
   * 对应 OpenRA PlaySequence(string sequenceName)
   */
  private _playSequence(sequenceName: string): void {
    this.currentSequence = this._sequences.getSequence(this.name, sequenceName)
    this._timeUntilNextFrame = this._currentSequenceTick()
  }

  // -----------------------------------------------------------------------
  // 播放模式 1: PlayRepeating — 正向循环播放
  //
  // OpenRA 对照: Animation.PlayRepeating (Animation.cs:136-149)
  // -----------------------------------------------------------------------

  /**
   * 正向循环播放序列。
   *
   * OpenRA 对照: PlayRepeating(string sequenceName)
   *
   * 帧递增到末尾后归零，无限循环。
   *
   * @param sequenceName — 序列名称
   */
  playRepeating(sequenceName: string): void {
    this._backwards = false
    this._tickAlways = false
    this._playSequence(sequenceName)

    this._frame = 0
    this._tickFunc = () => {
      ++this._frame
      if (this._frame >= this.currentSequence!.length) {
        this._frame = 0
      }
    }
  }

  // -----------------------------------------------------------------------
  // 播放模式 2: PlayThen — 正向播放一次，结束时回调
  //
  // OpenRA 对照: Animation.PlayThen (Animation.cs:162-179)
  // -----------------------------------------------------------------------

  /**
   * 正向播放序列一次，结束时调用回调。
   *
   * OpenRA 对照: PlayThen(string sequenceName, Action after)
   *
   * 帧递增到末尾后停在最后一帧，调用 after 回调并清除 tickFunc。
   *
   * @param sequenceName — 序列名称
   * @param after — 播放完毕回调（可选）
   */
  playThen(sequenceName: string, after?: () => void): void {
    this._backwards = false
    this._tickAlways = false
    this._playSequence(sequenceName)

    this._frame = 0
    this._tickFunc = () => {
      ++this._frame
      if (this._frame >= this.currentSequence!.length) {
        this._frame = this.currentSequence!.length - 1
        this._tickFunc = null
        after?.()
      }
    }
  }

  // -----------------------------------------------------------------------
  // 播放模式 3: PlayBackwardsThen — 反向播放一次
  //
  // OpenRA 对照: Animation.PlayBackwardsThen (Animation.cs:181-185)
  // -----------------------------------------------------------------------

  /**
   * 反向播放序列一次，结束时调用回调。
   *
   * OpenRA 对照: PlayBackwardsThen(string sequenceName, Action after)
   *
   * 委托给 PlayThen 并将 backwards 设为 true。
   *
   * @param sequenceName — 序列名称
   * @param after — 播放完毕回调（可选）
   */
  playBackwardsThen(sequenceName: string, after?: () => void): void {
    this.playThen(sequenceName, after)
    this._backwards = true
  }

  // -----------------------------------------------------------------------
  // 播放模式 4: PlayFetchIndex — 外部帧控制
  //
  // OpenRA 对照: Animation.PlayFetchIndex (Animation.cs:187-195)
  // -----------------------------------------------------------------------

  /**
   * 从外部函数获取帧索引（每 tick 调用，不等时间累积）。
   *
   * OpenRA 对照: PlayFetchIndex(string sequenceName, Func<int> func)
   *
   * tickAlways = true: 每次 Tick() 都调用 func 获取当前帧索引。
   * 用于需要外部精确控制帧位置的场景（如构建进度条）。
   *
   * @param sequenceName — 序列名称
   * @param func — 帧索引获取函数
   */
  playFetchIndex(sequenceName: string, func: () => number): void {
    this._backwards = false
    this._tickAlways = true
    this._playSequence(sequenceName)

    this._frame = func()
    this._tickFunc = () => {
      this._frame = func()
    }
  }

  // -----------------------------------------------------------------------
  // 播放模式 5: PlayFetchDirection — 方向控制播放
  //
  // OpenRA 对照: Animation.PlayFetchDirection (Animation.cs:197-212)
  // -----------------------------------------------------------------------

  /**
   * 根据方向回调控制播放方向。
   *
   * OpenRA 对照: PlayFetchDirection(string sequenceName, Func<int> direction)
   *
   * direction() > 0: 正向播放（帧递增，末尾归零）
   * direction() < 0: 反向播放（帧递减，零归末尾）
   * direction() == 0: 保持不变
   *
   * @param sequenceName — 序列名称
   * @param direction — 方向获取函数（返回 -1/0/1）
   */
  playFetchDirection(sequenceName: string, direction: () => number): void {
    this._tickAlways = false
    this._playSequence(sequenceName)

    this._frame = 0
    this._tickFunc = () => {
      const d = direction()
      if (d > 0 && ++this._frame >= this.currentSequence!.length) {
        this._frame = 0
      }
      if (d < 0 && --this._frame < 0) {
        this._frame = this.currentSequence!.length - 1
      }
    }
  }

  // -----------------------------------------------------------------------
  // 播放模式 6: ReplaceAnim — 替换序列保帧位置
  //
  // OpenRA 对照: Animation.ReplaceAnim (Animation.cs:151-160)
  // -----------------------------------------------------------------------

  /**
   * 替换当前序列，保持帧位置（取模适配新序列长度）。
   *
   * OpenRA 对照: ReplaceAnim(string sequenceName)
   *
   * 用途：单位切换武器时保持行走动画的相对帧位置。
   *
   * @param sequenceName — 新序列名称
   * @returns true 如果序列存在并成功替换，false 如果序列不存在
   */
  replaceAnim(sequenceName: string): boolean {
    if (!this.hasSequence(sequenceName)) return false

    this.currentSequence = this._sequences.getSequence(this.name, sequenceName)
    this._timeUntilNextFrame = Math.min(
      this._currentSequenceTick(),
      this._timeUntilNextFrame,
    )
    this._frame %= this.currentSequence.length
    return true
  }

  // -----------------------------------------------------------------------
  // Tick（对应 OpenRA Animation.Tick / Tick(int t)）
  //
  // OpenRA 对照:
  //   public void Tick() — 检查暂停，调用 Tick(40)
  //   public void Tick(int t) — 递减 timeUntilNextFrame，触发 tickFunc
  // -----------------------------------------------------------------------

  /**
   * 推进一帧（40ms）。
   *
   * OpenRA 对照: Animation.Tick()
   *
   * 若暂停则跳过。否则调用 Tick(40)。
   */
  tick(): void {
    if (this._paused === null || !this._paused()) {
      this.tickMs(DEFAULT_TICK_MS)
    }
  }

  /**
   * 推进指定毫秒。
   *
   * OpenRA 对照: Animation.Tick(int t)
   *
   * tickAlways=true: 直接调用 tickFunc（每 tick 一帧）
   * tickAlways=false: 累积 timeUntilNextFrame，到达 0 时触发 tickFunc
   *
   * @param t — 经过的毫秒数
   */
  tickMs(t: number): void {
    if (this._tickAlways) {
      this._tickFunc?.()
    } else {
      this._timeUntilNextFrame -= t
      while (this._timeUntilNextFrame <= 0) {
        this._tickFunc?.()
        this._timeUntilNextFrame += this._currentSequenceTick()
      }
    }
  }

  // -----------------------------------------------------------------------
  // ChangeImage（对应 OpenRA Animation.ChangeImage）
  //
  // OpenRA 对照: Animation.ChangeImage (Animation.cs:235-245)
  // -----------------------------------------------------------------------

  /**
   * 更改动画图像（精灵集 Actor 名称）。
   *
   * OpenRA 对照: ChangeImage(string newImage, string newAnimIfMissing)
   *
   * 若新名称与当前不同则切换。尝试保持当前序列名称；
   * 若新精灵集不存在当前序列名，尝试替换为 newAnimIfMissing。
   *
   * @param newImage — 新精灵集名称
   * @param newAnimIfMissing — 若当前序列在新精灵集中不存在，尝试此序列
   */
  changeImage(newImage: string, newAnimIfMissing: string): void {
    newImage = newImage.toLowerCase()

    if (this.name !== newImage) {
      this.name = newImage
      if (!this.replaceAnim(this.currentSequence!.name)) {
        this.replaceAnim(newAnimIfMissing)
      }
    }
  }

  // -----------------------------------------------------------------------
  // HasSequence（对应 OpenRA Animation.HasSequence）
  //
  // OpenRA 对照:
  //   public bool HasSequence(string seq)
  //   { return sequences.HasSequence(Name, seq); }
  // -----------------------------------------------------------------------

  /**
   * 查询当前精灵集是否包含指定序列。
   *
   * @param seq — 序列名称
   * @returns true 如果序列存在
   */
  hasSequence(seq: string): boolean {
    return this._sequences.hasSequence(this.name, seq)
  }

  // -----------------------------------------------------------------------
  // GetSequence（对应 OpenRA Animation.GetSequence）
  //
  // OpenRA 对照:
  //   public ISpriteSequence GetSequence(string sequenceName)
  //   { return sequences.GetSequence(Name, sequenceName); }
  // -----------------------------------------------------------------------

  /**
   * 获取指定序列。
   *
   * @param sequenceName — 序列名称
   * @returns ISpriteSequence 实例
   */
  getSequence(sequenceName: string): ISpriteSequence {
    return this._sequences.getSequence(this.name, sequenceName)
  }

  // -----------------------------------------------------------------------
  // GetRandomExistingSequence（对应 OpenRA 同方法）
  //
  // OpenRA 对照:
  //   public string GetRandomExistingSequence(ImmutableArray<string> sequences,
  //     MersenneTwister random)
  // -----------------------------------------------------------------------

  /**
   * 从候选序列中随机选择一个存在的序列。
   *
   * OpenRA 对照: GetRandomExistingSequence(ImmutableArray<string>, MersenneTwister)
   *
   * @param candidateSequences — 候选序列名列表
   * @param random — 随机数生成函数（返回 [0, 1) 之间的值）
   * @returns 随机选中的序列名，若无可用序列返回空字符串
   */
  getRandomExistingSequence(
    candidateSequences: readonly string[],
    random: () => number,
  ): string {
    const available = candidateSequences.filter(s => this.hasSequence(s))
    if (available.length === 0) return ''
    const index = Math.floor(random() * available.length)
    return available[index]!
  }
}
