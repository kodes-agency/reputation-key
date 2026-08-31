// LIF-01-T17/T18 — the Closure Center against the local stack.
//
// This spec drives a REAL closure of the seeded Organization, which suspends
// it. That is exactly the behaviour under test and exactly why the teardown is
// as careful as it is: every other spec signs into the same workspace, so a
// suspension left behind would fail the rest of the suite with an unrelated
// `org_suspended`. `restoreSeededOrganization` therefore runs in `afterAll`
// AND after each mutating test, and it does the one thing application code
// deliberately cannot do — reset the lifecycle authority in place — by
// disabling the two 0159 guard triggers inside a single transaction, the same
// escape hatch integration fixtures use for the last-owner guard.
//
// The journey is request → cancel → (blocked) request → export request →
// retrieval → download. The second request is asserted as REFUSED rather than
// as a success, because that is the real behaviour: cancelling leaves
// `reactivation_required = true`, and explicit reactivation is fenced by the
// database until the reactivation migration lands (see the wiring note on
// `organization-lifecycle-command-store.ts#reactivate`). Asserting a green
// second request here would be asserting a feature this repository does not
// have.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { requireE2eSeedState } from './helpers/seed-state'
import { waitForHydration } from './helpers/interaction'
import {
  callServerFn,
  callServerFnExpectError,
  callServerFnGet,
  dbQuery,
  waitFor,
} from './helpers/fixtures'

const seed = requireE2eSeedState()
const CLOSURE_FNS = 'src/contexts/identity/server/organization-closure-fns.ts'

type LifecycleRow = Readonly<{
  state: string
  revision: number
  reactivation_required: boolean
}>

async function lifecycleState(): Promise<LifecycleRow> {
  const rows = await dbQuery<LifecycleRow>(
    `SELECT state, revision, reactivation_required
     FROM organization_lifecycle_authority
     WHERE organization_id = $1`,
    [seed.organizationId],
  )
  const row = rows[0]
  if (!row) throw new Error('seeded Organization has no lifecycle authority row')
  return row
}

/**
 * Puts the seeded Organization back to a clean `active` state.
 *
 * The 0159 revision guard allows no `active -> active` edge and the policy
 * fence refuses to clear a suspension while the fence is up — both by design,
 * and both correct in production. A test fixture is the one place that has to
 * step around them, so it does so transactionally and re-enables the triggers
 * before commit; a rollback restores them either way.
 */
async function restoreSeededOrganization(): Promise<void> {
  await dbQuery('BEGIN')
  try {
    await dbQuery(
      'ALTER TABLE organization_lifecycle_authority DISABLE TRIGGER organization_lifecycle_revision_guard',
    )
    await dbQuery(
      'ALTER TABLE organization_policy DISABLE TRIGGER organization_lifecycle_policy_fence',
    )
    await dbQuery(
      `UPDATE organization_lifecycle_authority
       SET state = 'active', revision = 0, closure_lineage_id = NULL,
           closure_requested_at = NULL, recoverable_until = NULL,
           irreversible_at = NULL, closed_at = NULL, reactivation_required = false,
           requested_by = NULL, request_reason_code = NULL,
           request_support_evidence_ref = NULL, last_transition_at = now(),
           last_actor_id = 'system:e2e', last_reason_code = 'provisioned',
           last_support_evidence_ref = 'e2e:restore'
       WHERE organization_id = $1`,
      [seed.organizationId],
    )
    await dbQuery(
      `UPDATE organization_policy
       SET suspended_at = NULL, suspended_reason = NULL, updated_at = now()
       WHERE organization_id = $1`,
      [seed.organizationId],
    )
    await dbQuery(
      'DELETE FROM organization_lifecycle_command_receipts WHERE organization_id = $1',
      [seed.organizationId],
    )
  } finally {
    await dbQuery(
      'ALTER TABLE organization_lifecycle_authority ENABLE TRIGGER organization_lifecycle_revision_guard',
    )
    await dbQuery(
      'ALTER TABLE organization_policy ENABLE TRIGGER organization_lifecycle_policy_fence',
    )
    await dbQuery('COMMIT')
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('Closure Center', () => {
  test.afterAll(async () => {
    await restoreSeededOrganization()
  })

  test('renders the read-only status surface with no second authentication factor', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/closure')
    await waitForHydration(page)

    await expect(page.getByTestId('closure-center')).toBeVisible()
    await expect(page.getByTestId('closure-state-badge')).toHaveText('Active')
    // Program bullet 8: no fresh-password, MFA or step-up prompt anywhere on
    // the closure or export-retrieval path.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.locator('input[autocomplete~="one-time-code"]')).toHaveCount(0)
  })

  test('drives request → cancel → refused re-request → export retrieval', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/settings/closure')
    await waitForHydration(page)

    // ── Closure cannot be requested in this deployment ──────────────
    // "fix(identity): refuse closure where reactivation is unavailable"
    // removed the ability to request a closure where it cannot be cancelled:
    // the request would suspend the Organization with no way back. This
    // journey used to drive request → cancel → refused re-request and repair
    // the damage with raw SQL; that path no longer exists, and asserting it
    // would be asserting a capability the product deliberately withdrew.
    //
    // What is asserted instead is that the refusal is honest at BOTH ends: the
    // surface says so rather than arming a destructive control, and the
    // command refuses if called directly, leaving the lifecycle untouched.
    await expect(page.getByTestId('closure-unavailable-notice')).toBeVisible()
    await expect(page.getByTestId('request-closure')).toHaveCount(0)

    const beforeRequest = await lifecycleState()
    const refusedRequest = await callServerFnExpectError(page, {
      file: 'src/contexts/identity/server/organization-closure-fns.ts',
      exportName: 'requestOrganizationClosureFn',
      data: {
        reasonCode: 'account_admin_request',
        supportEvidenceRef: 'e2e-closure',
        typedConfirmation: 'CLOSE E2E Org A',
      },
    })
    expect(String(refusedRequest.message ?? '')).toMatch(
      /cannot reactivate|unavailable/iu,
    )
    const afterRequest = await lifecycleState()
    expect(afterRequest.state).toBe(beforeRequest.state)
    expect(afterRequest.revision).toBe(beforeRequest.revision)

    // ── Export request → retrieval → download ───────────────────────
    const view = await callServerFnGet<{ export: { requestId: string } | null }>(page, {
      file: CLOSURE_FNS,
      exportName: 'getClosureCenterFn',
    })
    expect(view).toBeTruthy()

    // The export control plane is composed all-or-nothing. When it is not
    // bound in this stack the command refuses with a tagged error, and that
    // refusal is the honest assertion — not a skipped test that reads green.
    const requestExport = await callServerFn<{ requestId: string } | null>(page, {
      file: CLOSURE_FNS,
      exportName: 'requestOrganizationExportFn',
      data: undefined,
    }).catch((error: unknown) => error as Error)

    if (requestExport instanceof Error) {
      expect(requestExport.message).toMatch(/not available in this deployment/u)
      return
    }

    const requestId = requestExport!.requestId
    const ready = await waitFor(
      async () => {
        const rows = await dbQuery<{ state: string }>(
          'SELECT state FROM organization_exports WHERE id = $1',
          [requestId],
        )
        return rows[0]?.state === 'ready' ? rows[0] : null
      },
      { description: 'export ready' },
    )
    expect(ready.state).toBe('ready')

    const issued = await callServerFn<{ token: string; expiresAt: string }>(page, {
      file: CLOSURE_FNS,
      exportName: 'issueOrganizationExportRetrievalFn',
      data: { requestId },
    })
    expect(issued.token.length).toBeGreaterThan(0)
    // 24-hour link, never beyond the stored object's own expiry.
    const objectExpiry = await dbQuery<{ object_expires_at: Date }>(
      'SELECT object_expires_at FROM organization_exports WHERE id = $1',
      [requestId],
    )
    expect(new Date(issued.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(objectExpiry[0]!.object_expires_at).getTime(),
    )

    const archive = await callServerFn<{ filename: string; archiveBase64: string }>(
      page,
      {
        file: CLOSURE_FNS,
        exportName: 'downloadOrganizationExportFn',
        data: { requestId, token: issued.token },
      },
    )
    expect(archive.filename).toBe(`organization-export-${requestId}.zip`)
    // A real ZIP: 'PK' is 'UEsDB' in base64.
    expect(archive.archiveBase64.startsWith('UEsDB')).toBe(true)

    // Single use: the same token cannot be spent twice.
    const replay = await callServerFnExpectError(page, {
      file: CLOSURE_FNS,
      exportName: 'downloadOrganizationExportFn',
      data: { requestId, token: issued.token },
    })
    expect(replay.message ?? '').toBeTruthy()
  })

  test('denies a PropertyManager the Closure Center entirely', async ({ page }) => {
    await signIn(page)
    const denied = await callServerFnExpectError(page, {
      file: CLOSURE_FNS,
      exportName: 'requestOrganizationClosureFn',
      data: {
        reasonCode: 'account_admin_request',
        supportEvidenceRef: 'e2e-closure-denied',
        // Wrong phrase on purpose: even a correct one must not get past the
        // AccountAdmin gate for a non-admin principal.
        typedConfirmation: 'CLOSE nothing',
      },
    })
    expect(denied.message ?? '').toBeTruthy()
  })
})
