import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORGANIZATION_CLOSURE_RECOVERY_MS,
  ORGANIZATION_LIFECYCLE_CONTEXTS,
  assertOrganizationLifecycleTransition,
  assertOrganizationLifecycleTransitionReason,
  canCancelOrganizationClosure,
  canTransitionOrganizationLifecycle,
  organizationClosureDeadline,
  validateCompleteLifecycleReceipts,
  validateLifecycleEvidenceRef,
} from './organization-lifecycle'
import { identityOrganizationLifecycleChanged } from './events'

describe('Organization lifecycle rules', () => {
  it('gives an AccountAdmin request a 30-day recoverable window', () => {
    const requestedAt = new Date('2026-08-28T00:00:00.000Z')

    expect(DEFAULT_ORGANIZATION_CLOSURE_RECOVERY_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(organizationClosureDeadline(requestedAt).toISOString()).toBe(
      '2026-09-27T00:00:00.000Z',
    )
  })

  it('allows cancellation only while the request is still recoverable', () => {
    const recoverableUntil = new Date('2026-09-27T00:00:00.000Z')

    expect(
      canCancelOrganizationClosure({
        state: 'closure_requested',
        recoverableUntil,
        now: new Date('2026-09-26T23:59:59.999Z'),
      }),
    ).toBe(true)
    expect(
      canCancelOrganizationClosure({
        state: 'closing',
        recoverableUntil,
        now: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toBe(true)
    expect(
      canCancelOrganizationClosure({
        state: 'closure_requested',
        recoverableUntil,
        now: recoverableUntil,
      }),
    ).toBe(false)
    expect(
      canCancelOrganizationClosure({
        state: 'purge_pending',
        recoverableUntil,
        now: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toBe(false)
  })

  it('makes the Purging boundary irreversible', () => {
    expect(canTransitionOrganizationLifecycle('closure_requested', 'closing')).toBe(true)
    expect(canTransitionOrganizationLifecycle('closing', 'purge_pending')).toBe(true)
    expect(canTransitionOrganizationLifecycle('purge_pending', 'active')).toBe(true)
    expect(canTransitionOrganizationLifecycle('purge_pending', 'purging')).toBe(true)
    expect(canTransitionOrganizationLifecycle('purging', 'closed')).toBe(true)
    expect(canTransitionOrganizationLifecycle('purging', 'purge_pending')).toBe(false)
    expect(() => assertOrganizationLifecycleTransition('closed', 'active')).toThrow(
      /Invalid Organization lifecycle transition/,
    )
    expect(() =>
      assertOrganizationLifecycleTransitionReason(
        'purge_pending',
        'active',
        'purge_cancelled_before_irreversible',
      ),
    ).not.toThrow()
    expect(() =>
      assertOrganizationLifecycleTransitionReason(
        'purge_pending',
        'active',
        'context_purge_complete',
      ),
    ).toThrow(/reason does not match/)
    expect(() =>
      assertOrganizationLifecycleTransitionReason(
        'closure_requested',
        'active',
        'closing_prepared',
      ),
    ).toThrow(/reason does not match/)
  })

  it('requires one content-free receipt from every bounded context', () => {
    const receipts = ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => ({
      context,
      phase: 'closing' as const,
      outcome: 'complete' as const,
      evidenceRef: `closing:${context}:revision-1`,
    }))

    expect(validateCompleteLifecycleReceipts('closing', receipts)).toEqual(receipts)
    expect(() => validateCompleteLifecycleReceipts('closing', receipts.slice(1))).toThrow(
      /Missing Organization lifecycle receipts: activity/,
    )
    expect(() =>
      validateCompleteLifecycleReceipts('closing', [receipts[0]!, ...receipts]),
    ).toThrow(/Duplicate Organization lifecycle receipt/)
    expect(() => validateCompleteLifecycleReceipts('purge', receipts)).toThrow(
      /phase mismatch/,
    )
  })

  it('accepts only bounded content-free support evidence identifiers', () => {
    expect(validateLifecycleEvidenceRef('support:CASE-2048')).toBe('support:CASE-2048')
    expect(() => validateLifecycleEvidenceRef('free text with spaces')).toThrow(
      /content-free identifier/,
    )
    expect(() => validateLifecycleEvidenceRef('x'.repeat(201))).toThrow(/200/)
  })

  it('emits a content-minimal revision-fenced lifecycle fact', () => {
    expect(
      identityOrganizationLifecycleChanged({
        organizationId: 'org-1' as never,
        closureLineageId: '18deca2e-91a7-46e4-b92b-73163568ed84',
        state: 'closure_requested',
        revision: 1,
        reactivationRequired: true,
        recoverableUntil: new Date('2026-09-27T00:00:00.000Z'),
        occurredAt: new Date('2026-08-28T00:00:00.000Z'),
      }),
    ).toMatchObject({
      _tag: 'identity.organization_lifecycle.changed',
      organizationId: 'org-1',
      state: 'closure_requested',
      revision: 1,
      reactivationRequired: true,
    })
  })
})
