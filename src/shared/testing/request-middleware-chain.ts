// Start's request middleware, run the way its executor runs them: each gets the
// next one as `next`, and the last one's `next` is the terminal handler. Enough
// to show what a chain does with a request, and what its outer members see when
// an inner one throws, without a server.

type Handler = 'serverFn' | 'router'
type Settled = Readonly<{ response: Response }>
type ChainStep = (input: {
  request: Request
  pathname: string
  context: undefined
  handlerType: Handler
  next: () => Promise<Settled>
}) => Promise<Settled | Response> | Settled | Response
type RequestMiddleware = Readonly<{ options: Readonly<{ server?: unknown }> }>

export type ChainRequest = Readonly<{
  request: Request
  pathname: string
  handlerType: Handler
}>

/** A call of the server function `id` as the app's own client makes it (same-origin). */
export function serverFnChainRequest(
  id: string,
  handlerType: Handler = 'serverFn',
): ChainRequest {
  const pathname = handlerType === 'serverFn' ? `/_serverFn/${id}` : `/${id}`
  return {
    request: new Request(`https://manager.repkey.example${pathname}`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    }),
    pathname,
    handlerType,
  }
}

export async function runRequestChain(
  middlewares: readonly RequestMiddleware[],
  terminal: () => Promise<Settled>,
  input: ChainRequest,
): Promise<Response> {
  const step = (index: number): (() => Promise<Settled>) =>
    index === middlewares.length
      ? terminal
      : async () => {
          const run = middlewares[index]?.options.server as ChainStep
          const settled = await run({
            ...input,
            context: undefined,
            next: step(index + 1),
          })
          return settled instanceof Response ? { response: settled } : settled
        }
  return (await step(0)()).response
}
