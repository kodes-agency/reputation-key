// Whether the Share tab offers the print kit, or the one notice that stands in for
// it. A print carries the live page's code, so a portal that is not live must not
// reach the read (which can only refuse), and a read the server refuses for that
// reason is the same notice, not a failure with a Try again.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPublicationState } from '../shared/types'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import type { PortalShareProps } from './portal-share-types'
import { usePortalPrintKit } from './use-portal-print-kit'

type Result = ReturnType<typeof usePortalPrintKit>
type Seen = Readonly<{ show: boolean; notLive: Result['notLive'] }>

const MANAGER_VIEW = { showActions: true, showCode: true, canDownloadAgain: true }

/** What the read answers for a portal that prints in one language. */
const ANSWER: PortalPrintKitView = {
  portalId: 'portal-1',
  kit: 'final',
  lastPrint: null,
  savedWording: null,
  portalName: 'Reception',
  primaryLocale: 'en',
  locales: ['en'],
  titles: { en: 'Reception' },
  look: {
    wordmark: 'Oakmere',
    propertyName: 'Oakmere by Larkspur',
    accentColour: '#A8C6FE',
    fieldColour: '#16224A',
    heroUrl: null,
    heroFocal: null,
    heroSize: null,
    logoUrl: null,
  },
}

function resultFor(
  state: PortalPublicationState | undefined,
  options: Readonly<{
    read?: PortalPrintKitReader
    view?: Parameters<typeof usePortalPrintKit>[1]
    withPrintKit?: boolean
    /** What the read's cache holds when the tab opens. */
    prime?: (client: QueryClient) => void
  }> = {},
): Result {
  const read = options.read ?? vi.fn()
  const props = {
    portalId: 'portal-1',
    publicationState: state,
    printKit:
      options.withPrintKit === false ? undefined : { read, downloadMutation: vi.fn() },
  } as unknown as PortalShareProps
  const client = new QueryClient()
  options.prime?.(client)
  let seen: Result | null = null
  function Probe(): ReactNode {
    seen = usePortalPrintKit(props, options.view ?? MANAGER_VIEW)
    return null
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Probe)),
  )
  if (seen === null) throw new Error('The probe did not render')
  return seen
}

function seenFor(
  state: PortalPublicationState | undefined,
  options: Parameters<typeof resultFor>[1] = {},
): Seen {
  const { show, notLive } = resultFor(state, options)
  return { show, notLive }
}

/** The read has been tried and refused, with nothing to show. */
function failTheRead(client: QueryClient): void {
  client
    .getQueryCache()
    .build(client, {
      queryKey: portalKeys.printKit('portal-1'),
      queryFn: () => Promise.reject(new Error('unavailable')),
    })
    .setState({
      status: 'error',
      error: new Error('unavailable'),
      errorUpdateCount: 1,
      fetchStatus: 'idle',
    })
}

describe('usePortalPrintKit', () => {
  it.each<PortalPublicationState>(['draft', 'disabled', 'archived'])(
    'offers one notice instead of the kit while the portal is %s',
    (state) => {
      const seen = seenFor(state)

      expect(seen.show).toBe(false)
      expect(seen.notLive).toEqual(
        expect.objectContaining({ body: expect.stringMatching(/to make a print kit/) }),
      )
    },
  )

  it('offers the kit, and no notice, while the portal is live', () => {
    expect(seenFor('published')).toEqual({ show: true, notLive: null })
  })

  it('lets the read decide when the tab was not told the state', () => {
    expect(seenFor(undefined)).toEqual({ show: true, notLive: null })
  })

  it('offers nothing to someone who cannot make prints, whatever the state', () => {
    const viewer = { showActions: false, showCode: true, canDownloadAgain: false }

    expect(seenFor('draft', { view: viewer })).toEqual({ show: false, notLive: null })
    expect(seenFor('published', { view: viewer })).toEqual({ show: false, notLive: null })
  })

  it('offers nothing before there is a code to print', () => {
    const noCode = { showActions: true, showCode: false, canDownloadAgain: false }

    expect(seenFor('draft', { view: noCode })).toEqual({ show: false, notLive: null })
  })

  it('offers nothing on a tab that has no print kit', () => {
    expect(seenFor('draft', { withPrintKit: false })).toEqual({
      show: false,
      notLive: null,
    })
  })

  describe('what follows the Print cards', () => {
    it('waits while the first read is out, so the section it follows cannot push it away', () => {
      expect(resultFor('published').settling).toBe(true)
    })

    it('stops waiting once the read has answered', () => {
      const answered = resultFor('published', {
        prime: (client) => client.setQueryData(portalKeys.printKit('portal-1'), ANSWER),
      })

      expect(answered.settling).toBe(false)
    })

    it('does not wait on a read that failed: the code is what the person came for', () => {
      expect(resultFor('published', { prime: failTheRead }).settling).toBe(false)
    })

    it('does not wait where there is no read to wait on', () => {
      expect(resultFor('draft').settling).toBe(false)
      expect(resultFor('published', { withPrintKit: false }).settling).toBe(false)
    })
  })
})
