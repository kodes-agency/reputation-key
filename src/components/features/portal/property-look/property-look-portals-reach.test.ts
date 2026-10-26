// The Property look page's rail and status line for a property whose portals have
// parts of their own (ADR 0070): what the look still reaches, and what the line
// and the preview say about the rest.
import { describe, expect, it } from 'vitest'
import type { PortalLookSources } from '#/contexts/portal/application/public-api'
import {
  affectedPortals,
  defaultPreviewPortal,
  describeAffected,
  describeLookStatus,
  type AffectedPortalRow,
} from './property-look-rules'

const row = (
  name: string,
  publicationState: AffectedPortalRow['publicationState'],
): AffectedPortalRow => ({
  portalId: name.toLowerCase(),
  name,
  publicationState,
  group: null,
})

describe('a property whose portals have parts of their own', () => {
  const FOLLOWING: PortalLookSources = {
    photo: 'property',
    colours: 'property',
    identity: 'property',
  }
  const ownPhotoAndColours: PortalLookSources = {
    ...FOLLOWING,
    photo: 'portal',
    colours: 'portal',
  }
  const ownEverything: PortalLookSources = {
    photo: 'portal',
    colours: 'portal',
    identity: 'portal',
  }
  const owning = (
    name: string,
    lookSources: PortalLookSources,
    state: AffectedPortalRow['publicationState'] = 'published',
  ): AffectedPortalRow => ({ ...row(name, state), lookSources })

  const mixed = affectedPortals([
    row('Reception', 'published'),
    owning('Spa', ownPhotoAndColours),
    owning('Bar', ownEverything),
    row('Pool', 'draft'),
    owning('Kiosk', ownEverything, 'draft'),
  ])

  it('keeps every live and draft portal listed, and sorts out those the look still reaches', () => {
    expect(mixed.listed.map((entry) => entry.name)).toEqual([
      'Reception',
      'Spa',
      'Bar',
      'Pool',
      'Kiosk',
    ])
    expect(mixed.following.live.map((entry) => entry.name)).toEqual(['Reception', 'Spa'])
    expect(mixed.following.drafts.map((entry) => entry.name)).toEqual(['Pool'])
    expect(mixed.independent.map((entry) => entry.name)).toEqual(['Bar', 'Kiosk'])
  })

  it('counts only the portals the look reaches under the title, and still publishes to every live one', () => {
    expect(describeAffected(mixed)).toBe('2 live · 1 draft')
    // The batch review lists all three live portals; the owners show "nothing new".
    expect(mixed.live).toHaveLength(3)
  })

  it('counts what is waiting among the portals the look reaches', () => {
    const waiting = affectedPortals([
      { ...row('Reception', 'published'), pendingChangeCount: 1 },
      { ...owning('Spa', ownPhotoAndColours), pendingChangeCount: 0 },
      { ...owning('Bar', ownEverything), pendingChangeCount: 5 },
    ])

    expect(waiting.waiting).toBe(2)
    expect(waiting.following.waiting).toBe(1)
    expect(describeLookStatus({ status: 'idle' }, waiting).text).toBe(
      'Changes are waiting to go live on 1 of 2 portals · 2 portals have their own photo, colours or name and logo',
    )
  })

  it('says the portals that differ after the count, as the board does', () => {
    const three = affectedPortals([
      row('Reception', 'published'),
      row('Pool', 'published'),
      row('Rooms', 'published'),
      owning('Spa', ownPhotoAndColours, 'draft'),
    ])

    expect(describeLookStatus({ status: 'saved' }, three).text).toBe(
      'Saved as a draft · 3 live portals use this look · Spa has its own photo and colours',
    )
  })

  it('says every live portal has its own look when none follows, and does not say it twice', () => {
    const none = affectedPortals([
      owning('Bar', ownEverything),
      owning('Spa', ownEverything),
    ])

    expect(describeLookStatus({ status: 'idle' }, none).text).toBe(
      'Every live portal has its own look',
    )
    expect(describeAffected(none)).toBe('Every portal has its own look')
  })

  it('is unchanged for a property where every portal follows the look', () => {
    const plain = affectedPortals([row('A', 'published'), row('B', 'draft')])

    expect(plain.independent).toEqual([])
    expect(plain.following.live).toEqual(plain.live)
    expect(plain.following.waiting).toBe(plain.waiting)
    expect(describeLookStatus({ status: 'idle' }, plain).text).toBe(
      '1 live portal uses this look',
    )
  })

  it('previews a portal the look reaches first, not one that owns every part', () => {
    const owner = owning('Bar', ownEverything)
    const follower = owning('Spa', ownPhotoAndColours)

    expect(defaultPreviewPortal(affectedPortals([owner, follower]))?.name).toBe('Spa')
    expect(
      defaultPreviewPortal(affectedPortals([owner, owning('Pool', FOLLOWING, 'draft')]))
        ?.name,
    ).toBe('Pool')
    expect(defaultPreviewPortal(affectedPortals([owner]))?.name).toBe('Bar')
    expect(defaultPreviewPortal(affectedPortals([]))).toBeNull()
  })
})
