// Test seam for outbox suites that emit synthetic event types or narrow a
// real type's schema. Mock `#/shared/events/registry.server` with
// `withEventDescriptorOverrides`, then add descriptors with
// `overrideEventDescriptor`. `hideEventDescriptors` makes every lookup miss, to
// reach the outbox's unregistered-type refusal.

import type { EventDescriptor } from '#/shared/events/descriptor'

type DescriptorLookup = (type: string, version: number) => EventDescriptor | undefined

const overrides = new Map<string, EventDescriptor>()
let hidden = false

export function hideEventDescriptors(isHidden: boolean): void {
  hidden = isHidden
}

export function overrideEventDescriptor(entry: EventDescriptor): void {
  overrides.set(`${entry.type}:v${entry.version}`, entry)
}

export function withEventDescriptorOverrides<
  T extends { getEventDescriptor: DescriptorLookup },
>(actual: T): T {
  return {
    ...actual,
    getEventDescriptor: (type, version) =>
      hidden
        ? undefined
        : (overrides.get(`${type}:v${version}`) ??
          actual.getEventDescriptor(type, version)),
  }
}
