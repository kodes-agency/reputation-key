import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { revokePortalTokens } from './revoke-portal-tokens'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi

describe('revokePortalTokens', () => {
  it('trims the audit reason, preserves tenant scope, and emits after a revocation', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const revokeForPortal = vi.fn(async () => 2)
    const events = createCapturingEventBus()
    const ctx = buildTestAuthContext()
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo: { revokeForPortal } as unknown as PortalTokenRepository,
      staffPublicApi,
      events,
      clock: () => NOW,
    })

    await expect(
      useCase({ portalId: portal.id, reason: '  compromised print  ' }, ctx),
    ).resolves.toEqual({ revoked: 2 })
    expect(revokeForPortal).toHaveBeenCalledWith({
      organizationId: ctx.organizationId,
      portalId: portal.id,
      revokedBy: ctx.userId,
      reason: 'compromised print',
      at: NOW,
    })
    expect(events.capturedByTag('portal.token.revoked')).toHaveLength(1)
  })

  it('fails before repository mutation when the revocation reason is blank', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const revokeForPortal = vi.fn()
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo: { revokeForPortal } as unknown as PortalTokenRepository,
      staffPublicApi,
      events: createCapturingEventBus(),
      clock: () => NOW,
    })

    await expect(
      useCase({ portalId: portal.id, reason: '   ' }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    expect(revokeForPortal).not.toHaveBeenCalled()
  })

  it('does not emit a revocation event when no active tokens changed', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const events = createCapturingEventBus()
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo: {
        revokeForPortal: vi.fn(async () => 0),
      } as unknown as PortalTokenRepository,
      staffPublicApi,
      events,
      clock: () => NOW,
    })

    await expect(
      useCase({ portalId: portal.id, reason: 'retired' }, buildTestAuthContext()),
    ).resolves.toEqual({ revoked: 0 })
    expect(events.capturedByTag('portal.token.revoked')).toHaveLength(0)
  })
})
