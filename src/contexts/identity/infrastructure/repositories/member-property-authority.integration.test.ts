import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { decideCurrentMemberPropertyAuthority } from './member-property-authority'

const db = getDb()
const ORG = 'org-publication-actor-authority'
const USER = 'user-publication-actor-authority'
const PROPERTY = '4a000000-0000-4000-8000-000000000001'
const VERSION_CHANGE_AUTHORITY_SESSION = 'rpl-actor-authority-version-change'
const MUTATION_FIRST_AUTHORITY_SESSION = 'rpl-actor-authority-mutation-first'

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

async function decide() {
  return db.transaction((tx) =>
    decideCurrentMemberPropertyAuthority(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
      userId: USER,
      permission: 'reply.manage',
      at: new Date(),
    }),
  )
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER}`)
  await db.execute(sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Publication Actor Authority', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES (${USER}, 'Publication Manager', 'publication-actor-authority@example.com', false)
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Authority Property', 'authority-property', 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES ('member-publication-actor-authority', ${USER}, ${ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (${ORG}, ${PROPERTY}::uuid, ${USER}, 'operator', 'test')
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER}`)
  await db.execute(sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe.sequential('current member Property authority', () => {
  it('allows the current PropertyManager while reply permission and grant hold', async () => {
    await expect(decide()).resolves.toEqual({
      allowed: true,
      scope: 'assigned-properties',
    })
  })

  it('serializes a grant revocation behind the protected authority transaction', async () => {
    let signalReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    let releaseAuthority: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseAuthority = resolve
    })

    const authorityTransaction = db.transaction(async (tx) => {
      const decision = await decideCurrentMemberPropertyAuthority(tx, {
        organizationId: ORG,
        propertyId: PROPERTY,
        userId: USER,
        permission: 'reply.manage',
        at: new Date(),
      })
      signalReady?.()
      await release
      return decision
    })

    await ready
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
          await tx.execute(sql`
            UPDATE property_access_grant
            SET revoked_at = now()
            WHERE organization_id = ${ORG}
              AND property_id = ${PROPERTY}::uuid
              AND user_id = ${USER}
              AND revoked_at IS NULL
          `)
        }),
      ).rejects.toMatchObject({ cause: { code: '55P03' } })
    } finally {
      releaseAuthority?.()
    }

    await expect(authorityTransaction).resolves.toEqual({
      allowed: true,
      scope: 'assigned-properties',
    })
  })

  it('denies when the permission generation changes during concrete-row locking', async () => {
    const mutator = await getPool().connect()
    let mutationOpen = false
    let authorityTransaction: ReturnType<typeof decide> | undefined

    try {
      await mutator.query('BEGIN')
      mutationOpen = true
      await mutator.query(
        `SELECT id
         FROM property_access_grant
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL
         FOR UPDATE`,
        [ORG, PROPERTY, USER],
      )

      authorityTransaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('application_name', ${VERSION_CHANGE_AUTHORITY_SESSION}, true)`,
        )
        return decideCurrentMemberPropertyAuthority(tx, {
          organizationId: ORG,
          propertyId: PROPERTY,
          userId: USER,
          permission: 'reply.manage',
          at: new Date(),
        })
      })
      void authorityTransaction.catch(() => undefined)
      await waitForSessionLock(VERSION_CHANGE_AUTHORITY_SESSION)

      await mutator.query(
        `UPDATE permission_version
         SET version = version + 1, updated_at = now()
         WHERE organization_id = $1`,
        [ORG],
      )
      await mutator.query('COMMIT')
      mutationOpen = false

      await expect(authorityTransaction).resolves.toEqual({
        allowed: false,
        reason: 'membership_denied',
      })
    } finally {
      if (mutationOpen) await mutator.query('ROLLBACK').catch(() => undefined)
      mutator.release()
      await authorityTransaction?.catch(() => undefined)
    }
  })

  it('lets a mutation holding the grant finish before the authority generation check', async () => {
    const mutator = await getPool().connect()
    let mutationOpen = false
    let authorityTransaction: ReturnType<typeof decide> | undefined

    try {
      await mutator.query('BEGIN')
      mutationOpen = true
      await mutator.query(
        `SELECT id
         FROM property_access_grant
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL
         FOR UPDATE`,
        [ORG, PROPERTY, USER],
      )

      authorityTransaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('application_name', ${MUTATION_FIRST_AUTHORITY_SESSION}, true)`,
        )
        return decideCurrentMemberPropertyAuthority(tx, {
          organizationId: ORG,
          propertyId: PROPERTY,
          userId: USER,
          permission: 'reply.manage',
          at: new Date(),
        })
      })
      void authorityTransaction.catch(() => undefined)
      await waitForSessionLock(MUTATION_FIRST_AUTHORITY_SESSION)

      await mutator.query(
        `UPDATE property_access_grant
         SET revoked_at = now()
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL`,
        [ORG, PROPERTY, USER],
      )
      await mutator.query('COMMIT')
      mutationOpen = false

      await expect(authorityTransaction).resolves.toEqual({
        allowed: false,
        reason: 'assignment_denied',
      })
    } finally {
      if (mutationOpen) await mutator.query('ROLLBACK').catch(() => undefined)
      mutator.release()
      await authorityTransaction?.catch(() => undefined)
    }
  })

  it('denies after the queued manager grant is revoked', async () => {
    await db.execute(sql`
      UPDATE property_access_grant
      SET revoked_at = now()
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND user_id = ${USER}
        AND revoked_at IS NULL
    `)

    await expect(decide()).resolves.toEqual({
      allowed: false,
      reason: 'assignment_denied',
    })
  })

  it('serializes a new grant behind an already-made denied authority decision', async () => {
    let signalReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    let releaseAuthority: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseAuthority = resolve
    })

    const authorityTransaction = db.transaction(async (tx) => {
      const decision = await decideCurrentMemberPropertyAuthority(tx, {
        organizationId: ORG,
        propertyId: PROPERTY,
        userId: USER,
        permission: 'reply.manage',
        at: new Date(),
      })
      signalReady?.()
      await release
      return decision
    })

    await ready
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`)
          await tx.execute(sql`
            INSERT INTO property_access_grant (
              organization_id, property_id, user_id, source, created_by
            ) VALUES (${ORG}, ${PROPERTY}::uuid, ${USER}, 'operator', 'race-test')
          `)
        }),
      ).rejects.toMatchObject({ cause: { code: '55P03' } })
    } finally {
      releaseAuthority?.()
    }

    await expect(authorityTransaction).resolves.toEqual({
      allowed: false,
      reason: 'assignment_denied',
    })
  })

  it('denies after the queued manager membership is removed', async () => {
    await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)

    await expect(decide()).resolves.toEqual({
      allowed: false,
      reason: 'membership_denied',
    })
  })
})
