// Integration context — start property import use case
// Steps: authorize → find connection → verify active → build job → insert → enqueue → return
//
// BQC-4.1 / ADR 0048: a location with no resolvable country can never resolve
// a processing region — it is skipped with an explicit region_unresolved
// reason in the result instead of being silently imported unresolved. When
// NO location is resolvable the import fails closed (region_unresolved).

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { GbpQueuePort } from '../ports/gbp-queue.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { GbpImportJob } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ImportPropertiesInput } from '../dto/import-properties.dto'
export type { ImportPropertiesInput as StartPropertyImportInput } from '../dto/import-properties.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId, gbpImportJobId } from '#/shared/domain/ids'
import { buildGbpImportJob } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'

export type StartPropertyImportDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  importRepo: GbpImportRepository
  queue: GbpQueuePort
  events: EventBus
  clock: () => Date
  idGen: () => string
}>

/** A location withheld from the import by the region gate (content-free). */
export type SkippedImportLocation = Readonly<{
  gbpPlaceId: string
  businessName: string
  reason: 'region_unresolved'
}>

export type StartPropertyImportResult = Readonly<{
  job: GbpImportJob
  /** Locations skipped by the BQC-4.1 region gate — never imported. */
  skippedLocations: ReadonlyArray<SkippedImportLocation>
}>

/** BQC-4.1: a location is importable only with an explicit country (GBP regionCode or override). */
function hasResolvableCountry(countryCode: string | null | undefined): boolean {
  return typeof countryCode === 'string' && countryCode.trim().length > 0
}

export const startPropertyImport =
  (deps: StartPropertyImportDeps) =>
  async (
    input: ImportPropertiesInput,
    ctx: AuthContext,
  ): Promise<StartPropertyImportResult> => {
    // Uses property.create because import creates property resources
    // 1. Authorize
    if (!canForContext(ctx, 'property.create')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to create properties',
      )
    }

    const connectionId = googleConnectionId(input.connectionId)

    // 2. Find connection
    const connection = await deps.connectionRepo.findById(
      ctx.organizationId,
      connectionId,
    )
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 3. Verify active
    if (connection.status !== 'active') {
      throw integrationError('connection_disconnected', 'Google account is not connected')
    }

    // 4. Validate non-empty locations
    if (input.locations.length === 0) {
      throw integrationError('gbp_api_error', 'Select at least one location to import')
    }

    // 4b. BQC-4.1 region gate — split resolvable from unresolvable locations.
    const eligible = input.locations.filter((l) => hasResolvableCountry(l.countryCode))
    const skippedLocations: SkippedImportLocation[] = input.locations
      .filter((l) => !hasResolvableCountry(l.countryCode))
      .map((l) => ({
        gbpPlaceId: l.gbpPlaceId,
        businessName: l.businessName,
        reason: 'region_unresolved' as const,
      }))
    if (eligible.length === 0) {
      throw integrationError(
        'region_unresolved',
        'No selected location has a resolvable country — import cannot proceed without a processing region',
        false,
        { skippedCount: skippedLocations.length },
      )
    }

    // 5. Build import job (tracks only region-resolvable locations)
    const importJobId = gbpImportJobId(deps.idGen())
    const now = deps.clock()

    const buildResult = buildGbpImportJob({
      id: importJobId,
      organizationId: ctx.organizationId,
      initiatedBy: ctx.userId,
      totalCount: eligible.length,
      now,
    })

    if (buildResult.isErr()) {
      throw buildResult.error
    }

    const importJob = buildResult.value

    // 6. Insert job
    await deps.importRepo.insert(importJob)

    // 7. Enqueue BullMQ job with full payload
    await deps.queue.addBulkImportJob({
      jobId: importJobId,
      organizationId: ctx.organizationId,
      connectionId: input.connectionId,
      locations: eligible,
      // BQC-3.2: named initiator for operator/user-triggered delayed work.
      policy: { initiator: { kind: 'user', id: ctx.userId } },
    })

    // 8. Return the job + explicit region-gate skips
    return { job: importJob, skippedLocations }
  }

export type StartPropertyImport = ReturnType<typeof startPropertyImport>
