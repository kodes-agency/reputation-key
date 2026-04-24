// Property context — list properties use case tests

import { describe, it, expect } from 'vitest'
import { listProperties } from './list-properties'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const useCase = listProperties({ propertyRepo })
  return { useCase, propertyRepo }
}

describe('listProperties', () => {
  it('returns properties for the current organization', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext()
    const p1 = buildTestProperty({ id: 'p1', name: 'Hotel A' })
    const p2 = buildTestProperty({ id: 'p2', name: 'Hotel B' })
    propertyRepo.seed([p1, p2])

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(2)
  })

  it('returns empty array when no properties exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    const properties = await useCase(ctx)

    expect(properties).toHaveLength(0)
  })

  it('works for all roles', async () => {
    const { useCase, propertyRepo } = setup()
    const prop = buildTestProperty({})
    propertyRepo.seed([prop])

    for (const role of ['AccountAdmin', 'PropertyManager', 'Staff'] as const) {
      const ctx = buildTestAuthContext({ role })
      const properties = await useCase(ctx)
      expect(properties).toHaveLength(1)
    }
  })
})
