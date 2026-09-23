import { describe, expect, it } from 'vitest'
import { isEmailStopped, organizationEmailStop } from './organization-email-stop'

const lifecycle = (state: string, reactivationRequired = state !== 'active') => ({
  state,
  reactivationRequired,
})

describe("an Organization's lifecycle and its outbound email", () => {
  it('stops nothing for an active Organization', () => {
    expect(organizationEmailStop(lifecycle('active'))).toBe('none')
  })

  it('stops optional mail from the closure request, through the recoverable window', () => {
    for (const state of ['closure_requested', 'closing', 'purge_pending']) {
      expect(organizationEmailStop(lifecycle(state))).toBe('optional')
    }
  })

  it('keeps optional mail stopped after a cancelled closure until reactivation', () => {
    // Cancellation returns the state to active but does not reactivate
    // notifications; explicit reactivation clears the flag.
    expect(organizationEmailStop(lifecycle('active', true))).toBe('optional')
  })

  it('stops all mail once the irreversible boundary is crossed', () => {
    expect(organizationEmailStop(lifecycle('purging'))).toBe('all')
    expect(organizationEmailStop(lifecycle('closed'))).toBe('all')
  })

  it('stops optional mail for a lifecycle state it does not know', () => {
    expect(organizationEmailStop(lifecycle('hibernating'))).toBe('optional')
  })

  it('stops nothing for an Organization with no lifecycle record', () => {
    expect(organizationEmailStop(null)).toBe('none')
  })

  it('lets mandatory notices through an optional stop, and nothing through a full one', () => {
    expect(isEmailStopped('optional', 'mandatory')).toBe(false)
    expect(isEmailStopped('optional', 'workflow_collaboration')).toBe(true)
    expect(isEmailStopped('all', 'mandatory')).toBe(true)
    expect(isEmailStopped('none', 'urgent_operational')).toBe(false)
  })
})
