/**
 * Exact grandfathered export-function infrastructure factories at the
 * standards enforcement baseline. New/materially modified factories use
 * arrow-const declarations; removing an entry is a one-way migration.
 */
export const LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES = Object.freeze([] as const)

const LEGACY_FACTORY_SET = new Set<string>(LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES)

export function unapprovedInfrastructureFunctionFactories(
  declarations: readonly string[],
): readonly string[] {
  return [...new Set(declarations)]
    .filter((declaration) => !LEGACY_FACTORY_SET.has(declaration))
    .sort()
}

export function staleInfrastructureFunctionFactoryAllowances(
  declarations: readonly string[],
): readonly string[] {
  const current = new Set(declarations)
  return LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES.filter(
    (declaration) => !current.has(declaration),
  )
}
