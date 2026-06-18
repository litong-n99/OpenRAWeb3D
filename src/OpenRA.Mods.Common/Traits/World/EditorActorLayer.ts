/**
 * EditorActorLayer.ts — 编辑器 actor 集合管理层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs (495 lines C#)
 *
 * 核心范式转换:
 * - C# SpatiallyPartitioned<EditorActorPreview> → 轻量级 SimpleSpatialIndex<T>
 *   (基于网格的空间哈希，适配 cellMap / screenMap 两个索引)
 * - C# List<EditorActorPreview> + HashSet<uint> → Array + Set<number> (预览 ID 跟踪)
 * - C# int2 / Rectangle 结构体 → 轻量级 TypeScript 接口 (无堆分配包装)
 * - C# HashSet<CPos>.UnionWith/Overlaps/Except → Map<number, CPos> (按 Bits 键控)
 * - C# IEnumerable<IRenderable> yield return → readonly IRenderable[] 数组
 * - C# INotifyActorDisposing, ICreatePlayers, IRadarSignature → TypeScript 接口实现
 * - C# OpenRA Primitives 不可变集合 → TypeScript 原生 Map/Set/Array
 *
 * EditorActorLayer 管理编辑器中所有 EditorActorPreview 实例。它维护一个
 * 以 actor ID 为键的主集合，加上两个空间索引（cellMap / screenMap），
 * 用于高效的基于位置和基于屏幕的查询。多玩家数量同步跟踪 mpspawn
 * actor 以添加或删除 MultiX 玩家槽。
 *
 * Migration: TODO-21.A.2 — Chapter 21 Phase A
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import type { SubCell as SubCellEnum } from '../../../OpenRA.Game/Traits/SubCell.js'
import { CellCoordsRegion } from '../../../OpenRA.Game/Map/CellCoordsRegion.js'
import { PlayerReference } from '../../../OpenRA.Game/Map/PlayerReference.js'
import { MapPlayers } from '../../../OpenRA.Game/Map/MapPlayers.js'
import {
  EditorActorPreview,
  type ActorReferenceMap,
  type OwnerInit,
} from './EditorActorPreview.js'
import type {
  ITraitInfo,
  ITickRender,
  IRender,
  IRenderAnnotations,
  IWorldLoaded,
  ICreatePlayers,
  INotifyActorDisposing,
  IGameActor,
  WorldRendererStub,
  WorldStub,
  IRenderable,
  RectangleStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { MersenneTwisterStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// 轻量级几何类型 (对应 OpenRA int2 / Rectangle / Size)
// ---------------------------------------------------------------------------

/** 二维整数点（对应 OpenRA int2 / Size）。 */
interface Int2 {
  readonly x: number
  readonly y: number
}

/** 轴对齐矩形（对应 OpenRA Rectangle）。 */
interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 从 LTRB 坐标构造矩形（对应 OpenRA Rectangle.FromLTRB）。 */
function rectFromLTRB(left: number, top: number, right: number, bottom: number): Rect {
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 空矩形（面积为零）。 */
function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0
}

/** 两个矩形的并集边界矩形（对应 OpenRA IEnumerable<Rectangle>.Union()）。 */
function unionRects(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let left = Number.MAX_SAFE_INTEGER
  let top = Number.MAX_SAFE_INTEGER
  let right = Number.MIN_SAFE_INTEGER
  let bottom = Number.MIN_SAFE_INTEGER
  for (const r of rects) {
    if (r.x < left) left = r.x
    if (r.y < top) top = r.y
    if (r.x + r.width > right) right = r.x + r.width
    if (r.y + r.height > bottom) bottom = r.y + r.height
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// ---------------------------------------------------------------------------
// CPos 集合工具 (对应 OpenRA HashSet<CPos>)
// ---------------------------------------------------------------------------

/** 基于 Bits 的唯一 CPos 集合（对应 OpenRA HashSet<CPos>）。 */
class CPosSet {
  private readonly map = new Map<number, CPos>()

  add(cp: CPos): void { this.map.set(cp.Bits, cp) }

  has(cp: CPos): boolean { return this.map.has(cp.Bits) }

  get size(): number { return this.map.size }

  values(): CPos[] { return [...this.map.values()] }

  /** 与另一个 CPos 集合求并（对应 HashSet<CPos>.UnionWith）。 */
  unionWith(cells: Iterable<CPos>): void {
    for (const c of cells) this.map.set(c.Bits, c)
  }

  /** 检查与另一个 CPos 集合是否有交叠（对应 HashSet<CPos>.Overlaps）。 */
  overlaps(other: CPosSet): boolean {
    for (const bits of this.map.keys()) {
      if (other.map.has(bits)) return true
    }
    return false
  }

  /** 从集合中移除匹配的 cell（对应 IEnumerable<CPos>.Except）。 */
  except(keys: Iterable<CPos>): CPos[] {
    const excluded = new Set<number>()
    for (const c of keys) excluded.add(c.Bits)
    const result: CPos[] = []
    for (const [bits, cp] of this.map) {
      if (!excluded.has(bits)) result.push(cp)
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// 邻居扩展 (对应 OpenRA Util.ExpandFootprint / Util.Neighbours)
// ---------------------------------------------------------------------------

/** 获取 cell 及其相邻格（包含对角线方向）。
 *
 * OpenRA 对照: Util.Neighbours(CPos c, bool allowDiagonal)
 *
 * 返回 5 个（不含对角线）或 9 个（含对角线）位置，包括自身。
 */
function neighboursOf(cell: CPos, allowDiagonal: boolean): CPos[] {
  const x = cell.X
  const y = cell.Y
  const result: CPos[] = [
    new CPos(x, y),
    new CPos(x - 1, y),
    new CPos(x + 1, y),
    new CPos(x, y - 1),
    new CPos(x, y + 1),
  ]
  if (allowDiagonal) {
    result.push(new CPos(x - 1, y - 1))
    result.push(new CPos(x + 1, y - 1))
    result.push(new CPos(x - 1, y + 1))
    result.push(new CPos(x + 1, y + 1))
  }
  return result
}

/** 为一组 cell 生成扩展的脚印（含邻居）。
 *
 * OpenRA 对照: Util.ExpandFootprint(IEnumerable<CPos>, bool allowDiagonal)
 *
 * 返回所有输入 cell 及它们邻居的唯一定位集合。
 */
function expandFootprint(cells: Iterable<CPos>, allowDiagonal: boolean): readonly CPos[] {
  const set = new CPosSet()
  for (const cell of cells) {
    for (const n of neighboursOf(cell, allowDiagonal)) {
      set.add(n)
    }
  }
  return set.values()
}

// ---------------------------------------------------------------------------
// 简单空间索引 (对应 OpenRA SpatiallyPartitioned<T>)
// ---------------------------------------------------------------------------

/**
 * 基于规则网格的轻量级空间索引。
 *
 * OpenRA 对照: SpatiallyPartitioned<T>(width, height, binSize)
 *
 * 将 2D 空间划分为 binSize*binsize 的区间，支持：
 * - add(item, rect): 将元素添加到与其矩形相交的所有 bin 中
 * - remove(item): 从所有 bin 中删除元素
 * - at(x, y): 获取 (x,y) 处 bin 内的所有元素
 * - inBox(rect): 获取与矩形相交的所有 bin 内的元素（去重）
 * - keys: 所有已索引元素
 */
class SimpleSpatialIndex<T> {
  /** 将 bin 键映射到元素集合。 */
  private readonly bins = new Map<string, Set<T>>()

  /** 将元素映射到其占据的 bin 键集合。 */
  private readonly itemBins = new Map<T, Set<string>>()

  /** 所有被索引的元素。 */
  private readonly allItems = new Set<T>()

  /** 每个 bin 的大小（world/cell 单位）。 */
  private readonly binSize: number

  constructor(binSize: number) {
    this.binSize = Math.max(1, binSize)
  }

  /** 为坐标计算 bin 键。 */
  private binKey(x: number, y: number): string {
    const bx = Math.floor(x / this.binSize)
    const by = Math.floor(y / this.binSize)
    return `${bx},${by}`
  }

  /** 获取与矩形相交的所有 bin 键。 */
  private binKeysForRect(rect: Rect): string[] {
    const keys: string[] = []
    const startX = Math.floor(rect.x / this.binSize)
    const startY = Math.floor(rect.y / this.binSize)
    const endX = Math.floor((rect.x + rect.width - 1) / this.binSize)
    const endY = Math.floor((rect.y + rect.height - 1) / this.binSize)
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        keys.push(`${x},${y}`)
      }
    }
    return keys
  }

  /** 添加一个元素，指定其占据的矩形区域。
   *
   * OpenRA 对照: SpatiallyPartitioned<T>.Add(T item, Rectangle bounds)
   */
  add(item: T, rect: Rect): void {
    this.allItems.add(item)
    const keys = this.binKeysForRect(rect)
    const occBins = new Set<string>(keys)
    this.itemBins.set(item, occBins)
    for (const key of keys) {
      let bin = this.bins.get(key)
      if (!bin) {
        bin = new Set()
        this.bins.set(key, bin)
      }
      bin.add(item)
    }
  }

  /** 移除一个元素。
   *
   * OpenRA 对照: SpatiallyPartitioned<T>.Remove(T item)
   */
  remove(item: T): void {
    this.allItems.delete(item)
    const occBins = this.itemBins.get(item)
    if (occBins) {
      for (const key of occBins) {
        this.bins.get(key)?.delete(item)
      }
      this.itemBins.delete(item)
    }
  }

  /** 在指定位置获取元素。
   *
   * OpenRA 对照: SpatiallyPartitioned<T>.At(int2 pos)
   */
  at(x: number, y: number): T[] {
    const bin = this.bins.get(this.binKey(x, y))
    return bin ? [...bin] : []
  }

  /** 获取与指定矩形相交的所有元素。
   *
   * OpenRA 对照: SpatiallyPartitioned<T>.InBox(Rectangle r)
   */
  inBox(rect: Rect): T[] {
    const result = new Set<T>()
    for (const key of this.binKeysForRect(rect)) {
      const bin = this.bins.get(key)
      if (bin) {
        for (const item of bin) result.add(item)
      }
    }
    return [...result]
  }

  /** 所有被索引的元素。
   *
   * OpenRA 对照: SpatiallyPartitioned<T>.Keys
   */
  get keys(): T[] {
    return [...this.allItems]
  }

  /** 清理所有索引条目。 */
  clear(): void {
    this.bins.clear()
    this.itemBins.clear()
    this.allItems.clear()
  }
}

// ---------------------------------------------------------------------------
// Actor ID 工具
// ---------------------------------------------------------------------------

/** const string ActorPrefix = "Actor" */
const ACTOR_PREFIX = 'Actor'
/** const string PlayerSpawnName = "mpspawn" */
const PLAYER_SPAWN_NAME = 'mpspawn'

/** 尝试从名称中解析 actor 数字 ID。
 *
 * OpenRA 对照: EditorActorLayer.TryGetActorId(string name, out uint id)
 *
 * 名称必须以 "Actor" 开头，其余部分必须是有效的非负整数。
 */
function tryGetActorId(name: string): { id: number; ok: boolean } {
  if (!name.startsWith(ACTOR_PREFIX)) return { id: 0, ok: false }
  const suffix = name.slice(ACTOR_PREFIX.length)
  if (suffix.length === 0) return { id: 0, ok: false }
  const parsed = Number(suffix)
  if (!Number.isInteger(parsed) || parsed < 0) return { id: 0, ok: false }
  return { id: parsed, ok: true }
}

// ---------------------------------------------------------------------------
// EditorActorLayerInfo (对应 OpenRA EditorActorLayerInfo : TraitInfo, ICreatePlayersInfo)
// ---------------------------------------------------------------------------

/**
 * EditorActorLayer 的特质配置。
 *
 * OpenRA 对照: EditorActorLayerInfo : TraitInfo<EditorActorLayer>, ICreatePlayersInfo
 *
 * @TraitLocation SystemActors.EditorWorld
 */
export class EditorActorLayerInfo implements ITraitInfo {
  /** 可选实例名称（用于消歧）。 */
  readonly instanceName?: string

  /** 分区区间大小（世界像素）。默认 250。
   *
   * OpenRA 对照: EditorActorLayerInfo.BinSize
   */
  readonly BinSize: number

  /** 新 actor 的朝向。默认 384（WAngle）。
   *
   * OpenRA 对照: EditorActorLayerInfo.DefaultActorFacing
   */
  readonly DefaultActorFacing: number

  /** @param params — 配置参数 */
  constructor(params: {
    instanceName?: string
    binSize?: number
    defaultActorFacing?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.BinSize = params.binSize ?? 250
    this.DefaultActorFacing = params.defaultActorFacing ?? 384
  }

  /**
   * 此特质绝不可定义在世界 actor 上。
   *
   * OpenRA 对照: ICreatePlayersInfo.CreateServerPlayers()
   */
  createServerPlayers(
    _map: unknown,
    _session: unknown,
    _players: unknown[],
    _random: unknown,
  ): void {
    throw new Error(
      'EditorActorLayer must not be defined on the world actor.',
    )
  }

  /**
   * 创建 EditorActorLayer 特质实例。
   *
   * OpenRA 对照: TraitInfo<EditorActorLayer>.Create(ActorInitializer)
   *
   * @param _init — actor 初始化器（未使用）
   * @returns 新的 EditorActorLayer 实例
   */
  create(_init: { self: IGameActor }): EditorActorLayer {
    return new EditorActorLayer(this)
  }
}

// ---------------------------------------------------------------------------
// EditorActorLayer (对应 OpenRA EditorActorLayer : IWorldLoaded, ITickRender,
//   IRender, IRadarSignature, ICreatePlayers, IRenderAnnotations,
//   INotifyActorDisposing)
// ---------------------------------------------------------------------------

/**
 * 管理编辑器中所有 EditorActorPreview 实例。
 *
 * OpenRA 对照: EditorActorLayer
 *
 * 维护 actor 的主列表，加上两个空间索引，用于基于位置和基于屏幕的查询。
 * 处理 actor 的添加、移除、移动以及多玩家槽位同步。
 *
 * 在 TypeScript 中，世界 actor 没有完整的 TraitDictionary，因此
 * EditorActorLayer 是在没有特质信息对象的情况下独立创建的。
 * 构造后的初始化在 worldLoaded() 中进行。
 */
export class EditorActorLayer
  implements ITickRender, IRender, IRenderAnnotations, IWorldLoaded, ICreatePlayers, INotifyActorDisposing
{
  // ---------------------------------------------------------------------------
  // 静态常量 (对应 OpenRA const)
  // ---------------------------------------------------------------------------

  /** Actor ID 前缀。
   *
   * OpenRA 对照: const string ActorPrefix = "Actor"
   */
  static readonly ActorPrefix = ACTOR_PREFIX

  /** 玩家出生点 actor 类型名称。
   *
   * OpenRA 对照: const string PlayerSpawnName = "mpspawn"
   */
  static readonly PlayerSpawnName = PLAYER_SPAWN_NAME

  // ---------------------------------------------------------------------------
  // 公开属性 (对应 OpenRA 字段 / 属性)
  // ---------------------------------------------------------------------------

  /** 特质配置信息。
   *
   * OpenRA 对照: EditorActorLayer.Info (readonly)
   */
  readonly Info: EditorActorLayerInfo

  /** 玩家槽位集合。
   *
   * OpenRA 对照: EditorActorLayer.Players { get; private set; }
   */
  Players: MapPlayers | null = null

  /** 玩家槽位被移除时的回调。
   *
   * OpenRA 对照: EditorActorLayer.OnPlayerRemoved (Action)
   */
  onPlayerRemoved: () => void = () => {}

  // ---------------------------------------------------------------------------
  // 私有状态 (对应 OpenRA 私有字段)
  // ---------------------------------------------------------------------------

  /** 所有编辑器 actor 预览的主列表。
   *
   * OpenRA 对照: List<EditorActorPreview> previews
   */
  private _previews: EditorActorPreview[] = []

  /** 已使用的数字 actor ID（用于唯一 ID 生成）。
   *
   * OpenRA 对照: HashSet<uint> previewIds
   */
  private readonly _previewIds = new Set<number>()

  /** 将单元格索引偏移到以零为基的空间（最小单元格坐标）。
   *
   * OpenRA 对照: int2 cellOffset
   */
  private _cellOffset: Int2 = { x: 0, y: 0 }

  /** 基于单元格的空间索引。
   *
   * OpenRA 对照: SpatiallyPartitioned<EditorActorPreview> cellMap
   */
  private _cellMap: SimpleSpatialIndex<EditorActorPreview>

  /** 基于屏幕的空间索引。
   *
   * OpenRA 对照: SpatiallyPartitioned<EditorActorPreview> screenMap
   */
  private _screenMap: SimpleSpatialIndex<EditorActorPreview>

  /** 世界渲染器引用。
   *
   * OpenRA 对照: WorldRenderer worldRenderer
   */
  private _worldRenderer: WorldRendererStub | null = null

  /** 世界拥有者玩家（编辑器模式）。
   *
   * OpenRA 对照: PlayerReference worldOwner
   */
  private _worldOwner: PlayerReference | null = null

  // ---------------------------------------------------------------------------
  // 构造 (对应 OpenRA EditorActorLayer constructor)
  // ---------------------------------------------------------------------------

  /**
   * 创建一个新的 EditorActorLayer。
   *
   * OpenRA 对照: EditorActorLayer(EditorActorLayerInfo info)
   *
   * 在 worldLoaded() 被调用之前，此层不包含任何 preview。
   *
   * @param info — 特质配置
   */
  constructor(info: EditorActorLayerInfo) {
    this.Info = info
    this._cellMap = new SimpleSpatialIndex<EditorActorPreview>(info.BinSize)
    this._screenMap = new SimpleSpatialIndex<EditorActorPreview>(info.BinSize)
  }

  // ---------------------------------------------------------------------------
  // ICreatePlayers (对应 OpenRA ICreatePlayers.CreatePlayers)
  // ---------------------------------------------------------------------------

  /**
   * 从地图定义创建玩家槽位。
   *
   * OpenRA 对照: ICreatePlayers.CreatePlayers(World w, MersenneTwister playerRandom)
   *
   * 通过 playerDefinitions 构造 MapPlayers，识别世界拥有者，
   * 并设置世界拥有者。如果未提供 playerDefinitions，则创建默认单人配置。
   *
   * @param w — 世界
   * @param _playerRandom — 随机数生成器（未使用）
   */
  createPlayers(w: WorldStub, _playerRandom: MersenneTwisterStub): void {
    // 尝试从世界的地图数据获取 playerDefinitions。
    // 如果 WorldStub 没有提供定义，我们创建默认配置。
    const worldWithMap = w as WorldStub & {
      map?: { playerDefinitions?: { name: string; properties?: Partial<PlayerReference> }[] }
    }

    if (worldWithMap.map?.playerDefinitions?.length) {
      this.Players = new MapPlayers(worldWithMap.map.playerDefinitions)
    } else {
      // 默认：只有 "Neutral" 作为世界拥有者
      this.Players = new MapPlayers()
      const neutral = new PlayerReference({
        name: 'Neutral',
        faction: 'Random',
        ownsWorld: true,
        nonCombatant: true,
        playable: false,
      })
      this.Players.players.set('Neutral', neutral)
    }

    // 找到世界拥有者（ownsWorld && !Playable）
    this._worldOwner =
      [...this.Players.players.values()].find(
        (p) => p.ownsWorld && !p.playable,
      ) ?? null

    // NOTE: C# 在此处调用 w.SetWorldOwner(new Player(w, null, worldOwner, playerRandom))
    // 由于 Player 是存根且 World 可能还不支持 SetWorldOwner，
    // 我们只存储引用。TODO-21.A.2-DEFER-1: 在 Player 完成迁移后调用 SetWorldOwner。
  }

  // ---------------------------------------------------------------------------
  // IWorldLoaded (对应 OpenRA IWorldLoaded.WorldLoaded)
  // ---------------------------------------------------------------------------

  /**
   * 在世界加载后初始化空间索引并加载现有 actor 定义。
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World world, WorldRenderer wr)
   *
   * 根据世界地图尺寸配置 cellMap 和 screenMap，加载所有现有 actor
   * 定义，并订阅地图变化通知。
   *
   * @param world — 世界
   * @param wr — 世界渲染器
   */
  worldLoaded(world: WorldStub, wr: WorldRendererStub): void {
    this._worldRenderer = wr

    // NOTE: world reference stored for map change subscriptions.
    void world

    // 获取地图数据的类型安全视图
    const worldWithMap = world as WorldStub & {
      map?: {
        allCells?: CPos[]
        rules?: { terrainInfo?: { tileSize?: { width: number; height: number } } }
        mapSize?: { width: number; height: number }
        actorDefinitions?: Map<string, { type: string; value: Record<string, unknown> }>
        playerDefinitions?: { name: string; properties?: Partial<PlayerReference> }[]
        height?: { cellEntryChanged?: { subscribe: (cb: (cell: CPos) => void) => () => void } }
        ramp?: { cellEntryChanged?: { subscribe: (cb: (cell: CPos) => void) => () => void } }
      }
    }
    const map = worldWithMap.map

    // 计算 cellOffset（最小细胞坐标）
    if (map?.allCells?.length) {
      let minX = Number.MAX_SAFE_INTEGER
      let minY = Number.MAX_SAFE_INTEGER
      let maxX = Number.MIN_SAFE_INTEGER
      let maxY = Number.MIN_SAFE_INTEGER
      for (const cell of map.allCells) {
        if (cell.X < minX) minX = cell.X
        if (cell.X > maxX) maxX = cell.X
        if (cell.Y < minY) minY = cell.Y
        if (cell.Y > maxY) maxY = cell.Y
      }
      this._cellOffset = { x: minX, y: minY }

      // 配置 cellMap: binSize = ceil(Info.BinSize / tileWidth)
      const ts = map.rules?.terrainInfo?.tileSize ?? { width: 1024, height: 1024 }
      const cellBinSize = Math.max(
        1,
        Math.ceil(this.Info.BinSize / ts.width),
      )
      // NOTE: mapCellWidth/Height + screenWidth/Height computed here match
      // the C# SpatiallyPartitioned constructor signature but are not used
      // by our simplified spatial index (no explicit domain bounds). They
      // will be consumed when the real SpatiallyPartitioned is migrated.
      void (maxX - minX)
      void (maxY - minY)
      this._cellMap = new SimpleSpatialIndex<EditorActorPreview>(cellBinSize)

      // 配置 screenMap
      if (map.mapSize) {
        void (map.mapSize.width * ts.width)
        void (map.mapSize.height * ts.height)
        this._screenMap = new SimpleSpatialIndex<EditorActorPreview>(
          this.Info.BinSize,
        )
      }
    }

    // 更新玩家的调色板
    if (this.Players) {
      const wrExt = wr as Record<string, unknown>
      const updateFn = wrExt.updatePalettesForPlayer as
        | ((name: string, color: number, force: boolean) => void)
        | undefined
      if (updateFn) {
        for (const pr of this.Players.players.values()) {
          updateFn(pr.name, pr.color, false)
        }
      }
    }

    // 加载现有 actor 定义
    if (map?.actorDefinitions?.size) {
      const names: string[] = []
      const references: ActorReferenceMap[] = []
      for (const [name, def] of map.actorDefinitions) {
        names.push(name)
        references.push(new Map(Object.entries(def.value ?? {})))
      }
      this.addRangeFromNames(references, names)
    }

    // 订阅地图变化事件
    if (map?.height?.cellEntryChanged) {
      this._unsubHeight = map.height.cellEntryChanged.subscribe(
        (cell: CPos) => this._updatePreviewsOnMapChange(cell),
      )
    }
    if (map?.ramp?.cellEntryChanged) {
      this._unsubRamp = map.ramp.cellEntryChanged.subscribe(
        (cell: CPos) => this._updatePreviewsOnMapChange(cell),
      )
    }
  }

  /** 取消订阅函数（在 disposing 中调用）。 */
  private _unsubHeight: (() => void) | null = null
  private _unsubRamp: (() => void) | null = null

  // ---------------------------------------------------------------------------
  // ITickRender (对应 OpenRA ITickRender.TickRender)
  // ---------------------------------------------------------------------------

  /**
   * 每帧推进所有 preview 动画。
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer wr, Actor self)
   */
  tickRender(_wr: WorldRendererStub, _self: IGameActor): void {
    for (const p of this._previews) {
      p.tick()
    }
  }

  // ---------------------------------------------------------------------------
  // IRender (对应 OpenRA IRender.Render)
  // ---------------------------------------------------------------------------

  /**
   * 为屏幕上可见的 preview 收集渲染对象。
   *
   * OpenRA 对照: EditorActorLayer.Render(Actor self, WorldRenderer wr)
   *
   * NOTE: 由于 WorldRendererStub 不提供 Viewport，
   * 此方法返回所有 preview 的渲染对象。
   * TODO-21.A.2-DEFER-2: 在 Viewport 存根扩展后，添加视口剔除。
   */
  render(_self: IGameActor, _wr: WorldRendererStub): readonly IRenderable[] {
    const result: IRenderable[] = []
    for (const p of this._previews) {
      for (const r of p.render()) {
        result.push(r)
      }
    }
    return result
  }

  /**
   * 返回屏幕空间边界矩形。
   *
   * OpenRA 对照: IRender.ScreenBounds(Actor self, WorldRenderer wr)
   *
   * 世界 actor 的渲染特质不需要屏幕边界。
   */
  screenBounds(_self: IGameActor, _wr: WorldRendererStub): readonly RectangleStub[] {
    return []
  }

  // ---------------------------------------------------------------------------
  // IRenderAnnotations (对应 OpenRA IRenderAnnotations)
  // ---------------------------------------------------------------------------

  /**
   * 为在屏幕框中可见的所有 preview 收集标注渲染对象。
   *
   * OpenRA 对照: EditorActorLayer.RenderAnnotations(Actor self, WorldRenderer wr)
   */
  renderAnnotations(): readonly IRenderable[] {
    const result: IRenderable[] = []
    for (const p of this._previews) {
      for (const r of p.renderAnnotations()) {
        result.push(r)
      }
    }
    return result
  }

  /**
   * 此特质不支持空间分区。
   *
   * OpenRA 对照: IRenderAnnotations.SpatiallyPartitionable => false
   */
  get spatiallyPartitionable(): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // IRadarSignature (对应 OpenRA IRadarSignature)
  // ---------------------------------------------------------------------------

  /**
   * 为小地图 / 雷达解析 actor 单元格颜色。
   *
   * OpenRA 对照: IRadarSignature.PopulateRadarSignatureCells(Actor self,
   *   List<(CPos Cell, Color Color)> destinationBuffer)
   *
   * 用每个被占用单元格的预览雷达颜色填充目标缓冲区。
   *
   * @param _self — 世界 actor（未使用）
   * @param destinationBuffer — 要追加到的 (cell, color) 数组
   */
  populateRadarSignatureCells(
    _self: IGameActor,
    destinationBuffer: { cell: CPos; color: number }[],
  ): void {
    for (const preview of this._cellMap.keys) {
      for (const cell of this._occupiedCells(preview)) {
        destinationBuffer.push({ cell, color: preview.radarColor })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Actor 集合管理 — 查询 (对应 OpenRA PreviewsInScreenBox / PreviewsInCellRegion / ...)
  // ---------------------------------------------------------------------------

  /**
   * 获取屏幕框中所有可见的 preview。
   *
   * OpenRA 对照: EditorActorLayer.PreviewsInScreenBox(int2 a, int2 b)
   *   和 PreviewsInScreenBox(Rectangle r)
   */
  previewsInScreenBox(left: number, top: number, right: number, bottom: number): EditorActorPreview[] {
    return this._screenMap.inBox(
      rectFromLTRB(
        Math.min(left, right),
        Math.min(top, bottom),
        Math.max(left, right),
        Math.max(top, bottom),
      ),
    )
  }

  /**
   * 获取在给定单元格区域内所有 preview。
   *
   * OpenRA 对照: EditorActorLayer.PreviewsInCellRegion(CellCoordsRegion region)
   */
  previewsInCellRegion(region: CellCoordsRegion): EditorActorPreview[] {
    return this._cellMap
      .inBox(
        rectFromLTRB(
          region.TopLeft.X - this._cellOffset.x,
          region.TopLeft.Y - this._cellOffset.y,
          region.BottomRight.X - this._cellOffset.x + 1,
          region.BottomRight.Y - this._cellOffset.y + 1,
        ),
      )
      .filter((p) => {
        for (const cell of this._occupiedCells(p)) {
          if (region.contains(cell)) return true
        }
        return false
      })
  }

  /**
   * 获取在特定单元格处堆叠的所有 preview。
   *
   * OpenRA 对照: EditorActorLayer.PreviewsAtCell(CPos cell)
   */
  previewsAtCell(cell: CPos): EditorActorPreview[] {
    return this._cellMap
      .at(cell.X - this._cellOffset.x, cell.Y - this._cellOffset.y)
      .filter((p) => {
        for (const c of this._occupiedCells(p)) {
          if (c.Bits === cell.Bits) return true
        }
        return false
      })
  }

  /**
   * 获取在指定世界像素位置的所有 preview。
   *
   * OpenRA 对照: EditorActorLayer.PreviewsAtWorldPixel(int2 worldPx)
   */
  previewsAtWorldPixel(worldPx: Int2): EditorActorPreview[] {
    return this._screenMap.at(worldPx.x, worldPx.y)
  }

  // ---------------------------------------------------------------------------
  // Actor 集合管理 — 添加 (对应 OpenRA Add / AddRange)
  // ---------------------------------------------------------------------------

  /**
   * 创建一个新的 preview actor 并添加到层中。
   *
   * OpenRA 对照: EditorActorLayer.Add(ActorReference reference)
   *
   * 解析拥有者，生成唯一的 actor ID，创建 EditorActorPreview，
   * 并将其添加到主集合和两个空间索引。
   *
   * @param reference — actor 配置（init 映射）
   * @returns 新创建的 EditorActorPreview
   */
  add(reference: ActorReferenceMap): EditorActorPreview {
    if (!this._worldRenderer) {
      throw new Error(
        'Cannot add preview before worldLoaded() — worldRenderer not set.',
      )
    }
    const owner = this._getOrAddOwner(reference)
    const preview = new EditorActorPreview(
      this._worldRenderer,
      this.nextActorName(),
      reference,
      owner,
      { name: typeof reference.get('type') === 'string' ? (reference.get('type') as string) : 'Actor' },
    )
    this._addSingle(preview)
    return preview
  }

  /**
   * 批量添加 actor（使用提供的名称）。
   *
   * OpenRA 对照: EditorActorLayer.AddRange(ReadOnlySpan<ActorReference>, ReadOnlySpan<string>)
   *
   * 每个 reference 必须有一个对应的名称。批量构建 preview 数组，
   * 然后一次性插入到集合和索引中。
   *
   * @param references — actor 配置数组
   * @param names — 对应的名称数组
   * @throws 如果两个数组长度不相等
   */
  /**
   * @throws Error 如果两个数组长度不相等，或 worldRenderer 未初始化。
   */
  addRangeFromNames(
    references: readonly ActorReferenceMap[],
    names: readonly string[],
  ): void {
    if (names.length !== references.length) {
      throw new Error('Member name count must match reference count.')
    }

    if (!this._worldRenderer) {
      throw new Error(
        'Cannot add previews before worldLoaded() — worldRenderer not set.',
      )
    }

    const newPreviews: EditorActorPreview[] = []
    for (let i = 0; i < names.length; i++) {
      const owner = this._getOrAddOwner(references[i])
      newPreviews.push(
        new EditorActorPreview(
          this._worldRenderer,
          names[i],
          references[i],
          owner,
          { name: typeof references[i].get('type') === 'string' ? (references[i].get('type') as string) : 'Actor' },
        ),
      )
    }
    this._addRangeInternal(newPreviews)
  }

  /**
   * 批量添加 actor，自动生成唯一名称。
   *
   * OpenRA 对照: EditorActorLayer.AddRange(ReadOnlySpan<ActorReference>)
   *
   * 使用 nextActorNames() 为每个 reference 自动生成唯一的 actor ID。
   * 这是编辑器笔刷添加 actor 的首选方法（无需预先确定名称）。
   *
   * @param references — actor 配置数组
   */
  addRange(references: readonly ActorReferenceMap[]): void {
    this.addRangeFromNames(references, this.nextActorNames(references.length))
  }

  /**
   * 批量添加已构建的 preview。
   *
   * OpenRA 对照: EditorActorLayer.AddRange(ReadOnlySpan<EditorActorPreview>)
   *
   * 直接添加一个提前构建的 EditorActorPreview 数组。
   * 用于 copy/paste 和 undo/redo 操作，这些操作中的 preview 已在外部构建。
   *
   * @param previews — 要批量添加的 preview
   */
  addRangePreviews(previews: readonly EditorActorPreview[]): void {
    this._addRangeInternal(previews)
  }

  /**
   * 在此层中添加一个已构建的 preview。
   *
   * OpenRA 对照: EditorActorLayer.Add(EditorActorPreview preview)
   *
   * 直接添加一个提前构建的 EditorActorPreview。
   *
   * @param preview — 要添加的 preview
   */
  addPreview(preview: EditorActorPreview): void {
    this._addSingle(preview)
  }

  // ---------------------------------------------------------------------------
  // Actor 集合管理 — 移除 (对应 OpenRA Remove / RemoveRange / RemoveRegion)
  // ---------------------------------------------------------------------------

  /**
   * 从此层中移除一个 preview。
   *
   * OpenRA 对照: EditorActorLayer.Remove(EditorActorPreview preview)
   *
   * 从主集合和两个空间索引中移除，通知 preview，并更新邻居。
   * 如果移除的是一个 mpspawn actor，还会同步多玩家槽位。
   *
   * @param preview — 要移除的 preview
   */
  remove(preview: EditorActorPreview): void {
    this._removeSingle(preview)

    preview.removedFromEditor()
    this._updateNeighboursForFootprint(preview.footprint)

    if (preview.type === PLAYER_SPAWN_NAME) {
      this._syncMultiplayerCount()
    }
  }

  /**
   * 批量移除 preview。
   *
   * OpenRA 对照: EditorActorLayer.RemoveRange(ReadOnlySpan<EditorActorPreview>)
   */
  removeRange(removePreviews: readonly EditorActorPreview[]): void {
    for (const preview of removePreviews) {
      this._removeSingle(preview)
    }

    for (const preview of removePreviews) {
      preview.removedFromEditor()
    }

    this._updateNeighboursForPreviews(removePreviews)

    this._syncMultiplayerCount()
  }

  /**
   * 移除在一个单元格区域内的所有 actor。
   *
   * OpenRA 对照: EditorActorLayer.RemoveRegion(CellCoordsRegion region)
   */
  removeRegion(region: CellCoordsRegion): void {
    this.removeRange(this.previewsInCellRegion(region))
  }

  /**
   * 移除在一个单元格区域内的所有 actor，仅当它们的脚印与给定掩码重叠时。
   *
   * OpenRA 对照: EditorActorLayer.RemoveRegion(CellCoordsRegion region, HashSet<CPos> mask)
   *
   * @param region — 要检查的区域
   * @param mask — CPos 的 Bits 集合（用于重叠测试）
   */
  removeRegionWithMask(region: CellCoordsRegion, mask: Set<number>): void {
    const toRemove = this.previewsInCellRegion(region).filter((p) => {
      for (const [cell] of p.footprint) {
        if (mask.has(cell.Bits)) return true
      }
      return false
    })
    this.removeRange(toRemove)
  }

  // ---------------------------------------------------------------------------
  // 移动 actor (对应 OpenRA MoveActor)
  // ---------------------------------------------------------------------------

  /**
   * 移动一个 actor 到新的单元格位置。
   *
   * OpenRA 对照: EditorActorLayer.MoveActor(EditorActorPreview preview, CPos location)
   *
   * 移除并重新添加 preview 以更新空间索引和脚印。
   * 如果 actor 支持共享单元格，还会分配一个空闲的子单元格。
   *
   * @param preview — 要移动的 preview
   * @param location — 新的单元格位置
   */
  moveActor(preview: EditorActorPreview, location: CPos): void {
    this._removeSingle(preview)
    preview.replaceInit('LocationInit', {
      type: 'LocationInit',
      value: location,
    })

    // 如果 actor 支持共享单元格，分配空闲的子单元格
    const ios = preview.getInitOrDefault('IOccupySpaceInfo') as {
      sharesCell?: boolean
    } | undefined
    if (ios?.sharesCell) {
      const actorSubCell = this.freeSubCellAt(location)
      if (actorSubCell === SubCell.Invalid) {
        preview.removeInit('SubCellInit')
      } else {
        preview.replaceInit('SubCellInit', {
          type: 'SubCellInit',
          value: actorSubCell,
        })
      }
    }

    preview.updateFromMove()
    this._addSingle(preview)
  }

  // ---------------------------------------------------------------------------
  // 空闲子单元格 (对应 OpenRA FreeSubCellAt)
  // ---------------------------------------------------------------------------

  /**
   * 在指定单元格处查找空闲的子单元格位置。
   *
   * OpenRA 对照: EditorActorLayer.FreeSubCellAt(CPos cell)
   *
   * 如果没有 preview 占据该单元格，返回 DefaultSubCell（FullCell）。
   * 否则，遍历子单元格槽位并返回第一个未被占用的。
   * 如果所有槽位都被占用，返回 SubCell.Invalid。
   *
   * @param cell — 要检查的单元格
   * @returns 空闲的子单元格，或 SubCell.Invalid
   */
  freeSubCellAt(cell: CPos): SubCellEnum {
    const previews = this.previewsAtCell(cell)
    if (previews.length === 0) {
      return SubCell.FullCell
    }

    // 遍历 First(1)..MaxSubCell(5) 寻找空闲槽位
    // TODO-21.A.2-DEFER-8: Replace hardcoded maxSubCell=5 with
    // world.Map.Grid.SubCellOffsets.length - 1. 当前仅支持矩形网格。
    // Isometric 网格有不同数量的子单元格偏移。
    const maxSubCell = 5
    for (let i = SubCell.First; i <= maxSubCell; i++) {
      const blocked = previews.some((p) => {
        const s = p.footprint.get(cell)
        return s !== undefined && s === (i as SubCellEnum)
      })
      if (!blocked) {
        return i as SubCellEnum
      }
    }

    return SubCell.Invalid
  }

  // ---------------------------------------------------------------------------
  // Actor 名称生成 (对应 OpenRA NextActorName / NextActorNames)
  // ---------------------------------------------------------------------------

  /**
   * 生成下一个可用的唯一 actor ID。
   *
   * OpenRA 对照: EditorActorLayer.NextActorName()
   *
   * 格式: "Actor" + 最小的未使用数字后缀（例如 "Actor0", "Actor1", ...）。
   *
   * @returns 唯一的 actor 名称
   */
  nextActorName(): string {
    let currentId = 0
    while (this._previewIds.has(currentId)) {
      currentId++
    }
    return ACTOR_PREFIX + currentId.toString()
  }

  /**
   * 生成一批顺序的、唯一 actor 名称。
   *
   * OpenRA 对照: EditorActorLayer.NextActorNames(int count)
   *
   * 返回 count 个不重复的名称，使用最小的未使用 ID。
   *
   * @param count — 需要的名称数量
   * @returns 唯一 actor 名称的数组
   */
  nextActorNames(count: number): string[] {
    const result: string[] = []
    let remaining = count
    let currentId = 0
    while (remaining > 0) {
      if (!this._previewIds.has(currentId)) {
        result.push(ACTOR_PREFIX + currentId.toString())
        remaining--
      }
      currentId++
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // 保存 (对应 OpenRA Save)
  // ---------------------------------------------------------------------------

  /**
   * 将所有 actor 序列化为 MiniYaml 节点格式。
   *
   * OpenRA 对照: EditorActorLayer.Save() → List<MiniYamlNode>
   *
   * NOTE: 由于 MiniYaml 序列化器尚未完成（TODO-4.H），
   * 返回属性 key-value 数组。每个 entry 是 { key: actorId, value: saveObject }。
   */
  save(): { key: string; value: Record<string, unknown> }[] {
    return this._previews.map((a) => ({
      key: a.id,
      value: a.save(),
    }))
  }

  // ---------------------------------------------------------------------------
  // 基于 ID 的索引器 (对应 OpenRA EditorActorLayer.this[string id])
  // ---------------------------------------------------------------------------

  /**
   * 通过 ID（不区分大小写）按索引获取一个 preview。
   *
   * OpenRA 对照: EditorActorLayer.this[string id] { get }
   *
   * @param id — 要查找的 actor ID
   * @returns 匹配的预览，如果未找到则返回 undefined
   */
  getById(id: string): EditorActorPreview | undefined {
    const lower = id.toLowerCase()
    return this._previews.find((p) => p.id.toLowerCase() === lower)
  }

  // ---------------------------------------------------------------------------
  // 所有 preview 的可迭代访问
  // ---------------------------------------------------------------------------

  /**
   * 获取所有注册的 editor actor preview 的只读数组。
   *
   * OpenRA 对照: (通过 previews 列表隐式访问)
   *
   * @returns 所有 EditorActorPreview 实例
   */
  get all(): readonly EditorActorPreview[] {
    return this._previews
  }

  // ---------------------------------------------------------------------------
  // Dispose / Cleanup
  // ---------------------------------------------------------------------------

  /**
   * 清理所有 preview 和资源。
   *
   * OpenRA 对照: (IDisposable 模式，C# 中无显式 Dispose，但 INotifyActorDisposing
   *   取消订阅事件)
   *
   * 主销毁路径：INotifyActorDisposing.Disposing()。
   * 此方法是用户手动清理的便捷入口。
   */
  dispose(): void {
    // 取消订阅地图变化事件
    if (this._unsubHeight) {
      this._unsubHeight()
      this._unsubHeight = null
    }
    if (this._unsubRamp) {
      this._unsubRamp()
      this._unsubRamp = null
    }

    // 以 O(n) 方式移除所有 preview（反向迭代，避免中间 splice 重排）
    for (let i = this._previews.length - 1; i >= 0; i--) {
      const preview = this._previews[i]
      // 直接从索引中移除（在之后清理数组，无需 splice）
      const actorId = tryGetActorId(preview.id)
      if (actorId.ok) this._previewIds.delete(actorId.id)
      this._screenMap.remove(preview)
      this._cellMap.remove(preview)
      preview.removedFromEditor()
    }
    this._previews.length = 0

    // 清理集合
    this._previewIds.clear()
    this._cellMap.clear()
    this._screenMap.clear()
    this._worldRenderer = null
    this._worldOwner = null
    this.Players = null
    this.onPlayerRemoved = () => {}
  }

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing (对应 OpenRA INotifyActorDisposing.Disposing)
  // ---------------------------------------------------------------------------

  /**
   * 在世界 actor 被 disposing 时，取消订阅地图变化事件。
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor self)
   */
  disposing(_self: IGameActor): void {
    if (this._unsubHeight) {
      this._unsubHeight()
      this._unsubHeight = null
    }
    if (this._unsubRamp) {
      this._unsubRamp()
      this._unsubRamp = null
    }
  }

  // ---------------------------------------------------------------------------
  // 私有：空间索引辅助
  // ---------------------------------------------------------------------------

  /**
   * 获取被一个 preview 占据的单元格。
   *
   * OpenRA 对照: EditorActorLayer.OccupiedCells(EditorActorPreview preview)
   *
   * 如果脚印为空（例如尚未初始化的 actor），回退到通过
   * CenterPosition 推导单元格。
   *
   * PERF: 此方法在 previewsAtCell / previewsInCellRegion 的过滤器内部被调用
   * （每预览一次）。如果分析显示瓶颈，考虑按预览缓存足迹结果，
   * 使用 WeakMap<EditorActorPreview, CPos[]>。
   */
  private _occupiedCells(preview: EditorActorPreview): CPos[] {
    if (preview.footprint.size === 0) {
      // NOTE: C# 调用 worldRenderer.World.Map.CellContaining(preview.CenterPosition)
      // 由于 WorldStub 没有 Map，回退到使用 preview 的 location。
      return [preview.location]
    }
    return [...preview.footprint.keys()]
  }

  // ---------------------------------------------------------------------------
  // 私有：添加 / 移除辅助
  // ---------------------------------------------------------------------------

  /**
   * 解析或分配 actor reference 的拥有者。
   *
   * OpenRA 对照: EditorActorLayer.GetOrAddOwner(ActorReference reference)
   */
  private _getOrAddOwner(reference: ActorReferenceMap): PlayerReference {
    const ownerInit = reference.get('OwnerInit') as OwnerInit | undefined
    if (
      ownerInit &&
      ownerInit.value &&
      this.Players?.players.has(ownerInit.value)
    ) {
      return this.Players.players.get(ownerInit.value)!
    }

    // 回退到世界拥有者
    const owner = this._worldOwner
    if (!owner) {
      throw new Error(
        'Cannot add preview before createPlayers() or worldLoaded(). ' +
        'The editor world owner has not been set.',
      )
    }
    reference.set('OwnerInit', {
      type: 'OwnerInit',
      value: owner.name,
    } satisfies OwnerInit)
    return owner
  }

  /**
   * 将单个 preview 插入主集合和空间索引。
   */
  private _addSingle(preview: EditorActorPreview): void {
    this._previews.push(preview)

    const actorId = tryGetActorId(preview.id)
    if (actorId.ok) {
      this._previewIds.add(actorId.id)
    }

    // Screen map
    if (!isEmptyRect(preview.bounds)) {
      this._screenMap.add(preview, preview.bounds)
    }

    // Cell map
    const occupiedCells = this._occupiedCells(preview)
    const cellRects: Rect[] = occupiedCells.map((cell) => ({
      x: cell.X - this._cellOffset.x,
      y: cell.Y - this._cellOffset.y,
      width: 1,
      height: 1,
    }))
    const cellFootprintBounds = unionRects(cellRects)
    this._cellMap.add(preview, cellFootprintBounds)

    preview.addedToEditor()

    // 更新邻居（单个脚印变体）
    this._updateNeighboursForFootprint(preview.footprint)

    if (preview.type === PLAYER_SPAWN_NAME) {
      this._syncMultiplayerCount()
    }
  }

  /**
   * 从索引中移除单个 preview（不调用 removedFromEditor）。
   */
  private _removeSingle(preview: EditorActorPreview): void {
    const idx = this._previews.indexOf(preview)
    if (idx !== -1) {
      this._previews.splice(idx, 1)
    }

    const actorId = tryGetActorId(preview.id)
    if (actorId.ok) {
      this._previewIds.delete(actorId.id)
    }

    this._screenMap.remove(preview)
    this._cellMap.remove(preview)
  }

  /**
   * 批量插入 preview（内部使用）。
   */
  private _addRangeInternal(newPreviews: readonly EditorActorPreview[]): void {
    for (const preview of newPreviews) {
      this._previews.push(preview)

      const actorId = tryGetActorId(preview.id)
      if (actorId.ok) {
        this._previewIds.add(actorId.id)
      }

      if (!isEmptyRect(preview.bounds)) {
        this._screenMap.add(preview, preview.bounds)
      }

      const occupiedCells = this._occupiedCells(preview)
      const cellRects: Rect[] = occupiedCells.map((cell) => ({
        x: cell.X - this._cellOffset.x,
        y: cell.Y - this._cellOffset.y,
        width: 1,
        height: 1,
      }))
      const cellFootprintBounds = unionRects(cellRects)
      this._cellMap.add(preview, cellFootprintBounds)

      preview.addedToEditor()
    }

    this._updateNeighboursForPreviews(newPreviews)

    this._syncMultiplayerCount()
  }

  // ---------------------------------------------------------------------------
  // 私有：邻居更新 (对应 OpenRA UpdateNeighbours)
  // ---------------------------------------------------------------------------

  /**
   * 更新给定脚印周围的所有邻居 preview。
   *
   * OpenRA 对照: EditorActorLayer.UpdateNeighbours(IReadOnlyDictionary<CPos, SubCell> footprint)
   *
   * 扩展脚印以包含所有相邻单元格，找到任何触及这些单元格的 preview，
   * 并用新邻居数据替换它们的 RuntimeNeighbourInit。
   */
  private _updateNeighboursForFootprint(
    footprint: ReadonlyMap<CPos, SubCellEnum>,
  ): void {
    const footprintKeys = [...footprint.keys()]
    const cells = expandFootprint(footprintKeys, true)

    if (cells.length === 0) return

    // NOTE: C# iterates: cells.SelectMany(PreviewsAtCell).Distinct()
    // (point queries per expanded cell). We use a region query
    // (previewsInCellRegion + filter) for better batching. Both
    // approaches produce the same set of touched previews, but ours
    // avoids per-cell spatial-index lookups in degenerate cases
    // where the expanded footprint spans a large area.
    const bounds = CellCoordsRegion.boundingRegion(cells)
    const touchedPreviews = this.previewsInCellRegion(bounds).filter((p) => {
      for (const cell of cells) {
        for (const [fc] of p.footprint) {
          if (fc.Bits === cell.Bits) return true
        }
      }
      return false
    })

    for (const p of touchedPreviews) {
      const neighbours = this._neighbouringPreviews(p.footprint)
      p.replaceInit('RuntimeNeighbourInit', {
        type: 'RuntimeNeighbourInit',
        value: neighbours,
      })
    }
  }

  /**
   * 基于一组 preview 脚印更新邻居。
   *
   * OpenRA 对照: EditorActorLayer.UpdateNeighbours(ReadOnlySpan<EditorActorPreview>)
   */
  private _updateNeighboursForPreviews(
    previews: readonly EditorActorPreview[],
  ): void {
    const allCells = new CPosSet()
    for (const preview of previews) {
      allCells.unionWith(expandFootprint(preview.footprint.keys(), true))
    }

    if (allCells.size === 0) return

    const cellsArr = allCells.values()
    const bounds = CellCoordsRegion.boundingRegion(cellsArr)
    const touchedPreviews = this.previewsInCellRegion(bounds).filter((p) => {
      for (const [fc] of p.footprint) {
        if (allCells.has(fc)) return true
      }
      return false
    })

    for (const p of touchedPreviews) {
      const neighbours = this._neighbouringPreviews(p.footprint)
      p.replaceInit('RuntimeNeighbourInit', {
        type: 'RuntimeNeighbourInit',
        value: neighbours,
      })
    }
  }

  /**
   * 计算脚印的邻居 actor 类型名称。
   *
   * OpenRA 对照: EditorActorLayer.NeighbouringPreviews(
   *   IReadOnlyDictionary<CPos, SubCell> footprint)
   *
   * 返回一个从单元格键到该单元格处 actor 类型名称数组的映射。
   * 仅包含脚印外部的相邻格（不包括脚印自身）。
   */
  private _neighbouringPreviews(
    footprint: ReadonlyMap<CPos, SubCellEnum>,
  ): Map<string, string[]> {
    const footprintKeys = [...footprint.keys()]
    const expanded = expandFootprint(footprintKeys, true)
    const footprintSet = new Set<number>()
    for (const c of footprintKeys) footprintSet.add(c.Bits)

    // 仅保留脚印外部的单元格
    const borderCells = expanded.filter((c) => !footprintSet.has(c.Bits))

    const result = new Map<string, string[]>()
    for (const cell of borderCells) {
      const previews = this.previewsAtCell(cell)
      result.set(
        `${cell.X},${cell.Y}`,
        previews.map((p) => p.info.name),
      )
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // 私有：多玩家计数同步 (对应 OpenRA SyncMultiplayerCount)
  // ---------------------------------------------------------------------------

  /**
   * 根据 mpspawn actor 的数量同步 MultiX 玩家槽位。
   *
   * OpenRA 对照: EditorActorLayer.SyncMultiplayerCount()
   *
   * 移除索引超出新计数的 MultiX 玩家，为缺失的槽位创建新的
   * MultiX 玩家引用，并更新 Creeps 的敌人列表。
   */
  private _syncMultiplayerCount(): void {
    if (!this.Players) return

    const newCount = this._previews.filter(
      (p) => p.type === PLAYER_SPAWN_NAME,
    ).length
    let playersChanged = false

    // 移除索引 >= newCount 的 MultiX 玩家
    for (const [name] of this.Players.players) {
      if (!name.startsWith('Multi')) continue
      const index = Number(name.slice(5))
      if (Number.isNaN(index)) continue

      if (index >= newCount) {
        this.Players.players.delete(name)
        this.onPlayerRemoved()
        playersChanged = true
      }
    }

    // 添加缺失的 MultiX 玩家
    for (let index = 0; index < newCount; index++) {
      const name = `Multi${index}`
      if (this.Players.players.has(name)) continue

      const pr = new PlayerReference({
        name,
        faction: 'Random',
        playable: true,
        enemies: ['Creeps'],
      })
      this.Players.players.set(pr.name, pr)

      // 更新调色板
      const wrUpdate = this._worldRenderer as Record<string, unknown> | null
      if (wrUpdate?.updatePalettesForPlayer) {
        ;(wrUpdate.updatePalettesForPlayer as (
          name: string,
          color: number,
          force: boolean,
        ) => void)(pr.name, pr.color, true)
      }
      playersChanged = true
    }

    if (!playersChanged) return

    // 更新 Creeps 的敌人列表以包含所有非战斗玩家
    const creepsKey = [...this.Players.players.keys()].find(
      (k) => k === 'Creeps',
    )
    if (creepsKey) {
      this.Players.players.get(creepsKey)!.enemies = [
        ...this.Players.players.keys(),
      ].filter((k) => {
        const p = this.Players!.players.get(k)
        return p && !p.nonCombatant
      })
    }
  }

  // ---------------------------------------------------------------------------
  // 私有：地图变化回调 (对应 OpenRA UpdatePreviewsOnMapChange)
  // ---------------------------------------------------------------------------

  /**
   * 当地形在给定单元格处变化时，更新所有受影响的 preview。
   *
   * OpenRA 对照: EditorActorLayer.UpdatePreviewsOnMapChange(CPos changedCell)
   */
  private _updatePreviewsOnMapChange(changedCell: CPos): void {
    for (const preview of this.previewsAtCell(changedCell)) {
      preview.updateFromCellChange()
    }
  }
}
