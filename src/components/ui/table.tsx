'use client'

import * as React from 'react'

import { cn } from '#/lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  const { className: focusClassName, ...scroll } = useScrollFocus<HTMLDivElement>()
  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full overflow-x-auto', focusClassName)}
      {...scroll}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

// The outline is inset: a scroller often sits inside a frame that clips, which
// would cut off a ring drawn outside it.
const FOCUS_OUTLINE =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/**
 * Props for a scroll container, so the keyboard can reach it while its content
 * overflows. A scroller with nothing focusable inside cannot be scrolled from the
 * keyboard at all; one that fits takes no tab stop. Re-measured when the
 * container or one of its children present at mount is resized.
 */
function useScrollFocus<T extends HTMLElement>(): Readonly<{
  ref: React.RefCallback<T>
  tabIndex: 0 | undefined
  className: string | undefined
}> {
  const [scrolls, setScrolls] = React.useState(false)
  const ref = React.useCallback((element: T | null) => {
    if (!element) return
    const measure = () =>
      setScrolls(
        element.scrollWidth > element.clientWidth ||
          element.scrollHeight > element.clientHeight,
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [])
  return {
    ref,
    tabIndex: scrolls ? 0 : undefined,
    className: scrolls ? FOCUS_OUTLINE : undefined,
  }
}
