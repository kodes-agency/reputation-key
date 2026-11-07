import { describe, expect, it } from 'vitest'
import { AUDIT_EVENT_RETENTION_RULE, auditEventCutoff } from './retention.server'
import { retentionRuleCutoff } from '#/shared/db/retention/retention-cutoff'
import { RETENTION_RULES } from '#/composition/retention-rules'

const now = new Date('2026-11-07T12:00:00Z')

describe('audit event occurrence retention', () => {
  it('uses exactly 365 elapsed days for both reads and the scheduled sweep', () => {
    const expected = new Date('2025-11-07T12:00:00Z')
    expect(auditEventCutoff(now)).toEqual(expected)
    expect(retentionRuleCutoff(AUDIT_EVENT_RETENTION_RULE, now)).toEqual(expected)
    expect(AUDIT_EVENT_RETENTION_RULE.tsColumn).toBe('occurred_at')
    expect(RETENTION_RULES.filter((rule) => rule.subject === 'audit_events')).toEqual([
      AUDIT_EVENT_RETENTION_RULE,
    ])
  })

  it('rejects an invalid clock rather than calculating an unbounded read', () => {
    expect(() => auditEventCutoff(new Date(NaN))).toThrow(
      'Invalid audit observation time',
    )
  })
})
