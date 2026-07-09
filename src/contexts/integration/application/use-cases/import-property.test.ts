// Integration context — import-property use case tests

import { describe, it, expect, vi } from 'vitest'
import { importProperty, type ImportPropertyDeps } from './import-property'
import { createInMemoryGbpImportRepo } from '#/shared/testing/in-memory-gbp-import-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildTestGbpImportJob } from '#/shared/testing/fixtures'
import { gbpImportJobId, organizationId } from '#/shared/domain/ids'
import { createHash } from 'crypto'
import { duplicateKeyError } from '../ports/property-import-repo.port'
import type { GbpImportJob } from '../../domain/types'
import type { PropertyImportRepo } from '../ports/property-import-repo.port'
import type { PropertyEventPort } from '../ports/property-event.port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'

// ── Helpers ──────────────────────────────────────────────────────

function makePropertyImportRepo(options?: {
  throwDuplicate?: boolean
  existingIds?: string[]
  connectionPropertyCount?: number
}) {
  const existing = new Set<string>(options?.existingIds ?? [])
  let autoCounter = 1

  return {
    findExistingGbpPlaceIds: async (_orgId: string, ids: readonly string[]) =>
      ids.filter((id) => existing.has(id)),
    existsByGbpPlaceId: async (_orgId: string, id: string) => existing.has(id),
    insertProperty: async (input: {
      organizationId: string
      name: string
      slug: string
      gbpPlaceId: string
      googleConnectionId: string
    }) => {
      if (options?.throwDuplicate) {
        throw duplicateKeyError('duplicate key')
      }
      const id = `prop-${String(autoCounter++).padStart(3, '0')}`
      existing.add(input.gbpPlaceId)
      return {
        id,
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        gbpPlaceId: input.gbpPlaceId,
        createdAt: null,
      }
    },
    countByGoogleConnectionId: async () => options?.connectionPropertyCount ?? 0,
  } satisfies PropertyImportRepo
}

function makeFailingPropertyImportRepo(error: Error): PropertyImportRepo {
  return {
    findExistingGbpPlaceIds: async () => {
      throw error
    },
    existsByGbpPlaceId: async () => false,
    insertProperty: async () => {
      throw error
    },
    countByGoogleConnectionId: async () => 0,
  }
}

function makeEventPort() {
  const events: unknown[] = []
  return {
    emitPropertyCreated: async (event: unknown) => {
      events.push(event)
    },
    getEvents: () => events,
  }
}

function makeFailingEventPort(): PropertyEventPort {
  return {
    emitPropertyCreated: async () => {
      throw new Error('Event bus unavailable')
    },
  }
}

// ── Setup ────────────────────────────────────────────────────────

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const JOB_ID = 'f0000000-0000-0000-0000-000000000001'
const ORG_ID = 'org-00000000-0000-0000-0000-000000000001'
const CONNECTION_ID = 'e0000000-0000-0000-0000-000000000001'

const setup = () => {
  const importRepo = createInMemoryGbpImportRepo()
  const propertyRepo = makePropertyImportRepo()
  const eventBus = createCapturingEventBus()
  const events = makeEventPort()

  const deps = {
    importRepo,
    propertyRepo,
    events,
    eventBus,
    toJobId: (id: string) => gbpImportJobId(id),
    toOrgId: (id: string) => organizationId(id),
    clock: () => FIXED_TIME,
    hashFn: (input: string) => createHash('sha256').update(input).digest('base64url'),
    logger: createMockLogger(),
  }
  const useCase = importProperty(deps)

  const seedJob = (overrides: Partial<GbpImportJob> = {}) => {
    const job = buildTestGbpImportJob({
      id: JOB_ID,
      organizationId: organizationId(ORG_ID),
      totalCount: 2,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      status: 'queued',
      ...overrides,
    })
    importRepo.seed([job])
    return job
  }

  const buildUseCase = (
    propertyRepoOverride: PropertyImportRepo,
    eventOverride?: PropertyEventPort,
    onFirstPropertyImported?: ImportPropertyDeps['onFirstPropertyImported'],
  ) =>
    importProperty({
      importRepo,
      propertyRepo: propertyRepoOverride,
      events: eventOverride ?? events,
      eventBus,
      toJobId: (id: string) => gbpImportJobId(id),
      toOrgId: (id: string) => organizationId(id),
      clock: () => FIXED_TIME,
      hashFn: (input: string) => createHash('sha256').update(input).digest('base64url'),
      logger: createMockLogger(),
      onFirstPropertyImported,
    })

  return { useCase, importRepo, propertyRepo, events, seedJob, buildUseCase }
}

// ── Tests ────────────────────────────────────────────────────────

describe('importProperty', () => {
  it('happy path: imports new locations and returns created properties', async () => {
    const { useCase, importRepo, events, seedJob } = setup()
    seedJob({ totalCount: 2 })

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-1',
          businessName: 'Biz One',
          gbpLocationName: 'accounts/1/locations/1',
        },
        {
          gbpPlaceId: 'ChIJ-2',
          businessName: 'Biz Two',
          gbpLocationName: 'accounts/1/locations/2',
        },
      ],
    })

    expect(result.status).toBe('completed')
    expect(result.created).toHaveLength(2)
    expect(result.created[0].gbpPlaceId).toBe('ChIJ-1')
    expect(result.created[0].name).toBe('Biz One')
    expect(result.created[0].googleConnectionId).toBe(CONNECTION_ID)
    expect(result.created[1].gbpPlaceId).toBe('ChIJ-2')

    // Events emitted
    const emitted = events.getEvents()
    expect(emitted).toHaveLength(2)

    // Job finalized to completed
    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.status).toBe('completed')
    expect(job?.importedCount).toBe(2)
  })

  it('returns completed_with_skips when some locations already exist', async () => {
    const { importRepo, seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 2 })

    const customRepo = makePropertyImportRepo({ existingIds: ['ChIJ-skip'] })
    const useCase = buildUseCase(customRepo)

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-skip',
          businessName: 'Skip Biz',
          gbpLocationName: 'accounts/1/locations/s',
        },
        {
          gbpPlaceId: 'ChIJ-new',
          businessName: 'New Biz',
          gbpLocationName: 'accounts/1/locations/n',
        },
      ],
    })

    expect(result.status).toBe('completed_with_skips')
    expect(result.created).toHaveLength(1)
    expect(result.created[0].gbpPlaceId).toBe('ChIJ-new')

    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.skippedCount).toBe(1)
    expect(job?.importedCount).toBe(1)
  })

  it('handles duplicate-key race condition when existsByGbpPlaceId returns true', async () => {
    const { importRepo, seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })

    // This repo throws DuplicateKeyError on insert AND returns true for existsByGbpPlaceId
    // for the given place ID — simulating a race condition that resolves as a skip
    const dupRepo = {
      findExistingGbpPlaceIds: async () => [] as string[],
      existsByGbpPlaceId: async (_orgId: string, id: string) => id === 'ChIJ-race',
      insertProperty: async () => {
        throw duplicateKeyError('duplicate key')
      },
      countByGoogleConnectionId: async () => 0,
    } satisfies PropertyImportRepo

    const useCase = buildUseCase(dupRepo)

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-race',
          businessName: 'Race Biz',
          gbpLocationName: 'accounts/1/locations/r',
        },
      ],
    })

    // Treated as a skip, not a failure
    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.skippedCount).toBe(1)
    expect(job?.failedCount).toBe(0)
    expect(result.created).toHaveLength(0)
    expect(result.status).toBe('completed_with_skips')
  })

  it('handles duplicate-key error without existing record as failure', async () => {
    const { importRepo, seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })

    // Throws DuplicateKeyError but existsByGbpPlaceId returns false
    const dupFailRepo = {
      findExistingGbpPlaceIds: async () => [] as string[],
      existsByGbpPlaceId: async () => false,
      insertProperty: async () => {
        throw duplicateKeyError('duplicate key')
      },
      countByGoogleConnectionId: async () => 0,
    } satisfies PropertyImportRepo

    const useCase = buildUseCase(dupFailRepo)

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-dupfail',
          businessName: 'Dup Fail Biz',
          gbpLocationName: 'accounts/1/locations/df',
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.created).toHaveLength(0)

    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.failedCount).toBe(1)
  })

  it('handles non-duplicate insert error as failure', async () => {
    const { importRepo, seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })

    const errorRepo = {
      findExistingGbpPlaceIds: async () => [] as string[],
      existsByGbpPlaceId: async () => false,
      insertProperty: async () => {
        throw new Error('DB connection lost')
      },
      countByGoogleConnectionId: async () => 0,
    } satisfies PropertyImportRepo

    const useCase = buildUseCase(errorRepo)

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-fail',
          businessName: 'Fail Biz',
          gbpLocationName: 'accounts/1/locations/f',
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.created).toHaveLength(0)

    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.failedCount).toBe(1)
  })

  it('returns failed when no locations are provided', async () => {
    const { useCase, seedJob } = setup()
    seedJob({ totalCount: 0 })

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [],
    })

    expect(result.status).toBe('failed')
    expect(result.created).toHaveLength(0)
  })

  it('handles crash in outer try/catch gracefully', async () => {
    const { importRepo, seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })

    const crashRepo = makeFailingPropertyImportRepo(new Error('Unexpected crash'))
    const useCase = buildUseCase(crashRepo)

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-crash',
          businessName: 'Crash Biz',
          gbpLocationName: 'accounts/1/locations/c',
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.created).toHaveLength(0)

    const job = await importRepo.findById(organizationId(ORG_ID), gbpImportJobId(JOB_ID))
    expect(job?.status).toBe('failed')
  })

  it('continues when event emission fails', async () => {
    const { seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })

    const goodRepo = makePropertyImportRepo()
    const useCase = buildUseCase(goodRepo, makeFailingEventPort())

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-evfail',
          businessName: 'Event Fail Biz',
          gbpLocationName: 'accounts/1/locations/ef',
        },
      ],
    })

    // Should still succeed — event failure is non-fatal
    expect(result.status).toBe('completed')
    expect(result.created).toHaveLength(1)
  })

  it('generates unique slugs for properties', async () => {
    const { useCase, seedJob } = setup()
    seedJob({ totalCount: 2 })

    const result = await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-slug-a',
          businessName: 'My Business',
          gbpLocationName: 'accounts/1/locations/a',
        },
        {
          gbpPlaceId: 'ChIJ-slug-b',
          businessName: 'My Business',
          gbpLocationName: 'accounts/1/locations/b',
        },
      ],
    })

    expect(result.created).toHaveLength(2)
    // Same business name but different gbpPlaceId should produce different slugs
    expect(result.created[0].slug).not.toBe(result.created[1].slug)
    // Slugs should start with the normalized business name
    expect(result.created[0].slug).toMatch(/^my-business-/)
    expect(result.created[1].slug).toMatch(/^my-business-/)
  })
  it('fires onFirstPropertyImported when the connection imports its first property (0→1)', async () => {
    const { seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })
    const hook = vi.fn()
    const useCase = buildUseCase(
      makePropertyImportRepo({ connectionPropertyCount: 0 }),
      undefined,
      hook,
    )

    await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-first',
          businessName: 'First',
          gbpLocationName: 'accounts/1/locations/f',
        },
      ],
    })

    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(organizationId(ORG_ID), CONNECTION_ID)
  })

  it('does not fire onFirstPropertyImported when the connection already has properties', async () => {
    const { seedJob, buildUseCase } = setup()
    seedJob({ totalCount: 1 })
    const hook = vi.fn()
    const useCase = buildUseCase(
      makePropertyImportRepo({ connectionPropertyCount: 2 }),
      undefined,
      hook,
    )

    await useCase({
      jobId: JOB_ID,
      organizationId: ORG_ID,
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-second',
          businessName: 'Second',
          gbpLocationName: 'accounts/1/locations/s',
        },
      ],
    })

    expect(hook).not.toHaveBeenCalled()
  })
})
