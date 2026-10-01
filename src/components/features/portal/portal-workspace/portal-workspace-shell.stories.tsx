// The workspace frame with its header and tab strip, in the states the header
// distinguishes: live with changes waiting, a draft, the review mode, a viewer
// who cannot publish, and a caller without the Results capability.
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
  pendingNote: string | null
  canReview: boolean
  activeTab: PortalDetailTab
  activeSection?: PortalEditorSection
  hiddenTabs: ReadonlyArray<PortalDetailTab>
  openPageMode: 'reveal' | 'share'
}>

function Frame({
  mode,
  statusLine,
  pendingNote,
  canReview,
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
            pendingNote={pendingNote}
            canReview={canReview}
            activeTab={activeTab}
            activeSection={activeSection}
            saveStatus={<p className="text-xs text-muted-foreground">Draft saved</p>}
            openPage={
              <PortalOpenPageButton
                propertyId={PROPERTY_ID}
                portalId={PORTAL_ID}
                mode={openPageMode}
                revealMutation={revealMutation}
              />
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
  args: { statusLine: 'Draft · not published', pendingNote: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Draft · not published')).toBeInTheDocument()
    await expect(canvas.queryByText(/not live/)).not.toBeInTheDocument()
  },
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
    const open = canvas.getByRole('button', { name: /^Open page/ })
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
    await expect(precedes(note, canvas.getByRole('button', { name: /^Open page/ }))).toBe(
      true,
    )
  },
}

// The address can be had again: "Open page" is a button, not a link, because it
// has to fetch the address first.
export const OpenPageForALivePortal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Open page/ })).toBeEnabled()
    await expect(canvas.queryByRole('link', { name: /^Open page/ })).toBeNull()
    // A new tab opens, and assistive technology is told so.
    await expect(canvas.getByRole('button', { name: /^Open page/ })).toHaveAccessibleName(
      'Open page (opens in a new tab)',
    )
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
        within(canvasElement).getByRole('button', { name: /^Open page/ }),
      )
      await waitFor(() => expect(sent).toHaveLength(1))
    } finally {
      window.open = originalOpen
    }
    await expect(revealCalls).toEqual([{ portalId: PORTAL_ID, purpose: 'show' }])
    await expect(sent).toEqual(['https://app.example.com/p/tok_pool'])
  },
}

// Not live, no live code, or a retired key: there is nothing to reveal, so the
// control leads to Share, where the address is shown or made.
export const OpenPageLeadsToShareWhenItCannotReveal: Story = {
  args: { openPageMode: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: /^Open page/ })
    await expect(link).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/portals/${PORTAL_ID}?tab=share`,
    )
    // It stays in the app, so it says where it goes rather than promising a new tab.
    await expect(link).toHaveAccessibleName('Open page: get its address in Share')
    await expect(canvas.queryByRole('button', { name: /^Open page/ })).toBeNull()
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
    await expect(canvas.queryByRole('button', { name: /^Open page/ })).toBeNull()
    await expect(canvas.queryByRole('link', { name: /^Open page/ })).toBeNull()
  },
}
