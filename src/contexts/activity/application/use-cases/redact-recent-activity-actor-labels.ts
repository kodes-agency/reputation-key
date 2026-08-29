import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { activityError } from '../../domain/errors'
import { RECENT_ACTIVITY_REPLAY_RETENTION_MS } from '../../domain/recent-activity-replay-fact'
import type { RecentActivityPrivacyStore } from '../../ports/recent-activity-privacy-store.port'

const RECENT_ACTIVITY_REDACTION_BATCH_MAX = 100

export type RedactRecentActivityActorLabelsInput = Readonly<{
  organizationId: OrganizationId
  actorSubjectId: UserId
  limit?: number
}>

export type RedactRecentActivityActorLabelsDeps = Readonly<{
  store: RecentActivityPrivacyStore
  clock: () => Date
}>

export const redactRecentActivityActorLabels =
  (deps: RedactRecentActivityActorLabelsDeps) =>
  async (input: RedactRecentActivityActorLabelsInput) => {
    if ((input.actorSubjectId as string).length === 0) {
      throw activityError(
        'invalid_recent_activity_redaction_subject',
        'Recent Activity actor-label redaction requires a subject',
      )
    }
    const redactedAt = deps.clock()
    if (Number.isNaN(redactedAt.getTime())) {
      throw activityError(
        'invalid_recent_activity_redaction_time',
        'Recent Activity actor-label redaction time is invalid',
      )
    }
    return deps.store.redactActorLabels({
      organizationId: input.organizationId,
      actorSubjectId: input.actorSubjectId,
      redactedAt,
      expiresAt: new Date(redactedAt.getTime() + RECENT_ACTIVITY_REPLAY_RETENTION_MS),
      limit: Math.min(
        RECENT_ACTIVITY_REDACTION_BATCH_MAX,
        Math.max(1, Math.trunc(input.limit ?? RECENT_ACTIVITY_REDACTION_BATCH_MAX)),
      ),
    })
  }

export type RedactRecentActivityActorLabels = ReturnType<
  typeof redactRecentActivityActorLabels
>
