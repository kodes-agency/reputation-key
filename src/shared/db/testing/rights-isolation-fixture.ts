// Shared pieces of the rights executor isolation tests: an Organization with
// Properties, the suspension an Organization erasure requires, and a
// journal store that remembers what the runner wrote before it erased.

import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { parseSuspendedOrgs } from '#/shared/auth/beta-capabilities'
import { getEnv, resetEnv } from '#/shared/config/env'
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

/** Suspends the Organization the way `BETA_SUSPENDED_ORGS` does, as an Organization erasure needs. */
export function holdRightsOrganization(organizationId: string): void {
  const suspended = [...parseSuspendedOrgs(getEnv().BETA_SUSPENDED_ORGS)]
  vi.stubEnv('BETA_SUSPENDED_ORGS', [...suspended, organizationId].join(','))
  resetEnv()
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
