import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/outbox/dispatcher', () => ({
  registerConsumer: mocks.registerConsumer,
}))
vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

import { registerMetricCorrectionConsumer } from './correction-outbox-consumers'

const payload = {
  correctionId: 'correction-1',
  correctedReadingId: 'reading-1',
  replacementReadingId: 'reading-2',
  organizationId: 'org-1',
  propertyId: 'property-1',
  definitionVersionId: 'definition-version-1',
  sourceEventId: 'source-event-2',
  supersededSourceEventId: 'source-event-1',
  occurredAt: '2026-08-16T12:00:00.000Z',
}

function registrationWithDatabase() {
  const onConflictDoUpdate = vi.fn(async () => undefined)
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  registerMetricCorrectionConsumer({ insert } as unknown as Database)
  const registration = mocks.registerConsumer.mock.calls[0]?.[0] as {
    eventType: string
    consumerName: string
    handler: (event: {
      eventVersion: number
      organizationId: string
      propertyId: string
      payload: unknown
    }) => Promise<{ status: string }>
  }
  return { registration, insert, values, onConflictDoUpdate }
}

describe('registerMetricCorrectionConsumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateEventPayload.mockImplementation(
      (_type: string, _version: number, value: unknown) => value,
    )
  })

  it('registers the stable metric correction consumer identity', () => {
    const { registration } = registrationWithDatabase()

    expect(registration).toMatchObject({
      eventType: 'metric.corrected',
      consumerName: 'metric.correction-reconciliation',
    })
  })

  it('validates attribution and advances the scoped source watermark monotonically', async () => {
    const { registration, insert, values, onConflictDoUpdate } =
      registrationWithDatabase()

    await expect(
      registration.handler({
        eventVersion: 1,
        organizationId: 'org-1',
        propertyId: 'property-1',
        payload,
      }),
    ).resolves.toEqual({ status: 'applied' })
    expect(mocks.validateEventPayload).toHaveBeenCalledWith(
      'metric.corrected',
      1,
      payload,
    )
    expect(insert).toHaveBeenCalledOnce()
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerName: 'metric.correction-reconciliation',
        organizationId: 'org-1',
        propertyId: 'property-1',
        definitionVersionId: 'definition-version-1',
        lastSourceEventId: 'source-event-2',
        lastEventAt: new Date(payload.occurredAt),
      }),
    )
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ lastSourceEventId: 'source-event-2' }),
        setWhere: expect.anything(),
      }),
    )
  })

  it('rejects envelope attribution mismatch before persistence', async () => {
    const { registration, insert } = registrationWithDatabase()

    await expect(
      registration.handler({
        eventVersion: 1,
        organizationId: 'other-org',
        propertyId: 'property-1',
        payload,
      }),
    ).rejects.toThrow('metric correction envelope attribution mismatch')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects an invalid occurrence timestamp before persistence', async () => {
    const { registration, insert } = registrationWithDatabase()

    await expect(
      registration.handler({
        eventVersion: 1,
        organizationId: 'org-1',
        propertyId: 'property-1',
        payload: { ...payload, occurredAt: 'not-a-date' },
      }),
    ).rejects.toThrow('metric correction occurredAt is invalid')
    expect(insert).not.toHaveBeenCalled()
  })
})
