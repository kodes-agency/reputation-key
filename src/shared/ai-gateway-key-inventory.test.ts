import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from './security/versioned-hmac-keyring'
import {
  AI_GATEWAY_KEY_INVENTORY_V1,
  AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1,
  assertAiAdmissionPrivateKeyInventory,
  assertAiAdmissionPublicKeyringInventory,
  assertAiProvenancePrivateKeyInventory,
  assertAiRequestBindingKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from './ai-gateway-key-inventory'

const RFC8032_SEED =
  '9d61b19deffd5a60ba844af492ec2cc4' + '4449c5697b326919703bac031cae7f60'
const RFC8032_PRIVATE_PKCS8 = Buffer.from(
  `302e020100300506032b657004220420${RFC8032_SEED}`,
  'hex',
)
const FIXED_PRIVATE_KEY = createPrivateKey({
  key: RFC8032_PRIVATE_PKCS8,
  format: 'der',
  type: 'pkcs8',
})
const FIXED_PUBLIC_KEY = createPublicKey(FIXED_PRIVATE_KEY)
const RFC8032_PROVENANCE_SEED =
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb'
const FIXED_PROVENANCE_PRIVATE_KEY = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${RFC8032_PROVENANCE_SEED}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
})

describe('shared AI gateway key inventory', () => {
  it('accepts only the exact request-binding active/retained inventory', () => {
    const expected = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
    expect(() => assertAiRequestBindingKeyringInventory(expected)).not.toThrow()
    expect(() =>
      assertAiRequestBindingKeyringInventory(
        createVersionedHmacKeyring(`request-v2:${'11'.repeat(32)}`),
      ),
    ).toThrow('inventory')
    expect(() =>
      assertAiRequestBindingKeyringInventory(
        createVersionedHmacKeyring(
          `request-v1:${'11'.repeat(32)},old:${'22'.repeat(32)}`,
        ),
      ),
    ).toThrow('inventory')
  })

  it('rejects an unprovisioned key even when the active kid matches', () => {
    const kid = AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.activeKid
    expect(() =>
      assertAiAdmissionPublicKeyringInventory(new Map([[kid, FIXED_PUBLIC_KEY]])),
    ).toThrow('inventory')
    expect(() =>
      assertAiAdmissionPrivateKeyInventory({ kid, privateKey: FIXED_PRIVATE_KEY }),
    ).toThrow('private signing key')
  })
  it('accepts the fixed local-stack signing inventory only outside Railway', () => {
    const local = resolveAiGatewayRuntimeKeyInventory({
      AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
    })
    expect(local).toBe(AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1)
    expect(() =>
      assertAiAdmissionPrivateKeyInventory(
        {
          kid: local.admissionSigning.activeKid,
          privateKey: FIXED_PRIVATE_KEY,
        },
        local,
      ),
    ).not.toThrow()
    expect(() =>
      assertAiAdmissionPublicKeyringInventory(
        new Map([[local.admissionSigning.activeKid, FIXED_PUBLIC_KEY]]),
        local,
      ),
    ).not.toThrow()
    expect(() =>
      assertAiProvenancePrivateKeyInventory(
        {
          kid: local.provenance.activeKid,
          privateKey: FIXED_PROVENANCE_PRIVATE_KEY,
        },
        local,
      ),
    ).not.toThrow()
    expect(() =>
      resolveAiGatewayRuntimeKeyInventory({
        AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
        RAILWAY_DEPLOYMENT_ID: 'deployment',
      }),
    ).toThrow('forbidden on Railway')
    expect(() =>
      resolveAiGatewayRuntimeKeyInventory({
        AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
        RAILWAY_GIT_COMMIT_SHA: 'g'.repeat(40),
      }),
    ).toThrow('forbidden on Railway')
    expect(() =>
      resolveAiGatewayRuntimeKeyInventory({
        AI_KEY_INVENTORY_PROFILE: 'unknown',
      }),
    ).toThrow('profile is invalid')
  })

  it('rejects valid-looking IDs, extra keys, and a different Ed25519 pair', () => {
    const kid = AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.activeKid
    const other = generateKeyPairSync('ed25519')
    expect(() =>
      assertAiAdmissionPublicKeyringInventory(
        new Map([['admission-v2', FIXED_PUBLIC_KEY]]),
      ),
    ).toThrow('inventory')
    expect(() =>
      assertAiAdmissionPublicKeyringInventory(
        new Map([
          [kid, FIXED_PUBLIC_KEY],
          ['extra', other.publicKey],
        ]),
      ),
    ).toThrow('inventory')
    expect(() =>
      assertAiAdmissionPublicKeyringInventory(new Map([[kid, other.publicKey]])),
    ).toThrow('inventory')
    expect(() =>
      assertAiAdmissionPrivateKeyInventory({ kid, privateKey: other.privateKey }),
    ).toThrow('private signing key')
    expect(() =>
      assertAiAdmissionPrivateKeyInventory({
        kid: 'admission-v2',
        privateKey: FIXED_PRIVATE_KEY,
      }),
    ).toThrow('active signing kid')
  })
})
