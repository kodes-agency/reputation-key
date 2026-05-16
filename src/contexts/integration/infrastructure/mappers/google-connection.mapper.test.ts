// Integration context — Google connection mapper tests

import { describe, it, expect } from 'vitest'
import {
  googleConnectionFromRow,
  googleConnectionToInsert,
} from './google-connection.mapper'
import type { googleConnections } from '#/shared/db/schema/google-connection.schema'

type GoogleConnectionRow = typeof googleConnections.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')

const sampleRow: GoogleConnectionRow = {
  id: 'conn-uuid-001',
  organizationId: 'org-uuid-001',
  googleAccountId: 'gacct-123',
  googleEmail: 'user@example.com',
  encryptedAccessToken: 'enc-access-token',
  encryptedRefreshToken: 'enc-refresh-token',
  tokenExpiresAt: now,
  scopes: [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/plus.me',
  ],
  connectedBy: 'user-uuid-001',
  visibility: 'organization',
  status: 'active',
  createdAt: now,
  updatedAt: now,
}

describe('googleConnectionFromRow', () => {
  it('brands IDs correctly', () => {
    const conn = googleConnectionFromRow(sampleRow)
    expect(conn.id).toBe(sampleRow.id)
    expect(conn.organizationId).toBe(sampleRow.organizationId)
    expect(conn.connectedBy).toBe(sampleRow.connectedBy)
  })

  it('maps all fields', () => {
    const conn = googleConnectionFromRow(sampleRow)
    expect(conn.googleAccountId).toBe('gacct-123')
    expect(conn.googleEmail).toBe('user@example.com')
    expect(conn.encryptedAccessToken).toBe('enc-access-token')
    expect(conn.encryptedRefreshToken).toBe('enc-refresh-token')
    expect(conn.tokenExpiresAt).toBe(now)
    expect(conn.scopes).toEqual([
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/plus.me',
    ])
    expect(conn.visibility).toBe('organization')
    expect(conn.status).toBe('active')
    expect(conn.createdAt).toBe(now)
    expect(conn.updatedAt).toBe(now)
  })

  it('freezes scopes array', () => {
    const conn = googleConnectionFromRow(sampleRow)
    expect(Object.isFrozen(conn.scopes)).toBe(true)
  })

  it('handles disconnected status', () => {
    const row = { ...sampleRow, status: 'disconnected' as const }
    const conn = googleConnectionFromRow(row)
    expect(conn.status).toBe('disconnected')
  })

  it('handles private visibility', () => {
    const row = { ...sampleRow, visibility: 'private' as const }
    const conn = googleConnectionFromRow(row)
    expect(conn.visibility).toBe('private')
  })
})

describe('googleConnectionToInsert', () => {
  it('round-trips through fromRow → toInsert', () => {
    const conn = googleConnectionFromRow(sampleRow)
    const insert = googleConnectionToInsert(conn)

    expect(insert.id).toBe(sampleRow.id)
    expect(insert.organizationId).toBe(sampleRow.organizationId)
    expect(insert.googleAccountId).toBe(sampleRow.googleAccountId)
    expect(insert.googleEmail).toBe(sampleRow.googleEmail)
    expect(insert.encryptedAccessToken).toBe(sampleRow.encryptedAccessToken)
    expect(insert.encryptedRefreshToken).toBe(sampleRow.encryptedRefreshToken)
    expect(insert.tokenExpiresAt).toBe(sampleRow.tokenExpiresAt)
    expect(insert.scopes).toEqual([...sampleRow.scopes])
    expect(insert.connectedBy).toBe(sampleRow.connectedBy)
    expect(insert.visibility).toBe(sampleRow.visibility)
    expect(insert.status).toBe(sampleRow.status)
    expect(insert.createdAt).toBe(sampleRow.createdAt)
    expect(insert.updatedAt).toBe(sampleRow.updatedAt)
  })

  it('spreads frozen scopes back into a mutable array', () => {
    const conn = googleConnectionFromRow(sampleRow)
    const insert = googleConnectionToInsert(conn)
    expect(Array.isArray(insert.scopes)).toBe(true)
    expect(insert.scopes).toEqual(sampleRow.scopes)
  })
})
