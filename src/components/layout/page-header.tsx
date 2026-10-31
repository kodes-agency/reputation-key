import { Children, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '#/lib/utils'
import { Skeleton } from '#/components/ui/skeleton'
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
  /** What the page is, or the name of the entity it is about. The page's one `h1`. */
  title: string
  /**
   * Where you are and what state it is in, one quiet line under the title: the Property
   * the page is about, a count ("3 properties"), a status Badge. Each item is one fact;
   * the header puts the dot between them. Not a sentence of help (`description`).
   */
  meta?: readonly ReactNode[]
  /** One sentence of purpose or help, and nothing else: no count, no name, no status. */
  description?: string
  /**
   * Breadcrumb trail; the last item renders as the current page. Every crumb above
   * it links (build it with `trailCrumbs`, `page-identity`). A page goes up through
   * these: there is no separate back link.
   */
  breadcrumbs?: readonly Crumb[]
  /** Primary-action slot, right-aligned. */
  actions?: ReactNode
  /** A compact explanation alongside the title, separate from primary actions. */
  titleAside?: ReactNode
  /**
   * For the page's loading state only: bars where the loaded header draws its
   * meta and description lines (20 px each), so the content below starts where
   * it will once the page has arrived.
   */
  placeholderLines?: 1 | 2
  className?: string
}>

/**
 * Canonical page header: breadcrumb trail, title, meta line, description, and a
 * primary-action slot. Each slot has one job (see `Props`), so the line under a
 * title reads the same kind of thing on every page.
 */
export function PageHeader({
  title,
  meta,
  description,
  breadcrumbs,
  actions,
  titleAside,
  placeholderLines,
  className,
}: Props) {
  const metaItems = Children.toArray(meta)
  return (
    <div className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((c, i) => (
              <BreadcrumbItem key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                {i === breadcrumbs.length - 1 ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : c.to ? (
                  <BreadcrumbLink asChild>
                    <Link to={c.to as never}>{c.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span>{c.label}</span>
                )}
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3',
          titleAside && 'md:flex-nowrap',
        )}
      >
        <div className={cn('space-y-1', titleAside && 'min-w-0 max-md:w-full')}>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {titleAside}
          </div>
          {metaItems.length ? (
            <p
              data-slot="page-header-meta"
              className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
            >
              {metaItems.map((item, index) => (
                <span key={index}>
                  {index > 0 && <span aria-hidden="true">· </span>}
                  {item}
                </span>
              ))}
            </p>
          ) : null}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {placeholderLines ? (
            <>
              <Skeleton className="h-5 w-72 max-w-full" />
              {placeholderLines === 2 && <Skeleton className="h-5 w-56 max-w-full" />}
            </>
          ) : null}
        </div>
        {actions && (
          <div
            data-slot="page-header-actions"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
