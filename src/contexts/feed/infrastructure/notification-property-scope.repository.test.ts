import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createNotificationPropertyScopeResolver } from './repositories/notification-property-scope.repository'

const ORG_ID = 'organization-1'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'

describe('createNotificationPropertyScopeResolver', () => {
  it('returns the active property timezone within the requested tenant scope', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ timezone: 'Europe/Sofia' }] })
    const resolveScope = createNotificationPropertyScopeResolver({
      query,
    } as unknown as Pool)

    await expect(resolveScope(ORG_ID, PROPERTY_ID)).resolves.toEqual({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      timezone: 'Europe/Sofia',
    })
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /organization_id = \$1[\s\S]*id = \$2::uuid[\s\S]*deleted_at IS NULL[\s\S]*lifecycle_state = 'active'/,
      ),
      [ORG_ID, PROPERTY_ID],
    )
  })

  it('returns null rather than leaking a property outside the active scope', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const resolveScope = createNotificationPropertyScopeResolver({
      query,
    } as unknown as Pool)

    await expect(resolveScope(ORG_ID, PROPERTY_ID)).resolves.toBeNull()
  })
})
