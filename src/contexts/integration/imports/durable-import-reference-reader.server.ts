import { and, eq, gt } from 'drizzle-orm'
import type { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import { googleImportDiscoveryRecords } from '#/shared/db/schema/google-import-discovery.schema'
import { sameDiscoveryAuthorization } from './google-import-discovery-authorization.server'
import type {
  ImportDiscoveryAuthorization,
  ImportReferenceResult,
} from './durable-import-reference-store.port.server'
import {
  isHandle,
  type DurableImportReferenceAudience,
} from './durable-import-reference-keys.server'
import {
  durableImportReferenceExists,
  loadDurableImportRecord,
  type DurableImportRecord,
} from './durable-import-reference-persistence.server'

const MAX_CLOCK_SKEW_MS = 60_000

export const createDurableImportReferenceReader = (
  deps: Readonly<{
    db: Database
    clock: () => Date
  }>,
) => {
  const load = async <T>(
    input: Readonly<{
      handle: string
      audience: DurableImportReferenceAudience
      authorization: ImportDiscoveryAuthorization
      schema: z.ZodType<T>
    }>,
  ): Promise<ImportReferenceResult<{ record: DurableImportRecord; payload: T }>> => {
    if (!isHandle(input.handle)) return { ok: false, code: 'malformed' }
    try {
      const loaded = await loadDurableImportRecord(
        deps.db,
        input.handle,
        input.audience,
        deps.clock(),
      )
      if (loaded.status !== 'found') {
        if (loaded.status === 'expired') return { ok: false, code: 'expired' }
        return (await durableImportReferenceExists(deps.db, [input.handle]))
          ? { ok: false, code: 'binding_mismatch' }
          : { ok: false, code: 'not_found' }
      }
      const now = deps.clock()
      if (loaded.record.issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
        return { ok: false, code: 'malformed' }
      }
      if (!sameDiscoveryAuthorization(loaded.record.authorization, input.authorization)) {
        return { ok: false, code: 'binding_mismatch' }
      }
      const payload = input.schema.safeParse(loaded.record.payload)
      return payload.success
        ? { ok: true, record: loaded.record, payload: payload.data }
        : { ok: false, code: 'malformed' }
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
  }

  const redeemCursor = async <T>(
    input: Readonly<{
      handle: string
      audience: 'accounts_cursor' | 'locations_cursor'
      authorization: ImportDiscoveryAuthorization
      schema: z.ZodType<T>
    }>,
  ): Promise<ImportReferenceResult<{ payload: T }>> => {
    const loaded = await load(input)
    if (!loaded.ok) return loaded
    if (loaded.record.remainingRedemptions === 0) {
      return { ok: false, code: 'budget_exhausted' }
    }
    if (loaded.record.remainingRedemptions === null) {
      return { ok: false, code: 'malformed' }
    }
    const now = deps.clock()
    try {
      const changed = await deps.db
        .update(googleImportDiscoveryRecords)
        .set({
          remainingRedemptions: loaded.record.remainingRedemptions - 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(googleImportDiscoveryRecords.referenceKey, loaded.record.referenceKey),
            eq(
              googleImportDiscoveryRecords.organizationId,
              input.authorization.organizationId,
            ),
            eq(
              googleImportDiscoveryRecords.remainingRedemptions,
              loaded.record.remainingRedemptions,
            ),
            gt(googleImportDiscoveryRecords.expiresAt, now),
          ),
        )
        .returning({ key: googleImportDiscoveryRecords.referenceKey })
      return changed.length === 1
        ? { ok: true, payload: loaded.payload }
        : { ok: false, code: 'runtime_unavailable' }
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
  }

  return Object.freeze({ load, redeemCursor })
}
