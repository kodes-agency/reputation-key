import { describe, expect, it } from 'vitest'
import type {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
} from '#/shared/db/schema/portal.schema'
import { contentFromRow, overrideFromRow } from './portal-experience.mapper'

const now = new Date('2026-09-30T10:00:00Z')

const contentRow: typeof propertyPortalBrandContents.$inferSelect = {
  id: 'content-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  locale: 'bg',
  title: 'Заглавие',
  shortDescription: 'Описание',
  version: 1,
  updatedBy: 'user-1',
  createdAt: now,
  updatedAt: now,
}

const overrideRow: typeof portalLocalizedOverrides.$inferSelect = {
  id: 'override-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  portalId: 'portal-1',
  locale: 'en',
  title: 'Title',
  shortDescription: 'Description',
  heroImageUrl: null,
  version: 1,
  updatedBy: 'user-1',
  createdAt: now,
  updatedAt: now,
}

describe('portal experience row mappers', () => {
  it('reads the locale a row stores', () => {
    expect(contentFromRow(contentRow).locale).toBe('bg')
    expect(overrideFromRow(overrideRow).locale).toBe('en')
    expect(contentFromRow({ ...contentRow, locale: 'de' }).locale).toBe('de')
  })

  it('throws on a locale outside the catalogue and never returns en for it', () => {
    expect(() => contentFromRow({ ...contentRow, locale: 'pt' })).toThrow(/locale/)
    expect(() => overrideFromRow({ ...overrideRow, locale: '' })).toThrow(/locale/)
  })
})
