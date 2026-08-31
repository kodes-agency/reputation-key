// BQC-3.9 — activity audit handlers for the consumed orphan families.
//
// Recorded lifecycle event families are consumed into content-minimized
// activity audit jobs. Tests assert the exact queue payloads.

import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  userId,
  googleConnectionId,
} from '#/shared/domain/ids'

import { onGoogleConnectionVisibilityChanged } from './on-google-connection-visibility-changed'
import { onOrganizationCreated } from './on-organization-created'
import { onPropertyCreated } from './on-property-created'
import { onPropertyDeleted } from './on-property-deleted'
import { onPropertyUpdated } from './on-property-updated'
const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')
const USER = userId('00000000-0000-4000-8000-000000000020')
const CONN = googleConnectionId('00000000-0000-4000-8000-000000000099')

const mockQueue = () =>
  ({ add: vi.fn() }) as unknown as Queue & { add: ReturnType<typeof vi.fn> }

describe('activity orphan audit handlers (BQC-3.9)', () => {
  it('onOrganizationCreated → created/organization with the owner as actor', async () => {
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

    expect(queue.add).toHaveBeenCalledWith('project-recent-activity', {
      action: 'created',
      resourceType: 'organization',
      resourceId: ORG,
      propertyId: null,
      organizationId: ORG,
      userId: USER,
      source: 'web',
      eventId: 'evt-org-1',
      payload: { subject: 'organization', from: null, to: null, detail: null },
    })
  })

  it('onPropertyCreated → created/property without retaining the name', async () => {
    const queue = mockQueue()

    await onPropertyCreated({ queue })({
      _tag: 'property.created',
      eventId: 'evt-prop-created',
      organizationId: ORG,
      propertyId: PROP,
      name: 'Grand Hotel',
      slug: 'grand-hotel',
      processingRegion: 'us',
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('project-recent-activity', {
      action: 'created',
      resourceType: 'property',
      resourceId: PROP,
      propertyId: PROP,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-prop-created',
      payload: { subject: 'property', from: null, to: null, detail: null },
    })
  })

  it('onPropertyUpdated → changed/property without retaining the name', async () => {
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

    expect(queue.add).toHaveBeenCalledWith('project-recent-activity', {
      action: 'changed',
      resourceType: 'property',
      resourceId: PROP,
      propertyId: PROP,
      organizationId: ORG,
      userId: null,
      source: 'web',
      eventId: 'evt-prop-1',
      payload: { subject: 'property', from: null, to: null, detail: null },
    })
  })

  it('onPropertyDeleted → deleted/property with no detail', async () => {
    const queue = mockQueue()

    await onPropertyDeleted({ queue })({
      _tag: 'property.deleted',
      eventId: 'evt-prop-2',
      organizationId: ORG,
      propertyId: PROP,
      occurredAt: new Date(),
      correlationId: null,
    })

    expect(queue.add).toHaveBeenCalledWith('project-recent-activity', {
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

    expect(queue.add).toHaveBeenCalledWith('project-recent-activity', {
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
})
