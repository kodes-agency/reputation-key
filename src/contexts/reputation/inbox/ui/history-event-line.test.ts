import { describe, expect, it } from 'vitest'
import { inboxItemId, userId } from '#/shared/domain/ids'
import { presentFeedbackHandlingOutcomeEvent } from './feedback-handling-presentation'
import { historyEventLine, type HistoryEventLine } from './history-event-line'
import type { InboxHistoryEntry } from './inbox-thread-model'

// The parts contract of plan v2.1 row 11, per kind, with every guard the
// varchar casts in `inbox-history.repository.ts` make reachable on a cached
// client. The words asserted here are the words a reader sees: the node joins
// actor, verb and object with single spaces and adds nothing else to them.

const ITEM_ID = inboxItemId('11111111-1111-4111-8111-111111111111')
const MARIA_ID = userId('user-maria')
const GEORGI_ID = userId('user-georgi')
const MARIA = 'Maria Petrova'

type Detail = InboxHistoryEntry['detail']
type DetailOf<K extends Detail['kind']> = Extract<Detail, { kind: K }>

function entry(detail: Detail, over: Partial<InboxHistoryEntry> = {}): InboxHistoryEntry {
  return {
    id: `hist-${detail.kind}`,
    inboxItemId: ITEM_ID,
    kind: detail.kind,
    occurredAt: new Date('2026-03-01T09:00:00.000Z'),
    cycleNumber: 1,
    stateRevision: 1,
    actorUserId: MARIA_ID,
    actorDisplayName: MARIA,
    legacy: false,
    detail,
    ...over,
  }
}

/** A row no person caused — what the server writes for a system event. */
const NO_ACTOR = { actorUserId: null, actorDisplayName: null } as const

const opened = (
  over: Partial<DetailOf<'cycle_opened'>> = {},
): DetailOf<'cycle_opened'> => ({
  kind: 'cycle_opened',
  openedReason: 'review_observed',
  manualReopenReason: null,
  manualReopenExplanation: null,
  supersedesCycleNumber: null,
  sourceRevision: 1,
  ...over,
})

const reopen = (over: Partial<DetailOf<'cycle_opened'>> = {}) =>
  opened({ openedReason: 'manual_reopen', ...over })

const transition = (
  over: Partial<DetailOf<'cycle_transition'>> = {},
): DetailOf<'cycle_transition'> => ({
  kind: 'cycle_transition',
  transition: 'closed',
  transitionReason: 'confirmed_on_google',
  actorType: 'user',
  ...over,
})

const assignment = (
  over: Partial<DetailOf<'assignment'>> = {},
): DetailOf<'assignment'> => ({
  kind: 'assignment',
  reason: 'assign',
  previousAssignee: null,
  nextAssignee: GEORGI_ID,
  previousAssigneeDisplayName: null,
  nextAssigneeDisplayName: 'Georgi Ivanov',
  bulkId: null,
  ...over,
})

const release = assignment({
  reason: 'release',
  nextAssignee: null,
  nextAssigneeDisplayName: null,
})

const outcome = (
  over: Partial<DetailOf<'handling_outcome'>> = {},
): DetailOf<'handling_outcome'> => ({
  kind: 'handling_outcome',
  outcome: 'follow_up_completed',
  outcomeRevision: 1,
  deadlineResult: 'on_time',
  completionAt: new Date('2026-03-02T08:00:00.000Z'),
  supersedesOutcomeId: null,
  ...over,
})

const correction = outcome({
  outcome: 'handled_with_team',
  supersedesOutcomeId: 'outcome-1',
})

const ESCALATED = { kind: 'escalation', escalation: 'escalated' } as const
const RESOLVED = { kind: 'escalation', escalation: 'resolved' } as const

/** The line's words as the node prints them, before the clause and the time. */
function spoken(line: HistoryEventLine | null): string {
  if (!line) throw new Error('expected a line, got silence')
  return [line.actor, line.verb, line.object].filter(Boolean).join(' ')
}

const lineFor = (detail: Detail, over: Partial<InboxHistoryEntry> = {}) =>
  historyEventLine(entry(detail, over))

// Every sentence this build can write, in both leads: `alone` is v1's sentence
// verbatim, `led` is what follows `Maria Petrova `.
const REOPEN_WORDS = [
  ['guest_follow_up_still_needed', 'guest follow-up still needed'],
  ['internal_follow_up_still_needed', 'internal follow-up still needed'],
  ['new_information', 'new information'],
  ['correcting_handling_status', 'correcting the handling status'],
  ['other', 'another reason'],
] as const

const CLOSE_WORDS = [
  ['confirmed_on_google', 'the reply is confirmed on Google'],
  ['external_reply_observed', 'a reply was already on Google'],
  ['guest_withdrawn', 'the guest withdrew'],
  ['private_feedback_handled', 'the feedback was handled'],
  ['source_ineligible', 'the source is no longer eligible'],
  ['superseded_by_source_revision', 'a newer version superseded it'],
] as const

type Sentence = readonly [name: string, detail: Detail, led: string, alone: string]

const SENTENCES: readonly Sentence[] = [
  ...REOPEN_WORDS.map(([manualReopenReason, words]): Sentence => [
    `manual reopen for ${manualReopenReason}`,
    reopen({ manualReopenReason }),
    `reopened — ${words}`,
    `Reopened — ${words}`,
  ]),
  ...CLOSE_WORDS.map(([transitionReason, words]): Sentence => [
    `close for ${transitionReason}`,
    transition({ transitionReason }),
    `closed this — ${words}`,
    `Closed — ${words}`,
  ]),
  ['manual reopen, no reason', reopen(), 'reopened this', 'Reopened'],
  [
    'reopen transition',
    transition({ transition: 'reopened' }),
    'reopened this',
    'Reopened',
  ],
  [
    'assignment',
    assignment(),
    'assigned this to Georgi Ivanov',
    'Assigned to Georgi Ivanov',
  ],
  ['release', release, 'unassigned this', 'Unassigned'],
  ['escalation', ESCALATED, 'escalated this', 'Escalated'],
  ['resolution', RESOLVED, 'resolved the escalation', 'Escalation resolved'],
  [
    'first outcome',
    outcome(),
    'handled — Follow-up completed',
    'Handled — Follow-up completed',
  ],
  [
    'correction',
    correction,
    'corrected the outcome — Handled with the team',
    'Outcome corrected — Handled with the team',
  ],
]

describe('historyEventLine — every sentence in both leads', () => {
  it.each(SENTENCES)('%s', (_name, detail, led, alone) => {
    const withActor = lineFor(detail)
    const withoutActor = lineFor(detail, NO_ACTOR)
    expect(withActor?.actor).toBe(MARIA)
    expect(spoken(withActor)).toBe(`${MARIA} ${led}`)
    expect(withoutActor?.actor).toBeNull()
    expect(spoken(withoutActor)).toBe(alone)
    // The capital is the contract's: lower after a name, upper when the verb leads.
    expect(withActor?.verb.charAt(0)).toMatch(/[a-z]/)
    expect(withoutActor?.verb.charAt(0)).toMatch(/[A-Z]/)
  })

  it('keeps `Reopened — new information` reachable as rendered text (pinned by e2e)', () => {
    const detail = reopen({ manualReopenReason: 'new_information' })
    expect(lineFor(detail, NO_ACTOR)?.verb).toBe('Reopened — new information')
    // One contiguous run after a name, which Playwright's case-insensitive
    // `getByText` matches (`activity-notification-facts.spec.ts`).
    expect(lineFor(detail)?.verb.toLowerCase()).toBe('reopened — new information')
  })
})

describe('historyEventLine — cycle_opened', () => {
  it.each([
    ['legacy_backfill', 'Earlier handling'],
    ['review_observed', 'Opened from Google'],
    ['feedback_submitted', 'Opened from guest feedback'],
    ['material_revision_changed', 'Reopened — the review was edited'],
    ['provider_reply_deleted', 'Reopened — the reply was removed from Google'],
    ['provider_reply_diverged', 'Reopened — the reply on Google no longer matches'],
  ] as const)('an opening from %s reads "%s" and names nobody', (openedReason, words) => {
    const expected = { actor: null, verb: words, object: null, body: null }
    expect(lineFor(opened({ openedReason }), NO_ACTOR)).toEqual(expected)
    // The writer stores `openedBy: null` for each of these; a row that still
    // carries a name must not read `Maria Petrova opened from Google`.
    expect(lineFor(opened({ openedReason }))).toEqual(expected)
  })

  it('carries a manual reopen’s explanation as the body', () => {
    const detail = reopen({
      manualReopenReason: 'other',
      manualReopenExplanation: 'Phoned again.',
    })
    expect(lineFor(detail)?.body).toBe('Phoned again.')
    expect(lineFor(reopen({ manualReopenExplanation: '' }))?.body).toBeNull()
  })

  it('falls silent on an opened reason this build cannot spell', () => {
    const widened = 'future_reason' as DetailOf<'cycle_opened'>['openedReason']
    expect(lineFor(opened({ openedReason: widened }))).toBeNull()
  })

  it('falls silent on an unknown reopen reason, dropping the explanation with it', () => {
    type Reason = NonNullable<DetailOf<'cycle_opened'>['manualReopenReason']>
    const detail = reopen({
      manualReopenReason: 'future_reopen' as Reason,
      manualReopenExplanation: 'Must not survive the sentence that frames it.',
    })
    expect(lineFor(detail)).toBeNull()
  })
})

describe('historyEventLine — cycle_transition', () => {
  it('is silent for an `opened` transition, which its cycle_opened row already tells', () => {
    expect(lineFor(transition({ transition: 'opened' }))).toBeNull()
  })

  it.each(['guest', 'provider', 'system', 'future_type'])(
    'names nobody on a transition whose actor type is %s, even with a name on the row',
    (actorType) => {
      type ActorType = DetailOf<'cycle_transition'>['actorType']
      const detail = transition({
        transitionReason: 'guest_withdrawn',
        actorType: actorType as ActorType,
      })
      expect(spoken(lineFor(detail))).toBe('Closed — the guest withdrew')
    },
  )

  it('humanises an unknown close reason rather than dropping a close that happened', () => {
    // `transitionReason` is a plain string on the wire: the close is true, only
    // its reason is unfamiliar.
    const line = lineFor(transition({ transitionReason: 'Manager_Override' }), NO_ACTOR)
    expect(line?.verb).toBe('Closed — manager override')
    expect(spoken(line)).not.toMatch(/undefined|_/)
  })

  it.each(['legacy_backfill', '', '___'])(
    'names no reason for %j',
    (transitionReason) => {
      expect(lineFor(transition({ transitionReason }), NO_ACTOR)?.verb).toBe('Closed')
    },
  )
})

describe('historyEventLine — the actor', () => {
  it('redacts a legacy row whose fixture still carries a name, starting at the verb', () => {
    const line = lineFor(reopen({ manualReopenReason: 'other' }), { legacy: true })
    expect(line?.actor).toBeNull()
    expect(spoken(line)).toBe('Reopened — another reason')
    expect(JSON.stringify(line)).not.toContain(MARIA)
  })

  it('treats an empty display name as no name', () => {
    const line = lineFor(ESCALATED, { actorDisplayName: '' })
    expect(line).toMatchObject({ actor: null, verb: 'Escalated' })
  })

  it('never falls back to the raw actor id for a name that did not resolve', () => {
    const line = lineFor(ESCALATED, { actorDisplayName: null })
    expect(line?.actor).toBeNull()
    expect(JSON.stringify(line)).not.toContain(MARIA_ID)
  })
})

describe('historyEventLine — handling_outcome', () => {
  it('reads a first outcome with its timing clause, no note, and the internal flag', () => {
    expect(lineFor(outcome())).toEqual({
      actor: MARIA,
      verb: 'handled — Follow-up completed',
      object: null,
      clause: 'on time',
      body: null,
      internal: true,
    })
  })

  it('marks every outcome internal, note or not, so the flag is no evidence of one', () => {
    const noted = lineFor(outcome({ internalNote: 'Offered an upgrade.' }))
    expect(noted).toMatchObject({ body: 'Offered an upgrade.', internal: true })
    // An absent key is what an unauthorized read AND a note-free outcome return.
    expect(lineFor(outcome({ internalNote: '' }))).toMatchObject({
      body: null,
      internal: true,
    })
  })

  it('makes no deadline claim on a correction', () => {
    expect(lineFor(correction)?.clause).toBeNull()
  })

  it.each([
    ['a first outcome', outcome()],
    ['a correction', correction],
  ])('reads %s alone in the presenter’s own words', (_name, detail) => {
    const presented = presentFeedbackHandlingOutcomeEvent(detail)
    expect(lineFor(detail, NO_ACTOR)?.verb).toBe(presented?.sentence)
  })

  it('falls silent on an outcome this build cannot name, note and all', () => {
    const widened = 'future_outcome' as DetailOf<'handling_outcome'>['outcome']
    expect(
      lineFor(outcome({ outcome: widened, internalNote: 'Must not render.' })),
    ).toBeNull()
  })
})

describe('historyEventLine — a kind this build does not know', () => {
  it('renders nothing for a sixth kind, and does not throw', () => {
    const future = { kind: 'future_kind', payload: 1 } as unknown as Detail
    expect(() => lineFor(future)).not.toThrow()
    expect(lineFor(future)).toBeNull()
  })
})

// A truthiness guard lets exactly one kind of unknown value through: a name
// `Object.prototype` already owns. `MAP['constructor']` is a function, so the
// varchar cast would print `function Object() { [native code] }` as a sentence.
describe('historyEventLine — an inherited property name is still unknown', () => {
  it.each(['constructor', 'toString', '__proto__'])(
    'is silent for openedReason %s',
    (name) => {
      expect(lineFor(opened({ openedReason: name as never }))).toBeNull()
    },
  )

  it('is silent for a manual reopen reason named toString', () => {
    expect(lineFor(reopen({ manualReopenReason: 'toString' as never }))).toBeNull()
  })

  it('humanises a close reason named constructor instead of printing a function', () => {
    const said = spoken(lineFor(transition({ transitionReason: 'constructor' })))
    expect(said).toBe(`${MARIA} closed this — constructor`)
  })
})
