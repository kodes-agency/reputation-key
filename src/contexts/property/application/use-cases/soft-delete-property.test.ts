// LIF-01 — legacy destructive Property deletion containment

import { describe, it, expect } from 'vitest'
import { deleteProperty } from './soft-delete-property'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'

describe('deleteProperty', () => {
  it('has no destructive dependencies and refuses even an AccountAdmin', async () => {
    const useCase = deleteProperty()

    await expect(
      useCase(
        { propertyId: 'property-1' },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isPropertyError(error) &&
        error.code === 'forbidden' &&
        error.message === 'Permanent property removal is not available in this beta.',
    )
  })
})
