'use client'

import { useState } from 'react'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Button } from '#/components/ui/button'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '#/lib/utils'
import { VALID_TIMEZONES, getTimezoneOffsetLabel } from '#/shared/domain/timezones'
import type { BaseFieldApi } from '#/components/forms/form-text-field'

type Props = Readonly<{
  field: BaseFieldApi
  label: string
  id: string
}>

export function TimezoneCombobox({ field, label, id }: Props) {
  const [open, setOpen] = useState(false)
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            aria-invalid={isInvalid}
            onBlur={field.handleBlur}
          >
            {field.state.value
              ? VALID_TIMEZONES.includes(field.state.value)
                ? `${getTimezoneOffsetLabel(field.state.value)} - ${field.state.value}`
                : field.state.value
              : 'Select timezone'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search timezone..." />
            <CommandList>
              <CommandEmpty>No timezone found.</CommandEmpty>
              <CommandGroup>
                {VALID_TIMEZONES.map((tz) => (
                  <CommandItem
                    key={tz}
                    value={`${getTimezoneOffsetLabel(tz)} - ${tz}`}
                    onSelect={() => {
                      field.handleChange(tz)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        field.state.value === tz ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="flex-1">
                      {getTimezoneOffsetLabel(tz)} - {tz}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
