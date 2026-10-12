// Model-based test of the reply workflow on PostgreSQL (fast-check).
//
// Generated sequences of everything that can happen to a reply: the manager
// commands (draft, submit, approve, reject, retry, edit published, delete), a
// disconnect cancellation, executions of the publish worker with each provider
// outcome, the reconciliation sweep (also racing a worker that claims after the
// sweep read its batch), a review sync that reads Google, and the passing of
// time. They run against the real use cases, command store, observation store,
// worker and sweep (testing/reply-workflow-harness.ts).
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
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { Reply } from '../domain/types'
import { isReviewError } from '../domain/errors'
import { googleReplyTextDigest } from '../domain/google-reply-observation'
import {
  afterPublicationEvent,
  isLegalReplyState,
  managerVerdict,
  reachableBy,
  sameReplyState,
  type ManagerCommand,
  type OraclePublication,
  type OracleReply,
  type OracleState,
  type PublicationEvent,
} from '../domain/__fixtures__/reply-workflow-oracle'
import {
  createReplyWorkflowHarness,
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

type Step =
  | Readonly<{
      act: 'manager'
      pick: number
      wild: ManagerCommand | null
      text: (typeof TEXTS)[number]
    }>
  | Readonly<{ act: 'job'; job: number; outcome: GoogleWriteOutcome; final: boolean }>
  | Readonly<{ act: 'sweep'; waitMinutes: number; racing: GoogleWriteOutcome | null }>
  | Readonly<{ act: 'observe' }>
  | Readonly<{ act: 'cancel' }>
  | Readonly<{ act: 'wait'; minutes: number }>

const arbText = fc.constantFrom(...TEXTS)
const arbOutcome = fc.constantFrom(...WRITE_OUTCOMES)
const arbManagerCommand: fc.Arbitrary<ManagerCommand> = fc.oneof(
  arbText.map((text) => ({ kind: 'draft' as const, text })),
  arbText.map((text) => ({ kind: 'edit' as const, text })),
  fc.constantFrom(
    { kind: 'submit' as const },
    { kind: 'approve' as const },
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
  {
    weight: 1,
    arbitrary: fc.record({
      act: fc.constant('wait' as const),
      minutes: fc.constantFrom(10, 30),
    }),
  },
)

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
      }

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
})

afterAll(async () => {
  await harness.remove()
  clearEventSchemas()
  await pool.end()
})

/** One generated history, with what the invariants need remembered. */
function createRun() {
  const trace: string[] = []
  let approvals = 0
  let evidenceRows = 0
  const covered = new Set<string>()

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

  async function manager(
    step: Extract<Step, { act: 'manager' }>,
    before: ReplyEvidence,
  ): Promise<void> {
    const state = toOracle(before.reply)
    const evidence = { provablyNeverSent: provablyNeverSent(before) }
    const allowed = COMMAND_KINDS.map((kind): ManagerCommand =>
      kind === 'draft' || kind === 'edit' ? { kind, text: step.text } : { kind },
    ).filter((command) => managerVerdict(state, command, evidence).accepted)
    const command: ManagerCommand = step.wild ??
      allowed[step.pick % Math.max(allowed.length, 1)] ?? { kind: 'approve' }
    const verdict = managerVerdict(state, command, evidence)
    say(
      `${command.kind}${'text' in command ? ` "${command.text}"` : ''} → expect ${
        verdict.accepted ? 'accepted' : verdict.code
      }`,
    )

    let failure: unknown = null
    try {
      if (command.kind === 'draft') await harness.commands.draft(command.text)
      else if (command.kind === 'edit') await harness.commands.editPublished(command.text)
      else await harness.commands[command.kind]()
    } catch (error) {
      failure = error
    }
    const after = await harness.evidence()

    if (verdict.accepted) {
      expect(failure, context()).toBeNull()
      expect(sameReplyState(toOracle(after.reply), verdict.next), context()).toBe(true)
      if (command.kind === 'approve') approvals += 1
      return
    }
    // A refusal is a tagged error the Inbox can show, never a database error,
    // and it leaves the reply and its evidence exactly as they were.
    const refusal = failure === null ? 'the command was accepted' : String(failure)
    expect(isReviewError(failure), `${refusal}${context()}`).toBe(true)
    expect((failure as { code: string }).code, context()).toBe(verdict.code)
    expect(after, context()).toEqual(before)
  }

  async function job(
    step: Extract<Step, { act: 'job' }>,
    before: ReplyEvidence,
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
    if (called) {
      // A write was attempted: the row went exactly where that outcome leads.
      let expected: OracleReply | null = pre
      for (const event of jobEvents(step.outcome, step.final)) {
        expected = expected && afterPublicationEvent(expected, event)
      }
      expect(
        expected,
        `a write left for a row that could not be claimed${context()}`,
      ).not.toBeNull()
      expect(sameReplyState(post, expected), context()).toBe(true)
      return
    }
    expect(reachableBy(pre, post!, READBACK_EVENTS, 1), context()).toBe(true)
  }

  async function sweep(
    step: Extract<Step, { act: 'sweep' }>,
    before: ReplyEvidence,
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
      if (step.act === 'manager') await manager(step, before)
      else if (step.act === 'job') await job(step, before)
      else if (step.act === 'sweep') await sweep(step, before)
      else if (step.act === 'observe') await observe(before)
      else if (step.act === 'cancel') await cancel(before)
      else {
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
      // change in the code and never a new draw.
      { numRuns: 60, seed: MODEL_SEED, endOnFailure: true },
    )
    // The histories are only evidence if they went through publication, its
    // failures and its cancellation, not just through drafts.
    expect([...covered].sort()).toEqual(
      expect.arrayContaining([
        'approved/authorized',
        'approved/pending_observation',
        'approved/sending',
        'draft/cancelled',
        'publish_failed/ambiguous',
        'publish_failed/terminal',
        'published/published',
      ]),
    )
  }, 300_000)
})
