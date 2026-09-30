import { describe, expect, it } from 'vitest'
import {
  currentGuestLanguagePack,
  isSupportedGuestLanguagePack,
} from '#/shared/domain/guest-locale'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  languagePackGenerationOf,
  LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION,
  PORTAL_PUBLICATION_SCHEMA_VERSION,
} from '../domain/portal-publication-snapshot'
import {
  immersiveConfiguration,
  immersiveSnapshot,
  immersiveSnapshotWith,
} from './__fixtures__/immersive-snapshot'
import {
  digestPortalPublicationConfiguration,
  verifyPortalPublicationSnapshot,
} from './portal-publication-snapshot'

describe('schema version 3 build and verify', () => {
  it('verifies a complete snapshot built by the test-only builder', () => {
    expect(verifyPortalPublicationSnapshot(immersiveSnapshot())).toBe(true)
  })

  it('digests the exact configuration: any changed field changes the digest', () => {
    const digest = (overrides: Parameters<typeof immersiveConfiguration>[0]) =>
      digestPortalPublicationConfiguration(immersiveConfiguration(overrides))

    expect(digest({})).toBe(digest({}))
    expect(digest({ timeZone: 'Europe/London' })).not.toBe(digest({}))
    expect(digest({ linktree: { enabled: false } })).not.toBe(digest({}))
    expect(digest({ provenance: { aiDraftTextKeys: ['title:bg'] } })).not.toBe(digest({}))
  })

  it('verifies a snapshot that carries provenance, which is history only', () => {
    expect(
      verifyPortalPublicationSnapshot(
        immersiveSnapshotWith({ provenance: { aiDraftTextKeys: ['title:bg'] } }),
      ),
    ).toBe(true)
  })

  it('fails closed when stored content no longer matches its digest', () => {
    const snapshot = immersiveSnapshot()
    const tampered = {
      ...snapshot,
      configuration: immersiveConfiguration({ timeZone: 'Europe/London' }),
    }

    expect(verifyPortalPublicationSnapshot(tampered)).toBe(false)
  })

  it('fails closed when the row disagrees with the configuration it carries', () => {
    const snapshot = immersiveSnapshot()

    expect(
      verifyPortalPublicationSnapshot({ ...snapshot, destinationSourceEpoch: 99 }),
    ).toBe(false)
    expect(
      verifyPortalPublicationSnapshot({
        ...snapshot,
        destinationUri: 'https://search.google.com/local/writereview?placeid=other',
      }),
    ).toBe(false)
    expect(verifyPortalPublicationSnapshot({ ...snapshot, portalId: 'portal-x' })).toBe(
      false,
    )
  })

  it('fails closed on an incomplete configuration even with a matching digest', () => {
    const incomplete = immersiveSnapshotWith({
      languagePackVersions: { en: 'guest-ui-en-v2' },
    })

    expect(verifyPortalPublicationSnapshot(incomplete)).toBe(false)
  })
})

describe('pack generation is bound to the schema version', () => {
  it.each([
    [LEGACY_PORTAL_PUBLICATION_SCHEMA_VERSION, 1],
    [PORTAL_PUBLICATION_SCHEMA_VERSION, 1],
    [IMMERSIVE_HUB_SCHEMA_VERSION, 2],
  ] as const)('schema version %i carries generation %i packs', (version, generation) => {
    expect(languagePackGenerationOf(version)).toBe(generation)
  })

  it('rejects a v3 snapshot carrying generation 1 packs', () => {
    const withV1Packs = immersiveSnapshotWith({
      languagePackVersion: 'guest-ui-en-v1',
      languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
    })

    expect(verifyPortalPublicationSnapshot(withV1Packs)).toBe(false)
  })

  it('has a current generation 2 pack for every locale a v3 snapshot can carry today', () => {
    const { localeSet, languagePackVersions } = immersiveConfiguration()

    for (const locale of localeSet) {
      expect(languagePackVersions[locale]).toBe(currentGuestLanguagePack(locale, 2))
      expect(isSupportedGuestLanguagePack(locale, languagePackVersions[locale], 2)).toBe(
        true,
      )
      expect(isSupportedGuestLanguagePack(locale, languagePackVersions[locale], 1)).toBe(
        false,
      )
    }
  })

  it('serves no snapshot whose locale has no generation 2 pack yet', () => {
    const german = immersiveSnapshotWith({
      guestLocale: 'de',
      languagePackVersion: 'guest-ui-de-v2',
      localeSet: ['de'],
      languagePackVersions: { de: 'guest-ui-de-v2' },
      localizedContent: { de: immersiveConfiguration().localizedContent.en },
      links: [],
    })

    expect(verifyPortalPublicationSnapshot(german)).toBe(false)
  })
})
