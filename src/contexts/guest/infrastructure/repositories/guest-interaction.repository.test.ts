// Guest context — guest interaction repository integration tests
// Per architecture: integration tests against real Postgres.

import { describe, it, expect, beforeAll } from 'vitest'
import { createGuestInteractionRepository } from './guest-interaction.repository'
import { getDb } from '#/shared/db'
import {
  buildTestScanEvent,
  buildTestRating,
  buildTestFeedback,
} from '#/shared/testing/fixtures'
import {
  organizationId,
  portalId,
  propertyId,
  ratingId,
  feedbackId,
} from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-guest-aaaaaa')
const ORG_B = organizationId('org-guest-bbbbbbb')
const PROP_A = propertyId(crypto.randomUUID())
const PORTAL_A = portalId(crypto.randomUUID())
const PROP_SLUG = 'gp-' + (PROP_A as string).slice(0, 12)
const PORTAL_SLUG = 'gport-' + (PORTAL_A as string).slice(0, 12)

let seedPool: Pool

setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['feedback', 'ratings', 'scan_events'],
})

beforeAll(async () => {
  const env = getEnv()
  seedPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })

  await seedPool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Guest Test Prop', $3, 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A as string, ORG_A as string, PROP_SLUG],
  )
  await seedPool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $3, 'Guest Test Portal', $4, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL_A as string, ORG_A as string, PROP_A as string, PORTAL_SLUG],
  )
})

describe('guestInteractionRepository (integration)', () => {
  describe('recordScan', () => {
    it('inserts a scan event', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const scan = buildTestScanEvent({
        id: crypto.randomUUID() as never,
        organizationId: ORG_A,
        portalId: PORTAL_A,
        propertyId: PROP_A,
        sessionId: crypto.randomUUID(),
      })
      await repo.recordScan(scan)
    })
  })

  describe('insertRating', () => {
    it('inserts a rating', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const rating = buildTestRating({
        id: crypto.randomUUID() as never,
        organizationId: ORG_A,
        portalId: PORTAL_A,
        propertyId: PROP_A,
        sessionId: crypto.randomUUID(),
        value: 5,
      })
      await repo.insertRating(rating)
    })
  })

  describe('insertFeedback', () => {
    it('inserts feedback', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const fb = buildTestFeedback({
        id: crypto.randomUUID() as never,
        organizationId: ORG_A,
        portalId: PORTAL_A,
        propertyId: PROP_A,
        sessionId: crypto.randomUUID(),
        comment: 'Great experience!',
        ratingId: null,
      })
      await repo.insertFeedback(fb)
    })
  })

  describe('hasRated', () => {
    it('returns true when a rating exists for the session+portal+org', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const sessionId = crypto.randomUUID()

      const rating = buildTestRating({
        id: crypto.randomUUID() as never,
        organizationId: ORG_A,
        portalId: PORTAL_A,
        propertyId: PROP_A,
        sessionId,
        value: 3,
      })
      await repo.insertRating(rating)

      const result = await repo.hasRated(ORG_A, sessionId, PORTAL_A)
      expect(result).toBe(true)
    })

    it('returns false when no rating exists', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const result = await repo.hasRated(ORG_A, 'nonexistent-session', PORTAL_A)
      expect(result).toBe(false)
    })

    it('returns false for a different org (tenant isolation)', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const sessionId = crypto.randomUUID()

      const rating = buildTestRating({
        id: crypto.randomUUID() as never,
        organizationId: ORG_A,
        portalId: PORTAL_A,
        propertyId: PROP_A,
        sessionId,
        value: 4,
      })
      await repo.insertRating(rating)

      const result = await repo.hasRated(ORG_B, sessionId, PORTAL_A)
      expect(result).toBe(false)
    })
  })
  describe('findRatingById', () => {
    it('returns the rating for the owning org and null for a different org (tenant isolation)', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const rid = crypto.randomUUID()
      await repo.insertRating(
        buildTestRating({
          id: rid as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId: crypto.randomUUID(),
          value: 3,
        }),
      )

      expect(await repo.findRatingById(ratingId(rid), ORG_A)).not.toBeNull()
      // A dropped eq(...organizationId) filter would surface ORG_A's row here.
      expect(await repo.findRatingById(ratingId(rid), ORG_B)).toBeNull()
    })
  })

  describe('findFeedbackById', () => {
    it('returns the feedback for the owning org and null for a different org (tenant isolation)', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const fid = crypto.randomUUID()
      await repo.insertFeedback(
        buildTestFeedback({
          id: fid as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId: crypto.randomUUID(),
          comment: 'Tenant isolation check',
          ratingId: null,
        }),
      )

      expect(await repo.findFeedbackById(feedbackId(fid), ORG_A)).not.toBeNull()
      expect(await repo.findFeedbackById(feedbackId(fid), ORG_B)).toBeNull()
    })
  })

  describe('getLatestScanBySession', () => {
    it('returns the scan for the owning org and null for a different org (tenant isolation)', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const sessionId = crypto.randomUUID()
      await repo.recordScan(
        buildTestScanEvent({
          id: crypto.randomUUID() as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId,
        }),
      )

      expect(await repo.getLatestScanBySession(ORG_A, sessionId)).not.toBeNull()
      expect(await repo.getLatestScanBySession(ORG_B, sessionId)).toBeNull()
    })
  })

  describe('hasRatedByIpWithin', () => {
    it('returns true when the same ipHash rated this portal within the window', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const ipHash = 'ip-dedup-' + crypto.randomUUID()
      await repo.insertRating(
        buildTestRating({
          id: crypto.randomUUID() as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId: crypto.randomUUID(),
          value: 5,
          ipHash,
          createdAt: new Date(),
        }),
      )

      expect(await repo.hasRatedByIpWithin(ORG_A, ipHash, PORTAL_A, 3600)).toBe(true)
    })

    it('returns false when the only matching rating is older than the window', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const ipHash = 'ip-dedup-old-' + crypto.randomUUID()
      // Backdate to 2h ago — outside a 1h window.
      await repo.insertRating(
        buildTestRating({
          id: crypto.randomUUID() as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId: crypto.randomUUID(),
          value: 5,
          ipHash,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
      )

      expect(await repo.hasRatedByIpWithin(ORG_A, ipHash, PORTAL_A, 3600)).toBe(false)
    })

    it('returns false for a different org (tenant isolation)', async () => {
      const db = getDb()
      const repo = createGuestInteractionRepository(db)
      const ipHash = 'ip-dedup-org-' + crypto.randomUUID()
      await repo.insertRating(
        buildTestRating({
          id: crypto.randomUUID() as never,
          organizationId: ORG_A,
          portalId: PORTAL_A,
          propertyId: PROP_A,
          sessionId: crypto.randomUUID(),
          value: 5,
          ipHash,
          createdAt: new Date(),
        }),
      )

      expect(await repo.hasRatedByIpWithin(ORG_B, ipHash, PORTAL_A, 3600)).toBe(false)
    })
  })
})
