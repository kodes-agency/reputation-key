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
export type {
  OutboxRepository,
  UnpublishedEvent,
  ReceiptStatus,
} from './infrastructure/outbox-repository'
