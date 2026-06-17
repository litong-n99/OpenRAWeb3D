/**
 * ScriptPlayerInterface.ts — Player-scoped script access
 * OpenRA 对照: ScriptPlayerInterface.cs
 *
 * 核心范式转换:
 * - C# context.PlayerCommands (Type[] from reflection)
 *   → ScriptRegistry.getPlayerProperties() from explicit registration
 * - C# Player reference → PlayerStub (forward interface for loose coupling)
 */

import type { PlayerStub } from '../Traits/TraitsInterfaces.js'
import type { IScriptContext } from './ScriptMemberDescriptor.js'
import type { MemberDescriptor } from './ScriptMemberDescriptor.js'
import { ScriptObjectWrapper } from './ScriptObjectWrapper.js'

// ---------------------------------------------------------------------------
// ScriptPlayerProperties — abstract base for player-scoped property groups
// ---------------------------------------------------------------------------

/**
 * Abstract base class for scripting properties on a player.
 *
 * OpenRA 对照: ScriptPlayerProperties (ScriptContext.cs:54-58)
 *
 * Each subclass exposes player-level APIs (e.g., PlayerProperties exposes
 * player.Name, MissionObjectiveProperties exposes player.AddObjective).
 *
 * Paradigm shift:
 * - C# constructor takes (ScriptContext, Player) directly
 * - TS constructor takes (context, player) where player is PlayerStub
 */
export abstract class ScriptPlayerProperties {
  /** The player these properties are bound to. */
  protected readonly player: PlayerStub

  /** The owning ScriptContext. */
  protected readonly context: IScriptContext

  constructor(context: IScriptContext, player: PlayerStub) {
    this.context = context
    this.player = player
  }

  /** Required trait interface names for this property group (on the PlayerActor).
   *
   * OpenRA 对照: Requires<TInfo> on ScriptPlayerProperties subclass
   */
  static readonly requiredTraits: readonly string[]
}

// ---------------------------------------------------------------------------
// ScriptPlayerInterface — player-scoped script wrapper
// ---------------------------------------------------------------------------

/**
 * Script-accessible interface for a specific player.
 *
 * OpenRA 对照: ScriptPlayerInterface (ScriptPlayerInterface.cs:14-29)
 *
 * Wraps a player and exposes all available ScriptPlayerProperties
 * command groups.
 */
export class ScriptPlayerInterface extends ScriptObjectWrapper {
  /** The wrapped player. */
  private readonly _player: PlayerStub

  /**
   * @param context — the owning ScriptContext
   * @param player — the player to wrap
   */
  constructor(context: IScriptContext, player: PlayerStub) {
    super(context)
    this._player = player

    const commandClasses = context.playerCommands
    const instances = commandClasses.map(
      cmd => new cmd.ctor(context, player),
    )

    if (instances.length > 0) {
      this.bind(instances)
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  /** The wrapped player. */
  get player(): PlayerStub {
    return this._player
  }

  // ---------------------------------------------------------------------------
  // Error Messages
  // ---------------------------------------------------------------------------

  protected override duplicateKeyError(memberName: string): string {
    return `Player '${this._getPlayerName()}' defines the command '${memberName}' on multiple traits`
  }

  protected override memberNotFoundError(memberName: string): string {
    return `Player '${this._getPlayerName()}' does not define a property '${memberName}'`
  }

  // ---------------------------------------------------------------------------
  // Member Binding
  // ---------------------------------------------------------------------------

  protected override getMemberDescriptors(obj: object): MemberDescriptor[] {
    if (obj instanceof ScriptPlayerProperties) {
      return (obj as any).getOwnMemberDescriptors?.() ?? []
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _getPlayerName(): string {
    return (this._player as any).resolvedPlayerName
      ?? (this._player as any).playerName
      ?? 'unknown'
  }
}
