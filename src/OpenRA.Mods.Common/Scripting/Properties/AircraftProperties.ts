/**
 * AircraftProperties.ts — Script-exposed Movement properties for aircraft
 * OpenRA 对照: AircraftProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Movement")] → category = 'Movement'
 * - C# Aircraft trait → cached from actor
 * - C# Fly, ReturnToBase, Land, Resupply activities → queueActivity
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

// ===========================================================================
// AircraftProperties
// ===========================================================================

/**
 * Movement properties for aircraft actors.
 *
 * OpenRA 对照: AircraftProperties (AircraftProperties.cs:20-60)
 */
export class AircraftProperties extends ScriptActorProperties {
  static readonly category = 'Movement' as const
  static readonly requiredTraits = ['AircraftInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _aircraft: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._aircraft = (self as any).trait?.('Aircraft') ?? null
  }

  // ---- Methods ----

  /** Fly within the cell grid. */
  Move(cell: unknown): void {
    this.self.queueActivity?.(createActivity('Fly', { target: this.self, destination: cell }))
  }

  /**
   * Return to the base, which is either the destination given, or an auto-selected one.
   */
  ReturnToBase(destination?: IGameActor): void {
    this.self.queueActivity?.(createActivity('ReturnToBase', {
      target: this.self,
      destination,
      abandonOnResupply: true,
    }))
  }

  /** Queues a landing activity on the specified actor. */
  Land(landOn: IGameActor): void {
    this.self.queueActivity?.(createActivity('Land', { target: this.self, landOn }))
  }

  /** Starts the resupplying activity when being on a host building.
   *
   * OpenRA 对照: AircraftProperties.Resupply() (AircraftProperties.cs:53-59)
   * NOTE: Must check atLandAltitude before queuing Resupply — the actor
   * must be at (or below) LandAltitude to dock with a host building.
   */
  Resupply(): void {
    if (!this._aircraft) return
    const world = (this.self as any).world as any
    const centerPosition = (this.self as any).centerPosition
    const landAltitude = this._aircraft.info?.landAltitude ?? (this._aircraft.info?.LandAltitude)
    const distanceAboveTerrain = typeof world?.map?.distanceAboveTerrain === 'function'
      ? world.map.distanceAboveTerrain(centerPosition)
      : 0
    const atLandAltitude = distanceAboveTerrain === landAltitude
      || (typeof distanceAboveTerrain === 'number' && typeof landAltitude === 'number'
        && distanceAboveTerrain <= landAltitude)
    const host = this._aircraft.getActorBelow?.()
    if (atLandAltitude && host != null) {
      this.self.queueActivity?.(createActivity('Resupply', {
        target: this.self,
        host,
        closeEnough: 0,
      }))
    }
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Move', returnType: 'nil',
        description: 'Fly within the cell grid.',
        parameters: [{ name: 'cell', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.Move(args[0]) },
      },
      {
        memberType: 'method', name: 'ReturnToBase', returnType: 'nil',
        description: 'Return to the base, which is either the destination given, or an auto-selected one otherwise.',
        parameters: [
          { name: 'destination', type: 'Actor', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => { this.ReturnToBase(args[0] as IGameActor | undefined) },
      },
      {
        memberType: 'method', name: 'Land', returnType: 'nil',
        description: 'Queues a landing activity on the specified actor.',
        parameters: [{ name: 'landOn', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.Land(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'Resupply', returnType: 'nil',
        description: 'Starts the resupplying activity when being on a host building.',
        parameters: [],
        invoke: () => { this.Resupply() },
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Movement',
  ctor: AircraftProperties,
  requiredTraits: ['AircraftInfo'],
  exposedForDestroyedActors: false,
  description: 'Aircraft movement: Move (fly), ReturnToBase, Land, Resupply',
})
