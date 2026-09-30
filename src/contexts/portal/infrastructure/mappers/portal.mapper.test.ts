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
  privateFeedbackThreshold: 3,
  publicationState: 'published',
  createdBy: 'creator-1',
  responsibleManagerRevision: 1,
  responsibilityNeededSince: null,
  primaryGuestLocale: 'en',
  additionalGuestLocales: [],
  linktreeEnabled: true,
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
    expect(portal.publicationState).toBe('published')
    expect(portal.privateFeedbackThreshold).toBe(3)
  })

  it('carries the Linktree switch both ways', () => {
    expect(portalFromRow(sampleRow).linktreeEnabled).toBe(true)
    const off = portalFromRow({ ...sampleRow, linktreeEnabled: false })
    expect(off.linktreeEnabled).toBe(false)
    expect(portalToRow(off).linktreeEnabled).toBe(false)
  })

  it('defaults theme when null', () => {
    const row = { ...sampleRow, theme: null }
    const portal = portalFromRow(row)
    expect(portal.theme.primaryColor).toBe('#6366F1')
  })
})

describe('portalFromRow guest locales', () => {
  it('reads every locale of the catalogue', () => {
    const portal = portalFromRow({
      ...sampleRow,
      primaryGuestLocale: 'de',
      additionalGuestLocales: ['bg', 'es'],
    })
    expect(portal.primaryGuestLocale).toBe('de')
    expect(portal.additionalGuestLocales).toEqual(['bg', 'es'])
  })

  it('throws on a primary locale it does not know instead of reading it as English', () => {
    expect(() => portalFromRow({ ...sampleRow, primaryGuestLocale: 'pt' })).toThrow(
      /guest locale/,
    )
  })

  it('throws on an unknown additional locale or a malformed list', () => {
    expect(() =>
      portalFromRow({ ...sampleRow, additionalGuestLocales: ['bg', 'pt'] }),
    ).toThrow(/guest locale/)
    expect(() =>
      portalFromRow({ ...sampleRow, additionalGuestLocales: 'bg' as never }),
    ).toThrow(/guest locale/)
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
    expect(row.publicationState).toBe(sampleRow.publicationState)
    expect(row.privateFeedbackThreshold).toBe(sampleRow.privateFeedbackThreshold)
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
