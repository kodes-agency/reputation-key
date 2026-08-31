import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  handlePortalHealthDependencyChanged,
  PORTAL_HEALTH_RECONCILIATION_CONSUMER,
} from './portal-health-outbox-consumers'

const NOW = '2026-08-27T08:00:00.000Z'

function event(eventType: string, payload: Record<string, unknown>): ConsumerEvent {
  return {
    eventId: '88000000-0000-4000-8000-000000000001',
    eventType,
    eventVersion: eventType === 'portal.responsible_managers.updated' ? 2 : 1,
    organizationId: 'org-1',
    propertyId: '88000000-0000-4000-8000-000000000002',
    sourceContext: eventType.split('.')[0]!,
    sourceAggregateId: '88000000-0000-4000-8000-000000000002',
    payload,
  }
}

describe('Portal Health dependency consumers', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('reconciles every Portal after a Property Google binding change', async () => {
    const reconcile = vi.fn(async () => ({ status: 'applied' as const, changed: 2 }))
    const input = event('property.google_binding.changed', {
      organizationId: 'org-1',
      propertyId: '88000000-0000-4000-8000-000000000002',
      connectionId: '88000000-0000-4000-8000-000000000003',
      sourceEpoch: 3,
      change: 'disconnected',
      occurredAt: NOW,
    })

    await expect(
      handlePortalHealthDependencyChanged({ reconcile }, input),
    ).resolves.toEqual({ status: 'applied' })
    expect(reconcile).toHaveBeenCalledWith({
      eventId: input.eventId,
      consumerName: PORTAL_HEALTH_RECONCILIATION_CONSUMER,
      organizationId: 'org-1',
      propertyId: '88000000-0000-4000-8000-000000000002',
      portalId: null,
      sourceVersion: `${input.eventId}:google:3`,
      occurredAt: new Date(NOW),
    })
  })

  it.each(['property.archived', 'property.restored'])(
    'reconciles every Portal after %s',
    async (eventType) => {
      const reconcile = vi.fn(async () => ({
        status: 'applied' as const,
        changed: 2,
      }))
      const input = event(eventType, {
        organizationId: 'org-1',
        propertyId: '88000000-0000-4000-8000-000000000002',
        userId: 'admin-1',
        previousState: eventType === 'property.archived' ? 'active' : 'archived',
        sourceEpoch: 4,
        recoveryDeadline:
          eventType === 'property.archived' ? '2026-09-26T08:00:00.000Z' : undefined,
        googleBindingReadiness:
          eventType === 'property.restored' ? 'reconnect_required' : undefined,
        occurredAt: NOW,
      })

      await expect(
        handlePortalHealthDependencyChanged({ reconcile }, input),
      ).resolves.toEqual({ status: 'applied' })
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          propertyId: '88000000-0000-4000-8000-000000000002',
          portalId: null,
          sourceVersion: `${input.eventId}:lifecycle:4`,
          occurredAt: new Date(NOW),
        }),
      )
    },
  )

  it('reconciles only the Portal whose responsible-manager set changed', async () => {
    const reconcile = vi.fn(async () => ({ status: 'applied' as const, changed: 1 }))
    const input = event('portal.responsible_managers.updated', {
      organizationId: 'org-1',
      propertyId: '88000000-0000-4000-8000-000000000002',
      portalId: '88000000-0000-4000-8000-000000000004',
      assignmentCount: 0,
      sourceAggregateVersion: NOW,
      occurredAt: NOW,
    })

    await handlePortalHealthDependencyChanged({ reconcile }, input)
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        portalId: '88000000-0000-4000-8000-000000000004',
        sourceVersion: NOW,
      }),
    )
  })

  it('rejects an envelope whose Property attribution disagrees with its payload', async () => {
    const reconcile = vi.fn()
    const input = event('property.deleted', {
      organizationId: 'org-1',
      propertyId: '88000000-0000-4000-8000-000000000099',
      sourceAggregateVersion: NOW,
      occurredAt: NOW,
    })

    await expect(
      handlePortalHealthDependencyChanged({ reconcile }, input),
    ).rejects.toThrow('Portal Health dependency envelope attribution mismatch')
    expect(reconcile).not.toHaveBeenCalled()
  })
})
