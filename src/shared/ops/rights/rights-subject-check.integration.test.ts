// The subject check against real PostgreSQL: a mistyped Organization and a
// Property of another Organization are refused before any executor runs.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { runRightsExecutors, type RightsExecutor } from './rights-executor'
import { createRightsJournal } from './rights-journal'
import type { RightsRequestPlan } from './rights-request-command'
import { rightsSubjectRefusal } from '#/shared/db/lifecycle/rights-subject-store'

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')

let lease: TestLease
let db: Database
const organizationIds: string[] = []

async function seedOrganization(): Promise<{
  organizationId: string
  propertyId: string
}> {
  const suffix = randomUUID()
  const organizationId = `subject-org-${suffix}`
  const propertyId = randomUUID()
  organizationIds.push(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Subject fixture', $1, $2)`,
    [organizationId, CREATED_AT],
  )
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Subject Property', $3, 'UTC', $4, $4)`,
    [propertyId, organizationId, `subject-${suffix}`, CREATED_AT],
  )
  return { organizationId, propertyId }
}

function planOf(overrides: Partial<RightsRequestPlan>): RightsRequestPlan {
  return {
    scope: 'property',
    mode: 'apply',
    organizationId: 'x',
    batchSize: 50,
    receivedAt: CREATED_AT,
    ...overrides,
  }
}

describe.sequential('rights subject check', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    await deleteTestOrganizations(lease.pool, organizationIds)
    organizationIds.length = 0
  })

  it('accepts an existing Organization and its own Property', async () => {
    const asked = await seedOrganization()

    expect(await rightsSubjectRefusal(db, planOf({ ...asked }))).toBeNull()
    expect(
      await rightsSubjectRefusal(
        db,
        planOf({ scope: 'organization', organizationId: asked.organizationId }),
      ),
    ).toBeNull()
  })

  it.each([
    'mistyped Organization',
    "another Organization's Property",
    'missing Property',
  ])('refuses %s before any executor and changes nothing', async (subject) => {
    const asked = await seedOrganization()
    const other = await seedOrganization()
    const apply = vi.fn(async () => ({ ok: true as const, lines: [] }))
    const preflight = vi.fn(async () => ({ ok: true as const }))
    const put = vi.fn(async () => {})
    const executor: RightsExecutor = {
      name: 'a',
      scopes: ['property'],
      journalContexts: ['review'],
      tables: {},
      report: async () => [],
      exportFiles: async () => [],
      preflight,
      apply,
    }
    const err: string[] = []

    const snapshot = async () =>
      (
        await lease.pool.query(
          'SELECT to_jsonb(p.*) AS row FROM properties p WHERE organization_id = ANY($1) ORDER BY id',
          [organizationIds],
        )
      ).rows
    const before = await snapshot()
    const missingOrganization = subject === 'mistyped Organization'
    const exit = await runRightsExecutors({
      plan: planOf({
        organizationId: missingOrganization
          ? `${asked.organizationId}-typo`
          : asked.organizationId,
        propertyId: missingOrganization
          ? asked.propertyId
          : subject === 'missing Property'
            ? randomUUID()
            : other.propertyId,
      }),
      executors: [executor],
      io: { out: () => {}, err: (line) => err.push(line) },
      journal: createRightsJournal({ put, alert: () => {} }),
      subjectRefusal: (plan) => rightsSubjectRefusal(db, plan),
      writeExportFile: async () => {},
    })

    expect(exit).toBe(1)
    expect(err).toEqual([
      `rights-request: ${missingOrganization ? 'the Organization does not exist' : 'the Property does not belong to the Organization'}; nothing was changed`,
    ])
    expect(preflight).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(await snapshot()).toEqual(before)
  })
})
