// Shared outbox — public application-facing surface (BQR-1.3).
//
// Application use cases and context build() wiring may import only from this
// barrel (or paths re-exported here). They must NOT import:
//   - ./infrastructure/**   (Drizzle repository implementation)
//   - ./relay               (worker relay loop)
//   - ./dispatcher          (worker consumer dispatcher)
//   - ./envelope            (relay↔dispatcher job-data contract)
//   - ./event-adapter       (internal payload mapping)
//
// Composition root and worker entry points may import infrastructure modules
// directly to construct adapters and start runtime loops.

export { emitAndRecord } from './emit-and-record'
// ARC-03-T7: no free registration function. Consumers are registered on the
// registry their container owns, so a second container in one process can
// register the same consumers without colliding with the first.
export { createConsumerRegistry } from './consumer-registry'
export type {
  ConsumerEvent,
  ConsumerHandler,
  ConsumerListing,
  ConsumerRegistration,
  ConsumerRegistry,
  ConsumerResult,
} from './consumer-registry'
export type {
  OutboxRepository,
  UnpublishedEvent,
  ReceiptStatus,
} from './infrastructure/outbox-repository'
