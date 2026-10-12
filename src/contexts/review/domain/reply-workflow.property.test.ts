// Model tests for the reply workflow's domain rules (fast-check).
//
// The oracle is `__fixtures__/reply-workflow-oracle.ts`: the workflow written
// out by hand from the Review CONTEXT, importing nothing from the production
// tables. These tests hold the three production authorities to it:
//
//   1. the command preconditions (reply-command-preconditions.ts) accept
//      exactly the replies the workflow lets each command start from;
//   2. the status table (REPLY_TRANSITIONS, through canTransitionReply) allows
//      every move a command makes and none that skips approval;
//   3. the publication table (nextPublicationState) allows every publication
//      event the workflow has, and authorizes or claims from nowhere else;
//   4. the AI text rule of each command (reply-ai-text.ts) reads the AI draft
//      binding exactly where the workflow moves AI text toward Google, and ends
//      the adoption exactly where a manager writes the text.
//
// Then generated sequences of commands and publication events walk the
// workflow. At every step the production preconditions and AI text rules are
// asked the same question as the oracle and must give the same answer. The
// invariants checked along the way are checked on the workflow as it is
// written here: they hold the oracle to the Review CONTEXT. What production
// does with a whole history is the PostgreSQL model test's to show
// (infrastructure/reply-workflow.model.integration.test.ts).

import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import {
  cancelledPublication,
  replyCommandMayStart,
  type ReplyCommand,
  type ReplyCommandSubject,
} from './reply-command-preconditions'
import { aiTextRuleOf } from './reply-ai-text'
import { canTransitionReply } from './rules'
import {
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationStateEvent,
} from './reply-publication-workflow'
import type { ReplyStatus } from './types'
import {
  afterPublicationEvent,
  isLegalReplyState,
  LEGAL_REPLY_STATES,
  managerVerdict,
  mayBeClaimed,
  PUBLICATION_EVENTS,
  type CommandEvidence,
  type ManagerCommand,
  type OracleAuthorship,
  type OracleFailure,
  type OraclePublication,
  type OracleReply,
  type OracleState,
  type PublicationEvent,
  type ReplyOnScreen,
} from './__fixtures__/reply-workflow-oracle'

const STATUSES: ReadonlyArray<ReplyStatus> = [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
  'publish_failed',
]
const PUBLICATION_STATES: ReadonlyArray<PersistedPublicationState | null> = [
  null,
  'requested',
  'authorized',
  'sending',
  'pending_observation',
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
]
const FAILURES: ReadonlyArray<OracleFailure> = [
  null,
  'retryable',
  'terminal_rejection',
  'ambiguous',
]

const AUTHORSHIPS: ReadonlyArray<OracleAuthorship> = ['human', 'ai_assisted']

/** The reply the tables below are asked about, as an up-to-date screen shows it. */
const THIS_REPLY: ReplyOnScreen = { id: 'reply-1', revision: 2 }

const NEVER_SENT: CommandEvidence = {
  provablyNeverSent: true,
  aiBindingCurrent: true,
  textClaimedBefore: false,
  stored: THIS_REPLY,
}
const MAYBE_SENT: CommandEvidence = { ...NEVER_SENT, provablyNeverSent: false }
/** The same two, ten minutes after an AI suggestion was generated. */
const STALE_AI: ReadonlyArray<CommandEvidence> = [
  { ...NEVER_SENT, aiBindingCurrent: false },
  { ...MAYBE_SENT, aiBindingCurrent: false },
]

const subject = (reply: OracleReply): ReplyCommandSubject => ({
  status: reply.status,
  publicationState: reply.publication,
  publicationCycle: reply.cycle,
  publicationLastErrorClass: reply.lastFailure,
})

/**
 * A manager command that goes through a reply command's precondition. Adopting
 * an AI suggestion does not: the acceptance store decides it under its own
 * locks, and the PostgreSQL model test holds that store to the workflow.
 */
type ReplyCommandKind = Exclude<ManagerCommand['kind'], 'adopt_ai'>

/** The production precondition each manager command checks before it writes. */
const PRODUCTION_COMMAND: Readonly<Record<ReplyCommandKind, ReplyCommand>> = {
  draft: 'save_draft',
  submit: 'submit',
  approve: 'approve',
  reject: 'reject',
  retry: 'retry_publication',
  edit: 'edit_published',
  delete: 'delete',
}

const COMMAND_KINDS = Object.keys(PRODUCTION_COMMAND) as ReadonlyArray<ReplyCommandKind>

type ReplyManagerCommand = Extract<ManagerCommand, { kind: ReplyCommandKind }>

/** The command as the Inbox sends it: an approval names the reply on screen. */
const commandOf = (
  kind: ReplyCommandKind,
  text = 'Rewritten',
  onScreen: ReplyOnScreen = THIS_REPLY,
): ReplyManagerCommand => {
  if (kind === 'draft' || kind === 'edit') return { kind, text }
  return kind === 'approve' ? { kind, onScreen } : { kind }
}

/**
 * Whether production would let `command` write, as the use case decides it:
 * the command's precondition, then its AI text rule. Retry is the one command
 * with a step before its precondition: an attempt of unknown outcome is first
 * settled as never sent, on evidence, and the precondition is asked of the
 * settled reply. A settled published reply answers a retry without a write.
 *
 * An approval is the Inbox's: it names the reply on screen. The refusal of one
 * that names an earlier reply is a comparison of state revisions in the use
 * case and the store, which the PostgreSQL model test covers.
 */
function productionAccepts(
  reply: OracleReply,
  command: ReplyManagerCommand,
  evidence: CommandEvidence,
): boolean {
  if (command.kind !== 'retry') {
    const production = PRODUCTION_COMMAND[command.kind]
    const movesStaleAiText =
      aiTextRuleOf(production) === 'needs_current_binding' &&
      reply.authorship === 'ai_assisted' &&
      !evidence.aiBindingCurrent
    return replyCommandMayStart(production, subject(reply)) && !movesStaleAiText
  }
  if (reply.status === 'published' && reply.publication === 'published') return true
  const outcomeUnknown =
    reply.publication === 'ambiguous' ||
    (reply.publication === 'terminal' && reply.lastFailure === 'ambiguous')
  if (!outcomeUnknown) return replyCommandMayStart('retry_publication', subject(reply))
  if (reply.status !== 'publish_failed' || !evidence.provablyNeverSent) return false
  return replyCommandMayStart(
    'retry_publication',
    subject({ ...reply, publication: 'terminal', lastFailure: 'retryable' }),
  )
}

function everyReplyState(): OracleReply[] {
  const replies: OracleReply[] = []
  for (const status of STATUSES) {
    for (const publicationState of PUBLICATION_STATES) {
      for (const lastFailure of FAILURES) {
        for (const cycle of [0, 1, 2]) {
          for (const authorship of AUTHORSHIPS) {
            replies.push({
              status,
              // `requested` is reserved; the oracle has no move for it.
              publication: publicationState as OraclePublication,
              lastFailure,
              cycle,
              attempts: 0,
              text: 'Thank you',
              authorship,
            })
          }
        }
      }
    }
  }
  return replies
}

describe('reply command preconditions against the hand-written workflow', () => {
  it('accept exactly what the workflow allows from every legal reply state', () => {
    const legal = everyReplyState().filter(isLegalReplyState)
    expect(legal).toHaveLength(
      LEGAL_REPLY_STATES.length * FAILURES.length * 3 * AUTHORSHIPS.length,
    )

    for (const reply of legal) {
      for (const kind of COMMAND_KINDS) {
        for (const evidence of [NEVER_SENT, MAYBE_SENT, ...STALE_AI]) {
          const command = commandOf(kind)
          expect(
            productionAccepts(reply, command, evidence),
            `${kind} from ${reply.authorship} ${reply.status}/${String(reply.publication)}/${String(reply.lastFailure)} cycle ${reply.cycle}, AI binding ${evidence.aiBindingCurrent ? 'current' : 'stale'}`,
          ).toBe(managerVerdict(reply, command, evidence).accepted)
        }
      }
    }
  })

  it('accept nothing from a state no reply should be in, except the legacy edit', () => {
    // A reply published before the publication state was recorded carries
    // NULL. Editing it authorizes a cycle like any other edit.
    const acceptedOutsideTheWorkflow: string[] = []
    for (const reply of everyReplyState().filter((state) => !isLegalReplyState(state))) {
      for (const kind of COMMAND_KINDS) {
        if (productionAccepts(reply, commandOf(kind), NEVER_SENT)) {
          acceptedOutsideTheWorkflow.push(
            `${kind} from ${reply.status}/${String(reply.publication)}`,
          )
        }
      }
    }
    expect([...new Set(acceptedOutsideTheWorkflow)]).toEqual(['edit from published/null'])
  })

  it('never let a draft save, a submit or a delete touch a reply in publication', () => {
    for (const publication of ['authorized', 'sending', 'pending_observation'] as const) {
      for (const status of STATUSES) {
        const reply = { status, publicationState: publication } as const
        for (const command of ['save_draft', 'submit', 'delete'] as const) {
          expect(
            replyCommandMayStart(command, {
              ...reply,
              publicationCycle: 1,
              publicationLastErrorClass: null,
            }),
          ).toBe(false)
        }
      }
    }
  })
})

describe('the AI text rule of each command against the hand-written workflow', () => {
  const aiReplies = everyReplyState().filter(
    (reply) => isLegalReplyState(reply) && reply.authorship === 'ai_assisted',
  )

  it('reads the AI draft binding only where a command moves unedited AI text toward Google', () => {
    const blockedByAStaleBinding = new Set<ReplyCommandKind>()
    for (const reply of aiReplies) {
      for (const kind of COMMAND_KINDS) {
        const command = commandOf(kind)
        if (!managerVerdict(reply, command, NEVER_SENT).accepted) continue
        const stale = managerVerdict(reply, command, STALE_AI[0]!)
        if (stale.accepted) continue
        expect(stale.code, `${kind} from ${reply.status}`).toBe('ai_suggestion_stale')
        blockedByAStaleBinding.add(kind)
      }
    }
    // Written out by hand: everything else has somewhere to go.
    expect([...blockedByAStaleBinding].sort()).toEqual(['approve', 'submit'])
    expect(
      COMMAND_KINDS.filter(
        (kind) => aiTextRuleOf(PRODUCTION_COMMAND[kind]) === 'needs_current_binding',
      ).sort(),
    ).toEqual(['approve', 'submit'])
  })

  it('ends the adoption exactly where a manager writes the text', () => {
    const endsAdoption = new Set<ReplyCommandKind>()
    for (const reply of aiReplies) {
      for (const kind of COMMAND_KINDS) {
        const verdict = managerVerdict(reply, commandOf(kind), NEVER_SENT)
        if (!verdict.accepted || verdict.next === null || verdict.next === reply) continue
        const becameHuman = verdict.next.authorship === 'human'
        expect(becameHuman, `${kind} from ${reply.status}`).toBe(
          aiTextRuleOf(PRODUCTION_COMMAND[kind]) === 'ends_adoption',
        )
        if (becameHuman) endsAdoption.add(kind)
      }
    }
    // Not a retry: it changes no text, so the text stays the suggestion's.
    expect([...endsAdoption].sort()).toEqual(['draft', 'edit'])
  })

  it('leaves no AI-assisted reply without a command it can take once its binding is stale', () => {
    // The finding this pins: when every write asked the binding, a reply ten
    // minutes old could be neither typed over, rejected, retried nor edited.
    // `approved` is the worker's and the sweep's to move, not a manager's.
    for (const reply of aiReplies.filter((state) => state.status !== 'approved')) {
      const open = COMMAND_KINDS.filter(
        (kind) =>
          kind !== 'delete' &&
          managerVerdict(reply, commandOf(kind), STALE_AI[0]!).accepted &&
          productionAccepts(reply, commandOf(kind), STALE_AI[0]!),
      )
      expect(
        open,
        `${reply.status}/${String(reply.publication)}/${String(reply.lastFailure)}`,
      ).not.toEqual([])
    }
  })
})

describe('the status table against the hand-written workflow', () => {
  it('allows every status move a command makes', () => {
    for (const [status, publication] of LEGAL_REPLY_STATES) {
      for (const lastFailure of FAILURES) {
        const reply: OracleReply = {
          status,
          publication,
          lastFailure,
          cycle: 1,
          attempts: 0,
          text: 'Thank you',
          authorship: 'human',
        }
        for (const kind of COMMAND_KINDS) {
          const verdict = managerVerdict(reply, commandOf(kind), NEVER_SENT)
          if (!verdict.accepted || verdict.next === null || verdict.next === reply)
            continue
          expect(
            canTransitionReply(reply.status, verdict.next.status),
            `${kind}: ${reply.status} → ${verdict.next.status}`,
          ).toBe(true)
        }
      }
    }
  })

  it('allows exactly these status moves and no other', () => {
    // Written out by hand. `approved → draft` is absent on purpose: only a
    // cancellation makes that move, and it does not go through this table.
    const allowed: ReadonlyArray<readonly [ReplyStatus, ReplyStatus]> = [
      ['draft', 'draft'],
      ['draft', 'pending_approval'],
      ['pending_approval', 'approved'],
      ['pending_approval', 'rejected'],
      ['rejected', 'draft'],
      ['approved', 'published'],
      ['approved', 'publish_failed'],
      ['publish_failed', 'approved'],
      ['publish_failed', 'published'],
      ['published', 'approved'],
    ]
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(canTransitionReply(from, to), `${from} → ${to}`).toBe(
          allowed.some(([a, b]) => a === from && b === to),
        )
      }
    }
  })
})

describe('the publication table against the hand-written workflow', () => {
  /**
   * The production event that carries each workflow event's state change.
   * Three workflow events are decided outside this table and are not listed:
   * `confirm` and `supersede` are the observation authority's own guarded
   * writes (google-reply-observation-store.ts), and `settle_never_sent` is the
   * store's evidence-locked settle. The PostgreSQL model test covers them.
   */
  const PRODUCTION_EVENT: Readonly<
    Partial<Record<PublicationEvent, PublicationStateEvent>>
  > = {
    cancel: 'cancel',
    claim: 'claim',
    provider_accepted: 'provider_accepted',
    requeue: 'requeue',
    fail_not_sent: 'fail_terminal',
    fail_rejected: 'fail_terminal',
    fail_unknown: 'fail_ambiguous',
    settle_unclaimed: 'fail_terminal',
    end_checks: 'fail_terminal',
  }

  it('allows every publication event the workflow has, with the same result', () => {
    for (const [status, publication] of LEGAL_REPLY_STATES) {
      for (const lastFailure of FAILURES) {
        const reply: OracleReply = {
          status,
          publication,
          lastFailure,
          cycle: 1,
          attempts: 1,
          text: 'Thank you',
          authorship: 'human',
        }
        for (const event of PUBLICATION_EVENTS) {
          const next = afterPublicationEvent(reply, event)
          const productionEvent = PRODUCTION_EVENT[event]
          if (next === null || productionEvent === undefined) continue
          expect(
            nextPublicationState(reply.publication, productionEvent),
            `${event} from ${status}/${String(publication)}`,
          ).toBe(next.publication)
        }
      }
    }
  })

  it('authorizes a new cycle only where nothing is in flight and nothing is unknown', () => {
    // NULL and cancelled: an approval. Terminal: a retry of a settled failure.
    // `requested` is reserved and never written. Not from `ambiguous`: an
    // attempt of unknown outcome is settled first (Invariant 9).
    const authorizable = [null, 'cancelled', 'terminal', 'requested']
    for (const state of PUBLICATION_STATES) {
      expect(nextPublicationState(state, 'authorize'), String(state)).toBe(
        authorizable.includes(state) ? 'authorized' : null,
      )
    }
  })

  it('lets a worker claim only a fresh authorization', () => {
    for (const state of PUBLICATION_STATES) {
      expect(nextPublicationState(state, 'claim'), String(state)).toBe(
        state === 'authorized' ? 'sending' : null,
      )
    }
  })

  it('returns a reply to draft only by cancelling an open, unconfirmed cycle', () => {
    for (const state of PUBLICATION_STATES) {
      const open = ['requested', 'authorized', 'sending', 'pending_observation']
      expect(cancelledPublication({ publicationState: state }), String(state)).toEqual(
        open.includes(String(state))
          ? { status: 'draft', publicationState: 'cancelled' }
          : null,
      )
    }
  })
})

// ── Generated histories ───────────────────────────────────────────────

/** Which reply the screen of an approving manager shows. */
type Screen =
  /** The stored reply, as it is. */
  | 'this_reply'
  /** The stored reply, before its last change. */
  | 'an_earlier_revision'
  /** A reply that was deleted since, and replaced by the stored one. */
  | 'a_replaced_reply'

/** A manager command as it is generated: which screen an approval comes from
 * is decided when the step runs, against the replies the history has seen. */
type GeneratedCommand =
  | Exclude<ManagerCommand, { kind: 'approve' }>
  | Readonly<{ kind: 'approve'; screen: Screen }>

type Move =
  | Readonly<{ by: 'manager'; command: ManagerCommand }>
  | Readonly<{ by: 'system'; event: PublicationEvent }>

/**
 * One generated step. Most steps take a move the workflow allows from the
 * current state (`pick` chooses among them), so a history walks deep into the
 * workflow instead of bouncing off refusals; a `wild` step is any command at
 * all, which is where the refusals are exercised.
 */
type Step = Readonly<{
  pick: number
  wild: GeneratedCommand | null
  text: string
  provablyNeverSent: boolean
  aiBindingCurrent: boolean
}>

const TEXTS = ['Thank you!', 'We are sorry.', 'See you again.'] as const
const arbText = fc.constantFrom(...TEXTS)
const arbManagerCommand: fc.Arbitrary<GeneratedCommand> = fc.oneof(
  arbText.map((text) => ({ kind: 'draft' as const, text })),
  arbText.map((text) => ({ kind: 'adopt_ai' as const, text })),
  arbText.map((text) => ({ kind: 'edit' as const, text })),
  fc.constantFrom(
    { kind: 'submit' as const },
    { kind: 'approve' as const, screen: 'this_reply' as const },
    { kind: 'approve' as const, screen: 'an_earlier_revision' as const },
    { kind: 'approve' as const, screen: 'a_replaced_reply' as const },
    { kind: 'reject' as const },
    { kind: 'retry' as const },
    { kind: 'delete' as const },
  ),
)
const arbStep: fc.Arbitrary<Step> = fc.record({
  pick: fc.nat(),
  wild: fc.oneof(
    { weight: 3, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: arbManagerCommand },
  ),
  text: arbText,
  provablyNeverSent: fc.boolean(),
  // Mostly current, or AI text would rarely get as far as Google.
  aiBindingCurrent: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
})

const does = (command: GeneratedCommand): Step => ({
  pick: 0,
  wild: command,
  text: TEXTS[0],
  provablyNeverSent: false,
  aiBindingCurrent: true,
})

/**
 * Always run: a second manager rejects the pending reply, deletes it, writes
 * another and submits it, while a first still has the confirmation of the old
 * one open. The new reply is pending at the revision the old one was pending
 * at (created, then submitted), and it is another reply.
 */
const REPLACED_UNDER_AN_OPEN_CONFIRMATION: Step[] = [
  does({ kind: 'draft', text: TEXTS[0] }),
  does({ kind: 'submit' }),
  does({ kind: 'reject' }),
  does({ kind: 'delete' }),
  does({ kind: 'draft', text: TEXTS[1] }),
  does({ kind: 'submit' }),
  does({ kind: 'approve', screen: 'a_replaced_reply' }),
]

/**
 * The store's side of a history, kept by hand beside the workflow state: which
 * reply is stored and at which revision, every reply a screen could still be
 * showing, and which words a worker claimed for the stored reply.
 */
function createStoreLedger() {
  let replies = 0
  let stored: ReplyOnScreen | null = null
  let claimedTexts = new Set<string>()
  const shown: ReplyOnScreen[] = []

  /** A screen that never showed any reply of this history. */
  const nothing: ReplyOnScreen = { id: 'reply-0', revision: 1 }

  return {
    stored: () => stored,
    evidence: (step: Step, state: OracleState): CommandEvidence => ({
      provablyNeverSent: step.provablyNeverSent,
      aiBindingCurrent: step.aiBindingCurrent,
      textClaimedBefore: state !== null && claimedTexts.has(state.text),
      stored,
    }),
    /** The reply a screen of that kind shows. A replaced reply at the stored
     * reply's own revision is preferred: it is the one a number cannot tell
     * apart. */
    screen(kind: Screen): ReplyOnScreen {
      if (stored === null) return nothing
      const current = stored
      if (kind === 'this_reply') return current
      if (kind === 'an_earlier_revision') {
        return { id: current.id, revision: current.revision - 1 }
      }
      const replaced = shown.filter((reply) => reply.id !== current.id)
      return (
        replaced.find((reply) => reply.revision === current.revision) ??
        replaced.at(-1) ??
        nothing
      )
    },
    /** A new reply counts from 1. One whose text, status or authorship moved
     * is at its next revision; a claim, or any other step inside a publication
     * cycle, changes none of the three. */
    record(before: OracleState, after: OracleState, claimed: boolean): void {
      if (after === null) {
        stored = null
        claimedTexts = new Set()
        return
      }
      if (before === null || stored === null) {
        replies += 1
        stored = { id: `reply-${replies}`, revision: 1 }
      } else if (
        before.status !== after.status ||
        before.text !== after.text ||
        before.authorship !== after.authorship
      ) {
        stored = { id: stored.id, revision: stored.revision + 1 }
      }
      if (claimed) claimedTexts.add(after.text)
      shown.push(stored)
    },
  }
}

function allowedMoves(state: OracleState, step: Step, evidence: CommandEvidence): Move[] {
  const moves: Move[] = []
  const commands: ManagerCommand[] = [
    ...COMMAND_KINDS.map((kind) =>
      commandOf(kind, step.text, evidence.stored ?? THIS_REPLY),
    ),
    { kind: 'adopt_ai', text: step.text },
  ]
  for (const command of commands) {
    if (managerVerdict(state, command, evidence).accepted) {
      moves.push({ by: 'manager', command })
    }
  }
  if (state !== null) {
    for (const event of PUBLICATION_EVENTS) {
      // A worker claims only what it may: stale AI text that was never claimed
      // is left to `cancel`, the one move a worker has for it.
      if (event === 'claim' && !mayBeClaimed(state, evidence)) continue
      if (afterPublicationEvent(state, event) !== null)
        moves.push({ by: 'system', event })
    }
  }
  return moves
}

const outcomeUnknown = (reply: OracleReply): boolean =>
  reply.publication === 'ambiguous' ||
  (reply.publication === 'terminal' && reply.lastFailure === 'ambiguous')

const textIsFrozen = (reply: OracleReply): boolean =>
  reply.status === 'pending_approval' ||
  reply.status === 'approved' ||
  reply.status === 'publish_failed'

/** The invariants one accepted manager command must keep (Review CONTEXT). */
function assertManagerMoveKeepsTheInvariants(
  before: OracleState,
  after: OracleState,
  command: ManagerCommand,
  evidence: CommandEvidence,
): void {
  if (before === null) return
  if (after === null) {
    // The publication evidence of a reply that was ever authorized outlives it.
    expect(before.cycle, 'a reply with a publication record was deleted').toBe(0)
    return
  }
  if (textIsFrozen(before)) {
    expect(after.text, `${command.kind} changed text a manager had submitted`).toBe(
      before.text,
    )
  }
  // A label follows the words: it changes only when a manager writes them.
  if (after.text === before.text && command.kind === 'retry') {
    expect(after.authorship, 'a retry relabelled text it did not change').toBe(
      before.authorship,
    )
  }
  // Unedited AI text moves toward Google only while its binding is current.
  const movedTowardGoogle =
    (before.status === 'draft' && after.status === 'pending_approval') ||
    (before.status === 'pending_approval' && after.status === 'approved')
  if (movedTowardGoogle && after.authorship === 'ai_assisted') {
    expect(
      evidence.aiBindingCurrent,
      `${command.kind} moved stale AI text from ${before.status} to ${after.status}`,
    ).toBe(true)
  }
  if (after.cycle === before.cycle) return
  // A new cycle is a new authority to write to Google.
  expect(after.cycle).toBe(before.cycle + 1)
  expect(after).toMatchObject({ status: 'approved', publication: 'authorized' })
  // AI text is authorized by an approval, or again by a retry of it. An edit
  // is the manager's own text.
  if (after.authorship === 'ai_assisted') {
    expect(['approve', 'retry']).toContain(command.kind)
  }
  // BETA §5: only an approval takes a reply out of pending_approval; a failed
  // reply is retried, a published one edited.
  expect(command.kind).toBe(
    before.status === 'pending_approval'
      ? 'approve'
      : before.status === 'publish_failed'
        ? 'retry'
        : 'edit',
  )
  // The approval named the reply that was stored, as it was stored.
  if (command.kind === 'approve') expect(command.onScreen).toEqual(evidence.stored)
  // Invariant 9: an attempt of unknown outcome is sent again only on positive
  // evidence that it never left RepKey.
  if (outcomeUnknown(before)) {
    expect(evidence.provablyNeverSent, 'an uncertain attempt was re-sent').toBe(true)
  }
}

describe('generated reply histories', () => {
  it('production rules and the hand-written workflow agree on every step, and the workflow keeps its invariants', () => {
    const reached = new Set<string>()
    const reachedAsAiText = new Set<string>()
    let refusals = 0
    let staleAiRefusals = 0
    let replacedRepliesRefused = 0
    let staleAiClaimsWithheld = 0
    fc.assert(
      // `size: 'max'`: by default fast-check keeps arrays near ten items, and
      // AI text needs most of that just to be adopted, confirmed and sent.
      fc.property(fc.array(arbStep, { maxLength: 40, size: 'max' }), (steps) => {
        let state: OracleState = null
        const ledger = createStoreLedger()
        for (const step of steps) {
          const before: OracleState = state
          const evidence = ledger.evidence(step, state)
          const moves = allowedMoves(state, step, evidence)
          const wild: ManagerCommand | null =
            step.wild === null
              ? null
              : step.wild.kind === 'approve'
                ? { kind: 'approve', onScreen: ledger.screen(step.wild.screen) }
                : step.wild
          const move: Move =
            wild !== null
              ? { by: 'manager', command: wild }
              : moves[step.pick % moves.length]!
          let claimed = false

          if (move.by === 'system') {
            // Chosen from the moves that apply, so the event has a result.
            state = afterPublicationEvent(state!, move.event)
            claimed = move.event === 'claim'
            if (claimed && before?.authorship === 'ai_assisted') {
              // The last gate: current, or these words went through before.
              expect(evidence.aiBindingCurrent || evidence.textClaimedBefore).toBe(true)
            }
          } else {
            const verdict = managerVerdict(state, move.command, evidence)
            // What production can be asked here: a reply command, sent from a
            // screen that shows the reply (see `productionAccepts`).
            const { command } = move
            const fromAnotherScreen =
              command.kind === 'approve' &&
              !(
                command.onScreen.id === evidence.stored?.id &&
                command.onScreen.revision === evidence.stored.revision
              )
            if (state !== null && command.kind !== 'adopt_ai' && !fromAnotherScreen) {
              expect(
                productionAccepts(state, command, evidence),
                `${command.kind} from ${state.authorship} ${state.status}/${String(state.publication)}`,
              ).toBe(verdict.accepted)
            }
            if (verdict.accepted) {
              assertManagerMoveKeepsTheInvariants(
                state,
                verdict.next,
                move.command,
                evidence,
              )
              state = verdict.next
            } else {
              refusals += 1
              if (verdict.code === 'ai_suggestion_stale') staleAiRefusals += 1
              // The reply a number alone could not tell apart: pending, at the
              // revision the screen shows, and another reply.
              if (
                command.kind === 'approve' &&
                state?.status === 'pending_approval' &&
                command.onScreen.revision === evidence.stored?.revision &&
                command.onScreen.id !== evidence.stored.id
              ) {
                replacedRepliesRefused += 1
              }
            }
          }
          ledger.record(before, state, claimed)
          if (state !== null) {
            expect(isLegalReplyState(state), JSON.stringify(state)).toBe(true)
            reached.add(`${state.status}/${String(state.publication)}`)
            if (state.authorship === 'ai_assisted') reachedAsAiText.add(state.status)
            if (
              state.publication === 'authorized' &&
              !mayBeClaimed(state, ledger.evidence(step, state))
            ) {
              staleAiClaimsWithheld += 1
            }
          }
        }
      }),
      { numRuns: 2000, examples: [[REPLACED_UNDER_AN_OPEN_CONFIRMATION]] },
    )
    // The generator is only worth its runs if it reaches the whole workflow
    // and also asks for what the workflow refuses.
    expect([...reached].sort()).toEqual(
      LEGAL_REPLY_STATES.map(
        ([status, publication]) => `${status}/${String(publication)}`,
      ).sort(),
    )
    expect(refusals).toBeGreaterThan(1000)
    // AI text went the whole way, and its binding was refused along it: at
    // submit and approval, and at the claim of text that was never claimed.
    expect([...reachedAsAiText].sort()).toEqual([...STATUSES].sort())
    expect(staleAiRefusals).toBeGreaterThan(100)
    expect(staleAiClaimsWithheld).toBeGreaterThan(20)
    // A confirmation met another reply at the revision its screen showed: the
    // scripted history at least, and whichever generated ones got there.
    expect(replacedRepliesRefused).toBeGreaterThan(0)
  })
})
