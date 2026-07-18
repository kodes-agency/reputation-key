import type { IntegrationPropertyImportCompleted } from '#/contexts/integration/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

// BQC-3.9: consume the integration.property_import.completed orphan (BQC-3.1)
// — audit fact → audit log. Content-free: counts only, never location data.
export const onPropertyImportCompleted =
  (deps: Deps) =>
  async (event: IntegrationPropertyImportCompleted): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'created' as const,
      resourceType: 'integration' as const,
      resourceId: event.importJobId,
      propertyId: null,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'integration',
        from: null,
        to: null,
        detail:
          `import completed: ${event.importedCount}/${event.totalCount} imported, ` +
          `${event.skippedCount} skipped, ${event.failedCount} failed`,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
