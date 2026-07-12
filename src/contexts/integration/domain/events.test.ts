// Integration context — domain events tests
// Per architecture: "Events are facts, named in the past tense."

import { describe, it, expect } from 'vitest'
import { isDomainError } from '#/shared/domain/errors'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationPropertyImportCompleted,
  integrationGoogleConnectionVisibilityChanged,
} from './events'
import { googleConnectionId, gbpImportJobId, organizationId } from '#/shared/domain/ids'

const now = new Date('2025-06-15T12:00:00Z')

// ── integrationGoogleAccountConnected ──────────────────────────────────────────

describe('integrationGoogleAccountConnected', () => {
  it('sets _tag to "google_account.connected"', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      googleEmail: 'user@example.com',
      occurredAt: now,
    })
    expect(event._tag).toBe('integration.google_account.connected')
  })

  it('preserves all payload fields', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      googleEmail: 'user@example.com',
      occurredAt: now,
    })
    expect(event.connectionId).toBe(googleConnectionId('conn-1'))
    expect(event.organizationId).toBe(organizationId('org-1'))
    expect(event.googleEmail).toBe('user@example.com')
  })

  it('sets occurredAt as a Date', () => {
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      googleEmail: 'user@example.com',
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

// ── integrationPropertyImportCompleted ─────────────────────────────────────────

describe('integrationPropertyImportCompleted', () => {
  it('sets _tag to "property_import.completed"', () => {
    const event = integrationPropertyImportCompleted({
      importJobId: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      totalCount: 100,
      importedCount: 80,
      skippedCount: 15,
      failedCount: 5,
      occurredAt: now,
    })
    expect(event._tag).toBe('integration.property_import.completed')
  })

  it('preserves all payload fields including counters', () => {
    const event = integrationPropertyImportCompleted({
      importJobId: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      totalCount: 100,
      importedCount: 80,
      skippedCount: 15,
      failedCount: 5,
      occurredAt: now,
    })
    expect(event.importJobId).toBe(gbpImportJobId('job-1'))
    expect(event.totalCount).toBe(100)
    expect(event.importedCount).toBe(80)
    expect(event.skippedCount).toBe(15)
    expect(event.failedCount).toBe(5)
  })

  it('sets occurredAt as a Date', () => {
    const event = integrationPropertyImportCompleted({
      importJobId: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      totalCount: 0,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
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

// ── occurredAt validation (assertion_failed DomainError) ─────────────────────────

describe('event constructors validate occurredAt', () => {
  // All four constructors share the same guard; exercising one is sufficient since
  // the throw site + code are identical across them.
  it('throws an Error & DomainError with code "assertion_failed" when occurredAt is not a Date', () => {
    let caught: unknown
    try {
      integrationGoogleAccountConnected({
        connectionId: googleConnectionId('conn-1'),
        organizationId: organizationId('org-1'),
        googleEmail: 'user@example.com',
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

  it('rejects a null occurredAt across the import-completed constructor', () => {
    expect(() =>
      integrationPropertyImportCompleted({
        importJobId: gbpImportJobId('job-1'),
        organizationId: organizationId('org-1'),
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        occurredAt: null as unknown as Date,
      }),
    ).toThrow()
  })
})
