// Tests for the capability policy: four switches, everything off, suspension
// and blocked fates.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CAPABILITIES,
  FEATURE_SWITCHES,
  checkBetaCapability,
  checkScopedCapability,
  assertBetaCapability,
  BetaCapabilityError,
  capabilitiesOffProblem,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  createEnvCapabilityPolicyStore,
  isBlockedCapability,
  isCapabilityJobEnabled,
  isCapabilityOpenToEveryOrganization,
  listAllCapabilities,
  listBlockedCapabilities,
  checkGlobalCapability,
  parseSwitchesOff,
  type Capability,
  type CapabilityPolicyStore,
} from './beta-capabilities'
import {
  CAPABILITY_FATE,
  listCapabilitiesBySwitch,
  listCapabilitiesNeedingOrganization,
} from '#/shared/governance/capability-fate'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

const ORG = 'org-00000000-0000-0000-0000-000000000001'
const OTHER_ORG = 'org-00000000-0000-0000-0000-000000000002'

function install(env: Readonly<Record<string, string | undefined>>): void {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
}

function allowedFor(organizationId: string): Capability[] {
  return listAllCapabilities().filter(
    (capability) => checkScopedCapability({ organizationId }, capability).allowed,
  )
}

/**
 * Every capability the beta ran before the switches: the catalogue's
 * capabilities whose fate lets them run. Admission let every Organization in
 * (`BETA_ALLOWLIST_ORGS=*`), so its old core and controlled-beta fates both
 * ran; the rest were blocked.
 */
const ON_TODAY: ReadonlyArray<Capability> = CAPABILITIES.filter(
  (capability) => CAPABILITY_FATE[capability].fate === 'core',
).sort()

// What the policy reads on the beta today: nothing switched off, nobody
// suspended.
const BETA_ENV = { NODE_ENV: 'production' }

describe('BetaCapabilities', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
    delete process.env.RESTORE_MODE
  })

  describe('the beta environment', () => {
    it('runs exactly what it ran before, for every Organization', () => {
      install(BETA_ENV)

      expect(ON_TODAY).toHaveLength(27)
      expect(allowedFor(ORG)).toEqual(ON_TODAY)
      expect(allowedFor(OTHER_ORG)).toEqual(ON_TODAY)
    })

    it('refuses only the blocked fates, with the blocked reason', () => {
      install(BETA_ENV)

      const refused = listAllCapabilities().filter(
        (capability) => !ON_TODAY.includes(capability),
      )
      expect(refused).toHaveLength(10)
      expect(refused).toEqual([...listBlockedCapabilities()])
      for (const capability of refused) {
        expect(checkScopedCapability({ organizationId: ORG }, capability).reason).toBe(
          'capability_blocked',
        )
      }
    })
  })

  describe('switches', () => {
    it('names four switches', () => {
      expect(FEATURE_SWITCHES).toEqual(['google', 'ai', 'guest_pages', 'optional_email'])
    })

    it('puts every Google call under google', () => {
      expect(listCapabilitiesBySwitch('google')).toEqual([
        'gbp.reply.auto_publish',
        'property.connect_gbp',
        'property.import_gbp_v2',
        'property.publish_reply',
        'property.read_gbp_performance',
      ])
    })

    it('puts every AI call under ai', () => {
      expect(listCapabilitiesBySwitch('ai')).toEqual([
        'ai.analyze',
        'ai.detect_trends',
        'ai.generate_reply',
        'gbp.ai.cross_property_summary',
        'gbp.review_solicitation_gamification',
      ])
    })

    it('puts guest traffic under guest_pages and leaves Portal management alone', () => {
      expect(listCapabilitiesBySwitch('guest_pages')).toEqual([
        'portal.guest_contact',
        'portal.guest_media',
        'portal.guest_response',
        'portal.guest_text',
        'portal.public_read',
      ])
    })

    it('puts optional email under optional_email and leaves mandatory notices alone', () => {
      expect(listCapabilitiesBySwitch('optional_email')).toEqual([
        'notification.send_email',
      ])
    })

    it.each(FEATURE_SWITCHES)('%s off refuses exactly its group', (featureSwitch) => {
      install({ BETA_CAPABILITIES_OFF: featureSwitch })

      const group = listCapabilitiesBySwitch(featureSwitch)
      for (const capability of group) {
        expect(checkScopedCapability({ organizationId: ORG }, capability).allowed).toBe(
          false,
        )
      }
      expect(allowedFor(ORG)).toEqual(
        ON_TODAY.filter((capability) => !group.includes(capability)),
      )
      for (const capability of group.filter((entry) => ON_TODAY.includes(entry))) {
        expect(checkScopedCapability({ organizationId: ORG }, capability).reason).toBe(
          'capability_disabled',
        )
        expect(checkGlobalCapability(capability).reason).toBe('capability_disabled')
        expect(isCapabilityOpenToEveryOrganization(capability)).toBe(false)
      }
    })

    it('keeps mandatory notices running while optional email is off', () => {
      install({ BETA_CAPABILITIES_OFF: 'optional_email' })

      expect(
        checkScopedCapability(
          { organizationId: ORG },
          'notification.send_mandatory_email',
        ).allowed,
      ).toBe(true)
      expect(checkGlobalCapability('notification.send_mandatory_email').allowed).toBe(
        true,
      )
      expect(isCapabilityOpenToEveryOrganization('notification.send_email')).toBe(false)
    })

    it('turns several switches off together', () => {
      install({ BETA_CAPABILITIES_OFF: 'google, ai' })

      expect(parseSwitchesOff({ BETA_CAPABILITIES_OFF: 'google, ai' })).toEqual([
        'google',
        'ai',
      ])
      const scoped = (capability: Capability) =>
        checkScopedCapability({ organizationId: ORG }, capability).allowed
      expect(scoped('property.publish_reply')).toBe(false)
      expect(scoped('ai.generate_reply')).toBe(false)
      expect(scoped('portal.public_read')).toBe(true)
      expect(scoped('notification.send_email')).toBe(true)
    })

    it('refuses a name that is not a switch rather than ignore it', () => {
      // A per-capability name left over from before would otherwise turn back
      // on what its operator turned off.
      for (const value of ['property.connect_gbp', 'google,ai.analyze', 'Google']) {
        expect(capabilitiesOffProblem(value)).toMatch(/not a switch/)
        expect(() =>
          createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: value }),
        ).toThrow(/not a switch/)
      }
      expect(capabilitiesOffProblem(undefined)).toBeNull()
      expect(capabilitiesOffProblem('')).toBeNull()
      expect(capabilitiesOffProblem('guest_pages,optional_email')).toBeNull()
    })
  })

  describe('everything off', () => {
    it.each(['1', 'true', 'all', 'ALL'])(
      'BETA_CAPABILITIES_OFF=%s refuses every capability',
      (value) => {
        install({ BETA_CAPABILITIES_OFF: value })

        expect(allowedFor(ORG)).toEqual([])
        expect(
          checkScopedCapability({ organizationId: ORG }, 'identity.invite').reason,
        ).toBe('capability_disabled')
        expect(parseSwitchesOff({ BETA_CAPABILITIES_OFF: value })).toEqual([])
      },
    )
  })

  describe('suspension', () => {
    it('refuses every capability for the suspended Organization and nobody else', () => {
      install({ BETA_SUSPENDED_ORGS: ` ${ORG} ` })

      expect(allowedFor(ORG)).toEqual([])
      expect(checkScopedCapability({ organizationId: ORG }, 'inbox.use').reason).toBe(
        'org_suspended',
      )
      expect(allowedFor(OTHER_ORG)).toEqual(ON_TODAY)
    })

    it('reports a switched-off capability as switched off before the suspension', () => {
      install({ BETA_SUSPENDED_ORGS: ORG, BETA_CAPABILITIES_OFF: 'ai' })

      expect(checkScopedCapability({ organizationId: ORG }, 'ai.analyze').reason).toBe(
        'capability_disabled',
      )
      expect(checkScopedCapability({ organizationId: ORG }, 'inbox.use').reason).toBe(
        'org_suspended',
      )
    })

    it('is never decided without an Organization', () => {
      install({ BETA_SUSPENDED_ORGS: ORG })

      expect(checkGlobalCapability('inbox.use').allowed).toBe(true)
    })
  })

  describe('a call that names no Organization', () => {
    // These ran only for an admitted Organization, so a call naming none was
    // refused; it still is, or an org-less caller would reach tenant work.
    it('is refused every capability that needs an Organization', () => {
      install(BETA_ENV)

      const needing = listCapabilitiesNeedingOrganization()
      expect(needing).toHaveLength(13)
      for (const capability of needing) {
        expect(checkGlobalCapability(capability)).toEqual({
          allowed: false,
          reason: 'capability_disabled',
          capability,
        })
        expect(checkScopedCapability({ organizationId: ORG }, capability).allowed).toBe(
          true,
        )
      }
    })

    it('still runs the rest, as before', () => {
      install(BETA_ENV)

      const needing = listCapabilitiesNeedingOrganization()
      const globallyAllowed = listAllCapabilities().filter(
        (capability) => checkGlobalCapability(capability).allowed,
      )
      expect(globallyAllowed).toEqual(
        ON_TODAY.filter((capability) => !needing.includes(capability)),
      )
    })

    it('reads a capability as open to every Organization unless it is switched off', () => {
      install(BETA_ENV)

      expect(isCapabilityOpenToEveryOrganization('notification.send_email')).toBe(true)
      expect(isCapabilityOpenToEveryOrganization('identity.register')).toBe(false)
      install({ BETA_CAPABILITIES_OFF: 'all' })
      expect(isCapabilityOpenToEveryOrganization('notification.send_email')).toBe(false)
    })
  })

  describe('blocked fates', () => {
    it('never run, whatever the switches say', () => {
      install({})

      for (const capability of listBlockedCapabilities()) {
        expect(checkGlobalCapability(capability).reason).toBe('capability_blocked')
        expect(isCapabilityJobEnabled(capability)).toBe(false)
      }
    })

    it('identifies permanent prohibitions and the remaining temporary containment', () => {
      expect(isBlockedCapability('gbp.reply.auto_publish')).toBe(true)
      expect(isBlockedCapability('gbp.ai.cross_property_summary')).toBe(true)
      expect(isBlockedCapability('gbp.review_solicitation_gamification')).toBe(true)
      expect(isBlockedCapability('portal.write')).toBe(false)
      expect(isBlockedCapability('portal.upload')).toBe(false)
      expect(isBlockedCapability('portal.guest_contact')).toBe(true)
      expect(isBlockedCapability('identity.custom_roles')).toBe(true)
      expect(isBlockedCapability('identity.register')).toBe(true)
      expect(isBlockedCapability('organization.create')).toBe(true)
      expect(isBlockedCapability('notification.send_email')).toBe(false)
    })
  })

  describe('assertBetaCapability', () => {
    beforeEach(() => {
      install({ BETA_CAPABILITIES_OFF: 'guest_pages' })
    })

    it('throws BetaCapabilityError when denied', () => {
      const ctx = buildTestAuthContext()
      expect(() => assertBetaCapability(ctx, 'portal.public_read')).toThrow(
        BetaCapabilityError,
      )
    })

    it('does not throw when allowed', () => {
      const ctx = buildTestAuthContext()
      expect(() => assertBetaCapability(ctx, 'portal.write')).not.toThrow()
    })
  })

  describe('capability metadata', () => {
    it('publishes the complete catalogue exactly once in sorted order', () => {
      const capabilities = listAllCapabilities()

      expect(capabilities).toHaveLength(CAPABILITIES.length)
      expect(new Set(capabilities).size).toBe(CAPABILITIES.length)
      expect(capabilities).toEqual([...CAPABILITIES].sort())
      expect(capabilities).toEqual(expect.arrayContaining([...listBlockedCapabilities()]))
    })

    it('keeps jobs registered while their switch is off', () => {
      install({ BETA_CAPABILITIES_OFF: 'optional_email' })

      expect(isCapabilityJobEnabled('notification.send_email')).toBe(true)
      expect(isCapabilityJobEnabled('portal.upload')).toBe(true)
      expect(isCapabilityJobEnabled('portal.guest_media')).toBe(false)
    })
  })

  describe('restore-isolated mode', () => {
    const allowAll: CapabilityPolicyStore = {
      isCapabilityKilled: () => false,
      isOrgSuspended: () => false,
    }

    beforeEach(() => {
      initCapabilityPolicyStore(allowAll)
    })

    it('denies every capability even when the installed store allows it', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()

      expect(checkBetaCapability(ctx, 'identity.invite').reason).toBe(
        'capability_disabled',
      )
      expect(checkBetaCapability(ctx, 'goal.use').allowed).toBe(false)
    })

    it('denies the global check and the job gate (schedules stay dark)', () => {
      process.env.RESTORE_MODE = 'isolated'
      expect(checkGlobalCapability('identity.invite').allowed).toBe(false)
      expect(isCapabilityJobEnabled('identity.invite')).toBe(false)
    })

    it('keeps blocked capabilities denied with the blocked reason', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      const decision = checkBetaCapability(ctx, 'gbp.reply.auto_publish')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('capability_blocked')
    })

    it('restores the installed store the moment RESTORE_MODE is unset', () => {
      process.env.RESTORE_MODE = 'isolated'
      const ctx = buildTestAuthContext()
      expect(checkBetaCapability(ctx, 'identity.invite').allowed).toBe(false)
      delete process.env.RESTORE_MODE
      expect(checkBetaCapability(ctx, 'identity.invite').allowed).toBe(true)
    })
  })
})
