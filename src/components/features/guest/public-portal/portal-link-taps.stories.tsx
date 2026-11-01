import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, spyOn, waitFor, within } from 'storybook/test'
import type { SelectSecondaryLinkAction } from './guest-response-form-types'
import { PortalSecondaryLinks } from './portal-secondary-links'
import { ImmersivePublicPortal } from './immersive/immersive-public-portal'
import {
  NONCE,
  RATED,
  TOKEN,
  immersivePortalProps,
} from './immersive/__fixtures__/immersive-public-portal-fixtures'

const selectSecondaryLink = fn<SelectSecondaryLinkAction>(async ({ fetch }) => {
  await fetch?.('/_serverFn/tap', { method: 'POST', body: 'tap' })
  return { url: 'https://example.test/unused-action-answer' }
})
const rejected = fn<SelectSecondaryLinkAction>(async () => {
  throw new Error('observation unavailable')
})
const MENU_ID = '30000000-0000-4000-8000-000000000001'
const props = immersivePortalProps()
const meta = {
  title: 'Features/Guest/PortalLinkTaps',
  component: ImmersivePublicPortal,
  args: { ...props, actions: { ...props.actions, selectSecondaryLink } },
  beforeEach: () => {
    selectSecondaryLink.mockClear()
    rejected.mockClear()
    const fetch = spyOn(window, 'fetch').mockResolvedValue(new Response())
    return () => fetch.mockRestore()
  },
} satisfies Meta<typeof ImmersivePublicPortal>
export default meta

type Story = StoryObj<typeof meta>

/** Observe after React's handler, then stop navigation so the story can continue. */
function tap(tile: HTMLElement, init: MouseEventInit = {}) {
  let prevented = true
  const observe = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }
  document.addEventListener('click', observe)
  try {
    tile.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    )
  } finally {
    document.removeEventListener('click', observe)
  }
  expect(prevented).toBe(false)
  expect(tile.getAttribute('target')).toBeNull()
}

function expectTapCounted(linkId: string) {
  expect(selectSecondaryLink).toHaveBeenCalledTimes(1)
  expect(selectSecondaryLink).toHaveBeenCalledWith({
    data: { token: TOKEN, csrfNonce: NONCE, linkId },
    fetch: expect.any(Function),
  })
  expect(window.fetch).toHaveBeenCalledTimes(1)
  expect(window.fetch).toHaveBeenCalledWith('/_serverFn/tap', {
    method: 'POST',
    body: 'tap',
    keepalive: true,
  })
}

const countImmersiveTap: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const tile = within(canvasElement).getByRole('link', { name: /Menu/u })
  expect(tile).toHaveAttribute('href', `/api/public/p/${TOKEN}/click/${MENU_ID}`)
  tap(tile)
  expectTapCounted(MENU_ID)
}

export const BeforeARating: Story = { play: countImmersiveTap }
export const AfterARating: Story = {
  args: { initialResponse: RATED },
  play: countImmersiveTap,
}
export const ModifiedClicksCountToo: Story = {
  play: async ({ canvasElement }) => {
    const tile = within(canvasElement).getByRole('link', { name: /Menu/u })
    tap(tile, { metaKey: true })
    tap(tile, { ctrlKey: true })
    expect(selectSecondaryLink).toHaveBeenCalledTimes(2)
  },
}
export const RejectedAction: Story = {
  args: { actions: { ...props.actions, selectSecondaryLink: rejected } },
  play: async ({ canvasElement }) => {
    tap(within(canvasElement).getByRole('link', { name: /Menu/u }))
    await waitFor(() => expect(rejected).toHaveBeenCalledOnce())
  },
}

const legacy = {
  token: TOKEN,
  csrfNonce: NONCE,
  organizationName: 'Avela Resort',
  categories: [],
  links: [{ id: 'link-menu', label: 'Menu', categoryId: null, url: '#preview' }],
  selectSecondaryLink,
}
export const LegacyTile: Story = {
  render: () => <PortalSecondaryLinks {...legacy} />,
  play: async ({ canvasElement }) => {
    tap(within(canvasElement).getByRole('link', { name: 'Menu' }))
    expectTapCounted('link-menu')
  },
}
export const LegacyRejectedAction: Story = {
  render: () => <PortalSecondaryLinks {...legacy} selectSecondaryLink={rejected} />,
  play: async ({ canvasElement }) => {
    tap(within(canvasElement).getByRole('link', { name: 'Menu' }))
    await waitFor(() => expect(rejected).toHaveBeenCalledOnce())
  },
}
export const InertPreview: Story = {
  render: () => <PortalSecondaryLinks {...legacy} token={undefined} />,
  play: async ({ canvasElement }) => {
    tap(within(canvasElement).getByRole('link', { name: 'Menu' }))
    expect(selectSecondaryLink).not.toHaveBeenCalled()
    expect(window.fetch).not.toHaveBeenCalled()
  },
}
