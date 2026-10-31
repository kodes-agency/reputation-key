import { FORWARD_ONLY_CONSTRUCT_DEFINITIONS } from './construct-definitions'

/** Remove only the named forward-only statements and their own separators.
 * Every byte outside these exceptions must still match the historical copy. */
export function withoutForwardOnlyConstructs(sql: string): string {
  return sql.replace(
    /^CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS (\$[A-Za-z0-9_]*\$)[\s\S]*?\2\s*;\n(?:--> statement-breakpoint\n)?/gmu,
    (statement, name: string) =>
      FORWARD_ONLY_CONSTRUCT_DEFINITIONS.some((entry) => entry === name) ? '' : statement,
  )
}
