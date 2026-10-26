// The editor's live preview (round 4, slice 30) against real PostgreSQL: the
// draft is built from the saved working copy, a tile whose address is not
// approved is a placeholder, no address of any kind reaches the browser, and
// another organisation reads nothing.

import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import {
  createPreviewUseCase,
  seedScenarioForPreview,
} from './testing/portal-preview-use-case'
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
    'portal_look_overrides',
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

const seedScenario = () => seedScenarioForPreview(getPool(), COMPLETE_SCENARIO)

const asManager = (orgId = WORKING_COPY_ORG) =>
  buildTestAuthContext({ organizationId: orgId, role: 'AccountAdmin' })

describe.sequential('getPortalPreview (real PostgreSQL)', () => {
  it('builds the draft from the saved rows, with unapproved tiles as placeholders', async () => {
    await seedScenario()

    const outcome = await createPreviewUseCase()(
      { portalId: COMPLETE_SCENARIO.portalId, source: 'draft' },
      asManager(),
    )

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    const { preview } = outcome
    expect(preview).toMatchObject({
      source: 'draft',
      primaryLocale: 'bg',
      locales: ['bg', 'en'],
      privateFeedbackThreshold: 4,
    })
    expect(preview.experiences.bg?.content.title.value).toBe('Хотел Рила')
    expect(preview.experiences.en?.content.title.value).toBe('Hotel Rila Lobby')
    expect(preview.experiences.bg?.brand.displayName).toBe('Hotel Rila')
    expect(preview.experiences.bg?.timeZone).toBe('Europe/Sofia')
    expect(preview.experiences.bg?.links.map((link) => [link.label, link.state])).toEqual(
      [
        ['Spa', 'ready'],
        ['Меню', 'ready'],
        ['Awaiting approval', 'awaiting_approval'],
        ['Raw legacy address', 'not_approved'],
      ],
    )
  })

  it('never sends an address to the browser: approved, pending or legacy', async () => {
    await seedScenario()

    const outcome = await createPreviewUseCase()(
      { portalId: COMPLETE_SCENARIO.portalId, source: 'draft' },
      asManager(),
    )

    const json = JSON.stringify(outcome)
    for (const address of [
      'example.com/menu',
      'example.com/spa',
      'example.com/pending',
      'legacy.example',
    ]) {
      expect(json).not.toContain(address)
    }
  })

  it('has no live version to show for a portal that was never published', async () => {
    await seedScenario()

    await expect(
      createPreviewUseCase()(
        { portalId: COMPLETE_SCENARIO.portalId, source: 'live' },
        asManager(),
      ),
    ).resolves.toEqual({ status: 'unavailable', source: 'live', reason: 'not_published' })
  })

  it("does not read another organisation's portal", async () => {
    await seedScenario()

    await expect(
      createPreviewUseCase()(
        { portalId: COMPLETE_SCENARIO.portalId, source: 'draft' },
        asManager(organizationId(WORKING_COPY_OTHER_ORG)),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
