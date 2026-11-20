// A guest's contact request once the capability is no longer dark. Launch
// posture is the one thing stood in for: the capability check lets
// `portal.guest_contact` through; the Portal, the signed session, the consent
// the policy requires and the sealed rows are the app's own.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErasureJournalBucket } from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'
import type { TestPublishedPortal } from '#/shared/testing/server-function-portal-seeds'
import {
  answerOf,
  guestCall,
  openVisit,
  portalBase,
  ratingData,
  refusalOf,
  type GuestVisit,
} from '#/shared/testing/server-function-guest-visitor'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
vi.mock('#/shared/auth/beta-capabilities', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('#/shared/auth/beta-capabilities')>()
  return {
    ...original,
    checkScopedCapability: (
      ...[scope, capability]: Parameters<typeof original.checkScopedCapability>
    ) =>
      capability === 'portal.guest_contact'
        ? ({ allowed: true, reason: 'allowed', capability } as const)
        : original.checkScopedCapability(scope, capability),
  }
})

import { submitGuestResponseFn, submitPrivateFeedbackFn } from './public'
import { getPublicPortal } from './guest-scans'
import { submitContactRequestFn, withdrawContactRequestFn } from './contact-requests'

const harness = setupServerFunctionHarness({
  env: {
    CONTACT_REQUESTS_ENABLED: 'true',
    CONTACT_REQUEST_ENCRYPTION_KEY: 'ab'.repeat(32),
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY: 'fake-key',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
    AWS_S3_BUCKET_NAME: 'private-bucket',
  },
  cleanupTables: [
    'guest_contact_requests',
    'guest_response_integrity_decisions',
    'guest_response_session_bindings',
    'guest_response_private_feedback',
    'guest_response_experience_snapshots',
    'guest_responses',
    'guest_network_pressure_records',
    ...PORTAL_SEED_CLEANUP_TABLES,
  ],
  afterPropertiesCleanup: async (client, { organizationIds }) => {
    await client.query(
      `DELETE FROM idempotency_receipts
        WHERE key LIKE ANY (SELECT '%' || id || '%' FROM unnest($1::text[]) AS id)`,
      [organizationIds],
    )
  },
})

const journalPut = vi.spyOn(ErasureJournalBucket.prototype, 'put')
beforeEach(() => {
  journalPut.mockReset().mockResolvedValue()
})
afterAll(() => journalPut.mockRestore())

const UNAVAILABLE = { status: 404, code: 'unavailable' }

/** A guest with a rating and a private note on a Portal whose page offers a contact request. */
async function guestWithNote(): Promise<{
  portal: TestPublishedPortal
  visit: GuestVisit
}> {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property)
  await harness.pool().query(
    `UPDATE portal_publication_snapshots
        SET contact_request_enabled = true,
            contact_notice_id = 'guest-contact-manager-follow-up',
            contact_notice_version = 'guest-contact-notice.v1',
            contact_notice_digest = $2, contact_notice_locale = 'en',
            contact_request_purpose = 'manager_follow_up',
            contact_retention_policy_version = 'guest-contact-retention-30d-v1'
      WHERE portal_id = $1`,
    [portal.id, 'b'.repeat(64)],
  )
  const visit = await openVisit(
    harness,
    (token) => getPublicPortal({ data: { token } }),
    portal.rawToken ?? '',
  )
  answerOf(await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal, 2)))
  answerOf(
    await guestCall(harness, visit, submitPrivateFeedbackFn, {
      ...portalBase(portal),
      text: 'Please call me',
      textConsent: true,
    }),
  )
  return { portal, visit }
}

const storedRequests = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query('SELECT status FROM guest_contact_requests WHERE portal_id = $1', [
        portal.id,
      ])
  ).rows

const contactData = (portal: TestPublishedPortal, consent: boolean) => ({
  ...portalBase(portal),
  email: 'guest@example.com',
  consent,
})

describe('submitContactRequestFn', () => {
  it('stores a request for a guest who consented to be contacted', async () => {
    const { portal, visit } = await guestWithNote()

    const submitted = await guestCall(
      harness,
      visit,
      submitContactRequestFn,
      contactData(portal, true),
    )

    expect(answerOf(submitted)).toEqual({ status: 'submitted' })
    expect(await storedRequests(portal)).toEqual([{ status: 'active' }])
  })

  it('answers a guest who did not consent like a missing request, and stores nothing', async () => {
    const { portal, visit } = await guestWithNote()

    const submitted = await guestCall(
      harness,
      visit,
      submitContactRequestFn,
      contactData(portal, false),
    )

    expect(refusalOf(submitted)).toMatchObject(UNAVAILABLE)
    expect(await storedRequests(portal)).toEqual([])
  })
})

describe('withdrawContactRequestFn', () => {
  it('withdraws the request while the response stays', async () => {
    const { portal, visit } = await guestWithNote()
    await guestCall(harness, visit, submitContactRequestFn, contactData(portal, true))

    const withdrawn = await guestCall(
      harness,
      visit,
      withdrawContactRequestFn,
      portalBase(portal),
    )

    expect(answerOf(withdrawn)).toEqual({ status: 'withdrawn' })
    expect(await storedRequests(portal)).toEqual([{ status: 'withdrawn' }])
    expect(journalPut).toHaveBeenCalledOnce()
  })
})
