import { describe, expect, it } from 'vitest'
import {
  formatPropertyRecoveryDeadline,
  getPropertyLifecycleControls,
} from './property-lifecycle-card'

describe('Property lifecycle card model', () => {
  it('offers Archive without any destructive deletion control for active state', () => {
    expect(
      getPropertyLifecycleControls({
        lifecycleState: 'active',
        googleBindingState: 'active',
        responsibilityNeeded: false,
      }),
    ).toEqual({
      showArchive: true,
      showRestore: false,
      showDisconnect: false,
      restoreDisabled: false,
      statusLabel: 'Active',
    })
  })

  it('offers independent Restore and Property-only Google disconnect after Archive', () => {
    expect(
      getPropertyLifecycleControls({
        lifecycleState: 'archived',
        googleBindingState: 'active',
        responsibilityNeeded: false,
      }),
    ).toEqual({
      showArchive: false,
      showRestore: true,
      showDisconnect: true,
      restoreDisabled: false,
      statusLabel: 'Archived',
    })
  })

  it('keeps Restore visible but disabled while responsibility is unresolved', () => {
    expect(
      getPropertyLifecycleControls({
        lifecycleState: 'archived',
        googleBindingState: 'disconnected',
        responsibilityNeeded: true,
      }),
    ).toMatchObject({
      showRestore: true,
      showDisconnect: false,
      restoreDisabled: true,
    })
  })

  it('formats the fixed recovery deadline without depending on browser locale', () => {
    expect(formatPropertyRecoveryDeadline(new Date('2026-09-27T12:00:00.000Z'))).toBe(
      'Sep 27, 2026',
    )
    expect(formatPropertyRecoveryDeadline(null)).toBeNull()
  })
})
