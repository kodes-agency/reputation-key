import { describe, expect, it } from 'vitest'
import { teamFromRow, teamToRow } from './team.mapper'
import type { Team } from '../../domain/types'
import { organizationId, propertyId, teamId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makeTeamRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'team-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  name: 'Alpha Team',
  description: 'The first team',
  teamLeadId: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
  id: teamId('team-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  name: 'Alpha Team',
  description: 'The first team',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

describe('team mapper', () => {
  it('maps the team aggregate without reading the legacy lead shortcut', () => {
    const team = teamFromRow(makeTeamRow({ teamLeadId: 'legacy-user' }))
    expect(team).toEqual(makeTeam())
    expect(team).not.toHaveProperty('teamLeadId')
  })

  it('does not write the legacy lead shortcut', () => {
    const row = teamToRow(makeTeam())
    expect(row).not.toHaveProperty('teamLeadId')
  })

  it('round-trips nullable description and deletion history', () => {
    const deletedAt = new Date('2026-04-11T00:00:00Z')
    const team = makeTeam({ description: null, deletedAt })
    const restored = teamFromRow({
      ...makeTeamRow(),
      ...teamToRow(team),
      teamLeadId: null,
    })
    expect(restored).toEqual(team)
  })
})
