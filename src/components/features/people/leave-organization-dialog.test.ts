// A worklist nobody could read must not read as a worklist that is clear.
//
// The identity container installs a fail-closed MemberOffboardingPort until
// the responsibility facts are composed: `listOutstanding` THROWS rather than
// returning an empty list, because reporting "nothing outstanding" would let
// someone walk out leaving Portals and Properties with no Responsible Manager.
//
// That fence only holds if the UI preserves the distinction. `outstanding` is
// therefore nullable — null means UNKNOWN, not NONE — and these assert that
// only one of them permits the leave.
//
// The decision is asserted through `canLeaveOrganization` rather than through
// markup: the dialog is a Radix dialog, and a closed one renders nothing but
// its trigger, so every branch that matters is absent from the SSR output.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  canLeaveOrganization,
  LeaveOrganizationDialog,
} from './leave-organization-dialog'
import type { LeaveOrganizationDialogProps } from './leave-organization-dialog'

const noopAction = {
  mutate: () => {},
  mutateAsync: async () => {},
  isPending: false,
} as unknown as LeaveOrganizationDialogProps['leaveOrganization']

const render = (outstanding: LeaveOrganizationDialogProps['outstanding']): string =>
  renderToStaticMarkup(
    createElement(LeaveOrganizationDialog, {
      outstanding,
      candidates: [{ userId: 'user-2', name: 'Dana Manager' }],
      isSoleAccountAdmin: false,
      leaveOrganization: noopAction,
    }),
  )

describe('LeaveOrganizationDialog worklist availability', () => {
  it('renders the dialog trigger whether or not the worklist could be read', () => {
    // The page must survive the fence. If this throws, one uncomposed port
    // takes the whole members page down again.
    expect(() => render(null)).not.toThrow()
    expect(() => render([])).not.toThrow()
  })

  it('refuses the leave when the worklist could not be read', () => {
    // The fail-open this exists to prevent: null must not behave like [].
    expect(
      canLeaveOrganization({
        outstanding: null,
        assignedKeys: new Set(),
        isSoleAccountAdmin: false,
        candidateCount: 1,
      }),
    ).toBe(false)
  })

  it('allows the leave when the worklist is genuinely empty', () => {
    // The other half. A rule that refused both would be safe and useless, and
    // would pass the test above on its own.
    expect(
      canLeaveOrganization({
        outstanding: [],
        assignedKeys: new Set(),
        isSoleAccountAdmin: false,
        candidateCount: 1,
      }),
    ).toBe(true)
  })

  it('refuses while any responsibility is still unassigned', () => {
    const outstanding = [{ kind: 'portal_responsibility', resourceId: 'p1' }] as const

    expect(
      canLeaveOrganization({
        outstanding,
        assignedKeys: new Set(),
        isSoleAccountAdmin: false,
        candidateCount: 1,
      }),
    ).toBe(false)
    expect(
      canLeaveOrganization({
        outstanding,
        assignedKeys: new Set(['portal_responsibility:p1']),
        isSoleAccountAdmin: false,
        candidateCount: 1,
      }),
    ).toBe(true)
  })

  it('refuses the sole account administrator regardless of the worklist', () => {
    expect(
      canLeaveOrganization({
        outstanding: [],
        assignedKeys: new Set(),
        isSoleAccountAdmin: true,
        candidateCount: 1,
      }),
    ).toBe(false)
  })
})
