// Feed notification surface — port for the notification-gap read.
//
// "A review arrived but nobody was told" is the failure this answers. A gap is
// an inbox item that exists, is old enough to judge, has NO notification row
// pointing at it — for anybody — and whose delivery has not been decided.
// Delivery is decided once the Feed consumer has taken the item's
// `inbox.inbox_item.created` fact and every delivery it made has settled: a
// row, preferences that asked for none, or a recipient who no longer
// qualifies. An item whose recipients all muted it is therefore not a gap.
// Per-recipient partial gaps are not counted here: a row already exists, and
// the delivery repair sweep replays the recipient still owed one.
//
// An item that arrived as Google history is never a gap either: the fan-out
// never announces it (ADR 0046), and the gauge would otherwise page after
// every import.

export type NotificationGapWindow = Readonly<{
  /** Oldest item the gauge will consider (bounds the scan). */
  createdAtOrAfter: Date
  /**
   * Exclusive upper bound — the grace edge. The happy path is asynchronous
   * (event → BullMQ job → insert), so an item newer than this is not yet
   * evidence of anything.
   */
  createdBefore: Date
}>

export type NotificationGapRepositoryPort = Readonly<{
  /**
   * How many items in the window are missing their notification, saturating at
   * `scanLimit`. Feeds the `notification.missing_for_inbox_item` gauge, whose
   * alert pages on any count above zero — an exact count past the cap would
   * buy nothing and cost an unbounded aggregate on the health path.
   */
  countItemsMissingNotifications(
    input: NotificationGapWindow & Readonly<{ scanLimit: number }>,
  ): Promise<number>
}>
