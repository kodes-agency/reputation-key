import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  digestPortalPublicationConfiguration,
  verifyPortalPublicationSnapshot,
} from '../application/portal-publication-snapshot'
import { buildLegacyPortalPublicationSnapshot } from '../application/__fixtures__/legacy-snapshot-builder'
import { PORTAL_LANGUAGE_PACK_VERSIONS } from '../domain/portal-publication-snapshot'
import { snapshotMirrorColumns } from './mappers/portal-publication-snapshot.mapper'
import {
  GOLDEN_BUILDER_INPUTS,
  GOLDEN_SNAPSHOT_ROWS,
} from '../application/__fixtures__/publication-snapshots.golden'
import { GOLDEN_V3_BG_PRIMARY_ROW } from '../application/__fixtures__/publication-snapshot-v3.golden'
import { snapshotFromRow } from './repositories/portal-publication.repository'

const goldenRows = Object.entries({
  ...GOLDEN_SNAPSHOT_ROWS,
  v3BgPrimary: GOLDEN_V3_BG_PRIMARY_ROW,
})

function sha256OfCanonicalConfiguration(configuration: unknown): string {
  return createHash('sha256')
    .update(canonicalizeRfc8785(configuration), 'utf8')
    .digest('hex')
}

describe('golden publication snapshots', () => {
  describe.each(goldenRows)('%s row', (_name, row) => {
    it('reads back through snapshotFromRow and verifies', () => {
      const snapshot = snapshotFromRow(row)

      expect(snapshot).not.toBeNull()
      expect(snapshot && verifyPortalPublicationSnapshot(snapshot)).toBe(true)
    })

    it('keeps the stored digest and the row identity unchanged when read', () => {
      const snapshot = snapshotFromRow(row)

      expect(snapshot?.configurationDigest).toBe(row.configurationDigest)
      expect(snapshot?.id).toBe(row.id)
      expect(snapshot?.version).toBe(row.version)
      expect(snapshot?.destinationUri).toBe(row.destinationUri)
    })

    it('carries the configuration through the zod parse without adding or dropping a field', () => {
      const snapshot = snapshotFromRow(row)

      expect(snapshot?.configuration).toEqual(row.configuration)
    })

    it('digests to the stored value: SHA-256 over the RFC 8785 canonical configuration', () => {
      expect(sha256OfCanonicalConfiguration(row.configuration)).toBe(
        row.configurationDigest,
      )
    })

    it('derives the row mirror columns from the configuration exactly as stored', () => {
      const snapshot = snapshotFromRow(row)

      expect(snapshot && snapshotMirrorColumns(snapshot.configuration)).toEqual({
        localeSet: row.localeSet,
        languagePackVersions: row.languagePackVersions,
        localizedContent: row.localizedContent,
        brandProfileVersion: row.brandProfileVersion,
      })
    })

    it('fails closed when one character of the stored digest changes', () => {
      const flipped = row.configurationDigest.replace(/^./u, (first) =>
        first === '0' ? '1' : '0',
      )

      const snapshot = snapshotFromRow({ ...row, configurationDigest: flipped })

      expect(snapshot).toBeNull()
    })
  })

  it('mirrors the locale columns of the v2 rows in the configuration', () => {
    const seeded = GOLDEN_SNAPSHOT_ROWS.v2Seeded
    const bgPrimary = GOLDEN_SNAPSHOT_ROWS.v2BgPrimary

    expect([seeded.guestLocale, seeded.localeSet]).toEqual(['en', ['en', 'bg']])
    expect([bgPrimary.guestLocale, bgPrimary.localeSet]).toEqual(['bg', ['bg', 'en']])
    expect(snapshotFromRow({ ...bgPrimary, guestLocale: 'en' })).toBeNull()
    expect(snapshotFromRow({ ...seeded, brandProfileVersion: 2 })).toBeNull()
  })

  it('rejects a stored row whose schema version this build does not know', () => {
    const seeded = GOLDEN_SNAPSHOT_ROWS.v2Seeded

    for (const schemaVersion of [0, 4, 99]) {
      const row = {
        ...seeded,
        configuration: { ...seeded.configuration, schemaVersion },
      }
      expect(snapshotFromRow(row)).toBeNull()
    }
  })

  it('makes the verifier itself refuse a re-digested unknown schema version', () => {
    const seeded = GOLDEN_SNAPSHOT_ROWS.v2Seeded
    const snapshot = snapshotFromRow(seeded)
    expect(snapshot).not.toBeNull()
    if (!snapshot) return

    for (const schemaVersion of [0, 4, 99]) {
      const configuration = { ...snapshot.configuration, schemaVersion }
      const redigested = {
        ...snapshot,
        configuration,
        configurationDigest: sha256OfCanonicalConfiguration(configuration),
      } as unknown as typeof snapshot
      expect(verifyPortalPublicationSnapshot(redigested)).toBe(false)
    }
  })

  it('refuses a v2 configuration relabelled v3, and a v3 one relabelled v2', () => {
    const v2 = GOLDEN_SNAPSHOT_ROWS.v2Seeded
    const v3 = GOLDEN_V3_BG_PRIMARY_ROW

    expect(
      snapshotFromRow({
        ...v2,
        configuration: { ...v2.configuration, schemaVersion: 3 },
      }),
    ).toBeNull()
    expect(
      snapshotFromRow({
        ...v3,
        configuration: { ...v3.configuration, schemaVersion: 2 },
      }),
    ).toBeNull()
  })

  describe('the v3 row', () => {
    const row = GOLDEN_V3_BG_PRIMARY_ROW

    it('is Bulgarian primary with English additional, mirrored in that order', () => {
      expect([row.guestLocale, row.localeSet]).toEqual(['bg', ['bg', 'en']])
      const snapshot = snapshotFromRow(row)

      expect(snapshot && snapshotMirrorColumns(snapshot.configuration).localeSet).toEqual(
        ['bg', 'en'],
      )
    })

    it('mirrors the look version in the brand profile version column', () => {
      expect(row.brandProfileVersion).toBe(3)
      expect(snapshotFromRow({ ...row, brandProfileVersion: 1 })).toBeNull()
    })

    it('refuses a row whose mirror columns disagree with its configuration', () => {
      expect(snapshotFromRow({ ...row, guestLocale: 'en' })).toBeNull()
      expect(snapshotFromRow({ ...row, localeSet: ['en', 'bg'] })).toBeNull()
      expect(snapshotFromRow({ ...row, localizedContent: {} })).toBeNull()
      expect(
        snapshotFromRow({
          ...row,
          languagePackVersions: { bg: 'guest-ui-bg-v2', en: 'guest-ui-en-v1' },
        }),
      ).toBeNull()
    })

    it('digests to its literal with the production digest function', () => {
      const snapshot = snapshotFromRow(row)

      expect(
        snapshot && digestPortalPublicationConfiguration(snapshot.configuration),
      ).toBe(row.configurationDigest)
    })

    it('keeps the optional provenance through the parse, so the digest still matches', () => {
      const snapshot = snapshotFromRow(row)

      expect(snapshot?.configuration).toHaveProperty('provenance.aiDraftTextKeys', [
        'title:en',
      ])
    })

    it('refuses a row digested over a field this reader does not know', () => {
      // zod strips the unknown key, so the digest recomputed on read no longer
      // matches the one stored at write. This is why the v3 shape is complete
      // in this release: a later field needs a v4 with its own reader first.
      const configuration = { ...row.configuration, futureField: { v: 4 } }
      const digested = {
        ...row,
        configuration,
        configurationDigest: sha256OfCanonicalConfiguration(configuration),
      }

      expect(snapshotFromRow(digested)).toBeNull()
    })

    it('rejects a configuration the v3 schema cannot type', () => {
      const { timeZone: _timeZone, ...withoutZone } = row.configuration

      expect(snapshotFromRow({ ...row, configuration: withoutZone })).toBeNull()
      expect(
        snapshotFromRow({
          ...row,
          configuration: {
            ...row.configuration,
            links: [{ ...row.configuration.links[0], url: 'http://example.com/reviews' }],
          },
        }),
      ).toBeNull()
    })
  })

  it('reproduces the hand-built v1 digest with the legacy test builder', () => {
    const built = buildLegacyPortalPublicationSnapshot(GOLDEN_BUILDER_INPUTS.v1)

    expect(built.configurationDigest).toBe(GOLDEN_SNAPSHOT_ROWS.v1.configurationDigest)
    expect(built.configuration).toEqual(GOLDEN_SNAPSHOT_ROWS.v1.configuration)
  })

  it('reproduces the hand-built Bulgarian-primary v2 digest with the legacy test builder', () => {
    const built = buildLegacyPortalPublicationSnapshot(GOLDEN_BUILDER_INPUTS.v2BgPrimary)

    expect(built.configurationDigest).toBe(
      GOLDEN_SNAPSHOT_ROWS.v2BgPrimary.configurationDigest,
    )
    expect(built.configuration).toEqual(GOLDEN_SNAPSHOT_ROWS.v2BgPrimary.configuration)
  })

  it('pins the language pack registry every v2 snapshot is written and compared with', () => {
    // The repository writes this map whole into each v2 snapshot and compares
    // its canonical form on read, so a new pack here would change what every
    // future digest covers.
    expect(PORTAL_LANGUAGE_PACK_VERSIONS).toEqual({
      en: 'guest-ui-en-v1',
      bg: 'guest-ui-bg-v1',
    })
  })
})
