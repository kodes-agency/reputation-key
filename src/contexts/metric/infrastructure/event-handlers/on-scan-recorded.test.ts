import { describe, it, expect, beforeEach } from 'vitest'
import { onScanRecorded, type OnScanRecordedDeps } from './on-scan-recorded'
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  scanEventId,
  metricReadingId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (): OnScanRecordedDeps & {
  readings: RecordMetricInput[]
} => {
  const readings: RecordMetricInput[] = []
  return {
    readings,
    recordMetric: async (input) => {
      readings.push({ ...input })
      return {
        id: metricReadingId('metric-1'),
        ...input,
        recordedAt: FIXED_TIME,
      } as MetricReading
    },
  }
}

describe('onScanRecorded', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a portal.scan reading with value 1', async () => {
    const handler = onScanRecorded(deps)
    await handler({
      _tag: 'scan.recorded',
      scanId: scanEventId('scan-1'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      staffId: null,
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      staffId: null,
    })
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnScanRecordedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
    }
    const handler = onScanRecorded(failingDeps)

    await expect(
      handler({
        _tag: 'scan.recorded',
        scanId: scanEventId('scan-1'),
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        source: 'qr',
        staffId: null,
        occurredAt: FIXED_TIME,
      }),
    ).resolves.toBeUndefined()
  })
})
