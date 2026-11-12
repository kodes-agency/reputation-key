import { createElement, isValidElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryObserver, type UseQueryResult } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { RegionError } from '#/components/ui/region-error'
import { PortalReadState } from '#/contexts/portal/workspace/ui/portal-read-state'
import { OrganizationReadRegion } from './organization-read-region'

function region(kind: 'organization' | 'portal', query: UseQueryResult<number>) {
  return kind === 'portal'
    ? createElement(PortalReadState, { queries: [query], label: 'page settings' })
    : createElement(OrganizationReadRegion<number>, {
        query,
        label: 'response performance',
        children: (value) => createElement('p', null, `Ready ${value}`),
      })
}
function retry(kind: 'organization' | 'portal', query: UseQueryResult<number>) {
  const element =
    kind === 'portal'
      ? PortalReadState({ queries: [query], label: 'page settings' })
      : OrganizationReadRegion({
          query,
          label: 'response performance',
          children: () => null,
        })
  if (
    !isValidElement<ComponentProps<typeof RegionError>>(element) ||
    element.type !== RegionError
  ) {
    throw new Error('A failed read must offer its local retry')
  }
  element.props.onRetry()
}

describe.each(['organization', 'portal'] as const)('%s local retry', (kind) => {
  it('keeps the failure and a busy recovery button while retrying, then recovers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let finish: (value: number) => void = () => undefined
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('private backend detail'))
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finish = resolve
          }),
      )
    const observer = new QueryObserver(client, { queryKey: ['read'], queryFn: read })
    const stop = observer.subscribe(() => undefined)
    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
      const failed = renderToStaticMarkup(region(kind, observer.getCurrentResult()))
      expect(failed).toContain('couldn’t be loaded.')
      expect(failed).toContain('Try again')
      expect(failed).not.toContain('private backend detail')
      retry(kind, observer.getCurrentResult())
      expect(read).toHaveBeenCalledTimes(2)
      const pending = renderToStaticMarkup(region(kind, observer.getCurrentResult()))
      expect(pending).toContain('couldn’t be loaded.')
      expect(pending).toContain('aria-busy="true"')
      expect(pending).not.toContain('Loading ')
      finish(7)
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(7))
      if (kind === 'organization') {
        expect(renderToStaticMarkup(region(kind, observer.getCurrentResult()))).toContain(
          'Ready 7',
        )
      }
    } finally {
      stop()
      client.clear()
    }
  })
})
