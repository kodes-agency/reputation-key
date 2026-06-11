// Integration context — GBP import job repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Import jobs track async GBP → property sync operations.

import type { GbpImportJob, GbpImportJobId, GbpImportJobStatus } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type GbpImportRepository = Readonly<{
  findById: (orgId: OrganizationId, id: GbpImportJobId) => Promise<GbpImportJob | null>
  findByOrganization: (orgId: OrganizationId) => Promise<ReadonlyArray<GbpImportJob>>
  insert: (job: GbpImportJob) => Promise<void>
  updateStatus: (
    orgId: OrganizationId,
    id: GbpImportJobId,
    status: GbpImportJobStatus,
  ) => Promise<void>
  incrementImported: (orgId: OrganizationId, id: GbpImportJobId) => Promise<void>
  incrementSkipped: (orgId: OrganizationId, id: GbpImportJobId) => Promise<void>
  incrementFailed: (orgId: OrganizationId, id: GbpImportJobId) => Promise<void>
}>
