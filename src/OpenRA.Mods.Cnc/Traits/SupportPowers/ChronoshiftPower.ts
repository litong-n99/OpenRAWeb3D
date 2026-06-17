/**
 * ChronoshiftPower.ts — 超时空传送支援能力
 * OpenRA 对照: OpenRA.OpenRA.Mods.Cnc/Traits/SupportPowers/ChronoshiftPower.cs (394 lines)
 *
 * 核心范式转换:
 * - C# sealed class ChronoshiftPower : SupportPower → TS extends SupportPower
 * - C# inner sealed class SelectChronoshiftTarget : OrderGenerator → TS 独立顶层类
 * - C# inner sealed class SelectDestination : OrderGenerator → TS 独立顶层类
 * - C# IEnumerable<IRenderable> yield return → TS Generator<IRenderable>
 * - C# ref struct / float3 → TS Float3 字面量 {x,y,z}
 * - C# SpriteRenderable(ZOffset:-511, IsDecoration:true) → TS 同样参数对象构造
 * - C# Target.FromCell → TS Target.fromCell()
 *
 * ADR-19.5: 传送延迟 — Teleport Activity 在帧结束时执行。
 *
 * NOTE: Chronoshiftable forward ref — Chronoshiftable (TODO-19.A.1) 尚未迁移，
 * 使用接口桩代替。
 * NOTE: 使用 `any` 绕过不完整的 Stub 接口 (WorldStub/IGameActor/PlayerStub)。
 *   当完整实现可用时，这些 any 转换将被移除。
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type OrderStub,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type {
  ISupportPowerManager,
} from '../../../OpenRA.Mods.Common/Traits/SupportPowers/SupportPower.js'
import type {
  IGameActor,
  WorldRendererStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Forward stub for not-yet-migrated Chronoshiftable (TODO-19.A.1)
// ---------------------------------------------------------------------------

export interface IChronoshiftableStub {
  readonly isTraitDisabled: boolean
  canChronoshiftTo(target: IGameActor, targetCell: CPos): boolean
  teleport(
    target: IGameActor,
    targetCell: CPos,
    duration: number,
    killCargo: boolean,
    chronosphere: IGameActor,
  ): void
}

// ---------------------------------------------------------------------------
// Shared rendering stubs
// ---------------------------------------------------------------------------

interface ISpriteStub {
  readonly sheet: any
  readonly bounds: any
  readonly channel: any
  readonly blendMode: string
}

export interface ISequenceStub {
  getSprite(frame: number): ISpriteStub
  getAlpha(frame: number): number
  readonly scale: number
  readonly ignoreWorldTint: boolean
}

interface IPaletteStub { /* marker */ }

interface ISeqProvider {
  getSequence(image: string, sequence: string): ISequenceStub
  hasSequence(image: string, sequence: string): boolean
}

interface SpriteRenderableOpts {
  sprite: ISpriteStub
  pos: { X: number; Y: number; Z: number }
  offset: { X: number; Y: number; Z: number }
  zOffset: number
  palette: IPaletteStub
  scale: number
  alpha: number
  tint: { x: number; y: number; z: number }
  tintModifiers: number
  isDecoration: boolean
}

interface IRenderableExt {
  offsetBy?: (o: { X: number; Y: number; Z: number }) => IRenderableExt
}

function mkRenderable(opts: SpriteRenderableOpts): IRenderableExt {
  return opts as any
}

const Float3Ones = { x: 1, y: 1, z: 1 }
const TintModifiers = { None: 0, IgnoreWorldTint: 1 } as const

// ---------------------------------------------------------------------------
// ChronoshiftPowerInfo
// ---------------------------------------------------------------------------

export interface ChronoshiftPowerInfo extends SupportPowerInfo {
  readonly dimensions: CVec
  readonly footprint: string
  readonly duration: number
  readonly targetOverlayPalette: string
  readonly footprintImage: string
  readonly validFootprintSequence: string
  readonly invalidFootprintSequence: string
  readonly sourceFootprintSequence: string
  readonly killCargo: boolean
  readonly selectionCursor: string
  readonly targetCursor: string
  readonly targetBlockedCursor: string
}

const ciDefaults = {
  duration: 750,
  targetOverlayPalette: 'terrain',
  footprintImage: 'overlay',
  validFootprintSequence: 'target-valid',
  invalidFootprintSequence: 'target-invalid',
  sourceFootprintSequence: 'target-select',
  killCargo: true,
  selectionCursor: 'chrono-select',
  targetCursor: 'chrono-target',
  targetBlockedCursor: 'move-blocked',
} as const

export function createChronoshiftPowerInfo(
  overrides: Partial<ChronoshiftPowerInfo> & { dimensions: CVec; footprint: string },
): ChronoshiftPowerInfo {
  return {
    chargeInterval: 0,
    orderName: 'ChronoshiftPowerOrder',
    dimensions: overrides.dimensions,
    footprint: overrides.footprint,
    duration: overrides.duration ?? ciDefaults.duration,
    targetOverlayPalette: overrides.targetOverlayPalette ?? ciDefaults.targetOverlayPalette,
    footprintImage: overrides.footprintImage ?? ciDefaults.footprintImage,
    validFootprintSequence: overrides.validFootprintSequence ?? ciDefaults.validFootprintSequence,
    invalidFootprintSequence: overrides.invalidFootprintSequence ?? ciDefaults.invalidFootprintSequence,
    sourceFootprintSequence: overrides.sourceFootprintSequence ?? ciDefaults.sourceFootprintSequence,
    killCargo: overrides.killCargo ?? ciDefaults.killCargo,
    selectionCursor: overrides.selectionCursor ?? ciDefaults.selectionCursor,
    targetCursor: overrides.targetCursor ?? ciDefaults.targetCursor,
    targetBlockedCursor: overrides.targetBlockedCursor ?? ciDefaults.targetBlockedCursor,
  } as ChronoshiftPowerInfo
}

// ---------------------------------------------------------------------------
// ChronoshiftPower
// ---------------------------------------------------------------------------

export class ChronoshiftPower extends SupportPower {
  private readonly _fp: string[]
  private readonly _dims: CVec

  constructor(self: IGameActor, info: ChronoshiftPowerInfo) {
    super(self, info)
    this._fp = [...info.footprint].filter((c) => !/\s/.test(c))
    this._dims = info.dimensions
  }

  override selectTarget(self: IGameActor, order: string, manager: ISupportPowerManager): void {
    const w = (self as any).world as any
    if (w) w.setOrderGenerator(new SelectChronoshiftTarget(w as any, order, manager, this))
  }

  override activate(self: IGameActor, order: OrderStub, manager: ISupportPowerManager): void {
    super.activate(self, order, manager)
    this.playLaunchSounds()

    const info = this.info as ChronoshiftPowerInfo
    const w = (self as any).world as any
    if (!w || !order.target?.centerPosition || !order.target?.cell) return

    const srcLoc = (order as any).extraLocation as CPos | undefined
    if (!srcLoc) return

    const tgtCell = w.map.cellContaining(order.target.centerPosition) as CPos
    const delta = new CPos(tgtCell.X - srcLoc.X, tgtCell.Y - srcLoc.Y)
    const owner = (self as any).owner as any

    for (const t of this.unitsInRange(srcLoc)) {
      const cs = ((t as any).traitsImplementing?.('Chronoshiftable') as IChronoshiftableStub[])
        ?.find((x) => !x.isTraitDisabled)
      if (!cs) continue

      const loc = (t as any).location as CPos
      const dest = new CPos(loc.X + delta.X, loc.Y + delta.Y)

      if (owner?.shroud?.isExplored(dest) && cs.canChronoshiftTo(t, dest)) {
        cs.teleport(t, dest, info.duration, info.killCargo, self)
      }
    }
  }

  unitsInRange(xy: CPos): IGameActor[] {
    const tiles = SupportPower.cellsMatching(xy, this._fp, this._dims)
    const set = new Set<IGameActor>()
    const w = (this.self as any).world as any

    if (w?.actorMap) {
      for (const t of tiles) {
        const actors = (w.actorMap.getActorsAt(t) ?? []) as IGameActor[]
        for (const a of actors) set.add(a)
      }
    }

    return [...set].filter((a) => {
      const traits = (a as any).traitsImplementing?.('Chronoshiftable') as IChronoshiftableStub[] | undefined
      return traits?.some((cs) => !cs.isTraitDisabled)
    })
  }

  similarTerrain(xy: CPos, srcLoc: CPos): boolean {
    const owner = (this.self as any).owner as any
    if (!owner?.shroud?.isExplored(xy)) return false

    const srcTiles = SupportPower.cellsMatching(srcLoc, this._fp, this._dims)
    const dstTiles = SupportPower.cellsMatching(xy, this._fp, this._dims)
    if (srcTiles.length === 0 || dstTiles.length === 0) return false

    const w = (this.self as any).world as any
    for (let i = 0; i < srcTiles.length && i < dstTiles.length; i++) {
      const a = srcTiles[i], b = dstTiles[i]
      if (!owner.shroud.isExplored(a) || !owner.shroud.isExplored(b)) return false
      if (w?.map?.getTerrainIndex?.(a) !== w?.map?.getTerrainIndex?.(b)) return false
    }
    return true
  }

  get footprintPattern(): string[] { return this._fp }
  get dimensions(): CVec { return this._dims }
}

// ---------------------------------------------------------------------------
// SelectChronoshiftTarget — Stage 1
// ---------------------------------------------------------------------------

export class SelectChronoshiftTarget {
  readonly orderGeneratorKey = 'SelectChronoshiftTarget'
  private readonly _p: ChronoshiftPower
  private readonly _fp: string[]
  private readonly _dims: CVec
  private readonly _tile: ISpriteStub | null
  private readonly _alpha: number
  private readonly _mgr: ISupportPowerManager
  private readonly _order: string
  private readonly _w: any

  constructor(w: any, order: string, mgr: ISupportPowerManager, power: ChronoshiftPower) {
    this._w = w; this._mgr = mgr; this._order = order; this._p = power
    const info = power.info as ChronoshiftPowerInfo
    this._fp = power.footprintPattern; this._dims = info.dimensions

    const seq = (w as any).map?.sequences as ISeqProvider | undefined
    if (seq) {
      const s = seq.getSequence(info.footprintImage, info.sourceFootprintSequence)
      this._tile = s.getSprite(0); this._alpha = s.getAlpha(0)
    } else {
      this._tile = null; this._alpha = 1
    }
  }

  tick(): void {
    const p = this._mgr.powers.get(this._order)
    if (!p || !p.active || !p.ready) (this._w as any).cancelInputMode?.()
  }

  *orderInner(cell: CPos): Generator<never> {
    ;(this._w as any).cancelInputMode?.()
    ;(this._w as any).setOrderGenerator?.(
      new SelectDestination(this._w, this._order, this._mgr, this._p, cell),
    )
  }

  getCursor(): string { return (this._p.info as ChronoshiftPowerInfo).selectionCursor }

  *render(wr: WorldRendererStub): Generator<IRenderableExt> {
    if (!this._tile) return
    const xy = (wr as any).viewport?.viewToWorld?.(0, 0) as CPos | undefined
    if (!xy) return
    const tiles = SupportPower.cellsMatching(xy, this._fp, this._dims)
    const pal = (wr as any).palette?.((this._p.info as ChronoshiftPowerInfo).targetOverlayPalette) as IPaletteStub
    for (const t of tiles) {
      const c = this._w.map.centerOfCell?.(t) ?? { X: t.X * 1024, Y: t.Y * 1024, Z: 0 }
      yield mkRenderable({
        sprite: this._tile, pos: c, offset: { X: 0, Y: 0, Z: 0 },
        zOffset: -511, palette: pal, scale: 1, alpha: this._alpha,
        tint: Float3Ones, tintModifiers: TintModifiers.IgnoreWorldTint, isDecoration: true,
      })
    }
  }

  *renderAboveShroud(): Generator<IRenderableExt> { /* yield break */ }
  *renderAnnotations(_wr: WorldRendererStub): Generator<IRenderableExt> { /* stub */ }
}

// ---------------------------------------------------------------------------
// SelectDestination — Stage 2
// ---------------------------------------------------------------------------

export class SelectDestination {
  readonly orderGeneratorKey = 'SelectDestination'
  private readonly _p: ChronoshiftPower
  private readonly _src: CPos
  private readonly _fp: string[]
  private readonly _dims: CVec
  private readonly _vTile: ISpriteStub | null
  private readonly _iTile: ISpriteStub | null
  private readonly _sTile: ISpriteStub | null
  private readonly _vAlpha: number
  private readonly _iAlpha: number
  private readonly _sAlpha: number
  private readonly _mgr: ISupportPowerManager
  private readonly _order: string
  private readonly _w: any

  constructor(w: any, order: string, mgr: ISupportPowerManager, power: ChronoshiftPower, src: CPos) {
    this._w = w; this._mgr = mgr; this._order = order; this._p = power; this._src = src
    const info = power.info as ChronoshiftPowerInfo
    this._fp = power.footprintPattern; this._dims = info.dimensions

    const seq = (w as any).map?.sequences as ISeqProvider | undefined
    if (seq) {
      const ts = `${info.validFootprintSequence}-${((w as any).map?.tileset ?? '').toLowerCase()}`
      if (seq.hasSequence(info.footprintImage, ts)) {
        const vs = seq.getSequence(info.footprintImage, ts)
        this._vTile = vs.getSprite(0); this._vAlpha = vs.getAlpha(0)
      } else {
        const vs = seq.getSequence(info.footprintImage, info.validFootprintSequence)
        this._vTile = vs.getSprite(0); this._vAlpha = vs.getAlpha(0)
      }
      const iv = seq.getSequence(info.footprintImage, info.invalidFootprintSequence)
      this._iTile = iv.getSprite(0); this._iAlpha = iv.getAlpha(0)
      const sv = seq.getSequence(info.footprintImage, info.sourceFootprintSequence)
      this._sTile = sv.getSprite(0); this._sAlpha = sv.getAlpha(0)
    } else {
      this._vTile = this._iTile = this._sTile = null
      this._vAlpha = this._iAlpha = this._sAlpha = 1
    }
  }

  tick(): void {
    const p = this._mgr.powers.get(this._order)
    if (!p || !p.active || !p.ready) (this._w as any).cancelInputMode?.()
  }

  *orderInner(cell: CPos): Generator<any> {
    if (this._isValid(cell)) {
      ;(this._w as any).cancelInputMode?.()
      yield {
        orderName: this._order,
        subject: this._mgr.self,
        target: { type: 1, centerPosition: undefined, cell },
        queued: false,
        extraLocation: this._src,
        suppressVisualFeedback: true,
      }
    }
  }

  private _isValid(xy: CPos): boolean {
    let canTeleport = false, anyUnits = false
    const owner = (this._mgr.self as any).owner as any
    if (!owner) return false

    for (const u of this._p.unitsInRange(this._src)) {
      anyUnits = true
      const loc = (u as any).location as CPos
      const tgt = new CPos(loc.X + (xy.X - this._src.X), loc.Y + (xy.Y - this._src.Y))
      if (owner.shroud?.isExplored?.(tgt)) {
        const cs = ((u as any).traitsImplementing?.('Chronoshiftable') as IChronoshiftableStub[])
          ?.find((x) => !x.isTraitDisabled)
        if (cs?.canChronoshiftTo(u, tgt)) { canTeleport = true; break }
      }
    }
    if (!anyUnits) return false
    if (!canTeleport) canTeleport = this._p.similarTerrain(this._src, xy)
    return canTeleport
  }

  getCursor(cell: CPos): string {
    const info = this._p.info as ChronoshiftPowerInfo
    return this._isValid(cell) ? info.targetCursor : info.targetBlockedCursor
  }

  *renderAboveShroud(wr: WorldRendererStub): Generator<IRenderableExt> {
    const xy = (wr as any).viewport?.viewToWorld?.(0, 0) as CPos | undefined
    if (!xy) return
    const pal = (wr as any).palette?.((this._p.info as any).iconPalette ?? 'terrain') as IPaletteStub
    const owner = (this._mgr.self as any).owner as any
    const delta = new CPos(xy.X - this._src.X, xy.Y - this._src.Y)

    // Destination tiles
    for (const t of SupportPower.cellsMatching(this._src, this._fp, this._dims)) {
      const proj = new CPos(t.X + delta.X, t.Y + delta.Y)
      const ok = owner?.shroud?.isExplored?.(proj)
      const tile = ok ? this._vTile : this._iTile
      const alpha = ok ? this._vAlpha : this._iAlpha
      if (!tile) continue
      yield mkRenderable({
        sprite: tile, pos: this._w.map.centerOfCell?.(proj) ?? { X: proj.X * 1024, Y: proj.Y * 1024, Z: 0 },
        offset: { X: 0, Y: 0, Z: 0 }, zOffset: -511, palette: pal, scale: 1, alpha,
        tint: Float3Ones, tintModifiers: TintModifiers.IgnoreWorldTint, isDecoration: true,
      })
    }

    // Unit previews
    for (const u of this._p.unitsInRange(this._src)) {
      if (!(u as any).canBeViewedByPlayer?.(owner)) continue
      const loc = (u as any).location as CPos
      const tgt = new CPos(loc.X + delta.X, loc.Y + delta.Y)
      const canEnter = owner?.shroud?.isExplored?.(tgt)

      let tile: ISpriteStub | null; let alpha: number
      if (canEnter) {
        const cs = ((u as any).traitsImplementing?.('Chronoshiftable') as IChronoshiftableStub[])
          ?.find((x) => !x.isTraitDisabled)
        const ok = cs?.canChronoshiftTo(u, tgt) ?? false
        tile = ok ? this._vTile : this._iTile; alpha = ok ? this._vAlpha : this._iAlpha
      } else { tile = this._iTile; alpha = this._iAlpha }

      if (tile) {
        yield mkRenderable({
          sprite: tile, pos: this._w.map.centerOfCell?.(tgt) ?? { X: tgt.X * 1024, Y: tgt.Y * 1024, Z: 0 },
          offset: { X: 0, Y: 0, Z: 0 }, zOffset: -511, palette: pal, scale: 1, alpha,
          tint: Float3Ones, tintModifiers: TintModifiers.IgnoreWorldTint, isDecoration: true,
        })
      }

      // Offset rendering
      const sc = this._w.map.centerOfCell?.(this._src) ?? { X: this._src.X * 1024, Y: this._src.Y * 1024, Z: 0 }
      const dc = this._w.map.centerOfCell?.(xy) ?? { X: xy.X * 1024, Y: xy.Y * 1024, Z: 0 }
      const off = { X: dc.X - sc.X, Y: dc.Y - sc.Y, Z: dc.Z - sc.Z }
      for (const r of ((u as any).render?.(wr) ?? []) as IRenderableExt[]) {
        if (r.offsetBy) yield r.offsetBy(off)
      }
    }
  }

  *render(wr: WorldRendererStub): Generator<IRenderableExt> {
    if (!this._sTile) return
    const pal = (wr as any).palette?.((this._p.info as any).iconPalette ?? 'terrain') as IPaletteStub
    for (const t of SupportPower.cellsMatching(this._src, this._fp, this._dims)) {
      yield mkRenderable({
        sprite: this._sTile, pos: this._w.map.centerOfCell?.(t) ?? { X: t.X * 1024, Y: t.Y * 1024, Z: 0 },
        offset: { X: 0, Y: 0, Z: 0 }, zOffset: -511, palette: pal, scale: 1, alpha: this._sAlpha,
        tint: Float3Ones, tintModifiers: TintModifiers.IgnoreWorldTint, isDecoration: true,
      })
    }
  }

  *renderAnnotations(_wr: WorldRendererStub): Generator<IRenderableExt> { /* stub */ }
}
