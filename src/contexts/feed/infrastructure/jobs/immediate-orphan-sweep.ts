// Feed notification surface — immediate-email orphan sweep.
//
// The recovery path for an immediate email whose job never ran or gave up: the
// enqueue after the queue row committed failed (Redis was unavailable), or
// BullMQ spent its attempts on a transient provider failure. The queue row
// survives either way, so the hourly digest run re-enqueues every due
// immediate row it may still send.
//
// Two legs, because two delivery scopes exist. Property-scoped rows are
// authorized per Property. Organization-scoped rows are the mandatory access
// and purge notices ADR 0046 says must always go out; they have no Property,
// so the Property walk never saw them, and they are authorized per
// Organization instead.
//
// A row past its freshness bound — typically queued while its scope was dark
// for email — is suppressed as stale here rather than enqueued, so admitting
// a scope never releases its backlog as a burst.

import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationEmail } from '../../domain/notification-types'
import { isStaleQueuedEmail, STALE_EMAIL_REASON } from '../../domain/email-freshness'

type PropertyScope = Readonly<{ organization_id: string; property_id: string }>

export type ImmediateEmailEnqueue = (data: {
  notificationEmailId: string
  organizationId: string
  /** Absent for an Organization-scoped mandatory notice. */
  propertyId?: string
}) => Promise<void>

export type ImmediateOrphanSweepDeps = Readonly<{
  pool: Pick<Pool, 'query'>
  emailRepo: Pick<
    NotificationEmailRepositoryPort,
    | 'findDueByProperty'
    | 'findDueOrganizationScopes'
    | 'findDueByOrganization'
    | 'markSuppressed'
  >
  authorizeScope: ScheduledScopeAuthorizer
  logger: LoggerPort
  enqueueImmediate: ImmediateEmailEnqueue
}>

async function retireStale(
  deps: ImmediateOrphanSweepDeps,
  stale: readonly NotificationEmail[],
  now: Date,
): Promise<void> {
  for (const entry of stale) {
    await deps.emailRepo.markSuppressed(
      entry.id,
      entry.organizationId,
      entry.propertyId,
      STALE_EMAIL_REASON,
      now,
    )
  }
  if (stale.length > 0) {
    deps.logger.warn(
      { stale: stale.length, reason: STALE_EMAIL_REASON },
      'Suppressed immediate notification emails too old to send',
    )
  }
}

async function enqueueAll(
  deps: ImmediateOrphanSweepDeps,
  due: readonly NotificationEmail[],
  scope: Readonly<{ organizationId: string; propertyId?: string }>,
  now: Date,
): Promise<void> {
  const stale = due.filter((entry) => isStaleQueuedEmail(entry, now))
  await retireStale(deps, stale, now)
  const orphans = due.filter((entry) => !stale.includes(entry))
  for (const entry of orphans) {
    await deps.enqueueImmediate({ notificationEmailId: entry.id as string, ...scope })
  }
  if (orphans.length > 0) {
    deps.logger.info(
      { orphans: orphans.length },
      'Re-enqueued immediate notification emails missed by the urgent path',
    )
  }
}

async function sweepPropertyScoped(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  const scopes = await deps.pool.query<PropertyScope>(
    `SELECT organization_id, id::text AS property_id
       FROM properties
      WHERE deleted_at IS NULL
        AND lifecycle_state = 'active'`,
  )
  for (const scope of scopes.rows) {
    if (!(await deps.authorizeScope(scope.organization_id, scope.property_id))) continue
    try {
      const orphans = await deps.emailRepo.findDueByProperty(
        organizationId(scope.organization_id),
        propertyId(scope.property_id),
        'immediate',
        now,
      )
      await enqueueAll(
        deps,
        orphans,
        { organizationId: scope.organization_id, propertyId: scope.property_id },
        now,
      )
    } catch (error) {
      deps.logger.error({ error }, 'Immediate email orphan sweep failed for property')
    }
  }
}

async function sweepOrganizationScoped(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  const organizations = await deps.emailRepo.findDueOrganizationScopes(now)
  for (const orgId of organizations) {
    if (!(await deps.authorizeScope(orgId as string))) continue
    try {
      const orphans = await deps.emailRepo.findDueByOrganization(orgId, now)
      await enqueueAll(deps, orphans, { organizationId: orgId as string }, now)
    } catch (error) {
      deps.logger.error(
        { error },
        'Immediate email orphan sweep failed for Organization-scoped mail',
      )
    }
  }
}

export async function sweepImmediateOrphans(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  await sweepPropertyScoped(deps, now)
  await sweepOrganizationScoped(deps, now)
}
