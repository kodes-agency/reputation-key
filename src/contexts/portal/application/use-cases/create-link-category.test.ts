// Portal context — create link category use case tests

import { describe, it, expect } from 'vitest'
import { createLinkCategory } from './create-link-category'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    portalLinkRepo,
    events,
    idGen: () => 'c0000000-0000-0000-0000-000000000001',
    clock: () => FIXED_TIME,
  }
  const useCase = createLinkCategory(deps)
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('createLinkCategory', () => {
  it('creates a category for an existing portal', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    const category = await useCase({ portalId: portal.id, title: 'Reviews' }, ctx)

    expect(category.title).toBe('Reviews')
    expect(portalLinkRepo.allCategories()).toHaveLength(1)
  })

  it('rejects when portal not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ portalId: 'nonexistent', title: 'Reviews' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects empty title', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, title: '' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_title',
    )
  })

  it('emits portal_link_category.created event', async () => {
    const { useCase, portalRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id, title: 'Reviews' }, ctx)

    const emitted = events.capturedByTag('portal_link_category.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].categoryId).toBe('c0000000-0000-0000-0000-000000000001')
  })
})
