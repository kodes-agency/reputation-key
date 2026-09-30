import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { PlatformOrganizationView } from '#/contexts/identity/application/dto/platform-console.dto'
import {
  canInviteAdmin,
  formatConsoleDate,
  formatInvitationExpiry,
  isReauthRequired,
  lifecycleLabel,
  organizationFlags,
  summarizeOrganizations,
} from './platform-console-model'

const organization = (
  overrides: Partial<PlatformOrganizationView> = {},
): PlatformOrganizationView => ({
  id: 'org-1',
  name: 'Hotel Riviera',
  slug: 'hotel-riviera',
  createdAt: '2026-09-30T12:00:00.000Z',
  lifecycleState: 'active',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 1,
  controlledBetaEnabled: true,
  pendingAdminInvitations: [],
  ...overrides,
})

describe('isReauthRequired', () => {
  it('recognises the 403 the operator guard raises for a stale session', () => {
    const error = new ServerFunctionError(
      'AuthError',
      'Sign in again to change Organizations from the operator console.',
      'operator_reauth_required',
      403,
    )

    expect(isReauthRequired(error)).toBe(true)
  })

  it('does not mistake another refusal, or a plain error, for it', () => {
    const forbidden = new ServerFunctionError(
      'AuthError',
      'No.',
      'operator_not_registered',
      403,
    )

    expect(isReauthRequired(forbidden)).toBe(false)
    expect(isReauthRequired(new Error('operator_reauth_required'))).toBe(false)
    expect(isReauthRequired(null)).toBe(false)
    expect(isReauthRequired(undefined)).toBe(false)
  })
})

describe('canInviteAdmin', () => {
  it('opens the invite form only for an active Organization with no Account Admin', () => {
    expect(canInviteAdmin(organization())).toBe(true)
    expect(canInviteAdmin(organization({ accountAdminCount: 1 }))).toBe(false)
    expect(canInviteAdmin(organization({ lifecycleState: 'closure_requested' }))).toBe(
      false,
    )
  })
})

describe('organizationFlags', () => {
  it('flags an Organization that has no Account Admin yet', () => {
    expect(organizationFlags(organization()).map((flag) => flag.id)).toEqual([
      'needs-account-admin',
    ])
  })

  it('names the allowlist entry a dark Organization needs', () => {
    const flags = organizationFlags(
      organization({ accountAdminCount: 1, controlledBetaEnabled: false }),
    )

    expect(flags).toEqual([
      expect.objectContaining({ id: 'controlled-beta-off', detail: 'org-1' }),
    ])
  })

  it('states a lifecycle state that is not active, and nothing for an active one', () => {
    const closing = organizationFlags(
      organization({ accountAdminCount: 1, lifecycleState: 'closing' }),
    )

    expect(closing.map((flag) => [flag.id, flag.label])).toEqual([
      ['lifecycle', 'Closing'],
    ])
    expect(organizationFlags(organization({ accountAdminCount: 1 }))).toEqual([])
  })

  it('orders the flags by what the operator can act on first', () => {
    const flags = organizationFlags(
      organization({ lifecycleState: 'closed', controlledBetaEnabled: false }),
    )

    expect(flags.map((flag) => flag.id)).toEqual([
      'needs-account-admin',
      'lifecycle',
      'controlled-beta-off',
    ])
  })
})

describe('lifecycleLabel', () => {
  it.each([
    ['active', 'Active'],
    ['closure_requested', 'Closure requested'],
    ['purge_pending', 'Purge pending'],
  ] as const)('prints %s as %s', (state, label) => {
    expect(lifecycleLabel(state)).toBe(label)
  })
})

describe('summarizeOrganizations', () => {
  it('counts Organizations, those without an Account Admin, and open admin invitations', () => {
    const summary = summarizeOrganizations([
      organization({
        pendingAdminInvitations: [
          {
            id: 'a',
            email: 'a@example.com',
            expiresAt: '2026-10-07T12:00:00.000Z',
            expired: false,
          },
          {
            id: 'b',
            email: 'b@example.com',
            expiresAt: '2026-09-01T12:00:00.000Z',
            expired: true,
          },
        ],
      }),
      organization({ id: 'org-2', accountAdminCount: 2, controlledBetaEnabled: false }),
      organization({ id: 'org-3', accountAdminCount: 1 }),
    ])

    expect(summary).toEqual({
      organizations: 3,
      needAccountAdmin: 1,
      openAdminInvitations: 2,
      darkForControlledBeta: 1,
    })
  })

  it('reports zeroes for an empty list', () => {
    expect(summarizeOrganizations([])).toEqual({
      organizations: 0,
      needAccountAdmin: 0,
      openAdminInvitations: 0,
      darkForControlledBeta: 0,
    })
  })
})

describe('formatConsoleDate', () => {
  it('prints the UTC calendar date so the server and the browser agree', () => {
    expect(formatConsoleDate('2026-09-30T23:30:00.000Z')).toBe('Sep 30, 2026')
  })
})

describe('formatInvitationExpiry', () => {
  it('says when a live invitation lapses', () => {
    expect(
      formatInvitationExpiry({ expiresAt: '2026-10-07T09:05:00.000Z', expired: false }),
    ).toBe('Expires Oct 7, 2026, 9:05 AM UTC')
  })

  it('says an expired invitation lapsed, and when', () => {
    expect(
      formatInvitationExpiry({ expiresAt: '2026-09-01T09:05:00.000Z', expired: true }),
    ).toBe('Expired Sep 1, 2026, 9:05 AM UTC')
  })
})
