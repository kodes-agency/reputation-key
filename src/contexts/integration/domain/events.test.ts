// Integration context — domain events tests
// Per architecture: "Events are facts, named in the past tense."

import { describe, it, expect } from 'vitest'
import { isDomainError } from '#/shared/domain/errors'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
  integrationGoogleConnectionVisibilityChanged,
  integrationGoogleReviewPushAccepted,
  integrationPropertyImportRequested,
  integrationPropertyImportRetentionReleased,
} from './events'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'

const now = new Date('2025-06-15T12:00:00Z')

// ── integrationGoogleAccountConnected ──────────────────────────────────────────

describe('integrationGoogleAccountConnected', () => {
  it('sets _tag to "google_account.connected"', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      occurredAt: now,
    })
    expect(event._tag).toBe('integration.google_account.connected')
  })

  it('preserves all payload fields', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      occurredAt: now,
    })
    expect(event.connectionId).toBe(googleConnectionId('conn-1'))
    expect(event.organizationId).toBe(organizationId('org-1'))
    expect(event.userId).toBe(userId('user-1'))
    expect(Object.keys(event).sort()).toEqual([
      '_tag',
      'connectionId',
      'correlationId',
      'eventId',
      'occurredAt',
      'organizationId',
      'userId',
    ])
  })

  it('sets occurredAt as a Date', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      userId: userId('user-1'),
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt).toBe(now)
  })
})

// ── integrationGoogleAccountDisconnected ───────────────────────────────────────

describe('integrationGoogleAccountDisconnected', () => {
  it('sets _tag to "google_account.disconnected"', () => {
    const event = integrationGoogleAccountDisconnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      occurredAt: now,
    })
    expect(event._tag).toBe('integration.google_account.disconnected')
  })

  it('preserves connectionId and organizationId', () => {
    const event = integrationGoogleAccountDisconnected({
      connectionId: googleConnectionId('conn-2'),
      organizationId: organizationId('org-2'),
      occurredAt: now,
    })
    expect(event.connectionId).toBe(googleConnectionId('conn-2'))
    expect(event.organizationId).toBe(organizationId('org-2'))
  })

  it('sets occurredAt as a Date', () => {
    const event = integrationGoogleAccountDisconnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt).toBe(now)
  })
})

// ── integrationGoogleConnectionVisibilityChanged ───────────────────────────────

describe('integrationGoogleConnectionVisibilityChanged', () => {
  it('sets _tag to "google_connection.visibility_changed"', () => {
    const event = integrationGoogleConnectionVisibilityChanged({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      visibility: 'organization',
      occurredAt: now,
    })
    expect(event._tag).toBe('integration.google_connection.visibility_changed')
  })

  it('preserves all payload fields', () => {
    const event = integrationGoogleConnectionVisibilityChanged({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      visibility: 'private',
      occurredAt: now,
    })
    expect(event.connectionId).toBe(googleConnectionId('conn-1'))
    expect(event.organizationId).toBe(organizationId('org-1'))
    expect(event.visibility).toBe('private')
  })

  it('sets occurredAt as a Date', () => {
    const event = integrationGoogleConnectionVisibilityChanged({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      visibility: 'organization',
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
  })
})

describe('integrationPropertyImportRetentionReleased', () => {
  it('creates a bounded identifier-only release event', () => {
    const idempotencyKeys = ['40000000-0000-4000-8000-000000000001']
    const event = integrationPropertyImportRetentionReleased({
      organizationId: organizationId('org-1'),
      importJobId: '40000000-0000-4000-8000-000000000000',
      idempotencyKeys,
      occurredAt: now,
    })
    expect(event).toMatchObject({
      _tag: 'integration.property_import.retention_released',
      organizationId: 'org-1',
      importJobId: '40000000-0000-4000-8000-000000000000',
      idempotencyKeys,
      occurredAt: now,
      correlationId: null,
    })
  })

  it('rejects duplicate or oversized release sets', () => {
    expect(() =>
      integrationPropertyImportRetentionReleased({
        organizationId: organizationId('org-1'),
        importJobId: '40000000-0000-4000-8000-000000000000',
        idempotencyKeys: ['same', 'same'],
        occurredAt: now,
      }),
    ).toThrow('1..100 unique')
    expect(() =>
      integrationPropertyImportRetentionReleased({
        organizationId: organizationId('org-1'),
        importJobId: '40000000-0000-4000-8000-000000000000',
        idempotencyKeys: Array.from({ length: 101 }, (_, index) => `key-${index}`),
        occurredAt: now,
      }),
    ).toThrow('1..100 unique')
  })
})

describe('correlation', () => {
  it('preserves caller correlation across every constructor', () => {
    const correlationId = 'correlation-1'
    const connectionId = googleConnectionId('connection-1')
    const organization = organizationId('organization-1')
    const correlated = [
      integrationPropertyImportRequested({
        organizationId: organization,
        importJobId: 'import-1',
        occurredAt: now,
        correlationId,
      }),
      integrationGoogleAccountConnected({
        connectionId,
        organizationId: organization,
        userId: userId('user-1'),
        occurredAt: now,
        correlationId,
      }),
      integrationGoogleAccountDisconnected({
        connectionId,
        organizationId: organization,
        occurredAt: now,
        correlationId,
      }),
      integrationGoogleAccountReauthorizationRequired({
        connectionId,
        organizationId: organization,
        cause: 'member_removed',
        occurredAt: now,
        correlationId,
      }),
      integrationGoogleConnectionVisibilityChanged({
        connectionId,
        organizationId: organization,
        visibility: 'organization',
        occurredAt: now,
        correlationId,
      }),
      integrationPropertyImportRetentionReleased({
        organizationId: organization,
        importJobId: 'import-1',
        idempotencyKeys: ['key-1'],
        occurredAt: now,
        correlationId,
      }),
      integrationGoogleReviewPushAccepted({
        organizationId: organization,
        propertyId: 'property-1',
        connectionId,
        sourceEpoch: 1,
        referenceRef: null,
        notificationKind: 'REVIEW_CHANGED',
        occurredAt: now,
        correlationId,
      }),
    ]

    expect(correlated.map((event) => event.correlationId)).toEqual(
      Array.from({ length: correlated.length }, () => correlationId),
    )
  })
})

// ── occurredAt validation (assertion_failed DomainError) ─────────────────────────

describe('event constructors validate occurredAt', () => {
  // All constructors share the same occurredAt guard; exercising one is
  // sufficient because the throw site and error code are identical.
  it('throws an Error & DomainError with code "assertion_failed" when occurredAt is not a Date', () => {
    let caught: unknown
    try {
      integrationGoogleAccountConnected({
        connectionId: googleConnectionId('conn-1'),
        organizationId: organizationId('org-1'),
        userId: userId('user-1'),
        occurredAt: '2025-06-15' as unknown as Date,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    if (isDomainError(caught)) {
      expect(caught.code).toBe('assertion_failed')
    } else {
      expect.fail('expected a DomainError')
    }
  })
})
