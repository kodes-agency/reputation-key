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

/** Complete localized experience: bg primary with en additional, overrides, mixed links. */
export const COMPLETE_SCENARIO: WorkingCopyScenario = {
  ...scenarioIds(1),
  slug: 'lobby-complete',
  primaryGuestLocale: 'bg',
  additionalGuestLocales: ['en'],
  brand: {
    displayName: 'Hotel Rila',
    defaultHeroImageUrl: 'https://cdn.example/hero-default.jpg',
  },
  contents: [
    { locale: 'bg', title: 'Хотел Рила', shortDescription: 'Добре дошли' },
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
    },
    {
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
      destination: { state: 'approved', uri: 'https://example.com/menu' },
    },
    {
      id: 'c4000000-0000-4000-8000-000000000002',
      label: 'Spa',
      sortKey: 'a0',
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

/** No Brand Profile at all: the public name falls back to the organisation. */
export const NO_BRAND_SCENARIO: WorkingCopyScenario = {
  ...scenarioIds(2),
  slug: 'lobby-no-brand',
  primaryGuestLocale: 'en',
  additionalGuestLocales: [],
  brand: null,
  contents: [],
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

/** A Brand Profile but no content for one enabled locale: no experience yet. */
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
