// Web shutdown: refuse new traffic, let the requests already admitted finish,
// then close resources in order, all under one deadline.
//
// The nitro server entry hands every request to `app.fetch`. createWebShutdown
// wraps it to count requests in flight. A request counts until its handler has
// returned AND the native response has finished or closed, so a streamed body is
// waited for and an aborted socket still waits for its running handler. Waiting
// for them first keeps the database pool and Redis open for the queries an
// admitted request still has to make.
//
// A resource that fails to close, or a deadline that expires first, ends the
// process with exit code 1 (the platform's SIGKILL remains the outer bound).
// Otherwise it does not call process.exit: once the resources are closed the
// event loop empties and the process ends on its own, with code 0.
//
// Wired by server/plugins/graceful-shutdown.ts (nitro runtime plugin, registered
// through the `plugins` array in vite.config.ts).

import { disposeResources } from './disposer'

export interface NamedCloser {
  readonly name: string
  readonly close: () => Promise<void>
}

/** Narrow structural subset of the pino logger used by the shutdown path. */
export interface ShutdownLogger {
  info: (obj: Record<string, unknown>, msg: string) => void
  error: (obj: Record<string, unknown>, msg: string) => void
}

export interface CloseFailure {
  readonly name: string
  readonly reason: 'timeout' | 'error'
}

/**
 * Close each resource in order under one shared `budgetMs`. A rejecting close is
 * logged and does not stop the ones behind it; once the budget expires the rest
 * are skipped and reported as timeouts. Returns the resources that failed or
 * timed out — never throws.
 */
export async function closeWebResources(
  closers: ReadonlyArray<NamedCloser>,
  options: { readonly budgetMs: number; readonly logger: ShutdownLogger },
): Promise<ReadonlyArray<CloseFailure>> {
  const result = await disposeResources(
    closers.map((closer) => [
      {
        label: closer.name,
        release: async () => {
          await closer.close()
          options.logger.info(
            { resource: closer.name },
            'Resource closed during shutdown',
          )
        },
      },
    ]),
    {
      budgetMs: options.budgetMs,
      onError: (err, name) =>
        options.logger.error(
          { err, resource: name },
          'Error closing resource during shutdown',
        ),
    },
  )
  return [
    ...result.failed.map((name) => ({ name, reason: 'error' as const })),
    ...result.stuck.map((name) => ({ name, reason: 'timeout' as const })),
  ]
}

type NativeResponse = {
  once: (event: 'finish' | 'close', listener: () => void) => unknown
  off: (event: 'finish' | 'close', listener: () => void) => unknown
}
type ServerRequest = Request & { runtime?: { node?: { res?: NativeResponse } } }

/**
 * Wrap the server's fetch with in-flight accounting and own the shutdown
 * sequence. `shutdown()` is idempotent: every caller gets the same promise.
 */
export function createWebShutdown(options: {
  fetch: (request: Request) => Response | Promise<Response>
  closers: readonly NamedCloser[]
  budgetMs: number
  logger: ShutdownLogger
  beginDrain: () => void
  failed: () => void
  setExitCode: (code: 1) => void
  forceExit: (code: 1) => void
}) {
  let draining = false
  let closing: Promise<void> | undefined
  const active = new Set<Promise<void>>()

  const fetch = async (request: ServerRequest): Promise<Response> => {
    if (draining)
      return new Response('Service unavailable', {
        status: 503,
        headers: { Connection: 'close' },
      })
    const done = Promise.withResolvers<void>()
    active.add(done.promise)
    const native = request.runtime?.node?.res
    let handlerFinished = false
    let responseFinished = false
    const settle = () => {
      if (!handlerFinished || !responseFinished) return
      active.delete(done.promise)
      done.resolve()
    }
    const finish = () => {
      native?.off('finish', finish)
      native?.off('close', finish)
      responseFinished = true
      settle()
    }
    native?.once('finish', finish)
    native?.once('close', finish)
    try {
      const response = await options.fetch(request)
      handlerFinished = true
      settle()
      if (native) return response
      // No native response to watch: the body's last chunk or cancel is the end.
      if (!response.body) {
        finish()
        return response
      }
      const reader = response.body.getReader()
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read()
              if (chunk.done) {
                finish()
                controller.close()
              } else controller.enqueue(chunk.value)
            } catch (error) {
              finish()
              controller.error(error)
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason)
            } finally {
              finish()
            }
          },
        }),
        response,
      )
    } catch (error) {
      handlerFinished = true
      if (native) settle()
      else finish()
      throw error
    }
  }

  const shutdown = (signal = 'shutdown'): Promise<void> => {
    if (closing) return closing
    draining = true
    options.logger.info(
      { signal },
      'Shutdown signal received, draining requests and closing app resources',
    )
    options.beginDrain()
    closing = closeWebResources(
      [
        {
          name: 'http',
          close: async () => {
            await Promise.all(active)
          },
        },
        ...options.closers,
      ],
      options,
    ).then((failures) => {
      if (failures.length === 0) {
        options.logger.info({}, 'Graceful shutdown resource cleanup complete')
        return
      }
      options.failed()
      options.setExitCode(1)
      options.logger.error(
        { failures },
        'Graceful shutdown finished with unclean resources',
      )
      options.forceExit(1)
    })
    return closing
  }
  return { fetch, shutdown }
}
