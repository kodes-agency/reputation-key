import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS,
  contextOrganizationLifecycleReceipts,
} from './context-organization-lifecycle-receipts.schema'

const config = getTableConfig(contextOrganizationLifecycleReceipts)

function checkExpression(name: string): string {
  const found = config.checks.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing check constraint ${name}`)
  return found.value.queryChunks
    .map((chunk) =>
      typeof chunk === 'object' && chunk !== null && 'value' in chunk
        ? String((chunk as { value: unknown }).value)
        : String(chunk),
    )
    .join('')
}

describe('shared context Organization lifecycle receipts schema', () => {
  it('keys a receipt by context plus lineage, revision and phase', () => {
    expect(config.name).toBe('context_organization_lifecycle_receipts')
    expect(config.primaryKeys.map((candidate) => candidate.getName())).toEqual([
      'context_organization_lifecycle_receipts_pk',
    ])
    expect(config.primaryKeys[0]!.columns.map((column) => column.name)).toEqual([
      'context',
      'closure_lineage_id',
      'lifecycle_revision',
      'phase',
    ])
  })

  it('enumerates exactly the 17 ORGANIZATION_LIFECYCLE_CONTEXTS values', () => {
    // shared/** may not import a context domain module, so the list is
    // duplicated. This assertion is what stops the duplicate from drifting.
    expect([...CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS]).toEqual([
      ...ORGANIZATION_LIFECYCLE_CONTEXTS,
    ])
    expect(CONTEXT_LIFECYCLE_RECEIPT_CONTEXTS).toHaveLength(17)

    const expression = checkExpression(
      'context_organization_lifecycle_receipts_context_valid',
    )
    for (const context of ORGANIZATION_LIFECYCLE_CONTEXTS) {
      expect(expression).toContain(`'${context}'`)
    }
    expect(expression.match(/'[a-z_]+'/gu)).toHaveLength(
      ORGANIZATION_LIFECYCLE_CONTEXTS.length,
    )
  })

  it('accepts only affirmative content-free outcomes', () => {
    expect(
      checkExpression('context_organization_lifecycle_receipts_outcome_valid'),
    ).toContain("IN ('complete', 'no_data')")
    expect(
      checkExpression('context_organization_lifecycle_receipts_phase_valid'),
    ).toContain("IN ('closing', 'purge_readiness', 'purge')")
    expect(
      checkExpression('context_organization_lifecycle_receipts_evidence_valid'),
    ).toContain("~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'")
    expect(
      checkExpression('context_organization_lifecycle_receipts_fingerprint_valid'),
    ).toContain("~ '^[a-f0-9]{64}$'")
  })

  it('holds no content and no foreign key to organization', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'context',
      'organization_id',
      'closure_lineage_id',
      'lifecycle_revision',
      'phase',
      'request_fingerprint',
      'outcome',
      'evidence_ref',
      'recoverable_until',
      'occurred_at',
      'created_at',
    ])
    // Closure evidence must survive removal of the Better Auth Organization
    // row, so the table deliberately carries no referential dependency on it.
    expect(config.foreignKeys).toEqual([])
  })
})
