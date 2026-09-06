import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { issueToken } from '../../domain/portal-token'
import { issuePortalToken } from './issue-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const CURRENT_REVISION = new Date('2026-08-20T12:00:00.000Z')
const NEXT_REVISION = new Date(CURRENT_REVISION.getTime() + 1)
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi
const material = {
  rawToken: 'raw-token',
  tokenIdentifier: 'token-id',
  tokenHash: 'token-hash',
  tokenKeyVersion: 2,
}

describe('issuePortalToken', () => {
  it('persists a tenant-bound token and outbox facts, then returns only public material', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ updatedAt: CURRENT_REVISION })
    portalRepo.seed([portal])
    const insert = vi.fn(async () => undefined)
    const outbox = createRecordedOutbox()
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert,
    } as unknown as PortalTokenRepository
    const ids = [
      '6a100000-0000-4000-8000-000000000001',
      '6a100000-0000-4000-8000-000000000002',
      '6a100000-0000-4000-8000-000000000003',
    ]
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn(() => material) } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      baseUrl: 'https://example.test',
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).resolves.toEqual({
      rawToken: 'raw-token',
      publicUrl:
        'https://example.test/p/raw-token?accessArtifact=6a100000-0000-4000-8000-000000000002',
      publicUrls: {
        qr: 'https://example.test/p/raw-token?accessArtifact=6a100000-0000-4000-8000-000000000002',
        nfc: 'https://example.test/p/raw-token?accessArtifact=6a100000-0000-4000-8000-000000000003',
      },
      tokenIdentifier: 'token-id',
      version: 1,
      issuedAt: NOW,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        tokenHash: 'token-hash',
        printBatch: null,
      }),
    )
    expect(outbox.byTag('portal.token.issued')).toEqual([
      expect.objectContaining({
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
    ])
    expect(outbox.byTag('portal.access_artifact.published')).toEqual([
      expect.objectContaining({
        accessArtifactId: '6a100000-0000-4000-8000-000000000002',
        portalId: portal.id,
        channel: 'qr',
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
      expect.objectContaining({
        accessArtifactId: '6a100000-0000-4000-8000-000000000003',
        portalId: portal.id,
        channel: 'nfc',
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
    ])
    await expect(
      portalRepo.findById(portal.organizationId, portal.id),
    ).resolves.toMatchObject({ updatedAt: NEXT_REVISION })
  })

  it('requires rotation while a non-revoked token exists', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const active = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-id',
      tokenHash: 'old-hash',
      tokenKeyVersion: 1,
      version: 1,
      now: NOW,
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => active),
    } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn() } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      idGen: () => 'portal-token-2',
      clock: () => NOW,
      baseUrl: 'https://example.test',
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
  })
})
