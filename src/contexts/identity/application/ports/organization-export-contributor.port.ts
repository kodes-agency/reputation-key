// The contributor half of the Organization Export contract.
//
// Identity owns the export, but every other bounded context has to hand its own
// records over: a context that stayed silent would leak out of the archive
// unnoticed, so `buildOrganizationExportBundle` demands one explicit
// contribution per context. Those sixteen foreign contributors are cross-context
// adapter implementations, and src/contexts/CONTEXT.md "Dependency rules" lets a
// foreign `infrastructure/adapters/**` reach only into `application/ports/**`
// ("The port IS the public interface for adapter contracts"). So the contract a
// contributor implements lives here rather than beside the bundle builder —
// `application/organization-export-contract.ts` re-exports these names so
// Identity's own callers keep one vocabulary.
//
// Nothing in this file may grow behaviour. It is a contract, and every rule it
// implies is enforced by the builder, which is the one place that can be trusted
// to run for every context at once.

import type { OrganizationLifecycleContext } from '../../domain/organization-lifecycle'

export type { OrganizationLifecycleContext }

export const ORGANIZATION_EXPORT_CLASSIFICATIONS = [
  'tenant_visible',
  'permitted_guest_content',
  'manager_authored',
  'retained_ai_derivative',
  'content_free_lifecycle',
] as const

export type OrganizationExportClassification =
  (typeof ORGANIZATION_EXPORT_CLASSIFICATIONS)[number]

/**
 * The disclosure classes each context may stamp on its own entries. A
 * contributor cannot widen its own disclosure — Review may only ship
 * manager-authored text, Integration only content-free lifecycle facts — so the
 * bundle builder validates every entry against this map. It is published here
 * because a contributor author has to know the answer before writing the
 * adapter, and duplicating it in an adapter would let the copy drift out of
 * agreement with the rule that actually runs.
 */
export const CLASSIFICATIONS_BY_CONTEXT: Readonly<
  Record<OrganizationLifecycleContext, readonly OrganizationExportClassification[]>
> = {
  activity: ['tenant_visible'],
  ai: ['retained_ai_derivative'],
  dashboard: ['tenant_visible'],
  goal: ['tenant_visible'],
  guest: ['tenant_visible', 'permitted_guest_content'],
  identity: ['tenant_visible'],
  inbox: ['tenant_visible', 'manager_authored'],
  integration: ['content_free_lifecycle'],
  metric: ['tenant_visible'],
  notification: ['tenant_visible'],
  portal: ['tenant_visible'],
  property: ['tenant_visible'],
  review: ['manager_authored'],
  staff: ['tenant_visible'],
}

export type OrganizationExportEntry = Readonly<{
  path: string
  mediaType: 'text/csv' | 'application/json' | 'text/markdown'
  classification: OrganizationExportClassification
  bytes: Uint8Array
}>

export type OrganizationExportContribution = Readonly<{
  context: OrganizationLifecycleContext
  /** `no_data` is an affirmative answer; only `omitted` may withhold records. */
  coverage: 'complete' | 'no_data' | 'omitted'
  omissionCodes: readonly string[]
  entries: readonly OrganizationExportEntry[]
}>

export type OrganizationExportContributor = Readonly<{
  context: OrganizationLifecycleContext
  contribute(input: {
    organizationId: string
    requestId: string
    asOf: Date
  }): Promise<OrganizationExportContribution>
}>
