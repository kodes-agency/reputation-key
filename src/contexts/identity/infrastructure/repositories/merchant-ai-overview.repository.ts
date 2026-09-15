// Organization AI overview read.
//
// One statement per call over the live Properties in scope, left-joined to the
// Merchant AI authorization head and the standing decision deferral. The head
// columns are validated here and fail closed: a row the schema constraints
// should have made impossible never reaches the overview as a guess.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyIdInScope } from '#/shared/db/property-scope'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'
import type { MerchantAiState } from '../../domain/merchant-ai-authorization'
import type {
  MerchantAiOverviewReader,
  MerchantAiOverviewRecord,
} from '../../application/use-cases/merchant-ai-overview'

type Row = Record<string, unknown>

const STATES: ReadonlySet<string> = new Set(['disabled', 'enabled', 'revoked'])

function invalid(column: string): never {
  throw new Error(`Invalid Merchant AI overview ${column}`)
}

function readText(row: Row, column: string): string {
  const value = row[column]
  return typeof value === 'string' && value.length > 0 ? value : invalid(column)
}

function readCapabilities(value: unknown): ReadonlyArray<MerchantAiCapability> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return invalid('capabilities')
  }
  const present = new Set<string>(value)
  const normalized = CURRENT_MERCHANT_AI_CAPABILITIES.filter((capability) =>
    present.has(capability),
  )
  return normalized.length === value.length
    ? Object.freeze(normalized)
    : invalid('capabilities')
}

function readDeferredAt(value: unknown): Date | null {
  if (value === null) return null
  const instant =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return instant && !Number.isNaN(instant.getTime()) ? instant : invalid('deferred_at')
}

function toRecord(row: Row): MerchantAiOverviewRecord {
  if (typeof row.google_binding_active !== 'boolean') invalid('google_binding_active')
  const state = row.state
  let authorization: MerchantAiOverviewRecord['authorization'] = null
  if (state !== null) {
    if (typeof state !== 'string' || !STATES.has(state)) invalid('state')
    authorization = Object.freeze({
      state: state as MerchantAiState,
      capabilities: readCapabilities(row.capabilities),
      noticeVersion: readText(row, 'notice_version'),
      noticeDigest: readText(row, 'notice_digest'),
    })
  }
  return Object.freeze({
    propertyId: readText(row, 'property_id'),
    propertyName: readText(row, 'property_name'),
    googleBindingActive: row.google_binding_active as boolean,
    authorization,
    decisionDeferredAt: readDeferredAt(row.deferred_at),
  })
}

export const createMerchantAiOverviewReader = (
  db: Database,
): MerchantAiOverviewReader => ({
  async listOverview(input) {
    const result = await db.execute(sql`
      SELECT
        property.id::text AS property_id,
        property.name AS property_name,
        (property.google_binding_state = 'active') AS google_binding_active,
        enablement.state,
        enablement.capabilities,
        enablement.notice_version,
        enablement.notice_digest,
        deferral.deferred_at
      FROM properties AS property
      LEFT JOIN merchant_ai_enablement AS enablement
        ON enablement.organization_id = property.organization_id
        AND enablement.property_id = property.id
      LEFT JOIN merchant_ai_decision_deferrals AS deferral
        ON deferral.organization_id = property.organization_id
        AND deferral.property_id = property.id
      WHERE property.organization_id = ${input.organizationId}
        AND property.deleted_at IS NULL
        AND ${propertyIdInScope(sql`property.id`, input.propertyIds)}
      ORDER BY lower(property.name), property.id
    `)
    return result.rows.map((row) => toRecord(row as Row))
  },
})
