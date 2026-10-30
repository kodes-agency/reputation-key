// "Not right?": a manager corrects what the AI said of a review, in the Inbox, and the
// correction takes effect at once (decision Q11). It is stored beside the kept answer
// (`AiMentionCorrectionStorePort`) and overlaid by the reads, so Guest voice and the Inbox
// change without waiting for anything; a new revision of the review is a new analysis and
// starts with none. Nothing is sent to a provider, nothing is learned from it, and the
// words a manager types for a changed cause stay in this Property.
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { normalizeCausePhrase } from '#/shared/property-issue-normalization'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
import { resolveAiReadGate, type AiReadGateDependencies } from '../ai-read-gate'
import type {
  AiMentionCorrectionStorePort,
  MentionCorrectionCommand,
} from '../ports/ai-mention-correction-store.port'

/** What a manager asks of one mention: set it aside, say it is no problem, change its cause, or undo. */
export type MentionCorrectionAction =
  | Readonly<{ kind: 'remove_topic' }>
  | Readonly<{ kind: 'not_a_problem' }>
  | Readonly<{ kind: 'change_cause'; thing: string | null; issue: string | null }>
  | Readonly<{ kind: 'undo' }>

export type CorrectReviewMentionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  /** The review's current source, as Review gives it: the analysis a correction sits beside. */
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  mentionOrdinal: number
  action: MentionCorrectionAction
  /** The manager, authorized for the Property before anything is written. */
  actor: AuthContext
}>

export type CorrectReviewMentionResult =
  /** AI review analysis is off for this Property. */
  | Readonly<{ status: 'disabled' }>
  /** The mentions now corrected (more than one only for a removed topic), or given back by an undo. */
  | Readonly<{ status: 'applied' | 'cleared'; mentionOrdinals: readonly number[] }>
  /** The review has no current v3 analysis at that key, or it has no such mention, or no correction to undo. */
  | Readonly<{ status: 'not_found' }>
  /** "Not a problem" was said of something that is not a complaint. */
  | Readonly<{ status: 'not_applicable' }>
  /** A changed cause that is not one or two short lowercase phrases. */
  | Readonly<{ status: 'invalid_cause' }>

export type CorrectReviewMentionDependencies = AiReadGateDependencies &
  Readonly<{
    propertyAccess: AiPropertyAccess
    corrections: AiMentionCorrectionStorePort
    nowEpochMillis: () => number
  }>

function phraseOf(text: string | null): string | null | undefined {
  if (text === null || text.trim() === '') return null
  return normalizeCausePhrase(text) ?? undefined
}

/**
 * The cause a manager typed, as the stored contract holds one: lowercase, one to three
 * words each, a thing only with what was wrong with it, and at least one of the two.
 */
function changedCause(
  action: Extract<MentionCorrectionAction, { kind: 'change_cause' }>,
): MentionCorrectionCommand | null {
  const thing = phraseOf(action.thing)
  const issue = phraseOf(action.issue)
  if (thing === undefined || issue === undefined) return null
  if (thing === null && issue === null) return null
  if (thing !== null && issue === null) return null
  return { kind: 'change_cause', thing, issue }
}

/** The command an action stands for; null for a changed cause that is not one. */
function commandOf(
  action: Exclude<MentionCorrectionAction, { kind: 'undo' }>,
): MentionCorrectionCommand | null {
  return action.kind === 'change_cause' ? changedCause(action) : { kind: action.kind }
}

export function createCorrectReviewMention(
  dependencies: CorrectReviewMentionDependencies,
) {
  return async (
    input: CorrectReviewMentionInput,
  ): Promise<CorrectReviewMentionResult> => {
    await requireAiPropertyReadAccess(
      dependencies.propertyAccess,
      input.actor,
      'inbox.write',
      input,
    )
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }
    // A review whose source moved on since the caller read it has another analysis.
    if (input.sourceEpoch !== gate.authorization.authorizedSourceEpoch) {
      return { status: 'not_found' }
    }

    const key = {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      sourceEpoch: input.sourceEpoch,
      sourceRevision: input.sourceRevision,
      analysisSequence: input.analysisSequence,
    }
    const fences = {
      reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
      propertyProfileVersion: gate.profile.profileVersion,
    }
    const { action } = input
    if (action.kind === 'undo') {
      const cleared = await dependencies.corrections.clear({
        key,
        fences,
        mentionOrdinal: input.mentionOrdinal,
      })
      return cleared.status === 'cleared' ? cleared : { status: 'not_found' }
    }

    const command = commandOf(action)
    if (command === null) return { status: 'invalid_cause' }
    return dependencies.corrections.apply({
      key,
      fences,
      mentionOrdinal: input.mentionOrdinal,
      command,
      correctedBy: input.actor.userId,
      correctedAt: new Date(dependencies.nowEpochMillis()),
    })
  }
}
