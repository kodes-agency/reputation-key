import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './canonical-json'
import { normalizeGooglePrimaryCategory } from './domain/google-primary-category'
import { REVIEW_CAUSE_PHRASE_PATTERN } from './review-analysis-v3'
import catalogueSource from './review-vocabulary-hints-v1.json'
import { REVIEW_TOPICS_V3, type ReviewTopicV3 } from './review-topic-taxonomy'

// Vocabulary hints (review-vocabulary-hints-v1): per kind of business, the
// everyday names guests give things ("front desk", "air conditioning", "massage
// pressure"), offered to the model as suggestions for the `thing` of a mention.
// A hint is not a topic and not evidence: the model must not infer a mention
// because a hint exists.
//
// Hints are request context, not analysis semantics. Which set a request used is
// recorded on its operation (id, version, digest), and the catalogue is NOT part
// of any operation-profile or runtime digest (`review-analysis-v3-artifacts.ts`),
// so adding a kind of business or editing a hint changes what future requests
// send and re-analyses nothing. A change to the topics, the cause shape, the
// sentence rule or the normalizer is not a hint change and moves a profile.
//
// The set is chosen from the Property's Google primary category by an exact
// lookup after NFKC, whitespace, trim and case-folding, and falls back to the
// generic set. There is no substring guessing: "Barber shop" is not a bar.

export const REVIEW_VOCABULARY_HINTS_VERSION = 'review-vocabulary-hints-v1' as const
export const GENERIC_VOCABULARY_HINT_SET_ID = 'generic-service' as const

/** A prompt budget, not a taste: hints ride in every request. */
export const VOCABULARY_HINTS_MAX_PER_TOPIC = 16
export const VOCABULARY_HINTS_MAX_PER_SET = 120
export const REVIEW_PROPERTY_CONTEXT_MAX_BYTES = 4_096

const SET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const SET_DIGEST_DOMAIN = 'repkey-review-vocabulary-hint-set-v1\0'
const CATALOGUE_DIGEST_DOMAIN = 'repkey-review-vocabulary-hints-catalogue-v1\0'

export type VocabularyHints = Partial<Record<ReviewTopicV3, readonly string[]>>

export type VocabularyHintSet = Readonly<{
  id: string
  version: typeof REVIEW_VOCABULARY_HINTS_VERSION
  /** Google display names that choose this set, as Google writes them. */
  categoryAliases: readonly string[]
  hints: Readonly<VocabularyHints>
}>

/** What an operation records about the hints its request carried. */
export type VocabularyHintIdentity = Readonly<{
  setId: string
  setVersion: typeof REVIEW_VOCABULARY_HINTS_VERSION
  /** Over the set's id, version and hints, never its aliases. */
  digest: string
}>

const hintPhraseSchema = z
  .string()
  .max(80)
  .regex(REVIEW_CAUSE_PHRASE_PATTERN, 'a hint is one to three lowercase words')

const hintsSchema = z.partialRecord(
  z.enum(REVIEW_TOPICS_V3),
  z.array(hintPhraseSchema).min(1).max(VOCABULARY_HINTS_MAX_PER_TOPIC),
)

const catalogueSchema = z
  .object({
    version: z.literal(REVIEW_VOCABULARY_HINTS_VERSION),
    sets: z
      .array(
        z
          .object({
            id: z.string().regex(SET_ID_PATTERN),
            categoryAliases: z.array(z.string().min(1).max(512)),
            hints: hintsSchema,
          })
          .strict(),
      )
      .min(2),
  })
  .strict()

/** The form an alias is compared in: what `normalizeGooglePrimaryCategory` stores, case-folded. */
function aliasKey(category: string | null | undefined): string | null {
  const normalized = normalizeGooglePrimaryCategory(category)
  return normalized === null ? null : normalized.toLowerCase()
}

function parseCatalogue(source: unknown): readonly VocabularyHintSet[] {
  const parsed = catalogueSchema.parse(source)
  const ids = new Set<string>()
  const aliasOwner = new Map<string, string>()
  const sets = parsed.sets.map((entry): VocabularyHintSet => {
    if (ids.has(entry.id))
      throw new Error(`vocabulary hint set ${entry.id} is listed twice`)
    ids.add(entry.id)
    let total = 0
    for (const [topic, phrases] of Object.entries(entry.hints)) {
      if (new Set(phrases).size !== phrases.length) {
        throw new Error(`vocabulary hint set ${entry.id} repeats a hint under ${topic}`)
      }
      total += phrases.length
    }
    if (total > VOCABULARY_HINTS_MAX_PER_SET) {
      throw new Error(`vocabulary hint set ${entry.id} holds ${total} hints`)
    }
    for (const alias of entry.categoryAliases) {
      const key = aliasKey(alias)
      if (key === null || normalizeGooglePrimaryCategory(alias) !== alias) {
        throw new Error(`vocabulary hint alias '${alias}' is not in stored form`)
      }
      const owner = aliasOwner.get(key)
      if (owner !== undefined) {
        throw new Error(
          `vocabulary hint alias '${alias}' belongs to ${owner} and ${entry.id}`,
        )
      }
      aliasOwner.set(key, entry.id)
    }
    return deepFreeze({
      id: entry.id,
      version: parsed.version,
      categoryAliases: entry.categoryAliases,
      hints: entry.hints,
    })
  })
  const generic = sets.find((entry) => entry.id === GENERIC_VOCABULARY_HINT_SET_ID)
  if (generic === undefined || generic.categoryAliases.length > 0) {
    throw new Error(
      `the catalogue needs a ${GENERIC_VOCABULARY_HINT_SET_ID} set with no aliases: it is the fallback`,
    )
  }
  return Object.freeze(sets)
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function digestOf(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

/** What a request carries from a set, and so what its digest covers. */
export function vocabularyHintSetDigest(
  set: Pick<VocabularyHintSet, 'id' | 'version' | 'hints'>,
): string {
  return digestOf(SET_DIGEST_DOMAIN, {
    id: set.id,
    version: set.version,
    hints: set.hints,
  })
}

export const VOCABULARY_HINT_SETS: readonly VocabularyHintSet[] =
  parseCatalogue(catalogueSource)

/** Over the whole file, aliases included: the manifest pins it so a catalogue edit is reviewed. */
export const REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST = digestOf(
  CATALOGUE_DIGEST_DOMAIN,
  catalogueSource,
)

const SET_BY_ALIAS: ReadonlyMap<string, VocabularyHintSet> = new Map(
  VOCABULARY_HINT_SETS.flatMap((set) =>
    set.categoryAliases.flatMap((alias) => {
      const key = aliasKey(alias)
      return key === null ? [] : [[key, set] as const]
    }),
  ),
)

const GENERIC_SET: VocabularyHintSet = (() => {
  const generic = VOCABULARY_HINT_SETS.find(
    (entry) => entry.id === GENERIC_VOCABULARY_HINT_SET_ID,
  )
  if (generic === undefined) throw new Error('the generic vocabulary hint set is missing')
  return generic
})()

/** The set for a Google primary category: an exact alias, or the generic fallback. */
export function selectVocabularyHintSet(
  googlePrimaryCategory: string | null | undefined,
): VocabularyHintSet {
  const key = aliasKey(googlePrimaryCategory)
  return (key === null ? undefined : SET_BY_ALIAS.get(key)) ?? GENERIC_SET
}

export function vocabularyHintIdentity(set: VocabularyHintSet): VocabularyHintIdentity {
  return Object.freeze({
    setId: set.id,
    setVersion: set.version,
    digest: vocabularyHintSetDigest(set),
  })
}

/**
 * What a review-analysis request carries about the Property, beside the review's
 * sentences (contract §4). `googlePrimaryCategory` is the stored display name, or
 * null; the hints are the chosen set's. Nothing here names the Property or a guest.
 */
export const reviewPropertyContextSchema = z
  .object({
    googlePrimaryCategory: z.string().min(1).max(512).nullable(),
    vocabularyHintSetId: z.string().regex(SET_ID_PATTERN),
    vocabularyHintSetVersion: z.literal(REVIEW_VOCABULARY_HINTS_VERSION),
    vocabularyHints: hintsSchema,
  })
  .strict()

export type ReviewPropertyContext = z.infer<typeof reviewPropertyContextSchema>

export type ResolvedReviewPropertyContext = Readonly<{
  propertyContext: ReviewPropertyContext
  /** For the operation row and the request fingerprint. */
  hintIdentity: VocabularyHintIdentity
}>

/** Choose the hints for a Property and say which set they came from. */
export function resolveReviewPropertyContext(
  googlePrimaryCategory: string | null | undefined,
): ResolvedReviewPropertyContext {
  const set = selectVocabularyHintSet(googlePrimaryCategory)
  const propertyContext = reviewPropertyContextSchema.parse({
    googlePrimaryCategory: normalizeGooglePrimaryCategory(googlePrimaryCategory),
    vocabularyHintSetId: set.id,
    vocabularyHintSetVersion: set.version,
    vocabularyHints: structuredClone(set.hints),
  })
  const bytes = new TextEncoder().encode(JSON.stringify(propertyContext)).byteLength
  if (bytes > REVIEW_PROPERTY_CONTEXT_MAX_BYTES) {
    throw new Error(`the property context is ${bytes} bytes`)
  }
  return Object.freeze({ propertyContext, hintIdentity: vocabularyHintIdentity(set) })
}

/**
 * Whether a request's property context is exactly what the identity recorded on
 * its operation says it was: the same set, and hints that hash to the same
 * digest. A request whose hints moved after the operation was claimed fails here
 * instead of being sent under a record that no longer describes it.
 */
export function propertyContextMatchesHintIdentity(
  context: ReviewPropertyContext,
  identity: VocabularyHintIdentity,
): boolean {
  return (
    context.vocabularyHintSetId === identity.setId &&
    context.vocabularyHintSetVersion === identity.setVersion &&
    vocabularyHintSetDigest({
      id: context.vocabularyHintSetId,
      version: context.vocabularyHintSetVersion,
      hints: context.vocabularyHints,
    }) === identity.digest
  )
}
