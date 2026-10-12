// Model-based test of the reply workflow on PostgreSQL (fast-check).
//
// Generated sequences of everything that can happen to a reply: the manager
// commands (draft, adopt an AI suggestion, submit, approve, reject, retry, edit
// published, delete), a disconnect cancellation, executions of the publish
// worker with each provider outcome, the reconciliation sweep (also racing a
// worker that claims after the sweep read its batch), a review sync that reads
// Google, the end of an AI draft's ten-minute adoption window, the AI draft
// purge (when something AI drafts were generated from changes, and when a sync
// sees the review again), and the passing of time. They run against the real
// use cases, command store, AI acceptance store and binding, purge,
// observation store, worker and sweep (testing/reply-workflow-harness.ts).
//
// Three dimensions sit across the workflow. Authorship: a reply is the
// manager's text or the unedited text of an AI suggestion, and the commands by
// which a manager writes it change which. Freshness: an AI-assisted reply's
// binding is current or stale (because its window passed, or because an input
// changed), and its words were claimed for sending before or never were.
// Identity: an approval names the reply the manager's screen showed, which is
// the stored reply, an earlier revision of it, or a reply that was deleted and
// replaced since.
//
// The purge is the one writer here that is not part of the reply workflow: it
// writes SQL of its own, from other contexts' transactions, past every guard
// the commands carry. The histories put it between any two steps, so whatever
// it leaves is met by every command, the worker and the sweep.
//
// The oracle is the workflow written out by hand
// (domain/__fixtures__/reply-workflow-oracle.ts), never the production
// transition tables. After every step:
//   - a manager command did exactly what the workflow says, or was refused
//     with a tagged ReviewError and changed nothing;
//   - whatever the worker, the sweep or the sync did is a move the workflow
//     allows them;
//   - the invariants of src/contexts/review/CONTEXT.md hold, judged against
//     what the stand-in Google actually received.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Pool } from 'pg'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { getEnv } from '#/shared/config/env'
import { replyId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { Reply } from '../domain/types'
import { isReviewError } from '../domain/errors'
import { googleReplyTextDigest } from '../domain/google-reply-observation'
import {
  afterAiDraftPurge,
  afterPublicationEvent,
  afterRefusedClaim,
  isLegalReplyState,
  managerVerdict,
  mayBeClaimed,
  reachableBy,
  sameReplyState,
  type AiDraftPurgeScope,
  type CommandEvidence,
  type ManagerCommand,
  type ManagerVerdict,
  type OraclePublication,
  type OracleReply,
  type OracleState,
  type PublicationEvent,
  type ReplyOnScreen,
} from '../domain/__fixtures__/reply-workflow-oracle'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  type GoogleWriteOutcome,
  type ReplyEvidence,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const MINUTE_MS = 60_000
/** Review CONTEXT, Invariant 9: non-dispatch is judged "at least five minutes
 * after the attempt started". Time in this model moves in steps of ten. */
const DISPATCH_WINDOW_MS = 5 * MINUTE_MS

const MODEL_SEED = 20_261_012

const TEXTS = ['Thank you!', 'We are sorry.', 'See you again.'] as const
const COMMAND_KINDS = [
  'draft',
  'adopt_ai',
  'submit',
  'approve',
  'reject',
  'retry',
  'edit',
  'delete',
] as const
const WRITE_OUTCOMES: ReadonlyArray<GoogleWriteOutcome> = [
  'accepted',
  'rejected',
  'not_sent',
  'crashed',
  'timeout_landed',
  'timeout_lost',
]

/** Which reply the screen of an approving manager shows. */
type Screen =
  /** The stored reply, as it is. */
  | 'this_reply'
  /** The stored reply, before its last change. */
  | 'an_earlier_revision'
  /** A reply that was deleted since, and replaced by the stored one. */
  | 'a_replaced_reply'

/** A manager command as it is generated. Which reply an approval names is
 * decided when the step runs, against the replies the history has shown. */
type GeneratedCommand =
  | Exclude<ManagerCommand, { kind: 'approve' }>
  | Readonly<{ kind: 'approve'; screen: Screen }>

type Step =
  | Readonly<{
      act: 'manager'
      pick: number
      wild: GeneratedCommand | null
      text: (typeof TEXTS)[number]
    }>
  | Readonly<{ act: 'job'; job: number; outcome: GoogleWriteOutcome; final: boolean }>
  | Readonly<{ act: 'sweep'; waitMinutes: number; racing: GoogleWriteOutcome | null }>
  | Readonly<{ act: 'observe' }>
  | Readonly<{ act: 'cancel' }>
  /** Ten minutes pass for the AI draft: its adoption window is over. */
  | Readonly<{ act: 'lapse' }>
  /** The AI draft purge runs: for every AI draft of the Property, because
   * something they were generated from changed; or only for those past their
   * window, because a sync saw the unchanged review. */
  | Readonly<{ act: 'purge'; scope: AiDraftPurgeScope }>
  | Readonly<{ act: 'wait'; minutes: number }>

const arbText = fc.constantFrom(...TEXTS)
const arbOutcome = fc.constantFrom(...WRITE_OUTCOMES)
const arbManagerCommand: fc.Arbitrary<GeneratedCommand> = fc.oneof(
  arbText.map((text) => ({ kind: 'draft' as const, text })),
  arbText.map((text) => ({ kind: 'adopt_ai' as const, text })),
  arbText.map((text) => ({ kind: 'edit' as const, text })),
  fc.constantFrom(
    { kind: 'submit' as const },
    { kind: 'approve' as const, screen: 'this_reply' as const },
    // A confirmation left open while the reply was rewritten beneath it, or
    // deleted and replaced by another.
    { kind: 'approve' as const, screen: 'an_earlier_revision' as const },
    { kind: 'approve' as const, screen: 'a_replaced_reply' as const },
    { kind: 'reject' as const },
    { kind: 'retry' as const },
    { kind: 'delete' as const },
  ),
)
const arbStep: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      act: fc.constant('manager' as const),
      pick: fc.nat(),
      // One step in four is any command at all: that is where refusals come from.
      wild: fc.oneof(
        { weight: 3, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: arbManagerCommand },
      ),
      text: arbText,
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      act: fc.constant('job' as const),
      job: fc.nat(),
      outcome: arbOutcome,
      final: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      act: fc.constant('sweep' as const),
      // Nothing due; past the dispatch window; past the recovery deadline;
      // past the whole 72-hour read ladder.
      waitMinutes: fc.constantFrom(0, 10, 30, 4_800),
      racing: fc.oneof(
        { weight: 2, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: arbOutcome },
      ),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ act: 'observe' as const }) },
  { weight: 1, arbitrary: fc.constant({ act: 'cancel' as const }) },
  { weight: 2, arbitrary: fc.constant({ act: 'lapse' as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      act: fc.constant('purge' as const),
      scope: fc.constantFrom<AiDraftPurgeScope>(
        'every_ai_reply',
        'replies_past_their_window',
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      act: fc.constant('wait' as const),
      minutes: fc.constantFrom(10, 30),
    }),
  },
)

// ── Histories that are always run ─────────────────────────────────────
//
// A random walk reaches a stale AI reply at each of its three gates, or a
// confirmation that names a replaced reply, only now and then. These histories
// go there on purpose, through the same steps, the same oracle and the same
// invariants as the generated ones.

const AI_TEXT = TEXTS[0]
const TYPED_TEXT = TEXTS[1]

const does = (command: GeneratedCommand): Step => ({
  act: 'manager',
  pick: 0,
  wild: command,
  text: AI_TEXT,
})
const worker = (outcome: GoogleWriteOutcome, index = 0): Step => ({
  act: 'job',
  job: index,
  outcome,
  final: false,
})
const LAPSE: Step = { act: 'lapse' }
const OBSERVE: Step = { act: 'observe' }
const DISCONNECT: Step = { act: 'cancel' }
const INPUT_CHANGES: Step = { act: 'purge', scope: 'every_ai_reply' }
const SYNC_SEES_THE_REVIEW: Step = { act: 'purge', scope: 'replies_past_their_window' }
const ADOPT = does({ kind: 'adopt_ai', text: AI_TEXT })
const SUBMIT = does({ kind: 'submit' })
const APPROVE = does({ kind: 'approve', screen: 'this_reply' })
const RETRY = does({ kind: 'retry' })
const TYPE_OVER = does({ kind: 'draft', text: TYPED_TEXT })
const RECOVERY_DEADLINE_PASSES: Step = { act: 'sweep', waitMinutes: 30, racing: null }

const SCRIPTED_HISTORIES: ReadonlyArray<ReadonlyArray<Step>> = [
  // The window passes on a draft: submit is refused, typing over it is not.
  [ADOPT, LAPSE, SUBMIT, TYPE_OVER, SUBMIT, APPROVE],
  // It passes on a pending reply: approval is refused, a reject is not, and
  // the author reworks the rejected reply.
  [
    ADOPT,
    SUBMIT,
    LAPSE,
    APPROVE,
    does({ kind: 'reject' }),
    does({ kind: 'draft', text: AI_TEXT }),
    SUBMIT,
    APPROVE,
    worker('accepted'),
    OBSERVE,
  ],
  // It passes between Confirm & Publish and the claim: nothing is sent and
  // the reply is withdrawn, an empty draft that goes nowhere until a manager
  // types a reply into it.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    LAPSE,
    worker('accepted'),
    SUBMIT,
    TYPE_OVER,
    SUBMIT,
    APPROVE,
    worker('accepted', 1),
    OBSERVE,
  ],
  // The same, when no worker ran in time: the sweep ends the cycle as not
  // sent, a manager tries again, and the claim of that cycle is the gate.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    LAPSE,
    RECOVERY_DEADLINE_PASSES,
    RETRY,
    worker('accepted', 1),
    TYPE_OVER,
    SUBMIT,
    APPROVE,
    worker('accepted', 2),
    OBSERVE,
  ],
  // It passes after Google refused the first attempt: the words were claimed
  // while they were current, so the retry goes, and the text stays the AI's.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    worker('rejected'),
    LAPSE,
    RETRY,
    worker('accepted', 1),
    OBSERVE,
  ],
  // It passes between two executions of the same cycle: the second one sends.
  [ADOPT, SUBMIT, APPROVE, worker('not_sent'), LAPSE, worker('accepted'), OBSERVE],
  // It passes after publication: the reply can still be edited.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    worker('accepted'),
    OBSERVE,
    LAPSE,
    does({ kind: 'edit', text: TYPED_TEXT }),
    worker('accepted', 1),
    OBSERVE,
  ],
  // A confirmation left open while the reply was rejected, rewritten and
  // submitted again names a revision the reply has moved past.
  [
    does({ kind: 'draft', text: AI_TEXT }),
    SUBMIT,
    does({ kind: 'reject' }),
    TYPE_OVER,
    SUBMIT,
    does({ kind: 'approve', screen: 'an_earlier_revision' }),
    APPROVE,
  ],
  // One left open while the reply was rejected, deleted and written anew
  // names a reply that is gone. The new one is pending at the same revision.
  [
    does({ kind: 'draft', text: AI_TEXT }),
    SUBMIT,
    does({ kind: 'reject' }),
    does({ kind: 'delete' }),
    TYPE_OVER,
    SUBMIT,
    does({ kind: 'approve', screen: 'a_replaced_reply' }),
    APPROVE,
  ],
  // Something the AI text was generated from changes under a confirmed reply
  // no worker has claimed: the purge empties it, its job sends nothing, and
  // the empty draft is neither submitted nor deleted. What a manager types
  // into it goes the normal way.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    INPUT_CHANGES,
    worker('accepted'),
    SUBMIT,
    does({ kind: 'delete' }),
    TYPE_OVER,
    SUBMIT,
    APPROVE,
    worker('accepted', 1),
    OBSERVE,
  ],
  // Under a reply still waiting for approval: the purge deletes it. A
  // confirmation left open names a reply that is gone, and the reply written
  // in its place is pending at the same revision.
  [
    ADOPT,
    SUBMIT,
    INPUT_CHANGES,
    TYPE_OVER,
    SUBMIT,
    does({ kind: 'approve', screen: 'a_replaced_reply' }),
    APPROVE,
  ],
  // Under a reply Google refused once: the purge leaves a cycle that ran to
  // its end alone, and the retry's claim withdraws it. Having been claimed
  // before excuses a closed window, not a changed input.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    worker('rejected'),
    INPUT_CHANGES,
    RETRY,
    worker('accepted', 1),
    TYPE_OVER,
    SUBMIT,
    APPROVE,
    worker('accepted', 2),
    OBSERVE,
  ],
  // A sync leaves an AI draft alone while its binding is current and removes
  // it once its window has passed; a confirmed one it empties.
  [
    ADOPT,
    SYNC_SEES_THE_REVIEW,
    LAPSE,
    SYNC_SEES_THE_REVIEW,
    ADOPT,
    SUBMIT,
    APPROVE,
    LAPSE,
    SYNC_SEES_THE_REVIEW,
    worker('accepted'),
  ],
  // A cycle waiting for its next execution when the window passes: the sync
  // gets there before the worker and withdraws it. (Two histories up, the
  // worker gets there first and sends. Either is a rule keeping its word.)
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    worker('not_sent'),
    LAPSE,
    SYNC_SEES_THE_REVIEW,
    worker('accepted'),
  ],
  // A draft back from a cancelled cycle, submitted again: the purge empties
  // it under the approver, and a newly adopted suggestion takes its place in
  // the same reply, held by its own binding.
  [
    ADOPT,
    SUBMIT,
    APPROVE,
    DISCONNECT,
    SUBMIT,
    INPUT_CHANGES,
    APPROVE,
    ADOPT,
    SUBMIT,
    APPROVE,
    worker('accepted', 1),
    OBSERVE,
  ],
]

const toOracle = (reply: Reply | null): OracleState =>
  reply === null
    ? null
    : {
        status: reply.status,
        publication: reply.publicationState as OraclePublication,
        lastFailure: reply.publicationLastErrorClass,
        cycle: reply.publicationCycle,
        attempts: reply.publicationAttempts,
        text: reply.text,
        authorship: reply.aiGenerated ? 'ai_assisted' : 'human',
      }

/** A screen that never showed any reply of this history. */
const NO_REPLY_ON_SCREEN: ReplyOnScreen = {
  id: '4f000000-0000-4000-8000-000000000000',
  revision: 1,
}

/** The command as a manager's up-to-date screen sends it. */
const commandOf = (
  kind: (typeof COMMAND_KINDS)[number],
  text: (typeof TEXTS)[number],
  stored: ReplyOnScreen | null,
): ManagerCommand => {
  if (kind === 'draft' || kind === 'edit' || kind === 'adopt_ai') return { kind, text }
  return kind === 'approve' ? { kind, onScreen: stored ?? NO_REPLY_ON_SCREEN } : { kind }
}

/** What an approval's screen shows when it is not the stored reply as stored. */
type OtherScreen = 'another reply' | 'an earlier revision' | null

function otherScreenOf(
  command: ManagerCommand,
  stored: ReplyOnScreen | null,
): OtherScreen {
  if (command.kind !== 'approve' || stored === null) return null
  if (command.onScreen.id !== stored.id) return 'another reply'
  return command.onScreen.revision !== stored.revision ? 'an earlier revision' : null
}

/** The trace line of one manager step: the command, and what the workflow
 * says must become of it. */
const commandLine = (
  command: ManagerCommand,
  otherScreen: OtherScreen,
  staleAi: boolean,
  verdict: ManagerVerdict,
): string =>
  `${command.kind}${'text' in command ? ` "${command.text}"` : ''}${
    otherScreen ? ` (screen shows ${otherScreen})` : ''
  }${staleAi ? ' [AI text, binding stale]' : ''} → expect ${
    verdict.accepted ? 'accepted' : verdict.code
  }`

/** The events one execution of the publish job makes once it has called Google. */
function jobEvents(outcome: GoogleWriteOutcome, final: boolean): PublicationEvent[] {
  switch (outcome) {
    case 'accepted':
      return ['claim', 'provider_accepted']
    case 'rejected':
      return ['claim', 'fail_rejected']
    case 'not_sent':
      return ['claim', final ? 'fail_not_sent' : 'requeue']
    case 'crashed':
    case 'timeout_landed':
    case 'timeout_lost':
      // Unknown outcome: the row stays `sending` for a read-only execution,
      // and only the last execution calls it ambiguous.
      return final ? ['claim', 'fail_unknown'] : ['claim']
  }
}

/** What a job execution that made no provider call may do: nothing, or settle
 * the `sending` row it found through evidence or one read of Google. */
const READBACK_EVENTS: ReadonlyArray<PublicationEvent> = [
  'settle_never_sent',
  'confirm',
  'supersede',
  'fail_unknown',
]
/** What the sweep may do to a due row. It never writes to Google. */
const SWEEP_EVENTS: ReadonlyArray<PublicationEvent> = [
  'settle_unclaimed',
  'settle_never_sent',
  'confirm',
  'supersede',
  'fail_unknown',
  'end_checks',
]
const SYNC_EVENTS: ReadonlyArray<PublicationEvent> = ['confirm', 'supersede']

let pool: Pool
let harness: ReplyWorkflowHarness

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 })
  clearEventSchemas()
  registerAllEventSchemas()
  harness = await createReplyWorkflowHarness({
    pool,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    logger: createMockLogger(),
  })
  await harness.seed()
}, WORKFLOW_HOOK_TIMEOUT_MS)

afterAll(async () => {
  await harness.remove()
  clearEventSchemas()
  await pool.end()
}, WORKFLOW_HOOK_TIMEOUT_MS)

/** One generated history, with what the invariants need remembered. */
function createRun() {
  const trace: string[] = []
  let approvals = 0
  let evidenceRows = 0
  const covered = new Set<string>()
  /** Every reply a screen could still be showing, oldest first. */
  const shown: ReplyOnScreen[] = []
  /** What each of them said: a reply at a revision is one text in one status. */
  const saidOnScreen = new Map<string, string>()

  const say = (line: string): void => {
    trace.push(line)
  }
  const context = () => `\n${trace.join('\n')}\n`

  const currentAttemptLeftRepKey = (reply: Reply): boolean =>
    harness.google.sent.some(
      (sent) =>
        sent.replyId === reply.id &&
        sent.publicationCycle === reply.publicationCycle &&
        sent.attemptNumber === reply.publicationAttempts,
    )

  /** Positive evidence that the current attempt never left RepKey. */
  function provablyNeverSent(before: ReplyEvidence): boolean {
    const reply = before.reply
    if (reply === null || reply.publicationAttempts < 1) return false
    const attempt = before.attempts.find(
      (row) =>
        row.publicationCycle === reply.publicationCycle &&
        row.attemptNumber === reply.publicationAttempts,
    )
    return (
      attempt !== undefined &&
      !currentAttemptLeftRepKey(reply) &&
      harness.clock().getTime() - attempt.startedAt.getTime() >= DISPATCH_WINDOW_MS
    )
  }

  // ── Steps ──────────────────────────────────────────────────────────

  /** What the verdicts depend on beyond the reply's state: what the real
   * binding says of its AI text, as a whole and apart from its window, what
   * the stand-in Google was asked for before, and which reply is stored. */
  async function evidenceOf(before: ReplyEvidence): Promise<CommandEvidence> {
    const reply = before.reply
    const binding = reply === null ? 'not_ai' : await harness.ai.bindingOf(reply.id)
    return {
      provablyNeverSent: provablyNeverSent(before),
      aiBindingCurrent: binding !== 'stale',
      aiInputsCurrent:
        reply === null ||
        binding !== 'stale' ||
        (await harness.ai.inputsCurrentOf(reply.id)),
      textClaimedBefore:
        reply !== null &&
        harness.wasClaimedBefore({ replyId: reply.id, text: reply.text }),
      stored: reply === null ? null : { id: reply.id, revision: reply.stateRevision },
    }
  }

  /** The reply a screen of that kind shows. A replaced reply at the stored
   * reply's own revision is preferred: a number cannot tell the two apart. */
  function screenOf(kind: Screen, stored: ReplyOnScreen | null): ReplyOnScreen {
    if (stored === null) return NO_REPLY_ON_SCREEN
    if (kind === 'this_reply') return stored
    if (kind === 'an_earlier_revision') {
      return { id: stored.id, revision: stored.revision - 1 }
    }
    const replaced = shown.filter((reply) => reply.id !== stored.id)
    return (
      replaced.find((reply) => reply.revision === stored.revision) ??
      replaced.at(-1) ??
      NO_REPLY_ON_SCREEN
    )
  }

  function execute(command: ManagerCommand): Promise<unknown> {
    switch (command.kind) {
      case 'draft':
        return harness.commands.draft(command.text)
      case 'adopt_ai':
        return harness.commands.adoptAiSuggestion(command.text)
      case 'edit':
        return harness.commands.editPublished(command.text)
      case 'approve':
        // What the Inbox sends: the reply its screen showed, and its revision.
        return harness.commands.approve({
          id: replyId(command.onScreen.id),
          stateRevision: command.onScreen.revision,
        })
      default:
        return harness.commands[command.kind]()
    }
  }

  /** The command a manager step sends: its wild one, from the screen it names,
   * or one of those the workflow accepts from here. */
  function commandFor(
    step: Extract<Step, { act: 'manager' }>,
    state: OracleState,
    evidence: CommandEvidence,
  ): ManagerCommand {
    const { stored } = evidence
    if (step.wild !== null) {
      return step.wild.kind === 'approve'
        ? { kind: 'approve', onScreen: screenOf(step.wild.screen, stored) }
        : step.wild
    }
    const allowed = COMMAND_KINDS.map((kind) =>
      commandOf(kind, step.text, stored),
    ).filter((command) => managerVerdict(state, command, evidence).accepted)
    return allowed[step.pick % Math.max(allowed.length, 1)] ?? { kind: 'submit' }
  }

  /** What the command threw, or null when it went through. */
  async function failureOf(command: ManagerCommand): Promise<unknown> {
    try {
      await execute(command)
      return null
    } catch (error) {
      return error
    }
  }

  /** Which of the refusals the run must have met this one is. */
  function noteRefusal(
    command: ManagerCommand,
    code: Extract<ManagerVerdict, { accepted: false }>['code'],
    state: OracleState,
    stored: ReplyOnScreen | null,
  ): void {
    if (code === 'ai_suggestion_stale' && command.kind !== 'adopt_ai') {
      covered.add(`stale AI text refused: ${command.kind}`)
    }
    if (code === 'invalid_reply') covered.add(`blank reply refused: ${command.kind}`)
    if (command.kind !== 'approve' || state?.status !== 'pending_approval' || !stored) {
      return
    }
    const otherScreen = otherScreenOf(command, stored)
    if (otherScreen === 'an earlier revision') covered.add('earlier revision refused')
    // The case a revision alone cannot see: another reply, at this revision.
    if (
      otherScreen === 'another reply' &&
      command.onScreen.revision === stored.revision
    ) {
      covered.add('replaced reply refused at the same revision')
    }
  }

  async function manager(
    step: Extract<Step, { act: 'manager' }>,
    before: ReplyEvidence,
    evidence: CommandEvidence,
  ): Promise<void> {
    const state = toOracle(before.reply)
    const { stored } = evidence
    const command = commandFor(step, state, evidence)
    const verdict = managerVerdict(state, command, evidence)
    const staleAi = state?.authorship === 'ai_assisted' && !evidence.aiBindingCurrent
    say(commandLine(command, otherScreenOf(command, stored), staleAi, verdict))

    const failure = await failureOf(command)
    const after = await harness.evidence()

    if (verdict.accepted) {
      expect(failure, context()).toBeNull()
      expect(sameReplyState(toOracle(after.reply), verdict.next), context()).toBe(true)
      if (command.kind === 'approve') approvals += 1
      // The window never keeps a manager from taking a stale AI reply back or
      // making it their own.
      if (staleAi) covered.add(`stale AI text: ${command.kind}`)
      return
    }
    noteRefusal(command, verdict.code, state, stored)
    // A refusal is a tagged error the Inbox can show, never a database error,
    // and it leaves the reply and its evidence exactly as they were.
    const refusal = failure === null ? 'the command was accepted' : String(failure)
    expect(isReviewError(failure), `${refusal}${context()}`).toBe(true)
    expect((failure as { code: string }).code, context()).toBe(verdict.code)
    expect(after, context()).toEqual(before)
  }

  /**
   * The claim is the last gate for AI text: text that is stale and was never
   * claimed, or whose inputs changed, is not sent. An execution that got as
   * far as the claim (this cycle's job, with an execution left) withdraws the
   * reply as the purge would; any other execution leaves it alone.
   */
  function expectRefusedClaim(
    pre: OracleReply,
    post: OracleState,
    reachedTheClaim: boolean,
    evidence: CommandEvidence,
  ): void {
    const expected = reachedTheClaim ? afterRefusedClaim(pre) : pre
    expect(sameReplyState(post, expected), context()).toBe(true)
    if (!reachedTheClaim) return
    covered.add(
      evidence.aiInputsCurrent
        ? 'stale AI text: withdrawn at the claim'
        : 'AI text with a changed input: withdrawn at the claim',
    )
  }

  /** A write was attempted: the row went exactly where that outcome leads. */
  function expectWriteOutcome(
    pre: OracleReply,
    post: OracleState,
    step: Extract<Step, { act: 'job' }>,
    evidence: CommandEvidence,
  ): void {
    // Stale by now, and sent all the same: these words were claimed before.
    if (pre.authorship === 'ai_assisted' && !evidence.aiBindingCurrent) {
      covered.add('stale AI text: claimed again')
    }
    let expected: OracleReply | null = pre
    for (const event of jobEvents(step.outcome, step.final)) {
      expected = expected && afterPublicationEvent(expected, event)
    }
    expect(
      expected,
      `a write left for a row that could not be claimed${context()}`,
    ).not.toBeNull()
    expect(sameReplyState(post, expected), context()).toBe(true)
  }

  async function job(
    step: Extract<Step, { act: 'job' }>,
    before: ReplyEvidence,
    evidence: CommandEvidence,
  ): Promise<void> {
    if (harness.jobs.length === 0) return say('job: nothing queued')
    const index = step.job % harness.jobs.length
    const callsBefore = harness.google.calls
    const ran = await harness.runPublishJob(index, step.outcome, step.final)
    const called = harness.google.calls > callsBefore
    say(
      `job #${index} (${step.outcome}${step.final ? ', last execution' : ''}) → ${
        !ran ? 'no execution left' : called ? 'called Google' : 'made no write'
      }`,
    )
    const pre = toOracle(before.reply)
    const post = toOracle((await harness.evidence()).reply)
    if (pre === null) return expect(post, context()).toBeNull()
    expect(post, context()).not.toBeNull()
    if (pre.publication === 'authorized' && !mayBeClaimed(pre, evidence)) {
      expect(called, `stale AI text was claimed${context()}`).toBe(false)
      const reachedTheClaim =
        ran &&
        harness.jobs[index]?.data.publicationCycle === before.reply?.publicationCycle
      return expectRefusedClaim(pre, post, reachedTheClaim, evidence)
    }
    if (called) return expectWriteOutcome(pre, post, step, evidence)
    expect(reachableBy(pre, post!, READBACK_EVENTS, 1), context()).toBe(true)
  }

  async function sweep(
    step: Extract<Step, { act: 'sweep' }>,
    before: ReplyEvidence,
    evidence: CommandEvidence,
  ): Promise<void> {
    harness.advance(step.waitMinutes * MINUTE_MS)
    const now = harness.clock()
    const racing = harness.jobs.length > 0 ? step.racing : null
    say(
      `wait ${step.waitMinutes} min, sweep${
        racing ? `, while a worker runs the newest job (${racing})` : ''
      }`,
    )
    await harness.runSweep(
      racing
        ? async () => {
            await harness.runPublishJob(harness.jobs.length - 1, racing, false)
          }
        : undefined,
    )
    const pre = toOracle(before.reply)
    const post = toOracle((await harness.evidence()).reply)
    if (pre === null) return expect(post, context()).toBeNull()
    expect(post, context()).not.toBeNull()

    if (!racing) {
      expect(reachableBy(pre, post!, SWEEP_EVENTS, 1), context()).toBe(true)
      // A cycle nobody claimed by its recovery deadline is ended as not sent.
      const due = before.reply?.reconcileDueAt
      if (pre.publication === 'authorized' && due && due.getTime() <= now.getTime()) {
        expect(post, context()).toMatchObject({
          status: 'publish_failed',
          publication: 'terminal',
          lastFailure: 'retryable',
        })
      }
      return
    }
    if (pre.publication === 'authorized' && !mayBeClaimed(pre, evidence)) {
      // A worker that may not claim the cycle withdraws the reply, and the
      // sweep's settlement of the row it read then matches nothing. A worker
      // with no execution left does nothing, and the sweep makes its move.
      const withdrawn = afterRefusedClaim(pre)
      expect(
        sameReplyState(post, withdrawn) || reachableBy(pre, post!, SWEEP_EVENTS, 1),
        context(),
      ).toBe(true)
      return
    }
    // The worker's moves, then at most one of the sweep's.
    const workerAndSweep = [
      ...jobEvents(racing, false),
      ...READBACK_EVENTS,
      ...SWEEP_EVENTS,
    ]
    expect(reachableBy(pre, post!, workerAndSweep, 3), context()).toBe(true)
  }

  async function observe(before: ReplyEvidence): Promise<void> {
    say(
      `sync reads Google: ${harness.google.live ? `"${harness.google.live.text}"` : 'no reply'}`,
    )
    await harness.observeGoogle()
    const pre = toOracle(before.reply)
    const post = toOracle((await harness.evidence()).reply)
    if (pre === null) return expect(post, context()).toBeNull()
    expect(post, context()).not.toBeNull()
    expect(reachableBy(pre, post!, SYNC_EVENTS, 1), context()).toBe(true)
  }

  async function cancel(before: ReplyEvidence): Promise<void> {
    say('Google is disconnected: undispatched publications are cancelled')
    const cancelledCount = await harness.cancelUndispatched()
    const pre = toOracle(before.reply)
    const post = toOracle((await harness.evidence()).reply)
    const expected =
      pre !== null && pre.publication === 'authorized'
        ? afterPublicationEvent(pre, 'cancel')
        : pre
    expect(sameReplyState(post, expected), context()).toBe(true)
    expect(cancelledCount, context()).toBe(pre?.publication === 'authorized' ? 1 : 0)
  }

  const cancellationFacts = (evidence: ReplyEvidence): number =>
    evidence.facts['review.reply.publication_cancelled'] ?? 0

  /** Which of the purge's three outcomes the run has now seen. */
  function notePurge(pre: OracleState, expected: OracleState): void {
    if (pre?.authorship !== 'ai_assisted') return
    if (expected === null) covered.add('purge: deleted an AI reply nobody confirmed')
    else if (expected.text === '') covered.add('purge: emptied a confirmed AI reply')
    else covered.add('purge: left an AI reply alone')
  }

  async function purge(
    step: Extract<Step, { act: 'purge' }>,
    before: ReplyEvidence,
  ): Promise<void> {
    const everyAiReply = step.scope === 'every_ai_reply'
    const pastItsWindow =
      before.reply !== null && (await harness.ai.pastItsWindow(before.reply.id))
    say(
      everyAiReply
        ? 'something AI drafts were generated from changes: the purge runs for all of them'
        : `sync sees the unchanged review: the purge runs for AI drafts past their window${pastItsWindow ? ' (this one is)' : ''}`,
    )
    await (everyAiReply ? harness.ai.changeInput() : harness.ai.observeReviewAgain())
    const after = await harness.evidence()
    const pre = toOracle(before.reply)
    const expected = afterAiDraftPurge(pre, step.scope, pastItsWindow)
    expect(sameReplyState(toOracle(after.reply), expected), context()).toBe(true)
    // Whoever was waiting on the reply (an approver, or the author of a
    // confirmed one) is told once. A draft nobody was asked about, and a reply
    // the purge left alone, tell nobody.
    const wasWaitedOn =
      pre !== null &&
      (pre.status === 'pending_approval' || pre.publication === 'authorized')
    const told = wasWaitedOn && !sameReplyState(pre, expected) ? 1 : 0
    expect(cancellationFacts(after) - cancellationFacts(before), context()).toBe(told)
    notePurge(pre, expected)
  }

  // ── Invariants (src/contexts/review/CONTEXT.md) ────────────────────

  function assertInvariants(now: ReplyEvidence): void {
    const { reply, authorizations, attempts, facts } = now
    const at = context()

    // Publication authorizations and attempts are append-only evidence.
    expect(authorizations.length + attempts.length, at).toBeGreaterThanOrEqual(
      evidenceRows,
    )
    evidenceRows = authorizations.length + attempts.length

    // What left RepKey was the text authorized for its cycle, and never while
    // an earlier request was of unknown outcome (Invariant 9). One request per
    // attempt, each for an attempt that was claimed (Invariant 7).
    expect(harness.google.violations, at).toEqual([])
    const sentKeys = harness.google.sent.map(
      (sent) => `${sent.replyId}:${sent.publicationCycle}:${sent.attemptNumber}`,
    )
    expect(new Set(sentKeys).size, at).toBe(sentKeys.length)
    for (const sent of harness.google.sent) {
      expect(
        attempts.some(
          (row) =>
            row.publicationCycle === sent.publicationCycle &&
            row.attemptNumber === sent.attemptNumber,
        ),
        at,
      ).toBe(true)
    }

    // BETA §5 and the approved fact: one approval, one fact.
    expect(facts['review.reply.approved'] ?? 0, at).toBe(approvals)

    if (reply === null) {
      // Evidence keeps its reply: a deleted reply never had any.
      expect(authorizations, at).toEqual([])
      expect(attempts, at).toEqual([])
      return
    }
    const state = toOracle(reply)!
    expect(isLegalReplyState(state), `${JSON.stringify(state)}${at}`).toBe(true)
    covered.add(`${state.status}/${String(state.publication)}`)
    if (state.authorship === 'ai_assisted') covered.add(`AI text: ${state.status}`)
    // Invariant 5: blank text is not a reply. It is what a withdrawal leaves,
    // in a draft, and nothing puts it forward: not to an approver, not to a
    // worker.
    if (reply.text.trim() === '') expect(reply.status, at).toBe('draft')

    // What a confirmation names, a reply at a revision, is one text in one
    // status for as long as the history runs. A revision alone is not: every
    // new reply counts from 1 again.
    const screen: ReplyOnScreen = { id: reply.id, revision: reply.stateRevision }
    const key = `${screen.id}@${screen.revision}`
    const says = `${reply.status}: ${reply.text}`
    expect(saidOnScreen.get(key) ?? says, at).toBe(says)
    if (!saidOnScreen.has(key)) shown.push(screen)
    saidOnScreen.set(key, says)

    // Invariant 7: every cycle commits its authorization and its intent.
    expect(
      authorizations.map((row) => row.publicationCycle),
      at,
    ).toEqual(Array.from({ length: reply.publicationCycle }, (_, index) => index + 1))
    expect(facts['review.reply.publication_requested'] ?? 0, at).toBe(
      reply.publicationCycle,
    )

    const confirmed =
      reply.status === 'approved' ||
      reply.status === 'published' ||
      reply.status === 'publish_failed'
    if (confirmed) {
      // A confirmed reply names who confirmed it, and its text is still the
      // text that was authorized: nothing rewrites it while it is being
      // published, after it failed, or once it is published.
      expect(reply.approvedBy, at).not.toBeNull()
      expect(reply.approvedAt, at).not.toBeNull()
      expect(googleReplyTextDigest(reply.text), at).toBe(
        authorizations[reply.publicationCycle - 1]?.expectedReplyDigest,
      )
    }
    // Only an exact observation publishes: a reply recorded as published
    // carries the text Google shows.
    if (reply.status === 'published') {
      expect(harness.google.live?.text, at).toBe(reply.text)
    }
    // "Not sent" is true: a reply settled as a retryable failure has no
    // request for its current attempt on the wire or at Google.
    if (
      reply.publicationState === 'terminal' &&
      reply.publicationLastErrorClass === 'retryable'
    ) {
      expect(currentAttemptLeftRepKey(reply), at).toBe(false)
    }
  }

  async function run(steps: ReadonlyArray<Step>): Promise<void> {
    await harness.reset()
    for (const step of steps) {
      const before = await harness.evidence()
      if (step.act === 'manager') await manager(step, before, await evidenceOf(before))
      else if (step.act === 'job') await job(step, before, await evidenceOf(before))
      else if (step.act === 'sweep') await sweep(step, before, await evidenceOf(before))
      else if (step.act === 'observe') await observe(before)
      else if (step.act === 'cancel') await cancel(before)
      else if (step.act === 'purge') await purge(step, before)
      else if (step.act === 'lapse') {
        const lapsed = await harness.ai.letWindowPass()
        say(`ten minutes pass: ${lapsed} AI-assisted reply past its adoption window`)
      } else {
        say(`wait ${step.minutes} min`)
        harness.advance(step.minutes * MINUTE_MS)
      }
      assertInvariants(await harness.evidence())
    }
  }

  return { run, covered }
}

describe.sequential('reply workflow model (PostgreSQL)', () => {
  it('keeps the Review invariants through generated histories of commands, worker executions, sweeps and syncs', async () => {
    const covered = new Set<string>()
    await fc.assert(
      fc.asyncProperty(
        // `size: 'max'`: by default fast-check keeps arrays near ten items,
        // and a publication needs most of that just to be confirmed.
        fc.array(arbStep, { minLength: 10, maxLength: 40, size: 'max' }),
        async (steps) => {
          const history = createRun()
          await history.run(steps)
          for (const state of history.covered) covered.add(state)
        },
      ),
      // The trace in every assertion message is the counterexample; shrinking
      // a guided walk would replay hundreds of histories against PostgreSQL.
      // A fixed seed: the same histories on every run, so a failure here is a
      // change in the code and never a new draw. The scripted histories run
      // first and count toward the sixty.
      {
        numRuns: 60,
        seed: MODEL_SEED,
        endOnFailure: true,
        examples: SCRIPTED_HISTORIES.map((steps): [Step[]] => [[...steps]]),
      },
    )
    // The histories are only evidence if they went through publication, its
    // failures and its cancellation, not just through drafts; if AI text went
    // the same way; if its stale binding was both refused where it gates and
    // passed where it must not; if the purge deleted, emptied and left alone,
    // and what it emptied was refused as a reply; and if a confirmation met
    // both a rewritten reply and a replaced one.
    expect([...covered].sort()).toEqual(
      expect.arrayContaining([
        'approved/authorized',
        'approved/pending_observation',
        'approved/sending',
        'draft/cancelled',
        'publish_failed/ambiguous',
        'publish_failed/terminal',
        'published/published',
        'AI text: draft',
        'AI text: pending_approval',
        'AI text: approved',
        'AI text: published',
        'AI text: publish_failed',
        'stale AI text refused: submit',
        'stale AI text refused: approve',
        'stale AI text: withdrawn at the claim',
        'AI text with a changed input: withdrawn at the claim',
        'stale AI text: claimed again',
        'purge: deleted an AI reply nobody confirmed',
        'purge: emptied a confirmed AI reply',
        'purge: left an AI reply alone',
        'blank reply refused: submit',
        'stale AI text: draft',
        'stale AI text: reject',
        'stale AI text: retry',
        'stale AI text: edit',
        'earlier revision refused',
        'replaced reply refused at the same revision',
      ]),
    )
  }, 300_000)
})
