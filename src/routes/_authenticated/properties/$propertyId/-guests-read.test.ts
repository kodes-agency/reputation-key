// Guest voice reads one analysis. The loader reads the first window; a later range is read
// in the browser, through the cache, with the previous page kept on screen meanwhile. When
// that read fails there is no page and no reason to show, and until the route asked for the
// failure (`keptData`) it drew its loading frame for good, with no Try again.
//
// The route component is rendered once on the server renderer (the unit project has no
// DOM) over a real QueryClient in which the range the reader chose has already been read,
// or has failed. The router, the property read and the page itself stand outside.

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({
  propertyId: '10000000-0000-4000-8000-000000000001',
  /** The range in the address bar. */
  range: 'auto',
  read: vi.fn<(input: unknown) => Promise<unknown>>(),
  drawn: vi.fn<(props: unknown) => void>(),
  pending: vi.fn<() => void>(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ propertyId: page.propertyId }),
    useSearch: () => ({ range: page.range }),
    useNavigate: () => vi.fn(),
  }),
  notFound: vi.fn(),
}))
vi.mock('#/contexts/ai/server/guest-voice-v2', () => ({
  getGuestVoiceV2Fn: page.read,
}))
vi.mock('#/routes/-queries/route-queries', async () => {
  const { queryOptions } = await import('@tanstack/react-query')
  return {
    propertyQuery: (propertyId: string) =>
      queryOptions({
        queryKey: ['test', 'property', propertyId],
        queryFn: () => ({ property: { name: 'The Harbour' } }),
        staleTime: Infinity,
      }),
  }
})
vi.mock('#/components/features/property/property-guest-voice-page', () => ({
  PropertyGuestVoicePage: (props: unknown) => {
    page.drawn(props)
    return null
  },
}))
vi.mock('#/components/layout/route-page-state', () => ({
  RoutePending: () => {
    page.pending()
    return null
  },
}))

import { propertyQuery } from '#/routes/-queries/route-queries'
import { propertyGuestVoiceV2Query, Route } from './guests'

let client: QueryClient

beforeEach(async () => {
  // An errored read is not retried on mount, so the render sees the failure itself.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  })
  await client.fetchQuery(propertyQuery(page.propertyId))
  page.range = 'auto'
})

afterEach(() => {
  client.clear()
  vi.clearAllMocks()
})

function renderRoute(): string {
  const component = Route.options.component
  if (!component) throw new Error('the Guest voice route has no component')
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(component)),
  )
}

describe('the Guest voice route when the range the reader chose is read in the browser', () => {
  it('is the route error, with its Try again, when that read failed', async () => {
    const failure = new Error('the Guest voice read failed')
    page.read.mockRejectedValue(failure)
    await client
      .fetchQuery(propertyGuestVoiceV2Query(page.propertyId, '90d'))
      .catch(() => undefined)
    page.range = '90d'

    expect(renderRoute).toThrow(failure)
    expect(page.pending).not.toHaveBeenCalled()
    expect(page.drawn).not.toHaveBeenCalled()
  })

  it('draws the loading frame while that read has not answered yet', () => {
    page.range = '90d'

    renderRoute()

    expect(page.pending).toHaveBeenCalledTimes(1)
    expect(page.drawn).not.toHaveBeenCalled()
  })

  it('draws the reason an answered read gives', async () => {
    page.read.mockResolvedValue({ status: 'disabled' })
    await client.fetchQuery(propertyGuestVoiceV2Query(page.propertyId, 'auto'))

    renderRoute()

    expect(page.drawn).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disabled', range: 'auto' }),
    )
    expect(page.pending).not.toHaveBeenCalled()
  })
})
