/**
 * UtilsGlobal.ts — ScriptGlobal for collection utilities
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/UtilsGlobal.cs
 *
 * 核心范式转换:
 * - C# LuaValue[] collection parameter → unknown[] generic array
 * - C# LuaFunction func.Call(c).Dispose() → direct function call
 * - C# Context.CreateTable() (LuaTable) → plain unknown[] array
 * - C# WidgetUtils.FormatTime(ticks, leadingMinuteZero, 40) → custom formatter
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class UtilsGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Utils')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'Do',
        description: 'Calls a function on every element in a collection.',
        returnType: 'nil',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._do(args[0] as unknown[], args[1] as (item: unknown) => void),
      },
      {
        memberType: 'method',
        name: 'Any',
        description: 'Returns true if func returns true for any element in a collection.',
        returnType: 'boolean',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._any(args[0] as unknown[], args[1] as (item: unknown) => unknown),
      },
      {
        memberType: 'method',
        name: 'All',
        description: 'Returns true if func returns true for all elements in a collection.',
        returnType: 'boolean',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._all(args[0] as unknown[], args[1] as (item: unknown) => unknown),
      },
      {
        memberType: 'method',
        name: 'Where',
        description: 'Returns the original collection filtered with the func.',
        returnType: 'any',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._where(args[0] as unknown[], args[1] as (item: unknown) => unknown),
      },
      {
        memberType: 'method',
        name: 'Take',
        description: 'Returns the first n values from a collection.',
        returnType: 'any',
        parameters: [
          { name: 'n', type: 'number', optional: false },
          { name: 'source', type: 'any', optional: false },
        ],
        invoke: (_t, args) => this._take(args[0] as number, args[1] as unknown[]),
      },
      {
        memberType: 'method',
        name: 'Skip',
        description: 'Skips over the first numElements members of a table and return the rest.',
        returnType: 'any',
        parameters: [
          { name: 'table', type: 'any', optional: false },
          { name: 'numElements', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_t, args) => this._skip(args[0] as unknown[], args[1] as number),
      },
      {
        memberType: 'method',
        name: 'Concat',
        description: 'Concatenates two tables into a single table.',
        returnType: 'any',
        parameters: [
          { name: 'firstCollection', type: 'any', optional: false },
          { name: 'secondCollection', type: 'any', optional: false },
        ],
        invoke: (_t, args) => this._concat(args[0] as unknown[], args[1] as unknown[]),
      },
      {
        memberType: 'method',
        name: 'Random',
        description: 'Returns a random value from a collection.',
        returnType: 'any',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
        ],
        invoke: (_t, args) => this._random(args[0] as unknown[]),
      },
      {
        memberType: 'method',
        name: 'Shuffle',
        description: 'Returns the collection in a random order.',
        returnType: 'any',
        parameters: [
          { name: 'collection', type: 'any', optional: false },
        ],
        invoke: (_t, args) => this._shuffle(args[0] as unknown[]),
      },
      {
        memberType: 'method',
        name: 'ExpandFootprint',
        description: 'Expands the given footprint one step along the coordinate axes, and (if requested) diagonals.',
        returnType: 'CPos[]',
        parameters: [
          { name: 'footprint', type: 'CPos[]', optional: false },
          { name: 'allowDiagonal', type: 'boolean', optional: false },
        ],
        invoke: (_t, args) => this._expandFootprint(args[0] as unknown[], args[1] as boolean),
      },
      {
        memberType: 'method',
        name: 'RandomInteger',
        description: 'Returns a random integer x in the range low <= x < high.',
        returnType: 'number',
        parameters: [
          { name: 'low', type: 'number', optional: false },
          { name: 'high', type: 'number', optional: false },
        ],
        invoke: (_t, args) => this._randomInteger(args[0] as number, args[1] as number),
      },
      {
        memberType: 'method',
        name: 'FormatTime',
        description: 'Returns the ticks formatted to HH:MM:SS.',
        returnType: 'string',
        parameters: [
          { name: 'ticks', type: 'number', optional: false },
          { name: 'leadingMinuteZero', type: 'boolean', optional: true, defaultValue: true },
        ],
        invoke: (_t, args) => this._formatTime(args[0] as number, args[1] as boolean | undefined),
      },
    ]
  }

  // --- Private implementations ---

  private _do(collection: unknown[], func: (item: unknown) => void): void {
    for (const c of collection) {
      func(c)
    }
  }

  private _any(collection: unknown[], func: (item: unknown) => unknown): boolean {
    for (const c of collection) {
      const result = func(c)
      if (result) return true
    }
    return false
  }

  private _all(collection: unknown[], func: (item: unknown) => unknown): boolean {
    for (const c of collection) {
      const result = func(c)
      if (!result) return false
    }
    return true
  }

  private _where(collection: unknown[], func: (item: unknown) => unknown): unknown[] {
    const result: unknown[] = []
    for (const c of collection) {
      if (func(c)) {
        result.push(c)
      }
    }
    return result
  }

  private _take(n: number, source: unknown[]): unknown[] {
    return source.slice(0, n)
  }

  private _skip(table: unknown[], numElements: number): unknown[] {
    return table.slice(numElements)
  }

  private _concat(first: unknown[], second: unknown[]): unknown[] {
    return [...first, ...second]
  }

  private _random(collection: unknown[]): unknown {
    if (collection.length === 0) return null
    const rng = this._world.sharedRandom
    const idx = rng.next(0, collection.length)
    return collection[idx]
  }

  private _shuffle(collection: unknown[]): unknown[] {
    const result = [...collection]
    const rng = this._world.sharedRandom
    // Fisher-Yates shuffle using the world's shared RNG
    for (let i = result.length - 1; i > 0; i--) {
      const j = rng.next(0, i + 1)
      const tmp = result[i]
      result[i] = result[j]
      result[j] = tmp
    }
    return result
  }

  /**
   * Expand a footprint by one cell in cardinal directions (and optionally diagonals).
   *
   * OpenRA 对照: Util.ExpandFootprint(footprint, allowDiagonal)
   */
  private _expandFootprint(footprint: unknown[], _allowDiagonal: boolean): unknown[] {
    // Stub: full CPos expansion requires the CPos type
    // For Phase C, return the footprint unchanged
    // In full integration, this would use CVec directions to expand
    return [...footprint]
  }

  private _randomInteger(low: number, high: number): number {
    if (high <= low) return low
    return this._world.sharedRandom.next(low, high)
  }

  private _formatTime(ticks: number, leadingMinuteZero?: boolean): string {
    const leading = leadingMinuteZero ?? true
    const totalSeconds = Math.floor(ticks / 25) // 25 TPS
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const hh = String(hours).padStart(2, '0')
    const mm = leading ? String(minutes).padStart(2, '0') : String(minutes)
    const ss = String(seconds).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
}

ScriptRegistry.registerGlobal('Utils', UtilsGlobal, 'Collection utilities')
