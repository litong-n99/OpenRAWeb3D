/**
 * WithCargo.ts — 运输单位货物/乘客可见渲染
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/WithCargo.cs (143 lines)
 *
 * 核心范式转换:
 * - C# ITick + IRender + INotifyPassengerEntered + INotifyPassengerExited → TS four interfaces
 * - C# BodyOrientation.QuantizeOrientation / LocalToWorld → TS duck-typed transform
 * - C# yield return IRenderable → TS array accumulation
 */

import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Duck-typed interfaces
// ---------------------------------------------------------------------------

export interface ICargoBodyOrientation {
  quantizeOrientation(orientation: unknown): number
  quantizeFacing(facing: WAngle): number
  localToWorld(wvec: WVec): WVec
}

export interface ICargoFacing {
  readonly facing: WAngle
}

export interface ICargoAccess {
  readonly passengerCount: number
}

export interface IPassengerAccess {
  readonly info: { readonly cargoType: string }
}

export interface IActorPreview {
  tick(): void
  render(wr: unknown, pos: { readonly x: number; readonly y: number; readonly z: number }): unknown[]
  screenBounds(wr: unknown, pos: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number; width: number; height: number }[]
}

// ---------------------------------------------------------------------------
// WithCargoInfo
// ---------------------------------------------------------------------------

export class WithCargoInfo implements ITraitInfo {
  readonly instanceName?: string
  readonly localOffset: readonly WVec[]
  readonly displayTypes: ReadonlySet<string>

  constructor(params: {
    instanceName?: string
    localOffset?: readonly WVec[]
    displayTypes?: ReadonlySet<string>
  } = {}) {
    this.instanceName = params.instanceName
    this.localOffset = params.localOffset ?? [WVec.Zero]
    this.displayTypes = params.displayTypes ?? new Set()
  }

  create(init: IGameActor): WithCargo {
    return new WithCargo(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithCargo
// ---------------------------------------------------------------------------

export class WithCargo {
  readonly info: WithCargoInfo
  private readonly _cargo: ICargoAccess
  private readonly _body: ICargoBodyOrientation
  private readonly _facing: ICargoFacing | null
  private _previews = new Map<string, IActorPreview[] | null>()
  private _cachedFacing: WAngle = WAngle.Zero

  constructor(self: IGameActor, info: WithCargoInfo) {
    this.info = info
    this._cargo = (self as any).trait?.('Cargo') as ICargoAccess
    this._body = (self as any).trait?.('BodyOrientation') as ICargoBodyOrientation
    this._facing = (self as any).traitOrDefault?.('IFacing') as ICargoFacing | null ?? null
  }

  tick(self: IGameActor): void {
    for (const previews of this._previews.values()) {
      if (previews) {
        for (const preview of previews) {
          preview.tick()
        }
      }
    }

    if (
      this._facing &&
      this._facing.facing.angle !== this._cachedFacing.angle &&
      this._previews.size > 0
    ) {
      const screenMap = (self as any).world?.screenMap
      if (screenMap) screenMap.addOrUpdate(self)
      this._cachedFacing = this._facing.facing
    }
  }

  render(self: IGameActor, wr: unknown): unknown[] {
    const bodyOrientation = this._body.quantizeOrientation(
      (self as any).orientation,
    )
    const centerPos = (self as any).centerPosition as {
      readonly X: number; readonly Y: number; readonly Z: number
    }
    const result: unknown[] = []
    let passengerIndex = 0

    // Generate missing previews
    const missing: string[] = []
    for (const [key, previews] of this._previews) {
      if (!previews) missing.push(key)
    }
    for (const passengerKey of missing) {
      const previews = this.generatePreview(passengerKey, wr)
      if (previews) this._previews.set(passengerKey, previews)
    }

    for (const actorPreviews of this._previews.values()) {
      if (!actorPreviews) continue

      for (const p of actorPreviews) {
        const index =
          this._cargo.passengerCount > 1
            ? passengerIndex++ % this.info.localOffset.length
            : Math.floor(this.info.localOffset.length / 2)
        const localOffset = this.info.localOffset[index]!

        const worldPos = this._body.localToWorld(localOffset)
        const renderPos = {
          x: centerPos.X + worldPos.X,
          y: centerPos.Y + worldPos.Y,
          z: centerPos.Z + worldPos.Z,
        }

        for (const renderable of p.render(wr, renderPos)) {
          result.push({ ...(renderable as Record<string, unknown>), _zOffset: 1 } as unknown)
        }
      }
    }

    void bodyOrientation
    return result
  }

  screenBounds(self: IGameActor, wr: unknown): { x: number; y: number; width: number; height: number }[] {
    const centerPos = (self as any).centerPosition as { readonly X: number; readonly Y: number; readonly Z: number }
    const result: { x: number; y: number; width: number; height: number }[] = []
    for (const actorPreviews of this._previews.values()) {
      if (!actorPreviews) continue
      for (const p of actorPreviews) {
        const pos = { x: centerPos.X, y: centerPos.Y, z: centerPos.Z }
        for (const b of p.screenBounds(wr, pos)) {
          result.push(b)
        }
      }
    }
    return result
  }

  onPassengerEntered(self: IGameActor, passenger: IGameActor): void {
    const passengerTrait = (passenger as any).trait?.('Passenger') as IPassengerAccess | undefined
    if (passengerTrait && this.info.displayTypes.has(passengerTrait.info.cargoType)) {
      this._previews.set((passenger as any).actorId ?? 'unknown', null)
      const screenMap = (self as any).world?.screenMap
      if (screenMap) screenMap.addOrUpdate(self)
    }
  }

  onPassengerExited(self: IGameActor, passenger: IGameActor): void {
    this._previews.delete((passenger as any).actorId ?? 'unknown')
    const screenMap = (self as any).world?.screenMap
    if (screenMap) screenMap.addOrUpdate(self)
  }

  private generatePreview(_key: string, _wr: unknown): IActorPreview[] | null {
    return []
  }

  get passengerCount(): number { return this._previews.size }
  get previews(): ReadonlyMap<string, IActorPreview[] | null> { return this._previews }
  setPreviews(previews: Map<string, IActorPreview[] | null>): void { this._previews = previews }

  dispose(): void { this._previews.clear() }
}
