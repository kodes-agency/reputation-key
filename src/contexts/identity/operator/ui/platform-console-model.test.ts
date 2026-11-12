import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { PlatformOrganizationView } from '#/contexts/identity/application/dto/platform-console.dto'
import {
  canInviteAdmin,
  formatConsoleDate,
  formatInvitationExpiry,
  hasCompetingAdminInvitations,
  isReauthRequired,
  organizationFlags,
  summarizeOrganizations,
  suggestedSlug,
} from './platform-console-model'

const organization = (
  overrides: Partial<PlatformOrganizationView> = {},
): PlatformOrganizationView => ({
  id: 'org-1',
  name: 'Hotel Riviera',
  slug: 'hotel-riviera',
  createdAt: '2026-09-30T12:00:00.000Z',
  memberCount: 0,
  accountAdminCount: 0,
  pendingInvitationCount: 1,
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
  it('opens the invite form only for an Organization with no Account Admin', () => {
    expect(canInviteAdmin(organization())).toBe(true)
    expect(canInviteAdmin(organization({ accountAdminCount: 1 }))).toBe(false)
  })
})

describe('hasCompetingAdminInvitations', () => {
  const adminInvitation = (id: string, expired: boolean) => ({
    id,
    email: `${id}@example.com`,
    expiresAt: '2026-10-07T12:00:00.000Z',
    expired,
  })

  it('warns while two live Account Admin invitations are out: both can be accepted', () => {
    expect(
      hasCompetingAdminInvitations(
        organization({
          pendingAdminInvitations: [
            adminInvitation('first', false),
            adminInvitation('second', false),
          ],
        }),
      ),
    ).toBe(true)
  })

  it('does not count a lapsed invitation, which nobody can accept', () => {
    expect(
      hasCompetingAdminInvitations(
        organization({
          pendingAdminInvitations: [
            adminInvitation('live', false),
            adminInvitation('lapsed', true),
          ],
        }),
      ),
    ).toBe(false)
  })

  it('stays quiet for one invitation, and for an administered Organization', () => {
    expect(
      hasCompetingAdminInvitations(
        organization({ pendingAdminInvitations: [adminInvitation('only', false)] }),
      ),
    ).toBe(false)
    expect(
      hasCompetingAdminInvitations(
        organization({
          accountAdminCount: 1,
          pendingAdminInvitations: [
            adminInvitation('first', false),
            adminInvitation('second', false),
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('organizationFlags', () => {
  it('flags an Organization that has no Account Admin yet', () => {
    expect(organizationFlags(organization()).map((flag) => flag.id)).toEqual([
      'needs-account-admin',
    ])
  })

  it('flags nothing once the Organization has an Account Admin', () => {
    expect(organizationFlags(organization({ accountAdminCount: 1 }))).toEqual([])
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
      organization({ id: 'org-2', accountAdminCount: 2 }),
      organization({ id: 'org-3', accountAdminCount: 1 }),
    ])

    expect(summary).toEqual({
      organizations: 3,
      needAccountAdmin: 1,
      openAdminInvitations: 2,
    })
  })

  it('reports zeroes for an empty list', () => {
    expect(summarizeOrganizations([])).toEqual({
      organizations: 0,
      needAccountAdmin: 0,
      openAdminInvitations: 0,
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

describe('suggestedSlug', () => {
  it('derives the slug the server would, from the name being typed', () => {
    expect(suggestedSlug('Hotel Riviera & Spa')).toBe('hotel-riviera-spa')
  })

  it('suggests nothing until there is a name, rather than the fallback slug', () => {
    expect(suggestedSlug('')).toBe('')
    expect(suggestedSlug('   ')).toBe('')
  })
})
