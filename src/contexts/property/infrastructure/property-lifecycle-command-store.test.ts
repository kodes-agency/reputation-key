import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { userId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestProperty } from '#/shared/testing/fixtures'
import { propertyArchived, propertyRestored } from '../domain/events'
import { propertyToRow } from './mappers/property.mapper'
import { createPropertyLifecycleCommandStore } from './property-lifecycle-command-store'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const RECOVERY_DEADLINE = new Date('2026-09-27T12:00:00.000Z')
const ACTOR_ID = userId('admin-1')
const PROPERTY_ID = 'a0000000-0000-4000-8000-000000000001'

describe('createPropertyLifecycleCommandStore', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('co-commits recoverable archive, authority fencing, and its content-free fact', async () => {
    const property = buildTestProperty({
      id: PROPERTY_ID,
      lifecycleState: 'active',
      sourceEpoch: 7,
      dataCellId: 'us',
      processingRegion: 'us',
      googleReviewDestination: {
        state: 'verified',
        uri: 'https://search.google.com/local/writereview?placeid=property-1',
        retrievedAt: NOW,
        sourceEpoch: 7,
        profileVersion: 1,
      },
    })
    const current = propertyToRow(property) as Record<string, unknown>
    const order: string[] = []
    const updates: Array<Record<string, unknown>> = []
    const facts: Array<Record<string, unknown>> = []
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({ limit: vi.fn(async () => [current]) })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((set: Record<string, unknown>) => {
          order.push('state')
          updates.push(set)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ ...current, ...set }]),
            })),
          }
        }),
      })),
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(outboxEvents)
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            order.push('fact')
            facts.push(row)
          }),
        }
      }),
    }
    const db = {
      transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => {
        order.push('begin')
        const result = await run(tx)
        order.push('commit')
        return result
      }),
    } as unknown as Database
    const events: EventBus = {
      on: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(async () => {
        order.push('emit')
      }),
    }
    const event = propertyArchived({
      organizationId: property.organizationId,
      propertyId: property.id,
      userId: ACTOR_ID,
      previousState: 'active',
      sourceEpoch: 8,
      recoveryDeadline: RECOVERY_DEADLINE,
      occurredAt: NOW,
    })

    const result = await createPropertyLifecycleCommandStore(
      db,
      events,
      'us',
    ).transitionLifecycle({
      organizationId: property.organizationId,
      propertyId: property.id,
      from: 'active',
      to: 'archived',
      expectedSourceEpoch: 7,
      nextSourceEpoch: 8,
      expectedProfileVersion: 1,
      reason: 'Property no longer trading',
      recoveryDeadline: RECOVERY_DEADLINE,
      initiatedBy: ACTOR_ID,
      occurredAt: NOW,
      event,
    })

    expect(result).toMatchObject({
      id: property.id,
      lifecycleState: 'archived',
      sourceEpoch: 8,
      googleReviewDestination: { state: 'awaiting_refresh' },
    })
    expect(updates).toEqual([
      expect.objectContaining({
        lifecycleState: 'archived',
        lifecycleReason: 'Property no longer trading',
        lifecycleStateChangedAt: NOW,
        purgeScheduledFor: RECOVERY_DEADLINE,
        lifecycleInitiatedBy: 'admin-1',
        sourceEpoch: 8,
        googleReviewDestinationState: 'awaiting_refresh',
        updatedAt: NOW,
      }),
    ])
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      id: event.eventId,
      eventType: 'property.archived',
      organizationId: property.organizationId,
      propertyId: property.id,
    })
    expect(order).toEqual(['begin', 'state', 'fact', 'commit', 'emit'])
    expect(tx).not.toHaveProperty('delete')
  })

  it('co-commits restore without replacing the stable Property row or binding identity', async () => {
    const property = buildTestProperty({
      id: PROPERTY_ID,
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: new Date('2026-08-20T12:00:00.000Z'),
      purgeScheduledFor: RECOVERY_DEADLINE,
      lifecycleInitiatedBy: 'admin-previous',
      sourceEpoch: 8,
      dataCellId: 'us',
      processingRegion: 'us',
      googleBindingState: 'disconnected',
      googleConnectionId: null,
      gbpAccountId: null,
      gbpLocationId: null,
    })
    const current = propertyToRow(property) as Record<string, unknown>
    const updates: Array<Record<string, unknown>> = []
    const facts: Array<Record<string, unknown>> = []
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({ limit: vi.fn(async () => [current]) })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((set: Record<string, unknown>) => {
          updates.push(set)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ ...current, ...set }]),
            })),
          }
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async (row: Record<string, unknown>) => {
          facts.push(row)
        }),
      })),
    }
    const db = {
      transaction: vi.fn((run: (value: typeof tx) => Promise<unknown>) => run(tx)),
    } as unknown as Database
    const events: EventBus = {
      on: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
    }
    const event = propertyRestored({
      organizationId: property.organizationId,
      propertyId: property.id,
      userId: ACTOR_ID,
      previousState: 'archived',
      sourceEpoch: 9,
      googleBindingReadiness: 'reconnect_required',
      occurredAt: NOW,
    })

    const result = await createPropertyLifecycleCommandStore(
      db,
      events,
      'us',
    ).transitionLifecycle({
      organizationId: property.organizationId,
      propertyId: property.id,
      from: 'archived',
      to: 'active',
      expectedSourceEpoch: 8,
      nextSourceEpoch: 9,
      expectedProfileVersion: property.profileVersion,
      reason: null,
      recoveryDeadline: null,
      initiatedBy: ACTOR_ID,
      occurredAt: NOW,
      event,
    })

    expect(result).toMatchObject({
      id: property.id,
      lifecycleState: 'active',
      sourceEpoch: 9,
      googleBindingState: 'disconnected',
      googleConnectionId: null,
    })
    expect(updates).toEqual([
      expect.objectContaining({
        lifecycleState: 'active',
        lifecycleReason: null,
        purgeScheduledFor: null,
        sourceEpoch: 9,
      }),
    ])
    expect(facts[0]).toMatchObject({
      id: event.eventId,
      eventType: 'property.restored',
      propertyId: property.id,
    })
    expect(tx).not.toHaveProperty('delete')
  })

  it('fails closed on a stale authority epoch before any state or fact write', async () => {
    const property = buildTestProperty({
      id: PROPERTY_ID,
      lifecycleState: 'active',
      sourceEpoch: 9,
      dataCellId: 'us',
      processingRegion: 'us',
    })
    const current = propertyToRow(property) as Record<string, unknown>
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({ limit: vi.fn(async () => [current]) })),
          })),
        })),
      })),
      update: vi.fn(),
      insert: vi.fn(),
    }
    const db = {
      transaction: vi.fn((run: (value: typeof tx) => Promise<unknown>) => run(tx)),
    } as unknown as Database
    const events: EventBus = {
      on: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
    }
    const event = propertyArchived({
      organizationId: property.organizationId,
      propertyId: property.id,
      userId: ACTOR_ID,
      previousState: 'active',
      sourceEpoch: 8,
      recoveryDeadline: RECOVERY_DEADLINE,
      occurredAt: NOW,
    })

    await expect(
      createPropertyLifecycleCommandStore(db, events, 'us').transitionLifecycle({
        organizationId: property.organizationId,
        propertyId: property.id,
        from: 'active',
        to: 'archived',
        expectedSourceEpoch: 7,
        nextSourceEpoch: 8,
        expectedProfileVersion: property.profileVersion,
        reason: 'Property no longer trading',
        recoveryDeadline: RECOVERY_DEADLINE,
        initiatedBy: ACTOR_ID,
        occurredAt: NOW,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'stale_property' })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(events.emit).not.toHaveBeenCalled()
  })

  it('rejects mismatched recovery evidence before opening a transaction', async () => {
    const property = buildTestProperty({
      id: PROPERTY_ID,
      lifecycleState: 'active',
      sourceEpoch: 7,
      dataCellId: 'us',
      processingRegion: 'us',
    })
    const db = { transaction: vi.fn() } as unknown as Database
    const events: EventBus = {
      on: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
    }
    const event = propertyArchived({
      organizationId: property.organizationId,
      propertyId: property.id,
      userId: ACTOR_ID,
      previousState: 'active',
      sourceEpoch: 8,
      recoveryDeadline: new Date('2026-09-28T12:00:00.000Z'),
      occurredAt: NOW,
    })

    await expect(
      createPropertyLifecycleCommandStore(db, events, 'us').transitionLifecycle({
        organizationId: property.organizationId,
        propertyId: property.id,
        from: 'active',
        to: 'archived',
        expectedSourceEpoch: 7,
        nextSourceEpoch: 8,
        expectedProfileVersion: property.profileVersion,
        reason: 'Property no longer trading',
        recoveryDeadline: RECOVERY_DEADLINE,
        initiatedBy: ACTOR_ID,
        occurredAt: NOW,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'stale_property' })
    expect(db.transaction).not.toHaveBeenCalled()
    expect(events.emit).not.toHaveBeenCalled()
  })
})
