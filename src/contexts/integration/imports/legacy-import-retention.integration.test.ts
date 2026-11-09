import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createLegacyImportRetention } from './legacy-import-retention.server'

const ORG_ID = 'legacy-import-retention-org'
const DAY_MS = 24 * 60 * 60 * 1_000
const TERMINAL_AT = new Date('2026-09-01T10:00:00.000Z')
const PURGE_AT = new Date(TERMINAL_AT.getTime() + 30 * DAY_MS)
const db = getDb()
const retention = createLegacyImportRetention(db)

async function insertLegacyImport(status: 'queued' | 'failed') {
  const id = randomUUID()
  const itemId = randomUUID()
  const finished = status === 'failed'
  await db.insert(gbpImportRequests).values({
    id,
    organizationId: ORG_ID,
    requestId: id,
    initiatedBy: 'legacy-import-retention-user',
    status,
    totalCount: 1,
    pendingCount: finished ? 0 : 1,
    processedCount: finished ? 1 : 0,
    failedCount: finished ? 1 : 0,
    firstTerminalAt: finished ? TERMINAL_AT : null,
    purgeAt: finished ? PURGE_AT : null,
    createdAt: TERMINAL_AT,
    updatedAt: TERMINAL_AT,
  })
  if (!finished) return { id, itemId }
  await db.insert(gbpImportRequestItems).values({
    id: itemId,
    organizationId: ORG_ID,
    importJobId: id,
    destinationPropertyId: randomUUID(),
    action: 'create',
    updateExistingProfile: true,
    propertyName: 'Legacy',
    countryCode: 'US',
    timezone: 'UTC',
    status: 'failed',
    outcomeCode: 'internal_error',
    firstTerminalAt: TERMINAL_AT,
    effectDeadlineAt: new Date(TERMINAL_AT.getTime() + DAY_MS),
    createdAt: TERMINAL_AT,
    updatedAt: TERMINAL_AT,
  })
  return { id, itemId }
}

describe('legacy import retention', () => {
  beforeAll(() => {
    registerAllEventSchemas()
  })
  afterAll(async () => {
    await deleteTestOrganizations(db, [ORG_ID])
  })

  it('purges finished history past its purge time and leaves unfinished imports alone', async () => {
    const finished = await insertLegacyImport('failed')
    const active = await insertLegacyImport('queued')

    const early = await retention.listPurgeCandidates(
      new Date(PURGE_AT.getTime() - 1),
      100,
    )
    expect(early.filter((row) => row.organizationId === ORG_ID)).toEqual([])
    const due = await retention.listPurgeCandidates(PURGE_AT, 100)
    expect(due.filter((row) => row.organizationId === ORG_ID)).toEqual([
      { organizationId: ORG_ID, importJobId: finished.id, deletionFence: 0 },
    ])

    const outboxEventId = randomUUID()
    await expect(
      retention.purgeParent({
        organizationId: ORG_ID,
        importJobId: finished.id,
        expectedDeletionFence: 0,
        now: PURGE_AT,
        outboxEventId,
      }),
    ).resolves.toBe('purged')
    await expect(
      retention.purgeParent({
        organizationId: ORG_ID,
        importJobId: active.id,
        expectedDeletionFence: 0,
        now: PURGE_AT,
        outboxEventId: randomUUID(),
      }),
    ).resolves.toBe('lost')

    await expect(
      db.select().from(gbpImportRequests).where(eq(gbpImportRequests.id, finished.id)),
    ).resolves.toEqual([])
    await expect(
      db
        .select()
        .from(gbpImportRequestItems)
        .where(eq(gbpImportRequestItems.id, finished.itemId)),
    ).resolves.toEqual([])
    await expect(
      db.select().from(gbpImportRequests).where(eq(gbpImportRequests.id, active.id)),
    ).resolves.toHaveLength(1)
    await expect(
      db.select().from(outboxEvents).where(eq(outboxEvents.id, outboxEventId)),
    ).resolves.toHaveLength(1)
  })
})
