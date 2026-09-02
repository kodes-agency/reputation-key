import { describe, expect, it } from 'vitest'
import {
  formatPropertyRecoveryDeadline,
  getPropertyLifecycleActionStates,
  getPropertyLifecycleControls,
} from './property-lifecycle-model'

describe('Property lifecycle card model', () => {
  it('offers Archive and the recoverable Remove for active state, and nothing that deletes', () => {
    // Remove archives and disconnects — both recoverable. No control here reaches
    // permanent erasure, which stays support-mediated and off the tenant surface.
    expect(
      getPropertyLifecycleControls({
        lifecycleState: 'active',
        googleBindingState: 'active',
        responsibilityNeeded: false,
      }),
    ).toEqual({
      showArchive: true,
      showRemove: true,
      showRestore: false,
      showDisconnect: false,
      restoreDisabled: false,
      statusLabel: 'Active',
    })
  })

  it('withdraws Remove once the Property is already out of the workspace', () => {
    expect(
      getPropertyLifecycleControls({
        lifecycleState: 'archived',
        googleBindingState: 'disconnected',
        responsibilityNeeded: false,
      }),
    ).toMatchObject({ showRemove: false })
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
      showRemove: false,
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

  it('requires both permissions before Remove is usable', () => {
    // Removal archives and disconnects, so holding only one of the two is not
    // enough — offering it would fail halfway through.
    const controls = getPropertyLifecycleControls({
      lifecycleState: 'active',
      googleBindingState: 'active',
      responsibilityNeeded: false,
    })
    const states = (permissions: {
      archive: boolean
      restore: boolean
      disconnect: boolean
    }) => getPropertyLifecycleActionStates({ controls, permissions, pending: false })

    expect(
      states({ archive: true, restore: true, disconnect: true }).remove.disabled,
    ).toBe(false)
    expect(
      states({ archive: true, restore: true, disconnect: false }).remove.disabled,
    ).toBe(true)
    expect(
      states({ archive: false, restore: true, disconnect: true }).remove.disabled,
    ).toBe(true)
  })

  it('disables every offered control while any lifecycle action is pending', () => {
    const controls = getPropertyLifecycleControls({
      lifecycleState: 'active',
      googleBindingState: 'active',
      responsibilityNeeded: false,
    })

    const states = getPropertyLifecycleActionStates({
      controls,
      permissions: { archive: true, restore: true, disconnect: true },
      pending: true,
    })

    expect(states.archive.disabled).toBe(true)
    expect(states.remove.disabled).toBe(true)
  })

  it('keeps Restore disabled while responsibility is unresolved even with permission', () => {
    const controls = getPropertyLifecycleControls({
      lifecycleState: 'archived',
      googleBindingState: 'disconnected',
      responsibilityNeeded: true,
    })

    const states = getPropertyLifecycleActionStates({
      controls,
      permissions: { archive: true, restore: true, disconnect: true },
      pending: false,
    })

    expect(states.restore.show).toBe(true)
    expect(states.restore.disabled).toBe(true)
  })

  it('formats the fixed recovery deadline without depending on browser locale', () => {
    expect(formatPropertyRecoveryDeadline(new Date('2026-09-27T12:00:00.000Z'))).toBe(
      'Sep 27, 2026',
    )
    expect(formatPropertyRecoveryDeadline(null)).toBeNull()
  })
})
