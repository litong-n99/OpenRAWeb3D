/**
 * ScriptObjectWrapper.test.ts — ScriptObjectWrapper unit tests
 *
 * Tests focus on: bind/unbind member management, get/set property access,
 * method invocation with argument conversion, error messages.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptObjectWrapper, ScriptGlobal } from './ScriptObjectWrapper'
import type { IScriptContext } from './ScriptMemberDescriptor'
import type { MemberDescriptor } from './ScriptMemberDescriptor'

// ---------------------------------------------------------------------------
// Minimal stub context
// ---------------------------------------------------------------------------

const stubContext: IScriptContext = {
  world: { actors: [] } as any,
  worldRenderer: {},
  fatalErrorOccurred: false,
  errorMessage: null,
  getActorCommands: () => [],
  playerCommands: [],
  registerMapActor: () => {},
  fatalError: () => {},
  logDebug: () => {},
  get namedActors() { return new Map() },
}

// ---------------------------------------------------------------------------
// Test helper — concrete subclass for testing
// ---------------------------------------------------------------------------

class TestWrapper extends ScriptObjectWrapper {
  private _myMemberDescriptors: MemberDescriptor[] = []

  constructor(context: IScriptContext, descriptors: MemberDescriptor[]) {
    super(context)
    this._myMemberDescriptors = descriptors
  }

  protected override duplicateKeyError(memberName: string): string {
    return `Test: duplicate key '${memberName}'`
  }

  protected override memberNotFoundError(memberName: string): string {
    return `Test: member '${memberName}' not found`
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return this._myMemberDescriptors
  }

  /** Expose bind for testing */
  testBind(objects: object[]): void {
    this.bind(objects)
  }

  /** Expose unbind for testing */
  testUnbind(ctor: new (...args: any[]) => any): void {
    this.unbind(ctor)
  }
}

// ---------------------------------------------------------------------------
// Test objects
// ---------------------------------------------------------------------------

class TestObject {
  get name(): string { return 'test' }
  set name(_v: string) {}
  greet(msg: string): string { return `Hello, ${msg}` }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptObjectWrapper', () => {
  let wrapper: TestWrapper

  beforeEach(() => {
    wrapper = new TestWrapper(stubContext, [])
  })

  describe('bind', () => {
    it('populates members from descriptors', () => {
      const obj = new TestObject()
      const descriptors: MemberDescriptor[] = [
        {
          memberType: 'property',
          name: 'name',
          returnType: 'string',
          get: (t) => (t as TestObject).name,
          set: (t, v) => { (t as TestObject).name = v as string },
        },
        {
          memberType: 'method',
          name: 'greet',
          returnType: 'string',
          parameters: [{ name: 'msg', type: 'string', optional: false }],
          invoke: (t, args) => (t as TestObject).greet(args[0] as string),
        },
      ]
      wrapper = new TestWrapper(stubContext, descriptors)
      wrapper.testBind([obj])

      expect(wrapper.containsKey('name')).toBe(true)
      expect(wrapper.containsKey('greet')).toBe(true)
    })

    it('throws on duplicate member names', () => {
      const obj1 = new TestObject()
      const obj2 = { get name() { return 'other' }, set name(_v: string) {} }

      // Provide different descriptors with same name
      // We need to test across objects — bind creates descriptors from both
      class DuplicateWrapper extends ScriptObjectWrapper {
        protected duplicateKeyError = (m: string) => `dup: ${m}`
        protected memberNotFoundError = (m: string) => `not found: ${m}`
        protected getMemberDescriptors(obj: object): MemberDescriptor[] {
          if (obj === obj1) {
            return [{
              memberType: 'property', name: 'name', returnType: 'string',
              get: (t) => (t as any).name,
            }]
          }
          return [{
            memberType: 'property', name: 'name', returnType: 'string',
            get: (t) => (t as any).name,
          }]
        }
        testBind(objects: object[]) { this.bind(objects) }
      }

      const dupWrap = new DuplicateWrapper(stubContext)
      expect(() => dupWrap.testBind([obj1, obj2])).toThrow(/dup/)
    })
  })

  describe('containsKey', () => {
    it('returns false for missing key', () => {
      expect(wrapper.containsKey('nope')).toBe(false)
    })

    it('returns true for existing key after bind', () => {
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'property',
        name: 'count',
        returnType: 'number',
        get: () => 42,
      }])
      wrapper.testBind([{}])
      expect(wrapper.containsKey('count')).toBe(true)
    })
  })

  describe('get', () => {
    it('gets a property value', () => {
      const obj = { count: 42 }
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'property',
        name: 'count',
        returnType: 'number',
        get: (t) => (t as typeof obj).count,
      }])
      wrapper.testBind([obj])
      expect(wrapper.get('count')).toBe(42)
    })

    it('throws on write-only property', () => {
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'property',
        name: 'x',
        returnType: 'number',
        set: () => {},
      }])
      wrapper.testBind([{}])
      expect(() => wrapper.get('x')).toThrow(/write-only/)
    })

    it('throws on missing member', () => {
      expect(() => wrapper.get('missing')).toThrow(/not found/)
    })

    it('invokes method and returns result', () => {
      const obj = {
        add(a: number, b: number): number { return a + b },
      }
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'method',
        name: 'add',
        returnType: 'number',
        parameters: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        invoke: (t, args) => (t as typeof obj).add(args[0] as number, args[1] as number),
      }])
      wrapper.testBind([obj])

      const fn = wrapper.get('add') as Function
      const result = fn(3, 4)
      expect(result).toBe(7)
    })
  })

  describe('set', () => {
    it('sets a property value', () => {
      const obj = { name: 'old' }
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'property',
        name: 'name',
        returnType: 'string',
        get: (t) => (t as typeof obj).name,
        set: (t, v) => { (t as typeof obj).name = v as string },
      }])
      wrapper.testBind([obj])
      wrapper.set('name', 'new')
      expect(obj.name).toBe('new')
    })

    it('throws on read-only property', () => {
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'property',
        name: 'readonly',
        returnType: 'number',
        get: () => 42,
      }])
      wrapper.testBind([{}])
      expect(() => wrapper.set('readonly', 100)).toThrow(/read-only/)
    })

    it('throws when setting a method', () => {
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'method',
        name: 'doIt',
        returnType: 'nil',
        parameters: [],
        invoke: () => null,
      }])
      wrapper.testBind([{}])
      expect(() => wrapper.set('doIt', 1)).toThrow(/cannot be set/)
    })
  })

  describe('unbind', () => {
    it('removes all members from a specific class', () => {
      class A {
        get x(): number { return 1 }
      }
      class B {
        get y(): number { return 2 }
      }

      const a = new A()
      const b = new B()

      class MultiWrapper extends ScriptObjectWrapper {
        protected duplicateKeyError = (m: string) => `dup: ${m}`
        protected memberNotFoundError = (m: string) => `not found: ${m}`
        protected getMemberDescriptors(obj: object): MemberDescriptor[] {
          if (obj instanceof A) {
            return [{ memberType: 'property', name: 'x', returnType: 'number', get: (t) => (t as A).x }]
          }
          return [{ memberType: 'property', name: 'y', returnType: 'number', get: (t) => (t as B).y }]
        }
        testBind(objects: object[]) { this.bind(objects) }
        testUnbind(ctor: new (...args: any[]) => any) { this.unbind(ctor) }
      }

      const mw = new MultiWrapper(stubContext)
      mw.testBind([a, b])
      expect(mw.containsKey('x')).toBe(true)
      expect(mw.containsKey('y')).toBe(true)

      mw.testUnbind(A)
      expect(mw.containsKey('x')).toBe(false)
      expect(mw.containsKey('y')).toBe(true) // B's member still exists
    })
  })

  describe('method argument conversion', () => {
    it('uses default values for omitted optional args', () => {
      const obj = {
        repeat(msg: string, count: number, suffix?: string): string {
          let result = msg.repeat(count)
          if (suffix) result += suffix
          return result
        },
      }
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'method',
        name: 'repeat',
        returnType: 'string',
        parameters: [
          { name: 'msg', type: 'string', optional: false },
          { name: 'count', type: 'number', optional: false },
          { name: 'suffix', type: 'string', optional: true, defaultValue: '' },
        ],
        invoke: (t, args) => (t as typeof obj).repeat(
          args[0] as string, args[1] as number, args[2] as string | undefined,
        ),
      }])
      wrapper.testBind([obj])

      const fn = wrapper.get('repeat') as Function
      expect(fn('ab', 2)).toBe('abab')
      expect(fn('ab', 2, '!')).toBe('abab!')
    })

    it('throws when required argument is missing', () => {
      const obj = { add(a: number, b: number): number { return a + b } }
      wrapper = new TestWrapper(stubContext, [{
        memberType: 'method',
        name: 'add',
        returnType: 'number',
        parameters: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        invoke: (t, args) => (t as typeof obj).add(args[0] as number, args[1] as number),
      }])
      wrapper.testBind([obj])

      const fn = wrapper.get('add') as Function
      expect(() => fn(1)).toThrow(/required but was not provided/)
    })
  })
})

// ---------------------------------------------------------------------------
// ScriptGlobal tests
// ---------------------------------------------------------------------------

describe('ScriptGlobal', () => {
  it('sets the global table name', () => {
    class TestGlobal extends ScriptGlobal {
      constructor(context: IScriptContext) {
        super(context, 'TestGlobal')
      }
      protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
        return []
      }
    }

    const global = new TestGlobal(stubContext)
    expect(global.name).toBe('TestGlobal')
  })

  it('formats duplicateKeyError with table name', () => {
    class TestGlobal extends ScriptGlobal {
      constructor(context: IScriptContext) {
        super(context, 'MyGlobal')
      }
      protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
        return []
      }

      checkError(memberName: string): string {
        return this['duplicateKeyError'](memberName)
      }
    }

    const global = new TestGlobal(stubContext) as any
    const msg = global.checkError('foo')
    expect(msg).toContain('MyGlobal')
    expect(msg).toContain('foo')
  })

  it('formats memberNotFoundError with table name', () => {
    class TestGlobal extends ScriptGlobal {
      constructor(context: IScriptContext) {
        super(context, 'MyGlobal')
      }
      protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
        return []
      }

      checkError(memberName: string): string {
        return this['memberNotFoundError'](memberName)
      }
    }

    const global = new TestGlobal(stubContext) as any
    const msg = global.checkError('bar')
    expect(msg).toContain('MyGlobal')
    expect(msg).toContain('bar')
  })

  it('filterObjects passes through all objects when no filter', () => {
    class TestGlobal extends ScriptGlobal {
      constructor(context: IScriptContext) {
        super(context, 'Test')
      }
      protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
        return []
      }
      testFilter<T>(objects: T[], filter?: (item: unknown) => boolean): T[] {
        return this.filterObjects(objects, filter)
      }
    }

    const global = new TestGlobal(stubContext) as any
    const items = [1, 2, 3]
    const result = global.testFilter(items)
    expect(result).toEqual([1, 2, 3])
  })

  it('filterObjects applies filter function', () => {
    class TestGlobal extends ScriptGlobal {
      constructor(context: IScriptContext) {
        super(context, 'Test')
      }
      protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
        return []
      }
      testFilter<T>(objects: T[], filter?: (item: unknown) => boolean): T[] {
        return this.filterObjects(objects, filter)
      }
    }

    const global = new TestGlobal(stubContext) as any
    const items = [1, 2, 3, 4, 5]
    const result = global.testFilter(items, (item: unknown) => (item as number) > 2)
    expect(result).toEqual([3, 4, 5])
  })
})
