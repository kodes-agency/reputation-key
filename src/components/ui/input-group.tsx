import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/shared/class-names/utils'
import { Input } from '#/components/ui/input'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex h-9 max-md:min-h-(--control-touch) min-w-0 w-full items-center rounded-md border border-input shadow-xs outline-none transition-[color,box-shadow] dark:bg-input/30',
        'has-[>[data-align=inline-start]]:[&>input]:pl-2 has-[>[data-align=inline-end]]:[&>input]:pr-2',
        'has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',
        'has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  'flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*="size-"])]:size-4',
  {
    variants: {
      align: {
        'inline-start':
          'order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]',
        'inline-end':
          'order-last pr-3 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        event.currentTarget.parentElement
          ?.querySelector<HTMLInputElement>('input')
          ?.focus()
      }}
      {...props}
    />
  )
}

function InputGroupInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupInput }
