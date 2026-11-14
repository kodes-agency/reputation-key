// Integration context — list Google connections use case against real PostgreSQL

import { describe, it, expect } from 'vitest'
import { listGoogleConnections } from './list-google-connections'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createGoogleConnectionTestStore } from '#/contexts/integration/connections/google-connection.test-fixtures'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'

const ORG = organizationId('org-list-gc-aaaaaaa')
const OTHER_ORG = organizationId('org-list-gc-bbbbbbb')
const NOW = new Date('2026-04-10T12:00:00Z')

setupIntegrationDb({ orgA: ORG, orgB: OTHER_ORG, tables: ['google_connections'] })

const adminContext = () =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: ORG })

const setup = () => {
  const connectionRepo = createGoogleConnectionTestStore(getDb(), () => NOW, [
    ORG,
    OTHER_ORG,
  ])
  const deps = { connectionRepo }
  const useCase = listGoogleConnections(deps)
  return { useCase, connectionRepo }
}

describe('listGoogleConnections', () => {
  it('returns connections from repo filtered by org', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = adminContext()
    const conn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      connectedBy: ctx.userId,
    })
    const otherOrgConn = buildTestGoogleConnection({
      organizationId: OTHER_ORG,
      id: 'e0000001-0000-0000-0000-000000000001',
      googleSubject: 'google-subject-other-org',
    })
    await connectionRepo.seed([conn, otherOrgConn])

    const result = await useCase(ctx)

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(conn.id)
  })

  it('returns empty array for org with no connections', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = adminContext()
    // Seed a connection in a different org
    const otherOrgConn = buildTestGoogleConnection({
      organizationId: OTHER_ORG,
    })
    await connectionRepo.seed([otherOrgConn])

    const result = await useCase(ctx)

    expect(result).toEqual([])
  })

  it('returns every connection of the Organization to an admin, whoever connected it', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = adminContext()
    const ownConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      connectedBy: ctx.userId,
    })
    const colleagueConn = buildTestGoogleConnection({
      organizationId: ctx.organizationId,
      connectedBy: userId('other-user-0000-0000-0000-000000000001'),
      id: 'e0000001-0000-0000-0000-000000000001',
      googleSubject: 'google-subject-colleague',
    })
    await connectionRepo.seed([ownConn, colleagueConn])

    const result = await useCase(ctx)

    expect(result).toHaveLength(2)
  })

  it('reserves Organization connection management for AccountAdmin', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager', organizationId: ORG })
    await connectionRepo.seed([
      buildTestGoogleConnection({
        organizationId: ctx.organizationId,
        connectedBy: ctx.userId,
      }),
    ])

    await expect(useCase(ctx)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
