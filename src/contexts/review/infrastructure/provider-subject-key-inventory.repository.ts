import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  ReviewProviderSubjectKeyInventoryEntry,
  ReviewProviderSubjectKeyInventoryRepository,
  ReviewProviderSubjectKeyState,
} from '../application/provider-subject-keyring'

const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const KEY_DIGEST = /^[a-f0-9]{64}$/u
const KEY_STATES: Readonly<Record<ReviewProviderSubjectKeyState, true>> = Object.freeze({
  trusted_next: true,
  active: true,
  retiring: true,
})

type InventoryRow = Readonly<{
  key_version: unknown
  key_digest: unknown
  state: unknown
  generation: unknown
  reference_count: unknown
}>

function parseSafeInteger(value: unknown, minimum: number): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error('provider_subject_key_inventory_invalid')
  }
  const parsed = BigInt(value)
  if (parsed < BigInt(minimum) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('provider_subject_key_inventory_invalid')
  }
  return Number(parsed)
}

function parseInventoryRow(row: InventoryRow): ReviewProviderSubjectKeyInventoryEntry {
  if (
    typeof row.key_version !== 'string' ||
    !KEY_VERSION.test(row.key_version) ||
    typeof row.key_digest !== 'string' ||
    !KEY_DIGEST.test(row.key_digest) ||
    typeof row.state !== 'string' ||
    !Object.hasOwn(KEY_STATES, row.state)
  ) {
    throw new Error('provider_subject_key_inventory_invalid')
  }
  return Object.freeze({
    version: row.key_version,
    digest: row.key_digest,
    state: row.state as ReviewProviderSubjectKeyState,
    generation: parseSafeInteger(row.generation, 1),
    referenceCount: parseSafeInteger(row.reference_count, 0),
  })
}

/**
 * Review's runtime role sees only the masked, content-free inventory function.
 * Rotation/removal are database-serialized security-definer operations; this
 * adapter never reads or writes key material.
 */
export const createReviewProviderSubjectKeyInventoryRepository = (
  db: Database,
): ReviewProviderSubjectKeyInventoryRepository => {
  return Object.freeze({
    readInventory: async () => {
      const result = await db.execute(sql`
        SELECT
          key_version,
          key_digest,
          state,
          generation::text AS generation,
          reference_count::text AS reference_count
        FROM public.review_provider_subject_hmac_key_inventory_v1()
        ORDER BY generation, key_version
      `)
      return Object.freeze(
        result.rows.map((row) => parseInventoryRow(row as unknown as InventoryRow)),
      )
    },
    stageTrustedNext: async (input) => {
      await db.execute(sql`
        SELECT public.trust_next_review_provider_subject_hmac_key_v1(
          ${input.expectedActiveVersion}::text,
          ${input.trustedNextVersion}::text,
          ${input.trustedNextDigest}::text
        )
      `)
    },
    activateTrustedNext: async (input) => {
      await db.execute(sql`
        SELECT public.rotate_review_provider_subject_hmac_key_v1(
          ${input.expectedActiveVersion}::text,
          ${input.expectedTrustedNextVersion}::text
        )
      `)
    },
    removeRetiring: async (input) => {
      await db.execute(sql`
        SELECT public.remove_review_provider_subject_hmac_key_v1(
          ${input.expectedRetiringVersion}::text
        )
      `)
    },
  })
}
