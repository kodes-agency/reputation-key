import { Link } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { PageHeader, type Crumb } from './page-header'
import { FullBleedFrame, PageShell, type PageTier } from './page-shell'

// The one page-level state: a page that is loading, failed, is missing, or is
// not available to the person. Every route fallback and the router's defaults
// draw it, so a page keeps its title, breadcrumbs and width on the way in and
// out of a failure, and a failure looks and reads the same on every page.
//
// It is presentational. The route-bound wrappers (`RoutePending`, `RouteError`,
// `RouteNotFound`) read the page's identity from its route and the guarded error
// behaviour from `useGuardedRouteError`, then hand the result here.

/** The one way out of a page that is missing or unavailable. */
export type PageStateBack = Readonly<{ to: string; label: string }>

export type PageStateFrame = Readonly<{
  /** The page's `h1`. Without one the state draws no header, only its body. */
  title?: string
  breadcrumbs?: readonly Crumb[]
  /** The tier of the page it stands in for, so it does not change width. */
  tier?: PageTier
  /** For a full-bleed surface: wear the page gutter and scroll the state itself. */
  fullBleed?: boolean
}>

export type PageStateProps = PageStateFrame &
  (
    | Readonly<{
        kind: 'loading'
        /** What a screen reader hears while the page loads. */
        label?: string
      }>
    | Readonly<{
        kind: 'error'
        message: string
        /** Re-run the page's loaders. Without it the state offers no retry. */
        onRetry?: () => void
      }>
    | Readonly<{
        kind: 'notFound' | 'unavailable'
        /** What is wrong, in one sentence. */
        heading: string
        /** Why, and what could change it. */
        reason?: string
        back: PageStateBack
      }>
  )

function LoadingBody({ label }: Readonly<{ label: string }>) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

function ErrorBody({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      {onRetry && (
        // The same 44px phone target as a region's Try again (`RetryButton`),
        // which this first-paint file does not import.
        <Button variant="outline" className="max-md:min-h-11" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

function NoticeBody({
  heading,
  reason,
  back,
}: Readonly<{ heading: string; reason?: string; back: PageStateBack }>) {
  return (
    <EmptyState
      icon={CircleAlert}
      title={heading}
      description={reason}
      action={
        <Button variant="outline" asChild>
          <Link to={back.to as never}>{back.label}</Link>
        </Button>
      }
    />
  )
}

function PageStateBody(props: PageStateProps) {
  switch (props.kind) {
    case 'loading':
      return <LoadingBody label={props.label ?? `Loading ${props.title ?? 'page'}`} />
    case 'error':
      return <ErrorBody message={props.message} onRetry={props.onRetry} />
    default:
      return (
        <NoticeBody heading={props.heading} reason={props.reason} back={props.back} />
      )
  }
}

/**
 * A page that is loading, failed, is missing, or is unavailable to the person,
 * in the frame of the page it stands in for. Use through `RoutePending`,
 * `RouteError` and `RouteNotFound` for a route; use it directly where a page
 * decides for itself.
 */
export function PageState(props: PageStateProps) {
  const { title, breadcrumbs, tier, fullBleed } = props
  const state = (
    <PageShell tier={tier}>
      {title && <PageHeader title={title} breadcrumbs={breadcrumbs} />}
      <PageStateBody {...props} />
    </PageShell>
  )
  return fullBleed ? <FullBleedFrame scroll>{state}</FullBleedFrame> : state
}
