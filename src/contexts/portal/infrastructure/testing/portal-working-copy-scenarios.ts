// The working-copy shapes the reader tests pin. Each scenario is one Portal in
// a fixed organisation, with its rows named by identifier so the golden output
// (portal-working-copy.golden.ts) stays literal.

import {
  organizationId,
  portalId,
  propertyId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { PortalWorkingCopySeed } from './portal-working-copy-seed'

export const WORKING_COPY_ORG = organizationId('org-workingcopy-0000-0000-00000001')
export const WORKING_COPY_OTHER_ORG = organizationId('org-workingcopy-0000-0000-00000002')

/** A seed whose scope identifiers are the branded ones the ports take. */
export type WorkingCopyScenario = PortalWorkingCopySeed &
  Readonly<{ organizationId: OrganizationId; propertyId: PropertyId; portalId: PortalId }>

const scenarioIds = (n: number) => ({
  organizationId: WORKING_COPY_ORG,
  propertyId: propertyId(`c1000000-0000-4000-8000-00000000000${n}`),
  portalId: portalId(`c2000000-0000-4000-8000-00000000000${n}`),
  categoryId: `c3000000-0000-4000-8000-00000000000${n}`,
})

export const SCENARIO_HERO_ASSET = 'c5000000-0000-4000-8000-000000000001'
const SCENARIO_LOGO_ASSET = 'c5000000-0000-4000-8000-000000000002'
export const SCENARIO_TILE_ASSET = 'c5000000-0000-4000-8000-000000000003'

/**
 * Complete localized experience: bg primary with en additional, a look with a
 * hero, a logo and a tile picture, a language that wrote only some of its
 * texts, and links of every kind.
 */
export const COMPLETE_SCENARIO: WorkingCopyScenario = {
  ...scenarioIds(1),
  slug: 'lobby-complete',
  primaryGuestLocale: 'bg',
  additionalGuestLocales: ['en'],
  timeZone: 'Europe/Sofia',
  brand: {
    displayName: 'Hotel Rila',
    defaultHeroImageUrl: 'https://cdn.example/hero-default.jpg',
    wordmark: 'RILA',
    backgroundMode: 'manual',
    lookVersion: 4,
    heroAsset: { id: SCENARIO_HERO_ASSET, focalX: 0.3, focalY: 0.7 },
    logoAssetId: SCENARIO_LOGO_ASSET,
  },
  mediaAssets: [
    { id: SCENARIO_HERO_ASSET, purpose: 'hero', width: 1600, height: 1000 },
    { id: SCENARIO_LOGO_ASSET, purpose: 'logo', width: 480, height: 120 },
    { id: SCENARIO_TILE_ASSET, purpose: 'link_image', width: 800, height: 800 },
  ],
  contents: [
    {
      locale: 'bg',
      title: 'Хотел Рила',
      shortDescription: 'Добре дошли',
      heroAltText: 'Фасадата на хотела',
    },
    { locale: 'en', title: 'Hotel Rila', shortDescription: 'Welcome' },
    // Not enabled on the Portal: it must never reach the working copy.
    { locale: 'fr', title: 'Hôtel Rila', shortDescription: 'Bienvenue' },
  ],
  overrides: [
    {
      locale: 'en',
      title: 'Hotel Rila Lobby',
      shortDescription: null,
      heroImageUrl: null,
      linktreeTitle: 'Around Rila',
    },
    {
      // A photo address is the earlier design's way of naming a picture: ignored.
      locale: 'bg',
      title: null,
      shortDescription: null,
      heroImageUrl: 'https://cdn.example/hero-bg.jpg',
    },
  ],
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000001',
      label: 'Menu',
      sortKey: 'a1',
      iconKey: 'utensils',
      texts: [
        { locale: 'bg', label: 'Меню', line: 'Закуска до 11' },
        {
          locale: 'en',
          label: 'Menu',
          line: 'Breakfast until 11',
          provenance: 'ai_draft',
        },
      ],
      destination: { state: 'approved', uri: 'https://example.com/menu' },
    },
    {
      // No text rows at all: it reads its own label, in the primary language only.
      id: 'c4000000-0000-4000-8000-000000000002',
      label: 'Spa',
      sortKey: 'a0',
      imageAssetId: SCENARIO_TILE_ASSET,
      destination: { state: 'approved', uri: 'https://example.com/spa' },
    },
    {
      id: 'c4000000-0000-4000-8000-000000000003',
      label: 'Awaiting approval',
      sortKey: 'a2',
      destination: { state: 'pending', uri: 'https://example.com/pending' },
    },
    {
      id: 'c4000000-0000-4000-8000-000000000004',
      label: 'Raw legacy address',
      sortKey: 'a3',
      destination: 'legacy',
    },
  ],
}

/** No Brand Profile at all: the resolver gives the page the default look. */
export const NO_BRAND_SCENARIO: WorkingCopyScenario = {
  ...scenarioIds(2),
  slug: 'lobby-no-brand',
  primaryGuestLocale: 'en',
  additionalGuestLocales: [],
  linktreeEnabled: false,
  brand: null,
  // The Property has wording but has never picked a look.
  contents: [{ locale: 'en', title: 'Lobby', shortDescription: 'Scan for the lobby' }],
  overrides: [],
  links: [
    {
      id: 'c4000000-0000-4000-8000-000000000011',
      label: 'Menu',
      sortKey: 'a0',
      destination: { state: 'approved', uri: 'https://example.com/menu' },
    },
  ],
}

/** A Brand Profile but no wording for one enabled locale: the source says so, the resolver copies. */
export const INCOMPLETE_SCENARIO: WorkingCopyScenario = {
  ...scenarioIds(3),
  slug: 'lobby-incomplete',
  primaryGuestLocale: 'en',
  additionalGuestLocales: ['bg'],
  brand: { displayName: 'Hotel Pirin', defaultHeroImageUrl: null },
  contents: [{ locale: 'en', title: 'Hotel Pirin', shortDescription: 'Welcome' }],
  overrides: [],
  links: [],
}
