import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { decideCurrentUserParticipationAuthority } from './current-user-participation-authority'

const db = getDb()
const ORG = 'org-inbox-assignee-staff-authority'
const USER = 'user-inbox-assignee-participant'
const PROPERTY = '4c000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '4c000000-0000-4000-8000-000000000002'
const PARTICIPANT = '4c000000-0000-4000-8000-000000000010'
const LINK = '4c000000-0000-4000-8000-000000000011'
const PARTICIPATION = '4c000000-0000-4000-8000-000000000012'
const AT = new Date('2026-08-26T12:00:00.000Z')
const START = new Date('2026-08-25T12:00:00.000Z')
const MUTATION_FIRST_SESSION = 'ibx-assignee-staff-mutation-first'

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

function decide(propertyId = PROPERTY) {
  return db.transaction((tx) =>
    decideCurrentUserParticipationAuthority(tx, {
      organizationId: ORG,
      propertyId,
      userId: USER,
      at: AT,
    }),
  )
}

async function clearAuthorityRows(): Promise<void> {
  await db.execute(sql`DELETE FROM staff_participations WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM staff_user_links WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM staff_participants WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  await clearAuthorityRows()
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Inbox Staff Authority', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES
      (${PROPERTY}, ${ORG}, 'Inbox Staff Property', 'inbox-staff-property', 'UTC'),
      (${OTHER_PROPERTY}, ${ORG}, 'Other Inbox Property', 'other-inbox-property', 'UTC')
  `)
})

beforeEach(async () => {
  await clearAuthorityRows()
  await db.execute(sql`
    INSERT INTO staff_participants (
      id, organization_id, display_name, status, revision, created_by,
      created_at, updated_at
    ) VALUES (${PARTICIPANT}::uuid, ${ORG}, 'Inbox Manager', 'active', 1, 'test', ${START}, ${START})
  `)
  await db.execute(sql`
    INSERT INTO staff_user_links (
      id, organization_id, staff_participant_id, user_id, effective_from,
      effective_to, created_by
    ) VALUES (${LINK}::uuid, ${ORG}, ${PARTICIPANT}::uuid, ${USER}, ${START}, NULL, 'test')
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (
      id, organization_id, property_id, staff_participant_id, user_id,
      display_name, status, started_at, ended_at, revision, created_by,
      created_at, updated_at
    ) VALUES (
      ${PARTICIPATION}::uuid, ${ORG}, ${PROPERTY}::uuid, ${PARTICIPANT}::uuid,
      NULL, 'Inbox Manager', 'active', ${START}, NULL, 1, 'test', ${START}, ${START}
    )
  `)
})

afterAll(async () => {
  await clearAuthorityRows()
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
})

describe.sequential('current Staff user participation authority', () => {
  it('proves the exact current login link and active Property participation', async () => {
    await expect(decide()).resolves.toEqual({
      allowed: true,
      staffParticipantId: PARTICIPANT,
      staffParticipationId: PARTICIPATION,
    })
  })

  it('denies when the linked participant has no participation at the exact Property', async () => {
    await expect(decide(OTHER_PROPERTY)).resolves.toEqual({
      allowed: false,
      reason: 'participation_denied',
    })
  })

  it('denies an ended login link even while the participation remains active', async () => {
    await db.execute(sql`
      UPDATE staff_user_links
      SET effective_to = ${AT}
      WHERE id = ${LINK}::uuid
    `)

    await expect(decide()).resolves.toEqual({
      allowed: false,
      reason: 'link_denied',
    })
  })

  it('denies an archived participation even while the login link remains current', async () => {
    await db.execute(sql`
      UPDATE staff_participations
      SET status = 'archived', ended_at = ${AT}, archive_reason = 'left_property'
      WHERE id = ${PARTICIPATION}::uuid
    `)

    await expect(decide()).resolves.toEqual({
      allowed: false,
      reason: 'participation_denied',
    })
  })

  it('lets a link mutation finish before the link-first authority decision', async () => {
    const mutator = await getPool().connect()
    let mutationOpen = false
    let authorityTransaction: ReturnType<typeof decide> | undefined

    try {
      await mutator.query('BEGIN')
      mutationOpen = true
      await mutator.query(
        `SELECT id
         FROM staff_user_links
         WHERE organization_id = $1
           AND user_id = $2
           AND effective_to IS NULL
         FOR UPDATE`,
        [ORG, USER],
      )

      authorityTransaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('application_name', ${MUTATION_FIRST_SESSION}, true)`,
        )
        return decideCurrentUserParticipationAuthority(tx, {
          organizationId: ORG,
          propertyId: PROPERTY,
          userId: USER,
          at: AT,
        })
      })
      void authorityTransaction.catch(() => undefined)
      await waitForSessionLock(MUTATION_FIRST_SESSION)

      await mutator.query(
        `UPDATE staff_user_links
         SET effective_to = $3
         WHERE organization_id = $1
           AND user_id = $2
           AND effective_to IS NULL`,
        [ORG, USER, AT],
      )
      await mutator.query('COMMIT')
      mutationOpen = false

      await expect(authorityTransaction).resolves.toEqual({
        allowed: false,
        reason: 'link_denied',
      })
    } finally {
      if (mutationOpen) await mutator.query('ROLLBACK').catch(() => undefined)
      mutator.release()
      await authorityTransaction?.catch(() => undefined)
    }
  })
})
