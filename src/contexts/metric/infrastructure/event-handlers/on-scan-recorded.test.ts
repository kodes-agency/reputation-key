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
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (
  overrides: Partial<Pick<OnScanRecordedDeps, 'findGroupForPortal'>> = {},
): OnScanRecordedDeps & {
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
        occurredAt: FIXED_TIME,
      } as MetricReading
    },
    findGroupForPortal: overrides.findGroupForPortal ?? (async () => null),
  }
}

const scanEvent = () => ({
  _tag: 'guest.scan.recorded' as const,
  eventId: 'test-event-id',
  correlationId: null,
  scanId: scanEventId('scan-1'),
  organizationId: organizationId('org-1'),
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  source: 'qr' as const,
  occurredAt: FIXED_TIME,
})

describe('onScanRecorded', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a portal.scan reading with value 1 and null groupId when the portal has no group', async () => {
    const handler = onScanRecorded(deps)
    await handler(scanEvent())

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.scan',
      value: 1,
      groupId: null,
    })
  })

  it('resolves groupId from portal group membership so portal_group badges/leaderboards receive data', async () => {
    const groupId = portalGroupId('group-42')
    const calls: Array<{ orgId: unknown; portalId: unknown }> = []
    const groupDeps = createFakeDeps({
      findGroupForPortal: async (orgId, pid) => {
        calls.push({ orgId, portalId: pid })
        return { portalGroupId: groupId }
      },
    })
    const handler = onScanRecorded(groupDeps)
    await handler(scanEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.groupId).toEqual(groupId)
    expect(calls).toEqual([
      { orgId: organizationId('org-1'), portalId: portalId('portal-1') },
    ])
  })

  it('still records the metric (groupId null) when group resolution throws', async () => {
    const groupDeps = createFakeDeps({
      findGroupForPortal: async () => {
        throw new Error('portal group lookup failed')
      },
    })
    const handler = onScanRecorded(groupDeps)
    await handler(scanEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.groupId).toBeNull()
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnScanRecordedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
      findGroupForPortal: async () => null,
    }
    const handler = onScanRecorded(failingDeps)

    await expect(handler(scanEvent())).resolves.toBeUndefined()
  })
})
