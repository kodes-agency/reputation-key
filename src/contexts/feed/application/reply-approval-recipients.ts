// Feed notification surface — who is asked to approve a reply (I5.3).
//
// An approval request used to go to every AccountAdmin in the Organization,
// however many Properties they look after, while the Property's responsible
// managers — who hold `reply.manage` and could approve it in one click — were
// never asked at all.
//
// The rule is now: the Property's responsible managers who may approve; the
// AccountAdmins only when none of them can; and never the person who submitted
// the reply, because they cannot approve their own draft.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { UserLookupPort } from './ports/notification-user-lookup.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { ReplyApprovalAuthorityPort } from './ports/reply-approval-authority.port'

export type ReplyApprovalRecipientDeps = Readonly<{
  responsibleManagers: Pick<ResponsibleManagerLookupPort, 'findForProperty'>
  userLookup: Pick<UserLookupPort, 'findByRole'>
  replyApproval: ReplyApprovalAuthorityPort
}>

/**
 * Why a recipient was admitted, kept with any queued email so the send can
 * recheck it. `reply_approver` is rechecked as responsibility AND permission;
 * `account_admin` as the role alone.
 */
export type ReplyApprovalAudience =
  | Readonly<{ kind: 'reply_approver'; propertyId: string }>
  | Readonly<{ kind: 'account_admin' }>

export type ReplyApprovalRecipients = Readonly<{
  recipients: readonly UserId[]
  audience: ReplyApprovalAudience
}>

const withoutSubmitter = (
  candidates: readonly UserId[],
  submitterId: UserId | null,
): readonly UserId[] =>
  [...new Set(candidates)].filter((candidate) => candidate !== submitterId)

/** The Property's responsible managers who may act on an approval request. */
async function approversAmongResponsible(
  deps: ReplyApprovalRecipientDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  submitterId: UserId | null,
): Promise<readonly UserId[]> {
  const responsible = withoutSubmitter(
    await deps.responsibleManagers.findForProperty(organizationId, propertyId),
    submitterId,
  )
  const decisions = await Promise.all(
    responsible.map(async (candidate) => ({
      candidate,
      mayApprove: await deps.replyApproval.canApproveReplies(
        organizationId,
        propertyId,
        candidate,
      ),
    })),
  )
  return decisions
    .filter((decision) => decision.mayApprove)
    .map((decision) => decision.candidate)
}

/**
 * The submitter is removed BEFORE the fallback is considered: when the only
 * responsible approver is the person who wrote the draft, somebody else still
 * has to decide, and that is what the AccountAdmins are for.
 */
export async function resolveReplyApprovalRecipients(
  deps: ReplyApprovalRecipientDeps,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    submitterId: UserId | null
  }>,
): Promise<ReplyApprovalRecipients> {
  const approvers = await approversAmongResponsible(
    deps,
    input.organizationId,
    input.propertyId,
    input.submitterId,
  )
  if (approvers.length > 0) {
    return {
      recipients: approvers,
      audience: { kind: 'reply_approver', propertyId: input.propertyId },
    }
  }
  const admins = await deps.userLookup.findByRole(input.organizationId, 'AccountAdmin')
  return {
    recipients: withoutSubmitter(admins, input.submitterId),
    audience: { kind: 'account_admin' },
  }
}
