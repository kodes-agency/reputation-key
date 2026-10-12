// EventJobCatalogue — event family row shapes and factories.
//
// Shared by ./event-job-catalogue.ts and the family modules split out of it
// (./event-job-catalogue-identity.ts), which cannot import the catalogue back.

/** A durable outbox consumer of an event family, pinned to its registration module. */
export type EventConsumerRef = Readonly<{
  /** Consumer name, e.g. 'inbox.on-review-created'. */
  name: string
  /** Repo-relative file containing the registerConsumer call. */
  module: string
}>

export type EventFamilyRow = Readonly<{
  eventType: string
  consumers: ReadonlyArray<EventConsumerRef>
}>

/** Durable outbox consumer ('<context>.<handler-name>'). */
export const durable = (name: string, module: string): EventConsumerRef => ({
  name,
  module,
})

/** Event family row used by readiness and dispatcher routing. */
export const ev = (
  eventType: string,
  consumers: ReadonlyArray<EventConsumerRef>,
): EventFamilyRow => ({ eventType, consumers })
