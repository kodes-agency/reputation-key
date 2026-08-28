import { randomBytes } from 'node:crypto'
import type { GoogleImportReferenceStore } from '../application/ports/google-import-reference-store.port'
import type { ImportCandidatePageDto } from '../application/google-import-v2-contract'
import {
  affectedPropertyIdFor,
  durableAccountPayloadSchema,
  durableCandidatePayloadSchema,
  durableLocationsCursorPayloadSchema,
} from './durable-import-reference-codec'
import type { createDurableImportReferencePublisher } from './durable-import-reference-publication'
import type { createDurableImportReferenceReader } from './durable-import-reference-reader'

const MAX_CANDIDATES_PER_PAGE = 100
const MAX_CANDIDATE_BYTES = 16 * 1024
const MAX_CURSOR_REDEMPTIONS = 50

type CandidateMethods =
  'publishCandidatePage' | 'redeemLocationsCursor' | 'resolveCandidate'

export const createDurableImportReferenceCandidates = (
  deps: Readonly<{
    publisher: ReturnType<typeof createDurableImportReferencePublisher>
    reader: ReturnType<typeof createDurableImportReferenceReader>
    random?: (bytes: number) => Buffer
  }>,
): Pick<GoogleImportReferenceStore, CandidateMethods> => {
  const random = deps.random ?? randomBytes
  return {
    publishCandidatePage: async (input) => {
      const budget = input.cursorRedemptionBudget ?? MAX_CURSOR_REDEMPTIONS
      const account = await deps.reader.load({
        handle: input.account.accountRef,
        audience: 'account_selection',
        authorization: input.authorization,
        schema: durableAccountPayloadSchema,
      })
      if (
        !account.ok ||
        account.payload.accountId !== input.account.accountId ||
        account.payload.displayName !== input.account.displayName
      ) {
        return { ok: false, code: 'binding_mismatch' }
      }
      if (
        input.candidates.length > MAX_CANDIDATES_PER_PAGE ||
        !Number.isInteger(budget) ||
        budget < 1 ||
        budget > MAX_CURSOR_REDEMPTIONS ||
        (input.nextPageToken !== null &&
          !durableLocationsCursorPayloadSchema.safeParse({
            accountRef: input.account.accountRef,
            accountId: input.account.accountId,
            accountDisplayName: input.account.displayName,
            pageToken: input.nextPageToken,
          }).success)
      ) {
        return { ok: false, code: 'capacity_exceeded' }
      }
      const propertyIds = input.candidates.flatMap((candidate) => {
        const propertyId = affectedPropertyIdFor(candidate)
        return propertyId ? [propertyId] : []
      })
      return deps.publisher.publish<ImportCandidatePageDto>({
        authorization: input.authorization,
        contentDeadlineMs: input.contentDeadlineMs,
        propertyIds,
        build: ({ lease, issuedAt, expiresAt, createRecord }) => {
          const records = []
          const items: ImportCandidatePageDto['items'][number][] = []
          for (const candidate of input.candidates) {
            const idBytes = random(16)
            if (!Buffer.isBuffer(idBytes) || idBytes.byteLength !== 16) return null
            const candidateId = idBytes.toString('base64url')
            const payload = durableCandidatePayloadSchema.safeParse({
              ...candidate,
              candidateId,
              accountRef: input.account.accountRef,
              googleReviewUri: candidate.googleReviewUri ?? null,
              expectedSourceEpoch: candidate.expectedSourceEpoch ?? null,
              expectedProfileVersion: candidate.expectedProfileVersion ?? null,
              affectedPropertyId: candidate.affectedPropertyId ?? null,
            })
            if (
              !payload.success ||
              payload.data.accountId !== input.account.accountId ||
              payload.data.accountDisplayName !== input.account.displayName ||
              Buffer.byteLength(JSON.stringify(payload.data)) > MAX_CANDIDATE_BYTES
            ) {
              return null
            }
            const actionable =
              payload.data.eligibility.kind === 'create' ||
              payload.data.eligibility.kind === 'relink'
            const reference = actionable
              ? createRecord(
                  'import_candidate',
                  payload.data,
                  affectedPropertyIdFor(payload.data),
                )
              : null
            if (actionable && !reference) return null
            if (reference) records.push(reference)
            items.push({
              candidateId,
              candidateRef: reference?.handle ?? null,
              accountRef: input.account.accountRef,
              accountDisplayName: payload.data.accountDisplayName,
              businessName: payload.data.businessName,
              address: payload.data.address,
              primaryCategory: payload.data.primaryCategory,
              countryCode: payload.data.countryCode,
              eligibility: candidate.eligibility,
            })
          }
          const cursor = input.nextPageToken
            ? createRecord(
                'locations_cursor',
                {
                  accountRef: input.account.accountRef,
                  accountId: input.account.accountId,
                  accountDisplayName: input.account.displayName,
                  pageToken: input.nextPageToken,
                },
                null,
                budget,
              )
            : null
          if (input.nextPageToken && !cursor) return null
          return {
            records: [...records, ...(cursor ? [cursor] : [])],
            value: Object.freeze({
              items: Object.freeze(items),
              nextCursor: cursor?.handle ?? null,
              contentExpiresAt: expiresAt.toISOString(),
              authorizationLease: lease,
              contentTtlSeconds: Math.ceil(
                (expiresAt.getTime() - issuedAt.getTime()) / 1_000,
              ),
            }),
          }
        },
      })
    },

    redeemLocationsCursor: async (input) => {
      const redeemed = await deps.reader.redeemCursor({
        handle: input.cursorRef,
        audience: 'locations_cursor',
        authorization: input.authorization,
        schema: durableLocationsCursorPayloadSchema,
      })
      return redeemed.ok ? { ok: true, ...redeemed.payload } : redeemed
    },

    resolveCandidate: async (input) => {
      const loaded = await deps.reader.load({
        handle: input.candidateRef,
        audience: 'import_candidate',
        authorization: input.authorization,
        schema: durableCandidatePayloadSchema,
      })
      return loaded.ok ? { ok: true, candidate: loaded.payload } : loaded
    },
  }
}
