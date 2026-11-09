import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { BackLink } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { PageHeader, type Crumb } from './page-header'
import { loadingShapeOf, type HeaderLines, type LoadingShape } from './page-identity'
import { isSurfaceShape, LoadingShapeBody } from './page-state-loading'
import { FullBleedFrame, PageShell, type PageTier } from './page-shell'

// The one page-level state: a page that is loading, failed, is missing, or is
// not available to the person. Every route fallback draws it, so a page keeps its
// title, breadcrumbs and width through a failure.
//
// Presentational: the route-bound wrappers (`RoutePending`, `RouteError`,
// `RouteNotFound`) supply the page's identity and the guarded error behaviour.

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
  /**
   * Loading only: the body that holds the place of the page's content. Left out,
   * the frame decides (`loadingShapeOf`).
   */
  shape?: LoadingShape
  /** Loading only: the header lines under the title the loaded page draws. */
  headerLines?: HeaderLines
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
        <Button variant="outline" onClick={onRetry}>
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
      action={<BackLink to={back.to as never} label={back.label} />}
    />
  )
}

/** The shape a loading state draws: the one it was given, else what its frame implies. */
function shapeOf({ shape, tier, fullBleed }: PageStateFrame): LoadingShape {
  return loadingShapeOf({ loading: shape, tier, fullBleed })
}

function PageStateBody(props: PageStateProps) {
  switch (props.kind) {
    case 'loading':
      return (
        <LoadingShapeBody
          shape={shapeOf(props)}
          label={props.label ?? `Loading ${props.title ?? 'page'}`}
          title={props.title}
        />
      )
    case 'error':
      return <ErrorBody message={props.message} onRetry={props.onRetry} />
    default:
      return (
        <NoticeBody heading={props.heading} reason={props.reason} back={props.back} />
      )
  }
}

/**
 * A page that is loading, failed, missing or unavailable, in the frame of the page
 * it stands in for. Use `RoutePending`, `RouteError` and `RouteNotFound` for a
 * route. A workspace or Inbox loading shape is a whole surface, so no `PageShell`,
 * header or gutter is drawn around it.
 */
export function PageState(props: PageStateProps) {
  const { title, breadcrumbs, tier, fullBleed } = props
  if (props.kind === 'loading' && isSurfaceShape(shapeOf(props))) {
    return <PageStateBody {...props} />
  }
  const lines = props.kind === 'loading' ? (props.headerLines ?? 1) : 0
  const state = (
    <PageShell tier={tier}>
      {title && (
        <PageHeader
          title={title}
          breadcrumbs={breadcrumbs}
          placeholderLines={lines === 0 ? undefined : lines}
        />
      )}
      <PageStateBody {...props} />
    </PageShell>
  )
  return fullBleed ? <FullBleedFrame scroll>{state}</FullBleedFrame> : state
}
