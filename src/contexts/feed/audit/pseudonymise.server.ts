// Audit records outlive an erasure: the event stays, the person does not. Every
// user id, email address, name, IP address and free-text note in an erased
// Organization's or Property's audit rows is replaced by a pseudonym. The same
// person gets the same pseudonym throughout one erasure, so the history still
// reads as "one person did these things", and a replay with the same key writes
// the same values again. The pseudonyms are keyed with a server-side secret, so
// the ids, emails and addresses they hide cannot be recovered by hashing guesses.
// Operator handles (`ops:<name>`) and service ids name no
// customer and stay.

import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/db'

const PREFIX = 'pseudonym:'
const KEY_PURPOSE = 'audit-pseudonym:v1:'
const BATCH = 500

/** Resource types whose id is a person's user id. */
const PERSON_RESOURCE_TYPES: ReadonlySet<string> = new Set(['member', 'user'])

/** Detail keys whose string value names, addresses or describes a person. */
const PERSON_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'actorId',
  'changeReason',
  'displayName',
  'email',
  'initiatorUserId',
  'ipAddress',
  'memberUserId',
  'name',
  'note',
  'operatorUserId',
  'reason',
  'userId',
])

const EMAIL = /^[^\s@]+@[^\s@]+$/u

export type AuditPseudonymScope = Readonly<{
  organizationId: string
  /** Set for a Property erasure: only that Property's audit events change. */
  propertyId?: string
}>

/**
 * The HMAC key for one erasure: derived from a server secret and the journal
 * entry id. The id alone is stored beside the data, so it cannot be the key; the
 * secret is what a replay needs again.
 */
export function auditPseudonymKey(secret: string, entryId: string): string {
  if (secret.length === 0) throw new Error('The audit pseudonym secret is empty')
  return createHmac('sha256', secret).update(`${KEY_PURPOSE}${entryId}`).digest('hex')
}

type Pseudonymise = (value: string) => string

function pseudonymiser(key: string): Pseudonymise {
  return (value) =>
    value.startsWith(PREFIX)
      ? value
      : `${PREFIX}${createHmac('sha256', key).update(value).digest('hex').slice(0, 32)}`
}

type EventRow = Readonly<{
  id: string
  actor_type: string
  actor_id: string | null
  resource_type: string
  resource_id: string | null
  source_aggregate_id: string | null
}>

type LogRow = Readonly<{
  id: string
  user_id: string
  ip_address: string | null
  details: unknown
}>

const isPersonValue = (value: string | null, people: ReadonlySet<string>) =>
  value !== null && !value.startsWith(PREFIX) && people.has(value)

/** The user ids the scope's audit rows name. */
async function peopleOf(tx: Tx, scope: AuditPseudonymScope): Promise<Set<string>> {
  const property = scope.propertyId ? sql` AND property_id = ${scope.propertyId}` : sql``
  const logs = scope.propertyId
    ? sql``
    : sql`UNION SELECT user_id FROM audit_logs
          WHERE organization_id = ${scope.organizationId} AND user_id <> 'system'`
  const result = await tx.execute(sql`
    SELECT actor_id AS id FROM audit_events
      WHERE organization_id = ${scope.organizationId}${property}
        AND actor_type = 'user' AND actor_id IS NOT NULL
    UNION SELECT resource_id FROM audit_events
      WHERE organization_id = ${scope.organizationId}${property}
        AND resource_type IN ('member', 'user') AND resource_id IS NOT NULL
    ${logs}
  `)
  return new Set(
    result.rows
      .map((row) => String((row as { id: string }).id))
      .filter((id) => !id.startsWith(PREFIX)),
  )
}

function pseudonymisedEvent(
  row: EventRow,
  people: ReadonlySet<string>,
  pseudonym: Pseudonymise,
): EventRow {
  const actorId =
    row.actor_type === 'user' && row.actor_id !== null
      ? pseudonym(row.actor_id)
      : row.actor_id
  const resourceId =
    row.resource_id !== null &&
    (PERSON_RESOURCE_TYPES.has(row.resource_type) || people.has(row.resource_id))
      ? pseudonym(row.resource_id)
      : row.resource_id
  const aggregateId = isPersonValue(row.source_aggregate_id, people)
    ? pseudonym(row.source_aggregate_id as string)
    : row.source_aggregate_id
  return {
    ...row,
    actor_id: actorId,
    resource_id: resourceId,
    source_aggregate_id: aggregateId,
  }
}

function pseudonymisedDetails(
  value: unknown,
  people: ReadonlySet<string>,
  pseudonym: Pseudonymise,
  key?: string,
): unknown {
  if (typeof value === 'string') {
    const personal =
      (key !== undefined && PERSON_DETAIL_KEYS.has(key)) ||
      people.has(value) ||
      EMAIL.test(value)
    return personal ? pseudonym(value) : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => pseudonymisedDetails(item, people, pseudonym, key))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        pseudonymisedDetails(entry, people, pseudonym, entryKey),
      ]),
    )
  }
  return value
}

function pseudonymisedLog(
  row: LogRow,
  people: ReadonlySet<string>,
  pseudonym: Pseudonymise,
): LogRow {
  return {
    ...row,
    user_id: row.user_id === 'system' ? row.user_id : pseudonym(row.user_id),
    ip_address: row.ip_address === null ? null : pseudonym(row.ip_address),
    details: pseudonymisedDetails(row.details, people, pseudonym),
  }
}

async function rewriteEvents(
  tx: Tx,
  scope: AuditPseudonymScope,
  people: ReadonlySet<string>,
  pseudonym: Pseudonymise,
): Promise<number> {
  const property = scope.propertyId ? sql` AND property_id = ${scope.propertyId}` : sql``
  let changed = 0
  let after = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const page = (
      await tx.execute(sql`
        SELECT id::text AS id, actor_type, actor_id, resource_type, resource_id,
               source_aggregate_id
        FROM audit_events
        WHERE organization_id = ${scope.organizationId}${property}
          AND id > ${after}::uuid
        ORDER BY id LIMIT ${BATCH}
      `)
    ).rows as EventRow[]
    if (page.length === 0) return changed
    after = page.at(-1)!.id
    const updates = page
      .map((row) => pseudonymisedEvent(row, people, pseudonym))
      .filter((row, index) => JSON.stringify(row) !== JSON.stringify(page[index]))
    if (updates.length === 0) continue
    await tx.execute(sql`
      UPDATE audit_events AS event
      SET actor_id = next.actor_id,
          resource_id = next.resource_id,
          source_aggregate_id = next.source_aggregate_id
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS next(id uuid, actor_id text, resource_id text, source_aggregate_id text)
      WHERE event.organization_id = ${scope.organizationId} AND event.id = next.id
    `)
    changed += updates.length
  }
}

async function rewriteLogs(
  tx: Tx,
  organizationId: string,
  people: ReadonlySet<string>,
  pseudonym: Pseudonymise,
): Promise<number> {
  let changed = 0
  let after = ''
  for (;;) {
    const page = (
      await tx.execute(sql`
        SELECT id, user_id, ip_address, details
        FROM audit_logs
        WHERE organization_id = ${organizationId} AND id > ${after}
        ORDER BY id LIMIT ${BATCH}
      `)
    ).rows as LogRow[]
    if (page.length === 0) return changed
    after = page.at(-1)!.id
    const updates = page
      .map((row) => pseudonymisedLog(row, people, pseudonym))
      .filter((row, index) => JSON.stringify(row) !== JSON.stringify(page[index]))
    if (updates.length === 0) continue
    await tx.execute(sql`
      UPDATE audit_logs AS log
      SET user_id = next.user_id,
          ip_address = next.ip_address,
          details = next.details
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS next(id text, user_id text, ip_address text, details jsonb)
      WHERE log.organization_id = ${organizationId} AND log.id = next.id
    `)
    changed += updates.length
  }
}

/**
 * Pseudonymises the scope's audit rows inside the caller's transaction and
 * returns the rows changed. `key` must be the same for an erasure and its
 * replay. A Property scope changes that Property's audit events only; the
 * `audit_logs` table has no Property column.
 */
export async function pseudonymiseAuditRecords(
  tx: Tx,
  scope: AuditPseudonymScope,
  key: string,
): Promise<number> {
  const pseudonym = pseudonymiser(key)
  const people = await peopleOf(tx, scope)
  const events = await rewriteEvents(tx, scope, people, pseudonym)
  if (scope.propertyId) return events
  return events + (await rewriteLogs(tx, scope.organizationId, people, pseudonym))
}

export async function countAuditRecords(
  tx: Tx,
  scope: AuditPseudonymScope,
): Promise<Readonly<{ events: number; logs: number }>> {
  const property = scope.propertyId ? sql` AND property_id = ${scope.propertyId}` : sql``
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM audit_events
        WHERE organization_id = ${scope.organizationId}${property}) AS events,
      (SELECT count(*)::int FROM audit_logs
        WHERE organization_id = ${scope.organizationId}) AS logs
  `)
  const row = result.rows[0] as { events: number; logs: number }
  return { events: Number(row.events), logs: scope.propertyId ? 0 : Number(row.logs) }
}
