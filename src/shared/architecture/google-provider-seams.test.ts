// Integration owns every Google credential, token and provider call. Review
// and Identity reach it only through named seams, and each provider operation
// runs under the system authority for its capability. The behaviour of each
// authorizer is tested beside it; these scans hold the wiring that chooses
// which authorizer and which executor a provider call goes through.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

const INTEGRATION = 'src/contexts/integration'

describe('Review and Identity seams to Integration', () => {
  // Review receives an opaque cursor reference and hands the same reference
  // back, so a leaked Review value can never be replayed against Google.
  it('gives Review an opaque cursor reference, never a provider page token', () => {
    const port = read('src/contexts/reputation/sync/google-review-api.port.server.ts')
    expect(port).not.toContain('pageToken')
    expect(port).not.toContain('nextPageToken')
  })

  it('reaches Integration through its seams, never through a context-private hatch', () => {
    expect(read('src/contexts/reputation/build-review.ts')).not.toContain('.internal.')
    expect(
      read(`${INTEGRATION}/connections/member-departure-outbox-consumers.server.ts`),
    ).not.toContain('.internal.')
  })

  it('lets Identity decide a departure without naming Google connections', () => {
    const removal = read('src/contexts/identity/members/remove-member.server.ts')
    expect(removal).not.toContain('prepareGoogleConnectorDeparture')
    expect(removal).not.toContain('connectionId')
  })

  it('exposes no server function that accepts PKCE verifier material', () => {
    const source = read(`${INTEGRATION}/server/google-connections.ts`)
    expect(source).not.toMatch(/export const connectGoogle\s*=/u)
    expect(source).not.toMatch(/\bconnectGoogleInputSchema\b/u)
    expect(source).not.toContain('verifierMaterial')
  })
})

describe('Google provider authority wiring', () => {
  it('routes Review reads and reply publication through their distinct system authorities', () => {
    const source = read(`${INTEGRATION}/review-sync/google-review-sync-runtime.server.ts`)
    const start = source.indexOf('const reviewSyncAuthorizer =')
    const end = source.indexOf('const googleReviewApi:', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const reviewWiring = source.slice(start, end)
    expect(reviewWiring).toContain('createGoogleReviewSyncAuthorizer')
    expect(reviewWiring).toContain('createGoogleReplyPublicationAuthorizer')
    expect(reviewWiring).toContain("authorization.capability === 'property.connect_gbp'")
    expect(reviewWiring).toContain(
      "authorization.capability === 'property.publish_reply'",
    )
    expect(reviewWiring).toContain('authorization.publication.attemptNumber')
    expect(reviewWiring).toContain('propertySourceEpoch')
    expect(reviewWiring).not.toContain('connectedBy')
    expect(reviewWiring).not.toContain('property.import_gbp_v2')
  })

  it('routes notification account lookup and desired-state writes through the governed executor', () => {
    const notificationWiring = read(
      `${INTEGRATION}/connections/notifications-runtime.server.ts`,
    )
    expect(notificationWiring).toContain('withSingle401Refresh')
    expect(notificationWiring).toContain('createMyBusinessNotificationsAdapter')
    expect(notificationWiring).toContain('authorization_unavailable')
    expect(notificationWiring).toContain('notifications,')
    expect(notificationWiring).not.toContain('createGoogleAccountManagementAdapter')

    const runtime = read(
      `${INTEGRATION}/connections/google-notification-runtime.server.ts`,
    )
    expect(runtime).toContain('manageNotifications({')
    expect(runtime).toContain('notifications: deps.notifications')
    expect(runtime).not.toContain('createGoogleAccountManagementAdapter')

    // The account targets come from active Property bindings, never discovery.
    expect(
      read(`${INTEGRATION}/review-sync/google-review-sync-runtime.server.ts`),
    ).toContain('createGoogleNotificationProviderAuthorizer({')
    const authorizer = read(
      `${INTEGRATION}/connections/google-notification-provider-authorizer.server.ts`,
    )
    expect(authorizer).toContain('const targetedAccounts = new Set<string>()')
    expect(authorizer).toContain('gbpAccountId: binding.accountId')
    expect(authorizer).not.toContain('listAccounts')
    expect(read(`${INTEGRATION}/build.ts`)).not.toContain('createGbpApiAdapter')
  })

  // The permit sweep consumes Integration's named worker capability; the
  // bootstrap builds no recovery repository of its own.
  it('leaves the recovery stores to Integration and logs only counts', () => {
    const bootstrap = read('src/bootstrap.ts')
    expect(bootstrap).not.toContain('createGoogleOAuthExchangeRecoveryRepository')
    expect(bootstrap).not.toContain('createGoogleDisconnectRevokeRepository')

    const recoveryBlock = bootstrap.slice(
      bootstrap.indexOf('oauthExchangeAttemptsExpired'),
      bootstrap.indexOf("'Google provider recovery sweep completed'") + 43,
    )
    expect(recoveryBlock).not.toBe('')
    expect(recoveryBlock).not.toMatch(
      /organization|connectionId|attemptId|permitId|credentialBinding|token|providerResponse/u,
    )
  })

  it('activates a durable, non-empty provider-authorization invalidation handler set', () => {
    const build = read(`${INTEGRATION}/build.ts`)
    expect(build).toContain('createProviderAuthorizationInvalidationFanout')
    expect(build).toContain("id: 'google_import_references'")
    expect(build).toContain('registerProviderAuthorizationInvalidationConsumer')
  })
})
