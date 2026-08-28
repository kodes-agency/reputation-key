// BQC-4.4 — recent_activity_entries read-side org isolation (real PostgreSQL).
//
// The 4.3 data-flow map documents that recent_activity_entries payload.detail can carry
// TENANT-AUTHORED free text. The read-side governance decision (BQC-4.4):
// that text is tenant-owned content in the cell DB, displayed only to members
// of the owning org — every activity read filters organization_id in SQL.
// This test proves the isolation at the repository boundary: identical
// resource refs in another org never leak, free text included.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createRecentActivityRepository } from '../recent-activity-repository.drizzle'
import type { RecentActivityEntry } from '../../domain/types'
import {
  recentActivityEntryId,
  userId,
  propertyId,
  organizationId,
} from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'

const db = getDb()
const repo = createRecentActivityRepository(db, createMockLogger())
const ORG_A = organizationId('org-activity-iso-a')
const ORG_B = organizationId('org-activity-iso-b')
const ORG_C = organizationId('org-activity-valid-vocabulary')
const SHARED_RESOURCE_ID = 'shared-resource-id'
const OTHER_ORG_MARKER = 'OTHER-ORG-TENANT-FREE-TEXT-MARKER'

function entry(
  id: string,
  orgId: typeof ORG_A,
  detail: string | null,
): RecentActivityEntry {
  return {
    id: recentActivityEntryId(id),
    actorId: userId('user-activity-iso'),
    actorName: 'Iso Tester',
    actorAvatarUrl: null,
    actorRole: 'AccountAdmin',
    action: 'rejected',
    resourceType: 'review',
    resourceId: SHARED_RESOURCE_ID,
    propertyId: propertyId('d4000000-0000-4000-8000-0000000000b1'),
    organizationId: orgId,
    payload: { subject: 'review', from: 'draft', to: 'rejected', detail },
    source: 'web',
    eventId: `evt-${id}`,
    createdAt: new Date('2026-07-18T12:00:00Z'),
  }
}

const ROW_A = entry('d4000000-0000-4000-8000-0000000000c1', ORG_A, 'own-org reason')
const ROW_B = entry('d4000000-0000-4000-8000-0000000000c2', ORG_B, OTHER_ORG_MARKER)
const ROW_C: RecentActivityEntry = {
  ...entry('d4000000-0000-4000-8000-0000000000c3', ORG_C, 'escalation resolved'),
  action: 'deescalated',
  resourceType: 'organization',
  resourceId: ORG_C,
  propertyId: null,
}

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM recent_activity_entries WHERE organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`,
  )
  await repo.insert(ROW_A)
  await repo.insert(ROW_B)
  await repo.insert(ROW_C)
})

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM recent_activity_entries WHERE organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`,
  )
})

describe('activity repository org isolation (BQC-4.4, real PostgreSQL)', () => {
  it('findByOrganization returns only the caller org rows (free text included)', async () => {
    const rows = await repo.findByOrganization(ORG_A, {}, { limit: 50, offset: 0 })

    expect(rows.map((r) => r.id)).toEqual([ROW_A.id])
    expect(JSON.stringify(rows)).not.toContain(OTHER_ORG_MARKER)
  })

  it('findByResource cannot leak another org row with the same resource id', async () => {
    const rows = await repo.findByResource(ORG_A, 'review', SHARED_RESOURCE_ID, 50)

    expect(rows.map((r) => r.id)).toEqual([ROW_A.id])
    expect(JSON.stringify(rows)).not.toContain(OTHER_ORG_MARKER)
  })

  it('the other org read sees its own row only (symmetry)', async () => {
    const rows = await repo.findByOrganization(ORG_B, {}, { limit: 50, offset: 0 })

    expect(rows.map((r) => r.id)).toEqual([ROW_B.id])
  })

  it('decodes every valid lifecycle vocabulary value without breaking paging', async () => {
    const rows = await repo.findByOrganization(ORG_C, {}, { limit: 50, offset: 0 })

    expect(rows).toEqual([ROW_C])
  })

  it('does not return Organization-scoped rows through an assigned-Property filter', async () => {
    const rows = await repo.findByOrganization(
      ORG_C,
      { propertyIds: [propertyId('d4000000-0000-4000-8000-0000000000b1')] },
      { limit: 50, offset: 0 },
    )

    expect(rows).toEqual([])
  })
})
