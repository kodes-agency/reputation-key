// The manager endpoints for contact requests, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and the
// manager's authority over the Portal.

import { createInMemoryWithdrawalJournal } from '../responses/guest-withdrawal-journal.test-fixtures'
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import {
  setupServerFunctionHarness,
  type ServerFunctionHarness,
} from '#/shared/testing/server-function-harness'
import { createContactRequestEncryption } from '../contact-requests/contact-request-encryption.server'
import { createContactRequestRepository } from '../contact-requests/contact-request.repository.server'
import type { ContactRequestScope } from '../contact-requests/contracts'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getContactRequestFn, revealContactRequestFn } from './contact-requests'

const KEY = 'ab'.repeat(32)
const DIGEST = 'a'.repeat(64)
const GUEST_EMAIL = 'guest@example.com'

const harness = setupServerFunctionHarness({
  env: { CONTACT_REQUESTS_ENABLED: 'true', CONTACT_REQUEST_ENCRYPTION_KEY: KEY },
  cleanupTables: [
    'guest_contact_request_reveal_audits',
    'guest_contact_requests',
    'guest_response_private_feedback',
    'guest_response_experience_snapshots',
    'guest_responses',
    'portal_publication_snapshots',
    'portal_responsible_managers',
  ],
})

type Hotel = Awaited<ReturnType<typeof hotel>>

async function seedResponse(
  pool: ReturnType<ServerFunctionHarness['pool']>,
  scope: ContactRequestScope,
): Promise<string> {
  const responseId = randomUUID()
  const snapshotId = randomUUID()
  const now = new Date()
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
             true, 'guest-contact-manager-follow-up', 'guest-contact-notice.v1', $7,
             'en', 'manager_follow_up', 'guest-contact-retention-30d-v1')`,
    [
      snapshotId,
      scope.organizationId,
      scope.propertyId,
      scope.portalId,
      DIGEST,
      now,
      'b'.repeat(64),
    ],
  )
  await pool.query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, rating,
        response_consent, text_consent, feedback_source_event_id,
        feedback_submitted_at, retention_deadline, submitted_at)
     VALUES ($1, $2, $3, $4, 'submitted', 3, true, true, $6,
             $5, NOW() + INTERVAL '24 months', $5)`,
    [
      responseId,
      scope.organizationId,
      scope.propertyId,
      scope.portalId,
      now,
      randomUUID(),
    ],
  )
  await pool.query(
    `INSERT INTO guest_response_experience_snapshots
       (response_id, organization_id, property_id, portal_id, publication_state,
        publication_snapshot_id, publication_version, publication_digest,
        configuration_digest, guest_locale, language_pack_version,
        private_feedback_threshold, captured_at)
     VALUES ($1, $2, $3, $4, 'published', $5, 1, $6, $6, 'en',
             'guest-ui-en-v1', 3, $7)`,
    [
      responseId,
      scope.organizationId,
      scope.propertyId,
      scope.portalId,
      snapshotId,
      DIGEST,
      now,
    ],
  )
  await pool.query(
    `INSERT INTO guest_response_private_feedback
       (response_id, organization_id, property_id, portal_id, body,
        submitted_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'Please contact me', $5,
             $5::timestamptz + INTERVAL '90 days', $5)`,
    [responseId, scope.organizationId, scope.propertyId, scope.portalId, now],
  )
  return responseId
}

/** A Portal with a guest's private feedback and a sealed contact request on it. */
async function hotel(portalCreator?: string) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const portal = await harness.seedPortal(property, {
    createdBy: portalCreator === 'manager' ? manager.userId : 'someone-who-left',
  })
  const scope: ContactRequestScope = {
    organizationId: organization.id,
    propertyId: property.id,
    portalId: portal.id,
  }
  const responseId = await seedResponse(harness.pool(), scope)
  const contactRequestId = randomUUID()
  const now = new Date()
  const repository = createContactRequestRepository(
    getDb(),
    createContactRequestEncryption({
      activeKeyId: 'v1',
      keys: { v1: KEY },
      generateIv: () => randomBytes(12),
    }),
    createInMemoryWithdrawalJournal(),
  )
  const created = await repository.create({
    id: contactRequestId,
    scope,
    responseId,
    purpose: 'manager_follow_up',
    consent: true,
    email: GUEST_EMAIL,
    name: 'Guest Name',
    submittedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  })
  expect(created.outcome).toBe('created')
  return { organization, admin, manager, property, portal, responseId, contactRequestId }
}

const revealData = (h: Hotel, contactRequestId = h.contactRequestId) => ({
  propertyId: h.property.id,
  portalId: h.portal.id,
  contactRequestId,
})
const getData = (h: Hotel, responseId = h.responseId) => ({
  propertyId: h.property.id,
  portalId: h.portal.id,
  responseId,
})

const audits = async (h: Hotel) =>
  (
    await harness.pool().query(
      `SELECT actor_id, access_purpose, authority_basis
         FROM guest_contact_request_reveal_audits WHERE organization_id = $1`,
      [h.organization.id],
    )
  ).rows

const UNAVAILABLE = { status: 404, code: 'unavailable' }

// Contact requests stay dark: the `portal.guest_contact` capability is blocked
// by posture, so even with the switch on the policy withholds what a request
// holds. The use-case behaviour (masked read, reveal and its audit basis) is
// asserted in contact-request-lifecycle.server.integration.test.ts.
describe('getContactRequestFn', () => {
  it.each(['AccountAdmin', 'creator'] as const)(
    'answers %s as unavailable although a request exists, and shows no contact',
    async (who) => {
      const h = await hotel(who === 'creator' ? 'manager' : undefined)
      const caller = who === 'creator' ? h.manager : h.admin

      const error = await harness
        .callAs(caller, () => getContactRequestFn({ data: getData(h) }))
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject(UNAVAILABLE)
      expect(JSON.stringify(error)).not.toContain(GUEST_EMAIL)
    },
  )

  it('answers a response with no contact request like any missing request', async () => {
    const h = await hotel()

    await expect(
      harness.callAs(h.admin, () =>
        getContactRequestFn({ data: getData(h, randomUUID()) }),
      ),
    ).rejects.toMatchObject(UNAVAILABLE)
  })

  it('refuses a Member', async () => {
    const h = await hotel()
    const member = await harness.seedMember(h.organization, 'Member')

    await expect(
      harness.callAs(member, () => getContactRequestFn({ data: getData(h) })),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('answers an AccountAdmin of another Organization as unavailable', async () => {
    const h = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => getContactRequestFn({ data: getData(h) })),
    ).rejects.toMatchObject(UNAVAILABLE)
  })

  it('refuses a caller with no session', async () => {
    const h = await hotel()

    await expect(
      harness.callAs(null, () => getContactRequestFn({ data: getData(h) })),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a malformed request', async () => {
    const h = await hotel()

    await expect(
      harness.callAs(h.admin, () =>
        getContactRequestFn({ data: { ...getData(h), responseId: 'not-a-uuid' } }),
      ),
    ).rejects.toThrow(/responseId/)
  })
})

describe('revealContactRequestFn', () => {
  it.each(['AccountAdmin', 'PropertyManager', 'Member'] as const)(
    'refuses %s by capability and writes no audit row',
    async (role) => {
      const h = await hotel('manager')
      const caller =
        role === 'AccountAdmin'
          ? h.admin
          : role === 'PropertyManager'
            ? h.manager
            : await harness.seedMember(h.organization, 'Member')

      const error = await harness
        .callAs(caller, () => revealContactRequestFn({ data: revealData(h) }))
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({ status: 403 })
      expect(JSON.stringify(error)).not.toContain(GUEST_EMAIL)
      expect(await audits(h)).toEqual([])
    },
  )

  it('refuses an AccountAdmin of another Organization and writes no audit row', async () => {
    const h = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => revealContactRequestFn({ data: revealData(h) })),
    ).rejects.toMatchObject({ status: 403 })
    expect(await audits(h)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    const h = await hotel()

    await expect(
      harness.callAs(null, () => revealContactRequestFn({ data: revealData(h) })),
    ).rejects.toMatchObject({ status: 401 })
  })
})
