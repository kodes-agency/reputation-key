import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createGuestResponseRepository } from './repositories/guest-response.repository'

const scope = {
  organizationId: 'org-1',
  propertyId: 'property-1',
  portalId: 'portal-1',
}

function selectDatabase(rows: readonly unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(async () => rows)
  return { db: { select: vi.fn(() => chain) } as unknown as Database, chain }
}

describe('createGuestResponseRepository', () => {
  it('maps a tenant-scoped response without inventing retained contact data', async () => {
    const submittedAt = new Date('2026-08-16T12:00:00.000Z')
    const retentionDeadline = new Date('2026-09-15T12:00:00.000Z')
    const { db, chain } = selectDatabase([
      {
        id: 'response-1',
        ...scope,
        sessionId: 'session-1',
        status: 'corrected',
        rating: 5,
        categoryId: 'service',
        responseText: 'Helpful staff',
        responseConsent: true,
        textConsent: true,
        mediaConsent: false,
        correctionCount: 9,
        submittedAt,
        correctedAt: submittedAt,
        moderatedAt: null,
        deletedAt: null,
        retentionDeadline,
      },
    ])

    await expect(
      createGuestResponseRepository(db).findForSession(scope, 'session-1'),
    ).resolves.toEqual({
      id: 'response-1',
      ...scope,
      sessionId: 'session-1',
      status: 'corrected',
      rating: 5,
      category: 'service',
      text: 'Helpful staff',
      responseConsent: true,
      textConsent: true,
      mediaConsent: false,
      contactConsent: false,
      contactDetails: null,
      correctionCount: 0,
      submittedAt,
      correctedAt: submittedAt,
      moderatedAt: null,
      deletedAt: null,
      retentionDeadline,
      schemaVersion: 1,
    })
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when the scoped response is absent', async () => {
    await expect(
      createGuestResponseRepository(selectDatabase([]).db).findById(scope, 'missing'),
    ).resolves.toBeNull()
  })

  it.each([
    { returned: [{ id: 'response-1' }], inserted: true },
    { returned: [], inserted: false },
  ])(
    'reports idempotent insert disposition: $inserted',
    async ({ returned, inserted }) => {
      const returning = vi.fn(async () => returned)
      const onConflictDoNothing = vi.fn(() => ({ returning }))
      const values = vi.fn(() => ({ onConflictDoNothing }))
      const db = { insert: vi.fn(() => ({ values })) } as unknown as Database
      const response = {
        id: 'response-1',
        ...scope,
        sessionId: 'session-1',
        status: 'submitted',
        rating: 5,
        category: null,
        text: null,
        responseConsent: true,
        textConsent: false,
        mediaConsent: false,
        contactConsent: false,
        contactDetails: null,
        correctionCount: 0,
        submittedAt: new Date('2026-08-16T12:00:00.000Z'),
        correctedAt: null,
        moderatedAt: null,
        deletedAt: null,
        retentionDeadline: new Date('2026-09-15T12:00:00.000Z'),
        schemaVersion: 1,
      } as const

      await expect(
        createGuestResponseRepository(db).insertSubmitted(response),
      ).resolves.toBe(inserted)
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'response-1',
          organizationId: 'org-1',
          propertyId: 'property-1',
          portalId: 'portal-1',
        }),
      )
    },
  )
})
