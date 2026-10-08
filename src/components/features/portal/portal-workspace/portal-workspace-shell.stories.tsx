// The workspace frame with its header and tab strip, in the states the header
// distinguishes: live with changes waiting, live and up to date, live with no
// working code, a draft, the review mode, a viewer who cannot publish, a
// caller without the Results capability, and the way back to where the
// manager came from.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalOpenPageButton } from './portal-open-page-button'
import { PortalWorkspaceHeader } from './portal-workspace-header'
import { PortalWorkspaceShell } from './portal-workspace-shell'
import { PortalWorkspaceTabs } from './portal-workspace-tabs'
import type { Action } from '#/components/hooks/use-action'
import type { PortalShareMutations } from '../portal-share/portal-share-types'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import type { WorkspaceBackTarget } from './portal-workspace-origin'
import type { WorkspaceStatusProblem } from './portal-workspace-status'

const PROPERTY_ID = '0b6f8a52-4c2e-4d61-9a55-2f1d3c7e9b10'
const PORTAL_ID = '7c1e5a90-3b44-4f0d-8e21-6a9d0b2c4f33'

const LIVE_ADDRESS = 'https://app.example.com/p/tok_pool?accessArtifact=artifact-qr-1'
const revealCalls: Array<{ portalId: string; purpose: string }> = []
const revealMutation = Object.assign(
  async (input: {
    data: { portalId: string; purpose: 'download' | 'copy' | 'show' }
  }) => {
    revealCalls.push(input.data)
    return { publicUrl: LIVE_ADDRESS }
  },
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<
  { data: { portalId: string; purpose: 'download' | 'copy' | 'show' } },
  { publicUrl: string }
> as PortalShareMutations['revealMutation']

type FrameProps = Readonly<{
  mode: 'edit' | 'review'
  statusLine: string
  statusProblem?: WorkspaceStatusProblem | null
  pendingNote: string | null
  canReview: boolean
  publishWaiting: boolean
  back?: WorkspaceBackTarget
  activeTab: PortalDetailTab
  activeSection?: PortalEditorSection
  hiddenTabs: ReadonlyArray<PortalDetailTab>
  openPageMode: 'reveal' | 'share' | 'hidden'
}>

function Frame({
  mode,
  statusLine,
  statusProblem,
  pendingNote,
  canReview,
  publishWaiting,
  back,
  activeTab,
  activeSection,
  hiddenTabs,
  openPageMode,
}: FrameProps) {
  return (
    <div className="h-[560px] border">
      <PortalWorkspaceShell
        header={
          <PortalWorkspaceHeader
            mode={mode}
            propertyId={PROPERTY_ID}
            portalId={PORTAL_ID}
            portalName="Pool & Terrace"
            propertyName="Avela Resort"
            statusLine={statusLine}
            statusProblem={statusProblem}
            pendingNote={pendingNote}
            canReview={canReview}
            publishWaiting={publishWaiting}
            back={back}
            activeTab={activeTab}
            activeSection={activeSection}
            saveStatus={<p className="text-xs text-muted-foreground">Draft saved</p>}
            openPage={
              openPageMode === 'hidden' ? null : (
                <PortalOpenPageButton
                  propertyId={PROPERTY_ID}
                  portalId={PORTAL_ID}
                  mode={openPageMode}
                  revealMutation={revealMutation}
                />
              )
            }
          />
        }
        tabs={
          mode === 'review' ? undefined : (
            <PortalWorkspaceTabs
              propertyId={PROPERTY_ID}
              portalId={PORTAL_ID}
              activeTab={activeTab}
              hiddenTabs={hiddenTabs}
            />
          )
        }
      >
        <p className="text-sm text-muted-foreground">The active tab renders here.</p>
      </PortalWorkspaceShell>
    </div>
  )
}

const meta: Meta<typeof Frame> = {
  title: 'Portal/PortalWorkspaceShell',
  component: Frame,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    mode: 'edit',
    statusLine: 'Live · version 5',
    pendingNote: '2 changes not live',
    canReview: true,
    publishWaiting: true,
    activeTab: 'page',
    hiddenTabs: [],
    openPageMode: 'reveal',
  },
}
export default meta
type Story = StoryObj<typeof Frame>

export const LiveWithChangesWaiting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Pool & Terrace' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Live · version 5')).toBeInTheDocument()
    await expect(canvas.getByText('Avela Resort')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Review & publish' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}/review?tab=page`,
    )
    await expect(canvas.getByRole('link', { name: '2 changes not live' })).toBeVisible()
    const tabs = within(canvas.getByRole('navigation', { name: 'Portal sections' }))
    await expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Page',
      'Share',
      'Results',
      'History',
    ])
    await expect(tabs.getByRole('link', { name: 'Page' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(tabs.getByRole('link', { name: 'Share' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

export const DraftNothingWaiting: Story = {
  args: {
    statusLine: 'Draft · not published',
    pendingNote: null,
    openPageMode: 'hidden',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Draft · not published')).toBeInTheDocument()
    await expect(canvas.queryByText(/not live/)).not.toBeInTheDocument()
    // A draft has never been published, so publishing it is the next step.
    await expect(canvas.getByRole('link', { name: 'Review & publish' })).toBeVisible()
  },
}

// Nothing is waiting: the status says so, and the loudest control on the
// screen is not a step that would only say "Nothing to publish".
export const LiveAndUpToDate: Story = {
  args: {
    statusLine: 'Live · version 5 · up to date',
    pendingNote: null,
    publishWaiting: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Live · version 5 · up to date/)).toBeInTheDocument()
    await expect(
      canvas.queryByRole('link', { name: 'Review & publish' }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /^Open live page/ })).toBeVisible()
  },
}

// The list's rule, in the workspace: a live portal guests cannot reach says
// why on its one line, with the way to put it right.
export const LiveWithNoWorkingCode: Story = {
  args: {
    statusLine: 'Live',
    statusProblem: { text: 'no working code', fix: 'share' },
    pendingNote: null,
    publishWaiting: false,
    openPageMode: 'hidden',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'no working code' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}?tab=share`,
    )
    await expect(canvas.queryByRole('button', { name: /^Open live page/ })).toBeNull()
  },
}

// The property is paused: nothing here puts that right, so the problem is
// stated, not linked.
export const LiveButThePropertyIsUnavailable: Story = {
  args: {
    statusLine: 'Live',
    statusProblem: { text: 'property unavailable', fix: null },
    pendingNote: null,
    publishWaiting: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('property unavailable')).toBeVisible()
    await expect(
      canvas.queryByRole('link', { name: 'property unavailable' }),
    ).not.toBeInTheDocument()
  },
}

// Opened from a group page: the way back returns there, by the group's name.
export const BackToTheGroupItCameFrom: Story = {
  args: {
    back: {
      to: `/properties/${PROPERTY_ID}/portals/groups/g-1`,
      label: 'Back to Pool side',
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('link', { name: 'Back to Pool side' }),
    ).toHaveAttribute('href', `/properties/${PROPERTY_ID}/portals/groups/g-1`)
  },
}

// Opened from All properties with a filter on: the way back keeps it.
export const BackToAllPortalsWithItsFilter: Story = {
  args: {
    back: { to: '/portals', search: { show: 'attention' }, label: 'Back to all portals' },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('link', { name: 'Back to all portals' }),
    ).toHaveAttribute('href', '/portals?show=attention')
  },
}

// A tablet: the actions wrap as one group, so "Review & publish" stays beside
// the note it acts on instead of dropping alone under the way back.
export const TabletKeepsThePublishStepWithItsNote: Story = {
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const ShareTabActive: Story = {
  args: { activeTab: 'share' },
  play: async ({ canvasElement }) => {
    const tabs = within(
      within(canvasElement).getByRole('navigation', { name: 'Portal sections' }),
    )
    await expect(tabs.getByRole('link', { name: 'Share' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

export const ReviewLinkKeepsTheTab: Story = {
  args: { activeTab: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Both ways in carry the tab, so "Back to editing" can return to it.
    const review = `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}/review?tab=share`
    await expect(canvas.getByRole('link', { name: 'Review & publish' })).toHaveAttribute(
      'href',
      review,
    )
    await expect(
      canvas.getByRole('link', { name: '2 changes not live' }),
    ).toHaveAttribute('href', review)
  },
}

export const ReviewLinkKeepsTheSection: Story = {
  args: { activeTab: 'page', activeSection: 'linktree' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The section rides along with the tab, so review returns to where the
    // manager was working; a page with no section names none.
    await expect(canvas.getByRole('link', { name: 'Review & publish' })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}/review?tab=page&section=linktree`,
    )
  },
}

export const ShowsTheAutosaveLine: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Draft saved')).toBeInTheDocument()
  },
}

export const ResultsWithheld: Story = {
  args: { hiddenTabs: ['results'] },
  play: async ({ canvasElement }) => {
    const tabs = within(
      within(canvasElement).getByRole('navigation', { name: 'Portal sections' }),
    )
    await expect(tabs.queryByRole('link', { name: 'Results' })).not.toBeInTheDocument()
    await expect(tabs.getAllByRole('link')).toHaveLength(3)
  },
}

export const ViewerWhoCannotPublish: Story = {
  args: { canReview: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('link', { name: 'Review & publish' }),
    ).not.toBeInTheDocument()
    // The note stays, as plain text: it is a fact, not a way in.
    await expect(canvas.getByText('2 changes not live')).toBeInTheDocument()
    await expect(
      canvas.queryByRole('link', { name: '2 changes not live' }),
    ).not.toBeInTheDocument()
  },
}

// The boards put it after the save status and the pending note, right before
// "Review & publish"; a viewer, who has no publish button, still gets it last.
function precedes(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

export const OpenPageSitsBeforeReviewAndPublish: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const saved = canvas.getByText('Draft saved')
    const note = canvas.getByRole('link', { name: '2 changes not live' })
    const open = canvas.getByRole('button', { name: /^Open live page/ })
    const review = canvas.getByRole('link', { name: 'Review & publish' })
    await expect(precedes(saved, note)).toBe(true)
    await expect(precedes(note, open)).toBe(true)
    await expect(precedes(open, review)).toBe(true)
  },
}

export const OpenPageSitsAfterTheNoteForAViewer: Story = {
  args: { canReview: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const note = canvas.getByText('2 changes not live')
    await expect(
      precedes(note, canvas.getByRole('button', { name: /^Open live page/ })),
    ).toBe(true)
  },
}

// The address can be had again: "Open live page" is a button, not a link,
// because it has to fetch the address first. It says "live": the page it opens
// is what guests see, not the draft beside it.
export const OpenPageForALivePortal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByRole('button', { name: /^Open live page/ })
    await expect(open).toBeEnabled()
    await expect(canvas.queryByRole('link', { name: /^Open live page/ })).toBeNull()
    // A new tab opens, and assistive technology is told so.
    await expect(open).toHaveAccessibleName('Open live page (opens in a new tab)')
  },
}

// The tab opens on the click, the address is revealed for the purpose "show",
// and the tab is sent to the bare page address (no scan marker).
export const OpenPageRevealsForShowAndOpensTheBarePage: Story = {
  play: async ({ canvasElement }) => {
    const sent: string[] = []
    const originalOpen = window.open
    window.open = (() => ({
      opener: undefined,
      location: { replace: (url: string) => sent.push(url) },
      close: () => undefined,
    })) as unknown as typeof window.open
    revealCalls.length = 0
    try {
      await userEvent.click(
        within(canvasElement).getByRole('button', { name: /^Open live page/ }),
      )
      await waitFor(() => expect(sent).toHaveLength(1))
    } finally {
      window.open = originalOpen
    }
    await expect(revealCalls).toEqual([{ portalId: PORTAL_ID, purpose: 'show' }])
    await expect(sent).toEqual(['https://app.example.com/p/tok_pool'])
  },
}

// Live, but the code's address cannot be had again (a retired key): the
// control is named for what it does, and leads to Share, where the address is
// shown when the code is replaced.
export const GetPageLinkLeadsToShare: Story = {
  args: { openPageMode: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: 'Get page link' })
    await expect(link).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}?tab=share`,
    )
    await expect(canvas.queryByRole('button', { name: /^Open live page/ })).toBeNull()
  },
}

export const ReviewMode: Story = {
  args: { mode: 'review', activeTab: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Review changes to Pool & Terrace' }),
    ).toBeInTheDocument()
    // The route reads the tab from the review URL's `?tab=`; the way back returns to it.
    await expect(canvas.getByRole('link', { name: /back to editing/i })).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}?tab=share`,
    )
    await expect(
      canvas.queryByRole('navigation', { name: 'Portal sections' }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('link', { name: 'Review & publish' }),
    ).not.toBeInTheDocument()
    // The review is a focused step; the page opens from the editor.
    await expect(canvas.queryByRole('button', { name: /^Open live page/ })).toBeNull()
    await expect(canvas.queryByRole('link', { name: 'Get page link' })).toBeNull()
  },
}
