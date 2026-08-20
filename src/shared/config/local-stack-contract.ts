import type { Capability } from '#/shared/auth/beta-capabilities'

export type LocalStackMode = 'beta' | 'e2e' | 'perf'

/**
 * Non-core features promoted for the controlled local beta cohort.
 * Permanently blocked Google behaviors are deliberately absent.
 */
export const LOCAL_BETA_CAPABILITIES = [
  'identity.register',
  'organization.create',
  'notification.send_email',
  'portal.read',
  'portal.write',
  'portal.upload',
  'portal.public_read',
  'portal.guest_response',
  'portal.guest_text',
  'portal.guest_contact',
  'portal.guest_media',
  'team.use',
  'goal.use',
  'badge.use',
  'leaderboard.use',
  'property.import_gbp_v2',
  'property.read_gbp_performance',
] as const satisfies ReadonlyArray<Capability>

/**
 * Process-wide exceptions needed only to create a fresh E2E account and its
 * first organization. Product capabilities always come from persisted tenant
 * policy so revocation and suspension remain observable in acceptance tests.
 */
export const LOCAL_E2E_BOOTSTRAP_CAPABILITIES = [
  'identity.register',
  'organization.create',
] as const satisfies ReadonlyArray<Capability>

/**
 * Capabilities `pnpm seed` deliberately withholds from a developer
 * organization. Each one reaches outside the machine or accepts unmoderated
 * anonymous input, so it must be granted per environment — with a reason and a
 * ticket, through `setOrgCapabilityFn` — rather than by running a seed script.
 *
 * The E2E stack still grants them (LOCAL_BETA_CAPABILITIES) because its
 * acceptance tests drive registration, org creation and the guest media
 * lifecycle against stubbed providers.
 */
export const SEED_WITHHELD_CAPABILITIES = [
  // Public self-service signup.
  'identity.register',
  // Self-serve organization creation.
  'organization.create',
  // Sends real email through the configured provider.
  'notification.send_email',
  // Accepts unmoderated inbound media from anonymous guests.
  'portal.guest_media',
] as const satisfies ReadonlyArray<Capability>

/**
 * What `pnpm seed` grants a developer organization and every one of its
 * properties: the local beta cohort minus the withheld set. Derived rather
 * than restated so a capability added to the cohort cannot silently miss the
 * developer seed.
 */
export const SEED_BETA_CAPABILITIES: ReadonlyArray<Capability> =
  LOCAL_BETA_CAPABILITIES.filter(
    (capability) =>
      !(SEED_WITHHELD_CAPABILITIES as ReadonlyArray<Capability>).includes(capability),
  )

export function localStackEnvironment(mode: LocalStackMode): Readonly<{
  E2E_WEB_CAPABILITY_OVERRIDE: string
  E2E_WEB_EXECUTION_IDENTITY: string
}> {
  if (mode !== 'e2e') {
    return {
      E2E_WEB_CAPABILITY_OVERRIDE: '',
      E2E_WEB_EXECUTION_IDENTITY: '',
    }
  }

  return {
    E2E_WEB_CAPABILITY_OVERRIDE: LOCAL_E2E_BOOTSTRAP_CAPABILITIES.join(','),
    E2E_WEB_EXECUTION_IDENTITY: 'local-playwright-e2e',
  }
}
