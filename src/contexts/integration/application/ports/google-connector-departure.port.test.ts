// ARC-03-T9 contract test — Identity/Integration seam.
//
// Identity decides that a member is departing; Integration owns what that means
// for a Google connection. The contract keeps the decision one-way: Identity
// never learns which connections exist, and the returned transitioned set is
// always a SUBSET of the fenced set, so a caller cannot infer a transition that
// did not happen.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type { GoogleConnectorDepartureStore } from './google-connector-departure.port'

const AT = new Date('2026-04-01T00:00:00.000Z')

const inMemoryDepartureStore = (
  connections: ReadonlyArray<
    Readonly<{ id: string; grantUserId: string; fenced: boolean }>
  >,
): GoogleConnectorDepartureStore => {
  const state = connections.map((connection) => ({ ...connection }))
  return Object.freeze({
    fenceForDeparture: async (input) => {
      const owned = state.filter(
        (connection) => connection.grantUserId === input.connectorUserId,
      )
      const transitioned = owned.filter((connection) => !connection.fenced)
      for (const connection of transitioned) connection.fenced = true
      return {
        connectionIds: owned.map((connection) => googleConnectionId(connection.id)),
        transitionedConnectionIds: transitioned.map((connection) =>
          googleConnectionId(connection.id),
        ),
      }
    },
  })
}

const departure = {
  organizationId: organizationId('org-1'),
  connectorUserId: userId('user-1'),
  cause: 'member_removed' as const,
  occurredAt: AT,
}

describe('GoogleConnectorDepartureStore contract', () => {
  it('returns only connections whose current grant belongs to the departing user', async () => {
    const store = inMemoryDepartureStore([
      { id: 'conn-a', grantUserId: 'user-1', fenced: false },
      { id: 'conn-b', grantUserId: 'user-2', fenced: false },
    ])

    const result = await store.fenceForDeparture(departure)

    expect(result.connectionIds).toEqual(['conn-a'])
  })

  it('reports the transitioned set as a subset of the fenced set', async () => {
    const store = inMemoryDepartureStore([
      { id: 'conn-a', grantUserId: 'user-1', fenced: false },
      { id: 'conn-b', grantUserId: 'user-1', fenced: true },
    ])

    const result = await store.fenceForDeparture(departure)

    expect(result.connectionIds).toEqual(['conn-a', 'conn-b'])
    expect(result.transitionedConnectionIds).toEqual(['conn-a'])
    for (const id of result.transitionedConnectionIds) {
      expect(result.connectionIds).toContain(id)
    }
  })

  it('is idempotent — a second departure transitions nothing new', async () => {
    const store = inMemoryDepartureStore([
      { id: 'conn-a', grantUserId: 'user-1', fenced: false },
    ])

    await store.fenceForDeparture(departure)
    const second = await store.fenceForDeparture(departure)

    expect(second.connectionIds).toEqual(['conn-a'])
    expect(second.transitionedConnectionIds).toEqual([])
  })

  it('is consumed through the seam, never through a context-private hatch', () => {
    const consumer = readFileSync(
      resolve('src/contexts/identity/application/use-cases/remove-member.ts'),
      'utf8',
    )

    expect(consumer).not.toContain('.internal.')
    // Identity states the intent; it never names a Google connection.
    expect(consumer).toContain('prepareGoogleConnectorDeparture')
    expect(consumer).not.toContain('connectionId')
  })
})
