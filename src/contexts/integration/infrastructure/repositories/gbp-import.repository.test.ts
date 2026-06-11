// Integration context — GBP import job repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { createGbpImportRepository } from './gbp-import.repository'
import { getDb } from '#/shared/db'
import { buildTestGbpImportJob } from '#/shared/testing/fixtures'
import { organizationId, gbpImportJobId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'

const ORG_A = organizationId('org-imp-aaaaaaa')
const ORG_B = organizationId('org-imp-bbbbbbbb')

setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['gbp_import_jobs'],
})

describe('gbpImportRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a job', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        totalCount: 10,
      })

      await repo.insert(job)
      const found = await repo.findById(ORG_A, job.id)

      expect(found).not.toBeNull()
      expect(found!.totalCount).toBe(10)
      expect(found!.status).toBe('queued')
      expect(found!.organizationId).toBe(ORG_A)
    })

    it('returns null for non-existent id', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const fakeId = gbpImportJobId(crypto.randomUUID())
      const found = await repo.findById(ORG_A, fakeId)
      expect(found).toBeNull()
    })
  })

  describe('tenant isolation', () => {
    it('findById does not return jobs from other orgs', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
      })
      await repo.insert(job)

      const found = await repo.findById(ORG_B, job.id)
      expect(found).toBeNull()
    })
  })

  describe('findByOrganization', () => {
    it('lists jobs for an org', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      await repo.insert(
        buildTestGbpImportJob({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          totalCount: 5,
        }),
      )
      await repo.insert(
        buildTestGbpImportJob({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          totalCount: 8,
        }),
      )

      const results = await repo.findByOrganization(ORG_A)
      expect(results).toHaveLength(2)
    })
  })

  describe('updateStatus', () => {
    it('updates job status', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        status: 'queued',
      })
      await repo.insert(job)

      await repo.updateStatus(ORG_A, job.id, 'in_progress')
      const found = await repo.findById(ORG_A, job.id)
      expect(found!.status).toBe('in_progress')
    })
  })

  describe('incrementImported', () => {
    it('increments imported count by 1', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        importedCount: 3,
      })
      await repo.insert(job)

      await repo.incrementImported(ORG_A, job.id)
      const found = await repo.findById(ORG_A, job.id)
      expect(found!.importedCount).toBe(4)
    })
  })

  describe('incrementSkipped', () => {
    it('increments skipped count by 1', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        skippedCount: 1,
      })
      await repo.insert(job)

      await repo.incrementSkipped(ORG_A, job.id)
      const found = await repo.findById(ORG_A, job.id)
      expect(found!.skippedCount).toBe(2)
    })
  })

  describe('incrementFailed', () => {
    it('increments failed count by 1', async () => {
      const db = getDb()
      const repo = createGbpImportRepository(db)
      const job = buildTestGbpImportJob({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        failedCount: 0,
      })
      await repo.insert(job)

      await repo.incrementFailed(ORG_A, job.id)
      const found = await repo.findById(ORG_A, job.id)
      expect(found!.failedCount).toBe(1)
    })
  })
})
