import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const INVOKED_TYPESCRIPT_PROJECTS = [
  'tsconfig.json',
  'tsconfig.scripts.json',
  'tsconfig.railway.json',
] as const

const NON_SOURCE_DIRECTORIES = new Set([
  '.claude',
  '.codex',
  '.fallow',
  '.git',
  '.local-stack',
  '.od-skills',
  '.omp',
  '.output',
  '.pi',
  '.secrets',
  '.superpowers',
  '.tanstack',
  '.vscode',
  'coverage',
  'drizzle',
  'drizzle.bak',
  'node_modules',
  'storybook-static',
  'test-results',
])

function isNonSourceDirectory(name: string): boolean {
  return NON_SOURCE_DIRECTORIES.has(name) || name === 'dist' || name.startsWith('dist-')
}

function repositoryPath(root: string, file: string): string {
  return relative(root, file).split('\\').join('/')
}

function isTypeScriptModule(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx')
}

/** Discover every repository-owned TypeScript source, including hidden roots. */
export function discoverTypeScriptModules(root: string): readonly string[] {
  const modules: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!isNonSourceDirectory(entry.name)) walk(join(directory, entry.name))
        continue
      }
      if (!entry.isFile() || !isTypeScriptModule(entry.name)) continue
      modules.push(repositoryPath(root, join(directory, entry.name)))
    }
  }
  walk(root)
  return modules.sort()
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

/** Resolve a project's effective file set through TypeScript's own config parser. */
export function loadTypeScriptProjectFiles(
  root: string,
  project: string,
): readonly string[] {
  const configPath = resolve(root, project)
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
  if (loaded.error) {
    throw new Error(`${project}: ${diagnosticMessage(loaded.error)}`)
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  )
  if (parsed.errors.length > 0) {
    throw new Error(`${project}: ${parsed.errors.map(diagnosticMessage).join('; ')}`)
  }
  return parsed.fileNames
    .filter((file) => !repositoryPath(root, file).startsWith('../'))
    .map((file) => repositoryPath(root, file))
    .sort()
}

export function loadInvokedTypeScriptProjectFiles(root: string): readonly string[] {
  return [
    ...new Set(
      INVOKED_TYPESCRIPT_PROJECTS.flatMap((project) =>
        loadTypeScriptProjectFiles(root, project),
      ),
    ),
  ].sort()
}

/** Pure ownership comparison used by the negative regression test. */
export function validateTypeScriptProjectCoverage(
  discovered: readonly string[],
  owned: readonly string[],
): readonly string[] {
  const ownedSet = new Set(owned)
  return discovered
    .filter((file) => !ownedSet.has(file))
    .map((file) => `${file} is not owned by an invoked TypeScript project`)
}

export function validateRepositoryTypeScriptProjectCoverage(
  root: string,
): readonly string[] {
  try {
    return validateTypeScriptProjectCoverage(
      discoverTypeScriptModules(root),
      loadInvokedTypeScriptProjectFiles(root),
    )
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

export function runTypeScriptProjectCoverageCli(args: readonly string[]): number {
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '../..'))
  const discovered = discoverTypeScriptModules(root)
  const violations = validateRepositoryTypeScriptProjectCoverage(root)
  if (violations.length > 0) {
    process.stderr.write(
      `[typescript-project-coverage] FAILED — ${violations.length} violation(s):\n${violations
        .map((violation) => `  - ${violation}`)
        .join('\n')}\n`,
    )
    return 1
  }
  process.stdout.write(
    `[typescript-project-coverage] OK — ${discovered.length} TypeScript modules are owned by ${INVOKED_TYPESCRIPT_PROJECTS.length} invoked projects\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runTypeScriptProjectCoverageCli(process.argv.slice(2))
}
