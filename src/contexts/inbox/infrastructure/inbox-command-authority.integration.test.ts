import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { EventBus } from '#/shared/events/event-bus'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { decideCurrentManagerPropertyAuthorities } from '#/contexts/identity/infrastructure/repositories/member-property-authority'
import { decideCurrentUserParticipationAuthority } from '#/contexts/staff/infrastructure/repositories/current-user-participation-authority'
import type { InboxItem } from '../domain/types'
import { inboxItemAssigned, inboxItemBulkStatusChanged } from '../domain/events'
import { isInboxError } from '../domain/errors'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createInboxCommandAuthority } from './adapters/inbox-command-authority.adapter'

const db = getDb()
const ORG = organizationId('org-inbox-command-batch-authority')
const OWNER = userId('user-inbox-command-owner-a')
const MANAGER = userId('user-inbox-command-manager-z')
const PROPERTY_A = propertyId('4e000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('4e000000-0000-4000-8000-000000000002')
const ITEM_A = inboxItemId('4e000000-0000-4000-8000-000000000011')
const ITEM_B = inboxItemId('4e000000-0000-4000-8000-000000000012')
const FEEDBACK_A = feedbackId('4e000000-0000-4000-8000-000000000021')
const FEEDBACK_B = feedbackId('4e000000-0000-4000-8000-000000000022')
const NOW = new Date('2026-08-27T00:00:00.000Z')
const ASSIGN_SESSION = 'ibx-batch-assign-target-revocation'
const BULK_SESSION = 'ibx-batch-bulk-later-revocation'

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

async function waitForSessionLock(applicationName: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const waiting = await getPool().query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE application_name = $1
         AND wait_event_type = 'Lock'`,
      [applicationName],
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`session ${applicationName} did not reach its lock wait`)
}

function authorityForSession(applicationName: string): InboxCommandAuthority {
  const authorize = createInboxCommandAuthority({
    decideManagerPropertyAuthorities: (tx, input) =>
      decideCurrentManagerPropertyAuthorities(tx, input),
    decideUserParticipationAuthority: (tx, input) =>
      decideCurrentUserParticipationAuthority(tx, input),
  })
  return async (tx, input) => {
    await tx.execute(sql`SELECT set_config('application_name', ${applicationName}, true)`)
    return authorize(tx, input)
  }
}

function makeItem(
  id: typeof ITEM_A | typeof ITEM_B,
  property: typeof PROPERTY_A | typeof PROPERTY_B,
  sourceId: typeof FEEDBACK_A | typeof FEEDBACK_B,
  status: 'open' | 'closed',
): InboxItem {
  return {
    id,
    organizationId: ORG,
    propertyId: property,
    sourceType: 'feedback',
    sourceId,
    status,
    rating: 2,
    sourceDate: NOW,
    platform: null,
    snippet: 'Private feedback',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: status === 'closed' ? NOW : null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

async function insertItem(item: InboxItem): Promise<void> {
  await db.execute(sql`
    INSERT INTO inbox_items (
      id, organization_id, property_id, source_type, source_id, status,
      rating, source_date, snippet, closed_at, command_revision, created_at, updated_at
    ) VALUES (
      ${item.id}::uuid, ${item.organizationId}, ${item.propertyId}, ${item.sourceType},
      ${item.sourceId}::uuid, ${item.status}, ${item.rating}, ${item.sourceDate},
      ${item.snippet}, ${item.closedAt}, ${item.commandRevision}, ${item.createdAt},
      ${item.updatedAt}
    )
  `)
}

async function clearCommandRows(): Promise<void> {
  await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  await clearCommandRows()
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Inbox Batch Authority', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES
      (${OWNER}, 'Inbox Owner', 'inbox-batch-owner@example.com', false),
      (${MANAGER}, 'Inbox Manager', 'inbox-batch-manager@example.com', false)
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES
      (${PROPERTY_A}, ${ORG}, 'Inbox Batch Property A', 'inbox-batch-property-a', 'UTC'),
      (${PROPERTY_B}, ${ORG}, 'Inbox Batch Property B', 'inbox-batch-property-b', 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES
      ('member-inbox-batch-owner', ${OWNER}, ${ORG}, 'owner', now()),
      ('member-inbox-batch-manager', ${MANAGER}, ${ORG}, 'admin', now())
  `)
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(async () => {
  await clearCommandRows()
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES
      (${ORG}, ${PROPERTY_A}::uuid, ${MANAGER}, 'operator', 'test'),
      (${ORG}, ${PROPERTY_B}::uuid, ${MANAGER}, 'operator', 'test')
  `)
})

afterAll(async () => {
  clearEventSchemas()
  await clearCommandRows()
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])
})

describe.sequential('Inbox command-wide authority', () => {
  it('lets target revocation finish before an actor-to-assignee command is denied', async () => {
    const item = makeItem(ITEM_A, PROPERTY_A, FEEDBACK_A, 'open')
    await insertItem(item)
    const revoker = await getPool().connect()
    let revocationOpen = false
    let command: ReturnType<
      ReturnType<typeof createAtomicInboxCommandStore>['assign']
    > | null = null

    try {
      await revoker.query('BEGIN')
      revocationOpen = true
      await revoker.query(
        `SELECT id
         FROM property_access_grant
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL
         FOR UPDATE`,
        [ORG, PROPERTY_A, MANAGER],
      )

      const store = createAtomicInboxCommandStore(
        db,
        silentEvents,
        authorityForSession(ASSIGN_SESSION),
        () => NOW,
      )
      command = store.assign(
        item,
        { assignedTo: MANAGER },
        inboxItemAssigned({
          inboxItemId: ITEM_A,
          organizationId: ORG,
          propertyId: PROPERTY_A,
          userId: OWNER,
          assignedTo: MANAGER,
          source: 'web',
          occurredAt: NOW,
        }),
        NOW,
      )
      void command.catch(() => undefined)
      await waitForSessionLock(ASSIGN_SESSION)

      await revoker.query(
        `UPDATE property_access_grant
         SET revoked_at = $4
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL`,
        [ORG, PROPERTY_A, MANAGER, NOW],
      )
      await revoker.query('COMMIT')
      revocationOpen = false

      await expect(command).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'forbidden',
      )
      const current = await getPool().query(
        `SELECT assigned_to, command_revision::int AS command_revision
         FROM inbox_items WHERE id = $1`,
        [ITEM_A],
      )
      expect(current.rows).toEqual([{ assigned_to: null, command_revision: 1 }])
    } finally {
      if (revocationOpen) await revoker.query('ROLLBACK').catch(() => undefined)
      revoker.release()
      await command?.catch(() => undefined)
    }
  })

  it('denies one multi-Property bulk reopen after the later grant is revoked without partial writes', async () => {
    const itemA = makeItem(ITEM_A, PROPERTY_A, FEEDBACK_A, 'closed')
    const itemB = makeItem(ITEM_B, PROPERTY_B, FEEDBACK_B, 'closed')
    await insertItem(itemA)
    await insertItem(itemB)
    const revoker = await getPool().connect()
    let revocationOpen = false
    let command: ReturnType<
      ReturnType<typeof createAtomicInboxCommandStore>['bulkUpdateStatus']
    > | null = null

    try {
      await revoker.query('BEGIN')
      revocationOpen = true
      await revoker.query(
        `SELECT id
         FROM property_access_grant
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL
         FOR UPDATE`,
        [ORG, PROPERTY_B, MANAGER],
      )

      const bulkId = '4e000000-0000-4000-8000-000000000099'
      const events = [itemA, itemB].map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG,
          propertyId: item.propertyId,
          userId: MANAGER,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId,
          source: 'web',
          occurredAt: NOW,
        }),
      )
      const store = createAtomicInboxCommandStore(
        db,
        silentEvents,
        authorityForSession(BULK_SESSION),
        () => NOW,
      )
      command = store.bulkUpdateStatus([itemA, itemB], events, {
        reason: 'new_information',
        explanation: null,
      })
      void command.catch(() => undefined)
      await waitForSessionLock(BULK_SESSION)

      await revoker.query(
        `UPDATE property_access_grant
         SET revoked_at = $4
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL`,
        [ORG, PROPERTY_B, MANAGER, NOW],
      )
      await revoker.query('COMMIT')
      revocationOpen = false

      await expect(command).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'forbidden',
      )
      const current = await getPool().query(
        `SELECT id::text AS id, status, command_revision::int AS command_revision
         FROM inbox_items
         WHERE organization_id = $1
         ORDER BY id`,
        [ORG],
      )
      expect(current.rows).toEqual([
        { id: ITEM_A, status: 'closed', command_revision: 1 },
        { id: ITEM_B, status: 'closed', command_revision: 1 },
      ])
      const facts = await getPool().query(
        `SELECT 1 FROM outbox_events
         WHERE organization_id = $1
           AND event_type = 'inbox.inbox_item.bulk_status_changed'`,
        [ORG],
      )
      expect(facts.rowCount).toBe(0)
    } finally {
      if (revocationOpen) await revoker.query('ROLLBACK').catch(() => undefined)
      revoker.release()
      await command?.catch(() => undefined)
    }
  })
})
