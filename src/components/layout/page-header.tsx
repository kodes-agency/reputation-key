import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
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
  className,
}: Props) {
  return (
    <div className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((c, i) => (
              <BreadcrumbItem key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <TrailCrumb crumb={c} last={i === breadcrumbs.length - 1} />
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <HeaderMeta items={meta} />
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

function TrailCrumb({ crumb, last }: Readonly<{ crumb: Crumb; last: boolean }>) {
  if (last) return <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
  if (crumb.to) {
    return (
      <BreadcrumbLink asChild>
        <Link to={crumb.to as never}>{crumb.label}</Link>
      </BreadcrumbLink>
    )
  }
  // A place with no address yet is not the page: no link, no current mark.
  return <span>{crumb.label}</span>
}

function HeaderMeta({ items }: Readonly<{ items: readonly ReactNode[] | undefined }>) {
  if (!items || items.length === 0) return null
  return (
    <p
      data-slot="page-header-meta"
      className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </Fragment>
      ))}
    </p>
  )
}
