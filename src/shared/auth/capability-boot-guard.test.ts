// BQC-0.3 / SPEC-P0-03 — test-only capability overrides must not boot outside
// an explicit test/CI execution identity.
//
// Invariants proven here:
//   1. BETA_E2E_GLOBAL_CAPABILITIES refuses process startup unless
//      NODE_ENV=test or an explicit BETA_E2E_EXECUTION_IDENTITY is present.
//   2. Every blocked capability fails a production boot assertion, even if a
//      hostile policy store tries to globally enable it.
//   3. The startup policy manifest records version + effective posture
//      without tenant/content data.
//   4. The lazy getStore() fallback enforces the same rules in processes the
//      boot guard cannot reach (vite dev server skips Nitro plugins).

import { describe, it, expect, afterEach } from 'vitest'
import {
  assertBlockedCapabilitiesContained,
  assertE2EOverrideIdentity,
  checkGlobalCapability,
  listBlockedCapabilities,
  resetCapabilityPolicyStore,
  type Capability,
  type CapabilityPolicyEnv,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import {
  buildCapabilityBootManifest,
  runCapabilityBootGuard,
} from './capability-boot-guard'

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

function makeLogger() {
  const entries: Array<{ obj: unknown; msg: string }> = []
  return {
    entries,
    info(obj: unknown, msg: string) {
      entries.push({ obj, msg })
    },
  }
}

const OVERRIDE = 'identity.register,organization.create'

describe('BQC-0.3 capability boot guard (SPEC-P0-03)', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  describe('test-only override identity', () => {
    it('refuses startup when the override is set in production', () => {
      const env: CapabilityPolicyEnv = {
        NODE_ENV: 'production',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
      }
      expect(() => assertE2EOverrideIdentity(env)).toThrow(
        /BETA_E2E_GLOBAL_CAPABILITIES.*production|test\/CI/i,
      )
    })

    it('refuses startup when the override is set in development', () => {
      const env: CapabilityPolicyEnv = {
        NODE_ENV: 'development',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
      }
      expect(() => assertE2EOverrideIdentity(env)).toThrow(
        /BETA_E2E_GLOBAL_CAPABILITIES/i,
      )
    })

    it('refuses startup when NODE_ENV is absent (defaults to non-test)', () => {
      const env: CapabilityPolicyEnv = {
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
      }
      expect(() => assertE2EOverrideIdentity(env)).toThrow(
        /BETA_E2E_GLOBAL_CAPABILITIES/i,
      )
    })

    it('allows startup when the override is set with NODE_ENV=test', () => {
      const env: CapabilityPolicyEnv = {
        NODE_ENV: 'test',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
      }
      expect(() => assertE2EOverrideIdentity(env)).not.toThrow()
    })

    it('allows startup with an explicit execution identity (CI e2e dev server)', () => {
      // CI e2e runs `pnpm dev`, whose script pins NODE_ENV=development — the
      // explicit identity var is what authorizes the override there.
      const env: CapabilityPolicyEnv = {
        NODE_ENV: 'development',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
        BETA_E2E_EXECUTION_IDENTITY: 'playwright-e2e',
      }
      expect(() => assertE2EOverrideIdentity(env)).not.toThrow()
    })

    it('allows startup in production when the override is absent or empty', () => {
      expect(() => assertE2EOverrideIdentity({ NODE_ENV: 'production' })).not.toThrow()
      expect(() =>
        assertE2EOverrideIdentity({
          NODE_ENV: 'production',
          BETA_E2E_GLOBAL_CAPABILITIES: '',
        }),
      ).not.toThrow()
    })

    it('treats a whitespace/separator-only override as empty', () => {
      const env: CapabilityPolicyEnv = {
        NODE_ENV: 'production',
        BETA_E2E_GLOBAL_CAPABILITIES: ' , , ',
      }
      expect(() => assertE2EOverrideIdentity(env)).not.toThrow()
    })
  })

  describe('production boot assertion for blocked capabilities', () => {
    it('passes for the standard env policy store', () => {
      expect(() => assertBlockedCapabilitiesContained(makeStore())).not.toThrow()
    })

    it('fails when any blocked capability is globally enabled', () => {
      for (const cap of listBlockedCapabilities()) {
        const hostile = makeStore({
          isCapabilityGloballyEnabled: (c: Capability) => c === cap,
        })
        expect(
          () => assertBlockedCapabilitiesContained(hostile),
          `blocked capability ${cap} must fail the boot assertion`,
        ).toThrow(new RegExp(cap.replace('.', '\\.')))
      }
    })
  })

  describe('startup policy manifest', () => {
    it('records version, nodeEnv, core/blocked posture, and effective overrides', () => {
      const manifest = buildCapabilityBootManifest({
        NODE_ENV: 'test',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
        BETA_E2E_EXECUTION_IDENTITY: 'playwright-e2e',
      })
      expect(manifest.policyVersion).toBeTruthy()
      expect(manifest.nodeEnv).toBe('test')
      expect(manifest.coreCapabilities.length).toBeGreaterThan(0)
      expect(manifest.blockedCapabilities).toContain('portal.write')
      expect(manifest.blockedCapabilities).toContain('portal.upload')
      expect(manifest.e2eGlobalOverrides).toEqual(
        expect.arrayContaining(['identity.register', 'organization.create']),
      )
      expect(manifest.e2eExecutionIdentity).toBe('playwright-e2e')
    })

    it('filters blocked capabilities out of recorded overrides', () => {
      const manifest = buildCapabilityBootManifest({
        NODE_ENV: 'test',
        BETA_E2E_GLOBAL_CAPABILITIES: 'portal.write,portal.upload,team.use',
      })
      expect(manifest.e2eGlobalOverrides).toEqual(['team.use'])
    })

    it('records no tenant identifiers', () => {
      const manifest = buildCapabilityBootManifest({
        NODE_ENV: 'test',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
        BETA_ALLOWLIST_ORGS: 'org-secret-1,org-secret-2',
        BETA_SUSPENDED_ORGS: 'org-secret-3',
      })
      const serialized = JSON.stringify(manifest)
      expect(serialized).not.toContain('org-secret-1')
      expect(serialized).not.toContain('org-secret-2')
      expect(serialized).not.toContain('org-secret-3')
    })
  })

  describe('runCapabilityBootGuard', () => {
    it('eagerly initializes the policy store and logs the manifest', () => {
      const logger = makeLogger()
      runCapabilityBootGuard(
        {
          NODE_ENV: 'test',
          BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
        },
        logger,
      )
      // Store is live without a lazy first-use fallback.
      expect(checkGlobalCapability('identity.register').allowed).toBe(true)
      expect(checkGlobalCapability('portal.write').allowed).toBe(false)
      expect(logger.entries.length).toBeGreaterThan(0)
      expect(JSON.stringify(logger.entries[0].obj)).toContain('policyVersion')
    })

    it('throws before logging when the override identity is invalid', () => {
      const logger = makeLogger()
      expect(() =>
        runCapabilityBootGuard(
          { NODE_ENV: 'production', BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE },
          logger,
        ),
      ).toThrow(/BETA_E2E_GLOBAL_CAPABILITIES/i)
      expect(logger.entries).toHaveLength(0)
    })
  })

  describe('lazy getStore safety net (processes without a boot guard)', () => {
    const ENV_KEYS = [
      'NODE_ENV',
      'BETA_E2E_GLOBAL_CAPABILITIES',
      'BETA_E2E_EXECUTION_IDENTITY',
    ] as const

    function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
      const saved = new Map<string, string | undefined>(
        ENV_KEYS.map((k) => [k, process.env[k]]),
      )
      try {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
        return fn()
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    }

    it('throws on first capability check when the override leaks without identity', () => {
      withEnv(
        {
          NODE_ENV: 'production',
          BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
          BETA_E2E_EXECUTION_IDENTITY: undefined,
        },
        () => {
          resetCapabilityPolicyStore()
          expect(() => checkGlobalCapability('identity.register')).toThrow(
            /BETA_E2E_GLOBAL_CAPABILITIES/i,
          )
        },
      )
    })

    it('still honors the override through the lazy path under a test identity', () => {
      withEnv(
        {
          NODE_ENV: 'test',
          BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
          BETA_E2E_EXECUTION_IDENTITY: undefined,
        },
        () => {
          resetCapabilityPolicyStore()
          expect(checkGlobalCapability('identity.register').allowed).toBe(true)
          expect(checkGlobalCapability('portal.write').allowed).toBe(false)
        },
      )
    })
  })
})
