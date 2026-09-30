import { describe, expect, it } from 'vitest'
import {
  betaInvitationRole,
  invitationExpiresInDays,
  invitationState,
} from './invitation-state'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const LATER = new Date('2026-10-07T12:00:00.000Z')
const EARLIER = new Date('2026-09-23T12:00:00.000Z')

describe('invitationState', () => {
  it('reads a stored pending row that has not lapsed as pending', () => {
    expect(invitationState('pending', LATER, NOW)).toBe('pending')
  })

  it('reads a stored pending row whose expiry has passed as expired', () => {
    expect(invitationState('pending', EARLIER, NOW)).toBe('expired')
  })

  it('reads a pending row expiring exactly now as expired', () => {
    expect(invitationState('pending', NOW, NOW)).toBe('expired')
  })

  it('reads a stored expired row as expired whatever its expiry says', () => {
    expect(invitationState('expired', LATER, NOW)).toBe('expired')
  })

  it.each(['accepted', 'rejected', 'canceled'] as const)(
    'keeps the terminal status %s',
    (status) => {
      expect(invitationState(status, LATER, NOW)).toBe(status)
      expect(invitationState(status, EARLIER, NOW)).toBe(status)
    },
  )

  it('reads an unknown stored status as null', () => {
    expect(invitationState('archived', LATER, NOW)).toBeNull()
    expect(invitationState('', LATER, NOW)).toBeNull()
  })
})

describe('invitationExpiresInDays', () => {
  it('turns the seven-day lifetime into 7', () => {
    expect(invitationExpiresInDays(7 * 86_400_000)).toBe(7)
  })

  it('rounds a lifetime that is not whole days', () => {
    expect(invitationExpiresInDays(36 * 3_600_000)).toBe(2)
  })

  it('never promises less than one day', () => {
    expect(invitationExpiresInDays(60_000)).toBe(1)
    expect(invitationExpiresInDays(0)).toBe(1)
  })
})

describe('betaInvitationRole', () => {
  it('maps the two beta manager tokens to their roles', () => {
    expect(betaInvitationRole('owner')).toBe('AccountAdmin')
    expect(betaInvitationRole(' Admin ')).toBe('PropertyManager')
  })

  it.each([['member'], ['owner,editor'], ['custom-role'], [''], [null]])(
    'reads %j as no beta role',
    (raw) => {
      expect(betaInvitationRole(raw)).toBeNull()
    },
  )
})
