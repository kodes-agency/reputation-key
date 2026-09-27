// A hard load of /properties/import-google/$importId renders the progress step
// on the server, in the container's zone (UTC), and hydrates it in the viewer's.
// "Last updated" printed with the runtime's own clock differed between the two,
// and React threw a hydration mismatch (#418). Rendering under two process zones
// stands in for the server and the browser: the markup must not differ.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportProgressDto } from '#/contexts/integration/application/public-api'
import { GoogleImportProgressView } from './google-import-progress-view'

const processing: ImportProgressDto = {
  contractVersion: 3,
  importJobId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  status: 'processing',
  totalCount: 4,
  processedCount: 2,
  counts: {
    pending: 2,
    processing: 0,
    imported: 2,
    relinked: 0,
    already_exists: 0,
    failed: 0,
    cancelled: 0,
  },
  items: [],
  canRetry: false,
  pollAfterMs: 2_000,
  purgeAt: null,
  updatedAt: '2026-08-12T10:00:00.000Z',
}

function renderProgressIn(timeZone: string): string {
  vi.stubEnv('TZ', timeZone)
  return renderToStaticMarkup(
    createElement(GoogleImportProgressView, {
      progress: processing,
      setupStep: null,
      isPollingError: false,
      isRefreshing: false,
      isCancelling: false,
      retryingItemId: null,
      onRefresh: () => undefined,
      onRetry: () => undefined,
      onCancel: () => undefined,
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GoogleImportProgressView server render', () => {
  it('prints the same progress caption on the server and in a browser elsewhere', () => {
    const server = renderProgressIn('UTC')
    const browser = renderProgressIn('Europe/Sofia')

    expect(browser).toBe(server)
    expect(server).toContain('50% complete')
  })
})
