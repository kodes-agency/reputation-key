// The workspace frame with its header and tab strip, in the states the header
// distinguishes: live with changes waiting, a draft, the review mode, a viewer
// who cannot publish, and a caller without the Results capability.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalWorkspaceHeader } from './portal-workspace-header'
import { PortalWorkspaceShell } from './portal-workspace-shell'
import { PortalWorkspaceTabs } from './portal-workspace-tabs'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'

const PROPERTY_ID = '0b6f8a52-4c2e-4d61-9a55-2f1d3c7e9b10'
const PORTAL_ID = '7c1e5a90-3b44-4f0d-8e21-6a9d0b2c4f33'

type FrameProps = Readonly<{
  mode: 'edit' | 'review'
  statusLine: string
  pendingNote: string | null
  canReview: boolean
  activeTab: PortalDetailTab
  hiddenTabs: ReadonlyArray<PortalDetailTab>
}>

function Frame({
  mode,
  statusLine,
  pendingNote,
  canReview,
  activeTab,
  hiddenTabs,
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
  },
}
