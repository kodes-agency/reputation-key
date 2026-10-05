// The shared field anatomy: a label (with its Optional marker), the control, a line of
// help and the error, in that order. The text, textarea and number fields share it, so
// they read as one field. Dark is the default theme; the light variants render the same
// fields on the light surface (axe runs on both). The Storybook Vitest project compiles
// no Tailwind, so the plays pin structure and wiring (the label names the control, the
// help is the control's description, the error follows the help), not colours.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { FormNumberField } from './form-number-field'
import { FormTextField, type BaseFieldApi } from './form-text-field'
import { FormTextarea, type BaseFieldApiTextarea } from './form-textarea'

const clean = { isTouched: false, isValid: true, errors: [] }
const refused = {
  isTouched: true,
  isValid: false,
  errors: [{ message: 'Use 100 characters or fewer' }],
}

const text = (
  value: string,
  meta: BaseFieldApi['state']['meta'] = clean,
): BaseFieldApi => ({
  name: 'field',
  state: { value, meta },
  handleBlur: () => undefined,
  handleChange: () => undefined,
})

const textarea = (
  value: string,
  meta: BaseFieldApiTextarea['state']['meta'] = clean,
): BaseFieldApiTextarea => ({
  name: 'field',
  state: { value, meta },
  handleBlur: () => undefined,
  handleChange: () => undefined,
})

function Fields({ invalid = false }: Readonly<{ invalid?: boolean }>) {
  return (
    <div className="grid max-w-md gap-6">
      <FormTextField
        field={text('Harborline Suites', invalid ? refused : clean)}
        id="field-name"
        label="Workspace name"
        description="The name your team sees."
      />
      <FormTextarea
        field={textarea('', invalid ? refused : clean)}
        id="field-note"
        label="Note"
        optional
        description="For your management record."
      />
      <FormNumberField
        id="field-hours"
        label="Hours"
        min={1}
        max={720}
        optional
        description="Between 1 and 720."
        field={{
          state: { value: 24, meta: { errors: invalid ? refused.errors : [] } },
          handleBlur: () => undefined,
          handleChange: () => undefined,
        }}
      />
    </div>
  )
}

const meta: Meta<typeof Fields> = {
  title: 'Patterns/Form field',
  component: Fields,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof Fields>

/** The label names the control, Optional is inside the label, the help is the control's description. */
export const Anatomy: Story = {
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Workspace name' })
    expect(name).toHaveAccessibleDescription('The name your team sees.')

    const note = canvas.getByRole('textbox', { name: 'Note Optional' })
    expect(note).toHaveAccessibleDescription('For your management record.')

    const hours = canvas.getByRole('spinbutton', { name: 'Hours Optional' })
    expect(hours).toHaveAccessibleDescription('Between 1 and 720.')

    // A field that is required says nothing: only the optional one is marked.
    expect(canvas.getAllByText('Optional')).toHaveLength(2)
  },
}

export const AnatomyLight: Story = { ...Anatomy, parameters: { theme: 'light' } }

/** The error follows the help, so the help stays where the eye left it. */
export const Refused: Story = {
  args: { invalid: true },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Workspace name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')

    const help = canvas.getByText('The name your team sees.')
    const alert = within(name.closest('[data-slot="field"]') as HTMLElement).getByRole(
      'alert',
    )
    expect(alert).toHaveTextContent('Use 100 characters or fewer')
    expect(
      help.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
  render: (args) => <Fields {...args} />,
}

export const RefusedLight: Story = { ...Refused, parameters: { theme: 'light' } }
