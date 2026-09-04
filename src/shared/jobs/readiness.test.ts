// BQC-3.6 — job readiness gate tests.
//
// assertJobReadiness runs after bootstrap, before any BullMQ worker starts:
// an enabled catalogue row without a handler (or a registered handler with no
// catalogue row) is a deployment/config failure and must FAIL THE BOOT, per
// the phase BQC-3 failure taxonomy ("Unknown job/consumer → fail readiness").
// When the durable dispatcher is enabled, every catalogued durable consumer
// ref must also be registered — consumers are intentionally inert while the
// dispatcher is off (BQR-0 containment), so that check is gated on the flag.

import { describe, it, expect, vi } from 'vitest'
import { assertJobReadiness } from './readiness'
import { createJobRegistry } from './registry'
import {
  JOB_FAMILY_ROWS,
  EVENT_FAMILY_ROWS,
} from '#/shared/governance/event-job-catalogue'
import { INBOX_CUTOVER_FAMILIES } from '#/shared/outbox/cutover-flags'

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

/** Mirror bootstrap.ts: blocked/dark work has no executable handler. */
function fullyRegisteredRegistry() {
  const registry = createJobRegistry()
  for (const row of JOB_FAMILY_ROWS) {
    if (row.registration === 'blocked_capability' || row.registration === 'denied_dark') {
      continue
    }
    registry.register(row.jobName, async () => {})
  }
  return registry
}

/** Every durable consumer ref the catalogue declares, as registered pairs. */
function allCatalogueDurableConsumers() {
  return EVENT_FAMILY_ROWS.flatMap((r) =>
    r.consumers
      .filter((c) => c.kind === 'durable')
      .map((c) => ({ eventType: r.eventType, consumerName: c.name })),
  )
}

const CUTOVER_CONSUMER_CASES = [
  {
    family: 'review.created',
    state: 'shadow',
    consumerName: 'inbox.on-review-created',
  },
  {
    family: 'review.expired',
    state: 'switch',
    consumerName: 'inbox.on-review-expired',
  },
] as const

describe('assertJobReadiness (BQC-3.6)', () => {
  it('passes when every enabled row has a handler and none are extra', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
      }),
    ).not.toThrow()

    expect(logger.info).toHaveBeenCalled()
  })

  it('throws when an enabled catalogue row has no registered handler', () => {
    const logger = fakeLogger()
    const registry = createJobRegistry()
    // Register everything EXCEPT one enabled row.
    const missing = JOB_FAMILY_ROWS.find((r) => r.registration === 'enabled')
    if (!missing) throw new Error('test precondition: an enabled row exists')
    for (const row of JOB_FAMILY_ROWS) {
      if (row.jobName !== missing.jobName) registry.register(row.jobName, async () => {})
    }

    expect(() =>
      assertJobReadiness(registry, logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
      }),
    ).toThrow(new RegExp(missing.jobName))
  })

  it('throws when a registered handler has no catalogue row (stale/typo handler)', () => {
    const logger = fakeLogger()
    const registry = fullyRegisteredRegistry()
    registry.register('health-chek', async () => {}) // typo'd stale handler

    expect(() =>
      assertJobReadiness(registry, logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
      }),
    ).toThrow(/health-chek/)
  })

  it('throws when a blocked or dark family retains an executable handler', () => {
    const logger = fakeLogger()
    const registry = fullyRegisteredRegistry()
    const blocked = JOB_FAMILY_ROWS.find(
      (row) =>
        row.registration === 'blocked_capability' || row.registration === 'denied_dark',
    )
    if (!blocked) throw new Error('test precondition: a blocked row exists')
    registry.register(blocked.jobName, async () => {})

    expect(() =>
      assertJobReadiness(registry, logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
      }),
    ).toThrow(new RegExp(blocked.jobName))
  })

  it('contains exactly the governed dark and quarantined job registrations', () => {
    expect(
      JOB_FAMILY_ROWS.filter((row) => row.registration !== 'enabled').map((row) => ({
        jobName: row.jobName,
        capability: row.capability,
        registration: row.registration,
      })),
    ).toEqual([
      {
        jobName: 'process-image',
        capability: 'portal.upload',
        registration: 'blocked_capability',
      },
      {
        jobName: 'expire-review-provider-source',
        capability: 'none',
        registration: 'quarantined',
      },
      {
        jobName: 'purge-expired-reviews',
        capability: 'none',
        registration: 'quarantined',
      },
      {
        jobName: 'advance-organization-lifecycle',
        capability: 'none',
        registration: 'quarantined',
      },
      {
        jobName: 'generate-organization-export',
        capability: 'none',
        registration: 'quarantined',
      },
      {
        jobName: 'purge-expired-organization-exports',
        capability: 'none',
        registration: 'quarantined',
      },
    ])
  })

  it('skips durable-consumer validation when the dispatcher is disabled (logs info)', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
        listConsumers: () => [], // nothing registered — must not matter
      }),
    ).not.toThrow()
  })

  it('throws when the dispatcher is enabled and a catalogued durable consumer is unregistered', () => {
    const logger = fakeLogger()
    const durable = allCatalogueDurableConsumers()
    const missing = durable.find(
      ({ eventType }) => !INBOX_CUTOVER_FAMILIES.some((family) => family === eventType),
    )
    if (!missing) throw new Error('test precondition: a non-cutover consumer exists')
    const rest = durable.filter((consumer) => consumer !== missing)

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: true,
        listConsumers: () => rest,
      }),
    ).toThrow(new RegExp(missing.consumerName))
  })

  it('passes durable-consumer validation when every catalogued ref is registered', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: true,
        listConsumers: () => allCatalogueDurableConsumers(),
      }),
    ).not.toThrow()
  })

  it('BQC-3.9: fails the boot when a family is shadow/switch but the dispatcher is off', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
        activeCutoverFamilies: () => [{ family: 'review.created', state: 'shadow' }],
      }),
    ).toThrow(/review\.created=shadow.*OUTBOX_DISPATCHER_ENABLED/)

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
        listConsumers: () => [],
        activeCutoverFamilies: () => [
          { family: 'review.created', state: 'switch' },
          { family: 'review.expired', state: 'shadow' },
        ],
      }),
    ).toThrow(/review\.created=switch.*review\.expired=shadow/)
  })

  it('BQC-3.9: passes shadow/switch families when the dispatcher is enabled and consumers register', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: true,
        listConsumers: () => allCatalogueDurableConsumers(),
        activeCutoverFamilies: () => [
          { family: 'review.created', state: 'switch' },
          { family: 'review.expired', state: 'shadow' },
        ],
      }),
    ).not.toThrow()
  })

  it('BQC-3.9: record-only families need no durable consumer', () => {
    const logger = fakeLogger()
    const recordOnlyRegistrations = allCatalogueDurableConsumers().filter(
      (consumer) =>
        !CUTOVER_CONSUMER_CASES.some(
          ({ family, consumerName }) =>
            consumer.eventType === family && consumer.consumerName === consumerName,
        ),
    )

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: true,
        listConsumers: () => recordOnlyRegistrations,
        activeCutoverFamilies: () => [],
      }),
    ).not.toThrow()
  })

  it.each(CUTOVER_CONSUMER_CASES)(
    'BQC-3.9: $state requires the $family durable consumer',
    ({ family, state, consumerName }) => {
      const logger = fakeLogger()
      const recordOnlyRegistrations = allCatalogueDurableConsumers().filter(
        (consumer) =>
          !CUTOVER_CONSUMER_CASES.some(
            (cutover) =>
              consumer.eventType === cutover.family &&
              consumer.consumerName === cutover.consumerName,
          ),
      )
      const activeConsumers = allCatalogueDurableConsumers().filter(
        (consumer) =>
          consumer.eventType === family && consumer.consumerName === consumerName,
      )
      expect(activeConsumers).toHaveLength(1)

      expect(() =>
        assertJobReadiness(fullyRegisteredRegistry(), logger, {
          dispatcherEnabled: true,
          listConsumers: () => recordOnlyRegistrations,
          activeCutoverFamilies: () => [{ family, state }],
        }),
      ).toThrow(new RegExp(`${family}::${consumerName}`))

      expect(() =>
        assertJobReadiness(fullyRegisteredRegistry(), logger, {
          dispatcherEnabled: true,
          listConsumers: () => [...recordOnlyRegistrations, ...activeConsumers],
          activeCutoverFamilies: () => [{ family, state }],
        }),
      ).not.toThrow()
    },
  )
})
