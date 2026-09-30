// "New Organization" (ADR 0063): the dialog, its validation, the slug that
// follows the name, and the two ways it ends. The dialog renders in a portal,
// so each play function reads from the document body.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { CreateOrganizationDialog } from './create-organization-dialog'
import { makeAction } from './platform-console-stories-data'

const created = {
  organizationId: 'org-new',
  slug: 'hotel-riviera',
  invitationId: 'inv-new',
  emailSent: true,
}

const provisionSpy = fn(async (_input: unknown) => created)

const meta: Meta<typeof CreateOrganizationDialog> = {
  title: 'Platform/CreateOrganizationDialog',
  component: CreateOrganizationDialog,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { provision: makeAction(provisionSpy) },
}
export default meta
type Story = StoryObj<typeof CreateOrganizationDialog>

const body = () => within(document.body)

async function openDialog(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /new organization/i }),
  )
  return within(await body().findByRole('dialog'))
}

export const Closed: Story = {}

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.getByRole('heading', { name: 'New Organization' })).toBeVisible()
    expect(dialog.getByLabelText('Organization name')).toBeVisible()
    expect(dialog.getByLabelText('Slug')).toHaveValue('')
    expect(dialog.getByLabelText("First Account Admin's email")).toBeVisible()
  },
}

export const OpenLight: Story = {
  parameters: { theme: 'light' },
  play: Open.play,
}

export const SlugFollowsTheName: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    const name = dialog.getByLabelText('Organization name')
    const slug = dialog.getByLabelText('Slug')

    await userEvent.type(name, 'Hotel Riviera & Spa')
    expect(slug).toHaveValue('hotel-riviera-spa')

    // Once the operator edits the slug, the name stops rewriting it.
    await userEvent.clear(slug)
    await userEvent.type(slug, 'riviera')
    await userEvent.type(name, ' Group')
    expect(slug).toHaveValue('riviera')
  },
}

export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => {
    provisionSpy.mockClear()
    const dialog = await openDialog(canvasElement)
    await userEvent.click(
      dialog.getByRole('button', { name: /create and send invitation/i }),
    )
    expect(
      await dialog.findByText(/organization name must be at least 2 characters/i),
    ).toBeVisible()
    expect(dialog.getByText(/a valid email address is required/i)).toBeVisible()
    expect(provisionSpy).not.toHaveBeenCalled()
  },
}

export const CreatesAndSendsInvitation: Story = {
  play: async ({ canvasElement }) => {
    provisionSpy.mockClear()
    const dialog = await openDialog(canvasElement)
    await userEvent.type(dialog.getByLabelText('Organization name'), 'Hotel Riviera')
    await userEvent.type(
      dialog.getByLabelText("First Account Admin's email"),
      'Owner@Riviera.Example',
    )
    await userEvent.click(
      dialog.getByRole('button', { name: /create and send invitation/i }),
    )

    await waitFor(() =>
      expect(provisionSpy).toHaveBeenCalledWith({
        data: {
          name: 'Hotel Riviera',
          slug: 'hotel-riviera',
          adminEmail: 'Owner@Riviera.Example',
        },
      }),
    )
    // The result names the address the invitation went to, as the server stored it.
    expect(
      await dialog.findByRole('heading', { name: 'Organization created' }),
    ).toBeVisible()
    expect(dialog.getByText('owner@riviera.example')).toBeVisible()
    expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible()
  },
}

export const EmailCouldNotBeSent: Story = {
  args: {
    provision: makeAction(async () => ({ ...created, emailSent: false })),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.type(dialog.getByLabelText('Organization name'), 'Hotel Riviera')
    await userEvent.type(
      dialog.getByLabelText("First Account Admin's email"),
      'owner@riviera.example',
    )
    await userEvent.click(
      dialog.getByRole('button', { name: /create and send invitation/i }),
    )

    expect(await dialog.findByText(/could not be sent/i)).toBeVisible()
    expect(dialog.getByText(/use resend/i)).toBeVisible()
  },
}

export const Refused: Story = {
  args: {
    provision: makeAction(async () => {
      throw new Error('That email already belongs to another Organization.')
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.type(dialog.getByLabelText('Organization name'), 'Hotel Riviera')
    await userEvent.type(
      dialog.getByLabelText("First Account Admin's email"),
      'taken@example.com',
    )
    await userEvent.click(
      dialog.getByRole('button', { name: /create and send invitation/i }),
    )

    expect(
      await dialog.findByText(/already belongs to another organization/i),
    ).toBeVisible()
    // The form stays, filled in, so the operator can change the address and retry.
    expect(dialog.getByLabelText('Organization name')).toHaveValue('Hotel Riviera')
  },
}
