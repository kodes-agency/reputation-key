import { describe, expect, it } from 'vitest'
import { parseRecentActivityRecoveryInvocation } from './recent-activity-recovery-invocation'

describe('Recent Activity recovery operator invocation', () => {
  it('requires an explicit observation time', () => {
    expect(() => parseRecentActivityRecoveryInvocation([])).toThrow(
      'expected <observed-at>',
    )
    expect(() => parseRecentActivityRecoveryInvocation(['not-a-date'])).toThrow(
      'observed-at must be a valid ISO-8601 value',
    )
  })

  it('accepts a readiness-only invocation without a cursor', () => {
    expect(parseRecentActivityRecoveryInvocation(['2026-08-28T00:00:00.000Z'])).toEqual({
      observedAt: new Date('2026-08-28T00:00:00.000Z'),
    })
  })

  it('requires the complete cursor pair and rejects a future cursor', () => {
    expect(() =>
      parseRecentActivityRecoveryInvocation([
        '2026-08-28T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z',
      ]),
    ).toThrow('expected <observed-at>')
    expect(() =>
      parseRecentActivityRecoveryInvocation([
        '2026-08-28T00:00:00.000Z',
        '2026-08-29T00:00:00.000Z',
        'event:org:event-2',
      ]),
    ).toThrow('cannot be newer than observed-at')
  })

  it('accepts the exact cursor emitted by a previous bounded run', () => {
    expect(
      parseRecentActivityRecoveryInvocation([
        '2026-08-28T00:00:00.000Z',
        '2026-08-27T12:00:00.000Z',
        ' event:org:event-1 ',
      ]),
    ).toEqual({
      observedAt: new Date('2026-08-28T00:00:00.000Z'),
      after: {
        sourceOccurredAt: new Date('2026-08-27T12:00:00.000Z'),
        replayKey: 'event:org:event-1',
      },
    })
  })
})
