// Guest's executor for the manual rights script: access export, guest-response
// erasure, Property erasure and Organization purge.
//
// It composes the erase bodies Guest already owns instead of restating them:
// the operator response erasure, the Property contributor, the Organization
// purge workbench and the Organization export contributor. Every statement
// stays bound to the requested Organization (and Property, or response), so a
// sibling Property, a sibling response and another Organization are untouched.
//
// Inbox and Reporting scrub the facts a response erasure publishes
// asynchronously, so apply reports how many Guest facts are still undelivered.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { guestResponses } from '#/shared/db/schema/guest.schema'
import {
  guestResponseId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import {
  GuestResponseLifecycleError,
  guestResponseLifecycle,
  type OperatorErasureAuthority,
} from '../../application/use-cases/guest-response-lifecycle'
import { createAtomicGuestResponseCommandStore } from '../guest-response-command-store'
import { createGuestResponseRepository } from '../repositories/guest-response.repository'
import { createGuestOrganizationExportContributor } from './guest-organization-export.adapter'
import {
  drizzleGuestLifecycleWorkbench,
  GUEST_PURGE_READINESS_BLOCKED,
} from './guest-organization-lifecycle.adapter'
import { createGuestPropertyEraseContributor } from './guest-property-erase.adapter'
import {
  countGuestLegacyPropertyRows,
  eraseGuestLegacyPropertyRows,
} from './guest-property-legacy-rows'

const CONTEXT = 'guest'

export type GuestRightsExecutorDeps = Readonly<{
  db: Database
  now: () => Date
  idGen: () => string
  /** The named operator and the check that the id is registered. Absent means denied. */
  operator?: Readonly<{ id: string; authority: OperatorErasureAuthority }>
}>

function errorMessage(error: unknown): string {
  return error instanceof GuestResponseLifecycleError
    ? error.code
    : error instanceof Error
      ? error.message
      : 'unexpected error'
}

export function createGuestRightsExecutor(deps: GuestRightsExecutorDeps): RightsExecutor {
  const { db } = deps
  const { now, idGen } = deps
  const workbench = drizzleGuestLifecycleWorkbench
  const propertyContributor = createGuestPropertyEraseContributor()
  const exportContributor = createGuestOrganizationExportContributor(db)

  // The runner journals this erasure before it applies, so the store's own
  // entry is not written a second time.
  const lifecycle = guestResponseLifecycle({
    operatorAuthority: deps.operator?.authority,
    repo: createGuestResponseRepository(db, now),
    clock: now,
    idGen,
    commandStore: createAtomicGuestResponseCommandStore(db, now, {
      idGen,
      put: async () => {},
      alert: () => {},
    }),
    resolvePrimaryStaffAttribution: async () => null,
  })

  const undeliveredFacts = (organization: string) =>
    db.transaction((tx) => workbench.countUndeliveredGuestFacts(tx, organization))

  const undeliveredLine = async (organization: string) =>
    `undelivered guest facts ${await undeliveredFacts(organization)}`

  async function responsePortal(
    organization: string,
    property: string,
    response: string,
  ): Promise<string | undefined> {
    const [row] = await db
      .select({ portalId: guestResponses.portalId })
      .from(guestResponses)
      .where(
        and(
          eq(guestResponses.organizationId, organization),
          eq(guestResponses.propertyId, property),
          eq(guestResponses.id, response),
        ),
      )
      .limit(1)
    return row?.portalId
  }

  async function propertyExists(organization: string, property: string) {
    const result = await db.execute(
      sql`SELECT 1 FROM properties WHERE id = ${property}::uuid AND organization_id = ${organization}`,
    )
    return result.rows.length > 0
  }

  async function organizationRefusal(organization: string): Promise<string | null> {
    const result = await db.execute(
      sql`SELECT state FROM organization_lifecycle_authority WHERE organization_id = ${organization}`,
    )
    const state = (result.rows[0] as { state?: string } | undefined)?.state
    if (state === undefined) return 'Organization has no lifecycle record'
    if (state === 'active') {
      return 'Organization is still active; suspend it before a purge'
    }
    return (await undeliveredFacts(organization)) > 0
      ? GUEST_PURGE_READINESS_BLOCKED
      : null
  }

  async function guestResponseRefusal(
    organization: string,
    property: string | undefined,
    response: string | undefined,
  ): Promise<string | null> {
    if (!property) return '--property is required'
    if (!response) return 'response=<uuid> is required'
    if (!deps.operator || !(await deps.operator.authority.verify(deps.operator.id))) {
      return 'operator_not_authorized'
    }
    return (await responsePortal(organization, property, response))
      ? null
      : 'response_not_found'
  }

  async function propertyReport(organization: string, property: string) {
    const scope = { organizationId: organization, propertyId: property }
    return db.transaction(async (tx) => [
      ...(await propertyContributor.inventory(tx, scope)),
      ...(await countGuestLegacyPropertyRows(tx, scope)),
    ])
  }

  return Object.freeze({
    name: CONTEXT,
    scopes: ['access', 'guest-response', 'property', 'organization'] as const,
    journalContexts: ['guest'] as const,
    async preflight(plan) {
      let refusal: string | null = null
      if (plan.scope === 'guest-response') {
        refusal = await guestResponseRefusal(
          plan.organizationId,
          plan.propertyId,
          plan.responseId,
        )
      } else if (plan.scope === 'property') {
        if (!plan.propertyId) refusal = '--property is required'
        else if (!(await propertyExists(plan.organizationId, plan.propertyId))) {
          refusal = 'Property not found in the Organization'
        }
      } else if (plan.scope === 'organization') {
        refusal = await organizationRefusal(plan.organizationId)
      }
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    async report(plan) {
      if (plan.scope === 'property' && plan.propertyId) {
        return [
          ...(await propertyReport(plan.organizationId, plan.propertyId)).map(
            ({ table, rowCount }) => `${table} ${rowCount}`,
          ),
          await undeliveredLine(plan.organizationId),
        ]
      }
      if (plan.scope === 'guest-response') {
        const found =
          plan.propertyId && plan.responseId
            ? await responsePortal(plan.organizationId, plan.propertyId, plan.responseId)
            : undefined
        return [
          `guest_responses ${found ? 1 : 0}`,
          await undeliveredLine(plan.organizationId),
        ]
      }
      const rows = await db.transaction((tx) =>
        workbench.countTenantRows(tx, plan.organizationId),
      )
      return [`tenant rows ${rows}`, await undeliveredLine(plan.organizationId)]
    },
    async exportFiles(plan) {
      const contribution = await exportContributor.contribute({
        organizationId: plan.organizationId,
        requestId: 'rights-request',
        asOf: now(),
      })
      return contribution.entries.map(({ path, bytes }) => ({ path, bytes }))
    },
    async apply(plan) {
      try {
        if (plan.scope === 'guest-response') return await eraseResponse(plan)
        if (plan.scope === 'property') return await eraseProperty(plan)
        if (plan.scope === 'organization') return await purgeOrganization(plan)
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })

  async function eraseResponse(plan: Parameters<RightsExecutor['apply']>[0]) {
    const refusal = await guestResponseRefusal(
      plan.organizationId,
      plan.propertyId,
      plan.responseId,
    )
    if (refusal || !deps.operator || !plan.propertyId || !plan.responseId) {
      return { ok: false as const, error: refusal ?? 'operator_not_authorized' }
    }
    const portal = await responsePortal(
      plan.organizationId,
      plan.propertyId,
      plan.responseId,
    )
    if (!portal) return { ok: false as const, error: 'response_not_found' }
    const outcome = await lifecycle.eraseAsOperator(
      deps.operator.id,
      {
        organizationId: organizationId(plan.organizationId),
        propertyId: propertyId(plan.propertyId),
        portalId: portalId(portal),
      },
      guestResponseId(plan.responseId),
    )
    return {
      ok: true as const,
      lines: [
        `response ${plan.responseId} ${outcome}`,
        `${await undeliveredLine(plan.organizationId)}; Inbox and Reporting scrub them asynchronously`,
      ],
    }
  }

  async function eraseProperty(plan: Parameters<RightsExecutor['apply']>[0]) {
    if (!plan.propertyId) return { ok: false as const, error: '--property is required' }
    const scope = { organizationId: plan.organizationId, propertyId: plan.propertyId }
    const erased = await db.transaction(
      async (tx) =>
        (await propertyContributor.erase(tx, scope)) +
        (await eraseGuestLegacyPropertyRows(tx, scope)),
    )
    return {
      ok: true as const,
      lines: [
        `deleted=${erased}`,
        `${await undeliveredLine(plan.organizationId)}; Inbox and Reporting scrub them asynchronously`,
      ],
    }
  }

  async function purgeOrganization(plan: Parameters<RightsExecutor['apply']>[0]) {
    const deleted = await db.transaction(async (tx) => {
      const refusal = await organizationRefusal(plan.organizationId)
      if (refusal) throw new Error(refusal)
      const owned = await workbench.countTenantRows(tx, plan.organizationId)
      if (owned > 0) await workbench.scrubTenantRows(tx, plan.organizationId)
      return owned
    })
    return { ok: true as const, lines: [`deleted=${deleted}`] }
  }
}
