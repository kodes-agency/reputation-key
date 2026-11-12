import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalWorkflowFactCommand } from '../application/use-cases/complete-content-review'
import { isPortalError } from '../domain/errors'
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

type HarnessOptions = Readonly<{
  alreadyRecorded?: boolean
  publicationState?: string
}>

function makeHarness(options: HarnessOptions = {}) {
  const { alreadyRecorded = false, publicationState = 'published' } = options
  const order: string[] = []
  const outboxRows: Array<Record<string, unknown>> = []
  const tx = {
    execute: vi.fn(async () => {
      order.push('tx.portal-lock')
      return { rows: [{ publicationState }] }
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            order.push('tx.check')
            return alreadyRecorded ? [{ id: 'existing' }] : []
          }),
        })),
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
  return { db, order, outboxRows, tx }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

describe('Portal workflow fact store', () => {
  it('atomically marks the review and records the content review fact alone', async () => {
    const harness = makeHarness()
    const store = createPortalWorkflowFactStore(harness.db)

    const result = await store.recordCompletedReview(command)

    expect(result.status).toBe('recorded')
    expect(result.events).toEqual([
      expect.objectContaining({
        _tag: 'portal.content_review.completed',
        portalGroupId: command.portalGroupId,
        sourceAggregateVersion: committedRevision.toISOString(),
        occurredAt,
      }),
    ])
    expect(harness.outboxRows.map((row) => [row.eventType, row.eventVersion])).toEqual([
      ['portal.content_review.completed', 2],
    ])
    expect(harness.order).toEqual([
      'tx.start',
      'tx.portal-lock',
      'tx.check',
      'tx.portal',
      'tx.outbox',
      'tx.commit',
    ])
  })

  it('refuses a Portal that is not live without touching it', async () => {
    const harness = makeHarness({ publicationState: 'draft' })

    await expect(
      createPortalWorkflowFactStore(harness.db).recordCompletedReview(command),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isPortalError(error) && error.code === 'invalid_publication_transition',
    )
    expect(harness.tx.update).not.toHaveBeenCalled()
    expect(harness.outboxRows).toHaveLength(0)
  })

  it('makes a replay of the same review revision a no-op', async () => {
    const duplicate = makeHarness({ alreadyRecorded: true })

    const result = await createPortalWorkflowFactStore(
      duplicate.db,
    ).recordCompletedReview(command)

    expect(result).toEqual({ status: 'duplicate', events: [] })
    expect(duplicate.tx.update).not.toHaveBeenCalled()
    expect(duplicate.outboxRows).toHaveLength(0)
  })

  it('links a corrected fact to the source event it supersedes', async () => {
    const harness = makeHarness()

    const result = await createPortalWorkflowFactStore(harness.db).recordCompletedReview({
      ...command,
      revision: 2,
      supersedes: { contentReviewSourceEventId: 'old-review' },
    })

    expect(result.events.map((event) => event.supersedesSourceEventId)).toEqual([
      'old-review',
    ])
  })
})
