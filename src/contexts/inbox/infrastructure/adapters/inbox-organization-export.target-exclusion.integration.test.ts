import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  excludeCycle,
  seedOrdinaryItem,
  seedRestatedRevisionItem,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'
import { createInboxOrganizationExportContributor } from './inbox-organization-export.adapter'

const ORG = 'org-inbox-export-target-exclusion'
const PROPERTY = 'e8c50000-0000-4000-8000-000000000001'
const RESTATED_ITEM = 'e8c50000-0000-4000-8000-000000000101'
const RESTATED_REVIEW = 'e8c50000-0000-4000-8000-000000000201'
const SIBLING_ITEM = 'e8c50000-0000-4000-8000-000000000102'
const SIBLING_REVIEW = 'e8c50000-0000-4000-8000-000000000202'

let pool: Pool

type ExportedTarget = Readonly<{
  inbox_item_id: string
  /** A bigint: the driver hands it over as text. */
  cycle_number: string
  excluded_reason: string | null
}>

async function exportedTargets(): Promise<{
  rows: ReadonlyArray<ExportedTarget>
  csv: string
}> {
  const contribution = await createInboxOrganizationExportContributor(getDb()).contribute(
    {
      organizationId: ORG,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    },
  )
  const entry = (path: string) => {
    const found = contribution.entries.find((candidate) => candidate.path === path)
    if (!found) throw new Error(`export has no ${path}`)
    return Buffer.from(found.bytes).toString('utf8')
  }
  const json = JSON.parse(entry('inbox/handling-cycles.json')) as {
    responseTargets: ReadonlyArray<ExportedTarget>
  }
  return { rows: json.responseTargets, csv: entry('inbox/handling-cycles.csv') }
}

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'inbox-export-target-exclusion',
    at: GUEST_UPDATE_TIME,
    properties: [{ id: PROPERTY, name: 'Export Property', slug: 'export-property' }],
  })
  await seedRestatedRevisionItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: RESTATED_REVIEW,
    itemId: RESTATED_ITEM,
    outcome: 'late',
  })
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: SIBLING_REVIEW,
    itemId: SIBLING_ITEM,
    startAt: new Date('2026-10-18T09:00:00.000Z'),
    outcome: 'open',
  })
})

describe.sequential('Inbox export marks an excluded Response Target (PostgreSQL)', () => {
  it('exports every target row, and names the exclusion on the row it excludes', async () => {
    await excludeCycle(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      itemId: RESTATED_ITEM,
      cycleNumber: 2,
    })

    const { rows, csv } = await exportedTargets()
    const reasons = rows.map((row) => [
      row.inbox_item_id,
      row.cycle_number,
      row.excluded_reason,
    ])

    expect(reasons).toEqual(
      expect.arrayContaining([
        [RESTATED_ITEM, '1', null],
        [RESTATED_ITEM, '2', 'provider_restatement'],
        [SIBLING_ITEM, '1', null],
      ]),
    )
    expect(rows).toHaveLength(3)
    // The human view carries each row as JSON, so the marker travels with it.
    expect(csv).toContain('excluded_reason')
  })

  it('exports no exclusion when nothing was excluded', async () => {
    const { rows } = await exportedTargets()

    expect(rows.map((row) => row.excluded_reason)).toEqual([null, null, null])
  })
})
