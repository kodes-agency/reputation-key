import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createContactRequestEncryptionAdapter } from '../adapters/contact-request-encryption.adapter'
import {
  createContactRequestRepository,
  createContactRequestRetentionRepository,
} from './contact-request.repository'
import type { ContactRequestManagerAuthorityBasis } from '../../application/ports/contact-request-manager-authority.port'
import { contactRequestRetentionSweep } from '../../application/use-cases/contact-request-retention'
import {
  createRetentionSweepHandler,
  GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
} from '#/shared/jobs/retention-sweep.job'

const ORG_A = organizationId('ca000000-0000-4000-8000-000000000001')
const ORG_B = organizationId('ca000000-0000-4000-8000-000000000002')
const PROPERTY_A = 'ca000000-0000-4000-8000-000000000010'
const PORTAL_A = 'ca000000-0000-4000-8000-000000000020'
const RESPONSE_A = 'ca000000-0000-4000-8000-000000000030'
const REQUEST_A = 'ca000000-0000-4000-8000-000000000040'
const SNAPSHOT_A = 'ca000000-0000-4000-8000-000000000050'
const PUBLICATION_DIGEST = 'a'.repeat(64)
const NOTICE_ID = 'guest-contact-manager-follow-up'
const NOTICE_VERSION = 'guest-contact-notice-2026-08-26.v1'
const NOTICE_DIGEST = 'b'.repeat(64)
const RETENTION_POLICY_VERSION = 'guest-contact-retention-30d-v1'
const CREATOR = 'contact-creator'
const ACCOUNT_ADMIN = 'contact-account-admin'
const NOW = new Date('2026-08-26T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'guest_contact_request_reveal_audits',
    'guest_contact_requests',
    'guest_response_private_feedback',
    'guest_response_experience_snapshots',
    'guest_responses',
    'portal_publication_snapshots',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  await getPool().query(
    "DELETE FROM idempotency_receipts WHERE scope = 'guest_contact_purge'",
  )
  await getPool().query('DELETE FROM retention_runs WHERE subject = $1', [
    GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
  ])
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Contact Property', $3, 'UTC')`,
    [PROPERTY_A, ORG_A, `contact-property-${PROPERTY_A}`],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug, created_by)
     VALUES ($1::uuid, $2, $3::uuid, 'property', ($3::uuid)::text,
             'Contact Portal', $4, $5)`,
    [PORTAL_A, ORG_A, PROPERTY_A, `contact-portal-${PORTAL_A}`, CREATOR],
  )
  await getPool().query(
    `INSERT INTO portal_publication_snapshots
       (id, organization_id, property_id, portal_id, version,
        configuration_digest, configuration, guest_locale, language_pack_version,
        private_feedback_threshold, destination_uri, destination_retrieved_at,
        destination_source_epoch, destination_profile_version, created_by, created_at,
        contact_request_enabled, contact_notice_id, contact_notice_version,
        contact_notice_digest, contact_notice_locale, contact_request_purpose,
        contact_retention_policy_version)
     VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1',
             3, 'https://example.test/review', $6, 0, 1, $7, $6,
             true, $8, $9, $10, 'en', 'manager_follow_up', $11)`,
    [
      SNAPSHOT_A,
      ORG_A,
      PROPERTY_A,
      PORTAL_A,
      PUBLICATION_DIGEST,
      NOW,
      CREATOR,
      NOTICE_ID,
      NOTICE_VERSION,
      NOTICE_DIGEST,
      RETENTION_POLICY_VERSION,
    ],
  )
  await getPool().query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, feedback_source_event_id,
        feedback_submitted_at, retention_deadline, submitted_at)
     VALUES ($1, $2, $3, $4, 'submitted', 3, true, true, 'feedback-event-1',
             $5, NOW() + INTERVAL '24 months', $5)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, NOW],
  )
  await getPool().query(
    `INSERT INTO guest_response_experience_snapshots
       (response_id, organization_id, property_id, portal_id, publication_state,
        publication_snapshot_id, publication_version, publication_digest,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at)
     VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en',
             'guest-ui-en-v1', 3, $7)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, SNAPSHOT_A, PUBLICATION_DIGEST, NOW],
  )
  await getPool().query(
    `INSERT INTO guest_response_private_feedback
       (response_id, organization_id, property_id, portal_id, body,
        submitted_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'Please contact me', $5,
             $5::timestamptz + INTERVAL '90 days', $5)`,
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
    `DELETE FROM guest_response_private_feedback WHERE organization_id = $1`,
    [ORG_A],
  )
  await getPool().query(
    `DELETE FROM guest_response_experience_snapshots WHERE organization_id = $1`,
    [ORG_A],
  )
  await getPool().query(`DELETE FROM guest_responses WHERE organization_id = $1`, [ORG_A])
  await getPool().query(
    `DELETE FROM portal_publication_snapshots WHERE organization_id = $1`,
    [ORG_A],
  )
  await getPool().query(`DELETE FROM portals WHERE organization_id = $1`, [ORG_A])
  await getPool().query(`DELETE FROM properties WHERE organization_id = $1`, [ORG_A])
  await getPool().query(
    "DELETE FROM idempotency_receipts WHERE scope = 'guest_contact_purge'",
  )
  await getPool().query('DELETE FROM retention_runs WHERE subject = $1', [
    GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
  ])
})

const encryption = () =>
  createContactRequestEncryptionAdapter({
    activeKeyId: 'v1',
    keys: { v1: '44'.repeat(32) },
    generateIv: () => randomBytes(12),
  })

const repository = () =>
  createContactRequestRepository(drizzle(getPool()) as unknown as Database, encryption())

async function seedResponse(responseId: string, submittedAt: Date): Promise<void> {
  await getPool().query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, feedback_source_event_id,
        feedback_submitted_at, retention_deadline, submitted_at)
     VALUES ($1::uuid, $2, $3, $4, 'submitted', 3, true, true,
             $1::text || '-feedback',
             $5::timestamptz, $5::timestamptz + INTERVAL '24 months',
             $5::timestamptz)`,
    [responseId, ORG_A, PROPERTY_A, PORTAL_A, submittedAt],
  )
  await getPool().query(
    `INSERT INTO guest_response_experience_snapshots
       (response_id, organization_id, property_id, portal_id, publication_state,
        publication_snapshot_id, publication_version, publication_digest,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at)
     VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en',
             'guest-ui-en-v1', 3, $7)`,
    [
      responseId,
      ORG_A,
      PROPERTY_A,
      PORTAL_A,
      SNAPSHOT_A,
      PUBLICATION_DIGEST,
      submittedAt,
    ],
  )
  await getPool().query(
    `INSERT INTO guest_response_private_feedback
       (response_id, organization_id, property_id, portal_id, body,
        submitted_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'Please contact me', $5,
             $5::timestamptz + INTERVAL '90 days', $5)`,
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

const managerAuthorization = (
  actorId = CREATOR,
  basis: ContactRequestManagerAuthorityBasis = 'portal_creator',
  checkedAt = NOW,
) => ({ actorId, basis, checkedAt })

describe('Contact Request repository', () => {
  it('rejects a Contact Request when the response has no live submitted private feedback', async () => {
    await getPool().query(
      `DELETE FROM guest_response_private_feedback
       WHERE organization_id = $1 AND response_id = $2`,
      [ORG_A, RESPONSE_A],
    )
    await expect(repository().create(createInput())).resolves.toEqual({
      outcome: 'source_unavailable',
    })
  })

  it('stores contact separately in sealed form and ordinary reads stay masked', async () => {
    await expect(repository().create(createInput())).resolves.toEqual({
      outcome: 'created',
    })

    const persisted = await getPool().query<{
      encrypted_contact: string
      encryption_key_id: string
      consent_granted: boolean
      expires_at: Date
      publication_snapshot_id: string
      publication_version: number
      publication_digest: string
      notice_id: string
      notice_version: string
      notice_digest: string
      notice_locale: string
      retention_policy_version: string
    }>(
      `SELECT encrypted_contact, encryption_key_id, consent_granted, expires_at,
              publication_snapshot_id, publication_version, publication_digest,
              notice_id, notice_version, notice_digest, notice_locale,
              retention_policy_version
       FROM guest_contact_requests WHERE id = $1`,
      [REQUEST_A],
    )
    expect(persisted.rows[0]).toMatchObject({
      encryption_key_id: 'v1',
      consent_granted: true,
      expires_at: new Date('2026-09-25T09:00:00.000Z'),
      publication_snapshot_id: SNAPSHOT_A,
      publication_version: 1,
      publication_digest: PUBLICATION_DIGEST,
      notice_id: NOTICE_ID,
      notice_version: NOTICE_VERSION,
      notice_digest: NOTICE_DIGEST,
      notice_locale: 'en',
      retention_policy_version: RETENTION_POLICY_VERSION,
    })
    expect(persisted.rows[0]?.encrypted_contact).not.toContain('guest@example.com')
    expect(persisted.rows[0]?.encrypted_contact).not.toContain('Guest Name')

    const masked = await repository().findMasked({
      scope: createInput().scope,
      contactRequestId: REQUEST_A,
      authorization: managerAuthorization(),
      asOf: NOW,
    })
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
           (id, organization_id, property_id, portal_id, response_id,
            publication_snapshot_id, publication_version, publication_digest,
            contact_request_enabled, notice_id, notice_version, notice_digest,
            notice_locale, retention_policy_version, purpose,
            encrypted_contact, encryption_key_id, submitted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, true, $8, $9, $10, 'en',
                 $11, 'manager_follow_up', 'opaque', 'v1',
                 $12, $12::timestamptz + INTERVAL '720:00:00')`,
        [
          REQUEST_A,
          ORG_A,
          PROPERTY_A,
          PORTAL_A,
          RESPONSE_A,
          SNAPSHOT_A,
          PUBLICATION_DIGEST,
          NOTICE_ID,
          NOTICE_VERSION,
          NOTICE_DIGEST,
          RETENTION_POLICY_VERSION,
          NOW,
        ],
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

  it('persists each owning-context authority basis in the reveal audit without contact values', async () => {
    await repository().create(createInput())

    const authorities = [
      [ACCOUNT_ADMIN, 'account_admin'],
      [CREATOR, 'portal_creator'],
      ['responsible-manager', 'responsible_manager'],
    ] as const
    for (const [actorId, basis] of authorities) {
      await expect(
        repository().reveal({
          scope: createInput().scope,
          contactRequestId: REQUEST_A,
          authorization: managerAuthorization(actorId, basis),
          auditId: randomUUID(),
          accessPurpose: 'respond_to_contact_request',
          at: NOW,
        }),
      ).resolves.toEqual({
        outcome: 'revealed',
        email: 'guest@example.com',
        name: 'Guest Name',
      })
    }

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
      ['responsible-manager', 'responsible_manager'],
    ])
    for (const audit of audits.rows) {
      expect(audit.row_text).not.toContain('guest@example.com')
      expect(audit.row_text).not.toContain('Guest Name')
    }
  })

  it('requires fresh authority evidence and exact tenant, Property, and Portal scope at reveal time', async () => {
    await repository().create(createInput())

    const afterAuthorityCheck = new Date(NOW.getTime() + 1)
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(CREATOR, 'portal_creator', NOW),
        auditId: randomUUID(),
        accessPurpose: 'respond_to_contact_request',
        at: afterAuthorityCheck,
      }),
    ).resolves.toEqual({ outcome: 'not_authorized' })
    await expect(
      repository().reveal({
        scope: { ...createInput().scope, organizationId: ORG_B as string },
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(ACCOUNT_ADMIN, 'account_admin'),
        auditId: randomUUID(),
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
        authorization: managerAuthorization(),
        auditId: randomUUID(),
        accessPurpose: 'respond_to_contact_request',
        at: NOW,
      }),
    ).resolves.toEqual({ outcome: 'not_found' })
  })

  it('withdraws atomically, clears the sealed value, and makes every later read unavailable', async () => {
    await repository().create(createInput())
    const withdrawnAt = new Date(NOW.getTime() + 1)

    await expect(
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        responseId: RESPONSE_A,
        at: withdrawnAt,
      }),
    ).resolves.toEqual({ outcome: 'withdrawn' })
    await expect(
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        responseId: RESPONSE_A,
        at: new Date(NOW.getTime() + 2),
      }),
    ).resolves.toEqual({ outcome: 'unavailable' })
    await expect(
      repository().findMasked({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(CREATOR, 'portal_creator', withdrawnAt),
        asOf: withdrawnAt,
      }),
    ).resolves.toBeNull()
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(CREATOR, 'portal_creator', withdrawnAt),
        auditId: randomUUID(),
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
        authorization: managerAuthorization(CREATOR, 'portal_creator', at),
        auditId: randomUUID(),
        accessPurpose: 'respond_to_contact_request',
        at,
      }),
      repository().withdraw({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        responseId: RESPONSE_A,
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

  it('retires contact in the same transaction when private feedback is withdrawn', async () => {
    await repository().create(createInput())
    const withdrawnAt = new Date(NOW.getTime() + 1)

    await getPool().query(
      `UPDATE guest_responses
       SET text_consent = false, feedback_source_event_id = NULL,
           feedback_withdrawn_at = $1, updated_at = $1
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
      repository().findMasked({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(),
        asOf: NOW,
      }),
    ).resolves.toBeNull()
    await expect(
      repository().reveal({
        scope: createInput().scope,
        contactRequestId: REQUEST_A,
        authorization: managerAuthorization(),
        auditId: randomUUID(),
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
      `SELECT
         (payload->>'processedCount')::int AS processed_count,
         (payload->>'completedThrough')::timestamptz AS completed_through
       FROM idempotency_receipts
       WHERE scope = 'guest_contact_purge' AND key = 'guest-contact-30d-v1'`,
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

  it('runs the inactive capability cleanup through the scheduled retention evidence seam', async () => {
    const submittedAt = new Date('2026-07-01T09:00:00.000Z')
    await getPool().query(`UPDATE guest_responses SET submitted_at = $1 WHERE id = $2`, [
      submittedAt,
      RESPONSE_A,
    ])
    await repository().create({
      ...createInput(),
      submittedAt,
      expiresAt: new Date('2026-07-31T09:00:00.000Z'),
    })
    const db = drizzle(getPool()) as unknown as Database
    const guestContactRequestRetentionSweep = contactRequestRetentionSweep({
      repo: createContactRequestRetentionRepository(db),
      clock: () => NOW,
    })
    const handler = createRetentionSweepHandler({
      db,
      clock: () => NOW,
      rules: [],
      batchSize: 10,
      guestContactRequestRetentionSweep,
    })

    await handler({} as never)

    const request = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(`SELECT status, encrypted_contact FROM guest_contact_requests WHERE id = $1`, [
      REQUEST_A,
    ])
    expect(request.rows[0]).toEqual({ status: 'expired', encrypted_contact: null })
    const evidence = await getPool().query<{
      outcome: string
      batches: number
      rows_deleted: number
      rows_redacted: number
      batch_size: number
    }>(
      `SELECT outcome, batches, rows_deleted, rows_redacted, batch_size
       FROM retention_runs WHERE subject = $1 ORDER BY started_at DESC LIMIT 1`,
      [GUEST_CONTACT_REQUEST_RETENTION_SUBJECT],
    )
    expect(evidence.rows[0]).toEqual({
      outcome: 'completed',
      batches: 1,
      rows_deleted: 0,
      rows_redacted: 1,
      batch_size: 10,
    })
  })
})
