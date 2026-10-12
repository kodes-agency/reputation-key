// Test-only: the reply workflow, written out by hand.
//
// This is the oracle of the reply model tests. It is deliberately NOT built
// from REPLY_TRANSITIONS, PERSISTED_PUBLICATION_TRANSITIONS or the command
// preconditions, and it imports nothing from them: a test that asks the
// production tables what is allowed can only agree with them. Every move below
// is stated from src/contexts/review/CONTEXT.md (Model, Runtime, Manager
// publication commands, Invariants 7 to 10) and docs/BETA.md §5 (No
// auto-publish). When the product rule changes, this file changes by hand.
//
// Four things a verdict depends on are not part of the reply's state and are
// passed in as evidence: whether the current attempt provably never left
// RepKey; whether an AI-assisted reply's binding is still current (everything
// it was generated from, and its ten-minute adoption window; and which of the
// two it is that no longer holds); whether the text the reply holds was
// claimed for sending before; and which reply is stored, at which revision.
// The last is identity, which a state cannot carry: a reply that is deleted
// and written anew is another reply in the very same state.
//
// One writer is not a command and not a publication event: the AI draft purge
// (Review CONTEXT, Model; AI CONTEXT, Invariant 4). It withdraws unedited AI
// text that may no longer be published, from outside the reply workflow, and
// is written out at the end of this file.

export type OracleStatus =
  'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected' | 'publish_failed'

/** `requested` is reserved and never written, so the oracle has no move for it. */
export type OraclePublication =
  | null
  | 'authorized'
  | 'sending'
  | 'pending_observation'
  | 'published'
  | 'terminal'
  | 'ambiguous'
  | 'cancelled'

export type OracleFailure = null | 'retryable' | 'terminal_rejection' | 'ambiguous'

/** `ai_assisted`: the unedited text of an AI suggestion a manager adopted. Any
 * act by which a manager makes the text their own ends it. */
export type OracleAuthorship = 'human' | 'ai_assisted'

export type OracleReply = Readonly<{
  status: OracleStatus
  publication: OraclePublication
  lastFailure: OracleFailure
  /** Publication cycles authorized so far. */
  cycle: number
  /** Attempts claimed in the current cycle. */
  attempts: number
  text: string
  authorship: OracleAuthorship
}>

/** Null: the review has no internal reply. */
export type OracleState = OracleReply | null

/** Every (status, publication state) a reply may be in. Nothing else is legal. */
export const LEGAL_REPLY_STATES: ReadonlyArray<
  readonly [OracleStatus, OraclePublication]
> = [
  // Not in publication: never authorized, or the last cycle was cancelled.
  ['draft', null],
  ['draft', 'cancelled'],
  ['pending_approval', null],
  ['pending_approval', 'cancelled'],
  ['rejected', null],
  ['rejected', 'cancelled'],
  // A manager confirmed it and a cycle is open.
  ['approved', 'authorized'],
  ['approved', 'sending'],
  ['approved', 'pending_observation'],
  // The cycle ended.
  ['published', 'published'],
  ['publish_failed', 'terminal'],
  ['publish_failed', 'ambiguous'],
]

export const isLegalReplyState = (reply: OracleReply): boolean =>
  LEGAL_REPLY_STATES.some(
    ([status, publication]) =>
      status === reply.status && publication === reply.publication,
  )

// ── Manager commands ──────────────────────────────────────────────────

/**
 * A reply as a manager's screen shows it, and as a confirmation names it:
 * which reply, at which revision. The revision is counted per reply, from 1,
 * and moves whenever the reply's text, status or authorship does. A number
 * alone names nothing: every new reply counts from 1 again.
 */
export type ReplyOnScreen = Readonly<{ id: string; revision: number }>

export type ManagerCommand =
  /** Type the reply: a new draft, or over the one that is there. */
  | Readonly<{ kind: 'draft'; text: string }>
  /** Adopt an AI suggestion, unedited, as the review's draft. */
  | Readonly<{ kind: 'adopt_ai'; text: string }>
  | Readonly<{ kind: 'submit' }>
  /** Confirm & Publish the reply the manager's screen showed when they opened
   * the confirmation. It may no longer be the reply that is stored. */
  | Readonly<{ kind: 'approve'; onScreen: ReplyOnScreen }>
  | Readonly<{ kind: 'reject' }>
  | Readonly<{ kind: 'retry' }>
  | Readonly<{ kind: 'edit'; text: string }>
  | Readonly<{ kind: 'delete' }>

export type ManagerVerdict =
  | Readonly<{ accepted: true; next: OracleState }>
  | Readonly<{
      accepted: false
      code:
        'reply_not_found' | 'invalid_transition' | 'invalid_reply' | 'ai_suggestion_stale'
    }>

/** What a verdict depends on beyond the reply itself. */
export type CommandEvidence = Readonly<{
  /** Positive evidence that no request for the current attempt left RepKey. */
  provablyNeverSent: boolean
  /** Everything an AI-assisted reply was generated from is still current, and
   * its ten-minute adoption window has not passed. Not read for a reply a
   * human authored. */
  aiBindingCurrent: boolean
  /** The first half alone: everything it was generated from is still current,
   * whatever its adoption window says. False only when the binding is not
   * current either. */
  aiInputsCurrent: boolean
  /** A worker claimed this reply for sending before, with the text it holds
   * now. Those words then passed every gate while they were current. */
  textClaimedBefore: boolean
  /** The reply that is stored, as a screen that is up to date would show it.
   * Null when the review has no internal reply. */
  stored: ReplyOnScreen | null
}>

const REFUSED: ManagerVerdict = { accepted: false, code: 'invalid_transition' }
const NO_REPLY: ManagerVerdict = { accepted: false, code: 'reply_not_found' }
const NO_TEXT: ManagerVerdict = { accepted: false, code: 'invalid_reply' }
const STALE_AI_TEXT: ManagerVerdict = { accepted: false, code: 'ai_suggestion_stale' }

/**
 * AI output is advisory: unedited AI text moves toward Google only while its
 * binding is current. That holds for the three steps that move it (submit,
 * Confirm & Publish, the worker's first claim of the text) and for nothing
 * else: the binding never keeps a manager from taking the reply back or making
 * it their own.
 */
const staleAiText = (reply: OracleReply, evidence: CommandEvidence): boolean =>
  reply.authorship === 'ai_assisted' && !evidence.aiBindingCurrent

/** The confirmation names the reply that is stored, as it is stored. */
const namesTheStoredReply = (
  onScreen: ReplyOnScreen,
  evidence: CommandEvidence,
): boolean =>
  evidence.stored !== null &&
  onScreen.id === evidence.stored.id &&
  onScreen.revision === evidence.stored.revision

/** No publication cycle is open and none ended: a draft may be worked on. */
const outsidePublication = (reply: OracleReply): boolean =>
  reply.publication === null || reply.publication === 'cancelled'

/** The attempt's outcome is unknown: Google may or may not have the reply. */
const outcomeUnknown = (reply: OracleReply): boolean =>
  reply.status === 'publish_failed' &&
  (reply.publication === 'ambiguous' ||
    (reply.publication === 'terminal' && reply.lastFailure === 'ambiguous'))

/** A manager confirms the reply: a new cycle, nothing claimed yet. */
const authorized = (
  reply: OracleReply,
  authorship: OracleAuthorship,
  text = reply.text,
): OracleReply => ({
  status: 'approved',
  publication: 'authorized',
  lastFailure: null,
  cycle: reply.cycle + 1,
  attempts: 0,
  text,
  authorship,
})

const newDraft = (text: string, authorship: OracleAuthorship): OracleReply => ({
  status: 'draft',
  publication: null,
  lastFailure: null,
  cycle: 0,
  attempts: 0,
  text,
  authorship,
})

function draftVerdict(state: OracleState, text: string): ManagerVerdict {
  if (state === null) return { accepted: true, next: newDraft(text, 'human') }
  // Only an unsubmitted reply is rewritten. In particular not an approved one:
  // its text is what a manager confirmed and what Google is being sent.
  // Typing over AI text makes the reply the manager's own, however stale the
  // AI draft was: the binding is not asked.
  const rewritable =
    (state.status === 'draft' || state.status === 'rejected') && outsidePublication(state)
  return rewritable
    ? { accepted: true, next: { ...state, status: 'draft', text, authorship: 'human' } }
    : REFUSED
}

function adoptVerdict(state: OracleState, text: string): ManagerVerdict {
  if (state === null) return { accepted: true, next: newDraft(text, 'ai_assisted') }
  // A suggestion replaces only an unsubmitted reply. One generated before the
  // reply was submitted, confirmed or published is stale by then.
  const replaceable = state.status === 'draft' || state.status === 'rejected'
  return replaceable
    ? {
        accepted: true,
        next: { ...state, status: 'draft', text, authorship: 'ai_assisted' },
      }
    : STALE_AI_TEXT
}

function submitVerdict(state: OracleReply, evidence: CommandEvidence): ManagerVerdict {
  if (state.status !== 'draft' || !outsidePublication(state)) return REFUSED
  // Invariant 5: blank text is not a reply. A manager cannot save one; the
  // only blank reply there is, is one whose AI text was withdrawn.
  if (state.text === '') return NO_TEXT
  return staleAiText(state, evidence)
    ? STALE_AI_TEXT
    : { accepted: true, next: { ...state, status: 'pending_approval' } }
}

function approveVerdict(
  state: OracleReply,
  onScreen: ReplyOnScreen,
  evidence: CommandEvidence,
): ManagerVerdict {
  // BETA §5: a reply reaches Google only after pending_approval → approved.
  if (state.status !== 'pending_approval' || !outsidePublication(state)) return REFUSED
  // The manager confirms the reply they read. One that was rejected, rewritten
  // and submitted again since has moved to a later revision. One that was
  // deleted and written anew is another reply, whatever its revision.
  if (!namesTheStoredReply(onScreen, evidence)) return REFUSED
  // Confirming does not end the adoption: the worker's claim still asks.
  return staleAiText(state, evidence)
    ? STALE_AI_TEXT
    : { accepted: true, next: authorized(state, state.authorship) }
}

function retryVerdict(state: OracleReply, evidence: CommandEvidence): ManagerVerdict {
  // A reply already confirmed on Google answers the retry as it is.
  if (state.status === 'published' && state.publication === 'published') {
    return { accepted: true, next: state }
  }
  if (state.status !== 'publish_failed') return REFUSED
  // Trying again changes no text, so the text is whose it was. It never waits
  // on the binding: a failed reply has no other way forward. It also sends
  // nothing: whether AI text may still go is the claim's to decide.
  const retried: ManagerVerdict = {
    accepted: true,
    next: authorized(state, state.authorship),
  }
  // Invariant 9: an attempt of unknown outcome is sent again only on positive
  // evidence that it never left RepKey.
  if (outcomeUnknown(state)) return evidence.provablyNeverSent ? retried : REFUSED
  return state.publication === 'terminal' ? retried : REFUSED
}

function editVerdict(state: OracleReply, text: string): ManagerVerdict {
  if (state.status !== 'published' || state.publication !== 'published') return REFUSED
  // The manager typed the new text: it is theirs, whatever wrote the old one.
  return {
    accepted: true,
    next: text === state.text ? state : authorized(state, 'human', text),
  }
}

/** What a reply command must do from `state`: the move it makes, or its refusal. */
export function managerVerdict(
  state: OracleState,
  command: ManagerCommand,
  evidence: CommandEvidence,
): ManagerVerdict {
  if (command.kind === 'draft') return draftVerdict(state, command.text)
  if (command.kind === 'adopt_ai') return adoptVerdict(state, command.text)
  if (state === null) return NO_REPLY
  switch (command.kind) {
    case 'submit':
      return submitVerdict(state, evidence)
    case 'approve':
      return approveVerdict(state, command.onScreen, evidence)
    case 'reject':
      // An approver can always send a reply back, AI-assisted and stale or not.
      return state.status === 'pending_approval' && outsidePublication(state)
        ? { accepted: true, next: { ...state, status: 'rejected' } }
        : REFUSED
    case 'retry':
      return retryVerdict(state, evidence)
    case 'edit':
      return editVerdict(state, command.text)
    case 'delete':
      // A reply that was ever authorized keeps its publication evidence, and
      // the evidence keeps the reply.
      return (state.status === 'draft' || state.status === 'rejected') &&
        state.publication === null &&
        state.cycle === 0
        ? { accepted: true, next: null }
        : REFUSED
  }
}

// ── Publication events (worker, sweep, sync, policy) ──────────────────

export type PublicationEvent =
  /** A disconnect or a policy change ends a cycle nothing was sent for. The
   * reply returns to draft with its text. (A worker that may not claim AI
   * text ends the cycle too, and takes the text with it: `afterRefusedClaim`.) */
  | 'cancel'
  /** The worker takes the cycle: exactly one provider write may follow. */
  | 'claim'
  /** Google answered the write with success. */
  | 'provider_accepted'
  /** The write was refused inside RepKey; another execution may claim again. */
  | 'requeue'
  /** The last execution was refused inside RepKey: nothing was posted. */
  | 'fail_not_sent'
  /** Google answered 4xx: nothing was posted. */
  | 'fail_rejected'
  /** No read confirmed the write within its grace: outcome unknown. */
  | 'fail_unknown'
  /** Google shows exactly the text this attempt wrote. */
  | 'confirm'
  /** The cycle was never claimed and its recovery deadline passed. */
  | 'settle_unclaimed'
  /** Positive evidence that the claimed attempt never left RepKey. */
  | 'settle_never_sent'
  /** The read ladder ended without an answer. */
  | 'end_checks'
  /** Google shows a different reply: the attempt lost to provider truth. */
  | 'supersede'

export const PUBLICATION_EVENTS: ReadonlyArray<PublicationEvent> = [
  'cancel',
  'claim',
  'provider_accepted',
  'requeue',
  'fail_not_sent',
  'fail_rejected',
  'fail_unknown',
  'confirm',
  'settle_unclaimed',
  'settle_never_sent',
  'end_checks',
  'supersede',
]

const failed = (reply: OracleReply, lastFailure: OracleFailure): OracleReply => ({
  ...reply,
  status: 'publish_failed',
  publication: 'terminal',
  lastFailure,
})

const cancelled = (reply: OracleReply): OracleReply => ({
  ...reply,
  status: 'draft',
  publication: 'cancelled',
})

const is = (
  reply: OracleReply,
  status: OracleStatus,
  ...publications: OraclePublication[]
): boolean => reply.status === status && publications.includes(reply.publication)

/**
 * Whether a worker may take the reply's cycle and write to Google. The claim is
 * the last gate for AI text: it is sent while its binding is current, and
 * after that only if these words were claimed once before and nothing but the
 * ten minutes has passed since (they then went through while they were
 * current, and a later attempt or a retry does not wait on a window that has
 * closed). A changed input is never excused: it is what the AI draft purge
 * withdraws a reply for. AI text the gate refuses is not sent, by the cycle of
 * its approval or by the cycle of a retry: the worker withdraws the reply
 * (`afterRefusedClaim`).
 */
export const mayBeClaimed = (reply: OracleReply, evidence: CommandEvidence): boolean =>
  is(reply, 'approved', 'authorized') &&
  (!staleAiText(reply, evidence) ||
    (evidence.textClaimedBefore && evidence.aiInputsCurrent))

/** What one publication event does to a reply, or null when it does not apply. */
type PublicationMove = (reply: OracleReply) => OracleReply | null

// `sending`: RepKey's own authorizer refused the claimed write before anything
// was sent (the Property moved on after the claim).
const onCancel: PublicationMove = (reply) =>
  is(reply, 'approved', 'authorized', 'sending') ? cancelled(reply) : null

const onClaim: PublicationMove = (reply) =>
  is(reply, 'approved', 'authorized')
    ? { ...reply, publication: 'sending', attempts: reply.attempts + 1 }
    : null

const onProviderAccepted: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending')
    ? { ...reply, publication: 'pending_observation' }
    : null

const onRequeue: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending') ? { ...reply, publication: 'authorized' } : null

const onFailNotSent: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending') ? failed(reply, 'retryable') : null

const onFailRejected: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending') ? failed(reply, 'terminal_rejection') : null

const onFailUnknown: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending', 'pending_observation')
    ? {
        ...reply,
        status: 'publish_failed',
        publication: 'ambiguous',
        lastFailure: 'ambiguous',
      }
    : null

// Only an attempt whose outcome is still open can be confirmed.
const onConfirm: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending', 'pending_observation') || outcomeUnknown(reply)
    ? { ...reply, status: 'published', publication: 'published' }
    : null

const onSettleUnclaimed: PublicationMove = (reply) =>
  is(reply, 'approved', 'authorized') ? failed(reply, 'retryable') : null

const onSettleNeverSent: PublicationMove = (reply) =>
  is(reply, 'approved', 'sending') || outcomeUnknown(reply)
    ? failed(reply, 'retryable')
    : null

const onEndChecks: PublicationMove = (reply) =>
  is(reply, 'publish_failed', 'ambiguous') ? failed(reply, 'ambiguous') : null

// Terminal ambiguity only ended the automatic checks; its attempt is as open
// as before and loses to a different live reply like any other.
const onSupersede: PublicationMove = (reply) =>
  is(reply, 'approved', 'authorized', 'sending', 'pending_observation') ||
  outcomeUnknown(reply)
    ? { ...cancelled(reply), lastFailure: null }
    : null

/** Which of the moves above each event makes. Every one is written out by
 * hand; this only looks them up by name. */
const PUBLICATION_MOVES: Readonly<Record<PublicationEvent, PublicationMove>> = {
  cancel: onCancel,
  claim: onClaim,
  provider_accepted: onProviderAccepted,
  requeue: onRequeue,
  fail_not_sent: onFailNotSent,
  fail_rejected: onFailRejected,
  fail_unknown: onFailUnknown,
  confirm: onConfirm,
  settle_unclaimed: onSettleUnclaimed,
  settle_never_sent: onSettleNeverSent,
  end_checks: onEndChecks,
  supersede: onSupersede,
}

/** The reply after `event`, or null when the event does not apply to it. */
export function afterPublicationEvent(
  reply: OracleReply,
  event: PublicationEvent,
): OracleReply | null {
  return PUBLICATION_MOVES[event](reply)
}

/** The fields two replies must share to be the same reply state. The failure
 * class is part of the state only where it decides what may happen next. */
export function sameReplyState(left: OracleState, right: OracleState): boolean {
  if (left === null || right === null) return left === right
  const failureMatters =
    left.publication === 'terminal' || left.publication === 'ambiguous'
  return (
    left.status === right.status &&
    left.publication === right.publication &&
    left.cycle === right.cycle &&
    left.attempts === right.attempts &&
    left.text === right.text &&
    left.authorship === right.authorship &&
    (!failureMatters || left.lastFailure === right.lastFailure)
  )
}

/**
 * Whether `to` is `from` after at most `maxEvents` of `events`, each of which
 * must apply. A job execution or a sweep makes a short run of these moves; this
 * says whether what it did is one of the runs it is allowed.
 */
export function reachableBy(
  from: OracleReply,
  to: OracleReply,
  events: ReadonlyArray<PublicationEvent>,
  maxEvents: number,
): boolean {
  if (sameReplyState(from, to)) return true
  if (maxEvents === 0) return false
  return events.some((event) => {
    const next = afterPublicationEvent(from, event)
    return next !== null && reachableBy(next, to, events, maxEvents - 1)
  })
}

// ── Withdrawn AI text (the AI draft purge, and a claim the gate refuses) ──

/**
 * What a withdrawal leaves of a reply a manager once confirmed. Its
 * authorizations and attempts are evidence and they keep the reply, so it is
 * not deleted: its open cycle is cancelled, the AI text is removed, and with
 * no AI text left it claims no AI authorship. An empty draft, in which a
 * manager writes a new reply. The cycle count and the attempts stay: they are
 * the record.
 */
const withdrawn = (reply: OracleReply): OracleReply => ({
  ...reply,
  status: 'draft',
  publication: 'cancelled',
  lastFailure: null,
  text: '',
  authorship: 'human',
})

/**
 * A worker found AI text it may not claim (`mayBeClaimed`). Nothing is sent,
 * and the reply is withdrawn on the spot, exactly as the purge would withdraw
 * it at its next run. Null when the reply is not one a claim can refuse so.
 */
export const afterRefusedClaim = (reply: OracleReply): OracleReply | null =>
  is(reply, 'approved', 'authorized') && reply.authorship === 'ai_assisted'
    ? withdrawn(reply)
    : null

/** Which AI-assisted replies one run of the AI draft purge reaches. */
export type AiDraftPurgeScope =
  /** Something they were generated from changed (the Review, the Property, its
   * AI settings), and the transaction that changed it runs the purge. */
  | 'every_ai_reply'
  /** A sync saw the Review again, unchanged. Nothing marks the moment the ten
   * minutes run out, so this is when a reply past them is withdrawn. */
  | 'replies_past_their_window'

/** Confirmed once, and nothing of its current cycle has left RepKey: the
 * cycle is waiting for a worker, or it was cancelled and the reply is a draft
 * again (perhaps submitted again since, or rejected). */
const confirmedAndNotDispatched = (reply: OracleReply): boolean =>
  is(reply, 'approved', 'authorized') ||
  (reply.publication === 'cancelled' &&
    (reply.status === 'draft' ||
      reply.status === 'pending_approval' ||
      reply.status === 'rejected'))

/**
 * The reply after the AI draft purge ran for it. The purge touches only
 * unedited AI text (a reply a manager wrote, or typed over, is never in its
 * reach), and what it does depends on how far the reply got:
 *
 *   - no manager ever confirmed it (a draft, awaiting approval, rejected, with
 *     no publication cycle): it is deleted;
 *   - it was confirmed and nothing of its current cycle has left RepKey, or it
 *     is back in draft after a cancelled cycle: it is withdrawn, not deleted;
 *   - a worker has claimed it, or its cycle ended published or failed: left
 *     alone. Its text may be on Google, and the attempt evidence describes it.
 *
 * `pastItsWindow`: the reply's ten-minute adoption window has passed.
 */
export function afterAiDraftPurge(
  state: OracleState,
  scope: AiDraftPurgeScope,
  pastItsWindow: boolean,
): OracleState {
  if (state === null || state.authorship !== 'ai_assisted') return state
  if (scope === 'replies_past_their_window' && !pastItsWindow) return state
  if (state.publication === null) return null
  return confirmedAndNotDispatched(state) ? withdrawn(state) : state
}
