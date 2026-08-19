import type {
  GbpImportItemStatus,
  ImportOutcomeCode,
  ImportParentStatus,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'

const ITEM_STATUS_MESSAGES: Record<GbpImportItemStatus, string> = {
  pending: 'Waiting to start',
  processing: 'Importing property',
  imported: 'Property imported',
  relinked: 'Existing property linked',
  already_exists: 'Property already exists',
  region_unavailable: 'Select a processing region before importing',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
}

const OUTCOME_MESSAGES: Record<ImportOutcomeCode, string> = {
  imported: 'Property imported',
  relinked: 'Existing property linked',
  already_exists: 'Property already exists',
  region_unavailable: 'Select a processing region before importing',
  active_binding_conflict:
    'This Google location is linked elsewhere. Rediscover locations.',
  stale_binding: 'This location changed. Rediscover locations before importing.',
  reauthentication_required: 'Reconnect Google to continue.',
  reconnect_required: 'The Google connection must be restored.',
  authorization_changed: 'Import stopped because access changed.',
  policy_disabled: 'Import stopped because this feature is unavailable.',
  organization_suspended: 'Import stopped because the organization is suspended.',
  property_suspended: 'Import stopped because the property is suspended.',
  property_deleted: 'Import stopped because the property was deleted.',
  temporarily_unavailable: 'Google is temporarily unavailable. Retry this item.',
  cleanup_required: 'Import could not finish safely. Contact support.',
  internal_error: 'Import could not be completed.',
}

const PARENT_MESSAGES: Record<ImportParentStatus, string> = {
  queued: 'Import queued',
  processing: 'Import in progress',
  completed: 'Import complete',
  completed_with_issues: 'Import complete with issues',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
}

export function importItemMessage(
  item: Readonly<{
    status: GbpImportItemStatus
    outcomeCode: ImportOutcomeCode | null
  }>,
): string {
  return item.outcomeCode
    ? OUTCOME_MESSAGES[item.outcomeCode]
    : ITEM_STATUS_MESSAGES[item.status]
}

export function parentStatusMessage(status: ImportParentStatus): string {
  return PARENT_MESSAGES[status]
}

export function isImportParentTerminal(status: ImportParentStatus): boolean {
  return status !== 'queued' && status !== 'processing'
}

export function importProgressPercent(progress: ImportProgressDto): number {
  if (progress.totalCount <= 0) return 0
  return Math.min(
    100,
    Math.max(0, Math.round((progress.processedCount / progress.totalCount) * 100)),
  )
}

export type ImportProgressSummary = Readonly<{
  completed: number
  alreadyLinked: number
  issues: number
  remaining: number
}>

/**
 * Partitions every item status into exactly one summary figure. `already_exists`
 * gets its own bucket: the location was already bound, so nothing was imported and
 * nothing needs attention — folding it into either one, or into neither, made an
 * all-already-bound import render as 0 / 0 / 0.
 *
 * Every status is named explicitly and no figure is derived by subtraction, so the
 * colocated partition test detects a status that is dropped or double counted.
 */
export function importProgressSummary(
  progress: ImportProgressDto,
): ImportProgressSummary {
  const { counts } = progress
  return {
    completed: counts.imported + counts.relinked,
    alreadyLinked: counts.already_exists,
    issues: counts.failed + counts.cancelled + counts.region_unavailable,
    remaining: counts.pending + counts.processing,
  }
}
