export const GOOGLE_PERFORMANCE_ALLOWED_DEPENDENCY_KINDS = [
  'execution_policy',
  'provider_content_lease',
  'property_reader',
  'google_performance_source',
  'clock',
  'authorization_audit',
] as const
export type GooglePerformanceAllowedDependencyKind =
  (typeof GOOGLE_PERFORMANCE_ALLOWED_DEPENDENCY_KINDS)[number]

export type GooglePerformanceDependencyDescriptor = Readonly<{
  kind: string
  modulePath: string
}>

export type GooglePerformanceDependencyBoundaryResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; violations: readonly string[] }>

const ALLOWED_KIND_SET = new Set<string>(GOOGLE_PERFORMANCE_ALLOWED_DEPENDENCY_KINDS)
/**
 * ADR 0050 §10 forbidden module classes for the live Performance path: Metric,
 * any write/queue/job/cache infrastructure module, and any Performance-specific
 * repository/queue/cache/job. Exported so the architecture test can apply the
 * same list to the use case's transitive runtime module graph, not only to the
 * declared injection descriptors.
 */
export const FORBIDDEN_MODULE_PATHS = [
  /\/contexts\/metric\//,
  /\/infrastructure\/(?:repositories|jobs|queues|cache)(?:\/|$)/,
  /google-performance.*(?:repository|queue|cache|job)/i,
] as const

export function validateGooglePerformanceLiveDependencies(
  dependencies: readonly GooglePerformanceDependencyDescriptor[],
): GooglePerformanceDependencyBoundaryResult {
  const violations: string[] = []

  for (const dependency of dependencies) {
    const allowedKind = ALLOWED_KIND_SET.has(dependency.kind)
    const forbiddenPath = FORBIDDEN_MODULE_PATHS.some((pattern) =>
      pattern.test(dependency.modulePath),
    )
    if (!allowedKind || forbiddenPath) {
      violations.push(`${dependency.kind}:${dependency.modulePath}`)
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
