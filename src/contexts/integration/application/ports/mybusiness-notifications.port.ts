// Integration context — GBP Notifications API port (Pub/Sub lifecycle step 2/3).
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Wraps Google's My Business Notifications `updateNotificationSetting` endpoint,
// used by manage-notifications to subscribe (on first property import) and
// unsubscribe (on disconnect) a GBP account to/from the shared Pub/Sub topic.

export type SubscribeInput = Readonly<{
  accessToken: string
  /** GBP account id (`accounts/{id}` → the `{id}`), resolved via listAccounts. */
  gbpAccountId: string
  pubsubTopic: string
  notificationTypes: ReadonlyArray<string>
}>

export type UnsubscribeInput = Readonly<{
  accessToken: string
  gbpAccountId: string
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
