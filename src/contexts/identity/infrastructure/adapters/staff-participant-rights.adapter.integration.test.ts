// Participant erasure against real PostgreSQL: the person is pseudonymised and
// their login removed, everyone else stays, a restore cannot bring them back,
// and a rejected journal write changes nothing. Rows are committed (the executor
// opens its own transactions), so every test removes what it created.

import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureLedgerEntry,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  decodeErasureJournalEntry,
  type ErasureJournalEntry,
} from '#/shared/db/lifecycle/erasure-journal.server'
import {
  organizationId as toOrganizationId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { createPrimaryStaffAttributionResolver } from '../primary-staff-attribution'
import { FORMER_STAFF_LABEL } from './staff-participant-erasure'
import { createStaffParticipantErasureReplayer } from './staff-participant-erasure-replayer.adapter'
import { createStaffParticipantRightsExecutor } from './staff-participant-rights.adapter'

const db = getDb()
const ERASED_AT = new Date('2026-11-09T12:00:00.000Z')
const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z')

const orgIds: string[] = []
const userIds: string[] = []

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

type Person = Readonly<{
  participantId: string
  participationId: string
  userId: string
  email: string
  sessionId: string
}>

type Cell = Readonly<{
  organizationId: string
  propertyId: string
  otherPropertyId: string
  portalId: string
  person: Person
  colleague: Person
  colleagueOtherProperty: Person
}>

async function seedUser(email: string): Promise<{ userId: string; sessionId: string }> {
  const userId = `user-${randomUUID()}`
  const sessionId = `session-${randomUUID()}`
  userIds.push(userId)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (${userId}, 'Real Name', ${email}, true, clock_timestamp(), clock_timestamp())
  `)
  await db.execute(sql`
    INSERT INTO session (id, "expiresAt", token, "userId", "createdAt", "updatedAt")
    VALUES (${sessionId}, clock_timestamp() + interval '1 day', ${`token-${sessionId}`},
            ${userId}, clock_timestamp(), clock_timestamp())
  `)
  await db.execute(sql`
    INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
    VALUES (${`account-${userId}`}, ${userId}, 'credential', ${userId},
            clock_timestamp(), clock_timestamp())
  `)
  return { userId, sessionId }
}

async function seedMember(organizationId: string, userId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES (${`member-${randomUUID()}`}, ${userId}, ${organizationId}, 'member',
            clock_timestamp())
  `)
}

async function seedOrganization(): Promise<string> {
  const organizationId = `rk-ap-08k-${randomUUID()}`
  orgIds.push(organizationId)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'Participant Proof', ${organizationId}, clock_timestamp())
  `)
  return organizationId
}

async function seedProperty(organizationId: string): Promise<string> {
  const propertyId = randomUUID()
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${propertyId}::uuid, ${organizationId}, 'Proof House',
            ${`proof-${propertyId}`}, 'UTC', clock_timestamp(), clock_timestamp())
  `)
  return propertyId
}

async function seedPerson(
  organizationId: string,
  propertyId: string,
  name: string,
  existingUser?: { userId: string; sessionId: string },
): Promise<Person> {
  const email = `${name.toLowerCase().replace(/\s+/gu, '.')}-${randomUUID()}@example.test`
  const { userId, sessionId } = existingUser ?? (await seedUser(email))
  const participantId = randomUUID()
  const participationId = randomUUID()
  await db.execute(sql`
    INSERT INTO staff_participants (id, organization_id, display_name, created_by,
                                    created_at, updated_at)
    VALUES (${participantId}::uuid, ${organizationId}, ${name}, 'seed',
            ${SEEDED_AT.toISOString()}::timestamptz, ${SEEDED_AT.toISOString()}::timestamptz)
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (id, organization_id, property_id,
                                      staff_participant_id, display_name, started_at,
                                      created_by, created_at, updated_at)
    VALUES (${participationId}::uuid, ${organizationId}, ${propertyId}::uuid,
            ${participantId}::uuid, ${name}, ${SEEDED_AT.toISOString()}::timestamptz,
            'seed', ${SEEDED_AT.toISOString()}::timestamptz,
            ${SEEDED_AT.toISOString()}::timestamptz)
  `)
  await db.execute(sql`
    INSERT INTO staff_user_links (id, organization_id, staff_participant_id, user_id,
                                  effective_from, created_by)
    VALUES (${randomUUID()}::uuid, ${organizationId}, ${participantId}::uuid, ${userId},
            ${SEEDED_AT.toISOString()}::timestamptz, 'seed')
  `)
  await seedMember(organizationId, userId)
  const stored = (await db.execute(sql`SELECT email FROM "user" WHERE id = ${userId}`))
    .rows[0] as { email: string } | undefined
  if (!stored) throw new Error('seeded user missing')
  return { participantId, participationId, userId, email: stored.email, sessionId }
}

async function seedCell(): Promise<Cell> {
  const organizationId = await seedOrganization()
  const propertyId = await seedProperty(organizationId)
  const otherPropertyId = await seedProperty(organizationId)
  const portalId = randomUUID()
  await db.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                         publication_state, created_at, updated_at)
    VALUES (${portalId}::uuid, ${organizationId}, ${propertyId}::uuid,
            ${propertyId}::uuid, 'Front Desk', ${`portal-${portalId}`},
            'published', clock_timestamp(), clock_timestamp())
  `)
  const person = await seedPerson(organizationId, propertyId, 'Erin Erased')
  const colleague = await seedPerson(organizationId, propertyId, 'Casey Colleague')
  const colleagueOtherProperty = await seedPerson(
    organizationId,
    otherPropertyId,
    'Olive Other',
  )
  await db.execute(sql`
    INSERT INTO portal_responsibilities (id, organization_id, property_id, portal_id,
                                         staff_participation_id, effective_from, created_by)
    VALUES (${randomUUID()}::uuid, ${organizationId}, ${propertyId}::uuid,
            ${portalId}::uuid, ${person.participationId}::uuid,
            ${SEEDED_AT.toISOString()}::timestamptz, 'seed')
  `)
  return {
    organizationId,
    propertyId,
    otherPropertyId,
    portalId,
    person,
    colleague,
    colleagueOtherProperty,
  }
}

async function removeEverything(): Promise<void> {
  for (const organizationId of orgIds.splice(0)) {
    for (const table of [
      'portal_responsibilities',
      'staff_user_links',
      'staff_participations',
      'staff_onboardings',
      'staff_participants',
      'property_access_grants',
      'portals',
      'properties',
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
      )
    }
    await db.execute(
      sql`DELETE FROM invitation WHERE "organizationId" = ${organizationId}`,
    )
    await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${organizationId}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${organizationId}`)
  }
  for (const userId of userIds.splice(0)) {
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`)
  }
}

afterEach(removeEverything)

function planFor(
  cell: Cell,
  person: Person,
  overrides: Partial<RightsRequestPlan> = {},
): RightsRequestPlan {
  return {
    scope: 'participant',
    mode: 'apply',
    organizationId: cell.organizationId,
    subjectRef: digest(person.email.toLowerCase()),
    verificationRef: 'ticket-1',
    receivedAt: ERASED_AT,
    verifiedAt: ERASED_AT,
    batchSize: 50,
    ...overrides,
  }
}

function recordingStore() {
  const entries: ErasureJournalEntry[] = []
  const store = {
    put: async (_key: string, bytes: string) => {
      entries.push(decodeErasureJournalEntry(bytes))
    },
    alert: vi.fn(),
  }
  return { entries, store }
}

function executorWith(store: ReturnType<typeof recordingStore>['store']) {
  return createStaffParticipantRightsExecutor({
    db,
    journal: createRightsJournal(store),
    now: () => ERASED_AT,
  })
}

async function rowsOf(query: ReturnType<typeof sql>): Promise<unknown[]> {
  return (await db.execute(query)).rows
}

/** Everything the erased person's neighbours hold, as JSON, for byte comparison. */
async function bystanderState(cell: Cell): Promise<unknown> {
  const ids = [cell.colleague, cell.colleagueOtherProperty].map(
    ({ participantId }) => participantId,
  )
  const users = [cell.colleague, cell.colleagueOtherProperty].map(({ userId }) => userId)
  return {
    participants: await rowsOf(sql`
      SELECT * FROM staff_participants WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) ORDER BY id`),
    participations: await rowsOf(sql`
      SELECT * FROM staff_participations WHERE staff_participant_id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) ORDER BY id`),
    links: await rowsOf(sql`
      SELECT * FROM staff_user_links WHERE user_id IN (${sql.join(
        users.map((id) => sql`${id}`),
        sql`, `,
      )}) ORDER BY id`),
    users: await rowsOf(sql`
      SELECT * FROM "user" WHERE id IN (${sql.join(
        users.map((id) => sql`${id}`),
        sql`, `,
      )}) ORDER BY id`),
    members: await rowsOf(sql`
      SELECT * FROM member WHERE "userId" IN (${sql.join(
        users.map((id) => sql`${id}`),
        sql`, `,
      )}) ORDER BY id`),
  }
}

const count = async (query: ReturnType<typeof sql>) =>
  Number((await rowsOf(query))[0] && ((await rowsOf(query))[0] as { n: string }).n)

describe('Staff Participant erasure', () => {
  it('pseudonymises the person, removes the login, and leaves everyone else untouched', async () => {
    const cell = await seedCell()
    const before = await bystanderState(cell)
    const { entries, store } = recordingStore()

    const outcome = await executorWith(store).apply(planFor(cell, cell.person))

    expect(outcome).toEqual({
      ok: true,
      lines: ['participants=1 logins=1 memberships=1'],
    })
    expect(
      await rowsOf(sql`
        SELECT display_name, status FROM staff_participants
        WHERE id = ${cell.person.participantId}::uuid`),
    ).toEqual([{ display_name: FORMER_STAFF_LABEL, status: 'archived' }])
    expect(
      await rowsOf(sql`
        SELECT display_name, user_id, status FROM staff_participations
        WHERE id = ${cell.person.participationId}::uuid`),
    ).toEqual([{ display_name: FORMER_STAFF_LABEL, user_id: null, status: 'archived' }])
    for (const table of ['"user"', 'session', 'account']) {
      const column = table === '"user"' ? 'id' : '"userId"'
      expect(
        await count(
          sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE ${sql.raw(column)} = ${cell.person.userId}`,
        ),
      ).toBe(0)
    }
    expect(
      await count(
        sql`SELECT count(*) AS n FROM member WHERE "userId" = ${cell.person.userId}`,
      ),
    ).toBe(0)
    expect(await bystanderState(cell)).toEqual(before)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      context: 'staff',
      subjectClass: 'privacy_subject',
      journalTargets: { kind: 'staff_participant', ids: [cell.person.participantId] },
    })
  })

  it('keeps attribution resolving and shows the neutral label', async () => {
    const cell = await seedCell()
    const resolve = createPrimaryStaffAttributionResolver(db)
    const input = {
      organizationId: toOrganizationId(cell.organizationId),
      propertyId: toPropertyId(cell.propertyId),
      portalId: toPortalId(cell.portalId),
      observedAt: new Date('2026-06-01T00:00:00.000Z'),
    }
    const snapshotBefore = await resolve(input)

    await executorWith(recordingStore().store).apply(planFor(cell, cell.person))

    const snapshotAfter = await resolve(input)
    expect(snapshotBefore).not.toBeNull()
    expect(snapshotAfter).toMatchObject({
      staffParticipantId: snapshotBefore!.staffParticipantId,
      staffParticipationId: snapshotBefore!.staffParticipationId,
      portalResponsibilityId: snapshotBefore!.portalResponsibilityId,
    })
    expect(snapshotAfter?.staffParticipantId).toBe(cell.person.participantId)
    expect(
      await rowsOf(sql`
        SELECT display_name FROM staff_participants
        WHERE id = ${snapshotAfter!.staffParticipantId}::uuid`),
    ).toEqual([{ display_name: FORMER_STAFF_LABEL }])
  })

  it('keeps the login for another Organization and removes only this membership', async () => {
    const cell = await seedCell()
    const otherOrganizationId = await seedOrganization()
    const otherPropertyId = await seedProperty(otherOrganizationId)
    const other = await seedPerson(otherOrganizationId, otherPropertyId, 'Erin Erased', {
      userId: cell.person.userId,
      sessionId: cell.person.sessionId,
    })

    const outcome = await executorWith(recordingStore().store).apply(
      planFor(cell, cell.person),
    )

    expect(outcome).toEqual({
      ok: true,
      lines: ['participants=1 logins=0 memberships=1'],
    })
    expect(
      await rowsOf(sql`SELECT name FROM "user" WHERE id = ${cell.person.userId}`),
    ).toEqual([{ name: 'Real Name' }])
    expect(
      await count(
        sql`SELECT count(*) AS n FROM session WHERE id = ${cell.person.sessionId}`,
      ),
    ).toBe(1)
    expect(
      await rowsOf(sql`
        SELECT "organizationId" FROM member WHERE "userId" = ${cell.person.userId}`),
    ).toEqual([{ organizationId: otherOrganizationId }])
    expect(
      await rowsOf(sql`
        SELECT display_name FROM staff_participants
        WHERE id = ${other.participantId}::uuid`),
    ).toEqual([{ display_name: 'Erin Erased' }])
  })

  it('writes one journal entry per batch of at most the batch size', async () => {
    const cell = await seedCell()
    const { entries, store } = recordingStore()
    // A second participant that the same login once belonged to also matches.
    const formerId = randomUUID()
    await db.execute(sql`
      INSERT INTO staff_participants (id, organization_id, display_name, created_by)
      VALUES (${formerId}::uuid, ${cell.organizationId}, 'Erin Earlier', 'seed')
    `)
    await db.execute(sql`
      INSERT INTO staff_user_links (id, organization_id, staff_participant_id, user_id,
                                    effective_from, effective_to, created_by)
      VALUES (${randomUUID()}::uuid, ${cell.organizationId}, ${formerId}::uuid,
              ${cell.person.userId}, '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z', 'seed')
    `)

    await executorWith(store).apply(planFor(cell, cell.person, { batchSize: 1 }))

    expect(entries.map((entry) => entry.journalTargets?.ids.length)).toEqual([1, 1])
    expect(new Set(entries.flatMap((entry) => entry.journalTargets?.ids ?? []))).toEqual(
      new Set([cell.person.participantId, formerId]),
    )
  })

  it('erases again after a restore brings the person back', async () => {
    const cell = await seedCell()
    const { entries, store } = recordingStore()
    await executorWith(store).apply(planFor(cell, cell.person))

    // The restore point predates the erasure: the person, login and membership return.
    await db.execute(sql`
      UPDATE staff_participants
      SET display_name = 'Erin Erased', status = 'active', archived_at = NULL,
          archive_reason = NULL
      WHERE id = ${cell.person.participantId}::uuid`)
    await db.execute(sql`
      UPDATE staff_participations
      SET display_name = 'Erin Erased', user_id = ${cell.person.userId},
          status = 'active', ended_at = NULL, archive_reason = NULL
      WHERE id = ${cell.person.participationId}::uuid`)
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${cell.person.userId}, 'Real Name', ${cell.person.email}, true,
              clock_timestamp(), clock_timestamp())`)
    await seedMember(cell.organizationId, cell.person.userId)

    const result = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries as BackupErasureLedgerEntry[],
        restorePointAt: new Date('2026-11-09T00:00:00.000Z'),
        replayers: [createStaffParticipantErasureReplayer()],
      }),
    )

    expect(result.verified).toBe(true)
    expect(
      await rowsOf(sql`
        SELECT display_name FROM staff_participants
        WHERE id = ${cell.person.participantId}::uuid`),
    ).toEqual([{ display_name: FORMER_STAFF_LABEL }])
    expect(
      await count(sql`SELECT count(*) AS n FROM "user" WHERE id = ${cell.person.userId}`),
    ).toBe(0)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM member WHERE "userId" = ${cell.person.userId}`,
      ),
    ).toBe(0)
    expect(
      await rowsOf(sql`
        SELECT display_name FROM staff_participants
        WHERE id = ${cell.colleague.participantId}::uuid`),
    ).toEqual([{ display_name: 'Casey Colleague' }])
  })

  it('changes nothing and raises an alert when the journal write is rejected', async () => {
    const cell = await seedCell()
    const alert = vi.fn()
    const journal = createRightsJournal({
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })
    const before = JSON.stringify([
      await bystanderState(cell),
      await rowsOf(sql`
        SELECT * FROM staff_participants WHERE id = ${cell.person.participantId}::uuid`),
      await rowsOf(sql`SELECT * FROM "user" WHERE id = ${cell.person.userId}`),
    ])

    await expect(
      createStaffParticipantRightsExecutor({ db, journal, now: () => ERASED_AT }).apply(
        planFor(cell, cell.person),
      ),
    ).rejects.toThrow('Erasure journal write failed')

    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'staff' }))
    const after = JSON.stringify([
      await bystanderState(cell),
      await rowsOf(sql`
        SELECT * FROM staff_participants WHERE id = ${cell.person.participantId}::uuid`),
      await rowsOf(sql`SELECT * FROM "user" WHERE id = ${cell.person.userId}`),
    ])
    expect(after).toBe(before)
  })

  it('refuses a subject that matches nobody in this Organization', async () => {
    const cell = await seedCell()
    const otherOrganizationId = await seedOrganization()

    const outcome = await executorWith(recordingStore().store).preflight!(
      planFor(cell, cell.person, { organizationId: otherOrganizationId }),
    )

    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('no Staff') })
  })
})
