// Platform operator console — the pure rules the page and its rows share
// (ADR 0065): what needs the operator's attention, which Organizations take an
// invitation, when open invitations compete, how a timestamp reads, and which
// refusal means "sign in again".
// No React, so each rule is pinned by a unit test.

import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { deriveOrganizationSlug } from '#/shared/domain/organization-slug'
import { formatDateTime } from '#/lib/format-date-time'
import { formatDate } from '#/lib/format'
import type {
  PlatformAdminInvitationView,
  PlatformOrganizationView,
} from '#/contexts/identity/application/dto/platform-console.dto'

/** The code the operator guard raises for a change on a session older than 30 minutes. */
const REAUTH_REQUIRED_CODE = 'operator_reauth_required'

/** A rejected console action that only a fresh sign-in can fix. */
export function isReauthRequired(error: unknown): boolean {
  return isServerFunctionError(error) && error.code === REAUTH_REQUIRED_CODE
}

/** The console may invite only an Organization that has no Account Admin. */
export function canInviteAdmin(organization: PlatformOrganizationView): boolean {
  return organization.accountAdminCount === 0
}

/**
 * More than one live Account Admin invitation is out for an ownerless
 * Organization. Each stays acceptable after the first acceptance, and once an
 * Account Admin has joined the console may no longer cancel the rest, so this
 * is how an Organization ends up with two Account Admins. A lapsed invitation
 * does not count: nobody can accept it until it is resent.
 */
export function hasCompetingAdminInvitations(
  organization: PlatformOrganizationView,
): boolean {
  if (organization.accountAdminCount > 0) return false
  const live = organization.pendingAdminInvitations.filter(
    (invitation) => !invitation.expired,
  )
  return live.length > 1
}

export type OrganizationFlag = Readonly<{
  id: 'needs-account-admin'
  label: string
}>

/** What the operator can act on: the Organization has no Account Admin. */
export function organizationFlags(
  organization: PlatformOrganizationView,
): ReadonlyArray<OrganizationFlag> {
  return organization.accountAdminCount === 0
    ? [{ id: 'needs-account-admin', label: 'Needs an Account Admin' }]
    : []
}

export type ConsoleSummary = Readonly<{
  organizations: number
  needAccountAdmin: number
  openAdminInvitations: number
}>

export function summarizeOrganizations(
  organizations: ReadonlyArray<PlatformOrganizationView>,
): ConsoleSummary {
  return {
    organizations: organizations.length,
    needAccountAdmin: organizations.filter((entry) => entry.accountAdminCount === 0)
      .length,
    openAdminInvitations: organizations.reduce(
      (total, entry) => total + entry.pendingAdminInvitations.length,
      0,
    ),
  }
}

/** What the slug field shows for a name: empty until there is a name to derive from. */
export function suggestedSlug(name: string): string {
  return name.trim() === '' ? '' : deriveOrganizationSlug(name)
}

const CONSOLE_LOCALE = 'en-US'
// UTC, pinned: the page renders on the server and hydrates in the browser, and
// both must print the same string.
const CONSOLE_TIME_ZONE = 'UTC'

/** `Sep 30, 2026` — the UTC calendar date of an ISO timestamp. */
export function formatConsoleDate(iso: string): string {
  return formatDate(iso, CONSOLE_TIME_ZONE) ?? ''
}

/** `Expires Oct 7, 2026, 9:05 AM UTC`, or `Expired …` once it has lapsed. */
export function formatInvitationExpiry(
  invitation: Pick<PlatformAdminInvitationView, 'expiresAt' | 'expired'>,
): string {
  const when = formatDateTime(new Date(invitation.expiresAt), {
    locale: CONSOLE_LOCALE,
    timeZone: CONSOLE_TIME_ZONE,
    timeZoneName: true,
  })
  return `${invitation.expired ? 'Expired' : 'Expires'} ${when}`
}
