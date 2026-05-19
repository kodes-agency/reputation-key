// Integration context — start property import use case tests

import { describe, it, expect } from 'vitest'
import { startPropertyImport } from './start-property-import'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGbpImportRepo } from '#/shared/testing/in-memory-gbp-import-repo'
import { createInMemoryGbpQueuePort } from '#/shared/testing/in-memory-gbp-queue-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const CONNECTION_ID = 'e0000000-0000-0000-0000-000000000001'

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const importRepo = createInMemoryGbpImportRepo()
  const queue = createInMemoryGbpQueuePort()
  const events = createCapturingEventBus()
  const deps = {
    connectionRepo,
    importRepo,
    queue,
    events,
    clock: () => FIXED_TIME,
  }
  const useCase = startPropertyImport(deps)
  return { useCase, connectionRepo, importRepo, queue, events }
}

const seedActiveConnection = (
  connectionRepo: ReturnType<typeof createInMemoryGoogleConnectionRepo>,
) => {
  const conn = buildTestGoogleConnection({
    id: CONNECTION_ID,
    status: 'active',
  })
  connectionRepo.seed([conn])
  return conn
}

describe('startPropertyImport', () => {
  it('happy path: inserts job, enqueues, returns with correct fields', async () => {
    const { useCase, connectionRepo, importRepo, queue } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    seedActiveConnection(connectionRepo)

    const input = {
      connectionId: CONNECTION_ID,
      locations: [
        {
          gbpPlaceId: 'ChIJ-1',
          businessName: 'Biz 1',
          address: null,
          primaryCategory: null,
          gbpLocationName: 'accounts/123/locations/456',
        },
      ],
    }

    const result = await useCase(input, ctx)

    // Job was inserted
    expect(importRepo.all()).toHaveLength(1)
    const inserted = importRepo.all()[0]
    expect(inserted.id).toBe(result.id)
    expect(inserted.organizationId).toBe(ctx.organizationId)
    expect(inserted.initiatedBy).toBe(ctx.userId)
    expect(inserted.status).toBe('queued')
    expect(inserted.totalCount).toBe(1)
    expect(inserted.importedCount).toBe(0)
    expect(inserted.skippedCount).toBe(0)
    expect(inserted.failedCount).toBe(0)

    // Job was enqueued
    const enqueued = queue.enqueuedJobs()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].connectionId).toBe(CONNECTION_ID)
    expect(enqueued[0].organizationId).toBe(ctx.organizationId as string)
    expect(enqueued[0].locations).toEqual(input.locations)

    // Returned job matches
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(result.initiatedBy).toBe(ctx.userId)
    expect(result.totalCount).toBe(1)
  })

  it('rejects without property.create permission → forbidden', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase(
        {
          connectionId: CONNECTION_ID,
          locations: [
            {
              gbpPlaceId: 'ChIJ-1',
              businessName: 'Biz 1',
              address: null,
              primaryCategory: null,
              gbpLocationName: 'accounts/123/locations/456',
            },
          ],
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when connection not found → connection_not_found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    // No connection seeded

    await expect(
      useCase(
        {
          connectionId: CONNECTION_ID,
          locations: [
            {
              gbpPlaceId: 'ChIJ-1',
              businessName: 'Biz 1',
              address: null,
              primaryCategory: null,
              gbpLocationName: 'accounts/123/locations/456',
            },
          ],
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('rejects when connection is disconnected → connection_disconnected', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const conn = buildTestGoogleConnection({
      id: CONNECTION_ID,
      status: 'disconnected',
    })
    connectionRepo.seed([conn])

    await expect(
      useCase(
        {
          connectionId: CONNECTION_ID,
          locations: [
            {
              gbpPlaceId: 'ChIJ-1',
              businessName: 'Biz 1',
              address: null,
              primaryCategory: null,
              gbpLocationName: 'accounts/123/locations/456',
            },
          ],
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'connection_disconnected',
    )
  })

  it('enqueued job data matches input locations and connection', async () => {
    const { useCase, connectionRepo, queue } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    seedActiveConnection(connectionRepo)

    const locations = [
      {
        gbpPlaceId: 'ChIJ-1',
        businessName: 'Biz 1',
        address: '123 Main St',
        primaryCategory: 'restaurant',
        gbpLocationName: 'accounts/123/locations/456',
      },
      {
        gbpPlaceId: 'ChIJ-2',
        businessName: 'Biz 2',
        address: null,
        primaryCategory: null,
        gbpLocationName: 'accounts/123/locations/789',
      },
    ]
    const input = { connectionId: CONNECTION_ID, locations }

    await useCase(input, ctx)

    const enqueued = queue.enqueuedJobs()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].connectionId).toBe(CONNECTION_ID)
    expect(enqueued[0].organizationId).toBe(ctx.organizationId as string)
    expect(enqueued[0].locations).toEqual(locations)
    // jobId is the generated import job ID
    expect(enqueued[0].jobId).toBeTruthy()
  })
})
