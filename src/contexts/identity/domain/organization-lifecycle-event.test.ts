import { beforeEach, describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { identityOrganizationLifecycleChanged } from './events'

describe('Organization lifecycle durable fact', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('retains fences and excludes actor, reason, and support evidence', () => {
    const row = toOutboxEvent(
      identityOrganizationLifecycleChanged({
        organizationId: organizationId('org-1'),
        closureLineageId: '18deca2e-91a7-46e4-b92b-73163568ed84',
        state: 'closure_requested',
        revision: 1,
        reactivationRequired: true,
        recoverableUntil: new Date('2026-09-27T00:00:00.000Z'),
        occurredAt: new Date('2026-08-28T00:00:00.000Z'),
      }),
    )

    expect(row).toMatchObject({
      eventType: 'identity.organization_lifecycle.changed',
      eventVersion: 1,
      organizationId: 'org-1',
      sourceAggregateId: '18deca2e-91a7-46e4-b92b-73163568ed84',
    })
    expect(row.payload).toEqual({
      organizationId: 'org-1',
      closureLineageId: '18deca2e-91a7-46e4-b92b-73163568ed84',
      state: 'closure_requested',
      revision: 1,
      reactivationRequired: true,
      recoverableUntil: '2026-09-27T00:00:00.000Z',
      occurredAt: '2026-08-28T00:00:00.000Z',
      correlationId: null,
    })
    expect(row.payload).not.toHaveProperty('actorUserId')
    expect(row.payload).not.toHaveProperty('reasonCode')
    expect(row.payload).not.toHaveProperty('supportEvidenceRef')
  })
})
