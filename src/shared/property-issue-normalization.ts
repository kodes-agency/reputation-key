import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './canonical-json'
import {
  REVIEW_CAUSE_PHRASE_MAX_LENGTH,
  REVIEW_CAUSE_PHRASE_PATTERN,
} from './review-analysis-v3'
import { REVIEW_TOPICS_V3, type ReviewTopicV3 } from './review-topic-taxonomy'
import catalogueSource from './property-issue-normalization-v1.json'

// Property issue normalization is deterministic product vocabulary, not a
// model or a learned cross-Property catalogue. A reviewed catalogue edit moves
// this digest and its manifest, but does not regroup history: stored member rows
// win before the catalogue is consulted. It therefore needs neither an epoch
// bump nor re-analysis.

export const PROPERTY_ISSUE_NORMALIZATION_VERSION =
  'property-issue-normalization-v1' as const
export const TOPIC_LEVEL_ISSUE_KEY = '__topic__' as const

const RULE_VERSION = 'property-issue-normalization-rules-v1' as const
const DIGEST_DOMAIN = 'repkey-property-issue-normalization-catalogue-v1\0'
const INPUT_LENGTH_BOUND = 256
const APOSTROPHE_VARIANTS = /[\u2018\u2019\u02bc\uff07]/gu
const DASH_VARIANTS = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/gu
const SURROUNDING_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

const phraseSchema = z
  .string()
  .max(REVIEW_CAUSE_PHRASE_MAX_LENGTH)
  .regex(REVIEW_CAUSE_PHRASE_PATTERN)

const catalogueSchema = z
  .object({
    version: z.literal(PROPERTY_ISSUE_NORMALIZATION_VERSION),
    ruleVersion: z.literal(RULE_VERSION),
    singularization: z.record(phraseSchema, phraseSchema),
    synonyms: z.partialRecord(
      z.enum(REVIEW_TOPICS_V3),
      z.record(phraseSchema, phraseSchema),
    ),
  })
  .strict()

type Catalogue = z.infer<typeof catalogueSchema>

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  Object.values(value).forEach((child) => deepFreeze(child))
  return Object.freeze(value)
}

function validateCatalogue(catalogue: Catalogue): Catalogue {
  for (const [topic, entries] of Object.entries(catalogue.synonyms)) {
    for (const [alias, canonical] of Object.entries(entries ?? {})) {
      if (entries?.[canonical] !== undefined) {
        throw new Error(`property issue synonym chain under ${topic}: ${alias}`)
      }
    }
  }
  return deepFreeze(catalogue)
}

const CATALOGUE = validateCatalogue(catalogueSchema.parse(catalogueSource))

export const PROPERTY_ISSUE_NORMALIZATION_DIGEST = createHash('sha256')
  .update(DIGEST_DOMAIN, 'utf8')
  .update(
    canonicalizeRfc8785({
      ruleVersion: RULE_VERSION,
      catalogue: CATALOGUE,
    }),
    'utf8',
  )
  .digest('hex')

export type NormalizedIssueThing = Readonly<{
  memberKey: string
  canonicalKey: string
  canonicalThing: string | null
}>

function invalidThing(): never {
  throw new Error('Property issue thing does not fit the stored cause phrase contract')
}

/**
 * A phrase as the stored cause contract holds it: Unicode-folded, lowercase, one space
 * between words, no surrounding punctuation, one to three words. It throws on one that
 * does not fit. A manager's words for a cause pass through it too.
 */
function normalizeStoredPhrase(thing: string): string {
  let normalized = thing
    .normalize('NFKC')
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(DASH_VARIANTS, '-')
    .replace(/\s+/gu, ' ')
    .trim()
  if (normalized.length > INPUT_LENGTH_BOUND) invalidThing()
  normalized = normalized.replace(SURROUNDING_PUNCTUATION, '').trim()
  if (
    normalized.length > REVIEW_CAUSE_PHRASE_MAX_LENGTH ||
    !REVIEW_CAUSE_PHRASE_PATTERN.test(normalized)
  ) {
    invalidThing()
  }
  return normalized
}

function singularizeLastWord(phrase: string): string {
  const words = phrase.split(' ')
  const lastIndex = words.length - 1
  const lastWord = words[lastIndex]
  if (lastWord === undefined) return phrase
  const singular = CATALOGUE.singularization[lastWord]
  if (singular === undefined) return phrase
  return [...words.slice(0, lastIndex), singular].join(' ')
}

/**
 * Resolve one stored `thing` to its observed member key and stable canonical
 * key. `a/c` is intentionally absent from the catalogue: the stored cause
 * contract cannot contain a slash, so it cannot be an observed member.
 */
export function normalizeIssueThing(
  topic: ReviewTopicV3,
  thing: string | null,
): NormalizedIssueThing {
  if (thing === null) {
    return Object.freeze({
      memberKey: TOPIC_LEVEL_ISSUE_KEY,
      canonicalKey: TOPIC_LEVEL_ISSUE_KEY,
      canonicalThing: null,
    })
  }
  const memberKey = singularizeLastWord(normalizeStoredPhrase(thing))
  const canonicalKey = CATALOGUE.synonyms[topic]?.[memberKey] ?? memberKey
  if (
    canonicalKey.length > REVIEW_CAUSE_PHRASE_MAX_LENGTH ||
    !REVIEW_CAUSE_PHRASE_PATTERN.test(canonicalKey)
  ) {
    throw new Error('Property issue catalogue produced an invalid canonical key')
  }
  return Object.freeze({ memberKey, canonicalKey, canonicalThing: canonicalKey })
}

/**
 * A cause phrase a person typed, as the stored contract holds it; null when it does not
 * fit (empty, more than three words, or anything but letters and hyphens).
 */
export function normalizeCausePhrase(text: string): string | null {
  try {
    return normalizeStoredPhrase(text)
  } catch {
    return null
  }
}
