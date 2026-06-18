/**
 * DeveloperMode.test.ts — DeveloperMode migration unit tests
 *
 * Tests focus on: state management, config defaults, enabled gating,
 * order processing, permission checking, all cheat flag toggles.
 *
 * OpenRA 对照: DeveloperMode.cs 完整功能
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DeveloperMode,
  DeveloperModeInfo,
  type DeveloperModeInfoFields,
} from './DeveloperMode.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { Damage } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal stub IGameActor for testing. */
function createStubActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traitsImplementing: () => [],
    ...overrides,
  } as IGameActor
}

/** Create a developer mode instance with defaults. */
function createDevMode(
  infoOverrides: Partial<DeveloperModeInfoFields> = {},
): DeveloperMode {
  return new DeveloperMode(new DeveloperModeInfo(infoOverrides))
}

// ---------------------------------------------------------------------------
// DeveloperModeInfo
// ---------------------------------------------------------------------------

describe('DeveloperModeInfo', () => {
  it('has all defaults matching OpenRA', () => {
    const info = new DeveloperModeInfo()
    expect(info.checkboxLabel).toBe('checkbox-debug-menu.label')
    expect(info.checkboxDescription).toBe('checkbox-debug-menu.description')
    expect(info.checkboxEnabled).toBe(false)
    expect(info.checkboxLocked).toBe(false)
    expect(info.checkboxVisible).toBe(true)
    expect(info.checkboxDisplayOrder).toBe(0)
    expect(info.cash).toBe(20000)
    expect(info.resourceGrowth).toBe(100)
    expect(info.fastBuild).toBe(false)
    expect(info.fastCharge).toBe(false)
    expect(info.disableShroud).toBe(false)
    expect(info.unlimitedPower).toBe(false)
    expect(info.buildAnywhere).toBe(false)
    expect(info.pathDebug).toBe(false)
  })

  it('accepts all configurable fields', () => {
    const info = new DeveloperModeInfo({
      checkboxLabel: 'custom.label',
      checkboxDescription: 'custom.description',
      checkboxEnabled: true,
      checkboxLocked: true,
      checkboxVisible: false,
      checkboxDisplayOrder: 5,
      cash: 50000,
      resourceGrowth: 200,
      fastBuild: true,
      fastCharge: true,
      disableShroud: true,
      unlimitedPower: true,
      buildAnywhere: true,
      pathDebug: true,
    })
    expect(info.checkboxLabel).toBe('custom.label')
    expect(info.checkboxEnabled).toBe(true)
    expect(info.cash).toBe(50000)
    expect(info.fastBuild).toBe(true)
    expect(info.fastCharge).toBe(true)
    expect(info.disableShroud).toBe(true)
    expect(info.unlimitedPower).toBe(true)
    expect(info.buildAnywhere).toBe(true)
    expect(info.pathDebug).toBe(true)
  })

  it('partial configuration leaves others as defaults', () => {
    const info = new DeveloperModeInfo({ fastBuild: true, cash: 99999 })
    expect(info.fastBuild).toBe(true)
    expect(info.cash).toBe(99999)
    expect(info.fastCharge).toBe(false)
    expect(info.disableShroud).toBe(false)
    expect(info.unlimitedPower).toBe(false)
    expect(info.buildAnywhere).toBe(false)
    expect(info.pathDebug).toBe(false)
    expect(info.checkboxEnabled).toBe(false)
  })

  it('has optional instanceName', () => {
    const info = new DeveloperModeInfo({ instanceName: 'dev' })
    expect(info.instanceName).toBe('dev')
  })

  it('works without instanceName', () => {
    const info = new DeveloperModeInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('lobbyOptions returns cheats checkbox', () => {
    const info = new DeveloperModeInfo({
      checkboxLabel: 'Cheats',
      checkboxDescription: 'Enable cheats',
      checkboxEnabled: false,
      checkboxLocked: false,
      checkboxVisible: true,
      checkboxDisplayOrder: 0,
    })
    const stubMap = { uid: 'test-map' }
    const options = info.lobbyOptions(stubMap)
    expect(options).toHaveLength(1)
    expect(options[0].id).toBe('cheats')
    expect(options[0].name).toBe('Cheats')
    expect(options[0].description).toBe('Enable cheats')
    expect(options[0].defaultValue).toBe('false')
    expect(options[0].isLocked).toBe(false)
    expect(options[0].isVisible).toBe(true)
    expect(options[0].displayOrder).toBe(0)
  })

  it('lobbyOptions returns true defaultValue when checkboxEnabled', () => {
    const info = new DeveloperModeInfo({ checkboxEnabled: true })
    const options = info.lobbyOptions({ uid: 'test-map' })
    expect(options[0].defaultValue).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// DeveloperMode — constructor and basic state
// ---------------------------------------------------------------------------

describe('DeveloperMode', () => {
  describe('constructor and basic properties', () => {
    it('returns false for all cheats with default info (enabled=false)', () => {
      const mode = new DeveloperMode()
      expect(mode.enabled).toBe(false)
      expect(mode.fastBuild).toBe(false)
      expect(mode.allTech).toBe(false)
      expect(mode.fastCharge).toBe(false)
      expect(mode.disableShroud).toBe(false)
      expect(mode.unlimitedPower).toBe(false)
      expect(mode.buildAnywhere).toBe(false)
      expect(mode.pathDebug).toBe(false)
    })

    it('returns false for all cheats even when config has true (not enabled)', () => {
      const mode = createDevMode({
        fastBuild: true,
        fastCharge: true,
        disableShroud: true,
        unlimitedPower: true,
        buildAnywhere: true,
        pathDebug: true,
      })
      // enabled is still false — all properties gated by enabled
      expect(mode.fastBuild).toBe(false)
      expect(mode.allTech).toBe(false)
      expect(mode.fastCharge).toBe(false)
      expect(mode.disableShroud).toBe(false)
      expect(mode.unlimitedPower).toBe(false)
      expect(mode.buildAnywhere).toBe(false)
      expect(mode.pathDebug).toBe(false)
    })

    it('returns config defaults when enabled is true', () => {
      const mode = createDevMode({
        fastBuild: true,
        fastCharge: true,
        disableShroud: true,
        unlimitedPower: true,
        buildAnywhere: true,
      })
      mode.enabled = true
      expect(mode.fastBuild).toBe(true)
      expect(mode.fastCharge).toBe(true)
      expect(mode.disableShroud).toBe(true)
      expect(mode.unlimitedPower).toBe(true)
      expect(mode.buildAnywhere).toBe(true)
      // allTech is not configurable in info — starts false
      expect(mode.allTech).toBe(false)
      // pathDebug not configured — starts false
      expect(mode.pathDebug).toBe(false)
    })

    it('stores info reference', () => {
      const info = new DeveloperModeInfo({ fastBuild: true })
      const mode = new DeveloperMode(info)
      expect(mode.info).toBe(info)
    })

    it('uses default info when none provided', () => {
      const mode = new DeveloperMode()
      expect(mode.info).toBeInstanceOf(DeveloperModeInfo)
    })

    it('renderPlayerUnlocked matches enabled', () => {
      const mode = new DeveloperMode()
      expect(mode.renderPlayerUnlocked).toBe(false)
      mode.enabled = true
      expect(mode.renderPlayerUnlocked).toBe(true)
      mode.enabled = false
      expect(mode.renderPlayerUnlocked).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // INotifyCreated
  // -------------------------------------------------------------------------

  describe('created (INotifyCreated)', () => {
    it('enables dev mode in single player (nonBotCount <= 1)', () => {
      const mode = createDevMode()
      const actor = createStubActor({
        world: {
          players: [{ isBot: false }],
          lobbyInfo: {
            globalSettings: {
              optionOrDefault: () => false,
            },
          },
        },
      } as any)
      mode.created(actor)
      expect(mode.enabled).toBe(true)
    })

    it('enables dev mode in single player with one bot', () => {
      const mode = createDevMode()
      const actor = createStubActor({
        world: {
          players: [{ isBot: false }, { isBot: true }],
        },
      } as any)
      mode.created(actor)
      expect(mode.enabled).toBe(true)
    })

    it('uses lobby option in multiplayer', () => {
      const mode = createDevMode()
      const actor = createStubActor({
        world: {
          players: [{ isBot: false }, { isBot: false }, { isBot: false }],
          lobbyInfo: {
            globalSettings: {
              optionOrDefault: (_key: string, _default: boolean) => true,
            },
          },
        },
      } as any)
      mode.created(actor)
      expect(mode.enabled).toBe(true)
    })

    it('uses lobby option false in multiplayer', () => {
      const mode = createDevMode()
      const actor = createStubActor({
        world: {
          players: [{ isBot: false }, { isBot: false }],
          lobbyInfo: {
            globalSettings: {
              optionOrDefault: (_key: string, _default: boolean) => false,
            },
          },
        },
      } as any)
      mode.created(actor)
      expect(mode.enabled).toBe(false)
    })

    it('falls back to checkboxEnabled without lobbyInfo', () => {
      const mode = createDevMode({ checkboxEnabled: true })
      const actor = createStubActor({
        world: {
          players: [{ isBot: false }, { isBot: false }],
        },
      } as any)
      mode.created(actor)
      expect(mode.enabled).toBe(true)
    })

    it('falls back to checkboxEnabled without world', () => {
      const mode = createDevMode({ checkboxEnabled: true })
      const actor = createStubActor({ world: undefined })
      mode.created(actor)
      expect(mode.enabled).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // resolveOrder — toggle orders
  // -------------------------------------------------------------------------

  describe('resolveOrder (IResolveOrder)', () => {
    let mode: DeveloperMode
    let actor: IGameActor

    beforeEach(() => {
      mode = createDevMode()
      mode.enabled = true
      actor = createStubActor({
        world: { players: [] },
      } as any)
    })

    it('ignores all orders when enabled is false', () => {
      mode.enabled = false
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.EnableTech,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(false)
    })

    it('DevAll toggles all cheats on', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.All,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(true)
      expect(mode.fastBuild).toBe(true)
      expect(mode.fastCharge).toBe(true)
      expect(mode.disableShroud).toBe(true)
      expect(mode.unlimitedPower).toBe(true)
      expect(mode.buildAnywhere).toBe(true)
    })

    it('DevAll toggles all cheats off', () => {
      // First enable all
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.All,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(true)
      // Then disable all
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.All,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(false)
      expect(mode.fastBuild).toBe(false)
      expect(mode.fastCharge).toBe(false)
      expect(mode.disableShroud).toBe(false)
      expect(mode.unlimitedPower).toBe(false)
      expect(mode.buildAnywhere).toBe(false)
    })

    it('DevEnableTech toggles allTech', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.EnableTech,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.EnableTech,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(false)
    })

    it('DevFastCharge toggles fastCharge', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.FastCharge,
        targetString: '',
        extraData: 0,
      })
      expect(mode.fastCharge).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.FastCharge,
        targetString: '',
        extraData: 0,
      })
      expect(mode.fastCharge).toBe(false)
    })

    it('DevFastBuild toggles fastBuild', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.FastBuild,
        targetString: '',
        extraData: 0,
      })
      expect(mode.fastBuild).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.FastBuild,
        targetString: '',
        extraData: 0,
      })
      expect(mode.fastBuild).toBe(false)
    })

    it('DevVisibility toggles disableShroud', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Visibility,
        targetString: '',
        extraData: 0,
      })
      expect(mode.disableShroud).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Visibility,
        targetString: '',
        extraData: 0,
      })
      expect(mode.disableShroud).toBe(false)
    })

    it('DevPathDebug toggles pathDebug', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.PATH_DEBUG_ORDER_NAME,
        targetString: '',
        extraData: 0,
      })
      expect(mode.pathDebug).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.PATH_DEBUG_ORDER_NAME,
        targetString: '',
        extraData: 0,
      })
      expect(mode.pathDebug).toBe(false)
    })

    it('DevUnlimitedPower toggles unlimitedPower', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.UnlimitedPower,
        targetString: '',
        extraData: 0,
      })
      expect(mode.unlimitedPower).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.UnlimitedPower,
        targetString: '',
        extraData: 0,
      })
      expect(mode.unlimitedPower).toBe(false)
    })

    it('DevBuildAnywhere toggles buildAnywhere', () => {
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.BuildAnywhere,
        targetString: '',
        extraData: 0,
      })
      expect(mode.buildAnywhere).toBe(true)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.BuildAnywhere,
        targetString: '',
        extraData: 0,
      })
      expect(mode.buildAnywhere).toBe(false)
    })

    it('unknown order returns silently', () => {
      // Should not throw
      mode.resolveOrder(actor, {
        orderName: 'UnknownOrder',
        targetString: '',
        extraData: 0,
      })
      // State should be unchanged
      expect(mode.allTech).toBe(false)
      expect(mode.fastBuild).toBe(false)
    })

    it('GiveCash gives cash to player resources', () => {
      let cashChanged = false
      let amountChanged = 0
      const resActor = createStubActor({
        traitsImplementing: (name: string) => {
          if (name === 'PlayerResources') {
            return [{
              changeCash: (amt: number) => {
                cashChanged = true
                amountChanged = amt
                return amt
              },
            }]
          }
          return []
        },
      })
      mode.resolveOrder(resActor, {
        orderName: DeveloperMode.Orders.GiveCash,
        targetString: '',
        extraData: 1000,
      } as any)
      expect(cashChanged).toBe(true)
      expect(amountChanged).toBe(1000)
    })

    it('GiveCash defaults to info.cash when extraData is 0', () => {
      const cashMode = createDevMode({ cash: 50000 })
      cashMode.enabled = true
      let amountChanged = 0
      const resActor = createStubActor({
        traitsImplementing: (name: string) => {
          if (name === 'PlayerResources') {
            return [{
              changeCash: (amt: number) => {
                amountChanged = amt
                return amt
              },
            }]
          }
          return []
        },
      })
      cashMode.resolveOrder(resActor, {
        orderName: DeveloperMode.Orders.GiveCash,
        targetString: '',
        extraData: 0,
      } as any)
      expect(amountChanged).toBe(50000)
    })

    it('GiveCashAll gives cash to all playable players', () => {
      const received: number[] = []
      const worldActor = createStubActor({
        world: {
          players: [
            {
              playable: true,
              playerActor: {
                traitsImplementing: (name: string) => {
                  if (name === 'PlayerResources') {
                    return [{
                      changeCash: (amt: number) => {
                        received.push(amt)
                        return amt
                      },
                    }]
                  }
                  return []
                },
              },
            },
            {
              playable: true,
              playerActor: {
                traitsImplementing: (name: string) => {
                  if (name === 'PlayerResources') {
                    return [{
                      changeCash: (amt: number) => {
                        received.push(amt)
                        return amt
                      },
                    }]
                  }
                  return []
                },
              },
            },
            {
              playable: false,
              playerActor: {},
            },
          ],
        },
      } as any)
      mode.resolveOrder(worldActor, {
        orderName: DeveloperMode.Orders.GiveCashAll,
        targetString: '',
        extraData: 500,
      } as any)
      expect(received).toEqual([500, 500])
    })

    it('Heal order heals target actor to full HP', () => {
      const targetActor = createStubActor({
        traitsImplementing: (name: string) => {
          if (name === 'IHealth') {
            return [{
              maxHP: 100,
              hp: 50,
              inflictDamage: (
                _act: IGameActor,
                _attacker: IGameActor,
                damage: Damage,
                _ignore: boolean,
              ) => {
                // Damage value for heal is -maxHP
                expect(damage.value).toBe(-100)
              },
            }]
          }
          return []
        },
      })
      const target = Target.fromActor(targetActor as any)
      // HACK: Access private order fields via any for test
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Heal,
        targetString: '',
        extraData: 0,
        target,
      } as any)
    })

    it('Heal order ignores non-Actor targets', () => {
      const target = Target.fromCell(CPos.Zero)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Heal,
        targetString: '',
        extraData: 0,
        target,
      } as any)
      // Should not throw — silently ignores invalid target
    })

    it('Kill order kills target actor', () => {
      let killed = false
      const targetActor = createStubActor({
        kill: () => { killed = true },
        traitsImplementing: () => [],
      })
      const target = Target.fromActor(targetActor as any)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Kill,
        targetString: '',
        extraData: 0,
        target,
      } as any)
      expect(killed).toBe(true)
    })

    it('Kill order ignores non-Actor targets', () => {
      const target = Target.fromCell(CPos.Zero)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Kill,
        targetString: '',
        extraData: 0,
        target,
      } as any)
      // Should not throw
    })

    it('Dispose order disposes target actor', () => {
      let disposed = false
      const targetActor = createStubActor({
        dispose: () => { disposed = true },
        traitsImplementing: () => [],
      })
      const target = Target.fromActor(targetActor as any)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Dispose,
        targetString: '',
        extraData: 0,
        target,
      } as any)
      expect(disposed).toBe(true)
    })

    it('Dispose order ignores non-Actor targets', () => {
      const target = Target.fromCell(CPos.Zero)
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.Dispose,
        targetString: '',
        extraData: 0,
        target,
      } as any)
      // Should not throw
    })

    it('GiveExploration calls exploreAll on shroud', () => {
      let explored = false
      const expActor = createStubActor({
        owner: {
          shroud: { exploreAll: () => { explored = true } },
        },
      } as any)
      mode.resolveOrder(expActor, {
        orderName: DeveloperMode.Orders.GiveExploration,
        targetString: '',
        extraData: 0,
      } as any)
      expect(explored).toBe(true)
    })

    it('ResetExploration calls resetExploration on shroud', () => {
      let reset = false
      const expActor = createStubActor({
        owner: {
          shroud: { resetExploration: () => { reset = true } },
        },
      } as any)
      mode.resolveOrder(expActor, {
        orderName: DeveloperMode.Orders.ResetExploration,
        targetString: '',
        extraData: 0,
      } as any)
      expect(reset).toBe(true)
    })

    it('PlayerExperience calls giveExperience on PlayerExperience trait', () => {
      let expGiven = 0
      const expActor = createStubActor({
        owner: {
          playerActor: {
            traitOrDefault: (name: string) => {
              if (name === 'PlayerExperience') {
                return {
                  giveExperience: (amount: number) => { expGiven = amount },
                }
              }
              return undefined
            },
          },
        },
      } as any)
      mode.resolveOrder(expActor, {
        orderName: DeveloperMode.Orders.PlayerExperience,
        targetString: '',
        extraData: 100,
      } as any)
      expect(expGiven).toBe(100)
    })
  })

  // -------------------------------------------------------------------------
  // checkPermission
  // -------------------------------------------------------------------------

  describe('checkPermission', () => {
    it('returns false for null', () => {
      expect(DeveloperMode.checkPermission(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(DeveloperMode.checkPermission(undefined)).toBe(false)
    })

    it('returns false for disabled mode', () => {
      const mode = new DeveloperMode()
      expect(DeveloperMode.checkPermission(mode)).toBe(false)
    })

    it('returns true for enabled mode', () => {
      const mode = new DeveloperMode()
      mode.enabled = true
      expect(DeveloperMode.checkPermission(mode)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Orders constants
  // -------------------------------------------------------------------------

  describe('Orders constants', () => {
    it('has all order string constants', () => {
      expect(DeveloperMode.Orders.All).toBe('DevAll')
      expect(DeveloperMode.Orders.EnableTech).toBe('DevEnableTech')
      expect(DeveloperMode.Orders.FastCharge).toBe('DevFastCharge')
      expect(DeveloperMode.Orders.FastBuild).toBe('DevFastBuild')
      expect(DeveloperMode.Orders.GiveCash).toBe('DevGiveCash')
      expect(DeveloperMode.Orders.GiveCashAll).toBe('DevGiveCashAll')
      expect(DeveloperMode.Orders.GrowResources).toBe('DevGrowResources')
      expect(DeveloperMode.Orders.Visibility).toBe('DevVisibility')
      expect(DeveloperMode.Orders.GiveExploration).toBe('DevGiveExploration')
      expect(DeveloperMode.Orders.ResetExploration).toBe('DevResetExploration')
      expect(DeveloperMode.Orders.UnlimitedPower).toBe('DevUnlimitedPower')
      expect(DeveloperMode.Orders.BuildAnywhere).toBe('DevBuildAnywhere')
      expect(DeveloperMode.Orders.PlayerExperience).toBe('DevPlayerExperience')
      expect(DeveloperMode.Orders.Heal).toBe('DevHeal')
      expect(DeveloperMode.Orders.Kill).toBe('DevKill')
      expect(DeveloperMode.Orders.Dispose).toBe('DevDispose')
    })

    it('has PATH_DEBUG_ORDER_NAME constant', () => {
      expect(DeveloperMode.PATH_DEBUG_ORDER_NAME).toBe('DevPathDebug')
    })
  })

  // -------------------------------------------------------------------------
  // Notification constants
  // -------------------------------------------------------------------------

  describe('Notification constants', () => {
    it('has all notification keys', () => {
      expect(DeveloperMode.CHEAT_USED).toBe('notification-cheat-used')
      expect(DeveloperMode.CHEAT_ENABLED).toBe('notification-cheat-enabled')
      expect(DeveloperMode.CHEAT_DISABLED).toBe('notification-cheat-disabled')
    })
  })

  // -------------------------------------------------------------------------
  // enabled gating — edge cases
  // -------------------------------------------------------------------------

  describe('enabled gating', () => {
    it('properties return false immediately after disabling', () => {
      const mode = createDevMode({
        fastBuild: true,
        fastCharge: true,
        disableShroud: true,
        unlimitedPower: true,
        buildAnywhere: true,
        pathDebug: true,
      })
      mode.enabled = true
      // Toggle allTech on
      const actor = createStubActor()
      mode.resolveOrder(actor, {
        orderName: DeveloperMode.Orders.EnableTech,
        targetString: '',
        extraData: 0,
      })
      expect(mode.allTech).toBe(true)

      // Now disable
      mode.enabled = false
      expect(mode.fastBuild).toBe(false)
      expect(mode.fastCharge).toBe(false)
      expect(mode.disableShroud).toBe(false)
      expect(mode.unlimitedPower).toBe(false)
      expect(mode.buildAnywhere).toBe(false)
      expect(mode.pathDebug).toBe(false)
      expect(mode.allTech).toBe(false)
    })

    it('properties preserve internal state when re-enabled', () => {
      const mode = createDevMode({ fastBuild: true })
      mode.enabled = true
      expect(mode.fastBuild).toBe(true)

      mode.enabled = false
      expect(mode.fastBuild).toBe(false)

      mode.enabled = true
      expect(mode.fastBuild).toBe(true) // config default still applies
    })
  })
})
