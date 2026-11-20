import { describe, expect, it } from 'vitest'
import {
  replyQueueStage,
  type InboxItemReplyState,
} from '#/contexts/inbox/application/public-api'
import {
  REPLY_CHIP_WORDS,
  replyStateDescription,
  replyStateRowLabel,
  resolveReplyStateCopy,
} from './reply-state-copy'

const NEXT_CHECK_AT = new Date('2026-04-15T12:15:00Z')

const failedState = (
  overrides: Partial<Parameters<typeof resolveReplyStateCopy>[0]>,
): Parameters<typeof resolveReplyStateCopy>[0] => ({
  ...replyState('publish_failed'),
  ...overrides,
})

const replyState = (status: InboxItemReplyState['status']): InboxItemReplyState => ({
  status,
  publicationState: status === 'published' ? 'published' : null,
  publicationLastErrorClass: null,
  updatedAt: new Date('2026-04-15T12:00:00Z'),
})

describe('replyStateRowLabel', () => {
  it('keeps private drafts and about-to-close published replies off inbox rows', () => {
    expect(replyStateRowLabel(replyState('draft'))).toBeNull()
    expect(replyStateRowLabel(replyState('published'))).toBeNull()
  })

  const statuses: ReadonlyArray<InboxItemReplyState['status']> = [
    'draft',
    'pending_approval',
    'approved',
    'published',
    'rejected',
    'publish_failed',
  ]
  const publicationStates: ReadonlyArray<InboxItemReplyState['publicationState']> = [
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

  // The due time is a dimension of its own: an ambiguous publish with one
  // waits on Google, and without one needs a person (D8).
  const dueTimes: ReadonlyArray<{ due: string; reconcileDueAt: Date | null }> = [
    { due: 'no next check', reconcileDueAt: null },
    { due: 'a next check', reconcileDueAt: NEXT_CHECK_AT },
  ]

  it.each(
    statuses.flatMap((status) =>
      publicationStates.flatMap((publicationState) =>
        dueTimes.map(({ due, reconcileDueAt }) => ({
          status,
          publicationState,
          due,
          reconcileDueAt,
        })),
      ),
    ),
  )(
    'keeps queue stage and row copy aligned for $status × $publicationState × $due',
    (row) => {
      const state = {
        ...replyState(row.status),
        publicationState: row.publicationState,
        reconcileDueAt: row.reconcileDueAt,
      }
      const copy = resolveReplyStateCopy(state)
      const stage = replyQueueStage(state)

      if (stage === 'awaiting') {
        expect(copy.badge).toBe(REPLY_CHIP_WORDS.awaitingApproval)
      } else if (stage === 'waiting') {
        expect([
          REPLY_CHIP_WORDS.waitingForGoogle,
          REPLY_CHIP_WORDS.liveOnGoogle,
        ]).toContain(copy.badge)
      } else {
        expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.awaitingApproval)
        expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.waitingForGoogle)
        expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.liveOnGoogle)
      }
    },
  )
})

/**
 * D8: an ambiguous publication is only a person's problem once the automatic
 * read ladder has ended. While `reconcileDueAt` is set RepKey is still reading
 * Google on its own, so the row and the detail say `Waiting for Google`, the
 * same word as the queue it sits in.
 */
describe('ambiguous publication copy', () => {
  it('waits on Google while automatic checks continue', () => {
    const copy = resolveReplyStateCopy(
      failedState({
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: NEXT_CHECK_AT,
      }),
    )

    expect(copy.badge).toBe(REPLY_CHIP_WORDS.waitingForGoogle)
    expect(replyStateDescription(copy)).toBe(
      "Google hasn't shown this reply yet. RepKey keeps checking automatically and won't send it twice.",
    )
  })

  it('needs a check once automatic checks have stopped', () => {
    const copy = resolveReplyStateCopy(
      failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: null,
      }),
    )

    expect(copy.badge).toBe(REPLY_CHIP_WORDS.needsCheck)
    expect(replyStateDescription(copy)).toBe(
      "RepKey couldn't confirm this reply on Google and has stopped checking automatically. It won't send it twice. Check Google again, or look at the review on Google.",
    )
  })

  it.each([
    {
      label: 'ambiguous with a next check',
      state: failedState({
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: NEXT_CHECK_AT,
      }),
      row: 'Waiting for Google',
    },
    {
      label: 'ambiguous with a next check serialized over the wire',
      state: failedState({
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: NEXT_CHECK_AT.toISOString(),
      }),
      row: 'Waiting for Google',
    },
    {
      label: 'ambiguous with nothing scheduled',
      state: failedState({
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: null,
      }),
      row: 'Needs a check',
    },
    {
      label: 'ambiguous from a row projection that carries no next check',
      state: failedState({
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
      }),
      row: 'Needs a check',
    },
    {
      label: 'terminal ambiguity',
      state: failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: null,
      }),
      row: 'Needs a check',
    },
    {
      // A stale due time on a terminal row is not a running ladder: only
      // `publication_state = 'ambiguous'` is walked by the sweep.
      label: 'terminal ambiguity with a leftover due time',
      state: failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: NEXT_CHECK_AT,
      }),
      row: 'Needs a check',
    },
  ])('labels the row for $label', ({ state, row }) => {
    expect(replyStateRowLabel(state)).toBe(row)
  })
})

describe('publication failure copy', () => {
  it('does not claim Google rejected a terminal rejection', () => {
    const copy = resolveReplyStateCopy(
      failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'terminal_rejection',
      }),
    )

    expect(copy.badge).toBe(REPLY_CHIP_WORDS.notPublished)
    expect(replyStateDescription(copy, 1)).toBe(
      "This reply couldn't be published, and nothing was posted to Google. Check the Google Business Profile connection, then try again.",
    )
  })

  it('counts attempts on a failure that is safe to send again', () => {
    const copy = resolveReplyStateCopy(
      failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      }),
    )

    expect(copy.badge).toBe(REPLY_CHIP_WORDS.notPublished)
    expect(replyStateDescription(copy, 1)).toBe(
      'RepKey stopped after 1 attempt, and nothing was published to Google, so it is safe to try again.',
    )
    expect(replyStateDescription(copy, 3)).toContain('stopped after 3 attempts,')
    expect(replyStateDescription(copy, 0)).toContain('No Google update was attempted')
  })

  /**
   * `retryable` includes the never-dispatched settlement (D4: no request left
   * RepKey), whose toast says the reply never reached Google. The description
   * shown beside that toast may say only what every retryable failure shares —
   * nothing was published — never that Google received and refused it.
   */
  it('never says Google received a retryable failure, or blames the connection', () => {
    const copy = resolveReplyStateCopy(
      failedState({
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
      }),
    )

    for (const attempts of [0, 1, 3]) {
      const description = replyStateDescription(copy, attempts) ?? ''
      expect(description).not.toMatch(/google did not accept|connection/i)
    }
  })

  it('describes an in-flight send without promising checks until it is confirmed', () => {
    const sending = resolveReplyStateCopy({
      ...replyState('approved'),
      publicationState: 'sending',
    })

    expect(replyStateDescription(sending)).toBe(
      'RepKey is publishing this reply to Google and checking that it appears. Google can take a few minutes.',
    )
  })

  /**
   * `sending` is claimed BEFORE the provider call (publish-reply.job.ts
   * header), and D4 settles some of those attempts as never dispatched. The
   * sentence may not assert a send the code cannot know happened.
   */
  it('does not claim a sending reply already reached Google', () => {
    const sending = resolveReplyStateCopy({
      ...replyState('approved'),
      publicationState: 'sending',
    })

    expect(replyStateDescription(sending)).not.toMatch(/\bsent\b/i)
  })
})
