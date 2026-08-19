import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

export const AI_PROPERTY_TREND_CONTRACT_VERSION = 'property-trend-v1' as const
export const AI_TREND_RENDER_PROFILE_VERSION = 'trend-render-v1' as const

export type ClosedTrendSignalId =
  | `sentiment.${'positive' | 'neutral' | 'negative' | 'mixed'}.${'up' | 'down'}`
  | `attention.${'urgent' | 'high' | 'medium' | 'low'}.${'up' | 'down'}`
  | `category.${
      | 'service'
      | 'staff'
      | 'quality'
      | 'value'
      | 'cleanliness'
      | 'wait_time'
      | 'atmosphere'
      | 'location'
      | 'accessibility'
      | 'other'}.${'up' | 'down'}`

export const CLOSED_TREND_SIGNAL_IDS = Object.freeze([
  'attention.high.down',
  'attention.high.up',
  'attention.low.down',
  'attention.low.up',
  'attention.medium.down',
  'attention.medium.up',
  'attention.urgent.down',
  'attention.urgent.up',
  'category.accessibility.down',
  'category.accessibility.up',
  'category.atmosphere.down',
  'category.atmosphere.up',
  'category.cleanliness.down',
  'category.cleanliness.up',
  'category.location.down',
  'category.location.up',
  'category.other.down',
  'category.other.up',
  'category.quality.down',
  'category.quality.up',
  'category.service.down',
  'category.service.up',
  'category.staff.down',
  'category.staff.up',
  'category.value.down',
  'category.value.up',
  'category.wait_time.down',
  'category.wait_time.up',
  'sentiment.mixed.down',
  'sentiment.mixed.up',
  'sentiment.negative.down',
  'sentiment.negative.up',
  'sentiment.neutral.down',
  'sentiment.neutral.up',
  'sentiment.positive.down',
  'sentiment.positive.up',
] as const satisfies readonly ClosedTrendSignalId[])

/**
 * Property-local derivative aggregates for one seven-day window.
 *
 * There is deliberately NO mean-valence member. The model's `sentimentValence`
 * is consumed only by the attention rule and is never persisted, so no honest
 * per-window valence sum exists; a share-derived proxy under a mean-valence
 * label would report a fabricated statistic (and would feed it to the provider).
 */
export type DeterministicAggregateWindow = Readonly<{
  reviewCount: number
  sentimentCounts: Readonly<{
    positive: number
    neutral: number
    negative: number
    mixed: number
  }>
  attentionCounts: Readonly<{
    urgent: number
    high: number
    medium: number
    low: number
  }>
  categoryCounts: Readonly<{
    service: number
    staff: number
    quality: number
    value: number
    cleanliness: number
    waitTime: number
    atmosphere: number
    location: number
    accessibility: number
    other: number
  }>
}>

export type DeterministicTrendCandidate = Readonly<{
  id: ClosedTrendSignalId
  baselineNumerator: number
  baselineDenominator: number
  currentNumerator: number
  currentDenominator: number
}>

export type AiPropertyTrendSource = Readonly<{
  languageCode: 'en'
  currentWindow: DeterministicAggregateWindow
  baselineWindow: DeterministicAggregateWindow
  candidates: readonly DeterministicTrendCandidate[]
}>

export function encodeCanonicalAiPropertyTrendSource(
  source: AiPropertyTrendSource,
): Uint8Array {
  return new TextEncoder().encode(`\u0002${canonicalizeRfc8785(source)}`)
}

export type PropertyTrendRender = Readonly<{
  headline:
    | 'Review signals improved'
    | 'Review signals need attention'
    | 'Notable review changes'
  /**
   * Dominant polarity of the selected signals. `stable` means "no polarised
   * signal was selected" (neutral-sentiment/category shifts are material but
   * directionless) — never "no material change".
   */
  direction: 'improving' | 'stable' | 'declining'
  sentences: readonly string[]
  summary: string
}>

const nonnegativeSafeInteger = z.number().int().nonnegative().safe()
const safeInteger = z.number().int().safe()
const sentimentCountsSchema = z
  .object({
    positive: nonnegativeSafeInteger,
    neutral: nonnegativeSafeInteger,
    negative: nonnegativeSafeInteger,
    mixed: nonnegativeSafeInteger,
  })
  .strict()
const attentionCountsSchema = z
  .object({
    urgent: nonnegativeSafeInteger,
    high: nonnegativeSafeInteger,
    medium: nonnegativeSafeInteger,
    low: nonnegativeSafeInteger,
  })
  .strict()
const categoryCountsSchema = z
  .object({
    service: nonnegativeSafeInteger,
    staff: nonnegativeSafeInteger,
    quality: nonnegativeSafeInteger,
    value: nonnegativeSafeInteger,
    cleanliness: nonnegativeSafeInteger,
    waitTime: nonnegativeSafeInteger,
    atmosphere: nonnegativeSafeInteger,
    location: nonnegativeSafeInteger,
    accessibility: nonnegativeSafeInteger,
    other: nonnegativeSafeInteger,
  })
  .strict()
const aggregateWindowSchema = z
  .object({
    reviewCount: nonnegativeSafeInteger,
    sentimentCounts: sentimentCountsSchema,
    attentionCounts: attentionCountsSchema,
    categoryCounts: categoryCountsSchema,
  })
  .strict()
const candidateSchema = z
  .object({
    id: z.enum(CLOSED_TREND_SIGNAL_IDS),
    baselineNumerator: safeInteger,
    baselineDenominator: nonnegativeSafeInteger,
    currentNumerator: safeInteger,
    currentDenominator: nonnegativeSafeInteger,
  })
  .strict()
const selectionSchema = z
  .object({
    selectedSignalIds: z.array(z.enum(CLOSED_TREND_SIGNAL_IDS)).min(1).max(4),
    candidates: z.array(candidateSchema).min(1).max(12),
  })
  .strict()

function sum(values: readonly number[]): bigint {
  let result = 0n
  for (const value of values) result += BigInt(value)
  return result
}

function freezeWindow(
  value: z.infer<typeof aggregateWindowSchema>,
): DeterministicAggregateWindow {
  return Object.freeze({
    reviewCount: value.reviewCount,
    sentimentCounts: Object.freeze({ ...value.sentimentCounts }),
    attentionCounts: Object.freeze({ ...value.attentionCounts }),
    categoryCounts: Object.freeze({ ...value.categoryCounts }),
  })
}

export function validateDeterministicAggregateWindow(
  value: unknown,
): DeterministicAggregateWindow {
  const parsed = aggregateWindowSchema.parse(value)
  const reviewCount = BigInt(parsed.reviewCount)
  if (parsed.reviewCount < 10)
    throw new TypeError('aggregate window requires at least ten ready analyses')
  if (sum(Object.values(parsed.sentimentCounts)) !== reviewCount) {
    throw new TypeError('sentiment counts must sum to reviewCount')
  }
  if (sum(Object.values(parsed.attentionCounts)) !== reviewCount) {
    throw new TypeError('attention counts must sum to reviewCount')
  }
  if (sum(Object.values(parsed.categoryCounts)) !== reviewCount) {
    throw new TypeError('category counts must sum to reviewCount')
  }
  return freezeWindow(parsed)
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

function direction(delta: bigint): 'up' | 'down' {
  if (delta === 0n) throw new TypeError('zero delta is not a trend candidate')
  return delta > 0n ? 'up' : 'down'
}

type ScoredCandidate = Readonly<{
  candidate: DeterministicTrendCandidate
  scoreNumerator: bigint
  scoreDenominator: bigint
}>

function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  const comparison =
    left.scoreNumerator * right.scoreDenominator -
    right.scoreNumerator * left.scoreDenominator
  if (comparison > 0n) return -1
  if (comparison < 0n) return 1
  return left.candidate.id < right.candidate.id
    ? -1
    : left.candidate.id > right.candidate.id
      ? 1
      : 0
}

function shareCandidate(
  input: Readonly<{
    family: 'sentiment' | 'attention' | 'category'
    name: string
    baselineNumerator: number
    currentNumerator: number
    baselineCount: number
    currentCount: number
    categoryPrevalenceRequired: boolean
  }>,
): ScoredCandidate | null {
  const baselineCount = BigInt(input.baselineCount)
  const currentCount = BigInt(input.currentCount)
  const baselineNumerator = BigInt(input.baselineNumerator)
  const currentNumerator = BigInt(input.currentNumerator)
  const delta = currentNumerator * baselineCount - baselineNumerator * currentCount
  if (delta === 0n) return null
  const denominatorProduct = currentCount * baselineCount
  if (absolute(delta) * 100n < 10n * denominatorProduct) return null
  if (
    input.categoryPrevalenceRequired &&
    currentNumerator * 10n < currentCount &&
    baselineNumerator * 10n < baselineCount
  )
    return null

  return {
    candidate: Object.freeze({
      id: `${input.family}.${input.name}.${direction(delta)}` as ClosedTrendSignalId,
      baselineNumerator: input.baselineNumerator,
      baselineDenominator: input.baselineCount,
      currentNumerator: input.currentNumerator,
      currentDenominator: input.currentCount,
    }),
    scoreNumerator: absolute(delta) * 10n,
    scoreDenominator: denominatorProduct,
  }
}

const SENTIMENT_NAMES = ['positive', 'neutral', 'negative', 'mixed'] as const
const ATTENTION_NAMES = ['urgent', 'high', 'medium', 'low'] as const
const CATEGORY_NAMES = [
  ['service', 'service'],
  ['staff', 'staff'],
  ['quality', 'quality'],
  ['value', 'value'],
  ['cleanliness', 'cleanliness'],
  ['wait_time', 'waitTime'],
  ['atmosphere', 'atmosphere'],
  ['location', 'location'],
  ['accessibility', 'accessibility'],
  ['other', 'other'],
] as const

export function computeDeterministicTrendCandidates(
  input: Readonly<{
    currentWindow: DeterministicAggregateWindow
    baselineWindow: DeterministicAggregateWindow
  }>,
): readonly DeterministicTrendCandidate[] {
  const current = validateDeterministicAggregateWindow(input.currentWindow)
  const baseline = validateDeterministicAggregateWindow(input.baselineWindow)
  const scored: ScoredCandidate[] = []

  for (const name of SENTIMENT_NAMES) {
    const item = shareCandidate({
      family: 'sentiment',
      name,
      baselineNumerator: baseline.sentimentCounts[name],
      currentNumerator: current.sentimentCounts[name],
      baselineCount: baseline.reviewCount,
      currentCount: current.reviewCount,
      categoryPrevalenceRequired: false,
    })
    if (item !== null) scored.push(item)
  }
  for (const name of ATTENTION_NAMES) {
    const item = shareCandidate({
      family: 'attention',
      name,
      baselineNumerator: baseline.attentionCounts[name],
      currentNumerator: current.attentionCounts[name],
      baselineCount: baseline.reviewCount,
      currentCount: current.reviewCount,
      categoryPrevalenceRequired: false,
    })
    if (item !== null) scored.push(item)
  }
  for (const [idName, countName] of CATEGORY_NAMES) {
    const item = shareCandidate({
      family: 'category',
      name: idName,
      baselineNumerator: baseline.categoryCounts[countName],
      currentNumerator: current.categoryCounts[countName],
      baselineCount: baseline.reviewCount,
      currentCount: current.reviewCount,
      categoryPrevalenceRequired: true,
    })
    if (item !== null) scored.push(item)
  }
  scored.sort(compareScoredCandidates)
  return Object.freeze(scored.slice(0, 12).map(({ candidate }) => candidate))
}

function validateCandidate(candidate: DeterministicTrendCandidate): ScoredCandidate {
  if (candidate.baselineDenominator <= 0 || candidate.currentDenominator <= 0) {
    throw new TypeError('candidate denominators must be positive')
  }
  const baselineDenominator = BigInt(candidate.baselineDenominator)
  const currentDenominator = BigInt(candidate.currentDenominator)
  const baselineNumerator = BigInt(candidate.baselineNumerator)
  const currentNumerator = BigInt(candidate.currentNumerator)
  const delta =
    currentNumerator * baselineDenominator - baselineNumerator * currentDenominator
  if (!candidate.id.endsWith(`.${direction(delta)}`)) {
    throw new TypeError('candidate direction does not match its exact rational delta')
  }
  const denominatorProduct = baselineDenominator * currentDenominator
  // Every closed signal is a share signal: there is no mean-valence family.
  if (
    baselineNumerator < 0n ||
    currentNumerator < 0n ||
    baselineNumerator > baselineDenominator ||
    currentNumerator > currentDenominator ||
    absolute(delta) * 100n < 10n * denominatorProduct
  )
    throw new TypeError('invalid share candidate')
  if (
    candidate.id.startsWith('category.') &&
    baselineNumerator * 10n < baselineDenominator &&
    currentNumerator * 10n < currentDenominator
  )
    throw new TypeError('category candidate does not meet prevalence')
  return {
    candidate,
    scoreNumerator: absolute(delta) * 10n,
    scoreDenominator: denominatorProduct,
  }
}

export function validateTrendSelection(
  input: Readonly<{
    selectedSignalIds: readonly ClosedTrendSignalId[]
    candidates: readonly DeterministicTrendCandidate[]
  }>,
): readonly ClosedTrendSignalId[] {
  const parsed = selectionSchema.parse(input)
  const candidateIds = new Set<ClosedTrendSignalId>()
  let previous: ScoredCandidate | null = null
  for (const candidate of parsed.candidates) {
    const scored = validateCandidate(candidate)
    if (candidateIds.has(candidate.id)) throw new TypeError('duplicate trend candidate')
    if (previous !== null && compareScoredCandidates(previous, scored) > 0) {
      throw new TypeError('trend candidates are not in deterministic order')
    }
    candidateIds.add(candidate.id)
    previous = scored
  }
  const selected = new Set<ClosedTrendSignalId>()
  for (const id of parsed.selectedSignalIds) {
    if (selected.has(id)) throw new TypeError('duplicate selected trend signal')
    if (!candidateIds.has(id)) throw new TypeError('selected signal is not a candidate')
    selected.add(id)
  }
  return Object.freeze([...parsed.selectedSignalIds])
}

const LABEL_BY_SIGNAL_NAME: Readonly<Record<string, string>> = Object.freeze({
  positive: 'Positive sentiment',
  neutral: 'Neutral sentiment',
  negative: 'Negative sentiment',
  mixed: 'Mixed sentiment',
  urgent: 'Urgent attention',
  high: 'High attention',
  medium: 'Medium attention',
  low: 'Low attention',
  service: 'Service mentions',
  staff: 'Staff mentions',
  quality: 'Quality mentions',
  value: 'Value mentions',
  cleanliness: 'Cleanliness mentions',
  wait_time: 'Wait time mentions',
  atmosphere: 'Atmosphere mentions',
  location: 'Location mentions',
  accessibility: 'Accessibility mentions',
  other: 'Other topic mentions',
})
const FAVORABLE_SIGNALS: Readonly<Partial<Record<ClosedTrendSignalId, true>>> =
  Object.freeze({
    'sentiment.positive.up': true,
    'sentiment.negative.down': true,
    'sentiment.mixed.down': true,
    'attention.urgent.down': true,
    'attention.high.down': true,
    'attention.medium.down': true,
    'attention.low.up': true,
  })
const ATTENTION_SIGNALS: Readonly<Partial<Record<ClosedTrendSignalId, true>>> =
  Object.freeze({
    'sentiment.positive.down': true,
    'sentiment.negative.up': true,
    'sentiment.mixed.up': true,
    'attention.urgent.up': true,
    'attention.high.up': true,
    'attention.medium.up': true,
    'attention.low.down': true,
  })

const TREND_RENDER_MANIFEST = Object.freeze({
  version: AI_TREND_RENDER_PROFILE_VERSION,
  headlines: Object.freeze({
    favorable: 'Review signals improved',
    attention: 'Review signals need attention',
    mixed: 'Notable review changes',
  }),
  labels: LABEL_BY_SIGNAL_NAME,
  favorableSignalIds: Object.freeze(
    CLOSED_TREND_SIGNAL_IDS.filter((id) => FAVORABLE_SIGNALS[id] === true),
  ),
  attentionSignalIds: Object.freeze(
    CLOSED_TREND_SIGNAL_IDS.filter((id) => ATTENTION_SIGNALS[id] === true),
  ),
  shareSentence: '{label} rose|fell from {baseline}% to {current}%',
  directionRule: 'leading-signal-polarity-then-majority-polarity-then-stable',
  rounding: 'half-away-from-zero-to-one-decimal',
  maximumSummaryCharactersExclusive: 600,
})

export const AI_TREND_RENDER_PROFILE_DIGEST = createHash('sha256')
  .update('repkey-trend-render-v1\0', 'utf8')
  .update(canonicalizeRfc8785(TREND_RENDER_MANIFEST), 'utf8')
  .digest('hex')

const PROPERTY_TREND_CONTRACT_MANIFEST = Object.freeze({
  version: AI_PROPERTY_TREND_CONTRACT_VERSION,
  signalIds: CLOSED_TREND_SIGNAL_IDS,
  minimumWindowReviewCount: 10,
  shareThresholdPercentagePoints: 10,
  categoryMinimumWindowShareNumerator: 1,
  categoryMinimumWindowShareDenominator: 10,
  meanValenceSignal: 'removed-no-persisted-per-review-valence',
  maximumProviderCandidates: 12,
  selectionMinimum: 1,
  selectionMaximum: 4,
  selectionUnique: true,
  candidateOrdering: 'normalized-magnitude-descending-then-id-lexical',
  shareNormalizedMagnitude: 'absolute-share-delta-divided-by-10',
  directionRule: 'leading-signal-polarity-then-majority-polarity-then-stable',
  selectionMustBeCandidate: true,
  renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
  renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
})

export const AI_PROPERTY_TREND_CONTRACT_DIGEST = createHash('sha256')
  .update('repkey-ai-property-trend-contract-v1\0', 'utf8')
  .update(canonicalizeRfc8785(PROPERTY_TREND_CONTRACT_MANIFEST), 'utf8')
  .digest('hex')

function roundRatioToOneDecimal(
  numerator: number,
  denominator: number,
  scale: bigint,
): string {
  const signedNumerator = BigInt(numerator) * scale
  const negative = signedNumerator < 0n
  const magnitude = absolute(signedNumerator)
  const divisor = BigInt(denominator)
  let tenths = magnitude / divisor
  if ((magnitude % divisor) * 2n >= divisor) tenths += 1n
  const sign = negative && tenths !== 0n ? '-' : ''
  return `${sign}${tenths / 10n}.${tenths % 10n}`
}

function renderCandidate(candidate: DeterministicTrendCandidate): string {
  const [, name, directionValue] = candidate.id.split('.')
  const label = name === undefined ? undefined : LABEL_BY_SIGNAL_NAME[name]
  if (label === undefined || (directionValue !== 'up' && directionValue !== 'down')) {
    throw new TypeError('unknown trend render mapping')
  }
  const verb = directionValue === 'up' ? 'rose' : 'fell'
  const baseline = roundRatioToOneDecimal(
    candidate.baselineNumerator,
    candidate.baselineDenominator,
    1_000n,
  )
  const current = roundRatioToOneDecimal(
    candidate.currentNumerator,
    candidate.currentDenominator,
    1_000n,
  )
  return `${label} ${verb} from ${baseline}% to ${current}%`
}

export function renderPropertyTrendReport(
  input: Readonly<{
    selectedSignalIds: readonly ClosedTrendSignalId[]
    candidates: readonly DeterministicTrendCandidate[]
  }>,
): PropertyTrendRender {
  const selectedSignalIds = validateTrendSelection(input)
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  )
  const sentences = selectedSignalIds.map((id) => {
    const candidate = candidateById.get(id)
    if (candidate === undefined) throw new TypeError('selected signal is not renderable')
    return renderCandidate(candidate)
  })
  const favorable = selectedSignalIds.filter(
    (id) => FAVORABLE_SIGNALS[id] === true,
  ).length
  const adverse = selectedSignalIds.filter((id) => ATTENTION_SIGNALS[id] === true).length
  const allFavorable = favorable === selectedSignalIds.length
  const allAttention = adverse === selectedSignalIds.length
  const headline = allFavorable
    ? 'Review signals improved'
    : allAttention
      ? 'Review signals need attention'
      : 'Notable review changes'
  // `direction` is the report's dominant polarity: the leading (first selected)
  // signal decides when it is polarised, otherwise the polarised majority does.
  // `stable` is reserved for a selection with NO polarised signal at all —
  // neutral-sentiment and category shifts are material but directionless — so a
  // mixed report of real improvements and regressions never reads as unchanged.
  const leading = selectedSignalIds[0]!
  const direction: PropertyTrendRender['direction'] =
    FAVORABLE_SIGNALS[leading] === true
      ? 'improving'
      : ATTENTION_SIGNALS[leading] === true
        ? 'declining'
        : favorable > adverse
          ? 'improving'
          : adverse > favorable
            ? 'declining'
            : 'stable'
  const summary = `${sentences.join('. ')}.`
  if (summary.length >= 600)
    throw new TypeError('rendered trend summary exceeds 600 characters')
  return Object.freeze({
    headline,
    direction,
    sentences: Object.freeze(sentences),
    summary,
  })
}
