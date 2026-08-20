import { describe, expect, it } from 'vitest'
import { isCredentialLifecycleSweepEligible } from './credential-lifecycle'

const before = new Date('2026-08-10T12:00:00.000Z')

describe('credential lifecycle sweep boundary', () => {
  it('releases only fully terminal, drained records older than the boundary', () => {
    expect(
      isCredentialLifecycleSweepEligible(
        {
          sourceState: 'terminal',
          revokeState: 'confirmed_revoked',
          guardState: 'drained',
          terminalAt: new Date('2026-08-10T11:00:00.000Z'),
        },
        before,
      ),
    ).toBe(true)
    expect(
      isCredentialLifecycleSweepEligible(
        {
          sourceState: 'provider_reset_terminal',
          revokeState: 'provider_reset_confirmed',
          guardState: 'provider_reset_terminal',
          terminalAt: new Date('2026-08-10T11:00:00.000Z'),
        },
        before,
      ),
    ).toBe(true)
  })

  it.each([
    ['active source', 'provider_started', 'active', 'cleanup_pending'],
    ['dispatching cleanup', 'terminal', 'dispatching', 'cleanup_pending'],
    ['ambiguous cleanup', 'terminal', 'cleanup_ambiguous', 'ambiguous'],
  ] as const)('retains %s', (_label, sourceState, revokeState, guardState) => {
    expect(
      isCredentialLifecycleSweepEligible(
        {
          sourceState,
          revokeState,
          guardState,
          terminalAt: new Date('2026-08-10T11:00:00.000Z'),
        },
        before,
      ),
    ).toBe(false)
  })

  it('retains recent and unterminated records', () => {
    const terminal = {
      sourceState: 'terminal' as const,
      revokeState: 'confirmed_not_sent' as const,
      guardState: 'drained' as const,
    }
    expect(
      isCredentialLifecycleSweepEligible({ ...terminal, terminalAt: null }, before),
    ).toBe(false)
    expect(
      isCredentialLifecycleSweepEligible(
        { ...terminal, terminalAt: new Date('2026-08-10T13:00:00.000Z') },
        before,
      ),
    ).toBe(false)
  })
})
