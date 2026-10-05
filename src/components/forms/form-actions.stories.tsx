// FormActions: the one row a settings group saves from. Dark is the default theme;
// the light variants render the same row on the light surface (axe runs on both).
// The Storybook Vitest project compiles no Tailwind, so the plays pin behaviour (Reset
// shows only while the group holds edits, puts back the SAVED values, hands the focus
// to the group's first field, and a refused save is read above the buttons); the
// right alignment is a class read in a browser.
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Button } from '#/components/ui/button'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { FormActions } from './form-actions'
import { FormTextField, type BaseFieldApi } from './form-text-field'
import { SubmitButton } from './submit-button'
import { submitHandler } from './form-submit'

type Mutation = Readonly<{ isPending: boolean; error: unknown }>
const IDLE: Mutation = { isPending: false, error: null }

/** A group the way the app builds one: the page holds the saved name and keys the form on it. */
function SavedGroup({
  saved,
  onSave,
  mutation = IDLE,
}: Readonly<{
  saved: string
  onSave: (name: string) => Promise<void>
  mutation?: Mutation
}>) {
  const form = useForm({
    defaultValues: { name: saved },
    onSubmit: async ({ value }) => onSave(value.name),
  })
  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form.Field name="name">
            {(field: BaseFieldApi) => (
              <FormTextField field={field} id="group-name" label="Workspace name" />
            )}
          </form.Field>
        </CardContent>
        <CardFooter>
          <FormActions form={form} error={mutation.error} pending={mutation.isPending}>
            <SubmitButton mutation={mutation} form={form}>
              Save profile
            </SubmitButton>
          </FormActions>
        </CardFooter>
      </Card>
    </form>
  )
}

/** The page: a save changes the saved name, which remounts the group on it. */
function Page({ initial = 'Harborline Suites' }: Readonly<{ initial?: string }>) {
  const [saved, setSaved] = useState(initial)
  return (
    <SavedGroup
      key={saved}
      saved={saved}
      onSave={async (name) => {
        setSaved(name)
      }}
    />
  )
}

const meta: Meta<typeof FormActions> = {
  title: 'Patterns/Form actions',
  component: FormActions,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof FormActions>

const NAME = /workspace name/i

/** Nothing edited: the primary alone, and no Reset. */
export const Clean: Story = {
  render: () => <Page />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Save profile' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()
  },
}

export const CleanLight: Story = { ...Clean, parameters: { theme: 'light' } }

/** An edit brings Reset before the primary; Reset puts the saved value back and keeps the focus in the group. */
export const ResetRestoresTheSavedValue: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: NAME })
    await userEvent.clear(name)
    await userEvent.type(name, 'Another name')

    const reset = await canvas.findByRole('button', { name: 'Reset' })
    const buttons = canvas.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Reset', 'Save profile'])
    await userEvent.click(reset)

    expect(name).toHaveValue('Harborline Suites')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
    expect(name).toHaveFocus()
  },
}

export const ResetRestoresTheSavedValueLight: Story = {
  ...ResetRestoresTheSavedValue,
  parameters: { theme: 'light' },
}

/** After a save the saved value is the new one: no Reset, and a later Reset returns to it, not to the first. */
export const AfterASaveResetReturnsToWhatWasSaved: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    let name = canvas.getByRole('textbox', { name: NAME })
    await userEvent.clear(name)
    await userEvent.type(name, 'Harborline Suites & Spa')
    await userEvent.click(canvas.getByRole('button', { name: 'Save profile' }))

    // The page holds the new name and mounts the group on it: clean again.
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
    name = canvas.getByRole('textbox', { name: NAME })
    expect(name).toHaveValue('Harborline Suites & Spa')

    await userEvent.type(name, ' (draft)')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))

    expect(name).toHaveValue('Harborline Suites & Spa')
  },
}

/** A save the server refused: the banner is directly above the buttons, and Reset (the edits are gone) clears it. */
export const RefusedSave: Story = {
  render: () => (
    <SavedGroup
      saved="Harborline Suites"
      onSave={async () => undefined}
      mutation={{
        isPending: false,
        error: new ServerFunctionError(
          'ValidationError',
          'Another workspace already uses that name',
          'name_taken',
          409,
        ),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')
    expect(alert).toHaveTextContent('Another workspace already uses that name')
    const actions = canvasElement.querySelector('[data-slot="form-actions"]')
    expect(actions?.firstElementChild).toBe(alert)
    expect(alert.nextElementSibling).toContainElement(
      canvas.getByRole('button', { name: 'Save profile' }),
    )

    await userEvent.type(canvas.getByRole('textbox', { name: NAME }), ' II')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))

    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

export const RefusedSaveLight: Story = {
  ...RefusedSave,
  parameters: { theme: 'light' },
}

/** While the save runs the primary is busy and Reset waits. */
export const Saving: Story = {
  render: () => (
    <SavedGroup
      saved="Harborline Suites"
      onSave={async () => undefined}
      mutation={{ isPending: true, error: null }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: NAME }), ' II')
    expect(await canvas.findByRole('button', { name: 'Reset' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Save profile' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
}

/** A group that keeps its own state says what is dirty and what Reset does. */
function ChoiceGroup() {
  const saved = ['avery']
  const [chosen, setChosen] = useState(saved)
  const dirty = chosen.join() !== saved.join()
  return (
    <div className="space-y-3 rounded-lg border p-4">
      {['avery', 'jordan'].map((id) => (
        <label key={id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={chosen.includes(id)}
            onCheckedChange={(next) =>
              setChosen((current) =>
                next === true ? [...current, id] : current.filter((x) => x !== id),
              )
            }
          />
          {id}
        </label>
      ))}
      <FormActions dirty={dirty} onReset={() => setChosen(saved)}>
        <Button disabled={!dirty}>Save responsible managers</Button>
      </FormActions>
    </div>
  )
}

export const OfAGroupThatKeepsItsOwnState: Story = {
  render: () => <ChoiceGroup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull()

    await userEvent.click(canvas.getByRole('checkbox', { name: 'jordan' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))

    expect(canvas.getByRole('checkbox', { name: 'jordan' })).not.toBeChecked()
    expect(canvas.getByRole('checkbox', { name: 'avery' })).toBeChecked()
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).toBeNull(),
    )
    expect(canvas.getByRole('checkbox', { name: 'avery' })).toHaveFocus()
  },
}

export const OfAGroupThatKeepsItsOwnStateLight: Story = {
  ...OfAGroupThatKeepsItsOwnState,
  parameters: { theme: 'light' },
}
