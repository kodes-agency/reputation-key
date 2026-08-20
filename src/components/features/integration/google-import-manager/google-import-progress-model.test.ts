import { describe, expect, it } from 'vitest'
import {
  GBP_IMPORT_ITEM_STATUSES,
  IMPORT_OUTCOME_CODES,
  type ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import {
  importItemMessage,
  importProgressPercent,
  importProgressSummary,
  isImportParentTerminal,
  parentStatusMessage,
} from './google-import-progress-model'

const progress = (processedCount: number, totalCount: number): ImportProgressDto => ({
  contractVersion: 2,
  importJobId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  status: 'processing',
  totalCount,
  processedCount,
  counts: {
    pending: Math.max(totalCount - processedCount, 0),
    processing: 0,
    imported: processedCount,
    relinked: 0,
    already_exists: 0,
    region_unavailable: 0,
    failed: 0,
    cancelled: 0,
  },
  items: [],
  canRetry: false,
  pollAfterMs: 2_000,
  purgeAt: null,
  updatedAt: '2026-08-12T10:00:00.000Z',
})

describe('Google import progress presentation', () => {
  it('has human copy for every item status and outcome code', () => {
    for (const status of GBP_IMPORT_ITEM_STATUSES) {
      expect(importItemMessage({ status, outcomeCode: null })).not.toMatch(/_/u)
    }
    for (const outcomeCode of IMPORT_OUTCOME_CODES) {
      expect(importItemMessage({ status: 'failed', outcomeCode })).not.toMatch(/_/u)
    }
  })

  it('treats every final parent status as terminal and processing states as live', () => {
    expect(isImportParentTerminal('queued')).toBe(false)
    expect(isImportParentTerminal('processing')).toBe(false)
    for (const status of [
      'completed',
      'completed_with_issues',
      'failed',
      'cancelled',
    ] as const) {
      expect(isImportParentTerminal(status)).toBe(true)
      expect(parentStatusMessage(status)).toBeTruthy()
    }
  })

  it('bounds progress percentage for empty and inconsistent snapshots', () => {
    expect(importProgressPercent(progress(0, 0))).toBe(0)
    expect(importProgressPercent(progress(3, 4))).toBe(75)
    expect(importProgressPercent(progress(8, 4))).toBe(100)
  })

  it('gives every item status exactly one summary figure', () => {
    const counts = Object.fromEntries(
      GBP_IMPORT_ITEM_STATUSES.map((status, index) => [status, index + 1]),
    ) as ImportProgressDto['counts']
    const summary = importProgressSummary({ ...progress(0, 0), counts })
    const total = GBP_IMPORT_ITEM_STATUSES.reduce((sum, s) => sum + counts[s], 0)

    // Any status dropped from — or double-counted across — the cards breaks this.
    expect(
      summary.completed + summary.alreadyLinked + summary.issues + summary.remaining,
    ).toBe(total)
  })

  it('reports an all-already-bound import as already linked, not as zero work', () => {
    const summary = importProgressSummary({
      ...progress(3, 3),
      status: 'completed_with_issues',
      counts: {
        pending: 0,
        processing: 0,
        imported: 0,
        relinked: 0,
        already_exists: 3,
        region_unavailable: 0,
        failed: 0,
        cancelled: 0,
      },
    })

    expect(summary).toEqual({
      completed: 0,
      alreadyLinked: 3,
      issues: 0,
      remaining: 0,
    })
  })
})
