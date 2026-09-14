import { describe, expect, it } from 'vitest'
import {
  type FeedbackHandlingOutcomeEvent,
  feedbackHandlingAction,
  feedbackHandlingOutcomeLabel,
  feedbackHandlingStatusLabel,
  presentFeedbackHandlingOutcomeEvent,
} from './feedback-handling-presentation'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { FeedbackHandlingState } from '#/contexts/inbox/application/public-api'

/**
 * A first completion. Every case below overrides exactly the one field it is
 * about, so a sentence that moves for the wrong reason fails a different test.
 */
const FIRST_OUTCOME: FeedbackHandlingOutcomeEvent = {
  outcome: 'follow_up_completed',
  deadlineResult: 'on_time',
  supersedesOutcomeId: null,
}

/** The same cycle, corrected: a different outcome pinned to the first one's id. */
const CORRECTION: FeedbackHandlingOutcomeEvent = {
  ...FIRST_OUTCOME,
  outcome: 'handled_with_team',
  supersedesOutcomeId: 'outcome-1',
}

const DEADLINE_RESULTS: ReadonlyArray<FeedbackHandlingOutcomeEvent['deadlineResult']> = [
  'on_time',
  'late',
  'not_measured',
]

/** An untouched cycle. Every case below overrides only the fields it is about. */
const CYCLE: FeedbackHandlingState = {
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  closeReason: null,
  currentOutcome: null,
  history: [],
}

/** One recorded manager outcome, as the detail bundle carries it. */
const OUTCOME: NonNullable<FeedbackHandlingState['currentOutcome']> = {
  id: 'outcome-1',
  inboxItemId: inboxItemId('11111111-1111-4111-8111-111111111111'),
  organizationId: organizationId('22222222-2222-4222-8222-222222222222'),
  propertyId: propertyId('33333333-3333-4333-8333-333333333333'),
  feedbackId: feedbackId('fb-1'),
  cycleNumber: 1,
  sourceRevision: 1,
  outcomeRevision: 1,
  outcome: 'follow_up_completed',
  internalNote: null,
  recordedBy: userId('44444444-4444-4444-8444-444444444444'),
  recordedAt: new Date('2026-03-02T08:00:00Z'),
  completionAt: new Date('2026-03-02T08:00:00Z'),
  deadlineResult: 'on_time',
  supersedesOutcomeId: null,
}

/** A cycle closed by `closeReason`, with no manager outcome recorded. */
const closedWith = (
  closeReason: FeedbackHandlingState['closeReason'],
): FeedbackHandlingState => ({ ...CYCLE, status: 'closed', closeReason })

describe('feedback handling presentation', () => {
  // `OUTCOME_LABELS['constructor']` is a function; the callers treat
  // `undefined` as "this build has no word", so an inherited name must be one.
  it('has no label for an outcome that names an inherited property', () => {
    expect(feedbackHandlingOutcomeLabel('constructor' as never)).toBeUndefined()
    expect(feedbackHandlingOutcomeLabel('__proto__' as never)).toBeUndefined()
  })

  it('uses calm, specific labels for every controlled outcome', () => {
    expect(feedbackHandlingOutcomeLabel('follow_up_completed')).toBe(
      'Follow-up completed',
    )
    expect(feedbackHandlingOutcomeLabel('follow_up_attempted')).toBe(
      'Follow-up attempted',
    )
    expect(feedbackHandlingOutcomeLabel('handled_with_team')).toBe(
      'Handled with the team',
    )
    expect(feedbackHandlingOutcomeLabel('reviewed_no_additional_step')).toBe(
      'Reviewed — no additional step',
    )
    expect(feedbackHandlingOutcomeLabel('content_concern_reviewed')).toBe(
      'Content concern reviewed',
    )
  })
})

describe('handling outcome as a thread event', () => {
  it('reads a first completion as the recorded result plus its timing', () => {
    expect(presentFeedbackHandlingOutcomeEvent(FIRST_OUTCOME)).toEqual({
      sentence: 'Handled — Follow-up completed',
      deadlineClause: 'on time',
    })
  })

  // A correction preserves the first completion's instant and timing result
  // verbatim, so its row must name itself a correction rather than read as a
  // second completion of the same work.
  it('reads a correction as a correction, not a second completion', () => {
    expect(presentFeedbackHandlingOutcomeEvent(CORRECTION)).toEqual({
      sentence: 'Outcome corrected — Handled with the team',
      deadlineClause: null,
    })
  })

  // `supersedesOutcomeId` is the discriminator, not `outcomeRevision`: the
  // presenter is not even given a revision number, so a cycle whose numbering
  // starts anywhere still reads correctly.
  it('recognises a correction from the superseded id alone', () => {
    const corrected = presentFeedbackHandlingOutcomeEvent({
      ...FIRST_OUTCOME,
      supersedesOutcomeId: 'outcome-1',
    })
    expect(corrected?.sentence).toBe('Outcome corrected — Follow-up completed')
  })

  it('states the deadline result of the first completion, in a quiet clause', () => {
    const clauseFor = (
      deadlineResult: FeedbackHandlingOutcomeEvent['deadlineResult'],
    ): string | null =>
      presentFeedbackHandlingOutcomeEvent({ ...FIRST_OUTCOME, deadlineResult })
        ?.deadlineClause ?? null

    expect(clauseFor('on_time')).toBe('on time')
    expect(clauseFor('late')).toBe('late')
    expect(clauseFor('not_measured')).toBe('timing not measured')
  })

  // `not_measured` means no measured handling target existed for the cycle. It
  // is the absence of a measurement, never a missed one, so the clause must not
  // borrow any of the words a real miss would use.
  it('does not read `not_measured` as a failure', () => {
    const clause =
      presentFeedbackHandlingOutcomeEvent({
        ...FIRST_OUTCOME,
        deadlineResult: 'not_measured',
      })?.deadlineClause ?? ''

    for (const miss of ['late', 'missed', 'overdue', 'failed', 'not met']) {
      expect(clause).not.toContain(miss)
    }
  })

  it('never repeats the deadline result on a correction, for any result', () => {
    for (const deadlineResult of DEADLINE_RESULTS) {
      expect(
        presentFeedbackHandlingOutcomeEvent({ ...CORRECTION, deadlineResult }),
      ).toEqual({
        sentence: 'Outcome corrected — Handled with the team',
        deadlineClause: null,
      })
    }
  })

  // The manager-internal note's key is ABSENT — not null, not empty — whenever
  // the reader may not see it. The sentence must therefore be byte-identical
  // either way, or its shape would tell an unauthorized reader that a note
  // exists.
  it('says exactly the same thing whether the internal note is readable or withheld', () => {
    const readable = { ...FIRST_OUTCOME, internalNote: 'Called the guest back' }
    const withheld = { ...FIRST_OUTCOME }

    expect(presentFeedbackHandlingOutcomeEvent(readable)).toEqual(
      presentFeedbackHandlingOutcomeEvent(withheld),
    )
    expect(JSON.stringify(presentFeedbackHandlingOutcomeEvent(readable))).not.toContain(
      'Called the guest back',
    )
  })

  // Both unions are cast out of `varchar` columns by the history repository, so
  // a value widened server-side reaches a manager's cached bundle with no
  // client deploy.
  it('falls silent on an outcome this build does not know', () => {
    const widened = 'guest_compensated' as FeedbackHandlingOutcomeEvent['outcome']
    expect(
      presentFeedbackHandlingOutcomeEvent({ ...FIRST_OUTCOME, outcome: widened }),
    ).toBeNull()
  })

  it('keeps the sentence and drops only the clause on an unknown timing result', () => {
    const widened = 'waived' as FeedbackHandlingOutcomeEvent['deadlineResult']
    expect(
      presentFeedbackHandlingOutcomeEvent({ ...FIRST_OUTCOME, deadlineResult: widened }),
    ).toEqual({ sentence: 'Handled — Follow-up completed', deadlineClause: null })
  })

  // Every label has to survive being embedded in the event sentence. Two are
  // awkward there and are pinned so a copy fix is a deliberate, visible change:
  // `handled_with_team` stutters after the `Handled — ` prefix, and
  // `reviewed_no_additional_step` puts a second em dash in one line. Both are
  // correct on the dialog's select and on the case-strip chip, which is why
  // neither label was changed in this PR.
  it('composes an event sentence for all five outcomes', () => {
    const sentences = (
      [
        'follow_up_completed',
        'follow_up_attempted',
        'handled_with_team',
        'reviewed_no_additional_step',
        'content_concern_reviewed',
      ] as const
    ).map(
      (outcome) =>
        presentFeedbackHandlingOutcomeEvent({ ...FIRST_OUTCOME, outcome })?.sentence,
    )

    expect(sentences).toEqual([
      'Handled — Follow-up completed',
      'Handled — Follow-up attempted',
      'Handled — Handled with the team',
      'Handled — Reviewed — no additional step',
      'Handled — Content concern reviewed',
    ])
  })
})
/**
 * Which action each reachable handling state offers. This is the predicate the
 * composer's foot renders AND the pane reads to place region 4's single accent,
 * so a state missing from here is a feedback item whose manager is offered
 * nothing and told nothing about why.
 */
describe('the action a handling cycle offers', () => {
  it('offers the first outcome on an open cycle', () => {
    expect(feedbackHandlingAction(CYCLE)).toBe('mark')
  })

  // A reopen bumps `currentCycleNumber` and the store scopes `history` to the
  // current cycle, so production never sends this shape. If a backfill ever
  // does, `mark` is still the honest offer: the open cycle has no outcome of
  // its own to correct.
  it('still offers the first outcome when an open cycle carries a stale outcome', () => {
    expect(feedbackHandlingAction({ ...CYCLE, currentOutcome: OUTCOME })).toBe('mark')
  })

  it('offers the correction once an outcome closed the cycle', () => {
    expect(
      feedbackHandlingAction({
        ...CYCLE,
        status: 'closed',
        closeReason: 'private_feedback_handled',
        currentOutcome: OUTCOME,
        history: [OUTCOME],
      }),
    ).toBe('correct')
  })

  // Every close reason that can leave a cycle with no outcome. The two the
  // domain refuses forever and the ones that merely need a reopen all answer
  // `null` — the difference between them is the SENTENCE
  // `feedback-handling-body.tsx` picks, not the action, because there is no
  // action either way.
  it('offers nothing for any close that recorded no outcome', () => {
    const reasons: ReadonlyArray<FeedbackHandlingState['closeReason']> = [
      'guest_withdrawn',
      'source_ineligible',
      'superseded_by_source_revision',
      'confirmed_on_google',
      'external_reply_observed',
      'private_feedback_handled',
      null,
    ]
    expect(
      reasons.map((closeReason) =>
        feedbackHandlingAction({ ...CYCLE, status: 'closed', closeReason }),
      ),
    ).toEqual(reasons.map(() => null))
  })
})

/**
 * The case strip's work-status chip, in words. Row 10 gives it three, and the
 * third exists because the other two can both be lies: `Handled` asserts a
 * manager judgement, and `Handled · <outcome>` names one. Every case below is
 * about which of those claims the data actually supports.
 */
describe('the work-status chip for a feedback item', () => {
  it('reads `Needs attention` while the cycle is open', () => {
    expect(feedbackHandlingStatusLabel(CYCLE, 'open')).toBe('Needs attention')
  })

  it('names the recorded outcome once one closed the cycle', () => {
    expect(
      feedbackHandlingStatusLabel(
        { ...closedWith('private_feedback_handled'), currentOutcome: OUTCOME },
        'closed',
      ),
    ).toBe('Handled · Follow-up completed')
  })

  // `handling-outcome-authority.ts` refuses a manager outcome for a withdrawn or
  // ineligible source FOREVER — no later cycle re-earns the right, and a manual
  // reopen is refused too. `Handled` there is a claim about a person that
  // nothing can ever substantiate, which is exactly what the deleted card was
  // criticised for. The chip must report the close, not imply a judgement.
  it('refuses to claim a judgement that can never exist, for either permanent close', () => {
    expect(feedbackHandlingStatusLabel(closedWith('guest_withdrawn'), 'closed')).toBe(
      'Closed — no outcome',
    )
    expect(feedbackHandlingStatusLabel(closedWith('source_ineligible'), 'closed')).toBe(
      'Closed — no outcome',
    )
  })

  // The mirror of the case above, and the reason the branch is a positive
  // recognition rather than a `closeReason !== 'guest_withdrawn'` test: these
  // closes leave a cycle a reopen can still carry to a real outcome, so the
  // third word would be as false here as `Handled` is there.
  it('keeps the bare `Handled` for a close that does not forbid an outcome', () => {
    const reopenable: ReadonlyArray<FeedbackHandlingState['closeReason']> = [
      'superseded_by_source_revision',
      'confirmed_on_google',
      'external_reply_observed',
      'private_feedback_handled',
      null,
    ]
    expect(
      reopenable.map((reason) =>
        feedbackHandlingStatusLabel(closedWith(reason), 'closed'),
      ),
    ).toEqual(reopenable.map(() => 'Handled'))
  })

  // `closeReason` is the CURRENT cycle's latest close transition; the server's
  // refusal scans every close reason ever recorded against the ITEM. An item
  // withdrawn in cycle 1 whose cycle 2 closed as superseded is therefore still
  // refused an outcome while reading `Handled` here. Pinned deliberately: the
  // client cannot see the item-wide list, so the fix is a server field, and
  // nobody should "fix" it by inferring permission from this cycle's reason.
  it('does not pretend to know an item-wide refusal from one cycle reason', () => {
    expect(
      feedbackHandlingStatusLabel(closedWith('superseded_by_source_revision'), 'closed'),
    ).toBe('Handled')
  })

  // A recorded outcome is read out even on a cycle the domain would now refuse.
  // The judgement demonstrably happened; the refusal only stops new ones.
  it('still names an outcome that was recorded before the source went away', () => {
    expect(
      feedbackHandlingStatusLabel(
        { ...closedWith('guest_withdrawn'), currentOutcome: OUTCOME },
        'closed',
      ),
    ).toBe('Handled · Follow-up completed')
  })

  // The server withholds `feedbackHandling` entirely from a caller who may read
  // private feedback but not handle it (`get-inbox-item-detail.ts`), so there is
  // no `closeReason` to branch on at all. That path must keep reading the item's
  // own status — `Closed — no outcome` would be a guess, and `Open`/`Closed`
  // would leak the review vocabulary onto a feedback item.
  it('reads the item status when the handling cycle is withheld', () => {
    expect(feedbackHandlingStatusLabel(null, 'open')).toBe('Needs attention')
    expect(feedbackHandlingStatusLabel(null, 'closed')).toBe('Handled')
  })

  // `outcome` is cast straight out of a `varchar` column, so a union widened
  // server-side reaches a manager's cached bundle with no client deploy. The
  // chip's label is also its whole accessible name, so an unguarded map index
  // put the literal text `Handled · undefined` in front of a screen reader.
  it('drops an outcome word this build cannot read, rather than printing undefined', () => {
    const widened = 'guest_compensated' as NonNullable<
      FeedbackHandlingState['currentOutcome']
    >['outcome']
    const label = feedbackHandlingStatusLabel(
      {
        ...closedWith('private_feedback_handled'),
        currentOutcome: { ...OUTCOME, outcome: widened },
      },
      'closed',
    )

    expect(label).toBe('Handled')
    expect(label).not.toContain('undefined')
  })

  // The guard above is only sound because the map index really can miss. If the
  // declared return ever narrows back to `string`, every caller's guard becomes
  // dead code again and this is the test that says so.
  it('reports an unknown outcome as undefined rather than a label', () => {
    const widened = 'guest_compensated' as Parameters<
      typeof feedbackHandlingOutcomeLabel
    >[0]
    expect(feedbackHandlingOutcomeLabel(widened)).toBeUndefined()
  })
})
