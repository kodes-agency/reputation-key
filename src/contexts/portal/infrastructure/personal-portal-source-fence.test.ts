import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { assertPersonalSourceFence } from './personal-portal-source-fence'
import { portalCreated } from '../domain/events'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import { buildPortalPublicationSnapshot } from '../application/portal-publication-snapshot'

describe('personal Portal copy source fence', () => {
  it('refuses a source changed after preflight before inserting a personal copy', async () => {
    const portal = buildTestPortal()
    const snapshot = buildPortalPublicationSnapshot({
      id: 'snapshot',
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      version: 1,
      source: publicationSource({
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portal: { id: portal.id, name: 'Harbor', slug: portal.slug },
      }),
      destination: {
        state: 'verified',
        uri: 'https://example.com',
        retrievedAt: portal.createdAt,
        sourceEpoch: 1,
        profileVersion: 1,
      },
      createdBy: 'manager',
      createdAt: portal.createdAt,
    })
    const execute = vi.fn(async () => ({ rows: [] }))
    await expect(
      assertPersonalSourceFence({ execute } as unknown as Tx, {
        organizationId: portal.organizationId,
        portal,
        initialResponsibleManagerIds: [],
        event: portalCreated({
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          publicationState: 'draft',
          sourceAggregateVersion: portal.updatedAt.toISOString(),
          occurredAt: portal.createdAt,
        }),
        personalSourceFence: {
          portalId: portal.id,
          updatedAt: portal.updatedAt,
          snapshot,
        },
      }),
    ).rejects.toMatchObject({ code: 'source_has_unpublished_changes' })
    expect(execute).toHaveBeenCalledTimes(3)
  })
})
