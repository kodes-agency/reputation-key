import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createContactRequestEncryptionAdapter } from '../adapters/contact-request-encryption.adapter'
import { createContactRequestRepository } from './contact-request.repository'

const ORG_A = organizationId('ca000000-0000-4000-8000-000000000001')
const ORG_B = organizationId('ca000000-0000-4000-8000-000000000002')
const PROPERTY_A = 'ca000000-0000-4000-8000-000000000010'
const PORTAL_A = 'ca000000-0000-4000-8000-000000000020'
const RESPONSE_A = 'ca000000-0000-4000-8000-000000000030'
const REQUEST_A = 'ca000000-0000-4000-8000-000000000040'
const CREATOR = 'contact-creator'
const RESPONSIBLE_MANAGER = 'responsible-manager'
const UNASSIGNED_MANAGER = 'unassigned-manager'
const ACCOUNT_ADMIN = 'contact-account-admin'
const NOW = new Date('2026-08-26T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'guest_contact_request_reveal_audits',
    'guest_contact_requests',
    'portal_responsible_managers',
    'guest_responses',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  await getPool().query('DELETE FROM guest_contact_request_purge_checkpoints')
  await getPool().query(`DELETE FROM member WHERE "userId" = ANY($1)`, [
    [CREATOR, RESPONSIBLE_MANAGER, UNASSIGNED_MANAGER],
  ])
  await getPool().query(`DELETE FROM "user" WHERE id = ANY($1)`, [
    [CREATOR, RESPONSIBLE_MANAGER, UNASSIGNED_MANAGER],
  ])
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Contact Creator', 'contact-creator@example.test', true, NOW(), NOW())`,
    [CREATOR],
  )
  await getPool().query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ('contact-member-creator', $1, $2, 'admin', NOW())`,
    [CREATOR, ORG_A],
  )
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Contact Property', $3, 'UTC')`,
    [PROPERTY_A, ORG_A, `contact-property-${PROPERTY_A}`],
  )
  await getPool().query(
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by)
     VALUES ($1, $2, $3, 'operator', $3)`,
    [ORG_A, PROPERTY_A, CREATOR],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug, created_by)
     VALUES ($1::uuid, $2, $3::uuid, 'property', ($3::uuid)::text,
             'Contact Portal', $4, $5)`,
    [PORTAL_A, ORG_A, PROPERTY_A, `contact-portal-${PORTAL_A}`, CREATOR],
  )
  await getPool().query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, retention_deadline, submitted_at)
     VALUES ($1, $2, $3, $4, 'submitted', 3, true,
             NOW() + INTERVAL '24 months', $5)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, NOW],
  )
})

afterEach(async () => {
  await getPool().query(
    `DELETE FROM guest_contact_request_reveal_audits WHERE organization_id = $1`,
    [ORG_A],
  )
  await getPool().query(`DELETE FROM guest_contact_requests WHERE organization_id = $1`, [
    ORG_A,
  ])
  await getPool().query(
    `DELETE FROM portal_responsible_managers WHERE organization_id = $1`,
    [ORG_A],
  )
  await getPool().query(`DELETE FROM guest_responses WHERE organization_id = $1`, [ORG_A])
  await getPool().query(`DELETE FROM portals WHERE organization_id = $1`, [ORG_A])
  await getPool().query(`DELETE FROM properties WHERE organization_id = $1`, [ORG_A])
  await getPool().query('DELETE FROM guest_contact_request_purge_checkpoints')
})

const encryption = () =>
  createContactRequestEncryptionAdapter({
    activeKeyId: 'v1',
    keys: { v1: '44'.repeat(32) },
  })

const repository = () =>
  createContactRequestRepository(drizzle(getPool()) as unknown as Database, encryption())

async function seedMember(userId: string, role: 'owner' | 'admin'): Promise<void> {
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $1, $2, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [userId, `${userId}@example.test`],
  )
  await getPool().query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [`member-${userId}`, userId, ORG_A, role],
  )
  if (role === 'admin') {
    await getPool().query(
      `INSERT INTO property_access_grant
         (organization_id, property_id, user_id, source, created_by)
       VALUES ($1, $2, $3, 'operator', $4)
       ON CONFLICT DO NOTHING`,
      [ORG_A, PROPERTY_A, userId, CREATOR],
    )
  }
}

async function seedResponse(responseId: string, submittedAt: Date): Promise<void> {
  await getPool().query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, retention_deadline, submitted_at)
     VALUES ($1, $2, $3, $4, 'submitted', 3, true,
             $5::timestamptz + INTERVAL '24 months', $5::timestamptz)`,
    [responseId, ORG_A, PROPERTY_A, PORTAL_A, submittedAt],
  )
}

const createInput = () => ({
  id: REQUEST_A,
  scope: {
    organizationId: ORG_A as string,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
  },
  responseId: RESPONSE_A,
  purpose: 'manager_follow_up' as const,
  consent: true as const,
  email: 'guest@example.com',
  name: 'Guest Name',
  submittedAt: NOW,
  expiresAt: new Date('2026-09-25T09:00:00.000Z'),
})

describe('Contact Request repository', () => {
  it('stores contact separately in sealed form and ordinary reads stay masked', async () => {
    await expect(repository().create(createInput())).resolves.toEqual({
      outcome: 'created',
    })

    const persisted = await getPool().query<{
      encrypted_contact: string
      encryption_key_id: string
      consent_granted: boolean
      expires_at: Date
    }>(
      `SELECT encrypted_contact, encryption_key_id, consent_granted, expires_at
       FROM guest_contact_requests WHERE id = $1`,
      [REQUEST_A],
    )
    expect(persisted.rows[0]).toMatchObject({
      encryption_key_id: 'v1',
      consent_granted: true,
      expires_at: new Date('2026-09-25T09:00:00.000Z'),
    })
    expect(persisted.rows[0]?.encrypted_contact).not.toContain('guest@example.com')
    expect(persisted.rows[0]?.encrypted_contact).not.toContain('Guest Name')

    const masked = await repository().findMasked(createInput().scope, REQUEST_A, NOW)
    expect(masked).toEqual({
      id: REQUEST_A,
      scope: createInput().scope,
      responseId: RESPONSE_A,
      purpose: 'manager_follow_up',
      maskedContact: '••••••••',
      submittedAt: NOW,
      expiresAt: new Date('2026-09-25T09:00:00.000Z'),
    })
    expect(masked).not.toHaveProperty('email')
  })

  it('fails closed for inferred consent, duplicate responses, or mismatched source scope', async () => {
    await expect(
      getPool().query(
        `INSERT INTO guest_contact_requests
           (id, organization_id, property_id, portal_id, response_id, purpose,
            encrypted_contact, encryption_key_id, submitted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'manager_follow_up', 'opaque', 'v1',
                 $6, $6::timestamptz + INTERVAL '720:00:00')`,
        [REQUEST_A, ORG_A, PROPERTY_A, PORTAL_A, RESPONSE_A, NOW],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(repository().create(createInput())).resolves.toEqual({
      outcome: 'created',
    })
    await expect(
      repository().create({
        ...createInput(),
        id: 'ca000000-0000-4000-8000-000000000049',
      }),
    ).resolves.toEqual({ outcome: 'duplicate' })
    await expect(
      repository().create({
        ...createInput(),
        id: 'ca000000-0000-4000-8000-000000000048',
        scope: { ...createInput().scope, organizationId: ORG_B as string },
      }),
    ).resolves.toEqual({ outcome: 'source_unavailable' })
  })

  it('reveals only to the current portal creator, assigned managers, or AccountAdmin and audits each reveal without contact values', async () => {
    await seedMember(RESPONSIBLE_MANAGER, 'admin')
    await seedMember(UNASSIGNED_MANAGER, 'admin')
    await seedMember(ACCOUNT_ADMIN, 'owner')
    await getPool().query(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ORG_A, PROPERTY_A, PORTAL_A, RESPONSIBLE_MANAGER, NOW, CREATOR],
    )
    await repository().create(createInput())

    for (const actorId of [CREATOR, RESPONSIBLE_MANAGER, ACCOUNT_ADMIN]) {
      await expect(
        repository().reveal({
          scope: createInput().scope,
          contactRequestId: REQUEST_A,
          actorId,
          accessPurpose: 'respond_to_contact_request',
          at: NOW,
        }),
      ).resolves.toEqual({
        outcome: 'revealed',
        email: 'guest@example.com',
        name: 'Guest Name',
      })
    }
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        actorId: UNASSIGNED_MANAGER,
        accessPurpose: 'respond_to_contact_request',
        at: NOW,
      }),
    ).resolves.toEqual({ outcome: 'not_authorized' })

    const audits = await getPool().query<{
      actor_id: string
      authority_basis: string
      row_text: string
    }>(
      `SELECT actor_id, authority_basis, row_to_json(a)::text AS row_text
       FROM guest_contact_request_reveal_audits a
       WHERE organization_id = $1 AND contact_request_id = $2
       ORDER BY actor_id`,
      [ORG_A, REQUEST_A],
    )
    expect(
      audits.rows.map(({ actor_id, authority_basis }) => [actor_id, authority_basis]),
    ).toEqual([
      [ACCOUNT_ADMIN, 'account_admin'],
      [CREATOR, 'portal_creator'],
      [RESPONSIBLE_MANAGER, 'responsible_manager'],
    ])
    for (const audit of audits.rows) {
      expect(audit.row_text).not.toContain('guest@example.com')
      expect(audit.row_text).not.toContain('Guest Name')
    }
  })

  it('rechecks current responsibility and exact tenant, Property, and Portal scope at reveal time', async () => {
    await seedMember(RESPONSIBLE_MANAGER, 'admin')
    const assignment = await getPool().query<{ id: string }>(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ORG_A, PROPERTY_A, PORTAL_A, RESPONSIBLE_MANAGER, NOW, CREATOR],
    )
    await repository().create(createInput())
    await getPool().query(
      `UPDATE portal_responsible_managers
       SET effective_to = $1, end_reason = 'responsibility changed'
       WHERE id = $2`,
      [new Date(NOW.getTime() + 1), assignment.rows[0]!.id],
    )

    const afterRemoval = new Date(NOW.getTime() + 2)
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        actorId: RESPONSIBLE_MANAGER,
        accessPurpose: 'respond_to_contact_request',
        at: afterRemoval,
      }),
    ).resolves.toEqual({ outcome: 'not_authorized' })
    await expect(
      repository().reveal({
        scope: { ...createInput().scope, organizationId: ORG_B as string },
        contactRequestId: REQUEST_A,
        actorId: ACCOUNT_ADMIN,
        accessPurpose: 'respond_to_contact_request',
        at: NOW,
      }),
    ).resolves.toEqual({ outcome: 'not_found' })
    await expect(
      repository().reveal({
        scope: {
          ...createInput().scope,
          propertyId: 'cb000000-0000-4000-8000-000000000010',
        },
        contactRequestId: REQUEST_A,
        actorId: CREATOR,
        accessPurpose: 'respond_to_contact_request',
        at: NOW,
      }),
    ).resolves.toEqual({ outcome: 'not_found' })
  })

  it('denies a Portal creator or responsible manager after current Property access is revoked', async () => {
    await seedMember(RESPONSIBLE_MANAGER, 'admin')
    await getPool().query(
      `INSERT INTO portal_responsible_managers
         (organization_id, property_id, portal_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ORG_A, PROPERTY_A, PORTAL_A, RESPONSIBLE_MANAGER, NOW, CREATOR],
    )
    await repository().create(createInput())
    const revokedAt = new Date(NOW.getTime() + 1)
    await getPool().query(
      `UPDATE property_access_grant
       SET revoked_at = $1, revoke_reason = 'access removed'
       WHERE organization_id = $2 AND property_id = $3
         AND user_id = ANY($4) AND revoked_at IS NULL`,
      [revokedAt, ORG_A, PROPERTY_A, [CREATOR, RESPONSIBLE_MANAGER]],
    )

    for (const actorId of [CREATOR, RESPONSIBLE_MANAGER]) {
      await expect(
        repository().reveal({
          scope: createInput().scope,
          contactRequestId: REQUEST_A,
          actorId,
          accessPurpose: 'respond_to_contact_request',
          at: new Date(revokedAt.getTime() + 1),
        }),
      ).resolves.toEqual({ outcome: 'not_authorized' })
    }
  })

  it('withdraws atomically, clears the sealed value, and makes every later read unavailable', async () => {
    await repository().create(createInput())
    const withdrawnAt = new Date(NOW.getTime() + 1)

    await expect(
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        at: withdrawnAt,
      }),
    ).resolves.toEqual({ outcome: 'withdrawn' })
    await expect(
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        at: new Date(NOW.getTime() + 2),
      }),
    ).resolves.toEqual({ outcome: 'unavailable' })
    await expect(
      repository().findMasked(createInput().scope, REQUEST_A, withdrawnAt),
    ).resolves.toBeNull()
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        actorId: CREATOR,
        accessPurpose: 'respond_to_contact_request',
        at: withdrawnAt,
      }),
    ).resolves.toEqual({ outcome: 'unavailable' })

    const terminal = await getPool().query<{
      status: string
      consent_granted: boolean
      encrypted_contact: string | null
      withdrawn_at: Date
    }>(
      `SELECT status, consent_granted, encrypted_contact, withdrawn_at
       FROM guest_contact_requests WHERE id = $1`,
      [REQUEST_A],
    )
    expect(terminal.rows[0]).toEqual({
      status: 'withdrawn',
      consent_granted: false,
      encrypted_contact: null,
      withdrawn_at: withdrawnAt,
    })
  })

  it('serializes reveal against withdrawal so terminal contact can never reappear', async () => {
    await repository().create(createInput())
    const at = new Date(NOW.getTime() + 1)

    const [reveal, withdrawal] = await Promise.all([
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        actorId: CREATOR,
        accessPurpose: 'respond_to_contact_request',
        at,
      }),
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        at,
      }),
    ])

    expect(withdrawal).toEqual({ outcome: 'withdrawn' })
    expect(['revealed', 'unavailable']).toContain(reveal.outcome)
    const terminal = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(`SELECT status, encrypted_contact FROM guest_contact_requests WHERE id = $1`, [
      REQUEST_A,
    ])
    expect(terminal.rows[0]).toEqual({
      status: 'withdrawn',
      encrypted_contact: null,
    })
  })

  it('retires contact in the same transaction when the linked Guest Response is withdrawn', async () => {
    await repository().create(createInput())
    const withdrawnAt = new Date(NOW.getTime() + 1)

    await getPool().query(
      `UPDATE guest_responses
       SET status = 'deleted', deleted_at = $1, updated_at = $1
       WHERE organization_id = $2 AND id = $3`,
      [withdrawnAt, ORG_A, RESPONSE_A],
    )

    const terminal = await getPool().query<{
      status: string
      encrypted_contact: string | null
      withdrawn_at: Date
    }>(
      `SELECT status, encrypted_contact, withdrawn_at
       FROM guest_contact_requests WHERE id = $1`,
      [REQUEST_A],
    )
    expect(terminal.rows[0]).toEqual({
      status: 'withdrawn',
      encrypted_contact: null,
      withdrawn_at: withdrawnAt,
    })
  })

  it('denies expired reads before cleanup and advances a restart-safe bounded purge checkpoint', async () => {
    const submittedAt = new Date('2026-07-01T09:00:00.000Z')
    const secondResponse = 'ca000000-0000-4000-8000-000000000031'
    const secondRequest = 'ca000000-0000-4000-8000-000000000041'
    await getPool().query(`UPDATE guest_responses SET submitted_at = $1 WHERE id = $2`, [
      submittedAt,
      RESPONSE_A,
    ])
    await seedResponse(secondResponse, new Date(submittedAt.getTime() + 1))
    await repository().create({
      ...createInput(),
      submittedAt,
      expiresAt: new Date('2026-07-31T09:00:00.000Z'),
    })
    await repository().create({
      ...createInput(),
      id: secondRequest,
      responseId: secondResponse,
      submittedAt: new Date(submittedAt.getTime() + 1),
      expiresAt: new Date('2026-07-31T09:00:00.001Z'),
    })

    await expect(
      repository().findMasked(createInput().scope, REQUEST_A, NOW),
    ).resolves.toBeNull()
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        actorId: CREATOR,
        accessPurpose: 'respond_to_contact_request',
        at: NOW,
      }),
    ).resolves.toEqual({ outcome: 'unavailable' })

    const first = await repository().purgeExpired({ through: NOW, batchSize: 1 })
    const second = await repository().purgeExpired({ through: NOW, batchSize: 1 })
    const completed = await repository().purgeExpired({ through: NOW, batchSize: 1 })
    expect(first.processed).toBe(1)
    expect(second.processed).toBe(1)
    expect(completed).toMatchObject({ processed: 0, completedThrough: NOW })

    const rows = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(
      `SELECT status, encrypted_contact FROM guest_contact_requests
       WHERE id = ANY($1) ORDER BY id`,
      [[REQUEST_A, secondRequest]],
    )
    expect(rows.rows).toEqual([
      { status: 'expired', encrypted_contact: null },
      { status: 'expired', encrypted_contact: null },
    ])
    const checkpoint = await getPool().query<{
      processed_count: number
      completed_through: Date
    }>(
      `SELECT processed_count, completed_through
       FROM guest_contact_request_purge_checkpoints
       WHERE authority = 'guest-contact-30d-v1'`,
    )
    expect(checkpoint.rows[0]).toEqual({
      processed_count: 2,
      completed_through: NOW,
    })

    // A restored/backfilled older row cannot hide behind the saved cursor:
    // every run rechecks the authoritative active+expiry predicate.
    const lateResponse = 'ca000000-0000-4000-8000-000000000032'
    const lateRequest = 'ca000000-0000-4000-8000-000000000042'
    await seedResponse(lateResponse, new Date(submittedAt.getTime() + 2))
    await repository().create({
      ...createInput(),
      id: lateRequest,
      responseId: lateResponse,
      submittedAt: new Date(submittedAt.getTime() + 2),
      expiresAt: new Date('2026-07-31T09:00:00.002Z'),
    })
    await expect(
      repository().purgeExpired({ through: NOW, batchSize: 1 }),
    ).resolves.toMatchObject({ processed: 1 })
    const late = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(`SELECT status, encrypted_contact FROM guest_contact_requests WHERE id = $1`, [
      lateRequest,
    ])
    expect(late.rows[0]).toEqual({ status: 'expired', encrypted_contact: null })
  })
})
