// Guest context — resolvePortalContext use case tests
import { describe, it, expect } from 'vitest'
import { resolvePortalContext } from './resolve-portal-context'
import { isGuestError } from '../../domain/errors'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

const ORG = organizationId('org-test')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')

describe('resolvePortalContext (use case)', () => {
  it('returns portal context when portal found', async () => {
    const useCase = resolvePortalContext({
      portalContextResolver: {
        resolve: async () => ({ organizationId: ORG, propertyId: PROP }),
      },
    })
    const pid = portalId('b0000000-0000-4000-8000-000000000001')
    const result = await useCase({ portalId: pid })
    expect(result.organizationId).toBe(ORG)
    expect(result.propertyId).toBe(PROP)
  })

  it('throws portal_not_found when portal not found', async () => {
    const useCase = resolvePortalContext({
      portalContextResolver: {
        resolve: async () => null,
      },
    })
    const pid = portalId('b0000000-0000-4000-8000-000000000001')
    try {
      await useCase({ portalId: pid })
      expect.fail('Expected error')
    } catch (e) {
      expect(isGuestError(e)).toBe(true)
      if (isGuestError(e)) {
        expect(e.code).toBe('portal_not_found')
      }
    }
  })
})
