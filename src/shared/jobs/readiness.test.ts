// BQC-3.6 — job readiness gate tests.
//
// assertJobReadiness runs after bootstrap, before any BullMQ worker starts:
// an enabled catalogue row without a handler (or a registered handler with no
// catalogue row) is a deployment/config failure and must FAIL THE BOOT, per
// the phase BQC-3 failure taxonomy ("Unknown job/consumer → fail readiness").
// Every catalogued durable consumer ref must also be registered: the outbox
// relay + dispatcher are the only delivery path, so an unregistered consumer
// is a fact nobody reads.

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
    r.consumers.map((c) => ({ eventType: r.eventType, consumerName: c.name })),
  )
}

describe('assertJobReadiness (BQC-3.6)', () => {
  it('passes when every enabled row has a handler and none are extra', () => {
    const logger = fakeLogger()

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        listConsumers: allCatalogueDurableConsumers,
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
        listConsumers: allCatalogueDurableConsumers,
      }),
    ).toThrow(new RegExp(missing.jobName))
  })

  it('throws when a registered handler has no catalogue row (stale/typo handler)', () => {
    const logger = fakeLogger()
    const registry = fullyRegisteredRegistry()
    registry.register('health-chek', async () => {}) // typo'd stale handler

    expect(() =>
      assertJobReadiness(registry, logger, {
        listConsumers: allCatalogueDurableConsumers,
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
        listConsumers: allCatalogueDurableConsumers,
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

  it('throws when a catalogued durable consumer is unregistered', () => {
    const logger = fakeLogger()
    const [missing, ...rest] = allCatalogueDurableConsumers()
    if (!missing) throw new Error('test precondition: the catalogue declares a consumer')

    expect(() =>
      assertJobReadiness(fullyRegisteredRegistry(), logger, {
        listConsumers: () => rest,
      }),
    ).toThrow(new RegExp(missing.consumerName))
  })
})
