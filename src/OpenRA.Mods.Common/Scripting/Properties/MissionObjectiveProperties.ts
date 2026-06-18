/**
 * MissionObjectiveProperties.ts — Script-exposed mission objectives for a player
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Properties/MissionObjectiveProperties.cs
 *
 * 核心范式转换:
 * - C# MissionObjectives trait on PlayerActor → (player as any).playerActor.trait('MissionObjectives')
 * - C# MapOptions.ShortGame on WorldActor → context.world.worldActor.trait('MapOptions')
 * - C# ObjectiveState enum → string comparison ('Completed', 'Failed')
 * - C# mo.Add(Player, ...) → this._mo.add(this.player, ...)
 */
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// MissionObjectiveProperties
// ===========================================================================

/**
 * Mission objective management for a player.
 *
 * OpenRA 对照: MissionObjectiveProperties (MissionObjectiveProperties.cs:20-129)
 */
export class MissionObjectiveProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['MissionObjectivesInfo'] as const

  private readonly _mo: any | null
  private readonly _shortGame: boolean

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)

    const playerActor = (player as any).playerActor
    this._mo = playerActor?.trait?.('MissionObjectives') ?? null

    const world = context.world as any
    const worldActor = world?.worldActor
    const mapOptions = worldActor?.trait?.('MapOptions')
    this._shortGame = mapOptions?.shortGame ?? false
  }

  // ---- Validated accessor ----

  private _requireObjective(id: number): any {
    if (!this._mo) {
      throw new Error('MissionObjectives trait not found on player actor')
    }
    const objectives = this._mo.objectives
    if (!objectives || id < 0 || id >= (objectives as any[]).length) {
      throw new Error('Objective ID is out of range.')
    }
    return (objectives as any[])[id]
  }

  // ---- Methods ----

  /**
   * Add a mission objective for this player.
   * @returns the ID of the newly created objective
   */
  AddObjective(description: string, type: string = 'Primary', required: boolean = true): number {
    if (!this._mo) {
      throw new Error('MissionObjectives trait not found on player actor')
    }
    return this._mo.add?.(this.player, description, type, required) ?? -1
  }

  /**
   * Add a primary mission objective for this player.
   * @returns the ID of the newly created objective
   */
  AddPrimaryObjective(description: string): number {
    return this.AddObjective(description)
  }

  /**
   * Add a secondary mission objective for this player.
   * @returns the ID of the newly created objective
   */
  AddSecondaryObjective(description: string): number {
    return this.AddObjective(description, 'Secondary', false)
  }

  /**
   * Mark an objective as completed.
   * @param id — the objective ID returned by AddObjective
   */
  MarkCompletedObjective(id: number): void {
    this._requireObjective(id) // validate range
    this._mo!.markCompleted?.(this.player, id)
  }

  /**
   * Mark an objective as failed.
   * @param id — the objective ID returned by AddObjective
   */
  MarkFailedObjective(id: number): void {
    this._requireObjective(id) // validate range
    this._mo!.markFailed?.(this.player, id)
  }

  /**
   * Returns true if the objective has been successfully completed.
   */
  IsObjectiveCompleted(id: number): boolean {
    const obj = this._requireObjective(id)
    return obj.state === 'Completed'
  }

  /**
   * Returns true if the objective has been failed.
   */
  IsObjectiveFailed(id: number): boolean {
    const obj = this._requireObjective(id)
    return obj.state === 'Failed'
  }

  /**
   * Returns the description of an objective.
   */
  GetObjectiveDescription(id: number): string {
    const obj = this._requireObjective(id)
    return obj.description ?? ''
  }

  /**
   * Returns the type of an objective.
   */
  GetObjectiveType(id: number): string {
    const obj = this._requireObjective(id)
    return obj.type ?? ''
  }

  /**
   * Returns true if this player has lost all units/actors that have
   * the MustBeDestroyed trait (according to the short game option).
   */
  HasNoRequiredUnits(): boolean {
    return (this.player as any).hasNoRequiredUnits?.(this._shortGame) ?? false
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'AddObjective', returnType: 'number',
        description: 'Add a mission objective for this player. Returns the ID of the newly created objective.',
        parameters: [
          { name: 'description', type: 'string', optional: false },
          { name: 'type', type: 'string', optional: true, defaultValue: 'Primary' },
          { name: 'required', type: 'boolean', optional: true, defaultValue: true },
        ],
        invoke: (_, args) => this.AddObjective(
          args[0] as string, args[1] as string, args[2] as boolean,
        ),
      },
      {
        memberType: 'method', name: 'AddPrimaryObjective', returnType: 'number',
        description: 'Add a primary mission objective for this player. Returns the ID of the newly created objective.',
        parameters: [{ name: 'description', type: 'string', optional: false }],
        invoke: (_, args) => this.AddPrimaryObjective(args[0] as string),
      },
      {
        memberType: 'method', name: 'AddSecondaryObjective', returnType: 'number',
        description: 'Add a secondary mission objective for this player. Returns the ID of the newly created objective.',
        parameters: [{ name: 'description', type: 'string', optional: false }],
        invoke: (_, args) => this.AddSecondaryObjective(args[0] as string),
      },
      {
        memberType: 'method', name: 'MarkCompletedObjective', returnType: 'nil',
        description: 'Mark an objective as completed. Needs the objective ID from AddObjective.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => { this.MarkCompletedObjective(args[0] as number) },
      },
      {
        memberType: 'method', name: 'MarkFailedObjective', returnType: 'nil',
        description: 'Mark an objective as failed. Needs the objective ID from AddObjective.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => { this.MarkFailedObjective(args[0] as number) },
      },
      {
        memberType: 'method', name: 'IsObjectiveCompleted', returnType: 'boolean',
        description: 'Returns true if the objective has been successfully completed.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => this.IsObjectiveCompleted(args[0] as number),
      },
      {
        memberType: 'method', name: 'IsObjectiveFailed', returnType: 'boolean',
        description: 'Returns true if the objective has been failed.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => this.IsObjectiveFailed(args[0] as number),
      },
      {
        memberType: 'method', name: 'GetObjectiveDescription', returnType: 'string',
        description: 'Returns the description of an objective.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => this.GetObjectiveDescription(args[0] as number),
      },
      {
        memberType: 'method', name: 'GetObjectiveType', returnType: 'string',
        description: 'Returns the type of an objective.',
        parameters: [{ name: 'id', type: 'number', optional: false }],
        invoke: (_, args) => this.GetObjectiveType(args[0] as number),
      },
      {
        memberType: 'method', name: 'HasNoRequiredUnits', returnType: 'boolean',
        description: "Returns true if this player has lost all units/actors that have the MustBeDestroyed trait (according to the short game option).",
        parameters: [],
        invoke: () => this.HasNoRequiredUnits(),
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'MissionObjectives',
  ctor: MissionObjectiveProperties,
  requiredTraits: ['MissionObjectivesInfo'],
  description: 'Mission objectives: AddObjective, AddPrimaryObjective, AddSecondaryObjective, MarkCompletedObjective, MarkFailedObjective, IsObjectiveCompleted, IsObjectiveFailed, GetObjectiveDescription, GetObjectiveType, HasNoRequiredUnits',
})
