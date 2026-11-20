// The guest response journey (rating, correction, private feedback, withdrawal,
// Start over, Google and secondary-link taps, contact requests), called as a
// guest's browser would over PostgreSQL: the real Portal lookup, signed
// session, public execution decision and response lifecycle.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import {
  PORTAL_SEED_CLEANUP_TABLES,
  type SeedPublishedPortalOptions,
  type TestPublishedPortal,
} from '#/shared/testing/server-function-portal-seeds'
import type {
  CallRequest,
  ServerFunctionHarness,
} from '#/shared/testing/server-function-harness'
import {
  answerOf,
  guestCall,
  openVisit,
  portalBase,
  ratingData,
  refusalOf,
  visitAfter,
  BROWSER_USER_AGENT,
  type GuestVisit,
} from '#/shared/testing/server-function-guest-visitor'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  correctGuestResponseFn,
  selectGoogleReviewFn,
  selectSecondaryLinkFn,
  startNewGuestResponseFn,
  submitGuestResponseFn,
  submitPrivateFeedbackFn,
  withdrawGuestResponseFn,
  withdrawPrivateFeedbackFn,
} from './public'
import { getPublicPortal } from './guest-scans'
import { submitContactRequestFn, withdrawContactRequestFn } from './contact-requests'

const harness = setupServerFunctionHarness({
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

const openPortal = (
  _harness: ServerFunctionHarness,
  portal: Pick<TestPublishedPortal, 'rawToken'>,
  request: CallRequest = {},
  token = portal.rawToken ?? '',
) =>
  openVisit(
    harness,
    (opened) => getPublicPortal({ data: { token: opened } }),
    token,
    request,
  )

const UNAVAILABLE = { status: 404, code: 'unavailable' }

async function venue(options: SeedPublishedPortalOptions = {}) {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property, options)
  return { organization, property, portal }
}

const mutate = <T>(
  visit: GuestVisit,
  fn: (input: { data: never }) => Promise<T>,
  data: Record<string, unknown>,
  request: CallRequest = {},
) => guestCall(harness, visit, fn, data, request)

const base = portalBase
const ratingOf = ratingData

const responseRows = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query(
        'SELECT status, rating, integrity_outcome, integrity_reason_code FROM guest_responses WHERE portal_id = $1',
        [portal.id],
      )
  ).rows

/**
 * The rows a completed withdrawal leaves, bound to the visitor's session; the
 * withdrawal itself needs the erasure journal bucket.
 */
async function seedWithdrawnResponse(visit: GuestVisit, portal: TestPublishedPortal) {
  const container = harness.container()
  const scope = {
    organizationId: organizationId(portal.organizationId),
    propertyId: propertyId(portal.propertyId),
    portalId: portalId(portal.id),
  }
  const session = container.guestPublicApi.requests.guestSessions.verify(
    visit.cookies.join('; '),
    scope,
  )
  if (!session) throw new Error('The visit has no session')
  const responseId = randomUUID()
  const params = [responseId, portal.organizationId, portal.propertyId, portal.id]
  await harness.pool().query(
    `INSERT INTO guest_responses
       (id, organization_id, property_id, portal_id, status, response_consent,
        text_consent, retention_deadline, submitted_at, deleted_at)
     VALUES ($1, $2, $3, $4, 'deleted', false, false,
             now() + INTERVAL '24 months', now(), now())`,
    params,
  )
  await harness.pool().query(
    `INSERT INTO guest_response_session_bindings
       (response_id, organization_id, property_id, portal_id, session_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '24 hours')`,
    [...params, session.sessionId],
  )
}

const clickFacts = async (portal: TestPublishedPortal) =>
  (
    await harness.pool().query(
      `SELECT payload FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'guest.review_link.clicked'
        ORDER BY created_at`,
      [portal.organizationId],
    )
  ).rows.map((row) => row.payload as { destinationKind: string })

const value = answerOf
const error = refusalOf

describe('privacy of every answer', () => {
  it('sets the private response headers on success', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const accepted = await mutate(visit, submitGuestResponseFn, ratingOf(portal))

    expect(accepted.headers.get('cache-control')).toBe('private, no-store')
    expect(accepted.headers.get('referrer-policy')).toBe('no-referrer')
    expect(accepted.headers.get('vary')).toContain('Cookie')
  })

  it.each([
    ['submitGuestResponseFn', submitGuestResponseFn],
    ['correctGuestResponseFn', correctGuestResponseFn],
    ['startNewGuestResponseFn', startNewGuestResponseFn],
    ['submitPrivateFeedbackFn', submitPrivateFeedbackFn],
    ['withdrawPrivateFeedbackFn', withdrawPrivateFeedbackFn],
    ['selectGoogleReviewFn', selectGoogleReviewFn],
    ['selectSecondaryLinkFn', selectSecondaryLinkFn],
    ['withdrawGuestResponseFn', withdrawGuestResponseFn],
    ['submitContactRequestFn', submitContactRequestFn],
    ['withdrawContactRequestFn', withdrawContactRequestFn],
  ] as const)('sets them on a malformed request to %s', async (_name, fn) => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const malformed = await mutate(visit, fn as never, { token: '' })

    expect(malformed.ok).toBe(false)
    expect(malformed.headers.get('cache-control')).toBe('private, no-store')
    expect(malformed.headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('submitGuestResponseFn', () => {
  it('stores the rating against the published experience and keeps the session for the withdrawal window', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitGuestResponseFn, ratingOf(portal, 4))

    expect(value(response)).toMatchObject({ status: 'submitted', rating: 4 })
    expect(await responseRows(portal)).toMatchObject([
      { status: 'submitted', rating: 4, integrity_outcome: expect.anything() },
    ])
    const snapshot = await harness.pool().query(
      `SELECT publication_snapshot_id, guest_locale, language_pack_version, private_feedback_threshold
           FROM guest_response_experience_snapshots WHERE portal_id = $1`,
      [portal.id],
    )
    expect(snapshot.rows).toMatchObject([
      { publication_snapshot_id: portal.snapshotId, guest_locale: 'en' },
    ])
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it('answers a second submit of the same session with the response it already has', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 4))

    const again = await mutate(visit, submitGuestResponseFn, ratingOf(portal, 1))

    expect(value(again)).toMatchObject({ status: 'submitted', rating: 4 })
    expect(await responseRows(portal)).toHaveLength(1)
  })

  it.each([
    ['origin', { origin: 'https://elsewhere.example' }],
    ['session', { cookies: [] as string[] }],
  ] as const)(
    'answers a wrong %s as unavailable and stores nothing',
    async (kind, extra) => {
      const { portal } = await venue()
      const visit = await openPortal(harness, portal)

      const response =
        kind === 'session'
          ? await mutate(
              { ...visit, cookies: [] },
              submitGuestResponseFn,
              ratingOf(portal),
            )
          : await mutate(visit, submitGuestResponseFn, ratingOf(portal), extra)

      expect(error(response)).toMatchObject(UNAVAILABLE)
      expect(await responseRows(portal)).toEqual([])
    },
  )

  it('answers a wrong CSRF nonce as unavailable and stores nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(
      { ...visit, csrfNonce: randomUUID() },
      submitGuestResponseFn,
      ratingOf(portal),
    )

    expect(error(response)).toMatchObject(UNAVAILABLE)
    expect(await responseRows(portal)).toEqual([])
  })

  it('answers a filled honeypot with the view a real submit gives, and keeps the response filtered', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(
      visit,
      submitGuestResponseFn,
      ratingOf(portal, 5, { honeypot: 'bot' }),
    )

    expect(value(response)).toMatchObject({ status: 'submitted', rating: 5 })
    expect(await responseRows(portal)).toMatchObject([
      {
        integrity_outcome: 'filtered_automatically',
        integrity_reason_code: 'honeypot_signal',
      },
    ])
  })

  it('answers a filled honeypot on a correction before any session is resolved, and writes nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(
      { ...visit, cookies: [], csrfNonce: randomUUID() },
      correctGuestResponseFn,
      ratingOf(portal, 2, { honeypot: 'bot' }),
    )

    expect(value(response)).toMatchObject({ status: 'submitted', rating: 2 })
    expect(await responseRows(portal)).toEqual([])
  })

  it('refuses a new rating on a Portal that skips the private rating, and stores nothing', async () => {
    const { portal } = await venue({ skipPrivateRating: true })
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitGuestResponseFn, ratingOf(portal))

    expect(error(response)).toMatchObject(UNAVAILABLE)
    expect(await responseRows(portal)).toEqual([])
  })
})

describe('who may change a response', () => {
  it('stores no note with a rating: private feedback is its own command', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const rated = await mutate(
      visit,
      submitGuestResponseFn,
      ratingOf(portal, 1, { text: 'Smelled of smoke', textConsent: true }),
    )

    expect(value(rated)).toMatchObject({ status: 'submitted', hasPrivateFeedback: false })
    const noted = await harness
      .pool()
      .query('SELECT 1 FROM guest_response_private_feedback WHERE portal_id = $1', [
        portal.id,
      ])
    expect(noted.rows).toEqual([])
  })

  it('refuses a note before the session has a rating', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitPrivateFeedbackFn, {
      ...base(portal),
      text: 'The room was cold',
      textConsent: true,
    })

    expect(error(response)).toMatchObject(UNAVAILABLE)
  })

  it('answers a filled honeypot on a submit with no session with the decoy, and writes nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(
      { ...visit, cookies: [] },
      submitGuestResponseFn,
      ratingOf(portal, 5, { honeypot: 'bot' }),
    )

    expect(value(response)).toMatchObject({ status: 'submitted', rating: 5 })
    expect(await responseRows(portal)).toEqual([])
  })

  it('gives a signed-in member no way to change or withdraw a guest’s response', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const property = await harness.seedProperty(organization)
    const portal = await harness.seedPublishedPortal(property)
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 2))

    for (const [fn, data] of [
      [correctGuestResponseFn, ratingOf(portal, 5)],
      [withdrawGuestResponseFn, base(portal)],
    ] as const) {
      const attempt = await harness.respondAs(
        admin,
        () => fn({ data: { csrfNonce: visit.csrfNonce, ...data } as never }),
        { headers: { 'user-agent': BROWSER_USER_AGENT } },
      )
      expect(error(attempt)).toMatchObject(UNAVAILABLE)
    }
    expect(await responseRows(portal)).toMatchObject([{ status: 'submitted', rating: 2 }])
  })
})

describe('correctGuestResponseFn', () => {
  it('changes the rating of the session’s own response', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 2))

    const corrected = await mutate(visit, correctGuestResponseFn, ratingOf(portal, 5))

    expect(value(corrected)).toMatchObject({ status: 'corrected', rating: 5 })
    expect(await responseRows(portal)).toMatchObject([{ status: 'corrected', rating: 5 }])
  })

  it('answers a session with no response as unavailable', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, correctGuestResponseFn, ratingOf(portal, 5))

    expect(error(response)).toMatchObject(UNAVAILABLE)
  })
})

describe('private feedback', () => {
  const text = (portal: TestPublishedPortal) => ({
    ...base(portal),
    text: 'The room was cold',
    textConsent: true,
  })

  it('adds a note to the rating', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 2))

    const added = await mutate(visit, submitPrivateFeedbackFn, text(portal))
    const noted = await harness
      .pool()
      .query('SELECT 1 FROM guest_response_private_feedback WHERE portal_id = $1', [
        portal.id,
      ])

    expect(value(added)).toMatchObject({ hasPrivateFeedback: true })
    expect(noted.rows).toHaveLength(1)
  })

  it('keeps the note when the erasure journal cannot be written, so the withdrawal is refused', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 2))
    await mutate(visit, submitPrivateFeedbackFn, text(portal))

    const withdrawn = await mutate(visit, withdrawPrivateFeedbackFn, base(portal))

    expect(withdrawn.ok).toBe(false)
    const noted = await harness
      .pool()
      .query('SELECT 1 FROM guest_response_private_feedback WHERE portal_id = $1', [
        portal.id,
      ])
    expect(noted.rows).toHaveLength(1)
  })

  it('answers a note on a Portal that skips the private rating as unavailable', async () => {
    const { portal } = await venue({ skipPrivateRating: true })
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitPrivateFeedbackFn, text(portal))

    expect(error(response)).toMatchObject(UNAVAILABLE)
  })

  it('answers a filled honeypot on a note with a decoy and stores nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitPrivateFeedbackFn, {
      ...text(portal),
      honeypot: 'bot',
    })

    expect(value(response)).toMatchObject({
      status: 'submitted',
      hasPrivateFeedback: true,
    })
    expect(await responseRows(portal)).toEqual([])
  })
})

describe('withdrawGuestResponseFn and Start over', () => {
  it('keeps the response when the erasure journal cannot be written, so the withdrawal is refused', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 3))

    const withdrawn = await mutate(visit, withdrawGuestResponseFn, base(portal))

    expect(withdrawn.ok).toBe(false)
    expect(await responseRows(portal)).toMatchObject([{ status: 'submitted', rating: 3 }])
  })

  it('refuses Start over before the session has a rating', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, startNewGuestResponseFn, base(portal))

    expect(error(response)).toMatchObject(UNAVAILABLE)
  })

  it('rotates to a fresh session and nonce after a rating, leaving the earlier response', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 3))

    const started = await mutate(visit, startNewGuestResponseFn, base(portal))
    const fresh = visitAfter(visit, started.headers, value(started).csrfNonce)
    const second = await mutate(fresh, submitGuestResponseFn, ratingOf(portal, 5))

    expect(fresh.csrfNonce).not.toBe(visit.csrfNonce)
    expect(value(second)).toMatchObject({ status: 'submitted', rating: 5 })
    expect(await responseRows(portal)).toHaveLength(2)
  })
})

describe('selectGoogleReviewFn', () => {
  it('refuses an unrated session the Google step and records nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, selectGoogleReviewFn, base(portal))

    expect(error(response)).toMatchObject(UNAVAILABLE)
    expect(await clickFacts(portal)).toEqual([])
  })

  it('opens Google after a rating, and a repeated open records one fact for the session', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 5))

    const first = await mutate(visit, selectGoogleReviewFn, base(portal))
    const second = await mutate(visit, selectGoogleReviewFn, base(portal))

    expect(value(first)).toEqual(value(second))
    expect(value(first)).toMatchObject({ url: expect.stringContaining('https://') })
    expect(await clickFacts(portal)).toEqual([
      expect.objectContaining({ destinationKind: 'google_review' }),
    ])
  })

  describe('on a Portal that skips the private rating', () => {
    it('admits an unrated session to Google', async () => {
      const { portal } = await venue({ skipPrivateRating: true })
      const visit = await openPortal(harness, portal)

      const response = await mutate(visit, selectGoogleReviewFn, base(portal))

      expect(value(response)).toMatchObject({ url: expect.any(String) })
      expect(await clickFacts(portal)).toHaveLength(1)
    })

    it('refuses a withdrawn session until Start over gives a fresh one', async () => {
      const { portal } = await venue({ skipPrivateRating: true })
      const visit = await openPortal(harness, portal)
      await seedWithdrawnResponse(visit, portal)

      const refused = await mutate(visit, selectGoogleReviewFn, base(portal))
      const started = await mutate(visit, startNewGuestResponseFn, base(portal))
      const fresh = visitAfter(visit, started.headers, value(started).csrfNonce)
      const admitted = await mutate(fresh, selectGoogleReviewFn, base(portal))

      expect(error(refused)).toMatchObject(UNAVAILABLE)
      expect(value(admitted)).toMatchObject({ url: expect.any(String) })
    })
  })
})

describe('a Portal that skips the private rating while Google is unavailable', () => {
  it('keeps the rating path, since there is no Google step to skip to', async () => {
    const { portal, property } = await venue({ skipPrivateRating: true })
    await harness.pool().query(
      `UPDATE properties
            SET google_review_destination_state = 'unavailable', google_review_uri = NULL,
                google_review_destination_retrieved_at = NULL,
                google_review_destination_source_epoch = NULL,
                google_review_destination_profile_version = NULL
          WHERE id = $1`,
      [property.id],
    )
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, submitGuestResponseFn, ratingOf(portal, 4))

    expect(value(response)).toMatchObject({ status: 'submitted', rating: 4 })
  })
})

describe('selectSecondaryLinkFn', () => {
  const tap = (portal: TestPublishedPortal) => ({
    ...base(portal),
    linkId: portal.linkId,
  })

  it('records the tap of a session that has not rated, and answers the link', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)

    const response = await mutate(visit, selectSecondaryLinkFn, tap(portal))

    expect(value(response)).toMatchObject({ url: portal.linkUrl })
    expect(await clickFacts(portal)).toEqual([
      expect.objectContaining({ destinationKind: 'secondary_link' }),
    ])
  })

  it('resolves the link in the scope of the session’s own Portal, and records no tap for another Portal’s link', async () => {
    const organization = await harness.seedOrganization()
    const here = await harness.seedPublishedPortal(
      await harness.seedProperty(organization),
    )
    const elsewhere = await harness.seedPublishedPortal(
      await harness.seedProperty(organization),
    )
    const visit = await openPortal(harness, here)

    const response = await mutate(visit, selectSecondaryLinkFn, {
      ...base(here),
      linkId: elsewhere.linkId,
    })

    expect(JSON.stringify(response.ok ? response.value : null)).not.toContain(
      elsewhere.linkUrl,
    )
    expect(await clickFacts(elsewhere)).toEqual([])
    expect(await clickFacts(here)).toEqual([])
  })

  it.each(['origin', 'csrf', 'session'] as const)(
    'answers a wrong %s as unavailable and records nothing',
    async (wrong) => {
      const { portal } = await venue()
      const visit = await openPortal(harness, portal)
      const bad: GuestVisit =
        wrong === 'csrf'
          ? { ...visit, csrfNonce: randomUUID() }
          : wrong === 'session'
            ? { ...visit, cookies: [] }
            : visit

      const response = await mutate(
        bad,
        selectSecondaryLinkFn,
        tap(portal),
        wrong === 'origin' ? { origin: 'https://elsewhere.example' } : {},
      )

      expect(error(response)).toMatchObject(UNAVAILABLE)
      expect(await clickFacts(portal)).toEqual([])
    },
  )
})

// Contact requests stay dark: the guest-side capability is blocked by posture
// and the switch is off, so a guest's submit or withdrawal answers like a
// missing request. The use-case behaviour is asserted in
// contact-request-lifecycle.server.integration.test.ts.
describe('contact requests, guest side', () => {
  it('answers a submit as unavailable and stores nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 3))

    const response = await mutate(visit, submitContactRequestFn, {
      ...base(portal),
      email: 'guest@example.com',
      consent: true,
    })

    expect(error(response)).toMatchObject(UNAVAILABLE)
    const stored = await harness
      .pool()
      .query('SELECT 1 FROM guest_contact_requests WHERE portal_id = $1', [portal.id])
    expect(stored.rows).toEqual([])
  })

  it('answers a withdrawal as unavailable', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal)
    await mutate(visit, submitGuestResponseFn, ratingOf(portal, 3))

    const response = await mutate(visit, withdrawContactRequestFn, base(portal))

    expect(error(response)).toMatchObject(UNAVAILABLE)
  })
})
