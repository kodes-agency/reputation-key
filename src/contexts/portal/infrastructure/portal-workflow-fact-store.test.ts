import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalWorkflowFactCommand } from '../application/use-cases/complete-content-review'
import { createPortalWorkflowFactStore } from './portal-workflow-fact-store'

const occurredAt = new Date('2026-08-09T12:00:00.000Z')
const currentRevision = new Date('2026-08-09T13:00:00.000Z')
const committedRevision = new Date(currentRevision.getTime() + 1)
const command: PortalWorkflowFactCommand = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
  portalId: portalId('22222222-2222-4222-8222-222222222222'),
  portalGroupId: portalGroupId('33333333-3333-4333-8333-333333333333'),
  reviewId: 'review-cycle-1',
  revision: 1,
  supersedes: null,
  occurredAt,
}

function makeHarness(existingFactCount: 0 | 1 | 3 = 0) {
  const order: string[] = []
  const outboxRows: Array<Record<string, unknown>> = []
  let executeCount = 0
  const tx = {
    execute: vi.fn(async () => {
      executeCount += 1
      if (executeCount === 1) {
        order.push('tx.portal-lock')
        return {
          rows: [
            {
              id: command.portalId,
              organizationId: command.organizationId,
              propertyId: command.propertyId,
              name: 'Front desk',
              description: 'Tell us about your stay',
              theme: { primaryColor: '#112233' },
              publicationState: 'published',
              // Raw Drizzle SQL returns timestamptz values as PostgreSQL strings.
              updatedAt: '2026-08-09 16:00:00+03',
            },
          ],
        }
      }
      order.push('tx.snapshot')
      return {
        rows: [
          {
            categoryCount: 1,
            urls: [
              'https://www.google.com/maps/place/one',
              'https://www.google.com/maps/place/two',
              'https://www.google.com/maps/place/three',
              'https://www.google.com/maps/place/four',
              'https://www.google.com/maps/place/five',
            ],
          },
        ],
      }
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          order.push('tx.check')
          return Array.from({ length: existingFactCount }, (_, index) => ({
            eventType: [
              'portal.content_review.completed',
              'portal.configuration_completeness.recorded',
              'portal.approved_destination_ratio.recorded',
            ][index],
          }))
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        outboxRows.push(row)
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => {
              order.push('tx.outbox')
              return [{ id: row.id }]
            }),
          })),
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            order.push('tx.portal')
            return [{ updatedAt: committedRevision }]
          }),
        })),
      })),
    })),
  }
  const db = {
    transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => {
      order.push('tx.start')
      const result = await run(tx)
      order.push('tx.commit')
      return result
    }),
  } as unknown as Database
  const events = {
    emit: vi.fn(async () => {
      order.push('emit')
    }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus
  return { db, events, order, outboxRows, tx }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

describe('Portal workflow fact store', () => {
  it('atomically marks the review and records exact completeness and destination facts', async () => {
    const harness = makeHarness()
    const store = createPortalWorkflowFactStore(harness.db, harness.events)

    const result = await store.recordCompletedReview(command)

    expect(result.status).toBe('recorded')
    expect(result.events).toEqual([
      expect.objectContaining({
        _tag: 'portal.content_review.completed',
        portalGroupId: command.portalGroupId,
      }),
      expect.objectContaining({
        _tag: 'portal.configuration_completeness.recorded',
        completedFields: 5,
        requiredFields: 5,
      }),
      expect.objectContaining({
        _tag: 'portal.approved_destination_ratio.recorded',
        approvedDestinations: 5,
        configuredDestinations: 5,
      }),
    ])
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceAggregateVersion: committedRevision.toISOString(),
          occurredAt,
        }),
      ]),
    )
    expect(harness.outboxRows).toHaveLength(3)
    expect(harness.outboxRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventVersion: 2,
          payload: expect.objectContaining({
            sourceAggregateVersion: committedRevision.toISOString(),
            occurredAt: occurredAt.toISOString(),
          }),
        }),
      ]),
    )
    expect(harness.order).toEqual([
      'tx.start',
      'tx.portal-lock',
      'tx.snapshot',
      'tx.check',
      'tx.portal',
      'tx.outbox',
      'tx.outbox',
      'tx.outbox',
      'tx.commit',
      'emit',
      'emit',
      'emit',
    ])
  })

  it('uses the locked semantic command identity and makes a replay a no-op', async () => {
    const first = makeHarness()
    const duplicate = makeHarness(3)
    const firstResult = await createPortalWorkflowFactStore(
      first.db,
      first.events,
    ).recordCompletedReview(command)
    const duplicateResult = await createPortalWorkflowFactStore(
      duplicate.db,
      duplicate.events,
    ).recordCompletedReview(command)

    expect(duplicateResult.status).toBe('duplicate')
    expect(firstResult.events).toHaveLength(3)
    expect(duplicateResult.events).toEqual([])
    expect(duplicate.events.emit).not.toHaveBeenCalled()
    expect(duplicate.tx.update).not.toHaveBeenCalled()
    expect(duplicate.outboxRows).toHaveLength(0)
  })

  it('rejects a partial semantic fact set without advancing the Portal revision', async () => {
    const partial = makeHarness(1)

    await expect(
      createPortalWorkflowFactStore(partial.db, partial.events).recordCompletedReview(
        command,
      ),
    ).rejects.toThrow('partial Portal workflow fact set detected')
    expect(partial.tx.update).not.toHaveBeenCalled()
    expect(partial.outboxRows).toHaveLength(0)
  })

  it('links every corrected fact to its exact superseded source event', async () => {
    const harness = makeHarness()
    const store = createPortalWorkflowFactStore(harness.db, harness.events)

    const result = await store.recordCompletedReview({
      ...command,
      revision: 2,
      supersedes: {
        contentReviewSourceEventId: 'old-review',
        configurationSourceEventId: 'old-config',
        destinationRatioSourceEventId: 'old-ratio',
      },
    })

    expect(result.events.map((event) => event.supersedesSourceEventId)).toEqual([
      'old-review',
      'old-config',
      'old-ratio',
    ])
  })
})
