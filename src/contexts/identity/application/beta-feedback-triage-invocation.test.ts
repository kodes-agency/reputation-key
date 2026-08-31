import { describe, expect, it } from 'vitest'
import { parseBetaFeedbackTriageInvocation } from './beta-feedback-triage-invocation'

describe('beta feedback triage operator invocation', () => {
  it('defaults to a report-only invocation', () => {
    expect(parseBetaFeedbackTriageInvocation([])).toEqual({ mode: 'report' })
  })

  it('parses one exact CAS-protected transition', () => {
    expect(
      parseBetaFeedbackTriageInvocation([
        '00000000-0000-4000-8000-000000000001',
        '4',
        'accepted',
        'P2',
        'clear',
        'none',
        'reproduced',
        'unique',
        'none',
        'engineering',
        'operator@example.invalid',
        'sent',
        'github:rep-key:123',
        '00000000-0000-4000-8000-000000000002',
      ]),
    ).toEqual({
      mode: 'apply',
      reference: '00000000-0000-4000-8000-000000000001',
      expectedRevision: 4,
      toState: 'accepted',
      severity: 'P2',
      privacyClass: 'clear',
      securityClass: 'none',
      reproduction: 'reproduced',
      dedupeDisposition: 'unique',
      duplicateOfReference: null,
      ownerQueue: 'engineering',
      ownerId: 'operator@example.invalid',
      customerResponse: 'sent',
      engineeringIssueRef: 'github:rep-key:123',
      transitionId: '00000000-0000-4000-8000-000000000002',
    })
  })

  it('rejects missing fields and uncontrolled values', () => {
    expect(() => parseBetaFeedbackTriageInvocation(['only-a-reference'])).toThrow(
      'beta_feedback_triage_invocation_invalid',
    )
    expect(() =>
      parseBetaFeedbackTriageInvocation([
        '00000000-0000-4000-8000-000000000001',
        '4',
        'deleted',
        'urgent',
        'clear',
        'none',
        'reproduced',
        'unique',
        'none',
        'engineering',
        'operator',
        'sent',
        'none',
        '00000000-0000-4000-8000-000000000002',
      ]),
    ).toThrow('beta_feedback_triage_invocation_invalid')
  })
})
