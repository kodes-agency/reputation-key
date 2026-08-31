import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import {
  createProjectRecentActivityHandler,
  LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME,
  PROJECT_RECENT_ACTIVITY_JOB_NAME,
  type ProjectRecentActivityJobData,
} from './project-recent-activity.job'
import { organizationId, recentActivityEntryId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'

const data: ProjectRecentActivityJobData = {
  action: 'created',
  resourceType: 'organization',
  resourceId: 'org-job-drain',
  propertyId: null,
  organizationId: organizationId('org-job-drain'),
  userId: null,
  source: 'web',
  eventId: 'event-job-drain',
  occurredAt: '2026-08-28T12:00:00.000Z',
  payload: { subject: 'organization', from: null, to: 'created', detail: null },
}

describe('Recent Activity projection job rolling compatibility', () => {
  it.each([PROJECT_RECENT_ACTIVITY_JOB_NAME, LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME])(
    'processes %s through the same idempotent projection handler',
    async (name) => {
      const insert = vi.fn(async () => undefined)
      const handler = createProjectRecentActivityHandler({
        repo: {
          insert,
          findDuplicate: vi.fn(async () => false),
          findByResource: vi.fn(async () => []),
          findByOrganization: vi.fn(async () => []),
        },
        userLookup: { lookup: vi.fn() },
        clock: () => new Date('2026-08-28T12:00:01.000Z'),
        logger: createMockLogger(),
        idGen: () => recentActivityEntryId('f1000000-0000-4000-8000-000000000001'),
      })

      await handler({ name, data } as Job<ProjectRecentActivityJobData>)

      expect(insert).toHaveBeenCalledOnce()
    },
  )

  it('keeps the legacy identifier distinct and drain-only', () => {
    expect(PROJECT_RECENT_ACTIVITY_JOB_NAME).toBe('project-recent-activity')
    expect(LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME).toBe('insert-activity-log')
  })
})
