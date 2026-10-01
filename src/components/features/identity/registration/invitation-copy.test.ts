import { describe, expect, it } from 'vitest'
import {
  formatInvitationExpiry,
  invitationMismatchCopy,
  invitationPropertyLines,
  invitationStateCopy,
} from './invitation-copy'

describe('invitationStateCopy', () => {
  it('tells an expired invitation holder who to ask, by name', () => {
    const copy = invitationStateCopy({
      state: 'expired',
      organizationName: 'Meridian Hotels',
      inviterName: 'Dana Whitfield',
      signedIn: false,
    })

    expect(copy.title).toBe('This invitation has expired')
    expect(copy.description).toContain('Ask Dana Whitfield to resend it')
    expect(copy.action).toEqual({ label: 'Sign in', to: '/login' })
  })

  it('names the Organization when the inviter is gone', () => {
    const copy = invitationStateCopy({
      state: 'expired',
      organizationName: 'Meridian Hotels',
      inviterName: null,
      signedIn: false,
    })

    expect(copy.description).toContain('Ask an Account Admin at Meridian Hotels')
  })

  it('points a cancelled invitation at a new one', () => {
    const copy = invitationStateCopy({
      state: 'canceled',
      organizationName: 'Meridian Hotels',
      inviterName: 'Dana Whitfield',
      signedIn: false,
    })

    expect(copy.title).toBe('This invitation was cancelled')
    expect(copy.description).toContain('Ask Dana Whitfield to send you a new invitation')
  })

  it('sends a used invitation to sign in, or into the workspace when signed in', () => {
    const signedOut = invitationStateCopy({
      state: 'accepted',
      organizationName: 'Meridian Hotels',
      inviterName: null,
      signedIn: false,
    })
    const signedIn = invitationStateCopy({
      state: 'accepted',
      organizationName: 'Meridian Hotels',
      inviterName: null,
      signedIn: true,
    })

    expect(signedOut.title).toBe('This invitation was already used')
    expect(signedOut.action).toEqual({ label: 'Sign in', to: '/login' })
    expect(signedIn.action).toEqual({
      label: 'Go to your workspace',
      to: '/properties',
    })
  })

  it('gives an unknown link the same words whoever asks', () => {
    const copy = invitationStateCopy({ state: 'unavailable', signedIn: false })

    expect(copy.title).toBe("This invitation link isn't valid")
    expect(copy.description).toContain('Open the link from your invitation email again')
  })

  // The preview answered "too many requests": nothing is wrong with the link,
  // so the words say to wait rather than to ask for a new one, and do not
  // offer a retry button (each retry spends more of the same budget).
  it('asks a rate-limited visitor to wait, and to reopen the same link', () => {
    const copy = invitationStateCopy({ state: 'rate_limited', signedIn: false })

    expect(copy.title).toBe('Too many attempts')
    expect(copy.description).toContain('Wait a few minutes')
    expect(copy.description).toContain('open the link from your invitation email again')
    expect(copy.description).not.toMatch(/new (invitation|one)/i)
    expect(copy.action).toEqual({ label: 'Sign in', to: '/login' })
  })
})

describe('invitationMismatchCopy', () => {
  it('names both addresses so the person can tell which one is wrong', () => {
    const copy = invitationMismatchCopy('new.hire@meridian.test', 'dana@other.test')

    expect(copy.title).toBe('This invitation is for another address')
    expect(copy.description).toContain('new.hire@meridian.test')
    expect(copy.description).toContain('dana@other.test')
  })

  it('points at signing out, which carries on with the invited address', () => {
    const copy = invitationMismatchCopy('new.hire@meridian.test', 'dana@other.test')

    expect(copy.description).toContain('Sign out to continue with the invited address')
  })
})

describe('invitationPropertyLines', () => {
  it('says an Account Admin reaches every Property', () => {
    expect(invitationPropertyLines('AccountAdmin', [])).toEqual([
      'Every Property in the Organization',
    ])
  })

  it('lists the Properties a Property Manager is invited to', () => {
    expect(invitationPropertyLines('PropertyManager', ['Hotel A', 'Hotel B'])).toEqual([
      'Hotel A',
      'Hotel B',
    ])
  })

  it('says so when a Property Manager has no Property yet', () => {
    expect(invitationPropertyLines('PropertyManager', [])).toEqual(['None assigned yet'])
  })

  it('folds a long list into a count', () => {
    const names = Array.from({ length: 11 }, (_, index) => `Hotel ${index + 1}`)

    const lines = invitationPropertyLines('PropertyManager', names)

    expect(lines).toHaveLength(9)
    expect(lines[8]).toBe('and 3 more')
  })
})

describe('formatInvitationExpiry', () => {
  it('pins the zone so the server and the browser print the same day', () => {
    expect(formatInvitationExpiry(new Date('2026-10-07T23:30:00.000Z'))).toBe(
      '7 Oct 2026',
    )
  })
})
