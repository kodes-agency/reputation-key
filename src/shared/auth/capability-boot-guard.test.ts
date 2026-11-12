// The worker's capability boot guard.
//
// Invariants proven here:
//   1. A BETA_CAPABILITIES_OFF the policy cannot read refuses startup before
//      anything is installed or logged.
//   2. The startup policy manifest records version + effective posture
//      without tenant/content data.
//   3. The guard installs the store eagerly, and the lazy getStore() fallback
//      reads the same switches in processes the guard cannot reach (vite dev
//      server skips Nitro plugins).

import { describe, it, expect, afterEach } from 'vitest'
import { checkGlobalCapability, resetCapabilityPolicyStore } from './beta-capabilities'
import {
  buildCapabilityBootManifest,
  runCapabilityBootGuard,
} from './capability-boot-guard'

function makeLogger() {
  const entries: Array<{ obj: unknown; msg: string }> = []
  return {
    entries,
    info(obj: unknown, msg: string) {
      entries.push({ obj, msg })
    },
  }
}

describe('capability boot guard', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  describe('startup policy manifest', () => {
    it('records version, nodeEnv, blocked posture and the switches turned off', () => {
      const manifest = buildCapabilityBootManifest({
        NODE_ENV: 'test',
        BETA_CAPABILITIES_OFF: 'optional_email,google',
        BETA_E2E_EXECUTION_IDENTITY: 'playwright-e2e',
      })
      expect(manifest.policyVersion).toBeTruthy()
      expect(manifest.nodeEnv).toBe('test')
      expect(manifest.killSwitchActive).toBe(false)
      expect(manifest.switchesOff).toEqual(['google', 'optional_email'])
      expect(manifest.blockedCapabilities).toContain('gbp.reply.auto_publish')
      expect(manifest.blockedCapabilities).toContain('gbp.ai.cross_property_summary')
      expect(manifest.e2eExecutionIdentity).toBe('playwright-e2e')
    })

    it('records everything off as such', () => {
      const manifest = buildCapabilityBootManifest({ BETA_CAPABILITIES_OFF: 'all' })
      expect(manifest.killSwitchActive).toBe(true)
      expect(manifest.switchesOff).toEqual([])
    })

    it('records no tenant identifiers', () => {
      const manifest = buildCapabilityBootManifest({
        NODE_ENV: 'test',
        BETA_SUSPENDED_ORGS: 'org-secret-3',
      })
      expect(JSON.stringify(manifest)).not.toContain('org-secret-3')
    })
  })

  describe('runCapabilityBootGuard', () => {
    it('eagerly initializes the policy store and logs the manifest', () => {
      const logger = makeLogger()
      runCapabilityBootGuard(
        { NODE_ENV: 'production', BETA_CAPABILITIES_OFF: 'ai' },
        logger,
      )

      // Store is live without a lazy first-use fallback.
      expect(checkGlobalCapability('ai.analyze').allowed).toBe(false)
      expect(checkGlobalCapability('inbox.use').allowed).toBe(true)
      expect(logger.entries).toHaveLength(1)
      expect(JSON.stringify(logger.entries[0].obj)).toContain('policyVersion')
    })

    it('throws before logging when BETA_CAPABILITIES_OFF names something that is not a switch', () => {
      const logger = makeLogger()
      expect(() =>
        runCapabilityBootGuard(
          { NODE_ENV: 'production', BETA_CAPABILITIES_OFF: 'ai.analyze' },
          logger,
        ),
      ).toThrow(/BETA_CAPABILITIES_OFF names "ai.analyze"/)
      expect(logger.entries).toHaveLength(0)
    })
  })

  describe('lazy getStore fallback (processes without a boot guard)', () => {
    function withSwitchesOff<T>(value: string | undefined, fn: () => T): T {
      const saved = process.env.BETA_CAPABILITIES_OFF
      try {
        if (value === undefined) delete process.env.BETA_CAPABILITIES_OFF
        else process.env.BETA_CAPABILITIES_OFF = value
        resetCapabilityPolicyStore()
        return fn()
      } finally {
        if (saved === undefined) delete process.env.BETA_CAPABILITIES_OFF
        else process.env.BETA_CAPABILITIES_OFF = saved
      }
    }

    it('reads the switches from the process environment', () => {
      withSwitchesOff('guest_pages', () => {
        expect(checkGlobalCapability('portal.public_read').allowed).toBe(false)
        expect(checkGlobalCapability('review.use').allowed).toBe(true)
      })
    })

    it('fails closed on a name that is not a switch', () => {
      withSwitchesOff('portal.public_read', () => {
        expect(() => checkGlobalCapability('portal.public_read')).toThrow(/not a switch/)
      })
    })
  })
})
