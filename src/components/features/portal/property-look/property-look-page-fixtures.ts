// Story data for the Property look page: "Avela Resort", as board 9 draws it.
import { fn } from 'storybook/test'
import { OFFERED_GUEST_LOCALES } from '#/shared/domain/guest-locale'
import type { AffectedPortalRow } from './property-look-rules'
import type { PropertyLookProfile } from './property-look-types'
import type { PropertyLookSaves } from './use-property-look-draft'

export const AVELA_PROFILE: PropertyLookProfile = {
  displayName: 'Avela Resort',
  primaryColor: '#EAD6A8',
  backgroundColor: '#14110F',
  backgroundMode: 'auto',
  wordmark: 'AVELA',
  defaultGuestLocales: OFFERED_GUEST_LOCALES,
}

/** What a Property has before anyone picks a colour: the default palette, automatic. */
export const DEFAULT_PALETTE_PROFILE: PropertyLookProfile = {
  displayName: 'Avela Resort',
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  backgroundMode: 'auto',
  wordmark: null,
  defaultGuestLocales: OFFERED_GUEST_LOCALES,
}

const group = (name: string) => ({ id: `group-${name}`, name })

export const AVELA_PORTALS: readonly AffectedPortalRow[] = [
  {
    portalId: 'p-reception',
    name: 'Reception',
    publicationState: 'published',
    group: group('Front of house'),
  },
  {
    portalId: 'p-pool',
    name: 'Pool & Terrace',
    publicationState: 'published',
    group: group('Pool side'),
  },
  {
    portalId: 'p-olive',
    name: 'Olive Terrace restaurant',
    publicationState: 'published',
    group: null,
  },
  {
    portalId: 'p-spa',
    name: 'Spa & thermal pools',
    publicationState: 'published',
    group: group('Pool side'),
  },
  {
    portalId: 'p-rooms',
    name: 'Guest rooms',
    publicationState: 'published',
    group: group('Front of house'),
  },
  {
    portalId: 'p-bar',
    name: 'Pool bar',
    publicationState: 'draft',
    group: group('Pool side'),
  },
  { portalId: 'p-old', name: 'Old kiosk', publicationState: 'archived', group: null },
]

/** An action that answers with what it was given, as the server's Brand Profile. */
export function savingLook(
  profile: PropertyLookProfile = AVELA_PROFILE,
): PropertyLookSaves['saveLook'] {
  return Object.assign(
    fn(async (input: { data: Record<string, unknown> }) => ({
      ...profile,
      ...(typeof input.data.accentColour === 'string'
        ? { primaryColor: input.data.accentColour }
        : {}),
      ...(input.data.backgroundMode === 'manual' || input.data.backgroundMode === 'auto'
        ? { backgroundMode: input.data.backgroundMode }
        : {}),
      ...(typeof input.data.backgroundColour === 'string'
        ? { backgroundColor: input.data.backgroundColour }
        : {}),
      wordmark:
        input.data.wordmark === undefined
          ? profile.wordmark
          : (input.data.wordmark as string | null),
    })),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as PropertyLookSaves['saveLook']
}

export function savingLocales(): PropertyLookSaves['saveLocales'] {
  return Object.assign(
    fn(async (input: { data: { locales: string[] } }) => ({
      defaultGuestLocales: input.data.locales,
    })),
    { isPending: false, error: null, isSuccess: false, data: null },
  ) as unknown as PropertyLookSaves['saveLocales']
}
