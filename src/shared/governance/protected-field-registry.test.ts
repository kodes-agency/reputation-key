// Keeps the explicit Google/provider-content field allowlist aligned with the
// live database schema and registered durable events.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import * as outboxSchema from '#/shared/db/schema/outbox.schema'
import {
  PROTECTED_FIELD_REGISTRY,
  type ProtectedFieldRule,
} from './protected-field-registry'

const PROTECTED_COLUMN_PATTERNS: ReadonlyArray<RegExp> = [
  /^text$/,
  /rating/,
  /reviewer/,
  /language_code/,
  /external_(id|location_id)/,
  /rejection_reason/,
  /content_hash/,
  /snippet/,
  /gbp_/,
  /google_/,
  /payload/,
  /^title$/,
  /^body$/,
  /^comment$/,
  /ip_hash/,
  /^pseudonym$/,
  /source_name/,
  /message_id/,
]

const GOVERNED_TABLES: ReadonlyArray<string> = [
  'reviews',
  'review_source_contents',
  'replies',
  'google_connections',
  'properties',
  'inbox_items',
  'inbox_notes',
  'recent_activity_entries',
  'recent_activity_actor_label_redactions',
  'recent_activity_replay_facts',
  'notifications',
  'outbox_events',
  'event_consumer_receipts',
  'review_sync_state',
  'idempotency_receipts',
  'feedback',
  'ratings',
  'scan_events',
  'guest_network_pressure_records',
]

const REQUIRED_EVENT_FIELDS: ReadonlyArray<
  Readonly<{ relation: string; field: string }>
> = [
  { relation: 'event:review.created', field: 'externalId' },
  { relation: 'event:review.updated', field: 'externalId' },
  { relation: 'event:guest.rating.submitted', field: 'value' },
]

function allSchemaTables(): ReadonlyArray<{ name: string; columns: string[] }> {
  const tables: Array<{ name: string; columns: string[] }> = []
  for (const value of [...Object.values(schema), ...Object.values(outboxSchema)]) {
    if (isTable(value)) {
      tables.push({
        name: getTableName(value),
        columns: Object.values(getTableColumns(value)).map((column) => column.name),
      })
    }
  }
  return tables
}

function registryKey([relation, field]: ProtectedFieldRule): string {
  return `${relation}:${field}`
}

describe('protected-field registry', () => {
  it('has no duplicate entries', () => {
    const keys = PROTECTED_FIELD_REGISTRY.map(registryKey)
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
    expect(duplicates, `duplicate registry entries: ${duplicates.join(', ')}`).toEqual([])
  })

  it('covers every protected-pattern column in governed tables', () => {
    const registered = new Set(PROTECTED_FIELD_REGISTRY.map(registryKey))
    const missing: string[] = []
    for (const table of allSchemaTables()) {
      if (!GOVERNED_TABLES.includes(table.name)) continue
      for (const column of table.columns) {
        if (!PROTECTED_COLUMN_PATTERNS.some((pattern) => pattern.test(column))) continue
        if (!registered.has(`${table.name}:${column}`)) {
          missing.push(`${table.name}:${column}`)
        }
      }
    }
    expect(
      missing,
      `protected columns missing from the registry: \n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no stale table entries', () => {
    const tables = new Map(allSchemaTables().map((table) => [table.name, table.columns]))
    const stale = PROTECTED_FIELD_REGISTRY.filter(
      ([relation]) => !relation.startsWith('event:'),
    )
      .filter(([relation, field]) => !(tables.get(relation) ?? []).includes(field))
      .map(registryKey)
    expect(stale, `stale registry entries: ${stale.join(', ')}`).toEqual([])
  })

  it('pins the governed-table list to reality', () => {
    const actual = new Set(allSchemaTables().map((table) => table.name))
    const unknown = GOVERNED_TABLES.filter((table) => !actual.has(table))
    expect(unknown, `governed tables not found in schema: ${unknown.join(', ')}`).toEqual(
      [],
    )
  })

  it('registers protected event payload fields on real event types', () => {
    const registered = new Set(PROTECTED_FIELD_REGISTRY.map(registryKey))
    const missing = REQUIRED_EVENT_FIELDS.filter(
      ({ relation, field }) => !registered.has(`${relation}:${field}`),
    ).map(({ relation, field }) => `${relation}:${field}`)
    expect(
      missing,
      `event payload fields missing from the registry: ${missing.join(', ')}`,
    ).toEqual([])

    const registrations = readFileSync(
      join(process.cwd(), 'src/shared/events/schema-registrations.ts'),
      'utf8',
    )
    const unknown = PROTECTED_FIELD_REGISTRY.filter(([relation]) =>
      relation.startsWith('event:'),
    )
      .filter(
        ([relation]) =>
          !registrations.includes(`type: '${relation.replace(/^event:/, '')}'`),
      )
      .map(registryKey)
    expect(
      unknown,
      `event entries for unregistered event types: ${unknown.join(', ')}`,
    ).toEqual([])
  })
})
