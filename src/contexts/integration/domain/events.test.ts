// Integration context — domain events tests
// Per architecture: "Events are facts, named in the past tense."

import { describe, it, expect } from 'vitest'
import {
  googleAccountConnected,
  googleAccountDisconnected,
  propertyImportCompleted,
  googleConnectionVisibilityChanged,
} from './events'
import { googleConnectionId, gbpImportJobId, organizationId } from '#/shared/domain/ids'

const now = new Date('2025-06-15T12:00:00Z')

// ── googleAccountConnected ──────────────────────────────────────────

describe('googleAccountConnected', () => {
  it('sets _tag to "google_account.connected"', () => {
    const event = googleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      googleEmail: 'user@example.com',
      occurredAt: now,
    })
    expect(event._tag).toBe('google_account.connected')
  })

  it('preserves all payload fields', () => {
    const event = googleAccountConnected({
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
    const event = googleAccountConnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      googleEmail: 'user@example.com',
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt).toBe(now)
  })
})

// ── googleAccountDisconnected ───────────────────────────────────────

describe('googleAccountDisconnected', () => {
  it('sets _tag to "google_account.disconnected"', () => {
    const event = googleAccountDisconnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      occurredAt: now,
    })
    expect(event._tag).toBe('google_account.disconnected')
  })

  it('preserves connectionId and organizationId', () => {
    const event = googleAccountDisconnected({
      connectionId: googleConnectionId('conn-2'),
      organizationId: organizationId('org-2'),
      occurredAt: now,
    })
    expect(event.connectionId).toBe(googleConnectionId('conn-2'))
    expect(event.organizationId).toBe(organizationId('org-2'))
  })

  it('sets occurredAt as a Date', () => {
    const event = googleAccountDisconnected({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt).toBe(now)
  })
})

// ── propertyImportCompleted ─────────────────────────────────────────

describe('propertyImportCompleted', () => {
  it('sets _tag to "property_import.completed"', () => {
    const event = propertyImportCompleted({
      importJobId: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      totalCount: 100,
      importedCount: 80,
      skippedCount: 15,
      failedCount: 5,
      occurredAt: now,
    })
    expect(event._tag).toBe('property_import.completed')
  })

  it('preserves all payload fields including counters', () => {
    const event = propertyImportCompleted({
      importJobId: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      totalCount: 100,
      importedCount: 80,
      skippedCount: 15,
      failedCount: 5,
      occurredAt: now,
    })
    expect(event.importJobId).toBe(gbpImportJobId('job-1'))
    expect(event.organizationId).toBe(organizationId('org-1'))
    expect(event.totalCount).toBe(100)
    expect(event.importedCount).toBe(80)
    expect(event.skippedCount).toBe(15)
    expect(event.failedCount).toBe(5)
  })

  it('sets occurredAt as a Date', () => {
    const event = propertyImportCompleted({
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

// ── googleConnectionVisibilityChanged ───────────────────────────────

describe('googleConnectionVisibilityChanged', () => {
  it('sets _tag to "google_connection.visibility_changed"', () => {
    const event = googleConnectionVisibilityChanged({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      visibility: 'organization',
      occurredAt: now,
    })
    expect(event._tag).toBe('google_connection.visibility_changed')
  })

  it('preserves all payload fields', () => {
    const event = googleConnectionVisibilityChanged({
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
    const event = googleConnectionVisibilityChanged({
      connectionId: googleConnectionId('conn-1'),
      organizationId: organizationId('org-1'),
      visibility: 'organization',
      occurredAt: now,
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
  })
})
