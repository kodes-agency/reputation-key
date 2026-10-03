import { describe, expect, it } from 'vitest'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { immersiveSnapshot } from './__fixtures__/immersive-snapshot'
import { buildLegacyPortalPublicationSnapshot } from './__fixtures__/legacy-snapshot-builder'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot'
import {
  destinationMatchesSnapshot,
  publishedContent,
  workingCopyMatchesSnapshot,
} from './portal-working-copy-match'

const SOURCE = publicationSource()

const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=match',
  retrievedAt: new Date('2026-08-26T10:00:00.000Z'),
  sourceEpoch: 1,
  profileVersion: 1,
} as const

const snapshotOf = (source: PortalPublicationSource) =>
  buildPortalPublicationSnapshot({
    id: 'snapshot-1',
    portalId: source.portal.id,
    organizationId: source.organizationId,
    propertyId: source.propertyId,
    version: 1,
    source,
    destination: DESTINATION,
    createdBy: 'manager-1',
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
  })

const first = <T>(items: readonly T[]): T => {
  const [item] = items
  if (item === undefined) throw new Error('the fixture has no such item')
  return item
}

/** One change to the working copy for every v3 field a guest could see. */
const MOVES: ReadonlyArray<readonly [string, PortalPublicationSource]> = [
  ['the portal address', { ...SOURCE, portal: { ...SOURCE.portal, slug: 'other' } }],
  ['the threshold', { ...SOURCE, privateFeedbackThreshold: 4 }],
  ['the Linktree switch', { ...SOURCE, linktreeEnabled: false }],
  ['the time zone', { ...SOURCE, timeZone: 'Europe/London' }],
  ['the languages', { ...SOURCE, localeSet: ['en'] }],
  [
    'the primary language',
    { ...SOURCE, primaryGuestLocale: 'bg', localeSet: ['bg', 'en'] },
  ],
  ['the accent', { ...SOURCE, look: { ...SOURCE.look!, accentColour: '#2255AA' } }],
  ['the look version', { ...SOURCE, look: { ...SOURCE.look!, lookVersion: 4 } }],
  ['the look itself', { ...SOURCE, look: null }],
  ['the hero photo', { ...SOURCE, look: { ...SOURCE.look!, hero: null } }],
  [
    'the hero focal point',
    {
      ...SOURCE,
      look: { ...SOURCE.look!, hero: { ...SOURCE.look!.hero!, focalX: 0.9 } },
    },
  ],
  ['the logo', { ...SOURCE, look: { ...SOURCE.look!, logo: null } }],
  ['the wordmark', { ...SOURCE, look: { ...SOURCE.look!, wordmark: 'OTHER' } }],
  ['the display name', { ...SOURCE, look: { ...SOURCE.look!, displayName: 'Renamed' } }],
  [
    'a title',
    {
      ...SOURCE,
      wording: { ...SOURCE.wording, en: { ...SOURCE.wording.en!, title: 'Another' } },
    },
  ],
  [
    'the Linktree title',
    {
      ...SOURCE,
      wording: {
        ...SOURCE.wording,
        bg: { ...SOURCE.wording.bg!, linktreeTitle: 'Друго' },
      },
    },
  ],
  ['a link', { ...SOURCE, links: [first(SOURCE.links)] }],
  ['the order of the links', { ...SOURCE, links: [...SOURCE.links].reverse() }],
  [
    'a link address',
    {
      ...SOURCE,
      links: [
        { ...first(SOURCE.links), url: 'https://other.example.com/' },
        ...SOURCE.links.slice(1),
      ],
    },
  ],
  [
    'a link icon',
    {
      ...SOURCE,
      links: [{ ...first(SOURCE.links), iconKey: 'bed' }, ...SOURCE.links.slice(1)],
    },
  ],
  [
    'a tile photo',
    {
      ...SOURCE,
      links: [first(SOURCE.links), { ...SOURCE.links[1]!, imageAssetId: null }],
    },
  ],
  [
    'a link text',
    {
      ...SOURCE,
      links: [
        {
          ...first(SOURCE.links),
          texts: {
            ...first(SOURCE.links).texts,
            bg: { label: 'Друго', line: null, provenance: null },
          },
        },
        ...SOURCE.links.slice(1),
      ],
    },
  ],
  [
    'where a link text came from',
    {
      ...SOURCE,
      links: [
        {
          ...first(SOURCE.links),
          texts: {
            ...first(SOURCE.links).texts,
            bg: { label: 'Меню', line: 'Закуска до 11', provenance: 'ai_draft' },
          },
        },
        ...SOURCE.links.slice(1),
      ],
    },
  ],
]

describe('workingCopyMatchesSnapshot', () => {
  it('matches the snapshot built from the same working copy', () => {
    expect(workingCopyMatchesSnapshot(SOURCE, snapshotOf(SOURCE))).toBe(true)
  })

  it('matches when a gap was filled from the primary language, as publishing filled it', () => {
    const gapped = publicationSource({
      wording: {
        en: SOURCE.wording.en!,
        bg: { title: null, shortDescription: null, heroAlt: null, linktreeTitle: null },
      },
    })

    expect(workingCopyMatchesSnapshot(gapped, snapshotOf(gapped))).toBe(true)
  })

  it('matches a portal with no brand profile, which publishes the default look', () => {
    const plain = publicationSource({ look: null })

    expect(workingCopyMatchesSnapshot(plain, snapshotOf(plain))).toBe(true)
  })

  it.each(MOVES)('reports a change to %s', (_name, moved) => {
    expect(workingCopyMatchesSnapshot(moved, snapshotOf(SOURCE))).toBe(false)
  })

  it('reports a change of scope', () => {
    expect(
      workingCopyMatchesSnapshot(
        { ...SOURCE, propertyId: 'property-2' },
        snapshotOf(SOURCE),
      ),
    ).toBe(false)
  })

  describe('an earlier snapshot', () => {
    const legacySnapshot = buildLegacyPortalPublicationSnapshot({
      id: 'snapshot-legacy',
      portalId: SOURCE.portal.id,
      organizationId: SOURCE.organizationId,
      propertyId: SOURCE.propertyId,
      version: 1,
      source: {
        portal: {
          id: SOURCE.portal.id,
          name: 'Lobby',
          slug: 'lobby',
          description: null,
          heroImageUrl: null,
          theme: null,
          organizationName: 'Example Organisation',
        },
        categories: [],
        links: [],
        privateFeedbackThreshold: 3,
        organizationId: SOURCE.organizationId,
        propertyId: SOURCE.propertyId,
      },
      destination: DESTINATION,
      createdBy: 'manager-1',
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
    })

    it('never matches: publishing now would write the new design', () => {
      expect(workingCopyMatchesSnapshot(SOURCE, legacySnapshot)).toBe(false)
      expect(publishedContent(legacySnapshot)).toBeNull()
    })
  })

  describe('what a v3 snapshot says it published', () => {
    it('names every v3 field a working copy has to match', () => {
      const published = publishedContent(immersiveSnapshot())

      expect(published).toMatchObject({
        privateFeedbackThreshold: 3,
        content: {
          linktree: { enabled: true },
          guestLocale: 'en',
          timeZone: 'Europe/Sofia',
        },
      })
      expect(published?.content.links).toHaveLength(2)
    })
  })

  describe('the Google destination a snapshot is pinned to', () => {
    const snapshot = snapshotOf(SOURCE)

    it('matches while all four pinned facts equal the Property destination', () => {
      expect(destinationMatchesSnapshot({ ...DESTINATION }, snapshot)).toBe(true)
    })

    it.each([
      ['the link', { uri: 'https://search.google.com/local/writereview?placeid=other' }],
      ['the retrieval time', { retrievedAt: new Date('2026-08-27T10:00:00.000Z') }],
      ['the source epoch', { sourceEpoch: 2 }],
      ['the profile version', { profileVersion: 2 }],
    ])('stops matching when %s moves', (_name, change) => {
      expect(destinationMatchesSnapshot({ ...DESTINATION, ...change }, snapshot)).toBe(
        false,
      )
    })
  })
})
