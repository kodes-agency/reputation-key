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
  groupId: null,
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
  it('round-trips all fields through fromRow → toRow', () => {
    const portal = portalFromRow(sampleRow)
    const row = portalToRow(portal)

    expect(row.id).toBe(sampleRow.id)
    expect(row.organizationId).toBe(sampleRow.organizationId)
    expect(row.propertyId).toBe(sampleRow.propertyId)
    expect(row.entityType).toBe(sampleRow.entityType)
    expect(row.entityId).toBe(sampleRow.entityId)
    expect(row.name).toBe(sampleRow.name)
    expect(row.slug).toBe(sampleRow.slug)
    expect(row.description).toBe(sampleRow.description)
    expect(row.heroImageUrl).toBe(sampleRow.heroImageUrl)
    expect(row.smartRoutingEnabled).toBe(sampleRow.smartRoutingEnabled)
    expect(row.smartRoutingThreshold).toBe(sampleRow.smartRoutingThreshold)
    expect(row.isActive).toBe(sampleRow.isActive)
    expect(row.createdAt).toBe(sampleRow.createdAt)
    expect(row.updatedAt).toBe(sampleRow.updatedAt)
    expect(row.deletedAt).toBe(sampleRow.deletedAt)
  })

  it('preserves theme object through round-trip', () => {
    const portal = portalFromRow(sampleRow)
    const row = portalToRow(portal)
    expect((row.theme as Record<string, unknown>).primaryColor).toBe('#6366F1')
  })
})
