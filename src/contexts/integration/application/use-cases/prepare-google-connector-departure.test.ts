import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { prepareGoogleConnectorDeparture } from './prepare-google-connector-departure'

const ORGANIZATION_ID = organizationId('org-google-connector-departure')
const CONNECTOR_USER_ID = userId('user-google-connector-departure')
const CONNECTION_A = googleConnectionId('80000000-0000-4000-8000-000000000001')
const CONNECTION_B = googleConnectionId('80000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-08-27T00:00:00.000Z')

describe('prepareGoogleConnectorDeparture', () => {
  it('lands the provider fence before cancelling every affected import lifecycle', async () => {
    const order: string[] = []
    const store = {
      fenceForDeparture: vi.fn(async () => {
        order.push('fence')
        return {
          connectionIds: [CONNECTION_A, CONNECTION_B],
          transitionedConnectionIds: [CONNECTION_A, CONNECTION_B],
        }
      }),
    }
    const cancelGoogleImportsForConnection = vi.fn(async (_org, connectionId) => {
      order.push(`cancel:${connectionId}`)
    })

    const result = await prepareGoogleConnectorDeparture({
      store,
      cancelGoogleImportsForConnection,
      clock: () => NOW,
    })({
      organizationId: ORGANIZATION_ID,
      connectorUserId: CONNECTOR_USER_ID,
      cause: 'member_removed',
    })

    expect(order).toEqual(['fence', `cancel:${CONNECTION_A}`, `cancel:${CONNECTION_B}`])
    expect(store.fenceForDeparture).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      connectorUserId: CONNECTOR_USER_ID,
      cause: 'member_removed',
      occurredAt: NOW,
    })
    expect(result.transitionedConnectionIds).toEqual([CONNECTION_A, CONNECTION_B])
  })

  it('is a no-op when the departing member owns no current OAuth grant', async () => {
    const cancelGoogleImportsForConnection = vi.fn(async () => undefined)
    const useCase = prepareGoogleConnectorDeparture({
      store: {
        fenceForDeparture: async () => ({
          connectionIds: [],
          transitionedConnectionIds: [],
        }),
      },
      cancelGoogleImportsForConnection,
      clock: () => NOW,
    })

    await expect(
      useCase({
        organizationId: ORGANIZATION_ID,
        connectorUserId: CONNECTOR_USER_ID,
        cause: 'account_admin_role_lost',
      }),
    ).resolves.toEqual({ connectionIds: [], transitionedConnectionIds: [] })
    expect(cancelGoogleImportsForConnection).not.toHaveBeenCalled()
  })

  it('keeps the landed fence when cancellation fails so a retry remains safe', async () => {
    const store = {
      fenceForDeparture: vi.fn(async () => ({
        connectionIds: [CONNECTION_A],
        transitionedConnectionIds: [CONNECTION_A],
      })),
    }
    const useCase = prepareGoogleConnectorDeparture({
      store,
      cancelGoogleImportsForConnection: async () => {
        throw new Error('queue unavailable')
      },
      clock: () => NOW,
    })

    await expect(
      useCase({
        organizationId: ORGANIZATION_ID,
        connectorUserId: CONNECTOR_USER_ID,
        cause: 'member_removed',
      }),
    ).rejects.toThrow('queue unavailable')
    expect(store.fenceForDeparture).toHaveBeenCalledOnce()
  })
})
