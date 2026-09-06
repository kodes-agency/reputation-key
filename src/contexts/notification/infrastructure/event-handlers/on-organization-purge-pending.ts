// LIF-01 program bullet 5 — the MANDATORY final notice at Purge Pending.
//
// Why this exists at all: `prepareClosing` cancels every still-sendable
// NON-mandatory queued email for a closing Organization, so ordinary product
// mail stops the moment a closure is requested. That is correct — but it means
// the one message that matters most, "your data is about to be erased and this
// is your last chance to stop it", would never be sent unless it is carved out
// explicitly. `mandatory` is that carve-out: the Closing fence skips the
// category, so a notice queued here survives the fence that silenced
// everything else.
//
// The notice is emitted at `purge_pending` and nowhere else. Earlier states
// remain recoverable through governed lifecycle authority; `purging` is past
// the irreversible boundary, where a "last chance" message would be a lie.
//
// Recipients are the CURRENT AccountAdmins. Deliberately not the requester:
// the person who asked for the closure may have left, and the people who can
// still act are whoever holds the authority now.

import type { OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

const ORGANIZATION_PURGE_PENDING_NOTIFICATION_TYPE =
  'account.organization_purge_pending' as const

export type OrganizationPurgePendingNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export type OrganizationPurgePendingFact = Readonly<{
  eventId: string
  organizationId: OrganizationId
  closureLineageId: string
  revision: number
  correlationId: string | null
}>

export const onOrganizationPurgePending =
  (deps: OrganizationPurgePendingNotificationDeps) =>
  async (fact: OrganizationPurgePendingFact): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      fact.organizationId,
      'AccountAdmin',
    )
    if (recipients.length === 0) {
      // An Organization with no AccountAdmin left cannot be notified, and
      // silently proceeding to an irreversible purge with nobody told is the
      // exact failure this notice exists to prevent. Loud and content-free.
      // The closure lineage identifies WHICH closure without logging the
      // tenant: organizationId is a banned observability key.
      deps.logger.warn(
        {
          closureLineageId: fact.closureLineageId,
          correlationId: fact.correlationId ?? undefined,
        },
        'onOrganizationPurgePending: no AccountAdmin recipient for the final notice',
      )
      return
    }

    await Promise.all(
      recipients.map((recipientId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipientId,
            organizationId: fact.organizationId,
            // Mandatory account notices are Organization-scoped; a closure is
            // not a fact about any one Property.
            propertyId: null,
            type: ORGANIZATION_PURGE_PENDING_NOTIFICATION_TYPE,
            resourceType: 'organization' as const,
            resourceId: fact.organizationId as string,
            eventId: fact.eventId,
            payload: {},
            audience: { kind: 'account_admin' as const },
          },
          // Deterministic per (fact, recipient): bus and outbox dual delivery
          // and any retry converge on ONE notice per admin per revision.
          { jobId: `${fact.eventId}-${recipientId}` },
        ),
      ),
    )
  }
