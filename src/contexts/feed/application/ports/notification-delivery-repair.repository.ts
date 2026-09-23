// Feed notification surface — port for the durable-delivery repair read.
//
// Durable delivery leaves two receipts per recipient on its source fact. The
// delivery bridge writes `notification.enqueue:<route>:<key>` once Redis has
// accepted the insert job; settlement claims `notification.materialized:<route>:<key>`
// in the transaction that decides it — applied (a row, or preferences that
// asked for none) or obsolete (the recipient no longer qualifies). An enqueue
// receipt with no materialized twin past the grace edge is a delivery that
// never settled, and nothing else is: a recipient who muted the type, or who
// no longer qualifies, is settled and never offered for repair.

import type { UnpublishedEvent } from '#/shared/outbox'

export type UnsettledNotificationDelivery = Readonly<{
  /** The durable source fact, as the relay delivers it. */
  event: UnpublishedEvent
  /** The matrix route whose delivery of the fact never settled. */
  consumerName: string
}>

/** Keyset position: the last (recordedAt, eventId, consumerName) a batch returned. */
export type UnsettledDeliveryCursor = Readonly<{
  recordedAt: Date
  eventId: string
  consumerName: string
}>

export type NotificationDeliveryRepairRepositoryPort = Readonly<{
  /**
   * One keyset batch of source facts with an unsettled delivery, one entry
   * per (fact, route), ordered by (recorded_at, id, route) ascending.
   */
  findUnsettledDeliveries(
    input: Readonly<{
      /** Oldest source fact still worth repairing. */
      recordedAtOrAfter: Date
      /** An enqueue at or after this may still be settling; it is no evidence. */
      enqueuedBefore: Date
      cursor: UnsettledDeliveryCursor | null
      limit: number
    }>,
  ): Promise<readonly UnsettledNotificationDelivery[]>
}>
