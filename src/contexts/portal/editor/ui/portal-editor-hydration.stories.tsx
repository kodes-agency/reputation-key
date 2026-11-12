// The Portal editor printed by the server before its reads answered, then hydrated
// in the browser after they did (TanStack Start streams query data into the client
// cache): the first browser render must print the server's words, with no
// hydration error, and the answered words follow once hydration is done.
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { RouterProvider } from '@tanstack/react-router'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, waitFor } from 'storybook/test'
import { portalKeys } from '#/shared/queries/query-keys'
import { usePortalLinkTaps } from './link-tree/use-portal-link-taps'
import { TooltipProvider } from '#/components/ui/tooltip'
import { makeAuthedRouter } from '../../../../../.storybook/AuthedRouterDecorator'
import { action, makeResources } from './__fixtures__/portal-editor-fixtures'
import { PortalDraftAutosaveProvider } from './portal-draft-autosave-context'
import { PortalEditor } from './portal-editor'
import { withoutReadAnswers } from './portal-editor-section-reads'
import type { PortalEditorResources } from './portal-editor-types'

const meta = {
  title: 'Portal/PortalEditor hydration',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

async function page(content: () => ReactNode, client: QueryClient = new QueryClient()) {
  const router = makeAuthedRouter(content, 'AccountAdmin')
  await router.load()
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <PortalDraftAutosaveProvider>
          <RouterProvider router={router} />
        </PortalDraftAutosaveProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

const editor = (resources: PortalEditorResources) => () => (
  <PortalEditor resources={resources} requestedSection="welcome" />
)

const summaryTexts = (root: ParentNode) =>
  Array.from(root.querySelectorAll('nav a')).map((link) => link.textContent ?? '')

export const HydratesWithoutAMismatch: Story = {
  render: () => <p>Reads answered between the server render and hydration.</p>,
  play: async () => {
    const answered = makeResources(action(async () => undefined))
    const host = document.createElement('div')
    host.innerHTML = renderToString(await page(editor(withoutReadAnswers(answered))))
    document.body.append(host)
    const served = summaryTexts(host)
    expect(served.length).toBeGreaterThan(0)

    const errors: Array<unknown> = []
    const root = hydrateRoot(host, await page(editor(answered)), {
      onRecoverableError: (error) => errors.push(error),
    })
    try {
      await waitFor(() => expect(summaryTexts(host)).not.toEqual(served))
      expect(errors).toEqual([])
    } finally {
      root.unmount()
      host.remove()
    }
  },
}

const PROPERTY_ID = 'prop-1'

function LinkTapsRead() {
  const taps = usePortalLinkTaps({
    getLinkTaps: async () => ({ taps: { 'link-1': 7 } }),
    pageIsLive: true,
    propertyId: PROPERTY_ID,
    portalId: 'p-1',
  })
  return <p data-testid="reads">{taps ? `${taps['link-1']} taps` : 'no taps'}</p>
}

// The link tree's tap figures: the answer is in the client cache when the browser hydrates, and the first render must still print the server's words.
export const LinkTapsHydrateWithoutAMismatch: Story = {
  render: () => <p>Taps answered before hydration.</p>,
  play: async () => {
    const host = document.createElement('div')
    host.innerHTML = renderToString(await page(() => <LinkTapsRead />))
    document.body.append(host)
    expect(host.textContent).toBe('no taps')

    const answered = new QueryClient()
    answered.setQueryData(portalKeys.linkTaps(PROPERTY_ID, 'p-1'), {
      taps: { 'link-1': 7 },
    })
    const errors: Array<unknown> = []
    const root = hydrateRoot(host, await page(() => <LinkTapsRead />, answered), {
      onRecoverableError: (error) => errors.push(error),
    })
    try {
      await waitFor(() => expect(host.textContent).toBe('7 taps'))
      expect(errors).toEqual([])
    } finally {
      root.unmount()
      host.remove()
    }
  },
}
