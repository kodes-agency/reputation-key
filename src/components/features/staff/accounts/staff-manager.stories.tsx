import {
  StaffManagerStory,
  staffStoryResults,
} from '../../../../../.storybook/staff-manager-fixtures'
import { indexOverviewResults } from '#/components/features/portal/portal-overview/portal-overview-results'
import { usePortalSectionFolds } from '#/components/features/portal/portal-overview/use-portal-section-folds'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
import { StaffAccountsList, StaffAddAction } from './staff-accounts-list'
import { StaffRemoveDialog } from './staff-member-actions'
import { PortalOverviewTable } from '#/components/features/portal/portal-overview/portal-overview-table'
import { buildPortalOverview } from '#/components/features/portal/portal-overview/portal-overview-view'
import {
  overviewGroup,
  overviewRow,
} from '#/components/features/portal/portal-overview/portal-overview-fixtures'
import { action } from '#/components/features/portal/portal-list-page-stories-data'
import type { PortalArchiveMutations } from '#/components/features/portal/portal-overview/portal-archive-dialog'
const members = ['Ana Jones', 'Bob Smith', 'Li May', 'Zoe Park'].map(
  (displayName, i) => ({
    displayName,
    email: `${displayName.toLowerCase().replace(' ', '.')}@harbor.example`,
    participationId: `person-${i}`,
    portalId: `portal-${i}`,
    operationId: null,
    access: i === 3 ? ('invited' as const) : ('active' as const),
    step: null,
    code: null,
    endsSignIn: i === 0,
  }),
)
const group = overviewGroup('reception', 'Reception')
const mutation: PortalArchiveMutations['archiveMutation'] = action()
function Scene({
  scene,
  width = 1440,
}: Readonly<{ scene: 'group' | 'other' | 'staff' | 'remove'; width?: number }>) {
  const { folded, toggleSection } = usePortalSectionFolds()
  const rows = members.map((member) =>
    overviewRow(member.portalId, {
      kind: 'personal',
      name: member.displayName,
      group: scene === 'other' ? null : group,
    }),
  )
  const overview = buildPortalOverview(
    [overviewRow('place', { name: 'Front desk card', group }), ...rows],
    {},
    [],
    99,
    undefined,
    [],
    folded,
  )
  return (
    <StaffManagerStory members={members}>
      <div style={{ width, maxWidth: '100%' }}>
        {scene === 'remove' ? (
          <StaffRemoveDialog
            member={members[0]!}
            open
            onOpenChange={fn()}
            onConfirm={async () => undefined}
          />
        ) : scene === 'staff' ? (
          <>
            <StaffAddAction />
            <StaffAccountsList />
          </>
        ) : (
          <PortalOverviewTable
            folded={folded}
            onToggleSection={toggleSection}
            sections={overview.sections}
            propertyId="prop-1"
            propertyName="Harbor Hotel"
            results={{
              status: 'ready',
              index: indexOverviewResults(staffStoryResults()),
            }}
            archiveMutation={mutation}
            restoreMutation={action()}
          />
        )}
      </div>
    </StaffManagerStory>
  )
}
const meta = {
  title: 'Staff/Manager',
  component: Scene,
  args: { scene: 'group', width: 1440 },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Scene>
export default meta
type Story = StoryObj<typeof meta>
export const GroupFolded: Story = {
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    expect(ui.queryByRole('button', { name: 'Ana Jones' })).toBeNull()
    expect(ui.getByText(/1 portal · 4 people/)).toBeVisible()
  },
}
export const GroupOpen: Story = {
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    await userEvent.click(ui.getByRole('button', { name: /Portals in Reception/i }))
    await expect(ui.getByRole('button', { name: 'Ana Jones' })).toBeVisible()
    expect(ui.getByText('Invited, not signed in yet')).toBeVisible()
  },
}
export const OtherStaff: Story = {
  args: { scene: 'other' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Other staff')).toBeVisible()
  },
}
export const StaffPage: Story = {
  args: { scene: 'staff' },
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    expect(ui.getByText('Ana Jones')).toBeVisible()
    expect(
      ui.getByRole('switch', { name: "Show staff each other's scans" }),
    ).not.toBeChecked()
  },
}
export const Remove: Story = {
  args: { scene: 'remove' },
  play: async () => {
    const ui = within(await screen.findByRole('alertdialog'))
    expect(ui.getByText('Remove Ana Jones?')).toBeVisible()
    expect(ui.getByText(/Their sign-in ends/)).toBeVisible()
  },
}
export const Narrow320: Story = { ...GroupOpen, args: { width: 320 } }
export const Phone375: Story = { ...GroupOpen, args: { width: 375 } }
export const Tablet768: Story = { ...GroupOpen, args: { width: 768 } }
export const Desktop1440: Story = { ...GroupOpen, args: { width: 1440 } }

export const PersonSheetFromPortal: Story = {
  args: { scene: 'group' },
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement)
    await userEvent.click(ui.getByRole('button', { name: /Portals in Reception/i }))
    await userEvent.click(ui.getByRole('button', { name: 'Ana Jones' }))
    await expect(await screen.findByRole('dialog', { name: 'Ana Jones' })).toBeVisible()
  },
}
