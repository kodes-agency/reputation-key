import type { SQL } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  ORGANIZATION_LIFECYCLE_EVENT_CONTEXTS,
  organizationLifecycleEvents,
} from './organization-lifecycle.schema'

/**
 * Renders a Drizzle SQL fragment back to readable text for assertions:
 * literal chunks verbatim, column references as `"table"."column"`.
 */
function sqlText(fragment: SQL): string {
  return fragment.queryChunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null) return String(chunk)
      if ('value' in chunk) return String((chunk as { value: unknown }).value)
      if ('name' in chunk && 'table' in chunk) {
        const column = chunk as { name: string; table: PgTable }
        return `"${getTableConfig(column.table).name}"."${column.name}"`
      }
      return String(chunk)
    })
    .join('')
}

function checkExpression(table: PgTable, name: string): string {
  const found = getTableConfig(table).checks.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing check constraint ${name}`)
  return sqlText(found.value)
}

describe('Organization lifecycle schema', () => {
  it('consolidates retry evidence into one append-only event shape', () => {
    const config = getTableConfig(organizationLifecycleEvents)
    expect(config.name).toBe('organization_lifecycle_events')
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'organization_id',
      'context',
      'phase',
      'kind',
      'payload',
      'recorded_at',
    ])
    expect(config.foreignKeys).toEqual([])
    expect([...ORGANIZATION_LIFECYCLE_EVENT_CONTEXTS]).toEqual([
      ...ORGANIZATION_LIFECYCLE_CONTEXTS,
    ])
    const unique = config.indexes.find(
      (candidate) =>
        candidate.config.name === 'organization_lifecycle_events_idempotency_unique',
    )
    expect(unique?.config.unique).toBe(true)
    expect(
      unique?.config.columns.map((column) =>
        'name' in column ? column.name : String(column),
      ),
    ).toEqual(['context', 'phase', 'kind'])
    expect(
      checkExpression(
        organizationLifecycleEvents,
        'organization_lifecycle_events_payload_object',
      ),
    ).toContain("= 'object'")
  })
})
