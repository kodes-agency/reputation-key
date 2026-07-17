// BQC-1.1 — protected-field registry test.
//
// Fails when a protected field is introduced anywhere without a
// classification entry in PROTECTED_FIELD_REGISTRY:
//   1. registry entries are complete;
//   2. registered table columns exist in the real drizzle schema (no stale);
//   3. every protected-pattern schema column IS registered (generated
//      inventory — this is the test that fails on unclassified fields);
//   4. registered outbox event payload fields are registered;
//   5. job payload types carry no unregistered raw-content fields.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isTable, getTableColumns, getTableName } from 'drizzle-orm'
import * as schema from '#/shared/db/schema'
import * as outboxSchema from '#/shared/db/schema/outbox.schema'
import {
  PROTECTED_FIELD_REGISTRY,
  type ProtectedFieldRule,
} from './protected-field-registry'

// Column-name patterns that indicate Google source content, provider
// identifiers, or protected user/provider content (BQC-1 §3).
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
  /source_name/,
  /message_id/,
]

// Tables that hold review/reply/provider data in scope for BQC-1.
// (Enumerated so a new schema file cannot silently escape the scan —
// the stale-entry test pins this list to reality.)
const GOVERNED_TABLES: ReadonlyArray<string> = [
  'reviews',
  'replies',
  'google_connections',
  'properties',
  'inbox_items',
  'inbox_notes',
  'activity_log',
  'notifications',
  'outbox_events',
  'event_consumer_receipts',
  'gbp_cache',
  'review_sync_state',
  'inbound_webhook_receipts',
  'feedback',
  'ratings',
  'scan_events',
]

// Event payload fields that must be classified (residual identifiers/raw
// fields on outbox-registered types).
const REQUIRED_EVENT_FIELDS: ReadonlyArray<
  Readonly<{ relation: string; field: string }>
> = [
  { relation: 'event:review.created', field: 'externalId' },
  { relation: 'event:review.created', field: 'rating' },
  { relation: 'event:review.updated', field: 'externalId' },
  { relation: 'event:review.updated', field: 'rating' },
  { relation: 'event:property.created', field: 'gbpPlaceId' },
  { relation: 'event:identity.member.invited', field: 'email' },
]

function allSchemaTables(): ReadonlyArray<{ name: string; columns: string[] }> {
  const tables: Array<{ name: string; columns: string[] }> = []
  for (const value of [...Object.values(schema), ...Object.values(outboxSchema)]) {
    if (isTable(value)) {
      tables.push({
        name: getTableName(value),
        columns: Object.values(getTableColumns(value)).map((c) => c.name),
      })
    }
  }
  return tables
}

function registryKey(entry: ProtectedFieldRule): string {
  return `${entry.relation}:${entry.field}`
}

describe('BQC-1.1 protected-field registry', () => {
  it('has complete entries (owner, paths, rules, deletion mechanism)', () => {
    const incomplete = PROTECTED_FIELD_REGISTRY.filter(
      (e) =>
        !e.owner ||
        !e.purpose ||
        !e.creationPath ||
        !e.readPath ||
        !e.refreshRule ||
        !e.deletionMechanism,
    ).map(registryKey)
    expect(incomplete, `incomplete registry entries: ${incomplete.join(', ')}`).toEqual(
      [],
    )
  })

  it('has no duplicate entries', () => {
    const keys = PROTECTED_FIELD_REGISTRY.map(registryKey)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes, `duplicate registry entries: ${dupes.join(', ')}`).toEqual([])
  })

  it('covers every protected-pattern column in governed tables', () => {
    const registered = new Set(PROTECTED_FIELD_REGISTRY.map(registryKey))
    const missing: string[] = []
    for (const table of allSchemaTables()) {
      if (!GOVERNED_TABLES.includes(table.name)) continue
      for (const column of table.columns) {
        if (!PROTECTED_COLUMN_PATTERNS.some((p) => p.test(column))) continue
        if (!registered.has(`${table.name}:${column}`)) {
          missing.push(`${table.name}:${column}`)
        }
      }
    }
    expect(
      missing,
      `protected columns missing from the registry (classify them in protected-field-registry.ts):\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no stale table entries (registered columns must exist)', () => {
    const tables = new Map(allSchemaTables().map((t) => [t.name, t.columns]))
    const stale = PROTECTED_FIELD_REGISTRY.filter((e) => e.kind === 'table')
      .filter((e) => !(tables.get(e.relation) ?? []).includes(e.field))
      .map(registryKey)
    expect(stale, `stale registry entries: ${stale.join(', ')}`).toEqual([])
  })

  it('pins the governed-table list to reality', () => {
    const actual = new Set(allSchemaTables().map((t) => t.name))
    const unknown = GOVERNED_TABLES.filter((t) => !actual.has(t))
    expect(unknown, `governed tables not found in schema: ${unknown.join(', ')}`).toEqual(
      [],
    )
  })

  it('registers every event payload field that holds protected data', () => {
    // Outbox event payloads are identifier-only by zod allowlist (BQR-2.5),
    // but allowlisted fields themselves need classification (e.g. externalId,
    // rating on review.created; email on identity.member.invited).
    const registered = new Set(PROTECTED_FIELD_REGISTRY.map(registryKey))
    const missing = REQUIRED_EVENT_FIELDS.filter(
      ({ relation, field }) => !registered.has(`${relation}:${field}`),
    ).map(({ relation, field }) => `${relation}:${field}`)
    expect(
      missing,
      `event payload fields missing from the registry: ${missing.join(', ')}`,
    ).toEqual([])

    // Every event entry must reference a real registered event type.
    const registrations = readFileSync(
      join(process.cwd(), 'src/shared/events/schema-registrations.ts'),
      'utf8',
    )
    const unknown = PROTECTED_FIELD_REGISTRY.filter((e) => e.kind === 'event')
      .filter(
        (e) => !registrations.includes(`type: '${e.relation.replace(/^event:/, '')}'`),
      )
      .map(registryKey)
    expect(
      unknown,
      `event entries for unregistered event types: ${unknown.join(', ')}`,
    ).toEqual([])
  })

  it('keeps raw content fields out of job payload types', () => {
    // Scan queue port / job data type files for raw-content field names.
    // Registered exceptions (e.g. replyId references) are fine — raw text,
    // reviewer identity, and reply bodies are not.
    const FORBIDDEN =
      /\b(reviewText|reviewerName|reviewerProfilePhotoUrl|replyText|rejectionReason|snippet)\b/
    const offenders: string[] = []
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          scan(path)
        } else if (
          /(queue\.port|\.job)\.ts$/.test(entry.name) &&
          !entry.name.endsWith('.test.ts')
        ) {
          const content = readFileSync(path, 'utf8')
          if (FORBIDDEN.test(content)) offenders.push(path)
        }
      }
    }
    scan(join(process.cwd(), 'src/contexts'))
    expect(
      offenders,
      `job payload types referencing raw content fields:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
