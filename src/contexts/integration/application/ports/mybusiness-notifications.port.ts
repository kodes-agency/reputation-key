// Integration context — GBP Notifications API port (Pub/Sub lifecycle step 2/3).
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Wraps Google's My Business Notifications desired-state endpoint through the
// typed Google provider executor. Every write is followed by an authoritative
// readback; ambiguous transport outcomes are never resolved by replaying the
// write blindly.

import type { GoogleProviderCallAuthorization } from '../google-provider-contract'

export const GBP_NOTIFICATION_TYPES = ['NEW_REVIEW', 'UPDATED_REVIEW'] as const
export type GbpNotificationType = (typeof GBP_NOTIFICATION_TYPES)[number]

export type SubscribeInput = Readonly<{
  accessToken: string
  authorization: GoogleProviderCallAuthorization
  /**
   * Exact GBP account id (`accounts/{id}` → the `{id}`) from an authorized,
   * active Property binding. Provider discovery must not guess this target.
   */
  gbpAccountId: string
  pubsubTopic: string
  notificationTypes: ReadonlyArray<GbpNotificationType>
  signal?: AbortSignal
}>

export type UnsubscribeInput = Readonly<{
  accessToken: string
  authorization: GoogleProviderCallAuthorization
  gbpAccountId: string
  signal?: AbortSignal
}>

export type MyBusinessNotificationsPort = Readonly<{
  /**
   * PATCH updateNotificationSetting with a pubsubTopic + notificationTypes so
   * Google publishes the given notification types to the topic.
   */
  subscribe: (input: SubscribeInput) => Promise<void>
  /**
   * PATCH updateNotificationSetting with an empty pubsubTopic to stop publishing.
   */
  unsubscribe: (input: UnsubscribeInput) => Promise<void>
}>
