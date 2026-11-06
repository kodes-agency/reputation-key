import { z } from 'zod/v4'
import {
  boundedRouteString,
  optionalPageTokenSchema,
  reviewRouteDescriptorSchemas,
  type ReviewRouteDescriptor,
} from './review-route-descriptors'

export const routeDescriptorSchema = z.discriminatedUnion('routeKey', [
  z
    .object({
      routeKey: z.literal('account-management.accounts.list'),
      accessToken: boundedRouteString,
      pageToken: optionalPageTokenSchema,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('business-information.locations.list'),
      accessToken: boundedRouteString,
      accountId: z.string().min(1).max(255),
      pageToken: optionalPageTokenSchema,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('performance.fetch'),
      accessToken: boundedRouteString,
      locationId: z.string().min(1).max(255),
      startLocalDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
      endLocalDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('oauth.token.exchange'),
      code: boundedRouteString,
      clientId: boundedRouteString,
      clientSecret: boundedRouteString,
      redirectUri: boundedRouteString,
      codeVerifier: boundedRouteString,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('oauth.token.refresh'),
      refreshToken: boundedRouteString,
      clientId: boundedRouteString,
      clientSecret: boundedRouteString,
    })
    .strict(),
  z.object({ routeKey: z.literal('oauth.jwks') }).strict(),
  z
    .object({
      routeKey: z.literal('oauth.revoke'),
      token: boundedRouteString,
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('notifications.get'),
      accessToken: boundedRouteString,
      accountId: z.string().min(1).max(255),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('notifications.subscribe'),
      accessToken: boundedRouteString,
      accountId: z.string().min(1).max(255),
      pubsubTopic: z.string().min(1).max(1_024),
      notificationTypes: z
        .array(z.enum(['NEW_REVIEW', 'UPDATED_REVIEW']))
        .min(1)
        .max(2),
    })
    .strict(),
  z
    .object({
      routeKey: z.literal('notifications.unsubscribe'),
      accessToken: boundedRouteString,
      accountId: z.string().min(1).max(255),
    })
    .strict(),
  ...reviewRouteDescriptorSchemas,
])
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
