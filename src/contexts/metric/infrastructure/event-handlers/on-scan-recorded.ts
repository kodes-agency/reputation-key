// Metric context — records portal.scan metric on scan events
import type { ScanRecorded } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { getLogger } from '#/shared/observability/logger'

export type OnScanRecordedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const onScanRecorded =
  (deps: OnScanRecordedDeps) =>
  async (event: ScanRecorded): Promise<void> => {
    try {
      await deps.recordMetric({
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        portalId: event.portalId,
        metricKey: 'portal.scan',
        value: 1,
        staffId: event.staffId,
      })
    } catch (err) {
      getLogger().error(
        { err, event: event._tag, portalId: event.portalId },
        'metric: failed to record portal.scan',
      )
    }
  }
