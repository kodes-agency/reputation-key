import {
  GBP_IMPORT_ITEM_STATUSES,
  IMPORT_OUTCOME_PRESENTATION,
  type GbpImportItemStatus,
  type ImportOutcomeCode,
  type ImportParentStatus,
  type ImportReducerClass,
} from './google-import-v2-contract'
import { GOOGLE_IMPORT_BATCH_SIZE } from './google-import-saga'

export const GOOGLE_IMPORT_PARENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

export type GoogleImportReducerItem = Readonly<{
  status: GbpImportItemStatus
  outcomeCode: ImportOutcomeCode | null
  highestAttemptForRevision: number
}>

export type GoogleImportParentReduction = Readonly<{
  status: ImportParentStatus
  processedCount: number
  counts: Readonly<Record<GbpImportItemStatus, number>>
  firstTerminalAt: Date | null
  purgeAt: Date | null
}>

function emptyCounts(): Record<GbpImportItemStatus, number> {
  return Object.fromEntries(
    GBP_IMPORT_ITEM_STATUSES.map((status) => [status, 0]),
  ) as Record<GbpImportItemStatus, number>
}

function reducerClassFor(item: GoogleImportReducerItem): ImportReducerClass | null {
  if (item.status === 'pending' || item.status === 'processing') {
    if (item.outcomeCode !== null) {
      throw new Error('invalid import item status/outcome pair')
    }
    return null
  }
  if (item.outcomeCode === null) {
    throw new Error('invalid import item status/outcome pair')
  }
  const presentation = IMPORT_OUTCOME_PRESENTATION[item.outcomeCode]
  if (presentation.status !== item.status) {
    throw new Error('invalid import item status/outcome pair')
  }
  return presentation.reducerClass
}

function terminalStatus(classes: readonly ImportReducerClass[]): ImportParentStatus {
  if (classes.every((value) => value === 'success')) return 'completed'
  const hasPositive = classes.some(
    (value) => value === 'success' || value === 'benign_skip',
  )
  if (!hasPositive && classes.every((value) => value === 'cancellation')) {
    return 'cancelled'
  }
  if (!hasPositive && classes.some((value) => value === 'failure')) {
    return 'failed'
  }
  return 'completed_with_issues'
}

/**
 * Exhaustive reducer for every persisted item transition and progress read.
 * `firstTerminalAt` is immutable: a manual retry may reopen work but never
 * extends the fixed parent retention deadline.
 */
export function reduceGoogleImportParent(
  input: Readonly<{
    items: readonly GoogleImportReducerItem[]
    firstTerminalAt: Date | null
    now: Date
  }>,
): GoogleImportParentReduction {
  if (input.items.length < 1 || input.items.length > GOOGLE_IMPORT_BATCH_SIZE) {
    throw new Error('invalid import item count')
  }

  const counts = emptyCounts()
  const classes: ImportReducerClass[] = []
  let hasNonterminal = false
  let anyClaimOccurred = input.firstTerminalAt !== null

  for (const item of input.items) {
    if (
      !Number.isSafeInteger(item.highestAttemptForRevision) ||
      item.highestAttemptForRevision < 0 ||
      item.highestAttemptForRevision > 5
    ) {
      throw new Error('invalid import attempt high-water')
    }
    counts[item.status] += 1
    const reducerClass = reducerClassFor(item)
    if (reducerClass === null) hasNonterminal = true
    else classes.push(reducerClass)
    if (item.highestAttemptForRevision > 0 || item.status === 'processing') {
      anyClaimOccurred = true
    }
  }

  const processedCount = input.items.length - counts.pending - counts.processing
  let status: ImportParentStatus
  if (hasNonterminal) {
    status =
      counts.pending === input.items.length && !anyClaimOccurred ? 'queued' : 'processing'
  } else {
    status = terminalStatus(classes)
  }

  const firstTerminalAt =
    hasNonterminal || input.firstTerminalAt !== null
      ? input.firstTerminalAt
      : new Date(input.now.getTime())
  const purgeAt = firstTerminalAt
    ? new Date(firstTerminalAt.getTime() + GOOGLE_IMPORT_PARENT_RETENTION_MS)
    : null

  return {
    status,
    processedCount,
    counts,
    firstTerminalAt,
    purgeAt,
  }
}
