// Integration context — manage-notifications use case tests (Pub/Sub lifecycle step 3).

import { describe, it, expect, vi } from 'vitest'
import { manageNotifications } from './manage-notifications'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { createInMemoryMyBusinessNotificationsPort } from '#/shared/testing/in-memory-mybusiness-notifications-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../../domain/types'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const CONN = 'e0000000-0000-0000-0000-000000000001'

const setup = (overrides?: {
  connection?: Partial<GoogleConnection>
  pubsubTopic?: string
}) => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const encryption = createInMemoryTokenEncryption()
  const gbpApi = createInMemoryGbpApiPort()
  const notifications = createInMemoryMyBusinessNotificationsPort()
  const refreshGoogleToken = vi.fn(
    async (_org: typeof ORG, _id: string): Promise<GoogleConnection> =>
      buildTestGoogleConnection({
        id: CONN,
        organizationId: ORG,
        encryptedAccessToken: 'enc:new-access-token',
        tokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
        status: 'active',
      }),
  )

  gbpApi.setAccounts([
    { name: 'accounts/1234567890', accountName: 'Biz', type: 'BUSINESS', role: 'OWNER' },
  ])

  const connection = buildTestGoogleConnection({
    id: CONN,
    organizationId: ORG,
    encryptedAccessToken: 'enc:access-token',
    tokenExpiresAt: new Date('2026-12-31T23:59:59Z'),
    status: 'active',
    ...overrides?.connection,
  })
  connectionRepo.seed([connection])

  const useCase = manageNotifications({
    connectionRepo,
    gbpApi,
    encryption,
    refreshGoogleToken,
    notifications,
    pubsubTopic: overrides?.pubsubTopic ?? 'projects/test/topics/gbp-reviews',
    notificationTypes: ['NEW_REVIEW'],
    clock: () => FIXED_TIME,
    logger: createMockLogger(),
  })

  return {
    useCase,
    connectionRepo,
    gbpApi,
    notifications,
    refreshGoogleToken,
    connection,
  }
}

describe('manageNotifications', () => {
  describe('subscribe', () => {
    it('resolves the GBP account via listAccounts and subscribes', async () => {
      const { useCase, notifications } = setup()

      await useCase.subscribe(ORG, CONN)

      expect(notifications.subscribeCalls).toHaveLength(1)
      expect(notifications.subscribeCalls[0]).toMatchObject({
        accessToken: 'access-token',
        gbpAccountId: '1234567890',
        pubsubTopic: 'projects/test/topics/gbp-reviews',
        notificationTypes: ['NEW_REVIEW'],
      })
    })

    it('refreshes the access token before subscribing when it is expired', async () => {
      const { useCase, notifications, refreshGoogleToken } = setup({
        connection: { tokenExpiresAt: new Date('2020-01-01T00:00:00Z') },
      })

      await useCase.subscribe(ORG, CONN)

      expect(refreshGoogleToken).toHaveBeenCalledWith(ORG, CONN)
      expect(notifications.subscribeCalls[0]?.accessToken).toBe('new-access-token')
    })

    it('is a no-op when pubsubTopic is empty (notifications disabled)', async () => {
      const { useCase, notifications } = setup({ pubsubTopic: '' })

      await useCase.subscribe(ORG, CONN)

      expect(notifications.subscribeCalls).toHaveLength(0)
    })

    it('is a no-op when the connection is not active', async () => {
      const { useCase, notifications } = setup({
        connection: { status: 'disconnected' },
      })

      await useCase.subscribe(ORG, CONN)

      expect(notifications.subscribeCalls).toHaveLength(0)
    })

    it('is a no-op when the connection cannot be found', async () => {
      const { useCase, notifications } = setup()
      await useCase.subscribe(ORG, 'unknown-connection-id')

      expect(notifications.subscribeCalls).toHaveLength(0)
    })

    it('swallows failures (best-effort) and never throws', async () => {
      const { useCase, notifications, gbpApi } = setup()
      gbpApi.setError('listAccounts', new Error('boom'))

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBeUndefined()
      expect(notifications.subscribeCalls).toHaveLength(0)
    })
  })

  describe('unsubscribe', () => {
    it('resolves the GBP account and unsubscribes', async () => {
      const { useCase, notifications } = setup()

      await useCase.unsubscribe(ORG, CONN)

      expect(notifications.unsubscribeCalls).toHaveLength(1)
      expect(notifications.unsubscribeCalls[0]).toMatchObject({
        accessToken: 'access-token',
        gbpAccountId: '1234567890',
      })
    })

    it('swallows failures (best-effort) and never throws', async () => {
      const { useCase, notifications } = setup()
      notifications.setError('unsubscribe', new Error('boom'))

      await expect(useCase.unsubscribe(ORG, CONN)).resolves.toBeUndefined()
      expect(notifications.unsubscribeCalls).toHaveLength(0)
    })
  })
})
