import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/** What a manager can say is wrong with one mention of a review's analysis. */
export type MentionCorrectionCommand =
  /** The topic is not in the review: every mention of that topic is set aside. */
  | Readonly<{ kind: 'remove_topic' }>
  /** The mention is a complaint, and not a problem. */
  | Readonly<{ kind: 'not_a_problem' }>
  /** The cause is another: the thing, and what was wrong or right, as short lowercase phrases. */
  | Readonly<{ kind: 'change_cause'; thing: string | null; issue: string | null }>

/** The analysis a correction sits beside: one review in one revision and sequence. */
export type MentionCorrectionAnalysisKey = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

/** The fences the analysis must still sit under for a correction to be written for it. */
export type MentionCorrectionFences = Readonly<{
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
}>

export type ApplyMentionCorrectionInput = Readonly<{
  key: MentionCorrectionAnalysisKey
  fences: MentionCorrectionFences
  mentionOrdinal: number
  command: MentionCorrectionCommand
  correctedBy: string
  correctedAt: Date
}>

export type ApplyMentionCorrectionResult =
  /** The mentions now corrected: more than one only for a removed topic. */
  | Readonly<{ status: 'applied'; mentionOrdinals: readonly number[] }>
  /** No current, ready v3 analysis at that key under those fences, or no such mention. */
  | Readonly<{ status: 'not_found' }>
  /** "Not a problem" says something only of a complaint. */
  | Readonly<{ status: 'not_applicable' }>

export type ClearMentionCorrectionInput = Readonly<{
  key: MentionCorrectionAnalysisKey
  fences: MentionCorrectionFences
  mentionOrdinal: number
}>

export type ClearMentionCorrectionResult =
  /** The mentions whose correction was taken away; a removed topic is given back whole. */
  | Readonly<{ status: 'cleared'; mentionOrdinals: readonly number[] }>
  | Readonly<{ status: 'not_found' }>

/**
 * A manager's corrections beside the kept AI answer. The answer is never changed: a
 * correction is a row the reads overlay before they count anything. Writing one takes
 * the Property's aggregate lock, as the issue commands do, because a changed cause may
 * create the issue it moves to.
 */
export type AiMentionCorrectionStorePort = Readonly<{
  apply(input: ApplyMentionCorrectionInput): Promise<ApplyMentionCorrectionResult>
  clear(input: ClearMentionCorrectionInput): Promise<ClearMentionCorrectionResult>
}>
