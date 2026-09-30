import { describe, expect, it } from 'vitest'
import type { PortalPublicationSource } from '../domain/portal-publication-snapshot'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot'
import {
  comparableWorkingContent,
  publishedContent,
  workingCopyMatchesSnapshot,
} from './portal-working-copy-match'

const WITHOUT_EXPERIENCE: PortalPublicationSource = {
  portal: {
    id: 'portal-1',
    name: 'Lobby',
    slug: 'lobby',
    description: null,
    heroImageUrl: null,
    theme: null,
    organizationName: 'Example Organisation',
  },
  categories: [{ id: 'category-1', title: 'Around', sortKey: 'a0' }],
  links: [
    {
      id: 'link-1',
      label: 'Menu',
      url: 'https://example.com/menu',
      categoryId: 'category-1',
      sortKey: 'a0',
    },
  ],
  privateFeedbackThreshold: 3,
  organizationId: 'org-1',
  propertyId: 'property-1',
}

const WITH_EXPERIENCE: PortalPublicationSource = {
  ...WITHOUT_EXPERIENCE,
  experience: {
    primaryGuestLocale: 'en',
    localeSet: ['en'],
    // The reader hands over the whole pack map; only enabled locales are compared.
    languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
    localizedContent: {
      en: { title: 'Welcome', shortDescription: 'Tell us', heroImageUrl: null },
      bg: { title: 'Добре дошли', shortDescription: 'Кажете', heroImageUrl: null },
    },
    brandProfile: {
      displayName: 'Example Hotel',
      logoUrl: null,
      defaultHeroImageUrl: null,
      primaryColor: '#1D4ED8',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
      version: 1,
    },
  },
}

const snapshotOf = (source: PortalPublicationSource) =>
  buildPortalPublicationSnapshot({
    id: 'snapshot-1',
    portalId: 'portal-1',
    organizationId: 'org-1',
    propertyId: 'property-1',
    version: 1,
    source,
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=match',
      retrievedAt: new Date('2026-08-26T10:00:00.000Z'),
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: 'manager-1',
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
  })

describe('workingCopyMatchesSnapshot', () => {
  it('matches the snapshot built from the same working copy', () => {
    expect(workingCopyMatchesSnapshot(WITH_EXPERIENCE, snapshotOf(WITH_EXPERIENCE))).toBe(
      true,
    )
    expect(
      workingCopyMatchesSnapshot(WITHOUT_EXPERIENCE, snapshotOf(WITHOUT_EXPERIENCE)),
    ).toBe(true)
  })

  it('compares only the enabled locales of the pack map and the content', () => {
    const comparable = comparableWorkingContent(WITH_EXPERIENCE)

    expect(comparable.experience?.languagePackVersions).toEqual({ en: 'guest-ui-en-v1' })
    expect(comparable.experience?.localizedContent).toEqual({
      en: WITH_EXPERIENCE.experience?.localizedContent.en,
    })
  })

  it.each([
    [
      'a portal field',
      { ...WITH_EXPERIENCE, portal: { ...WITH_EXPERIENCE.portal, name: 'Other' } },
    ],
    ['a category', { ...WITH_EXPERIENCE, categories: [] }],
    ['a link', { ...WITH_EXPERIENCE, links: [] }],
    ['the threshold', { ...WITH_EXPERIENCE, privateFeedbackThreshold: 4 }],
    [
      'the enabled locales',
      {
        ...WITH_EXPERIENCE,
        experience: { ...WITH_EXPERIENCE.experience!, localeSet: ['en', 'bg'] as const },
      },
    ],
    [
      'the brand profile',
      {
        ...WITH_EXPERIENCE,
        experience: {
          ...WITH_EXPERIENCE.experience!,
          brandProfile: {
            ...WITH_EXPERIENCE.experience!.brandProfile,
            displayName: 'Renamed',
          },
        },
      },
    ],
  ])('reports a change to %s', (_name, moved) => {
    expect(workingCopyMatchesSnapshot(moved, snapshotOf(WITH_EXPERIENCE))).toBe(false)
  })

  it('reports a working copy that gained an experience over a legacy snapshot', () => {
    expect(
      workingCopyMatchesSnapshot(WITH_EXPERIENCE, snapshotOf(WITHOUT_EXPERIENCE)),
    ).toBe(false)
  })

  it('describes a legacy snapshot without an experience', () => {
    expect(publishedContent(snapshotOf(WITHOUT_EXPERIENCE))).not.toHaveProperty(
      'experience',
    )
  })
})
