import { createHash, timingSafeEqual } from 'node:crypto'
import {
  deriveReviewProviderSubject,
  type ReviewProviderSubject,
} from '#/shared/review-provider-subject-contract'

const KEY_ENTRY = /^([a-z0-9][a-z0-9._-]{0,31}):([a-f0-9]{64})$/u
const KEY_DIGEST_DOMAIN = Buffer.from(
  'repkey-review-provider-subject-hmac-key-v1\0',
  'utf8',
)
const MAX_CONFIGURED_KEYS = 2

export type ReviewProviderSubjectKeyState = 'trusted_next' | 'active' | 'retiring'

export type MaskedReviewProviderSubjectKey = Readonly<{
  version: string
  digest: string
}>

export type ReviewProviderSubjectKeyInventoryEntry = Readonly<{
  version: string
  digest: string
  state: ReviewProviderSubjectKeyState
  generation: number
  referenceCount: number
}>
type ReviewProviderSubjectInventoryLayout = Readonly<{
  active: ReviewProviderSubjectKeyInventoryEntry
  secondary: ReviewProviderSubjectKeyInventoryEntry | null
  generation: number
}>

export type ReviewProviderSubjectDerivationScope = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  resourceName: string
}>

export type ReviewProviderSubjectDeriver = Readonly<{
  activeVersion: string
  retiringVersion: string | null
  inventoryGeneration: number
  deriveCandidates(
    scope: ReviewProviderSubjectDerivationScope,
  ): readonly [ReviewProviderSubject, ...ReviewProviderSubject[]]
}>

export type ReviewProviderSubjectKeyInventoryRepository = Readonly<{
  readInventory(): Promise<readonly ReviewProviderSubjectKeyInventoryEntry[]>
  stageTrustedNext(
    input: Readonly<{
      expectedActiveVersion: string
      trustedNextVersion: string
      trustedNextDigest: string
    }>,
  ): Promise<void>
  activateTrustedNext(
    input: Readonly<{
      expectedActiveVersion: string
      expectedTrustedNextVersion: string
    }>,
  ): Promise<void>
  removeRetiring(
    input: Readonly<{
      expectedRetiringVersion: string
    }>,
  ): Promise<void>
}>

export type ReviewProviderSubjectKeyService = Readonly<{
  acquireDeriver(): Promise<ReviewProviderSubjectDeriver>
  stageTrustedNext(
    input: Readonly<{
      expectedActiveVersion: string
      trustedNextVersion: string
    }>,
  ): Promise<void>
  activateTrustedNext(
    input: Readonly<{
      expectedActiveVersion: string
      expectedTrustedNextVersion: string
    }>,
  ): Promise<void>
  removeRetiring(
    input: Readonly<{
      expectedRetiringVersion: string
    }>,
  ): Promise<void>
}>

export type ReviewProviderSubjectKeyFailureCode =
  | 'config_invalid'
  | 'inventory_unavailable'
  | 'inventory_invalid'
  | 'inventory_mismatch'
  | 'rotation_conflict'
  | 'retiring_key_referenced'
  | 'key_unavailable'
  | 'keyring_destroyed'

export class ReviewProviderSubjectKeyError extends Error {
  readonly code: ReviewProviderSubjectKeyFailureCode

  constructor(code: ReviewProviderSubjectKeyFailureCode) {
    super(code)
    this.name = 'ReviewProviderSubjectKeyError'
    this.code = code
  }
}

export type ReviewProviderSubjectSecretKeyring = Readonly<{
  maskedInventory: readonly MaskedReviewProviderSubjectKey[]
  derive(
    version: string,
    scope: ReviewProviderSubjectDerivationScope,
  ): ReviewProviderSubject | null
  destroy(): void
}>

function fail(code: ReviewProviderSubjectKeyFailureCode): never {
  throw new ReviewProviderSubjectKeyError(code)
}

function maskedKeyDigest(key: Uint8Array): string {
  return createHash('sha256').update(KEY_DIGEST_DOMAIN).update(key).digest('hex')
}

/**
 * Parses the writer-only secret. The wire value is a comma-separated set of at
 * most two `version:64-lowercase-hex` entries. Database state, not entry order,
 * selects the active key. Decoded buffers stay closure-private and are zeroed
 * by `destroy`.
 */
export function createReviewProviderSubjectSecretKeyring(
  raw: string,
): ReviewProviderSubjectSecretKeyring {
  if (typeof raw !== 'string' || raw.length === 0) fail('config_invalid')
  const encoded = raw.split(',')
  if (encoded.length < 1 || encoded.length > MAX_CONFIGURED_KEYS) fail('config_invalid')

  const keys = new Map<string, Buffer>()
  try {
    for (const entry of encoded) {
      const match = KEY_ENTRY.exec(entry)
      if (!match) fail('config_invalid')
      const version = match[1]!
      const key = Buffer.from(match[2]!, 'hex')
      if (key.byteLength !== 32 || keys.has(version)) {
        key.fill(0)
        fail('config_invalid')
      }
      for (const existing of keys.values()) {
        if (timingSafeEqual(existing, key)) {
          key.fill(0)
          fail('config_invalid')
        }
      }
      keys.set(version, key)
    }
  } catch (error) {
    for (const key of keys.values()) key.fill(0)
    throw error
  }

  const maskedInventory = Object.freeze(
    [...keys.entries()]
      .map(([version, key]) => Object.freeze({ version, digest: maskedKeyDigest(key) }))
      .sort((left, right) =>
        left.version < right.version ? -1 : left.version > right.version ? 1 : 0,
      ),
  )
  let destroyed = false

  return Object.freeze({
    maskedInventory,
    derive: (version, scope) => {
      if (destroyed) fail('keyring_destroyed')
      const key = keys.get(version)
      if (!key) return null
      return deriveReviewProviderSubject({ ...scope, keyVersion: version, key })
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      for (const key of keys.values()) key.fill(0)
      keys.clear()
    },
  })
}
/** Keeps Review provider-subject material out of non-writer processes. */
export function configureReviewProviderSubjectWriterKeys(
  input: Readonly<{
    writerEnabled: boolean
    production: boolean
    raw: string | undefined
  }>,
): ReviewProviderSubjectSecretKeyring | undefined {
  if (!input.writerEnabled) return undefined
  if (!input.raw) {
    if (input.production) fail('config_invalid')
    return undefined
  }
  return createReviewProviderSubjectSecretKeyring(input.raw)
}

function safeInteger(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum
}

function inventoryLayout(
  rows: readonly ReviewProviderSubjectKeyInventoryEntry[],
): ReviewProviderSubjectInventoryLayout {
  if (rows.length < 1 || rows.length > MAX_CONFIGURED_KEYS) fail('inventory_invalid')
  const versions = new Set<string>()
  const generations = new Set<number>()
  for (const row of rows) {
    if (
      !KEY_ENTRY.test(`${row.version}:${row.digest}`) ||
      !safeInteger(row.generation, 1) ||
      !safeInteger(row.referenceCount, 0) ||
      versions.has(row.version) ||
      generations.has(row.generation)
    ) {
      fail('inventory_invalid')
    }
    versions.add(row.version)
    generations.add(row.generation)
  }

  const activeRows = rows.filter((row) => row.state === 'active')
  if (activeRows.length !== 1) fail('inventory_invalid')
  const active = activeRows[0]!
  const secondary = rows.find((row) => row !== active) ?? null
  if (secondary) {
    if (secondary.state === 'active') fail('inventory_invalid')
    if (secondary.state === 'trusted_next' && secondary.generation <= active.generation) {
      fail('inventory_invalid')
    }
    if (secondary.state === 'retiring' && secondary.generation >= active.generation) {
      fail('inventory_invalid')
    }
  }
  return Object.freeze({
    active,
    secondary,
    generation: Math.max(...rows.map((row) => row.generation)),
  })
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return (
    leftBytes.byteLength === 32 &&
    rightBytes.byteLength === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

function verifyExactParity(
  configured: readonly MaskedReviewProviderSubjectKey[],
  rows: readonly ReviewProviderSubjectKeyInventoryEntry[],
): ReviewProviderSubjectInventoryLayout {
  const layout = inventoryLayout(rows)
  if (configured.length !== rows.length) fail('inventory_mismatch')
  const configuredByVersion = new Map(configured.map((entry) => [entry.version, entry]))
  for (const row of rows) {
    const key = configuredByVersion.get(row.version)
    if (!key || !sameDigest(key.digest, row.digest)) fail('inventory_mismatch')
  }
  return layout
}

/** Secret-free deny adapter used by process roles that are not Review writers. */
export function createUnavailableReviewProviderSubjectKeyService(): ReviewProviderSubjectKeyService {
  return Object.freeze({
    acquireDeriver: async () => fail('config_invalid'),
    stageTrustedNext: async () => fail('config_invalid'),
    activateTrustedNext: async () => fail('config_invalid'),
    removeRetiring: async () => fail('config_invalid'),
  })
}

export function createReviewProviderSubjectKeyService(
  input: Readonly<{
    keyring: ReviewProviderSubjectSecretKeyring
    repository: ReviewProviderSubjectKeyInventoryRepository
  }>,
): ReviewProviderSubjectKeyService {
  const readVerified = async () => {
    let rows: readonly ReviewProviderSubjectKeyInventoryEntry[]
    try {
      rows = await input.repository.readInventory()
    } catch {
      fail('inventory_unavailable')
    }
    return {
      rows,
      layout: verifyExactParity(input.keyring.maskedInventory, rows),
    }
  }

  const acquireDeriver = async (): Promise<ReviewProviderSubjectDeriver> => {
    const { layout } = await readVerified()
    const activeVersion = layout.active.version
    const retiringVersion =
      layout.secondary?.state === 'retiring' ? layout.secondary.version : null
    return Object.freeze({
      activeVersion,
      retiringVersion,
      inventoryGeneration: layout.generation,
      deriveCandidates: (scope) => {
        const active = input.keyring.derive(activeVersion, scope)
        if (!active) fail('key_unavailable')
        if (!retiringVersion) {
          return Object.freeze([active] as [ReviewProviderSubject])
        }
        const retiring = input.keyring.derive(retiringVersion, scope)
        if (!retiring) fail('key_unavailable')
        return Object.freeze([active, retiring] as [
          ReviewProviderSubject,
          ReviewProviderSubject,
        ])
      },
    })
  }

  return Object.freeze({
    stageTrustedNext: async (command) => {
      let rows: readonly ReviewProviderSubjectKeyInventoryEntry[]
      try {
        rows = await input.repository.readInventory()
      } catch {
        fail('inventory_unavailable')
      }
      const layout = inventoryLayout(rows)
      if (layout.secondary || layout.active.version !== command.expectedActiveVersion) {
        fail('rotation_conflict')
      }
      const configuredActive = input.keyring.maskedInventory.find(
        (entry) => entry.version === layout.active.version,
      )
      const trustedNext = input.keyring.maskedInventory.find(
        (entry) => entry.version === command.trustedNextVersion,
      )
      if (
        input.keyring.maskedInventory.length !== 2 ||
        !configuredActive ||
        !sameDigest(configuredActive.digest, layout.active.digest) ||
        !trustedNext ||
        trustedNext.version === layout.active.version
      ) {
        fail('inventory_mismatch')
      }
      try {
        await input.repository.stageTrustedNext({
          expectedActiveVersion: command.expectedActiveVersion,
          trustedNextVersion: trustedNext.version,
          trustedNextDigest: trustedNext.digest,
        })
      } catch {
        fail('rotation_conflict')
      }
      const staged = await readVerified()
      const stagedSecondary = staged.layout.secondary
      if (
        staged.layout.active.version !== layout.active.version ||
        !stagedSecondary ||
        stagedSecondary.state !== 'trusted_next' ||
        stagedSecondary.version !== trustedNext.version
      ) {
        fail('inventory_invalid')
      }
    },
    acquireDeriver,
    activateTrustedNext: async (command) => {
      const { layout } = await readVerified()
      const trustedNext = layout.secondary
      if (
        layout.active.version !== command.expectedActiveVersion ||
        trustedNext?.state !== 'trusted_next' ||
        trustedNext.version !== command.expectedTrustedNextVersion ||
        trustedNext.referenceCount !== 0
      ) {
        fail('rotation_conflict')
      }
      try {
        await input.repository.activateTrustedNext(command)
      } catch {
        fail('rotation_conflict')
      }
      const rotated = await readVerified()
      const rotatedSecondary = rotated.layout.secondary
      if (
        rotated.layout.active.version !== trustedNext.version ||
        !rotatedSecondary ||
        rotatedSecondary.state !== 'retiring' ||
        rotatedSecondary.version !== layout.active.version
      ) {
        fail('inventory_invalid')
      }
    },
    removeRetiring: async (command) => {
      const { layout } = await readVerified()
      const retiring = layout.secondary
      if (
        retiring?.state !== 'retiring' ||
        retiring.version !== command.expectedRetiringVersion
      ) {
        fail('rotation_conflict')
      }
      if (retiring.referenceCount !== 0) fail('retiring_key_referenced')
      try {
        await input.repository.removeRetiring(command)
      } catch {
        fail('retiring_key_referenced')
      }
      let remainingRows: readonly ReviewProviderSubjectKeyInventoryEntry[]
      try {
        remainingRows = await input.repository.readInventory()
      } catch {
        fail('inventory_unavailable')
      }
      const remaining = inventoryLayout(remainingRows)
      if (
        remainingRows.length !== 1 ||
        remaining.secondary !== null ||
        remaining.active.version !== layout.active.version ||
        !sameDigest(remaining.active.digest, layout.active.digest)
      ) {
        fail('inventory_invalid')
      }
    },
  })
}

/**
 * Sealed-migrator-only entry point. The callback cannot retain usable decoded
 * keys after settlement: all closure-private buffers are zero-filled in the
 * mandatory finally block, including callback failures.
 */
export async function withSealedReviewProviderSubjectKeys<T>(
  raw: string,
  use: (keyring: ReviewProviderSubjectSecretKeyring) => Promise<T>,
): Promise<T> {
  const keyring = createReviewProviderSubjectSecretKeyring(raw)
  try {
    return await use(keyring)
  } finally {
    keyring.destroy()
  }
}
