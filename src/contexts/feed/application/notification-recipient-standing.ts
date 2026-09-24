import {
  propertyId as toPropertyId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience'
import {
  resolveResponsibleRecipients,
  type ResponsibleRecipientDeps,
} from './responsible-recipients'
import type { ReplyApprovalAuthorityPort } from './ports/reply-approval-authority.port'

/** Everything a standing check may have to ask about, resolved at send time. */
export type NotificationRecipientStandingDeps = ResponsibleRecipientDeps &
  Readonly<{ replyApproval: ReplyApprovalAuthorityPort }>

export type NotificationRecipientStandingInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  /** The audience stored with the queued email; `null` for older rows. */
  audience: unknown
}>

/**
 * Answers shared by the rows of one delivery pass, such as one recipient's
 * digest. Property eligibility depends only on (Organization, Property,
 * user) and the audience part only on (Organization, user, audience), so they
 * are kept apart: a digest with many rows on one Property, each naming its own
 * work item, asks for eligibility once.
 */
export type RecipientStandingMemo = Readonly<{
  propertyEligibility: Map<string, Promise<boolean>>
  audienceStanding: Map<string, Promise<boolean>>
}>

export const createRecipientStandingMemo = (): RecipientStandingMemo => ({
  propertyEligibility: new Map(),
  audienceStanding: new Map(),
})

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
 *
 * Pass a memo to share answers across the rows of one pass; without one every
 * question is asked afresh.
 */
export type NotificationRecipientStanding = (
  input: NotificationRecipientStandingInput,
  memo?: RecipientStandingMemo,
) => Promise<boolean>

const remembered = (
  cache: Map<string, Promise<boolean>> | undefined,
  key: string,
  ask: () => Promise<boolean>,
): Promise<boolean> => {
  if (!cache) return ask()
  const known = cache.get(key)
  if (known) return known
  const answer = ask()
  cache.set(key, answer)
  return answer
}

/** Whether the recipient still holds the duty or role their audience names. */
async function holdsAudience(
  deps: NotificationRecipientStandingDeps,
  organizationId: OrganizationId,
  userId: UserId,
  stored: unknown,
): Promise<boolean> {
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
      return (await deps.userLookup.findByRole(organizationId, 'AccountAdmin')).includes(
        userId,
      )
    // Responsibility and permission are separate authorities and either can
    // end on its own, so both are asked again (I5.3).
    case 'reply_approver': {
      const scope = toPropertyId(audience.propertyId)
      const responsible = await deps.responsibleManagers.findForProperty(
        organizationId,
        scope,
      )
      if (!responsible.includes(userId)) return false
      return deps.replyApproval.canApproveReplies(organizationId, scope, userId)
    }
    default:
      // The other audiences follow a work item or a result, whose standing
      // is Property eligibility, checked before this.
      return true
  }
}

export const createNotificationRecipientStanding =
  (deps: NotificationRecipientStandingDeps): NotificationRecipientStanding =>
  async ({ organizationId, propertyId, userId, audience: stored }, memo) => {
    // Active manager membership, current Property access and participation.
    // Every Property-scoped audience admits only eligible managers.
    const eligible = await remembered(
      memo?.propertyEligibility,
      `${organizationId as string}\0${propertyId as string}\0${userId as string}`,
      () =>
        deps.responsibleManagers.isEligibleForProperty(
          organizationId,
          propertyId,
          userId,
        ),
    )
    if (!eligible) return false
    if (stored === null) return true
    return remembered(
      memo?.audienceStanding,
      `${organizationId as string}\0${userId as string}\0${JSON.stringify(stored)}`,
      () => holdsAudience(deps, organizationId, userId, stored),
    )
  }
