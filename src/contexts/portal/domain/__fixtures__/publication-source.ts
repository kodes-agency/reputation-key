// Test-only builder for a v3 publication source: the working copy as the
// reader hands it to the resolver. A complete English-primary portal with a
// Bulgarian second language whose every text was written. Not imported by
// production code.

import type { PortalPublicationSource } from '../portal-publication-source'

export const SOURCE_FIXTURE_SCOPE = Object.freeze({
  organizationId: 'org-1',
  propertyId: '20000000-0000-4000-8000-000000000001',
  portalId: '10000000-0000-4000-8000-000000000001',
})

export const SOURCE_HERO_ASSET_ID = '70000000-0000-4000-8000-000000000001'
export const SOURCE_LOGO_ASSET_ID = '70000000-0000-4000-8000-000000000002'
export const SOURCE_TILE_ASSET_ID = '70000000-0000-4000-8000-000000000003'

export function publicationSource(
  overrides: Partial<PortalPublicationSource> = {},
): PortalPublicationSource {
  return {
    organizationId: SOURCE_FIXTURE_SCOPE.organizationId,
    propertyId: SOURCE_FIXTURE_SCOPE.propertyId,
    portal: { id: SOURCE_FIXTURE_SCOPE.portalId, name: 'Harbor lobby', slug: 'harbor' },
    privateFeedbackThreshold: 3,
    primaryGuestLocale: 'en',
    localeSet: ['en', 'bg'],
    linktreeEnabled: true,
    timeZone: 'Europe/Sofia',
    look: {
      displayName: 'The Harbor Hotel',
      wordmark: 'HARBOR',
      accentColour: '#C8A45A',
      backgroundColour: '#101010',
      backgroundMode: 'auto',
      lookVersion: 3,
      logo: { assetId: SOURCE_LOGO_ASSET_ID, width: 480, height: 120 },
      hero: {
        assetId: SOURCE_HERO_ASSET_ID,
        width: 1600,
        height: 1000,
        focalX: 0.4,
        focalY: 0.6,
      },
    },
    wording: {
      en: {
        title: 'Tell us about your visit',
        shortDescription: 'Rate your visit to the Harbor Hotel.',
        heroAlt: 'The Harbor Hotel at dusk',
        linktreeTitle: null,
      },
      bg: {
        title: 'Разкажете ни за посещението си',
        shortDescription: 'Оценете посещението си в хотел Харбър.',
        heroAlt: 'Хотел Харбър в здрача',
        linktreeTitle: 'Полезни връзки',
      },
    },
    links: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        url: 'https://harbor.example.com/menu',
        iconKey: 'utensils',
        imageAssetId: null,
        texts: {
          en: { label: 'Menu', line: 'Breakfast until 11', provenance: null },
          bg: { label: 'Меню', line: 'Закуска до 11', provenance: null },
        },
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        url: 'https://harbor.example.com/spa',
        iconKey: null,
        imageAssetId: SOURCE_TILE_ASSET_ID,
        texts: {
          en: { label: 'Spa', line: null, provenance: null },
          bg: { label: 'Спа', line: null, provenance: null },
        },
      },
    ],
    ...overrides,
  }
}
