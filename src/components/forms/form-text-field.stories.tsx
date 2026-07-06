// Storybook stories for the shared FormTextField form primitive.
// Composes TanStack Form's field shape with the shadcn Field/Input primitives.
// Covers default (labeled), with-value, invalid (FieldError via aria-invalid +
// role=alert), disabled, and an editable state driven by a stateful wrapper.

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { FormTextField, type BaseFieldApi } from './form-text-field'

const meta: Meta<typeof FormTextField> = {
  title: 'Forms/FormTextField',
  component: FormTextField,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FormTextField>

// Static (uncontrolled-by-story) field factory for non-interactive stories.
function staticField(
  over: Partial<BaseFieldApi> & Pick<BaseFieldApi, 'name'>,
): BaseFieldApi {
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
    field: staticField({ name: 'username' }),
    label: 'Username',
    id: 'username',
    placeholder: 'Enter username',
  },
}

export const WithValue: Story = {
  args: {
    field: staticField({
      name: 'username',
      state: {
        value: 'jane.doe',
        meta: { isTouched: false, isValid: true, errors: [] },
      },
    }),
    label: 'Username',
    id: 'username',
    placeholder: 'Enter username',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /username/i })).toHaveValue(
      'jane.doe',
    )
  },
}

export const Invalid: Story = {
  args: {
    field: staticField({
      name: 'email',
      state: {
        value: 'not-an-email',
        meta: {
          isTouched: true,
          isValid: false,
          errors: [{ message: 'Enter a valid email address' }],
        },
      },
    }),
    label: 'Email',
    id: 'email',
    placeholder: 'you@example.com',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /email/i })
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    // FieldError renders the message inside role="alert"
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent(/enter a valid email address/i)
  },
}

export const Disabled: Story = {
  args: {
    field: staticField({
      name: 'username',
      state: {
        value: 'locked-value',
        meta: { isTouched: false, isValid: true, errors: [] },
      },
    }),
    label: 'Username',
    id: 'username',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /username/i })).toBeDisabled()
  },
}

// Stateful wrapper that wires field.handleChange/handleBlur to React state, so
// the Editable story can drive real typing via the play function.
function StatefulFormTextField({
  name = 'username',
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
  const [isTouched, setIsTouched] = useState(false)
  const field: BaseFieldApi = {
    name,
    state: {
      value,
      meta: {
        isTouched,
        isValid: true,
        errors: [],
      },
    },
    handleBlur: () => setIsTouched(true),
    handleChange: setValue,
  }
  return <FormTextField field={field} label={label} id={id} placeholder={placeholder} />
}

export const Editable: Story = {
  args: {
    field: staticField({ name: 'username' }),
    label: 'Username',
    id: 'username',
    placeholder: 'Enter username',
  },
  render: (args) => (
    <StatefulFormTextField
      name={args.id}
      label={args.label}
      id={args.id}
      placeholder={args.placeholder}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /username/i })
    await userEvent.type(input, 'jane')
    await expect(input).toHaveValue('jane')
  },
}
