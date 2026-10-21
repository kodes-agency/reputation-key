// Google's moderation of an owner reply (`reviewReply.reviewReplyState` and
// `.policyViolation`, GBP API v4 reference), as the review adapter reads it.
//
// Observation only. The values are parsed into RepKey's closed type and counted
// per read; nothing else changes. Google does not document what `comment` and
// `updateTime` hold while a reply is PENDING or REJECTED, so the behaviour that
// follows is designed from what these counts and the read-back lines show.
//
// It must never fail a page. Both fields are read as `unknown`, and any value
// outside the documented enum is `unspecified` (state) or `UNKNOWN` (policy
// code), counted and never logged. Nothing here logs reply text, a review, or
// the value Google sent.

import { z } from 'zod/v4'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ReplyModeration } from '#/contexts/review/application/public-api'

/** The reply object's moderation fields, for the review item schema. */
export const replyModerationFields = {
  reviewReplyState: z.unknown().optional(),
  policyViolation: z.unknown().optional(),
}

type ProviderReply = Readonly<{
  comment?: string
  updateTime?: string
  reviewReplyState?: unknown
  policyViolation?: unknown
}>

export type ProviderReplyReview = Readonly<{ reviewReply?: ProviderReply }>

/** A moderation reading plus whether Google sent a value RepKey did not know. */
export type ParsedReplyModeration = Readonly<{
  moderation: ReplyModeration
  unknownState: boolean
  unknownPolicyViolation: boolean
  /** Google sent a policy code on a reply that is not REJECTED (ignored). */
  policyViolationWithoutRejected: boolean
}>

const STATE_BY_WIRE_VALUE: Readonly<
  Record<string, Exclude<ReplyModeration['state'], 'absent'> | undefined>
> = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVIEW_REPLY_STATE_UNSPECIFIED: 'unspecified',
})

/** An enum word: upper case and underscores, bounded. */
const POLICY_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u

const UNKNOWN_POLICY_VIOLATION = 'UNKNOWN'

const isSent = (value: unknown): boolean => value !== undefined && value !== null

const isNonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0

function parseState(wire: unknown): {
  state: ReplyModeration['state']
  unknown: boolean
} {
  if (!isSent(wire)) return { state: 'absent', unknown: false }
  const known =
    typeof wire === 'string' && Object.hasOwn(STATE_BY_WIRE_VALUE, wire)
      ? STATE_BY_WIRE_VALUE[wire]
      : undefined
  return known === undefined
    ? { state: 'unspecified', unknown: true }
    : { state: known, unknown: false }
}

function parsePolicyViolation(wire: unknown): {
  code: string | null
  unknown: boolean
} {
  if (!isSent(wire)) return { code: null, unknown: false }
  return typeof wire === 'string' && POLICY_CODE.test(wire)
    ? { code: wire, unknown: false }
    : { code: UNKNOWN_POLICY_VIOLATION, unknown: true }
}

export function parseReplyModeration(raw: ProviderReplyReview): ParsedReplyModeration {
  const reply = raw.reviewReply
  const state = parseState(reply?.reviewReplyState)
  // The code means something only on a rejection; elsewhere it is ignored.
  const policy =
    state.state === 'rejected'
      ? parsePolicyViolation(reply?.policyViolation)
      : { code: null, unknown: false }
  // Google documents the code as set only when REJECTED; counting a code that
  // arrives otherwise checks that claim against real payloads.
  const policyViolationWithoutRejected =
    state.state !== 'rejected' && isSent(reply?.policyViolation)
  return {
    moderation: {
      state: state.state,
      policyViolation: policy.code,
      commentPresent: isNonEmptyString(reply?.comment),
      commentEmpty: reply?.comment === '',
      updateTimePresent: isNonEmptyString(reply?.updateTime),
      updateTimeEmpty: reply?.updateTime === '',
    },
    unknownState: state.unknown,
    unknownPolicyViolation: policy.unknown,
    policyViolationWithoutRejected,
  }
}

/**
 * One content-free line per read that returned any reply: how many reviews and
 * replies, and how many replies sit in each state. A read with no reply writes
 * nothing. A second line counts values Google sent that RepKey does not know, or a
 * policy code on a reply that is not REJECTED, never which value or review.
 */
export function reportReplyModeration(
  logger: LoggerPort,
  operation: 'reviews.list' | 'reviews.get',
  raws: ReadonlyArray<ProviderReplyReview>,
): void {
  const replies = raws.filter((raw) => raw.reviewReply !== undefined).length
  if (replies === 0) return
  const parsed = raws.map(parseReplyModeration)
  const count = (state: ReplyModeration['state']): number =>
    parsed.filter(
      (entry, index) =>
        raws[index]?.reviewReply !== undefined && entry.moderation.state === state,
    ).length
  logger.info(
    {
      event: 'reviews_reply_moderation',
      operation,
      reviews: raws.length,
      replies,
      pending: count('pending'),
      approved: count('approved'),
      rejected: count('rejected'),
      unspecified: count('unspecified'),
      stateAbsent: count('absent'),
    },
    'Google reply moderation states read',
  )
  const unknownState = parsed.filter((entry) => entry.unknownState).length
  const unknownPolicyViolation = parsed.filter(
    (entry) => entry.unknownPolicyViolation,
  ).length
  const policyViolationWithoutRejected = parsed.filter(
    (entry) => entry.policyViolationWithoutRejected,
  ).length
  if (
    unknownState === 0 &&
    unknownPolicyViolation === 0 &&
    policyViolationWithoutRejected === 0
  ) {
    return
  }
  logger.warn(
    {
      event: 'reviews_reply_moderation_unknown',
      operation,
      unknownState,
      unknownPolicyViolation,
      policyViolationWithoutRejected,
    },
    'Google sent reply moderation values RepKey does not know or expect',
  )
}
