// Inbox context — who is allowed to be the author of a closure.
//
// The Private Feedback Handling Outcome is a claim about a *person*: a manager
// looked at this guest's private feedback and chose one of five approved
// dispositions. Retention purge, redaction and source-unavailability are not
// claims about a person at all — they are the source disappearing. Recording a
// manager outcome for such a cycle fabricates evidence of human judgement that
// never happened, and it does so on exactly the rows a regulator or a guest is
// most likely to ask about.
//
// The legacy classifier (application/inbox-handling-cutover.ts) already refuses
// to *derive* an outcome from a legacy `closed_at`. This module is the same
// refusal for LIVE rows, and it is deliberately one-way: once a source has been
// withdrawn, purged or made ineligible, no later reopen re-earns the right to
// an outcome. The Inbox may still show the work; it may never claim it was
// handled.

import { err, ok, type Result } from '#/shared/domain'
import { inboxError, type InboxError } from './errors'
import type { HandlingCycleCloseReason, HandlingCycleHead } from './types'

/**
 * Closures caused by the source ceasing to be available: a guest withdrawal or
 * retention purge of the private feedback body (`guest_withdrawn`), and any
 * redaction / expiry / provider deletion that makes the source unservable
 * (`source_ineligible`).
 *
 * `superseded_by_source_revision` is deliberately absent — a revised guest
 * submission is still live content, and its successor cycle is handleable.
 */
export const SOURCE_UNAVAILABLE_CLOSE_REASONS = [
  'guest_withdrawn',
  'source_ineligible',
] as const

export type SourceUnavailableCloseReason =
  (typeof SOURCE_UNAVAILABLE_CLOSE_REASONS)[number]

export const isSourceUnavailableCloseReason = (
  value: string,
): value is SourceUnavailableCloseReason =>
  SOURCE_UNAVAILABLE_CLOSE_REASONS.some((candidate) => candidate === value)

/** The exactly-one closure that a manager authored. */
const MANAGER_HANDLING_CLOSE_REASON: HandlingCycleCloseReason = 'private_feedback_handled'

const KNOWN_CLOSE_REASONS: ReadonlyArray<HandlingCycleCloseReason> = [
  'confirmed_on_google',
  'external_reply_observed',
  'guest_withdrawn',
  'private_feedback_handled',
  'source_ineligible',
  'superseded_by_source_revision',
]

export type ManagerHandlingAttribution =
  'manager_handling' | 'not_manager_handling' | 'unattributable'

/**
 * How a recorded closure may be presented. `unattributable` exists so a reason
 * this build does not know about is reported as unknown instead of silently
 * defaulting into either bucket — the same fail-closed stance the legacy
 * classifier takes with `ambiguous`.
 */
export function managerHandlingAttributionFor(
  closeReason: string,
): ManagerHandlingAttribution {
  if (closeReason === MANAGER_HANDLING_CLOSE_REASON) return 'manager_handling'
  if (KNOWN_CLOSE_REASONS.some((candidate) => candidate === closeReason)) {
    return 'not_manager_handling'
  }
  return 'unattributable'
}

export type ManagerHandlingRequest = Readonly<{
  current: HandlingCycleHead
  /**
   * Every close reason already recorded against this Inbox Item, across every
   * cycle. The caller reads the append-only transition log; this function does
   * not care about order, only about presence.
   */
  recordedCloseReasons: ReadonlyArray<string>
}>

/**
 * Decide whether a Private Feedback Handling Outcome may be authored at all.
 * Cycle status, revision fencing and authorization stay with the caller — this
 * answers only "could a manager honestly claim to have handled this source".
 */
export function assertManagerHandlingPermitted(
  request: ManagerHandlingRequest,
): Result<true, InboxError> {
  if (request.current.sourceType !== 'feedback') {
    return err(
      inboxError(
        'invalid_input',
        'Only a private-feedback Handling Cycle accepts a manager outcome',
      ),
    )
  }

  const unavailableCloseReasons = SOURCE_UNAVAILABLE_CLOSE_REASONS.filter((reason) =>
    request.recordedCloseReasons.includes(reason),
  )
  if (unavailableCloseReasons.length > 0) {
    return err(
      inboxError(
        'invalid_transition',
        'Withdrawn, purged or unavailable private feedback can never record a manager handling outcome',
        {
          inboxItemId: request.current.inboxItemId,
          cycleNumber: request.current.currentCycleNumber,
          unavailableCloseReasons,
        },
      ),
    )
  }
  return ok(true)
}
