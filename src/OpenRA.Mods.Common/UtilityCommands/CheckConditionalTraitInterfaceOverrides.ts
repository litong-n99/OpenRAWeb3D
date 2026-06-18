/**
 * CheckConditionalTraitInterfaceOverrides.ts — 验证 ConditionalTrait 子类重写正确的方法
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CheckConditionalTraitInterfaceOverrides.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<T> 泛型基类 → TypeScript ConditionalTrait 抽象基类
 * - C# Type.GetMethod(interfaceType.FullName + "." + methodName) 反射
 *   → TypeScript 的原型属性描述符检查 + 方法签名验证
 * - C# IsGenericType && GetGenericTypeDefinition() == typeof(ConditionalTrait<>)
 *   → TypeScript 的原型链遍历 + 特征方法检测
 *
 * 关键边界说明:
 * 与 OpenRA（名义类型 + 显式接口实现）不同，TypeScript 使用结构类型。
 * "直接实现接口方法" 与 "重写基类虚方法" 在运行时无法区分 —
 * TypeScript interface 完全擦除，且方法调度始终通过原型链。
 * `tsc --noEmit` 已在编译时强制执行方法签名兼容性。
 *
 * 因此，此命令:
 * 1. 检测 ConditionalTrait 子类是否在自身原型上重写了 `created()`
 *    和/或 `getVariableObservers()`（记录信息性日志）
 * 2. 检测方法是否被错误地定义为 getter/setter 而非函数（违规）
 * 3. 对于未重写任一方法的子类，记录一条提示性消息
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// ConditionalTrait 检测（对应 OpenRA IsConditionalTrait）
// ---------------------------------------------------------------------------

/**
 * ConditionalTrait 基类在原型上暴露的特征方法集合。
 *
 * 任何原型上同时具有这三个方法的类都被视为 ConditionalTrait 子类。
 * 这取代了 C# 的运行时泛型类型检查。
 */
const CONDITIONAL_TRAIT_SIGNATURE_METHODS = [
  'isTraitDisabled',
  'created',
  'getVariableObservers',
] as const

/**
 * 通过检查构造函数原型链，确定一个类是否为 ConditionalTrait 子类。
 *
 * OpenRA 对照: IsConditionalTrait(Type) — 遍历继承链检查 ConditionalTrait<>
 *
 * @param ctor — 要检查的构造函数
 * @returns 如果是条件 trait 子类则返回 true
 */
function isConditionalTraitSubclass(
  ctor: new (...args: unknown[]) => unknown,
): boolean {
  const proto = ctor.prototype as Record<string, unknown>

  // 直接检查原型上的特征方法
  const hasSignature = CONDITIONAL_TRAIT_SIGNATURE_METHODS.every(
    (m) => typeof proto[m] === 'function',
  )
  if (hasSignature) return true

  // 检查父类原型链
  const parentProto = Object.getPrototypeOf(ctor.prototype)
  if (parentProto && parentProto !== Object.prototype) {
    const parentRecord = parentProto as Record<string, unknown>
    return CONDITIONAL_TRAIT_SIGNATURE_METHODS.every(
      (m) => typeof parentRecord[m] === 'function',
    )
  }

  return false
}

// ---------------------------------------------------------------------------
// 需要重写的接口方法（对应 OpenRA CheckInterfaceViolation）
// ---------------------------------------------------------------------------

interface InterfaceMethodEntry {
  interfaceName: string
  methodName: string
}

const INTERFACE_METHODS_TO_CHECK: InterfaceMethodEntry[] = [
  { interfaceName: 'INotifyCreated', methodName: 'created' },
  { interfaceName: 'IObservesVariables', methodName: 'getVariableObservers' },
]

// ---------------------------------------------------------------------------
// CheckConditionalTraitInterfaceOverrides（对应 OpenRA 类）
// ---------------------------------------------------------------------------

/**
 * 验证 ConditionalTrait 子类正确处理了接口方法重写。
 *
 * OpenRA 对照: public class CheckConditionalTraitInterfaceOverrides : IUtilityCommand
 */
export class CheckConditionalTraitInterfaceOverrides
  implements IUtilityCommand
{
  readonly name = '--check-conditional-trait-interface-overrides'

  private _violationCount = 0

  // ---------------------------------------------------------------------------
  // validateArguments
  // ---------------------------------------------------------------------------

  validateArguments(args: string[]): boolean {
    return args.length === 0
  }

  // ---------------------------------------------------------------------------
  // run
  // ---------------------------------------------------------------------------

  run(utility: Utility, _args: string[]): void {
    this._violationCount = 0

    console.log(
      'NOTE: In TypeScript, interfaces are structurally typed and erased at ' +
        'compile time. "Explicit interface implementation" vs. "virtual method ' +
        'override" are indistinguishable at runtime. This command performs ' +
        'heuristic checks on ConditionalTrait subclasses.',
    )

    console.log(
      'Checking conditional trait interface overrides in mod: ' +
        utility.modData.manifest.id,
    )

    const classNames = utility.modData.objectCreator.registeredNames

    for (const className of classNames) {
      const ctor = utility.modData.objectCreator.getType(className)
      if (!ctor) continue
      if (typeof ctor !== 'function' || !ctor.prototype) continue
      if (
        !isConditionalTraitSubclass(
          ctor as new (...args: unknown[]) => unknown,
        )
      )
        continue

      this._checkConditionalTraitClass(className, ctor)
    }

    if (this._violationCount > 0) {
      console.log(
        `Conditional trait interface override violations: ${this._violationCount}`,
      )
      console.log(
        'Hint: ConditionalTrait subclasses should override `created()` and/or ' +
          '`getVariableObservers()` as prototype methods, not instance properties.',
      )
      this._exitWithError()
    } else {
      console.log(
        'No conditional trait interface override violations found.',
      )
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 检查单个 ConditionalTrait 子类。
   *
   * 检查项:
   * 1. 如果子类在自身原型上重写了 created() — 记录信息性日志（正确行为）
   * 2. 如果子类在自身原型上重写了 getVariableObservers() — 记录信息性日志
   * 3. 如果方法被定义为 getter/setter 而非函数 — **违规**（会破坏原型链调度）
   * 4. 如果子类完全未重写任一方法 — 记录提示（默认实现已足够）
   *
   * @param className — 类名
   * @param ctor — 类构造函数
   */
  private _checkConditionalTraitClass(
    className: string,
    ctor: new (...args: unknown[]) => unknown,
  ): void {
    const proto = ctor.prototype as Record<string, unknown>
    const ownKeys = new Set(Object.getOwnPropertyNames(proto))

    for (const entry of INTERFACE_METHODS_TO_CHECK) {
      const { methodName, interfaceName } = entry

      if (!ownKeys.has(methodName)) continue

      const desc = Object.getOwnPropertyDescriptor(proto, methodName)
      if (!desc) continue

      // 违规: 方法被定义为 accessor property（getter/setter）而非函数
      if (typeof desc.get === 'function' || typeof desc.set === 'function') {
        console.error(
          `${className}: '${methodName}' is defined as a getter/setter, ` +
            `not a method. ConditionalTrait subclasses must override ` +
            `${methodName}() as a prototype method to properly handle ` +
            `${interfaceName}.`,
        )
        this._violationCount++
        continue
      }

      // 正确: 方法定义为函数（正在重写 ConditionalTrait 的处理程序）
      if (typeof desc.value === 'function') {
        console.log(
          `\t${className}.${methodName}() — correctly overrides ` +
            `ConditionalTrait's ${interfaceName} handler`,
        )
      }
    }

    // 提示: 子类未重写任一关键方法
    if (!ownKeys.has('created') && !ownKeys.has('getVariableObservers')) {
      console.log(
        `\t${className} — no overrides for created() or ` +
          `getVariableObservers() (using ConditionalTrait defaults)`,
      )
    }
  }

  /**
   * 以错误码退出。
   */
  private _exitWithError(): void {
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1)
    }
  }
}
