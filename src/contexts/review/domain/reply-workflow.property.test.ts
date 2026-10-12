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
//      the adoption exactly where a manager makes the text their own.
//
// Then generated sequences of commands and publication events are run through
// the production rules and the oracle side by side, and the invariants the
// Review CONTEXT states are checked on every history.

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
  PUBLICATION_EVENTS,
  type CommandEvidence,
  type ManagerCommand,
  type OracleAuthorship,
  type OracleFailure,
  type OraclePublication,
  type OracleReply,
  type OracleState,
  type PublicationEvent,
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

const NEVER_SENT: CommandEvidence = { provablyNeverSent: true, aiBindingCurrent: true }
const MAYBE_SENT: CommandEvidence = { provablyNeverSent: false, aiBindingCurrent: true }
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
const commandOf = (kind: ReplyCommandKind, text = 'Rewritten'): ReplyManagerCommand => {
  if (kind === 'draft' || kind === 'edit') return { kind, text }
  return kind === 'approve' ? { kind, onScreen: 'this_reply' } : { kind }
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

  it('ends the adoption exactly where a manager makes the text their own', () => {
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
    expect([...endsAdoption].sort()).toEqual(['draft', 'edit', 'retry'])
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
  wild: ManagerCommand | null
  text: string
  evidence: CommandEvidence
}>

const TEXTS = ['Thank you!', 'We are sorry.', 'See you again.'] as const
const arbText = fc.constantFrom(...TEXTS)
const arbManagerCommand: fc.Arbitrary<ManagerCommand> = fc.oneof(
  arbText.map((text) => ({ kind: 'draft' as const, text })),
  arbText.map((text) => ({ kind: 'adopt_ai' as const, text })),
  arbText.map((text) => ({ kind: 'edit' as const, text })),
  fc.constantFrom(
    { kind: 'submit' as const },
    { kind: 'approve' as const, onScreen: 'this_reply' as const },
    { kind: 'approve' as const, onScreen: 'an_earlier_reply' as const },
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
  evidence: fc.record({
    provablyNeverSent: fc.boolean(),
    // Mostly current, or AI text would rarely get as far as Google.
    aiBindingCurrent: fc.oneof(
      { weight: 3, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
  }),
})

function allowedMoves(state: OracleState, step: Step): Move[] {
  const moves: Move[] = []
  const commands: ManagerCommand[] = [
    ...COMMAND_KINDS.map((kind) => commandOf(kind, step.text)),
    { kind: 'adopt_ai', text: step.text },
  ]
  for (const command of commands) {
    if (managerVerdict(state, command, step.evidence).accepted) {
      moves.push({ by: 'manager', command })
    }
  }
  if (state !== null) {
    for (const event of PUBLICATION_EVENTS) {
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
  // AI text is authorized by an approval alone; a retry or an edit is a
  // manager's own text by then.
  if (after.authorship === 'ai_assisted') expect(command.kind).toBe('approve')
  // BETA §5: only an approval takes a reply out of pending_approval; a failed
  // reply is retried, a published one edited.
  expect(command.kind).toBe(
    before.status === 'pending_approval'
      ? 'approve'
      : before.status === 'publish_failed'
        ? 'retry'
        : 'edit',
  )
  // Invariant 9: an attempt of unknown outcome is sent again only on positive
  // evidence that it never left RepKey.
  if (outcomeUnknown(before)) {
    expect(evidence.provablyNeverSent, 'an uncertain attempt was re-sent').toBe(true)
  }
}

describe('generated reply histories', () => {
  it('production rules and the hand-written workflow agree on every step, and every history keeps the invariants', () => {
    const reached = new Set<string>()
    const reachedAsAiText = new Set<string>()
    let refusals = 0
    let staleAiRefusals = 0
    fc.assert(
      // `size: 'max'`: by default fast-check keeps arrays near ten items, and
      // AI text needs most of that just to be adopted, confirmed and sent.
      fc.property(fc.array(arbStep, { maxLength: 40, size: 'max' }), (steps) => {
        let state: OracleState = null
        for (const step of steps) {
          const moves = allowedMoves(state, step)
          const move: Move =
            step.wild !== null
              ? { by: 'manager', command: step.wild }
              : moves[step.pick % moves.length]!

          if (move.by === 'system') {
            // Chosen from the moves that apply, so the event has a result.
            state = afterPublicationEvent(state!, move.event)
          } else {
            const verdict = managerVerdict(state, move.command, step.evidence)
            // What production can be asked here: a reply command, sent from a
            // screen that shows the reply (see `productionAccepts`).
            const { command } = move
            if (
              state !== null &&
              command.kind !== 'adopt_ai' &&
              !(command.kind === 'approve' && command.onScreen === 'an_earlier_reply')
            ) {
              expect(
                productionAccepts(state, command, step.evidence),
                `${command.kind} from ${state.authorship} ${state.status}/${String(state.publication)}`,
              ).toBe(verdict.accepted)
            }
            if (verdict.accepted) {
              assertManagerMoveKeepsTheInvariants(
                state,
                verdict.next,
                move.command,
                step.evidence,
              )
              state = verdict.next
            } else {
              refusals += 1
              if (verdict.code === 'ai_suggestion_stale') staleAiRefusals += 1
            }
          }
          if (state !== null) {
            expect(isLegalReplyState(state), JSON.stringify(state)).toBe(true)
            reached.add(`${state.status}/${String(state.publication)}`)
            if (state.authorship === 'ai_assisted') reachedAsAiText.add(state.status)
          }
        }
      }),
      { numRuns: 2000 },
    )
    // The generator is only worth its runs if it reaches the whole workflow
    // and also asks for what the workflow refuses.
    expect([...reached].sort()).toEqual(
      LEGAL_REPLY_STATES.map(
        ([status, publication]) => `${status}/${String(publication)}`,
      ).sort(),
    )
    expect(refusals).toBeGreaterThan(1000)
    // AI text went the whole way, and its binding was refused along it.
    expect([...reachedAsAiText].sort()).toEqual([...STATUSES].sort())
    expect(staleAiRefusals).toBeGreaterThan(100)
  })
})
