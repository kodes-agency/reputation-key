// Integration context — import-property use case
// Extracted from the import-property job handler to keep business logic
// in the application layer. The job handler is now a thin infrastructure wrapper.
//
// This use case:
//   - Generates unique property slugs
//   - Creates properties for new GBP locations
//   - Handles duplicate/race-condition errors gracefully
//   - Emits property.created events via a port
//   - Tracks import job counters

import type { PropertyEventPort } from '../ports/property-event.port'
import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { PropertyImportRepo } from '../ports/property-import-repo.port'
import { isDuplicateKeyError } from '../ports/property-import-repo.port'
import type { GbpImportJobId, GbpImportJobStatus } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  propertyId as toPropertyId,
  organizationId as toOrgId,
  googleConnectionId as toConnectionId,
} from '#/shared/domain/ids'
import { normalizeSlug } from '#/shared/domain/slug'
import type { Logger } from 'pino'

// ── Types ──────────────────────────────────────────────────────────

export type ImportLocation = Readonly<{
  gbpPlaceId: string
  businessName: string
  gbpLocationName: string
}>

export type CreatedProperty = Readonly<{
  id: string
  organizationId: string
  name: string
  slug: string
  gbpPlaceId: string
  gbpLocationName: string
  googleConnectionId: string
  createdAt: Date
}>

export type ImportPropertyInput = Readonly<{
  jobId: string
  organizationId: string
  connectionId: string
  locations: ReadonlyArray<ImportLocation>
}>

export type ImportPropertyResult = Readonly<{
  created: ReadonlyArray<CreatedProperty>
  status: 'completed' | 'completed_with_skips' | 'completed_with_failures' | 'failed'
}>

export type ImportPropertyDeps = Readonly<{
  importRepo: GbpImportRepository
  propertyRepo: PropertyImportRepo
  events: PropertyEventPort
  toJobId: (id: string) => GbpImportJobId
  toOrgId: (id: string) => OrganizationId
  clock: () => Date
  hashFn: (input: string) => string
  logger: Logger
}>

// ── Helpers ────────────────────────────────────────────────────────

function generatePropertySlug(
  businessName: string,
  gbpPlaceId: string,
  hashFn: (input: string) => string,
): string {
  const baseSlug = normalizeSlug(businessName)
  const slugSuffix = hashFn(gbpPlaceId).slice(0, 8)
  return `${baseSlug}-${slugSuffix}`
}

function determineTerminalStatus(
  totalCount: number,
  skippedCount: number,
  failedCount: number,
): ImportPropertyResult['status'] {
  if (totalCount === 0) return 'failed'
  if (failedCount >= totalCount) return 'failed'
  if (failedCount > 0) return 'completed_with_failures'
  if (skippedCount > 0) return 'completed_with_skips'
  return 'completed'
}

// ── Use case ───────────────────────────────────────────────────────

export const importProperty =
  (deps: ImportPropertyDeps) =>
  async (input: ImportPropertyInput): Promise<ImportPropertyResult> => {
    const logger = deps.logger
    const jobId = deps.toJobId(input.jobId)
    const orgId = deps.toOrgId(input.organizationId)

    // Mark job in progress
    await deps.importRepo.updateStatus(jobId, orgId, 'in_progress')

    const createdProperties: CreatedProperty[] = []

    try {
      // 1. Resolve which GBP place IDs already exist as properties
      const gbpPlaceIds = input.locations.map((loc) => loc.gbpPlaceId)
      const existingGbpPlaceIds = new Set(
        await deps.propertyRepo.findExistingGbpPlaceIds(
          input.organizationId,
          gbpPlaceIds,
        ),
      )

      // 2. Process each location
      for (const location of input.locations) {
        try {
          if (existingGbpPlaceIds.has(location.gbpPlaceId)) {
            await deps.importRepo.incrementSkipped(jobId, orgId)
            continue
          }

          const slug = generatePropertySlug(
            location.businessName,
            location.gbpPlaceId,
            deps.hashFn,
          )
          const now = deps.clock()

          const inserted = await deps.propertyRepo.insertProperty({
            organizationId: input.organizationId,
            name: location.businessName,
            slug,
            gbpPlaceId: location.gbpPlaceId,
            googleConnectionId: input.connectionId,
          })

          await deps.importRepo.incrementImported(jobId, orgId)

          createdProperties.push({
            id: inserted.id,
            organizationId: inserted.organizationId,
            name: inserted.name,
            slug: inserted.slug,
            gbpPlaceId: inserted.gbpPlaceId ?? location.gbpPlaceId,
            gbpLocationName: location.gbpLocationName,
            googleConnectionId: input.connectionId,
            createdAt: inserted.createdAt ?? now,
          })
        } catch (err) {
          // Handle duplicate-key race condition
          const isDup = isDuplicateKeyError(err)

          let treatAsSkip = false
          if (isDup) {
            treatAsSkip = await deps.propertyRepo.existsByGbpPlaceId(
              input.organizationId,
              location.gbpPlaceId,
            )
          }

          if (!treatAsSkip) {
            logger.error(
              {
                jobId: input.jobId,
                organizationId: input.organizationId,
                gbpPlaceId: location.gbpPlaceId,
                businessName: location.businessName,
                err,
              },
              'GBP property import failed',
            )
          }

          if (treatAsSkip) {
            await deps.importRepo.incrementSkipped(jobId, orgId)
          } else {
            await deps.importRepo.incrementFailed(jobId, orgId)
          }
        }
      }

      // 3. Finalize job status
      const jobRow = await deps.importRepo.findById(orgId, jobId)

      const finalStatus: GbpImportJobStatus = jobRow
        ? determineTerminalStatus(
            jobRow.totalCount,
            jobRow.skippedCount,
            jobRow.failedCount,
          )
        : 'failed'

      await deps.importRepo.updateStatus(jobId, orgId, finalStatus)

      // 4. Emit property.created events
      for (const prop of createdProperties) {
        try {
          await deps.events.emitPropertyCreated({
            _tag: 'property.created',
            propertyId: toPropertyId(prop.id),
            organizationId: toOrgId(prop.organizationId),
            name: prop.name,
            slug: prop.slug,
            gbpPlaceId: prop.gbpPlaceId,
            gbpLocationName: prop.gbpLocationName,
            googleConnectionId: toConnectionId(prop.googleConnectionId),
            occurredAt: prop.createdAt,
          })
        } catch (err) {
          logger.warn(
            { err, propertyId: prop.id },
            'Failed to emit property.created event',
          )
        }
      }

      return { created: createdProperties, status: finalStatus }
    } catch (err) {
      logger.error(
        { err, jobId: input.jobId, organizationId: input.organizationId },
        'Import handler crashed unexpectedly',
      )
      await deps.importRepo.updateStatus(jobId, orgId, 'failed')
      return { created: createdProperties, status: 'failed' }
    }
  }

export type ImportProperty = ReturnType<typeof importProperty>

// Alias used by the job handler for dependency injection
export type ImportPropertyUseCase = (
  input: ImportPropertyInput,
) => Promise<ImportPropertyResult>
