// Portal context — link mapper unit tests
// Per architecture: mapper is pure functions; trivial but regression-safe.

import { describe, it, expect } from 'vitest'
import { categoryFromRow, categoryToRow, linkFromRow, linkToRow } from './portal-link.mapper'
import { buildTestPortalLinkCategory, buildTestPortalLink } from '#/shared/testing/fixtures'

describe('portal-link.mapper', () => {
  describe('categoryFromRow', () => {
    it('maps a DB row to a domain category', () => {
      const cat = categoryFromRow({
        id: 'cat-11111111-1111-1111-1111-111111111111',
        portalId: 'portal-11111111-1111-1111-1111-111111111111',
        organizationId: 'org-11111111-1111-1111-1111-111111111111',
        title: 'Rooms',
        sortKey: 'a0',
        createdAt: new Date('2026-04-10T12:00:00Z'),
        updatedAt: new Date('2026-04-10T12:00:00Z'),
      } as never)

      expect(cat.title).toBe('Rooms')
      expect(cat.sortKey).toBe('a0')
    })
  })

  describe('categoryToRow', () => {
    it('maps a domain category back to a DB row shape', () => {
      const cat = buildTestPortalLinkCategory({
        title: 'Dining',
        sortKey: 'b1',
      })

      const row = categoryToRow(cat)

      expect(row.title).toBe('Dining')
      expect(row.sortKey).toBe('b1')
    })
  })

  describe('linkFromRow', () => {
    it('maps a DB row to a domain link', () => {
      const link = linkFromRow({
        id: 'link-11111111-1111-1111-1111-111111111111',
        categoryId: 'cat-11111111-1111-1111-1111-111111111111',
        portalId: 'portal-11111111-1111-1111-1111-111111111111',
        organizationId: 'org-11111111-1111-1111-1111-111111111111',
        label: 'Booking Engine',
        url: 'https://book.example.com',
        iconKey: 'calendar',
        sortKey: 'a0',
        createdAt: new Date('2026-04-10T12:00:00Z'),
        updatedAt: new Date('2026-04-10T12:00:00Z'),
      } as never)

      expect(link.label).toBe('Booking Engine')
      expect(link.url).toBe('https://book.example.com')
      expect(link.iconKey).toBe('calendar')
    })
  })

  describe('linkToRow', () => {
    it('maps a domain link back to a DB row shape', () => {
      const link = buildTestPortalLink({
        label: 'Concierge',
        url: 'https://concierge.example.com',
        iconKey: 'bell',
        sortKey: 'c2',
      })

      const row = linkToRow(link)

      expect(row.label).toBe('Concierge')
      expect(row.url).toBe('https://concierge.example.com')
      expect(row.iconKey).toBe('bell')
      expect(row.sortKey).toBe('c2')
    })
  })
})
