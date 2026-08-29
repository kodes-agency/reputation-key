// Escaping for a user-supplied substring used inside a SQL LIKE/ILIKE pattern.
//
// The parameter is still bound — this is not injection. It is the WILDCARDS:
// a guest typing `100%` would otherwise match every comment, and `a_b` would
// match `axb`. A filter that silently widens is a privacy problem as much as a
// correctness one, because it returns rows the operator did not ask to see.
//
// ORDER IS THE WHOLE POINT. The backslash must be escaped FIRST. Escaping `%`
// and `_` ahead of it turns a literal backslash in the input into an escape
// character: `\%` becomes `\\%`, which Postgres reads as an escaped backslash
// followed by an UNESCAPED wildcard. Three repositories wrote this by hand and
// two of them had that bug, which is why it lives in one place now.

/**
 * Escape `%`, `_` and `\` so the value matches literally inside a LIKE pattern.
 *
 * The caller still adds its own wildcards and binds the result as a parameter:
 * `` sql`${column} ilike ${'%' + escapeLikePattern(input) + '%'}` ``.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
