/**
 * RenderSprites.ts — 基础精灵渲染特质
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/RenderSprites.cs
 *
 * 核心范式转换:
 * - C# IRender + ITick + INotifyOwnerChanged 接口实现 → TypeScript 直接 implements
 * - C# AnimationWrapper 内部类 → 私有类（相同包可见）
 * - C# IEnumerable<IRenderable> yield return → Generator 函数 / 数组收集
 * - C# FrozenDictionary<string, string> FactionImages → Record<string, string>
 * - C# self.World.ScreenMap.AddOrUpdate → WorldRenderer 等效更新
 * - C# PaletteReference → IPaletteRef (Animation.ts 定义)
 *
 * RenderSprites 是所有 With* 渲染特质的基座。它管理一个 AnimationWrapper
 * 列表，处理调色板刷新、属主变更和每 tick 动画更新。
 *
 * DamageState → 序列前缀映射（DamagePrefixes）:
 *   Critical → "critical-"
 *   Heavy    → "damaged-"
 *   Medium   → "scratched-"
 *   Light    → "scuffed-"
 *   Undamaged → （无前缀）
 */

import type { Animation } from '../../../OpenRA.Game/Graphics/Animation.js'
import {
  AnimationWithOffset,
  type IHasCenterPosition,
} from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import type {
  IRenderable,
  IPaletteRef,
  Rectangle,
  IWorldRenderer,
} from '../../../OpenRA.Game/Graphics/Animation.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type {
  IGameActor,
  ITick,
  IRender,
  INotifyOwnerChanged,
  INotifyEffectiveOwnerChanged,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { DamageState } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// 扩展 Actor/Player 接口（RenderSprites 所需成员）
// ---------------------------------------------------------------------------

/**
 * 供 RenderSprites 使用的 Player 接口（扩展 TraitsInterfaces.PlayerStub）。
 *
 * OpenRA 对照: Player.InternalName, Player.Faction.InternalName
 */
export interface IRenderPlayer extends PlayerStub {
  readonly InternalName: string
  readonly Faction?: { readonly InternalName: string }
}

/**
 * 供 RenderSprites 使用的 Actor 接口（扩展 IHasCenterPosition + IGameActor）。
 *
 * OpenRA 对照: Actor（具有 CenterPosition, Info, Owner, EffectiveOwner, World）
 */
export interface IRenderActor extends IHasCenterPosition, IGameActor {
  readonly Info: { readonly Name: string }
  readonly Owner: IRenderPlayer
  readonly EffectiveOwner?: { readonly Disguised: boolean; readonly Owner: IRenderPlayer } | null
  readonly World: {
    readonly ScreenMap: { addOrUpdate(actor: IRenderActor): void }
  }
  getDamageState(): DamageState
}

// ---------------------------------------------------------------------------
// DamagePrefixes（对应 OpenRA RenderSprites.DamagePrefixes）
// ---------------------------------------------------------------------------

/**
 * 损伤状态到序列前缀的映射（按严重程度降序排列）。
 *
 * OpenRA 对照: RenderSprites.DamagePrefixes
 */
const DAMAGE_PREFIXES: readonly {
  readonly damageState: DamageState
  readonly prefix: string
}[] = [
    { damageState: DamageState.Critical, prefix: 'critical-' },
    { damageState: DamageState.Heavy, prefix: 'damaged-' },
    { damageState: DamageState.Medium, prefix: 'scratched-' },
    { damageState: DamageState.Light, prefix: 'scuffed-' },
  ]

// ---------------------------------------------------------------------------
// RenderSpritesInfo（对应 OpenRA RenderSpritesInfo）
// ---------------------------------------------------------------------------

/**
 * RenderSprites 特质配置。
 *
 * OpenRA 对照: RenderSpritesInfo : TraitInfo, IRenderActorPreviewInfo
 */
export class RenderSpritesInfo {
  /** 精灵序列集名称（默认使用 actor 名称）。
   *
   * OpenRA 对照: RenderSpritesInfo.Image
   */
  readonly Image: string | null

  /** 阵营特定的图像覆盖。
   *
   * OpenRA 对照: RenderSpritesInfo.FactionImages
   */
  readonly FactionImages: Readonly<Record<string, string>> | null

  /** 自定义调色板名称。
   *
   * OpenRA 对照: RenderSpritesInfo.Palette
   */
  readonly Palette: string | null

  /** 玩家颜色调色板基础名称。
   *
   * OpenRA 对照: RenderSpritesInfo.PlayerPalette
   */
  readonly PlayerPalette: string

  constructor(
    image?: string | null,
    factionImages?: Readonly<Record<string, string>> | null,
    palette?: string | null,
    playerPalette?: string,
  ) {
    this.Image = image ?? null
    this.FactionImages = factionImages ?? null
    this.Palette = palette ?? null
    this.PlayerPalette = playerPalette ?? 'player'
  }

  // -----------------------------------------------------------------------
  // GetImage（对应 OpenRA RenderSpritesInfo.GetImage）
  // -----------------------------------------------------------------------

  /**
   * 解析 actor 的图像名称（考虑阵营覆盖）。
   *
   * OpenRA 对照: RenderSpritesInfo.GetImage(ActorInfo actor, string faction)
   *
   * @param actorName — actor 类型名称
   * @param faction — 阵营内部名称（可选）
   * @returns 小写图像名称
   */
  getImage(actorName: string, faction?: string | null): string {
    if (this.FactionImages && faction && faction.length > 0) {
      const factionImage = this.FactionImages[faction]
      if (factionImage) {
        return factionImage.toLowerCase()
      }
    }
    return (this.Image ?? actorName).toLowerCase()
  }
}

// ---------------------------------------------------------------------------
// AnimationWrapper（对应 OpenRA RenderSprites.AnimationWrapper）
// ---------------------------------------------------------------------------

/**
 * 内部类：包装 AnimationWithOffset，附加调色板和可见性缓存。
 *
 * OpenRA 对照: RenderSprites.AnimationWrapper (sealed class)
 */
class AnimationWrapper {
  /** 被包装的动画。
   *
   * OpenRA 对照: AnimationWrapper.Animation
   */
  readonly Animation: AnimationWithOffset

  /** 调色板名称。
   *
   * OpenRA 对照: AnimationWrapper.Palette
   */
  readonly Palette: string

  /** 是否使用玩家颜色调色板。
   *
   * OpenRA 对照: AnimationWrapper.IsPlayerPalette
   */
  readonly IsPlayerPalette: boolean

  /** 缓存的调色板引用（属主变更时置 null）。
   *
   * OpenRA 对照: AnimationWrapper.PaletteReference
   */
  PaletteReference: IPaletteRef | null = null

  // 变更检测缓存
  private _cachedVisible = false
  private _cachedOffset: WVec = WVec.Zero
  private _cachedSequenceName: string | null = null

  constructor(
    animation: AnimationWithOffset,
    palette: string,
    isPlayerPalette: boolean,
  ) {
    this.Animation = animation
    this.Palette = palette
    this.IsPlayerPalette = isPlayerPalette
  }

  // -----------------------------------------------------------------------
  // CachePalette（对应 OpenRA AnimationWrapper.CachePalette）
  // -----------------------------------------------------------------------

  /**
   * 从 WorldRenderer 解析调色板引用。
   *
   * OpenRA 对照: AnimationWrapper.CachePalette(WorldRenderer wr, Player owner)
   *
   * @param getPalette — (name: string) => IPaletteRef 回调
   * @param owner — 属主玩家
   */
  cachePalette(
    getPalette: (name: string) => IPaletteRef,
    owner: IRenderPlayer,
  ): void {
    const paletteName = this.IsPlayerPalette
      ? this.Palette + owner.InternalName
      : this.Palette
    this.PaletteReference = getPalette(paletteName)
  }

  // -----------------------------------------------------------------------
  // OwnerChanged（对应 OpenRA AnimationWrapper.OwnerChanged）
  // -----------------------------------------------------------------------

  /**
   * 属主变更时调色板引用置 null，下次渲染时重新解析。
   *
   * OpenRA 对照: AnimationWrapper.OwnerChanged()
   */
  ownerChanged(): void {
    if (this.IsPlayerPalette) {
      this.PaletteReference = null
    }
  }

  // -----------------------------------------------------------------------
  // IsVisible（对应 OpenRA AnimationWrapper.IsVisible）
  // -----------------------------------------------------------------------

  /**
   * 是否为可见（DisableFunc 为 null 或返回 false）。
   *
   * OpenRA 对照: AnimationWrapper.IsVisible
   */
  get isVisible(): boolean {
    return this.Animation.DisableFunc === null || !this.Animation.DisableFunc()
  }

  // -----------------------------------------------------------------------
  // Tick（对应 OpenRA AnimationWrapper.Tick）
  // -----------------------------------------------------------------------

  /**
   * 推进动画并返回位置/大小是否发生变化。
   *
   * OpenRA 对照: AnimationWrapper.Tick()
   *
   * @returns true 如果可见性、偏移或序列发生变化
   */
  tick(): boolean {
    // Tick the wrapped animation
    this.Animation.Animation.tick()

    const visible = this.isVisible
    const offset = this.Animation.OffsetFunc?.() ?? WVec.Zero
    const sequence = this.Animation.Animation.currentSequence
    const sequenceName = sequence?.name ?? null

    const updated =
      visible !== this._cachedVisible ||
      !WVec.equals(offset, this._cachedOffset) ||
      sequenceName !== this._cachedSequenceName

    this._cachedVisible = visible
    this._cachedOffset = offset
    this._cachedSequenceName = sequenceName

    return updated
  }
}

// ---------------------------------------------------------------------------
// RenderSprites（对应 OpenRA RenderSprites）
// ---------------------------------------------------------------------------

/**
 * 基础精灵渲染特质 — 所有 With* 渲染特质的基座。
 *
 * OpenRA 对照: RenderSprites : IRender, ITick, INotifyOwnerChanged, INotifyEffectiveOwnerChanged, IActorPreviewInitModifier
 *
 * 职责:
 * - 管理 AnimationWithOffset 列表
 * - 处理调色板刷新和属主变更
 * - 每 tick 推进所有动画
 * - 渲染时收集所有可见动画的 IRenderable
 *
 * 使用方式:
 * ```
 * const rs = new RenderSprites(info, faction)
 * actor.addTrait(rs)
 * rs.add(new AnimationWithOffset(anim, offsetFn, disableFn))
 * ```
 */
export class RenderSprites
  implements ITick, IRender, INotifyOwnerChanged, INotifyEffectiveOwnerChanged {
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'ITick',
    'IRender',
    'INotifyOwnerChanged',
    'INotifyEffectiveOwnerChanged',
    'RenderSprites',
  ]

  /** DamagePrefixes 公开副本（供 NormalizeSequence 外部调用）。 */
  static readonly DamagePrefixes = DAMAGE_PREFIXES

  /** 特质配置信息。
   *
   * OpenRA 对照: RenderSprites.Info
   */
  readonly Info: RenderSpritesInfo

  /** 缓存的图像名称（GetImage 延迟计算）。 */
  private _cachedImage: string | null = null

  /** 阵营内部名称。 */
  private readonly _faction: string | null

  /** 已注册的动画包装器列表。
   *
   * OpenRA 对照: RenderSprites.anims
   */
  private readonly _anims: AnimationWrapper[] = []

  /** 是否需要刷新调色板。 */
  private _shouldRefreshPalettes = true

  /** 属主函数（由 Actor 设置，用于 palette 获取）。 */
  private _getPaletteFn:
  | ((name: string) => IPaletteRef)
  | null = null

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA RenderSprites 构造函数）
  // -----------------------------------------------------------------------

  /**
   * 构造 RenderSprites。
   *
   * OpenRA 对照: RenderSprites(ActorInitializer init, RenderSpritesInfo info)
   *
   * @param info — 特质配置
   * @param faction — 阵营内部名称（来自 Owner.Faction.InternalName）
   */
  constructor(info: RenderSpritesInfo, faction?: string | null) {
    this.Info = info
    this._faction = faction ?? null
  }

  // -----------------------------------------------------------------------
  // GetImage（对应 OpenRA RenderSprites.GetImage）
  // -----------------------------------------------------------------------

  /**
   * 获取此 actor 的精灵集图像名称（缓存）。
   *
   * OpenRA 对照: RenderSprites.GetImage(Actor self)
   *
   * @param self — actor 实例（获取 Info.Name）
   * @returns 小写图像名称
   */
  getImage(self: IRenderActor): string {
    if (this._cachedImage !== null) {
      return this._cachedImage
    }
    this._cachedImage = this.Info.getImage(self.Info.Name, this._faction)
    return this._cachedImage
  }

  // -----------------------------------------------------------------------
  // Add / Remove（对应 OpenRA RenderSprites.Add/Remove）
  // -----------------------------------------------------------------------

  /**
   * 添加动画包装器。
   *
   * OpenRA 对照: RenderSprites.Add(AnimationWithOffset anim, string palette, bool isPlayerPalette)
   *
   * 若 palette 为 null，使用 Info.Palette 或 Info.PlayerPalette 作为默认值。
   *
   * @param anim — 带偏移的动画
   * @param palette — 调色板名称（null = 自动选择）
   * @param isPlayerPalette — 是否为玩家颜色调色板（palette 为 null 时自动推断）
   */
  add(
    anim: AnimationWithOffset,
    palette?: string | null,
    isPlayerPalette?: boolean,
  ): void {
    // Use defaults from Info
    if (palette === undefined || palette === null) {
      palette = this.Info.Palette ?? this.Info.PlayerPalette
      isPlayerPalette = this.Info.Palette === null
    }

    this._shouldRefreshPalettes = true
    this._anims.push(
      new AnimationWrapper(anim, palette, isPlayerPalette ?? false),
    )
  }

  /**
   * 移除指定动画。
   *
   * OpenRA 对照: RenderSprites.Remove(AnimationWithOffset anim)
   *
   * @param anim — 要移除的动画
   */
  remove(anim: AnimationWithOffset): void {
    for (let i = this._anims.length - 1; i >= 0; i--) {
      if (this._anims[i]!.Animation === anim) {
        this._anims.splice(i, 1)
      }
    }
  }

  // -----------------------------------------------------------------------
  // UpdatePalette / OwnerChanged（对应 OpenRA）
  // -----------------------------------------------------------------------

  /**
   * 标记所有调色板需要刷新。
   *
   * OpenRA 对照: RenderSprites.UpdatePalette()
   */
  updatePalette(): void {
    this._shouldRefreshPalettes = true
    for (const anim of this._anims) {
      anim.ownerChanged()
    }
  }

  /**
   * 设置调色板解析器（由 WorldRenderer 注入）。
   *
   * @param fn — (paletteName: string) => IPaletteRef
   */
  setPaletteResolver(fn: (name: string) => IPaletteRef): void {
    this._getPaletteFn = fn
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged / INotifyEffectiveOwnerChanged
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  onOwnerChanged(
    _actor: IGameActor,
    _oldOwner: PlayerStub,
    _newOwner: PlayerStub,
  ): void {
    this.updatePalette()
  }

  /** @inheritdoc */
  onEffectiveOwnerChanged(
    _actor: IGameActor,
    _oldEffectiveOwner: PlayerStub,
    _newEffectiveOwner: PlayerStub,
  ): void {
    this.updatePalette()
  }

  // -----------------------------------------------------------------------
  // IRender.Render（对应 OpenRA RenderSprites.Render）
  // -----------------------------------------------------------------------

  /**
   * 渲染所有可见动画。
   *
   * OpenRA 对照: RenderSprites.Render(Actor self, WorldRenderer wr)
   *
   * 首次调用或 shouldRefreshPalettes 为 true 时刷新调色板。
   *
   * @param self — actor 实例
   * @param _wr — 世界渲染器（当前未使用，保留供将来扩展）
   * @returns 可渲染对象数组
   */
  render(self: IRenderActor, _wr: IWorldRenderer): readonly IRenderable[] {
    // Refresh palettes if needed
    if (this._shouldRefreshPalettes && this._getPaletteFn) {
      this._shouldRefreshPalettes = false
      for (const a of this._anims) {
        if (a.PaletteReference === null) {
          const owner = this._resolveEffectiveOwner(self)
          a.cachePalette(this._getPaletteFn, owner)
        }
      }
    }

    return RenderSprites.renderAnimations(this._anims, self)
  }

  // -----------------------------------------------------------------------
  // IRender.ScreenBounds（对应 OpenRA RenderSprites.ScreenBounds）
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  screenBounds(
    self: IRenderActor,
    wr: IWorldRenderer,
  ): readonly Rectangle[] {
    const results: Rectangle[] = []
    for (const a of this._anims) {
      if (a.isVisible) {
        results.push(a.Animation.screenBounds(self, wr))
      }
    }
    return results
  }

  // -----------------------------------------------------------------------
  // ITick.Tick（对应 OpenRA ITick.Tick / RenderSprites.Tick）
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  tick(actor: IGameActor): void {
    const self = actor as IRenderActor
    let updated = false
    for (const a of this._anims) {
      if (a.tick()) {
        updated = true
      }
    }

    if (updated) {
      self.World.ScreenMap.addOrUpdate(self)
    }
  }

  // -----------------------------------------------------------------------
  // AutoRenderSize / AutoSelectionSize（对应 OpenRA）
  // -----------------------------------------------------------------------

  /**
   * 计算自动选择框大小（从第一个可见动画的第一帧精灵大小推算）。
   *
   * OpenRA 对照: RenderSprites.AutoSelectionSize()
   *
   * @returns 精灵大小 { x, y } 或 { x: 0, y: 0 }（无可见动画）
   */
  autoSelectionSize(): { x: number; y: number } {
    return this.autoRenderSize()
  }

  /**
   * 计算自动渲染大小（从第一个可见动画推算）。
   *
   * OpenRA 对照: RenderSprites.AutoRenderSize()
   *
   * @returns 精灵大小 { x, y }（已乘序列缩放）或 { x: 0, y: 0 }
   */
  autoRenderSize(): { x: number; y: number } {
    for (const w of this._anims) {
      if (!w.isVisible) continue
      const seq = w.Animation.Animation.currentSequence
      if (!seq) continue
      const img = w.Animation.Animation.image
      if (!img) continue
      const scale = seq.scale
      return {
        x: Math.trunc(img.size.x * scale),
        y: Math.trunc(img.size.y * scale),
      }
    }
    return { x: 0, y: 0 }
  }

  // -----------------------------------------------------------------------
  // 动画列表访问器
  // -----------------------------------------------------------------------

  /** 已注册的动画数量。
   *
   * OpenRA 对照: anims.Count
   */
  get animationCount(): number {
    return this._anims.length
  }

  /** 是否需要刷新调色板。
   *
   * OpenRA 对照: shouldRefreshPalettes (private, exposed for tests)
   */
  get shouldRefreshPalettes(): boolean {
    return this._shouldRefreshPalettes
  }

  // -----------------------------------------------------------------------
  // 静态: RenderAnimations（对应 OpenRA RenderSprites.RenderAnimations）
  // -----------------------------------------------------------------------

  /**
   * 从动画包装器列表收集所有可见动画的 IRenderable。
   *
   * OpenRA 对照: RenderSprites.RenderAnimations(List<AnimationWrapper> anims, Actor self)
   *
   * @param anims — 动画包装器列表
   * @param self — actor 实例
   * @returns 可渲染对象数组（惰性求值）
   */
  static renderAnimations(
    anims: readonly AnimationWrapper[],
    self: IHasCenterPosition,
  ): IRenderable[] {
    const results: IRenderable[] = []
    for (const a of anims) {
      if (!a.isVisible) continue
      if (!a.PaletteReference) continue
      // Collect renderables from the wrapped animation
      const renderables = a.Animation.render(self, a.PaletteReference)
      for (const r of renderables) {
        results.push(r)
      }
    }
    return results
  }

  // -----------------------------------------------------------------------
  // 静态: UnnormalizeSequence（对应 OpenRA RenderSprites.UnnormalizeSequence）
  // -----------------------------------------------------------------------

  /**
   * 移除序列名的损伤前缀。
   *
   * OpenRA 对照: RenderSprites.UnnormalizeSequence(string sequence)
   *
   * @param sequence — 可能带有损伤前缀的序列名
   * @returns 去除前缀的序列名
   */
  static unnormalizeSequence(sequence: string): string {
    for (const dp of DAMAGE_PREFIXES) {
      if (sequence.startsWith(dp.prefix)) {
        return sequence.substring(dp.prefix.length)
      }
    }
    return sequence
  }

  // -----------------------------------------------------------------------
  // 静态: NormalizeSequence（对应 OpenRA RenderSprites.NormalizeSequence）
  // -----------------------------------------------------------------------

  /**
   * 根据损伤状态为序列名添加适当前缀。
   *
   * OpenRA 对照: RenderSprites.NormalizeSequence(Animation anim, DamageState state, string sequence)
   *
   * 算法:
   * 1. 先移除现有前缀
   * 2. 按严重程度降序遍历 DamagePrefixes
   * 3. 若当前损伤状态 >= 前缀对应的损伤状态，且动画中存在带前缀序列，则使用该前缀
   *
   * @param anim — 动画实例（用于查询序列是否存在）
   * @param state — 损伤状态
   * @param sequence — 基础序列名
   * @returns 适当前缀的序列名
   */
  static normalizeSequence(
    anim: Animation,
    state: DamageState,
    sequence: string,
  ): string {
    // Remove any existing damage prefix
    sequence = RenderSprites.unnormalizeSequence(sequence)

    for (const dp of DAMAGE_PREFIXES) {
      if (state >= dp.damageState && anim.hasSequence(dp.prefix + sequence)) {
        return dp.prefix + sequence
      }
    }

    return sequence
  }

  // -----------------------------------------------------------------------
  // 内部: 解析 EffectiveOwner
  // -----------------------------------------------------------------------

  /**
   * 解析实际属主（考虑伪装）。
   *
   * OpenRA 对照:
   *   var owner = self.EffectiveOwner != null && self.EffectiveOwner.Disguised
   *     ? self.EffectiveOwner.Owner : self.Owner;
   *
   * @param self — actor 实例
   * @returns 实际属主
   */
  private _resolveEffectiveOwner(self: IRenderActor): IRenderPlayer {
    if (
      self.EffectiveOwner != null &&
      self.EffectiveOwner.Disguised
    ) {
      return self.EffectiveOwner.Owner
    }
    return self.Owner
  }
}
