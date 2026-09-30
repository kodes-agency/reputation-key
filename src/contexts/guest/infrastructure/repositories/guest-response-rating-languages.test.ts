// Private ratings by the language of the page the guest saw (real PG).
//
// "Guests by language" on the Portal Results tab counts PRIVATE RATINGS, not
// scans (owner decision 2026-09-30). Each rating's language is the one its
// experience snapshot pinned at submission, so a Portal that later changed its
// languages cannot rewrite history. A rating with no snapshot (older than the
// snapshots) is counted on its own line, never guessed into a language.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { createGuestResponseRepository } from './guest-response.repository'

const db = getDb()
const ORG = 'org-guest-rating-languages'
const OTHER_ORG = 'org-guest-rating-languages-other'
const PROP = 'e1000000-0000-4000-8000-000000000001'
const OTHER_PROP = 'e1000000-0000-4000-8000-000000000002'
const PORTAL = 'e2000000-0000-4000-8000-000000000001'
const SIBLING_PORTAL = 'e2000000-0000-4000-8000-000000000002'
const OTHER_PORTAL = 'e2000000-0000-4000-8000-000000000003'

const START = new Date('2026-09-01T00:00:00.000Z')
const END = new Date('2026-10-01T00:00:00.000Z')
const DIGEST = 'a'.repeat(64)

type Seed = Readonly<{
  n: number
  org?: string
  property?: string
  portal?: string
  rating?: number | null
  outcome?: 'accepted' | 'filtered_automatically' | 'under_review'
  consent?: boolean
  submittedAt?: string | null
  correctedAt?: string | null
  deletedAt?: string | null
  locale?: string | null
}>

const uuid = (n: number) => `e3000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function seedResponse(seed: Seed) {
  const org = seed.org ?? ORG
  const property = seed.property ?? PROP
  const portal = seed.portal ?? PORTAL
  await db.execute(sql`
    INSERT INTO guest_responses (
      id, organization_id, property_id, portal_id, status, integrity_outcome,
      rating, response_consent, submitted_at, corrected_at, deleted_at,
      retention_deadline
    ) VALUES (
      ${uuid(seed.n)}, ${org}, ${property}, ${portal}, 'submitted',
      ${seed.outcome ?? 'accepted'}, ${seed.rating === undefined ? 5 : seed.rating},
      ${seed.consent ?? true},
      ${seed.submittedAt === undefined ? '2026-09-10T10:00:00.000Z' : seed.submittedAt},
      ${seed.correctedAt ?? null}, ${seed.deletedAt ?? null},
      now() + interval '24 months'
    )
  `)
  if (seed.locale === null) return
  await db.execute(sql`
    INSERT INTO guest_response_experience_snapshots (
      response_id, organization_id, property_id, portal_id, publication_state,
      configuration_digest, guest_locale, language_pack_version,
      private_feedback_threshold, captured_at
    ) VALUES (
      ${uuid(seed.n)}, ${org}, ${property}, ${portal}, 'published', ${DIGEST},
      ${seed.locale ?? 'en'}, 'guest-ui-v1', 3, '2026-09-10T10:00:00.000Z'
    )
  `)
}

async function cleanup() {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(
      sql`DELETE FROM guest_response_experience_snapshots WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM portals WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
}

beforeAll(async () => {
  await cleanup()
  for (const [org, property, portals] of [
    [ORG, PROP, [PORTAL, SIBLING_PORTAL]],
    [OTHER_ORG, OTHER_PROP, [OTHER_PORTAL]],
  ] as const) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${org}, ${org}, ${org}, now())
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES (${property}, ${org}, ${org}, ${org}, 'UTC')
    `)
    for (const portal of portals) {
      await db.execute(sql`
        INSERT INTO portals (
          id, organization_id, property_id, entity_type, entity_id, name, slug,
          publication_state
        ) VALUES (
          ${portal}, ${org}, ${property}, 'property', ${property},
          ${`portal-${portal.slice(-2)}`}, ${`portal-${portal.slice(-2)}`}, 'published'
        )
      `)
    }
  }
  await seedResponse({ n: 1, locale: 'en' })
  await seedResponse({
    n: 2,
    locale: 'en',
    rating: 4,
    submittedAt: '2026-09-11T10:00:00.000Z',
  })
  await seedResponse({
    n: 3,
    locale: 'bg',
    rating: 2,
    submittedAt: '2026-09-12T10:00:00.000Z',
  })
  // No snapshot: older than the snapshots, so its language was never recorded.
  await seedResponse({ n: 4, locale: null, submittedAt: '2026-09-13T10:00:00.000Z' })
  // A correction moves a rating to the day it was corrected: counted in September.
  await seedResponse({
    n: 5,
    locale: 'es',
    submittedAt: '2026-08-30T10:00:00.000Z',
    correctedAt: '2026-09-05T10:00:00.000Z',
  })
  // Not eligible ratings, or not in the window, or not this Portal's.
  await seedResponse({ n: 6, locale: 'en', outcome: 'filtered_automatically' })
  await seedResponse({ n: 7, locale: 'en', outcome: 'under_review' })
  await seedResponse({ n: 8, locale: 'en', rating: null })
  await seedResponse({ n: 9, locale: 'en', submittedAt: '2026-08-01T10:00:00.000Z' })
  await seedResponse({ n: 10, locale: 'en', submittedAt: '2026-10-01T00:00:00.000Z' })
  await seedResponse({ n: 11, locale: 'en', deletedAt: '2026-09-20T10:00:00.000Z' })
  await seedResponse({ n: 12, locale: 'en', consent: false })
  await seedResponse({ n: 13, locale: 'de', portal: SIBLING_PORTAL })
  await seedResponse({
    n: 14,
    locale: 'en',
    org: OTHER_ORG,
    property: OTHER_PROP,
    portal: OTHER_PORTAL,
  })
})

afterAll(async () => {
  await cleanup()
})

const repository = () => createGuestResponseRepository(db, () => END)
const scope = (portal: string = PORTAL) => ({
  organizationId: organizationId(ORG),
  propertyId: propertyId(PROP),
  portalId: portalId(portal),
})

describe('summarizePortalRatingLanguages (integration)', () => {
  it('counts eligible private ratings by the language of the page the guest saw', async () => {
    const summary = await repository().summarizePortalRatingLanguages(scope(), START, END)

    expect(summary).toEqual({
      total: 5,
      languages: [
        { locale: 'en', count: 2 },
        { locale: 'bg', count: 1 },
        { locale: 'es', count: 1 },
      ],
      unrecorded: 1,
    })
  })

  it('answers for one Portal only', async () => {
    const summary = await repository().summarizePortalRatingLanguages(
      scope(SIBLING_PORTAL),
      START,
      END,
    )

    expect(summary).toEqual({
      total: 1,
      languages: [{ locale: 'de', count: 1 }],
      unrecorded: 0,
    })
  })

  it('never reads another organisation', async () => {
    const summary = await repository().summarizePortalRatingLanguages(
      { ...scope(OTHER_PORTAL) },
      START,
      END,
    )

    expect(summary).toEqual({ total: 0, languages: [], unrecorded: 0 })
  })

  it('has nothing to say about an empty window', async () => {
    const summary = await repository().summarizePortalRatingLanguages(
      scope(),
      new Date('2027-01-01T00:00:00.000Z'),
      new Date('2027-02-01T00:00:00.000Z'),
    )

    expect(summary).toEqual({ total: 0, languages: [], unrecorded: 0 })
  })
})
