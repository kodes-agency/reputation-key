import { describe, expect, it } from 'vitest'
import { parseRailwayPlanEvidence } from '../../src/shared/release/railway-plan-evidence'
import {
  assertRailwayDataCellTarget,
  buildRailwayPlanEvidenceFiles,
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

describe('Railway Data Cell plan evidence files', () => {
  const input = {
    outputPath: '/evidence/cell-europe-plan.json',
    capturedAt: new Date('2026-08-27T09:00:00.000Z'),
    cell: 'europe',
    target: {
      projectId: 'project-id',
      environment: 'cell-europe',
      environmentId: 'environment-id',
    },
    iacSha256: 'b'.repeat(64),
    exitCode: 2,
    rawPlan: JSON.stringify({
      changes: [{ action: 'update', name: 'web', value: 'postgres://u:pw@host/db' }],
    }),
  } as const

  it('emits parseable canonical evidence beside a shasum-compatible sidecar', () => {
    const files = buildRailwayPlanEvidenceFiles(input)
    const parsed = parseRailwayPlanEvidence(files.content)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.evidence.plan.outcome).toBe('pending-changes')
    expect(parsed.digest).toBe(files.digest)
    expect(files.sidecarPath).toBe('/evidence/cell-europe-plan.json.sha256')
    expect(files.sidecarContent).toBe(`${files.digest}  cell-europe-plan.json\n`)
  })

  it('never writes a plan value in plaintext', () => {
    const files = buildRailwayPlanEvidenceFiles(input)

    expect(files.content).not.toContain('postgres://u:pw@host/db')
    expect(files.content).not.toContain('pw')
    expect(files.content).toContain('"name":"web"')
  })

  it('refuses to render evidence for a plan exit that blocks promotion', () => {
    expect(() => buildRailwayPlanEvidenceFiles({ ...input, exitCode: 1 })).toThrow(
      'Railway plan exit 1 blocks promotion',
    )
  })
})
