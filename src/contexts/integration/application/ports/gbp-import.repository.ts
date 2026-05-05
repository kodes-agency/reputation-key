// Integration context — GBP import job repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Import jobs track async GBP → property sync operations.

import type { GbpImportJob, GbpImportJobId, GbpImportJobStatus } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type GbpImportRepository = Readonly<{
  findById: (id: GbpImportJobId) => Promise<GbpImportJob | null>
  findByOrganization: (orgId: OrganizationId) => Promise<ReadonlyArray<GbpImportJob>>
  insert: (job: GbpImportJob) => Promise<void>
  updateStatus: (id: GbpImportJobId, status: GbpImportJobStatus) => Promise<void>
  incrementImported: (id: GbpImportJobId) => Promise<void>
  incrementSkipped: (id: GbpImportJobId) => Promise<void>
  incrementFailed: (id: GbpImportJobId) => Promise<void>
}>
