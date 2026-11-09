// Shared pieces of the rights executor isolation tests: an Organization with
// Properties, the lifecycle hold an Organization erasure requires, and a
// journal store that remembers what the runner wrote before it erased.

import { randomUUID } from 'node:crypto'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  runRightsExecutors,
  type RightsExecutor,
} from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'

export const RIGHTS_FIXTURE_AT = new Date('2026-08-01T00:00:00.000Z')

export type RightsQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>

export type RightsSeeded = Readonly<{
  organizationId: string
  propertyIds: readonly string[]
}>

export async function seedRightsOrganization(
  query: RightsQuery,
  properties: number,
  seedProperty: (organizationId: string, propertyId: string) => Promise<void>,
): Promise<RightsSeeded> {
  const organizationId = `rights-${randomUUID()}`
  await query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights Fixture', $1, $2)`,
    [organizationId, RIGHTS_FIXTURE_AT],
  )
  const propertyIds: string[] = []
  for (let index = 0; index < properties; index += 1) {
    const propertyId = randomUUID()
    propertyIds.push(propertyId)
    await query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1::uuid, $2, 'Rights Property', $1::text, 'UTC', $3, $3)`,
      [propertyId, organizationId, RIGHTS_FIXTURE_AT],
    )
    await seedProperty(organizationId, propertyId)
  }
  return { organizationId, propertyIds }
}

/** Moves the Organization to the purge-pending state an Organization erasure needs. */
export async function holdRightsOrganization(
  query: RightsQuery,
  organizationId: string,
): Promise<void> {
  const at = RIGHTS_FIXTURE_AT
  await query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:rights-test', request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:rights-test',
         last_reason_code = 'test_workspace', last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [organizationId, randomUUID(), at, new Date('2026-08-31T00:00:00.000Z')],
  )
  for (const [next, reason] of [
    ['closing', 'closing_prepared'],
    ['purge_pending', 'recovery_window_elapsed'],
  ] as const) {
    await query(
      `UPDATE organization_lifecycle_authority
       SET state = $2, revision = revision + 1,
           last_transition_at = $3, last_actor_id = 'system:rights-test',
           last_reason_code = $4, last_support_evidence_ref = 'test:advance'
       WHERE organization_id = $1`,
      [organizationId, next, at, reason],
    )
  }
}

export function rightsPlan(
  scope: 'organization' | 'property',
  organizationId: string,
  options: { propertyId?: string; mode?: RightsRequestPlan['mode'] } = {},
): RightsRequestPlan {
  return {
    scope,
    mode: options.mode ?? 'apply',
    organizationId,
    ...(options.propertyId ? { propertyId: options.propertyId } : {}),
    batchSize: 50,
    receivedAt: RIGHTS_FIXTURE_AT,
  }
}

export async function runRightsExecutor(
  executor: RightsExecutor,
  plan: RightsRequestPlan,
  store: RightsJournalStore,
) {
  const out: string[] = []
  const err: string[] = []
  const code = await runRightsExecutors({
    plan,
    executors: [executor],
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { code, out, err }
}

export function recordingJournalStore() {
  const written = new Map<string, string>()
  const store: RightsJournalStore = {
    put: async (key, bytes) => {
      written.set(key, bytes)
    },
    alert: () => {},
  }
  return { store, entries: () => [...written.values()].map(decodeErasureJournalEntry) }
}
