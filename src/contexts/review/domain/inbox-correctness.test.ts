import { describe, it, expect } from 'vitest'
import {
  MAX_INBOX_PAGE_SIZE,
  DEFAULT_INBOX_PAGE_SIZE,
  encodeCursor,
  decodeCursor,
  clampPageSize,
  checkVersionConflict,
  isValidTriageTransition,
  type InboxCursor,
} from './inbox-correctness'

describe('inbox-correctness (B1.9)', () => {
  describe('cursor pagination', () => {
    it('encodes and decodes a cursor round-trip', () => {
      const cursor: InboxCursor = {
        sortValue: '2026-07-14T12:00:00Z',
        reviewId: 'rev-123',
      }
      const encoded = encodeCursor(cursor)
      const decoded = decodeCursor(encoded)

      expect(decoded).toEqual(cursor)
    })

    it('returns null for malformed cursor', () => {
      expect(decodeCursor('!!!not-valid!!!')).toBeNull()
    })

    it('returns null for null cursor', () => {
      expect(decodeCursor(null)).toBeNull()
    })

    it('returns null for cursor missing fields', () => {
      const bad = Buffer.from(JSON.stringify({ sortValue: 'x' }), 'utf8').toString(
        'base64url',
      )
      expect(decodeCursor(bad)).toBeNull()
    })

    it('clamps page size to maximum', () => {
      expect(clampPageSize(500)).toBe(MAX_INBOX_PAGE_SIZE)
    })

    it('clamps page size to default when undefined', () => {
      expect(clampPageSize(undefined)).toBe(DEFAULT_INBOX_PAGE_SIZE)
    })

    it('clamps page size to default when zero', () => {
      expect(clampPageSize(0)).toBe(DEFAULT_INBOX_PAGE_SIZE)
    })

    it('preserves valid page size', () => {
      expect(clampPageSize(25)).toBe(25)
    })
  })

  describe('optimistic concurrency', () => {
    it('returns null when versions match', () => {
      expect(checkVersionConflict(3, 3)).toBeNull()
    })

    it('returns conflict when versions differ', () => {
      const conflict = checkVersionConflict(3, 5)
      expect(conflict).toEqual({
        code: 'version_conflict',
        expected: 3,
        actual: 5,
      })
    })

    it('returns conflict when expected is stale', () => {
      const conflict = checkVersionConflict(2, 3)
      expect(conflict?.code).toBe('version_conflict')
    })
  })

  describe('review triage state machine', () => {
    it('allows new → open', () => {
      expect(isValidTriageTransition('new', 'open')).toBe(true)
    })

    it('allows new → ignored', () => {
      expect(isValidTriageTransition('new', 'ignored')).toBe(true)
    })

    it('allows open → in_progress', () => {
      expect(isValidTriageTransition('open', 'in_progress')).toBe(true)
    })

    it('allows open → resolved', () => {
      expect(isValidTriageTransition('open', 'resolved')).toBe(true)
    })

    it('allows resolved → open (reopen)', () => {
      expect(isValidTriageTransition('resolved', 'open')).toBe(true)
    })

    it('allows ignored → open (un-ignore)', () => {
      expect(isValidTriageTransition('ignored', 'open')).toBe(true)
    })

    it('rejects new → resolved (must triage first)', () => {
      expect(isValidTriageTransition('new', 'resolved')).toBe(false)
    })

    it('rejects resolved → in_progress (must reopen first)', () => {
      expect(isValidTriageTransition('resolved', 'in_progress')).toBe(false)
    })

    it('rejects ignored → resolved', () => {
      expect(isValidTriageTransition('ignored', 'resolved')).toBe(false)
    })

    it('rejects same-state transitions', () => {
      expect(isValidTriageTransition('open', 'open')).toBe(false)
    })
  })
})
