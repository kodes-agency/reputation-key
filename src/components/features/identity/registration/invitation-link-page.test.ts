import { act, createElement, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { ConfirmInvitationView } from './confirm-invitation-view'
import { InvitationLinkPage } from './invitation-link-page'

const view = vi.hoisted(() => ({
  current: undefined as ComponentProps<typeof ConfirmInvitationView> | undefined,
}))
vi.mock('./confirm-invitation-view', () => ({
  ConfirmInvitationView: (props: ComponentProps<typeof ConfirmInvitationView>) => {
    view.current = props
    return null
  },
}))
vi.mock('./accepted-view', () => ({ AcceptedView: () => null }))
vi.mock('./invitation-state-card', () => ({
  InvitationLinkStateCard: () => null,
  InvitationStateCard: () => null,
}))

const root = setupHookRoot()
const controls = () => {
  if (!view.current) throw new Error('Invitation confirmation did not render')
  return view.current
}

describe('invitation action feedback', () => {
  it('shows the last attempted action’s failure and clears it during a retry', async () => {
    const signOutFailure = new Error('Could not sign out. Please try again.')
    const acceptFailure = new Error('This invitation has expired.')
    let finishSignOut: (() => void) | undefined
    const signOut = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(signOutFailure)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            finishSignOut = () => reject(signOutFailure)
          }),
      )
    const acceptInvitation = vi.fn().mockRejectedValue(acceptFailure)
    await root.render(
      createElement(InvitationLinkPage, {
        link: {
          state: 'pending',
          invitationId: 'invitation-1',
          invitedEmail: 'manager@example.test',
          details: {
            organizationName: 'Example',
            inviterName: null,
            role: 'PropertyManager',
            propertyNames: [],
            expiresAt: new Date('2026-12-01'),
          },
        },
        signedInEmail: 'manager@example.test',
        acceptInvitation,
        signOut,
        joiningNotice: null,
      }),
    )

    await act(async () => controls().onSignOut())
    expect(controls().error).toBe(signOutFailure)
    await act(async () => controls().onAccept())
    expect(acceptInvitation).toHaveBeenCalledExactlyOnceWith({
      data: { invitationId: 'invitation-1' },
    })
    expect(controls().error).toBe(acceptFailure)

    await act(async () => controls().onSignOut())
    expect(controls().signingOut).toBe(true)
    expect(controls().error).toBeNull()
    await act(async () => finishSignOut?.())
    expect(controls().signingOut).toBe(false)
    expect(controls().error).toBe(signOutFailure)
  })
})
