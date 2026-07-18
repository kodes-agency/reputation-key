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

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

/** Mirror bootstrap.ts: every catalogued job gets a handler (no-op for dark/blocked). */
function fullyRegisteredRegistry() {
  const registry = createJobRegistry()
  for (const row of JOB_FAMILY_ROWS) {
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

describe('assertJobReadiness (BQC-3.6)', () => {
  it('passes when every enabled row has a handler and none are extra', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
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
      assertJobReadiness(registry, logger, { dispatcherEnabled: false }),
    ).toThrow(new RegExp(missing.jobName))
  })

  it('throws when a registered handler has no catalogue row (stale/typo handler)', () => {
    const logger = fakeLogger()
    const registry = fullyRegisteredRegistry()
    registry.register('health-chek', async () => {}) // typo'd stale handler

    expect(() =>
      assertJobReadiness(registry, logger, { dispatcherEnabled: false }),
    ).toThrow(/health-chek/)
  })

  it('passes with denied_dark/blocked_capability rows registered as no-op handlers', () => {
    const logger = fakeLogger()
    const darkRows = JOB_FAMILY_ROWS.filter((r) => r.registration !== 'enabled')
    expect(darkRows.length).toBeGreaterThan(0)

    // fullyRegisteredRegistry registers dark/blocked rows as no-ops — by design.
    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
      }),
    ).not.toThrow()
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
    expect(durable.length).toBeGreaterThan(0)
    const missing = durable[0]!
    const rest = durable.slice(1)

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
        activeCutoverFamilies: () => [{ family: 'review.created', state: 'shadow' }],
      }),
    ).toThrow(/review\.created=shadow.*OUTBOX_DISPATCHER_ENABLED/)

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
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
          { family: 'review.updated', state: 'shadow' },
        ],
      }),
    ).not.toThrow()
  })

  it('BQC-3.9: record-only everywhere needs no dispatcher (explicit empty cutover)', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        dispatcherEnabled: false,
        activeCutoverFamilies: () => [],
      }),
    ).not.toThrow()
  })
})
