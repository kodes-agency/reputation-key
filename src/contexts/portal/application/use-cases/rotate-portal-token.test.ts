import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { issueToken } from '../../domain/portal-token'
import { rotatePortalToken } from './rotate-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi
const material = {
  rawToken: 'new-raw-token',
  tokenIdentifier: 'new-token-id',
  tokenHash: 'new-token-hash',
  tokenKeyVersion: 2,
}

describe('rotatePortalToken', () => {
  it('atomically saves QR and NFC replacements with the 30-day planned window', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 4,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const saveRotation = vi.fn(async () => undefined)
    const events = createCapturingEventBus()
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation,
    } as unknown as PortalTokenRepository
    const ids = [
      '6a200000-0000-4000-8000-000000000001',
      '6a200000-0000-4000-8000-000000000002',
      '6a200000-0000-4000-8000-000000000003',
    ]
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn(() => material) } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        events,
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      baseUrl: 'https://example.test',
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).resolves.toEqual({
      rawToken: 'new-raw-token',
      publicUrl:
        'https://example.test/p/new-raw-token?accessArtifact=6a200000-0000-4000-8000-000000000002',
      publicUrls: {
        qr: 'https://example.test/p/new-raw-token?accessArtifact=6a200000-0000-4000-8000-000000000002',
        nfc: 'https://example.test/p/new-raw-token?accessArtifact=6a200000-0000-4000-8000-000000000003',
      },
      tokenIdentifier: 'new-token-id',
      version: 5,
      gracePeriodEnds: new Date('2026-09-15T12:00:00.000Z'),
    })
    expect(saveRotation).toHaveBeenCalledWith({
      oldToken: expect.objectContaining({
        tokenIdentifier: 'old-token-id',
        status: 'rotating',
      }),
      newToken: expect.objectContaining({
        tokenIdentifier: 'new-token-id',
        version: 5,
        status: 'active',
      }),
    })
    expect(events.capturedByTag('portal.token.rotated')).toHaveLength(1)
    expect(events.capturedByTag('portal.access_artifact.published')).toEqual([
      expect.objectContaining({
        accessArtifactId: '6a200000-0000-4000-8000-000000000002',
        portalId: portal.id,
        channel: 'qr',
        occurredAt: NOW,
      }),
      expect.objectContaining({
        accessArtifactId: '6a200000-0000-4000-8000-000000000003',
        portalId: portal.id,
        channel: 'nfc',
        occurredAt: NOW,
      }),
    ])
  })

  it.each([0, 1.5, 91])(
    'rejects an invalid planned replacement window before reading the active token: %s days',
    async (gracePeriodDays) => {
      const portalRepo = createInMemoryPortalRepo()
      const portal = buildTestPortal()
      portalRepo.seed([portal])
      const findLatestForPortal = vi.fn()
      const portalTokenRepo = {
        findLatestForPortal,
      } as unknown as PortalTokenRepository
      const events = createCapturingEventBus()
      const useCase = rotatePortalToken({
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
        defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
      })

      await expect(
        useCase(
          { portalId: portal.id, replacementKind: 'planned', gracePeriodDays },
          buildTestAuthContext(),
        ),
      ).rejects.toMatchObject({ code: 'token_unavailable' })
      expect(findLatestForPortal).not.toHaveBeenCalled()
    },
  )

  it('supports an immediate security replacement with no printed-code grace', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 1,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const ids = [
      '6a200000-0000-4000-8000-000000000011',
      '6a200000-0000-4000-8000-000000000012',
      '6a200000-0000-4000-8000-000000000013',
    ]
    const events = createCapturingEventBus()
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: { issue: vi.fn(() => material) } as unknown as PortalTokenCodec,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        events,
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      baseUrl: 'https://example.test',
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    await expect(
      useCase(
        { portalId: portal.id, replacementKind: 'security' },
        buildTestAuthContext(),
      ),
    ).resolves.toMatchObject({ gracePeriodEnds: NOW })
  })

  it('requires an active current token', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
    } as unknown as PortalTokenRepository
    const events = createCapturingEventBus()
    const useCase = rotatePortalToken({
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
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
  })
})
