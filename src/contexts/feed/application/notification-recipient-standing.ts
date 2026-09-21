import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience'
import {
  resolveResponsibleRecipients,
  type ResponsibleRecipientDeps,
} from './responsible-recipients'

export type NotificationRecipientStandingInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  /** The audience stored with the queued email; `null` for older rows. */
  audience: unknown
}>

/**
 * Whether a Property-scoped email's recipient may still receive it, asked
 * immediately before the provider call (CONTEXT.md invariant 4). Hours can
 * pass between queueing and sending — quiet hours, a daily digest, retries —
 * and a recipient removed from the Organization, moved off the Property, or
 * relieved of the responsibility that selected them must not be mailed.
 *
 * This is standing, not freshness: it never asks whether the item that raised
 * the notice has moved on. Organization-scoped mandatory mail never comes here;
 * an access-removed notice is addressed to someone who is no longer a member.
 */
export type NotificationRecipientStanding = (
  input: NotificationRecipientStandingInput,
) => Promise<boolean>

export const createNotificationRecipientStanding =
  (deps: ResponsibleRecipientDeps): NotificationRecipientStanding =>
  async ({ organizationId, propertyId, userId, audience: stored }) => {
    // Active manager membership, current Property access and participation.
    // Every Property-scoped audience admits only eligible managers.
    if (
      !(await deps.responsibleManagers.isEligibleForProperty(
        organizationId,
        propertyId,
        userId,
      ))
    ) {
      return false
    }
    if (stored === null) return true
    const audience = parseNotificationAudience(stored)
    if (!audience) return false
    switch (audience.kind) {
      case 'responsible_scope':
        return (
          await resolveResponsibleRecipients(deps, organizationId, audience.scope)
        ).includes(userId)
      case 'portal_health':
        return (
          await resolveResponsibleRecipients(deps, organizationId, {
            kind: 'portal',
            portalId: audience.portalId,
          })
        ).includes(userId)
      case 'account_admin':
        return (
          await deps.userLookup.findByRole(organizationId, 'AccountAdmin')
        ).includes(userId)
      default:
        // The other audiences follow a work item or a result, whose standing
        // is Property eligibility, already checked above.
        return true
    }
  }
