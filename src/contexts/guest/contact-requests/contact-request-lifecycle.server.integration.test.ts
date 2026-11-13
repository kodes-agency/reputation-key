import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  contactRequestLifecycle,
  contactRequestRetentionSweep,
} from './contact-request-lifecycle.server'
import { createContactRequestEncryption } from './contact-request-encryption.server'
import {
  createContactRequestRepository,
  createContactRequestRetentionRepository,
} from './contact-request.repository.server'
import type {
  ContactRequestManagerAuthorityBasis,
  ContactRequestScope,
} from './contracts'
import { CONTACT_REQUEST_RETENTION_MS } from './contracts'

const ORG_A = organizationId('cb000000-0000-4000-8000-000000000001')
const ORG_B = organizationId('cb000000-0000-4000-8000-000000000002')
const PROPERTY_A = 'cb000000-0000-4000-8000-000000000010'
const PORTAL_A = 'cb000000-0000-4000-8000-000000000020'
const PORTAL_OTHER = 'cb000000-0000-4000-8000-000000000021'
const RESPONSE_A = 'cb000000-0000-4000-8000-000000000030'
const SNAPSHOT_A = 'cb000000-0000-4000-8000-000000000050'
const DIGEST = 'a'.repeat(64)
const GUEST_COOKIE = 'rk_guest_session=valid'
const GUEST = { signedSession: GUEST_COOKIE, csrfNonce: randomUUID() }
const NOW = new Date('2026-08-26T09:00:00.000Z')
const SCOPE: ContactRequestScope = {
  organizationId: ORG_A,
  propertyId: PROPERTY_A,
  portalId: PORTAL_A,
}

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

const manager = (userId: string): AuthContext =>
  ({ userId, organizationId: ORG_A, role: 'PropertyManager' }) as unknown as AuthContext

async function seed(options: { contactEnabled: boolean }) {
  const pool = getPool()
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Contact Property', $3, 'UTC')`,
    [PROPERTY_A, ORG_A, `contact-property-${PROPERTY_A}`],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug, created_by)
     VALUES ($1::uuid, $2, $3::uuid, 'property', ($3::uuid)::text, 'Contact Portal', $4, 'creator')`,
    [PORTAL_A, ORG_A, PROPERTY_A, `contact-portal-${PORTAL_A}`],
  )
  await pool.query(
    `INSERT INTO portal_publication_snapshots
       (id, organization_id, property_id, portal_id, version,
        configuration_digest, configuration, guest_locale, language_pack_version,
        private_feedback_threshold, destination_uri, destination_retrieved_at,
        destination_source_epoch, destination_profile_version, created_by, created_at,
        contact_request_enabled, contact_notice_id, contact_notice_version,
        contact_notice_digest, contact_notice_locale, contact_request_purpose,
        contact_retention_policy_version)
     VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1',
             3, 'https://example.test/review', $6, 0, 1, 'creator', $6,
             $7, $8, $9, $10, $11, 'manager_follow_up', 'guest-contact-retention-30d-v1')`,
    [
      SNAPSHOT_A,
      ORG_A,
      PROPERTY_A,
      PORTAL_A,
      DIGEST,
      NOW,
      options.contactEnabled,
      options.contactEnabled ? 'guest-contact-manager-follow-up' : null,
      options.contactEnabled ? 'guest-contact-notice.v1' : null,
      options.contactEnabled ? 'b'.repeat(64) : null,
      options.contactEnabled ? 'en' : null,
    ],
  )
  await pool.query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, feedback_source_event_id,
        feedback_submitted_at, retention_deadline, submitted_at)
     VALUES ($1, $2, $3, $4, 'submitted', 3, true, true, 'feedback-event-1',
             $5, NOW() + INTERVAL '24 months', $5)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, NOW],
  )
  await pool.query(
    `INSERT INTO guest_response_experience_snapshots
       (response_id, organization_id, property_id, portal_id, publication_state,
        publication_snapshot_id, publication_version, publication_digest,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at)
     VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en',
             'guest-ui-en-v1', 3, $7)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, SNAPSHOT_A, DIGEST, NOW],
  )
  await pool.query(
    `INSERT INTO guest_response_private_feedback
       (response_id, organization_id, property_id, portal_id, body,
        submitted_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'Please contact me', $5,
             $5::timestamptz + INTERVAL '90 days', $5)`,
    [RESPONSE_A, ORG_A, PROPERTY_A, PORTAL_A, NOW],
  )
}

async function clean() {
  const pool = getPool()
  for (const table of [
    'guest_contact_request_reveal_audits',
    'guest_contact_requests',
    'guest_response_private_feedback',
    'guest_response_experience_snapshots',
    'guest_responses',
    'portal_publication_snapshots',
    'portals',
    'properties',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG_A])
  }
  await pool.query("DELETE FROM idempotency_receipts WHERE scope = 'guest_contact_purge'")
}

afterEach(clean)

type Setup = Readonly<{
  enabled?: boolean
  managerBasis?: Readonly<Record<string, ContactRequestManagerAuthorityBasis>>
  deniedActions?: ReadonlyArray<string>
  guestCookie?: string
  keys?: Readonly<{ activeKeyId: string; keys: Record<string, string> }>
}>

const KEY = '44'.repeat(32)

function build(setup: Setup = {}) {
  const clock = { now: NOW }
  const db = drizzle(getPool()) as unknown as Database
  const encryption = createContactRequestEncryption({
    ...(setup.keys ?? { activeKeyId: 'v1', keys: { v1: KEY } }),
    generateIv: () => randomBytes(12),
  })
  const repo = createContactRequestRepository(db, encryption)
  const commands = contactRequestLifecycle({
    repo,
    policy: {
      decide: async (request) => ({
        allowed: !(setup.deniedActions ?? []).includes(String(request.action)),
        reason: 'allowed',
        action: String(request.action),
        policyVersion: 'test',
      }),
    },
    managerAuthority: {
      resolve: async ({ scope, actorId }) =>
        scope.organizationId === ORG_A
          ? ((setup.managerBasis ?? { 'manager-1': 'portal_creator' })[actorId] ?? null)
          : null,
    },
    responseAuthority: {
      authorize: async ({ authority, scope }) =>
        authority.signedSession === (setup.guestCookie ?? GUEST_COOKIE) &&
        scope.organizationId === ORG_A
          ? RESPONSE_A
          : null,
    },
    isEnabled: () => setup.enabled ?? true,
    clock: () => clock.now,
    idGen: randomUUID,
    revealAuditIdGen: randomUUID,
  })
  const sweep = contactRequestRetentionSweep({
    repo: createContactRequestRetentionRepository(db),
    clock: () => clock.now,
  })
  return { clock, commands, sweep }
}

const submitInput = (extra: Record<string, unknown> = {}) => ({
  ...SCOPE,
  email: 'guest@example.com',
  name: 'Guest Name',
  consent: true,
  purpose: 'manager_follow_up' as const,
  authority: GUEST,
  ...extra,
})

const rowCount = async (table: string) =>
  Number(
    (
      await getPool().query(
        `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
        [ORG_A],
      )
    ).rows[0].n,
  )

describe('contact requests through the public commands', () => {
  beforeEach(async () => {
    await clean()
    await seed({ contactEnabled: true })
  })

  it('stores the details sealed, shows them masked, and reveals them with an audit row', async () => {
    const { commands } = build()
    await expect(commands.submit(submitInput())).resolves.toEqual({ status: 'submitted' })

    const stored = await getPool().query<{ encrypted_contact: string }>(
      'SELECT encrypted_contact FROM guest_contact_requests WHERE organization_id = $1',
      [ORG_A],
    )
    expect(stored.rows[0]?.encrypted_contact).not.toContain('guest@example.com')

    const masked = await commands.getMasked(
      { ...SCOPE, responseId: RESPONSE_A },
      manager('manager-1'),
    )
    expect(masked).toMatchObject({ responseId: RESPONSE_A, maskedContact: '••••••••' })
    expect(JSON.stringify(masked)).not.toContain('guest@example.com')

    await expect(
      commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).resolves.toEqual({ email: 'guest@example.com', name: 'Guest Name' })

    const audits = await getPool().query(
      `SELECT actor_id, access_purpose, authority_basis
       FROM guest_contact_request_reveal_audits WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(audits.rows).toEqual([
      {
        actor_id: 'manager-1',
        access_purpose: 'respond_to_contact_request',
        authority_basis: 'portal_creator',
      },
    ])
    expect(JSON.stringify(audits.rows)).not.toContain('guest@example.com')
  })

  it.each([
    ['no consent', { consent: undefined }, 'consent_required'],
    ['consent false', { consent: false }, 'consent_required'],
    ['no purpose', { purpose: undefined }, 'purpose_required'],
    ['a purpose outside the approved one', { purpose: 'marketing' }, 'invalid_purpose'],
    ['an invalid email', { email: 'not-an-email' }, 'invalid_contact'],
  ])('refuses a submission with %s and stores nothing', async (_name, extra, code) => {
    const { commands } = build()
    await expect(commands.submit(submitInput(extra))).rejects.toMatchObject({ code })
    expect(await rowCount('guest_contact_requests')).toBe(0)
  })

  it('refuses a guest whose session does not hold the response, before reading the form', async () => {
    const { commands } = build({ guestCookie: 'rk_guest_session=someone-else' })
    await expect(commands.submit(submitInput({ consent: false }))).rejects.toMatchObject({
      code: 'not_authorized',
    })
    expect(await rowCount('guest_contact_requests')).toBe(0)
  })

  it('refuses a second request for the same response', async () => {
    const { commands } = build()
    await commands.submit(submitInput())
    await expect(commands.submit(submitInput())).rejects.toMatchObject({
      code: 'duplicate',
    })
  })

  it('refuses a Portal whose published snapshot has no contact notice', async () => {
    await clean()
    await seed({ contactEnabled: false })
    const { commands } = build()
    await expect(commands.submit(submitInput())).rejects.toMatchObject({
      code: 'contact_disabled',
    })
    expect(await rowCount('guest_contact_requests')).toBe(0)
  })

  it('refuses every manager who lacks current authority, the permission, or the exact scope', async () => {
    const { commands } = build({ deniedActions: ['feedback.contact_read'] })
    await commands.submit(submitInput())
    const masked = await commands.getMasked(
      { ...SCOPE, responseId: RESPONSE_A },
      manager('manager-1'),
    )
    const reveal = (scope: ContactRequestScope, actor: string) =>
      commands.reveal(
        {
          ...scope,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager(actor),
      )

    // Permission denied for feedback.contact_read.
    await expect(reveal(SCOPE, 'manager-1')).rejects.toMatchObject({
      code: 'not_authorized',
    })

    const open = build()
    await expect(
      open.commands.getMasked({ ...SCOPE, responseId: RESPONSE_A }, manager('stranger')),
    ).rejects.toMatchObject({ code: 'not_authorized' })
    await expect(
      open.commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('stranger'),
      ),
    ).rejects.toMatchObject({ code: 'not_authorized' })
    await expect(
      open.commands.reveal(
        {
          ...SCOPE,
          portalId: PORTAL_OTHER,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      open.commands.reveal(
        { ...SCOPE, contactRequestId: masked!.id },
        manager('manager-1'),
      ),
    ).rejects.toMatchObject({ code: 'access_purpose_required' })
    expect(await rowCount('guest_contact_request_reveal_audits')).toBe(0)
  })

  it('answers nothing while the launch switch is off, yet still lets the guest withdraw', async () => {
    const on = build()
    await on.commands.submit(submitInput())

    const off = build({ enabled: false })
    await expect(off.commands.submit(submitInput())).rejects.toMatchObject({
      code: 'contact_disabled',
    })
    await expect(
      off.commands.getMasked({ ...SCOPE, responseId: RESPONSE_A }, manager('manager-1')),
    ).rejects.toMatchObject({ code: 'contact_disabled' })
    await expect(off.commands.withdraw({ ...SCOPE, authority: GUEST })).resolves.toEqual({
      status: 'withdrawn',
    })
  })

  it('withdraws by the guest alone: clears the sealed value and ends every later read', async () => {
    const { commands } = build()
    await commands.submit(submitInput())
    const masked = await commands.getMasked(
      { ...SCOPE, responseId: RESPONSE_A },
      manager('manager-1'),
    )

    await expect(commands.withdraw({ ...SCOPE, authority: GUEST })).resolves.toEqual({
      status: 'withdrawn',
    })

    const stored = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(
      'SELECT status, encrypted_contact FROM guest_contact_requests WHERE organization_id = $1',
      [ORG_A],
    )
    expect(stored.rows[0]).toEqual({ status: 'withdrawn', encrypted_contact: null })
    await expect(commands.withdraw({ ...SCOPE, authority: GUEST })).rejects.toMatchObject(
      {
        code: 'unavailable',
      },
    )
    await expect(
      commands.getMasked({ ...SCOPE, responseId: RESPONSE_A }, manager('manager-1')),
    ).resolves.toBeNull()
    await expect(
      commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('denies a withdrawal from a session that does not hold the response', async () => {
    const { commands } = build()
    await commands.submit(submitInput())
    await expect(
      commands.withdraw({
        ...SCOPE,
        authority: {
          signedSession: 'rk_guest_session=forged',
          csrfNonce: GUEST.csrfNonce,
        },
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' })
    const stored = await getPool().query<{ status: string }>(
      'SELECT status FROM guest_contact_requests WHERE organization_id = $1',
      [ORG_A],
    )
    expect(stored.rows[0]?.status).toBe('active')
  })

  it('stops showing the details at 30 days and the sweep then erases them', async () => {
    const { clock, commands, sweep } = build()
    await commands.submit(submitInput())
    const masked = await commands.getMasked(
      { ...SCOPE, responseId: RESPONSE_A },
      manager('manager-1'),
    )
    const expiry = new Date(NOW.getTime() + CONTACT_REQUEST_RETENTION_MS)
    expect(masked?.expiresAt).toBe(expiry.toISOString())

    clock.now = new Date(expiry.getTime() - 1)
    await expect(
      commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).resolves.toMatchObject({ email: 'guest@example.com' })

    clock.now = expiry
    await expect(
      commands.getMasked({ ...SCOPE, responseId: RESPONSE_A }, manager('manager-1')),
    ).resolves.toBeNull()
    await expect(
      commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })

    const before = await getPool().query<{
      status: string
      encrypted_contact: string | null
    }>(
      'SELECT status, encrypted_contact FROM guest_contact_requests WHERE organization_id = $1',
      [ORG_A],
    )
    expect(before.rows[0]?.status).toBe('active')
    expect(before.rows[0]?.encrypted_contact).not.toBeNull()

    await expect(sweep({ batchSize: 10 })).resolves.toMatchObject({
      processed: 1,
      capped: false,
    })
    const after = await getPool().query<{
      status: string
      encrypted_contact: string | null
      purged_at: Date | null
    }>(
      'SELECT status, encrypted_contact, purged_at FROM guest_contact_requests WHERE organization_id = $1',
      [ORG_A],
    )
    expect(after.rows[0]).toEqual({
      status: 'expired',
      encrypted_contact: null,
      purged_at: expiry,
    })
    await expect(sweep({ batchSize: 10 })).resolves.toMatchObject({ processed: 0 })
  })

  it('refuses a purge batch outside its bounds', async () => {
    const { commands, sweep } = build()
    await expect(commands.purgeExpired({ batchSize: 0 })).rejects.toMatchObject({
      code: 'invalid_batch_size',
    })
    await expect(commands.purgeExpired({ batchSize: 1_001 })).rejects.toMatchObject({
      code: 'invalid_batch_size',
    })
    await expect(sweep({ batchSize: 0 })).rejects.toThrow('retention bounds')
  })

  it('writes no audit row and shows nothing when the sealed value cannot be opened', async () => {
    const { commands } = build()
    await commands.submit(submitInput())
    const masked = await commands.getMasked(
      { ...SCOPE, responseId: RESPONSE_A },
      manager('manager-1'),
    )

    const rotatedAway = build({
      keys: { activeKeyId: 'v2', keys: { v2: '55'.repeat(32) } },
    })
    await expect(
      rotatedAway.commands.reveal(
        {
          ...SCOPE,
          contactRequestId: masked!.id,
          accessPurpose: 'respond_to_contact_request',
        },
        manager('manager-1'),
      ),
    ).rejects.toThrow('Contact Request data is unavailable')
    expect(await rowCount('guest_contact_request_reveal_audits')).toBe(0)
  })
})
