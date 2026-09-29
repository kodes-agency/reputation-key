// Feed notification surface — who is told an Inbox item was escalated (I5.3).
//
// An escalation goes to the people who own the item's work — the Property's
// responsible managers for a review, the Portal's for private feedback — and
// to the AccountAdmins only when nobody there can answer it.
//
// The escalating actor is removed BEFORE that fallback is considered, the way
// an approval request removes its submitter. Escalating is asking for help: a
// small hotel's only responsible manager pressing Escalate used to be removed
// AFTER the fallback had already been skipped, so the request reached nobody.

import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItemFacts } from './ports/notification-inbox-item-lookup.port'
import type { NotificationAudience } from './notification-audience'
import {
  findScopeResponsibleManagers,
  inboxNotificationAudience,
  type ResponsibleRecipientDeps,
} from './responsible-recipients'

export type EscalationRecipients = Readonly<{
  recipients: readonly UserId[]
  audience: NotificationAudience
}>

const ACCOUNT_ADMIN = { kind: 'account_admin' } as const

const excluding = (candidates: readonly UserId[], actorId: UserId | null) =>
  candidates.filter((candidate) => candidate !== actorId)

/**
 * The scope's responsible managers other than the actor, under the scope's
 * own audience. When the scope names nobody at all the AccountAdmins keep that
 * audience too, as every responsible-scope route's recovery does: the send
 * admits them while the scope is still empty. When the scope names only the
 * actor, the admins are admitted as AccountAdmins, because the scope's
 * recheck would find its one manager and refuse them.
 */
export async function resolveEscalationRecipients(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: InboxItemFacts | null,
  actorId: UserId | null,
): Promise<EscalationRecipients> {
  // An item whose scope cannot be read is recovered by the AccountAdmins, as
  // any unattributable item is.
  const scopeAudience = facts ? inboxNotificationAudience(facts) : ACCOUNT_ADMIN
  const scoped =
    scopeAudience.kind === 'responsible_scope'
      ? await findScopeResponsibleManagers(deps, organizationId, scopeAudience.scope)
      : []
  const others = excluding(scoped, actorId)
  if (others.length > 0) return { recipients: others, audience: scopeAudience }

  const admins = excluding(
    [...new Set(await deps.userLookup.findByRole(organizationId, 'AccountAdmin'))],
    actorId,
  )
  return {
    recipients: admins,
    audience: scoped.length === 0 ? scopeAudience : ACCOUNT_ADMIN,
  }
}
