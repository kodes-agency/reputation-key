// Fixtures for the per-portal look journey (ADR 0070, `beta-product-journeys.spec.ts`).
// Kept apart from `fixtures.ts`, which is already long.
//
// The journey seeds its own Property (prefix `e2e-pl-`, with the run id and the
// retry in the slug) with two Portals, Reception and Spa, live through the real
// Portal commands, so the Property look it moves is its own and no other journey
// sees a pending change it left. Properties and Portals are never deleted, as the
// monthly portal goal fixtures' header explains: the stack is disposable.
import type { Page } from '@playwright/test'
import {
  callServerFn,
  callServerFnGet,
  dbQuery,
  e2eRunId,
  seedProperty,
  waitFor,
} from './fixtures'
import { verifyGoogleReviewDestination } from './portal-goal-fixtures'
import { requireE2eSeedState } from './seed-state'

export const PORTAL_LOOK_PREFIX = 'e2e-pl-'

/** One Portal of the journey: live, with the address a guest opens. */
export type SeededLookPortal = Readonly<{
  id: string
  name: string
  rawToken: string
}>

export type SeededLookProperty = Readonly<{
  propertyId: string
  reception: SeededLookPortal
  spa: SeededLookPortal
}>

/** The colours a guest page draws and the wordmark in its header, as the page's own markup says them. */
export type GuestLook = Readonly<{
  accent: string
  field: string
  /** Null when the header shows no wordmark. */
  wordmark: string | null
}>

/** What the Portals overview says of one Portal's look. */
export type LookOverviewRow = Readonly<{
  portalId: string
  pendingChangeCount: number
  lookSources?: Readonly<{ photo: string; colours: string; identity: string }>
}>

/**
 * A Property whose Brand Profile has an accent of its own (so a Property look edit
 * has something to move), and two Portals created, given an address and published
 * by the owner `page` is signed in as. Both follow the Property look.
 */
export async function seedPortalLookProperty(
  page: Page,
  suffix: string,
  retry: number,
  accent: string,
): Promise<SeededLookProperty> {
  const seed = requireE2eSeedState()
  const slug = `${PORTAL_LOOK_PREFIX}${e2eRunId}-${retry}-${suffix}`
  const { propertyId } = await seedProperty({
    organizationId: seed.organizationId,
    name: `E2E Portal Look ${e2eRunId} ${retry} ${suffix}`,
    slug,
  })
  await verifyGoogleReviewDestination(propertyId, slug)
  // A Portal is published from a snapshot of its Property's brand, in every
  // enabled language, so both exist first.
  await callServerFn(page, {
    file: 'src/contexts/portal/server/portals.ts',
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
    file: 'src/contexts/portal/server/portals.ts',
    exportName: 'savePropertyPortalBrandContent',
    data: {
      propertyId,
      locale: 'en',
      title: 'How was your stay?',
      shortDescription: 'Tell the team how it went — it takes a moment.',
    },
  })
  await saveSeededPropertyAccent(page, propertyId, accent)
  const reception = await seedLivePortal(page, propertyId, slug, 'Reception')
  const spa = await seedLivePortal(page, propertyId, slug, 'Spa')
  return { propertyId, reception, spa }
}

/** The Property look's accent, with the automatic background and no wordmark, as the Property look page saves it. */
export async function saveSeededPropertyAccent(
  page: Page,
  propertyId: string,
  accent: string,
): Promise<void> {
  await callServerFn(page, {
    file: 'src/contexts/portal/server/property-look.ts',
    exportName: 'savePropertyLook',
    data: {
      propertyId,
      accentColour: accent,
      backgroundMode: 'auto',
      wordmark: null,
    },
  })
}

async function seedLivePortal(
  page: Page,
  propertyId: string,
  propertySlug: string,
  name: string,
): Promise<SeededLookPortal> {
  const { portal } = await callServerFn<{ portal: { id: string } }>(page, {
    file: 'src/contexts/portal/server/portals.ts',
    exportName: 'createPortal',
    data: {
      propertyId,
      name,
      slug: `${propertySlug}-${name.toLowerCase()}`,
      description: 'A Portal of the per-portal look journey.',
    },
  })
  const { rawToken } = await callServerFn<{ rawToken: string }>(page, {
    file: 'src/contexts/portal/server/portals.ts',
    exportName: 'issuePortalToken',
    data: { portalId: portal.id },
  })
  await callServerFn(page, {
    file: 'src/contexts/portal/server/portals.ts',
    exportName: 'updatePortal',
    data: { portalId: portal.id, publicationState: 'published' },
  })
  // A published Portal is only served while Portal Health says so, and health is
  // projected by a worker AFTER the publish commits; without this wait the guest
  // request races the projection and the gateway correctly fails closed.
  await waitFor(
    async () => {
      const [row] = await dbQuery<{ status: string }>(
        `SELECT status FROM portal_health_intervals
         WHERE portal_id = $1 AND effective_to IS NULL`,
        [portal.id],
      )
      return row && row.status !== 'unavailable' ? row : null
    },
    { description: `portal health reconciled after publishing ${name}` },
  )
  return { id: portal.id, name, rawToken }
}

/**
 * The look a guest gets at an address: the accent and field colours the page's
 * `--ih-*` variables hold (lower case, so a comparison does not hang on how the
 * page writes a hex) and the wordmark in its header.
 */
export async function guestLookOf(page: Page, rawToken: string): Promise<GuestLook> {
  await page.goto(`/p/${rawToken}`)
  const root = page.locator('.ih-root').first()
  await root.waitFor({ state: 'attached' })
  const variables = await root.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      accent: style.getPropertyValue('--ih-accent'),
      field: style.getPropertyValue('--ih-field'),
    }
  })
  const wordmark = page.locator('.ih-wordmark').first()
  return {
    accent: variables.accent.trim().toLowerCase(),
    field: variables.field.trim().toLowerCase(),
    // textContent, not innerText: the page may set the wordmark in capitals by CSS.
    wordmark:
      (await wordmark.count()) === 0
        ? null
        : ((await wordmark.textContent()) ?? '').trim(),
  }
}

/** Each Portal of the Property as the overview lists it, by Portal id. */
export async function lookOverviewOf(
  page: Page,
  propertyId: string,
): Promise<ReadonlyMap<string, LookOverviewRow>> {
  const { portals } = await callServerFnGet<{ portals: ReadonlyArray<LookOverviewRow> }>(
    page,
    {
      file: 'src/contexts/portal/server/portals.ts',
      exportName: 'listPortalOverview',
      data: { propertyId },
    },
  )
  return new Map(portals.map((row) => [row.portalId, row]))
}
