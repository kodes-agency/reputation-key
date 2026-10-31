// The controller as the shell runs it: both reads, the one attempt to open by
// itself, and what closing does. The server calls are the .storybook stubs, whose
// shapes are the real server functions'; the slim banner is stood in for by the
// query its route reads, which is the cache entry the modal empties on close.
import type { Meta, StoryObj } from '@storybook/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import { merchantAiNoticeUpdateQuery } from '#/components/features/settings/merchant-ai-notice-update-query'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import {
  aiNoticeStoryState,
  storyAiNoticeUpdate,
} from '../../../../.storybook/stubs/merchant-ai-notice-updates-server'
import {
  productUpdatesStoryClient,
  productUpdatesStoryState,
} from '../../../../.storybook/stubs/product-updates-server'
import ProductUpdatesController from './product-updates-controller'

const ORGANIZATION = 'story-organization'
const getClient = async () => productUpdatesStoryClient
const getAiClient = async () => productUpdatesStoryClient.aiNoticeUpdate

/** What the stand-in banner says about the shared entry. */
function bannerLabel({ isPending, data }: { isPending: boolean; data?: unknown }) {
  if (isPending) return 'Reading the update'
  return data ? 'The banner waits' : 'The banner is gone'
}

/**
 * The controller beside a stand-in for the slim banner. One person per render:
 * the opening is attempted once per person and session. A manager has no banner
 * (the shell mounts it only for `ai.manage`), so `readBanner` is off for them.
 */
function ShellWithTheController({
  readBanner = true,
}: Readonly<{ readBanner?: boolean }>) {
  const [userId] = useState(() => `story-${crypto.randomUUID()}`)
  const banner = useQuery({
    ...merchantAiNoticeUpdateQuery({ userId, organizationId: ORGANIZATION }, getAiClient),
    enabled: readBanner,
  })
  return (
    <>
      <p>{bannerLabel(banner)}</p>
      <ProductUpdatesController
        userId={userId}
        organizationId={ORGANIZATION}
        getClient={getClient}
      />
    </>
  )
}

type Arrangement = Readonly<{
  /** "Show updates automatically". */
  autoShow: boolean
  /** The server's weekly rule: an unseen highlight, and a week since the last opening. */
  weeklyDue: boolean
  /** The AccountAdmin has an AI update they have not seen. */
  aiPending: boolean
}>

/** Sets the stubs, and makes the headless page count as focused, as a person's tab is. */
function arrange({ autoShow, weeklyDue, aiPending }: Arrangement) {
  const updates = productUpdatesStoryState
  updates.view = {
    entries: PRODUCT_UPDATES,
    unseenIds: weeklyDue ? PRODUCT_UPDATES.map(({ id }) => id) : [],
    autoShow,
    shouldAutoOpen: weeklyDue,
  }
  Object.assign(updates, { reads: 0, claims: 0, claimWins: true })
  Object.assign(aiNoticeStoryState, { pending: aiPending, marked: [], reads: 0 })
  const focus = spyOn(document, 'hasFocus').mockReturnValue(true)
  return () => focus.mockRestore()
}

const meta = {
  title: 'Product updates/Controller',
  component: ShellWithTheController,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ShellWithTheController>
export default meta
type Story = StoryObj<typeof meta>

/** Both reads have been answered and the screen has had its chance to react. */
async function afterBothReads(page: ReturnType<typeof within>) {
  await waitFor(() => expect(productUpdatesStoryState.reads).toBeGreaterThan(0))
  await waitFor(() => expect(aiNoticeStoryState.reads).toBeGreaterThan(0))
  await waitFor(() => expect(page.queryByText('Reading the update')).toBeNull())
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  )
}

export const AiUpdateOpensItByItself: Story = {
  beforeEach: () => arrange({ autoShow: true, weeklyDue: false, aiPending: true }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const ai = await page.findByRole('region', { name: 'AI update' })
    await expect(ai).toBeVisible()
    await expect(
      within(ai).getByRole('heading', { name: storyAiNoticeUpdate.title }),
    ).toBeVisible()
    // Inside the weekly window: no claim is made, and nothing older pads the modal.
    expect(productUpdatesStoryState.claims).toBe(0)
    expect(page.queryByRole('link', { name: /Show me/ })).toBeNull()
    expect(page.getByText('The banner waits')).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    // Closing marks the update seen on the server and empties the entry the banner reads.
    await waitFor(() =>
      expect(aiNoticeStoryState.marked).toEqual([
        {
          noticeVersion: storyAiNoticeUpdate.noticeVersion,
          noticeDigest: storyAiNoticeUpdate.noticeDigest,
        },
      ]),
    )
    await waitFor(() => expect(page.getByText('The banner is gone')).toBeVisible())
  },
}

export const WithTheWeeklyUpdatesBeneathIt: Story = {
  beforeEach: () => arrange({ autoShow: true, weeklyDue: true, aiPending: true }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const ai = await page.findByRole('region', { name: 'AI update' })
    // The weekly rule is due as well, so the week is claimed on the server once.
    expect(productUpdatesStoryState.claims).toBe(1)
    await expect(page.getAllByRole('link', { name: /Show me/ }).length).toBeGreaterThan(0)
    const [firstHighlight] = page.getAllByRole('article')
    expect(
      ai.compareDocumentPosition(firstHighlight!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await userEvent.click(page.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(aiNoticeStoryState.marked).toHaveLength(1))
  },
}

export const SwitchOffKeepsTheModalClosed: Story = {
  beforeEach: () => arrange({ autoShow: false, weeklyDue: false, aiPending: true }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await afterBothReads(page)
    // The banner stays their way in; the modal does not open by itself.
    expect(page.queryByRole('dialog')).toBeNull()
    expect(productUpdatesStoryState.claims).toBe(0)
    await expect(page.getByText('The banner waits')).toBeVisible()
  },
}

export const NothingToTellKeepsItClosed: Story = {
  beforeEach: () => arrange({ autoShow: true, weeklyDue: false, aiPending: false }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await afterBothReads(page)
    expect(page.queryByRole('dialog')).toBeNull()
  },
}

export const ManagersAreNeverAskedForIt: Story = {
  args: { readBanner: false },
  decorators: [withRole('PropertyManager')],
  beforeEach: () => arrange({ autoShow: true, weeklyDue: false, aiPending: true }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(productUpdatesStoryState.reads).toBeGreaterThan(0))
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    )
    expect(page.queryByRole('dialog')).toBeNull()
    expect(aiNoticeStoryState.reads).toBe(0)
  },
}
