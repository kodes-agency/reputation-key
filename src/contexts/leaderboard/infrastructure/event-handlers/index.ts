import type { EventBus } from '#/shared/events/event-bus'

export type RegisterRecognitionHandlersDeps = Readonly<{
  eventBus: EventBus
  reconcileProperty: (
    organizationId: string,
    propertyId: string,
  ) => Promise<
    Readonly<{
      snapshotsReconciled: number
      entriesUpserted: number
      sourceFactsRecorded: number
    }>
  >
}>

/**
 * Governed metric facts trigger only a property-scoped reconciliation. The
 * repository re-authorizes the capability and resolves the installed metric
 * definition version before reading or writing any recognition facts.
 */
export function registerRecognitionEventHandlers(
  deps: RegisterRecognitionHandlersDeps,
): void {
  deps.eventBus.on(
    'metric.recorded',
    async (event) => {
      if (!event.permittedConsumers.includes('recognition')) return
      await Promise.allSettled([
        deps.reconcileProperty(event.organizationId, event.propertyId),
      ])
    },
    { consumer: 'recognition.event-handlers' },
  )
}
