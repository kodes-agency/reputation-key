import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Google admission database authority architecture', () => {
  it('uses only the journaled execute-only database API at runtime', () => {
    const authority = source(
      'services/google-execution-admission/postgres-permit-authority.ts',
    )

    expect(authority).toContain('load_google_execution_permit_v1')
    expect(authority).toContain('start_google_execution_permit_v3')
    expect(authority).toContain('fail_google_execution_permit_v1')
    expect(authority).toContain('complete_google_execution_permit_v1')
    expect(authority).not.toMatch(/\b(?:FROM|UPDATE) authorization_execution_permits\b/u)
    expect(authority).not.toContain('capability_compliance_approvals AS approval')
  })

  it('keeps prospective exchange admission and adds exact disconnect cleanup admission', () => {
    const exchangeMigration = source('drizzle/0162_google_oauth_gateway_admission.sql')
    const migration = source('drizzle/0164_google_provider_recovery_authority.sql')

    expect(migration).toContain('FUNCTION public.start_google_execution_permit_v3')
    expect(migration).toContain("p_route_key <> 'oauth.revoke'")
    expect(migration).toContain('public.start_google_execution_permit_v2(')
    expect(migration).toContain('google_disconnect_revoke_attempts AS attempt')
    expect(migration).toContain("connection.credential_use_state = 'cleanup_only'")
    expect(exchangeMigration).toContain("'exchange_new'")
    expect(exchangeMigration).toContain("'exchange_existing'")
    expect(exchangeMigration).toContain('google_organization_credential_homes AS home')
    expect(exchangeMigration).toContain('connection.id IS NULL')
    expect(exchangeMigration).toContain(
      "permit.operation_key = 'provider.oauth.token.exchange'",
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.start_google_execution_permit_v3\([\s\S]*? FROM PUBLIC/u,
    )
  })

  it('journals security-definer operations and removes public execution', () => {
    const migration = source('drizzle/0079_google-admission-database-authority.sql')

    for (const name of [
      'load_google_execution_permit_v1',
      'start_google_execution_permit_v1',
      'fail_google_execution_permit_v1',
      'complete_google_execution_permit_v1',
    ]) {
      expect(migration).toContain(`FUNCTION public.${name}`)
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*? FROM PUBLIC`,
          'u',
        ),
      )
    }
    expect(migration.match(/SECURITY DEFINER/gu)).toHaveLength(4)
    expect(migration.match(/SET search_path = pg_catalog, public/gu)).toHaveLength(4)
    expect(migration).toContain('clock_timestamp()')
    expect(migration).toContain('FOR UPDATE OF permit')
    expect(migration).toContain("interval '30 seconds'")
    expect(migration).toContain("permit.route_key <> 'oauth.revoke'")
    expect(migration).toContain("permit.route_key = 'oauth.revoke'")
    expect(migration).toContain('revoke.cleanup_work_permit_id = permit.id')
    expect(migration).toContain("revoke.state = 'dispatching'")
    expect(migration).toContain("guard.state = 'cleanup_pending'")
  })

  it('provisions a Railway-compatible login with functions but no tables', () => {
    const provisioner = source('scripts/ops/provision-google-admission-role.ts')

    expect(provisioner).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION')
    expect(provisioner).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public')
    expect(provisioner).toContain('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public')
    expect(provisioner).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
    expect(provisioner.match(/GRANT EXECUTE ON FUNCTION/gu)).toHaveLength(4)
    expect(provisioner).toContain("statement_timeout = '3s'")

    const authority = source(
      'services/google-execution-admission/postgres-permit-authority.ts',
    )
    expect(authority).toContain(
      "NOT has_schema_privilege(current_user, 'public', 'CREATE')",
    )
    expect(authority).toContain('has_sequence_privilege')
    expect(authority).toContain('::regprocedure')
  })

  it('starts a permit without coupling it to the deployed release sha', () => {
    const superseded = source('drizzle/0175_google_core_capability_start_authority.sql')
    const sql = source('drizzle/0177_google_permit_release_decoupling.sql')
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
    const count = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1

    // All four occurrences are pinned: v1 gated both its branches (ordinary
    // work and the `oauth.revoke` cleanup drain), and v2 and v3 each re-check
    // the approval themselves before delegating — so replacing v1 alone would
    // have left the OAuth exchange and revoke routes fenced.
    expect(superseded.match(/AND approval\.release_sha = p_release_sha/gu)).toHaveLength(
      2,
    )
    for (const earlier of [
      'drizzle/0162_google_oauth_gateway_admission.sql',
      'drizzle/0164_google_provider_recovery_authority.sql',
    ]) {
      expect(
        source(earlier).match(/AND approval\.release_sha = p_release_sha/gu),
      ).toHaveLength(1)
    }
    expect(sql).not.toContain('approval.release_sha')

    // All three authorities are redefined together, and arity is preserved
    // deliberately: the admission sidecar calls v3 by regprocedure and v3
    // delegates through v2 with nine arguments, and it is a pinned image that
    // cannot redeploy in lockstep with a migration.
    expect(
      count(sql, 'CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v'),
    ).toBe(3)
    expect(sql).toContain(
      'FUNCTION public.start_google_execution_permit_v1(p_permit_id uuid, p_permit_generation bigint, p_policy_version bigint, p_emergency_kill_version bigint, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_authorization_vector jsonb, p_release_sha text)',
    )

    // Every other approval control survives, in all four branches.
    for (const predicate of [
      "approval.status = 'approved'",
      'approval.route_catalog_version = permit.route_catalog_version',
      'approval.google_project_attestation_sha256 =',
      'approval.railway_closed_beta_cohort @>',
    ]) {
      expect(count(sql, predicate)).toBe(4)
    }
    expect(count(sql, 'newer.binding_version > approval.binding_version')).toBe(2)
    expect(count(sql, 'control.denied = false')).toBe(2)
    expect(sql.match(/SECURITY DEFINER/gu)).toHaveLength(3)
  })
})
