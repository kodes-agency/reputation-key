// Rights executor for the Google integration: what an Organization's Google
// connection and imports hold, and the scrub that closing the Organization
// applies to it.
//
// Export is an explicit allowlist of lifecycle status. Credentials, the Google
// subject, email and scopes, provider account and location identifiers,
// replay digests, discovery candidates and permit internals are never selected.
//
// Closure never talks to Google: an operator process has no provider runtime.
// A connection that still holds a credential has a live grant at Google, and
// scrubbing it here would leave a grant nobody can revoke, so apply refuses
// until the Organization's admin has used ordinary Disconnect (which revokes
// and redacts). Everything else is scoped to one organization_id.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  closeGoogleIntegration,
  eraseGoogleIntegrationForProperty,
  readGoogleRightsExport,
  readGoogleRightsPropertyExport,
  readGoogleRightsPropertyReport,
  readGoogleRightsReport,
} from '#/shared/db/lifecycle/google-rights-store'
import type { RightsExecutor } from './rights-executor'

export const GOOGLE_RIGHTS_EXPORT_PATH = 'integration/google-lifecycle.json'

export type GoogleRightsExecutorDeps = Readonly<{
  db: Database
  now?: () => Date
}>

export function createGoogleRightsExecutor(
  deps: GoogleRightsExecutorDeps,
): RightsExecutor {
  const now = deps.now ?? (() => new Date())
  return Object.freeze({
    name: 'google-integration',
    scopes: ['access', 'organization', 'property'] as const,
    report: (plan) =>
      plan.scope === 'property' && plan.propertyId
        ? readGoogleRightsPropertyReport(deps.db, plan.organizationId, plan.propertyId)
        : readGoogleRightsReport(deps.db, plan.organizationId, now()),
    async exportFiles(plan) {
      const payload = plan.propertyId
        ? await readGoogleRightsPropertyExport(
            deps.db,
            plan.organizationId,
            plan.propertyId,
          )
        : await readGoogleRightsExport(deps.db, plan.organizationId)
      return [
        {
          path: GOOGLE_RIGHTS_EXPORT_PATH,
          bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
        },
      ]
    },
    async apply(plan) {
      if (plan.scope === 'property') {
        if (!plan.propertyId) return { ok: false, error: '--property is required' }
        const erased = await eraseGoogleIntegrationForProperty(
          deps.db,
          plan.organizationId,
          plan.propertyId,
        )
        return erased.ok ? { ok: true, lines: [`deleted=${erased.deleted}`] } : erased
      }
      const outcome = await closeGoogleIntegration(deps.db, plan.organizationId, now())
      return outcome.ok
        ? {
            ok: true,
            lines: [`deleted=${outcome.deleted} scrubbed=${outcome.scrubbed}`],
          }
        : outcome
    },
  })
}
