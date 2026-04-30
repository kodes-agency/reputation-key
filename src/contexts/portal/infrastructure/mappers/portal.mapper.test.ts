// Portal context — portal mapper tests

import { describe, it, expect } from 'vitest'
import { portalFromRow, portalToRow } from './portal.mapper'
import type { portals } from '#/shared/db/schema/portal.schema'

type PortalRow = typeof portals.$inferSelect

const now = new Date('2025-01-01T00:00:00Z')

const sampleRow: PortalRow = {
  id: 'portal-uuid',
  organizationId: 'org-uuid',
  propertyId: 'prop-uuid',
  entityType: 'property',
  entityId: 'prop-uuid',
  name: 'Test Portal',
  slug: 'test-portal',
  description: 'A test portal',
  heroImageUrl: null,
  theme: { primaryColor: '#6366F1' },
  smartRoutingEnabled: false,
  smartRoutingThreshold: 4,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
}

describe('portalFromRow', () => {
  it('brands IDs correctly', () => {
    const portal = portalFromRow(sampleRow)
    expect(portal.id).toBe(sampleRow.id)
    expect(portal.organizationId).toBe(sampleRow.organizationId)
    expect(portal.propertyId).toBe(sampleRow.propertyId)
  })

  it('maps all fields', () => {
    const portal = portalFromRow(sampleRow)
    expect(portal.name).toBe('Test Portal')
    expect(portal.slug).toBe('test-portal')
    expect(portal.entityType).toBe('property')
    expect(portal.isActive).toBe(true)
  })

  it('defaults theme when null', () => {
    const row = { ...sampleRow, theme: null }
    const portal = portalFromRow(row)
    expect(portal.theme.primaryColor).toBe('#6366F1')
  })
})

describe('portalToRow', () => {
  it('round-trips through fromRow → toRow', () => {
    const portal = portalFromRow(sampleRow)
    const row = portalToRow(portal)
    expect(row.name).toBe(sampleRow.name)
    expect(row.slug).toBe(sampleRow.slug)
  })
})
