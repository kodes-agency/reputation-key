// BQR-1.1: Executable schema parity for migrations 0006–0007 and later additions.
//
// Ensures the canonical Drizzle model includes tables and columns that
// already exist in the migrated database. Prevents silent dual-truth where
// SQL migrations add objects the TypeScript schema never learns about.
//
// Does NOT connect to Postgres — asserts against Drizzle table metadata.

import { describe, it, expect } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { properties } from './property.schema'
import { reviews } from './review.schema'
import {
  reviewSyncState,
  reviewSyncRuns,
  inboundWebhookReceipts,
} from './review-sync.schema'

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table)).map((c) => c.name)
}

describe('BQR-1.1: schema parity with migrations 0006–0007 and later additions', () => {
  describe('migration 0006 — property processing profile', () => {
    it('exposes properties table name', () => {
      expect(getTableName(properties)).toBe('properties')
    })

    it('includes all routing / processing-profile columns', () => {
      const cols = new Set(columnNames(properties))
      for (const name of [
        'country_code',
        'country_source',
        'timezone_source',
        'timezone_resolved_at',
        'processing_region',
        'data_cell_id',
        'processing_region_source',
        'routing_policy_version',
        'processing_region_resolved_at',
        'source_epoch',
      ]) {
        expect(cols.has(name), `properties missing column ${name}`).toBe(true)
      }
    })
  })

  describe('migration 0006 — review source lifecycle', () => {
    it('includes all source-lifecycle columns on reviews', () => {
      const cols = new Set(columnNames(reviews))
      for (const name of [
        'source_created_at',
        'source_updated_at',
        'first_fetched_at',
        'last_fetched_at',
        'content_expires_at',
        'content_hash',
        'source_seen_generation',
      ]) {
        expect(cols.has(name), `reviews missing column ${name}`).toBe(true)
      }
    })
  })

  describe('migration 0007 — review sync operational tables', () => {
    it('registers review_sync_state with primary cursor columns', () => {
      expect(getTableName(reviewSyncState)).toBe('review_sync_state')
      const cols = new Set(columnNames(reviewSyncState))
      for (const name of [
        'property_id',
        'source',
        'watermark_updated_at',
        'next_incremental_at',
        'lease_until',
        'source_epoch',
      ]) {
        expect(cols.has(name), `review_sync_state missing ${name}`).toBe(true)
      }
    })

    it('registers review_sync_runs', () => {
      expect(getTableName(reviewSyncRuns)).toBe('review_sync_runs')
      const cols = new Set(columnNames(reviewSyncRuns))
      expect(cols.has('mode')).toBe(true)
      expect(cols.has('started_at')).toBe(true)
      expect(cols.has('result')).toBe(true)
    })

    it('registers inbound_webhook_receipts', () => {
      expect(getTableName(inboundWebhookReceipts)).toBe('inbound_webhook_receipts')
      const cols = new Set(columnNames(inboundWebhookReceipts))
      expect(cols.has('provider')).toBe(true)
      expect(cols.has('topic')).toBe(true)
      expect(cols.has('message_id')).toBe(true)
    })
  })
})
