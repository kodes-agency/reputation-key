// The editor's live preview (board A8): the guest page as the saved draft would
// publish it, or as it is live now, in any of the Portal's languages and
// guest states, and "Try as guest" to click through it.
//
// It reads one server function (`getPortalPreview`), handed in by the route the
// way the Results tab's read is, and writes nothing. The query key sits where
// every working-copy write already invalidates (portalKeys.preview), so the
// pane follows the draft as it autosaves.

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalKeys } from '#/shared/queries/query-keys'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import type {
  PortalPreviewOutcome,
  PortalPreviewSource,
} from '#/contexts/portal/application/public-api'
import type { PreviewStateId } from './portal-preview-states'
import { describeUnavailable } from './portal-preview-rules'
import { PHONE_SCALE, PortalPreviewStage } from './portal-preview-stage'
import { phoneFrameSize } from './preview-phone'
import { PortalPreviewToolbar } from './portal-preview-toolbar'
import { usePreviewCopy } from './use-preview-copy'

/** The read, as a route hands it in (a server function takes its input as `data`). */
export type PortalPreviewReader = (args: {
  data: { portalId: string; source: PortalPreviewSource }
}) => Promise<PortalPreviewOutcome>

type Props = Readonly<{
  portalId: string
  getPortalPreview: PortalPreviewReader
}>

export function PortalPreviewPane({ portalId, getPortalPreview }: Props) {
  const [source, setSource] = useState<PortalPreviewSource>('draft')
  const [chosenLocale, setChosenLocale] = useState<GuestLocale | null>(null)
  const [stateId, setStateId] = useState<PreviewStateId>('arrival')
  const [isTrying, setIsTrying] = useState(false)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: portalKeys.preview(portalId, source),
    queryFn: () => getPortalPreview({ data: { portalId, source } }),
    staleTime: 30_000,
    // Switching the version keeps the last page up while the other one loads.
    placeholderData: keepPreviousData,
  })
  const preview = data?.status === 'ready' ? data.preview : null
  // The chosen language may not exist in the other version: fall back to its primary.
  const locale =
    chosenLocale !== null && preview?.locales.includes(chosenLocale)
      ? chosenLocale
      : (preview?.primaryLocale ?? 'en')
  const experience = preview?.experiences[locale]
  const copy = usePreviewCopy(locale)

  return (
    <section aria-labelledby="portal-preview-heading" className="space-y-4">
      {/* The guest fonts are linked here: the editor is not a guest route, so
          nothing else loads them. React hoists and de-duplicates the tag. */}
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <h2 id="portal-preview-heading" className="text-sm font-semibold">
        Preview
      </h2>
      <PortalPreviewToolbar
        locales={preview?.locales ?? []}
        locale={locale}
        onLocaleChange={setChosenLocale}
        source={source}
        onSourceChange={(next) => {
          setSource(next)
          setIsTrying(false)
        }}
        isTrying={isTrying}
        onTryChange={setIsTrying}
        canTry={experience !== undefined && copy.data !== undefined}
      />
      {isError || copy.isError ? (
        <PreviewFailure
          onRetry={() => {
            if (isError) void refetch()
            if (copy.isError) void copy.refetch()
          }}
        />
      ) : isPending || (preview !== null && copy.data === undefined) ? (
        <PreviewSkeleton />
      ) : data?.status === 'unavailable' ? (
        <PreviewUnavailable reason={data.reason} />
      ) : preview && experience && copy.data ? (
        <PortalPreviewStage
          preview={preview}
          experience={experience}
          copy={copy.data}
          locale={locale}
          stateId={stateId}
          onStateChange={setStateId}
          isTrying={isTrying}
          onTryChange={setIsTrying}
        />
      ) : null}
    </section>
  )
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="rounded-[2.2rem]" style={phoneFrameSize(PHONE_SCALE)} />
      <span className="sr-only">Loading preview…</span>
    </div>
  )
}

function PreviewUnavailable({
  reason,
}: Readonly<{ reason: Parameters<typeof describeUnavailable>[0] }>) {
  const note = describeUnavailable(reason)
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{note.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{note.body}</p>
    </div>
  )
}

function PreviewFailure({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div role="alert" className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">The preview couldn’t be loaded</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  )
}
