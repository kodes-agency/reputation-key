import { describe, expect, it } from 'vitest'
import {
  assertRailwayDataCellTarget,
  parseRailwayLinkedTarget,
} from './railway-data-cell-plan'

describe('Railway Data Cell plan target', () => {
  it('accepts only the exact linked environment for the requested Data Cell', () => {
    expect(
      assertRailwayDataCellTarget('europe', {
        project: 'project-id',
        name: 'reputation-key',
        environment: 'environment-id',
        environmentName: 'cell-europe',
      }),
    ).toEqual({
      cell: 'europe',
      environment: 'cell-europe',
      environmentId: 'environment-id',
      projectId: 'project-id',
    })
  })

  it('parses the non-secret target identity from Railway status', () => {
    expect(
      parseRailwayLinkedTarget(`
Project:         reputation-key
Project ID:      project-id

Environment:     cell-europe
Environment ID:  environment-id
`),
    ).toEqual({
      project: 'project-id',
      name: 'reputation-key',
      environment: 'environment-id',
      environmentName: 'cell-europe',
    })
  })

  it('refuses a plausible plan when the repository is linked to another cell', () => {
    expect(() =>
      assertRailwayDataCellTarget('europe', {
        project: 'project-id',
        name: 'reputation-key',
        environment: 'environment-id',
        environmentName: 'cell-us',
      }),
    ).toThrow(
      'Railway Data Cell environment mismatch: expected cell-europe, linked cell-us',
    )
  })

  it('refuses a linked project with the expected environment name', () => {
    expect(() =>
      assertRailwayDataCellTarget('us', {
        project: 'other-project-id',
        name: 'lookalike-project',
        environment: 'environment-id',
        environmentName: 'cell-us',
      }),
    ).toThrow('Railway project mismatch')
  })
})
