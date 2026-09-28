// A recipient whose digest throws is skipped so the sweep reaches everyone
// else — which also means the job completes and BullMQ records a success. The
// catch is therefore the only place the failure can be reported: logged alone,
// as `{ error: { name } }`, a digest that failed every morning was invisible
// until its rows retired as stale two days later.

import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import { createFakeJobLogger } from './test-fixtures'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))
vi.mock('./immediate-orphan-sweep', () => ({ sweepImmediateOrphans: async () => {} }))

const ORG = 'org-1'

function depsFailingFor(failingUser: string) {
  const failure = new Error('Digest batch invariant violated: member digest mismatch')
  const deps = {
    emailRepo: {
      findDueRecipients: vi.fn(async () => [
        { organizationId: ORG, userId: failingUser },
        { organizationId: ORG, userId: 'user-ok' },
      ]),
      findOpenDigestBatch: vi.fn(async (_org: string, user: string) => {
        if (user === failingUser) throw failure
        return null
      }),
      findDueByUser: vi.fn(async () => []),
    },
    preferenceRepo: {
      getUserSettings: vi.fn(async () => ({ timezone: 'UTC' })),
      resolveDeliveryWindow: vi.fn(async () => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })),
    },
    resolveOrganizationScope: vi.fn(async () => ({
      timezone: 'UTC',
      propertyNames: new Map(),
    })),
    organizationEmailStop: vi.fn(async (_org: string) => 'none' as const),
    authorizeScope: vi.fn(async () => true),
    logger: createFakeJobLogger(),
    clock: () => new Date('2026-07-11T08:00:00.000Z'),
  }
  return { deps, failure }
}

const run = (deps: ReturnType<typeof depsFailingFor>['deps']) =>
  createDigestNotificationJobHandler(
    deps as unknown as Parameters<typeof createDigestNotificationJobHandler>[0],
  )({} as Job<void>)

describe('a digest recipient that fails', () => {
  it('reaches the error monitor even though the job completes', async () => {
    const { deps, failure } = depsFailingFor('user-broken')

    await expect(run(deps)).resolves.toBeUndefined()

    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.capture).toHaveBeenCalledWith(failure, {
      source: 'bullmq-job',
      queue: 'background',
      jobName: 'digest-notification',
    })
  })

  it('logs why it failed, not only the error class', async () => {
    const { deps } = depsFailingFor('user-broken')

    await run(deps)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'Error: Digest batch invariant violated: member digest mismatch',
      }),
      'Daily digest failed for recipient',
    )
    // The sweep still reached the next recipient.
    expect(deps.emailRepo.findOpenDigestBatch).toHaveBeenCalledTimes(2)
  })
})
