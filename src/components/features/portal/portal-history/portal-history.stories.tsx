// The History tab (board 08): the ledger beside the Versions rail, and making
// an earlier version live again. The harness holds the state the tab holds
// (filter, what is open) over fixed data, so every story is the real view.

import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { buildHistoryRows, type HistoryFilterKey } from './portal-history-rows'
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
} from './__fixtures__/portal-history-stories-data'
import { PortalHistoryView, type HistorySelection } from './portal-history-view'

type HarnessProps = Readonly<{
  entriesState?: 'loading' | 'error' | 'ready'
  versionsLoaded?: boolean
  versionsFailed?: boolean
  canMakeLive?: boolean
  pendingChanges?: number
  initialFilter?: HistoryFilterKey
  initialSelection?: HistorySelection | null
  detailStatus?: 'loading' | 'error' | 'ready'
  restoreError?: string | null
  entries?: typeof STORY_ENTRIES
  note?: string | null
  /** Version 4 was made live again after version 5; the draft is still on 5. */
  afterRestore?: boolean
  /** Confirming succeeds: the confirmation closes, as the tab does. */
  confirmSucceeds?: boolean
  onConfirm?: (version: number) => void
}>

function Harness({
  entriesState = 'ready',
  versionsLoaded = true,
  versionsFailed = false,
  canMakeLive = true,
  pendingChanges = STORY_PENDING_CHANGES,
  initialFilter = 'all',
  initialSelection = null,
  detailStatus = 'ready',
  restoreError = null,
  entries,
  note = null,
  afterRestore = false,
  confirmSucceeds = false,
  onConfirm = fn(),
}: HarnessProps) {
  const [filter, setFilter] = useState<HistoryFilterKey>(initialFilter)
  const [selection, setSelection] = useState<HistorySelection | null>(initialSelection)
  const [showEarlier, setShowEarlier] = useState(false)
  const [revealedVersion, setRevealedVersion] = useState<number | null>(null)
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null)
  const versions = versionsLoaded
    ? afterRestore
      ? STORY_LIVE_4_VERSIONS
      : STORY_VERSIONS
    : null
  const details = afterRestore ? STORY_LIVE_4_DETAILS : STORY_VERSION_DETAILS
  const rows = useMemo(
    () =>
      buildHistoryRows({
        entries: entries ?? storyHistoryFor(filter),
        versions,
        filter,
        showEarlier,
      }),
    [entries, filter, versions, showEarlier],
  )
  return (
    <PortalHistoryView
      portalName={STORY_PORTAL_NAME}
      now={STORY_NOW}
      timeZone={STORY_TIME_ZONE}
      filter={filter}
      onFilterChange={(next) => {
        setFilter(next)
        setSelection(null)
      }}
      rows={rows}
      entriesState={entriesState}
      hasMore={false}
      loadingMore={false}
      onLoadMore={fn()}
      onRetry={fn()}
      onShowEarlier={(firstVersion) => {
        setRevealedVersion(firstVersion)
        setShowEarlier(true)
      }}
      revealedVersion={revealedVersion}
      restoredVersion={restoredVersion}
      announcement={
        restoredVersion === null ? null : `Version ${restoredVersion} is live again.`
      }
      versions={versions}
      versionsFailed={versionsFailed}
      pendingChangeCount={pendingChanges}
      canMakeLive={canMakeLive}
      note={note}
      selection={selection}
      detail={{
        status: detailStatus,
        detail: selection ? (details[selection.version] ?? null) : null,
        retry: fn(),
      }}
      submitting={false}
      restoreError={restoreError}
      onSelect={setSelection}
      onConfirmRestore={(version) => {
        onConfirm(version)
        if (!confirmSucceeds) return
        setRestoredVersion(version)
        setSelection(null)
      }}
    />
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
    await expect(
      canvas.queryByRole('region', { name: 'Make version 4 live again?' }),
    ).toBeNull()
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
    restoreError: 'Only a currently published Portal can make another version live again',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      /currently published/,
    )
  },
}

export const CheckingWhatWouldChange: Story = {
  args: {
    initialSelection: { version: 4, mode: 'restore', host: 'row' },
    detailStatus: 'loading',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/checking what would change/i),
    ).toBeInTheDocument()
  },
}

// A rail tile opens the version for reading; from there it can be made live.
export const ViewVersionFromRail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Version 3, published 14 Jul by Georgi Ivanov',
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
  args: {
    canMakeLive: false,
    note: 'No version is live while the page is off. Turn it on from Review & publish to make a version live again.',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/no version is live/i),
    ).toBeInTheDocument()
  },
}

export const NoDraftChanges: Story = {
  args: { pendingChanges: 0 },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('No changes waiting'),
    ).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { entriesState: 'loading', versionsLoaded: false },
}

export const LoadFailed: Story = {
  args: { entriesState: 'error', versionsLoaded: false, versionsFailed: true },
  play: async ({ canvasElement }) => {
    const alerts = within(canvasElement).getAllByRole('alert')
    await expect(alerts).toHaveLength(2)
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
