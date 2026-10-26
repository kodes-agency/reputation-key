// Story data for a Property whose portals have parts of their own (ADR 0070):
// "Avela Resort" with portals that follow the look, portals with their own photo
// or colours, and two that have all of it. The page, its media and its batch
// stories all draw this one Property.
import type {
  PortalLookSources,
  PortalReview,
} from '#/contexts/portal/application/public-api'
import { readyReview } from './property-look-page-fixtures'
import type { AffectedPortalRow } from './property-look-rules'

const FOLLOWS: PortalLookSources = {
  photo: 'property',
  colours: 'property',
  identity: 'property',
}

const OWN_COLOURS: PortalLookSources = { ...FOLLOWS, colours: 'portal' }
const OWN_PHOTO_AND_COLOURS: PortalLookSources = {
  ...FOLLOWS,
  photo: 'portal',
  colours: 'portal',
}
const OWN_PHOTO: PortalLookSources = { ...FOLLOWS, photo: 'portal' }
const OWN_EVERYTHING: PortalLookSources = {
  photo: 'portal',
  colours: 'portal',
  identity: 'portal',
}
/** No photo, and the colours and the name of its own: nothing the Property look says reaches it. */
const NO_PHOTO_OWN_REST: PortalLookSources = {
  photo: 'none',
  colours: 'portal',
  identity: 'portal',
}

const group = (name: string) => ({ id: `group-${name}`, name })

/**
 * Six live portals and two drafts. Five live ones and one draft still take
 * something from the Property look; the Wellness annex and the Beach kiosk have
 * all three parts of their own, so the look does not reach them.
 */
export const AVELA_MIXED_PORTALS: readonly AffectedPortalRow[] = [
  {
    portalId: 'p-reception',
    name: 'Reception',
    publicationState: 'published',
    group: group('Front of house'),
    lookSources: FOLLOWS,
  },
  {
    portalId: 'p-pool',
    name: 'Pool & Terrace',
    publicationState: 'published',
    group: group('Pool side'),
    lookSources: FOLLOWS,
  },
  {
    portalId: 'p-olive',
    name: 'Olive Terrace restaurant',
    publicationState: 'published',
    group: null,
    lookSources: OWN_COLOURS,
  },
  {
    portalId: 'p-spa',
    name: 'Spa & thermal pools',
    publicationState: 'published',
    group: group('Pool side'),
    lookSources: OWN_PHOTO_AND_COLOURS,
  },
  {
    portalId: 'p-rooms',
    name: 'Guest rooms',
    publicationState: 'published',
    group: group('Front of house'),
    lookSources: FOLLOWS,
  },
  {
    portalId: 'p-annex',
    name: 'Wellness annex',
    publicationState: 'published',
    group: group('Pool side'),
    lookSources: OWN_EVERYTHING,
  },
  {
    portalId: 'p-bar',
    name: 'Pool bar',
    publicationState: 'draft',
    group: group('Pool side'),
    lookSources: OWN_PHOTO,
  },
  {
    portalId: 'p-kiosk',
    name: 'Beach kiosk',
    publicationState: 'draft',
    group: null,
    lookSources: NO_PHOTO_OWN_REST,
  },
  { portalId: 'p-old', name: 'Old kiosk', publicationState: 'archived', group: null },
]

/** A Property with a second portal that has its own photo, and nothing else to tell. */
export const TWO_PORTALS_ONE_OWN_PHOTO: readonly AffectedPortalRow[] = [
  {
    portalId: 'p-reception',
    name: 'Reception',
    publicationState: 'published',
    group: null,
    lookSources: FOLLOWS,
  },
  {
    portalId: 'p-spa',
    name: 'Spa & thermal pools',
    publicationState: 'published',
    group: null,
    lookSources: OWN_PHOTO,
  },
]

/**
 * What an owner's review says when the portal's own look was edited and the
 * Property look was not: the portal's own photo change is the only thing waiting.
 * It is an edit to this portal, not to the look every portal starts with, so the
 * batch counts it among the other draft edits and leaves the portal unticked.
 */
export function ownLookReview(portalId: string, version = 4): PortalReview {
  const ready = readyReview(portalId, version)
  return {
    ...ready,
    changes: [
      {
        type: 'edit',
        kind: 'portal_configuration',
        subject: { area: 'portal_look', facet: 'photo' },
        propertyWide: false,
        actor: { userId: 'u-1', displayName: 'Elena Petrova' },
        occurredAt: '2026-10-02T09:00:00.000Z',
        previousText: null,
        newText: null,
        editCount: 1,
      },
    ],
  }
}
