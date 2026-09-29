// Integration context — GBP Notifications API port (Pub/Sub lifecycle step 2/3).
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Wraps Google's My Business Notifications desired-state endpoint through the
// typed Google provider executor. A subscribe reads the current setting first
// and writes only when it differs; every write is followed by an authoritative
// readback, and ambiguous transport outcomes are never resolved by replaying
// the write blindly.

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

/** What `subscribe` found: it wrote the setting, or it already matched. */
export type GbpAccountSubscription = 'subscribed' | 'already_subscribed'

export type MyBusinessNotificationsPort = Readonly<{
  /**
   * Read the account's notification setting and, only when it differs, PATCH
   * updateNotificationSetting with the pubsubTopic + notificationTypes so Google
   * publishes those types to the topic, then confirm by readback.
   */
  subscribe: (input: SubscribeInput) => Promise<GbpAccountSubscription>
  /**
   * PATCH updateNotificationSetting with an empty pubsubTopic to stop publishing.
   */
  unsubscribe: (input: UnsubscribeInput) => Promise<void>
}>
