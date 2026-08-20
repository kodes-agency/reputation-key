import { createHash, createPublicKey, type KeyObject } from 'node:crypto'
import type { VersionedHmacKeyring } from './security/versioned-hmac-keyring'

const ADMISSION_V1_PUBLIC_KEY_SPKI_SHA256 =
  'a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f'
const PROVENANCE_V1_PUBLIC_KEY_SPKI_SHA256 =
  'dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842'
const LOCAL_ADMISSION_V1_PUBLIC_KEY_SPKI_SHA256 =
  '06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9'
const LOCAL_PROVENANCE_V1_PUBLIC_KEY_SPKI_SHA256 =
  'deb2ded39dc26fce0e6085b6fc34bf6b5941913bbfe2ea614113cff9e004c170'

export const AI_GATEWAY_KEY_INVENTORY_V1 = Object.freeze({
  requestBinding: Object.freeze({
    activeVersion: 'request-v1',
    retainedVersions: Object.freeze([] as readonly string[]),
    keyringGeneration: 1,
    maximumConfiguredKeys: 2,
  }),
  safetyIdentifier: Object.freeze({
    activeVersion: 'safety-v1',
    keyringGeneration: 1,
    maximumConfiguredKeys: 1,
  }),
  provenance: Object.freeze({
    activeKid: 'provenance-v1',
    publicKeyDigest: PROVENANCE_V1_PUBLIC_KEY_SPKI_SHA256,
    keyringGeneration: 1,
    maximumPrivateKeysPerProcess: 1,
  }),
  admissionSigning: Object.freeze({
    activeKid: 'admission-v1',
    retainedKids: Object.freeze([] as readonly string[]),
    publicKeyDigests: Object.freeze({
      'admission-v1': ADMISSION_V1_PUBLIC_KEY_SPKI_SHA256,
    }),
    keyringGeneration: 1,
    maximumConfiguredKeys: 2,
  }),
})
export type AiGatewayKeyInventory = Readonly<{
  requestBinding: Readonly<{
    activeVersion: string
    retainedVersions: readonly string[]
    keyringGeneration: number
    maximumConfiguredKeys: number
  }>
  safetyIdentifier: Readonly<{
    activeVersion: string
    keyringGeneration: number
    maximumConfiguredKeys: number
  }>
  provenance: Readonly<{
    activeKid: string
    publicKeyDigest: string
    keyringGeneration: number
    maximumPrivateKeysPerProcess: number
  }>
  admissionSigning: Readonly<{
    activeKid: string
    retainedKids: readonly string[]
    publicKeyDigests: Readonly<Record<string, string>>
    keyringGeneration: number
    maximumConfiguredKeys: number
  }>
}>

export const AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1: AiGatewayKeyInventory =
  Object.freeze({
    requestBinding: AI_GATEWAY_KEY_INVENTORY_V1.requestBinding,
    safetyIdentifier: AI_GATEWAY_KEY_INVENTORY_V1.safetyIdentifier,
    provenance: Object.freeze({
      ...AI_GATEWAY_KEY_INVENTORY_V1.provenance,
      publicKeyDigest: LOCAL_PROVENANCE_V1_PUBLIC_KEY_SPKI_SHA256,
    }),
    admissionSigning: Object.freeze({
      ...AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning,
      publicKeyDigests: Object.freeze({
        'admission-v1': LOCAL_ADMISSION_V1_PUBLIC_KEY_SPKI_SHA256,
      }),
    }),
  })

export function resolveAiGatewayKeyInventory(
  profile: string | undefined,
): AiGatewayKeyInventory {
  if (profile === undefined || profile === 'production-v1') {
    return AI_GATEWAY_KEY_INVENTORY_V1
  }
  if (profile === 'local-stack-v1') {
    return AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1
  }
  throw new Error('AI gateway key inventory profile is invalid')
}

function isRailwayHosted(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return Object.entries(environment).some(
    ([name, value]) => name.startsWith('RAILWAY_') && value !== undefined,
  )
}

export function resolveAiGatewayRuntimeKeyInventory(
  environment: Readonly<Record<string, string | undefined>>,
): AiGatewayKeyInventory {
  const profile = environment.AI_KEY_INVENTORY_PROFILE
  if (profile === 'local-stack-v1' && isRailwayHosted(environment)) {
    throw new Error('AI local-stack key inventory is forbidden on Railway')
  }
  return resolveAiGatewayKeyInventory(profile)
}

export function ed25519PublicKeyDigest(key: KeyObject): string {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('AI signing key type is invalid')
  }
  return createHash('sha256')
    .update(key.export({ format: 'der', type: 'spki' }))
    .digest('hex')
}

export function assertAiRequestBindingKeyringInventory(
  keyring: Pick<VersionedHmacKeyring, 'activeVersion' | 'retainedVersions'>,
  inventory: AiGatewayKeyInventory = AI_GATEWAY_KEY_INVENTORY_V1,
): void {
  const expected = inventory.requestBinding
  if (
    keyring.activeVersion !== expected.activeVersion ||
    keyring.retainedVersions.length > expected.maximumConfiguredKeys - 1 ||
    keyring.retainedVersions.length !== expected.retainedVersions.length ||
    keyring.retainedVersions.some(
      (version, index) => version !== expected.retainedVersions[index],
    )
  ) {
    throw new Error('AI request-binding keyring inventory is invalid')
  }
}

export function assertAiAdmissionPublicKeyringInventory(
  keys: ReadonlyMap<string, KeyObject>,
  keyInventory: AiGatewayKeyInventory = AI_GATEWAY_KEY_INVENTORY_V1,
): void {
  const inventory = keyInventory.admissionSigning
  const expectedKids = [inventory.activeKid, ...inventory.retainedKids].sort()
  if (
    keys.size !== expectedKids.length ||
    keys.size > inventory.maximumConfiguredKeys ||
    [...keys.keys()].sort().some((kid, index) => kid !== expectedKids[index])
  ) {
    throw new Error('AI admission public keyring inventory is invalid')
  }
  for (const kid of expectedKids) {
    const key = keys.get(kid)
    const expectedDigest =
      inventory.publicKeyDigests[kid as keyof typeof inventory.publicKeyDigests]
    if (
      !key ||
      expectedDigest === undefined ||
      ed25519PublicKeyDigest(key) !== expectedDigest
    ) {
      throw new Error('AI admission public keyring inventory is invalid')
    }
  }
}

export function assertAiProvenancePublicKeyringInventory(
  keys: ReadonlyMap<string, KeyObject>,
  keyInventory: AiGatewayKeyInventory = AI_GATEWAY_KEY_INVENTORY_V1,
): void {
  const inventory = keyInventory.provenance
  const key = keys.get(inventory.activeKid)
  if (
    keys.size !== 1 ||
    !key ||
    ed25519PublicKeyDigest(key) !== inventory.publicKeyDigest
  ) {
    throw new Error('AI provenance public keyring inventory is invalid')
  }
}

export function assertAiAdmissionPrivateKeyInventory(
  input: Readonly<{
    kid: string
    privateKey: KeyObject
  }>,
  keyInventory: AiGatewayKeyInventory = AI_GATEWAY_KEY_INVENTORY_V1,
): void {
  const inventory = keyInventory.admissionSigning
  if (input.kid !== inventory.activeKid) {
    throw new Error('AI admission active signing kid is invalid')
  }
  let publicKey: KeyObject
  try {
    publicKey = createPublicKey(input.privateKey)
  } catch {
    throw new Error('AI admission private signing key is invalid')
  }
  const expectedDigest = inventory.publicKeyDigests[inventory.activeKid]
  if (ed25519PublicKeyDigest(publicKey) !== expectedDigest) {
    throw new Error('AI admission private signing key is invalid')
  }
}

export function assertAiProvenancePrivateKeyInventory(
  input: Readonly<{
    kid: string
    privateKey: KeyObject
  }>,
  keyInventory: AiGatewayKeyInventory = AI_GATEWAY_KEY_INVENTORY_V1,
): void {
  const inventory = keyInventory.provenance
  if (input.kid !== inventory.activeKid) {
    throw new Error('AI provenance active signing kid is invalid')
  }
  let publicKey: KeyObject
  try {
    publicKey = createPublicKey(input.privateKey)
  } catch {
    throw new Error('AI provenance private signing key is invalid')
  }
  if (ed25519PublicKeyDigest(publicKey) !== inventory.publicKeyDigest) {
    throw new Error('AI provenance private signing key is invalid')
  }
}
