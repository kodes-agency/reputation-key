// Portal context — soft delete portal use case tests

import { describe, it, expect } from 'vitest'
import { softDeletePortal } from './soft-delete-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const events = createCapturingEventBus()
  const deps = { portalRepo, events, clock: () => FIXED_TIME }
  const useCase = softDeletePortal(deps)
  return { useCase, portalRepo, events }
}

describe('softDeletePortal', () => {
  it('soft-deletes an existing portal', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    const all = portalRepo.all()
    expect(all[0].deletedAt).not.toBeNull()
  })

  it('emits portal.deleted event', async () => {
    const { useCase, portalRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id }, ctx)

    const emitted = events.capturedByTag('portal.deleted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].portalId).toBe(portal.id)
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
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })
})
