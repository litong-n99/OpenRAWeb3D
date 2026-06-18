/**
 * TransportProperties.ts — Script-exposed Transport category properties for cargo carriers
 * OpenRA 对照: TransportProperties.cs
 *
 * 核心范式转换:
 * - C# Cargo trait → cached Cargo reference on actor
 * - C# UnloadCargo activity → queueActivity
 * - C# Actor[] Passengers → delegate to cargo.passengers
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

// ===========================================================================
// TransportProperties
// ===========================================================================

/**
 * Transport/cargo properties for actors that can carry other actors.
 *
 * OpenRA 对照: TransportProperties (TransportProperties.cs:22-65)
 */
export class TransportProperties extends ScriptActorProperties {
  static readonly category = 'Transports' as const
  static readonly requiredTraits = ['CargoInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _cargo: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._cargo = (self as any).trait?.('Cargo') ?? null
  }

  // ---- Properties ----

  /** Returns references to passengers inside the transport. */
  get Passengers(): IGameActor[] {
    if (!this._cargo) return []
    return this._cargo.passengers ?? this._cargo.Passengers ?? []
  }

  /** Specifies whether transport has any passengers. */
  get HasPassengers(): boolean {
    return this.Passengers.length > 0
  }

  /** Specifies the amount of passengers. */
  get PassengerCount(): number {
    return this.Passengers.length
  }

  // ---- Methods ----

  /** Teleport an existing actor inside this transport. */
  LoadPassenger(a: IGameActor): void {
    if (!a.isIdle) {
      throw new Error('LoadPassenger requires the passenger to be idle.')
    }
    this._cargo?.load?.(this.self, a)
  }

  /**
   * Remove an existing actor (or first actor if none specified) from the transport.
   * This actor is not added to the world.
   */
  UnloadPassenger(a?: IGameActor): IGameActor | null {
    if (!this._cargo) return null
    return this._cargo.unload?.(this.self, a) ?? null
  }

  /**
   * Command transport to unload passengers.
   * @param cell — optional destination cell
   * @param unloadRange — range in cells (default 5)
   */
  UnloadPassengers(cell?: unknown, unloadRange: number = 5): void {
    if (cell != null) {
      this.self.queueActivity?.(createActivity('UnloadCargo', {
        target: this.self,
        destination: cell,
        range: unloadRange,
      }))
    } else {
      this.self.queueActivity?.(createActivity('UnloadCargo', {
        target: this.self,
        range: unloadRange,
      }))
    }
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Passengers', returnType: 'Actor[]',
        description: 'Returns references to passengers inside the transport.',
        get: () => this.Passengers,
      },
      {
        memberType: 'property', name: 'HasPassengers', returnType: 'boolean',
        description: 'Specifies whether transport has any passengers.',
        get: () => this.HasPassengers,
      },
      {
        memberType: 'property', name: 'PassengerCount', returnType: 'number',
        description: 'Specifies the amount of passengers.',
        get: () => this.PassengerCount,
      },
      {
        memberType: 'method', name: 'LoadPassenger', returnType: 'nil',
        description: 'Teleport an existing actor inside this transport.',
        parameters: [{ name: 'a', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.LoadPassenger(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'UnloadPassenger', returnType: 'Actor',
        description: 'Remove an existing actor (or first actor if none specified) from the transport. This actor is not added to the world.',
        parameters: [
          { name: 'a', type: 'Actor', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => this.UnloadPassenger(args[0] as IGameActor | undefined),
      },
      {
        memberType: 'method', name: 'UnloadPassengers', returnType: 'nil',
        description: 'Command transport to unload passengers.',
        parameters: [
          { name: 'cell', type: 'CPos', optional: true, defaultValue: undefined },
          { name: 'unloadRange', type: 'number', optional: true, defaultValue: 5 },
        ],
        invoke: (_, args) => {
          this.UnloadPassengers(args[0], args[1] as number)
        },
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Transports',
  ctor: TransportProperties,
  requiredTraits: ['CargoInfo'],
  exposedForDestroyedActors: false,
  description: 'Transport cargo: Passengers, HasPassengers, PassengerCount, LoadPassenger, UnloadPassenger, UnloadPassengers',
})
