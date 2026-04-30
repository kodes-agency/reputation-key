// Portal context — create link use case tests

import { describe, it, expect } from 'vitest'
import { createLink } from './create-link'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortalLinkCategory } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalLinkRepo,
    events,
    idGen: () => '10000000-0000-0000-0000-000000000001',
    clock: () => FIXED_TIME,
  }
  const useCase = createLink(deps)
  return { useCase, portalLinkRepo, events }
}

describe('createLink', () => {
  it('creates a link in an existing category', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    const link = await useCase(
      {
        categoryId: category.id,
        portalId: 'd0000000-0000-0000-0000-000000000001',
        label: 'Google Review',
        url: 'https://google.com/review',
      },
      ctx,
    )

    expect(link.label).toBe('Google Review')
    expect(portalLinkRepo.allLinks()).toHaveLength(1)
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        {
          categoryId: 'nonexistent',
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: 'Test',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'category_not_found',
    )
  })

  it('rejects empty label', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: '',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_label',
    )
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: 'Test',
          url: 'not-a-url',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_url',
    )
  })

  it('emits portal_link.created event', async () => {
    const { useCase, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await useCase(
      {
        categoryId: category.id,
        portalId: 'd0000000-0000-0000-0000-000000000001',
        label: 'Test',
        url: 'https://example.com',
      },
      ctx,
    )

    const emitted = events.capturedByTag('portal_link.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].linkId).toBe('10000000-0000-0000-0000-000000000001')
  })
})
