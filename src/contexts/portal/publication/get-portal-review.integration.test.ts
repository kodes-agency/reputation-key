// The Review & publish read over in-memory stand-ins for the repositories it reads:
// what guests will see change, the checks, and who may publish.

import { describe, expect, it, vi } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  listed,
  LINK,
  LIVE_AT,
  minutesAgo,
  openChange,
  pageEdit,
  world,
  setup,
} from './get-portal-review.test-fixtures'

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

describe('getPortalReview', () => {
  it('lists what guests will see change, oldest first, with who made each change', async () => {
    const harness = await setup({
      pending: [openChange('portal_links', minutesAgo(24 * 60 - 5), 'georgi')],
      edits: [
        pageEdit({
          editId: 'edit-2',
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          actorUserId: 'elena',
          occurredAt: minutesAgo(120),
          previousText: 'Zona de piscina',
          newText: 'Piscina y terraza',
        }),
        pageEdit({
          editId: 'edit-1',
          key: `link:${LINK}:text:en`,
          occurredAt: minutesAgo(24 * 60 - 5),
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
        }),
      ],
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    const review = await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(review).toMatchObject({
      portalId: harness.portal.id,
      publicationState: 'published',
      action: 'publish_changes',
      live: {
        version: 4,
        activatedAt: LIVE_AT.toISOString(),
        activatedBy: { userId: 'georgi', displayName: 'Georgi Ivanov' },
      },
      publishesAsVersion: 5,
      nothingToPublish: false,
      reviewDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      canPublish: true,
      changesMayBeIncomplete: false,
    })
    expect(review.changes).toEqual([
      {
        type: 'edit',
        kind: 'portal_links',
        subject: { area: 'link_text', linkId: LINK, locale: 'en' },
        propertyWide: false,
        actor: { userId: 'georgi', displayName: 'Georgi Ivanov' },
        occurredAt: minutesAgo(24 * 60 - 5).toISOString(),
        previousText: 'Dinner menu',
        newText: 'Olive Terrace menu',
        editCount: 1,
      },
      {
        type: 'edit',
        kind: 'property_brand_content',
        subject: { area: 'welcome_text', locale: 'es' },
        propertyWide: true,
        actor: { userId: 'elena', displayName: 'Elena Petrova' },
        occurredAt: minutesAgo(120).toISOString(),
        previousText: 'Zona de piscina',
        newText: 'Piscina y terraza',
        editCount: 1,
      },
    ])
  })

  it('does not list edits that went into the live version', async () => {
    const review = await listed({
      pending: [openChange('portal_links', minutesAgo(5), 'elena')],
      edits: [
        pageEdit({ editId: 'new', occurredAt: minutesAgo(5), actorUserId: 'elena' }),
        // The same instant as the publication: the publication took it.
        pageEdit({
          editId: 'at-publication',
          key: `link:${LINK}:deleted`,
          occurredAt: LIVE_AT,
        }),
        pageEdit({
          editId: 'old',
          key: `link:${LINK}:created`,
          occurredAt: new Date(LIVE_AT.getTime() - 1),
        }),
      ],
    })

    expect(review.changes).toHaveLength(1)
    expect(review.changes[0]).toMatchObject({
      type: 'edit',
      subject: { area: 'link', linkId: LINK, change: 'updated' },
    })
  })

  it('lists every edit made since the live version when an older version was made live again', async () => {
    // v3 is live again after v5 was published an hour ago: every edit since v3
    // is still in the draft and publishing puts it in front of guests, the ones
    // v5 took included. The review measures from v3, not from v5.
    const review = await listed({
      liveVersion: 3,
      workingCopy: { privateFeedbackThreshold: 4 },
      pending: [openChange('portal_links', minutesAgo(10), 'georgi')],
      edits: [
        pageEdit({
          editId: 'after-v5',
          key: `link:${LINK}:text:en`,
          occurredAt: minutesAgo(10),
          previousText: 'Dinner menu',
          newText: 'Olive Terrace menu',
        }),
        pageEdit({
          editId: 'between',
          kind: 'property_brand_content',
          key: 'es',
          propertyWide: true,
          actorUserId: 'elena',
          occurredAt: minutesAgo(120),
          previousText: 'Zona de piscina',
          newText: 'Piscina y terraza',
        }),
      ],
    })

    expect(review.live?.version).toBe(3)
    expect(review.changes).toMatchObject([
      { type: 'edit', kind: 'property_brand_content', previousText: 'Zona de piscina' },
      { type: 'edit', kind: 'portal_links', previousText: 'Dinner menu' },
    ])
  })

  it('does not fall back to an unlisted change after an older version was made live again', async () => {
    const review = await listed({
      liveVersion: 3,
      workingCopy: { privateFeedbackThreshold: 4 },
      edits: [
        pageEdit({
          key: 'settings:name',
          kind: 'portal_configuration',
          occurredAt: minutesAgo(120),
          previousText: 'Pool',
          newText: 'Pool & Terrace',
        }),
      ],
    })

    expect(review.changes).toMatchObject([{ type: 'edit', kind: 'portal_configuration' }])
  })

  it('does not offer to publish to someone who may only read the Portal', async () => {
    const review = await listed({
      role: 'PropertyManager',
      readOnly: true,
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    expect(review.canPublish).toBe(false)
    expect(review.action).toBe('publish_changes')
    expect(review.nothingToPublish).toBe(false)
    expect(review.checkCounts.blocked).toBe(0)
  })

  it('does not offer to publish when the publish capability is dark for this Portal', async () => {
    const harness = await setup({ workingCopy: { privateFeedbackThreshold: 4 } })

    const review = await harness.useCase(
      { portalId: harness.portal.id, mayPublish: false },
      harness.ctx,
    )

    expect(review.canPublish).toBe(false)
    expect(review.checkCounts.blocked).toBe(0)
  })

  it('reads the ledger bounded to the repository page, for this Portal', async () => {
    const harness = await setup()

    await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(harness.historyRepo.listPageEdits).toHaveBeenCalledWith(
      harness.portal.organizationId,
      harness.portal.propertyId,
      harness.portal.id,
      { bound: null, limit: 100 },
      harness.portal.createdAt,
    )
  })

  it('says the list may be incomplete when the ledger page is full of newer edits', async () => {
    const edits = Array.from({ length: 100 }, (_, index) =>
      pageEdit({
        editId: `edit-${index}`,
        key: `link:${LINK}:text:en`,
        occurredAt: minutesAgo(index + 1),
        newText: `Text ${index}`,
      }),
    )
    const review = await listed({ edits })

    expect(review.changesMayBeIncomplete).toBe(true)
  })

  it('has nothing to publish when the draft is what is live and nothing is open', async () => {
    const review = await listed()

    expect(review).toMatchObject({
      nothingToPublish: true,
      canPublish: false,
      changes: [],
      action: 'publish_changes',
    })
  })

  it('names the move to the new design when the live version is the earlier one', async () => {
    const review = await listed({ liveIsEarlierDesign: true })

    expect(review.nothingToPublish).toBe(false)
    expect(review.changes.map((change) => change.type)).toEqual(['earlier_design'])
    expect(review.canPublish).toBe(true)
  })

  it('names a Google address the Property has moved on from', async () => {
    const review = await listed({ destination: 'relinked' })

    expect(review.nothingToPublish).toBe(false)
    expect(review.changes).toEqual([{ type: 'google_destination_moved' }])
  })

  it('names who made a recorded change the ledger has no row for', async () => {
    const review = await listed({
      pending: [openChange('approved_destination', minutesAgo(30), 'elena')],
    })

    expect(review.changes).toEqual([
      {
        type: 'unrecorded',
        kind: 'approved_destination',
        actor: { userId: 'elena', displayName: 'Elena Petrova' },
        occurredAt: minutesAgo(30).toISOString(),
      },
    ])
  })

  it('passes the address check for an older code, as the publication accepts it', async () => {
    const review = await listed({
      hasAddress: 'older',
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    expect(review.checks).toContainEqual(
      expect.objectContaining({ code: 'public_address', status: 'passed' }),
    )
  })

  it('reports every gate the publish use case would refuse, without throwing', async () => {
    const review = await listed({
      propertyActive: false,
      destination: 'unavailable',
      hasAddress: false,
      responsibilityNeededSince: minutesAgo(10),
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    expect(review.canPublish).toBe(false)
    expect(review.checkCounts).toEqual({ blocked: 4, warning: 0, passed: 3 })
    expect(review.checks.slice(0, 4).map((check) => check.code)).toEqual([
      'property_available',
      'google_destination',
      'responsible_manager',
      'public_address',
    ])
  })

  it('blocks on a primary-language text nobody wrote, and passes nothing the resolver refused', async () => {
    const review = await listed({
      workingCopy: {
        wording: {
          en: {
            title: '',
            shortDescription: 'Rate your visit.',
            heroAlt: null,
            linktreeTitle: null,
          },
        },
        privateFeedbackThreshold: 4,
      },
    })

    expect(review.canPublish).toBe(false)
    expect(review.checks).toContainEqual({
      code: 'primary_text',
      status: 'blocked',
      locale: 'en',
      keys: ['title'],
    })
  })

  it('warns about a text copied from the fallback language, and counts AI drafts per language', async () => {
    const review = await listed({
      additionalLocales: ['bg'],
      workingCopy: {
        localeSet: ['en', 'bg'],
        wording: {
          en: {
            title: 'Avela',
            shortDescription: 'Rate your visit.',
            heroAlt: null,
            linktreeTitle: null,
          },
        },
        links: [
          {
            id: LINK,
            url: 'https://harbor.example.com/menu',
            iconKey: null,
            imageAssetId: null,
            texts: {
              en: { label: 'Menu', line: null, provenance: null },
              bg: { label: 'Меню', line: null, provenance: 'ai_draft' },
            },
          },
        ],
        privateFeedbackThreshold: 4,
      },
    })

    expect(review.canPublish).toBe(true)
    expect(review.checkCounts.warning).toBe(1)
    expect(review.checks).toContainEqual({
      code: 'copied_text',
      status: 'warning',
      locale: 'bg',
      keys: ['title', 'shortDescription'],
    })
    const bulgarian = review.languages.find((row) => row.locale === 'bg')
    expect(bulgarian).toMatchObject({ aiDraftCount: 1, status: 'copied_from_fallback' })
    expect(review.languages.find((row) => row.locale === 'en')).toMatchObject({
      isFallback: true,
      aiDraftCount: 0,
    })
  })

  it('reviews a first publication without a change list, and offers to publish', async () => {
    const review = await listed({
      state: 'draft',
      edits: [pageEdit()],
      pending: [openChange('portal_links', minutesAgo(1), 'georgi')],
    })

    expect(review).toMatchObject({
      publicationState: 'draft',
      action: 'publish',
      live: null,
      nothingToPublish: false,
      canPublish: true,
      changes: [],
      publishesAsVersion: 5,
    })
  })

  it('offers nothing for an archived Portal', async () => {
    const review = await listed({ state: 'archived' })

    expect(review).toMatchObject({ action: 'none', canPublish: false })
  })

  it('refuses a Published Portal that has no live version, as publishing does', async () => {
    const harness = await setup({ noLiveRecord: true })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('refuses when the working copy cannot be read', async () => {
    const harness = await setup()
    vi.mocked(harness.publicationRepo.loadWorkingCopyWithLook).mockResolvedValueOnce(null)

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
  })

  it('checks property access before reading anything about the Portal', async () => {
    const harness = await setup({ accessible: [] })

    await expect(
      harness.useCase({ portalId: harness.portal.id }, harness.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopyWithLook).not.toHaveBeenCalled()
    expect(harness.historyRepo.listPageEdits).not.toHaveBeenCalled()
  })

  it('does not find a Portal of another organization', async () => {
    const harness = await setup()

    await expect(
      harness.useCase({ portalId: harness.portal.id }, world.ctxB()),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(harness.publicationRepo.loadWorkingCopyWithLook).not.toHaveBeenCalled()
  })

  it('names the people behind the page with one directory call', async () => {
    const harness = await setup({
      edits: [pageEdit({ actorUserId: 'elena' })],
      pending: [openChange('portal_links', minutesAgo(5), 'elena')],
    })

    await harness.useCase({ portalId: harness.portal.id }, harness.ctx)

    expect(harness.actorDirectory.resolveDisplayNames).toHaveBeenCalledTimes(1)
    const [, ids] =
      vi.mocked(harness.actorDirectory.resolveDisplayNames).mock.calls[0] ?? []
    expect([...(ids ?? [])].sort()).toEqual(['elena', 'georgi'])
  })
})
