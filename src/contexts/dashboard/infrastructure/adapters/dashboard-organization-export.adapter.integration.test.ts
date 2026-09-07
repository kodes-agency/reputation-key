import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { CLASSIFICATIONS_BY_CONTEXT } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createDashboardOrganizationExportAdapter } from './dashboard-organization-export.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Dashboard Export Fixture', $1, NOW())`,
    [organizationId],
  )
  return organizationId
}

async function seedMilestones(): Promise<string> {
  const organizationId = await seedOrganization('dashboard-export-org')
  // Deliberately inserted out of alphabetical order: the export must sort.
  await lease.pool.query(
    `INSERT INTO setup_checklist_milestones (
       organization_id, step, first_completed_at, created_at
     ) VALUES
       ($1, 'published_portal', TIMESTAMPTZ '2026-08-03T10:00:00Z', NOW()),
       ($1, 'google_connection', TIMESTAMPTZ '2026-08-01T10:00:00Z', NOW())`,
    [organizationId],
  )
  return organizationId
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

describe.sequential('Dashboard Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    await lease.pool.query(
      'DELETE FROM setup_checklist_milestones WHERE organization_id = ANY($1)',
      [ids],
    )
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('exports the owned onboarding milestones deterministically', async () => {
    const organizationId = await seedMilestones()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createDashboardOrganizationExportAdapter(db)

    const first = await contributor.contribute({
      organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'dashboard',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path }) => path)).toEqual([
      'dashboard/setup-checklist.csv',
      'dashboard/setup-checklist.json',
    ])
    for (const entry of first.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.dashboard).toContain(entry.classification)
    }

    const csvLines = decode(first.entries[0]!.bytes).trimEnd().split('\n')
    expect(csvLines[0]).toBe('record_type,step,first_completed_at,created_at')
    // Inserted out of order; exported in UTF-8 byte order of the step.
    expect(csvLines.slice(1).map((line) => line.split(',').slice(0, 3))).toEqual([
      ['setup_checklist_milestone', 'google_connection', '2026-08-01T10:00:00.000000Z'],
      ['setup_checklist_milestone', 'published_portal', '2026-08-03T10:00:00.000000Z'],
    ])

    const payload = JSON.parse(decode(first.entries[1]!.bytes)) as {
      records: Record<string, readonly Record<string, unknown>[]>
    }
    // Dashboard owns no metric or review row, so its payload carries exactly
    // one record class and duplicates no other context's export.
    expect(Object.keys(payload.records)).toEqual(['setup_checklist_milestone'])
    expect(payload.records.setup_checklist_milestone!.map(({ step }) => step)).toEqual([
      'google_connection',
      'published_portal',
    ])
  })

  it('answers no_data for an Organization that completed no milestone', async () => {
    const organizationId = await seedOrganization('dashboard-export-empty-org')

    const contribution = await createDashboardOrganizationExportAdapter(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'dashboard',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const organizationId = await seedMilestones()

    await expect(
      createDashboardOrganizationExportAdapter(db).contribute({
        organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
