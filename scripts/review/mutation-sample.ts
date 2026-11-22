// The monthly mutation sample of rule 31 (docs/rules.md): plant small faults in
// the modules that decide tenant policy, attempt fences and period clocks, and
// check that some test catches each one.
//
//   pnpm mutation:sample                          unit tests, 3 faults per module
//   pnpm mutation:sample --project=integration    integration tests (needs the test database)
//   pnpm mutation:sample --mutants=5 --group=period-clock --seed=2026-12
//   pnpm mutation:sample --only=src/shared/domain/period-range.ts   re-check one module
//
// The modules and the fault each one must not let through are listed in
// mutation-targets.json. For every module the command first runs the tests
// that import it (`vitest related`) on the clean file, then plants one fault
// at a time (flip an operator, negate an if, drop a throw, swap a ternary, move
// a number by one, change a compared string, flip a returned boolean) and runs
// them again. A fault no test catches is a survivor: either a missing
// assertion, which gets a test, or a change that cannot be observed, which the
// report says. The seed defaults to the month, so each month samples other
// sites. The source file is always restored, also on Ctrl-C; a run killed
// outright leaves a journal in the system temp folder, and the next run puts
// the file back before it starts. It exits 1 when a
// fault survived. mutation-sample-run.ts starts it; this module only exports,
// so its test can import it without running it.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

export const TARGETS_PATH = 'scripts/review/mutation-targets.json'

export type MutationGroup = 'tenant-policy' | 'attempt-fence' | 'period-clock'

export type MutationTarget = Readonly<{
  path: string
  group: MutationGroup
  /** The fault a check must catch, in one sentence. */
  fault: string
}>

export type MutationSite = Readonly<{
  kind: string
  start: number
  end: number
  original: string
  replacement: string
  line: number
}>

const OPERATOR_FLIPS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: '!==',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '===',
  [ts.SyntaxKind.LessThanToken]: '<=',
  [ts.SyntaxKind.LessThanEqualsToken]: '<',
  [ts.SyntaxKind.GreaterThanToken]: '>=',
  [ts.SyntaxKind.GreaterThanEqualsToken]: '>',
  [ts.SyntaxKind.AmpersandAmpersandToken]: '||',
  [ts.SyntaxKind.BarBarToken]: '&&',
  [ts.SyntaxKind.PlusToken]: '-',
  [ts.SyntaxKind.MinusToken]: '+',
}

const isStringy = (node: ts.Expression) =>
  ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)

/** Every place in a module's code where a small fault can be planted. */
export function mutationSites(text: string, fileName: string): MutationSite[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const sites: MutationSite[] = []
  const add = (kind: string, start: number, end: number, replacement: string) => {
    sites.push({
      kind,
      start,
      end,
      original: text.slice(start, end),
      replacement,
      line: source.getLineAndCharacterOfPosition(start).line + 1,
    })
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeNode(node)
    )
      return
    if (ts.isBinaryExpression(node)) {
      const flip = OPERATOR_FLIPS[node.operatorToken.kind]
      const concatenation =
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (isStringy(node.left) || isStringy(node.right))
      if (flip && !concatenation) {
        add(
          'operator',
          node.operatorToken.getStart(source),
          node.operatorToken.getEnd(),
          flip,
        )
      }
      const compared =
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      for (const side of [node.left, node.right]) {
        if (compared && ts.isStringLiteral(side)) {
          add(
            'compared-string',
            side.getStart(source) + 1,
            side.getEnd() - 1,
            `${side.text}_planted`,
          )
        }
      }
    }
    if (ts.isIfStatement(node)) {
      const condition = node.expression
      add(
        'negate-if',
        condition.getStart(source),
        condition.getEnd(),
        `!(${condition.getText(source)})`,
      )
    }
    if (ts.isThrowStatement(node)) {
      add('drop-throw', node.getStart(source), node.getEnd(), 'void 0')
    }
    if (ts.isConditionalExpression(node)) {
      add(
        'swap-ternary',
        node.getStart(source),
        node.getEnd(),
        `((${node.condition.getText(source)}) ? (${node.whenFalse.getText(source)}) : (${node.whenTrue.getText(source)}))`,
      )
    }
    if (
      ts.isNumericLiteral(node) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !ts.isEnumMember(node.parent)
    ) {
      add('number', node.getStart(source), node.getEnd(), String(Number(node.text) + 1))
    }
    if (
      (node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword) &&
      (ts.isReturnStatement(node.parent) || ts.isPropertyAssignment(node.parent))
    ) {
      add(
        'boolean',
        node.getStart(source),
        node.getEnd(),
        node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true',
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

const rank = (seed: string, site: MutationSite) =>
  createHash('sha1').update(`${seed}:${site.start}:${site.kind}`).digest().readUInt32BE(0)

/**
 * `count` sites, chosen by the seed, one of each kind before a second of any
 * kind, so a sample of three is not three flipped operators. The seed orders
 * the kinds too, so small samples rotate through them month by month.
 */
export function pickSites(
  sites: readonly MutationSite[],
  count: number,
  seed: string,
): MutationSite[] {
  const byKind = new Map<string, MutationSite[]>()
  for (const site of [...sites].sort((a, b) => rank(seed, a) - rank(seed, b))) {
    byKind.set(site.kind, [...(byKind.get(site.kind) ?? []), site])
  }
  const kindRank = (kind: string) =>
    createHash('sha1').update(`${seed}:${kind}`).digest().readUInt32BE(0)
  const queues = [...byKind.entries()]
    .sort(([a], [b]) => kindRank(a) - kindRank(b))
    .map(([, queue]) => [...queue])
  const picked: MutationSite[] = []
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const site = queue.shift()
      if (site && picked.length < count) picked.push(site)
    }
  }
  return picked
}

export function plant(text: string, site: MutationSite): string {
  return text.slice(0, site.start) + site.replacement + text.slice(site.end)
}

type Outcome = 'caught' | 'survived' | 'no-tests' | 'baseline-red'

type Result = Readonly<{
  target: MutationTarget
  site?: MutationSite
  outcome: Outcome
}>

// Which file holds a planted fault right now, and its original text.
const JOURNAL = join(
  tmpdir(),
  `repkey-mutation-sample-${createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)}.json`,
)

/** Puts back a file that a stopped run left with a planted fault. */
function restoreFromJournal(): void {
  if (!existsSync(JOURNAL)) return
  const { path, original } = JSON.parse(readFileSync(JOURNAL, 'utf8')) as {
    path: string
    original: string
  }
  writeFileSync(path, original)
  rmSync(JOURNAL)
  console.log(
    `[mutation-sample] restored ${path}, which a stopped run left with a planted fault`,
  )
}

function relatedTests(path: string, project: string): { passed: boolean; ran: boolean } {
  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'related',
      path,
      '--run',
      `--project=${project}`,
      '--passWithNoTests',
      '--bail=1',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const output = `${run.stdout}${run.stderr}`
  return { passed: run.status === 0, ran: !/No test files found/u.test(output) }
}

function option(args: readonly string[], name: string, fallback: string): string {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function sampleTarget(
  target: MutationTarget,
  count: number,
  seed: string,
  project: string,
): Result[] {
  const original = readFileSync(target.path, 'utf8')
  const baseline = relatedTests(target.path, project)
  if (!baseline.ran) return [{ target, outcome: 'no-tests' }]
  if (!baseline.passed) return [{ target, outcome: 'baseline-red' }]
  writeFileSync(JOURNAL, JSON.stringify({ path: target.path, original }))
  try {
    return pickSites(
      mutationSites(original, target.path),
      count,
      `${seed}:${target.path}`,
    ).map((site) => {
      writeFileSync(target.path, plant(original, site))
      try {
        return {
          target,
          site,
          outcome: relatedTests(target.path, project).passed ? 'survived' : 'caught',
        }
      } finally {
        writeFileSync(target.path, original)
      }
    })
  } finally {
    writeFileSync(target.path, original)
    rmSync(JOURNAL, { force: true })
  }
}

export function formatReport(results: readonly Result[]): string {
  const lines: string[] = []
  const groups = [...new Set(results.map((result) => result.target.group))].sort()
  for (const group of groups) {
    const planted = results.filter(
      (result) => result.target.group === group && result.site,
    )
    const caught = planted.filter((result) => result.outcome === 'caught').length
    lines.push(`${group}: ${caught} of ${planted.length} planted faults caught`)
  }
  for (const result of results) {
    if (result.outcome === 'caught') continue
    const where = result.site
      ? `${result.target.path}:${result.site.line}`
      : result.target.path
    const change = result.site
      ? ` ${result.site.kind}: ${JSON.stringify(result.site.original.slice(0, 60))} -> ${JSON.stringify(result.site.replacement.slice(0, 60))}`
      : ''
    lines.push(
      `  ${result.outcome} ${where}${change} (must catch: ${result.target.fault})`,
    )
  }
  return lines.join('\n')
}

/** Samples, reports, and returns the exit code: 1 when a planted fault survived. */
export function runMutationSample(args: readonly string[]): number {
  const project = option(args, 'project', 'unit')
  const count = Number(option(args, 'mutants', '3'))
  const seed = option(args, 'seed', new Date().toISOString().slice(0, 7))
  const group = option(args, 'group', '')
  const only = option(args, 'only', '')
  if (!Number.isInteger(count) || count < 1) {
    console.error('--mutants must be a positive whole number')
    return 2
  }
  const targets = (
    JSON.parse(readFileSync(TARGETS_PATH, 'utf8')) as MutationTarget[]
  ).filter(
    (target) =>
      (group === '' || target.group === group) && (only === '' || target.path === only),
  )
  restoreFromJournal()
  const onSignal = () => {
    restoreFromJournal()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  const results: Result[] = []
  try {
    for (const target of targets) {
      const sampled = sampleTarget(target, count, seed, project)
      for (const result of sampled) {
        console.log(
          `[mutation-sample] ${result.outcome} ${target.path}${result.site ? `:${result.site.line} ${result.site.kind}` : ''}`,
        )
      }
      results.push(...sampled)
    }
  } finally {
    restoreFromJournal()
  }
  console.log(
    `\n[mutation-sample] seed ${seed}, ${project} tests\n${formatReport(results)}`,
  )
  return results.some((result) => result.outcome === 'survived') ? 1 : 0
}
