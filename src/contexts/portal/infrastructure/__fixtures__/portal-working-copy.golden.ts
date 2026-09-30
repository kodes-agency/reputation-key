// Pinned output of the Portal working-copy reader for the scenarios in
// testing/portal-working-copy-scenarios.ts. Captured from the three pre-refactor
// assemblers (PortalPublicationRepository.loadWorkingCopy), before they became
// one reader, so a change here is a change to what publish, the in-transaction
// verification and the history comparison all see.

import type { PortalPublicationSource } from '../../domain/portal-publication-snapshot'

export const COMPLETE_GOLDEN: PortalPublicationSource = {
  portal: {
    id: 'c2000000-0000-4000-8000-000000000001',
    name: 'Lobby portal',
    slug: 'lobby-complete',
    description: 'Scan for the lobby',
    heroImageUrl: null,
    theme: {
      primaryColor: '#123456',
    },
    organizationName: 'Hotel Rila',
  },
  categories: [
    {
      id: 'c3000000-0000-4000-8000-000000000001',
      title: 'Around the hotel',
      sortKey: 'a0',
    },
  ],
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000002',
      label: 'Spa',
      url: 'https://example.com/spa',
      categoryId: 'c3000000-0000-4000-8000-000000000001',
      sortKey: 'a0',
    },
    {
      id: 'c4000000-0000-4000-8000-000000000001',
      label: 'Menu',
      url: 'https://example.com/menu',
      categoryId: 'c3000000-0000-4000-8000-000000000001',
      sortKey: 'a1',
    },
  ],
  privateFeedbackThreshold: 4,
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000001',
  experience: {
    primaryGuestLocale: 'bg',
    localeSet: ['bg', 'en'],
    languagePackVersions: {
      en: 'guest-ui-en-v1',
      bg: 'guest-ui-bg-v1',
    },
    localizedContent: {
      bg: {
        title: 'Хотел Рила',
        shortDescription: 'Добре дошли',
        heroImageUrl: 'https://cdn.example/hero-bg.jpg',
      },
      en: {
        title: 'Hotel Rila Lobby',
        shortDescription: 'Welcome',
        heroImageUrl: 'https://cdn.example/hero-default.jpg',
      },
    },
    brandProfile: {
      displayName: 'Hotel Rila',
      logoUrl: null,
      defaultHeroImageUrl: 'https://cdn.example/hero-default.jpg',
      primaryColor: '#1D4ED8',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
      version: 3,
    },
  },
}

export const NO_BRAND_GOLDEN: PortalPublicationSource = {
  portal: {
    id: 'c2000000-0000-4000-8000-000000000002',
    name: 'Lobby portal',
    slug: 'lobby-no-brand',
    description: 'Scan for the lobby',
    heroImageUrl: null,
    theme: {
      primaryColor: '#123456',
    },
    organizationName: 'Test Org t-orgworkingcopy0000000000000001',
  },
  categories: [
    {
      id: 'c3000000-0000-4000-8000-000000000002',
      title: 'Around the hotel',
      sortKey: 'a0',
    },
  ],
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000011',
      label: 'Menu',
      url: 'https://example.com/menu',
      categoryId: 'c3000000-0000-4000-8000-000000000002',
      sortKey: 'a0',
    },
  ],
  privateFeedbackThreshold: 4,
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000002',
}

export const INCOMPLETE_GOLDEN: PortalPublicationSource = {
  portal: {
    id: 'c2000000-0000-4000-8000-000000000003',
    name: 'Lobby portal',
    slug: 'lobby-incomplete',
    description: 'Scan for the lobby',
    heroImageUrl: null,
    theme: {
      primaryColor: '#123456',
    },
    organizationName: 'Hotel Pirin',
  },
  categories: [
    {
      id: 'c3000000-0000-4000-8000-000000000003',
      title: 'Around the hotel',
      sortKey: 'a0',
    },
  ],
  links: [],
  privateFeedbackThreshold: 4,
  organizationId: 'org-workingcopy-0000-0000-00000001',
  propertyId: 'c1000000-0000-4000-8000-000000000003',
}
