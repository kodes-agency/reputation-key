import { describe, it, expect } from 'vitest'
import {
  createActivityItem,
  tombstoneActivity,
  sanitizeActivityMetadata,
  computeAuditHash,
  type AuditRecord,
} from './activity-audit'

describe('Activity & Audit', () => {
  describe('sanitizeActivityMetadata', () => {
    it('keeps safe fields', () => {
      const result = sanitizeActivityMetadata({ name: 'John', count: 5, active: true })
      expect(result.name).toBe('John')
      expect(result.count).toBe(5)
      expect(result.active).toBe(true)
    })

    it('removes forbidden fields', () => {
      const result = sanitizeActivityMetadata({
        name: 'John',
        reviewText: 'Great service',
        token: 'abc123',
        password: 'secret',
      })
      expect(result.name).toBe('John')
      expect(result).not.toHaveProperty('reviewText')
      expect(result).not.toHaveProperty('token')
      expect(result).not.toHaveProperty('password')
    })

    it('redacts complex objects', () => {
      const result = sanitizeActivityMetadata({ nested: { a: 1 } })
      expect(result.nested).toBe('[redacted]')
    })
  })

  describe('createActivityItem', () => {
    it('creates an activity item with sanitized metadata', () => {
      const item = createActivityItem({
        id: 'act-1',
        organizationId: 'org-1',
        userId: 'user-1',
        category: 'goal_lifecycle',
        resourceType: 'goal',
        resourceId: 'goal-1',
        resourceLabel: 'Monthly target',
        action: 'created',
        metadata: { target: 20, reviewText: 'should be removed' },
      })
      expect(item.isTombstoned).toBe(false)
      expect(item.metadata).toHaveProperty('target', 20)
      expect(item.metadata).not.toHaveProperty('reviewText')
    })
  })

  describe('tombstoneActivity', () => {
    it('redacts the activity item', () => {
      const item = createActivityItem({
        id: 'act-1',
        organizationId: 'org-1',
        userId: 'user-1',
        category: 'badge_award',
        resourceType: 'badge',
        resourceId: 'badge-1',
        resourceLabel: 'Award name',
        action: 'awarded',
        metadata: { value: 90 },
      })
      const tombstoned = tombstoneActivity(item)
      expect(tombstoned.isTombstoned).toBe(true)
      expect(tombstoned.resourceLabel).toBe('[redacted]')
      expect(Object.keys(tombstoned.metadata)).toHaveLength(0)
    })
  })

  describe('computeAuditHash', () => {
    it('produces a deterministic hash', () => {
      const record: Omit<AuditRecord, 'hash'> = {
        id: 'audit-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        category: 'authentication',
        resourceType: 'session',
        resourceId: 'sess-1',
        action: 'login',
        result: 'success',
        reason: null,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        sequenceNumber: 1,
        previousHash: null,
      }
      const hash1 = computeAuditHash(record)
      const hash2 = computeAuditHash(record)
      expect(hash1).toBe(hash2)
      expect(hash1.length).toBeGreaterThan(0)
    })

    it('produces different hashes for different records', () => {
      const base: Omit<AuditRecord, 'hash'> = {
        id: 'audit-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        category: 'authentication',
        resourceType: 'session',
        resourceId: 'sess-1',
        action: 'login',
        result: 'success',
        reason: null,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        sequenceNumber: 1,
        previousHash: null,
      }
      const different = { ...base, action: 'logout' }
      expect(computeAuditHash(base)).not.toBe(computeAuditHash(different))
    })
  })
})
