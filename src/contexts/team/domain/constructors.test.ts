import { describe, it, expect } from 'vitest'
import { buildTeam } from './constructors'
import { teamId, organizationId, propertyId, userId } from '#/shared/domain/ids'

const FIXED_ID = teamId('00000000-0000-0000-0000-000000000001')
const FIXED_ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const FIXED_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const FIXED_USER = userId('user-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')

describe('buildTeam', () => {
  it('builds a team with required fields', () => {
    const result = buildTeam({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      propertyId: FIXED_PROPERTY,
      name: 'Front Desk',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const team = result.value
      expect(team.name).toBe('Front Desk')
      expect(team.description).toBeNull()
      expect(team.teamLeadId).toBeNull()
      expect(team.deletedAt).toBeNull()
      expect(team.createdAt).toBe(FIXED_TIME)
    }
  })

  it('builds a team with all optional fields', () => {
    const result = buildTeam({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      propertyId: FIXED_PROPERTY,
      name: 'Housekeeping',
      description: 'Room cleaning team',
      teamLeadId: FIXED_USER,
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const team = result.value
      expect(team.name).toBe('Housekeeping')
      expect(team.description).toBe('Room cleaning team')
      expect(team.teamLeadId).toBe(FIXED_USER)
    }
  })

  it('rejects empty name', () => {
    const result = buildTeam({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      propertyId: FIXED_PROPERTY,
      name: '',
      now: FIXED_TIME,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('trims name whitespace', () => {
    const result = buildTeam({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      propertyId: FIXED_PROPERTY,
      name: '  Maintenance  ',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.name).toBe('Maintenance')
  })
})
