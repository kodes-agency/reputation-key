// Whether the Share tab offers the print kit, or the one notice that stands in for
// it. A print carries the live page's code, so a portal that is not live must not
// reach the read (which can only refuse), and a read the server refuses for that
// reason is the same notice, not a failure with a Try again.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { PortalPublicationState } from '../shared/types'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import type { PortalShareProps } from './portal-share-types'
import { usePortalPrintKit } from './use-portal-print-kit'

type Result = ReturnType<typeof usePortalPrintKit>
type Seen = Readonly<{ show: boolean; notLive: Result['notLive'] }>

const MANAGER_VIEW = { showActions: true, showCode: true, canDownloadAgain: true }

function seenFor(
  state: PortalPublicationState | undefined,
  options: Readonly<{
    read?: PortalPrintKitReader
    view?: Parameters<typeof usePortalPrintKit>[1]
    withPrintKit?: boolean
  }> = {},
): Seen {
  const read = options.read ?? vi.fn()
  const props = {
    portalId: 'portal-1',
    publicationState: state,
    printKit:
      options.withPrintKit === false ? undefined : { read, downloadMutation: vi.fn() },
  } as unknown as PortalShareProps
  let seen: Seen | null = null
  function Probe(): ReactNode {
    const { show, notLive } = usePortalPrintKit(props, options.view ?? MANAGER_VIEW)
    seen = { show, notLive }
    return null
  }
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Probe),
    ),
  )
  if (seen === null) throw new Error('The probe did not render')
  return seen
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
})
