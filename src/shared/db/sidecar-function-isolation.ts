// Keep the AI admission role unable to EXECUTE anything in `public` except the
// five procedures it owns.
//
// WHY THIS EXISTS. `services/ai-execution-admission/postgres-admission-authority.ts`
// makes its readiness conditional on a strict isolation posture, and one clause
// is absolute: the connecting role must hold EXECUTE on exactly five public
// procedures and NOTHING else —
//
//   AND NOT EXISTS (
//     SELECT 1 FROM pg_proc AS other_procedure
//     WHERE other_procedure.pronamespace = 'public'::regnamespace
//       AND other_procedure.proname NOT IN (...the five...)
//       AND has_function_privilege(current_user, other_procedure.oid, 'EXECUTE'))
//
// PostgreSQL grants EXECUTE to PUBLIC on every newly created function by
// default, so every trigger and guard function the migrations create is
// executable by every role — including the AI admission role. On 2026-09-01 a
// deploy-time migration run left 51 such functions executable where the posture
// allows 5, and BOTH AI sidecars refused to start with "AI admission readiness
// verification failed". They had been healthy an hour earlier; nothing in their
// own code or configuration had changed.
//
// A one-off REVOKE fixes the symptom and lasts until the next migration creates
// or replaces a function, at which point the same outage returns with no commit
// to blame it on. So the revoke runs on EVERY deploy, after the schema work
// that can reintroduce the grants.
//
// SAFE FOR THE APPLICATION. `web`, `worker` and the Google admission sidecar all
// connect as a superuser, and superusers bypass privilege checks entirely — the
// revoke cannot take a capability away from them. It only removes the implicit
// PUBLIC grant that the non-superuser AI role would otherwise inherit. Trigger
// and guard functions are invoked by the trigger mechanism under the table
// owner, not through the caller's EXECUTE privilege, so revoking is not a
// behaviour change for them either.

/** The five procedures the AI admission role is allowed to execute. */
export const AI_ADMISSION_PUBLIC_PROCEDURES = Object.freeze([
  'admit_ai_property_v1',
  'admit_ai_canary_v1',
  'assert_ai_runtime_catalogue_ready_v1',
  'settle_ai_execution_v1',
  'reap_expired_ai_execution_permits_v1',
] as const)

/**
 * Idempotent REVOKE over every other function in `public`.
 *
 * Written as a DO block over `pg_proc` rather than a fixed list: the set of
 * trigger and guard functions grows with the schema, and a fixed list would go
 * stale exactly when a new migration adds the function that breaks the posture
 * — which is the failure this exists to prevent.
 *
 * `oid::regprocedure` renders the fully-qualified signature, so overloads are
 * revoked individually and correctly.
 */
export function sidecarFunctionIsolationSql(
  allowed: readonly string[] = AI_ADMISSION_PUBLIC_PROCEDURES,
): string {
  const list = allowed.map((name) => `'${name}'`).join(', ')
  return `
DO $repkey_isolation$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname NOT IN (${list})
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', target.signature);
  END LOOP;
END
$repkey_isolation$;`
}
