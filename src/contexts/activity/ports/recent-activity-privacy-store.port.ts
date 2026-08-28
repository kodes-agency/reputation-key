import type { OrganizationId, UserId } from '#/shared/domain/ids'

export type RecentActivityActorLabelRedaction = Readonly<{
  redacted: number
  remaining: boolean
}>

export type RecentActivityPrivacyStore = Readonly<{
  redactActorLabels(
    input: Readonly<{
      organizationId: OrganizationId
      actorSubjectId: UserId
      redactedAt: Date
      expiresAt: Date
      limit: number
    }>,
  ): Promise<RecentActivityActorLabelRedaction>
}>
