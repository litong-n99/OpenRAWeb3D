/**
 * WithCargo.ts — Transport unit cargo/passenger visible rendering
 * OpenRA reference: OpenRA.Mods.Cnc/Traits/Render/WithCargo.cs (143 lines)
 *
 * Paradigm mapping:
 * - C# ITick + IRender + INotifyPassengerEntered + INotifyPassengerExited -> TS four interfaces
 * - C# BodyOrientation.QuantizeOrientation / LocalToWorld -> TS duck-typed transform
 * - C# yield return IRenderable -> TS array accumulation
 * - C# TypeDictionary + ActorPreviewInitializer -> TS duck-typed init Map + preview builder
 *   (Phase B.10: implemented real passenger preview generation)
 */

import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IGameActor, ITraitInfo, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

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

/** Minimal IRenderActorPreviewInfo — generates preview renderables for an actor.
 *
 * OpenRA reference: IRenderActorPreviewInfo
 */
export interface ICargoRenderActorPreviewInfo {
  renderPreview(init: ICargoActorPreviewInitializer): Iterable<IActorPreview>
}

/** Minimal ActorPreviewInitializer for cargo previews.
 *
 * OpenRA reference: ActorPreviewInitializer
 */
export interface ICargoActorPreviewInitializer {
  readonly actor: { traitInfo(name: string): unknown; traitInfos(name: string): Iterable<unknown> }
  readonly worldRenderer: unknown
  contains(key: string): boolean
  getValue(key: string, fallback?: unknown): unknown
}

/** Minimal IActorPreviewInitModifier for passenger init customization.
 *
 * OpenRA reference: IActorPreviewInitModifier
 */
export interface ICargoActorPreviewInitModifier {
  modifyActorPreviewInit(actor: IGameActor, inits: Map<string, unknown>): void
}

// ---------------------------------------------------------------------------
// CargoPassengerPreview — a preview renderable for one passenger
// OpenRA reference: SpriteActorPreview generated via IRenderActorPreviewInfo
// ---------------------------------------------------------------------------

/**
 * Renders a passenger preview inside a transport unit.
 *
 * OpenRA reference: IActorPreview from passenger's IRenderActorPreviewInfo traits
 *
 * Each passenger gets a preview renderable at the appropriate offset inside
 * the transport, using the passenger's owner and facing.
 */
export class CargoPassengerPreview implements IActorPreview {
  /** The passenger's actor type name. */
  readonly actorName: string
  /** The passenger's owner (for color palette). */
  readonly owner: PlayerStub | undefined
  /** Dynamic facing callback. */
  readonly getFacing: () => WAngle
  /** Any init modifiers applied. */
  readonly modifiers: readonly IActorPreviewInitModifierMeta[]

  constructor(
    actorName: string,
    owner: PlayerStub | undefined,
    getFacing: () => WAngle,
    modifiers: readonly IActorPreviewInitModifierMeta[] = [],
  ) {
    this.actorName = actorName
    this.owner = owner
    this.getFacing = getFacing
    this.modifiers = modifiers
  }

  tick(): void {
    // Animation tick — would advance passenger sprite frames.
  }

  render(_wr: unknown, _pos: { readonly x: number; readonly y: number; readonly z: number }): unknown[] {
    // Returns passenger preview renderable entries.
    return [{
      type: 'cargoPassenger',
      actorName: this.actorName,
      owner: this.owner,
      facing: this.getFacing(),
      modifiers: this.modifiers,
    }]
  }

  screenBounds(_wr: unknown, _pos: { readonly x: number; readonly y: number; readonly z: number }): { x: number; y: number; width: number; height: number }[] {
    return [{ x: 0, y: 0, width: 1, height: 1 }]
  }
}

/** Metadata about an init modifier applied to a passenger preview. */
export interface IActorPreviewInitModifierMeta {
  readonly type: string
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
  private _passengerActors = new Map<string, IGameActor>()
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
    // NOTE: centerPos.X/Y/Z uses uppercase to match OpenRA WPos struct convention
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
    // NOTE: centerPos.X/Y/Z uses uppercase to match OpenRA WPos struct convention
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
      const key = (passenger as any).actorId ?? 'unknown'
      this._previews.set(key, null)
      this._passengerActors.set(key, passenger)
      const screenMap = (self as any).world?.screenMap
      if (screenMap) screenMap.addOrUpdate(self)
    }
  }

  onPassengerExited(self: IGameActor, passenger: IGameActor): void {
    const key = (passenger as any).actorId ?? 'unknown'
    this._previews.delete(key)
    this._passengerActors.delete(key)
    const screenMap = (self as any).world?.screenMap
    if (screenMap) screenMap.addOrUpdate(self)
  }

  /** Generate preview renderables for a passenger.
   *
   * OpenRA reference: WithCargo.Render — generates IActorPreview[] via
   *   p.Info.TraitInfos<IRenderActorPreviewInfo>()
   *     .SelectMany(rpi => rpi.RenderPreview(init))
   *
   * Phase B.10: Creates passenger preview renderables using the passenger's
   * owner, facing, and IActorPreviewInitModifier hooks.
   *
   * @param key — the passenger actor ID string
   * @param _wr — the world renderer (unused, preview metadata doesn't need GPU)
   * @returns array of IActorPreview for this passenger, or null if no previews
   */
  private generatePreview(key: string, _wr: unknown): IActorPreview[] | null {
    const passenger = this._passengerActors.get(key)
    if (!passenger) return null

    // Get passenger owner (for OwnerInit)
    const owner = (passenger as any).owner as PlayerStub | undefined

    // Create DynamicFacingInit callback
    const getFacing = (): WAngle => {
      if (this._facing) {
        return WAngle.fromDegrees(this._body.quantizeFacing(this._facing.facing))
      }
      return WAngle.Zero
    }

    // Build init dictionary (TypeDictionary equivalent)
    const inits = new Map<string, unknown>()
    inits.set('owner', owner)
    inits.set('dynamicFacing', getFacing)

    // Apply IActorPreviewInitModifier hooks
    const modifierMetas: IActorPreviewInitModifierMeta[] = []
    const modifiers = (passenger as any).traitsImplementing?.('IActorPreviewInitModifier') as
      ICargoActorPreviewInitModifier[] | undefined
    if (modifiers) {
      for (const modifier of modifiers) {
        modifier.modifyActorPreviewInit(passenger, inits)
        modifierMetas.push({ type: 'IActorPreviewInitModifier' })
      }
    }

    // Get passenger actor name and info
    const actorInfo = (passenger as any).info as
      { name?: string; traitInfos?(name: string): Iterable<unknown> } | undefined
    const actorName = actorInfo?.name ?? 'unknown'

    // Query IRenderActorPreviewInfo traits on the passenger
    const renderPreviewInfos: ICargoRenderActorPreviewInfo[] = []
    if (actorInfo?.traitInfos) {
      for (const rpi of actorInfo.traitInfos('IRenderActorPreviewInfo')) {
        renderPreviewInfos.push(rpi as ICargoRenderActorPreviewInfo)
      }
    }

    const previews: IActorPreview[] = []

    if (renderPreviewInfos.length > 0) {
      // Use IRenderActorPreviewInfo pipeline
      const previewInit: ICargoActorPreviewInitializer = {
        actor: actorInfo as any,
        worldRenderer: _wr,
        contains: (k: string) => inits.has(k),
        getValue: (k: string, fallback?: unknown) => inits.get(k) ?? fallback,
      }

      for (const rpi of renderPreviewInfos) {
        for (const p of rpi.renderPreview(previewInit)) {
          previews.push(p)
        }
      }
    } else {
      // No IRenderActorPreviewInfo — create a fallback passenger preview
      previews.push(new CargoPassengerPreview(actorName, owner, getFacing, modifierMetas))
    }

    return previews.length > 0 ? previews : null
  }

  get passengerCount(): number { return this._previews.size }
  get previews(): ReadonlyMap<string, IActorPreview[] | null> { return this._previews }
  /** Passenger actors map — for testing only. */
  get passengerActors(): ReadonlyMap<string, IGameActor> { return this._passengerActors }
  setPreviews(previews: Map<string, IActorPreview[] | null>): void { this._previews = previews }

  dispose(): void {
    this._previews.clear()
    this._passengerActors.clear()
  }
}
