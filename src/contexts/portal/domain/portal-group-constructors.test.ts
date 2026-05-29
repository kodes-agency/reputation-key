// Portal context — PortalGroup domain constructors tests
import { describe, it, expect } from 'vitest'
import { buildPortalGroup } from './portal-group-constructors'
import { portalGroupId, organizationId, propertyId } from '#/shared/domain/ids'

describe('buildPortalGroup', () => {
  const validInput = {
    id: portalGroupId('550e8400-e29b-41d4-a716-446655440000'),
    organizationId: organizationId('org_abc123'),
    propertyId: propertyId('660e8400-e29b-41d4-a716-446655440001'),
    name: 'Reception Team',
    now: new Date('2026-01-15T10:00:00Z'),
  }

  it('builds a valid portal group', () => {
    const result = buildPortalGroup(validInput)
    expect(result.isOk()).toBe(true)
    const group = result._unsafeUnwrap()
    expect(group.id).toBe(validInput.id)
    expect(group.organizationId).toBe(validInput.organizationId)
    expect(group.propertyId).toBe(validInput.propertyId)
    expect(group.name).toBe('Reception Team')
    expect(group.createdAt).toBe(validInput.now)
    expect(group.updatedAt).toBe(validInput.now)
  })

  it('trims whitespace from name', () => {
    const result = buildPortalGroup({ ...validInput, name: '  Lobby  ' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().name).toBe('Lobby')
  })

  it('rejects empty name', () => {
    const result = buildPortalGroup({ ...validInput, name: '' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
      expect(result.error.message).toBe('Group name is required')
    }
  })

  it('rejects whitespace-only name', () => {
    const result = buildPortalGroup({ ...validInput, name: '   ' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('rejects name over 100 characters', () => {
    const result = buildPortalGroup({ ...validInput, name: 'A'.repeat(101) })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
      expect(result.error.message).toBe('Group name must be at most 100 characters')
    }
  })

  it('accepts name at exactly 100 characters', () => {
    const result = buildPortalGroup({ ...validInput, name: 'A'.repeat(100) })
    expect(result.isOk()).toBe(true)
  })
})
