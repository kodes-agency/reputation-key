import { describe, expect, it } from 'vitest'
import {
  AI_ADMISSION_PUBLIC_PROCEDURES,
  sidecarFunctionIsolationSql,
} from './sidecar-function-isolation'

describe('sidecar function isolation', () => {
  it('allows exactly the five procedures the AI readiness posture permits', () => {
    // These are copied from the readiness predicate in
    // services/ai-execution-admission/postgres-admission-authority.ts. If that
    // list changes and this one does not, the revoke removes a procedure the
    // sidecar needs and it stops booting — so the set is pinned here.
    expect([...AI_ADMISSION_PUBLIC_PROCEDURES].sort()).toEqual([
      'admit_ai_canary_v1',
      'admit_ai_property_v1',
      'assert_ai_runtime_catalogue_ready_v1',
      'reap_expired_ai_execution_permits_v1',
      'settle_ai_execution_v1',
    ])
  })

  it('never revokes one of the allowed procedures', () => {
    const sql = sidecarFunctionIsolationSql()
    for (const name of AI_ADMISSION_PUBLIC_PROCEDURES) {
      expect(sql).toContain(`'${name}'`)
    }
    expect(sql).toContain('NOT IN')
  })

  it('revokes from PUBLIC, which is where the implicit grant comes from', () => {
    // PostgreSQL grants EXECUTE to PUBLIC on every new function. Revoking from
    // the AI role specifically would not help: the role would still hold the
    // privilege through PUBLIC.
    expect(sidecarFunctionIsolationSql()).toContain('FROM PUBLIC')
  })

  it('drives off pg_proc rather than a fixed list', () => {
    // A hardcoded list goes stale exactly when a new migration adds the
    // function that breaks the posture — the failure this prevents.
    const sql = sidecarFunctionIsolationSql()
    expect(sql).toContain('FROM pg_proc')
    expect(sql).toContain("'public'::regnamespace")
  })

  it('uses regprocedure so overloads are revoked individually', () => {
    expect(sidecarFunctionIsolationSql()).toContain('oid::regprocedure')
  })

  it('is a dollar-quoted block so it survives being sent as one statement', () => {
    const sql = sidecarFunctionIsolationSql()
    expect(sql).toContain('$repkey_isolation$')
    // Two delimiters: opening and closing.
    expect(sql.split('$repkey_isolation$').length - 1).toBe(2)
  })

  it('renders a custom allow-list, so the caller can narrow it in tests', () => {
    const sql = sidecarFunctionIsolationSql(['only_this_one'])
    expect(sql).toContain("'only_this_one'")
    expect(sql).not.toContain('admit_ai_property_v1')
  })
})
