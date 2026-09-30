import { describe, expect, it } from 'vitest'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import { LEGACY_V1_LANGUAGE_PACK } from '../../domain/portal-publication-snapshot'
import { snapshotMirrorColumns } from './portal-publication-snapshot.mapper'

describe('snapshotMirrorColumns', () => {
  it('mirrors a v3 configuration from its own locales, never the v1 English default', () => {
    const bulgarianPrimary = immersiveConfiguration({
      guestLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v2',
      localeSet: ['bg', 'en'],
    })

    const mirror = snapshotMirrorColumns(bulgarianPrimary)

    expect(mirror.localeSet).toEqual(['bg', 'en'])
    expect(mirror.languagePackVersions).toEqual(bulgarianPrimary.languagePackVersions)
    expect(mirror.localizedContent).toBe(bulgarianPrimary.localizedContent)
  })

  it('mirrors the v3 look version in the brand profile version column', () => {
    const configuration = immersiveConfiguration()

    expect(snapshotMirrorColumns(configuration).brandProfileVersion).toBe(
      configuration.brandProfile.lookVersion,
    )
  })

  it('keeps the literal English v1 default for a configuration with no locales', () => {
    const legacy = {
      schemaVersion: 1,
      guestLocale: 'en',
      languagePackVersion: LEGACY_V1_LANGUAGE_PACK,
    } as unknown as Parameters<typeof snapshotMirrorColumns>[0]

    expect(snapshotMirrorColumns(legacy)).toEqual({
      localeSet: ['en'],
      languagePackVersions: { en: LEGACY_V1_LANGUAGE_PACK },
      localizedContent: {},
      brandProfileVersion: null,
    })
  })
})
