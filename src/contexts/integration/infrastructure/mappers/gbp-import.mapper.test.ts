// Integration context — GBP import job mapper tests

import { describe, it, expect } from 'vitest'
import { gbpImportJobFromRow, gbpImportJobToInsert } from './gbp-import.mapper'
import type { gbpImportJobs } from '#/shared/db/schema/gbp-import-job.schema'

type GbpImportJobRow = typeof gbpImportJobs.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')

const sampleRow: GbpImportJobRow = {
  id: 'job-uuid-001',
  organizationId: 'org-uuid-001',
  initiatedBy: 'user-uuid-001',
  status: 'in_progress',
  totalCount: 150,
  importedCount: 100,
  skippedCount: 30,
  failedCount: 5,
  createdAt: now,
  updatedAt: now,
}

describe('gbpImportJobFromRow', () => {
  it('brands IDs correctly', () => {
    const job = gbpImportJobFromRow(sampleRow)
    expect(job.id).toBe(sampleRow.id)
    expect(job.organizationId).toBe(sampleRow.organizationId)
    expect(job.initiatedBy).toBe(sampleRow.initiatedBy)
  })

  it('maps all fields', () => {
    const job = gbpImportJobFromRow(sampleRow)
    expect(job.status).toBe('in_progress')
    expect(job.totalCount).toBe(150)
    expect(job.importedCount).toBe(100)
    expect(job.skippedCount).toBe(30)
    expect(job.failedCount).toBe(5)
    expect(job.createdAt).toBe(now)
    expect(job.updatedAt).toBe(now)
  })

  it('handles all status variants', () => {
    const statuses: GbpImportJobRow['status'][] = [
      'queued',
      'in_progress',
      'completed',
      'failed',
      'completed_with_skips',
      'completed_with_failures',
    ]
    for (const status of statuses) {
      const row = { ...sampleRow, status }
      const job = gbpImportJobFromRow(row)
      expect(job.status).toBe(status)
    }
  })

  it('handles zero counts', () => {
    const row = {
      ...sampleRow,
      totalCount: 0,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    }
    const job = gbpImportJobFromRow(row)
    expect(job.totalCount).toBe(0)
    expect(job.importedCount).toBe(0)
    expect(job.skippedCount).toBe(0)
    expect(job.failedCount).toBe(0)
  })
})

describe('gbpImportJobToInsert', () => {
  it('round-trips through fromRow → toInsert', () => {
    const job = gbpImportJobFromRow(sampleRow)
    const insert = gbpImportJobToInsert(job)

    expect(insert.id).toBe(sampleRow.id)
    expect(insert.organizationId).toBe(sampleRow.organizationId)
    expect(insert.initiatedBy).toBe(sampleRow.initiatedBy)
    expect(insert.status).toBe(sampleRow.status)
    expect(insert.totalCount).toBe(sampleRow.totalCount)
    expect(insert.importedCount).toBe(sampleRow.importedCount)
    expect(insert.skippedCount).toBe(sampleRow.skippedCount)
    expect(insert.failedCount).toBe(sampleRow.failedCount)
    expect(insert.createdAt).toBe(sampleRow.createdAt)
    expect(insert.updatedAt).toBe(sampleRow.updatedAt)
  })
})
