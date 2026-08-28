import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/outbox', () => ({ registerConsumer: mocks.registerConsumer }))
vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

import type { CurrentGoogleReputationSnapshotStore } from '../application/ports/current-google-reputation-snapshot.port'
import {
  handleCurrentGoogleReputationSnapshot,
  registerCurrentGoogleReputationConsumer,
} from './current-google-reputation-outbox-consumers'

const evaluatedAt = '2026-08-28T05:00:00.000Z'
const payload = {
  organizationId: 'current-google-test-org',
  propertyId: '55000000-0000-4000-8000-000000000001',
  sourceEpoch: 2,
  runId: '55000000-0000-4000-8000-000000000002',
  reviewCount: 17,
  averageRating: 4.7,
  evaluatedAt,
  sourceAggregateVersion: evaluatedAt,
}
const envelope = (overrides: Record<string, unknown> = {}) => ({
  eventId: '55000000-0000-4000-8000-000000000003',
  eventType: 'review.google_reputation_snapshot.verified',
  eventVersion: 1,
  payload,
  organizationId: payload.organizationId,
  propertyId: payload.propertyId,
  sourceContext: 'review',
  sourceAggregateId: payload.runId,
  occurredAt: evaluatedAt,
  sourceAggregateVersion: evaluatedAt,
  ...overrides,
})

const store = (
  outcome: 'applied' | 'duplicate' | 'obsolete' = 'applied',
): CurrentGoogleReputationSnapshotStore => ({
  applyVerifiedSnapshot: vi.fn(async () => outcome),
  getCurrentOnGoogle: vi.fn(async () => null),
})

describe('Current on Google durable consumer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers the distinct verified-snapshot event and projects its exact fact', async () => {
    const snapshots = store()
    registerCurrentGoogleReputationConsumer(snapshots)
    const registration = mocks.registerConsumer.mock.calls[0]?.[0]

    expect(registration).toMatchObject({
      eventType: 'review.google_reputation_snapshot.verified',
      consumerName: 'metric.current-google-reputation',
      module: 'metric.current-google-reputation',
    })
    await expect(registration.handler(envelope())).resolves.toEqual({
      status: 'applied',
    })
    expect(snapshots.applyVerifiedSnapshot).toHaveBeenCalledWith({
      eventId: '55000000-0000-4000-8000-000000000003',
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      sourceEpoch: 2,
      runId: payload.runId,
      reviewCount: 17,
      averageRating: 4.7,
      evaluatedAt: new Date(evaluatedAt),
    })
  })

  it.each(['duplicate', 'obsolete'] as const)(
    'preserves the store %s classification',
    async (outcome) => {
      await expect(
        handleCurrentGoogleReputationSnapshot(
          store(outcome),
          envelope() as Parameters<typeof handleCurrentGoogleReputationSnapshot>[1],
        ),
      ).resolves.toEqual({ status: outcome })
    },
  )

  it('fails closed on envelope attribution, authority, or version drift', async () => {
    const snapshots = store()
    await expect(
      handleCurrentGoogleReputationSnapshot(
        snapshots,
        envelope({ organizationId: 'other-org' }) as Parameters<
          typeof handleCurrentGoogleReputationSnapshot
        >[1],
      ),
    ).rejects.toThrow('attribution')
    await expect(
      handleCurrentGoogleReputationSnapshot(
        snapshots,
        envelope({ sourceAggregateId: 'another-run' }) as Parameters<
          typeof handleCurrentGoogleReputationSnapshot
        >[1],
      ),
    ).rejects.toThrow('source authority')
    await expect(
      handleCurrentGoogleReputationSnapshot(
        snapshots,
        envelope({ sourceAggregateVersion: '2026-08-28T04:59:59.000Z' }) as Parameters<
          typeof handleCurrentGoogleReputationSnapshot
        >[1],
      ),
    ).rejects.toThrow('source version')
    expect(snapshots.applyVerifiedSnapshot).not.toHaveBeenCalled()
  })
})
