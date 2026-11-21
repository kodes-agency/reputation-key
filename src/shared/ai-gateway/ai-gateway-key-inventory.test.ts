import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1,
  assertAiProvenancePrivateKeyInventory,
  assertAiProvenancePublicKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from './ai-gateway-key-inventory'
const RFC8032_PROVENANCE_SEED =
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb'
const FIXED_PROVENANCE_PRIVATE_KEY = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${RFC8032_PROVENANCE_SEED}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
})

describe('shared AI gateway key inventory', () => {
  it('accepts the fixed local-stack signing inventory only outside Railway', () => {
    const local = resolveAiGatewayRuntimeKeyInventory({
      AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
    })
    expect(local).toBe(AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1)
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

  it('rejects another provenance key, an extra key and another kid', () => {
    const local = AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1
    const kid = local.provenance.activeKid
    const other = generateKeyPairSync('ed25519')
    const fixedPublicKey = createPublicKey(FIXED_PROVENANCE_PRIVATE_KEY)
    expect(() =>
      assertAiProvenancePublicKeyringInventory(new Map([[kid, fixedPublicKey]]), local),
    ).not.toThrow()
    expect(() =>
      assertAiProvenancePublicKeyringInventory(
        new Map([
          [kid, fixedPublicKey],
          ['extra', other.publicKey],
        ]),
        local,
      ),
    ).toThrow('inventory')
    expect(() =>
      assertAiProvenancePublicKeyringInventory(new Map([[kid, other.publicKey]]), local),
    ).toThrow('inventory')
    expect(() =>
      assertAiProvenancePrivateKeyInventory({ kid, privateKey: other.privateKey }, local),
    ).toThrow('private signing key')
    expect(() =>
      assertAiProvenancePrivateKeyInventory(
        { kid: 'provenance-v2', privateKey: FIXED_PROVENANCE_PRIVATE_KEY },
        local,
      ),
    ).toThrow('active signing kid')
  })
})
