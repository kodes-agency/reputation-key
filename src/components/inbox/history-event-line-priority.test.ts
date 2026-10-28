// The priority line of Handling History (ADR 0071; copy deck C-14 alone and
// C-15 after a name), in a file of its own: `history-event-line.test.ts` is at
// the 300 counted lines ESLint `max-lines` allows under `src/components`.
import { describe, expect, it } from 'vitest'
import { inboxItemId, userId } from '#/shared/domain/ids'
import { historyEventLine } from './history-event-line'
import type { InboxHistoryEntry } from './inbox-thread-model'

type PriorityDetail = Extract<InboxHistoryEntry['detail'], { kind: 'priority' }>

function entry(
  detail: Omit<PriorityDetail, 'kind'>,
  actorDisplayName: string | null = 'Maria Lopez',
): InboxHistoryEntry {
  return {
    id: 'priority:item:2',
    inboxItemId: inboxItemId('11111111-1111-4111-8111-111111111111'),
    kind: 'priority',
    occurredAt: new Date('2026-10-28T09:00:00.000Z'),
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: userId('user-maria'),
    actorDisplayName,
    legacy: false,
    detail: { kind: 'priority', ...detail },
  }
}

/** The words a reader sees: actor, then the verb, as the node joins them. */
function words(value: InboxHistoryEntry): string | null {
  const line = historyEventLine(value)
  if (!line) return null
  return [line.actor, line.verb].filter(Boolean).join(' ')
}

describe('historyEventLine — priority', () => {
  it('says a first level was set', () => {
    expect(words(entry({ priority: 'urgent', previousPriority: null }))).toBe(
      'Maria Lopez set the priority to Urgent',
    )
    expect(words(entry({ priority: 'urgent', previousPriority: null }, null))).toBe(
      'Priority set to Urgent',
    )
  })

  it('says a level was changed, from what to what', () => {
    expect(words(entry({ priority: 'urgent', previousPriority: 'high' }))).toBe(
      'Maria Lopez changed the priority from High to Urgent',
    )
    expect(words(entry({ priority: 'urgent', previousPriority: 'high' }, null))).toBe(
      'Priority changed from High to Urgent',
    )
  })

  it('says a reset, with the level it cleared', () => {
    expect(words(entry({ priority: null, previousPriority: 'low' }))).toBe(
      'Maria Lopez reset the priority (was Low)',
    )
    expect(words(entry({ priority: null, previousPriority: 'low' }, null))).toBe(
      'Priority reset (was Low)',
    )
  })

  it('is silent for a level this build cannot spell, and for a reset of nothing', () => {
    expect(
      historyEventLine(entry({ priority: 'critical' as never, previousPriority: null })),
    ).toBeNull()
    expect(
      historyEventLine(entry({ priority: 'low', previousPriority: 'toString' as never })),
    ).toBeNull()
    expect(historyEventLine(entry({ priority: null, previousPriority: null }))).toBeNull()
  })
})
