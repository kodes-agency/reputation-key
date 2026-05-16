// Integration context — list Google connections use case tests

import { describe, it, expect } from 'vitest'
import { listGoogleConnections } from './list-google-connections'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const deps = { connectionRepo }
  const useCase = listGoogleConnections(deps)
  return { useCase, connectionRepo }
}

describe('listGoogleConnections', () => {
  it('returns connections from repo filtered by org', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const conn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      connectedBy: ctx.userId,
    })
    const otherOrgConn = buildTestGoogleConnection({
      organizationId: organizationId('other-org-0000-0000-0000-000000000001'),
      id: 'e0000001-0000-0000-0000-000000000001',
    })
    connectionRepo.seed([conn, otherOrgConn])

    const result = await useCase(ctx)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(conn.id)
  })

  it('returns empty array for org with no connections', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    // Seed a connection in a different org
    const otherOrgConn = buildTestGoogleConnection({
      organizationId: organizationId('other-org-0000-0000-0000-000000000001'),
    })
    connectionRepo.seed([otherOrgConn])

    const result = await useCase(ctx)

    expect(result).toEqual([])
  })

  it('returns all connections visible to admin', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const privateConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      visibility: 'private',
      connectedBy: userId('other-user-0000-0000-0000-000000000001'),
    })
    const orgConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      visibility: 'organization',
      connectedBy: userId('other-user-0000-0000-0000-000000000001'),
      id: 'e0000001-0000-0000-0000-000000000001',
    })
    connectionRepo.seed([privateConn, orgConn])

    const result = await useCase(ctx)

    expect(result).toHaveLength(2)
  })

  it('returns only own private + organization-visible for non-admin role', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const ownPrivateConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      visibility: 'private',
      connectedBy: ctx.userId,
    })
    const someoneElsesPrivateConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      visibility: 'private',
      connectedBy: userId('other-user-0000-0000-0000-000000000001'),
      id: 'e0000001-0000-0000-0000-000000000001',
    })
    const orgVisibleConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      visibility: 'organization',
      connectedBy: userId('other-user-0000-0000-0000-000000000001'),
      id: 'e0000002-0000-0000-0000-000000000001',
    })
    connectionRepo.seed([ownPrivateConn, someoneElsesPrivateConn, orgVisibleConn])

    const result = await useCase(ctx)

    // Admin would see all 3, but PropertyManager only sees own private + org-visible
    expect(result).toHaveLength(2)
    const ids = result.map((c) => c.id)
    expect(ids).toContain(ownPrivateConn.id)
    expect(ids).toContain(orgVisibleConn.id)
    expect(ids).not.toContain(someoneElsesPrivateConn.id)
  })
})
