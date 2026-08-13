import { describe, expect, it } from 'vitest'
import {
  GBP_IMPORT_ITEM_STATUSES,
  GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
  GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT,
  IMPORT_OUTCOME_CODES,
  IMPORT_OUTCOME_PRESENTATION,
  IMPORT_PARENT_STATUSES,
  PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
  getImportOutcomePresentation,
} from './google-import-v2-contract'

describe('Google property import v2 contract', () => {
  it('freezes event and job wire names', () => {
    expect(GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT).toBe(
      'integration.property_import.requested',
    )
    expect(PROPERTY_IMPORT_RETENTION_RELEASED_EVENT).toBe(
      'integration.property_import.retention_released',
    )
    expect(GOOGLE_PROPERTY_IMPORT_ITEM_JOB).toBe('import-gbp-property-item-v2')
    expect(GOOGLE_PROPERTY_IMPORT_ITEM_JOB).not.toContain(':')
  })

  it('maps every outcome exactly once and rejects unknown outcomes', () => {
    expect(Object.keys(IMPORT_OUTCOME_PRESENTATION).sort()).toEqual(
      [...IMPORT_OUTCOME_CODES].sort(),
    )
    expect(getImportOutcomePresentation('temporarily_unavailable')).toEqual({
      status: 'failed',
      reducerClass: 'failure',
      retryable: true,
      userAction: 'retry',
    })
    expect(getImportOutcomePresentation('future_outcome')).toBeNull()
  })

  it('keeps parent and item statuses distinct from legacy statuses', () => {
    expect(IMPORT_PARENT_STATUSES).toEqual([
      'queued',
      'processing',
      'completed',
      'completed_with_issues',
      'failed',
      'cancelled',
    ])
    expect(GBP_IMPORT_ITEM_STATUSES).toEqual([
      'pending',
      'processing',
      'imported',
      'relinked',
      'already_exists',
      'region_unavailable',
      'failed',
      'cancelled',
    ])
    expect(IMPORT_PARENT_STATUSES).not.toContain('completed_with_skips')
    expect(IMPORT_PARENT_STATUSES).not.toContain('completed_with_failures')
  })
})
