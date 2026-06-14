/**
 * Pluggable.ts — 可插接 trait（建筑连接器接收端）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Pluggable.cs (160 lines)
 *
 * 核心范式转换:
 * - C# PluggableInfo : TraitInfo, IEditorActorOptions → TS PluggableInfo
 *   implements ITraitInfo (IEditorActorOptions 延迟至编辑器系统)
 * - C# FrozenDictionary<string, BooleanExpression> → TS Map<string, string>
 *   (BooleanExpression 以字符串形式存储，运行时解析求值)
 * - C# Pluggable : IObservesVariables, INotifyCreated → TS 同接口
 * - C# VariableObserver 委托 → TS VariableObserver interface
 * - C# GrantCondition/RevokeCondition → TS duck-typed grantCondition/revokeCondition
 * - C# Actor.InvalidConditionToken (-1) → TS 常量 -1
 * - C# IEditorActorOptions → 全部延迟至编辑器系统迁移
 * - C# PlugInit / ValueActorInit → 简化为构造函数直接接收初始 plug 类型
 */

import type {
  ITraitInfo,
  IGameActor,
  INotifyCreated,
  IObservesVariables,
  VariableObserver,
  VariableObserverNotifier,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// InvalidConditionToken
// OpenRA 对照: Actor.InvalidConditionToken (-1)
// ---------------------------------------------------------------------------

const InvalidConditionToken = -1

// ---------------------------------------------------------------------------
// BooleanExpression helpers
// OpenRA 对照: OpenRA.Support.BooleanExpression
// ---------------------------------------------------------------------------

/** Evaluate a BooleanExpression string against a variable map.
 *
 * OpenRA 对照: BooleanExpression.Evaluate(ConditionPair[])
 *
 * Supports: variable names, ! (NOT), && (AND), || (OR).
 * Variables are truthy when their value in conditions > 0.
 * Parenthesized groups are supported for precedence.
 */
function evaluateBooleanExpression(
  expr: string,
  conditions: ReadonlyMap<string, number>,
): boolean {
  const trimmed = expr.trim()
  if (!trimmed) return true

  // --- || (lowest precedence) ---
  {
    let depth = 0
    for (let i = 0; i < trimmed.length - 1; i++) {
      const c = trimmed[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (depth === 0 && c === '|' && trimmed[i + 1] === '|') {
        return (
          evaluateBooleanExpression(trimmed.substring(0, i).trim(), conditions) ||
          evaluateBooleanExpression(trimmed.substring(i + 2).trim(), conditions)
        )
      }
    }
  }

  // --- && ---
  {
    let depth = 0
    for (let i = 0; i < trimmed.length - 1; i++) {
      const c = trimmed[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (depth === 0 && c === '&' && trimmed[i + 1] === '&') {
        return (
          evaluateBooleanExpression(trimmed.substring(0, i).trim(), conditions) &&
          evaluateBooleanExpression(trimmed.substring(i + 2).trim(), conditions)
        )
      }
    }
  }

  // --- ! (prefix negation) ---
  if (trimmed.startsWith('!')) {
    return !evaluateBooleanExpression(trimmed.substring(1).trim(), conditions)
  }

  // --- ( ... ) parenthesized group ---
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return evaluateBooleanExpression(
      trimmed.substring(1, trimmed.length - 1).trim(),
      conditions,
    )
  }

  // --- terminal: variable name ---
  if (trimmed.length === 0) return true
  return conditions.has(trimmed) && (conditions.get(trimmed) ?? 0) > 0
}

/** Extract variable names from a BooleanExpression string.
 *
 * OpenRA 对照: BooleanExpression.Variables
 */
function extractVariables(expr: string): readonly string[] {
  const cleaned = expr.replace(/\s+/g, '')
  if (!cleaned) return []

  // Split on || then && to get individual terms
  const orSegments = cleaned.split('||')
  const andSegments = orSegments.flatMap((s) => s.split('&&'))

  const vars = new Set<string>()
  for (const seg of andSegments) {
    // Strip leading ! (negation) and remove parenthesized markers
    const name = seg.startsWith('!') ? seg.slice(1) : seg
    // Remove any remaining parentheses
    const clean = name.replace(/[()]/g, '')
    if (clean) vars.add(clean)
  }

  return Array.from(vars)
}

// ---------------------------------------------------------------------------
// PluggableInfo
// OpenRA 对照: PluggableInfo : TraitInfo, IEditorActorOptions
// ---------------------------------------------------------------------------

/** Configuration for the Pluggable trait.
 *
 * OpenRA 对照: PluggableInfo
 *
 * Defines plug socket configuration including accepted plug types,
 * condition grants, and requirement expressions.
 */
export class PluggableInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Footprint cell offset where a plug can be placed.
   *
   * OpenRA 对照: PluggableInfo.Offset (default CVec.Zero)
   */
  readonly offset: CVec = CVec.Zero

  /** Conditions to grant for each accepted plug type.
   *
   * OpenRA 对照: PluggableInfo.Conditions (FrozenDictionary<string, string>)
   *
   * Key is the plug type. Value is the condition granted when the plug is
   * enabled.
   *
   * [FieldLoader.Require]
   */
  readonly conditions: ReadonlyMap<string, string>

  /** Requirements for accepting a plug type.
   *
   * OpenRA 对照: PluggableInfo.Requirements (FrozenDictionary<string, BooleanExpression>)
   *
   * Key is the plug type. Value is the BooleanExpression string defining
   * the requirements to place the plug.
   */
  readonly requirements: ReadonlyMap<string, string>

  /** Editor options for the map editor dropdown.
   *
   * OpenRA 对照: PluggableInfo.EditorOptions (FrozenDictionary<string, string>)
   *
   * Key is the plug type. Value is the display label.
   *
   * TODO-21-EDITOR: Integrate with map editor when editor system is migrated.
   */
  readonly editorOptions: ReadonlyMap<string, string>

  /** Label for an empty plug socket in the editor.
   *
   * OpenRA 对照: PluggableInfo.EmptyOption (default "Empty")
   */
  readonly emptyOption: string

  /** Display order for the dropdown in the map editor.
   *
   * OpenRA 对照: PluggableInfo.EditorDisplayOrder (default 5)
   */
  readonly editorDisplayOrder: number

  constructor(params: {
    instanceName?: string
    offset?: CVec
    conditions?: ReadonlyMap<string, string> | Record<string, string>
    requirements?: ReadonlyMap<string, string> | Record<string, string>
    editorOptions?: ReadonlyMap<string, string> | Record<string, string>
    emptyOption?: string
    editorDisplayOrder?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.offset = params.offset ?? CVec.Zero
    this.emptyOption = params.emptyOption ?? 'Empty'
    this.editorDisplayOrder = params.editorDisplayOrder ?? 5

    // Normalize conditions
    if (params.conditions instanceof Map) {
      this.conditions = params.conditions
    } else if (params.conditions) {
      this.conditions = new Map(Object.entries(params.conditions))
    } else {
      this.conditions = new Map()
    }

    // Normalize requirements (BooleanExpression strings)
    if (params.requirements instanceof Map) {
      this.requirements = params.requirements
    } else if (params.requirements) {
      this.requirements = new Map(Object.entries(params.requirements))
    } else {
      this.requirements = new Map()
    }

    // Normalize editor options
    if (params.editorOptions instanceof Map) {
      this.editorOptions = params.editorOptions
    } else if (params.editorOptions) {
      this.editorOptions = new Map(Object.entries(params.editorOptions))
    } else {
      this.editorOptions = new Map()
    }
  }
}

// ---------------------------------------------------------------------------
// Pluggable
// OpenRA 对照: Pluggable : IObservesVariables, INotifyCreated
// ---------------------------------------------------------------------------

/** Enables/disables plugs on buildings.
 *
 * OpenRA 对照: Pluggable
 *
 * Manages plug sockets on a building. Each plug type maps to a condition
 * that is granted/revoked when the plug is enabled/disabled. Optional
 * BooleanExpression requirements can gate plug acceptance.
 */
export class Pluggable implements IObservesVariables, INotifyCreated {
  /** User-facing configuration. */
  readonly info: PluggableInfo

  /** The initial plug type from initialization data.
   *
   * OpenRA 对照: initialPlug (from PlugInit)
   */
  private _initialPlug: string | null

  /** The condition token for the currently active plug.
   *
   * OpenRA 对照: conditionToken (Actor.InvalidConditionToken when none)
   */
  private _conditionToken: number = InvalidConditionToken

  /** Per-plug-type availability flags, updated by variable observers.
   *
   * OpenRA 对照: plugTypesAvailability (Dictionary<string, bool>)
   */
  private _plugTypesAvailability: Map<string, boolean> | null = null

  /** The currently active plug type.
   *
   * OpenRA 对照: active (string)
   */
  private _active: string | null = null

  /** Cached reference to the owning actor, set during created(). */
  private _self: IGameActor | null = null

  constructor(info: PluggableInfo, initialPlug?: string | null) {
    this.info = info
    this._initialPlug = initialPlug ?? null

    // Initialize plug availability map
    if (info.requirements.size > 0) {
      this._plugTypesAvailability = new Map()
      for (const plugType of info.requirements.keys()) {
        this._plugTypesAvailability.set(plugType, true)
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: INotifyCreated.Created(Actor self)
  // -----------------------------------------------------------------------

  /** Called when the actor is fully created.
   *
   * If an initial plug was specified, enable it immediately.
   */
  created(self: IGameActor): void {
    this._self = self
    if (this._initialPlug !== null) {
      this.enablePlug(self, this._initialPlug)
    }
  }

  // -----------------------------------------------------------------------
  // AcceptsPlug
  // OpenRA 对照: Pluggable.AcceptsPlug(string type)
  // -----------------------------------------------------------------------

  /** Check whether a given plug type is accepted by this Pluggable.
   *
   * OpenRA 对照: Pluggable.AcceptsPlug(string type)
   *
   * A plug type is accepted if:
   * 1. The type exists in Info.Conditions
   * 2. If there are no requirements for this type: no plug is currently active
   *    (only one plug at a time)
   * 3. If there are requirements: the plug type's availability flag is true
   *
   * @param type — the plug type to check
   * @returns whether this plug type can be enabled
   */
  acceptsPlug(type: string): boolean {
    if (!this.info.conditions.has(type)) return false

    if (!this.info.requirements.has(type)) {
      return this._active === null
    }

    return this._plugTypesAvailability?.get(type) ?? false
  }

  // -----------------------------------------------------------------------
  // EnablePlug
  // OpenRA 对照: Pluggable.EnablePlug(Actor self, string type)
  // -----------------------------------------------------------------------

  /** Enable a plug of the given type.
   *
   * OpenRA 对照: Pluggable.EnablePlug(Actor self, string type)
   *
   * Grants the condition associated with this plug type. Revokes any
   * previously active plug's condition first. Sets the active plug type.
   *
   * @param self — the owning actor
   * @param type — the plug type to enable
   */
  enablePlug(self: IGameActor, type: string): void {
    const condition = this.info.conditions.get(type)
    if (!condition) return

    // Revoke any previous condition
    if (this._conditionToken !== InvalidConditionToken) {
      this._revokeCondition(self, this._conditionToken)
    }

    // Grant the new condition
    this._conditionToken = this._grantCondition(self, condition)
    this._active = type
  }

  // -----------------------------------------------------------------------
  // DisablePlug
  // OpenRA 对照: Pluggable.DisablePlug(Actor self, string type)
  // -----------------------------------------------------------------------

  /** Disable a plug of the given type.
   *
   * OpenRA 对照: Pluggable.DisablePlug(Actor self, string type)
   *
   * Only disables if the given type matches the currently active plug.
   * Revokes the condition token and clears the active plug type.
   *
   * @param self — the owning actor
   * @param type — the plug type to disable
   */
  disablePlug(self: IGameActor, type: string): void {
    if (type !== this._active) return

    if (this._conditionToken !== InvalidConditionToken) {
      this._conditionToken = this._revokeCondition(self, this._conditionToken)
    }

    this._active = null
  }

  // -----------------------------------------------------------------------
  // IObservesVariables
  // OpenRA 对照: IObservesVariables.GetVariableObservers()
  // -----------------------------------------------------------------------

  /** Return variable observers for evaluating plug type requirements.
   *
   * OpenRA 对照: IObservesVariables.GetVariableObservers()
   *
   * For each requirement expression, creates a VariableObserver that
   * re-evaluates the BooleanExpression whenever referenced variables change.
   */
  getVariableObservers(): readonly VariableObserver[] {
    if (!this._plugTypesAvailability) return []

    const observers: VariableObserver[] = []

    for (const [plugType, expr] of this.info.requirements) {
      const variables = extractVariables(expr)
      if (variables.length === 0) continue

      const notifier: VariableObserverNotifier = (
        _self: IGameActor,
        conditions: ReadonlyMap<string, number>,
      ) => {
        const result = evaluateBooleanExpression(expr, conditions)
        this._plugTypesAvailability!.set(plugType, result)
      }

      observers.push({ notifier, variables })
    }

    return observers
  }

  // -----------------------------------------------------------------------
  // Public accessors (matching C# fields for introspection)
  // -----------------------------------------------------------------------

  /** The currently active plug type, or null if none.
   *
   * OpenRA 对照: Pluggable.active
   */
  get active(): string | null {
    return this._active
  }

  /** The current condition token, or InvalidConditionToken (-1) if none.
   *
   * OpenRA 对照: Pluggable.conditionToken
   */
  get conditionToken(): number {
    return this._conditionToken
  }

  /** The owning actor reference.
   *
   * OpenRA 对照: N/A (C# uses method parameter `self`)
   */
  get self(): IGameActor | null {
    return this._self
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Grant a condition on the actor via duck-typed grantCondition.
   *
   * OpenRA 对照: self.GrantCondition(condition)
   */
  private _grantCondition(self: IGameActor, condition: string): number {
    const actor = self as unknown as {
      grantCondition?: (cond: string) => number
    }
    if (typeof actor.grantCondition === 'function') {
      return actor.grantCondition(condition)
    }
    // Fallback when condition system not available
    return InvalidConditionToken
  }

  /** Revoke a condition on the actor via duck-typed revokeCondition.
   *
   * OpenRA 对照: self.RevokeCondition(token)
   */
  private _revokeCondition(self: IGameActor, token: number): number {
    const actor = self as unknown as {
      revokeCondition?: (tok: number) => number
    }
    if (typeof actor.revokeCondition === 'function') {
      return actor.revokeCondition(token)
    }
    return InvalidConditionToken
  }
}
