import type { NotificationCategory } from './notification-types'

/**
 * How far an Organization's lifecycle stops its outbound email.
 *
 * - `none`: an active Organization.
 * - `optional`: from the closure request through the recoverable window, and
 *   after a cancelled closure until explicit reactivation. Only mandatory
 *   account and security notices go out: they are Identity's channel for
 *   telling people what is happening to their access.
 * - `all`: past the irreversible boundary. Nothing goes out.
 */
export type OrganizationEmailStop = 'none' | 'optional' | 'all'

/** The Identity-owned lifecycle authority, as far as email needs it. */
export type OrganizationLifecycleFacts = Readonly<{
  state: string
  reactivationRequired: boolean
}>

const IRREVERSIBLE_STATES: ReadonlySet<string> = new Set(['purging', 'closed'])

/**
 * Nothing sets an Organization suspension on a closure request any more, so
 * email reads the lifecycle authority itself. An unknown state stops optional
 * mail: the safe direction. An Organization with no lifecycle record has none
 * because it has no Organization row; its recipients fail their standing.
 */
export function organizationEmailStop(
  facts: OrganizationLifecycleFacts | null,
): OrganizationEmailStop {
  if (facts === null) return 'none'
  if (IRREVERSIBLE_STATES.has(facts.state)) return 'all'
  if (facts.state !== 'active' || facts.reactivationRequired) return 'optional'
  return 'none'
}

export const isEmailStopped = (
  stop: OrganizationEmailStop,
  category: NotificationCategory,
): boolean => stop === 'all' || (stop === 'optional' && category !== 'mandatory')

/**
 * The suppression reason on mail an Organization's closure stopped. The same
 * code the Closing phase stamps on the rows it cancels, so an operator finds
 * both with one query.
 */
export const ORGANIZATION_CLOSING_REASON = 'organization_closing'
