import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { revokePortalTokens } from './revoke-portal-tokens'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi

describe('revokePortalTokens', () => {
  it('trims the audit reason, preserves tenant scope, and records a revocation fact', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const revokeForPortal = vi.fn(async () => 2)
    const outbox = createRecordedOutbox()
    const ctx = buildTestAuthContext()
    const portalTokenRepo = { revokeForPortal } as unknown as PortalTokenRepository
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
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
    expect(outbox.byTag('portal.token.revoked')).toHaveLength(1)
  })

  it('fails before repository mutation when the revocation reason is blank', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const revokeForPortal = vi.fn()
    const portalTokenRepo = { revokeForPortal } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      clock: () => NOW,
    })

    await expect(
      useCase({ portalId: portal.id, reason: '   ' }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    expect(revokeForPortal).not.toHaveBeenCalled()
  })

  it('does not record a revocation fact when no active tokens changed', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const outbox = createRecordedOutbox()
    const portalTokenRepo = {
      revokeForPortal: vi.fn(async () => 0),
    } as unknown as PortalTokenRepository
    const useCase = revokePortalTokens({
      portalRepo,
      portalTokenRepo,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      clock: () => NOW,
    })

    await expect(
      useCase({ portalId: portal.id, reason: 'retired' }, buildTestAuthContext()),
    ).resolves.toEqual({ revoked: 0 })
    expect(outbox.byTag('portal.token.revoked')).toHaveLength(0)
  })
})
