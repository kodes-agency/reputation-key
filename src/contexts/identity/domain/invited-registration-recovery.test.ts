import { describe, expect, it } from 'vitest'
import { classifyInvitedRegistrationRecovery } from './invited-registration-recovery'

const NOW = new Date('2026-08-27T10:00:00.000Z')

const baseInput = () => ({
  expected: {
    invitationId: 'invitation-1',
    organizationId: 'org-1',
    userId: 'user-1',
    credentialAccountId: 'account-1',
    initialSessionId: 'session-1',
  },
  now: NOW,
  user: null,
  invitation: {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'manager@example.com',
    status: 'pending',
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  },
  accounts: [],
  sessions: [],
  memberships: [],
})

describe('invited registration recovery classification', () => {
  it('waits for a retried provider call when no provider artifact exists', () => {
    expect(classifyInvitedRegistrationRecovery(baseInput())).toEqual({
      kind: 'awaiting_provider',
    })
  })

  it('resumes acceptance when only the exact fenced provider records exist', () => {
    expect(
      classifyInvitedRegistrationRecovery({
        ...baseInput(),
        user: { id: 'user-1', email: 'MANAGER@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        sessions: [{ id: 'session-1', userId: 'user-1' }],
      }),
    ).toEqual({ kind: 'ready_to_accept' })
  })

  it('permits exact cleanup when Better Auth committed only the fenced user', () => {
    expect(
      classifyInvitedRegistrationRecovery({
        ...baseInput(),
        user: { id: 'user-1', email: 'manager@example.com' },
      }),
    ).toEqual({
      kind: 'safe_to_compensate',
      reason: 'partial_provider_commit',
    })
  })

  it('permits exact cleanup when the invitation expired before acceptance', () => {
    const input = baseInput()
    expect(
      classifyInvitedRegistrationRecovery({
        ...input,
        invitation: {
          ...input.invitation,
          expiresAt: new Date('2026-08-27T09:59:59.000Z'),
        },
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        sessions: [{ id: 'session-1', userId: 'user-1' }],
      }),
    ).toEqual({
      kind: 'safe_to_compensate',
      reason: 'invitation_unavailable',
    })
  })

  it('settles an interrupted saga when exact invitation authority already committed', () => {
    const input = baseInput()
    expect(
      classifyInvitedRegistrationRecovery({
        ...input,
        invitation: { ...input.invitation, status: 'accepted' },
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        memberships: [{ organizationId: 'org-1' }],
      }),
    ).toEqual({ kind: 'already_accepted' })
  })

  it('closes an artifact-free attempt when its invitation is no longer available', () => {
    const input = baseInput()
    expect(
      classifyInvitedRegistrationRecovery({
        ...input,
        invitation: { ...input.invitation, status: 'canceled' },
      }),
    ).toEqual({
      kind: 'safe_to_compensate',
      reason: 'invitation_unavailable',
    })
  })

  it.each([
    {
      name: 'the provider user has another email',
      patch: {
        user: { id: 'user-1', email: 'other@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
      },
    },
    {
      name: 'an unallocated session exists',
      patch: {
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        sessions: [{ id: 'later-login-session', userId: 'user-1' }],
      },
    },
    {
      name: 'a different provider account exists',
      patch: {
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'oauth-account',
            userId: 'user-1',
            providerId: 'google',
            accountId: 'provider-subject',
          },
        ],
      },
    },
    {
      name: 'the preallocated credential account was attached to another user',
      patch: {
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-other',
            providerId: 'credential',
            accountId: 'user-other',
          },
        ],
      },
    },
    {
      name: 'membership authority appeared before acceptance',
      patch: {
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        memberships: [{ organizationId: 'org-other' }],
      },
    },
    {
      name: 'the preallocated session was attached to another user',
      patch: {
        user: { id: 'user-1', email: 'manager@example.com' },
        accounts: [
          {
            id: 'account-1',
            userId: 'user-1',
            providerId: 'credential',
            accountId: 'user-1',
          },
        ],
        sessions: [{ id: 'session-1', userId: 'user-other' }],
      },
    },
  ])('requires manual review when $name', ({ patch }) => {
    expect(classifyInvitedRegistrationRecovery({ ...baseInput(), ...patch })).toEqual({
      kind: 'manual_review',
      reason: 'unexpected_authority',
    })
  })
})
