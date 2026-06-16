// Notification context — on-badge-awarded event handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onBadgeAwarded } from './on-badge-awarded'
import type { BadgeAwarded } from '#/contexts/badge/application/public-api'
import type { Queue } from 'bullmq'
import { organizationId, propertyId, portalId, badgeId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const PORTAL_ID = portalId('portal-1')
const BADGE_DEF_ID = badgeId('badge-def-1')
const NOW = new Date('2026-06-01T12:00:00Z')

function makeEvent(overrides?: Partial<BadgeAwarded>): BadgeAwarded {
  return {
    _tag: 'badge.awarded',
    eventId: 'evt-badge-1',
    correlationId: null,
    occurredAt: NOW,
    badgeDefinitionId: BADGE_DEF_ID,
    criteriaVersion: 1,
    targetType: 'portal',
    targetId: PORTAL_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    awardedAt: NOW,
    ...overrides,
  }
}

type EnqueuedJob = { name: string; data: unknown; opts: unknown }

function createFakeDeps(managerIds: string[] = ['manager-1', 'manager-2']) {
  const jobs: EnqueuedJob[] = []
  const addMock = vi.fn(async (name: string, data: unknown, opts?: unknown) => {
    jobs.push({ name, data, opts })
  })
  const queue = { add: addMock } as unknown as Queue

  const userLookup = {
    findByRole: vi.fn(async () => []),
    findAssignedManagers: vi.fn(async () => managerIds.map((id) => id as never)),
    getEmail: vi.fn(async () => null),
    getName: vi.fn(async () => null),
  }

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger),
  }

  return { queue, addMock, jobs, userLookup, logger }
}

describe('onBadgeAwarded (notification)', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('enqueues one notification job per assigned manager', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.addMock).toHaveBeenCalledTimes(2)
    for (const job of deps.jobs) {
      expect(job.name).toBe(INSERT_NOTIFICATION_JOB_NAME)
      const data = job.data as Record<string, unknown>
      expect(data.type).toBe('badge.awarded')
      expect(data.resourceType).toBe('badge')
      expect(data.resourceId).toBe(BADGE_DEF_ID)
      expect(data.userId).toBeTruthy()
      expect(data.organizationId).toBe(ORG_ID)
      expect(data.title).toBeTruthy()
    }
  })

  it('queries managers by org and property', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('skips silently when no managers found', async () => {
    const emptyDeps = createFakeDeps([])
    await onBadgeAwarded(emptyDeps)(makeEvent())

    expect(emptyDeps.addMock).not.toHaveBeenCalled()
  })

  it('uses badge definition ID as resource ID', async () => {
    const customDefId = badgeId('custom-badge')
    await onBadgeAwarded(deps)(makeEvent({ badgeDefinitionId: customDefId }))

    const data = deps.jobs[0]!.data as Record<string, unknown>
    expect(data.resourceId).toBe(customDefId)
  })

  it('uses retry with exponential backoff', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    const opts = deps.jobs[0]!.opts as Record<string, unknown>
    expect(opts.attempts).toBe(3)
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 30_000 })
  })
})
