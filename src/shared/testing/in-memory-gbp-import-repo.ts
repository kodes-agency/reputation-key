// In-memory GbpImportRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { GbpImportRepository } from '#/contexts/integration/application/ports/gbp-import.repository'
import type { GbpImportJob } from '#/contexts/integration/domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type InMemoryGbpImportRepo = GbpImportRepository &
  Readonly<{
    seed: (jobs: ReadonlyArray<GbpImportJob>) => void
    all: () => ReadonlyArray<GbpImportJob>
  }>

export const createInMemoryGbpImportRepo = (): InMemoryGbpImportRepo => {
  const store = new Map<string, GbpImportJob>()

  const byOrg = (orgId: OrganizationId) => (j: GbpImportJob) => j.organizationId === orgId

  return {
    findById: async (orgId, id) => {
      const job = store.get(id as string)
      return job && byOrg(orgId)(job) ? job : null
    },

    findByOrganization: async (orgId) => [...store.values()].filter(byOrg(orgId)),

    insert: async (job) => {
      store.set(job.id as string, job)
    },

    updateStatus: async (id, orgId, status) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, { ...existing, status, updatedAt: new Date() })
    },

    incrementImported: async (id, orgId) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        importedCount: existing.importedCount + 1,
        updatedAt: new Date(),
      })
    },

    incrementSkipped: async (id, orgId) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        skippedCount: existing.skippedCount + 1,
        updatedAt: new Date(),
      })
    },

    incrementFailed: async (id, orgId) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        failedCount: existing.failedCount + 1,
        updatedAt: new Date(),
      })
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seed: (jobs) => {
      for (const j of jobs) store.set(j.id as string, j)
    },

    all: () => [...store.values()],
  }
}
