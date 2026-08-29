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

export const auditUseCaseTypeTriples = (
  sources: readonly StandardsSource[],
): readonly string[] =>
  sources
    .flatMap(({ path, body }) => {
      const exportedFunctions = [
        ...body.matchAll(/^export\s+function\s+([A-Za-z][A-Za-z0-9]*)/gmu),
      ].map((match) => match[1]!)
      const constDeclarations = [
        ...body.matchAll(/^export\s+const\s+([A-Za-z][A-Za-z0-9]*)\b/gmu),
      ]
      const exportedArrowFunctions = constDeclarations.flatMap((match) => {
        const start = (match.index ?? 0) + match[0].length
        const nextExport = body.indexOf('\nexport ', start)
        const declaration = body.slice(
          start,
          nextExport === -1 ? body.length : nextExport,
        )
        const equals = declaration.indexOf('=')
        const arrow = declaration.indexOf('=>', equals + 1)
        if (equals === -1 || arrow === -1) return []
        const candidate = declaration.slice(equals + 1, arrow).trim()
        const parameters = candidate.startsWith('async ')
          ? candidate.slice('async '.length).trimStart()
          : candidate
        return parameters.startsWith('(') || /^[A-Za-z][A-Za-z0-9]*$/u.test(parameters)
          ? [match[1]!]
          : []
      })
      const exportedCallables = [...exportedFunctions, ...exportedArrowFunctions]
      const exportedTypeNames = new Set(
        [...body.matchAll(/^export\s+type\s+([A-Za-z][A-Za-z0-9]*)\b/gmu)].map(
          (match) => match[1]!,
        ),
      )
      const returnTypeAliases = new Map(
        [
          ...body.matchAll(
            /^export\s+type\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*ReturnType\s*<\s*typeof\s+([A-Za-z][A-Za-z0-9]*)\s*>/gmu,
          ),
        ].map((match) => [match[1]!, match[2]!] as const),
      )
      const hasExportedDeps = [...exportedTypeNames].some((name) => name.endsWith('Deps'))

      return exportedCallables.flatMap((callable) => {
        const typeName = `${callable[0]!.toUpperCase()}${callable.slice(1)}`
        const issues: string[] = []
        if (!exportedTypeNames.has(`${typeName}Input`)) {
          issues.push(`${path}#${callable}: missing exported ${typeName}Input`)
        }
        if (!hasExportedDeps) {
          issues.push(`${path}#${callable}: missing exported Deps type`)
        }
        if (returnTypeAliases.get(typeName) !== callable) {
          issues.push(`${path}#${callable}: missing exported ReturnType alias`)
        }
        return issues
      })
    })
    .sort()

const sourceStem = (name: string): string | null => {
  if (name.endsWith('.test.ts')) return name.slice(0, -'.test.ts'.length)
  if (name.endsWith('.ts')) return name.slice(0, -'.ts'.length)
  return null
}

const isAsciiLower = (value: string): boolean => value >= 'a' && value <= 'z'
const isAsciiUpper = (value: string): boolean => value >= 'A' && value <= 'Z'
const isAsciiDigit = (value: string): boolean => value >= '0' && value <= '9'

const isCamelStem = (value: string): boolean =>
  value.length > 0 &&
  isAsciiLower(value[0]!) &&
  [...value].every(
    (character) =>
      isAsciiLower(character) || isAsciiUpper(character) || isAsciiDigit(character),
  )

const isKebabStem = (value: string): boolean => {
  const segments = value.split('-')
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      isAsciiLower(segment[0]!) &&
      [...segment].every(
        (character) => isAsciiLower(character) || isAsciiDigit(character),
      ),
  )
}

const matchesStemAndSuffix = (
  name: string,
  style: 'camel' | 'kebab',
  suffixes: readonly string[] = [''],
): boolean => {
  const stemWithSuffix = sourceStem(name)
  if (stemWithSuffix === null) return false
  const suffix = suffixes.find(
    (candidate) => candidate === '' || stemWithSuffix.endsWith(candidate),
  )
  if (suffix === undefined) return false
  const stem = suffix === '' ? stemWithSuffix : stemWithSuffix.slice(0, -suffix.length)
  return style === 'camel' ? isCamelStem(stem) : isKebabStem(stem)
}

/** Context-root files that carry no layer naming rule. */
const CONTEXT_ROOT_FILES = new Set([
  'build.ts',
  'build.test.ts',
  'application/public-api.ts',
  'application/public-api.test.ts',
])

type LayerNamingRule = Readonly<{
  /** Context-relative directory prefixes the rule governs. */
  prefixes: readonly string[]
  style: 'camel' | 'kebab'
  /** Required filename suffixes; omitted means any suffix-free stem. */
  suffixes?: readonly string[]
  /** Layer entry points exempt from the stem rule. */
  exempt?: readonly string[]
  message: string
}>

const LAYER_NAMING_RULES: readonly LayerNamingRule[] = [
  {
    prefixes: ['domain/'],
    style: 'camel',
    message: 'domain files use camelCase and tests mirror source',
  },
  {
    prefixes: ['application/use-cases/'],
    style: 'kebab',
    message: 'use-case files use kebab-case and tests mirror source',
  },
  {
    prefixes: ['application/ports/'],
    style: 'kebab',
    suffixes: ['.repository', '.port'],
    message: 'port files end in .repository.ts or .port.ts and tests mirror source',
  },
  {
    prefixes: ['infrastructure/repositories/'],
    style: 'kebab',
    suffixes: ['.repository'],
    message: 'repository files end in .repository.ts and tests mirror source',
  },
  {
    prefixes: ['infrastructure/adapters/'],
    style: 'kebab',
    suffixes: ['.adapter'],
    message: 'adapter files end in .adapter.ts and tests mirror source',
  },
  {
    prefixes: ['infrastructure/mappers/'],
    style: 'kebab',
    suffixes: ['.mapper'],
    message: 'mapper files end in .mapper.ts and tests mirror source',
  },
  {
    prefixes: ['infrastructure/jobs/'],
    style: 'kebab',
    suffixes: ['.job'],
    message: 'job files end in .job.ts and tests mirror source',
  },
  {
    prefixes: ['infrastructure/event-handlers/', 'server/'],
    style: 'kebab',
    exempt: ['index.ts', 'index.test.ts'],
    message: 'handler/server files use kebab-case and tests mirror source',
  },
]

/** Strip everything up to and including `src/contexts/<context>/`. */
const contextRelativePath = (path: string): string => {
  const marker = '/src/contexts/'
  const normalized = path.startsWith('src/contexts/')
    ? `/${path}`
    : path.includes(marker)
      ? path.slice(path.indexOf(marker))
      : `/${path}`
  return normalized.split('/').slice(4).join('/')
}

const fileNameIssue = (path: string): string | null => {
  const relative = contextRelativePath(path)
  const name = relative.split('/').at(-1) ?? ''

  if (CONTEXT_ROOT_FILES.has(relative)) return null
  const rule = LAYER_NAMING_RULES.find(({ prefixes }) =>
    prefixes.some((prefix) => relative.startsWith(prefix)),
  )
  if (rule === undefined) return null
  if (rule.exempt?.includes(name)) return null
  return matchesStemAndSuffix(name, rule.style, rule.suffixes) ? null : rule.message
}

export const auditContextFileNames = (
  sources: readonly StandardsSource[],
): readonly string[] =>
  sources
    .flatMap(({ path }) => {
      const issue = fileNameIssue(path)
      return issue === null ? [] : [`${path}: ${issue}`]
    })
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
