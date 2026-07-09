// Storybook stories for the shared FormTextarea form primitive.
// Mirrors FormTextField for multiline fields: composes TanStack Form's field
// shape with the shadcn Field/Textarea primitives. Covers default (labeled),
// with-value, invalid (FieldError via aria-invalid + role=alert), disabled, and
// an editable state driven by a stateful wrapper so the play fn can type.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { FormTextarea, type BaseFieldApiTextarea } from './form-textarea'

const meta: Meta<typeof FormTextarea> = {
  title: 'Forms/FormTextarea',
  component: FormTextarea,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FormTextarea>

// Static (uncontrolled-by-story) field factory for non-interactive stories.
function staticField(
  over: Partial<BaseFieldApiTextarea> & Pick<BaseFieldApiTextarea, 'name'>,
): BaseFieldApiTextarea {
  return {
    name: over.name,
    state: over.state ?? {
      value: '',
      meta: { isTouched: false, isValid: true, errors: [] },
    },
    handleBlur: over.handleBlur ?? (() => {}),
    handleChange: over.handleChange ?? (() => {}),
  }
}

export const Default: Story = {
  args: {
    field: staticField({ name: 'bio' }),
    label: 'Bio',
    id: 'bio',
    placeholder: 'Tell us about yourself',
  },
}

export const WithValue: Story = {
  args: {
    field: staticField({
      name: 'bio',
      state: {
        value: 'Frontend engineer who likes small, correct diffs.',
        meta: { isTouched: false, isValid: true, errors: [] },
      },
    }),
    label: 'Bio',
    id: 'bio',
    placeholder: 'Tell us about yourself',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /bio/i })).toHaveValue(
      'Frontend engineer who likes small, correct diffs.',
    )
  },
}

export const Invalid: Story = {
  args: {
    field: staticField({
      name: 'bio',
      state: {
        value: 'x',
        meta: {
          isTouched: true,
          isValid: false,
          errors: [{ message: 'Bio must be at least 10 characters' }],
        },
      },
    }),
    label: 'Bio',
    id: 'bio',
    placeholder: 'Tell us about yourself',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /bio/i })
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    // FieldError renders the message inside role="alert"
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent(/bio must be at least 10 characters/i)
  },
}

export const Disabled: Story = {
  args: {
    field: staticField({
      name: 'bio',
      state: {
        value: 'locked-value',
        meta: { isTouched: false, isValid: true, errors: [] },
      },
    }),
    label: 'Bio',
    id: 'bio',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /bio/i })).toBeDisabled()
  },
}

// Stateful wrapper that wires field.handleChange/handleBlur to React state, so
// the Editable story can drive real typing via the play function.
function StatefulFormTextarea({
  name = 'bio',
  label,
  id,
  placeholder,
  initialValue = '',
}: Readonly<{
  name?: string
  label: string
  id: string
  placeholder?: string
  initialValue?: string
}>) {
  const [value, setValue] = useState(initialValue)
  const [touched, setTouched] = useState(false)
  return (
    <FormTextarea
      field={{
        name,
        state: { value, meta: { isTouched: touched, isValid: true, errors: [] } },
        handleBlur: () => setTouched(true),
        handleChange: (v: string) => setValue(v),
      }}
      label={label}
      id={id}
      placeholder={placeholder}
    />
  )
}

export const Editable: Story = {
  render: () => (
    <StatefulFormTextarea label="Bio" id="bio" placeholder="Tell us about yourself" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByRole('textbox', { name: /bio/i })
    await userEvent.type(textarea, 'Hello world')
    await expect(textarea).toHaveValue('Hello world')
  },
}
