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
})
