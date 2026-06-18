/**
 * MobileProperties.ts — Script-exposed Movement properties for ground units
 * OpenRA 对照: MobileProperties.cs
 *
 * 核心范式转换:
 * - C# Mobile trait → cached Mobile reference on actor
 * - C# WDist.FromCells(closeEnough) → numeric distance in cells
 * - C# Move(Self, cell, WDist) activity → queueActivity
 * - C# Nudge, RideTransport activities → queueActivity
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

// ===========================================================================
// MobileProperties
// ===========================================================================

/**
 * Movement properties for mobile (ground) actors.
 *
 * OpenRA 对照: MobileProperties (MobileProperties.cs:20-71)
 */
export class MobileProperties extends ScriptActorProperties {
  static readonly category = 'Movement' as const
  static readonly requiredTraits = ['MobileInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _mobile: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._mobile = (self as any).trait?.('Mobile') ?? null
  }

  // ---- Methods ----

  /**
   * Moves within the cell grid.
   * @param cell — target cell
   * @param closeEnough — optional range in cells considered close enough
   */
  Move(cell: unknown, closeEnough: number = 0): void {
    this.self.queueActivity?.(createActivity('Move', {
      target: this.self,
      destination: cell,
      closeEnough,
    }))
  }

  /** Moves within the cell grid, ignoring lane biases. */
  ScriptedMove(cell: unknown): void {
    this.self.queueActivity?.(createActivity('Move', {
      target: this.self,
      destination: cell,
    }))
  }

  /** Moves from outside the world into the cell grid. */
  MoveIntoWorld(cell: unknown): void {
    if (!this._mobile) return
    const pos = (this.self as any).centerPosition
    this._mobile.setPosition?.(this.self, cell)
    this._mobile.setCenterPosition?.(this.self, pos)
    this.self.queueActivity?.(createActivity('ReturnToCell', { target: this.self }))
  }

  /** Leave the current position in a random direction. */
  Scatter(): void {
    this.self.queueActivity?.(createActivity('Nudge', { target: this.self }))
  }

  /** Move to and enter the transport. */
  EnterTransport(transport: IGameActor): void {
    this.self.queueActivity?.(createActivity('RideTransport', {
      target: this.self,
      transport,
    }))
  }

  // ---- Properties ----

  /** Whether the actor can move (false if immobilized). */
  get IsMobile(): boolean {
    if (!this._mobile) return false
    return !this._mobile.isTraitDisabled && !this._mobile.isTraitPaused
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Move', returnType: 'nil',
        description: 'Moves within the cell grid. closeEnough defines an optional range (in cells) that will be considered close enough to complete the activity.',
        parameters: [
          { name: 'cell', type: 'CPos', optional: false },
          { name: 'closeEnough', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => { this.Move(args[0], args[1] as number) },
      },
      {
        memberType: 'method', name: 'ScriptedMove', returnType: 'nil',
        description: 'Moves within the cell grid, ignoring lane biases.',
        parameters: [{ name: 'cell', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.ScriptedMove(args[0]) },
      },
      {
        memberType: 'method', name: 'MoveIntoWorld', returnType: 'nil',
        description: 'Moves from outside the world into the cell grid.',
        parameters: [{ name: 'cell', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.MoveIntoWorld(args[0]) },
      },
      {
        memberType: 'method', name: 'Scatter', returnType: 'nil',
        description: 'Leave the current position in a random direction.',
        parameters: [],
        invoke: () => { this.Scatter() },
      },
      {
        memberType: 'method', name: 'EnterTransport', returnType: 'nil',
        description: 'Move to and enter the transport.',
        parameters: [{ name: 'transport', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.EnterTransport(args[0] as IGameActor) },
      },
      {
        memberType: 'property', name: 'IsMobile', returnType: 'boolean',
        description: 'Whether the actor can move (false if immobilized).',
        get: () => this.IsMobile,
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Movement',
  ctor: MobileProperties,
  requiredTraits: ['MobileInfo'],
  exposedForDestroyedActors: false,
  description: 'Mobile unit movement: Move, ScriptedMove, MoveIntoWorld, Scatter, EnterTransport, IsMobile',
})
