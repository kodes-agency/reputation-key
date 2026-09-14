// `historyEventLine` for assignment rows, in a file of its own: the suite for
// every other kind, `history-event-line.test.ts`, stands at the edge of the 300
// counted lines ESLint `max-lines` allows under `src/components`, and the
// assignment reasons are where the row's `actorUserId` and the sentence's
// subject part ways — a rule worth its own fixtures.
//
// The fixtures repeat the base suite's shapes rather than importing them: a
// test file exporting helpers would be a module other suites could start to
// lean on, and these are a dozen lines.
import { describe, expect, it } from 'vitest'
import { inboxItemId, userId } from '#/shared/domain/ids'
import { historyEventLine, type HistoryEventLine } from './history-event-line'
import type { InboxHistoryEntry } from './inbox-thread-model'

const MARIA_ID = userId('user-maria')
const GEORGI_ID = userId('user-georgi')
const MARIA = 'Maria Petrova'

type AssignmentDetail = Extract<InboxHistoryEntry['detail'], { kind: 'assignment' }>

/** A row no person caused — what the server writes for a system event. */
const NO_ACTOR = { actorUserId: null, actorDisplayName: null } as const

function lineFor(
  detail: AssignmentDetail,
  over: Partial<InboxHistoryEntry> = {},
): HistoryEventLine | null {
  return historyEventLine({
    id: 'hist-assignment',
    inboxItemId: inboxItemId('11111111-1111-4111-8111-111111111111'),
    kind: 'assignment',
    occurredAt: new Date('2026-03-01T09:00:00.000Z'),
    cycleNumber: 1,
    stateRevision: 1,
    actorUserId: MARIA_ID,
    actorDisplayName: MARIA,
    legacy: false,
    detail,
    ...over,
  })
}

const assignment = (over: Partial<AssignmentDetail> = {}): AssignmentDetail => ({
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

/** The line's words as the node prints them, before the clause and the time. */
function spoken(line: HistoryEventLine | null): string {
  if (!line) throw new Error('expected a line, got silence')
  return [line.actor, line.verb, line.object].filter(Boolean).join(' ')
}

describe('historyEventLine — assignment', () => {
  it('returns the assignee as the object, not as words inside the verb', () => {
    expect(lineFor(assignment())).toEqual({
      actor: MARIA,
      verb: 'assigned this to',
      object: 'Georgi Ivanov',
      body: null,
    })
    expect(lineFor(release)).toMatchObject({ verb: 'unassigned this', object: null })
  })

  // `eligibility_lost` is written by the system with the TRIGGERING person as
  // `actorUserId`: the admin who removed a member (`inbox-command-store.ts:1908`,
  // one row on every item the member held) and the manager who reopened an item
  // whose holder had lost eligibility (`:1755` bulk, `:2396` single). Neither
  // unassigned anybody, so the name must not become the subject of the verb.
  it('names nobody on an eligibility release, even though the row carries the trigger', () => {
    const lost = assignment({
      reason: 'eligibility_lost',
      previousAssignee: GEORGI_ID,
      previousAssigneeDisplayName: 'Georgi Ivanov',
      nextAssignee: null,
      nextAssigneeDisplayName: null,
    })
    const expected = {
      actor: null,
      verb: 'Unassigned — the assignee is no longer eligible',
      object: null,
      body: null,
    }
    expect(lineFor(lost)).toEqual(expected)
    expect(lineFor(lost, NO_ACTOR)).toEqual(expected)
    expect(JSON.stringify(lineFor(lost))).not.toContain(MARIA)
  })

  it('reads a claim as the actor claiming it, not assigning it to themselves', () => {
    const claim = assignment({
      reason: 'claim',
      nextAssignee: MARIA_ID,
      nextAssigneeDisplayName: MARIA,
    })
    expect(lineFor(claim)).toEqual({
      actor: MARIA,
      verb: 'claimed this',
      object: null,
      body: null,
    })
    // With no actor to lead, the holder is still named — v1's sentence.
    expect(spoken(lineFor(claim, NO_ACTOR))).toBe('Assigned to Maria Petrova')
  })

  it('does not call it a claim when the row names a holder other than the actor', () => {
    // `claim` is only ever written with `nextAssignee === actorUserId`; a row
    // that disagrees says nothing reliable about who claimed, so it falls back
    // to the plain assignment, which is true either way.
    const odd = assignment({ reason: 'claim' })
    expect(spoken(lineFor(odd))).toBe('Maria Petrova assigned this to Georgi Ivanov')
  })

  it('names an unresolvable assignee `Unknown user`, never the id', () => {
    const line = lineFor(assignment({ nextAssigneeDisplayName: null }))
    expect(spoken(line)).toBe('Maria Petrova assigned this to Unknown user')
    expect(JSON.stringify(line)).not.toContain(GEORGI_ID)
  })
})
