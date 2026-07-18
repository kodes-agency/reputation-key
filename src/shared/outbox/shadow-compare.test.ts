// BQC-3.9 — shadow-compare harness tests.
//
// For shadow families the durable and the in-process bus paths BOTH process
// the same event; the harness reads back the resulting inbox projection row
// after each path and compares the projection-owned fields (status, milestone
// timestamps, sourceDate, platform — never content). Results are structured
// logger lines + an in-memory summary; mismatch samples carry the eventId and
// the diverging field NAMES only (ADR 0030 — values never leave the DB).

import { describe, it, expect, vi } from 'vitest'
import {
  compareInboxProjection,
  createShadowCompareCollector,
  type InboxProjectionSnapshot,
} from './shadow-compare'

const OPEN_ITEM: InboxProjectionSnapshot = {
  exists: true,
  status: 'open',
  sourceDate: '2026-06-01T12:00:00.000Z',
  platform: 'google',
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  closedAt: null,
}

describe('compareInboxProjection (BQC-3.9)', () => {
  it('matches identical snapshots with no mismatch fields', () => {
    const result = compareInboxProjection({
      family: 'review.created',
      eventId: 'evt-1',
      bus: OPEN_ITEM,
      durable: OPEN_ITEM,
    })
    expect(result).toEqual({
      family: 'review.created',
      eventId: 'evt-1',
      outcome: 'match',
      mismatchFields: [],
    })
  })

  it('matches two absent rows (both paths produced nothing)', () => {
    const result = compareInboxProjection({
      family: 'review.expired',
      eventId: 'evt-2',
      bus: { exists: false },
      durable: { exists: false },
    })
    expect(result.outcome).toBe('match')
    expect(result.mismatchFields).toEqual([])
  })

  it('flags an existence divergence', () => {
    const result = compareInboxProjection({
      family: 'review.created',
      eventId: 'evt-3',
      bus: OPEN_ITEM,
      durable: { exists: false },
    })
    expect(result.outcome).toBe('mismatch')
    expect(result.mismatchFields).toEqual(['exists'])
  })

  it('flags each diverging projection field by NAME only', () => {
    const result = compareInboxProjection({
      family: 'review.reply.published',
      eventId: 'evt-4',
      bus: {
        ...OPEN_ITEM,
        status: 'closed',
        firstReplyPublishedAt: '2026-06-02T10:00:00.000Z',
        closedAt: '2026-06-02T10:00:00.000Z',
      },
      durable: {
        ...OPEN_ITEM,
        status: 'open',
        firstReplyPublishedAt: '2026-06-02T10:00:00.000Z',
        closedAt: null,
      },
    })
    expect(result.outcome).toBe('mismatch')
    expect(result.mismatchFields).toEqual(['status', 'closedAt'])
    // Content-free: no snapshot value appears anywhere in the result.
    expect(JSON.stringify(result)).not.toContain('2026-06-02')
    expect(JSON.stringify(result)).not.toContain('closed"')
  })

  it('flags sourceDate/platform drift (review.updated refresh)', () => {
    const result = compareInboxProjection({
      family: 'review.updated',
      eventId: 'evt-5',
      bus: { ...OPEN_ITEM, sourceDate: '2026-06-03T00:00:00.000Z' },
      durable: OPEN_ITEM,
    })
    expect(result.outcome).toBe('mismatch')
    expect(result.mismatchFields).toEqual(['sourceDate'])
  })
})

describe('shadow-compare collector (BQC-3.9)', () => {
  it('logs a structured shadow.compare line per result and summarizes counts', () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const collector = createShadowCompareCollector({ logger })

    collector.record(
      compareInboxProjection({
        family: 'review.created',
        eventId: 'evt-1',
        bus: OPEN_ITEM,
        durable: OPEN_ITEM,
      }),
    )
    collector.record(
      compareInboxProjection({
        family: 'review.expired',
        eventId: 'evt-2',
        bus: OPEN_ITEM,
        durable: { exists: false },
      }),
    )

    const summary = collector.summary()
    expect(summary.compared).toBe(2)
    expect(summary.matched).toBe(1)
    expect(summary.mismatched).toBe(1)
    expect(summary.results).toHaveLength(2)

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'review.created',
        eventId: 'evt-1',
        outcome: 'match',
      }),
      'shadow.compare',
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'review.expired',
        eventId: 'evt-2',
        outcome: 'mismatch',
        mismatchFields: ['exists'],
      }),
      'shadow.compare',
    )
    // Content-free logging: the warn payload carries field names only.
    expect(JSON.stringify(logger.warn.mock.calls[0]?.[0])).not.toContain('sourceDate')
  })
})
