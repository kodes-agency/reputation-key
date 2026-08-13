import { describe, expect, it } from 'vitest'
import {
  GBP_IMPORT_ITEM_STATUSES,
  IMPORT_OUTCOME_CODES,
  type ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import {
  importItemMessage,
  importProgressPercent,
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
})
