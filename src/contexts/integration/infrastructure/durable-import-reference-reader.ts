import { and, eq, gt } from 'drizzle-orm'
import type { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import { googleImportDiscoveryRecords } from '#/shared/db/schema/google-import-discovery.schema'
import type {
  ImportDiscoveryAuthorization,
  ImportReferenceResult,
} from '../application/ports/google-import-reference-store.port'
import { sameDurableAuthorization } from './durable-import-reference-codec'
import {
  type DurableImportReferenceAudience,
  type DurableImportReferenceKeys,
} from './durable-import-reference-keys'
import {
  durableImportReferenceExists,
  loadDurableImportRecord,
  type DurableImportRecord,
} from './durable-import-reference-persistence'

const MAX_CLOCK_SKEW_MS = 60_000
const AUDIENCES: readonly DurableImportReferenceAudience[] = [
  'account_selection',
  'accounts_cursor',
  'locations_cursor',
  'import_candidate',
]

export const createDurableImportReferenceReader = (
  deps: Readonly<{
    db: Database
    keys: DurableImportReferenceKeys
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
    const referenceKey = deps.keys.recordKey(input.audience, input.handle)
    if (!referenceKey) return { ok: false, code: 'malformed' }
    try {
      const loaded = await loadDurableImportRecord(
        deps.db,
        referenceKey,
        input.audience,
        deps.clock(),
      )
      if (loaded.status !== 'found') {
        if (loaded.status === 'expired') return { ok: false, code: 'expired' }
        const alternateKeys = AUDIENCES.filter(
          (audience) => audience !== input.audience,
        ).flatMap((audience) => {
          const key = deps.keys.recordKey(audience, input.handle)
          return key ? [key] : []
        })
        return (await durableImportReferenceExists(deps.db, alternateKeys))
          ? { ok: false, code: 'binding_mismatch' }
          : { ok: false, code: 'not_found' }
      }
      const keyVersion = input.handle.split('.', 1)[0]
      const now = deps.clock()
      if (
        loaded.record.keyVersion !== keyVersion ||
        loaded.record.issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS
      ) {
        return { ok: false, code: 'malformed' }
      }
      if (!sameDurableAuthorization(loaded.record.authorization, input.authorization)) {
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
