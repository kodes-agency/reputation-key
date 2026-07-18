// BQC-3.9 — activity audit handlers for the consumed orphan families.
//
// The five BQC-3.1 orphan event families whose facts were recorded but never
// consumed (identity.organization.created, property.updated, property.deleted,
// integration.google_connection.visibility_changed,
// integration.property_import.completed) gain activity audit consumers —
// mechanical mirrors of the on-member-removed pattern. Pure unit tests with a
// mock queue — no DB needed. Each case asserts the EXACT enqueued payload.

import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  userId,
  googleConnectionId,
  gbpImportJobId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')
const USER = userId('00000000-0000-4000-8000-000000000020')
const CONN = googleConnectionId('00000000-0000-4000-8000-000000000099')
const IMPORT_JOB = gbpImportJobId('00000000-0000-4000-8000-000000000088')

const mockQueue = () =>
  ({ add: vi.fn() }) as unknown as Queue & { add: ReturnType<typeof vi.fn> }

describe('activity orphan audit handlers (BQC-3.9)', () => {
  it('onOrganizationCreated → created/organization with the owner as actor', async () => {
    const { onOrganizationCreated } = await import('./on-organization-created')
    const queue = mockQueue()

    await onOrganizationCreated({ queue })({
      _tag: 'identity.organization.created',
      eventId: 'evt-org-1',
      organizationId: ORG,
      organizationName: 'Acme Hotels',
      slug: 'acme-hotels',
      ownerId: USER,
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {
      action: 'created',
      resourceType: 'organization',
      resourceId: ORG,
      propertyId: null,
      organizationId: ORG,
      userId: USER,
      source: 'web',
      eventId: 'evt-org-1',
      payload: { subject: 'organization', from: null, to: null, detail: 'Acme Hotels' },
    })
  })

  it('onPropertyUpdated → changed/property with the name in detail', async () => {
    const { onPropertyUpdated } = await import('./on-property-updated')
    const queue = mockQueue()

    await onPropertyUpdated({ queue })({
      _tag: 'property.updated',
      eventId: 'evt-prop-1',
      organizationId: ORG,
      propertyId: PROP,
      name: 'Grand Hotel',
      slug: 'grand-hotel',
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {
      action: 'changed',
      resourceType: 'property',
      resourceId: PROP,
      propertyId: PROP,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-prop-1',
      payload: { subject: 'property', from: null, to: null, detail: 'Grand Hotel' },
    })
  })

  it('onPropertyDeleted → deleted/property with no detail', async () => {
    const { onPropertyDeleted } = await import('./on-property-deleted')
    const queue = mockQueue()

    await onPropertyDeleted({ queue })({
      _tag: 'property.deleted',
      eventId: 'evt-prop-2',
      organizationId: ORG,
      propertyId: PROP,
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {
      action: 'deleted',
      resourceType: 'property',
      resourceId: PROP,
      propertyId: PROP,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-prop-2',
      payload: { subject: 'property', from: null, to: null, detail: null },
    })
  })

  it('onGoogleConnectionVisibilityChanged → changed/integration, new visibility in to', async () => {
    const { onGoogleConnectionVisibilityChanged } =
      await import('./on-google-connection-visibility-changed')
    const queue = mockQueue()

    await onGoogleConnectionVisibilityChanged({ queue })({
      _tag: 'integration.google_connection.visibility_changed',
      eventId: 'evt-conn-1',
      connectionId: CONN,
      organizationId: ORG,
      visibility: 'organization',
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {
      action: 'changed',
      resourceType: 'integration',
      resourceId: CONN,
      propertyId: null,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-conn-1',
      payload: { subject: 'integration', from: null, to: 'organization', detail: null },
    })
  })

  it('onPropertyImportCompleted → created/integration with content-free counts', async () => {
    const { onPropertyImportCompleted } = await import('./on-property-import-completed')
    const queue = mockQueue()

    await onPropertyImportCompleted({ queue })({
      _tag: 'integration.property_import.completed',
      eventId: 'evt-imp-1',
      importJobId: IMPORT_JOB,
      organizationId: ORG,
      totalCount: 5,
      importedCount: 3,
      skippedCount: 1,
      failedCount: 1,
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {
      action: 'created',
      resourceType: 'integration',
      resourceId: IMPORT_JOB,
      propertyId: null,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-imp-1',
      payload: {
        subject: 'integration',
        from: null,
        to: null,
        detail: 'import completed: 3/5 imported, 1 skipped, 1 failed',
      },
    })
  })
})
