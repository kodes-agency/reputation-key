// The ONE total order the Handling History is told in, and the legacy
// redaction that keeps a backfilled row from inventing an actor.
//
// Both are pure and both are load-bearing: five append-only tables merge into
// one stream, and if the order were not total, two machines rendering the same
// history would tell a manager two different stories.

import { describe, expect, it } from 'vitest'
import { inboxItemId, userId } from '#/shared/domain/ids'
import {
  compareInboxHistoryEntries,
  orderInboxHistory,
  redactLegacyActor,
  type InboxHistoryEntry,
  type InboxHistoryKind,
} from './handling-history'

const ITEM = inboxItemId('11111111-1111-4111-8111-111111111111')
const ACTOR = userId('manager-1')

const detailFor = (kind: InboxHistoryKind): InboxHistoryEntry['detail'] => {
  switch (kind) {
    case 'cycle_opened':
      return {
        kind: 'cycle_opened',
        openedReason: 'feedback_submitted',
        manualReopenReason: null,
        manualReopenExplanation: null,
        supersedesCycleNumber: null,
        sourceRevision: 1,
      }
    case 'cycle_transition':
      return {
        kind: 'cycle_transition',
        transition: 'closed',
        transitionReason: 'handled',
        actorType: 'user',
      }
    case 'assignment':
      return {
        kind: 'assignment',
        reason: 'assign',
        previousAssignee: null,
        nextAssignee: ACTOR,
        previousAssigneeDisplayName: null,
        nextAssigneeDisplayName: 'Morgan Manager',
        bulkId: null,
      }
    case 'escalation':
      return { kind: 'escalation' } as InboxHistoryEntry['detail']
    case 'handling_outcome':
      return { kind: 'handling_outcome' } as InboxHistoryEntry['detail']
  }
}

const entry = (
  overrides: Partial<InboxHistoryEntry> & Pick<InboxHistoryEntry, 'id' | 'occurredAt'>,
): InboxHistoryEntry => {
  const kind = overrides.kind ?? 'cycle_opened'
  return {
    inboxItemId: ITEM,
    kind,
    cycleNumber: 1,
    stateRevision: 1,
    actorUserId: ACTOR,
    actorDisplayName: 'Morgan Manager',
    legacy: false,
    detail: detailFor(kind),
    ...overrides,
  }
}

const AT = (iso: string) => new Date(iso)

describe('compareInboxHistoryEntries', () => {
  it('orders by instant first', () => {
    const early = entry({ id: 'b', occurredAt: AT('2026-08-28T10:00:00.000Z') })
    const late = entry({ id: 'a', occurredAt: AT('2026-08-28T11:00:00.000Z') })
    expect(compareInboxHistoryEntries(early, late)).toBeLessThan(0)
    expect(compareInboxHistoryEntries(late, early)).toBeGreaterThan(0)
  })

  it('breaks an instant tie by cycle, putting a cycle-less entry last', () => {
    const at = AT('2026-08-28T10:00:00.000Z')
    const first = entry({ id: 'a', occurredAt: at, cycleNumber: 1 })
    const second = entry({ id: 'a', occurredAt: at, cycleNumber: 2 })
    const cycleless = entry({ id: 'a', occurredAt: at, cycleNumber: null })
    expect(compareInboxHistoryEntries(first, second)).toBeLessThan(0)
    // An entry that cannot be placed inside a cycle sorts after those that can.
    expect(compareInboxHistoryEntries(second, cycleless)).toBeLessThan(0)
  })

  it('then by state revision, with a revision-less entry first', () => {
    const at = AT('2026-08-28T10:00:00.000Z')
    const withRevision = entry({ id: 'a', occurredAt: at, stateRevision: 5 })
    const without = entry({ id: 'a', occurredAt: at, stateRevision: null })
    expect(compareInboxHistoryEntries(without, withRevision)).toBeLessThan(0)
  })

  it('then by what the rows MEAN, not by which query returned first', () => {
    const at = AT('2026-08-28T10:00:00.000Z')
    const transition = entry({ id: 'a', occurredAt: at, kind: 'cycle_transition' })
    const outcome = entry({ id: 'a', occurredAt: at, kind: 'handling_outcome' })
    // A close transition and the outcome it completes are written in one
    // transaction: the transition is told first.
    expect(compareInboxHistoryEntries(transition, outcome)).toBeLessThan(0)
  })

  it('finally by id, in code-unit order, so the order is total', () => {
    const at = AT('2026-08-28T10:00:00.000Z')
    const a = entry({ id: 'a', occurredAt: at })
    const b = entry({ id: 'b', occurredAt: at })
    expect(compareInboxHistoryEntries(a, b)).toBe(-1)
    expect(compareInboxHistoryEntries(b, a)).toBe(1)
    expect(compareInboxHistoryEntries(a, entry({ id: 'a', occurredAt: at }))).toBe(0)
  })
})

describe('orderInboxHistory', () => {
  it('returns a new array and does not mutate the input', () => {
    const at = AT('2026-08-28T10:00:00.000Z')
    const input = [
      entry({ id: 'c', occurredAt: AT('2026-08-28T12:00:00.000Z') }),
      entry({ id: 'a', occurredAt: at }),
      entry({ id: 'b', occurredAt: at, kind: 'handling_outcome' }),
    ]
    const snapshot = input.map((item) => item.id)

    expect(orderInboxHistory(input).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(input.map((item) => item.id)).toEqual(snapshot)
  })
})

describe('redactLegacyActor', () => {
  it('returns a non-legacy entry untouched, by identity', () => {
    const live = entry({ id: 'a', occurredAt: AT('2026-08-28T10:00:00.000Z') })
    expect(redactLegacyActor(live)).toBe(live)
  })

  it('strips the actor from a backfilled row, so no renderer can invent one', () => {
    const legacy = entry({
      id: 'a',
      occurredAt: AT('2026-08-28T10:00:00.000Z'),
      legacy: true,
    })
    expect(redactLegacyActor(legacy)).toEqual({
      ...legacy,
      actorUserId: null,
      actorDisplayName: null,
    })
  })
})
