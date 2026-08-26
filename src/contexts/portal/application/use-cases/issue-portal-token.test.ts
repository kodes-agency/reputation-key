import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { issueToken } from '../../domain/portal-token'
import { issuePortalToken } from './issue-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
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
  it('persists a tenant-bound token, emits its event, and returns only public material', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const insert = vi.fn(async () => undefined)
    const events = createCapturingEventBus()
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert,
    } as unknown as PortalTokenRepository
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn(() => material) } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        events,
      }),
      idGen: () => 'portal-token-1',
      clock: () => NOW,
      baseUrl: 'https://example.test',
    })

    await expect(
      useCase({ portalId: portal.id, printBatch: 'batch-1' }, buildTestAuthContext()),
    ).resolves.toEqual({
      rawToken: 'raw-token',
      publicUrl: 'https://example.test/p/raw-token',
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
        printBatch: 'batch-1',
      }),
    )
    expect(events.capturedByTag('portal.token.issued')).toHaveLength(1)
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
    const events = createCapturingEventBus()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn() } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        events,
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
