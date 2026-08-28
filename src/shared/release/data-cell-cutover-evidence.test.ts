import { describe, expect, it } from 'vitest'
import {
  canonicalDataCellCutoverEvidence,
  createDataCellCutoverEvidence,
  parseDataCellCutoverEvidence,
} from './data-cell-cutover-evidence'

const DIGEST = 'a'.repeat(64)

describe('Data Cell cutover evidence', () => {
  it('creates canonical completed, zero-error release evidence', () => {
    const evidence = createDataCellCutoverEvidence({
      capturedAt: new Date('2026-08-27T12:01:00.000Z'),
      completedAt: new Date('2026-08-27T12:00:00.000Z'),
      reportDigestSha256: DIGEST,
      completionDigestSha256: 'b'.repeat(64),
      propertiesProcessed: 7,
      credentialHomesProcessed: 3,
      credentialConnectionsProcessed: 8,
      errorCount: 0,
      verification: {
        remainingProperties: 0,
        resolvablePropertiesRemaining: 0,
        remainingCredentialHomes: 0,
        activeWorkflowBlockers: 2,
        routingConflicts: 0,
      },
      targetProjectId: 'railway-project-us-test',
      targetEnvironmentId: 'railway-environment-us-test',
      operatorId: 'operator@example.com',
      changeTicket: 'OPS-57',
      correlationId: 'correlation-57',
    })
    const canonical = canonicalDataCellCutoverEvidence(evidence)
    expect(parseDataCellCutoverEvidence(canonical)).toMatchObject({
      ok: true,
      evidence: {
        state: 'completed',
        target: {
          cell: 'us',
          policyVersion: 3,
          projectId: 'railway-project-us-test',
          environmentId: 'railway-environment-us-test',
        },
        progress: { credentialConnectionsProcessed: 8 },
        verification: {
          remainingProperties: 0,
          resolvablePropertiesRemaining: 0,
          remainingCredentialHomes: 0,
          activeWorkflowBlockers: 2,
          routingConflicts: 0,
        },
      },
    })
  })

  it('refuses evidence with errors or non-canonical JSON', () => {
    expect(() =>
      createDataCellCutoverEvidence({
        capturedAt: new Date('2026-08-27T12:01:00.000Z'),
        completedAt: new Date('2026-08-27T12:00:00.000Z'),
        reportDigestSha256: DIGEST,
        completionDigestSha256: 'b'.repeat(64),
        propertiesProcessed: 1,
        credentialHomesProcessed: 1,
        credentialConnectionsProcessed: 1,
        errorCount: 1,
        verification: {
          remainingProperties: 0,
          resolvablePropertiesRemaining: 0,
          remainingCredentialHomes: 0,
          activeWorkflowBlockers: 0,
          routingConflicts: 0,
        },
        targetProjectId: 'railway-project-us-test',
        targetEnvironmentId: 'railway-environment-us-test',
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-57',
      }),
    ).toThrow(/Invalid input: expected 0/)
    expect(parseDataCellCutoverEvidence('{}\n')).toMatchObject({ ok: false })
  })
})
