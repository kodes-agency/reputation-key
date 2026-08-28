import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_RESOURCE_TYPES,
  RECENT_ACTIVITY_KINDS,
} from '../../domain/types'
import type {
  RecentActivityVocabularyApplyAuthority,
  RecentActivityVocabularyApplyCommand,
  RecentActivityVocabularyApplyOutcome,
  RecentActivityVocabularyPair,
  RecentActivityVocabularyReconciliationStore,
} from '../../ports/recent-activity-vocabulary-reconciliation.port'

export type RecentActivityVocabularyClassification =
  'canonical' | 'recognized_noncanonical' | 'unmappable'

export type RecentActivityVocabularyReport = Readonly<{
  version: 'recent-activity-vocabulary-report-v1'
  organizationId: OrganizationId
  evaluatedAt: string
  totalEntryCount: number
  groups: readonly Readonly<{
    action: string
    resourceType: string
    count: number
    classification: RecentActivityVocabularyClassification
    targetFingerprintSha256: string
  }>[]
  reportFingerprintSha256: string
}>

const pairKey = ({ action, resourceType }: RecentActivityVocabularyPair): string =>
  `${action}\u0000${resourceType}`
const canonicalPairs = new Set(RECENT_ACTIVITY_KINDS.map(pairKey))
const recognizedActions = new Set<string>(ACTIVITY_ACTIONS)
const recognizedResources = new Set<string>(ACTIVITY_RESOURCE_TYPES)

export const classifyRecentActivityVocabulary = (
  pair: RecentActivityVocabularyPair,
): RecentActivityVocabularyClassification => {
  if (canonicalPairs.has(pairKey(pair))) return 'canonical'
  return recognizedActions.has(pair.action) && recognizedResources.has(pair.resourceType)
    ? 'recognized_noncanonical'
    : 'unmappable'
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const assertPairShape = (pair: RecentActivityVocabularyPair): void => {
  if (
    !/^[a-z][a-z0-9_]{0,49}$/u.test(pair.action) ||
    !/^[a-z][a-z0-9_]{0,49}$/u.test(pair.resourceType)
  ) {
    throw new Error('recent_activity_vocabulary_pair_invalid')
  }
}

export const reportRecentActivityVocabulary =
  (deps: { store: RecentActivityVocabularyReconciliationStore; clock: () => Date }) =>
  async (organizationId: OrganizationId): Promise<RecentActivityVocabularyReport> => {
    const evaluatedAt = deps.clock()
    if (!Number.isSafeInteger(evaluatedAt.getTime())) {
      throw new Error('recent_activity_vocabulary_report_time_invalid')
    }
    const groups = [...(await deps.store.report(organizationId))]
      .map((group) => {
        assertPairShape(group)
        if (
          !Number.isSafeInteger(group.count) ||
          group.count < 1 ||
          !/^[0-9a-f]{64}$/u.test(group.targetFingerprintSha256)
        ) {
          throw new Error('recent_activity_vocabulary_report_row_invalid')
        }
        return Object.freeze({
          ...group,
          classification: classifyRecentActivityVocabulary(group),
        })
      })
      .sort(
        (left, right) =>
          left.action.localeCompare(right.action, 'en') ||
          left.resourceType.localeCompare(right.resourceType, 'en'),
      )
    const totalEntryCount = groups.reduce((sum, group) => sum + group.count, 0)
    if (!Number.isSafeInteger(totalEntryCount)) {
      throw new Error('recent_activity_vocabulary_report_count_invalid')
    }
    const body = {
      version: 'recent-activity-vocabulary-report-v1' as const,
      organizationId,
      evaluatedAt: evaluatedAt.toISOString(),
      totalEntryCount,
      groups,
    }
    return Object.freeze({
      ...body,
      reportFingerprintSha256: sha256(JSON.stringify(body)),
    })
  }

export type ApplyRecentActivityVocabularyInput = Omit<
  RecentActivityVocabularyApplyCommand,
  'appliedAt'
>

export const applyRecentActivityVocabularyReconciliation =
  (deps: {
    store: RecentActivityVocabularyReconciliationStore
    authority: RecentActivityVocabularyApplyAuthority
    clock: () => Date
  }) =>
  async (
    input: ApplyRecentActivityVocabularyInput,
  ): Promise<
    RecentActivityVocabularyApplyOutcome | Readonly<{ status: 'unauthorized' }>
  > => {
    assertPairShape(input.source)
    assertPairShape(input.target)
    if (!canonicalPairs.has(pairKey(input.target))) {
      throw new Error('recent_activity_vocabulary_target_not_canonical')
    }
    if (pairKey(input.source) === pairKey(input.target)) {
      throw new Error('recent_activity_vocabulary_mapping_unchanged')
    }
    if (
      !/^[0-9a-f]{64}$/u.test(input.expectedTargetFingerprintSha256) ||
      !Number.isSafeInteger(input.expectedTargetCount) ||
      input.expectedTargetCount < 1 ||
      !UUID.test(input.operationId) ||
      !isSafeOpaqueIdentifier(input.authorizedBy) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(input.authorizationEvidenceRef)
    ) {
      throw new Error('recent_activity_vocabulary_apply_input_invalid')
    }
    if (!(await deps.authority.authorize(input))) return { status: 'unauthorized' }

    const appliedAt = deps.clock()
    if (!Number.isSafeInteger(appliedAt.getTime())) {
      throw new Error('recent_activity_vocabulary_apply_time_invalid')
    }
    return deps.store.apply({ ...input, appliedAt })
  }
