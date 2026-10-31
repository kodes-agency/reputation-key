/** The windows the statistics engine chooses between. */
export type Window = '30d' | '90d' | '180d' | '365d'
export type Change = 'rising' | 'falling' | 'steady' | 'unknown'
export type EvidenceLevel = 'not_enough' | 'early' | 'likely'

/** What is known of one issue (or one topic) over the window, worked out by the engine. */
export type IssueStatistics = Readonly<{
  /** Reviews with text that name it. */
  reviewCount: number
  /** Reviews with text in the window: the "of 128" in "19 of 128". */
  textReviewCount: number
  /** Every review in the window, those with only stars included. */
  allReviewCount: number
  /** "19 of 128" (`shareText`). */
  shareText: string
  /** Null under 20 reviews with text: counts first, percentages only above that. */
  sharePercent: number | null
  /** Average stars of the reviews that name it, and of every other review. */
  mentionedAverage: number | null
  othersAverage: number | null
  gap: number | null
  /** "Worth up to": share of every review x the gap, to the nearest 0.05 stars. */
  upTo: number | null
  change: Change
  evidenceLevel: EvidenceLevel
}>

/**
 * One quote, read live: the text and where, in it, the cited sentences are. A review whose
 * original analysis names a person anywhere is never one: the read leaves it out, so
 * nothing here can be asked to hide a name.
 */
export type LiveEvidence = Readonly<{
  inboxItemId: string
  /** A day (`2026-10-18`) or an instant; the page prints the day. */
  reviewedAt: string
  rating: 1 | 2 | 3 | 4 | 5
  text: string
  /** Character offsets into `text`, one range per cited sentence. */
  sentenceRanges: readonly Readonly<{ start: number; end: number }>[]
}> // response-only; never persisted in AI storage
