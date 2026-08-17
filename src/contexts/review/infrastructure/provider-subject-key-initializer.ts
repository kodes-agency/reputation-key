import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  withSealedReviewProviderSubjectKeys,
  type MaskedReviewProviderSubjectKey,
} from '../application/provider-subject-keyring'

export type InitializedReviewProviderSubjectKey = MaskedReviewProviderSubjectKey
export type ReviewProviderSubjectMigratorEnvironment = Readonly<{
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS?: string
  REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS?: string
}>

async function hasInitializedInventory(db: Database): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 AS present
    FROM public."review_provider_subject_hmac_key_versions"
    LIMIT 1
  `)
  return result.rows.length > 0
}

/**
 * Sealed contract-migrator adapter. Only the masked digest crosses into SQL;
 * decoded key bytes remain closure-private and are zeroed before this settles.
 */
export async function initializeReviewProviderSubjectKeyInventory(
  input: Readonly<{
    db: Database
    sealedMigratorKeys: string
  }>,
): Promise<InitializedReviewProviderSubjectKey> {
  return withSealedReviewProviderSubjectKeys(
    input.sealedMigratorKeys,
    async (keyring) => {
      if (keyring.maskedInventory.length !== 1) {
        throw new Error('provider_subject_key_initialization_invalid')
      }
      const initial = keyring.maskedInventory[0]!
      try {
        if (await hasInitializedInventory(input.db)) return initial
        await input.db.execute(sql`
          SELECT public.initialize_review_provider_subject_hmac_key_v1(
            ${initial.version}::text,
            ${initial.digest}::text
          )
        `)
      } catch {
        // Another migrator may initialize the singleton inventory after the
        // empty read. Re-read before collapsing database details to the safe
        // failure code.
        try {
          if (await hasInitializedInventory(input.db)) return initial
        } catch {
          // The code-only failure below covers both initialization and re-read.
        }
        throw new Error('provider_subject_key_initialization_failed')
      }
      return initial
    },
  )
}

/**
 * Enforces the sealed migrator's distinct secret placement. Once the database
 * inventory exists, ordinary deploys need no copy of the one-run migrator
 * secret. A normal writer key variable is always rejected.
 */
export async function initializeReviewProviderSubjectKeyInventoryFromEnvironment(
  input: Readonly<{
    db: Database
    env: ReviewProviderSubjectMigratorEnvironment
  }>,
): Promise<InitializedReviewProviderSubjectKey | null> {
  if (input.env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS !== undefined) {
    throw new Error('provider_subject_key_initialization_invalid')
  }
  if (input.env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS === undefined) {
    if (await hasInitializedInventory(input.db)) return null
    throw new Error('provider_subject_key_initialization_invalid')
  }
  return initializeReviewProviderSubjectKeyInventory({
    db: input.db,
    sealedMigratorKeys: input.env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS,
  })
}
