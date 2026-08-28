import { describe, expect, it } from 'vitest'
import { publishPortalAccessArtifact } from './portal-access-artifact'
import {
  organizationId,
  portalAccessArtifactId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-08-27T10:00:00.000Z')

describe('Portal Access Artifact', () => {
  it.each(['qr', 'nfc'] as const)(
    'publishes a %s artifact bound to one address',
    (channel) => {
      expect(
        publishPortalAccessArtifact({
          id: portalAccessArtifactId('10000000-0000-4000-8000-000000000001'),
          organizationId: organizationId('org-1'),
          propertyId: propertyId('20000000-0000-4000-8000-000000000001'),
          portalId: portalId('30000000-0000-4000-8000-000000000001'),
          portalTokenId: '40000000-0000-4000-8000-000000000001',
          channel,
          now: NOW,
        }),
      ).toEqual({
        id: '10000000-0000-4000-8000-000000000001',
        organizationId: 'org-1',
        propertyId: '20000000-0000-4000-8000-000000000001',
        portalId: '30000000-0000-4000-8000-000000000001',
        portalTokenId: '40000000-0000-4000-8000-000000000001',
        channel,
        status: 'published',
        publishedAt: NOW,
        retiredAt: null,
      })
    },
  )

  it('rejects a channel that is not a controlled artifact marker', () => {
    expect(() =>
      publishPortalAccessArtifact({
        id: portalAccessArtifactId('10000000-0000-4000-8000-000000000001'),
        organizationId: organizationId('org-1'),
        propertyId: propertyId('20000000-0000-4000-8000-000000000001'),
        portalId: portalId('30000000-0000-4000-8000-000000000001'),
        portalTokenId: '40000000-0000-4000-8000-000000000001',
        channel: 'direct' as 'qr',
        now: NOW,
      }),
    ).toThrow('Access Artifact channel must be qr or nfc')
  })
})
