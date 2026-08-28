import { describe, expect, it } from 'vitest'
import {
  APPROVED_CORRELATION_FIELDS,
  BANNED_LOG_KEYS,
  isBannedLogKey,
  labelValueAllowed,
  METRIC_DEFINITIONS,
  QUEUE_NAMES,
  registeredSnapshotPaths,
} from './metrics-schema'

describe('metrics-schema registry', () => {
  it('has unique metric names', () => {
    const names = METRIC_DEFINITIONS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(0)
  })

  it('every definition has a kind, unit, and description', () => {
    for (const d of METRIC_DEFINITIONS) {
      expect(['counter', 'gauge']).toContain(d.kind)
      expect(['count', 'ms', 'seconds', 'info']).toContain(d.unit)
      expect(d.description.length).toBeGreaterThan(0)
    }
  })

  it('snapshot paths resolve to registered names', () => {
    const paths = registeredSnapshotPaths()
    expect(paths.size).toBeGreaterThan(0)
    for (const p of paths) expect(p).toMatch(/^[a-zA-Z][a-zA-Z0-9.*[\]]*$/)
  })

  it('registers every immediate-email source-clock acceptance signal', () => {
    const definitions = METRIC_DEFINITIONS.filter((definition) =>
      definition.name.startsWith('notification.email.immediate_acceptance_'),
    )

    expect(
      definitions.map((definition) => [definition.name, definition.snapshotPath]),
    ).toEqual([
      [
        'notification.email.immediate_acceptance_pending',
        ['notifications.deliveryLag.immediateEmailAcceptance.awaitingProviderAcceptance'],
      ],
      [
        'notification.email.immediate_acceptance_attempted_pending',
        [
          'notifications.deliveryLag.immediateEmailAcceptance.attemptedAwaitingProviderAcceptance',
        ],
      ],
      [
        'notification.email.immediate_acceptance_oldest_source_age_ms',
        ['notifications.deliveryLag.immediateEmailAcceptance.oldestAwaitingSourceAgeMs'],
      ],
      [
        'notification.email.immediate_acceptance_p99_ms',
        ['notifications.deliveryLag.immediateEmailAcceptance.acceptedLatencyP99Ms'],
      ],
      [
        'notification.email.immediate_acceptance_sample_count',
        ['notifications.deliveryLag.immediateEmailAcceptance.acceptedSampleCount'],
      ],
      [
        'notification.email.immediate_acceptance_source_unlinked',
        ['notifications.deliveryLag.immediateEmailAcceptance.sourceUnlinked'],
      ],
      [
        'notification.email.immediate_acceptance_saturated',
        ['notifications.deliveryLag.immediateEmailAcceptance.saturated'],
      ],
    ])
  })

  it('labelValueAllowed enforces closed sets and patterns', () => {
    const queueLabel = { values: QUEUE_NAMES }
    expect(labelValueAllowed(queueLabel, 'default')).toBe(true)
    expect(labelValueAllowed(queueLabel, 'tenant-123')).toBe(false)
    expect(
      labelValueAllowed({ pattern: /^[a-z]+\.[a-zA-Z]+$/ }, 'review.rejectReply'),
    ).toBe(true)
    expect(labelValueAllowed({ pattern: /^[a-z]+\.[a-zA-Z]+$/ }, 'has space')).toBe(false)
  })
})

describe('label policy', () => {
  it('approved correlation fields are exactly requestId + correlationId', () => {
    expect([...APPROVED_CORRELATION_FIELDS]).toEqual(['requestId', 'correlationId'])
  })

  it('approved correlation fields are never banned', () => {
    for (const f of APPROVED_CORRELATION_FIELDS) {
      expect(isBannedLogKey(f)).toBe(false)
    }
  })

  it('bans the known offender keys found by the 7.3 sweep', () => {
    for (const key of [
      'organizationId',
      'userId',
      'propertyId',
      'reviewId',
      'replyId',
      'jobId',
      'eventId',
      'connectionId',
      'jobData',
      'locationName',
      'email',
      'token',
      'password',
      'password_hash',
      'clientSecret',
      'OPENAI_API_KEY',
      'contactEmail',
      'reviewText',
      'DATABASE_URL',
    ]) {
      expect(isBannedLogKey(key), key).toBe(true)
    }
  })

  it('does not ban content-free operational fields', () => {
    for (const key of [
      'jobName',
      'queue',
      'reason',
      'duration',
      'count',
      'role',
      'useCase',
    ]) {
      expect(isBannedLogKey(key), key).toBe(false)
    }
  })

  it('has no duplicate banned keys', () => {
    expect(new Set(BANNED_LOG_KEYS).size).toBe(BANNED_LOG_KEYS.length)
  })
})
