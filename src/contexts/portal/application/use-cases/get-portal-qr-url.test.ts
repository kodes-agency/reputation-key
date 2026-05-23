import { describe, it, expect } from 'vitest'
import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getPortalQrUrl } from './get-portal-qr-url'
import { organizationId, userId } from '#/shared/domain/ids'

const fakePortalRepo: PortalRepository = {
  getPortalQrInfo: async () => ({
    propertySlug: 'my-hotel',
    slug: 'feedback',
  }),
} as Partial<PortalRepository> as PortalRepository

const ctx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
}

describe('getPortalQrUrl', () => {
  it('builds URL with source=qr', async () => {
    const fn = getPortalQrUrl({
      portalRepo: fakePortalRepo,
      baseUrl: 'https://example.com',
    })

    const result = await fn({ portalId: 'portal-1' }, ctx)
    expect(result.portalUrl).toBe('https://example.com/p/my-hotel/feedback?source=qr')
  })

  it('appends referralCode when provided', async () => {
    const fn = getPortalQrUrl({
      portalRepo: fakePortalRepo,
      baseUrl: 'https://example.com',
    })

    const result = await fn({ portalId: 'portal-1', referralCode: 'j-doe-a3f2' }, ctx)
    expect(result.portalUrl).toBe(
      'https://example.com/p/my-hotel/feedback?source=qr&ref=j-doe-a3f2',
    )
  })
})
