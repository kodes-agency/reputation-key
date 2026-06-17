import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { cn } from '#/lib/utils'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'

export type Crumb = Readonly<{ label: string; to?: string }>

type Props = Readonly<{
  title: string
  description?: string
  /** Breadcrumb trail; the last item renders as the current page. */
  breadcrumbs?: readonly Crumb[]
  /** Primary-action slot, right-aligned. */
  actions?: ReactNode
  /** Contextual "Back to …" link for deep-link destinations (see plan Q9). */
  backTo?: Readonly<{ to: string; label: string }>
  className?: string
}>

/**
 * Canonical page header: optional contextual back link, breadcrumb trail,
 * title + description, and a primary-action slot.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  backTo,
  className,
}: Props) {
  return (
    <div className={cn('space-y-3', className)}>
      {backTo && (
        <Link
          to={backTo.to as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backTo.label}
        </Link>
      )}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1
              return (
                <Fragment key={i}>
                  <BreadcrumbItem>
                    {last || !c.to ? (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={c.to as never}>{c.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!last && <BreadcrumbSeparator />}
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
