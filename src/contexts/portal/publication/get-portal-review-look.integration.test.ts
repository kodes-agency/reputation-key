// The Review & publish read, the Property look and a Portal's own look: which look
// edits a Portal sees in its change list and which are masked.

import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PortalLookSources } from '../domain/portal-look'
import type { PortalPageEditRow } from '../workspace/portal-history-repository.port.server'
import type { PortalPendingContentChange } from './portal-publication-repository.port.server'
import { listed, minutesAgo, pageEdit, world } from './get-portal-review.test-fixtures'

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

describe("getPortalReview, the Property look and a Portal's own look (ADR 0070)", () => {
  const owns = (...groups: ReadonlyArray<'photo' | 'colours' | 'identity'>) =>
    ({
      photo: groups.includes('photo') ? 'portal' : 'property',
      colours: groups.includes('colours') ? 'portal' : 'property',
      identity: groups.includes('identity') ? 'portal' : 'property',
    }) satisfies PortalLookSources
  const propertyLookEdit = (key: string, overrides: Partial<PortalPageEditRow> = {}) =>
    pageEdit({
      editId: `look-${key}`,
      kind: 'property_brand_profile',
      key,
      propertyWide: true,
      actorUserId: 'elena',
      occurredAt: minutesAgo(60),
      ...overrides,
    })
  const openFence = (kind: 'property_brand_profile' | 'property_brand_content') =>
    ({
      kind,
      key: 'all',
      sourceVersion: 'v7',
      changedAt: minutesAgo(60),
      changedBy: 'elena',
    }) satisfies PortalPendingContentChange
  it('lists a Property colour edit for a Portal that follows the colours', async () => {
    const review = await listed({
      edits: [propertyLookEdit('look:accent')],
      pending: [openFence('property_brand_profile')],
    })

    expect(review.changes).toMatchObject([
      {
        type: 'edit',
        kind: 'property_brand_profile',
        subject: { area: 'look', facet: 'accent' },
        propertyWide: true,
      },
    ])
  })

  it('leaves a Property colour edit out of a Portal that owns its colours', async () => {
    const review = await listed({
      lookSources: owns('colours'),
      edits: [propertyLookEdit('look:accent'), propertyLookEdit('look:field')],
    })

    expect(review.changes).toEqual([])
  })

  it('keeps a Property colour edit in a Portal that owns only its photo', async () => {
    const review = await listed({
      lookSources: owns('photo'),
      edits: [propertyLookEdit('look:accent')],
      pending: [openFence('property_brand_profile')],
    })

    expect(review.changes).toMatchObject([
      { type: 'edit', subject: { area: 'look', facet: 'accent' } },
    ])
  })

  it('treats a photo that is switched off as owned: the Property’s photo no longer reaches it', async () => {
    const review = await listed({
      lookSources: { photo: 'none', colours: 'property', identity: 'property' },
      edits: [propertyLookEdit('look:photo'), propertyLookEdit('look:accent')],
    })

    expect(review.changes).toMatchObject([{ subject: { area: 'look', facet: 'accent' } }])
  })

  it.each([
    ['a logo', 'look:logo', owns('identity'), true],
    ['a logo', 'look:logo', owns('photo'), false],
    ['a wordmark', 'look:wordmark', owns('identity'), true],
    ['a photo', 'look:photo', owns('photo'), true],
    ['a photo', 'look:photo', owns('identity'), false],
    ['a text colour', 'look:text', owns('colours'), true],
  ])(
    'for %s edit (%s) a Portal owning %j is %s',
    async (_name, key, sources, isHidden) => {
      const review = await listed({
        lookSources: sources,
        edits: [propertyLookEdit(key)],
      })

      expect(review.changes).toHaveLength(isHidden ? 0 : 1)
    },
  )

  it('hides a photo-and-logo row written before the facets were split only when the Portal owns both', async () => {
    const edits = [propertyLookEdit('look:images')]

    const photoOnly = await listed({ lookSources: owns('photo'), edits })
    const identityOnly = await listed({ lookSources: owns('identity'), edits })
    const both = await listed({ lookSources: owns('photo', 'identity'), edits })
    const photoSwitchedOff = await listed({
      lookSources: { photo: 'none', colours: 'property', identity: 'portal' },
      edits,
    })

    expect(photoOnly.changes).toHaveLength(1)
    expect(identityOnly.changes).toHaveLength(1)
    expect(both.changes).toHaveLength(0)
    expect(photoSwitchedOff.changes).toHaveLength(0)
  })

  it('keeps a look row whose facet it does not know, and the display name', async () => {
    const review = await listed({
      lookSources: owns('photo', 'colours', 'identity'),
      edits: [
        propertyLookEdit('look:something-newer'),
        propertyLookEdit('all', { editId: 'name' }),
      ],
    })

    expect(review.changes).toHaveLength(2)
  })

  it('lists a change of the Property photo’s description as a change of the photo, and hides it from a Portal with its own photo', async () => {
    const edits = [
      pageEdit({
        editId: 'alt',
        kind: 'property_brand_content',
        key: 'photo_alt:en',
        propertyWide: true,
        actorUserId: 'elena',
        occurredAt: minutesAgo(60),
      }),
    ]

    const following = await listed({
      edits,
      pending: [openFence('property_brand_content')],
    })
    const owning = await listed({ edits, lookSources: owns('photo') })
    const noPhoto = await listed({
      edits,
      lookSources: { photo: 'none', colours: 'property', identity: 'property' },
    })

    expect(following.changes).toMatchObject([
      {
        type: 'edit',
        kind: 'property_brand_content',
        subject: { area: 'look', facet: 'photo' },
      },
    ])
    expect(owning.changes).toEqual([])
    expect(noPhoto.changes).toEqual([])
  })

  it('still drops, as put back, a description row written under the bare language key', async () => {
    const review = await listed({
      edits: [
        pageEdit({
          editId: 'legacy-alt',
          kind: 'property_brand_content',
          key: 'en',
          propertyWide: true,
          occurredAt: minutesAgo(60),
        }),
      ],
    })

    expect(review.changes).toEqual([])
  })

  it('lists a Portal’s own look edit, which is not Property-wide and is never hidden', async () => {
    const review = await listed({
      lookSources: owns('photo', 'colours', 'identity'),
      edits: [
        pageEdit({
          editId: 'own-photo',
          kind: 'portal_configuration',
          key: 'look:photo',
          propertyWide: false,
          actorUserId: 'georgi',
          occurredAt: minutesAgo(30),
        }),
      ],
      pending: [
        {
          kind: 'portal_configuration',
          key: 'look:photo',
          sourceVersion: 'look:v5',
          changedAt: minutesAgo(30),
          changedBy: 'georgi',
        },
      ],
    })

    expect(review.changes).toMatchObject([
      {
        type: 'edit',
        kind: 'portal_configuration',
        subject: { area: 'portal_look', facet: 'photo' },
        propertyWide: false,
      },
    ])
  })

  it('never masks an open pending change: it is still something to publish, shown as unrecorded', async () => {
    // The Portal followed the colours when the Property edited its accent, then
    // took its own colours: the ledger row no longer reaches it, the open fence
    // row still counts, so publishing is still offered and the change is named.
    const review = await listed({
      lookSources: owns('colours'),
      edits: [propertyLookEdit('look:accent')],
      pending: [openFence('property_brand_profile')],
      workingCopy: { privateFeedbackThreshold: 4 },
    })

    expect(review.nothingToPublish).toBe(false)
    expect(review.changes).toMatchObject([
      {
        type: 'unrecorded',
        kind: 'property_brand_profile',
        actor: { userId: 'elena' },
      },
    ])
  })

  it('answers nothingToPublish as publish would, whatever the ledger masking leaves', async () => {
    const withLook = await listed({
      lookSources: owns('colours'),
      edits: [propertyLookEdit('look:accent')],
    })
    const without = await listed({ lookSources: owns('colours') })

    expect(withLook.nothingToPublish).toBe(without.nothingToPublish)
    expect(withLook.nothingToPublish).toBe(true)
  })

  it('judges whether the list may be incomplete on the ledger page as it was read, not on what masking left', async () => {
    const edits = Array.from({ length: 100 }, (_, index) =>
      propertyLookEdit('look:accent', {
        editId: `accent-${index}`,
        occurredAt: minutesAgo(index + 1),
      }),
    )

    const masked = await listed({ lookSources: owns('colours'), edits })
    const following = await listed({ edits })

    expect(masked.changes).toEqual([])
    expect(masked.changesMayBeIncomplete).toBe(true)
    expect(following.changesMayBeIncomplete).toBe(true)
  })
})
