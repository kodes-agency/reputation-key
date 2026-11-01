import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { assertPersonalGroupTarget } from './personal-portal-group-guard'

describe('personal Group membership target guard', () => {
  it.each([true, false])(
    'serializes and refuses an existing rating target: %s',
    async (conflict) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: conflict ? [{ id: 'assignment' }] : [] })
      const result = assertPersonalGroupTarget({ execute } as unknown as Tx, {
        organizationId: 'org',
        propertyId: 'property',
        portalId: 'portal',
        portalGroupId: 'group',
        at: new Date(),
      })
      if (conflict)
        await expect(result).rejects.toMatchObject({
          code: 'personal_portal_goal_locked',
        })
      else await expect(result).resolves.toBeUndefined()
      expect(execute).toHaveBeenCalledTimes(2)
    },
  )
})
