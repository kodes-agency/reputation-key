// Integration context — handle GBP notification use case tests

import { describe, it, expect } from 'vitest'
import { handleGbpNotification } from './handle-gbp-notification'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { PropertyLookup } from '../ports/property-lookup.port'
import type {
  SyncPropertyReviewsJobData,
  AddSyncJobOptions,
} from '#/contexts/review/application/public-api'

// ── In-memory fakes ──────────────────────────────────────────────

const createFakePropertyLookup = (
  lookup: Record<string, PropertyLookup | null> = {},
) => ({
  findByGbpPlaceId: async (gbpPlaceId: string): Promise<PropertyLookup | null> =>
    lookup[gbpPlaceId] ?? null,
})

const createFakeReviewQueue = () => {
  const jobs: Array<{ data: SyncPropertyReviewsJobData; options?: AddSyncJobOptions }> =
    []
  return {
    addSyncJob: async (data: SyncPropertyReviewsJobData, options?: AddSyncJobOptions) => {
      jobs.push({ data, options })
    },
    getJobs: () => jobs,
  }
}

// ── Setup ────────────────────────────────────────────────────────

const setup = () => {
  const reviewQueue = createFakeReviewQueue()
  const deps = {
    propertyLookup: createFakePropertyLookup(),
    reviewQueue,
    logger: createMockLogger(),
  }
  const useCase = handleGbpNotification(deps)
  return { useCase, reviewQueue }
}

// ── Tests ────────────────────────────────────────────────────────

describe('handleGbpNotification', () => {
  it('happy path: enqueues review sync when property found with google connection', async () => {
    const { reviewQueue } = setup()
    const testProperty: PropertyLookup = {
      id: 'prop-001',
      organizationId: 'org-001',
      googleConnectionId: 'conn-001',
    }
    // Override the lookup
    const lookup: Record<string, PropertyLookup | null> = {
      'ChIJ-test-place': testProperty,
    }
    const deps = {
      propertyLookup: createFakePropertyLookup(lookup),
      reviewQueue,
      logger: createMockLogger(),
    }
    const useCaseWithLookup = handleGbpNotification(deps)

    const result = await useCaseWithLookup({
      locationId: 'ChIJ-test-place',
      locationName: 'accounts/123/locations/456',
      messageId: 'msg-001',
    })

    expect(result.enqueued).toBe(true)
    expect(result.propertyId).toBe('prop-001')
    expect(result.reason).toBeUndefined()

    // Verify job was enqueued with correct data
    const jobs = reviewQueue.getJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].data).toEqual({
      propertyId: 'prop-001',
      organizationId: 'org-001',
      connectionId: 'conn-001',
      locationName: 'accounts/123/locations/456',
      // BQC-3.2: webhook-initiated delayed work carries a named system
      // initiator + content-free correlation.
      policy: {
        initiator: { kind: 'system', id: 'webhook:gbp' },
        correlationId: 'webhook:msg-001',
      },
    })
    expect(jobs[0].options?.jobId).toBe('webhook:msg-001')
  })

  it('returns property_not_found when property does not exist', async () => {
    const { useCase, reviewQueue } = setup()

    const result = await useCase({
      locationId: 'ChIJ-unknown-place',
      locationName: 'accounts/123/locations/999',
      messageId: 'msg-002',
    })

    expect(result.enqueued).toBe(false)
    expect(result.reason).toBe('property_not_found')
    expect(result.propertyId).toBeUndefined()

    // No job should be enqueued
    expect(reviewQueue.getJobs()).toHaveLength(0)
  })

  it('returns property_not_found when property exists but has no google connection', async () => {
    const reviewQueue = createFakeReviewQueue()
    const testProperty: PropertyLookup = {
      id: 'prop-002',
      organizationId: 'org-001',
      googleConnectionId: null,
    }
    const lookup: Record<string, PropertyLookup | null> = {
      'ChIJ-no-conn': testProperty,
    }
    const deps = {
      propertyLookup: createFakePropertyLookup(lookup),
      reviewQueue,
      logger: createMockLogger(),
    }
    const useCase = handleGbpNotification(deps)

    const result = await useCase({
      locationId: 'ChIJ-no-conn',
      locationName: 'accounts/123/locations/111',
      messageId: 'msg-003',
    })

    expect(result.enqueued).toBe(false)
    expect(result.reason).toBe('property_not_found')
    expect(reviewQueue.getJobs()).toHaveLength(0)
  })

  it('uses messageId-based jobId for deduplication', async () => {
    const reviewQueue = createFakeReviewQueue()
    const testProperty: PropertyLookup = {
      id: 'prop-003',
      organizationId: 'org-002',
      googleConnectionId: 'conn-002',
    }
    const lookup: Record<string, PropertyLookup | null> = {
      'ChIJ-dedup': testProperty,
    }
    const deps = {
      propertyLookup: createFakePropertyLookup(lookup),
      reviewQueue,
      logger: createMockLogger(),
    }
    const useCase = handleGbpNotification(deps)

    await useCase({
      locationId: 'ChIJ-dedup',
      locationName: 'accounts/999/locations/1',
      messageId: 'unique-msg-id-12345',
    })

    const jobs = reviewQueue.getJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options?.jobId).toBe('webhook:unique-msg-id-12345')
  })
})
