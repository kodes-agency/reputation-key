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
