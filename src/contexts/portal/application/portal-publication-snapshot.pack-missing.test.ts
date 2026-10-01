import { describe, expect, it, vi } from 'vitest'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { resolvePortalPublication } from '../domain/portal-publication-source'
import { buildPortalPublicationSnapshot } from './portal-publication-snapshot'

// Every guest language has a generation 2 pack today, so the "no pack" blocker
// is a guard for a language added to the catalogue before its pack. The
// catalogue is stood in for here to prove the guard still refuses it, in words
// a manager can act on.
vi.mock('#/shared/domain/guest-locale', async (importOriginal) => {
  const original = await importOriginal<typeof import('#/shared/domain/guest-locale')>()
  const currentGuestLanguagePack = ((locale: never, generation?: 1 | 2) =>
    locale === 'de' && generation === 2
      ? null
      : original.currentGuestLanguagePack(
          locale,
          generation as 2,
        )) as typeof original.currentGuestLanguagePack
  return { ...original, currentGuestLanguagePack }
})

const withoutPack = () =>
  publicationSource({
    localeSet: ['en', 'de'],
    wording: { en: publicationSource().wording.en! },
  })

describe('a language whose generation 2 pack is not registered', () => {
  it('blocks the publication and names the locale', () => {
    const { blockers } = resolvePortalPublication(withoutPack())

    expect(blockers).toContainEqual({ code: 'language_pack_missing', locale: 'de' })
  })

  it('refuses to build the snapshot, telling the manager in plain words', () => {
    const source = withoutPack()

    expect(() =>
      buildPortalPublicationSnapshot({
        id: '30000000-0000-4000-8000-000000000001',
        portalId: source.portal.id,
        organizationId: source.organizationId,
        propertyId: source.propertyId,
        version: 1,
        source,
        destination: {
          state: 'verified',
          uri: 'https://search.google.com/local/writereview?placeid=example',
          retrievedAt: new Date('2026-09-30T09:00:00.000Z'),
          sourceEpoch: 4,
          profileVersion: 7,
        },
        createdBy: 'manager-1',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      }),
    ).toThrow(
      'The guest wording for German isn’t ready yet, so that language can’t be published',
    )
  })
})
