import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalWorkflowFactCommand } from '../application/use-cases/complete-content-review'
import { isPortalError } from '../domain/errors'
import { publicationSource } from '../domain/__fixtures__/publication-source'
import type { PortalPublicationSource } from '../domain/portal-publication-source'
import { createPortalWorkflowFactStore } from './portal-workflow-fact-store'
import { readPortalWorkingCopy } from './portal-working-copy.reader'

vi.mock('./portal-working-copy.reader', () => ({ readPortalWorkingCopy: vi.fn() }))

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
  googleReviewDestinationVerified: true,
}

/** One row per kind of link the Portal can hold. */
const LINK_ROWS = [
  { url: null, destinationId: 'destination-1', approvalState: 'approved' },
  { url: null, destinationId: 'destination-2', approvalState: 'pending' },
  { url: null, destinationId: 'destination-3', approvalState: 'disabled' },
  // Raw addresses from before Property destinations keep the allowlist rule.
  {
    url: 'https://www.google.com/maps/place/one',
    destinationId: null,
    approvalState: null,
  },
  { url: 'https://harbor.example.com/menu', destinationId: null, approvalState: null },
]

type HarnessOptions = Readonly<{
  existingFactCount?: 0 | 1 | 3
  publicationState?: string
  workingCopy?: PortalPublicationSource | null
}>

function makeHarness(options: HarnessOptions = {}) {
  const { existingFactCount = 0, publicationState = 'published' } = options
  const workingCopy =
    options.workingCopy === undefined ? publicationSource() : options.workingCopy
  const order: string[] = []
  const outboxRows: Array<Record<string, unknown>> = []
  vi.mocked(readPortalWorkingCopy).mockImplementation(async () => {
    order.push('tx.working-copy')
    return workingCopy
  })
  const tx = {
    execute: vi.fn(async () => {
      order.push('tx.portal-lock')
      return { rows: [{ publicationState }] }
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        // The Portal's links, each with its destination's approval.
        leftJoin: vi.fn(() => ({
          where: vi.fn(async () => {
            order.push('tx.links')
            return LINK_ROWS
          }),
        })),
        // The facts already recorded for this review revision.
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
  return { db, order, outboxRows, tx }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
  vi.mocked(readPortalWorkingCopy).mockReset()
})

describe('Portal workflow fact store', () => {
  it('atomically marks the review and records exact completeness and destination facts', async () => {
    const harness = makeHarness()
    const store = createPortalWorkflowFactStore(harness.db)

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
        fieldSet: 'immersive_hub',
      }),
      expect.objectContaining({
        _tag: 'portal.approved_destination_ratio.recorded',
        approvedDestinations: 2,
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
    expect(readPortalWorkingCopy).toHaveBeenCalledWith(harness.tx, {
      organizationId: command.organizationId,
      propertyId: command.propertyId,
      portalId: command.portalId,
    })
    expect(harness.outboxRows.map((row) => [row.eventType, row.eventVersion])).toEqual([
      ['portal.content_review.completed', 2],
      ['portal.configuration_completeness.recorded', 3],
      ['portal.approved_destination_ratio.recorded', 2],
    ])
    expect(harness.outboxRows[1]).toMatchObject({
      payload: {
        completedFields: 5,
        requiredFields: 5,
        fieldSet: 'immersive_hub',
        sourceAggregateVersion: committedRevision.toISOString(),
        occurredAt: occurredAt.toISOString(),
      },
    })
    expect(harness.order).toEqual([
      'tx.start',
      'tx.portal-lock',
      'tx.working-copy',
      'tx.links',
      'tx.check',
      'tx.portal',
      'tx.outbox',
      'tx.outbox',
      'tx.outbox',
      'tx.commit',
    ])
  })

  it('counts the Google destination the review found', async () => {
    const harness = makeHarness()

    const result = await createPortalWorkflowFactStore(harness.db).recordCompletedReview({
      ...command,
      googleReviewDestinationVerified: false,
    })

    expect(result.events[1]).toMatchObject({ completedFields: 4, requiredFields: 5 })
  })

  it('refuses a Portal that is not live before reading its content', async () => {
    const harness = makeHarness({ publicationState: 'draft' })

    await expect(
      createPortalWorkflowFactStore(harness.db).recordCompletedReview(command),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isPortalError(error) && error.code === 'invalid_publication_transition',
    )
    expect(readPortalWorkingCopy).not.toHaveBeenCalled()
    expect(harness.tx.update).not.toHaveBeenCalled()
    expect(harness.outboxRows).toHaveLength(0)
  })

  it('refuses a working copy that does not resolve without advancing the Portal revision', async () => {
    const harness = makeHarness({ workingCopy: null })

    await expect(
      createPortalWorkflowFactStore(harness.db).recordCompletedReview(command),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isPortalError(error) && error.code === 'publication_snapshot_unavailable',
    )
    expect(harness.tx.update).not.toHaveBeenCalled()
    expect(harness.outboxRows).toHaveLength(0)
  })

  it('uses the locked semantic command identity and makes a replay a no-op', async () => {
    const first = makeHarness()
    const firstResult = await createPortalWorkflowFactStore(
      first.db,
    ).recordCompletedReview(command)
    const duplicate = makeHarness({ existingFactCount: 3 })
    const duplicateResult = await createPortalWorkflowFactStore(
      duplicate.db,
    ).recordCompletedReview(command)

    expect(duplicateResult.status).toBe('duplicate')
    expect(firstResult.events).toHaveLength(3)
    expect(duplicateResult.events).toEqual([])
    expect(duplicate.tx.update).not.toHaveBeenCalled()
    expect(duplicate.outboxRows).toHaveLength(0)
  })

  it('rejects a partial semantic fact set without advancing the Portal revision', async () => {
    const partial = makeHarness({ existingFactCount: 1 })

    await expect(
      createPortalWorkflowFactStore(partial.db).recordCompletedReview(command),
    ).rejects.toThrow('partial Portal workflow fact set detected')
    expect(partial.tx.update).not.toHaveBeenCalled()
    expect(partial.outboxRows).toHaveLength(0)
  })

  it('links every corrected fact to its exact superseded source event', async () => {
    const harness = makeHarness()
    const store = createPortalWorkflowFactStore(harness.db)

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
