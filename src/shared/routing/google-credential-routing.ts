import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  DATA_CELL_IDS,
  isDataCellAccepting,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import { SAFE_OPAQUE_IDENTIFIER_PATTERN } from '#/shared/domain/safe-identifier'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
export {
  canReplaceGoogleCredentialHome,
  type GoogleCredentialHome,
} from '#/shared/domain/google-credential-home'

const GOOGLE_CREDENTIAL_ROUTING_CONTRACT_VERSION = 'v1' as const
const GOOGLE_CREDENTIAL_ROUTING_SIGNATURE_AUDIENCE =
  'google-credential-routing-directory-v1' as const
export const MAX_GOOGLE_CREDENTIAL_ROUTING_TTL_MS = 5 * 60_000

const safeId = z.string().regex(SAFE_OPAQUE_IDENTIFIER_PATTERN)
const cellId = z.enum(DATA_CELL_IDS)
const positiveRevision = z.number().int().safe().positive()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)

const organizationHomeSchema = z
  .object({
    organizationId: safeId,
    homeCellId: cellId,
    authorityGeneration: positiveRevision,
  })
  .strict()
const connectionHomeSchema = z
  .object({
    organizationId: safeId,
    connectionId: safeId,
    homeCellId: cellId,
    authorityGeneration: positiveRevision,
  })
  .strict()
const propertyTargetSchema = z
  .object({
    organizationId: safeId,
    connectionId: safeId,
    propertyId: safeId,
    targetCellId: cellId,
  })
  .strict()

const payloadSchema = z
  .object({
    contractVersion: z.literal(GOOGLE_CREDENTIAL_ROUTING_CONTRACT_VERSION),
    revision: positiveRevision,
    cataloguePolicyVersion: positiveRevision,
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().positive(),
    organizationHomes: z.array(organizationHomeSchema).max(100_000),
    connectionHomes: z.array(connectionHomeSchema).max(1_000_000),
    propertyTargets: z.array(propertyTargetSchema).max(2_000_000),
  })
  .strict()

const signedDirectorySchema = payloadSchema
  .extend({
    digestSha256: sha256,
    signatureKeyVersion: z.string().min(1).max(32),
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict()

export type GoogleCredentialRoutingDirectoryPayload = z.infer<typeof payloadSchema>
export type SignedGoogleCredentialRoutingDirectory = z.infer<typeof signedDirectorySchema>

export function parseSignedGoogleCredentialRoutingDirectory(
  input: unknown,
): SignedGoogleCredentialRoutingDirectory {
  return signedDirectorySchema.parse(input)
}

export type GoogleCredentialRoutingDirectoryDenyCode =
  | 'malformed'
  | 'digest_mismatch'
  | 'signature_invalid'
  | 'not_yet_valid'
  | 'expired'
  | 'ttl_exceeded'
  | 'stale_revision'
  | 'policy_mismatch'
  | 'unsorted_or_duplicate'
  | 'cell_not_accepting'
  | 'home_mismatch'
  | 'reference_missing'

export type ValidatedGoogleCredentialRoutingDirectory = Readonly<{
  signed: SignedGoogleCredentialRoutingDirectory
  organizationHome(
    organizationId: string,
  ): Readonly<{ homeCellId: DataCellId; authorityGeneration: number }> | null
  connectionHome(
    organizationId: string,
    connectionId: string,
  ): Readonly<{ homeCellId: DataCellId; authorityGeneration: number }> | null
  propertyTarget(
    organizationId: string,
    connectionId: string,
    propertyId: string,
  ): DataCellId | null
}>

function canonicalPayload(payload: GoogleCredentialRoutingDirectoryPayload): string {
  return JSON.stringify([
    payload.contractVersion,
    payload.revision,
    payload.cataloguePolicyVersion,
    payload.issuedAtMs,
    payload.expiresAtMs,
    payload.organizationHomes.map((entry) => [
      entry.organizationId,
      entry.homeCellId,
      entry.authorityGeneration,
    ]),
    payload.connectionHomes.map((entry) => [
      entry.organizationId,
      entry.connectionId,
      entry.homeCellId,
      entry.authorityGeneration,
    ]),
    payload.propertyTargets.map((entry) => [
      entry.organizationId,
      entry.connectionId,
      entry.propertyId,
      entry.targetCellId,
    ]),
  ])
}

function payloadOf(
  directory: SignedGoogleCredentialRoutingDirectory,
): GoogleCredentialRoutingDirectoryPayload {
  return {
    contractVersion: directory.contractVersion,
    revision: directory.revision,
    cataloguePolicyVersion: directory.cataloguePolicyVersion,
    issuedAtMs: directory.issuedAtMs,
    expiresAtMs: directory.expiresAtMs,
    organizationHomes: directory.organizationHomes,
    connectionHomes: directory.connectionHomes,
    propertyTargets: directory.propertyTargets,
  }
}

function digestPayload(payload: GoogleCredentialRoutingDirectoryPayload): string {
  return createHash('sha256').update(canonicalPayload(payload)).digest('hex')
}

function sortedUnique<T>(items: readonly T[], key: (item: T) => string): boolean {
  let previous: string | null = null
  for (const item of items) {
    const current = key(item)
    if (previous !== null && current <= previous) return false
    previous = current
  }
  return true
}

export function signGoogleCredentialRoutingDirectory(
  input: GoogleCredentialRoutingDirectoryPayload,
  keys: VersionedHmacKeyring,
): SignedGoogleCredentialRoutingDirectory {
  const parsed = payloadSchema.parse(input)
  const digestSha256 = digestPayload(parsed)
  const signature = keys.sign(
    GOOGLE_CREDENTIAL_ROUTING_SIGNATURE_AUDIENCE,
    `${parsed.revision}:${digestSha256}`,
  )
  return Object.freeze({
    ...parsed,
    digestSha256,
    signatureKeyVersion: signature.keyVersion,
    signature: signature.digest,
  })
}

type RoutingHome = Readonly<{ homeCellId: DataCellId; authorityGeneration: number }>

type RoutingDirectoryIndex = Readonly<{
  organizationHomes: ReadonlyMap<string, RoutingHome>
  connectionHomes: ReadonlyMap<string, RoutingHome>
  propertyTargets: ReadonlyMap<string, DataCellId>
}>

/**
 * Envelope rules: the bytes hash to their digest, the signature verifies, the
 * directory is inside its own TTL, and its rows are sorted and unique. `null`
 * means the envelope is admissible.
 */
function routingDirectoryEnvelopeDenial(
  directory: SignedGoogleCredentialRoutingDirectory,
  options: Readonly<{
    keys: VersionedHmacKeyring
    nowMs: number
    minimumRevision: number
    expectedCataloguePolicyVersion?: number
  }>,
): GoogleCredentialRoutingDirectoryDenyCode | null {
  if (digestPayload(payloadOf(directory)) !== directory.digestSha256) {
    return 'digest_mismatch'
  }
  if (
    !options.keys.verify(
      GOOGLE_CREDENTIAL_ROUTING_SIGNATURE_AUDIENCE,
      `${directory.revision}:${directory.digestSha256}`,
      directory.signatureKeyVersion,
      directory.signature,
    )
  ) {
    return 'signature_invalid'
  }
  if (directory.issuedAtMs > options.nowMs) return 'not_yet_valid'
  if (directory.expiresAtMs <= options.nowMs) return 'expired'
  if (
    directory.expiresAtMs <= directory.issuedAtMs ||
    directory.expiresAtMs - directory.issuedAtMs > MAX_GOOGLE_CREDENTIAL_ROUTING_TTL_MS
  ) {
    return 'ttl_exceeded'
  }
  if (directory.revision < options.minimumRevision) return 'stale_revision'
  if (
    directory.cataloguePolicyVersion !==
    (options.expectedCataloguePolicyVersion ?? DATA_CELL_CATALOGUE_POLICY_VERSION)
  ) {
    return 'policy_mismatch'
  }
  if (
    !sortedUnique(directory.organizationHomes, (entry) => entry.organizationId) ||
    !sortedUnique(
      directory.connectionHomes,
      (entry) => `${entry.organizationId}\0${entry.connectionId}`,
    ) ||
    !sortedUnique(
      directory.propertyTargets,
      (entry) => `${entry.organizationId}\0${entry.connectionId}\0${entry.propertyId}`,
    )
  ) {
    return 'unsorted_or_duplicate'
  }
  return null
}

/**
 * Index the directory for exact lookup, refusing any row whose cell is not
 * accepting or whose parent row is missing or disagrees.
 */
function indexRoutingDirectory(
  directory: SignedGoogleCredentialRoutingDirectory,
  accepting: (cellId: string) => boolean,
):
  | Readonly<{ ok: true; index: RoutingDirectoryIndex }>
  | Readonly<{ ok: false; code: GoogleCredentialRoutingDirectoryDenyCode }> {
  const organizationHomes = new Map(
    directory.organizationHomes.map((entry) => [
      entry.organizationId,
      Object.freeze({
        homeCellId: entry.homeCellId,
        authorityGeneration: entry.authorityGeneration,
      }),
    ]),
  )
  const connectionHomes = new Map<string, RoutingHome>()
  for (const entry of directory.organizationHomes) {
    if (!accepting(entry.homeCellId)) return { ok: false, code: 'cell_not_accepting' }
  }
  for (const entry of directory.connectionHomes) {
    if (!accepting(entry.homeCellId)) return { ok: false, code: 'cell_not_accepting' }
    const organizationHome = organizationHomes.get(entry.organizationId)
    if (!organizationHome) return { ok: false, code: 'reference_missing' }
    if (
      organizationHome.homeCellId !== entry.homeCellId ||
      organizationHome.authorityGeneration !== entry.authorityGeneration
    ) {
      return { ok: false, code: 'home_mismatch' }
    }
    connectionHomes.set(
      `${entry.organizationId}\0${entry.connectionId}`,
      Object.freeze({
        homeCellId: entry.homeCellId,
        authorityGeneration: entry.authorityGeneration,
      }),
    )
  }
  const propertyTargets = new Map<string, DataCellId>()
  for (const entry of directory.propertyTargets) {
    if (!accepting(entry.targetCellId)) return { ok: false, code: 'cell_not_accepting' }
    if (!connectionHomes.has(`${entry.organizationId}\0${entry.connectionId}`)) {
      return { ok: false, code: 'reference_missing' }
    }
    propertyTargets.set(
      `${entry.organizationId}\0${entry.connectionId}\0${entry.propertyId}`,
      entry.targetCellId,
    )
  }
  return { ok: true, index: { organizationHomes, connectionHomes, propertyTargets } }
}

export function validateGoogleCredentialRoutingDirectory(
  input: unknown,
  options: Readonly<{
    keys: VersionedHmacKeyring
    nowMs: number
    minimumRevision: number
    expectedCataloguePolicyVersion?: number
    isAcceptingCell?: (cellId: string) => boolean
  }>,
):
  | Readonly<{ ok: true; value: ValidatedGoogleCredentialRoutingDirectory }>
  | Readonly<{ ok: false; code: GoogleCredentialRoutingDirectoryDenyCode }> {
  const parsed = signedDirectorySchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'malformed' }
  const directory = parsed.data

  const envelopeDenial = routingDirectoryEnvelopeDenial(directory, options)
  if (envelopeDenial) return { ok: false, code: envelopeDenial }

  const indexed = indexRoutingDirectory(
    directory,
    options.isAcceptingCell ?? isDataCellAccepting,
  )
  if (!indexed.ok) return indexed
  const { organizationHomes, connectionHomes, propertyTargets } = indexed.index

  return {
    ok: true,
    value: Object.freeze({
      signed: directory,
      organizationHome: (organizationId) => organizationHomes.get(organizationId) ?? null,
      connectionHome: (organizationId, connectionId) =>
        connectionHomes.get(`${organizationId}\0${connectionId}`) ?? null,
      propertyTarget: (organizationId, connectionId, propertyId) =>
        propertyTargets.get(`${organizationId}\0${connectionId}\0${propertyId}`) ?? null,
    }),
  }
}

/** No country or inferred-cell input exists: an absent exact route is a denial. */
export function resolveExactGoogleCredentialRoute(
  directory: ValidatedGoogleCredentialRoutingDirectory,
  input: Readonly<{
    organizationId: string
    connectionId: string
    propertyId: string
  }>,
): Readonly<{
  homeCellId: DataCellId
  targetCellId: DataCellId
  authorityGeneration: number
}> | null {
  const organizationHome = directory.organizationHome(input.organizationId)
  const connectionHome = directory.connectionHome(
    input.organizationId,
    input.connectionId,
  )
  const targetCellId = directory.propertyTarget(
    input.organizationId,
    input.connectionId,
    input.propertyId,
  )
  if (!organizationHome || !connectionHome || !targetCellId) return null
  if (
    organizationHome.homeCellId !== connectionHome.homeCellId ||
    organizationHome.authorityGeneration !== connectionHome.authorityGeneration
  ) {
    return null
  }
  return {
    homeCellId: organizationHome.homeCellId,
    targetCellId,
    authorityGeneration: organizationHome.authorityGeneration,
  }
}
