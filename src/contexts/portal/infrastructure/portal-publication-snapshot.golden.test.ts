import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  buildPortalPublicationSnapshot,
  verifyPortalPublicationSnapshot,
} from '../application/portal-publication-snapshot'
import {
  PORTAL_LANGUAGE_PACK_VERSIONS,
  snapshotMirrorColumns,
} from '../domain/portal-publication-snapshot'
import {
  GOLDEN_BUILDER_INPUTS,
  GOLDEN_SNAPSHOT_ROWS,
} from '../application/__fixtures__/publication-snapshots.golden'
import { snapshotFromRow } from './repositories/portal-publication.repository'

const goldenRows = Object.entries(GOLDEN_SNAPSHOT_ROWS)

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

  it('fails closed on a schema version this build does not know', () => {
    const seeded = GOLDEN_SNAPSHOT_ROWS.v2Seeded

    for (const schemaVersion of [0, 3, 99]) {
      const row = {
        ...seeded,
        configuration: { ...seeded.configuration, schemaVersion },
      }
      expect(snapshotFromRow(row)).toBeNull()
    }
  })

  it('reproduces the hand-built v1 digest with the production builder', () => {
    const built = buildPortalPublicationSnapshot(GOLDEN_BUILDER_INPUTS.v1)

    expect(built.configurationDigest).toBe(GOLDEN_SNAPSHOT_ROWS.v1.configurationDigest)
    expect(built.configuration).toEqual(GOLDEN_SNAPSHOT_ROWS.v1.configuration)
  })

  it('reproduces the hand-built Bulgarian-primary v2 digest with the production builder', () => {
    const built = buildPortalPublicationSnapshot(GOLDEN_BUILDER_INPUTS.v2BgPrimary)

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
