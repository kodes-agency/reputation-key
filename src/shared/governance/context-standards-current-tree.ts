export type StandardsSource = Readonly<{
  path: string
  body: string
}>

export const auditApplicationResultFlows = (
  sources: readonly StandardsSource[],
): readonly string[] =>
  sources
    .filter(({ body }) => /Promise\s*<\s*Result\s*</u.test(body))
    .map(({ path }) => `${path}: async application orchestration returns Result`)
    .sort()

export const auditDomainNativeErrorThrows = (
  sources: readonly StandardsSource[],
): readonly string[] =>
  sources
    .filter(({ body }) =>
      /throw\s+(?:new\s+(?:Error|TypeError|RangeError)\b|\{\s*code\s*:)/u.test(body),
    )
    .map(({ path }) => `${path}: domain throws a native or untagged error`)
    .sort()

const pascalToKebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/gu, '$1-$2')
    .toLowerCase()

export const auditRepositoryPorts = (
  sources: readonly StandardsSource[],
): readonly string[] =>
  [...sources]
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap(({ path, body }) => {
      const declarations = [
        ...body.matchAll(
          /^export\s+(?:type|interface)\s+([A-Za-z][A-Za-z0-9]*Repository)\b/gmu,
        ),
      ]
      return declarations.flatMap((declaration, index) => {
        const repositoryName = declaration[1]!
        const contextMatch = path.match(/^src\/contexts\/([^/]+)\//u)
        const context = contextMatch?.[1]
        const entity = pascalToKebab(repositoryName.replace(/Repository$/u, ''))
        const expectedSuffix = `application/ports/${entity}.repository.ts`
        const issues: string[] = []
        if (
          context === undefined ||
          path !== `src/contexts/${context}/${expectedSuffix}`
        ) {
          issues.push(`${path}#${repositoryName}: expected ${expectedSuffix}`)
        }

        const start = (declaration.index ?? 0) + declaration[0].length
        const end = declarations[index + 1]?.index ?? body.length
        const declarationBody = body.slice(start, end)
        const findById = declarationBody.indexOf('findById')
        if (findById >= 0) {
          const signature = declarationBody.slice(findById, findById + 500)
          if (!/(?:organizationId|orgId|[A-Za-z]+Scope)/u.test(signature)) {
            issues.push(`${path}#${repositoryName}.findById: tenant scope is absent`)
          }
        }
        return issues
      })
    })
