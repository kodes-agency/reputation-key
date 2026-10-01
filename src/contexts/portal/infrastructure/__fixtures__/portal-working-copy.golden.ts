// Pinned output of the Portal working-copy reader for the scenarios in
// testing/portal-working-copy-scenarios.ts. A change here is a change to what
// publish, the in-transaction verification and the history comparison all see.
//
// The reader reports facts and applies no policy: a text nobody wrote is null,
// a language without wording has null texts (the resolver copies the primary
// language in), a Property with no Brand Profile has no look, an image that may
// not be served is absent, and only approved links are listed, in guest order.

import type { PortalPublicationSource } from '../../domain/portal-publication-source'

export const COMPLETE_GOLDEN: PortalPublicationSource = {
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000001',
  portal: {
    id: 'c2000000-0000-4000-8000-000000000001',
    name: 'Lobby portal',
    slug: 'lobby-complete',
  },
  privateFeedbackThreshold: 4,
  primaryGuestLocale: 'bg',
  localeSet: ['bg', 'en'],
  linktreeEnabled: true,
  timeZone: 'Europe/Sofia',
  look: {
    displayName: 'Hotel Rila',
    wordmark: 'RILA',
    accentColour: '#1D4ED8',
    backgroundColour: '#101820',
    backgroundMode: 'manual',
    lookVersion: 4,
    logo: { assetId: 'c5000000-0000-4000-8000-000000000002', width: 480, height: 120 },
    hero: {
      assetId: 'c5000000-0000-4000-8000-000000000001',
      width: 1600,
      height: 1000,
      focalX: 0.3,
      focalY: 0.7,
    },
  },
  wording: {
    bg: {
      title: 'Хотел Рила',
      shortDescription: 'Добре дошли',
      heroAlt: 'Фасадата на хотела',
      linktreeTitle: null,
    },
    en: {
      title: 'Hotel Rila Lobby',
      shortDescription: 'Welcome',
      heroAlt: null,
      linktreeTitle: 'Around Rila',
    },
  },
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000002',
      url: 'https://example.com/spa',
      iconKey: null,
      imageAssetId: 'c5000000-0000-4000-8000-000000000003',
      texts: { bg: { label: 'Spa', line: null, provenance: null } },
    },
    {
      id: 'c4000000-0000-4000-8000-000000000001',
      url: 'https://example.com/menu',
      iconKey: 'utensils',
      imageAssetId: null,
      texts: {
        bg: { label: 'Меню', line: 'Закуска до 11', provenance: null },
        en: { label: 'Menu', line: 'Breakfast until 11', provenance: 'ai_draft' },
      },
    },
  ],
}

export const NO_BRAND_GOLDEN: PortalPublicationSource = {
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000002',
  portal: {
    id: 'c2000000-0000-4000-8000-000000000002',
    name: 'Lobby portal',
    slug: 'lobby-no-brand',
  },
  privateFeedbackThreshold: 4,
  primaryGuestLocale: 'en',
  localeSet: ['en'],
  linktreeEnabled: false,
  timeZone: 'UTC',
  look: null,
  wording: {
    en: {
      title: 'Lobby',
      shortDescription: 'Scan for the lobby',
      heroAlt: null,
      linktreeTitle: null,
    },
  },
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000011',
      url: 'https://example.com/menu',
      iconKey: null,
      imageAssetId: null,
      texts: { en: { label: 'Menu', line: null, provenance: null } },
    },
  ],
}

export const INCOMPLETE_GOLDEN: PortalPublicationSource = {
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000003',
  portal: {
    id: 'c2000000-0000-4000-8000-000000000003',
    name: 'Lobby portal',
    slug: 'lobby-incomplete',
  },
  privateFeedbackThreshold: 4,
  primaryGuestLocale: 'en',
  localeSet: ['en', 'bg'],
  linktreeEnabled: true,
  timeZone: 'UTC',
  look: {
    displayName: 'Hotel Pirin',
    wordmark: null,
    accentColour: '#1D4ED8',
    backgroundColour: '#101820',
    backgroundMode: 'auto',
    lookVersion: 1,
    logo: null,
    hero: null,
  },
  wording: {
    en: {
      title: 'Hotel Pirin',
      shortDescription: 'Welcome',
      heroAlt: null,
      linktreeTitle: null,
    },
    bg: { title: null, shortDescription: null, heroAlt: null, linktreeTitle: null },
  },
  links: [],
}
