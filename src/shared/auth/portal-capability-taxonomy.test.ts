// ADR 0049 — portal read, write, and upload are independent capabilities.
//
// A store that serves portal.read alone cannot authorize manager mutation or
// media paths, and the Guest pages switch stops guests, not managers.

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
    isCapabilityKilled: () => false,
    isOrgSuspended: () => false,
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

    it('keeps read, write and upload promotable, and Contact Requests safety-blocked', () => {
      expect(isBlockedCapability('portal.write')).toBe(false)
      expect(isBlockedCapability('portal.upload')).toBe(false)
      expect(isBlockedCapability('portal.read')).toBe(false)
      expect(isBlockedCapability('portal.guest_contact')).toBe(true)
    })
  })

  describe('read enablement cannot open mutations', () => {
    beforeEach(() => {
      // Only portal.read is served; the organization and property are
      // otherwise eligible so denial isolates the independent capability.
      initCapabilityPolicyStore(
        makeStore({ isCapabilityKilled: (cap) => cap !== 'portal.read' }),
      )
    })

    it('allows portal.read when read capability is enabled and role permits', async () => {
      const decision = await decide('portal.read')
      expect(decision.allowed).toBe(true)
    })

    it('denies portal.create when only portal.read is enabled', async () => {
      const decision = await decide('portal.create')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_disabled')
    })

    it('denies portal.update and portal.delete when only portal.read is enabled', async () => {
      for (const action of ['portal.update', 'portal.delete'] as const) {
        const decision = await decide(action)
        expect(decision.allowed, action).toBe(false)
        expect(decision.reason, action).toBe('capability_disabled')
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
        code: 'capability_disabled',
        status: 403,
      })
    })
  })

  describe('guest pages switched off', () => {
    it('keeps manager Portal read, write and upload, and stops the guest surface', () => {
      const store = createEnvCapabilityPolicyStore({
        BETA_CAPABILITIES_OFF: 'guest_pages',
      })
      expect(store.isCapabilityKilled('portal.read')).toBe(false)
      expect(store.isCapabilityKilled('portal.write')).toBe(false)
      expect(store.isCapabilityKilled('portal.upload')).toBe(false)
      expect(store.isCapabilityKilled('portal.public_read')).toBe(true)
      expect(store.isCapabilityKilled('portal.guest_response')).toBe(true)
    })
  })
})
