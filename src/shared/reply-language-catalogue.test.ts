import { describe, expect, it } from 'vitest'
import {
  REPLY_LANGUAGE_TAG_SQL_PATTERN,
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from './reply-language-catalogue'

const sqlConstraintPattern = new RegExp(REPLY_LANGUAGE_TAG_SQL_PATTERN, 'u')

describe('reply-language parser and SQL constraint alignment', () => {
  it.each(['en-Latn', 'bg-Cyrl-BG', 'en-Latn-001'])(
    'accepts canonical supported tag %s in both boundaries',
    (value) => {
      expect(parseCanonicalReplyLanguageTag(value)).not.toBeNull()
      expect(sqlConstraintPattern.test(value)).toBe(true)
    },
  )

  it.each([
    'en',
    'en-latn',
    'en-Latn-us',
    'en-Latn-UK',
    'en-Latn-000',
    'sr-Cyrl-RS',
    'bg-Cyrl-BG-extra',
  ])('rejects invalid or unsupported tag %s in both boundaries', (value) => {
    expect(parseCanonicalReplyLanguageTag(value)).toBeNull()
    expect(sqlConstraintPattern.test(value)).toBe(false)
  })
})

describe('browser-safe review metadata mapping', () => {
  it.each([
    ['en-US', 'en-Latn-US'],
    ['bg-BG', 'bg-Cyrl-BG'],
    ['tr', 'tr-Latn'],
  ] as const)('maps %s to canonical reply tag %s', (metadata, tag) => {
    expect(mapReplyLanguageMetadata(metadata)).toMatchObject({
      status: 'supported',
      language: { tag },
    })
  })

  it.each([null, undefined, '', 'und', 'zxx'])(
    'keeps undetermined metadata %s unavailable as a reply target',
    (metadata) => {
      expect(mapReplyLanguageMetadata(metadata)).toEqual({
        status: 'supported',
        language: null,
      })
    },
  )

  it('does not manufacture a target for an unsupported language group', () => {
    expect(mapReplyLanguageMetadata('sr-Cyrl-RS')).toEqual({
      status: 'language_not_supported',
      reason: 'unsupported_group',
    })
  })
})
