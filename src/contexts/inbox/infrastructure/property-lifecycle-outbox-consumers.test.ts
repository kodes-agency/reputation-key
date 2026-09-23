import { describe, expect, it, vi } from 'vitest'
import { capabilityForSystemAction } from '#/shared/auth/system-execution-policy'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { createConsumerRegistry } from '#/shared/outbox'
import { registerInboxPropertyLifecycleConsumers } from './property-lifecycle-outbox-consumers'

// The dispatcher authorizes each consumer under its own catalogue row, and a
// denied consumer records an obsolete receipt that is never retried. Cancelling
// an archived Property's reminders is cleanup, so no capability switch may skip
// it, and it acts on exactly one Property. Sharing the Inbox projection row
// would inherit that row's action, capability and Organization scope.
describe('Inbox Property lifecycle consumer authorization', () => {
  it('runs under its own ungated, Property-scoped catalogue row', () => {
    const registry = createConsumerRegistry()
    registerInboxPropertyLifecycleConsumers(registry, {
      responseTargetStore: { cancelArchivedPropertyRemindersOnce: vi.fn() },
      clock: () => new Date('2026-09-22T09:00:00.000Z'),
    })

    const registrations = registry.listFor('property.archived')
    expect(registrations).toHaveLength(1)
    const row = ENTRY_POINT_CATALOGUE.find(
      (candidate) =>
        candidate.kind === 'consumer' && candidate.name === registrations[0]!.module,
    )

    expect(row).toEqual({
      kind: 'consumer',
      name: 'inbox.property-lifecycle',
      action: 'system:inbox.cancel_property_reminders',
      capability: 'none',
      resourceScope: 'property',
      externalEffect: false,
    })
    expect(capabilityForSystemAction(row!.action)).toBe('none')
  })
})
