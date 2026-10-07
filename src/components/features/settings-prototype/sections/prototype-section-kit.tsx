// PROTOTYPE — the small parts every section is made of: the section heading, a
// locked notice, labelled fields wired to a fake form, and the save row. Real ui
// primitives throughout, so a section looks like the product.
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { FormActions } from '#/components/forms/form-actions'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { PrototypeForm } from './use-prototype-form'
import type { SettingsPrototypeContext } from '../settings-prototype-types'

export type SectionProps = Readonly<{ ctx: SettingsPrototypeContext }>

/** The heading a variant may draw itself (`bare`) or leave to the section. */
export function SectionHeading({
  title,
  description,
}: Readonly<{ title: string; description?: string }>) {
  return (
    <header className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  )
}

/** A read-only section: the lock and who to ask (one rule: lock when it constrains the work). */
export function LockedNotice({
  ctx,
  what,
}: Readonly<{ ctx: SettingsPrototypeContext; what: string }>) {
  return (
    <Alert variant="info">
      <AlertTitle>Read only for managers</AlertTitle>
      <AlertDescription>
        {what} Ask {ctx.data.workspace.adminName} to change it.
      </AlertDescription>
    </Alert>
  )
}

export function TextRow({
  id,
  label,
  value,
  onChange,
  description,
  disabled = false,
  type = 'text',
  optional = false,
}: Readonly<{
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  description?: ReactNode
  disabled?: boolean
  type?: 'text' | 'email' | 'number'
  optional?: boolean
}>) {
  return (
    <FormFieldFrame
      id={id}
      label={label}
      description={description}
      invalid={false}
      optional={optional}
    >
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormFieldFrame>
  )
}

export function SelectRow({
  id,
  label,
  value,
  options,
  onChange,
  description,
  disabled = false,
}: Readonly<{
  id: string
  label: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  description?: ReactNode
  disabled?: boolean
}>) {
  return (
    <FormFieldFrame id={id} label={label} description={description} invalid={false}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormFieldFrame>
  )
}

/** Reset (while dirty) and Save, the way every settings group ends; Save is a fake. */
export function SaveRow<T extends Readonly<Record<string, string | number | boolean>>>({
  form,
  label = 'Save',
  disabled = false,
}: Readonly<{ form: PrototypeForm<T>; label?: string; disabled?: boolean }>) {
  return (
    <FormActions
      dirty={form.dirty}
      onReset={form.reset}
      leading={
        form.savedText ? (
          <p role="status" className="text-sm text-muted-foreground">
            {form.savedText}
          </p>
        ) : null
      }
    >
      <Button
        type="button"
        pending={form.status === 'saving'}
        disabled={disabled}
        onClick={form.save}
      >
        {label}
      </Button>
    </FormActions>
  )
}
