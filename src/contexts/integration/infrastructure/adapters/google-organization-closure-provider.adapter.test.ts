// The closure provider over the real notifications use case: what Organization
// closing is told about a connection's Google notification subscriptions.
//
// `stopped` is what the closing evidence counts, and closing redacts the
// refresh token in the same transaction, so nothing can stop an account's
// setting afterwards. It may be answered only when every bound account was
// cleared.

import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { createInMemoryMyBusinessNotificationsPort } from '#/shared/testing/in-memory-mybusiness-notifications-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { GoogleReviewSyncProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleClosureConnectionTarget } from '../../application/ports/google-organization-closure.port'
import {
  manageNotifications,
  type NotificationProviderAuthorizationResult,
} from '../../application/use-cases/manage-notifications'
import { createGbpApiError } from '../../domain/gbp-api-error'
import { createGoogleOrganizationClosureProvider } from './google-organization-closure-provider.adapter'

const ORG = organizationId('org-closing-notifications')
const CONN = googleConnectionId('e1000000-0000-4000-8000-000000000001')
const ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].expectedSegments.accountId
const ACCOUNT_ID_2 = 'repkey-synthetic-do-not-use-account-0002'

const authorization: GoogleReviewSyncProviderCallAuthorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG,
  propertyId: propertyId('11000000-0000-4000-8000-000000000001'),
  connectionId: CONN,
  initiatorUserId: null,
  expectedCredentialGeneration: 7,
  authorizationVector: Object.freeze({
    principalKind: 'system',
    propertySourceEpoch: 3,
    credentialGeneration: 7,
  }),
})

const account = (gbpAccountId: string) => ({
  accessToken: `access-token-${gbpAccountId}`,
  authorization,
  gbpAccountId,
})

const ONE_ACCOUNT: NotificationProviderAuthorizationResult = {
  ok: true,
  targets: [account(ACCOUNT_ID)],
}
const TWO_ACCOUNTS: NotificationProviderAuthorizationResult = {
  ok: true,
  targets: [account(ACCOUNT_ID), account(ACCOUNT_ID_2)],
}

const target = (
  overrides: Partial<GoogleClosureConnectionTarget> = {},
): GoogleClosureConnectionTarget => ({
  organizationId: ORG,
  connectionId: CONN,
  encryptedRefreshToken: 'cipher',
  occurredAt: new Date('2026-10-13T08:00:00.000Z'),
  ...overrides,
})

function setup(
  authorize: () => Promise<NotificationProviderAuthorizationResult> = async () =>
    ONE_ACCOUNT,
) {
  const notifications = createInMemoryMyBusinessNotificationsPort()
  const authorizeProviderCall = vi.fn(authorize)
  const provider = createGoogleOrganizationClosureProvider({
    oauth: {
      revokeToken: async () => undefined,
      revokeTokenWithOutcome: async () => 'confirmed_revoked',
    },
    encryption: { decrypt: (value) => value },
    unsubscribeFromNotifications: manageNotifications({
      authorizeProviderCall,
      notifications,
      pubsubTopic: 'projects/test/topics/gbp-reviews',
      notificationTypes: ['NEW_REVIEW'],
      logger: createMockLogger(),
    }).unsubscribe,
  })
  return { provider, notifications, authorizeProviderCall }
}

describe('Google Organization closure provider — notification subscriptions', () => {
  it('answers stopped when every bound account was cleared', async () => {
    const { provider, notifications } = setup(async () => TWO_ACCOUNTS)

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'stopped',
    )
    expect(notifications.unsubscribeCalls.map((call) => call.gbpAccountId)).toEqual([
      ACCOUNT_ID,
      ACCOUNT_ID_2,
    ])
  })

  it.each([
    'connection_missing',
    'connection_inactive',
    'token_unavailable',
    'authorization_unavailable',
  ] as const)('answers not_sent when the unsubscribe is refused (%s)', async (code) => {
    const { provider, notifications } = setup(async () => ({ ok: false, code }))

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'not_sent',
    )
    expect(notifications.unsubscribeCalls).toEqual([])
  })

  it('answers not_sent when the authorization itself cannot be decided', async () => {
    const { provider, notifications } = setup(async () => {
      throw new Error('coordination store unreachable')
    })

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'not_sent',
    )
    expect(notifications.unsubscribeCalls).toEqual([])
  })

  it('answers not_sent when no Property of the connection can be targeted', async () => {
    // Every Property already archived: no active binding, so no account RepKey
    // may touch, while Google may still be publishing for it.
    const { provider, notifications } = setup(async () => ({ ok: true, targets: [] }))

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'not_sent',
    )
    expect(notifications.unsubscribeCalls).toEqual([])
  })

  it('answers ambiguous when Google refuses the write', async () => {
    const { provider, notifications } = setup()
    notifications.setError(
      'unsubscribe',
      createGbpApiError('unsubscribe', 'upstream_error', { providerStatus: 503 }),
    )

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'ambiguous',
    )
  })

  it('answers ambiguous when only some of the bound accounts were cleared', async () => {
    const { provider, notifications } = setup(async () => TWO_ACCOUNTS)
    notifications.setAccountError(
      ACCOUNT_ID_2,
      createGbpApiError('unsubscribe', 'upstream_error', { providerStatus: 500 }),
    )

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'ambiguous',
    )
    expect(notifications.unsubscribeCalls.map((call) => call.gbpAccountId)).toEqual([
      ACCOUNT_ID,
    ])
  })

  it('answers ambiguous when a bound account could not be authorized', async () => {
    const { provider } = setup(async () => ({
      ...ONE_ACCOUNT,
      unauthorizedAccounts: 1,
    }))

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'ambiguous',
    )
  })

  it('answers already_stopped, and asks nothing, for a redacted credential', async () => {
    const { provider, authorizeProviderCall } = setup()

    await expect(
      provider.stopNotificationSubscriptions(
        target({ encryptedRefreshToken: 'redacted' }),
      ),
    ).resolves.toBe('already_stopped')
    expect(authorizeProviderCall).not.toHaveBeenCalled()
  })

  it('answers ambiguous, and does not throw, when the unsubscribe itself throws', async () => {
    const provider = createGoogleOrganizationClosureProvider({
      oauth: { revokeToken: async () => undefined },
      encryption: { decrypt: (value) => value },
      unsubscribeFromNotifications: async () => {
        throw new Error('adapter defect')
      },
    })

    await expect(provider.stopNotificationSubscriptions(target())).resolves.toBe(
      'ambiguous',
    )
  })
})
