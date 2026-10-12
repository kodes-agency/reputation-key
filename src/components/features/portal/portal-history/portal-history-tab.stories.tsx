// fallow-ignore-file code-duplication
// The History tab with its reads and its write: the container, over mocked
// server functions. The view's states are in portal-history.stories.tsx; these
// stories prove what only the container does: fetching on mount, switching the
// filter, fetching what a restore would change, and handing the choice to the
// write and reporting its refusal.

import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { getPortalHistory } from '#/contexts/portal/server/portals'
import type {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { mockServerFn } from '../../../../../.storybook/mocks/mock-action'
import {
  STORY_PENDING_CHANGES,
  STORY_PORTAL_NAME,
  STORY_TIME_ZONE,
  STORY_VERSIONS,
  STORY_VERSION_DETAILS,
  storyHistoryFor,
} from './__fixtures__/portal-history-stories-data'
import { storyVersionPreview } from './__fixtures__/portal-version-preview-stories-data'
import { PortalHistoryTab, type MakeVersionLiveAction } from './portal-history-tab'

const getHistorySpy = fn(async (input: { data: { filter?: string } }) => ({
  entries: storyHistoryFor(input.data.filter ?? 'all'),
  nextCursor: null,
}))

const getVersionPreviewSpy = fn(
  async (input: { data: { portalId: string; version: number } }) =>
    storyVersionPreview(input.data.version),
)

const reads = {
  getHistory: mockServerFn(getHistorySpy) as unknown as typeof getPortalHistory,
  getVersions: mockServerFn(
    async (_input: unknown) => STORY_VERSIONS,
  ) as unknown as typeof getPortalVersions,
  getVersion: mockServerFn(
    async (input: { data: { version: number } }) =>
      STORY_VERSION_DETAILS[input.data.version],
  ) as unknown as typeof getPortalVersion,
  getVersionPreview: mockServerFn(
    getVersionPreviewSpy,
  ) as unknown as typeof getPortalVersionPreview,
}

const makeLiveAction = (
  impl: (input: { data: { portalId: string; version: number } }) => Promise<unknown>,
): MakeVersionLiveAction =>
  Object.assign(impl, {
    isPending: false,
    error: null as unknown,
    isSuccess: false,
    data: null,
  })

const meta: Meta<typeof PortalHistoryTab> = {
  title: 'Portal/PortalHistoryTab',
  component: PortalHistoryTab,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    portalId: 'portal-1',
    portalName: STORY_PORTAL_NAME,
    timeZone: STORY_TIME_ZONE,
    pendingChangeCount: STORY_PENDING_CHANGES,
    mayMakeLive: true,
    pageIsLive: true,
    reads,
    makeLive: makeLiveAction(async () => ({})),
  },
}
export default meta
type Story = StoryObj<typeof PortalHistoryTab>

export const ReadsOnMount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('list', { name: /history, newest first/i }),
    ).toBeInTheDocument()
    await expect(
      await canvas.findByRole('button', { name: /^Version 5, live now/ }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Based on version 5')).toBeInTheDocument()
  },
}

// The filter is asked of the server, not applied to what was already read.
export const FilterIsAskedOfTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('list', { name: /history, newest first/i })
    await userEvent.click(canvas.getByRole('radio', { name: 'Codes' }))
    await waitFor(() =>
      expect(getHistorySpy).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ filter: 'codes' }) }),
      ),
    )
    await expect(await canvas.findByText(/copied the NFC address/)).toBeInTheDocument()
  },
}

const makeLiveSpy = fn(
  async (_input: { data: { portalId: string; version: number } }) => ({}),
)
export const MakeLiveAgain: Story = {
  args: { makeLive: makeLiveAction(makeLiveSpy) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /make live again… version 4/i }),
    )
    const region = await canvas.findByRole('region', {
      name: 'Make version 4 live again?',
    })
    // What would change comes from the version read, not from the list.
    await within(region).findByText(/‘Getting here’ goes away/)
    await userEvent.click(
      within(region).getByRole('button', { name: 'Make version 4 live' }),
    )
    await waitFor(() =>
      expect(makeLiveSpy).toHaveBeenCalledWith({
        data: { portalId: 'portal-1', version: 4 },
      }),
    )
    await waitFor(() =>
      expect(
        canvas.queryByRole('region', { name: 'Make version 4 live again?' }),
      ).toBeNull(),
    )
  },
}

export const MakeLiveAgainRefused: Story = {
  args: {
    makeLive: makeLiveAction(async () => {
      throw new globalThis.Error('internal detail that must not be shown')
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /make live again… version 4/i }),
    )
    const region = await canvas.findByRole('region', {
      name: 'Make version 4 live again?',
    })
    await userEvent.click(
      await within(region).findByRole('button', { name: 'Make version 4 live' }),
    )
    // A refusal stays in the confirmation, in words made for the reader, and
    // the choice is still open to try again or cancel.
    await expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    )
    await expect(canvas.queryByText(/internal detail/)).toBeNull()
    await expect(within(region).getByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
}

export const ViewerCannotMakeLive: Story = {
  args: { mayMakeLive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('list', { name: /history, newest first/i })
    await expect(canvas.queryByRole('button', { name: /make live again/i })).toBeNull()
  },
}

export const PageIsOff: Story = {
  args: { pageIsLive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/no version is live/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /make live again/i })).toBeNull()
  },
}

// "View" draws the version's own page: the read is asked for that version, and
// the phone and its filmstrip are the editor preview's, captioned with the version.
export const ViewShowsThePageOfTheVersion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'View version 4' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    const phone = await dialog.findByRole(
      'region',
      {
        name: (name: string) =>
          name.startsWith('Preview of the guest page: Version 4 · Arrival · English'),
      },
      { timeout: 10_000 },
    )
    await expect(within(phone).getByText('How was your experience?')).toBeVisible()
    await expect(getVersionPreviewSpy).toHaveBeenCalledWith({
      data: { portalId: 'portal-1', version: 4 },
    })
    // What the version lists stays beside the page: the addresses are not on it.
    await expect(dialog.getByRole('heading', { name: 'What it lists' })).toBeVisible()
    // Version 4 lists a tile whose address has lapsed: the page leaves it out, and says so.
    await expect(dialog.getByText('Dinner menu')).toBeVisible()
    await expect(
      dialog.getByText(/Tiles whose address is no longer approved/),
    ).toBeVisible()
    // The page is a picture: nothing on it can be tapped from here.
    await expect(phone.querySelector('[inert]')).not.toBeNull()
  },
}

export const ViewShowsAnotherLanguageAndState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'View version 4' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await userEvent.click(
      await dialog.findByRole('radio', { name: /Bulgarian/ }, { timeout: 10_000 }),
    )
    await userEvent.click(
      await dialog.findByRole('button', { name: 'After a 5 star rating' }),
    )
    await expect(
      await dialog.findByRole(
        'region',
        {
          name: (name: string) =>
            name.startsWith(
              'Preview of the guest page: Version 4 · After 5★ · Bulgarian',
            ),
        },
        { timeout: 10_000 },
      ),
    ).toBeVisible()
  },
}

// A version from before the new design cannot be drawn; the words still say what it listed.
export const ViewOfAnEarlierDesignFallsBackToWords: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /^Version 3, published/ }),
    )
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(
      await dialog.findByText('This version uses the earlier design', undefined, {
        timeout: 10_000,
      }),
    ).toBeVisible()
    await expect(await dialog.findByText(/Español/)).toBeVisible()
    await expect(dialog.queryByRole('radio', { name: /Bulgarian/ })).toBeNull()
  },
}
