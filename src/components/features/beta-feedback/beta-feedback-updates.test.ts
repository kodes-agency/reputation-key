import { describe, expect, it } from 'vitest'
import type { MyBetaFeedbackItem } from './beta-feedback-form-context'
import {
  markSeen,
  readSeenOutcomes,
  unseenOutcomes,
  updatesLabel,
  writeSeenOutcomes,
} from './beta-feedback-updates'

const REF_A = '00000000-0000-4000-8000-00000000000a'
const REF_B = '00000000-0000-4000-8000-00000000000b'
const REF_C = '00000000-0000-4000-8000-00000000000c'

function report(
  reference: string,
  triageState: MyBetaFeedbackItem['triageState'],
  deliveryState: MyBetaFeedbackItem['deliveryState'] = 'delivered',
): MyBetaFeedbackItem {
  return {
    reference,
    feedbackType: 'bug',
    impactCode: 'cannot_complete',
    routeKey: 'inbox',
    deliveryState,
    triageState,
    engineeringIssueRef: null,
    createdAt: new Date('2026-09-15T09:00:00.000Z'),
    updatedAt: new Date('2026-09-16T09:00:00.000Z'),
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('unseen report outcomes', () => {
  it('flags a resolved report the reporter has not looked at', () => {
    expect(
      unseenOutcomes([report(REF_A, 'resolved')], {}).map((r) => r.reference),
    ).toEqual([REF_A])
  })

  it('treats accepted and not-planned as outcomes too', () => {
    const items = [report(REF_A, 'accepted'), report(REF_B, 'declined')]

    expect(unseenOutcomes(items, {})).toHaveLength(2)
  })

  it('stays quiet about intermediate states', () => {
    const items = [
      report(REF_A, 'new'),
      report(REF_B, 'screened'),
      report(REF_C, 'reproducing'),
    ]

    expect(unseenOutcomes(items, {})).toEqual([])
  })

  it('stays quiet once the reporter has seen that outcome', () => {
    expect(unseenOutcomes([report(REF_A, 'resolved')], { [REF_A]: 'resolved' })).toEqual(
      [],
    )
  })

  it('flags again when an outcome changes after it was seen', () => {
    // Seen as accepted; since resolved. That is new news.
    expect(
      unseenOutcomes([report(REF_A, 'resolved')], { [REF_A]: 'accepted' }),
    ).toHaveLength(1)
  })

  it('ignores a report that never reached the team', () => {
    expect(unseenOutcomes([report(REF_A, 'resolved', 'failed')], {})).toEqual([])
  })
})

describe('seen outcome storage', () => {
  it('round-trips what the reporter saw', () => {
    const storage = memoryStorage()
    const items = [report(REF_A, 'resolved'), report(REF_B, 'new')]

    writeSeenOutcomes(storage, markSeen(items))

    expect(readSeenOutcomes(storage)).toEqual({ [REF_A]: 'resolved', [REF_B]: 'new' })
  })

  it('keeps only references still listed, so it cannot grow without bound', () => {
    expect(markSeen([report(REF_B, 'new')])).toEqual({ [REF_B]: 'new' })
  })

  it('reads nothing when there is no storage at all', () => {
    expect(readSeenOutcomes(undefined)).toEqual({})
  })

  it.each([
    ['malformed JSON', '{not json'],
    ['an array', '[1,2,3]'],
    ['a scalar', '"resolved"'],
  ])('reads nothing from %s rather than throwing', (_label, raw) => {
    const storage = memoryStorage({ 'repkey:beta-feedback:seen-outcomes:v1': raw })

    expect(readSeenOutcomes(storage)).toEqual({})
  })

  it('drops entries it does not recognise, so they cannot hide a marker', () => {
    const storage = memoryStorage({
      'repkey:beta-feedback:seen-outcomes:v1': JSON.stringify({
        [REF_A]: 'resolved',
        'not-a-reference': 'resolved',
        [REF_B]: 'closed-forever',
      }),
    })

    expect(readSeenOutcomes(storage)).toEqual({ [REF_A]: 'resolved' })
  })

  it('survives storage that refuses to be read or written', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    expect(readSeenOutcomes(blocked)).toEqual({})
    expect(() => writeSeenOutcomes(blocked, { [REF_A]: 'resolved' })).not.toThrow()
  })
})

describe('updates label', () => {
  it.each([
    [1, '1 report updated'],
    [2, '2 reports updated'],
  ])('describes %i as "%s"', (count, label) => {
    expect(updatesLabel(count)).toBe(label)
  })
})
