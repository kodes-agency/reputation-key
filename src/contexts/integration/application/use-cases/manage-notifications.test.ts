import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import {
  manageNotifications,
  type NotificationProviderAuthorizationResult,
} from './manage-notifications'
import { createInMemoryMyBusinessNotificationsPort } from '#/shared/testing/in-memory-mybusiness-notifications-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleReviewSyncProviderCallAuthorization } from '../google-provider-contract'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const CONN = googleConnectionId('e0000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const PROPERTY_2 = propertyId('10000000-0000-4000-8000-000000000002')
const ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].expectedSegments.accountId
const ACCOUNT_ID_2 = 'repkey-synthetic-do-not-use-account-0002'

const authorization: GoogleReviewSyncProviderCallAuthorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONN,
  initiatorUserId: null,
  approvalBindingId: 'approval-binding-v1',
  expectedCredentialGeneration: 7,
  authorizationVector: Object.freeze({
    principalKind: 'system',
    propertySourceEpoch: 3,
    credentialGeneration: 7,
  }),
})
const authorization2: GoogleReviewSyncProviderCallAuthorization = Object.freeze({
  ...authorization,
  propertyId: PROPERTY_2,
  approvalBindingId: 'approval-binding-v2',
  authorizationVector: Object.freeze({
    ...authorization.authorizationVector,
    propertySourceEpoch: 4,
  }),
})

const setup = (input?: {
  pubsubTopic?: string
  authorizationResult?: NotificationProviderAuthorizationResult
}) => {
  const notifications = createInMemoryMyBusinessNotificationsPort()
  const authorizeProviderCall = vi.fn(async () =>
    input?.authorizationResult
      ? input.authorizationResult
      : ({
          ok: true,
          targets: [
            {
              accessToken: 'access-token',
              authorization,
              gbpAccountId: ACCOUNT_ID,
            },
          ],
        } as const),
  )
  const warn = vi.fn()
  const logger = { ...createMockLogger(), warn }
  const useCase = manageNotifications({
    authorizeProviderCall,
    notifications,
    pubsubTopic: input?.pubsubTopic ?? 'projects/test/topics/gbp-reviews',
    notificationTypes: ['NEW_REVIEW'],
    logger,
  })

  return {
    useCase,
    notifications,
    authorizeProviderCall,
    warn,
  }
}

describe('manageNotifications', () => {
  describe('subscribe', () => {
    it('uses the exact governed Property binding target for the notification write', async () => {
      const { useCase, notifications, authorizeProviderCall } = setup()

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('subscribed')

      expect(authorizeProviderCall).toHaveBeenCalledWith(ORG, CONN)
      expect(notifications.subscribeCalls).toEqual([
        {
          accessToken: 'access-token',
          authorization,
          gbpAccountId: ACCOUNT_ID,
          pubsubTopic: 'projects/test/topics/gbp-reviews',
          notificationTypes: ['NEW_REVIEW'],
        },
      ])
    })

    it('subscribes every distinct bound account with its own Property authorization', async () => {
      const { useCase, notifications } = setup({
        authorizationResult: {
          ok: true,
          targets: [
            {
              accessToken: 'access-token',
              authorization,
              gbpAccountId: ACCOUNT_ID,
            },
            {
              accessToken: 'access-token-2',
              authorization: authorization2,
              gbpAccountId: ACCOUNT_ID_2,
            },
          ],
        },
      })

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('subscribed')

      expect(notifications.subscribeCalls).toEqual([
        expect.objectContaining({
          authorization,
          gbpAccountId: ACCOUNT_ID,
        }),
        expect.objectContaining({
          authorization: authorization2,
          gbpAccountId: ACCOUNT_ID_2,
        }),
      ])
    })

    it('does not repeat an account shared by multiple bound Properties', async () => {
      const { useCase, notifications } = setup({
        authorizationResult: {
          ok: true,
          targets: [
            {
              accessToken: 'access-token',
              authorization,
              gbpAccountId: ACCOUNT_ID,
            },
            {
              accessToken: 'access-token-2',
              authorization: authorization2,
              gbpAccountId: ACCOUNT_ID,
            },
          ],
        },
      })

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('subscribed')
      expect(notifications.subscribeCalls).toHaveLength(1)
      expect(notifications.subscribeCalls[0]?.authorization).toBe(authorization)
    })

    it('is idempotent — a second subscribe re-asserts the same desired state', async () => {
      const { useCase, notifications } = setup()

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('subscribed')
      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('subscribed')

      expect(notifications.subscribeCalls).toHaveLength(2)
    })

    it('warns instead of authorizing when the Pub/Sub topic is unset', async () => {
      const { useCase, notifications, authorizeProviderCall, warn } = setup({
        pubsubTopic: '',
      })

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('topic_unset')

      expect(authorizeProviderCall).not.toHaveBeenCalled()
      expect(notifications.subscribeCalls).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(
        { envVar: 'GBP_PUBSUB_TOPIC' },
        expect.stringContaining('GBP push notifications disabled'),
      )
    })

    it.each([
      'connection_missing',
      'connection_inactive',
      'token_unavailable',
      'authorization_unavailable',
    ] as const)('fails closed when authorization reports %s', async (code) => {
      const { useCase, notifications } = setup({
        authorizationResult: { ok: false, code },
      })

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe(code)
      expect(notifications.subscribeCalls).toHaveLength(0)
    })

    it('reports account_unresolved when no active bound account can be authorized', async () => {
      const { useCase, notifications } = setup({
        authorizationResult: { ok: true, targets: [] },
      })

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('account_unresolved')
      expect(notifications.subscribeCalls).toHaveLength(0)
    })

    it('reports provider_failed when the desired-state write cannot be confirmed', async () => {
      const { useCase, notifications } = setup()
      notifications.setError('subscribe', new Error('ambiguous'))

      await expect(useCase.subscribe(ORG, CONN)).resolves.toBe('provider_failed')
      expect(notifications.subscribeCalls).toHaveLength(0)
    })
  })

  describe('unsubscribe', () => {
    it('uses the exact bound account and authorization to unsubscribe', async () => {
      const { useCase, notifications } = setup()

      await useCase.unsubscribe(ORG, CONN)

      expect(notifications.unsubscribeCalls).toEqual([
        {
          accessToken: 'access-token',
          authorization,
          gbpAccountId: ACCOUNT_ID,
        },
      ])
    })

    it('unsubscribes every distinct bound account before credential revocation', async () => {
      const { useCase, notifications } = setup({
        authorizationResult: {
          ok: true,
          targets: [
            {
              accessToken: 'access-token',
              authorization,
              gbpAccountId: ACCOUNT_ID,
            },
            {
              accessToken: 'access-token-2',
              authorization: authorization2,
              gbpAccountId: ACCOUNT_ID_2,
            },
          ],
        },
      })

      await useCase.unsubscribe(ORG, CONN)

      expect(notifications.unsubscribeCalls.map((call) => call.gbpAccountId)).toEqual([
        ACCOUNT_ID,
        ACCOUNT_ID_2,
      ])
    })

    it('swallows provider failures because disconnect remains best-effort', async () => {
      const { useCase, notifications } = setup()
      notifications.setError('unsubscribe', new Error('boom'))

      await expect(useCase.unsubscribe(ORG, CONN)).resolves.toBeUndefined()
      expect(notifications.unsubscribeCalls).toHaveLength(0)
    })
  })
})
