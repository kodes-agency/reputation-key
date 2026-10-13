// Every server function asks the execution policy, or says what it asks instead.
//
// A server function is reachable by anyone who can send a request. What stops
// a signed-in member from running one they may not is the handler's call to
// `requireExecutionAllowed` (docs/BETA.md §4 puts every capability decision in
// that policy). Most handlers were covered by no test that would notice the
// call being deleted: their tests mock the policy to allow, or never run the
// handler. This suite is the structural half of that proof. It reads every
// `createServerFn` declaration under `src/` and fails on one whose handler
// cannot reach the policy and is not listed, with its own guard, in
// server-function-policy-exemptions.ts. It also fails on a use of
// `createServerFn` that is not a declaration it read, so a server function
// written in another shape cannot pass unseen.
//
// It proves the call is written on a path from the handler
// (server-function-policy.ts says how reach is followed and where it stops).
// The action, capability and Property a handler passes are proven by that
// handler's own tests.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXECUTION_POLICY,
  isProductionSource,
  serverFunctionFactoryUses,
  serverFunctionReaches,
  type ServerFunctionFactoryUse,
  type ServerFunctionReach,
  type SourceReader,
} from './server-function-policy'
import {
  SERVER_FUNCTION_POLICY_EXEMPTIONS,
  type ServerFunctionPolicyExemption,
} from './server-function-policy-exemptions'

const ROOT = process.cwd()
const SOURCE_ROOT = 'src'

/** Repository-relative paths of every production module under a directory. */
function productionSourcesUnder(directory: string): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) found.push(...productionSourcesUnder(path))
    else if (isProductionSource(path)) found.push(path)
  }
  return found
}

/** Reads the working tree by repository-relative path, once per module. */
function repositoryReader(): SourceReader {
  const cache = new Map<string, string | null>()
  return (file) => {
    if (!cache.has(file)) {
      const path = join(ROOT, file)
      cache.set(file, existsSync(path) ? readFileSync(path, 'utf8') : null)
    }
    return cache.get(file) ?? null
  }
}

const keyOf = (site: Readonly<{ file: string; name: string }>): string =>
  `${site.file}#${site.name}`

const asksPolicy = (reach: ServerFunctionReach): boolean =>
  reach.calls.has(EXECUTION_POLICY)

function readerOf(sources: Readonly<Record<string, string>>): SourceReader {
  return (file) => sources[file] ?? null
}

const ADAPTER = 'src/contexts/sample/server/sample.ts'
const POLICY_IMPORT = `import { requireExecutionAllowed } from '#/shared/auth/execution-policy'`

// Samples are read through the entry point the repository check uses, so the
// choice of which modules to parse is part of what each case proves.
function reachOf(
  sources: Readonly<Record<string, string>>,
  name: string,
): ServerFunctionReach {
  const reach = serverFunctionReaches(Object.keys(sources), readerOf(sources)).find(
    (candidate) => candidate.name === name,
  )
  if (!reach) throw new Error(`no server function named ${name} in the sample`)
  return reach
}

function usesOf(source: string): readonly ServerFunctionFactoryUse[] {
  return serverFunctionFactoryUses([ADAPTER], readerOf({ [ADAPTER]: source }))
}

const unreadLinesOf = (source: string): readonly number[] =>
  usesOf(source)
    .filter((use) => use.declaredAs === null)
    .map((use) => use.line)

describe('what a server function handler reaches', () => {
  it('finds the policy call written in the handler', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          export const readThing = createServerFn({ method: 'GET' })
            .validator(schema)
            .handler(tracedHandler(async ({ data }) => {
              await requireExecutionAllowed({ actor: ctx, action: 'thing.read' })
              return load(data)
            }, 'GET', 'sample.readThing'))`,
      },
      'readThing',
    )

    expect(asksPolicy(reach)).toBe(true)
  })

  it('reports a handler whose policy call was deleted', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          export const readThing = createServerFn({ method: 'GET' })
            .handler(async ({ data }) => {
              const ctx = await resolveTenantContext(await headersFromContext())
              return load(data, ctx)
            })`,
      },
      'readThing',
    )

    expect(asksPolicy(reach)).toBe(false)
    expect([...reach.calls]).toContain('resolveTenantContext')
  })

  it('follows a handler declared apart from the server function', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          export const readThingHandler = createServerOnlyFn(async () => {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.read' })
          })
          export const readThing = createServerFn({ method: 'GET' })
            .handler(tracedHandler(readThingHandler, 'GET', 'sample.readThing'))`,
      },
      'readThing',
    )

    expect(asksPolicy(reach)).toBe(true)
  })

  it('follows a helper of the same module, however deep', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          async function authorize(ctx) {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.write' })
          }
          const runCommand = async (run) => {
            await authorize(await context())
            return run()
          }
          export const writeThing = createServerFn({ method: 'POST' })
            .handler(({ data }) => runCommand(() => save(data)))`,
      },
      'writeThing',
    )

    expect(asksPolicy(reach)).toBe(true)
  })

  it('follows a helper imported from the server adapter layer', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `import { withThings as run } from './sample-request.server'
          export const writeThing = createServerFn({ method: 'POST' })
            .handler(({ data }) => run((things) => things.save(data)))`,
        'src/contexts/sample/server/sample-request.server.ts': `${POLICY_IMPORT}
          export async function withThings(run) {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.write' })
            return run(things)
          }`,
      },
      'writeThing',
    )

    expect(asksPolicy(reach)).toBe(true)
  })

  it('does not count a policy call below the adapter layer', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `import { saveThing } from '../application/use-cases/save-thing'
          export const writeThing = createServerFn({ method: 'POST' })
            .handler(({ data }) => saveThing(data))`,
        'src/contexts/sample/application/use-cases/save-thing.ts': `${POLICY_IMPORT}
          export async function saveThing(data) {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.write' })
          }`,
      },
      'writeThing',
    )

    expect(asksPolicy(reach)).toBe(false)
  })

  it('does not count the policy named in a comment, a string or a type', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          // requireExecutionAllowed({ actor, action }) used to be called here.
          export const readThing = createServerFn({ method: 'GET' })
            .handler(async (): Promise<ReturnType<typeof requireExecutionAllowed>> => {
              log('requireExecutionAllowed skipped')
              return undefined
            })`,
      },
      'readThing',
    )

    expect(asksPolicy(reach)).toBe(false)
  })

  it('does not follow a top-level name that the handler declares again', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `${POLICY_IMPORT}
          async function authorize(ctx) {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.write' })
          }
          export const writeThing = createServerFn({ method: 'POST' })
            .handler(async ({ data }) => {
              const authorize = (ctx) => ctx
              return save(authorize(data))
            })`,
      },
      'writeThing',
    )

    expect(asksPolicy(reach)).toBe(false)
  })

  it('keeps the reach of one server function apart from its neighbour', () => {
    const sources = {
      [ADAPTER]: `${POLICY_IMPORT}
        export const guarded = createServerFn({ method: 'GET' })
          .handler(async () => {
            await requireExecutionAllowed({ actor: ctx, action: 'thing.read' })
          })
        export const open = createServerFn({ method: 'GET' })
          .handler(async () => load())`,
    }

    expect(asksPolicy(reachOf(sources, 'guarded'))).toBe(true)
    expect(asksPolicy(reachOf(sources, 'open'))).toBe(false)
  })

  it('does not take a local function of the same name for the policy', () => {
    const reach = reachOf(
      {
        [ADAPTER]: `const requireExecutionAllowed = async (input) => input
          export const readThing = createServerFn({ method: 'GET' })
            .handler(async () => {
              await requireExecutionAllowed({ actor: ctx, action: 'thing.read' })
              return load()
            })`,
      },
      'readThing',
    )

    expect(asksPolicy(reach)).toBe(false)
    expect([...reach.calls]).toContain('load')
  })

  it.each([
    [
      'with a type argument',
      `export const readThing = createServerFn<'GET'>({ method: 'GET' })
        .handler(async () => load())`,
    ],
    [
      'through an aliased import',
      `import { createServerFn as serverFn } from '@tanstack/react-start'
      export const readThing = serverFn({ method: 'GET' })
        .handler(async () => load())`,
    ],
    [
      'through a namespace import',
      `import * as Start from '@tanstack/react-start'
      export const readThing = Start.createServerFn({ method: 'GET' })
        .handler(async () => load())`,
    ],
    [
      'through a module that hands the factory on under its own name',
      `import { createServerFn } from './sample-shared'
      export const readThing = createServerFn({ method: 'GET' })
        .handler(async () => load())`,
    ],
    [
      'under a cast',
      `export const readThing = createServerFn({ method: 'GET' })
        .handler(async () => load()) as unknown as ReadThing`,
    ],
    [
      'under satisfies and a non-null assertion',
      `export const readThing = (createServerFn({ method: 'GET' })
        .handler(async () => load()) satisfies ReadThing)!`,
    ],
    [
      'with its root in parentheses',
      `export const readThing = (createServerFn({ method: 'GET' }))
        .handler(async () => load())`,
    ],
  ])('reads a server function declared %s', (_shape, source) => {
    const reach = reachOf({ [ADAPTER]: source }, 'readThing')

    // Read, and with no policy call on its path: the repository check below
    // would name it.
    expect(asksPolicy(reach)).toBe(false)
    expect([...reach.calls]).toContain('load')
  })
})

describe('where a module uses the server function factory', () => {
  it('names the declaration each factory call is the root of', () => {
    const uses = usesOf(
      `import { createServerFn, createServerFn as serverFn } from '@tanstack/react-start'
      export const readThing = serverFn<'GET'>({ method: 'GET' }).handler(load)
      export const writeThing = createServerFn({ method: 'POST' })
        .handler(save) as unknown as WriteThing`,
    )

    expect(uses).toEqual([
      { file: ADAPTER, line: 2, declaredAs: 'readThing' },
      { file: ADAPTER, line: 3, declaredAs: 'writeThing' },
    ])
  })

  it.each([
    [
      'inside a wrapper call',
      `export const readThing = wrap(createServerFn({ method: 'GET' }).handler(load))`,
      1,
    ],
    [
      'as an object member',
      `export const things = {
        read: createServerFn({ method: 'GET' }).handler(load),
      }`,
      2,
    ],
    [
      'as the default export',
      `export default createServerFn({ method: 'GET' }).handler(load)`,
      1,
    ],
    [
      'inside a function that builds server functions',
      `export function thingReader(load) {
        const readThing = createServerFn({ method: 'GET' }).handler(load)
        return readThing
      }`,
      2,
    ],
    [
      'under a second local name',
      `const serverFn = createServerFn
      export const readThing = serverFn({ method: 'GET' }).handler(load)`,
      1,
    ],
    [
      'renamed on its way out of the module',
      `import { createServerFn } from '@tanstack/react-start'
      export { createServerFn as serverFn }`,
      2,
    ],
    [
      'renamed as it is taken from the package',
      `const { createServerFn: serverFn } = await import('@tanstack/react-start')
      export const readThing = serverFn({ method: 'GET' }).handler(load)`,
      1,
    ],
    [
      'handed on as a member without being called',
      `import * as Start from '@tanstack/react-start'
      export const serverFn = Start.createServerFn`,
      2,
    ],
  ])('reports a use that no declaration was read from: %s', (_shape, source, line) => {
    expect(unreadLinesOf(source)).toEqual([line])
  })

  it('does not count an import, a type, or a re-export under its own name', () => {
    const uses = usesOf(
      `import { createServerFn } from '@tanstack/react-start'
      export { createServerFn }
      export type ServerFunctionFactory = typeof createServerFn
      const steps = { createServerFn: ['handler', 'validator'] }
      // createServerFn({ method: 'GET' }) was declared here once.
      log('createServerFn')`,
    )

    expect(uses).toEqual([])
  })
})

describe('server functions and the execution policy', () => {
  const read = repositoryReader()
  const reaches = serverFunctionReaches(productionSourcesUnder(SOURCE_ROOT), read)
  const reachByKey = new Map(reaches.map((reach) => [keyOf(reach), reach]))
  const exemptionByKey = new Map(
    SERVER_FUNCTION_POLICY_EXEMPTIONS.map((exemption) => [keyOf(exemption), exemption]),
  )
  const reachOfExemption = (
    exemption: ServerFunctionPolicyExemption,
  ): ServerFunctionReach | undefined => reachByKey.get(keyOf(exemption))

  it('reads the server functions of every context', () => {
    // A walk that found nothing would pass every check below.
    const contexts = new Set(
      reaches.flatMap(
        (reach) => /^src\/contexts\/([^/]+)\/server\//u.exec(reach.file)?.[1] ?? [],
      ),
    )

    expect([...contexts].sort()).toEqual([
      'ai',
      'feed',
      'guest',
      'identity',
      'inbox',
      'integration',
      'portal',
      'property',
      'reporting',
      'review',
    ])
    expect(reaches.length).toBeGreaterThan(SERVER_FUNCTION_POLICY_EXEMPTIONS.length)
  })

  it('reads a declaration at every place the server function factory is used', () => {
    // The checks below see only the declarations that were read. A server
    // function written in a shape the reader does not know would pass them all
    // unseen, so every use of the factory must be the root of one.
    const uses = serverFunctionFactoryUses(productionSourcesUnder(SOURCE_ROOT), read)
    const unread = uses
      .filter((use) => use.declaredAs === null)
      .map((use) => `${use.file}:${use.line}`)

    expect(
      unread,
      'createServerFn is used here in a shape this check does not read. Declare the server function as a top-level `const name = createServerFn(...)...`, or teach server-function-policy.ts the new shape.',
    ).toEqual([])
    expect(uses.map((use) => `${use.file}#${use.declaredAs}`).sort()).toEqual(
      reaches.map(keyOf).sort(),
    )
  })

  it('has every handler ask the execution policy, or be listed with its own guard', () => {
    const unguarded = reaches
      .filter((reach) => !asksPolicy(reach) && !exemptionByKey.has(keyOf(reach)))
      .map(keyOf)

    expect(
      unguarded,
      `These server functions never reach ${EXECUTION_POLICY}. Call it in the handler, or list the function in server-function-policy-exemptions.ts with the guard it asks instead.`,
    ).toEqual([])
  })

  it('lists each exemption once, with a reason', () => {
    expect(exemptionByKey.size).toBe(SERVER_FUNCTION_POLICY_EXEMPTIONS.length)
    expect(
      SERVER_FUNCTION_POLICY_EXEMPTIONS.filter(
        (exemption) => exemption.reason.trim().length === 0,
      ).map(keyOf),
    ).toEqual([])
  })

  it('lists only server functions that exist and do not ask the policy', () => {
    const missing = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter(
      (exemption) => reachOfExemption(exemption) === undefined,
    ).map(keyOf)
    const stale = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter((exemption) => {
      const reach = reachOfExemption(exemption)
      return reach !== undefined && asksPolicy(reach)
    }).map(keyOf)

    expect(missing, 'listed, but no such server function is declared').toEqual([])
    expect(stale, 'listed, but the handler now asks the execution policy').toEqual([])
  })

  it('finds the guard each exemption names on a path from its handler', () => {
    const unguarded = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter((exemption) => {
      if (exemption.guard === null) return false
      return reachOfExemption(exemption)?.calls.has(exemption.guard) !== true
    }).map((exemption) => `${keyOf(exemption)} → ${exemption.guard}`)

    expect(unguarded).toEqual([])
  })

  it('finds, for a decision taken below the adapter, the call that takes it', () => {
    const below = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter(
      (exemption) => exemption.category === 'DECIDED-BELOW',
    )
    const unbound = below
      .filter(
        (exemption) =>
          exemption.decidedIn === undefined ||
          read(exemption.decidedIn.file)?.includes(exemption.decidedIn.call) !== true,
      )
      .map(keyOf)
    const elsewhere = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter(
      (exemption) =>
        exemption.category !== 'DECIDED-BELOW' && exemption.decidedIn !== undefined,
    ).map(keyOf)

    expect(below.length).toBeGreaterThan(0)
    expect(unbound, 'the named module no longer makes the named call').toEqual([])
    expect(elsewhere, 'decidedIn belongs to DECIDED-BELOW entries only').toEqual([])
  })

  it('names a guard wherever the adapter calls one', () => {
    // Without a guard an entry is held only by its reason, so those that
    // remain are named here: adding one is a second, reviewed change.
    const withoutGuard = SERVER_FUNCTION_POLICY_EXEMPTIONS.filter(
      (exemption) => exemption.guard === null,
    ).map(keyOf)

    expect(withoutGuard.sort()).toEqual([
      'src/contexts/guest/server/guest-scans.ts#resolvePublicPortalLink',
      'src/contexts/identity/server/invitation-preview.ts#getInvitationPreview',
      'src/shared/observability/browser-observability.server.ts#getBrowserObservabilityConfigFn',
    ])
  })
})
