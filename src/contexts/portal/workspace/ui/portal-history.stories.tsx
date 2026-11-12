// fallow-ignore-file code-duplication
// The History tab (board 08): the ledger beside the Versions rail, and making
// an earlier version live again. The harness mounts the real tab parts over
// reads that answer from fixed data (or do not answer, or are refused), so every
// story is the real view in the state its reads put it in.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { portalKeys } from '#/shared/queries/query-keys'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { HistoryFilterKey } from './portal-history-rows'
import {
  STORY_ENTRIES,
  STORY_LIVE_4_DETAILS,
  STORY_LIVE_4_VERSIONS,
  STORY_NOW,
  STORY_PENDING_CHANGES,
  STORY_PORTAL_NAME,
  STORY_TIME_ZONE,
  STORY_VERSION_DETAILS,
  STORY_VERSIONS,
  storyHistoryFor,
  storyPublicationHistory,
} from './__fixtures__/portal-history-stories-data'
import {
  PortalHistoryProvider,
  type HistorySelection,
  type MakeVersionLiveAction,
  type PortalHistoryReads,
} from './portal-history-context'
import { PortalHistoryView } from './portal-history-view'
import { storyVersionPreview } from './__fixtures__/portal-version-preview-stories-data'

type HarnessProps = Readonly<{
  entriesState?: 'loading' | 'error' | 'ready'
  versionsLoaded?: boolean
  versionsFailed?: boolean
  canMakeLive?: boolean
  /** The page is off: no version can be made live. */
  pageIsOff?: boolean
  pendingChanges?: number
  initialFilter?: HistoryFilterKey
  initialSelection?: HistorySelection
  detailStatus?: 'loading' | 'error' | 'ready'
  /** Confirming is refused with this sentence. */
  refusal?: string
  /** The restore request is in flight. */
  submitting?: boolean
  entries?: typeof STORY_ENTRIES
  /** Version 4 was made live again after version 5; the draft is still on 5. */
  afterRestore?: boolean
  /** Confirming succeeds: the confirmation closes, as the tab does. */
  confirmSucceeds?: boolean
  /** The dialog draws the version's page (it reads for itself). */
  withPagePreview?: boolean
  onConfirm?: (version: number) => void
}>

const PORTAL_ID = 'portal-1'

/** A read that has not answered. */
const never = () => new Promise<never>(() => {})

/** A read the server refused, as the browser receives it. */
const failure = (message: string) =>
  Object.assign(new Error(message), { _tag: 'Refused', code: 'refused', status: 409 })

const asRead = <T,>(read: unknown) => read as T

// fallow-ignore-next-line complexity
function Harness({
  entriesState = 'ready',
  versionsLoaded = true,
  versionsFailed = false,
  canMakeLive = true,
  pageIsOff = false,
  pendingChanges = STORY_PENDING_CHANGES,
  initialFilter = 'all',
  initialSelection,
  detailStatus = 'ready',
  refusal,
  submitting = false,
  entries,
  afterRestore = false,
  confirmSucceeds = false,
  withPagePreview = false,
  onConfirm = fn(),
}: HarnessProps) {
  const versions = afterRestore ? STORY_LIVE_4_VERSIONS : STORY_VERSIONS
  const details = afterRestore ? STORY_LIVE_4_DETAILS : STORY_VERSION_DETAILS
  const queryClient = useQueryClient()
  // What a read has already answered is in the cache when the tab mounts, so a
  // story starts on the state it names; a read that has not (or will not) answer
  // is the story's loading or failed state.
  useState(() => {
    if (entriesState === 'ready') {
      queryClient.setQueryData(portalKeys.historyFor(PORTAL_ID, initialFilter), {
        pages: [{ entries: entries ?? storyHistoryFor(initialFilter), nextCursor: null }],
        pageParams: [undefined],
      })
    }
    if (versionsLoaded && !versionsFailed) {
      queryClient.setQueryData(portalKeys.versions(PORTAL_ID), versions)
    }
    queryClient.setQueryData(
      portalKeys.publicationHistory(PORTAL_ID),
      storyPublicationHistory(pendingChanges),
    )
    if (detailStatus === 'ready') {
      for (const [version, detail] of Object.entries(details)) {
        queryClient.setQueryData(portalKeys.version(PORTAL_ID, Number(version)), detail)
      }
    }
  })
  const [reads] = useState<PortalHistoryReads>(() => ({
    getHistory: asRead<PortalHistoryReads['getHistory']>(
      async (input: { data: { filter: string } }) => {
        if (entriesState === 'loading') return never()
        if (entriesState === 'error') throw new Error('not read')
        return {
          entries: entries ?? storyHistoryFor(input.data.filter),
          nextCursor: null,
        }
      },
    ),
    getVersions: asRead<PortalHistoryReads['getVersions']>(async () => {
      if (versionsFailed) throw new Error('not read')
      return versionsLoaded ? versions : never()
    }),
    getVersion: asRead<PortalHistoryReads['getVersion']>(
      async (input: { data: { version: number } }) => {
        if (detailStatus === 'loading') return never()
        if (detailStatus === 'error') throw new Error('not read')
        return details[input.data.version]
      },
    ),
    getPublicationHistory: asRead<PortalHistoryReads['getPublicationHistory']>(async () =>
      storyPublicationHistory(pendingChanges),
    ),
    ...(withPagePreview
      ? {
          getVersionPreview: asRead<PortalHistoryReads['getVersionPreview']>(
            async (input: { data: { version: number } }) =>
              storyVersionPreview(input.data.version),
          ),
        }
      : {}),
  }))
  const [makeLive] = useState<MakeVersionLiveAction>(() =>
    Object.assign(
      async (input: { data: { portalId: string; version: number } }) => {
        onConfirm(input.data.version)
        if (refusal !== undefined) throw failure(refusal)
        return confirmSucceeds ? {} : never()
      },
      { isPending: submitting, error: null as unknown, isSuccess: false, data: null },
    ),
  )
  return (
    <PortalHistoryProvider
      portalId={PORTAL_ID}
      portalName={STORY_PORTAL_NAME}
      timeZone={STORY_TIME_ZONE}
      mayMakeLive={canMakeLive}
      pageIsLive={!pageIsOff}
      reads={reads}
      makeLive={makeLive}
      now={STORY_NOW}
      initial={{
        filter: initialFilter,
        ...(initialSelection ? { selection: initialSelection } : {}),
      }}
    >
      <PortalHistoryView />
    </PortalHistoryProvider>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Portal/PortalHistory',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof Harness>

// All: edits that went into a version fold under its publish line, and the
// oldest versions fold into one line.
export const All: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ledger = within(canvas.getByRole('list', { name: /history, newest first/i }))
    await expect(
      ledger.getAllByText('Elena Petrova', { selector: 'b' }).length,
    ).toBeGreaterThan(0)
    await expect(ledger.getByText('the Spanish welcome line')).toBeInTheDocument()
    await expect(ledger.getByText('version 5')).toBeInTheDocument()
    await expect(ledger.getByText(/Live now/)).toBeInTheDocument()
    await expect(ledger.getAllByText(/In draft/)).toHaveLength(2)
    // Folded under version 5 and 4, not listed on their own.
    await expect(ledger.queryByText('‘Getting here’', { selector: 'b' })).toBeNull()
    await expect(ledger.getByText(/3 earlier versions/)).toBeInTheDocument()
    await expect(ledger.getByText(/Health:/)).toBeInTheDocument()
  },
}

export const ShowEarlierVersions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /show 3 earlier versions/i }),
    )
    await expect(
      canvas.queryByRole('button', { name: /show 3 earlier versions/i }),
    ).toBeNull()
    await expect(canvas.getByText('version 1')).toBeInTheDocument()
    // The row that held focus is gone: focus moves to the first line it revealed.
    await expect(canvas.getByRole('button', { name: 'View version 3' })).toHaveFocus()
  },
}

export const PublishingFilter: Story = {
  args: { initialFilter: 'publishing' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'Publishing' })).toBeChecked()
    const ledger = within(canvas.getByRole('list', { name: /history, newest first/i }))
    await expect(ledger.getAllByText(/^version \d$/)).toHaveLength(5)
    await expect(ledger.queryByText(/created/)).toBeNull()
    await expect(ledger.queryByText(/earlier versions/)).toBeNull()
  },
}

export const PageEditsFilter: Story = {
  args: { initialFilter: 'edits' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ledger = within(canvas.getByRole('list', { name: /history, newest first/i }))
    await expect(ledger.getAllByText(/published in version 5/)).toHaveLength(2)
    await expect(ledger.getByText(/published in version 4/)).toBeInTheDocument()
    await expect(ledger.getAllByText(/In draft/)).toHaveLength(2)
  },
}

export const CodesFilter: Story = {
  args: { initialFilter: 'codes' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/downloaded the code again/)).toBeInTheDocument()
    await expect(canvas.getByText(/copied the NFC address/)).toBeInTheDocument()
  },
}

// Board 08's open confirmation, under the version 4 line.
export const MakeLiveAgainOpen: Story = {
  args: { initialSelection: { version: 4, mode: 'restore', host: 'row' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const confirmation = within(
      canvas.getByRole('region', { name: 'Make version 4 live again?' }),
    )
    await expect(confirmation.getByText('Linktree')).toBeInTheDocument()
    await expect(confirmation.getByText(/‘Getting here’ goes away/)).toBeInTheDocument()
    await expect(
      confirmation.getByText(/goes away; German guests see English/),
    ).toBeInTheDocument()
    await expect(confirmation.getByText('Printed codes keep working')).toBeInTheDocument()
    await expect(
      confirmation.getByText('Your draft keeps its 2 changes'),
    ).toBeInTheDocument()
    await expect(
      confirmation.getByText(/makes it version 6 and brings back what version 5 added/),
    ).toBeInTheDocument()
    await expect(
      confirmation.getByRole('button', { name: 'Make version 4 live' }),
    ).toBeEnabled()
  },
}

const confirmSpy = fn()
export const MakeLiveAgainFlow: Story = {
  args: { onConfirm: confirmSpy },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /make live again… version 4/i }),
    )
    const region = canvas.getByRole('region', { name: 'Make version 4 live again?' })
    await userEvent.click(
      within(region).getByRole('button', { name: 'Make version 4 live' }),
    )
    await expect(confirmSpy).toHaveBeenCalledWith(4)
    await userEvent.click(within(region).getByRole('button', { name: 'Cancel' }))
    await expect(
      canvas.queryByRole('region', { name: 'Make version 4 live again?' }),
    ).toBeNull()
  },
}

// Making version 4 live again closes the confirmation; focus lands on that
// line's View (its "Make live again…" is still there only until the refetch),
// and a polite status says so.
export const MakeLiveAgainDone: Story = {
  args: { confirmSucceeds: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /make live again… version 4/i }),
    )
    const region = canvas.getByRole('region', { name: 'Make version 4 live again?' })
    await userEvent.click(
      within(region).getByRole('button', { name: 'Make version 4 live' }),
    )
    await waitFor(() =>
      expect(
        canvas.queryByRole('region', { name: 'Make version 4 live again?' }),
      ).toBeNull(),
    )
    await expect(canvas.getByRole('button', { name: 'View version 4' })).toHaveFocus()
    await expect(canvas.getByRole('status')).toHaveTextContent('Version 4 is live again.')
  },
}

// Version 4 is live after an earlier restore, and the draft still holds
// version 5. Going further back, publishing the draft brings version 5 back.
export const MakeLiveAgainAfterRestore: Story = {
  args: {
    afterRestore: true,
    // Publishing shows every version on its own line; All folds the older ones.
    initialFilter: 'publishing',
    initialSelection: { version: 3, mode: 'restore', host: 'row' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const confirmation = within(
      canvas.getByRole('region', { name: 'Make version 3 live again?' }),
    )
    await expect(
      confirmation.getByText(
        /makes it version 6 and brings back version 5 with the draft's changes/,
      ),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Based on version 5')).toBeInTheDocument()
  },
}

// A later version made live again reads as what it brings, not what comes back.
export const MakeLaterVersionLive: Story = {
  args: {
    afterRestore: true,
    initialFilter: 'publishing',
    initialSelection: { version: 5, mode: 'restore', host: 'row' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const confirmation = within(
      canvas.getByRole('region', { name: 'Make version 5 live again?' }),
    )
    await expect(confirmation.getByText('Deutsch').closest('li')).toHaveTextContent(
      'Deutsch is added',
    )
    await expect(confirmation.getByText(/‘Getting here’ is added/)).toBeInTheDocument()
    await expect(confirmation.queryByText(/comes back/)).toBeNull()
    await expect(confirmation.getByText(/makes it version 6\./)).toBeInTheDocument()
  },
}

export const MakeLiveAgainFailed: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'row' },
    refusal: 'Only a currently published Portal can make another version live again',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Make version 4 live' }),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      /currently published/,
    )
  },
}

// The confirmation in the dialog holds it open while the request runs: Escape is
// refused, so the refusal banner always has the surface it appears on.
export const MakeLiveAgainDialogHeldWhileSubmitting: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'dialog' },
    submitting: true,
  },
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    await expect(
      within(dialog).getByRole('button', { name: /making it live/i }),
    ).toBeDisabled()
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect(body.getByRole('dialog')).toBeInTheDocument()
  },
}

// Once the request has settled (here: it was refused) Escape closes it again.
export const MakeLiveAgainDialogClosesWhenIdle: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'dialog' },
    refusal: 'Only a currently published Portal can make another version live again',
  },
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Make version 4 live' }),
    )
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /currently published/,
    )
    await userEvent.keyboard('{Escape}')
    await expect(body.queryByRole('dialog')).toBeNull()
  },
}

export const CheckingWhatWouldChange: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'row' },
    detailStatus: 'loading',
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/checking what would change/i),
    ).toBeInTheDocument()
  },
}

/** The check failed: the same Try again as everywhere, and a way out beside it. */
export const CheckingFailed: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'row' },
    detailStatus: 'error',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'What would change couldn’t be checked.',
    )
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

// A rail tile opens the version for reading; from there it can be made live.
export const ViewVersionFromRail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Version 3, published Jul 14 by Georgi Ivanov',
      }),
    )
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.getByRole('heading', { name: 'Version 3' })).toBeInTheDocument()
    await expect(dialog.getByText(/Español/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Make live again…' }))
    await expect(
      await within(document.body).findByText('Make version 3 live again?'),
    ).toBeInTheDocument()
  },
}

// "View" with the page beside what the version lists (the metrics file measures it).
export const ViewVersionWithPage: Story = {
  args: {
    initialSelection: { version: 4, mode: 'view', host: 'dialog' },
    withPagePreview: true,
  },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(
      await dialog.findByRole('region', { name: 'Version 4 as guests see it' }),
    ).toBeInTheDocument()
    await expect(
      await dialog.findByRole(
        'region',
        {
          name: (name: string) => name.startsWith('Preview of the guest page: Version 4'),
        },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    await expect(
      dialog.getByRole('button', { name: 'Make live again…' }),
    ).toBeInTheDocument()
  },
}

export const LiveVersionHasNoRestore: Story = {
  args: { initialSelection: { version: 5, mode: 'view', host: 'dialog' } },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.getByText(/live now/)).toBeInTheDocument()
    await expect(dialog.queryByRole('button', { name: 'Make live again…' })).toBeNull()
  },
}

// A viewer without portal.update, or a page that is off, sees no restore at all.
export const ReadOnly: Story = {
  args: { canMakeLive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /make live again/i })).toBeNull()
    await expect(
      canvas.getAllByRole('button', { name: /^View version/ }).length,
    ).toBeGreaterThan(0)
  },
}

export const PageIsOff: Story = {
  args: { pageIsOff: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/no version is live/i),
    ).toBeInTheDocument()
  },
}

/** Nothing waiting: the draft matches the live version, so no edit is still in draft. */
export const NoDraftChanges: Story = {
  args: {
    pendingChanges: 0,
    entries: STORY_ENTRIES.slice(
      STORY_ENTRIES.findIndex((entry) => entry.detail.kind === 'version_published'),
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('No changes waiting'),
    ).toBeInTheDocument()
    await expect(within(canvasElement).queryByText('In draft')).toBeNull()
  },
}

export const Loading: Story = {
  args: { entriesState: 'loading', versionsLoaded: false },
}

export const LoadFailed: Story = {
  args: { entriesState: 'error', versionsLoaded: false, versionsFailed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('alert')).toHaveLength(2))
    // The ledger and the rail each offer the one recovery.
    await expect(canvas.getAllByRole('button', { name: 'Try again' })).toHaveLength(2)
  },
}

export const EmptyFilter: Story = {
  args: { entries: [], initialFilter: 'codes' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/no code has been made or downloaded yet/i),
    ).toBeInTheDocument()
  },
}

// Phone: the rail stacks under the ledger, actions stay reachable without hover.
export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}
