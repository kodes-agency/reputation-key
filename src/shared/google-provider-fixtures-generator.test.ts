import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  replaceGoogleProviderFixtureAnchor,
  validateGoogleProviderFixtureCatalogueSource,
} from '../../scripts/generate-google-provider-fixtures'
import {
  GOOGLE_PROVIDER_FIXTURE_CATALOGUE_SHA256_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '../../test-fixtures/generated/google-provider-identifiers-v1'

type MutableCatalogue = {
  catalogueVersion: string
  entries: Array<{
    fixtureId: string
    kind: string
    literal: string
    valid: boolean
    expectedSegments: {
      accountId: string
      locationId: string | null
      reviewId: string | null
    } | null
    allowedGeneratedTargets: string[]
  }>
}

const catalogueUrl = new URL(
  '../../test-fixtures/google-provider-identifiers-v1.json',
  import.meta.url,
)
const source = await readFile(catalogueUrl, 'utf8')
const catalogue = JSON.parse(source) as MutableCatalogue
const serialize = (value: MutableCatalogue): string =>
  `${JSON.stringify(value, null, 2)}\n`

function mutateCatalogue(mutator: (draft: MutableCatalogue) => void): string {
  const draft = structuredClone(catalogue)
  mutator(draft)
  return serialize(draft)
}

describe('Google provider fixture catalogue generator contract', () => {
  it('binds the primary unmistakably synthetic review to the exact catalogue bytes', () => {
    expect(GOOGLE_REVIEW_PRIMARY_RESOURCE).toBe(
      [
        'accounts',
        GOOGLE_REVIEW_PRIMARY_SEGMENTS.accountId,
        'locations',
        GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId,
        'reviews',
        GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
      ].join('/'),
    )
    expect(GOOGLE_REVIEW_PRIMARY_RESOURCE).toContain('repkey-synthetic-do-not-use-')
    expect(GOOGLE_PROVIDER_FIXTURE_CATALOGUE_SHA256_V1).toBe(
      createHash('sha256').update(source, 'utf8').digest('hex'),
    )
    expect(validateGoogleProviderFixtureCatalogueSource(source).entries).toHaveLength(5)
  })

  it('rejects field, order, target, duplicate, and literal mutations', () => {
    const mutations = [
      mutateCatalogue((draft) => {
        draft.catalogueVersion = 'google-provider-identifiers-v2'
      }),
      mutateCatalogue((draft) => {
        ;[draft.entries[0], draft.entries[1]] = [draft.entries[1]!, draft.entries[0]!]
      }),
      mutateCatalogue((draft) => {
        draft.entries.at(-1)!.allowedGeneratedTargets = draft.entries
          .at(-1)!
          .allowedGeneratedTargets.slice(1)
      }),
      mutateCatalogue((draft) => {
        draft.entries[1]!.fixtureId = draft.entries[0]!.fixtureId
      }),
      mutateCatalogue((draft) => {
        draft.entries.at(-1)!.literal = draft.entries
          .at(-1)!
          .literal.replace('review-0001', 'review-0002')
      }),
    ]

    for (const mutation of mutations) {
      expect(() => validateGoogleProviderFixtureCatalogueSource(mutation)).toThrow(
        /catalogue|entries|fixture|allowedGeneratedTargets|google-review-primary/i,
      )
    }
  })

  it('rejects missing, duplicate, incomplete, and reversed documentation anchors', () => {
    const start = '<!-- google-provider-identifiers-v1:start -->'
    const end = '<!-- google-provider-identifiers-v1:end -->'
    const valid = `before\n${start}\nold\n${end}\nafter\n`
    const replacement = `${start}\nnew\n${end}`

    expect(replaceGoogleProviderFixtureAnchor(valid, replacement, 'doc.md')).toBe(
      `before\n${replacement}\nafter\n`,
    )
    for (const invalid of [
      'no anchors',
      `${start}\nmissing end`,
      `${start}\n${end}\n${start}\n${end}`,
      `${end}\n${start}`,
    ]) {
      expect(() =>
        replaceGoogleProviderFixtureAnchor(invalid, replacement, 'doc.md'),
      ).toThrow(/Google provider fixture anchor/i)
    }
  })
})
