import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '#/lib/utils'

function Breadcrumb({ className, ...props }: React.ComponentProps<'nav'>) {
  return <nav aria-label="breadcrumb" className={cn('text-sm', className)} {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'flex flex-wrap items-center gap-1.5 break-words text-muted-foreground sm:gap-2',
        className,
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li className={cn('inline-flex items-center gap-1.5', className)} {...props} />
}

function BreadcrumbLink({
  asChild,
  className,
  children,
  ...props
}: React.ComponentProps<'a'> & { asChild?: boolean }) {
  if (asChild) {
    // Render the child (e.g. a <Link>) directly — apply the hover class via cloneElement
    // so the styling lands on the right element without depending on Radix Slot.
    return React.isValidElement(children) ? (
      React.cloneElement(children as React.ReactElement<{ className?: string }>, {
        className: cn('transition-colors hover:text-foreground', className),
      })
    ) : (
      <>{children}</>
    )
  }
  return (
    <a className={cn('transition-colors hover:text-foreground', className)} {...props}>
      {children}
    </a>
  )
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-current="page"
      className={cn('font-medium text-foreground', className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'li'>) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn('[&>svg]:size-3.5', className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
}
