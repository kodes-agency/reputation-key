// The `e` shortcut against the page it is bound on — the one place the key and
// the Escalate button it mirrors are both real.
//
// Why a page-level story and not only the handler's unit test. The handler
// (`use-inbox-keyboard-shortcuts.ts`) takes `escalation.isAllowed` as given;
// what can be wrong is how `use-inbox-page.ts` COMPUTES it, and that is a hook
// the node unit project cannot render. Plan v2.1 row 5 moved Escalate / Resolve
// from the header — which renders in every branch of the detail pane — into
// the case toolbar, which renders only once the detail has loaded
// (`inbox-detail-panel.tsx:52`). Until review caught it, the key still fired
// from a pane showing skeletons or `Failed to load detail`, with no escalation
// control anywhere on screen. These stories mount `InboxPageV2` itself, open an
// item through `search.itemId`, hold its detail query in each branch, and press
// the key.
//
// The keypress is a real `KeyboardEvent` dispatched on `document.body`, from
// where it bubbles to the page's `window` listener. The assertion is
// `defaultPrevented`: `runEscalation` calls `preventDefault` exactly when it
// issues a command and never otherwise, and the listener runs synchronously
// inside `dispatchEvent` — so "nothing happened" is read the moment the
// dispatch returns, with no wait for a command that might still arrive. The
// ready story is the control: the same press, on the same page, once the
// toolbar is up, does issue `escalate` — so the two refusals are not passing
// because the key is not wired at all.
//
// Desktop only, which is also the only width the key is bound at
// (`handleInboxShortcut` returns early on mobile); a story with no viewport
// parameter runs at 1200 x 900 (`inbox-page.stories.tsx:445-455`).
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, waitFor, within } from 'storybook/test'
import { InboxPageV2 } from './inbox-page-v2'
import {
  createInboxContainer,
  inboxTestIds,
  makeInboxItem,
} from '../../../.storybook/in-memory/inbox-container'
import { makeInboxFns } from '../../../.storybook/in-memory/inbox-fns'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar'
import type { InboxCtx } from './inbox-types'
import type { InboxPageNav } from './use-inbox-page'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxServerFns } from './types'

const ITEM_ID = 'esc-shortcut-1'

const container = createInboxContainer()
container.seed([makeInboxItem({ id: ITEM_ID, sourceType: 'review', status: 'open' })])

const ctx: InboxCtx = { activeOrganization: { id: String(inboxTestIds.ORG) } }

/**
 * Never settles: a command that resolved would run the page's success path
 * (cache writes, a toast) for a fake result. The press is what is under test,
 * not what the server does with it.
 */
const escalateInboxItem = fn(() => new Promise<never>(() => {}))
const resolveEscalation = fn(() => new Promise<never>(() => {}))

type DetailBranch = 'loading' | 'failed' | 'ready'

type DetailFn = InboxServerFns['getInboxItemDetail']

/** First open of an uncached item, held there: the query never settles. */
const neverLoads = (() => new Promise<never>(() => {})) as unknown as DetailFn

/** The preview's QueryClient has `retry: false`, so one rejection is the error branch. */
const failsToLoad = (() =>
  Promise.reject(new Error('detail unavailable'))) as unknown as DetailFn

/** The container's own fns, with the detail query held in one branch. */
function fnsFor(branch: DetailBranch): InboxServerFns {
  const base = makeInboxFns(container)
  const spies = {
    escalateInboxItem:
      escalateInboxItem as unknown as InboxServerFns['escalateInboxItem'],
    resolveEscalation:
      resolveEscalation as unknown as InboxServerFns['resolveEscalation'],
  }
  if (branch === 'ready') return { ...base, ...spies }
  const getInboxItemDetail = branch === 'loading' ? neverLoads : failsToLoad
  return { ...base, ...spies, getInboxItemDetail }
}

/**
 * Holds `search` the way the router does, starting with the item already
 * selected, so the pane opens without a click that would move focus.
 */
function ShortcutHarness({ branch }: Readonly<{ branch: DetailBranch }>) {
  const [search, setSearch] = useState<InboxSearchParams>({ itemId: ITEM_ID })
  const [inboxFns] = useState(() => fnsFor(branch))
  const onNavigate: InboxPageNav = (o) =>
    setSearch((previous) => ({ ...previous, ...o.search(previous) }))
  return (
    <InboxPageV2
      ctx={ctx}
      search={search}
      onNavigate={onNavigate}
      inboxFns={inboxFns}
      recordInboxVisit={false}
    />
  )
}

const meta: Meta<typeof ShortcutHarness> = {
  title: 'Inbox/Escalation Shortcut',
  component: ShortcutHarness,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-dvh min-h-[800px] w-full bg-background text-foreground">
        <SidebarProvider>
          <SidebarInset>
            <Story />
          </SidebarInset>
        </SidebarProvider>
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof ShortcutHarness>

/** Presses `e` with nothing focused; returns whether the page acted on it. */
function pressE(): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'e',
    bubbles: true,
    cancelable: true,
  })
  document.body.dispatchEvent(event)
  return event.defaultPrevented
}

function resetSpies(): void {
  escalateInboxItem.mockClear()
  resolveEscalation.mockClear()
}

/**
 * First open of an uncached item: the header is up, the body is skeletons, and
 * there is no case toolbar — so no Escalate button, and the key must not stand
 * in for one.
 */
export const DetailLoading: Story = {
  args: { branch: 'loading' },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Close detail' })
    await expect(canvas.queryByRole('region', { name: 'Case status' })).toBeNull()

    await expect(pressE()).toBe(false)
    await expect(escalateInboxItem).not.toHaveBeenCalled()
    await expect(resolveEscalation).not.toHaveBeenCalled()
  },
}

/** The detail failed: `Retry` in place of the content, and again no toolbar. */
export const DetailFailed: Story = {
  args: { branch: 'failed' },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Retry' })
    await expect(canvas.queryByRole('region', { name: 'Case status' })).toBeNull()

    await expect(pressE()).toBe(false)
    await expect(escalateInboxItem).not.toHaveBeenCalled()
  },
}

/**
 * The control: the detail loaded, the toolbar shows `Escalate`, and the same
 * press issues the command with the item's revision fence.
 */
export const DetailReady: Story = {
  args: { branch: 'ready' },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)
    const toolbar = await canvas.findByRole('region', { name: 'Case status' })
    await within(toolbar).findByRole('button', { name: 'Escalate' })

    await expect(pressE()).toBe(true)
    await waitFor(() => expect(escalateInboxItem).toHaveBeenCalledTimes(1))
    await expect(escalateInboxItem).toHaveBeenCalledWith({
      data: expect.objectContaining({ inboxItemId: ITEM_ID }),
    })
    await expect(resolveEscalation).not.toHaveBeenCalled()
  },
}
