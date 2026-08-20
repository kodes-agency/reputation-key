import { describe, it, expect, beforeEach } from 'vitest'
import { onScanRecorded } from './on-scan-recorded'
import type { RecordPortalMetricDeps as OnScanRecordedDeps } from './record-portal-metric'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  scanEventId,
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
      return input
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

  it('records a governed portal.scan reading with unresolved portal-group attribution', async () => {
    const handler = onScanRecorded(deps)
    await handler(scanEvent())

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      portalGroupId: null,
      definitionVersionId: '11111111-1111-4111-8111-111111111201',
      sourceEventId: 'test-event-id',
      sourcePolicy: 'review_solicitation_analytics_only',
      scope: 'portal',
      value: 1,
      sampleCount: 1,
      attributionQuality: 'exact',
      occurredAt: FIXED_TIME,
    })
  })

  it('resolves portalGroupId from membership for downstream attribution', async () => {
    const groupId = portalGroupId('group-42')
    const calls: Array<{ orgId: unknown; portalId: unknown; asOf: Date }> = []
    const groupDeps = createFakeDeps({
      findGroupForPortal: async (orgId, pid, asOf) => {
        calls.push({ orgId, portalId: pid, asOf })
        return { portalGroupId: groupId }
      },
    })
    const handler = onScanRecorded(groupDeps)
    await handler(scanEvent())

    expect(groupDeps.readings).toHaveLength(1)
    expect(groupDeps.readings[0]!.portalGroupId).toEqual(groupId)
    expect(calls).toEqual([
      {
        orgId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        asOf: FIXED_TIME,
      },
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
    expect(groupDeps.readings[0]!.portalGroupId).toBeNull()
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
