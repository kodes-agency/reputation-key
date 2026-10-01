// The History tab's "View" (round 4, slice 47i) against real PostgreSQL: a
// published version that is not the live one is read back through the
// repository's verification and drawn with the live rules, so a tile whose
// address is not approved is left out, an earlier-design version says so, a
// version that was never published is refused, no address reaches the browser,
// and another organisation reads nothing.

import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../domain/approved-destination'
import { bulgarianPrimaryConfiguration } from '../domain/__fixtures__/immersive-configuration'
import { getPortalVersionPreview } from '../application/use-cases/get-portal-version-preview'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalApprovedDestinationRepository } from './repositories/portal-approved-destination.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { seedLegacySnapshot } from './testing/portal-legacy-live-seed'
import { seedLiveImmersiveSnapshot } from './testing/portal-live-immersive-seed'
import { seedPortalWorkingCopy } from './testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_link_texts',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const NOW = new Date('2026-10-01T12:00:00.000Z')
const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

function versionPreview() {
  const db = getDb()
  return getPortalVersionPreview({
    portalRepo: createPortalRepository(db),
    publicationRepo: createPortalPublicationRepository(db),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    mediaRepo: createPortalMediaAssetRepository(db),
    staffPublicApi,
    clock: () => NOW,
  })
}

const LIVE_VERSION = 1
const EARLIER_DESIGN_VERSION = 2

/** Version 1 is live (the new design); version 2 is an earlier-design version that was replaced. */
async function seedVersions(): Promise<void> {
  await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
  // The shared seed writes a validation version the repository (rightly) refuses to read.
  await getPool().query(
    `UPDATE portal_approved_destinations SET validation_version = $1,
       last_validated_at = $3 WHERE organization_id = $2`,
    [PORTAL_DESTINATION_VALIDATION_VERSION, WORKING_COPY_ORG, NOW],
  )
  const base = bulgarianPrimaryConfiguration()
  const [menu, spa] = base.links
  if (!menu || !spa) throw new Error('the fixture has no links')
  await seedLiveImmersiveSnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    configuration: bulgarianPrimaryConfiguration({
      portal: { id: COMPLETE_SCENARIO.portalId, slug: COMPLETE_SCENARIO.slug },
      links: [
        { ...menu, url: 'https://example.com/menu' },
        // Not an approved destination of the scenario: left out of the page.
        { ...spa, url: 'https://elsewhere.example.net/spa' },
      ],
    }),
  })
  await seedLegacySnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    idTail: 7,
    version: EARLIER_DESIGN_VERSION,
    schemaVersion: 2,
    at: new Date('2026-09-20T09:00:00.000Z'),
    activation: 'replaced',
  })
}

const asManager = (orgId = WORKING_COPY_ORG) =>
  buildTestAuthContext({ organizationId: orgId, role: 'AccountAdmin' })

describe.sequential('getPortalVersionPreview (real PostgreSQL)', () => {
  it('draws a stored version with only the tiles whose address is still approved', async () => {
    await seedVersions()

    const outcome = await versionPreview()(
      { portalId: COMPLETE_SCENARIO.portalId, version: LIVE_VERSION },
      asManager(),
    )

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview).toMatchObject({
      source: 'version',
      version: LIVE_VERSION,
      primaryLocale: 'bg',
      locales: ['bg', 'en'],
    })
    expect(outcome.preview.experiences.bg?.links.map((link) => link.label)).toEqual([
      'Меню',
    ])
  })

  it('says an earlier-design version cannot be drawn', async () => {
    await seedVersions()

    await expect(
      versionPreview()(
        { portalId: COMPLETE_SCENARIO.portalId, version: EARLIER_DESIGN_VERSION },
        asManager(),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      source: 'version',
      reason: 'earlier_design',
    })
  })

  it('never sends an address to the browser', async () => {
    await seedVersions()

    const outcome = await versionPreview()(
      { portalId: COMPLETE_SCENARIO.portalId, version: LIVE_VERSION },
      asManager(),
    )

    const json = JSON.stringify(outcome)
    expect(json).not.toContain('example.com/menu')
    expect(json).not.toContain('elsewhere.example.net')
  })

  it('refuses a version the Portal never published', async () => {
    await seedVersions()

    await expect(
      versionPreview()({ portalId: COMPLETE_SCENARIO.portalId, version: 9 }, asManager()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it("does not read another organisation's portal", async () => {
    await seedVersions()

    await expect(
      versionPreview()(
        { portalId: COMPLETE_SCENARIO.portalId, version: LIVE_VERSION },
        asManager(organizationId(WORKING_COPY_OTHER_ORG)),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
