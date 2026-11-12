import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  BACKUP_ERASURE_LEDGER_CONTEXTS,
  BACKUP_ERASURE_SUBJECT_CLASSES,
  backupErasureLedger,
} from './backup-erasure-ledger.schema'

const config = getTableConfig(backupErasureLedger)

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

describe('backup erasure ledger schema (LIF-01-T15)', () => {
  it('records a content-free erasure and nothing else', () => {
    expect(config.name).toBe('backup_erasure_ledger')
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'subject_class',
      'organization_id',
      'property_id',
      'subject_ref',
      'context',
      'closure_lineage_id',
      'lifecycle_revision',
      'effective_erasure_at',
      'erased_row_count',
      'evidence_ref',
      'hold_reference',
      'created_at',
    ])
  })

  it('has no foreign key to organization or properties', () => {
    // An entry exists precisely because its subject was destroyed. A
    // referential dependency would cascade away the evidence that stops a
    // restore from resurrecting it.
    expect(config.foreignKeys).toEqual([])
  })

  it('forbids free text in every reference column', () => {
    expect(checkExpression('backup_erasure_ledger_evidence_valid')).toContain(
      "~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'",
    )
    expect(checkExpression('backup_erasure_ledger_hold_valid')).toContain(
      "~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'",
    )
    expect(checkExpression('backup_erasure_ledger_subject_ref_valid')).toContain(
      "~ '^[a-f0-9]{64}$'",
    )
    const textish = config.columns.filter(
      (column) => column.columnType === 'PgVarchar' || column.columnType === 'PgText',
    )
    // Every free-form-capable column is either an identifier we own or is
    // pinned by one of the regex checks above.
    expect(textish.map((column) => column.name)).toEqual([
      'subject_class',
      'organization_id',
      'context',
      'evidence_ref',
      'hold_reference',
    ])
  })

  it('enumerates exactly the 17 ORGANIZATION_LIFECYCLE_CONTEXTS values', () => {
    expect([...BACKUP_ERASURE_LEDGER_CONTEXTS]).toEqual([
      ...ORGANIZATION_LIFECYCLE_CONTEXTS,
    ])
    const expression = checkExpression('backup_erasure_ledger_context_valid')
    for (const context of ORGANIZATION_LIFECYCLE_CONTEXTS) {
      expect(expression).toContain(`'${context}'`)
    }
  })

  it('constrains the subject shape so every entry has a replayer', () => {
    expect([...BACKUP_ERASURE_SUBJECT_CLASSES]).toEqual([
      'organization',
      'property',
      'privacy_subject',
    ])
    const scope = checkExpression('backup_erasure_ledger_scope_valid')
    expect(scope).toContain("'organization'")
    expect(scope).toContain("'property'")
    expect(scope).toContain("'privacy_subject'")
    expect(checkExpression('backup_erasure_ledger_count_nonnegative')).toContain('>= 0')
    expect(checkExpression('backup_erasure_ledger_revision_positive')).toContain('> 0')
  })

  it('keys exactly one entry per lineage revision and context', () => {
    const unique = config.indexes.find(
      (candidate) => candidate.config.name === 'backup_erasure_ledger_lineage_unique',
    )
    expect(unique?.config.unique).toBe(true)
    expect(
      unique?.config.columns.map((column) =>
        'name' in column ? column.name : String(column),
      ),
    ).toEqual(['subject_class', 'closure_lineage_id', 'lifecycle_revision', 'context'])
  })
})
