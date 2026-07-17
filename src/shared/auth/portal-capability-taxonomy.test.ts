// BQC-0.2 / STD-P0-01 — portal read must not authorize write or upload.
//
// Invariant: portal.create/update/delete map to portal.write (blocked for beta).
// portal media maps to portal.upload (blocked). Enabling portal.read alone
// cannot open mutation paths.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  checkAuthorization,
  capabilityForPermission,
  requireAuthorized,
} from './authorization-policy'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  createEnvCapabilityPolicyStore,
  isBlockedCapability,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

function makeStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: () => false,
    isOrgAllowlisted: () => false,
    isPropertyAllowlisted: () => true,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

describe('BQC-0.2 portal capability taxonomy (STD-P0-01)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  describe('permission → capability mapping', () => {
    it('maps portal.read to portal.read', () => {
      expect(capabilityForPermission('portal.read')).toBe('portal.read')
    })

    it('maps create/update/delete to portal.write (not portal.read)', () => {
      expect(capabilityForPermission('portal.create')).toBe('portal.write')
      expect(capabilityForPermission('portal.update')).toBe('portal.write')
      expect(capabilityForPermission('portal.delete')).toBe('portal.write')
    })

    it('treats portal.write and portal.upload as hard-blocked', () => {
      expect(isBlockedCapability('portal.write')).toBe(true)
      expect(isBlockedCapability('portal.upload')).toBe(true)
      expect(isBlockedCapability('portal.read')).toBe(false)
    })
  })

  describe('read enablement cannot open mutations', () => {
    beforeEach(() => {
      // Only portal.read is globally enabled — the broken mapping would have
      // allowed create/update/delete through this gate.
      initCapabilityPolicyStore(
        makeStore({
          isCapabilityGloballyEnabled: (cap) => cap === 'portal.read',
        }),
      )
    })

    it('allows portal.read when read capability is enabled and role permits', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'portal.read',
        capability: 'portal.read',
      })
      expect(decision.allowed).toBe(true)
    })

    it('denies portal.create when only portal.read is enabled', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const decision = checkAuthorization({
        actor: ctx,
        action: 'portal.create',
        capability: capabilityForPermission('portal.create'),
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_denied')
    })

    it('denies portal.update and portal.delete when only portal.read is enabled', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      for (const action of ['portal.update', 'portal.delete'] as const) {
        const decision = checkAuthorization({
          actor: ctx,
          action,
          capability: capabilityForPermission(action),
        })
        expect(decision.allowed, action).toBe(false)
        expect(decision.reason, action).toBe('capability_denied')
      }
    })

    it('requireAuthorized denies portal.create for AccountAdmin under read-only capability', () => {
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      expect(() => requireAuthorized({ actor: ctx, action: 'portal.create' })).toThrow()
    })
  })

  describe('blocked write/upload never globally enabled via env', () => {
    it('BETA_E2E_GLOBAL_CAPABILITIES cannot enable portal.write or portal.upload', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_E2E_GLOBAL_CAPABILITIES: 'portal.read,portal.write,portal.upload,team.use',
      })
      expect(store.isCapabilityGloballyEnabled('portal.read')).toBe(true)
      expect(store.isCapabilityGloballyEnabled('portal.write')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('portal.upload')).toBe(false)
    })
  })
})
