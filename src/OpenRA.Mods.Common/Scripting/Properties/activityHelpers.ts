/**
 * activityHelpers.ts — Shared utilities for creating ActivityStub objects
 *
 * 核心范式转换:
 * - C# new Activity(args...) → createActivity(name, params)
 * - ActivityStub is a lightweight interface (queue, cancel, onActorDisposeOuter)
 * - Activity name and params stored as extra properties for future resolution
 * - Named activities delegate to Chapter 14 implementations at runtime
 */

import type { ActivityStub, IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

/** Extended stub with activity name and parameters for debug/routing. */
export interface NamedActivityStub extends ActivityStub {
  readonly activityName: string
  readonly activityParams?: Record<string, unknown>
}

/**
 * Create an ActivityStub for a named activity with optional parameters.
 * Used by scripting property groups to queue activities on actors.
 */
export function createActivity(name: string, params?: Record<string, unknown>): NamedActivityStub {
  return {
    activityName: name,
    activityParams: params,
    queue(_next: ActivityStub): void { /* chain — noop in stub */ },
    cancel(_actor: IGameActor): void { /* cancel — noop in stub */ },
    onActorDisposeOuter(_actor: IGameActor): void { /* cleanup — noop in stub */ },
  }
}
