import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { StaffAddForm, type StaffAddFormProps } from './staff-add-form'
import { newStaffRow } from './staff-batch'
const check: NonNullable<StaffAddFormProps['check']> = async ({ data }) => ({
  rows: data.rows.map(() => ({ code: 'ok' as const })),
  code: null,
  omittedLinks: [],
  remainingInvitations: 20,
  invitationsRequired: data.rows.length,
})
const add = fn<NonNullable<StaffAddFormProps['add']>>(async ({ data }) => ({
  operationId: data.operationId,
  participationId: 'person',
  portalId: 'portal',
  status: 'done',
  step: 'access',
  code: null,
  access: 'invited',
}))
function Scene(props: StaffAddFormProps) {
  return (
    <Dialog open>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
        </DialogHeader>
        <StaffAddForm {...props} />
      </DialogContent>
    </Dialog>
  )
}
const meta = {
  title: 'Staff/Add staff',
  component: Scene,
  args: {
    propertyId: 'property',
    portals: [{ id: 'portal', name: 'Reception' }],
    groups: [{ id: 'group', name: 'Front desk' }],
    check,
    add,
  },
  parameters: {
    layout: 'fullscreen',
    viewport: {
      viewports: {
        narrow: { name: '320', styles: { width: '320px', height: '900px' } },
        phone: { name: '375', styles: { width: '375px', height: '900px' } },
        tablet: { name: '768', styles: { width: '768px', height: '900px' } },
        desktop: { name: '1440', styles: { width: '1440px', height: '900px' } },
      },
    },
  },
} satisfies Meta<typeof Scene>
export default meta
type Story = StoryObj<typeof meta>
export const OneRow: Story = {
  play: async () => {
    const ui = within(await screen.findByRole('dialog'))
    expect(ui.getAllByLabelText('Name')).toHaveLength(1)
    expect(ui.queryByRole('button', { name: 'Remove person 1' })).toBeNull()
    await userEvent.type(ui.getByLabelText('Name'), 'Ana')
    await userEvent.type(ui.getByLabelText('Email'), 'ana@example.com')
    await userEvent.click(ui.getByRole('button', { name: 'Add' }))
    await expect(await ui.findByText('Invited')).toBeVisible()
  },
}
export const Several: Story = {
  args: {
    initialRows: [
      { ...newStaffRow('ana'), displayName: 'Ana', email: 'ana@example.com' },
      { ...newStaffRow('bob'), displayName: 'Bob', email: 'bob@example.com' },
      { ...newStaffRow('zoe'), displayName: 'Zoe', email: 'zoe@example.com' },
    ],
  },
  play: async () => {
    const ui = within(await screen.findByRole('dialog'))
    expect(ui.getAllByLabelText('Name')).toHaveLength(3)
    await userEvent.click(ui.getByRole('button', { name: 'Add' }))
    await expect(await ui.findAllByText('Invited')).toHaveLength(3)
  },
}
export const Failure: Story = {
  args: {
    initialRows: [
      {
        ...newStaffRow('same-operation'),
        displayName: 'Bob',
        email: 'bob@example.com',
        state: 'failed',
        problem: "Setup didn't finish. Try again.",
      },
    ],
  },
  play: async () => {
    const ui = within(await screen.findByRole('dialog'))
    await userEvent.click(ui.getByRole('button', { name: 'Try again' }))
    await expect(await ui.findByText('Invited')).toBeVisible()
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operationId: 'same-operation' }),
      }),
    )
  },
}
export const Budget: Story = {
  args: {
    check: async ({ data }) => ({ ...(await check({ data })), remainingInvitations: 0 }),
    initialRows: [
      { ...newStaffRow('budget'), displayName: 'Ana', email: 'ana@example.com' },
    ],
  },
  play: async () => {
    const ui = within(await screen.findByRole('dialog'))
    await userEvent.click(ui.getByRole('button', { name: 'Add' }))
    await expect(await ui.findByText(/Only 0 invitations remain/)).toBeVisible()
    expect(ui.getByLabelText('Name')).toBeEnabled()
  },
}
export const Narrow320: Story = {
  ...OneRow,
  globals: { viewport: { value: 'narrow', isRotated: false } },
}
export const Phone375: Story = {
  ...OneRow,
  globals: { viewport: { value: 'phone', isRotated: false } },
}
export const Tablet768: Story = {
  ...Several,
  globals: { viewport: { value: 'tablet', isRotated: false } },
}
export const Desktop1440: Story = {
  ...Several,
  globals: { viewport: { value: 'desktop', isRotated: false } },
}
