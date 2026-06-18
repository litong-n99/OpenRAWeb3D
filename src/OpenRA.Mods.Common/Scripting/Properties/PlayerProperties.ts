/**
 * PlayerProperties.ts — Script-exposed player identity and unit query
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Properties/PlayerProperties.cs
 *
 * 核心范式转换:
 * - C# Player.* direct field access → (this.player as any) with loose coupling
 * - C# Player.World.LobbyInfo.Clients for Team/Handicap → context.world.lobbyInfo.clients
 * - C# Player.World.Actors.Where(…) LINQ → for-of loop with filter
 * - C# Player.PlayerActor.TraitOrDefault<TechTree>() → playerActor.trait('TechTree')
 */
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// PlayerProperties
// ===========================================================================

/**
 * Player identity and unit query properties.
 *
 * OpenRA 对照: PlayerProperties (PlayerProperties.cs:21-126)
 */
export class PlayerProperties extends ScriptPlayerProperties {
  static readonly requiredTraits: readonly string[] = []

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
  }

  // ---- Properties ----

  /** The player's internal name. */
  get InternalName(): string {
    return (this.player as any).internalName ?? ''
  }

  /** The player's display name. */
  get Name(): string {
    return (this.player as any).resolvedPlayerName
      ?? (this.player as any).playerName
      ?? ''
  }

  /** The player's color. */
  get Color(): unknown {
    return (this.player as any).getColor?.(this.player) ?? null
  }

  /** The player's faction internal name. */
  get Faction(): string {
    return (this.player as any).faction?.internalName ?? ''
  }

  /** The player's spawnpoint ID. */
  get Spawn(): number {
    return (this.player as any).spawnPoint ?? 0
  }

  /** The player's home/starting location in cell coordinates. */
  get HomeLocation(): unknown {
    return (this.player as any).homeLocation ?? null
  }

  /** The player's team ID (from lobby info). */
  get Team(): number {
    const clients = (this.context.world as any).lobbyInfo?.clients as unknown[]
    if (!clients) return 0
    const clientIndex = (this.player as any).clientIndex ?? -1
    const c = clients.find((i: any) => i.index === clientIndex)
    return (c as any)?.team ?? 0
  }

  /** The player's handicap level (from lobby info). */
  get Handicap(): number {
    const clients = (this.context.world as any).lobbyInfo?.clients as unknown[]
    if (!clients) return 0
    const clientIndex = (this.player as any).clientIndex ?? -1
    const c = clients.find((i: any) => i.index === clientIndex)
    return (c as any)?.handicap ?? 0
  }

  /** Returns true if the player is a bot. */
  get IsBot(): boolean {
    return (this.player as any).isBot ?? false
  }

  /** Returns true if the player is non-combatant. */
  get IsNonCombatant(): boolean {
    return (this.player as any).nonCombatant ?? false
  }

  /** Returns true if the player is the local player. */
  get IsLocalPlayer(): boolean {
    const world = this.context.world as any
    const renderPlayer = world?.renderPlayer ?? world?.localPlayer
    return this.player === renderPlayer
  }

  // ---- Methods ----

  /**
   * Returns all living actors staying inside the world for this player.
   */
  GetActors(): IGameActor[] {
    const world = this.context.world
    const result: IGameActor[] = []
    for (const actor of world.actors) {
      if (actor.owner === this.player && !actor.isDead && actor.isInWorld) {
        result.push(actor)
      }
    }
    return result
  }

  /**
   * Returns an array of actors representing all ground attack units of this player.
   */
  GetGroundAttackers(): IGameActor[] {
    const world = this.context.world
    const result: IGameActor[] = []
    for (const actor of world.actors) {
      if (actor.owner !== this.player || actor.isDead || !actor.isInWorld) continue
      // Must have AttackBase trait AND MobileInfo (ground attacker)
      // Exact match — NOT substring: avoids false positives like "Immobile", "MobileArtilleryBlocked"
      const attackBase = (actor as any).trait?.('AttackBase') ?? (actor as any).trait?.('attackBase')
      const hasMobileInfo = ((actor as any).info?.traits as string[] | undefined)?.some?.(
        (t: string) => t === 'MobileInfo',
      )
      if (attackBase != null && hasMobileInfo) {
        result.push(actor)
      }
    }
    return result
  }

  /**
   * Returns all living actors of the specified type of this player.
   * @param type — actor type name (e.g. "e1")
   * @throws if the actor type is unknown
   */
  GetActorsByType(type: string): IGameActor[] {
    const world = this.context.world as any
    const rules = world?.map?.rules
    const actorsMap = rules?.actors as Map<string, any> | undefined

    if (!actorsMap || !actorsMap.has(type)) {
      throw new Error(`Unknown actor type '${type}'`)
    }

    const ai = actorsMap.get(type)
    const result: IGameActor[] = []

    for (const actor of this.context.world.actors) {
      if (actor.owner === this.player && !actor.isDead && actor.isInWorld
        && actor.info?.name === ai.name) {
        result.push(actor)
      }
    }
    return result
  }

  /**
   * Returns all living actors of the specified types of this player.
   * @param types — array of actor type names
   * @throws if any actor type is unknown
   */
  GetActorsByTypes(types: string[]): IGameActor[] {
    const world = this.context.world as any
    const rules = world?.map?.rules
    const actorsMap = rules?.actors as Map<string, any> | undefined

    for (const type of types) {
      if (!actorsMap || !actorsMap.has(type)) {
        throw new Error(`Unknown actor type '${type}'`)
      }
    }

    const typeSet = new Set(types)
    const result: IGameActor[] = []

    for (const actor of this.context.world.actors) {
      if (actor.owner === this.player && !actor.isDead && actor.isInWorld
        && actor.info?.name != null && typeSet.has(actor.info.name)) {
        result.push(actor)
      }
    }
    return result
  }

  /**
   * Check if the player has these prerequisites available.
   * @param type — array of prerequisite names
   * @throws if the player actor has no TechTree trait
   */
  HasPrerequisites(type: string[]): boolean {
    const playerActor = (this.player as any).playerActor
    if (!playerActor) {
      throw new Error(`Missing playerActor on player ${this.player.playerName}`)
    }
    const tt = playerActor.trait?.('TechTree')
    if (tt == null) {
      throw new Error(`Missing TechTree trait on player ${this.player.playerName}!`)
    }
    return tt.hasPrerequisites?.(type) ?? false
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      { memberType: 'property', name: 'InternalName', returnType: 'string', description: "The player's internal name.", get: () => this.InternalName },
      { memberType: 'property', name: 'Name', returnType: 'string', description: "The player's display name.", get: () => this.Name },
      { memberType: 'property', name: 'Color', returnType: 'Color', description: "The player's color.", get: () => this.Color },
      { memberType: 'property', name: 'Faction', returnType: 'string', description: "The player's faction internal name.", get: () => this.Faction },
      { memberType: 'property', name: 'Spawn', returnType: 'number', description: "The player's spawnpoint ID.", get: () => this.Spawn },
      { memberType: 'property', name: 'HomeLocation', returnType: 'CPos', description: "The player's home/starting location in cell coordinates.", get: () => this.HomeLocation },
      { memberType: 'property', name: 'Team', returnType: 'number', description: "The player's team ID (from lobby info).", get: () => this.Team },
      { memberType: 'property', name: 'Handicap', returnType: 'number', description: "The player's handicap level (from lobby info).", get: () => this.Handicap },
      { memberType: 'property', name: 'IsBot', returnType: 'boolean', description: "Returns true if the player is a bot.", get: () => this.IsBot },
      { memberType: 'property', name: 'IsNonCombatant', returnType: 'boolean', description: "Returns true if the player is non-combatant.", get: () => this.IsNonCombatant },
      { memberType: 'property', name: 'IsLocalPlayer', returnType: 'boolean', description: "Returns true if the player is the local player.", get: () => this.IsLocalPlayer },
      {
        memberType: 'method', name: 'GetActors', returnType: 'Actor[]',
        description: 'Returns all living actors staying inside the world for this player.',
        parameters: [],
        invoke: () => this.GetActors(),
      },
      {
        memberType: 'method', name: 'GetGroundAttackers', returnType: 'Actor[]',
        description: 'Returns an array of actors representing all ground attack units of this player.',
        parameters: [],
        invoke: () => this.GetGroundAttackers(),
      },
      {
        memberType: 'method', name: 'GetActorsByType', returnType: 'Actor[]',
        description: 'Returns all living actors of the specified type of this player.',
        parameters: [{ name: 'type', type: 'string', optional: false }],
        invoke: (_, args) => this.GetActorsByType(args[0] as string),
      },
      {
        memberType: 'method', name: 'GetActorsByTypes', returnType: 'Actor[]',
        description: 'Returns all living actors of the specified types of this player.',
        parameters: [{ name: 'types', type: 'string[]', optional: false }],
        invoke: (_, args) => this.GetActorsByTypes(args[0] as string[]),
      },
      {
        memberType: 'method', name: 'HasPrerequisites', returnType: 'boolean',
        description: 'Check if the player has these prerequisites available.',
        parameters: [{ name: 'type', type: 'string[]', optional: false }],
        invoke: (_, args) => this.HasPrerequisites(args[0] as string[]),
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'Player',
  ctor: PlayerProperties,
  requiredTraits: [],
  description: 'Player identity and unit query: InternalName, Name, Color, Faction, Spawn, HomeLocation, Team, Handicap, IsBot, IsNonCombatant, IsLocalPlayer, GetActors, GetGroundAttackers, GetActorsByType, GetActorsByTypes, HasPrerequisites',
})
