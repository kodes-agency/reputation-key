import type { ReactNode } from 'react'
import { Field, FieldLabel } from '#/components/ui/field'
import { Switch } from '#/components/ui/switch'

type Props = Readonly<{
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  propertyCount: number
  disabled?: boolean
  /** One override row per property, shown while the answer is not shared. */
  children: ReactNode
}>

/**
 * Decision 2: a multi-property import answers each question once. The switch
 * applies that answer to every property; turning it off lists the properties
 * so each can take its own.
 */
export function ApplyToAllToggle({
  id,
  checked,
  onCheckedChange,
  propertyCount,
  disabled = false,
  children,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal" className="items-center">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
        <FieldLabel htmlFor={id}>
          Same answer for all {propertyCount} properties
        </FieldLabel>
      </Field>
      {checked ? null : (
        <ul
          aria-label="Answer per property"
          className="flex flex-col divide-y rounded-md border"
        >
          {children}
        </ul>
      )}
    </div>
  )
}

export function ApplyToAllOverride({
  propertyName,
  children,
}: Readonly<{ propertyName: string; children: ReactNode }>) {
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0 truncate text-sm font-medium">{propertyName}</span>
      <div className="sm:w-64">{children}</div>
    </li>
  )
}
