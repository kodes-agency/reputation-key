// Portal context — soft delete portal use case tests

import { describe, it, expect, vi } from 'vitest'
import { softDeletePortal } from './soft-delete-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PropertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const NEXT_TIME = new Date(FIXED_TIME.getTime() + 1)

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})
const setup = (accessible: ReadonlyArray<PropertyId> | null = null, revokedCount = 1) => {
  const portalRepo = createInMemoryPortalRepo()
  const events = createCapturingEventBus()
  const revokeForPortal = vi.fn(async () => revokedCount)
  const portalTokenRepo = { revokeForPortal } as unknown as PortalTokenRepository
  const deps = {
    portalRepo,
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalTokenRepo,
      events,
    }),
    staffPublicApi: staffApiMock(accessible),
    clock: () => FIXED_TIME,
  }
  const useCase = softDeletePortal(deps)
  return { useCase, portalRepo, events, revokeForPortal }
}

describe('softDeletePortal', () => {
  it('soft-deletes an existing portal', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    const all = portalRepo.all()
    expect(all[0]).toMatchObject({ deletedAt: FIXED_TIME, updatedAt: NEXT_TIME })
  })

  it('emits portal.deleted event', async () => {
    const { useCase, portalRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    const emitted = events.capturedByTag('portal.deleted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      portalId: portal.id,
      sourceAggregateVersion: NEXT_TIME.toISOString(),
      occurredAt: FIXED_TIME,
    })
  })

  it('rejects users who cannot delete', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ portalId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ portalId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('revokes the portal tokens with an audit reason', async () => {
    const { useCase, portalRepo, events, revokeForPortal } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    expect(revokeForPortal).toHaveBeenCalledWith({
      organizationId: ctx.organizationId,
      portalId: portal.id,
      revokedBy: ctx.userId,
      reason: 'portal deleted',
      at: FIXED_TIME,
    })
    expect(events.capturedByTag('portal.token.revoked')).toHaveLength(1)
  })

  it('stays quiet when the portal has no live tokens', async () => {
    // Idempotency: a repeated delete revokes nothing, so no second audit event.
    const { useCase, portalRepo, events, revokeForPortal } = setup(null, 0)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    expect(revokeForPortal).toHaveBeenCalledTimes(1)
    expect(events.capturedByTag('portal.token.revoked')).toHaveLength(0)
    expect(events.capturedByTag('portal.deleted')).toHaveLength(1)
  })
})
