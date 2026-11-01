// Every control that retries a read presses it through `useReadRetry`, because in a
// tab whose code is older than the server's the read can only be refused again:
// pressing it directly is a button that does nothing, however often it is pressed.
// A retry that is not a read (a save) goes through in a stale tab, and a reload could
// lose it, so RetryButton on its own presses exactly what it is given.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadMoreButton } from './load-more-button'
import { RegionError, RetryButton } from './region-error'

const hoisted = vi.hoisted(() => ({
  reloading: false,
  tryAgain: undefined as unknown as (retry: () => void) => void,
  press: (): void => undefined,
}))

vi.mock('#/components/hooks/use-read-retry', () => ({
  useReadRetry: (retry: () => void) => ({
    tryAgain: () => hoisted.tryAgain(retry),
    reloading: hoisted.reloading,
  }),
}))

vi.mock('#/components/ui/button', () => ({
  Button: (
    props: Readonly<{
      children?: ReactNode
      onClick?: () => void
      'aria-busy'?: boolean
    }>,
  ) => {
    if (props.onClick) hoisted.press = props.onClick
    return createElement('button', { 'aria-busy': props['aria-busy'] }, props.children)
  },
}))

const regionError = (onRetry: () => void, retrying = false) =>
  renderToStaticMarkup(
    createElement(RegionError, {
      message: 'The preview couldn’t be loaded.',
      onRetry,
      retrying,
    }),
  )

const loadMore = (onLoadMore: () => void, failed = false) =>
  renderToStaticMarkup(
    createElement(LoadMoreButton, { onLoadMore, loading: false, failed }),
  )

let pressedThrough: Array<() => void>

beforeEach(() => {
  pressedThrough = []
  hoisted.reloading = false
  hoisted.tryAgain = (retry) => void pressedThrough.push(retry)
})

describe('RegionError', () => {
  it('presses Try again through the read retry, with the region’s own refetch', () => {
    const refetch = vi.fn()
    regionError(refetch)

    hoisted.press()

    expect(pressedThrough).toEqual([refetch])
    expect(refetch).not.toHaveBeenCalled()
  })

  it('stays busy while the page is loaded afresh, so the press is seen to have worked', () => {
    hoisted.reloading = true

    const html = regionError(vi.fn())
    hoisted.press()

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Trying again…')
    expect(pressedThrough).toEqual([])
  })

  it('stays busy while its own read retries', () => {
    expect(regionError(vi.fn(), true)).toContain('aria-busy="true"')
  })
})

describe('LoadMoreButton', () => {
  it('presses through the read retry, with the feed’s own next page', () => {
    const fetchNextPage = vi.fn()
    expect(loadMore(fetchNextPage, true)).toContain('Try again')

    hoisted.press()

    expect(pressedThrough).toEqual([fetchNextPage])
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('asks for the next page by itself until one has failed: nothing yet says it cannot be answered', () => {
    const fetchNextPage = vi.fn()
    expect(loadMore(fetchNextPage)).toContain('Load more')

    hoisted.press()

    expect(fetchNextPage).toHaveBeenCalledOnce()
    expect(pressedThrough).toEqual([])
  })

  it('stays busy while the page is loaded afresh, and takes no press', () => {
    hoisted.reloading = true

    const html = loadMore(vi.fn(), true)
    hoisted.press()

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Loading…')
    expect(pressedThrough).toEqual([])
  })
})

describe('RetryButton on its own', () => {
  it('presses exactly what it is given, so retrying a save never reloads the page', () => {
    const saveAgain = vi.fn()
    renderToStaticMarkup(createElement(RetryButton, { onRetry: saveAgain }))

    hoisted.press()

    expect(saveAgain).toHaveBeenCalledOnce()
    expect(pressedThrough).toEqual([])
  })
})
