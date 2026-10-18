// Fixtures for the Monthly portal goal journeys (`monthly-portal-goal.spec.ts`,
// PLAN §3.7). Kept apart from `fixtures.ts`, which is already long.
//
// Each journey seeds its own Property (prefix `e2e-pg-`, with the run id and
// the retry in the slug) with the three Portals of the screens' example, live
// through the real Portal commands. Properties and Portals are never deleted:
// the goal tables hold RESTRICT foreign keys onto the Property, so
// `cleanupE2eData({ prefix })` would throw, and the stack is disposable. The
// teardown ends what a journey left open and takes manager-one's grants back.
import type { Page } from '@playwright/test'
import {
  callServerFn,
  callServerFnGet,
  dbQuery,
  e2eRunId,
  getUserByEmail,
  seedProperty,
} from './fixtures'
import { requireE2eSeedState } from './seed-state'

export const PORTAL_GOAL_PREFIX = 'e2e-pg-'
export const MONTHLY_PORTAL_GOALS =
  'src/contexts/reporting/server/monthly-portal-goals.ts'
const PORTALS = 'src/contexts/portal/server/portals.ts'
const GOAL_PROGRAMS = 'src/contexts/reporting/server/goal-programs.ts'

/** The screens' example Property: three Portals, in name order. */
export const PORTAL_NAMES = ['Reception', 'Restaurant', 'Spa'] as const

export type SeededPortalGoalProperty = Readonly<{
  propertyId: string
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

/**
 * A Property granted to manager-one, with Reception, Restaurant and Spa each
 * created, given a code and published by the owner `page` is signed in as.
 */
export async function seedPortalGoalProperty(
  page: Page,
  suffix: string,
  retry: number,
): Promise<SeededPortalGoalProperty> {
  const seed = requireE2eSeedState()
  const managerOne = await getUserByEmail(seed.onePropertyManagerEmail)
  if (!managerOne) throw new Error('E2E manager-one is not seeded')
  const slug = `${PORTAL_GOAL_PREFIX}${e2eRunId}-${retry}-${suffix}`
  const { propertyId } = await seedProperty({
    organizationId: seed.organizationId,
    name: `E2E Portal Goal ${e2eRunId} ${retry} ${suffix}`,
    slug,
    grantAccessToUserId: managerOne.id,
  })
  // Publishing also needs a verified Google review destination on the
  // Property (portal-publication-readiness.ts), as the seed's Properties have
  // (scripts/seed-e2e-user.ts); a seeded Property starts with none.
  await dbQuery(
    `UPDATE properties
        SET google_review_destination_state = 'verified',
            google_review_uri = $2,
            google_review_destination_retrieved_at = now(),
            google_review_destination_source_epoch = 0,
            google_review_destination_profile_version = profile_version
      WHERE id = $1::uuid`,
    [propertyId, `https://search.google.com/local/writereview?placeid=${slug}`],
  )
  // A Portal is published from a snapshot of its Property's brand, in every
  // enabled language, so both exist first.
  await callServerFn(page, {
    file: PORTALS,
    exportName: 'savePropertyPortalBrandProfile',
    data: {
      propertyId,
      displayName: 'E2E Seaview Hotel',
      primaryColor: '#6366f1',
      backgroundColor: '#ffffff',
      textColor: '#111827',
    },
  })
  await callServerFn(page, {
    file: PORTALS,
    exportName: 'savePropertyPortalBrandContent',
    data: {
      propertyId,
      locale: 'en',
      title: 'How was your stay?',
      shortDescription: 'Tell the team how it went — it takes a moment.',
    },
  })
  const portals: { id: string; name: string }[] = []
  for (const name of PORTAL_NAMES) {
    const { portal } = await callServerFn<{ portal: { id: string } }>(page, {
      file: PORTALS,
      exportName: 'createPortal',
      data: {
        propertyId,
        name,
        slug: `${slug}-${name.toLowerCase()}`,
        description: 'A Portal of the monthly portal goal journeys.',
      },
    })
    // Its public address, which publishing needs, then live.
    await callServerFn(page, {
      file: PORTALS,
      exportName: 'issuePortalToken',
      data: { portalId: portal.id },
    })
    await callServerFn(page, {
      file: PORTALS,
      exportName: 'updatePortal',
      data: { portalId: portal.id, publicationState: 'published' },
    })
    portals.push({ id: portal.id, name })
  }
  return { propertyId, portals }
}

/** The Property's local day today, on the database clock: `YYYY-MM-DD`. */
export async function localToday(propertyId: string): Promise<string> {
  const [row] = await dbQuery<{ today: string }>(
    `SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today
       FROM properties WHERE id = $1::uuid`,
    [propertyId],
  )
  if (!row) throw new Error(`E2E Property ${propertyId} is not seeded`)
  return row.today
}

/**
 * Ends every goal still open on the journeys' Properties, as an operator would,
 * and takes back the grants they were given. `page` is signed in as the owner.
 */
export async function tearDownPortalGoalProperties(
  page: Page,
  propertyIds: readonly string[],
): Promise<void> {
  for (const propertyId of propertyIds) {
    const listed = await callServerFnGet<{
      programs: ReadonlyArray<{ program: { id: string; status: string } }>
    }>(page, {
      file: GOAL_PROGRAMS,
      exportName: 'listGoalPrograms',
      data: { propertyId },
    })
    for (const { program } of listed.programs) {
      if (program.status === 'ended') continue
      await callServerFn(page, {
        file: GOAL_PROGRAMS,
        exportName: 'changeGoalProgramStatus',
        data: {
          propertyId,
          programId: program.id,
          status: 'ended',
          reason: 'E2E end of a monthly portal goal journey.',
        },
      })
    }
  }
  if (propertyIds.length === 0) return
  await dbQuery('DELETE FROM property_access_grant WHERE property_id = ANY($1::uuid[])', [
    propertyIds,
  ])
}
