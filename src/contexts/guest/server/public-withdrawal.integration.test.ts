// A guest's withdrawals over PostgreSQL and the test Redis: the response, the
// private note and the contact request, each journalled before the deletion. The
// bucket the journal writes to is the only fake; the rows, the session cookie and
// the budgets are the app's own.

import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { ErasureJournalBucket } from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import {
  PORTAL_SEED_CLEANUP_TABLES,
  type TestPublishedPortal,
} from '#/shared/testing/server-function-portal-seeds'
import type { CallRequest } from '#/shared/testing/server-function-harness'
import {
  answerOf,
  guestCall,
  openVisit,
  portalBase,
  ratingData,
  refusalOf,
  venueAddress,
  visitAfter,
  type GuestVisit,
} from '#/shared/testing/server-function-guest-visitor'
import { createContactRequestEncryption } from '../contact-requests/contact-request-encryption.server'
import { createContactRequestRepository } from '../contact-requests/contact-request.repository.server'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  correctGuestResponseFn,
  startNewGuestResponseFn,
  submitGuestResponseFn,
  submitPrivateFeedbackFn,
  withdrawGuestResponseFn,
  withdrawPrivateFeedbackFn,
} from './public'
import { getPublicPortal } from './guest-scans'
import { withdrawContactRequestFn } from './contact-requests'

const KEY = 'ab'.repeat(32)

const harness = setupServerFunctionHarness({
  env: {
    CONTACT_REQUESTS_ENABLED: 'true',
    CONTACT_REQUEST_ENCRYPTION_KEY: KEY,
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY: 'fake-key',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
    AWS_S3_BUCKET_NAME: 'private-bucket',
    TRUSTED_PROXY_MODE: 'xff',
    TRUSTED_PROXY_COUNT: '1',
  },
  redis: true,
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

const journalWrites: Array<{ key: string; evidence: string }> = []
const journalPut = vi.spyOn(ErasureJournalBucket.prototype, 'put')
beforeEach(() => {
  journalWrites.length = 0
  journalPut.mockReset().mockImplementation(async (key, evidence) => {
    journalWrites.push({ key, evidence: String(evidence) })
  })
})
afterAll(() => journalPut.mockRestore())

const open = (portal: Pick<TestPublishedPortal, 'rawToken'>, request: CallRequest = {}) =>
  openVisit(
    harness,
    (token) => getPublicPortal({ data: { token } }),
    portal.rawToken ?? '',
    request,
  )

async function venue() {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property)
  return { organization, property, portal }
}

const mutate = <T>(
  visit: GuestVisit,
  fn: (input: { data: never }) => Promise<T>,
  data: Record<string, unknown>,
  request: CallRequest = {},
) => guestCall(harness, visit, fn, data, request)

const responseRows = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query(
        'SELECT id, status, rating, deleted_at FROM guest_responses WHERE portal_id = $1',
        [portal.id],
      )
  ).rows

const noteRows = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query('SELECT 1 FROM guest_response_private_feedback WHERE portal_id = $1', [
        portal.id,
      ])
  ).rows

const sessionCookie = (headers: Headers) =>
  headers.getSetCookie().find((cookie) => cookie.startsWith('rk_guest'))

/** The expiry a Set-Cookie carries, from its Max-Age or Expires attribute. */
function cookieExpiry(cookie: string, now: number): number {
  const maxAge = /Max-Age=(\d+)/i.exec(cookie)?.[1]
  if (maxAge) return now + Number(maxAge) * 1000
  const expires = /Expires=([^;]+)/i.exec(cookie)?.[1]
  if (!expires) throw new Error('The session cookie carries no expiry')
  return Date.parse(expires)
}

const switchToSkipPrivateRating = (portal: TestPublishedPortal) =>
  harness.seedRepublication(portal, (base) => ({
    ...base,
    reviewGateway: { ...base.reviewGateway, skipPrivateRating: true },
  }))

const UNAVAILABLE = { status: 404, code: 'unavailable' }
const TOLERANCE_MS = 5_000

describe('withdrawGuestResponseFn', () => {
  it('spends no withdrawal budget on a call whose session does not bind', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, { headers: venueAddress(32) })
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3), {
      headers: venueAddress(32),
    })

    for (let n = 0; n < 4; n += 1) {
      const stranger = await mutate(
        { ...visit, cookies: [] },
        withdrawGuestResponseFn,
        portalBase(portal),
        {
          headers: venueAddress(32),
        },
      )
      expect(refusalOf(stranger)).toMatchObject(UNAVAILABLE)
    }
    const own = await mutate(visit, withdrawGuestResponseFn, portalBase(portal), {
      headers: venueAddress(32),
    })

    expect(answerOf(own)).toMatchObject({ status: 'deleted' })
  })

  it('journals the erasure and deletes the response', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))
    const [before] = await responseRows(portal)

    const withdrawn = await mutate(visit, withdrawGuestResponseFn, portalBase(portal))

    expect(answerOf(withdrawn)).toMatchObject({ status: 'deleted' })
    expect(await responseRows(portal)).toMatchObject([
      { id: before.id, status: 'deleted', rating: null },
    ])
    expect(journalWrites).toHaveLength(1)
    expect(journalWrites[0]?.evidence).toContain(before.id)
    expect(withdrawn.headers.get('cache-control')).toBe('private, no-store')
  })

  it('leaves a guest with no response of their own without a journal entry', async () => {
    const { portal } = await venue()
    const visit = await open(portal)

    const withdrawn = await mutate(visit, withdrawGuestResponseFn, portalBase(portal))

    expect(refusalOf(withdrawn)).toBeDefined()
    expect(journalWrites).toEqual([])
  })

  it('refuses a fourth withdrawal in the hour with 429 and a Retry-After, after the session is bound', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, { headers: venueAddress(31) })
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))

    const attempts = []
    for (let n = 0; n < 4; n += 1) {
      attempts.push(
        await mutate(visit, withdrawGuestResponseFn, portalBase(portal), {
          headers: venueAddress(31),
        }),
      )
    }

    for (const attempt of attempts.slice(0, 3)) {
      expect(attempt.ok || (attempt.error as { status?: number }).status).not.toBe(429)
    }
    expect(refusalOf(attempts[3]!)).toMatchObject({ status: 429 })
    expect(attempts[3]!.headers.get('retry-after')).toMatch(/^\d+$/)
  })
})

describe('a Portal that skips the private rating, for a rating given earlier', () => {
  it('keeps correction and withdrawal available', async () => {
    const organization = await harness.seedOrganization()
    const property = await harness.seedProperty(organization)
    const portal = await harness.seedPublishedPortal(property)
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 4))
    await switchToSkipPrivateRating(portal)

    const corrected = await mutate(visit, correctGuestResponseFn, ratingData(portal, 5))
    const withdrawn = await mutate(visit, withdrawGuestResponseFn, portalBase(portal))

    expect(answerOf(corrected)).toMatchObject({ status: 'corrected', rating: 5 })
    expect(answerOf(withdrawn)).toMatchObject({ status: 'deleted' })
    expect(await responseRows(portal)).toMatchObject([
      { status: 'deleted', rating: null },
    ])
    expect(journalWrites).toHaveLength(1)
  })
})

describe('withdrawPrivateFeedbackFn', () => {
  it('journals the erasure, removes the note and keeps the rating', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 2))
    await mutate(visit, submitPrivateFeedbackFn, {
      ...portalBase(portal),
      text: 'The room was cold',
      textConsent: true,
    })

    const withdrawn = await mutate(visit, withdrawPrivateFeedbackFn, portalBase(portal))

    expect(answerOf(withdrawn)).toMatchObject({ hasPrivateFeedback: false })
    expect(await noteRows(portal)).toEqual([])
    expect(await responseRows(portal)).toMatchObject([{ status: 'submitted', rating: 2 }])
    expect(journalWrites).toHaveLength(1)
  })
})

describe('session renewal to the committed withdrawal deadline', () => {
  it('renews the cookie only to the response withdrawal deadline after a rating', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    const at = Date.now()

    const rated = await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))

    const deadline = Date.parse(
      (answerOf(rated) as { responseWithdrawalDeadline: string })
        .responseWithdrawalDeadline,
    )
    const cookie = sessionCookie(rated.headers)
    expect(cookie).toBeDefined()
    expect(Math.abs(cookieExpiry(cookie ?? '', at) - deadline)).toBeLessThan(TOLERANCE_MS)
  })

  it('renews the cookie only to the note withdrawal deadline after a note', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 2))
    const at = Date.now()

    const noted = await mutate(visit, submitPrivateFeedbackFn, {
      ...portalBase(portal),
      text: 'The room was cold',
      textConsent: true,
    })

    const deadline = Date.parse(
      (answerOf(noted) as { feedbackWithdrawalDeadline: string })
        .feedbackWithdrawalDeadline,
    )
    const cookie = sessionCookie(noted.headers)
    expect(cookie).toBeDefined()
    expect(Math.abs(cookieExpiry(cookie ?? '', at) - deadline)).toBeLessThan(TOLERANCE_MS)
  })
})

describe('Start over after a withdrawal', () => {
  it('gives a fresh session once the response is withdrawn', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))
    const withdrawn = await mutate(visit, withdrawGuestResponseFn, portalBase(portal))
    const after = visitAfter(visit, withdrawn.headers)

    const started = await mutate(after, startNewGuestResponseFn, portalBase(portal))
    const fresh = visitAfter(after, started.headers, answerOf(started).csrfNonce)
    const second = await mutate(fresh, submitGuestResponseFn, ratingData(portal, 5))

    expect(answerOf(second)).toMatchObject({ status: 'submitted', rating: 5 })
  })
})

describe('a contact request while contact requests are dark', () => {
  it('can still be withdrawn, because withdrawal needs the response capability and not the contact one', async () => {
    const { portal, organization, property } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))
    await mutate(visit, submitPrivateFeedbackFn, {
      ...portalBase(portal),
      text: 'Please call me',
      textConsent: true,
    })
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
    const [response] = await responseRows(portal)
    const now = new Date()
    const created = await createContactRequestRepository(
      getDb(),
      createContactRequestEncryption({
        activeKeyId: 'v1',
        keys: { v1: KEY },
        generateIv: () => randomBytes(12),
      }),
    ).create({
      id: randomUUID(),
      scope: {
        organizationId: organization.id,
        propertyId: property.id,
        portalId: portal.id,
      },
      responseId: response.id,
      purpose: 'manager_follow_up',
      consent: true,
      email: 'guest@example.com',
      submittedAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    })
    expect(created.outcome).toBe('created')

    const withdrawn = await mutate(visit, withdrawContactRequestFn, portalBase(portal))

    expect(answerOf(withdrawn)).toEqual({ status: 'withdrawn' })
    const rows = await harness
      .pool()
      .query('SELECT status FROM guest_contact_requests WHERE portal_id = $1', [
        portal.id,
      ])
    expect(rows.rows).toEqual([{ status: 'withdrawn' }])
    expect(journalWrites).toHaveLength(1)
  })

  it('answers a withdrawal with nothing to withdraw like a missing request', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await mutate(visit, submitGuestResponseFn, ratingData(portal, 3))

    const withdrawn = await mutate(visit, withdrawContactRequestFn, portalBase(portal))

    expect(refusalOf(withdrawn)).toMatchObject(UNAVAILABLE)
    expect(journalWrites).toEqual([])
  })
})
