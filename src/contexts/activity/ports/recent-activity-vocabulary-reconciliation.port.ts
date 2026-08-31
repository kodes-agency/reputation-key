import type { OrganizationId } from '#/shared/domain/ids'

export type RecentActivityVocabularyPair = Readonly<{
  action: string
  resourceType: string
}>

export type RecentActivityVocabularyTargetGroup = RecentActivityVocabularyPair &
  Readonly<{
    count: number
    targetFingerprintSha256: string
  }>

export type RecentActivityVocabularyApplyCommand = Readonly<{
  operationId: string
  organizationId: OrganizationId
  source: RecentActivityVocabularyPair
  target: RecentActivityVocabularyPair
  expectedTargetCount: number
  expectedTargetFingerprintSha256: string
  authorizedBy: string
  authorizationEvidenceRef: string
  appliedAt: Date
}>

export type RecentActivityVocabularyApplyOutcome =
  | Readonly<{ status: 'applied' | 'replayed'; updatedCount: number }>
  | Readonly<{
      status: 'stale_target'
      currentCount: number
      currentTargetFingerprintSha256: string
    }>
  | Readonly<{ status: 'no_rows' }>
  | Readonly<{ status: 'operation_conflict' }>

export type RecentActivityVocabularyReconciliationStore = Readonly<{
  report(
    organizationId: OrganizationId,
  ): Promise<readonly RecentActivityVocabularyTargetGroup[]>
  apply(
    command: RecentActivityVocabularyApplyCommand,
  ): Promise<RecentActivityVocabularyApplyOutcome>
}>

export type RecentActivityVocabularyApplyAuthority = Readonly<{
  authorize(
    command: Omit<RecentActivityVocabularyApplyCommand, 'appliedAt'>,
  ): Promise<boolean>
}>
