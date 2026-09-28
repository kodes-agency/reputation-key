// A worklist nobody could read must not read as a worklist that is clear.
//
// The identity container installs a fail-closed offboarding dependency until
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

const render = (
  outstanding: LeaveOrganizationDialogProps['outstanding'],
  selfServiceLeaveAvailable = true,
): string =>
  renderToStaticMarkup(
    createElement(LeaveOrganizationDialog, {
      outstanding,
      candidates: [{ userId: 'user-2', name: 'Dana Manager' }],
      isSoleAccountAdmin: false,
      selfServiceLeaveAvailable,
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

/**
 * wiring-03. When the deployment composes no responsibility facts, a leave can
 * never pass the transfer-first check. That is a standing beta state, not an
 * outage: the section says so and names who can remove the member, instead of
 * a "Leave organization" button whose dialog calls it a transient failure.
 * The notice replaces the dialog, so — unlike the branches above — it is
 * present in the markup and asserted there.
 */
describe('LeaveOrganizationDialog when self-service leave is not offered', () => {
  it('says leaving on your own is not available in this beta, and who can remove you', () => {
    const markup = render(null, false)

    expect(markup).toContain('data-testid="leave-not-offered"')
    expect(markup).toContain(
      'available in this beta — ask an account administrator to remove you',
    )
  })

  it('refuses the leave by offering no way to start one, and no transient-failure copy', () => {
    const markup = render(null, false)

    expect(markup).not.toContain('data-testid="open-leave-organization"')
    expect(markup).not.toContain('data-testid="confirm-leave-organization"')
    expect(markup).not.toContain('Leaving is unavailable right now')
    expect(markup).not.toContain('leave-worklist-unavailable')
  })

  it('keeps the transfer-first dialog wherever leave is offered', () => {
    // The other half: a notice that replaced the dialog everywhere would pass
    // both tests above and silently remove the feature once it is composed.
    const markup = render(null, true)

    expect(markup).toContain('data-testid="open-leave-organization"')
    expect(markup).not.toContain('data-testid="leave-not-offered"')
  })
})
