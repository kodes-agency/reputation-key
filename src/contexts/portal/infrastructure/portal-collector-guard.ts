import type { Tx } from '#/shared/outbox/commit'
import type { PortalRatingGoalReadApi } from '#/contexts/reporting/application/public-api'
import type { UpdatePortalCommand } from '../publication/portal-command-store-port.server'
import { portalError } from '../domain/errors'
import type { PortalSettingsBefore } from './portal-settings-edits'

type Guard = Pick<PortalRatingGoalReadApi, 'findPortalRatingGoalBlockInTransaction'>

/** The caller holds the Property goal fence before locking any Portal row. */
export async function assertPortalCollectorAvailable(
  tx: Tx,
  input: Parameters<Guard['findPortalRatingGoalBlockInTransaction']>[1],
  guard: Guard,
): Promise<void> {
  const block = await guard.findPortalRatingGoalBlockInTransaction(tx, input)
  if (!block) return
  if (block === 'staff_scan_target') {
    throw portalError(
      'running_rating_goal',
      'This portal has a running scan target for staff. End the target first.',
    )
  }
  throw portalError(
    'goal_needs_collector',
    block === 'portal'
      ? 'This portal has a running goal on private ratings. End the goal first.'
      : 'This is the last portal collecting ratings for a running goal. End the goal first.',
  )
}

export async function assertPortalCollectorChange(
  tx: Tx,
  command: UpdatePortalCommand,
  before: PortalSettingsBefore,
  guard: Guard,
): Promise<void> {
  const skipsRatings =
    command.patch.skipPrivateRating === true && before.skipPrivateRating === false
  const stopsCollecting =
    command.patch.publicationState === 'archived' ||
    (command.event.previousPublicationState === 'published' &&
      command.patch.publicationState === 'disabled')
  if (!skipsRatings && !stopsCollecting) return
  await assertPortalCollectorAvailable(
    tx,
    {
      organizationId: command.organizationId,
      propertyId: command.propertyId,
      portalId: command.portalId,
      at: command.occurredAt,
    },
    guard,
  )
}
