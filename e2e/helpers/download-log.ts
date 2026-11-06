import type { Page, Request } from '@playwright/test'

type Download = Readonly<{ url: string; bodyBytes: number; headerBytes: number }>

export function assertDownloadBudget(
  report: Readonly<{ bytes: number }>,
  limitBytes: number,
): void {
  if (report.bytes > limitBytes) {
    throw new Error(
      `Guest downloaded ${report.bytes} bytes; fixed limit is ${limitBytes} bytes`,
    )
  }
}

/** Attach before navigation in a fresh context. Counts encoded response bodies
 * and response headers, including documents, assets and server-function replies.
 * Upload bytes and decoded body sizes are not download measurements. */
export function attachDownloadLog(page: Page): () => Promise<{
  bytes: number
  responses: Download[]
}> {
  const downloads: Promise<Download | null>[] = []
  const inFlight = new Set<Request>()
  let onProgress: (() => void) | undefined
  let failed = false
  const onRequest = (request: Request) => {
    inFlight.add(request)
  }
  const onFinished = (request: Request) => {
    downloads.push(
      request.sizes().then(
        (sizes) => ({
          url: request.url(),
          bodyBytes: sizes.responseBodySize,
          headerBytes: sizes.responseHeadersSize,
        }),
        () => null,
      ),
    )
    inFlight.delete(request)
    onProgress?.()
  }
  const onFailed = (request: Request) => {
    failed = true
    inFlight.delete(request)
    onProgress?.()
  }
  page.on('request', onRequest)
  page.on('requestfinished', onFinished)
  page.on('requestfailed', onFailed)

  return async () => {
    try {
      // A previous idle can resolve immediately despite newer requests.
      await page.waitForLoadState('networkidle')
      let results: (Download | null)[]
      do {
        while (inFlight.size > 0) {
          await new Promise<void>((resolve) => {
            onProgress = resolve
          })
        }
        results = await Promise.all(downloads)
        // Requests can start or finish while asynchronous sizes are collected.
      } while (inFlight.size > 0 || results.length !== downloads.length)
      if (failed || results.some((result) => result === null)) {
        throw new Error('Guest download measurement is incomplete')
      }
      const responses = results.filter((result) => result !== null)
      const bytes = responses.reduce(
        (sum, response) => sum + response.bodyBytes + response.headerBytes,
        0,
      )
      if (bytes === 0) throw new Error('No downloaded bytes were recorded')
      return { bytes, responses }
    } finally {
      page.off('request', onRequest)
      page.off('requestfinished', onFinished)
      page.off('requestfailed', onFailed)
    }
  }
}
