import type { ReviewRouteDescriptor } from './review-route-descriptors'

export type GoogleProviderRouteDescriptor =
  | Readonly<{
      routeKey: 'account-management.accounts.list'
      accessToken: string
      pageToken?: string
    }>
  | Readonly<{
      routeKey: 'business-information.locations.list'
      accessToken: string
      accountId: string
      pageToken?: string
    }>
  | Readonly<{
      routeKey: 'performance.fetch'
      accessToken: string
      locationId: string
      startLocalDate: string
      endLocalDate: string
    }>
  | Readonly<{
      routeKey: 'oauth.token.exchange'
      code: string
      clientId: string
      clientSecret: string
      redirectUri: string
      codeVerifier: string
    }>
  | Readonly<{
      routeKey: 'oauth.token.refresh'
      refreshToken: string
      clientId: string
      clientSecret: string
    }>
  | Readonly<{ routeKey: 'oauth.jwks' }>
  | Readonly<{ routeKey: 'oauth.revoke'; token: string }>
  | Readonly<{
      routeKey: 'notifications.get'
      accessToken: string
      accountId: string
    }>
  | Readonly<{
      routeKey: 'notifications.subscribe'
      accessToken: string
      accountId: string
      pubsubTopic: string
      notificationTypes: ReadonlyArray<'NEW_REVIEW' | 'UPDATED_REVIEW'>
    }>
  | Readonly<{
      routeKey: 'notifications.unsubscribe'
      accessToken: string
      accountId: string
    }>
  | ReviewRouteDescriptor
