import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportDiscoveryRecords } from '#/shared/db/schema/google-import-discovery.schema'
import type {
  ClaimedImportCandidate,
  GoogleImportReferenceStore,
} from '../application/ports/google-import-reference-store.port'
import { durableCandidatePayloadSchema } from './durable-import-reference-codec'
import type { DurableImportReferenceKeys } from './durable-import-reference-keys'

type ClaimMethod = 'claimCandidates' | 'releaseCandidateClaims' | 'consumeCandidateClaims'

type ClaimInput = Parameters<GoogleImportReferenceStore['claimCandidates']>[0]

const referenceKeysFor = (
  keys: DurableImportReferenceKeys,
  input: ClaimInput,
): readonly string[] | null => {
  if (
    input.candidateRefs.length < 1 ||
    input.candidateRefs.length > 100 ||
    new Set(input.candidateRefs).size !== input.candidateRefs.length
  ) {
    return null
  }
  const derived = input.candidateRefs.map((ref) =>
    keys.recordKey('import_candidate', ref),
  )
  return derived.every((key): key is string => key !== null) ? derived : null
}

const lockedRows = async (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  referenceKeys: readonly string[],
) =>
  tx
    .select()
    .from(googleImportDiscoveryRecords)
    .where(
      and(
        inArray(googleImportDiscoveryRecords.referenceKey, referenceKeys),
        eq(googleImportDiscoveryRecords.audience, 'import_candidate'),
      ),
    )
    .orderBy(googleImportDiscoveryRecords.referenceKey)
    .for('update')

const ownsClaim = (
  row: Awaited<ReturnType<typeof lockedRows>>[number],
  input: ClaimInput,
) =>
  row.organizationId === input.organizationId &&
  row.userId === input.userId &&
  row.claimRequestId === input.requestId

export const createDurableImportReferenceClaims = (
  deps: Readonly<{
    db: Database
    keys: DurableImportReferenceKeys
    clock: () => Date
  }>,
): Pick<GoogleImportReferenceStore, ClaimMethod> => ({
  claimCandidates: async (input) => {
    const keys = referenceKeysFor(deps.keys, input)
    if (!keys) return { ok: false, code: 'malformed' }
    try {
      return await deps.db.transaction(async (tx) => {
        const rows = await lockedRows(tx, keys)
        const byKey = new Map(rows.map((row) => [row.referenceKey, row]))
        const ordered = keys.map((key) => byKey.get(key))
        const now = deps.clock()
        if (
          ordered.some(
            (row) =>
              !row ||
              row.expiresAt <= now ||
              row.organizationId !== input.organizationId ||
              row.userId !== input.userId ||
              (row.claimRequestId !== null && row.claimRequestId !== input.requestId),
          )
        ) {
          return { ok: false as const, code: 'binding_mismatch' as const }
        }
        const claimed: ClaimedImportCandidate[] = []
        for (const [index, row] of ordered.entries()) {
          const payload = durableCandidatePayloadSchema.safeParse(row!.payload)
          if (!payload.success) {
            return { ok: false as const, code: 'binding_mismatch' as const }
          }
          claimed.push({
            candidateRef: input.candidateRefs[index]!,
            authorization: {
              organizationId: row!.organizationId,
              userId: row!.userId,
              connectionId: row!.connectionId,
              connectionLifecycleVersion: row!.connectionLifecycleVersion,
              connectionAccessVersion: row!.connectionAccessVersion,
              credentialGeneration: row!.credentialGeneration,
              approvalBindingId: row!.approvalBindingId,
              authorizationVector: row!.authorizationVector,
            },
            candidate: payload.data,
          })
        }
        await tx
          .update(googleImportDiscoveryRecords)
          .set({ claimRequestId: input.requestId, claimedAt: now, updatedAt: now })
          .where(inArray(googleImportDiscoveryRecords.referenceKey, keys))
        return { ok: true as const, candidates: claimed }
      })
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
  },

  releaseCandidateClaims: async (input) => {
    const keys = referenceKeysFor(deps.keys, input)
    if (!keys) return false
    try {
      return await deps.db.transaction(async (tx) => {
        const rows = await lockedRows(tx, keys)
        if (rows.length !== keys.length || rows.some((row) => !ownsClaim(row, input))) {
          return false
        }
        await tx
          .update(googleImportDiscoveryRecords)
          .set({ claimRequestId: null, claimedAt: null, updatedAt: deps.clock() })
          .where(inArray(googleImportDiscoveryRecords.referenceKey, keys))
        return true
      })
    } catch {
      return false
    }
  },

  consumeCandidateClaims: async (input) => {
    const keys = referenceKeysFor(deps.keys, input)
    if (!keys) return false
    try {
      return await deps.db.transaction(async (tx) => {
        const rows = await lockedRows(tx, keys)
        if (rows.length !== keys.length || rows.some((row) => !ownsClaim(row, input))) {
          return false
        }
        await tx
          .delete(googleImportDiscoveryRecords)
          .where(inArray(googleImportDiscoveryRecords.referenceKey, keys))
        return true
      })
    } catch {
      return false
    }
  },
})
