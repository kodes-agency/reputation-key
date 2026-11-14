import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { serverFunctionErrorAdapter } from '../../src/shared/auth/server-function-error'

// ── Server-fn RPC (TanStack Start dev wire format) ────────────────────
//
// The wire contract (verified against @tanstack/start-server-core
// server-functions-handler.js + start-client-core serverFnFetcher.js):
//   - fn id (dev): base64url(JSON{ file: '/<repo-relative>?tss-serverfn-split',
//     export: '<name>_createServerFn_handler' }) at /_serverFn/<id>
//   - request payload: seroval JSON tree of { data } (toJSONAsync), POST body
//     or ?payload= query for GET fns
//   - success response: HTTP 200, seroval CROSS-JSON of { result } — app-level
//     fn errors may instead surface as { error } in the same envelope
//   - thrown errors: HTTP 4xx/5xx (intended status via the response ALS),
//     seroval CROSS-JSON of the Error itself
// seroval is not a direct dependency (pnpm strict), so it is resolved at
// runtime through the app's own dependency chain — always the same version
// the server uses.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

type SerovalCodec = Readonly<{
  toJSONAsync: (value: unknown) => Promise<unknown>
  fromCrossJSON: (tree: unknown, options: { plugins: unknown[] }) => unknown
  plugins: unknown[]
}>

let _codec: SerovalCodec | undefined

/**
 * seroval + the app's seroval plugins, resolved through the app's own
 * dependency chain (seroval/router-core are not direct dependencies — pnpm
 * strict — so they cannot be imported by name here; the chain always yields
 * the exact versions the running server serializes with). The plugin set is
 * what start-client-core's getDefaultSerovalPlugins builds: the app's
 * serializationAdapters (`src/start.ts`) ahead of router-core's defaults.
 */
async function codec(): Promise<SerovalCodec> {
  if (!_codec) {
    const req = createRequire(import.meta.url)
    const reactRouterPkg = req.resolve('@tanstack/react-router/package.json')
    const routerCorePkg = req.resolve('@tanstack/router-core/package.json', {
      paths: [reactRouterPkg],
    })
    const reactStartPkg = req.resolve('@tanstack/react-start/package.json')
    const clientCorePkg = req.resolve('@tanstack/start-client-core/package.json', {
      paths: [reactStartPkg],
    })
    const seroval = req(req.resolve('seroval', { paths: [clientCorePkg] })) as {
      toJSONAsync: SerovalCodec['toJSONAsync']
      fromCrossJSON: SerovalCodec['fromCrossJSON']
    }
    // `ssr/client`, not the package root: router-core 1.171.32 stopped
    // re-exporting the seroval plugins from its index and now publishes them
    // on the `./ssr/client` subpath only. Reading the root gave `undefined`
    // and every server-function call in the suite died on the spread.
    const routerCore = (await import(
      pathToFileURL(join(dirname(routerCorePkg), 'dist/esm/ssr/client.js')).href
    )) as {
      defaultSerovalPlugins: unknown[]
      makeSerovalPlugin: (adapter: unknown) => unknown
    }
    _codec = {
      ...seroval,
      plugins: [
        routerCore.makeSerovalPlugin(serverFunctionErrorAdapter),
        ...routerCore.defaultSerovalPlugins,
      ],
    }
  }
  return _codec
}

/**
 * TanStack Start server-function URL. Dev uses a base64url module descriptor;
 * production uses SHA-256 of `<file>--<generated handler export>`.
 */
export function serverFnUrl(file: string, exportName: string): string {
  const handlerExport = `${exportName}_createServerFn_handler`
  const id = process.env.E2E_EXTERNAL_STACK
    ? createHash('sha256').update(`${file}--${handlerExport}`).digest('hex')
    : Buffer.from(
        JSON.stringify({
          file: `/${file}?tss-serverfn-split`,
          export: handlerExport,
        }),
      ).toString('base64url')
  return `/_serverFn/${id}`
}

export type ServerFnErrorBody = Readonly<{
  name?: string
  message?: string
  code?: string
  status?: number
}>

export type ServerFnRawResult = Readonly<{
  httpStatus: number
  result?: unknown
  error?: ServerFnErrorBody
}>

function normalizeError(value: unknown, httpStatus: number): ServerFnErrorBody {
  if (value instanceof Error) {
    const tagged = value as Error & { code?: string; status?: number }
    return {
      name: value.name,
      message: value.message,
      code: tagged.code,
      status: tagged.status ?? httpStatus,
    }
  }
  if (value && typeof value === 'object') {
    const body = value as Record<string, unknown>
    return {
      name: typeof body.name === 'string' ? body.name : undefined,
      message: typeof body.message === 'string' ? body.message : JSON.stringify(value),
      code: typeof body.code === 'string' ? body.code : undefined,
      status: typeof body.status === 'number' ? body.status : httpStatus,
    }
  }
  return { message: String(value), status: httpStatus }
}

async function parseServerFnResponse(res: {
  status(): number
  text(): Promise<string>
}): Promise<ServerFnRawResult> {
  const httpStatus = res.status()
  const text = await res.text()
  if (!text) {
    return httpStatus >= 400
      ? {
          httpStatus,
          error: { message: `HTTP ${httpStatus} (empty body)`, status: httpStatus },
        }
      : { httpStatus }
  }
  let decoded: unknown
  try {
    decoded = (await codec()).fromCrossJSON(JSON.parse(text), {
      plugins: (await codec()).plugins,
    })
  } catch {
    // Non-seroval body (framework-level error page, 405, etc.)
    return httpStatus >= 400
      ? { httpStatus, error: { message: text.slice(0, 300), status: httpStatus } }
      : { httpStatus, result: text }
  }
  if (httpStatus >= 400 || decoded instanceof Error) {
    return { httpStatus, error: normalizeError(decoded, httpStatus) }
  }
  if (decoded && typeof decoded === 'object') {
    const envelope = decoded as Record<string, unknown>
    if (envelope.error) {
      return { httpStatus, error: normalizeError(envelope.error, httpStatus) }
    }
    if ('result' in envelope) {
      return { httpStatus, result: envelope.result }
    }
  }
  return { httpStatus, result: decoded }
}

type BrowserServerFnResponse = Readonly<{
  status: number
  text: string
}>

async function browserServerFnRequest(
  page: Page,
  input: Readonly<{ url: string; method: 'GET' | 'POST'; body?: string }>,
): Promise<{ status(): number; text(): Promise<string> }> {
  const current = new URL(page.url())
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    throw new Error('Server fn calls require a page loaded from the application origin')
  }
  const response = await page.evaluate(
    async ({ url, method, body }): Promise<BrowserServerFnResponse> => {
      const result = await fetch(url, {
        method,
        body,
        credentials: 'same-origin',
        headers: {
          'x-tsr-serverFn': 'true',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      })
      return { status: result.status, text: await result.text() }
    },
    input,
  )
  return {
    status: () => response.status,
    text: async () => response.text,
  }
}

/** POST a server fn; throws when the fn returned a serialized error. */
export async function callServerFn<T = unknown>(
  page: Page,
  fn: { file: string; exportName: string; data: unknown },
): Promise<T> {
  const body = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const res = await browserServerFnRequest(page, {
    url: serverFnUrl(fn.file, fn.exportName),
    method: 'POST',
    body,
  })
  const parsed = await parseServerFnResponse(res)
  if (parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} failed: ${parsed.error.code ?? parsed.error.name} — ${parsed.error.message}`,
    )
  }
  return parsed.result as T
}

/** POST a server fn expecting a denial; returns the serialized error body. */
export async function callServerFnExpectError(
  page: Page,
  fn: { file: string; exportName: string; data: unknown },
): Promise<ServerFnErrorBody> {
  const body = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const res = await browserServerFnRequest(page, {
    url: serverFnUrl(fn.file, fn.exportName),
    method: 'POST',
    body,
  })
  const parsed = await parseServerFnResponse(res)
  if (!parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} was expected to fail but returned: ${JSON.stringify(parsed.result)}`,
    )
  }
  return parsed.error
}

/** GET a server fn (query-param payload encoding). */
export async function callServerFnGet<T = unknown>(
  page: Page,
  fn: { file: string; exportName: string; data?: unknown },
): Promise<T> {
  const serialized = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const url = `${serverFnUrl(fn.file, fn.exportName)}?payload=${encodeURIComponent(serialized)}`
  const res = await browserServerFnRequest(page, { url, method: 'GET' })
  const parsed = await parseServerFnResponse(res)
  if (parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} failed: ${parsed.error.code ?? parsed.error.name} — ${parsed.error.message}`,
    )
  }
  return parsed.result as T
}

/** GET a server fn expecting a denial; returns the serialized error body. */
export async function callServerFnGetExpectError(
  page: Page,
  fn: { file: string; exportName: string; data?: unknown },
): Promise<ServerFnErrorBody> {
  const serialized = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const url = `${serverFnUrl(fn.file, fn.exportName)}?payload=${encodeURIComponent(serialized)}`
  const res = await browserServerFnRequest(page, { url, method: 'GET' })
  const parsed = await parseServerFnResponse(res)
  if (!parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} was expected to fail but returned: ${JSON.stringify(parsed.result)}`,
    )
  }
  return parsed.error
}
