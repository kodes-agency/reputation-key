// Test-only: the world, ids and seeds the personal guest page integration suites
// share, so the create and the update suites live in files of their own.

import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import type { CreatePersonalPortalDeps } from './create-personal-portal.server'
import { createPortalPublicationRepository } from '../publication/portal-publication-repository.server'
import { createCreationQueries } from '../publication/portal-creation-queries.test-fixtures'
import {
  createPersonalPortalDeps,
  seedCreationCategory,
  seedCreationDestination,
  seedCreationLink,
  seedCreationPortal,
  seedCreationProperty,
  type CreationManager,
} from '../infrastructure/testing/portal-creation-world'
import { publishFromSource } from '../publication/portal-working-copy-publish.test-fixtures'

export const ORG_A = organizationId('org-personal-0000-0000-000000000001')
export const ORG_B = organizationId('org-personal-0000-0000-000000000002')
export const PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000001')
export const OTHER_PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000002')
export const NO_WORDING_PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000003')
export const PROPERTY_B = propertyId('c2a10000-0000-4000-8000-00000000000b')
export const RECEPTION = 'c2b10000-0000-4000-8000-000000000001'
export const RECEPTION_B = 'c2b10000-0000-4000-8000-0000000000b1'
export const PERSON = 'c2b10000-0000-4000-8000-000000000011'
export const GROUP = 'c2a20000-0000-4000-8000-000000000001'
export const RESERVED = 'c2e10000-abcd-4000-8000-000000000001'
export const ID_PREFIX = 'c2d10000'
export const CLOCK = new Date('2026-10-01T12:00:00.000Z')
export const CREATOR = userId('user-personal-0000-0000-000000000001')
export const MISSING = 'c2a90000-0000-4000-8000-0000000000ff'

export const ctx = buildTestAuthContext({
  organizationId: ORG_A,
  userId: CREATOR,
  role: 'PropertyManager',
})
export const member = buildTestAuthContext({ organizationId: ORG_A, role: 'Member' })
export const ratingGoalGuard = createPortalRatingGoalGuard()

export const TEST_ORGANIZATIONS = { orgA: ORG_A, orgB: ORG_B }

const WORDING = [
  {
    locale: 'en',
    title: 'Welcome to Harbor',
    shortDescription: 'Tell us about your visit.',
  },
]

/** The Properties every test starts with: three in Organization A, one in B. */
export async function seedPersonalCreateProperties(pool: Pool) {
  const brand = { displayName: 'Harbor', defaultGuestLocales: ['en'], wording: WORDING }
  await seedCreationProperty(pool, { organizationId: ORG_A, propertyId: PROPERTY, brand })
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: OTHER_PROPERTY,
    brand,
  })
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: NO_WORDING_PROPERTY,
    brand: { ...brand, wording: [] },
  })
  await seedCreationProperty(pool, {
    organizationId: ORG_B,
    propertyId: PROPERTY_B,
    brand,
  })
}

export type WorldOptions = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  managers?: readonly CreationManager[]
}>

export const newPerson = {
  portalId: RESERVED,
  propertyId: PROPERTY,
  displayName: 'Polly Smith',
}

const tail = (id: string) => id.slice(-12)

export function createPersonalCreateHarness(getPool: () => Pool) {
  const worldDeps = (options: WorldOptions = {}): CreatePersonalPortalDeps =>
    createPersonalPortalDeps({
      pool: getPool(),
      idPrefix: ID_PREFIX,
      clock: CLOCK,
      accessible:
        options.accessible === undefined
          ? [PROPERTY, OTHER_PROPERTY]
          : options.accessible,
      managers: options.managers ?? [{ userId: CREATOR, role: 'PropertyManager' }],
      ratingGoalGuard: createPortalRatingGoalGuard(),
    })

  const { rows, countOf } = createCreationQueries(getPool, ORG_A)
  const portalCount = (org: string = ORG_A) => countOf('portals', org)
  const outboxCount = (org: string = ORG_A) => countOf('outbox_events', org)

  /** A Portal with one approved link, live, and the Property it sits on. */
  async function seedPublished(
    input: Readonly<{
      portalId: string
      name: string
      slug: string
      kind?: 'place' | 'personal'
      publicName?: string
      skipPrivateRating?: boolean
      linkDestination?: string
    }>,
  ) {
    const pool = getPool()
    const scope = {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: input.portalId,
    }
    await seedCreationPortal(pool, {
      ...scope,
      slug: input.slug,
      name: input.name,
      kind: input.kind,
      publicName: input.publicName ?? null,
      publicationState: 'draft',
      skipPrivateRating: input.skipPrivateRating,
    })
    const categoryId = `c2c10000-0000-4000-8000-${tail(input.portalId)}`
    await seedCreationCategory(pool, { ...scope, categoryId })
    const destinationId =
      input.linkDestination ?? `c2f10000-0000-4000-8000-${tail(input.portalId)}`
    if (!input.linkDestination) {
      await seedCreationDestination(pool, {
        ...scope,
        destinationId,
        approvalState: 'approved',
      })
    }
    await seedCreationLink(pool, {
      ...scope,
      categoryId,
      linkId: `c2c20000-0000-4000-8000-${tail(input.portalId)}`,
      destinationId,
      label: 'Menu',
      sortKey: 'a0',
      texts: [{ locale: 'en', label: 'Menu' }],
    })
    const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
      ORG_A,
      scope.portalId as never,
    )
    if (!working) throw new Error('the seeded Portal has no working copy')
    await publishFromSource(scope as never, working, createPortalRatingGoalGuard())
    return destinationId
  }

  const seedReception = (extra: Partial<Parameters<typeof seedPublished>[0]> = {}) =>
    seedPublished({ portalId: RECEPTION, name: 'Reception', slug: 'reception', ...extra })

  return {
    worldDeps,
    rows,
    countOf,
    portalCount,
    outboxCount,
    seedPublished,
    seedReception,
  }
}
