// Notification context — port for the notification-gap read.
//
// "A review arrived but nobody was told" is the failure this answers. Both
// consumers of the port work off the same definition of a gap: an inbox item
// that exists, is old enough to judge, and has NO notification row pointing at
// it — for anybody. Per-recipient partial gaps are deliberately NOT gaps here:
// re-running the insert path for a recipient who already has an unread row
// coalesces into it and bumps the user-visible "Updated N times" counter, so
// the sweep only ever touches items with zero notifications and leaves
// partially-delivered ones to the durable consumer's receipt fencing.

export type MissingNotificationCandidate = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string
  sourceType: string
  createdAt: Date
}>

/** Keyset position: the last (createdAt, id) pair a batch returned. */
export type MissingNotificationCursor = Readonly<{
  createdAt: Date
  inboxItemId: string
}>

export type NotificationGapWindow = Readonly<{
  /** Oldest item the sweep/gauge will consider (bounds the scan). */
  createdAtOrAfter: Date
  /**
   * Exclusive upper bound — the grace edge. The happy path is asynchronous
   * (event → BullMQ job → insert), so an item newer than this is not yet
   * evidence of anything and must not be raced.
   */
  createdBefore: Date
}>

export type NotificationGapRepositoryPort = Readonly<{
  /**
   * One keyset batch of inbox items with no notification row, ordered by
   * (created_at, id) ascending. `cursor` null starts at the window's head.
   */
  findItemsMissingNotifications(
    input: NotificationGapWindow &
      Readonly<{ cursor: MissingNotificationCursor | null; limit: number }>,
  ): Promise<readonly MissingNotificationCandidate[]>

  /**
   * How many items in the window are missing their notification, saturating at
   * `scanLimit`. Feeds the `notification.missing_for_inbox_item` gauge, whose
   * alert fires on "greater than zero, sustained" — an exact count past the
   * cap would buy nothing and cost an unbounded aggregate on the health path.
   */
  countItemsMissingNotifications(
    input: NotificationGapWindow & Readonly<{ scanLimit: number }>,
  ): Promise<number>
}>
