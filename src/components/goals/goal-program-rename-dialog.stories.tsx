// "Edit name" on a goal's page: its name and description, changed in place.
// Nothing about the target, the subjects or a month moves, so the dialog asks
// for no note and saves at once.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { renameGoalProgram } from '#/contexts/reporting/server/goal-program-details'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import { GoalProgramRenameDialog } from './goal-program-rename-dialog'
import { openGoalProgramDialog } from './goal-program.stories.dialog'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'

type RenameInput = Parameters<typeof renameGoalProgram>[0]

const renameMock = fn(async (input: RenameInput) => ({
  id: PROGRAM_ID,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  name: input.data.name,
  description: input.data.description ?? null,
  status: 'active' as const,
  statusReason: null,
  currentVersion: 1,
  createdBy: 'manager-1',
  createdAt: new Date('2026-02-20T08:00:00.000Z'),
  updatedAt: new Date('2026-03-20T12:00:00.000Z'),
}))
const renameGoalProgramFn = renameMock as unknown as typeof renameGoalProgram

const meta: Meta<typeof GoalProgramRenameDialog> = {
  title: 'Goals/GoalProgramRenameDialog',
  component: GoalProgramRenameDialog,
  decorators: [ToasterDecorator],
  args: {
    renameGoalProgramFn,
    propertyId: PROPERTY_ID,
    programId: PROGRAM_ID,
    name: 'Monthly ratings',
    description: 'Front desk and lobby',
  },
}

export default meta
type Story = StoryObj<typeof meta>

const SAYS_WHAT_STAYS = /target, subjects and results stay as they are/i

const open = (canvasElement: HTMLElement) =>
  openGoalProgramDialog(canvasElement, 'Edit name', SAYS_WHAT_STAYS)

/** The dialog opens on what the goal is called now, saves the new words and closes. */
export const SavesTheNewName: Story = {
  play: async ({ canvasElement }) => {
    renameMock.mockClear()
    const dialog = await open(canvasElement)
    const name = dialog.getByRole('textbox', { name: 'Name' })
    const description = dialog.getByRole('textbox', { name: 'Description Optional' })
    expect(name).toHaveValue('Monthly ratings')
    expect(description).toHaveValue('Front desk and lobby')

    await userEvent.clear(name)
    await userEvent.type(name, '  Lobby ratings ')
    await userEvent.clear(description)
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          programId: PROGRAM_ID,
          name: 'Lobby ratings',
          description: null,
        },
      }),
    )
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
    // Retried, not asserted once: the toast is in the page before it has faded in.
    await waitFor(() =>
      expect(within(document.body).getByText('Goal details saved')).toBeVisible(),
    )
  },
}

/**
 * An edit of the name alone leaves the description out, so the goal keeps the
 * one it has now: another manager may have changed it since the dialog opened.
 */
export const ANameOnlyEditLeavesTheDescriptionOut: Story = {
  play: async ({ canvasElement }) => {
    renameMock.mockClear()
    const dialog = await open(canvasElement)
    const name = dialog.getByRole('textbox', { name: 'Name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Lobby ratings')
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith({
        data: { propertyId: PROPERTY_ID, programId: PROGRAM_ID, name: 'Lobby ratings' },
      }),
    )
  },
}

/** Saving what the goal already says writes nothing and closes. */
export const AnUnchangedSaveSendsNothing: Story = {
  play: async ({ canvasElement }) => {
    renameMock.mockClear()
    const dialog = await open(canvasElement)

    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(renameMock).not.toHaveBeenCalled()
  },
}

/** A goal needs a name: the save waits for one. */
export const NeedsAName: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)

    await userEvent.clear(dialog.getByRole('textbox', { name: 'Name' }))

    expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  },
}

/** A refusal stays in the dialog as a sentence, never as the command's code. */
export const SaysARefusalInWords: Story = {
  play: async ({ canvasElement }) => {
    renameMock.mockClear()
    renameMock.mockRejectedValueOnce(
      new ServerFunctionError(
        'GoalProgramError',
        'invalid_transition',
        'invalid_transition',
        409,
      ),
    )
    const dialog = await open(canvasElement)
    const name = dialog.getByRole('textbox', { name: 'Name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Lobby ratings')
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This goal’s status no longer allows that. Reload the page to see where it stands.',
    )
    expect(dialog.queryByText(/invalid_transition/)).toBeNull()
    expect(name).toHaveValue('Lobby ratings')
  },
}
