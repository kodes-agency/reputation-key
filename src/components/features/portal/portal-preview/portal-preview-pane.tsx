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
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import type {
  PortalPreviewExperience,
  PortalPreviewOutcome,
  PortalPreviewSource,
} from '#/contexts/portal/application/public-api'
import { previewStateOptions, type PreviewStateId } from './portal-preview-states'
import { previewPartOf, stateIdForPart, type PreviewSelection } from './preview-parts'
import { describeUnavailable } from './portal-preview-rules'
import { PHONE_SCALE, PortalPreviewStage } from './portal-preview-stage'
import { phoneFrameSize } from './preview-phone'
import { PortalPreviewToolbar } from './portal-preview-toolbar'
import { usePreviewCopy } from './use-preview-copy'

/** The highest private-feedback threshold a portal can have. */
const MAX_THRESHOLD = 5

/** The read, as a route hands it in (a server function takes its input as `data`). */
export type PortalPreviewReader = (args: {
  data: { portalId: string; source: PortalPreviewSource }
}) => Promise<PortalPreviewOutcome>

type Props = Readonly<{
  portalId: string
  getPortalPreview: PortalPreviewReader
  /**
   * The editor's: with it the parts of the page can be clicked to edit them
   * (and the part of the active section is outlined). Without it, as on the
   * Review page, the phone is a picture.
   */
  selection?: PreviewSelection
}>

export function PortalPreviewPane({ portalId, getPortalPreview, selection }: Props) {
  const [source, setSource] = useState<PortalPreviewSource>('draft')
  const [chosenLocale, setChosenLocale] = useState<GuestLocale | null>(null)
  // Before the preview has loaded its threshold is not known: every valid one
  // (1 to 5) offers the note after a low rating, which is all this needs.
  const [stateId, setStateId] = useState<PreviewStateId>(() =>
    stateIdForPart(
      previewPartOf(selection?.active),
      'arrival',
      previewStateOptions(MAX_THRESHOLD),
    ),
  )
  // Moving to another section shows the guest state that draws its part: the
  // private note is only on the page after a low rating. A state the manager
  // chose that already draws it is kept.
  const [shownFor, setShownFor] = useState(selection?.active)
  const [isTrying, setIsTrying] = useState(false)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: portalKeys.preview(portalId, source),
    queryFn: () => getPortalPreview({ data: { portalId, source } }),
    staleTime: 30_000,
    // Switching the version keeps the last page up while the other one loads.
    placeholderData: keepPreviousData,
  })
  const preview = data?.status === 'ready' ? data.preview : null
  if (shownFor !== selection?.active) {
    setShownFor(selection?.active)
    setStateId(
      stateIdForPart(
        previewPartOf(selection?.active),
        stateId,
        previewStateOptions(preview?.privateFeedbackThreshold ?? MAX_THRESHOLD),
      ),
    )
  }
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
      <PreviewBody
        hasError={isError || copy.isError}
        isPending={isPending}
        data={data}
        copyData={copy.data}
        experience={experience}
        onRetry={() => {
          if (isError) void refetch()
          if (copy.isError) void copy.refetch()
        }}
        locale={locale}
        stateId={stateId}
        onStateChange={setStateId}
        isTrying={isTrying}
        onTryChange={setIsTrying}
        selection={selection}
      />
    </section>
  )
}

type BodyProps = Readonly<{
  hasError: boolean
  isPending: boolean
  data: PortalPreviewOutcome | undefined
  copyData: GuestPortalCopyV2 | undefined
  experience: PortalPreviewExperience | undefined
  onRetry: () => void
  locale: GuestLocale
  stateId: PreviewStateId
  onStateChange: (next: PreviewStateId) => void
  isTrying: boolean
  onTryChange: (next: boolean) => void
  selection: PreviewSelection | undefined
}>

/** What the pane shows under the toolbar: failure, loading, a reason, or the stage. */
function PreviewBody({
  hasError,
  isPending,
  data,
  copyData,
  experience,
  onRetry,
  ...stage
}: BodyProps) {
  if (hasError) return <PreviewFailure onRetry={onRetry} />
  const preview = data?.status === 'ready' ? data.preview : null
  if (isPending || (preview !== null && copyData === undefined))
    return <PreviewSkeleton />
  if (data?.status === 'unavailable') return <PreviewUnavailable reason={data.reason} />
  if (!preview || !experience || !copyData) return null
  return (
    <PortalPreviewStage
      preview={preview}
      experience={experience}
      copy={copyData}
      {...stage}
    />
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
