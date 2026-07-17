// BQC-0.2 / STD-P0-01 — portal read must not authorize write or upload.
//
// Invariant: portal.create/update/delete map to portal.write (blocked for beta).
// portal media maps to portal.upload (blocked). Enabling portal.read alone
// cannot open mutation paths.
//
// BQC-2.6: the proof now runs through the ExecutionPolicy — the production
// seam — not the deleted requireAuthorized path.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { capabilityForPermission } from './capability-for-permission'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  requireExecutionAllowed,
  resetExecutionPolicy,
} from './execution-policy'
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

function decide(
  action: 'portal.read' | 'portal.create' | 'portal.update' | 'portal.delete',
) {
  const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
  const policy = createExecutionPolicy({ listAccessiblePropertyIds: async () => [] })
  return policy.decide({
    principal: { kind: 'user', ctx },
    action,
    capability: capabilityForPermission(action),
    organizationId: ctx.organizationId as string,
    executionKind: 'interactive',
    now: new Date(),
  })
}

describe('BQC-0.2 portal capability taxonomy (STD-P0-01)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
    resetExecutionPolicy()
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

    it('allows portal.read when read capability is enabled and role permits', async () => {
      const decision = await decide('portal.read')
      expect(decision.allowed).toBe(true)
    })

    it('denies portal.create when only portal.read is enabled', async () => {
      const decision = await decide('portal.create')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_blocked')
    })

    it('denies portal.update and portal.delete when only portal.read is enabled', async () => {
      for (const action of ['portal.update', 'portal.delete'] as const) {
        const decision = await decide(action)
        expect(decision.allowed, action).toBe(false)
        expect(decision.reason, action).toBe('capability_blocked')
      }
    })

    it('requireExecutionAllowed denies portal.create for AccountAdmin under read-only capability', async () => {
      initExecutionPolicy(
        createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
      )
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      await expect(
        requireExecutionAllowed({ actor: ctx, action: 'portal.create' }),
      ).rejects.toMatchObject({
        _tag: 'AuthError',
        code: 'capability_blocked',
        status: 403,
      })
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
